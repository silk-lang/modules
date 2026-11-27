#!/usr/bin/env python3
"""Measure two production builds and Node on identical checked HTTP orders."""
import argparse
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import platform
import statistics
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'modules/runtime/bench'))
import jit_http as bench

MODES = ('before_default', 'after_calls', 'node', 'before_interpreter',
         'after_default', 'before_calls', 'after_interpreter')
JSON_MODES = ('before_default', 'after_calls', 'json_default', 'node', 'before_interpreter',
              'after_default', 'json_calls', 'before_calls', 'after_interpreter')
SMALL_MODES = ('after_default', 'node', 'after_interpreter', 'after_calls')
METRICS = ('sequential_requests_per_s', 'server_cpu_us_per_request', 'first_response_ms', 'p99_ms', 'peak_rss_kib')
PAIRS = [('after_default', 'before_default'), ('after_calls', 'before_calls'), ('after_calls', 'after_default'),
         ('before_calls', 'before_default'), ('after_default', 'node'), ('after_calls', 'node'),
         ('before_default', 'node'), ('before_calls', 'node'), ('after_interpreter', 'before_interpreter'),
         ('after_default', 'after_interpreter'), ('after_calls', 'after_interpreter'),
         ('before_default', 'before_interpreter'), ('after_interpreter', 'node'),
         ('after_default', 'json_default'), ('after_calls', 'json_calls'),
         ('json_default', 'before_default'), ('json_calls', 'before_calls')]


def spread(values):
    return {'median': statistics.median(values), 'min': min(values), 'max': max(values),
            'sample_sd': statistics.stdev(values), 'rounds': values}


