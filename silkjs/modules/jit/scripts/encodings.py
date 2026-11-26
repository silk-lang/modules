#!/usr/bin/env python3
"""Generate src/asm_x64_fixtures.silk: every encoder form beside the bytes LLVM assembles.

Each case pairs one `Assembler` call with the Intel-syntax instruction it must encode. llvm-mc
assembles the instructions and its bytes become the expectation, so the encoder is checked against
a real assembler and the checked-in tests need no LLVM to run.

    python3 modules/jit/scripts/encodings.py           # rewrite the fixtures
    python3 modules/jit/scripts/encodings.py --check   # exit 1 if the checked-in file is stale

llvm-mc is $LLVM_MC, else the one beside $SILK_CLANG, else `llvm-mc` on PATH.
"""
from __future__ import annotations

import itertools
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "src/asm_x64_fixtures.silk"

REG = ["Rax", "Rcx", "Rdx", "Rbx", "Rsp", "Rbp", "Rsi", "Rdi",
       "R8", "R9", "R10", "R11", "R12", "R13", "R14", "R15"]
NAME64 = ["rax", "rcx", "rdx", "rbx", "rsp", "rbp", "rsi", "rdi"] + [f"r{n}" for n in range(8, 16)]
NAME32 = ["eax", "ecx", "edx", "ebx", "esp", "ebp", "esi", "edi"] + [f"r{n}d" for n in range(8, 16)]
NAME16 = ["ax", "cx", "dx", "bx", "sp", "bp", "si", "di"] + [f"r{n}w" for n in range(8, 16)]
NAME8 = ["al", "cl", "dl", "bl", "spl", "bpl", "sil", "dil"] + [f"r{n}b" for n in range(8, 16)]
ALL = list(range(16))
# Registers whose encodings differ in kind: rsp/r12 force a SIB byte as a base, rbp/r13 force a
# displacement, r8 and up set REX bits, and 4-7 need REX to mean spl/bpl/sil/dil as bytes.
EDGE = [0, 3, 4, 5, 6, 8, 12, 13, 15]
WIDTHS = [("W64", NAME64, "qword"), ("W32", NAME32, "dword")]
ALU = ["Add", "Or", "Adc", "Sbb", "And", "Sub", "Xor", "Cmp"]
SHIFTS = ["Rol", "Ror", "Shl", "Shr", "Sar"]
UNARY = ["Not", "Neg", "Mul", "Imul", "Div", "Idiv"]
SCALAR = [("Sqrt", "sqrtsd"), ("Add", "addsd"), ("Mul", "mulsd"), ("Sub", "subsd"),
          ("Min", "minsd"), ("Div", "divsd"), ("Max", "maxsd")]
PACKED = ["Movapd", "Ucomisd", "Andpd", "Andnpd", "Orpd", "Xorpd"]
CONDS = [("Overflow", "o"), ("NoOverflow", "no"), ("Below", "b"), ("AboveOrEqual", "ae"),
         ("Equal", "e"), ("NotEqual", "ne"), ("BelowOrEqual", "be"), ("Above", "a"),
         ("Sign", "s"), ("NoSign", "ns"), ("Parity", "p"), ("NoParity", "np"),
         ("Less", "l"), ("GreaterOrEqual", "ge"), ("LessOrEqual", "le"), ("Greater", "g")]
IMMEDIATES = [0, 1, -1, 127, 128, -128, -129, 0x12345678, 0x7FFFFFFF, -0x80000000]
SCALES = [("One", 1), ("Two", 2), ("Four", 4), ("Eight", 8)]


def reg(n: int) -> str:
    return f"Reg.{REG[n]}"


def xmm(n: int) -> str:
    return f"Xmm.Xmm{n}"


