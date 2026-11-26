#!/usr/bin/env python3
"""results/*-timeline.jsonl + results/timelines/ -> results/timeline.json: the start-up of each app
as phases on its threads, with the median of each phase over a session's runs (TIMELINE.md).

  tools/timeline.py [results dir]

A phase: lane (a thread or process), label, kind (the colour), start and end in ms from launch,
and whether it is on the critical path to the first frame (solid) or runs beside it (hatched).

- Silk UI apps: the windowless bench's own lines ("bench: first frame ...", "bench: startup ...",
  "silkui: ..."). With a Silk UI build that has the start-up trace points (SILK_UI_TRACE_FRAMES,
  SILK_UI_TRACE_JS, the windowed path), the main, UI and render threads as in the start-up
  report of 2026-11-19.
- Electron: Chromium's startup trace (browser, GPU and renderer processes, raster workers), read
  the way that report read it.
- Rune, GPUI, FerroUI: the apps' own `XB span` lines (apps/rust-scenes). A span inside another
  splits it, and the time between spans is "untraced".
"""
import json, os, re, statistics, sys
from collections import defaultdict

XB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RESULTS = sys.argv[1] if len(sys.argv) > 1 else os.path.join(XB, "results")

LANES = {
    "process": "process", "main": "main thread", "ui": "UI thread", "render": "render thread",
    "browser": "browser process", "gpu": "GPU process", "renderer": "renderer main", "workers": "renderer workers",
}


class Segs(list):
    def add(self, lane, label, kind, a, b, critical=True):
        if a is None or b is None or b < a:
            return
        self.append(dict(lane=lane, label=label, kind=kind, start=a, end=b, critical=critical))


def first_times(lines):
    t = {}
    for ms, _, line in lines:
        t.setdefault(line.strip(), ms)
    return t


def num(line, key):
    m = re.search(r"(?<![\w-])" + key + r"=([0-9.e+-]+)", line)
    return float(m.group(1)) if m else None


