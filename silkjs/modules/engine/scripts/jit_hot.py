#!/usr/bin/env python3
"""Where compiled code spends its instructions: an instruction-level profile of JIT code.

Runs the JIT shell once under callgrind (--dump-instr=yes) with --jit-dump, maps the executed
instruction addresses onto the code blocks the dump places (`jit: code at <address> <bytes>`,
`jit: osr code at ...`, `jit: optimized code at ...`, `jit: baseline code at ...`) and prints, hottest first, each block's share and its disassembly with
an execution count per instruction. Compiled code lives in an anonymous mapping, so no symbol
tool sees it; the dump is what names it.

    python3 scripts/jit_hot.py bench/v8/deltablue.js                 # --jit --jit-calls
    python3 scripts/jit_hot.py --flags "--jit" --blocks 3 file.js    # three hottest blocks
    python3 scripts/jit_hot.py --summary file.js                     # one line per block

The shell is $SILKJS_JIT or this host's release build of silkjs-jit-shell. Needs valgrind and
objdump (or llvm-objdump as $OBJDUMP).
"""
import argparse
import bisect
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import toolchain  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


def default_shell():
    return toolchain.release_dir() / "silkjs-jit-shell"


def parse_costs(path):
    """Ir per instruction address, over the whole profile."""
    costs = {}
    last = 0
    skip = False
    with open(path, errors="replace") as lines:
        for line in lines:
            first = line[:1]
            if line.startswith("calls="):
                skip = True  # the next line is the call's inclusive cost, not the instruction's own
                continue
            if not (first.isdigit() or first in "+-*"):
                continue
            parts = line.split()
            if len(parts) < 3:
                continue
            where = parts[0]
            if where == "*":
                address = last
            elif where[0] in "+-":
                address = last + int(where, 16) if where[0] == "+" else last - int(where[1:], 16)
            else:
                address = int(where, 16)
            last = address
            if skip:
                skip = False
                continue
            costs[address] = costs.get(address, 0) + int(parts[2])
    return costs


def parse_dump(path):
    """The code blocks of a --jit-dump: (address, bytes, kind, bytecode, ssa lines)."""
    blocks = []
    bytecode = ""
    ssa = []
    in_ssa = False
    with open(path, errors="replace") as lines:
        for line in lines:
            if line.startswith("jit: hot "):
                bytecode = line.split(" code ", 1)[1].strip() if " code " in line else ""
            if line.startswith("jit: optimized ssa"):
                ssa = []
                in_ssa = True
                continue
            if in_ssa:
                if line.startswith("jit:"):
                    in_ssa = False
                else:
                    ssa.append(line.rstrip("\n"))
                    continue
            match = re.match(r"jit: (osr |optimized |baseline )?code at (\d+) ([0-9a-f]+)", line)
            if match:
                kind = {"osr ": "osr", "optimized ": "optimized", "baseline ": "baseline"}.get(match.group(1), "entry")
                blocks.append({"address": int(match.group(2)), "bytes": bytes.fromhex(match.group(3)),
                               "kind": kind, "bytecode": bytecode, "ssa": list(ssa)})
    order = sorted(range(len(blocks)), key=lambda i: blocks[i]["address"])
    for a, b in zip(order, order[1:]):
        gap = blocks[b]["address"] - blocks[a]["address"]
        if 0 < gap < len(blocks[a]["bytes"]):
            blocks[a]["bytes"] = blocks[a]["bytes"][:gap]
    return blocks


def sweep(block, start):
    """(address, text) per instruction of block from address start on, by linear sweep."""
    with tempfile.NamedTemporaryFile(suffix=".bin", delete=False) as out:
        out.write(block["bytes"][start - block["address"]:])
        name = out.name
    tool = os.environ.get("OBJDUMP", "objdump")
    listing = subprocess.run([tool, "-D", "-b", "binary", "-m", "i386:x86-64", "-M", "intel", "--no-show-raw-insn",
                              "--adjust-vma=%d" % start, name], capture_output=True, text=True).stdout
    os.unlink(name)
    result = []
    for line in listing.splitlines():
        match = re.match(r"\s*([0-9a-f]+):\s+(.*)", line)
        if match:
            result.append((int(match.group(1), 16), match.group(2).strip()))
    return result


