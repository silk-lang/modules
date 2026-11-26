#!/usr/bin/env python3
"""Runs the React benchmark and prints its tables (README.md).

Each measurement is a fresh process: the engine's driver (driver/, built with
`silk build --release`) and Node, with and without its JIT, on the same dist/bundle.js.
The table shows the median of --runs runs; --json keeps every run.

  python3 run.py                                   # the release driver against node
  python3 run.py --engine before=old/react-bench --engine after=new/react-bench
  python3 run.py --engine "image=new/react-bench --bytecode dist/bundle.bin"
"""
import argparse
import json
import os
import shlex
import shutil
import statistics
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
DRIVER = ROOT / 'build' / 'x86_64-unknown-linux-gnu' / 'release' / 'silkjs-react-bench'

MOUNT_ROWS = [
    ('realm_ns', 'create the realm', 'ms'),
    ('compile_ns', 'parse + compile (or load bytecode)', 'ms'),
    ('evaluate_ns', 'bundle top-level evaluation', 'ms'),
    ('mount_ns', 'React render + commit', 'ms'),
    ('cold_ns', 'cold mount: all of the above', 'ms'),
    ('mount_gc_ns', 'GC time within it', 'ms'),
    ('mount_full_collections', 'full collections', 'count'),
    ('mount_young_collections', 'young collections', 'count'),
    ('mount_peak_bytes', 'peak heap', 'MB'),
    ('mount_used_bytes', 'heap after mount', 'MB'),
    ('retained_used_bytes', 'retained heap (after a full collection)', 'MB'),
    ('peak_resident_bytes', 'peak resident memory', 'MB'),
    ('retained_resident_bytes', 'resident memory after the collection', 'MB'),
    ('unmounted_used_bytes', 'heap after unmounting', 'MB'),
    ('unmounted_resident_bytes', 'resident memory after unmounting', 'MB'),
]
STREAM_ROWS = [
    ('tick_ns', 'one streamed update (setState + commit)', 'us'),
    ('stream_gc_ns', 'GC time over all ticks', 'ms'),
    ('stream_full_collections', 'full collections', 'count'),
    ('stream_young_collections', 'young collections', 'count'),
]


def measure(command, mode, bundle, counts):
    """One process; returns its `name value` lines as a dict, with derived values added."""
    done = subprocess.run([*command, mode, str(bundle), *map(str, counts)], capture_output=True, text=True)
    if done.returncode != 0:
        raise SystemExit(f'{" ".join(command)} failed:\n{done.stdout[-2000:]}{done.stderr[-2000:]}')
    values = {}
    for line in done.stdout.splitlines():
        name, _, value = line.partition(' ')
        if value.strip().isdigit():
            values[name] = int(value)
    # The engine counts collections in CPU ticks; the run gives both clocks.
    if values.get('run_ticks'):
        scale = values['run_ns'] / values['run_ticks']
        for prefix in ('mount', 'stream'):
            if f'{prefix}_gc_ticks' in values:
                values[f'{prefix}_gc_ns'] = round(values[f'{prefix}_gc_ticks'] * scale)
    values['cold_ns'] = sum(values.get(name, 0) for name in ('realm_ns', 'compile_ns', 'evaluate_ns', 'mount_ns'))
    if 'stream_ns' in values:
        values['tick_ns'] = values['stream_ns'] // values['stream_ticks']
    return values


def measure_peak(command, mode, bundle, counts):
    """measure; the engine driver reports resident memory after each phase, the largest is its peak."""
    values = measure(command, mode, bundle, counts)
    if 'peak_resident_bytes' not in values:
        seen = [values[name] for name in values if name.endswith('_resident_bytes') and name not in ('closed_resident_bytes', 'unmounted_resident_bytes')]
        if seen:
            values['peak_resident_bytes'] = max(seen)
    return values


def show(value, unit):
    if value is None:
        return '-'
    if unit == 'ms':
        return f'{value / 1e6:.1f}'
    if unit == 'us':
        return f'{value / 1e3:.0f}'
    if unit == 'MB':
        return f'{value / 1048576:.1f}'
    return f'{value:g}'


def table(title, rows, results, labels):
    print(f'\n{title}\n')
    print('| | ' + ' | '.join(labels) + ' |')
    print('|---|' + '---:|' * len(labels))
    for key, name, unit in rows:
        cells = []
        for label in labels:
            runs = [run[key] for run in results[label] if key in run]
            cells.append(show(statistics.median(runs) if runs else None, unit))
        suffix = '' if unit == 'count' else f' ({unit.replace("us", "µs")})'
        print(f'| {name}{suffix} | ' + ' | '.join(cells) + ' |')


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--engine', action='append', default=[], metavar='[LABEL=]COMMAND',
                        help='a driver executable with its options; repeat to compare builds (default: the release driver)')
    parser.add_argument('--node', default=os.environ.get('NODE_REFERENCE') or shutil.which('node'), help='the Node executable')
    parser.add_argument('--no-node', action='store_true', help='leave the Node references out')
    parser.add_argument('--bundle', type=Path, default=HERE / 'dist' / 'bundle.js')
    parser.add_argument('--runs', type=int, default=10)
    parser.add_argument('--messages', type=int, default=1000, help='messages mounted (33 host elements each)')
    parser.add_argument('--stream-messages', type=int, default=200)
    parser.add_argument('--ticks', type=int, default=200)
    parser.add_argument('--only', choices=['mount', 'stream'])
    parser.add_argument('--json', type=Path, help='write every run here')
    args = parser.parse_args()

    engines = []
    for spec in args.engine or [f'silkjs={DRIVER}']:
        label, separator, command = spec.partition('=')
        if not separator or '/' in label or ' ' in label:
            label, command = 'silkjs', spec
        engines.append((label, shlex.split(command)))
    if not args.no_node and args.node:
        runner = str(HERE / 'run-node.mjs')
        engines.append(('node --jitless', [args.node, '--expose-gc', '--jitless', '--no-warnings', runner]))
        engines.append(('node', [args.node, '--expose-gc', runner]))
    labels = [label for label, _ in engines]

    modes = [args.only] if args.only else ['mount', 'stream']
    results = {mode: {label: [] for label in labels} for mode in modes}
    # Interleaved, so that a busy moment on the machine costs every engine the same.
    for _ in range(args.runs):
        for mode in modes:
            counts = [args.messages] if mode == 'mount' else [args.stream_messages, args.ticks]
            for label, command in engines:
                results[mode][label].append(measure_peak(command, mode, args.bundle, counts))
    if 'mount' in results:
        nodes = results['mount'][labels[0]][0].get('nodes')
        table(f'Mount of {args.messages} messages ({nodes} host nodes), median of {args.runs} runs', MOUNT_ROWS, results['mount'], labels)
    if 'stream' in results:
        table(f'Streaming into the last of {args.stream_messages} messages, {args.ticks} ticks, median of {args.runs} runs',
              STREAM_ROWS, results['stream'], labels)
    if args.json:
        args.json.write_text(json.dumps(results, indent=1))


if __name__ == '__main__':
    main()