def mem_operands() -> list[tuple[str, str]]:
    """(Silk expression, Intel text without the size prefix) for the memory operand shapes."""
    out = []
    for base in ALL:
        for disp in (0, 8):
            out.append((base, None, None, disp))
    for base in (0, 4, 5, 12, 13):
        for disp in (127, 128, -128, -129, 0x12345678, -0x80000000):
            out.append((base, None, None, disp))
    pairs = [(0, 1), (4, 0), (5, 5), (12, 13), (13, 12), (15, 8), (7, 15), (5, 9)]
    disps = itertools.cycle((0, 16, -0x1000, 127, -129))
    for (base, index), (scale_name, scale) in itertools.product(pairs, SCALES):
        out.append((base, index, (scale_name, scale), next(disps)))
    rendered = []
    for base, index, scale, disp in out:
        text = NAME64[base]
        if index is None:
            silk = f"Mem.at({reg(base)}, {disp})"
        else:
            silk = f"Mem.indexed({reg(base)}, {reg(index)}, Scale.{scale[0]}, {disp})"
            text += f" + {NAME64[index]}*{scale[1]}"
        if disp > 0:
            text += f" + {disp}"
        elif disp < 0:
            text += f" - {-disp}"
        rendered.append((silk, f"[{text}]"))
    return rendered


MEMS = mem_operands()
# A sample that still has every addressing shape: plain, SIB-forced, displacement-forced, each
# displacement size, and indexed with low and high registers.
MEM_SAMPLE = [MEMS[i] for i in (0, 9, 10, 17, 24, 27, 32, 35, 39, 44, 50, 55, 61, 62, 67, 72, 77, 82, 87, 93)]


def rotate(values, count=None):
    """Zip dimensions of different lengths so each value of each appears, without the product."""
    lists = [list(v) for v in values]
    count = count or max(len(v) for v in lists)
    return [tuple(v[i % len(v)] for v in lists) for i in range(count)]


