#!/usr/bin/env python3
"""Machine code against the interpreter as the code a run touches grows.

Two scripts do the same work, 3,000 rounds of `fs[i](o, a)` over 400 small functions: in
the narrow one those are 4 distinct functions, in the wide one 400. Each mode runs each
script --runs times on one core; the figure is the best user plus system CPU time, with the
instructions of one run under callgrind when --instructions is given.

    python3 footprint.py --shell build/.../silkjs-jit-shell [--runs 5] [--cpu 2] [--instructions]

Machine code that is fast on the narrow script and slow on the wide one pays for fetching
its own code (docs/jit/handoff-2026-11-21.md, "Update, evening of 22 November").
"""
import argparse
import os
from pathlib import Path
import re
import resource
import subprocess
import tempfile

BODY = ("var t = o.x{x} + {c}; if (o.flag) t += o.y; else t -= a.length; "
        "for (var k = 0; k < 3; k++) t += a[k] | 0; o.z = t & 1023; return t + (o.name.length > {n} ? 1 : 2);")
DRIVER = """
var objs = []; for (var j = 0; j < 8; j++) objs.push({x0:1,x1:2,x2:3,x3:4,x4:5,x5:6,x6:7,flag:j&1,y:j,name:'n'+j,z:0});
var arr = [1,2,3,4];
function round(r) { var s = 0; for (var i = 0; i < fs.length; i++) s += fs[i](objs[(i + r) & 7], arr); return s; }
var total = 0; for (var r = 0; r < 3000; r++) total = (total + round(r)) | 0;
print(total);
"""
MODES = (("interpreter", []), ("baseline", ["--jit-baseline"]), ("optimizer", ["--jit-opt"]))


def script(distinct):
    lines = ["var fs = [];"]
    for i in range(400):
        j = i % distinct
        body = BODY.format(x=j % 7, c=j, n=j % 5)
        if distinct == 400:
            lines.append("fs.push(function f%d(o, a) { %s });" % (i, body))
        else:
            lines.append("fs.push(fs.length < %d ? function g(o, a) { %s } : fs[fs.length %% %d]);" % (distinct, body, distinct))
    return "\n".join(lines) + DRIVER


def cpu_ms(command, cpu):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    subprocess.run(["taskset", "-c", str(cpu), *command], capture_output=True, check=True)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    return round((after.ru_utime - before.ru_utime + after.ru_stime - before.ru_stime) * 1000)


def instructions(command):
    run = subprocess.run(["valgrind", "--tool=callgrind", "--callgrind-out-file=/dev/null", *command], capture_output=True, text=True)
    found = re.search(r"refs:\s+([\d,]+)", run.stderr)
    return int(found[1].replace(",", "")) if found else 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--shell", type=Path, required=True)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--cpu", type=int, default=2)
    parser.add_argument("--instructions", action="store_true")
    args = parser.parse_args()
    with tempfile.TemporaryDirectory() as directory:
        for name, distinct in (("narrow", 4), ("wide", 400)):
            path = os.path.join(directory, name + ".js")
            Path(path).write_text(script(distinct))
            for mode, flags in MODES:
                command = [str(args.shell), *flags, path]
                best = min(cpu_ms(command, args.cpu) for _ in range(args.runs))
                line = f"{name:7s} {mode:12s} {best:5d} ms"
                if args.instructions:
                    count = instructions(command)
                    line += f"  {count / 1e6:7.0f}M instructions  {count / (best * 1e6):5.2f} per ns"
                print(line, flush=True)


if __name__ == "__main__":
    main()
