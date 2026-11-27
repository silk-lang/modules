"""Interleave equal blocks of checked HTTP requests on two warmed servers on the same core."""
import argparse
from contextlib import contextmanager, ExitStack
import http.client
import json
import os
from pathlib import Path
import re
import select
import signal
import statistics
import subprocess
import sys
import tempfile
import time

@contextmanager
def server(bench, exe, mode, cpu):
    calls = mode == 'calls'
    prefix = ['taskset', '-c', str(cpu), str(exe)]
    if calls:
        prefix.append('--jit-calls')
    elif mode == 'interp':
        prefix.append('--no-jit')
    env = {k:v for k,v in os.environ.items() if k not in ('NODE_OPTIONS','BUN_OPTIONS')}
    env['SILKJS_PREPARSE_THREADS'] = '0'
    with tempfile.TemporaryFile() as log:
        proc = subprocess.Popen([*prefix, str(bench.FIXTURE)], stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True)
        conn = None
        try:
            if not select.select([proc.stdout], [], [], 30)[0]: raise TimeoutError('server startup')
            ready = re.fullmatch(rb'ready (\d+)\n', proc.stdout.readline())
            if not ready or os.sched_getaffinity(proc.pid)!={cpu}: raise RuntimeError('server port or affinity')
            conn=http.client.HTTPConnection('127.0.0.1',int(ready[1]),timeout=15)
            conn.connect()
            original = conn.sock
            cases = bench.cases()
            def orders(n):
                for i in range(n):
                    bench.post(conn,'/order',*cases[i % len(cases)])
                    if conn.sock is not original: raise RuntimeError('connection changed')
            counters = {}
            def stop():
                bench.post(conn,'/stop',b'',b'stopped')
                conn.close()
            yield orders, ((~proc.pid)<<3)|2, counters, stop
            proc.communicate(timeout=15)
            if proc.returncode: raise RuntimeError(f'unexpected shutdown {proc.returncode}')
            log.seek(0)
            counters.update(bench.jit_counters(log.read().decode(), interpret=mode=='interp'))
            if bool(counters['direct-calls'])!=calls: raise RuntimeError('unexpected call policy')
        finally:
            if conn: conn.close()
            if proc.poll() is None:
                os.killpg(proc.pid,signal.SIGKILL)
                proc.wait()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo',type=Path,required=True)
    parser.add_argument('--base',type=Path,required=True)
    parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--out',type=Path,required=True)
    parser.add_argument('--orders',type=int,default=1000)
    parser.add_argument('--blocks',type=int,default=8)
    parser.add_argument('--rounds',type=int,default=4)
    parser.add_argument('--server-cpu',type=int,default=0)
    parser.add_argument('--client-cpu',type=int,default=4)
    args=parser.parse_args()
    if min(args.orders,args.rounds,args.blocks)<1 or args.blocks%2 or args.client_cpu==args.server_cpu:
        parser.error('positive counts, even number of blocks and distinct CPUs required')
    sys.path.insert(0,str(args.repo.resolve()/'modules/runtime/bench'))
    import jit_http as bench
    os.sched_setaffinity(0,{args.client_cpu})
    if bench.compiler_running(): raise RuntimeError('compiler active')
    paths = [args.base.resolve(strict=True), args.candidate.resolve(strict=True)]
    result = dict(hosts_sha256=[bench.sha256(p) for p in paths], fixture_sha256=bench.sha256(bench.FIXTURE),
                  client_sha256=bench.sha256(bench.__file__), driver_sha256=bench.sha256(__file__),
                  warm_orders_per_server=4800, orders_per_block=args.orders, blocks=args.blocks,
                  rounds=args.rounds, items=64, server_cpu=args.server_cpu, client_cpu=args.client_cpu, pairs=[])
    if args.out.exists(): raise FileExistsError(args.out)
    # A/A controls use independent baseline processes. Alternate launch, warmup and measured order.
    for rnd in range(args.rounds+1):
        modes = ['default','calls','interp']
        for offset in range(len(modes)):
            mode = modes[(rnd + offset) % len(modes)]
            aa=rnd==0
            first=(rnd+offset)%2
            label='A/A' if aa else 'A/B'
            with ExitStack() as stack:
                handles={}
                for side in [first,1-first]:
                    handles[side]=stack.enter_context(server(bench, paths[0 if aa else side], mode, args.server_cpu))
                for w in range(4):
                    start=(first+w)%2
                    for side in [start,1-start]:
                        handles[side][0](1200)
                blocks=[]
                for i in range(args.blocks):
                    start=(first+i)%2
                    measurements={}
                    for side in [start,1-start]:
                        orders,clock,_,_=handles[side]
                        before=time.clock_gettime_ns(clock)
                        wall=time.perf_counter_ns()
                        orders(args.orders)
                        elapsed=time.perf_counter_ns()-wall
                        cpu=time.clock_gettime_ns(clock)-before
                        measurements[side]=dict(cpu_us_per_order=cpu/(1000*args.orders), orders_per_s=args.orders*1e9/elapsed)
                    blocks.append(dict(first=start, sides=[measurements[0],measurements[1]]))
                for side in [first,1-first]:
                    handles[side][3]()
            row=dict(round=rnd, kind=label, mode=mode, blocks=blocks,jit=[handles[i][2] for i in (0,1)])
            result['pairs'].append(row)
            tmp=args.out.with_suffix('.tmp')
            tmp.write_text(json.dumps(result,indent=1)+'\n')
            tmp.replace(args.out)
            ratios=[b['sides'][1]['cpu_us_per_order']/b['sides'][0]['cpu_us_per_order'] for b in blocks]
            print(label,rnd,mode,round(100*(statistics.median(ratios)-1),2),flush=True)
if __name__=='__main__':
    main()
