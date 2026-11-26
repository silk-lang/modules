#!/usr/bin/env python3
"""Benchmarks two runtime executables against each other on one machine, for the CI runners
(macOS, Linux arm64) where `silk task bench` cannot run: no CPU pinning, no Postgres, no Bun.

Usage: python3 tools/ci_bench.py BASELINE CANDIDATE [--rounds N] [--only name,name]

Each round runs every benchmark once with each executable, the order of the two alternating from
round to round, so drift on the runner falls on both alike. Printed per benchmark: the median of
each, the candidate's change, the rounds in which the candidate did worse than the baseline
of that round, and both ranges. Benchmarks, from bench/scripts where one exists:

- node_http, serve: a server under `wrk -t1 -c8 -d5s`: requests per second, and the server's
  peak resident memory and CPU microseconds per request (from wait4's rusage).
- setImmediate: turns per second (bench/scripts/imm.js), and peak memory.
- spawnSync: microseconds per `spawnSync("echo")` (bench/scripts/spawn.mjs).
- cat: milliseconds to stream a 256 MiB file to /dev/null (bench/scripts/cat.cjs).
- sqlite_exec: milliseconds per `db.exec` of 2,000 statements on an in-memory database.
- cold_hello: milliseconds and peak memory of a start that prints one line (median of 10 per round).
"""
import os
import pathlib
import re
import signal
import socket
import statistics
import subprocess
import sys
import tempfile
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / 'bench' / 'scripts'
DARWIN = sys.platform == 'darwin'
ENV = {k: v for k, v in os.environ.items() if k not in ('NODE_OPTIONS', 'BUN_OPTIONS')}
ENV['SILKJS_PREPARSE_THREADS'] = '0'


def peak_mb(usage):
    # ru_maxrss is bytes on macOS, kilobytes on Linux.
    return usage.ru_maxrss / (1048576 if DARWIN else 1024)


