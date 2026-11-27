#!/usr/bin/env python3
"""CPU per verified order of the HTTP order service for two tiers of one embedding host.

Starts one server per mode on the same core, warms both, then interleaves equal blocks of
checked orders and reads each server's CPU clock around its block. The protocol is the one of
../2026-11-19-http-calls/paired.py, with the two sides being two modes of one binary instead of
two binaries in one mode.

    python3 paired_modes.py --host build/.../silkjs-jit-embed-smoke --out result.json
        [--modes interpret,baseline] [--orders 1000] [--blocks 8] [--rounds 3]
        [--server-cpu 0] [--client-cpu 3]
"""
import argparse
from contextlib import contextmanager, ExitStack
import http.client
import json
import os
from pathlib import Path
import re
import select
import signal
import statistics
import subprocess
import sys
import tempfile
import time

DIR = Path(__file__).resolve().parent
REPO = DIR.parents[3]
sys.path.insert(0, str(REPO / "modules/runtime/bench"))
import jit_http as bench  # noqa: E402

FLAGS = {"default": [], "calls": ["--jit-calls"], "baseline": ["--jit-baseline"], "interpret": ["--no-jit"]}


@contextmanager
def server(host, mode, cpu):
    env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "BUN_OPTIONS")}
    env["SILKJS_PREPARSE_THREADS"] = "0"
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(["taskset", "-c", str(cpu), str(host), *FLAGS[mode], str(bench.FIXTURE)],
                                   stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True)
        connection = None
        try:
            if not select.select([process.stdout], [], [], 30)[0]:
                raise TimeoutError("server startup")
            ready = re.fullmatch(rb"ready (\d+)\n", process.stdout.readline())
            if not ready or os.sched_getaffinity(process.pid) != {cpu}:
                raise RuntimeError("server port or affinity")
            connection = http.client.HTTPConnection("127.0.0.1", int(ready[1]), timeout=15)
            connection.connect()
            cases = bench.cases()

            def orders(count):
                for i in range(count):
                    bench.post(connection, "/order", *cases[i % len(cases)])

            def stop():
                bench.post(connection, "/stop", b"", b"stopped")
                connection.close()
                process.communicate(timeout=15)
                if process.returncode:
                    raise RuntimeError(f"unexpected shutdown {process.returncode}")

            # The CPU clock of the server process.
            yield orders, ((~process.pid) << 3) | 2, stop
        finally:
            if connection:
                connection.close()
            if process.poll() is None:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--modes", default="interpret,baseline")
    parser.add_argument("--orders", type=int, default=1000)
    parser.add_argument("--blocks", type=int, default=8)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--server-cpu", type=int, default=0)
    parser.add_argument("--client-cpu", type=int, default=3)
    args = parser.parse_args()
    modes = args.modes.split(",")
    if len(modes) != 2 or any(mode not in FLAGS for mode in modes) or args.blocks % 2 or args.client_cpu == args.server_cpu:
        parser.error("two modes, an even number of blocks and distinct CPUs required")
    busy = bench.compiler_running()
    if busy:
        parser.error(f"compiler running: {busy[0]}")
    os.sched_setaffinity(0, {args.client_cpu})
    host = args.host.resolve(strict=True)
    result = {"host_sha256": bench.sha256(host), "fixture_sha256": bench.sha256(bench.FIXTURE), "modes": modes,
              "warm_orders_per_server": 4800, "orders_per_block": args.orders, "blocks": args.blocks, "rounds": []}
    cpu = {mode: [] for mode in modes}
    ratios = []
    for rnd in range(args.rounds):
        first = rnd % 2
        with ExitStack() as stack:
            handles = {}
            for side in (first, 1 - first):
                handles[side] = stack.enter_context(server(host, modes[side], args.server_cpu))
            for warm in range(4):
                start = (first + warm) % 2
                for side in (start, 1 - start):
                    handles[side][0](1200)
            blocks = []
            for block in range(args.blocks):
                start = (first + block) % 2
                measured = {}
                for side in (start, 1 - start):
                    orders, clock, _ = handles[side]
                    before = time.clock_gettime_ns(clock)
                    wall = time.perf_counter_ns()
                    orders(args.orders)
                    elapsed = time.perf_counter_ns() - wall
                    spent = time.clock_gettime_ns(clock) - before
                    measured[side] = {"cpu_us_per_order": spent / (1000 * args.orders), "orders_per_s": args.orders * 1e9 / elapsed}
                blocks.append({"first": modes[start], "sides": [measured[0], measured[1]]})
                for side in (0, 1):
                    cpu[modes[side]].append(measured[side]["cpu_us_per_order"])
                ratios.append(measured[1]["cpu_us_per_order"] / measured[0]["cpu_us_per_order"])
            for side in (first, 1 - first):
                handles[side][2]()
        result["rounds"].append({"round": rnd, "blocks": blocks})
        print(f"round {rnd + 1}: " + ", ".join(f"{mode} {statistics.median(cpu[mode][-args.blocks:]):.1f} us" for mode in modes), flush=True)
    result["median_cpu_us_per_order"] = {mode: statistics.median(cpu[mode]) for mode in modes}
    result["median_paired_ratio"] = statistics.median(ratios)
    args.out.write_text(json.dumps(result, indent=1) + "\n")
    print(", ".join(f"{mode} {result['median_cpu_us_per_order'][mode]:.1f} us per order" for mode in modes)
          + f"; {modes[1]}/{modes[0]} paired median {result['median_paired_ratio']:.3f}x")


if __name__ == "__main__":
    main()
