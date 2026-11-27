#!/usr/bin/env python3
"""Instructions per order of the HTTP order service, by function, for each tier (needs valgrind).

Runs the JIT embedding host on the order fixture under callgrind twice per mode, with two order
counts, and charges the difference to an order: start-up, warm-up and compilation cancel out, so
the figure is the steady state and does not depend on how busy the machine is.

    python3 http_instructions.py --host build/.../silkjs-jit-embed-smoke --out /tmp/instructions
        [--modes interpreter,baseline,optimizer] [--low 400] [--high 1400] [--top 40] [--stats]

--stats also runs each JIT mode once without valgrind with --jit-stats and prints its counters
per order (steps by opcode, services, departures).
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import re
import subprocess
import sys

DIR = Path(__file__).resolve().parent
REPO = DIR.parents[3]
sys.path.insert(0, str(REPO / "modules/runtime/bench"))
import jit_http  # noqa: E402

FLAGS = {"interpreter": ["--no-jit"], "baseline": ["--jit-baseline"], "optimizer": ["--jit-opt"]}
# Where an instruction is charged, by the name callgrind gives its function.
SERVICES = ("baselineHeavy|baselineLight|baselineCallNative|baselineNative|baselineStep|baselineService|baselineQuick|baselineConcat"
            "|baselineConstruct|baselineFinish|baselineLoop|baselineScopeEnd|silkjsEmbedBaselineService|enterBaseline|enterBaselineKnown")
GROUPS = [
    ("machine code", r"0x0000"),
    ("interpreter loop", r"executeLoop"),
    ("engine services", r"(%s)\b" % SERVICES),
    # Everything else named baseline* is a helper of baseline_env.silk.
    ("helpers", r"(?!(%s)\b)baseline[A-Z]\w*" % SERVICES),
]


def serve(command, orders, items, log):
    env = {k: v for k, v in os.environ.items() if k not in {"BUN_OPTIONS", "NODE_OPTIONS"}}
    env["SILKJS_PREPARSE_THREADS"] = "0"
    with open(log, "w") as err:
        process = subprocess.Popen([*command, str(jit_http.FIXTURE)], stdout=subprocess.PIPE, stderr=err, env=env)
        try:
            ready = re.search(rb"ready (\d+)", process.stdout.readline())
            if not ready:
                raise ValueError(f"no listening port; see {log}")
            connection = http.client.HTTPConnection("127.0.0.1", int(ready[1]), timeout=300)
            payloads = jit_http.cases(items)
            for i in range(orders):
                jit_http.post(connection, "/order", *payloads[i % len(payloads)])
            jit_http.post(connection, "/stop", b"", b"stopped")
            connection.close()
            process.wait(timeout=300)
        finally:
            if process.poll() is None:
                process.kill()


def functions(path):
    text = subprocess.run(["callgrind_annotate", "--threshold=100", str(path)], capture_output=True, text=True, check=True).stdout
    found, total = {}, 0
    for line in text.splitlines():
        row = re.match(r"\s*([\d,]+)\s+\([\s\d.]+%\)\s+(.*)$", line)
        if not row:
            continue
        count = int(row[1].replace(",", ""))
        name = row[2].strip()
        if name.startswith("PROGRAM TOTALS"):
            total = count
            continue
        name = re.sub(r" \[.*\]$", "", re.sub(r"^\S+:", "", name))
        found[name] = found.get(name, 0) + count
    return found, total


def counters(host, mode, orders, items, out):
    log = out / f"stats-{mode}.txt"
    serve([str(host), *FLAGS[mode], "--jit-stats"], orders, items, log)
    lines = [line for line in log.read_text().splitlines() if line.startswith("jit: reported")]
    if not lines:
        return {}
    return {key: int(value) / orders for key, value in re.findall(r"([a-z][a-z0-9_:-]*) ([0-9]+)", lines[-1])}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--modes", default="interpreter,baseline,optimizer")
    parser.add_argument("--low", type=int, default=400)
    parser.add_argument("--high", type=int, default=1400)
    parser.add_argument("--items", type=int, default=64)
    parser.add_argument("--top", type=int, default=40)
    parser.add_argument("--stats", action="store_true")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    modes = args.modes.split(",")
    span = args.high - args.low
    per_order, totals, result = {}, {}, {"low": args.low, "high": args.high, "items": args.items, "modes": {}}
    for mode in modes:
        measured = []
        for orders in (args.low, args.high):
            data = args.out / f"callgrind-{mode}-{orders}.out"
            serve(["valgrind", "--tool=callgrind", f"--callgrind-out-file={data}", str(args.host), *FLAGS[mode]], orders, args.items,
                  args.out / f"valgrind-{mode}-{orders}.txt")
            measured.append(functions(data))
        (low, low_total), (high, high_total) = measured
        per_order[mode] = {name: (high.get(name, 0) - low.get(name, 0)) / span for name in set(low) | set(high)}
        totals[mode] = (high_total - low_total) / span
        groups, rest = {}, totals[mode]
        for label, pattern in GROUPS:
            groups[label] = sum(count for name, count in per_order[mode].items() if re.match(pattern, name))
            rest -= groups[label]
        groups["everything else"] = rest
        result["modes"][mode] = {"instructions_per_order": totals[mode], "groups": groups,
                                 "functions": dict(sorted(per_order[mode].items(), key=lambda item: -item[1])[:200])}
        print(f"{mode}: {totals[mode]:,.0f} instructions per order: " + ", ".join(f"{label} {count:,.0f}" for label, count in groups.items()))
        if args.stats and mode != "interpreter":
            stats = counters(args.host, mode, args.high, args.items, args.out)
            result["modes"][mode]["counters_per_order"] = stats
            print("  per order: " + ", ".join(f"{key[9:]} {stats.get(key, 0):.1f}" for key in
                                               ("baseline-steps", "baseline-departures", "baseline-service-calls", "baseline-direct-calls", "baseline-resumes")))
            steps = sorted(((count, key[5:]) for key, count in stats.items() if key.startswith("step:")), reverse=True)
            print("  steps per order: " + ", ".join(f"{name} {count:.1f}" for count, name in steps[:30]))
    (args.out / "result.json").write_text(json.dumps(result, indent=1) + "\n")
    if len(modes) >= 2:
        first, second = modes[0], modes[1]
        names = sorted(set(per_order[first]) | set(per_order[second]), key=lambda name: -abs(per_order[first].get(name, 0) - per_order[second].get(name, 0)))
        print(f"\n{first:>12} {second:>12} {'difference':>12}  function")
        for name in names[:args.top]:
            a, b = per_order[first].get(name, 0), per_order[second].get(name, 0)
            print(f"{a:12,.0f} {b:12,.0f} {a - b:+12,.0f}  {name[:110]}")


if __name__ == "__main__":
    main()
