#!/usr/bin/env python3
"""Attribute inclusive JSON parser entry/child costs in an instruction-address Callgrind dump."""
import argparse
from collections import Counter
import json
from pathlib import Path
import re

PATHS = (
    ('js_json_intrinsics.silk::dispatch', 'js_json_intrinsics_parse.silk::parse'),
    ('js_json_parse.silk::parseValue', 'js_json_parse.silk::.advanceKey'),
    ('js_json_parse.silk::.advanceKey', 'js_atoms.silk::AtomTable.findAscii'),
    ('js_json_parse.silk::.advanceKey', 'js_atoms.silk::AtomTable.findAsciiWithHash'),
    ('js_json_parse.silk::parseValue', 'js_shapes.silk::addProperty'),
    ('js_json_parse.silk::.lexToken', 'js_lexer_numbers.silk::scanJsonNumber'),
    ('js_lexer_numbers.silk::scanJsonNumber', 'dtoa.silk::Dtoa.parse'),
)


def selected_edges(host, dump):
    symbol = {}
    for line in Path(str(host) + '.symbols').read_text().splitlines():
        elf, _, qualified = line.split('\t',2)
        symbol[elf] = qualified.split(':',1)[-1]
    names = {}
    caller = callee = ''
    pending_calls = None
    counts = Counter()
    costs = Counter()
    for line in dump.read_text().splitlines():
        if line.startswith('summary:'):
            total = int(line.split()[1])
        elif line.startswith(('fn=', 'cfn=')):
            field, value = line.split('=',1)
            ref = re.fullmatch(r'\((\d+)\)(?: (.*))?', value)
            if ref:
                index, name = ref.groups()
                if name is not None:
                    names[index] = name
                value = names[index]
            value = symbol.get(value.split("'")[0].split('.llvm.')[0], value)
            if field == 'fn':
                caller = value
            else:
                callee = value
        elif line.startswith('calls='):
            pending_calls = int(line[6:].split()[0])
        elif pending_calls is not None and line.startswith(('0x','+','-','*')):
            edge = (caller, callee)
            if edge in PATHS:
                counts[edge] += pending_calls
                costs[edge] += int(line.split()[-1])
            pending_calls = None
    orders = counts[PATHS[0]]
    if orders != 400:
        raise ValueError(f'expected 400 JSON.parse dispatches, observed {orders}')
    return {f'{a} -> {b}': {'calls':counts[a,b], 'inclusive_ir':costs[a,b],
                             'ir_per_order':costs[a,b] / orders, 'percent_of_server':costs[a,b] * 100 / total}
            for a,b in PATHS}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('host', type=Path)
    parser.add_argument('dump', type=Path)
    args = parser.parse_args()
    print(json.dumps(selected_edges(args.host,args.dump),indent=2))
