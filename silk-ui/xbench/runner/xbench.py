#!/usr/bin/env python3
"""Runs the xbench scenes and appends one JSON record per run to results/<suite>.jsonl.

  xbench.py run --suite cpu --apps electron,silk-react --scenes feed,wall --runs 3
  xbench.py start --suite gpu --apps electron,silk-react --runs 10     # start-up only: cold + warm
  xbench.py run --suite gpu --uncapped ...                             # the GPU suite (a Mac)

What it measures (PROTOCOL.md has the app side, METRICS.md the definitions):
- start: process spawn to the app's "XB first-paint" line. The first launch of each app after its
  files were dropped from the page cache is "cold"; the launches after it are "warm".
- memory at each "XB mark": the app's process tree is stopped (SIGSTOP), measured, continued.
  macOS: `footprint` (phys_footprint, what Activity Monitor shows) summed over the tree; Linux: PSS
  summed over the tree, RSS beside it.
- each driver ("XB begin"/"XB end"): wall time and CPU time (all threads, all processes) of its
  frames, and the app's own frame intervals when its clock is real.
- each idle window ("XB idle-begin"/"XB idle-end"): CPU use, in percent of one core.
"""
import shutil, argparse, datetime, json, os, platform, re, signal, socket, statistics, subprocess, sys, tempfile, threading, time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from apps import APP_TABLE, XB, MAC  # noqa: E402

TICK = os.sysconf("SC_CLK_TCK") if not MAC else 100


# ---------- process tree, CPU and memory ----------

def children_map():
    if MAC:
        out = subprocess.run(["ps", "-A", "-o", "pid=,ppid="], capture_output=True, text=True).stdout
        pairs = [tuple(map(int, l.split())) for l in out.splitlines() if l.strip()]
    else:
        pairs = []
        for d in os.listdir("/proc"):
            if d.isdigit():
                try:
                    with open(f"/proc/{d}/stat") as f:
                        s = f.read()
                    pairs.append((int(d), int(s[s.rindex(")") + 2:].split()[1])))
                except OSError:
                    pass
    kids = {}
    for pid, ppid in pairs:
        kids.setdefault(ppid, []).append(pid)
    return kids


def tree(root):
    kids = children_map()
    out, todo = [], [root]
    while todo:
        p = todo.pop()
        out.append(p)
        todo += kids.get(p, [])
    return out


def cpu_seconds(pids):
    """User + system CPU seconds of the processes (all their threads)."""
    total = 0.0
    if MAC:
        out = subprocess.run(["ps", "-o", "time=", "-p", ",".join(map(str, pids))], capture_output=True, text=True).stdout
        for t in out.split():
            parts = [float(x) for x in t.replace("-", ":").split(":")]
            secs = 0.0
            for x in parts:
                secs = secs * 60 + x
            total += secs
        return total
    for p in pids:
        try:
            with open(f"/proc/{p}/stat") as f:
                s = f.read()
            fields = s[s.rindex(")") + 2:].split()
            total += (int(fields[11]) + int(fields[12])) / TICK
        except OSError:
            pass
    return total


def memory(pids):
    """Memory of the tree in bytes: footprint on macOS, PSS (and RSS) on Linux."""
    if MAC:
        # footprint cannot write JSON to /dev/stdout on macOS 27 ("Permission denied"), so it goes
        # through a file. RSS is kept beside it: it counts freed pages that malloc marked reusable.
        rss = subprocess.run(["ps", "-o", "rss=", "-p", ",".join(map(str, pids))], capture_output=True, text=True).stdout
        out = {"rss": sum(int(x) for x in rss.split()) * 1024, "processes": len(pids)}
        fd, path = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        try:
            args = ["footprint", "-f", "bytes", "-j", path]
            for p in pids:
                args += ["-p", str(p)]
            subprocess.run(args, capture_output=True, text=True)
            with open(path) as f:
                j = json.load(f)
            out.update(footprint=j.get("total footprint"), processes=len(j.get("processes", [])))
        except Exception:
            pass
        finally:
            os.remove(path)
        return out
    pss = rss = n = 0
    for p in pids:
        try:
            with open(f"/proc/{p}/smaps_rollup") as f:
                for line in f:
                    if line.startswith("Pss:"):
                        pss += int(line.split()[1]) * 1024
                    elif line.startswith("Rss:"):
                        rss += int(line.split()[1]) * 1024
            n += 1
        except OSError:
            pass
    return {"pss": pss, "rss": rss, "processes": n}


