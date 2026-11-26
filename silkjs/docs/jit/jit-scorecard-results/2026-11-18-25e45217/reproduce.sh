#!/usr/bin/env bash
set -eu
# Pass the checkout containing the release shell, and an empty results directory.
# For plain (interpreter) set PLAIN to its release engine path.
repo=$(realpath "$1")
out=$(realpath -m "$2")
mkdir -p "$out"
rel="$repo/build/llvm/x86_64-unknown-linux-gnu/release"
cd "$repo/modules/engine/scripts"
python3 - "$out" <<'PY'
from pathlib import Path
import sys, jit_kernels as j
original = (Path(j.KERNELS) / 'typed-array.js').read_text()
for n in (800, 1600, 10000):
    source = original.replace('k < 10000','k < '+str(n))
    (Path(sys.argv[1]) / f'h{n}.js').write_text(j.PRELUDE+source+j.EPILOGUE)
PY
cd "$out"
"$rel/silkjs-jit-shell" --jit --jit-calls --jit-stats --jit-dump h10000.js >hdump.out 2>hdump.log
for n in 800 1600; do
  for w in jit plain; do
    if [[ $w == jit ]]; then arg=("$rel/silkjs-jit-shell" --jit --jit-calls --jit-stats)
    elif [[ -n ${PLAIN:-} ]]; then arg=("$PLAIN")
    else continue
    fi
    valgrind --tool=callgrind --smc-check=all-non-file --callgrind-out-file="h.$w.$n.cg" "${arg[@]}" "h$n.js" >"h.$w.$n.out" 2>"h.$w.$n.log"
  done
done
