#!/bin/bash
# tm.sh SCRIPT ROUNDS shell...: interleaved user+sys CPU ms per shell (opt flags), median and min.
unset NODE_OPTIONS BUN_OPTIONS; export SILKJS_PREPARSE_THREADS=0
S=$1; N=$2; shift 2
python3 - "$S" "$N" "$@" <<'PY'
import sys, subprocess, resource, statistics, os
script, n, shells = sys.argv[1], int(sys.argv[2]), sys.argv[3:]
t = {s: [] for s in shells}
for r in range(n):
    for s in shells:
        cmd = s.split(',')
        b = resource.getrusage(resource.RUSAGE_CHILDREN)
        subprocess.run(['taskset', '-c', '2'] + cmd + [script], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        a = resource.getrusage(resource.RUSAGE_CHILDREN)
        t[s].append((a.ru_utime - b.ru_utime + a.ru_stime - b.ru_stime) * 1000)
for s in shells:
    print("%-60s median %7.1f min %7.1f" % (s[-58:], statistics.median(t[s]), min(t[s])))
PY
