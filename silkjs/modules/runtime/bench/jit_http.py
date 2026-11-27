#!/usr/bin/env python3
"""Compare the JIT embedding host with Node on the same local HTTP/JSON service (Linux)."""
import argparse
from datetime import datetime, timezone
import hashlib
import http.client
import json
import math
import os
from pathlib import Path
import platform
import re
import select
import shutil
import signal
import statistics
import subprocess
import sys
import tempfile
import time

BENCH = Path(__file__).resolve().parent
FIXTURE = BENCH / "scripts/http-order-totals.mjs"
sys.path.insert(0, str(BENCH.parents[1] / "engine/scripts"))
from jit_kernels import compiler_running


def cases(items=64):
    result = []
    for order in range(4):
        lines = [{"units": i % 5 + 1, "price": (i + 3) * (order + 101)} for i in range(items)]
        body = json.dumps({"id": order, "lines": lines}, separators=(",", ":")).encode()
        cents = sum(line["units"] * line["price"] for line in lines)
        result.append((body, ('{"id":%d,"total":%d}' % (order, cents)).encode()))
    return result


def post(connection, path, body, expected):
    connection.request("POST", path, body, {"Content-Type": "application/json"})
    response = connection.getresponse()
    contents = response.read()
    if response.status != 200 or contents != expected:
        raise ValueError(f"{path} returned HTTP {response.status} with {contents[:120]!r}")


def cpu_ticks(pid):
    # comm can contain spaces. The remaining fields start at field 3, state.
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return int(fields[11]) + int(fields[12])


def jit_counters(log, *, interpret=False, baseline=False):
    line = next((s for s in log.splitlines() if s.startswith("jit: reported ")), "")
    counters = {k: int(v) for k, v in re.findall(r"([a-z][a-z0-9-]*) ([0-9]+)", line)}
    if interpret:
        if any(counters.get(k) != 0 for k in ("reported", "compiled", "runs", "osr-runs", "failed")):
            raise ValueError(f"expected inactive JIT counters: {line!r}")
        return counters
    if baseline:
        if counters.get("failed") != 0 or counters.get("baseline-compiled", 0) == 0:
            raise ValueError(f"expected baseline code; JIT counters: {line!r}")
        return counters
    if counters.get("failed") != 0 or counters.get("runs", 0) + counters.get("osr-runs", 0) == 0:
        raise ValueError(f"expected successful compiled execution; JIT counters: {line!r}")
    return counters


def run_sample(executable, check_jit, server_cpu, settings, *, jit_calls=False, interpret=False, baseline=False, items=64):
    payloads = cases(items)
    env = {k: v for k, v in os.environ.items() if k not in {"BUN_OPTIONS", "NODE_OPTIONS"}}
    env["SILKJS_PREPARSE_THREADS"] = "0"
    with tempfile.TemporaryFile() as log:
        launch = time.perf_counter()
        command = ["taskset", "-c", str(server_cpu), executable]
        if interpret:
            command.append("--no-jit")
        elif jit_calls:
            command.append("--jit-calls")
        elif baseline:
            command.append("--jit-baseline")
        process = subprocess.Popen([*command, FIXTURE],
                                   stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True)
        connection = None
        try:
            deadline = launch + 30
            marker = b""
            while b"\n" not in marker and len(marker) < 256:
                if not select.select([process.stdout], [], [], max(0, deadline - time.perf_counter()))[0]:
                    raise TimeoutError("server produced no listening port in 30 seconds")
                part = os.read(process.stdout.fileno(), 256)
                if not part:
                    break
                marker += part
            ready = re.fullmatch(rb"ready (\d+)\n", marker)
            if not ready:
                raise ValueError(f"expected a listening port, received {marker[:120]!r}")
            if os.sched_getaffinity(process.pid) != {server_cpu}:
                raise RuntimeError(f"server did not start on CPU {server_cpu}")
            connection = http.client.HTTPConnection("127.0.0.1", int(ready[1]), timeout=10)
            post(connection, "/order", *payloads[0])
            first_ms = (time.perf_counter() - launch) * 1000
            sock = connection.sock
            if sock is None:
                raise ValueError("server closed the first connection")

            def order(i):
                post(connection, "/order", *payloads[i % len(payloads)])
                if connection.sock is not sock:
                    raise ValueError("server did not keep the benchmark connection open")

            for i in range(settings.warmup):
                order(i)
            count = 0
            ticks = cpu_ticks(process.pid)
            start = time.perf_counter()
            while time.perf_counter() - start < settings.seconds:
                order(count)
                count += 1
            elapsed = time.perf_counter() - start
            cpu_us = (cpu_ticks(process.pid) - ticks) * 1e6 / os.sysconf("SC_CLK_TCK") / count
            throughput = count / elapsed
            if settings.rate * 2 > throughput:
                raise ValueError(f"use a common rate below half the measured {throughput:.0f} req/s")

            delays = []
            start = time.perf_counter()
            for i in range(settings.samples):
                scheduled = start + i / settings.rate
                remaining = scheduled - time.perf_counter()
                if remaining > 0:
                    time.sleep(remaining)
                order(i)
                delays.append((time.perf_counter() - scheduled) * 1000)
            status = Path(f"/proc/{process.pid}/status").read_text()
            rss_kib = int(re.search(r"^VmHWM:\s+(\d+) kB$", status, re.M)[1])
            post(connection, "/stop", b"", b"stopped")
            connection.close()
            process.communicate(timeout=15)
            if process.returncode:
                raise ValueError(f"server exited with {process.returncode}")
            log.seek(0)
            counters = jit_counters(log.read().decode(errors="replace"), interpret=interpret, baseline=baseline) if check_jit else {}
            return {"first_response_ms": first_ms, "requests": count, "elapsed_s": elapsed,
                    "sequential_requests_per_s": throughput, "server_cpu_us_per_request": cpu_us,
                    "peak_rss_kib": rss_kib, "scheduled_latency_ms": delays,
                    "p99_ms": sorted(delays)[math.ceil(len(delays) * .99) - 1], "jit": counters}
        except Exception as error:
            log.seek(0)
            details = log.read().decode(errors="replace")[-800:]
            raise RuntimeError(f"{executable}: {error} (server status {process.poll()})\n{details}") from error
        finally:
            if connection:
                connection.close()
            if process.poll() is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.communicate()


