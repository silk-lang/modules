#!/usr/bin/env python3
"""usage: census.py APP SCENE [--top N] [--json OUT]

The engine census (what Silk UI holds, by container) at each mark of an xbench scene, for a
Silk app (silk-direct, silk-loom, silk-react). The app runs windowless on the bench's fake
clock with SILK_UI_BENCH_CENSUS=24, which prints a census every 24 frames; a mark holds still
for 400 ms (48 frames), so the first census after each `XB mark NAME` line is taken inside it.

Prints, per mark: the process's own footprint, used and reserved bytes summed by owner (the
name's first two parts, such as css.cache or js.heap), and the largest containers. `reserved`
is capacity times record size: what a container asked the allocator for, used or not.
"""
import argparse, collections, json, os, re, subprocess, sys

ROW = re.compile(r"census: phase=(\S+) frame=(\d+) (held|unit|work) (\S+) (.*)")
HEAD = re.compile(r"census: phase=(\S+) frame=(\d+) footprint=(\d+)")


def run(app, scene):
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "apps", app, "out", scene)
    binary = os.path.join(out, app)
    if not os.path.exists(binary):
        sys.exit(f"{binary}: not built (see the app's build script)")
    env = dict(os.environ, SILK_UI_HEADLESS="1", SILK_UI_BENCH="100000000", SILK_UI_BENCH_CENSUS="24")
    p = subprocess.Popen([binary, scene], cwd=out, env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    marks, pending, current = {}, None, None
    for raw in iter(p.stdout.readline, b""):
        line = raw.decode("utf-8", "replace").strip()
        if line.startswith("XB mark "):
            pending, current = line[8:], None
        elif line.startswith("XB done"):
            break
        elif line.startswith("census: "):
            head = HEAD.match(line)
            if head:
                current = None
                if pending:
                    current = marks[pending] = {"frame": int(head.group(2)), "footprint": int(head.group(3)), "held": {}, "unit": {}, "work": {}}
                    pending = None
                continue
            row = ROW.match(line)
            if row and current is not None:
                fields = dict(f.split("=", 1) for f in row.group(5).split() if "=" in f)
                current[row.group(3)][row.group(4)] = {k: int(v) for k, v in fields.items() if v.isdigit()}
    p.kill()
    return marks


def owner(name):
    return ".".join(name.split(".")[:2])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("app")
    ap.add_argument("scene")
    ap.add_argument("--top", type=int, default=12)
    ap.add_argument("--json")
    args = ap.parse_args()
    marks = run(args.app, args.scene)
    if args.json:
        with open(args.json, "w") as f:
            json.dump(marks, f)
    mb = lambda b: f"{b / 1048576:8.1f}"
    for name, m in marks.items():
        used = sum(r["used"] for r in m["held"].values())
        reserved = sum(r["reserved"] for r in m["held"].values())
        print(f"\n== {name} (frame {m['frame']}): footprint {mb(m['footprint'])} MB, counted used {mb(used)} MB, reserved {mb(reserved)} MB")
        by = collections.defaultdict(lambda: [0, 0])
        for n, r in m["held"].items():
            by[owner(n)][0] += r["used"]
            by[owner(n)][1] += r["reserved"]
        print("   used MB  reserved MB  owner")
        for o, (u, r) in sorted(by.items(), key=lambda kv: -kv[1][1])[: args.top]:
            print(f"  {mb(u)}     {mb(r)}  {o}")
        print("   used MB  reserved MB   entries  each  container")
        for n, r in sorted(m["held"].items(), key=lambda kv: -kv[1]["reserved"])[: args.top]:
            print(f"  {mb(r['used'])}     {mb(r['reserved'])} {r['entries']:9d} {r['each']:5d}  {n}")


if __name__ == "__main__":
    main()
