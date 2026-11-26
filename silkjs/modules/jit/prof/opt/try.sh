#!/bin/bash
# try.sh NAME [scripts]: dev build, Richards counters and instruction count; with "scripts" also the baseline scripts.
export PATH=$HOME/.silk/bin:$PATH
SP=${SILKJS_PROF:-$(cd "$(dirname "$0")/.." && pwd)}
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
unset NODE_OPTIONS BUN_OPTIONS; export SILKJS_PREPARSE_THREADS=0
cd $REPO/modules/jit/shell && silk build > $SP/dev-build.log 2>&1
if ! grep -q Finished $SP/dev-build.log; then grep -B2 -A12 "error" $SP/dev-build.log | head -60; exit 1; fi
cd $SP/opt; cp $REPO/build/x86_64-unknown-linux-gnu/dev/silkjs-jit-shell $1
./$1 --jit-opt=20 --jit-threshold=20 --jit-stats richards-x20.js 2>&1 | grep -o "inlined [0-9]*\|frame-exits [0-9]*\|inlined-exits [0-9]*\|optimize-refused [0-9]*\|optimized-bytes [0-9]*\|Richards.*\|rror.*" | tr '\n' ' '; echo
valgrind --tool=cachegrind --cache-sim=no --cachegrind-out-file=/dev/null ./$1 --jit-opt=20 --jit-threshold=20 richards-x20.js 2>&1 | grep 'I *refs' | sed "s/^/$1 /"
if [ "$2" = scripts ]; then cd $REPO && python3 modules/jit/scripts/baseline_scripts.py $SP/opt/$1 2>&1 | tail -4; fi