def cases() -> dict[str, list[tuple[str, str]]]:
    groups: dict[str, list[tuple[str, str]]] = {}

    def add(group: str, silk: str, text: str) -> None:
        groups.setdefault(group, []).append((silk, text))

    pairs = [(d, s) for d in EDGE for s in (1, 7, 9, 14)]
    for width, names, size in WIDTHS:
        for d, s in pairs:
            add("moves", f"a.mov(Width.{width}, {reg(d)}, {reg(s)})", f"mov {names[d]}, {names[s]}")
        for i, (m, text) in enumerate(MEMS if width == "W64" else MEM_SAMPLE):
            r = ALL[(i * 7 + 3) % 16]
            add("loads", f"a.load(Width.{width}, {reg(r)}, {m})", f"mov {names[r]}, {size} ptr {text}")
        for i, (m, text) in enumerate(MEM_SAMPLE):
            r = ALL[(i * 5 + 1) % 16]
            add("stores", f"a.store(Width.{width}, {m}, {reg(r)})", f"mov {size} ptr {text}, {names[r]}")
            value = IMMEDIATES[i % len(IMMEDIATES)]
            add("stores", f"a.storeImm(Width.{width}, {m}, {value})", f"mov {size} ptr {text}, {value}")
            add("moves", f"a.lea(Width.{width}, {reg(r)}, {m})", f"lea {names[r]}, {text}")
    for r in ALL:
        add("moves", f"a.movImm32({reg(r)}, {0x12345678 + r})", f"mov {NAME32[r]}, {0x12345678 + r}")
        add("moves", f"a.movImmSigned32({reg(r)}, {-1 - r})", f"mov {NAME64[r]}, {-1 - r}")
        add("moves", f"a.movImm64({reg(r)}, {0x1122334455667788 + r})", f"movabs {NAME64[r]}, {0x1122334455667788 + r}")
        add("moves", f"a.push({reg(r)})", f"push {NAME64[r]}")
        add("moves", f"a.pop({reg(r)})", f"pop {NAME64[r]}")
    add("moves", "a.movImm32(Reg.Rax, 0)", "mov eax, 0")
    add("moves", "a.movImm32(Reg.R15, 4294967295)", "mov r15d, 4294967295")
    add("moves", "a.movImmSigned32(Reg.Rax, 2147483647)", "mov rax, 2147483647")
    add("moves", "a.movImmSigned32(Reg.R9, -2147483648)", "mov r9, -2147483648")
    add("moves", "a.movImm64(Reg.Rax, 18446744073709551615)", "movabs rax, 18446744073709551615")
    for i, (m, text) in enumerate(MEM_SAMPLE):
        r = ALL[(i * 3 + 2) % 16]
        s = ALL[(i * 11 + 4) % 16]
        add("narrow", f"a.store8({m}, {reg(s)})", f"mov byte ptr {text}, {NAME8[s]}")
        add("narrow", f"a.store16({m}, {reg(s)})", f"mov word ptr {text}, {NAME16[s]}")
        add("narrow", f"a.loadZero8({reg(r)}, {m})", f"movzx {NAME32[r]}, byte ptr {text}")
        add("narrow", f"a.loadZero16({reg(r)}, {m})", f"movzx {NAME32[r]}, word ptr {text}")
        add("narrow", f"a.loadSigned32({reg(r)}, {m})", f"movsxd {NAME64[r]}, dword ptr {text}")
        add("narrow", f"a.loadSigned8({reg(r)}, {m})", f"movsx {NAME32[r]}, byte ptr {text}")
        add("narrow", f"a.loadSigned16({reg(r)}, {m})", f"movsx {NAME32[r]}, word ptr {text}")
    for d, s in rotate([ALL, [0, 4, 5, 6, 7, 8, 15, 1, 2, 3]], 20):
        add("narrow", f"a.zeroExtend8({reg(d)}, {reg(s)})", f"movzx {NAME32[d]}, {NAME8[s]}")
        add("narrow", f"a.signExtend32({reg(d)}, {reg(s)})", f"movsxd {NAME64[d]}, {NAME32[s]}")

    for op in ALU:
        lower = op.lower()
        for width, names, size in WIDTHS:
            for d, s in rotate([EDGE, [1, 9, 7, 14]], 9):
                add("alu", f"a.alu(Alu.{op}, Width.{width}, {reg(d)}, {reg(s)})", f"{lower} {names[d]}, {names[s]}")
            for d, value in rotate([[0, 1, 5, 8, 12, 13, 15], IMMEDIATES], 10) + [(0, 0x12345678), (0, 127), (0, -129)]:
                add("alu", f"a.aluImm(Alu.{op}, Width.{width}, {reg(d)}, {value})", f"{lower} {names[d]}, {value}")
            for i, (m, text) in enumerate(MEM_SAMPLE[::3]):
                r = ALL[(i * 9 + ALU.index(op)) % 16]
                value = IMMEDIATES[(i + ALU.index(op)) % len(IMMEDIATES)]
                add("aluMemory", f"a.aluLoad(Alu.{op}, Width.{width}, {reg(r)}, {m})", f"{lower} {names[r]}, {size} ptr {text}")
                add("aluMemory", f"a.aluStore(Alu.{op}, Width.{width}, {m}, {reg(r)})", f"{lower} {size} ptr {text}, {names[r]}")
                add("aluMemory", f"a.aluStoreImm(Alu.{op}, Width.{width}, {m}, {value})", f"{lower} {size} ptr {text}, {value}")

    for width, names, size in WIDTHS:
        for d, s in rotate([EDGE, [1, 9, 7, 14]], 9):
            add("arithmetic", f"a.test(Width.{width}, {reg(d)}, {reg(s)})", f"test {names[d]}, {names[s]}")
            add("arithmetic", f"a.imul(Width.{width}, {reg(d)}, {reg(s)})", f"imul {names[d]}, {names[s]}")
        for d, s, value in rotate([EDGE, [1, 9, 7, 14], IMMEDIATES], 10):
            add("arithmetic", f"a.imulImm(Width.{width}, {reg(d)}, {reg(s)}, {value})", f"imul {names[d]}, {names[s]}, {value}")
        for d, value in rotate([[0, 1, 5, 8, 13], [1, -1, 0x12345678, -0x80000000, 255]], 5):
            add("arithmetic", f"a.testImm(Width.{width}, {reg(d)}, {value})", f"test {names[d]}, {value}")
        for op in UNARY:
            for r in (0, 1, 5, 8, 13):
                add("arithmetic", f"a.unary(Unary.{op}, Width.{width}, {reg(r)})", f"{op.lower()} {names[r]}")
        for op in SHIFTS:
            for d, count in rotate([[0, 3, 5, 9, 12], [1, 2, 31, 63 if width == "W64" else 17, 7]], 5):
                add("arithmetic", f"a.shiftImm(Shift.{op}, Width.{width}, {reg(d)}, {count})", f"{op.lower()} {names[d]}, {count}")
            for d in (0, 2, 13):
                add("arithmetic", f"a.shiftCl(Shift.{op}, Width.{width}, {reg(d)})", f"{op.lower()} {names[d]}, cl")
    add("arithmetic", "a.signExtendAccumulator(Width.W32)", "cdq")
    add("arithmetic", "a.signExtendAccumulator(Width.W64)", "cqo")

    for i, (cond, suffix) in enumerate(CONDS):
        for r in (EDGE[i % len(EDGE)], ALL[(i * 3 + 1) % 16]):
            add("conditions", f"a.setcc(Cond.{cond}, {reg(r)})", f"set{suffix} {NAME8[r]}")
        for width, names, size in WIDTHS:
            d, s = ALL[(i * 5) % 16], ALL[(i * 7 + 3) % 16]
            add("conditions", f"a.cmov(Cond.{cond}, Width.{width}, {reg(d)}, {reg(s)})", f"cmov{suffix} {names[d]}, {names[s]}")

    for i, (m, text) in enumerate(MEM_SAMPLE):
        x = (i * 7 + 1) % 16
        add("doubles", f"a.loadDouble({xmm(x)}, {m})", f"movsd {'xmm' + str(x)}, qword ptr {text}")
        add("doubles", f"a.storeDouble({m}, {xmm(x)})", f"movsd qword ptr {text}, xmm{x}")
        add("doubles", f"a.loadFloat({xmm(x)}, {m})", f"cvtss2sd {'xmm' + str(x)}, dword ptr {text}")
        add("doubles", f"a.storeFloat({m}, {xmm(x)})", f"movss dword ptr {text}, xmm{x}")
    for op, mnemonic in SCALAR:
        for d, s in rotate([[0, 1, 7, 8, 15], [1, 9, 0, 15, 8]], 5):
            add("doubles", f"a.scalar(ScalarOp.{op}, {xmm(d)}, {xmm(s)})", f"{mnemonic} xmm{d}, xmm{s}")
        for i, (m, text) in enumerate(MEM_SAMPLE[::4]):
            x = (i * 5 + 2) % 16
            add("doubles", f"a.scalarLoad(ScalarOp.{op}, {xmm(x)}, {m})", f"{mnemonic} xmm{x}, qword ptr {text}")
    for op in PACKED:
        for d, s in rotate([[0, 1, 7, 8, 15], [1, 9, 0, 15, 8]], 5):
            add("doubles", f"a.packed(PackedOp.{op}, {xmm(d)}, {xmm(s)})", f"{op.lower()} xmm{d}, xmm{s}")
    for x, r in rotate([[0, 1, 7, 8, 15], [0, 9, 4, 13, 7]], 5):
        for width, names, size in WIDTHS:
            add("doubles", f"a.intToDouble(Width.{width}, {xmm(x)}, {reg(r)})", f"cvtsi2sd xmm{x}, {names[r]}")
            add("doubles", f"a.doubleToInt(Width.{width}, {reg(r)}, {xmm(x)})", f"cvttsd2si {names[r]}, xmm{x}")
        add("doubles", f"a.bitsToDouble({xmm(x)}, {reg(r)})", f"movq xmm{x}, {NAME64[r]}")
        add("doubles", f"a.doubleToBits({reg(r)}, {xmm(x)})", f"movq {NAME64[r]}, xmm{x}")
    for d, s in rotate([[0, 1, 7, 8, 15], [1, 9, 0, 15, 8]], 5):
        add("doubles", f"a.doubleToFloat({xmm(d)}, {xmm(s)})", f"cvtsd2ss xmm{d}, xmm{s}")

    for r in ALL:
        add("control", f"a.jmpReg({reg(r)})", f"jmp {NAME64[r]}")
        add("control", f"a.callReg({reg(r)})", f"call {NAME64[r]}")
    for m, text in MEM_SAMPLE[::2]:
        add("control", f"a.callMem({m})", f"call qword ptr {text}")
        add("control", f"a.jmpMem({m})", f"jmp qword ptr {text}")
    add("control", "a.ret()", "ret")
    add("control", "a.int3()", "int3")
    add("control", "a.ud2()", "ud2")
    add("control", "a.nop()", "nop")
    return groups


