#!/bin/bash
# ir.sh SHELL: exact instruction count of the optimized code (and the total) on Richards x20.
SP=${SILKJS_PROF:-$(cd "$(dirname "$0")/.." && pwd)}
unset NODE_OPTIONS BUN_OPTIONS; export SILKJS_PREPARSE_THREADS=0
cd $SP/opt; mkdir -p ir/$1
valgrind --tool=callgrind --dump-instr=yes --callgrind-out-file=ir/$1/cg.out ./$1 --jit-opt=20 --jit-threshold=20 --jit-dump richards-x20.js 2> ir/$1/cgdump.txt >/dev/null
python3 cgprof.py ir/$1/cgdump.txt ir/$1/cg.out | head -${2:-1} | sed "s/^/$1 /"