def app_pids(root, launch):
    """The app's processes: the tree under the spawned process, without the X server or the
    xvfb-run shell (they are the display's, not the app's)."""
    pids = tree(root)
    out = []
    for p in pids:
        try:
            comm = open(f"/proc/{p}/comm").read().strip() if not MAC else ""
        except OSError:
            continue
        if comm in ("Xvfb", "xvfb-run", "xauth", "sh", "bash"):
            continue
        out.append(p)
    return out


def signal_tree(pids, sig):
    for p in pids:
        try:
            os.kill(p, sig)
        except OSError:
            pass


# ---------- cold start ----------

def purge_mac():
    """`sudo purge`: with the password from the file XB_PURGE_SECRET names when set, else `sudo -n`
    (works when sudoers allows purge without a password). False when neither works."""
    secret = os.environ.get("XB_PURGE_SECRET")
    if secret:
        with open(secret) as f:
            ok = subprocess.run(["sudo", "-S", "-p", "", "purge"], stdin=f, capture_output=True).returncode == 0
    else:
        ok = subprocess.run(["sudo", "-n", "purge"], capture_output=True).returncode == 0
    time.sleep(1.0)  # let the system settle after purge
    return ok


def evict(paths):
    """Drops the app's files from the page cache, so the next launch reads them from disk.
    Linux: posix_fadvise on every file. macOS: `sudo purge` (purge_mac), else the launch is not cold."""
    if MAC:
        return purge_mac()
    files = []
    for root in paths:
        if os.path.isdir(root):
            for d, _, names in os.walk(root):
                files += [os.path.join(d, n) for n in names]
        elif os.path.isfile(root):
            files.append(root)
    done = 0
    for path in files:
        try:
            fd = os.open(path, os.O_RDONLY)
            os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
            os.close(fd)
            done += 1
        except OSError:
            pass
    return done > 0


def mapped_files(pids):
    """Every file the processes map (shared libraries, fonts, the binary): evicted for cold runs."""
    found = set()
    if MAC:
        return found
    for p in pids:
        try:
            for line in open(f"/proc/{p}/maps"):
                parts = line.split(None, 5)
                if len(parts) == 6 and parts[5].startswith("/") and not parts[5].startswith(("/dev", "/proc", "/memfd")):
                    found.add(parts[5].strip().split(" (deleted)")[0])
        except OSError:
            pass
    return found


# ---------- one run ----------

# Chromium's startup trace for Electron in timeline runs: the categories the startup report used.
ELECTRON_TRACE_CATS = ",".join(["toplevel", "startup", "navigation", "loading", "blink", "blink.user_timing", "v8", "v8.execute",
                                "devtools.timeline", "disabled-by-default-devtools.timeline", "viz", "gpu", "cc", "benchmark",
                                "electron", "browser", "content", "renderer_host", "ui", "latencyInfo"])