def llvm_mc() -> str:
    explicit = os.environ.get("LLVM_MC")
    if explicit:
        return explicit
    clang = os.environ.get("SILK_CLANG")
    if clang:
        beside = Path(shutil.which(clang) or clang).resolve().parent / "llvm-mc"
        if beside.exists():
            return str(beside)
    found = shutil.which("llvm-mc")
    if not found:
        sys.exit("encodings.py: no llvm-mc; set LLVM_MC or SILK_CLANG")
    return found


def assemble(lines: list[str]) -> list[bytes]:
    result = subprocess.run(
        [llvm_mc(), "--triple=x86_64-unknown-linux-gnu", "-x86-asm-syntax=intel", "--show-encoding"],
        input="\n".join(lines) + "\n", capture_output=True, text=True)
    if result.returncode != 0:
        sys.exit("encodings.py: llvm-mc rejected a case:\n" + result.stderr)
    encodings = [bytes(int(b, 16) for b in match.split(","))
                 for match in re.findall(r"# encoding: \[([^\]]*)\]", result.stdout)]
    if len(encodings) != len(lines):
        sys.exit(f"encodings.py: {len(lines)} instructions gave {len(encodings)} encodings")
    return encodings


# Whole programs with labels, checked after `finish`: they cover branch relaxation, which a
# single instruction cannot show. Each step is ("bind", n), ("jmp", n), ("jcc", cond, n),
# ("call", n), ("lea", reg, n), ("nops", count) or ("ret",); labels count from 0.
def programs() -> dict[str, list[tuple]]:
    return {
        # Forward and backward, every kind of reference, all within reach.
        "nearRefs": [("bind", 0), ("jcc", "Equal", 1), ("jmp", 0), ("call", 1), ("lea", 9, 0), ("bind", 1), ("ret",)],
        # 127 bytes forward fits in 8 bits; 128 does not.
        "forwardEdge": [("jmp", 0), ("nops", 127), ("bind", 0), ("jcc", "Below", 1), ("nops", 128), ("bind", 1), ("ret",)],
        # -128 fits, -129 does not (measured from the end of the 2-byte jump).
        "backwardEdge": [("bind", 0), ("nops", 126), ("jmp", 0), ("bind", 1), ("nops", 127), ("jcc", "Greater", 1), ("ret",)],
        # The second jump reaches only once the first has shrunk; the first only once the second has.
        "chain": [("jmp", 1), ("nops", 60), ("jcc", "Sign", 2), ("nops", 63), ("bind", 1), ("nops", 2), ("bind", 2), ("ret",)],
        # A long jump over short ones: its distance shrinks with theirs.
        "longOverShort": [("jmp", 2)] + [x for i in range(40) for x in (("jcc", "Parity", 1), ("nops", 3))]
                         + [("bind", 1), ("nops", 100), ("bind", 2), ("ret",)],
        # Many branches to one exit at the end, the backend's shape.
        "exits": [x for i in range(30) for x in (("nops", 4), ("jcc", "Overflow", 0))] + [("ret",), ("bind", 0), ("ud2",)],
    }


