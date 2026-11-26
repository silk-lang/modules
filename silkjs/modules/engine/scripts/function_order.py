#!/usr/bin/env python3
"""Regenerate startup.order, the link-time function order of the silkjs CLI.

Runs the CLI on an empty script under callgrind and lists every function it
executes, hottest first. The [native].function-order entry in silk.toml makes
the release link place these functions first, so creating and tearing down a
runtime touches a few contiguous code pages instead of windows spread across
the whole text segment.

Since Silk 0.1.0-dev.88 a release binary names each function by its declaration
(`package:file.silk::Owner.name`) rather than by a hash, and the order lists
declarations as the third column of the binary's .symbols file spells them
(`package@version:file.silk::Owner.name`), so the order holds across compiler
and dependency changes. C exports keep their own names.

Usage: python3 scripts/function_order.py [BINARY]
"""
import os
import re
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEADER = """# Functions the CLI runs to create a runtime and realm and tear them down,
# grouped so startup touches few code pages. Every app that links the engine
# links with this order, so it lists only functions apps have too: none of the
# CLI program's own files or its script loader's. Regenerate with
# python3 scripts/function_order.py after a release build.
"""

# Every build that links the engine reads this order, and the compiler notes each entry the
# build does not have. Functions only the CLI runs are left out, so an app's build has them all.
CLI_ONLY = re.compile(r'^silkjs-engine@[^:]*:((qjs|qjs_launch|qjs_memory|qjs_repl|qjs_benchmark|qjsc[a-z_]*)\.silk::|js_lexer\.silk::\.?detectModule$)')


def main():
    binary = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'build', 'silkjs-engine')
    binary = os.path.abspath(binary)
    declarations = {}
    known = set()
    with open(os.path.splitext(binary)[0] + '.symbols') as symbols:
        for row in symbols:
            columns = row.rstrip('\n').split('\t')
            if len(columns) >= 3:
                known.add(columns[2] if '::' in columns[2] else columns[0])
            if len(columns) >= 3 and '::' in columns[2]:
                package, _, rest = columns[2].partition(':')
                declarations[package.split('@')[0] + ':' + rest] = columns[2]
    with tempfile.TemporaryDirectory() as scratch:
        script = os.path.join(scratch, 'empty.js')
        profile = os.path.join(scratch, 'callgrind.out')
        open(script, 'w').close()
        subprocess.run(['valgrind', '--tool=callgrind', '--callgrind-out-file=' + profile, binary, script],
                       check=True, capture_output=True)
        report = subprocess.run(['callgrind_annotate', '--threshold=100', profile],
                                check=True, capture_output=True, text=True).stdout
    names = []
    for line in report.splitlines():
        if not line.rstrip().endswith('[' + binary + ']'):
            continue
        match = re.search(r'\?\?\?:(\S+) \[', line)
        if not match:
            continue
        # A second function of one declaration (an instance, or a copy the compiler made) is
        # named `declaration'2` and is ordered with its declaration. Names the .symbols file
        # does not list (addresses, runtime helpers) cannot be ordered.
        name = re.sub(r"'\d+$", '', match.group(1))
        name = declarations.get(name, name)
        if name in known and name not in names and not CLI_ONLY.match(name):
            names.append(name)
    # Keep silkjs_text_align immediately before executeLoop so executeLoop's
    # main indirect-jump dispatch header lands cleanly on a 64B cache-line
    # boundary instead of straddling a 32B DSB or 64B line boundary.
    execute_loop = declarations.get('silkjs-engine:js_vm.silk::executeLoop')
    pinned = []
    if 'silkjs_text_align' in known and execute_loop and execute_loop in known:
        pinned = ['silkjs_text_align', execute_loop]
        names = pinned + [n for n in names if n not in pinned]
    leaf_eval = declarations.get('silkjs-engine:js_vm_leaf.silk::evaluate')
    if 'silkjs_leaf_align' in known and leaf_eval and leaf_eval in known:
        names = [n for n in names if n not in ('silkjs_leaf_align', leaf_eval)] + ['silkjs_leaf_align', leaf_eval]
    known_call = declarations.get('silkjs-engine:js_vm.silk::enterKnownCall')
    if 'silkjs_hot_align' in known and known_call and known_call in known:
        names = [n for n in names if n not in ('silkjs_hot_align', known_call)] + ['silkjs_hot_align', known_call]
    with open(os.path.join(ROOT, 'startup.order'), 'w') as out:
        out.write(HEADER)
        out.write(''.join(name + '\n' for name in names))
    print('wrote %d functions to startup.order' % len(names))


if __name__ == '__main__':
    main()
