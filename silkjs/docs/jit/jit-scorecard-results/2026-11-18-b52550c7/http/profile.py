#!/usr/bin/env python3
"""Profile a fixed number of verified HTTP orders in four modes of the same diagnostic host."""
import argparse
from collections import Counter
import http.client
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys

TOGGLE = 'SILKJS_BENCH_ABLATE_STRICT_EQUALITY'
MODES = ('admitted_calls', 'ablated_calls', 'ablated_default', 'admitted_default')


def region_costs(profile, guest_maps, groups):
    # Restrict generated code to guest anonymous RX ranges. Skip inclusive edges.
    ranges = []
    for line in guest_maps.splitlines():
        fields = line.split()
        if len(fields) == 5 and fields[1] == 'r-xp' and fields[3] == '00:00':
            ranges.append([int(v, 16) for v in fields[0].split('-')])
    if not ranges:
        raise ValueError('missing anonymous executable guest mappings')
    costs = Counter()
    tables = {'fn': {}, 'ob': {}}
    obj = fn = ''
    edge = False
    for line in profile.read_text().splitlines():
        if line.startswith('summary:'):
            summary = int(line.split()[1])
        elif line.startswith('totals:'):
            total = int(line.split()[1])
        elif line.startswith('calls='):
            edge = True
        elif line.startswith(('0x', '+', '-', '*')):
            if not edge:
                costs[obj, fn] += int(line.split()[-1])
            edge = False
        elif '=' in line:
            key, value = line.split('=', 1)
            if key not in ('fn', 'cfn', 'ob', 'cob'):
                continue
            table = tables[key[-2:]]
            ref = re.fullmatch(r'\((\d+)\)(?: (.*))?', value)
            if ref:
                ident, name = ref.groups()
                if name is not None:
                    table[ident] = name
                value = table[ident]
            if key == 'fn':
                fn = value
            elif key == 'ob':
                obj = value
    if sum(costs.values()) != total:
        raise ValueError('exclusive cost sum differs from dump total')
    counts = Counter(dict.fromkeys(('generated', *sorted(set(groups.values()))), 0))
    for (obj, fn), cost in costs.items():
        if obj == '???' and re.fullmatch(r'0x[0-9a-f]+', fn):
            if any(lo <= int(fn, 16) < hi for lo, hi in ranges):
                counts['generated'] += cost
        else:
            name = fn.split("'")[0].split('.llvm.')[0]
            group = groups.get(name)
            if group:
                counts[group] += cost
    if not counts['generated']:
        raise ValueError('no generated-code instructions observed')
    return dict(summary_ir=summary, self_ir=total, self_ir_by_group=dict(counts),
                self_percent_by_group={k: v * 100 / total for k,v in counts.items()})


