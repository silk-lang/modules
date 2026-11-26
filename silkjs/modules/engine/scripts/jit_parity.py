#!/usr/bin/env python3
"""Compare SilkJS JIT and Node/V8 on the checked-in command-line macro workloads."""
import argparse
import hashlib
import json
import math
import os
import platform
import shutil
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from jit_kernels import compiler_running, release_engine

ROOT = Path(__file__).resolve().parents[1]
MACRO = ROOT / "bench" / "macro"
DEFAULT_WORKLOADS = "json,parse,maps,regexp"
TIMING_MARKER = "__parity_total_ms__ "


def environment():
    env = os.environ.copy()
    env.pop("NODE_OPTIONS", None)
    env.pop("BUN_OPTIONS", None)
    env["SILKJS_PREPARSE_THREADS"] = "0"
    return env


def repeat_script(source, warmup, iterations):
    # Each invocation gets fresh workload-local state. Both engines keep their compiled code.
    return f"""function workload() {{
{source}
}}
for (let i = 0; i < {warmup}; ++i) workload();
const started = performance.now();
for (let i = 0; i < {iterations}; ++i) workload();
const elapsed = performance.now() - started;
console.log('{TIMING_MARKER}' + elapsed);
"""


def measure(command, path, expected, repetitions, env, timeout):
    start = time.perf_counter_ns()
    run = subprocess.run([*command, str(path)], capture_output=True, text=True,
                         env=env, timeout=timeout)
    wall_ms = (time.perf_counter_ns() - start) / 1e6
    if run.returncode:
        raise ValueError(f"exit {run.returncode}: {run.stderr[-1000:]}")
    if repetitions is None:
        if run.stdout != expected:
            raise ValueError("cold stdout differs from macro/expected.json")
        return wall_ms

    warmup, iterations = repetitions
    records, separator, timing = run.stdout.rpartition(TIMING_MARKER)
    if not separator or records != expected * (warmup + iterations):
        raise ValueError("repeated stdout differs from macro/expected.json or lacks timing")
    per_call = float(timing) / iterations
    if not math.isfinite(per_call) or per_call <= 0:
        raise ValueError("invalid in-process time, increase --iterations")
    return per_call


def compare(commands, workloads, rounds, warmup, iterations, scratch, env, timeout):
    results = {}
    for name, expected in workloads.items():
        original = MACRO / f"{name}.js"
        repeated = scratch / f"{name}.js"
        repeated.write_text(repeat_script(original.read_text(), warmup, iterations))
        results[name] = {}
        for metric, path, repetitions in (("cold_ms", original, None),
                                         ("repeated_ms_per_call", repeated, (warmup, iterations))):
            samples = {label: [] for label in commands}
            for index in range(rounds):
                order = list(commands) if index % 2 == 0 else list(reversed(commands))
                for label in order:
                    try:
                        ms = measure(commands[label], path, expected, repetitions, env, timeout)
                    except (OSError, ValueError, subprocess.TimeoutExpired) as error:
                        raise ValueError(f"{name} {metric} round {index + 1} {label}: {error}") from error
                    samples[label].append(ms)
            ratio = statistics.median(silk / v8 for silk, v8 in zip(samples["silkjs"], samples["v8"]))
            results[name][metric] = {"samples": samples, "median_paired_ratio": ratio}
            print(f"{name:10} {metric:22} silkjs {statistics.median(samples['silkjs']):9.3f} ms"
                  f"  node {statistics.median(samples['v8']):9.3f} ms   paired {ratio:.3f}x", flush=True)
    return results


def sha256(path):
    with open(path, "rb") as source:
        digest = hashlib.sha256()
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", default=DEFAULT_WORKLOADS, help="comma-separated macro names")
    parser.add_argument("--rounds", type=int, default=5, help="fresh process pairs per metric")
    parser.add_argument("--warmup", type=int, default=2, help="untimed in-process calls")
    parser.add_argument("--iterations", type=int, default=5, help="timed in-process calls")
    parser.add_argument("--timeout", type=int, default=300, help="seconds per process")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--calls", action="store_true", help="also pass --jit-calls to SilkJS")
    mode.add_argument("--interpreter", action="store_true", help="measure the interpreter-only engine")
    parser.add_argument("--json", type=Path, help="write raw times, ratios and provenance")
    args = parser.parse_args()
    if min(args.rounds, args.iterations, args.timeout) < 1 or args.warmup < 0:
        parser.error("rounds, iterations and timeout must be positive and warmup nonnegative")

    expected = json.loads((MACRO / "expected.json").read_text())
    workloads = {}
    for name in args.only.split(","):
        if name not in expected or name == "startup" or name in workloads:
            parser.error(f"choose distinct nonempty workloads from macro/expected.json (got {name!r})")
        workloads[name] = expected[name]

    engine = Path(os.environ.get("SILKJS_ENGINE") or release_engine())
    binary = str(engine) if args.interpreter else (os.environ.get("SILKJS_JIT") or str(engine.with_name("silkjs-jit-shell")))
    silkjs = shutil.which(binary)
    node = shutil.which(os.environ.get("NODE_REFERENCE") or "node")
    if not silkjs or not node:
        variable = "SILKJS_ENGINE" if args.interpreter else "SILKJS_JIT"
        parser.error(f"set {variable} and NODE_REFERENCE to the SilkJS and Node executables")
    busy = compiler_running()
    if busy:
        parser.error(f"compiler running: {busy[0]}")
    commands = {"silkjs": [str(Path(silkjs).resolve())], "v8": [str(Path(node).resolve())]}
    if not args.interpreter:
        commands["silkjs"].append("--jit")
    if args.calls:
        commands["silkjs"].append("--jit-calls")
    env = environment()
    with tempfile.TemporaryDirectory(prefix="jit-parity-") as scratch:
        results = compare(commands, workloads, args.rounds, args.warmup, args.iterations,
                          Path(scratch), env, args.timeout)
    if args.json:
        versions = subprocess.check_output([node, "-p", "JSON.stringify(process.versions)"],
                                           text=True, env=env, timeout=args.timeout)
        revision = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
        report = {"host": platform.uname()._asdict(), "workload_revision": revision,
                  "workload_sha256": {name: sha256(MACRO / f"{name}.js") for name in workloads},
                  "commands": commands, "binary_sha256": {k: sha256(v[0]) for k, v in commands.items()},
                  "node_versions": json.loads(versions), "rounds": args.rounds, "warmup": args.warmup,
                  "iterations": args.iterations, "results": results}
        args.json.write_text(json.dumps(report, indent=2) + "\n")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
