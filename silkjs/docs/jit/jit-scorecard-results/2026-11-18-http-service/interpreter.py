#!/usr/bin/env python3
"""Profile 400 verified orders with the embeddable host's JIT disabled."""
import argparse
import http.client
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
from json_edges import selected_edges

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT/'modules/runtime/bench'))
import jit_http as bench


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', type=Path, required=True)
    parser.add_argument('--host-sha', required=True)
    parser.add_argument('--source', required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--items', type=int, choices=(4,64), default=64)
    args = parser.parse_args()
    host = args.host.resolve(strict=True)
    if bench.sha256(host) != args.host_sha:
        parser.error('unexpected host SHA256')
    out = args.out.resolve()
    out.mkdir()
    command = ['valgrind','--tool=callgrind','--instr-atstart=no','--dump-instr=yes',
               '--smc-check=all-non-file','--callgrind-out-file='+str(out/'profile.%p'),
               str(host),'--no-jit',str(bench.FIXTURE)]
    env = {k:v for k,v in os.environ.items() if k not in ('BUN_OPTIONS','NODE_OPTIONS','SILKJS_BENCH_ABLATE_STRICT_EQUALITY')}
    env['SILKJS_PREPARSE_THREADS']='0'
    with (out/'server.log').open('w+') as log:
        child = subprocess.Popen(command,env=env,stdout=subprocess.PIPE,stderr=log,start_new_session=True)
        connection = None
        def control(*flags):
            result = subprocess.run(['callgrind_control',*flags,str(child.pid)],env=env,
                                    check=True,capture_output=True,text=True,timeout=45)
            if 'PID ' not in result.stdout or 'ERROR' in result.stdout:
                raise RuntimeError(result.stdout)
        try:
            if not select.select([child.stdout],[],[],120)[0]:
                raise TimeoutError('server did not start under Callgrind')
            ready = re.fullmatch(rb'ready (\d+)\n',child.stdout.readline())
            if not ready:
                raise ValueError('server produced no port')
            connection = http.client.HTTPConnection('127.0.0.1',int(ready[1]),timeout=45)
            connection.connect()
            socket = connection.sock
            payloads = bench.cases(args.items)
            def orders(n):
                for i in range(n):
                    bench.post(connection,'/order',*payloads[i % len(payloads)])
                    if connection.sock is not socket:
                        raise ValueError('persistent connection closed')
            orders(1200)
            control('-i','on')
            control('-z')
            orders(400)
            control('--dump=400_orders')
            control('-i','off')
            bench.post(connection,'/stop',b'',b'stopped')
            connection.close()
            child.communicate(timeout=45)
            if child.returncode:
                raise ValueError(f'server status {child.returncode}')
            log.seek(0)
            counters = bench.jit_counters(log.read(),interpret=True)
            if any(counters.values()):
                raise ValueError('JIT counters changed with --no-jit')
        finally:
            if connection:
                connection.close()
            if child.poll() is None:
                try:
                    os.killpg(child.pid,signal.SIGKILL)
                except ProcessLookupError:
                    pass
            child.communicate()
    dump, = out.glob('profile.*.1')
    total = int(re.search(r'^summary: (\d+)$',dump.read_text(),re.M)[1])
    receipt = dict(command=sys.argv,server_command=command,source=args.source,
                   binary_sha256=args.host_sha,symbols_sha256=bench.sha256(str(host)+'.symbols'),
                   fixture_sha256=bench.sha256(bench.FIXTURE),script_sha256=bench.sha256(__file__),
                   raw_sha256=bench.sha256(dump),warmup=1200,verified=400,keep_alive=True,exit=0,
                   items=args.items,ir=total,ir_per_order=total/400,jit=counters,edges=selected_edges(host,dump))
    (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(args.items, round(total/400), flush=True)


if __name__ == '__main__':
    main()