def disassemble(block, costs):
    """(address, text) per executed instruction of block. A linear sweep loses its place after
    data in the code (constants, exit records), so each run of executed addresses is swept from
    its own first instruction, which is a real instruction start."""
    found = {}
    executed = sorted(a for a in costs if block["address"] <= a < block["address"] + len(block["bytes"]))
    for start in executed:
        if start in found:
            continue
        for address, text in sweep(block, start):
            if address not in costs or address in found:
                break
            found[address] = text
    return sorted(found.items())


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("script")
    parser.add_argument("--flags", default="--jit --jit-calls", help="JIT flags (default: --jit --jit-calls)")
    parser.add_argument("--blocks", type=int, default=5, help="blocks to list in full (default 5)")
    parser.add_argument("--summary", action="store_true", help="one line per block, no listings")
    parser.add_argument("--min", type=int, default=1, help="hide listed instructions executed fewer times")
    parser.add_argument("--ssa", action="store_true", help="print each listed block's SSA too")
    parser.add_argument("--keep", help="directory to keep the callgrind file and the dump in")
    parser.add_argument("--reuse", action="store_true", help="with --keep: list from the files of an earlier run there")
    args = parser.parse_args()
    shell = os.environ.get("SILKJS_JIT") or str(default_shell())
    work = args.keep or tempfile.mkdtemp(prefix="jit-hot-")
    os.makedirs(work, exist_ok=True)
    profile = os.path.join(work, "callgrind.out")
    dump = os.path.join(work, "dump.txt")
    command = ["valgrind", "--tool=callgrind", "--dump-instr=yes", "--compress-pos=no", "--callgrind-out-file=" + profile, shell] + args.flags.split() + ["--jit-dump", args.script]
    if not (args.reuse and os.path.exists(profile) and os.path.exists(dump)):
        with open(dump, "w") as err:
            ran = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=err)
        if ran.returncode != 0:
            sys.exit("the shell failed under callgrind: see " + dump)
    costs = parse_costs(profile)
    blocks = parse_dump(dump)
    if not blocks:
        sys.exit("no `jit: code at` lines in the dump: is the shell built from a tree that prints them?")
    total = sum(costs.values())
    addresses = sorted(costs)
    for block in blocks:
        low = bisect.bisect_left(addresses, block["address"])
        high = bisect.bisect_left(addresses, block["address"] + len(block["bytes"]))
        block["ir"] = sum(costs[a] for a in addresses[low:high])
    # A later block can reuse a freed range: only the last one placed at an address keeps its cost.
    seen = set()
    for block in reversed(blocks):
        if block["address"] in seen:
            block["ir"] = 0
        seen.add(block["address"])
    compiled = sum(block["ir"] for block in blocks)
    print("total %.1fM instructions, %.1fM (%.1f%%) in %d blocks of compiled code" % (total / 1e6, compiled / 1e6, 100.0 * compiled / max(total, 1), len(blocks)))
    ranked = sorted(blocks, key=lambda b: -b["ir"])
    for index, block in enumerate(ranked):
        if block["ir"] == 0:
            break
        listing = disassemble(block, costs) if (index < args.blocks and not args.summary) else []
        entries = costs.get(block["address"], 0)
        per = block["ir"] / entries if entries else 0
        print("%8.2fM %5.1f%%  %-5s %5d bytes  entered %d times, %.0f per entry  bytecode %s" % (
            block["ir"] / 1e6, 100.0 * block["ir"] / max(compiled, 1), block["kind"], len(block["bytes"]), entries, per, block["bytecode"][:60]))
        if not listing:
            continue
        if args.ssa:
            for line in block["ssa"]:
                print("        | " + line)
        for address, text in listing:
            count = costs.get(address, 0)
            if count >= args.min:
                print("  %10d  %5x: %s" % (count, address - block["address"], text))
        print()


if __name__ == "__main__":
    main()
