#!/usr/bin/env python3
"""Runs the scripts of tests/baseline on the JIT shell with and without baseline code.

    python3 scripts/baseline_scripts.py <silkjs-jit-shell> [script.js ...]

Each script prints what it computes. A script passes when --jit-baseline prints what the
interpreter prints, at hot thresholds 1, 5 and 60 (docs/jit/baseline.md), and when --jit-opt
does at each of those, with the optimizer taking a function after 1, 3 and 40 more entries
(docs/jit/optimizer.md). The scripts cover what the tiers do besides straight code: deep
recursion and the stack overflow, exceptions through their frames and handlers in them, error
stacks, closures, `arguments`, getters, constructors, natives, mixed operand types, steps, and
loops entered while they run.
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THRESHOLDS = (1, 5, 60)
# Entries of baseline code before the optimizer takes a function, per threshold.
OPTIMIZE = (1, 3, 40)


def output(command):
    try:
        run = subprocess.run(command, capture_output=True, timeout=120, check=False)
    except subprocess.TimeoutExpired:
        return None, b"timed out"
    return run.returncode, run.stdout + run.stderr


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    shell = sys.argv[1]
    folder = os.path.join(HERE, "tests", "baseline")
    scripts = sys.argv[2:] or sorted((os.path.join(folder, n) for n in os.listdir(folder) if n.endswith(".js")),
                                     key=lambda p: (len(os.path.basename(p)), p))
    failed = 0
    for script in scripts:
        expected = output([shell, script])
        for threshold, entries in zip(THRESHOLDS, OPTIMIZE):
            got = output([shell, "--jit-baseline", "--jit-threshold=%d" % threshold, script])
            if got != expected:
                failed += 1
                print("FAIL %s at threshold %d (status %s, interpreter %s)" % (os.path.basename(script), threshold, got[0], expected[0]))
            got = output([shell, "--jit-opt=%d" % entries, "--jit-threshold=%d" % threshold, script])
            if got != expected:
                failed += 1
                print("FAIL %s optimized at threshold %d + %d (status %s, interpreter %s)" % (os.path.basename(script), threshold, entries, got[0], expected[0]))
    print("%d scripts at thresholds %s: %s" % (len(scripts), ", ".join(map(str, THRESHOLDS)), "%d runs differ" % failed if failed else "all agree"))
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