def silk_segments(lines, first_paint):
    """Silk UI, from the trace points (windowed, the start-up report) or the windowless bench's lines."""
    t = first_times(lines)
    g = t.get
    S = Segs()
    js = {}
    for _, _, line in lines:
        m = re.match(r"bench: js entry=\S+ load-ms=([0-9.]+) evaluate-ms=([0-9.]+) render-ms=([0-9.]+) apply-ms=([0-9.]+)", line)
        if m:
            js = dict(load=float(m.group(1)), evaluate=float(m.group(2)), render=float(m.group(3)), apply=float(m.group(4)))
    bench = next(((ms, l) for ms, _, l in lines if l.startswith("bench: first frame")), None)
    startup = next(((ms, l) for ms, _, l in lines if l.startswith("bench: startup")), None)
    main = g("silkui: main")
    first_line = min((ms for ms, _, _ in lines), default=None)
    if main is not None:
        S.add("process", "exec, loader, static init", "start", 0.0, main)
    elif not (bench and startup):
        S.add("process", "exec, loader, static init", "start", 0.0, first_line)
    if main is not None:
        S.add("main", "stylesheets", "style", main, g("silkui: sheets ready"))
        S.add("ui", "start GPU thread", "start", g("silkui: program started"), g("silkui: gpu started"))
        S.add("ui", "load fonts", "fonts", g("silkui: gpu started"), g("silkui: fonts loaded"))
        S.add("ui", "open JS engine", "js", g("silkui: fonts loaded"), g("silkui: engine open"))
        S.add("ui", "bundle in", "js", g("silkui: engine open"), g("silkui: bundle ready"))
    if g("trace: ui start client") is not None:
        # Windowed, with the start-up trace points.
        S.add("main", "window system start", "gpu", g("trace: main platform start"), g("trace: main platform started"), False)
        S.add("render", "GPU instance", "gpu", g("trace: rt begin"), g("trace: rt instance"), False)
        S.add("render", "GPU adapter", "gpu", g("trace: rt instance"), g("trace: rt adapter"), False)
        S.add("render", "GPU device", "gpu", g("trace: rt adapter"), g("trace: rt device"), False)
        S.add("render", "pipelines", "gpu", g("trace: rt device"), g("trace: rt renderer made"), False)
        S.add("ui", "tree + setup", "start", g("silkui: bundle ready"), g("trace: ui start client"))
        cs, ce = g("trace: ui start client"), g("silk-ui: client started")
        if cs is not None and ce is not None and js:
            a = cs
            for name, label in (("load", "JS compile"), ("evaluate", "JS evaluate"), ("render", "React render"), ("apply", "apply to tree")):
                S.add("ui", label, "js", a, a + js[name]); a += js[name]
            S.add("ui", "client other", "js", a, ce)
        else:
            S.add("ui", "client start", "js", cs, ce)
        S.add("ui", "styles", "style", g("trace: ui prepare"), g("trace: ui prepared"))
        S.add("ui", "first layout", "layout", g("trace: ui prepared"), g("trace: ui laid out"))
        S.add("ui", "paint prep", "paint", g("trace: ui laid out"), g("silk-ui: first frame laid out"))
        S.add("ui", "open window", "gpu", g("trace: ui open window"), g("silk-ui: window open"))
        S.add("ui", "attach GPU", "gpu", g("trace: ui attach renderer"), g("silk-ui: gpu ready"))
        if g("trace: ui f1 begin") is not None:
            S.add("ui", "wait for frame", "wait", g("silk-ui: gpu ready"), g("trace: ui f1 begin"))
            S.add("ui", "frame 1: rAF, tick", "js", g("trace: ui f1 begin"), g("trace: ui f1 ticked"))
            S.add("ui", "frame 1: layout", "layout", g("trace: ui f1 ticked"), g("trace: ui f1 laid out"))
            S.add("ui", "frame 1: paint", "paint", g("trace: ui f1 laid out"), g("trace: ui f1 painted"))
            S.add("ui", "frame 1: scene", "paint", g("trace: ui f1 painted"), g("trace: ui f1 uploads copied"))
            S.add("ui", "frame 1: submit", "paint", g("trace: ui f1 uploads copied"), g("silk-ui: frame 1 submitted"))
            S.add("render", "frame 1: draw", "present", g("trace: rt f1 job taken"), g("trace: rt f1 drawn"))
            S.add("render", "present", "present", g("trace: rt f1 drawn"), g("trace: rt f1 present returned"))
            S.add("render", "to screen", "present", g("trace: rt f1 present returned"), g("silk-ui: frame 1 presented"))
        return S, dict(on_screen=g("silk-ui: frame 1 presented") or first_paint, window=g("silk-ui: window shown"))
    if bench and startup:
        # Windowless bench: setup, client start (JavaScript and React, or the app's own tree),
        # open, then style + layout + text shaping of the first frame, all on one thread.
        end = bench[0]
        layout = num(bench[1], "layout-ms")
        opened = num(startup[1], "open-to-layout-ms") or 0.0
        start = num(startup[1], "start-ms")
        setup = num(startup[1], "setup-ms") or 0.0
        a_layout = end - layout
        a_open = a_layout - opened
        a_start = a_open - start
        a_setup = a_start - setup
        lane = "ui" if main is not None else "main"
        if main is None:
            S.add("process", "exec, loader, static init", "start", 0.0, a_setup)
            S.add(lane, "setup", "start", a_setup, a_start)
        else:
            S.add(lane, "tree + setup", "start", g("silkui: bundle ready"), a_start)
        S.add(lane, "client start (JS, React)" if main is not None else "client start (build the tree)", "js", a_start, a_open)
        S.add(lane, "open", "start", a_open, a_layout)
        S.add(lane, "frame 1: style, layout, text", "layout", a_layout, end)
        if first_paint is not None and first_paint - end > 1:
            S.add(lane, "until frame 2 (untraced)", "other", end, first_paint)
    return S, dict(on_screen=first_paint)


