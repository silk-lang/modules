#!/usr/bin/env python3
"""CPU per verified order of the HTTP order service for several engines at once.

One server per mode on the same core, all warmed, then equal blocks of checked orders
interleaved with the order rotated; each server's CPU clock is read around its block. The
protocol of ../2026-11-20-http-baseline/paired_modes.py with any number of sides, and Node.

    python3 http_modes.py --host build/.../silkjs-jit-embed-smoke --node /opt/node22/bin/node
        --out result.json [--modes interpreter,baseline,optimizer,v8,v8_interpreter]
        [--orders 1000] [--blocks 6] [--rounds 3] [--server-cpu 0] [--client-cpu 3]
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

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / "modules/runtime/bench"))
import jit_http as bench  # noqa: E402


def commands(host, node):
    return {
        "interpreter": [host, "--no-jit"],
        "baseline": [host, "--jit-baseline"],
        "optimizer": [host, "--jit-opt"],
        "optimizer_eager": [host, "--jit-opt=20", "--jit-threshold=20"],
        "v8": [node],
        # node --jitless cannot run undici's wasm; these flags keep V8 in its interpreter.
        "v8_interpreter": [node, "--no-opt", "--no-maglev", "--no-sparkplug"],
    }


@contextmanager
def server(command, cpu):
    env = {k: v for k, v in os.environ.items() if k not in ("NODE_OPTIONS", "BUN_OPTIONS")}
    env["SILKJS_PREPARSE_THREADS"] = "0"
    with tempfile.TemporaryFile() as log:
        process = subprocess.Popen(["taskset", "-c", str(cpu), *command, str(bench.FIXTURE)],
                                   stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True)
        connection = None
        try:
            if not select.select([process.stdout], [], [], 30)[0]:
                raise TimeoutError("server startup")
            ready = re.fullmatch(rb"ready (\d+)\n", process.stdout.readline())
            if not ready:
                raise RuntimeError("server port")
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
                    log.seek(0)
                    raise RuntimeError(f"unexpected shutdown {process.returncode}: {log.read()[-400:]!r}")

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
    parser.add_argument("--node", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--modes", default="interpreter,baseline,optimizer,v8,v8_interpreter")
    parser.add_argument("--orders", type=int, default=1000)
    parser.add_argument("--blocks", type=int, default=6)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--warm", type=int, default=4800)
    parser.add_argument("--server-cpu", type=int, default=0)
    parser.add_argument("--client-cpu", type=int, default=3)
    args = parser.parse_args()
    table = commands(str(args.host.resolve(strict=True)), str(args.node.resolve(strict=True)))
    modes = args.modes.split(",")
    os.sched_setaffinity(0, {args.client_cpu})
    cpu = {mode: [] for mode in modes}
    result = {"modes": modes, "warm_orders_per_server": args.warm, "orders_per_block": args.orders, "blocks": args.blocks, "rounds": args.rounds}
    for rnd in range(args.rounds):
        with ExitStack() as stack:
            handles = [stack.enter_context(server(table[mode], args.server_cpu)) for mode in modes]
            for warm in range(4):
                for side in range(len(modes)):
                    handles[(side + warm + rnd) % len(modes)][0](args.warm // 4)
            for block in range(args.blocks):
                for step in range(len(modes)):
                    side = (step + block + rnd) % len(modes)
                    orders, clock, _ = handles[side]
                    before = time.clock_gettime_ns(clock)
                    orders(args.orders)
                    cpu[modes[side]].append((time.clock_gettime_ns(clock) - before) / (1000 * args.orders))
            for handle in handles:
                handle[2]()
        print(f"round {rnd + 1}: " + ", ".join(f"{mode} {statistics.median(cpu[mode][-args.blocks:]):.1f} us" for mode in modes), flush=True)
    result["median_cpu_us_per_order"] = {mode: round(statistics.median(cpu[mode]), 1) for mode in modes}
    args.out.write_text(json.dumps(result, indent=1) + "\n")
    print(", ".join(f"{mode} {result['median_cpu_us_per_order'][mode]:.1f} us per order" for mode in modes))


if __name__ == "__main__":
    main()
