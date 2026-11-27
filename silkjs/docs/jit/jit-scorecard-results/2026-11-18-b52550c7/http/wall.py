#!/usr/bin/env python3
"""Compare production and diagnostic SilkJS release modes with Node on one HTTP service."""
import argparse
import json
import os
import platform
import statistics
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

TOGGLE = 'SILKJS_BENCH_ABLATE_STRICT_EQUALITY'
ENGINES = ('production_default', 'ablated_calls', 'node', 'admitted_default',
           'production_calls', 'ablated_default', 'admitted_calls')
METRICS = ('sequential_requests_per_s', 'server_cpu_us_per_request', 'first_response_ms', 'p99_ms', 'peak_rss_kib')


def summarize(results):
    def median_range(items):
        return dict(median=statistics.median(items), min=min(items), max=max(items))

    metrics = {name: {m: median_range([s[m] for s in samples]) for m in METRICS}
               for name, samples in results.items()}
    comparisons = (
        ('admitted_calls', 'ablated_calls'), ('admitted_default', 'ablated_default'),
        ('admitted_calls', 'admitted_default'), ('ablated_calls', 'ablated_default'),
        ('production_calls', 'production_default'), ('production_default', 'node'), ('production_calls', 'node'),
        ('production_default', 'admitted_default'), ('production_calls', 'admitted_calls'))
    paired = {}
    for lhs, rhs in comparisons:
        paired[lhs + '/' + rhs] = {m: median_range([a[m] / b[m] for a, b in zip(results[lhs], results[rhs])])
                                  for m in METRICS}
    return dict(metrics=metrics, paired_round_ratios=paired)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True, help='worktree containing jit_http.py')
    parser.add_argument('--host', type=Path, required=True)
    parser.add_argument('--host-sha', required=True)
    parser.add_argument('--source', required=True, help='git commit of diagnostic host')
    parser.add_argument('--production-source', required=True)
    parser.add_argument('--production-host', type=Path, required=True)
    parser.add_argument('--production-sha', required=True)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--rounds', type=int, choices=(3, 5), default=5)
    parser.add_argument('--seconds', type=float, default=3.0)
    parser.add_argument('--warmup', type=int, default=1200)
    parser.add_argument('--rate', type=int, default=100)
    parser.add_argument('--samples', type=int, default=400)
    parser.add_argument('--server-cpu', type=int, default=0)
    parser.add_argument('--client-cpu', type=int, default=4)
    parser.add_argument('--json', type=Path, required=True)
    args = parser.parse_args()
    sys.path.insert(0, str(args.repo / 'modules/runtime/bench'))
    import jit_http as bench
    if args.server_cpu == args.client_cpu or {args.server_cpu, args.client_cpu} - os.sched_getaffinity(0):
        parser.error('CPUs must be distinct and available')
    host = str(args.host.resolve(strict=True))
    node = str(args.node.resolve(strict=True))
    production = str(args.production_host.resolve(strict=True))
    if bench.sha256(host) != args.host_sha or bench.sha256(production) != args.production_sha:
        parser.error('host SHA256 differs from expected')
    if args.json.exists():
        parser.error('output file already exists')
    original = os.environ.pop(TOGGLE, None)
    if original is not None:
        parser.error('start with the diagnostic toggle unset')
    results = {name: [] for name in ENGINES}
    cpu_topology = {}
    for cpu in (args.server_cpu, args.client_cpu):
        topology = Path(f'/sys/devices/system/cpu/cpu{cpu}/topology')
        cpu_topology[cpu] = {label: (topology / label).read_text().strip()
                             for label in ('physical_package_id', 'core_id', 'thread_siblings_list')
                             if (topology / label).is_file()}
    report = dict(cpu_topology=cpu_topology, started_at=datetime.now(timezone.utc).isoformat(), platform=platform.uname()._asdict(),
                  cpu_model=Path('/proc/cpuinfo').read_text().split('model name\t: ', 1)[-1].split('\n', 1)[0],
                  available_cpus=sorted(os.sched_getaffinity(0)), server_cpu=args.server_cpu, client_cpu=args.client_cpu,
                  command=sys.argv, production_commit=args.production_source, diagnostic_commit=args.source,
                  diagnostic_sha256=args.host_sha, production_sha256=args.production_sha, node_sha256=bench.sha256(node),
                  node_versions=json.loads(subprocess.check_output([node, '-p', 'JSON.stringify(process.versions)'], text=True,
                                                                   env={k:v for k,v in os.environ.items() if k!='NODE_OPTIONS'})),
                  fixture_sha256=bench.sha256(bench.FIXTURE), benchmark_sha256=bench.sha256(bench.__file__),
                  trial_script_sha256=bench.sha256(__file__), warmup=args.warmup, seconds=args.seconds, rate=args.rate,
                  scheduled_samples=args.samples, toggle=TOGGLE, ablated_value='1', admitted_value=None,
                  preparser_threads=0, process_jit_counters='through shutdown, variable total workload',
                  protocol='same one persistent connection per process, checked 64-line JSON order requests; scheduled latency from intended arrival through verified response',
                  order=[], samples=results)
    os.sched_setaffinity(0, {args.client_cpu})
    # Each condition runs in five different positions across the five interleaved rounds.
    rotations = (0, 3, 6, 2, 5)[:args.rounds]
    for round_index, offset in enumerate(rotations, 1):
        order = ENGINES[offset:] + ENGINES[:offset]
        report['order'].append(order)
        for name in order:
            busy = bench.compiler_running()
            if busy:
                raise RuntimeError(f'compiler detected during round {round_index}: {busy[0]}')
            if name.startswith('ablated'):
                os.environ[TOGGLE] = '1'
            else:
                os.environ.pop(TOGGLE, None)
            is_node = name == 'node'
            calls = name.endswith('_calls')
            executable = production if name.startswith('production_') else host
            s = bench.run_sample(node if is_node else executable, not is_node, args.server_cpu, args, jit_calls=calls)
            if not is_node and bool(s['jit']['direct-calls']) != calls:
                raise ValueError(f'{name}: unexpected direct-call counter {s["jit"]}')
            results[name].append(s)
            print(f'{round_index} {name:16s} {s["sequential_requests_per_s"]:7.1f} req/s '
                  f'{s["server_cpu_us_per_request"]:7.2f} us/order {s["p99_ms"]:6.2f} ms p99', flush=True)
            args.json.write_text(json.dumps(report, indent=2) + '\n')
    os.environ.pop(TOGGLE, None)
    report['summaries'] = summarize(results)
    report['finished_at'] = datetime.now(timezone.utc).isoformat()
    args.json.write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