def span_segments(lines, first_paint):
    """Rust apps: `XB span begin|end LANE KIND LABEL`. Nested spans split their parent."""
    open_, spans = {}, []
    for ms, _, line in lines:
        m = re.match(r"XB span (begin|end) (\S+) (\S+) (.*)$", line.strip())
        if not m:
            continue
        what, lane, kind, label = m.groups()
        if what == "begin":
            open_[(lane, label)] = (ms, kind)
        elif (lane, label) in open_:
            a, kind = open_.pop((lane, label))
            spans.append(dict(lane=lane, kind=kind, label=label, start=a, end=ms))
    S = Segs()
    if not spans:
        return S, dict(on_screen=first_paint)
    spans.sort(key=lambda s: (s["start"], -s["end"]))
    S.add("main", "process start", "start", 0.0, spans[0]["start"])
    for s in spans:
        kids = [k for k in spans if k is not s and k["lane"] == s["lane"] and k["start"] >= s["start"] and k["end"] <= s["end"]
                and (k["end"] - k["start"]) < (s["end"] - s["start"])]
        a = s["start"]
        for k in sorted(kids, key=lambda k: k["start"]):
            if k["start"] > a + 0.5:
                S.add(s["lane"], s["label"], s["kind"], a, k["start"])
            a = max(a, k["end"])
        if s["end"] > a + 0.5 or not kids:
            S.add(s["lane"], s["label"], s["kind"], a, s["end"])
    # Time on the main lane that no span covers, up to first paint.
    covered = sorted((s["start"], s["end"]) for s in S if s["lane"] == "main")
    end = first_paint if first_paint is not None else covered[-1][1]
    t, gaps = 0.0, []
    for a, b in covered:
        if a - t > 1:
            gaps.append((t, a))
        t = max(t, b)
    if end - t > 1:
        gaps.append((t, end))
    for a, b in gaps:
        S.add("main", "untraced", "other", a, b)
    return S, dict(on_screen=first_paint)


