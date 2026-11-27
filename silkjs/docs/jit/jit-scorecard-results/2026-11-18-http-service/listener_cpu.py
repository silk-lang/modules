"""Measure marginal CPU per forwarding call inside a verified HTTP order on Linux."""
import argparse
import http.client
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import tempfile
import time

SCRIPT = Path(__file__).with_name("listener-forwarding.mjs")
DEPTHS = ((0, 4, 8), (8, 4, 0), (4, 8, 0), (0, 8, 4), (8, 0, 4), (4, 0, 8))


def run_process(bench, args, policy, index):
    env = {k: v for k, v in os.environ.items() if k not in {"NODE_OPTIONS", "BUN_OPTIONS"}}
    env["SILKJS_PREPARSE_THREADS"] = "0"
    command = ["taskset", "-c", str(args.server_cpu), str(args.host)]
    if policy == "calls":
        command.append("--jit-calls")
    command.append(str(SCRIPT))
    cases = bench.cases()
    with tempfile.TemporaryFile() as log:
        server = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True)
        connection = None
        try:
            if not select.select([server.stdout], [], [], 30)[0]:
                raise TimeoutError("server did not start")
            ready = re.fullmatch(rb"ready (\d+)\n", server.stdout.readline())
            if not ready or os.sched_getaffinity(server.pid) != {args.server_cpu}:
                raise RuntimeError("expected listening port and server CPU affinity")
            connection = http.client.HTTPConnection("127.0.0.1", int(ready[1]), timeout=15)
            connection.connect()
            sock = connection.sock

            def orders(count):
                for i in range(count):
                    bench.post(connection, "/order", *cases[i % len(cases)])
                    if connection.sock is not sock:
                        raise RuntimeError("server closed keep-alive connection")

            def set_depth(depth):
                bench.post(connection, f"/probe-depth/{depth}", b"", b"ok")
                if connection.sock is not sock:
                    raise RuntimeError("depth change closed connection")

            for depth in (0, 4, 8):
                set_depth(depth)
                orders(args.warm)
            # CPUCLOCK_SCHED for the whole external server process on Linux.
            clock = ((~server.pid) << 3) | 2
            blocks = []
            for block in range(12):
                for depth in DEPTHS[(block + 2 * index) % len(DEPTHS)]:
                    set_depth(depth)
                    start = time.clock_gettime_ns(clock)
                    orders(args.orders)
                    elapsed_ns = time.clock_gettime_ns(clock) - start
                    blocks.append(dict(block=block + 1, depth=depth, cpu_us_per_order=elapsed_ns / (1000 * args.orders)))
            bench.post(connection, "/stop", b"", b"stopped")
            output = server.communicate(timeout=20)[0].split()
            measured = len(blocks) * args.orders
            expected = str(3 * args.warm + measured).encode()
            if server.returncode or output != [b"events", expected, expected]:
                raise RuntimeError(f"unexpected listener counts or exit status: {output!r}, {server.returncode}")
            log.seek(0)
            jit = bench.jit_counters(log.read().decode(errors="replace"))
            return dict(round=index + 1, policy=policy, verified=measured, blocks=blocks, jit=jit)
        finally:
            if connection:
                connection.close()
            if server.poll() is None:
                os.killpg(server.pid, signal.SIGKILL)
                server.wait()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--host", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--server-cpu", type=int, default=0)
    parser.add_argument("--client-cpu", type=int, default=4)
    parser.add_argument("--warm", type=int, default=2000)
    parser.add_argument("--orders", type=int, default=1000)
    args = parser.parse_args()
    if args.warm < 1 or args.orders < 1 or args.server_cpu == args.client_cpu:
        parser.error("positive warmup and order count and distinct server and client CPUs required")
    args.host = args.host.resolve(strict=True)
    sys.path.insert(0, str(args.repo.resolve() / "modules/runtime/bench"))
    import jit_http as bench

    if bench.compiler_running():
        parser.error("compiler active")
    os.sched_setaffinity(0, {args.client_cpu})
    with args.out.open("x") as out:
        for index in range(3):
            policies = ("calls", "default") if index % 2 == 0 else ("default", "calls")
            for policy in policies:
                print(json.dumps(run_process(bench, args, policy, index)), file=out, flush=True)


if __name__ == "__main__":
    main()