def sha256(path):
    with open(path, "rb") as file:
        return hashlib.file_digest(file, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runtime", required=True, type=Path, help="built JIT embed host")
    policy = parser.add_mutually_exclusive_group()
    policy.add_argument("--no-jit", action="store_true", help="run the SilkJS interpreter in the same embedding host")
    parser.add_argument("--items", type=int, default=64, help="line items per JSON order (default 64)")
    policy.add_argument("--jit-calls", action="store_true", help="enable compiled calls in the SilkJS host")
    policy.add_argument("--jit-baseline", action="store_true", help="baseline code for hot functions in the SilkJS host")
    parser.add_argument("--node", default=shutil.which("node"), type=Path)
    parser.add_argument("--rounds", type=int, default=3)
    parser.add_argument("--warmup", type=int, default=1200, help="untimed orders per process")
    parser.add_argument("--seconds", type=float, default=3, help="sequential throughput interval")
    parser.add_argument("--rate", type=int, default=100, help="orders/sec offered for latency")
    parser.add_argument("--samples", type=int, default=400, help="scheduled orders per process")
    parser.add_argument("--json", type=Path, required=True)
    args = parser.parse_args()
    cpus = sorted(os.sched_getaffinity(0))
    if (len(cpus) < 2 or not math.isfinite(args.seconds) or
            min(args.rounds, args.seconds, args.rate, args.samples) <= 0 or args.warmup < 0 or args.items < 0):
        parser.error("requires two CPUs, positive rounds, duration, rate and samples, and nonnegative warmup and item counts")
    if not args.node or not args.node.is_file() or not args.runtime.is_file():
        parser.error("both runtime executables must exist")
    busy = compiler_running()
    if busy:
        parser.error(f"compiler running: {busy[0]}")
    started = datetime.now(timezone.utc).isoformat()
    commands = {"silkjs": str(args.runtime.resolve()), "node": str(args.node.resolve())}
    node_version = subprocess.check_output([commands["node"], "-p", "JSON.stringify(process.versions)"],
                                           env={k: v for k, v in os.environ.items() if k != "NODE_OPTIONS"}, text=True)
    results = {name: [] for name in commands}
    os.sched_setaffinity(0, {cpus[-1]})
    for rnd in range(args.rounds):
        names = list(commands) if rnd % 2 == 0 else list(reversed(commands))
        for name in names:
            sample = run_sample(commands[name], name == "silkjs", cpus[0], args,
                                jit_calls=name == "silkjs" and args.jit_calls,
                                interpret=name == "silkjs" and args.no_jit,
                                baseline=name == "silkjs" and args.jit_baseline, items=args.items)
            results[name].append(sample)
            print(f"{rnd + 1} {name}: {sample['first_response_ms']:.2f} ms to first order,"
                  f" {sample['sequential_requests_per_s']:.0f} sequential req/s,"
                  f" p99 {sample['p99_ms']:.2f} ms", flush=True)
    report = {"started_at": started, "host": platform.uname()._asdict(), "server_cpu": cpus[0], "client_cpu": cpus[-1],
              "settings": vars(args) | {"runtime": commands["silkjs"], "node": commands["node"],
                                        "json": str(args.json)}, "node_versions": json.loads(node_version),
              "fixture_sha256": sha256(FIXTURE), "client_sha256": sha256(__file__),
              "binaries_sha256": {k: sha256(v) for k, v in commands.items()},
              "samples": results}
    args.json.write_text(json.dumps(report, indent=2) + "\n")
    for metric in ("first_response_ms", "sequential_requests_per_s", "p99_ms"):
        paired = [s[metric] / n[metric] for s, n in zip(results["silkjs"], results["node"])]
        print(f"{metric}: median paired Silk/Node {statistics.median(paired):.3f}x")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        sys.exit(str(error))