def electron_segments(d):
    """Chromium's startup trace, phase for phase as in the start-up report."""
    ev = d["trace"]["traceEvents"]
    t0 = d["t0_us"]
    names = {e["pid"]: e["args"]["name"] for e in ev if e.get("ph") == "M" and e["name"] == "process_name"}
    pid = {v: k for k, v in names.items()}
    B, G, R = pid.get("Browser"), pid.get("GPU Process"), pid.get("Renderer")
    ms = lambda us: (us - t0) / 1000.0

    def X(name, p=None, after=None, biggest=False):
        xs = [e for e in ev if e.get("ph") == "X" and e["name"] == name and (p is None or e["pid"] == p)
              and (after is None or ms(e["ts"]) >= after)]
        if not xs:
            return None
        e = max(xs, key=lambda e: e.get("dur", 0)) if biggest else min(xs, key=lambda e: e["ts"])
        return ms(e["ts"]), ms(e["ts"] + e.get("dur", 0))

    def first(p):
        xs = [e["ts"] for e in ev if e.get("pid") == p and e.get("ts")]
        return ms(min(xs)) if xs else None

    def instant(name, p=None):
        xs = [e["ts"] for e in ev if e["name"] == name and (p is None or e["pid"] == p) and e.get("ts")]
        return ms(min(xs)) if xs else None

    S = Segs()
    init = X("BrowserMainRunnerImpl::Initialize", B)
    if not init:
        # Linux traces have no BrowserMainRunnerImpl::Initialize: the browser's first event to
        # the end of BrowserMainLoop::PreMainMessageLoopRun.
        pre, b0 = X("BrowserMainLoop::PreMainMessageLoopRun", B), first(B)
        init = (b0, pre[1]) if pre and b0 is not None else None
    S.add("browser", "exec, Electron framework load", "start", 0.0, init[0] if init else first(B))
    if init:
        S.add("browser", "Chromium browser init", "start", init[0], init[1])
    nav = X("Navigator::Navigate", B)
    if init and nav:
        S.add("browser", "Node, main.cjs, app ready, BrowserWindow", "start", init[1], nav[0])
    gpu0, gi = first(G), X("gpu::GpuInit::InitializeAndStartSandbox", G)
    if gpu0 is not None and gi:
        S.add("gpu", "GPU process start", "gpu", gpu0, gi[0], False)
        S.add("gpu", "GPU init", "gpu", gi[0], gi[1], False)
    rinit, commit = X("RenderThreadImpl::Init", R), X("RenderFrameImpl::CommitNavigation", R)
    if nav and rinit:
        S.add("renderer", "renderer process start", "start", nav[0], rinit[0])
    if rinit:
        S.add("renderer", "renderer init", "start", rinit[0], rinit[1])
    if rinit and commit:
        S.add("renderer", "wait for navigation", "wait", rinit[1], commit[0])
    if commit:
        S.add("renderer", "commit navigation, HTML", "start", commit[0], commit[1])
    parse = X("v8.parseOnBackground", R)
    if parse:
        S.add("workers", "parse bundle (background)", "js", parse[0], parse[1], False)
    evalm = X("v8.evaluateModule", R)
    react = X("v8.callFunction", R, after=evalm[0] if evalm else None, biggest=True)
    fp = d.get("first_paint_ms") or 1e12
    if commit and evalm:
        S.add("renderer", "load + compile bundle", "js", commit[1], evalm[0])
    if evalm:
        S.add("renderer", "evaluate bundle", "js", evalm[0], evalm[1])
    if evalm and react:
        S.add("renderer", "wait (task)", "wait", evalm[1], react[0])
    if react:
        S.add("renderer", "React render", "js", react[0], react[1])
    # Each main frame up to the app's first paint: style, layout, then prepaint, paint, commit.
    frames = sorted((e for e in ev if e.get("ph") == "X" and e["name"] == "ProxyMain::BeginMainFrame" and e["pid"] == R
                     and e.get("dur", 0) > 1000 and react and ms(e["ts"]) >= react[1] and ms(e["ts"]) < fp), key=lambda e: e["ts"])
    if react and frames:
        S.add("renderer", "script tail", "js", react[1], ms(frames[0]["ts"]))
    prev = None
    for n, f in enumerate(frames, 1):
        a, b = ms(f["ts"]), ms(f["ts"] + f["dur"])
        if prev is not None:
            S.add("renderer", "wait for frame", "wait", prev, a)
        inside = lambda name: [e for e in ev if e.get("ph") == "X" and e["name"] == name and e["pid"] == R and e["tid"] == f["tid"]
                               and f["ts"] <= e["ts"] and e["ts"] + e.get("dur", 0) <= f["ts"] + f["dur"]]
        st, lo = inside("UpdateLayoutTree"), inside("Layout")
        t = a
        if st:
            e = max(st, key=lambda e: e["dur"])
            S.add("renderer", f"frame {n}: style", "style", ms(e["ts"]), ms(e["ts"] + e["dur"])); t = ms(e["ts"] + e["dur"])
        if lo:
            e = max(lo, key=lambda e: e["dur"])
            S.add("renderer", f"frame {n}: layout", "layout", max(t, ms(e["ts"])), ms(e["ts"] + e["dur"])); t = ms(e["ts"] + e["dur"])
        S.add("renderer", f"frame {n}: prepaint, paint, commit", "paint", t, b)
        prev = b
    bmf = (ms(frames[0]["ts"]), ms(frames[0]["ts"] + frames[0]["dur"])) if frames else None
    if prev is not None and fp < 1e12:
        S.add("renderer", "to first paint (2 rAF)", "wait", prev, fp)
    fcp = instant("firstContentfulPaint", R)
    rast = [e for e in ev if e.get("ph") == "X" and e["name"] == "RasterTask" and e["pid"] == R and bmf and ms(e["ts"]) >= bmf[0]]
    if rast:
        ra = min(ms(e["ts"]) for e in rast)
        before = [ms(e["ts"] + e["dur"]) for e in rast if ms(e["ts"]) < fp]
        rb = max(before) if before else ra
        S.add("workers", "raster", "paint", ra, rb, False)
        flush = X("RendererRasterWorker", G, after=ra)
        if flush:
            S.add("gpu", "GPU raster", "paint", flush[0], flush[1])
        da = X("Display::DrawAndSwap", G, after=max(rb, flush[1] if flush else rb))
        if da:
            S.add("gpu", "draw + swap", "present", da[0], da[1])
            if fcp and fcp > da[1]:
                S.add("gpu", "to screen", "present", da[1], fcp)
    return S, dict(on_screen=d.get("first_paint_ms") or fcp, fcp=fcp)