def program_text(steps: list[tuple]) -> tuple[list[str], list[str]]:
    cond = dict(CONDS)
    silk, asm = [], []
    for step in steps:
        kind = step[0]
        if kind == "bind":
            silk.append(f"a.bind(labels[{step[1]}])")
            asm.append(f".L{step[1]}:")
        elif kind == "jmp":
            silk.append(f"run a.jmp(labels[{step[1]}])")
            asm.append(f"jmp .L{step[1]}")
        elif kind == "jcc":
            silk.append(f"run a.jcc(Cond.{step[1]}, labels[{step[2]}])")
            asm.append(f"j{cond[step[1]]} .L{step[2]}")
        elif kind == "call":
            silk.append(f"run a.call(labels[{step[1]}])")
            asm.append(f"call .L{step[1]}")
        elif kind == "lea":
            silk.append(f"run a.leaLabel({reg(step[1])}, labels[{step[2]}])")
            asm.append(f"lea {NAME64[step[1]]}, [rip + .L{step[2]}]")
        elif kind == "nops":
            silk.append(f"run nops(&mut a, {step[1]})")
            asm += ["nop"] * step[1]
        elif kind == "ret":
            silk.append("run a.ret()")
            asm.append("ret")
        elif kind == "ud2":
            silk.append("run a.ud2()")
            asm.append("ud2")
    return silk, asm