def run_once(app, scene, suite, uncapped, kind, timeout, start_only, extra_files, timeline=None):
    """timeline: a path to write this launch's trace to (every output line with its arrival time,
    and Chromium's startup trace for Electron); the launch then ends shortly after first paint."""
    launch = APP_TABLE[app](scene, suite, uncapped)
    env = dict(os.environ)
    for k in ("SILK_UI_UNCAPPED", "XB_UNCAPPED", "XB_WINDOWLESS", "SILK_UI_BENCH", "SILK_UI_HEADLESS", "NODE_OPTIONS", "ELECTRON_RUN_AS_NODE"):
        env.pop(k, None)
    env.update(launch.env)
    trace_file = None
    if timeline:
        start_only = True
        # Silk UI's startup trace points (on a checkout that has them) and the apps' own spans.
        env.update({"SILK_UI_TRACE_FRAMES": "1", "SILK_UI_TRACE_JS": "1", "XB_TRACE": "1"})
        if app == "electron":
            trace_file = timeline + ".chrome.json"
            at = next(i for i, c in enumerate(launch.cmd) if os.path.basename(c).lower() == "electron")
            launch.cmd[at + 1:at + 1] = [f"--trace-startup={ELECTRON_TRACE_CATS}", f"--trace-startup-file={trace_file}",
                                         "--trace-startup-duration=4", "--trace-startup-format=json"]
    if kind == "cold":
        for d in launch.caches:
            shutil.rmtree(d, ignore_errors=True)
        cold_ok = evict(list(launch.files) + sorted(extra_files))
    else:
        cold_ok = None
    lines = []
    record = {
        "app": app, "scene": scene, "suite": suite, "uncapped": uncapped, "kind": kind,
        "cache_dropped": cold_ok, "marks": {}, "drivers": {}, "idle": {}, "notes": [],
    }
    traced = []
    t0 = time.monotonic()
    proc = subprocess.Popen(launch.cmd, cwd=launch.cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            start_new_session=True)
    events = []
    lock = threading.Condition()

    def reader(stream, name):
        for raw in iter(stream.readline, b""):
            now = time.monotonic()
            line = raw.decode("utf-8", "replace").rstrip("\n")
            with lock:
                events.append((now, name, line))
                lock.notify()

    threads = [threading.Thread(target=reader, args=(proc.stdout, "out"), daemon=True),
               threading.Thread(target=reader, args=(proc.stderr, "err"), daemon=True)]
    for t in threads:
        t.start()
    state = {"begin": {}, "idle": {}}
    seen = 0
    deadline = t0 + timeout
    files_seen = set()
    done = False
    while not done:
        with lock:
            while seen >= len(events) and proc.poll() is None and time.monotonic() < deadline:
                lock.wait(0.2)
            batch = events[seen:]
            seen = len(events)
        if not batch and (proc.poll() is not None or time.monotonic() >= deadline):
            if timeline and record.get("first_paint_ms") is not None:
                pass  # a timeline launch ends a little after first paint
            elif proc.poll() is None:
                record["notes"].append("timeout")
            else:
                record["notes"].append(f"exited {proc.returncode} before done")
            break
        for now, stream, line in batch:
            lines.append(line)
            if timeline:
                traced.append((round((now - t0) * 1000, 2), stream, line))
            at = line.find("XB ")
            if at < 0:
                # Silk UI with SILK_UI_TRACE_CANVAS: the running total of canvas frames the renderer
                # showed (in the window or in a layer), so a driver can count frames shown, not only
                # frames its rAF loop presented.
                shown = re.search(r"silk-ui: canvas shown (\d+)", line)
                if shown:
                    state["shown"] = int(shown.group(1))
                    continue
                # Silk UI with SILK_UI_TRACE_PRESENTS: the running total of frames the window showed.
                # Uncapped, an app's frame callbacks can outrun what reaches the screen.
                window = re.search(r"silk-ui: frames shown (\d+)", line)
                if window:
                    state["window_shown"] = int(window.group(1))
                    continue
                bench = re.search(r"bench: first frame start-to-layout-ms=([\d.e-]+) layout-ms=([\d.e-]+) paint-ms=([\d.e-]+) nodes=(\d+) fragments=(\d+)", line)
                if bench:
                    record["silk_first_frame"] = {"start_to_layout_ms": float(bench.group(1)), "layout_ms": float(bench.group(2)),
                                                  "paint_ms": float(bench.group(3)), "nodes": int(bench.group(4)), "fragments": int(bench.group(5))}
                continue
            words = line[at + 3:].split(" ")
            ev = words[0]
            if ev == "first-paint":
                record["first_paint_ms"] = (now - t0) * 1000
                pids = app_pids(proc.pid, launch)
                files_seen |= mapped_files(pids)
                if start_only:
                    record["marks"]["first-paint"] = measure(pids)
                    if not timeline:
                        done = True
                        break
                    # A trace also wants the frames right after first paint, and Electron's trace file.
                    deadline = min(deadline, now + (6.0 if trace_file else 0.6))
            elif ev == "mark":
                pids = app_pids(proc.pid, launch)
                signal_tree(pids, signal.SIGSTOP)
                try:
                    record["marks"][words[1]] = measure(pids)
                finally:
                    signal_tree(pids, signal.SIGCONT)
            elif ev == "begin":
                state["begin"][words[1]] = (now, cpu_seconds(app_pids(proc.pid, launch)), state.get("shown"), state.get("window_shown"))
            elif ev == "end":
                name, frames = words[1], int(words[2])
                b = state["begin"].pop(name, None)
                if b:
                    wall = (now - b[0]) * 1000
                    cpu = (cpu_seconds(app_pids(proc.pid, launch)) - b[1]) * 1000
                    record["drivers"].setdefault(name, {}).update({
                        "frames": frames, "wall_ms": wall, "cpu_ms": cpu,
                        "frame_ms": wall / max(frames, 1), "cpu_ms_per_frame": cpu / max(frames, 1),
                    })
                    if b[2] is not None or state.get("shown") is not None:
                        # Lines on stderr and stdout arrive on two pipes: a few frames either way.
                        shown_frames = (state.get("shown") or 0) - (b[2] or 0)
                        record["drivers"][name]["canvas_shown"] = shown_frames
                        record["drivers"][name]["canvas_shown_per_s"] = shown_frames * 1000 / wall if wall > 0 else None
                    if state.get("window_shown") is not None:
                        # The trace says at most a line a display frame: a few frames either way.
                        window_frames = state["window_shown"] - (b[3] or 0)
                        record["drivers"][name]["shown"] = window_frames
                        record["drivers"][name]["shown_per_s"] = window_frames * 1000 / wall if wall > 0 else None
                        record["drivers"][name]["cpu_ms_per_shown"] = cpu / window_frames if window_frames > 0 else None
            elif ev == "frames":
                if not launch.fake_clock and len(words) > 2 and words[2]:
                    gaps = [float(x) for x in words[2].split(",") if x]
                    record["drivers"].setdefault(words[1], {})["intervals"] = summarize(gaps)
            elif ev == "idle-begin":
                state["idle"][words[1]] = (now, cpu_seconds(app_pids(proc.pid, launch)))
            elif ev == "idle-end":
                b = state["idle"].pop(words[1], None)
                if b:
                    secs = now - b[0]
                    cpu = cpu_seconds(app_pids(proc.pid, launch)) - b[1]
                    record["idle"][words[1]] = {"seconds": secs, "cpu_pct": 100 * cpu / secs if secs > 0 else None,
                                                "meaningful": not launch.fake_clock}
            elif ev == "done":
                done = True
                break
    record["wall_s"] = time.monotonic() - t0
    if trace_file:
        # Chromium writes the trace when its duration ends: wait for it.
        for _ in range(60):
            if os.path.exists(trace_file) and os.path.getsize(trace_file) > 0:
                time.sleep(0.5)
                break
            time.sleep(0.1)
    if timeline:
        out = {"t0_us": t0 * 1e6, "lines": traced, "first_paint_ms": record.get("first_paint_ms")}
        if trace_file:
            try:
                with open(trace_file, errors="replace") as f:
                    trace = json.load(f)
                # Keep launch to first paint plus 300 ms: the analysis needs nothing later.
                end = t0 * 1e6 + ((record.get("first_paint_ms") or 4000) + 300) * 1000
                events = trace.get("traceEvents", trace) if isinstance(trace, dict) else trace
                out["trace"] = {"traceEvents": [e for e in events if e.get("ph") == "M" or (e.get("ts") or 0) <= end]}
            except Exception as error:
                out["trace_error"] = repr(error)
            try:
                os.remove(trace_file)
            except OSError:
                pass
        with open(timeline, "w") as f:
            json.dump(out, f)
        record["timeline"] = os.path.relpath(timeline, XB)
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except OSError:
        pass
    proc.wait()
    paths = [l.split("silk-ui: ", 1)[1] for l in lines if "silk-ui: canvas frames" in l]
    if paths:
        record["canvas_path"] = paths
    errors = [l for l in lines if "XB " not in l and re.search(r"error|panic|failed|exception", l, re.I) and "dbus" not in l]
    if errors:
        record["notes"] += errors[:5]
    return record, files_seen


