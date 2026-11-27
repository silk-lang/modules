#!/usr/bin/env python3
"""Profile two JIT modes with the same checked HTTP fixture and a fixed order count."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

HERE = Path(__file__).resolve()
ROOT = HERE.parents[4]
sys.path.insert(0, str(ROOT / 'modules/runtime/bench'))
import jit_http
from jit_coverage import jit_symbol_groups

spec = importlib.util.spec_from_file_location('http_fixed_work',
    HERE.parents[1] / '2026-11-18-b52550c7/http/profile.py')
profile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(profile)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True, type=Path)
    parser.add_argument('--host-sha', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--warmup', required=True, type=int)
    parser.add_argument('--items', type=int, choices=(4,64), default=64)
    args = parser.parse_args()
    host = args.host.resolve(strict=True)
    symbols = Path(str(host) + '.symbols')
    if jit_http.sha256(host) != args.host_sha:
        parser.error('host digest differs from expected')
    groups = jit_symbol_groups(str(host))
    if set(groups.values()) != {'helpers','compiler'}:
        parser.error('the release symbols sidecar is required')
    for line in symbols.read_text().splitlines():
        symbol, _, name = line.split('\t',2)
        package, _, source = name.partition('::')[0].partition(':')
        if package.startswith('silkjs-engine@'):
            if source.startswith('js_vm'):
                groups[symbol] = 'vm'
            elif source in ('js_json_parse.silk', 'js_json_intrinsics_parse.silk'):
                groups[symbol] = 'json_parse'
            elif source == 'js_gc.silk':
                groups[symbol] = 'gc'
    args.out.mkdir(exist_ok=False)
    samples = {}
    report = dict(command=sys.argv, source=args.source, binary_sha256=args.host_sha,
                  symbols_sha256=jit_http.sha256(symbols), fixture_sha256=jit_http.sha256(jit_http.FIXTURE),
                  trial_script_sha256=jit_http.sha256(HERE), shared_profile_script_sha256=jit_http.sha256(profile.__file__),
                  valgrind_version=subprocess.check_output(['valgrind','--version'], text=True).strip(),
                  items=args.items, samples=samples)
    bench = SimpleNamespace(FIXTURE=jit_http.FIXTURE, cases=lambda:jit_http.cases(args.items), post=jit_http.post,
                            jit_counters=jit_http.jit_counters, sha256=jit_http.sha256)
    for mode in ('default','with_calls'):
        sample = profile.collect(bench, groups, host, mode, args.out.resolve()/mode, args.warmup)
        samples[mode] = sample
        (args.out/'paired-fixed-work.json').write_text(json.dumps(report,indent=2)+'\n')
        print(mode, round(sample['instructions_per_order']), sample['self_percent_by_group'], flush=True)


if __name__ == '__main__':
    main()