def assemble_program(lines: list[str]) -> bytes:
    with tempfile.TemporaryDirectory() as work:
        source, obj, text = Path(work, "p.s"), Path(work, "p.o"), Path(work, "p.bin")
        source.write_text(".intel_syntax noprefix\n.text\n" + "\n".join(lines) + "\n")
        result = subprocess.run([llvm_mc(), "--triple=x86_64-unknown-linux-gnu", "-filetype=obj", "-o", str(obj), str(source)],
                                capture_output=True, text=True)
        if result.returncode != 0:
            sys.exit("encodings.py: llvm-mc rejected a program:\n" + result.stderr)
        objcopy = Path(llvm_mc()).resolve().parent / "llvm-objcopy"
        result = subprocess.run([str(objcopy), "-O", "binary", "--only-section=.text", str(obj), str(text)],
                                capture_output=True, text=True)
        if result.returncode != 0:
            sys.exit("encodings.py: llvm-objcopy failed:\n" + result.stderr)
        return text.read_bytes()


def render_programs() -> list[str]:
    out = ["", "effect fn nops(a: &mut Assembler, count: usize) -> () ! OutOfMemoryError ? &mut Allocator {",
           "  let mut index: usize = 0",
           "  while index < count { run a.nop() index = index + 1 }",
           "}"]
    for name, steps in programs().items():
        silk, asm = program_text(steps)
        expected = "".join(f"\\x{b:02x}" for b in assemble_program(asm))
        count = 1 + max([s[1] for s in steps if s[0] in ("bind", "jmp", "call")]
                        + [s[2] for s in steps if s[0] in ("jcc", "lea")])
        out += ["", f"effect fn {name}Program() -> Code ! OutOfMemoryError | UnboundLabelError ? &mut Allocator {{",
                "  let mut a = Assembler.make()",
                "  let mut labels = List<Label>.make()",
                f"  while labels.length() < {count} {{ let label = run a.label() run labels.append(label) }}"]
        out += [f"  {line}".replace("labels[", "labels.get(").replace("])", "))").replace("], ", "), ") for line in silk]
        out += ["  return run a.finish()", "}", "",
                f"test effect fn {name}MatchesLlvm() -> () ! OutOfMemoryError | UnboundLabelError | AssertionError<'static> {{",
                "  let mut allocator = Allocator.systemAllocatorProvider()",
                f"  let code = run {name}Program() |> Effect.provideMut<Allocator>(&mut allocator)",
                f'  run Testing.expect(sameBytes(code.bytes.asSlice(), b"{expected}"), "{name}: the bytes llvm-mc assembles")',
                "}"]
    return out


