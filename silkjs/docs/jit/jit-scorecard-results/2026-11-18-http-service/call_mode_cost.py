"""Compare exclusive symbol instructions and call-edge counts in paired fixed.py captures."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

from listener_apply_ir import sha


VM = 'js_vm.silk::'
ACTIVATION = [VM + name for name in (
    'startActivation', 'activationCall', 'callForCompiled', 'linkedCall',
    'runActivations', 'compiledCall', 'publishActivations',
)]
GENERATED = '[generated]'
EDGES = [
    (VM + 'linkedCall', VM + 'startActivation'),
    (VM + 'runActivations', VM + 'activationCall'),
    (VM + 'activationCall', VM + 'publishActivations'),
    (VM + 'activationCall', VM + 'callForCompiled'),
    (VM + 'activationCall', VM + 'constructInternal'),
    (VM + 'activationCall', VM + 'compiledOp'),
    (VM + 'compiledCall', VM + 'compiledOp'),
    (VM + 'compiledOp', 'js_vm_object_ops.silk::step'),
    (VM + 'compiledOp', 'js_vm_factories.silk::step'),
    (VM + 'compiledOp', 'js_vm_locals.silk::step'),
    (VM + 'compiledOp', 'js_vm_property_ops.silk::step'),
    ('js_vm_object_ops.silk::step', 'js_vm_object_ops.silk::defineFieldFast'),
]
COMPRESSED_LABEL = re.compile(r'\((\d+)\)(?: (.*))?')


def read_profile(dump, mappings, symbols, host):
    executable = []
    for line in mappings.read_text().splitlines():
        fields = line.split()
        if len(fields) == 5 and fields[1] == 'r-xp' and fields[3] == '00:00':
            executable.append(tuple(int(x, 16) for x in fields[0].split('-')))
    if not executable:
        raise ValueError('missing executable JIT maps')

    def label(obj, function):
        name = re.sub(r"(?:'\d+|\.llvm\.\d+)+$", '', function)
        if Path(obj).name == host.name:
            return symbols.get(name, name)
        if obj == '???' and name.startswith('0x'):
            address = int(name, 16)
            return GENERATED if any(lo <= address < hi for lo, hi in executable) else '[unknown address]'
        return name

    names = {'fn': {}, 'ob': {}}
    self_ir = Counter()
    calls = Counter()
    obj = fn = callee_obj = callee = ''
    pending_calls = None
    summary_ir = None
    with dump.open() as stream:
        for line in map(str.rstrip, stream):
            if line.startswith('summary:'):
                summary_ir = int(line.split()[1])
            elif line.startswith('events:') and line != 'events: Ir':
                raise ValueError(f'expected one Ir event in {dump}')
            elif line.startswith(('ob=', 'fn=', 'cob=', 'cfn=')):
                field, value = line.split('=', 1)
                compressed = COMPRESSED_LABEL.fullmatch(value)
                if compressed:
                    index, name = compressed.groups()
                    table = names[field[-2:]]
                    if name is not None:
                        table[index] = name
                    value = table[index]
                if field == 'ob':
                    obj = value
                elif field == 'fn':
                    fn = value
                    callee_obj = callee = ''
                elif field == 'cob':
                    callee_obj = value
                else:
                    callee = value
            elif line.startswith('calls='):
                pending_calls = int(line[6:].split()[0])
            elif line.startswith(('0x', '+', '-', '*')):
                caller = label(obj, fn)
                if pending_calls is None:
                    self_ir[caller] += int(line.split()[-1])
                else:
                    # The cost on this line already includes callees; only retain call count.
                    calls[caller, label(callee_obj or obj, callee)] += pending_calls
                    pending_calls = None
    return self_ir, calls, summary_ir


def compare(folder, host, host_sha, symbols, symbols_sha):
    receipt = json.loads((folder / 'paired-fixed-work.json').read_text())
    if (host_sha, symbols_sha) != (receipt['binary_sha256'], receipt['symbols_sha256']):
        raise ValueError('host or symbols differ from capture')
    samples = receipt['samples']
    modes = ['default', 'with_calls']
    if [samples[m]['flags'] for m in modes] != [[], ['--jit-calls']]:
        raise ValueError('expected only --jit-calls to vary')
    orders, = {s['profiled_verified'] for s in samples.values()}
    warmup, = {s['warmup_verified'] for s in samples.values()}
    costs, edges, groups, checks = [], [], [], {}
    for mode in modes:
        sample = samples[mode]
        dump, = (folder / mode).glob('profile.*.1')
        maps = folder / mode / 'maps.txt'
        digest = sha(dump)
        if (digest != sample['raw_dump_sha256'] or orders != 400 or not sample['keep_alive']
                or not sample['clean_stop'] or sample['strict_equality_ablation'] is not None):
            raise ValueError(f'unmatched fixed-work window: {folder}/{mode}')
        counts, calls, summary = read_profile(dump, maps, symbols, host)
        if (sum(counts.values()) != sample['self_ir'] or summary != sample['summary_ir']
                or counts[GENERATED] != sample['self_ir_by_group']['generated']):
            raise ValueError(f'exclusive accounting disagrees with fixed.py for {dump}')
        costs.append(counts)
        edges.append(calls)
        groups.append(sample['self_ir_by_group'])
        checks[mode] = dict(dump_sha256=digest, maps_sha256=sha(maps), summary_ir=summary,
                            sum_exclusive_ir=sum(counts.values()))
    def row(before, after):
        return [before / orders, after / orders, (after - before) / orders]

    before, after = costs
    delta_order = sorted(before.keys() | after.keys(), key=lambda name: (before[name] - after[name], name))
    selection = dict.fromkeys(ACTIVATION + delta_order[:15] + delta_order[-5:])
    lhs, rhs = edges
    return dict(source=receipt['source'], fixture_sha256=receipt['fixture_sha256'],
                items=receipt['items'], warmup_verified=warmup, profiled_verified=orders,
                checks=checks, all_exclusive_ir_per_order=row(sum(before.values()), sum(after.values())),
                activation_exclusive_ir_per_order=row(sum(before[n] for n in ACTIVATION),
                                                      sum(after[n] for n in ACTIVATION)),
                group_exclusive_ir_per_order={n: row(groups[0][n], groups[1][n]) for n in sorted(groups[0])},
                selected_exclusive_ir_per_order={n: row(before[n], after[n]) for n in selection},
                calls_per_order={f'{a} -> {b}': row(lhs[a,b], rhs[a,b]) for a,b in EDGES})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host', type=Path, help='profiled executable with adjacent .symbols')
    parser.add_argument('capture', nargs='+', type=Path, help='output folder(s) from fixed.py')
    args = parser.parse_args()
    sidecar = Path(str(args.host) + '.symbols')
    symbols = {}
    for line in sidecar.read_text().splitlines():
        key, _, qualified = line.split('\t', 2)
        name = qualified.removeprefix('silkjs-engine@0.1.0:')
        if key in symbols and symbols[key] != name:
            raise ValueError(f'ambiguous native symbol {key}')
        symbols[key] = name
    expected = set(ACTIVATION) | {n for edge in EDGES for n in edge}
    if missing := expected.difference(symbols.values()):
        raise ValueError(f'missing expected source symbols: {sorted(missing)}')
    host_sha, symbols_sha = sha(args.host), sha(sidecar)
    print(json.dumps(dict(
        binary_sha256=host_sha, symbols_sha256=symbols_sha,
        columns=['default', 'with_calls', 'with_calls_minus_default'],
        activation_symbols=ACTIVATION,
        method='Exclusive Ir sums the guest instructions at each symbol, merging recursion, LLVM clones and Silk specializations with the same source name. Generated addresses use each process executable maps. The seven activation symbols form a subset of vm. The selected call edges count transitions and can occur in sequence on the same operation.',
        windows=[compare(p, args.host, host_sha, symbols, symbols_sha) for p in args.capture],
    ), indent=2))


if __name__ == '__main__':
    main()
