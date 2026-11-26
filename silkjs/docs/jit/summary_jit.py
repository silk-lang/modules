#!/usr/bin/env python3
"""Geometric means over Octane score lines per engine (best, median, worst round), from octane.json."""
import json, math, sys
table = json.load(open(sys.argv[1]))
engines = list(next(iter(table.values())).keys())
def g(v): return math.exp(sum(map(math.log, v)) / len(v))
print("%-11s %8s %8s %8s" % ("engine", "best", "median", "worst"))
for e in engines:
    cols = [sorted(row[e]) for row in table.values() if row.get(e)]
    print("%-11s %8.0f %8.0f %8.0f" % (e, g([c[-1] for c in cols]), g([c[len(c)//2] for c in cols]), g([c[0] for c in cols])))
# per-benchmark ratio of medians to silkjs for each JIT column
for column in [e for e in engines if e.startswith("silkjs-jit")]:
    r = []
    print(column)
    for name, row in table.items():
        a, b = sorted(row["silkjs"]), sorted(row[column])
        r.append(b[len(b)//2] / a[len(a)//2])
        print("  %-16s %s/plain median %.3f  plain [%g..%g] %s [%g..%g]" % (name, column, r[-1], a[0], a[-1], column, b[0], b[-1]))
    print("geomean %s/plain of medians %.3f" % (column, g(r)))