def render() -> str:
    groups = cases()
    flat = [text for group in groups.values() for _, text in group]
    encodings = iter(assemble(flat))
    version = subprocess.run([llvm_mc(), "--version"], capture_output=True, text=True).stdout
    release = re.search(r"LLVM version (\S+)", version)
    out = [
        "// Generated by scripts/encodings.py; do not edit. Each `Assembler` call is followed by the",
        f"// bytes llvm-mc {release.group(1) if release else 'unknown'} assembles for the Intel-syntax instruction in the message.",
        "import asm_x64 { Alu, Assembler, Code, Cond, Label, Mem, PackedOp, Reg, Scale, ScalarOp, Shift, Unary, UnboundLabelError, Width, Xmm }",
        "import silk.collections.list { List }",
        "import silk.core.effect { Effect }",
        "import silk.mem.allocator { Allocator, OutOfMemoryError }",
        "import silk.testing.testing { AssertionError, Testing }",
        "",
        "/// Whether the bytes emitted since offset `at` are exactly `expected`; moves `at` past them.",
        "fn emitted(a: &Assembler, at: &mut usize, expected: &[u8]) -> bool {",
        "  let bytes = a.bytes()",
        "  let start = at.*",
        "  at.* = bytes.length",
        "  if bytes.length - start != expected.length { return false }",
        "  let mut index: usize = 0",
        "  while index < expected.length {",
        "    if bytes[start + index] != expected[index] { return false }",
        "    index = index + 1",
        "  }",
        "  return true",
        "}",
        "",
        "fn sameBytes(actual: &[u8], expected: &[u8]) -> bool {",
        "  if actual.length != expected.length { return false }",
        "  let mut index: usize = 0",
        "  while index < expected.length {",
        "    if actual[index] != expected[index] { return false }",
        "    index = index + 1",
        "  }",
        "  return true",
        "}",
    ]
    total = 0
    for name, group in groups.items():
        out += ["", f"effect fn {name}Cases(a: &mut Assembler) -> () ! OutOfMemoryError | AssertionError<'static> ? &mut Allocator {{",
                "  let mut at: usize = 0"]
        for silk, text in group:
            expected = "".join(f"\\x{b:02x}" for b in next(encodings))
            out.append(f"  run {silk}")
            out.append(f'  run Testing.expect(emitted(&a, &mut at, b"{expected}"), "{text}")')
            total += 1
        out += ["}", "",
                f"test effect fn {name}MatchLlvm() -> () ! OutOfMemoryError | AssertionError<'static> {{",
                "  let mut allocator = Allocator.systemAllocatorProvider()",
                "  let mut a = Assembler.make()",
                f"  run {name}Cases(&mut a) |> Effect.provideMut<Allocator>(&mut allocator)",
                "}"]
    out += render_programs()
    out.insert(2, f"// {total} cases and {len(programs())} programs.")
    return "\n".join(out) + "\n"


def main() -> None:
    text = render()
    if "--check" in sys.argv[1:]:
        if not OUTPUT.exists() or OUTPUT.read_text() != text:
            sys.exit(f"encodings.py: {OUTPUT.relative_to(ROOT)} is stale; run scripts/encodings.py")
        print(f"{OUTPUT.relative_to(ROOT)} is current")
        return
    OUTPUT.write_text(text)
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {text.count('Testing.expect(emitted')} cases")


if __name__ == "__main__":
    main()
