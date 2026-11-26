#!/usr/bin/env python3
"""Compare node:zlib in two runtime builds: bench/scripts/zlib.cjs and gzip-http.cjs.

    tools/zlib_bench.py --a build/silkjs-czlib --b build/silkjs [--rounds 5] [--only REGEXP]

The builds run in turns, round by round, so host noise (about 8% of wall time) falls on both
alike. Each runs with SILKJS_PREPARSE_THREADS=0 and without NODE_OPTIONS and BUN_OPTIONS, as the
benchmark tasks do (bench/README.md). Nothing is measured while a compiler runs. The table has
the median of the rounds per case; --memory adds the peak RSS of single cases, one process each.
"""
from pathlib import Path
import argparse
import json
import os
import statistics
import subprocess
import sys

ROOT = Path(__file__).resolve().parent.parent
MEMORY_CASES = ['deflate-gzip-6-text-oneshot', 'inflate-gzip-6-text-oneshot', 'deflate-raw-9-binary-oneshot',
                'inflate-raw-6-binary-oneshot', 'deflate-gzip-6-json-stream', 'inflate-gzip-6-json-stream',
                'deflate-gzip-1-random-oneshot', 'inflate-gzip-1-random-oneshot']


def environment():
    env = {key: value for key, value in os.environ.items() if key not in ('NODE_OPTIONS', 'BUN_OPTIONS')}
    env['SILKJS_PREPARSE_THREADS'] = '0'
    return env


def compiler_running():
    found = subprocess.run(['pgrep', '-x', 'silkc|clang|llvm|cc1|ld.lld'], capture_output=True, text=True)
    return found.returncode == 0


def run(runtime, script, extra):
    done = subprocess.run([str(runtime), str(ROOT / 'bench/scripts' / script), *extra], env=environment(),
                          capture_output=True, text=True, timeout=1800)
    if done.returncode != 0:
        raise SystemExit(f'{runtime} {script} failed:\n{done.stderr}')
    return [json.loads(line) for line in done.stdout.splitlines() if line.startswith('{')]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--a', type=Path, required=True, help='the first build, the "before"')
    parser.add_argument('--b', type=Path, required=True, help='the second build, the "after"')
    parser.add_argument('--rounds', type=int, default=5)
    parser.add_argument('--only', default='')
    parser.add_argument('--binary', type=Path, help='the file of the "binary" input; the same for both builds')
    parser.add_argument('--memory', action='store_true', help='also the peak RSS of single cases')
    parser.add_argument('--out', type=Path)
    parser.add_argument('--force', action='store_true', help='measure although a compiler is running')
    args = parser.parse_args()
    if compiler_running() and not args.force:
        raise SystemExit('a compiler is running; measure when it has finished (--force overrides)')
    binary = (args.binary or args.a).resolve()
    builds = {'a': args.a.resolve(), 'b': args.b.resolve()}
    extra = ['--binary', str(binary)] + (['--only', args.only] if args.only else [])
    samples = {'a': {}, 'b': {}}
    http = {'a': [], 'b': []}
    for index in range(args.rounds):
        for key in (('a', 'b') if index % 2 == 0 else ('b', 'a')):
            for line in run(builds[key], 'zlib.cjs', extra):
                if 'mbps' in line:
                    samples[key].setdefault(line['name'], []).append(line['mbps'])
            if not args.only:
                http[key].append(run(builds[key], 'gzip-http.cjs', [])[0])
        print(f'round {index + 1} of {args.rounds} done', file=sys.stderr)
    rows = []
    for name in samples['a']:
        a = statistics.median(samples['a'][name])
        b = statistics.median(samples['b'].get(name, [float('nan')]))
        rows.append({'name': name, 'a': a, 'b': b, 'ratio': b / a if a else float('nan')})
    report = {'a': str(builds['a']), 'b': str(builds['b']), 'rounds': args.rounds, 'throughput': rows, 'samples': samples}
    print(f"{'case':42} {'a MB/s':>10} {'b MB/s':>10} {'b/a':>6}")
    for row in rows:
        print(f"{row['name']:42} {row['a']:10.1f} {row['b']:10.1f} {row['ratio']:6.2f}")
    if http['a']:
        a = statistics.median(x['requestsPerSecond'] for x in http['a'])
        b = statistics.median(x['requestsPerSecond'] for x in http['b'])
        ra = statistics.median(x['maxRssMb'] for x in http['a'])
        rb = statistics.median(x['maxRssMb'] for x in http['b'])
        report['http'] = {'a': a, 'b': b, 'aRssMb': ra, 'bRssMb': rb}
        print(f"{'gzip-http requests/s':42} {a:10.1f} {b:10.1f} {b / a:6.2f}")
        print(f"{'gzip-http peak RSS MB':42} {ra:10.1f} {rb:10.1f} {rb / ra:6.2f}")
    if args.memory:
        memory = []
        for name in MEMORY_CASES:
            peaks = {'a': [], 'b': []}
            for index in range(3):
                for key in (('a', 'b') if index % 2 == 0 else ('b', 'a')):
                    lines = run(builds[key], 'zlib.cjs', ['--binary', str(binary), '--only', f'^{name}$'])
                    peaks[key].append(lines[-1]['maxRssMb'])
            a, b = statistics.median(peaks['a']), statistics.median(peaks['b'])
            memory.append({'name': name, 'a': a, 'b': b})
            print(f"{'rss ' + name:42} {a:10.1f} {b:10.1f} {b / a:6.2f}")
        report['memoryMb'] = memory
    if args.out:
        args.out.write_text(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
