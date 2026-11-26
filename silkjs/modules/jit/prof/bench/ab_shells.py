#!/usr/bin/env python3
"""Optimizer CPU time of one script under several shells, interleaved.

Each round runs every shell once on one core (the order reversed every other round), with
the optimizer configuration five_engines.py uses; prints each shell's median and minimum user
plus system CPU time. For telling two builds apart on a noisy machine: run 15 rounds or more,
and give Crypto a fixed seed (its random numbers come from the clock, see
docs/jit/handoff-2026-11-23.md).

    python3 ab_shells.py SCRIPT SHELL [SHELL...] [--rounds 15] [--cpu 2]
"""
import argparse
import resource
import statistics
import subprocess


def cpu_ms(command, cpu):
    before = resource.getrusage(resource.RUSAGE_CHILDREN)
    subprocess.run(["taskset", "-c", str(cpu), *command], capture_output=True, check=True)
    after = resource.getrusage(resource.RUSAGE_CHILDREN)
    return (after.ru_utime - before.ru_utime + after.ru_stime - before.ru_stime) * 1000


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("script")
    parser.add_argument("shells", nargs="+")
    parser.add_argument("--rounds", type=int, default=15)
    parser.add_argument("--cpu", type=int, default=2)
    args = parser.parse_args()
    times = {shell: [] for shell in args.shells}
    for r in range(args.rounds):
        for shell in (args.shells if r % 2 == 0 else args.shells[::-1]):
            times[shell].append(cpu_ms([shell, "--jit-opt=20", "--jit-threshold=20", args.script], args.cpu))
    for shell in args.shells:
        print("%-40s median %5.0f ms  min %5.0f ms" % (shell, statistics.median(times[shell]), min(times[shell])))


if __name__ == "__main__":
    main()
