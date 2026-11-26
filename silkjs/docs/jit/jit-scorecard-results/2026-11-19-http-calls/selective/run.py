#!/usr/bin/env python3
"""Run the three matched 4,800 + 400-order LLDB/Callgrind captures."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
BENCH = HERE.parents[4] / 'modules/runtime/bench'
sys.path.insert(0, str(BENCH))
import jit_http

HOST_SHA = '4598cbc914306531c7d7423f9d34e3ba17e46ae98bd23df7144d8a667da6a07e'
FIXTURE_SHA = '1373b8aa52f87d5de625265a2030aaf50a81bc794b67a76df44d1382e4ac287b'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def wait_for(condition, processes, timeout=120):
    deadline = time.monotonic() + timeout
    while not condition():
        if any(p.poll() is not None for p in processes):
            raise RuntimeError('a guest, LLDB or vgdb process exited early')
        if time.monotonic() > deadline:
            raise TimeoutError('waiting for debugger or guest')
        time.sleep(.03)


def commands(out, host, port):
    return [
        'settings set target.disable-aslr false', f'target create "{host}"', f'gdb-remote 127.0.0.1:{port}',
        'process handle SIGUSR2 -s true -p false -n true', f'command script import "{out / "gate.py"}"',
        'breakpoint set --address 0x16aa930', 'breakpoint command add -F gate.tap 1',
        'breakpoint set --address 0x1810dc0', 'breakpoint command add -F gate.finish 2', 'continue',
        'process plugin packet monitor instrumentation on', 'process plugin packet monitor zero',
        'script gate.boundary(lldb.debugger,"start")', 'continue',
        'process plugin packet monitor dump measured_orders', 'process plugin packet monitor instrumentation off',
        'script gate.boundary(lldb.debugger,"stop")', 'continue', 'quit',
    ]


def capture(args, mode):
    out = args.out / mode
    out.mkdir(parents=True)
    config = dict(mode=mode, fixture_uri=jit_http.FIXTURE.as_uri())
    (out / 'config.json').write_text(json.dumps(config))
    shutil.copy(HERE / 'gate.py', out)
    guest = [args.valgrind, '--log-file=' + str(out / 'vg'), '--tool=callgrind', '--instr-atstart=no',
             '--vgdb-error=0', '--callgrind-out-file=' + str(out / 'profile'), str(args.host)]
    if mode == 'calls':
        guest.append('--jit-calls')
    guest.append(str(jit_http.FIXTURE))
    env = dict(os.environ, SILKJS_PREPARSE_THREADS='0')
    procs = []
    connection = None
    try:
        with (out / 'server.out').open('w') as stdout, (out / 'server.err').open('w') as stderr, \
                (out / 'relay').open('w') as relay_log, (out / 'debug').open('w') as debug_log:
            server = subprocess.Popen(guest, stdout=stdout, stderr=stderr, env=env)
            procs.append(server)
            with socket.socket() as sock:
                sock.bind(('127.0.0.1', 0))
                port = sock.getsockname()[1]
            relay = subprocess.Popen([args.vgdb, '--wait=15', f'--pid={server.pid}', f'--port={port}'],
                                     stdout=relay_log, stderr=relay_log)
            procs.append(relay)
            wait_for(lambda: 'listening' in (out / 'relay').read_text().lower(), procs)
            cmd = out / 'commands'
            cmd.write_text('\n'.join(commands(out, args.host, port)) + '\n')
            debug_env = dict(os.environ)
            for key in ('PYTHONHOME', 'LD_LIBRARY_PATH'):
                if 'LLDB_' + key in os.environ:
                    debug_env[key] = os.environ['LLDB_' + key]
            lldb = subprocess.Popen([args.lldb, '-b', '-s', str(cmd)], stdout=debug_log, stderr=debug_log, env=debug_env)
            procs.append(lldb)
            ready = re.compile(r'ready (\d+)')
            wait_for(lambda: ready.search((out / 'server.out').read_text()), procs)
            port = int(ready.search((out / 'server.out').read_text())[1])
            connection = http.client.HTTPConnection('127.0.0.1', port, timeout=120)
            cases = jit_http.cases(64)
            keepalive = None
            counts = []
            for requests, marker in [(4800, 'start'), (400, 'stop')]:
                for i in range(requests):
                    jit_http.post(connection, '/order', *cases[i % 4])
                    if keepalive is None:
                        keepalive = connection.sock
                    assert keepalive is not None and keepalive is connection.sock
                counts.append(len((out / 'events.jsonl').read_text().splitlines()))
                os.kill(server.pid, signal.SIGUSR2)
                wait_for(lambda: (out / (marker + '-ready')).exists(), procs)
            jit_http.post(connection, '/stop', b'', b'stopped')
            assert server.wait(timeout=60) == 0 and lldb.wait(timeout=60) == 0
        log = (out / 'debug').read_text()
        assert log.count('stop reason = signal SIGUSR2') == 2 and 'Traceback' not in log
        [dump] = [p for p in out.glob('profile.*') if 'Trigger: dump measured_orders' in p.read_text()[:3000]]
        ir = int(re.search(r'^summary: (\d+)$', dump.read_text(), re.M)[1])
        assert ir > 1_000_000 and (out / 'entries.json').is_file()
        checked = dict(mode=mode, ir=ir, warm=4800, measured=400, total=5200, profile=dump.name,
                       events_at_warm=counts[0], events_at_end=counts[1])
        (out / 'verified.json').write_text(json.dumps(checked))
        print(mode, ir / 400, 'Ir/order', flush=True)
    finally:
        if connection is not None:
            connection.close()
        for p in reversed(procs):
            if p.poll() is None:
                p.kill()
                p.wait()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--host', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    for tool in ('valgrind', 'vgdb', 'lldb'):
        parser.add_argument('--' + tool, default=tool)
    args = parser.parse_args()
    args.out = args.out.resolve()
    args.host = args.host.resolve(strict=True)
    if sha(args.host) != HOST_SHA or sha(jit_http.FIXTURE) != FIXTURE_SHA:
        parser.error('the guest binary and fixture must match the measured hashes')
    args.out.mkdir(parents=True)
    for mode in ('selective', 'default', 'calls'):
        capture(args, mode)