def segments(app, d):
    if app == "electron":
        if "trace" in d:
            return electron_segments(d)
        return Segs(), dict(on_screen=d.get("first_paint_ms"))
    if app.startswith("silk-"):
        return silk_segments(d["lines"], d.get("first_paint_ms"))
    return span_segments(d["lines"], d.get("first_paint_ms"))


def main():
    groups = defaultdict(list)
    for name in sorted(os.listdir(RESULTS)):
        if not name.endswith("-timeline.jsonl"):
            continue
        for line in open(os.path.join(RESULTS, name)):
            if not line.strip():
                continue
            rec = json.loads(line)
            path = rec.get("timeline")
            if not path or not os.path.exists(os.path.join(XB, path)):
                continue
            groups[(rec["session"], rec["suite"], rec["app"], rec["scene"], rec["kind"])].append(rec)

    out, summaries = [], []
    for (session, suite, app, scene, kind), recs in sorted(groups.items()):
        runs = []
        for r in recs:
            try:
                d = json.load(open(os.path.join(XB, r["timeline"])))
            except (OSError, ValueError):
                continue
            S, marks = segments(app, d)
            end = marks.get("on_screen")
            S = [x for x in S if x["end"] - x["start"] >= 0.05 and (end is None or x["start"] < end - 0.05)]
            if S:
                runs.append((S, marks))
        if not runs:
            continue
        keyed, order = defaultdict(list), []
        for S, _ in runs:
            seen = defaultdict(int)
            for s in S:
                # The same label can come back on one lane (a split parent, "untraced").
                seen[(s["lane"], s["label"])] += 1
                k = (s["lane"], s["label"], seen[(s["lane"], s["label"])])
                if k not in keyed:
                    order.append((k, s["kind"], s["critical"]))
                keyed[k].append((s["start"], s["end"]))
        segs = []
        for k, skind, crit in order:
            xs = keyed[k]
            if len(xs) * 2 < len(runs):
                continue  # in fewer than half the runs
            segs.append(dict(lane=k[0], lane_name=LANES.get(k[0], k[0]), label=k[1], kind=skind, critical=crit,
                             start=round(statistics.median(a for a, _ in xs), 1), end=round(statistics.median(b for _, b in xs), 1),
                             dur=round(statistics.median(b - a for a, b in xs), 1), n=len(xs)))
        segs.sort(key=lambda s: (list(LANES).index(s["lane"]) if s["lane"] in LANES else 99, s["start"]))
        on = [m["on_screen"] for _, m in runs if m.get("on_screen") is not None]
        fcp = [m["fcp"] for _, m in runs if m.get("fcp") is not None]
        first = recs[0]
        head = dict(
            session=session, date=session[:10], suite=suite, app=app, scene=scene, kind=kind, runs=len(runs),
            machine=first["machine"].get("host", ""), cpu=first["machine"].get("cpu", ""), label=first.get("label", ""),
            on_screen=round(statistics.median(on), 1) if on else None,
            fcp=round(statistics.median(fcp), 1) if fcp else None,
        )
        # One flat row per phase: the dashboard's datasets are tables, not nested documents.
        for i, sg in enumerate(segs):
            out.append(dict(head, order=i, lane=sg["lane"], lane_name=sg["lane_name"], phase=sg["label"], phase_kind=sg["kind"],
                            critical=sg["critical"], start=sg["start"], end=sg["end"], dur=sg["dur"], n=sg["n"]))
        summaries.append(head)
    path = os.path.join(RESULTS, "timeline.json")
    with open(path, "w") as f:
        f.write("[\n" + ",\n".join(json.dumps(r, separators=(",", ":")) for r in out) + "\n]\n")
    for r in summaries:
        print(f"{r['session']} {r['suite']:3} {r['app']:12} {r['scene']:6} {r['kind']:4} n={r['runs']} on-screen={r['on_screen']}")
    print(path)


if __name__ == "__main__":
    main()
