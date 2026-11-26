#!/bin/bash
# rel.sh NAME: release shell build, then callgrind of DeltaBlue x20 into ../cgNAME.{out,err} and the totals.
export PATH=$HOME/.silk/bin:$PATH
SP=${SILKJS_PROF:-$(cd "$(dirname "$0")/.." && pwd)}
REPO=$(cd "$(dirname "$0")/../../../.." && pwd)
unset NODE_OPTIONS BUN_OPTIONS; export SILKJS_PREPARSE_THREADS=0
cd $REPO/modules/jit/shell && silk build --release > $SP/rel-build.log 2>&1
if ! grep -q Finished $SP/rel-build.log; then grep -B2 -A12 "error" $SP/rel-build.log | head -60; exit 1; fi
cd $SP; cp $REPO/build/x86_64-unknown-linux-gnu/release/silkjs-jit-shell opt/shell-$1
valgrind --tool=callgrind --dump-instr=yes --callgrind-out-file=cg$1.out opt/shell-$1 --jit-opt=20 --jit-threshold=20 --jit-dump $SP/bench/fixed/x20-deltablue.js 2> cg$1.err >/dev/null
grep totals cg$1.out; python3 opt/cgprof.py cg$1.err cg$1.out | head -3
