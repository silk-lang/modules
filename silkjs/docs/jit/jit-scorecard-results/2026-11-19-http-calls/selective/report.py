#!/usr/bin/env python3
"""Verify policy writes and associate installed table entries with their reporting function."""
import argparse
import hashlib
import json
from pathlib import Path
import re


def receipt(out):
    def read(name):
        return json.loads((out / name).read_text())
    checked = read('verified.json')
    mode = checked['mode']
    events = [json.loads(line) for line in (out / 'events.jsonl').read_text().splitlines()]
    log = (out / 'server.err').read_bytes()
    stats = {k: int(v) for k, v in re.findall(r'([a-z][a-z0-9-]*) (\d+)',
             re.search(rb'^jit: reported .+$', log, re.M)[0].decode())}
    assert stats['failed'] == 0
    # compileHot excludes waits, first feedback recordings and OSR-only header reports.
    assert len(events) == stats['reported'] + stats['waited'] + stats['profiled'] + sum(
        bool(e['compiled_slot']) for e in events)
    start, stop, end = [read(name + '.json') for name in ('start', 'stop', 'entries')]
    assert 0 < len(start) <= len(stop) <= len(end)
    for before, after in ((start, stop), (stop, end)):
        assert all(a['index'] == b['index'] and a['code'] == b['code'] for a, b in zip(before, after))
    mapped = []
    targets = {}
    previous_flag = int(mode == 'calls')
    for i, e in enumerate(events):
        assert 'error' not in e and e['before'] == previous_flag
        assert e['calls'] == (mode == 'calls' or (mode == 'selective' and bool(e['label'])))
        previous_flag = e['calls']
        following = events[i + 1] if i + 1 < len(events) else dict(entries_before=len(end), offset=len(log))
        ids = list(range(e['entries_before'], following['entries_before']))
        mapped.extend(ids)
        text = log[e['offset']:following['offset']].decode()
        assert set(map(int, re.findall(r'^jit: compiled entry (\d+)$', text, re.M))) <= set(ids)
        if not e['label']:
            continue
        row = targets.setdefault(e['label'], dict(ids=[], runs=0, osr_runs=0, deopts=0, refused=[]))
        row['ids'].extend(ids)
        for index in ids:
            lo = start[index] if index < len(start) else {}
            hi = stop[index] if index < len(stop) else {}
            for name, key in [('runs', 'runs'), ('osr_runs', 'osrRuns'), ('deopts', 'deopts'), ('deopts', 'osrDeopts')]:
                row[name] += hi.get(key, 0) - lo.get(key, 0)
        row['refused'].extend(re.findall(r'^jit: (?:osr )?refused: ([^\n]+)', text, re.M))
    assert mapped == list(range(len(end)))
    profile = (out / checked['profile']).read_bytes()
    ir = int(re.search(rb'^summary: (\d+)$', profile, re.M)[1])
    assert ir == checked['ir'] and checked['warm'] == 4800 and checked['measured'] == 400
    # Nonrecursive compile hook. Sum every instruction in its body and all its outgoing edges.
    names = dict((int(i), n) for i, n in re.findall(rb'^(?:c?fn)=\((\d+)\) (.+)$', profile, re.M))
    in_hook = False
    compile_ir = 0
    for line in profile.splitlines():
        if line.startswith(b'fn='):
            in_hook = names[int(re.match(rb'fn=\((\d+)\)', line)[1])] == b'jitHotFunction'
        elif in_hook and re.fullmatch(rb'\d+ \d+', line):
            compile_ir += int(line.split()[1])
    return dict(ir=ir, ir_per_order=ir / 400, compile_hook_inclusive_ir=compile_ir,
                dump_sha256=hashlib.sha256(profile).hexdigest(), enabled_reports=sum(e['calls'] for e in events),
                reports=len(events), window_reports=checked['events_at_end'] - checked['events_at_warm'],
                entries_before=len(start), entries_after=len(stop), targets=targets)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('captures', type=Path)
    args = parser.parse_args()
    print(json.dumps({mode: receipt(args.captures / mode) for mode in ('default', 'selective', 'calls')}, indent=2))
