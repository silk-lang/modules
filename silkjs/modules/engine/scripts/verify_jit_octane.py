#!/usr/bin/env python3
"""Compare the interpreter, JIT and compiled-call JIT on fixed Octane inputs.

Each fresh process runs the suite's setup, the fixed number of iterations used
by jit_coverage, and its teardown, including application state assertions.
"""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import tempfile

from jit_coverage import FIXED, FIXED_RUNNER, OCTANE, source


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine", required=True, type=Path)
    parser.add_argument("--shell", required=True, type=Path)
    parser.add_argument("--octane", required=True, type=Path, help="directory containing Octane base.js")
    parser.add_argument("--only", nargs="+", choices=OCTANE, default=list(OCTANE))
    args = parser.parse_args()
    engines = {
        "interpreter": [args.engine.resolve()],
        "jit": [args.shell.resolve(), "--jit"],
        "jit-calls": [args.shell.resolve(), "--jit", "--jit-calls"],
    }
    ok = True
    env = dict(os.environ, SILKJS_PREPARSE_THREADS="0")
    with tempfile.TemporaryDirectory() as temp:
        for name in args.only:
            script = Path(temp, name + ".js")
            script.write_text(source(args.octane, OCTANE[name]) + FIXED_RUNNER % FIXED.get(name, 1))
            reference = None
            for mode, command in engines.items():
                run = subprocess.run([*command, script], cwd=args.octane, env=env,
                                     capture_output=True, text=True, timeout=300)
                if mode == "interpreter":
                    reference = run.stdout
                if run.returncode or not run.stdout.rstrip().endswith(" done") or run.stdout != reference:
                    print(f"{name} {mode} failed (exit {run.returncode})", file=sys.stderr)
                    if run.stderr:
                        print(run.stderr.rstrip(), file=sys.stderr)
                    if run.stdout != reference:
                        print(f"expected {reference!r}, got {run.stdout!r}", file=sys.stderr)
                    ok = False
                else:
                    print(f"{name} {mode} passed", flush=True)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
