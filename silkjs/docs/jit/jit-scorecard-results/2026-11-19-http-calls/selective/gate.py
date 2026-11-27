"""LLDB callbacks for the pinned x86_64 release's Jit and FunctionBytecode layouts."""
import json
from pathlib import Path
import struct

import lldb

OUT = Path(__file__).resolve().parent
CONFIG = json.loads((OUT / 'config.json').read_text())
NAMED = {
    'node:events': {'emit'},
    'node:internal/http/native-parser': {'event', 'callback'},
    'node:_http_common': {'parserOnHeadersComplete', 'parserOnBody', 'parserOnMessageComplete'},
    'node:_http_server': {'parserOnIncoming'},
}
# Byte offsets and lengths in the debug source. The embedded native-parser wrapper
# adds 47 bytes before the checked-in module. The application is unwrapped.
PARSER = {(1429, 27): 'call0', (1472, 33): 'call1', (1767, 94): 'callRequestHead',
          (6488, 70): 'event arrow'}
APP = {(219, 466): 'request listener', (440, 27): 'data listener',
       (490, 191): 'end listener', (43, 146): 'totalCents'}
jit = None


def read(process, address, length):
    error = lldb.SBError()
    data = process.ReadMemory(address, length, error)
    if not error.Success() or len(data) != length:
        raise RuntimeError((hex(address), length, error.GetCString()))
    return data


def uint(process, address, size=8):
    return int.from_bytes(read(process, address, size), 'little')


def flag(process, address, value):
    error = lldb.SBError()
    written = process.WriteMemory(address, bytes([value]), error)
    assert written == 1 and error.Success() and uint(process, address, 1) == value


def atom(process, registry, index):
    if not index:
        return ''
    assert index < uint(process, registry + 40)
    table = uint(process, registry + 8)
    cell = uint(process, table + index * 16 + 8)
    length = uint(process, cell + 16, 4)
    assert uint(process, cell + 20, 4) == index and length < 65536
    wide = uint(process, cell + 36, 1)
    compact = uint(process, cell + 39, 1)
    ptr = cell + 40 if compact else uint(process, cell + (80 if wide else 40))
    return read(process, ptr, length * (1 + wide)).decode('utf-16-le' if wide else 'latin1')


def tap(frame, breakpoint, internal_dict):
    global jit
    process = frame.thread.process
    rt, bc, jit = [frame.FindRegister(reg).GetValueAsUnsigned() for reg in ('rdi', 'rsi', 'rdx')]
    offset = (OUT / 'server.err').stat().st_size
    record = dict(offset=offset, bytecode=hex(bc))
    try:
        registry = uint(process, rt + 40)
        function = bc + 8
        debug = function + 0xa0
        module = atom(process, registry, uint(process, debug + 8, 4))
        name = atom(process, registry, uint(process, function + 0x7c, 4))
        span = struct.unpack('<QQ', read(process, debug + 8 + 0x18 + 32, 16))
        label = name if name in NAMED.get(module, ()) else ''
        if module == 'node:internal/http/native-parser' and not name:
            label = PARSER.get(span, '')
        if module == CONFIG['fixture_uri']:
            label = APP.get(span, '')
        enabled = CONFIG['mode'] == 'calls' or (CONFIG['mode'] == 'selective' and bool(label))
        record.update(file=module, name=name, span=span, label=label, calls=int(enabled),
                      compiled_slot=uint(process, function + 0x1c, 4), entries_before=uint(process, jit + 0x58),
                      before=uint(process, jit + 0x13, 1))
        flag(process, jit + 0x11, int(not (OUT / 'start-ready').exists()))
        flag(process, jit + 0x13, int(enabled))
    except Exception as exc:
        record['error'] = repr(exc)
    with (OUT / 'events.jsonl').open('a') as log:
        log.write(json.dumps(record) + '\n')
    return 'error' in record


def snapshot(process, name):
    ptr, _, _, _, count = struct.unpack('<5Q', read(process, jit + 0x38, 40))
    assert 0 < count <= 4096
    table = read(process, ptr, count * 0xa0)
    rows = []
    for index in range(count):
        start = index * 0xa0
        runs, deopts = struct.unpack_from('<QQ', table, start + 0x28)
        osr_runs, osr_deopts = struct.unpack_from('<QQ', table, start + 0x88)
        rows.append(dict(index=index, code=struct.unpack_from('<Q', table, start)[0],
                         runs=runs, deopts=deopts, osrRuns=osr_runs, osrDeopts=osr_deopts))
    (OUT / (name + '.json')).write_text(json.dumps(rows))


def boundary(debugger, name):
    process = debugger.GetSelectedTarget().GetProcess()
    snapshot(process, name)
    flag(process, jit + 0x11, 0)
    (OUT / (name + '-ready')).write_text(str(process.GetSelectedThread().GetStopDescription(1024)))


def finish(frame, breakpoint, internal_dict):
    snapshot(frame.thread.process, 'entries')
    return False
