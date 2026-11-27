#!/usr/bin/env python3
"""Run the JIT kernels (bench/kernels) under silkjs, silkjs-jit, V8, JSC and QuickJS.

Each kernel is fixed work with one feature (integer loop, calls, method calls, doubles, arrays,
typed arrays). One `kernel()` call is timed inside the process, so startup is excluded and
compilation and warmup are included. Rounds are processes, interleaved across engines. Every
engine must return the same checksum. silkjs-jit (and silkjs-jit-calls, with --jit-calls) also runs with --jit-stats, whose counters are
printed beside its time so a non-result can be explained.

    python3 scripts/jit_kernels.py                       # every installed engine, 5 rounds
    python3 scripts/jit_kernels.py --rounds 3 --only sum-calls,calls --engines silkjs,silkjs-jit,v8-jit
    python3 scripts/jit_kernels.py --json out.json

Engines are found as the benchmark harness finds them: $SILKJS_ENGINE or this host's release
build, $SILKJS_JIT or silkjs-jit-shell beside it, $NODE_REFERENCE or node, $JSC or jsc, and
build/bench/quickjs/qjs from `silk task bench-setup quickjs`.
"""
import argparse
import json
import os
import shutil
import statistics
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toolchain  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
KERNELS = os.path.join(ROOT, "bench", "kernels")
ORDER = ["sum-calls", "sum-long", "nested", "calls", "method", "doubles", "array-sum", "typed-array"]
ENGINES = ["silkjs", "silkjs-jit", "silkjs-jit-calls", "v8-jitless", "v8-jit", "jsc-nojit", "jsc-jit", "qjs"]

PRELUDE = """var __now = (typeof preciseTime === 'function') ? function () { return preciseTime() * 1000; }
  : (typeof performance !== 'undefined' && typeof performance.now === 'function') ? function () { return performance.now(); }
  : function () { return Date.now(); };
var __say = (typeof print === 'function') ? print : console.log.bind(console);
"""
EPILOGUE = """var __t0 = __now(); var __r = kernel(); var __t1 = __now();
__say('kernel ' + __r + ' ' + (__t1 - __t0));
"""


def release_engine():
    return str(toolchain.release_binary())


def commands(work):
    engine = os.environ.get("SILKJS_ENGINE") or release_engine()
    shell = os.environ.get("SILKJS_JIT") or os.path.join(os.path.dirname(engine), "silkjs-jit-shell")
    node = shutil.which(os.environ.get("NODE_REFERENCE") or "node")
    jsc = shutil.which(os.environ.get("JSC") or "jsc")
    qjs = os.path.join(work, "quickjs", "qjs")
    found, missing = {}, {}

    def put(name, path, words, hint):
        if path and os.path.exists(path):
            found[name] = [path] + words
        else:
            missing[name] = (path or "(not on PATH)") + " is missing; " + hint
    put("silkjs", engine, [], "build it with `silk build --release` or set SILKJS_ENGINE")
    put("silkjs-jit", shell, ["--jit", "--jit-stats"], "build modules/jit/shell with `silk build --release` or set SILKJS_JIT")
    put("silkjs-jit-calls", shell, ["--jit", "--jit-calls", "--jit-stats"], "build modules/jit/shell with `silk build --release` or set SILKJS_JIT")
    put("v8-jitless", node, ["--jitless"], "install Node 24 or set NODE_REFERENCE")
    put("v8-jit", node, [], "install Node 24 or set NODE_REFERENCE")
    put("jsc-nojit", jsc, ["--useJIT=false"], "run `silk task bench-setup jsc` or set JSC")
    put("jsc-jit", jsc, [], "run `silk task bench-setup jsc` or set JSC")
    put("qjs", qjs, [], "run `silk task bench-setup quickjs`")
    return found, missing


def compiler_running():
    out = subprocess.run(["ps", "-eo", "args"], capture_output=True, text=True).stdout
    return [line for line in out.splitlines() if line.split(" ")[0].endswith(("silkc", "clang", "ld.lld", "cc1"))]


def run_once(words, script, timeout):
    env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "BUN_OPTIONS")}
    env["SILKJS_PREPARSE_THREADS"] = "0"
    done = subprocess.run(words + [script], capture_output=True, text=True, timeout=timeout, env=env)
    result, ms, stats = None, None, ""
    for line in done.stdout.splitlines():
        if line.startswith("kernel "):
            _, result, ms = line.split(" ")
            ms = float(ms)
    for line in done.stderr.splitlines():
        if line.startswith("jit: "):
            stats = line[5:]
    if done.returncode != 0 or ms is None:
        raise RuntimeError("exit %d: %s %s" % (done.returncode, done.stdout[-400:], done.stderr[-400:]))
    return result, ms, stats


