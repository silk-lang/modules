"""Compare pilot release hosts with the existing verified order service (Linux x86-64)."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import random
import subprocess
import sys
from types import SimpleNamespace

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--host', action='append', nargs=2, metavar=('LABEL', 'BINARY'), required=True)
    parser.add_argument('--node', type=Path, required=True)
    parser.add_argument('--rounds', type=int, default=6)
    parser.add_argument('--items', type=int, default=64)
    args = parser.parse_args()
    repo = args.repo.resolve()
    folder = repo / 'docs/jit/jit-scorecard-results/2026-11-18-http-service'
    spec = importlib.util.spec_from_file_location('wall', folder / 'wall.py')
    wall = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wall)
    bench = wall.bench
    settings = SimpleNamespace(warmup=1200, seconds=3, samples=40, rate=100)
    hosts = {k:Path(v).resolve(strict=True) for k,v in args.host}
    hosts['node'] = args.node.resolve(strict=True)
    modes = [(k,mode) for k in hosts if k != 'node' for mode in ('default','calls','interp')]
    modes.append(('node','default'))
    os.sched_setaffinity(0, {4})
    rng = random.Random(703)
    rng.shuffle(modes)
    data = dict(settings=vars(settings), items=args.items, rounds=args.rounds, server_cpu=0, client_cpu=4,
                fixture_sha256=bench.sha256(bench.FIXTURE), client_sha256=bench.sha256(bench.__file__),
                driver_sha256=bench.sha256(__file__), host_sha256={k:bench.sha256(v) for k,v in hosts.items()},
                node_version=subprocess.check_output([hosts['node'],'--version'],text=True).strip(), samples=[])
    offsets = list(range(len(modes)))
    rng.shuffle(offsets)
    if args.out.exists():
        raise FileExistsError(args.out)
    for index in range(args.rounds):
        offset=offsets[index%len(offsets)]
        order=modes[offset:]+modes[:offset]
        if index%2: order=list(reversed(order))
        for label, mode in order:
            busy=wall.active_benchmark_jobs()
            if busy: raise RuntimeError(f'concurrent compiler or profiler: {busy}')
            row=bench.run_sample(str(hosts[label]),label!='node',0,settings,jit_calls=mode=='calls',interpret=mode=='interp',items=args.items)
            if label!='node' and bool(row['jit']['direct-calls'])!=(mode=='calls'):
                raise RuntimeError('incorrect JIT policy')
            print(index+1,label,mode,round(row['sequential_requests_per_s']),round(row['server_cpu_us_per_request'],2),flush=True)
            row.update(round=index+1,host=label,mode=mode)
            data['samples'].append(row)
            tmp=args.out.with_suffix('.tmp')
            tmp.write_text(json.dumps(data,indent=1)+'\n')
            tmp.replace(args.out)

if __name__=='__main__':
    main()