def run(runtime, args, cwd=None, env=None):
    """Runs to completion: (stdout, wall seconds, rusage)."""
    start = time.perf_counter()
    child = subprocess.Popen([runtime, *args], cwd=cwd, env=env or ENV, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    out = child.stdout.read()
    _, status, usage = os.wait4(child.pid, 0)
    child.returncode = status
    return out.decode(errors='replace'), time.perf_counter() - start, usage


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def server(runtime, script):
    port = free_port()
    env = dict(ENV, PORT=str(port))
    child = subprocess.Popen([runtime, str(SCRIPTS / script)], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(200):
        try:
            socket.create_connection(('127.0.0.1', port), timeout=0.2).close()
            break
        except OSError:
            time.sleep(0.05)
    out = subprocess.run(['wrk', '-t1', '-c8', '-d5s', f'http://127.0.0.1:{port}/'], capture_output=True, text=True).stdout
    child.send_signal(signal.SIGTERM)
    _, status, usage = os.wait4(child.pid, 0)
    child.returncode = status
    match = re.search(r'Requests/sec:\s+([\d.]+)', out)
    total = re.search(r'(\d+) requests in', out)
    rps = float(match.group(1)) if match else 0.0
    requests = int(total.group(1)) if total else 0
    cpu = (usage.ru_utime + usage.ru_stime) * 1e6 / requests if requests else 0.0
    return {'req_s': rps, 'peak_mb': peak_mb(usage), 'cpu_us_per_req': cpu}


def bench_once(runtime, work, only):
    results = {}
    wanted = lambda name: not only or name in only
    if wanted('node_http'):
        results['node_http'] = server(runtime, 'node-http.cjs')
    if wanted('serve'):
        results['serve'] = server(runtime, 'silk-serve.js')
    if wanted('setImmediate'):
        results.update(immediate(runtime))
    if wanted('spawnSync'):
        out, _, _ = run(runtime, [str(SCRIPTS / 'spawn.mjs')], env=dict(ENV, N='200'))
        match = re.search(r'([\d.]+) us/iter', out)
        results['spawnSync'] = {'us': float(match.group(1)) if match else 0.0}
    if wanted('cat'):
        results.update(cat(runtime, work))
    if wanted('sqlite_exec'):
        results.update(sqlite(runtime, work))
    if wanted('cold_hello'):
        results.update(cold(runtime, work))
    return results


def immediate(runtime):
    out, _, usage = run(runtime, [str(SCRIPTS / 'imm.js')])
    match = re.search(r'setImmediate (\d+)', out)
    return {'setImmediate': {'turns_s': float(match.group(1)) if match else 0.0, 'peak_mb': peak_mb(usage)}}


def cat(runtime, work):
    start = time.perf_counter()
    with open(os.devnull, 'wb') as sink:
        child = subprocess.Popen([runtime, str(SCRIPTS / 'cat.cjs'), str(work / 'big.bin')], env=ENV, stdout=sink, stderr=subprocess.DEVNULL)
        _, _, usage = os.wait4(child.pid, 0)
        child.returncode = 0
    return {'cat': {'ms': (time.perf_counter() - start) * 1000, 'peak_mb': peak_mb(usage)}}


def sqlite(runtime, work):
    out, _, usage = run(runtime, [str(work / 'exec.mjs')])
    match = re.search(r'exec ([\d.]+) ms', out)
    return {'sqlite_exec': {'ms': float(match.group(1)) if match else 0.0, 'peak_mb': peak_mb(usage)}}


def cold(runtime, work):
    walls, peaks = [], []
    for _ in range(10):
        _, wall, usage = run(runtime, [str(work / 'hello.js')])
        walls.append(wall * 1000)
        peaks.append(peak_mb(usage))
    return {'cold_hello': {'ms': statistics.median(walls), 'peak_mb': statistics.median(peaks)}}


# Metrics where a larger value is better; the rest are better smaller.
LARGER_IS_BETTER = {'req_s', 'turns_s'}


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    baseline, candidate = os.path.abspath(sys.argv[1]), os.path.abspath(sys.argv[2])
    rounds = int(sys.argv[sys.argv.index('--rounds') + 1]) if '--rounds' in sys.argv else 6
    only = set(sys.argv[sys.argv.index('--only') + 1].split(',')) if '--only' in sys.argv else set()
    work = pathlib.Path(tempfile.mkdtemp(prefix='ci-bench-'))
    with open(work / 'big.bin', 'wb') as big:
        block = os.urandom(1 << 20)
        for _ in range(256):
            big.write(block)
    (work / 'exec.mjs').write_text(
        'const { DatabaseSync } = await import("node:sqlite");\n'
        'const db = new DatabaseSync(":memory:"); const sql = "select 1;".repeat(2000);\n'
        'for (let i = 0; i < 5; i++) db.exec(sql);\n'
        'let n = 0; const t0 = performance.now(), end = t0 + 1500; while (performance.now() < end) { db.exec(sql); n++; }\n'
        'console.log(`exec ${((performance.now() - t0) / n).toFixed(3)} ms`);\n')
    (work / 'hello.js').write_text('console.log("hello");\n')
    samples = {'baseline': [], 'candidate': []}
    for index in range(rounds):
        order = [('baseline', baseline), ('candidate', candidate)]
        if index % 2:
            order.reverse()
        for name, runtime in order:
            samples[name].append(bench_once(runtime, work, only))
        print(f'round {index + 1} of {rounds} done', flush=True)
    print(f'\n{"benchmark":<14} {"metric":<16} {"baseline":>12} {"candidate":>12} {"change":>8}  better     rounds candidate worse   ranges')
    worse = []
    for bench in samples['baseline'][0]:
        for metric in samples['baseline'][0][bench]:
            a = statistics.median(r[bench][metric] for r in samples['baseline'])
            b = statistics.median(r[bench][metric] for r in samples['candidate'])
            change = (b - a) / a * 100 if a else 0.0
            larger = metric in LARGER_IS_BETTER
            better = 'candidate' if (b > a) == larger and b != a else ('baseline' if b != a else 'same')
            base = [r[bench][metric] for r in samples['baseline']]
            cand = [r[bench][metric] for r in samples['candidate']]
            losses = sum(1 for x, y in zip(base, cand) if (y < x if larger else y > x))
            print(f'{bench:<14} {metric:<16} {a:>12.2f} {b:>12.2f} {change:>+7.1f}%  {better:<10} {losses:>2} of {len(base):<2}               '
                  f'{min(base):.2f}..{max(base):.2f} / {min(cand):.2f}..{max(cand):.2f}')
            if better == 'baseline' and abs(change) > 5:
                worse.append(f'{bench} {metric} {change:+.1f}%')
    print('\ncandidate more than 5% worse:', ', '.join(worse) if worse else 'none')


if __name__ == '__main__':
    main()