def spread(values):
    return min(values), statistics.median(values), max(values)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--only", default="", help="kernels, comma-separated")
    parser.add_argument("--engines", default="", help="columns, comma-separated (default: every installed one)")
    parser.add_argument("--work", default=os.environ.get("SILKJS_BENCH_WORK") or os.path.join(ROOT, "build", "bench"))
    parser.add_argument("--json", default="", help="write every measurement here")
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument("--force", action="store_true", help="measure while a compiler runs")
    args = parser.parse_args()

    busy = compiler_running()
    if busy and not args.force:
        sys.exit("a compiler is running, not measuring (--force overrides):\n  " + "\n  ".join(busy))
    found, missing = commands(args.work)
    chosen = args.engines.split(",") if args.engines else ENGINES
    for name in chosen:
        if name not in found and name not in missing:
            sys.exit("unknown engine " + name + "; the engines are " + " ".join(ENGINES))
        if name in missing:
            if args.engines:
                sys.exit(name + ": " + missing[name])
            print("%-11s OMITTED, %s" % (name, missing[name]))
        else:
            print("%-11s %s" % (name, " ".join(found[name])))
    columns = [name for name in chosen if name in found]
    kernels = args.only.split(",") if args.only else ORDER

    scripts = tempfile.mkdtemp(prefix="jit-kernels-")
    paths = {}
    for kernel in kernels:
        with open(os.path.join(KERNELS, kernel + ".js"), encoding="utf-8") as f:
            source = f.read()
        paths[kernel] = os.path.join(scripts, kernel + ".js")
        with open(paths[kernel], "w", encoding="utf-8") as f:
            f.write(PRELUDE + source + EPILOGUE)
        units = None
        for line in source.splitlines():
            if line.startswith("var UNITS = "):
                units = eval(line[len("var UNITS = "):].rstrip(";"))
        paths[kernel + "/units"] = units

    times = {k: {c: [] for c in columns} for k in kernels}
    stats = {k: {} for k in kernels}
    results = {k: {} for k in kernels}
    expected = {}
    failures = []
    for round_index in range(args.rounds):
        for kernel in kernels:
            for column in columns:
                try:
                    result, ms, line = run_once(found[column], paths[kernel], args.timeout)
                except (RuntimeError, subprocess.TimeoutExpired) as error:
                    failures.append("%s %s: %s" % (kernel, column, error))
                    continue
                checksum = expected.setdefault(kernel, result)
                if result != checksum:
                    failures.append(f"{kernel} {column} round {round_index + 1}: expected {checksum}, got {result}")
                    continue
                times[kernel][column].append(ms)
                results[kernel][column] = result
                if line:
                    stats[kernel][column] = line
        print("round %d of %d done" % (round_index + 1, args.rounds), file=sys.stderr)

    print()
    print("ms per kernel() call: median [min, max] of %d processes; ns/unit from the median" % args.rounds)
    head = "%-12s" % "kernel" + "".join("%22s" % c for c in columns)
    print(head)
    for kernel in kernels:
        line = "%-12s" % kernel
        for column in columns:
            values = times[kernel][column]
            if values:
                low, mid, high = spread(values)
                line += "%22s" % ("%.1f [%.1f, %.1f]" % (mid, low, high))
            else:
                line += "%22s" % "FAILED"
        print(line)
    print()
    print("ns per unit (median) and ratio to v8-jit / jsc-jit (above 1 means slower than that engine)")
    print("%-12s" % "kernel" + "".join("%22s" % c for c in columns))
    for kernel in kernels:
        units = paths[kernel + "/units"]
        line = "%-12s" % kernel
        v8 = statistics.median(times[kernel]["v8-jit"]) if times[kernel].get("v8-jit") else None
        jsc = statistics.median(times[kernel]["jsc-jit"]) if times[kernel].get("jsc-jit") else None
        for column in columns:
            values = times[kernel][column]
            if not values:
                line += "%22s" % "-"
                continue
            mid = statistics.median(values)
            cell = "%.2f" % (mid * 1e6 / units)
            cell += " %s/%s" % ("%.1f" % (mid / v8) if v8 else "-", "%.1f" % (mid / jsc) if jsc else "-")
            line += "%22s" % cell
        print(line)
    print()
    for kernel in kernels:
        for column, line in sorted(stats[kernel].items()):
            print("%s %-12s %s" % (column, kernel, line))
    if args.json:
        with open(args.json, "w", encoding="utf-8") as f:
            json.dump({"rounds": args.rounds, "commands": {c: found[c] for c in columns}, "omitted": {c: missing[c] for c in chosen if c in missing},
                       "units": {k: paths[k + "/units"] for k in kernels}, "ms": times, "checksums": results, "jit_stats": stats,
                       "failures": failures}, f, indent=1)
    shutil.rmtree(scripts)
    if failures:
        print("\n".join(failures))
        sys.exit(1)


if __name__ == "__main__":
    main()