def active_benchmark_jobs():
    # Catch the native suite, differential runners and profilers as well as compiler children.
    known = ('silkjs-engine', 'silkjs-jit', 'callgrind', 'valgrind', 'lldb', 'clang', 'silkc', 'ld.lld')
    rows = subprocess.check_output(['ps','-eo','stat=,comm='], text=True).splitlines()
    return [line.strip() for line in rows if len(line.split()) == 2 and
            not line.split()[0].startswith('Z') and line.split()[1].startswith(known)]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for stage in ('before', 'after'):
        parser.add_argument('--' + stage, required=True, type=Path)
        parser.add_argument('--' + stage + '-sha', required=True)
        parser.add_argument('--' + stage + '-source', required=True)
    parser.add_argument('--before-interpreter', type=Path, required=True)
    parser.add_argument('--before-interpreter-sha', required=True)
    parser.add_argument('--before-interpreter-source', required=True)
    parser.add_argument('--json-only', type=Path, help='matched JSON-only release host for component attribution')
    parser.add_argument('--json-only-sha')
    parser.add_argument('--json-only-source')
    parser.add_argument('--small', action='store_true', help='separate three-round, four-item candidate/Node diagnostic')
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--server-cpu', type=int, default=0)
    parser.add_argument('--client-cpu', type=int, default=4)
    args = parser.parse_args()
    modes = SMALL_MODES if args.small else MODES
    rotations = (0, 2, 1) if args.small else (0, 3, 6, 2, 5)
    if args.json_only:
        if not args.json_only_source or not args.json_only_sha:
            parser.error('JSON-only source and expected digest are required')
        if not args.small:
            modes = JSON_MODES
            rotations = (0, 4, 8, 3, 7)
    settings = argparse.Namespace(seconds=3.0, warmup=1200, samples=400, rate=100,
                                  items=4 if args.small else 64)
    original_cpus = sorted(os.sched_getaffinity(0))
    if args.server_cpu == args.client_cpu or {args.server_cpu, args.client_cpu} - set(original_cpus):
        parser.error('requires two distinct available CPUs')
    bins = {'before': args.before.resolve(strict=True), 'after': args.after.resolve(strict=True),
            'before_interpreter': args.before_interpreter.resolve(strict=True), 'node': args.node.resolve(strict=True)}
    if args.json_only:
        bins['json'] = args.json_only.resolve(strict=True)
    digests = {k:bench.sha256(v) for k,v in bins.items()}
    if digests['before'] != args.before_sha or digests['after'] != args.after_sha or digests['before_interpreter'] != args.before_interpreter_sha:
        parser.error('unexpected host SHA256')
    if args.json_only and digests['json'] != args.json_only_sha:
        parser.error('unexpected JSON-only release host SHA256')
    if digests['before'] == digests['after']:
        parser.error('before and after hashes must differ')
    if 'SILKJS_BENCH_ABLATE_STRICT_EQUALITY' in os.environ:
        parser.error('start with diagnostic equality control unset')
    args.out.mkdir(exist_ok=False)
    versions = subprocess.check_output([bins['node'], '-p', 'JSON.stringify(process.versions)'],
                                       env={k:v for k,v in os.environ.items() if k!='NODE_OPTIONS'}, text=True)
    report = {'started_utc': datetime.now(timezone.utc).isoformat(), 'command': sys.argv,
              'settings': vars(settings), 'cpu': {'before_pin': original_cpus,
              'server': args.server_cpu, 'client': args.client_cpu}, 'platform': platform.uname()._asdict(),
              'topology': {cpu: {k:(Path(f'/sys/devices/system/cpu/cpu{cpu}/topology')/k).read_text().strip()
                                for k in ('physical_package_id','core_id','thread_siblings_list')}
                           for cpu in (args.server_cpu,args.client_cpu)},
              'cpu_model': Path('/proc/cpuinfo').read_text().split('model name\t: ',1)[-1].splitlines()[0],
              'binaries_sha256': digests, 'sources': {'before': args.before_source, 'after': args.after_source,
              'before_interpreter': args.before_interpreter_source, 'json': args.json_only_source},
              'node': json.loads(versions), 'fixture_sha256': bench.sha256(bench.FIXTURE),
              'client_sha256': bench.sha256(bench.__file__), 'driver_sha256': bench.sha256(__file__),
              'round_order': [], 'samples': {key:[] for key in modes}}
    os.sched_setaffinity(0, {args.client_cpu})
    # Rotate every condition to a different within-round position.
    if os.sched_getaffinity(0) != {args.client_cpu}:
        raise RuntimeError('client affinity did not take effect')
    for rnd, offset in enumerate(rotations,1):
        order = modes[offset:] + modes[:offset]
        report['round_order'].append(order)
        for mode in order:
            busy = active_benchmark_jobs()
            if busy:
                raise RuntimeError('concurrent benchmark/compiler/profiler detected: ' + busy[0])
            stage = mode if mode == 'before_interpreter' else mode.partition('_')[0]
            calls = mode.endswith('_calls')
            sample = bench.run_sample(str(bins[stage]), stage != 'node', args.server_cpu, settings, jit_calls=calls,
                                      interpret=mode.endswith('_interpreter'), items=settings.items)
            if stage != 'node' and bool(sample['jit']['direct-calls']) != calls:
                raise RuntimeError(f'unexpected direct-call count in {mode}')
            report['samples'][mode].append(sample)
            print(f'{rnd} {mode:16} {sample["sequential_requests_per_s"]:.1f} req/s, '
                  f'{sample["server_cpu_us_per_request"]:.2f} us/order', flush=True)
            # Each completed process remains recoverable if a later process is interrupted.
            (args.out/'raw.json').write_text(json.dumps(report,separators=(',',':')) + '\n')
    report['finished_utc'] = datetime.now(timezone.utc).isoformat()
    raw = json.dumps(report,separators=(',',':')).encode() + b'\n'
    compressed = args.out/'samples.json.gz'
    compressed.write_bytes(gzip.compress(raw, mtime=0))
    (args.out/'raw.json').unlink()
    rows = report.pop('samples')
    report['raw_samples_sha256'] = bench.sha256(compressed)
    report['verified_orders'] = sum(1 + settings.warmup + s['requests'] + settings.samples
                                    for samples in rows.values() for s in samples)
    report['summary'] = {mode:{m:spread([s[m] for s in samples]) for m in METRICS} for mode,samples in rows.items()}
    report['paired_ratios'] = {
        a+'/'+b:{m:spread([x[m]/y[m] for x,y in zip(rows[a],rows[b])]) for m in METRICS}
        for a,b in PAIRS if a in rows and b in rows}
    if 'json_calls' in rows:
        # Effect of the keyed-read change with calls on divided by its effect with calls off.
        report['keyed_effect_calls_vs_default'] = {
            m:spread([a[m]/j[m] / (d[m]/c[m]) for a,j,d,c in zip(
                rows['after_calls'],rows['json_calls'],rows['after_default'],rows['json_default'])])
            for m in METRICS}
    (args.out/'wall.json').write_text(json.dumps(report,indent=2)+'\n')


if __name__ == '__main__':
    main()