def collect(bench, groups, host, mode, directory, warmup):
    directory.mkdir()
    flags = ['--jit-calls'] if mode.endswith('_calls') else []
    env = {k: v for k,v in os.environ.items() if k not in ('BUN_OPTIONS', 'NODE_OPTIONS', TOGGLE)}
    env['SILKJS_PREPARSE_THREADS'] = '0'
    if mode.startswith('ablated_'):
        env[TOGGLE] = '1'
    command = ['valgrind', '--tool=callgrind', '--instr-atstart=no', '--dump-instr=yes',
               '--smc-check=all-non-file', '--compress-pos=yes', '--separate-threads=no',
               '--collect-jumps=no', '--callgrind-out-file=' + str(directory / 'profile.%p'),
               str(host), *flags, str(bench.FIXTURE)]
    with (directory / 'server.log').open('w+') as log:
        child = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True)
        def control(*args):
            ctl = subprocess.run(['callgrind_control', *args, str(child.pid)], env=env, capture_output=True,
                                 text=True, timeout=45, check=True)
            if 'PID ' not in ctl.stdout or 'ERROR' in ctl.stdout:
                raise ValueError(ctl.stdout + ctl.stderr)
        conn = None
        try:
            if not select.select([child.stdout], [], [], 120)[0]:
                raise TimeoutError('server under Callgrind timed out')
            ready = re.fullmatch(rb'ready (\d+)\n', child.stdout.readline())
            if not ready:
                raise ValueError('server produced no port')
            conn = http.client.HTTPConnection('127.0.0.1', int(ready[1]), timeout=45)
            payloads = bench.cases()
            def orders(n):
                for i in range(n):
                    bench.post(conn, '/order', *payloads[i % len(payloads)])
                    if conn.sock is not sock:
                        raise ValueError('persistent connection closed')
            conn.connect()
            sock = conn.sock
            orders(warmup)
            control('-i','on')
            control('-z')
            orders(400)
            maps = Path(f'/proc/{child.pid}/maps').read_text()
            (directory / 'maps.txt').write_text(maps)
            control('--dump=400_orders')
            control('-i','off')
            bench.post(conn, '/stop', b'', b'stopped')
            conn.close()
            child.communicate(timeout=45)
            if child.returncode:
                raise ValueError(f'server status {child.returncode}')
            log.seek(0)
            counters = bench.jit_counters(log.read())
            if bool(counters['direct-calls']) != bool(flags):
                raise ValueError(f'direct-call counter mismatches mode {mode}')
        finally:
            if conn:
                conn.close()
            if child.poll() is None:
                try:
                    os.killpg(child.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            child.communicate()
    profile, = directory.glob('profile.*.1')
    summary = region_costs(profile, maps, groups)
    return dict(summary, instructions_per_order=summary['summary_ir'] / 400,
                warmup_verified=warmup, profiled_verified=400, clean_stop=True, keep_alive=True,
                valgrind_command=command, strict_equality_ablation=env.get(TOGGLE), flags=flags,
                whole_process_jit=counters, raw_dump_sha256=bench.sha256(profile))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--host', type=Path, required=True)
    parser.add_argument('--host-sha', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--warmup', type=int, default=1200, help='verified orders before enabling instrumentation')
    args = parser.parse_args()
    sys.path.insert(0, str(args.repo / 'modules/runtime/bench'))
    import jit_http as bench
    from jit_coverage import jit_symbol_groups
    if args.warmup <= 0:
        parser.error('positive warmup required')
    host = args.host.resolve(strict=True)
    if bench.sha256(host) != args.host_sha:
        parser.error('unexpected host SHA256')
    groups = jit_symbol_groups(str(host))
    if set(groups.values()) != {'helpers', 'compiler'}:
        parser.error('missing or incomplete release .symbols sidecar')
    for line in Path(str(host) + '.symbols').read_text().splitlines():
        symbol, _, qualified = line.split('\t', 2)
        module = qualified.partition('::')[0]
        package, _, source = module.partition(':')
        if package.startswith('silkjs-engine@'):
            if source.startswith('js_vm'):
                groups[symbol] = 'vm'
            elif source in ('js_json_parse.silk', 'js_json_intrinsics_parse.silk'):
                groups[symbol] = 'json_parse'
            elif source == 'js_gc.silk':
                groups[symbol] = 'gc'
    args.out.mkdir(exist_ok=False)
    out = args.out.resolve()
    results = {}
    report = dict(command=sys.argv, binary_sha256=args.host_sha, fixture_sha256=bench.sha256(bench.FIXTURE),
                  symbols_sha256=bench.sha256(str(host) + '.symbols'), trial_script_sha256=bench.sha256(__file__),
                  valgrind_version=subprocess.check_output(['valgrind','--version'], text=True).strip(),
                  samples=results)
    for mode in MODES:
        sample = collect(bench, groups, host, mode, out / mode, args.warmup)
        results[mode] = sample
        print(mode, round(sample['instructions_per_order']), sample['self_percent_by_group'], flush=True)
        (out / 'paired-fixed-work.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
