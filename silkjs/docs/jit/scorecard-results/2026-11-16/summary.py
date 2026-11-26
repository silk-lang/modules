#!/usr/bin/env python3
"""Geometric means over the result files of one scorecard run (this directory by default).

Octane: geomean over the 17 score lines of each engine's best, median and worst round.
Octane peak RSS: geomean over the 15 benchmark processes of each engine's median round.
Micro: geomean over the 72 tests of engine ns / silkjs ns (best round each); above 1 means
silkjs is faster.
"""
import json, math, statistics, sys
from pathlib import Path

here = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).parent)
engines = ["silkjs", "v8-jitless", "jsc-nojit", "qjs", "silkjs-wasm", "qjs-wasm", "v8-jit", "jsc-jit"]
geo = lambda xs: math.exp(sum(math.log(x) for x in xs) / len(xs))
octane = json.loads((here / "octane.json").read_text())
rss = json.loads((here / "octane-rss.json").read_text())
micro = json.loads((here / "micro.json").read_text())
print(f"{'engine':12} {'octane best':>11} {'median':>8} {'worst':>8} {'rss MB':>8} {'micro x':>8}")
for e in engines:
    best, med, worst = (round(geo([agg(octane[b][e]) for b in octane])) for agg in (max, statistics.median, min))
    peak = geo([statistics.median(rss[b][e]) for b in rss])
    tests = [t for t in micro if t != "total" and e in micro[t] and "silkjs" in micro[t]]
    ratio = geo([min(micro[t][e]) / min(micro[t]["silkjs"]) for t in tests])
    print(f"{e:12} {best:11} {med:8} {worst:8} {peak:8.1f} {ratio:8.3f}")
