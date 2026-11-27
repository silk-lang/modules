"""Count executed bytecode jump-table branches in x86_64 non-PIE release Callgrind dumps."""
from collections import Counter
import json
from pathlib import Path
import re
import struct
import subprocess
import sys

# Use the specific binary that generated each dump. LLVM clones the dispatch within a loop.
def dispatch_sites(host):
    sections = subprocess.check_output(["objdump", "-h", host], text=True)
    start, off = re.search(r"\s\.rodata\s+[0-9a-f]+\s+([0-9a-f]+)\s+[0-9a-f]+\s+([0-9a-f]+)", sections).groups()
    slide = int(start, 16) - int(off, 16)
    symbols = Path(str(host) + ".symbols").read_text().splitlines()
    sizes = {}
    for line in subprocess.check_output(["nm", "-S", host], text=True).splitlines():
        fields = line.split()
        if len(fields) == 4:
            sizes[fields[3]] = (int(fields[0], 16), int(fields[1], 16))
    desc = {}
    with host.open("rb") as elf:
        for line in symbols:
            symbol, _, name = line.split("\t", 2)
            if name.split(":", 1)[-1] not in {"js_vm.silk::executeLoop", "js_vm_leaf.silk::evaluate"}:
                continue
            disasm = subprocess.check_output(["objdump", "-d", "--no-show-raw-insn", "--disassemble=" + symbol, host], text=True)
            jumps = re.findall(r"^\s*([0-9a-f]+):\s+jmp\s+\*(0x[0-9a-f]+)\(,%\w+,8\)", disasm, re.M)
            base, size = sizes[symbol]
            matches = []
            for table in set(t for _, t in jumps):
                elf.seek(int(table, 16) - slide)
                targets = struct.unpack("<256Q", elf.read(256 * 8))
                if all(base <= t < base + size for t in targets) and len(set(targets)) > 100:
                    matches.append(table)
            # Nearby small jump tables can form a 256-word window into the same
            # function. The opcode table is the one referenced at multiple dispatch sites.
            counts = Counter(t for _, t in jumps)
            matches = [t for t in matches if counts[t] >= 2]
            if len(matches) != 1:
                raise ValueError((name, symbol, matches))
            sites = {int(pc, 16) for pc, t in jumps if t == matches[0]}
            desc[symbol] = (name.rsplit("::", 1)[-1], sites)
    return desc

def count(profile, desc):
    names = {}
    cost = Counter()
    symbol = ""
    address = 0
    edge = False
    for line in profile.open():
        if line.startswith(("fn=", "cfn=")):
            ref = re.fullmatch(r"(c?fn)=\((\d+)\)(?: (.*))?\n", line)
            k, ident, name = ref.groups()
            if name:
                names[ident] = name
            if k == "fn":
                symbol = names[ident].partition("'")[0].partition(".llvm.")[0]
        elif line.startswith("calls="):
            edge = True
        elif line.startswith(("0x","*","+","-")):
            pc, _, ir = line.split()
            if pc.startswith("0x"):
                address = int(pc, 16)
            elif pc != "*":
                address += int(pc)
            if not edge and symbol in desc:
                name, sites = desc[symbol]
                if address in sites:
                    cost[name] += int(ir)
            edge = False
    if not cost["executeLoop"] or not cost["evaluate"]:
        raise ValueError("missing dispatch counts")
    return cost

if __name__ == "__main__":
    sites = dispatch_sites(Path(sys.argv[1]))
    print(json.dumps({p: count(Path(p), sites) for p in sys.argv[2:]}, indent=2))
