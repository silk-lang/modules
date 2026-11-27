#!/usr/bin/env python3
"""Markdown coverage and compile-cost tables for docs/jit/jit-scorecard.md, from the --json output
of scripts/jit_coverage.py (default run, and optionally the --calls run)."""
import json, sys


def pct(entry, key="fraction"):
    c = entry.get("callgrind", {})
    if c.get("exit") != 0 or c.get(key) is None:
        return "-"
    percent = "%.3f%%" % (100 * c[key])
    if key == "compiler_fraction" and "helper_fraction" not in c:
        return percent + " (legacy)"
    return percent


def top(counter, n=3):
    items = sorted(counter.items(), key=lambda kv: -kv[1])[:n]
    return "; ".join("%s %d" % (("`%s`" % r.split(": ", 1)[1]) if r.startswith("opcode") else r, c) for r, c in items) or "-"


def main():
    plain = json.load(open(sys.argv[1]))["results"]
    calls = json.load(open(sys.argv[2]))["results"] if len(sys.argv) > 2 else {}
    rows = [k for k in plain if not k.startswith("v8/")]
    print("| Benchmark | hot / compiled / refused | deopts / unlinked | OSR compiled / runs / deopts | compile ms | code MB | compiled instr | compiler instr | helper instr | top refusals |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---|")
    for k in rows:
        e = plain[k]; s = e["counters"]["stats"]
        print("| %s | %d / %d / %d | %d / %d | %d / %d / %d | %.1f | %.2f | %s | %s | %s | %s |" % (
            k, s.get("reported", 0), s.get("compiled", 0), s.get("refused", 0), s.get("deopts", 0), s.get("unlinked", 0),
            s.get("osr-compiled", 0), s.get("osr-runs", 0), s.get("osr-deopts", 0), s.get("compile-ns", 0) / 1e6,
            s.get("code-bytes", 0) / 1048576, pct(e), pct(e, "compiler_fraction"), pct(e, "helper_fraction"), top(e["counters"]["refused"])))
    if calls:
        print()
        print("With `--jit-calls`:")
        print()
        print("| Benchmark | hot / compiled / refused | deopts / unlinked | compile ms | code MB | compiled instr | compiler instr | helper instr | top refusals |")
        print("|---|---:|---:|---:|---:|---:|---:|---:|---|")
        for k in rows:
            e = calls[k]; s = e["counters"]["stats"]
            print("| %s | %d / %d / %d | %d / %d | %.1f | %.2f | %s | %s | %s | %s |" % (
                k, s.get("reported", 0), s.get("compiled", 0), s.get("refused", 0), s.get("deopts", 0), s.get("unlinked", 0),
                s.get("compile-ns", 0) / 1e6, s.get("code-bytes", 0) / 1048576, pct(e), pct(e, "compiler_fraction"), pct(e, "helper_fraction"), top(e["counters"]["refused"])))


if __name__ == "__main__":
    main()
