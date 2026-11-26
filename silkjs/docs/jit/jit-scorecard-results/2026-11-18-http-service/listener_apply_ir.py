"""Read self and direct-child costs of Function.prototype.apply from HTTP Callgrind receipts."""
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import sys

def sha(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def count(dump, names):
    aliases = {}
    calls = Counter()
    child_ir = Counter()
    self_ir = 0
    pending = None
    wrapper = 'js_function_invoke.silk::apply'
    incoming = 0
    caller = callee = ''
    for line in dump.read_text().splitlines():
        if line.startswith(('fn=', 'cfn=')):
            k, label = line.split('=', 1)
            ref = re.fullmatch(r'\((\d+)\)(?: (.*))?', label)
            if ref:
                ident, name = ref.groups()
                if name is not None:
                    aliases[ident] = name
                label = aliases[ident]
            symbol = label.partition("'")[0].partition('.llvm.')[0]
            method = names.get(symbol, symbol)
            if k == 'fn':
                caller = method
            else:
                callee = method
        elif line.startswith('calls='):
            pending = int(line[6:].split()[0])
        elif line.startswith(('0x', '+', '-', '*')):
            ir = int(line.split()[-1])
            if pending is not None:
                if callee == wrapper:
                    incoming += pending
                if caller == wrapper:
                    child_ir[callee] += ir
                    calls[callee] += pending
            elif caller == wrapper:
                self_ir += ir
            pending = None
        elif line.startswith('summary:'):
            total = int(line.split()[1])
    setup = self_ir + child_ir['js_function_invoke.silk::buildArgList'] + child_ir['__silk_guarded_reclaim']
    return dict(apply_calls=incoming, apply_self_ir=self_ir, direct_child_inclusive_ir=dict(child_ir), direct_child_calls=dict(calls),
                wrapper_and_argument_ir=setup, server_ir=total, wrapper_and_argument_percent=100 * setup / total)

if __name__ == '__main__':
    host = Path(sys.argv[1])
    names = {}
    for line in Path(str(host) + '.symbols').read_text().splitlines():
        code, _, name = line.split('\t', 2)
        names[code] = name.split(':', 1)[1]
    digest = sha(host)
    report = []
    for arg in sys.argv[2:]:
        folder = Path(arg)
        meta = json.loads((folder/'paired-fixed-work.json').read_text())
        assert meta['binary_sha256'] == digest
        for mode, sample in meta['samples'].items():
            dump, = (folder/mode).glob('profile.*.1')
            assert sha(dump) == sample['raw_dump_sha256']
            data = count(dump, names)
            assert data['server_ir'] == sample['summary_ir']
            report.append(dict(source=meta['source'],host_sha256=digest,dump_sha256=sha(dump),items=meta['items'],
                               policy=mode,verified=sample['profiled_verified'],warmup=sample['warmup_verified'],**data))
    print(json.dumps(report, indent=2))
