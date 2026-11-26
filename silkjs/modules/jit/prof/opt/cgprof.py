#!/usr/bin/env python3
"""cgprof.py ERR OUT [--all]: callgrind instructions per optimized function.

ERR is the shell's stderr of a run with --jit-dump, OUT the callgrind file of the same run
(valgrind --tool=callgrind --dump-instr=yes). Each `jit: optimizing N` is followed by its
`jit: optimized code at ADDR HEX`; the instructions callgrind counts inside [ADDR, ADDR +
len(HEX) / 2) are that function's own (callees not included). Prints the total, the share in
optimized code and baseline code, then one line per function id: instructions, compiles and
code bytes, most first. --all prints every function, not only the top 30.

--ops FN: instead, the instructions of each SSA instruction of function FN (all its
compiles, joined by the `jit: optimized map` offsets), the 40 most costly, then the totals
per operation.

--asm FN TEXT: the machine code of each SSA instruction of FN whose line contains TEXT,
with the instructions callgrind counted at each address (objdump disassembles it).
"""
import os
import re
import signal
import subprocess
import tempfile
import sys
from bisect import bisect_right


def regions(err, ssa=None):
    """Optimized and baseline code regions; with ssa a dict, ssa[index of the region in opt]
    is (the SSA lines, the map offsets)."""
    opt, base = [], []
    current = None
    lines = None
    offsets = None
    with open(err, errors="replace") as f:
        for line in f:
            if line.startswith("jit: optimizing "):
                current = int(line.split()[2])
            elif line.startswith("jit: optimized ssa"):
                lines = []
            elif line.startswith("jit: optimized map"):
                offsets = [int(x) for x in line.split()[3:]]
                lines_done = lines
                lines = None
            elif lines is not None and line.startswith("  "):
                lines.append(line.strip())
            elif line.startswith("jit: optimized code at "):
                parts = line.split()
                if ssa is not None and offsets is not None:
                    ssa[len(opt)] = (lines_done, offsets, parts[5])
                offsets = None
                opt.append((int(parts[4]), len(parts[5]) // 2, current))
            elif line.startswith("jit: baseline code at "):
                parts = line.split()
                base.append((int(parts[4]), len(parts[5]) // 2, None))
    return opt, base


def costs(out):
    """Self Ir per instruction address (cost lines after `calls=` are inclusive: skipped)."""
    per = {}
    total = 0
    addr = 0
    skip = False
    number = re.compile(r"^(0x[0-9a-fA-F]+|[+-]\d+|\*)\s")
    with open(out, errors="replace") as f:
        for line in f:
            if line.startswith("summary:"):
                total = int(line.split()[1])
                continue
            if line.startswith("calls="):
                skip = True
                continue
            m = number.match(line)
            if not m:
                continue
            tok = m.group(1)
            if tok.startswith("0x"):
                addr = int(tok, 16)
            elif tok != "*":
                addr += int(tok)
            fields = line.split()
            if skip:
                skip = False
                continue
            if len(fields) >= 3:
                per[addr] = per.get(addr, 0) + int(fields[2])
    return per, total


def ops(opt, ssa, per, fn):
    rows = []
    byop = {}
    outside = 0
    for k, (a, n, f) in enumerate(opt):
        if f != fn or k not in ssa:
            continue
        lines, offsets, _ = ssa[k]
        if len(offsets) != len(lines) + 1:
            print(f"compile {k}: {len(lines)} SSA lines, {len(offsets)} offsets: skipped")
            continue
        starts = offsets[:-1]
        cost = [0] * len(lines)
        for addr, ir in per.items():
            if a <= addr < a + n:
                o = addr - a
                i = bisect_right(starts, o) - 1
                if i < 0 or o >= offsets[-1]:
                    outside += ir
                else:
                    cost[i] += ir
        for i, c in enumerate(cost):
            if c:
                rows.append((c, k, lines[i]))
                text = lines[i].split("=", 1)[-1].split()[0] if "=" in lines[i].split("   @")[0] else lines[i].split()[0]
                byop[text] = byop.get(text, 0) + c
    rows.sort(key=lambda r: -r[0])
    total = sum(r[0] for r in rows)
    print(f"fn {fn}: {total:,} in SSA instructions, {outside:,} outside them (prologue, exits, slow paths)")
    for c, k, line in rows[:40]:
        print(f"{c:>12,}  [{k}] {line[:150]}")
    print()
    for op, c in sorted(byop.items(), key=lambda kv: -kv[1])[:25]:
        print(f"{c:>12,}  {op}")


def asm(opt, ssa, per, fn, text):
    for k, (a, n, f) in enumerate(opt):
        if f != fn or k not in ssa:
            continue
        lines, offsets, code = ssa[k]
        if len(offsets) != len(lines) + 1:
            continue
        with tempfile.NamedTemporaryFile(delete=False) as out:
            out.write(bytes.fromhex(code))
            path = out.name
        for i, line in enumerate(lines):
            if text not in line:
                continue
            lo, hi = a + offsets[i], a + offsets[i + 1]
            total = sum(c for x, c in per.items() if lo <= x < hi)
            if total == 0:
                continue
            print(f"[{k}] {line[:140]}  ({total:,})")
            listing = subprocess.run(["objdump", "-D", "-b", "binary", "-m", "i386:x86-64", "--no-show-raw-insn",
                                      f"--adjust-vma={a}", f"--start-address={lo}", f"--stop-address={hi}", path],
                                     capture_output=True, text=True).stdout
            for row in listing.splitlines():
                m = re.match(r"\s*([0-9a-f]+):\s*(.*)", row)
                if m:
                    x = int(m.group(1), 16)
                    print(f"{per.get(x, 0):>12,}  {m.group(2)}")
        os.unlink(path)


def main():
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    ssa = {}
    opt, base = regions(sys.argv[1], ssa)
    per, total = costs(sys.argv[2])
    if "--asm" in sys.argv:
        at = sys.argv.index("--asm")
        asm(opt, ssa, per, int(sys.argv[at + 1]), sys.argv[at + 2])
        return
    if "--ops" in sys.argv:
        ops(opt, ssa, per, int(sys.argv[sys.argv.index("--ops") + 1]))
        return
    spans = sorted(opt + [(a, n, "base") for a, n, _ in base])
    starts = [s[0] for s in spans]
    byfn, compiles, nbytes = {}, {}, {}
    for a, n, fn in opt:
        compiles[fn] = compiles.get(fn, 0) + 1
        nbytes[fn] = nbytes.get(fn, 0) + n
    optimized = baseline = 0
    for addr, ir in per.items():
        i = bisect_right(starts, addr) - 1
        if i < 0:
            continue
        a, n, fn = spans[i]
        if addr >= a + n:
            continue
        if fn == "base":
            baseline += ir
        else:
            optimized += ir
            byfn[fn] = byfn.get(fn, 0) + ir
    print(f"total {total:,}  optimized {optimized:,}  baseline {baseline:,}")
    rows = sorted(byfn.items(), key=lambda kv: -kv[1])
    if "--all" not in sys.argv:
        rows = rows[:30]
    for fn, ir in rows:
        print(f"fn {fn:>4}  {ir:>14,}  compiles {compiles[fn]:>2}  bytes {nbytes[fn]:>8,}")


signal.signal(signal.SIGPIPE, signal.SIG_DFL)
main()
