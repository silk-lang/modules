#!/usr/bin/env python3
"""CPU time of the eight V8 benchmarks on five engines: the interpreter, the baseline tier,
the optimizer, V8 and V8 without its JIT.

Each benchmark runs a fixed amount of work (the fixed-count runner of
modules/engine/scripts/v8bench.py, scaled) once per engine per round, the four engines
interleaved and the order rotated each round, all on one core. The figure is the median of
user plus system CPU time of the whole process, start-up and compilation included.

    python3 four_engines.py --shell build/.../silkjs-jit-shell --node /opt/node22/bin/node
        --out result.json [--rounds 5] [--scale 20] [--cpu 0] [--only richards,splay]

Run it on a quiet machine: a build or a valgrind job on another core moves single runs by 20%.
"""
import argparse
import json
import os
from pathlib import Path
import resource
import statistics
import subprocess
import sys
import tempfile

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "modules/engine/scripts"))
import v8bench  # noqa: E402


def cpu_seconds(command, cpu, env):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    subprocess.run(["taskset", "-c", str(cpu), *command], capture_output=True, env=env, check=True)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    return (after.ru_utime - before.ru_utime) + (after.ru_stime - before.ru_stime)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--shell", type=Path, required=True)
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--rounds", type=int, default=5)
    parser.add_argument("--scale", type=int, default=20)
    parser.add_argument("--cpu", type=int, default=0)
    parser.add_argument("--only", default=",".join(v8bench.BENCHMARKS))
    args = parser.parse_args()
    shell = str(args.shell.resolve(strict=True))
    node = str(args.node.resolve(strict=True))
    engines = [("interpreter", [shell]), ("baseline", [shell, "--jit-baseline"]), ("optimizer", [shell, "--jit-opt=20", "--jit-threshold=20"]), ("v8", [node]), ("v8_jitless", [node, "--jitless"])]
    # The container's NODE_OPTIONS and BUN_OPTIONS change what the engines do.
    env = {key: value for key, value in os.environ.items() if key not in ("NODE_OPTIONS", "BUN_OPTIONS")}
    env["SILKJS_PREPARSE_THREADS"] = "0"
    version = subprocess.run([node, "--version"], capture_output=True, text=True, env=env, check=True).stdout.strip()
    result = {"node": version, "rounds": args.rounds, "scale": args.scale, "cpu_ms": {}}
    with tempfile.TemporaryDirectory() as directory:
        for name in args.only.split(","):
            path = v8bench.script(directory, [name], v8bench.FIXED_RUNNER % (v8bench.FIXED[name] * args.scale), "timed-" + name)
            times = {engine: [] for engine, _ in engines}
            for rnd in range(args.rounds):
                first = rnd % len(engines)
                for engine, command in engines[first:] + engines[:first]:
                    times[engine].append(cpu_seconds([*command, path], args.cpu, env))
            result["cpu_ms"][name] = {engine: round(statistics.median(values) * 1000, 1) for engine, values in times.items()}
            print(f"{name:14s} " + "  ".join(f"{engine} {result['cpu_ms'][name][engine]:7.0f} ms" for engine, _ in engines), flush=True)
    args.out.write_text(json.dumps(result, indent=1) + "\n")


if __name__ == "__main__":
    main()