def measure(pids):
    m = memory(pids)
    m["mb"] = round((m.get("footprint") or m.get("pss") or m.get("rss") or 0) / 1048576, 1)
    return m


def summarize(gaps):
    if not gaps:
        return None
    s = sorted(gaps)
    pick = lambda q: s[min(len(s) - 1, int(q * len(s)))]
    return {"n": len(s), "mean": statistics.fmean(s), "p50": pick(0.5), "p95": pick(0.95), "p99": pick(0.99), "max": s[-1],
            "over_8_3": sum(1 for g in s if g > 8.34), "over_16_7": sum(1 for g in s if g > 16.7)}


# ---------- provenance ----------

def git_rev(path):
    r = subprocess.run(["git", "-C", path, "rev-parse", "--short=10", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip() or None


def machine():
    name = socket.gethostname().split(".")[0]
    if MAC:
        chip = subprocess.run(["sysctl", "-n", "machdep.cpu.brand_string"], capture_output=True, text=True).stdout.strip()
    else:
        chip = next((l.split(":", 1)[1].strip() for l in open("/proc/cpuinfo") if l.startswith("model name")), platform.machine())
    if MAC:
        # Not the host name (it is usually the owner's name): the chip, as "mac-m1-max".
        name = "mac-" + re.sub(r"[^a-z0-9]+", "-", chip.lower().replace("apple", "")).strip("-")
    info = {"host": os.environ.get("XB_MACHINE", name), "os": platform.platform(), "cpu": chip, "cores": os.cpu_count()}
    if MAC:
        # Dark mode costs Silk UI a second layout before its first frame (its early layout assumes
        # light): record the appearance so start times from the two can be told apart.
        dark = subprocess.run(["defaults", "read", "-g", "AppleInterfaceStyle"], capture_output=True, text=True).stdout.strip()
        info["appearance"] = "dark" if dark == "Dark" else "light"
    return info


def versions():
    """What each app was built from: apps/<app>/out/VERSION (written by its build script)."""
    out = {}
    for app in APP_TABLE:
        f = os.path.join(XB, "apps", app, "VERSION")
        if os.path.exists(f):
            try:
                out[app] = json.load(open(f))
            except Exception:
                out[app] = open(f).read().strip()
    # Apps with no build script record: the framework's own version or commit.
    try:
        out.setdefault("electron", {"electron": json.load(open(os.path.join(XB, "apps/electron/node_modules/electron/package.json")))["version"]})
    except Exception:
        pass
    for app, repo in (("rune", "vendor/rune"), ("gpui", "vendor/zed")):
        rev = git_rev(os.path.join(XB, "apps", app, repo))
        if rev:
            out.setdefault(app, {app: rev})
    try:
        lock = open(os.path.join(XB, "apps/ferroui/Cargo.lock")).read()
        m = re.search(r'name = "ferroui-view"\nversion = "([^"]+)"', lock)
        if m:
            out.setdefault("ferroui", {"ferroui": m.group(1)})
    except Exception:
        pass
    return out


# ---------- main ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("what", choices=["run", "start", "timeline"],
                    help="run: the whole scene; start: start-up only; timeline: start-up with a trace of every thread (TIMELINE.md)")
    ap.add_argument("--suite", choices=["cpu", "gpu"], required=True)
    ap.add_argument("--apps", default=",".join(APP_TABLE))
    ap.add_argument("--scenes", default="feed,wall,stream,churn")
    ap.add_argument("--runs", type=int, default=1)
    ap.add_argument("--uncapped", action="store_true", help="gpu suite: no vsync (the cpu suite never has one)")
    ap.add_argument("--cold", type=int, default=1, help="how many of the first runs start cold")
    ap.add_argument("--timeout", type=float, default=600)
    ap.add_argument("--out", default=None)
    ap.add_argument("--prime", type=int, default=1 if MAC else 0,
                    help="discarded launches per app before measuring (macOS checks a newly built binary on its first launch, about 950 ms)")
    ap.add_argument("--label", default="", help="free text stored with every record (what changed)")
    a = ap.parse_args()
    apps = [x for x in a.apps.split(",") if x]
    scenes = ["feed"] if a.what in ("start", "timeline") and a.scenes == "feed,wall,stream,churn" else a.scenes.split(",")
    out = a.out or os.path.join(XB, "results", f"{a.suite}{'-timeline' if a.what == 'timeline' else ''}.jsonl")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    session = {
        "session": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "machine": machine(), "xbench": git_rev(XB), "versions": versions(), "label": a.label,
    }
    # The files each app mapped in earlier runs (libraries, fonts): evicted too for cold starts.
    os.makedirs(os.path.join(XB, "results"), exist_ok=True)
    cache = os.path.join(XB, "results", "mapped-files.json")
    try:
        extra = {k: set(v) for k, v in json.load(open(cache)).items()}
    except Exception:
        extra = {}
    if MAC and a.suite == "gpu":
        # Keep the display awake for the whole series.
        subprocess.Popen(["caffeinate", "-dimsu", "-w", str(os.getpid())])
    for app in apps:
        for _ in range(a.prime):
            run_once(app, scenes[0], a.suite, a.uncapped or a.suite == "cpu", "warm", a.timeout, True, set())
    for scene in scenes:
        if scene.split("-")[0] == "canvas":
            # The canvas scene draws with WebGPU: a GPU and one of the two apps that have it.
            unfit = [x for x in apps if x not in ("electron", "silk-react")]
            if a.suite != "gpu" or unfit:
                raise SystemExit("the canvas scene runs in the gpu suite, with electron and silk-react only")
        if scene.split("-")[0] in ("chat", "input"):
            # The chat and input scenes exist for the two React apps only (LOG.md).
            unfit = [x for x in apps if x not in ("electron", "silk-react")]
            if unfit:
                raise SystemExit(f"the {scene.split('-')[0]} scene runs with electron and silk-react only")
        for r in range(a.runs):
            # Interleaved: every app once per round, so drift (thermal, other load) hits all alike.
            order = apps if r % 2 == 0 else apps[::-1]
            for app in order:
                kind = "cold" if r < a.cold else "warm"
                trace = None
                if a.what == "timeline":
                    tdir = os.path.join(XB, "results", "timelines", session["session"].replace(":", ""))
                    os.makedirs(tdir, exist_ok=True)
                    trace = os.path.join(tdir, f"{app}-{scene}-{kind}-{r}.json")
                rec, files = run_once(app, scene, a.suite, a.uncapped or a.suite == "cpu", kind, a.timeout,
                                      a.what == "start", extra.get(app, set()), timeline=trace)
                extra.setdefault(app, set()).update(files)
                json.dump({k: sorted(v) for k, v in extra.items()}, open(cache, "w"))
                rec.update(session)
                rec["run"] = r
                rec["mode"] = a.what
                with open(out, "a") as f:
                    f.write(json.dumps(rec) + "\n")
                fp = rec.get("first_paint_ms")
                drv = " ".join(f"{k}={v.get('frame_ms', 0):.2f}ms/f" for k, v in rec["drivers"].items())
                mem = " ".join(f"{k}={v['mb']}" for k, v in rec["marks"].items())
                print(f"{app:12s} {scene:8s} {kind} first-paint={fp and round(fp)}ms {drv} mem[{mem}] {' '.join(rec['notes'])[:120]}", flush=True)


if __name__ == "__main__":
    main()
