# SilkJS JIT scorecard: silkjs-jit against V8 and JavaScriptCore

A running series. Each section is one measurement on one host, appended when a milestone 7
workstream lands, so progress shows as a sequence. Numbers from two hosts are never compared in
one table. [`scorecard.md`](scorecard.md) is the interpreter-only scorecard this extends.

The `silkjs-jit` column is `silkjs-jit-shell --jit` (modules/jit/shell): the engine plus the JIT,
compiling functions reported hot. `silkjs` is the plain engine. Every number is MEASURED on the
host of its section unless it says otherwise. Raw files are in
[`jit-scorecard-results/`](jit-scorecard-results/), one folder per section.

## How to rerun

From `modules/engine`, with `PATH="$HOME/.silk/bin:$PATH"`, `SILK_CLANG=$HOME/llvm-22.1.8/bin/clang`,
`NODE_REFERENCE=<Node 24>/bin/node`:

```sh
silk build --release                                  # plain engine
(cd ../jit/shell && silk build --release)             # silkjs-jit-shell, lands beside it
silk task bench-setup node jsc octane quickjs         # once
E=silkjs,silkjs-jit,v8-jitless,jsc-nojit,qjs,v8-jit,jsc-jit
python3 scripts/jit_kernels.py --rounds 7 --json kernels.json       # kernel table
python3 scripts/jit_coverage.py --instructions --kernels --json coverage.json
silk task bench-octane --engines $E --out OUT         # 3 interleaved rounds, ~30 min
silk task bench-startup --engines $E --out OUT
silk task bench-warmup richards deltablue --engines $E --out OUT
silk task bench-micro --engines $E --out OUT          # ~17 min
silk task bench-report --native --out OUT             # table with silkjs-jit and jit/plain
python3 ../../docs/jit/summary_jit.py OUT/octane.json # geomeans per engine
```

What the tools measure:

- `silkjs-jit` in the harness (`modules/benchkit/src/engines.silk`): `$SILKJS_JIT`, else
  `silkjs-jit-shell` beside the silkjs executable, run with `--jit`. It is in the default column
  set; a missing shell is printed as `SKIPPED` (or aborts when named in `--engines`).
- `scripts/jit_kernels.py`: `bench/kernels/*.js`, one feature each, fixed work. One `kernel()`
  call is timed inside the process (startup excluded, compilation and warmup included). Rounds are
  processes interleaved across engines; every engine must return the same checksum. ns per unit is
  the median time divided by the kernel's inner iterations (`UNITS`).
- `scripts/jit_coverage.py`: per benchmark, the shell's own `--jit-stats` and `--jit-dump`
  counters on the score runner (hot reports, compiled, refused by first refused opcode or reason,
  compiled runs, deopts, poll exits), and with `--instructions` the share of executed machine
  instructions that ran in compiled code: fixed iterations under callgrind, counting the
  instructions callgrind attributes to object `???` (the anonymous executable mapping holding
  compiled code). No engine counter is involved, so its cost when off is zero. Floor: code-load
  shows 0.0003% with nothing compiled (other anonymous code), so values below about 0.001% are noise.
- With the matching release `silkjs-jit-shell.symbols` file, `compiler_fraction` counts self
  instructions in the SSA modules, x64 assembler and x64 backend modules. `helper_fraction`
  counts self instructions in `jit_helpers` and `jit_exit_state`. Both divide by all process
  instructions. Shared allocator, GC and builtin callees retain their own costs. The compiler
  driver and code-memory management are outside both module groups. A JSON null or a dash in a
  table indicates missing attribution. A numeric zero means the group had symbols and no self
  instructions. Historical tables below predate this split. Their compiler column includes
  generated-code helper calls and exit reconstruction alongside compiler work.
- `--jit-dump` refusals name the bytecode the translator stopped at
  (`jit: refused: opcode outside the subset: push_this`).

## 2026-11-17 baseline: integration head 14e41811

### Host and versions

- Shared cloud VM (KVM guest), Ubuntu 24.04.5 LTS, Linux 6.18.44-fc-v553 x86_64, 4 vCPUs
  `Intel(R) Xeon(R) Processor @ 2.10GHz`, 15.7 GiB RAM, no swap. Nothing else ran while measuring;
  the tools refuse to measure while a compiler runs.
- lib-silkjs branch `claude/project-thread-6ys4ab` at `0fd4841`, which is integration
  `14e41811` plus the measuring tools and the `--jit-dump` opcode name (no engine or code
  generation change). Silk `v0.1.0-dev.74+205aea3f5b2e`, Clang 22.1.8. Plain release builds
  (`silk build --release`), not PGO.
- Node v24.22.3 (V8 13.6.233.17-node.63, nodejs.org tarball, SHA-256 checked); jsc from Ubuntu
  `libjavascriptcoregtk-bin` 2.52.6-0ubuntu0.24.04.1; QuickJS `e585640f`; Octane `570ad1cc`.
- Omissions: the wasm columns were not run (not part of this series).

### Kernels

Median ns per inner iteration over 7 processes, then the ratio to v8-jit / jsc-jit (above 1 means
slower than that engine). Full min/median/max in
[`kernels.log`](jit-scorecard-results/2026-11-17-baseline/kernels.log).

| Kernel | silkjs | silkjs-jit | v8-jitless | jsc-nojit | qjs | v8-jit | jsc-jit | silkjs-jit outcome |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| sum-calls: `sum(100)` called 200k times | 7.00 (12.9/10.1) | **3.47 (6.4/5.0)** | 12.80 | 6.65 | 10.15 | 0.54 | 0.69 | compiled; 199,000 runs, 0 deopts, 1,979 polls; 76.7% of instructions in compiled code |
| sum-long: one 5M-iteration loop per call, 4 calls | 10.12 (9.2/13.2) | 10.22 (9.3/13.3) | 17.65 | 8.39 | 13.84 | 1.10 | 0.77 | never hot (4 entries; needs OSR) |
| nested: 30x30 loops, 20k calls | 10.93 (17.0/9.8) | 11.43 (17.8/10.2) | 16.48 | 9.37 | 16.20 | 0.64 | 1.12 | refused: retain of a value that is not an argument |
| calls: `add(s, i)` in a loop | 22.59 (39.8/20.2) | 23.16 (40.8/20.7) | 26.23 | 27.65 | 27.78 | 0.57 | 1.12 | refused: `get_var` (the global `add`) |
| method: `p.dot(i)` reading `this.x`, `this.y` | 32.76 (34.7/21.9) | 31.26 (33.1/20.9) | 42.82 | 40.63 | 45.61 | 0.94 | 1.49 | refused: `get_field2` |
| doubles: `s * 0.999 + i * 0.25` | 15.50 (9.3/7.8) | 16.97 (10.2/8.6) | 26.13 | 13.02 | 25.33 | 1.66 | 1.98 | refused: `push_const8` (a double constant) |
| array-sum: `a[i]` over 1000 ints | 10.41 (15.3/13.2) | 10.30 (15.1/13.1) | 18.78 | 11.66 | 16.58 | 0.68 | 0.79 | refused: `get_arg_length8` |
| typed-array: Float64Array multiply-add | 41.93 (39.3/37.3) | 44.59 (41.8/39.7) | 57.67 | 60.62 | 50.94 | 1.07 | 1.12 | refused: `get_var` |

Reading: on the one kernel it compiles the JIT halves the interpreter's time and is 6.4x behind
V8 and 5.0x behind JSC there. Every other kernel stops at its first non-integer opcode and runs at
interpreter speed, 9x to 42x behind the JITs. Where a kernel is not compiled, silkjs-jit and silkjs
differ by noise and code layout (spread up to 1.3x between processes; see the log).

### Octane 2

3 interleaved rounds, one process per benchmark, engine and round. Score, higher is better.
Geometric mean over the 17 score lines ([`summary_jit.py`](summary_jit.py) on
[`octane.json`](jit-scorecard-results/2026-11-17-baseline/octane.json)):

| Engine | best round | median round | worst round |
|---|---:|---:|---:|
| silkjs | 6091 | 5959 | 5672 |
| silkjs-jit | 6033 | 5858 | 5709 |
| v8-jitless | 4678 | 4558 | 4416 |
| jsc-nojit | 3528 | 3422 | 3352 |
| qjs | 3192 | 3112 | 2994 |
| v8-jit | 57500 | 54836 | 52105 |
| jsc-jit | 56007 | 52714 | 50126 |

silkjs-jit/silkjs, geometric mean of per-benchmark medians: 0.983. silkjs-jit is 9.4x behind
v8-jit and 9.0x behind jsc-jit on the median round. Per benchmark the ratio of medians runs from
0.913 (Box2D) to 1.031 (Gameboy); every line except Box2D has overlapping plain and jit ranges, so
apart from Box2D the JIT column is the interpreter within noise. Per-benchmark best scores with
silkjs-jit and jit/plain are in
[`report--native.log`](jit-scorecard-results/2026-11-17-baseline/report--native.log).

Box2D is slower with the JIT, and that is real: under callgrind (3 fixed iterations) the shell
executes 2,507.7M instructions without `--jit`, 2,501.3M with `--jit --jit-threshold=100000000`
(hook attached, nothing compiled) and 2,614.5M with `--jit` (+4.3%). Two tiny functions were
compiled (80 bytes of code) and ran 45,589 times, so the cost is about 2,300 instructions per
compiled run. The extra instructions are in the generic call path, not in compiled code or the
compiler: `callArguments`, `js_arguments.construct`, `apply`, `buildArgList`, `denseArguments`,
GC `drainZeroFrom` and `fromShape` grow, and `lazyArgumentsSlot` shrinks
([`box2d-jit-instruction-delta.txt`](jit-scorecard-results/2026-11-17-baseline/box2d-jit-instruction-delta.txt)).
READ in code, not yet proved: linking makes `enterFrame` refuse the inline call (the frame-cells
stub), so callers that used the lazy-arguments fast path fall back to materializing an
`arguments` object. Splay, with nothing compiled, is 1.0000x (1,373.0M either way).

### Micro, startup, memory, size, warmup

- microbench.js (72 tests, best ns of 3 rounds): silkjs-jit/silkjs geometric mean 1.010 (0.849 to
  1.239 per test, code layout and noise; nothing in microbench is compiled). Engine ns over
  silkjs-jit ns: v8-jit 0.160, jsc-jit 0.165, v8-jitless 1.379, jsc-nojit 1.666, qjs 2.081.
- Empty-script startup, 30 starts, median wall: silkjs 3.27 ms, silkjs-jit 3.02 ms, qjs 2.02,
  jsc 8.2 to 8.5, node 25.7 to 26.2. Peak RSS: silkjs 19.48 MB, silkjs-jit 21.37 MB (+1.9 MB:
  the JIT's reserved code memory and tables), jsc 22.0 to 23.5, node 41.4 to 43.7, qjs 3.9.
- Octane peak RSS per process, geometric mean of medians: silkjs 54.6 MB, silkjs-jit 55.8 MB
  (per benchmark 1.002x to 1.041x), jsc-nojit 57.0, v8-jitless 93.3, v8-jit 130.3, jsc-jit 135.1.
- Executable size stripped: silkjs 21.67 MB, silkjs-jit-shell 22.11 MB (+0.44 MB for the JIT),
  node 103.68 MB, jsc 0.35 MB shell plus 30.60 MB library, qjs 2.75 MB.
- Warmup (200 iterations in one process, 3 processes, median): richards steady 2.006 ms silkjs,
  1.942 silkjs-jit, 0.093 v8-jit, 0.075 jsc-jit; deltablue steady 3.028, 3.026, 0.122, 0.172.
  Nothing in either is compiled, so the JIT column has no warmup curve yet.

### Coverage

Score runner under `--jit --jit-dump --jit-stats`; compiled share from fixed iterations under
callgrind. `v8/` rows are the v8bench copies of the same eight benchmarks. Hot counts vary a
little between runs because hot reports are delivered at interrupt polls.

| Benchmark | hot | compiled | refused | runs | deopts | polls | compiled instr | top refusals (first refused opcode or reason, count) |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| octane/richards | 16 | 0 | 16 | 0 | 0 | 0 | 0.0000% | `push_this` 16 |
| octane/deltablue | 39 | 0 | 39 | 0 | 0 | 0 | 0.0000% | `push_this` 36; `get_arg_field8` 1; `get_var` 1 |
| octane/crypto | 25 | 0 | 25 | 0 | 0 | 0 | 0.0000% | `push_this` 18; `get_var` 5; `get_arg_length8` 1 |
| octane/raytrace | 25 | 0 | 25 | 0 | 0 | 0 | 0.0000% | `push_this` 14; `get_var` 8; `lnot` 1 |
| octane/earley-boyer | 49 | 0 | 49 | 0 | 0 | 0 | 0.0000% | `get_var` 19; a function scope: invalid 8; `if_not_null8` 5 |
| octane/regexp | 2 | 0 | 2 | 0 | 0 | 0 | 0.0000% | `get_scope0` 1; `put_field` 1 |
| octane/splay | 14 | 0 | 14 | 0 | 0 | 0 | 0.0000% | `push_this` 7; `get_var` 4; `get_scope0` 2 |
| octane/navier-stokes | 3 | 0 | 3 | 0 | 0 | 0 | 0.0000% | `get_scope0` 2; `strict_eq_imm8` 1 |
| octane/pdfjs | 55 | 0 | 55 | 0 | 0 | 0 | 0.0000% | `push_this` 30; `get_scope0` 12; `get_var` 3 |
| octane/mandreel | 48 | 0 | 48 | 0 | 0 | 0 | 0.0000% | `sar_imm` 38; `get_var` 10 |
| octane/gbemu | 120 | 0 | 120 | 0 | 0 | 0 | 0.0000% | `get_arg_field8` 77; `push_this` 25; `get_field2` 16 |
| octane/code-load | 8 | 0 | 8 | 0 | 0 | 0 | 0.0003% | `get_var` 3; `fclosure8` 1; `push_atom_value` 1 |
| octane/box2d | 122 | 4 | 118 | 224734 | 0 | 0 | 0.0137% | `push_this` 98; `get_scope0` 9; `is_undefined` 6 |
| octane/zlib | 15 | 0 | 15 | 0 | 0 | 0 | 0.0000% | `or_imm` 15 |
| octane/typescript | 332 | 1 | 331 | 68325 | 0 | 0 | 0.0010% | `push_this` 266; `get_arg_field8` 29; `get_scope0` 16 |
| v8/richards | 16 | 0 | 16 | 0 | 0 | 0 | 0.0000% | `push_this` 16 |
| v8/deltablue | 39 | 0 | 39 | 0 | 0 | 0 | 0.0000% | `push_this` 36; `get_arg_field8` 1; `get_var` 1 |
| v8/crypto | 25 | 0 | 25 | 0 | 0 | 0 | 0.0000% | `push_this` 18; `get_var` 5; `get_arg_length8` 1 |
| v8/raytrace | 25 | 0 | 25 | 0 | 0 | 0 | 0.0000% | `push_this` 14; `get_var` 8; `lnot` 1 |
| v8/earley-boyer | 49 | 0 | 49 | 0 | 0 | 0 | 0.0000% | `get_var` 19; a function scope: invalid 8; `if_not_null8` 5 |
| v8/regexp | 2 | 0 | 2 | 0 | 0 | 0 | 0.0000% | `get_scope0` 1; `put_field` 1 |
| v8/splay | 14 | 0 | 14 | 0 | 0 | 0 | 0.0000% | `push_this` 7; `get_var` 4; `get_scope0` 2 |
| v8/navier-stokes | 3 | 0 | 3 | 0 | 0 | 0 | 0.0000% | `get_scope0` 2; `strict_eq_imm8` 1 |

Refusals over all rows including the kernels (hot functions refused, first refused opcode):
`push_this` 602, `get_arg_field8` 107, `get_var` 94, `get_scope0` 48, `sar_imm` 38, a function
scope: invalid 26, `get_field2` 25, `or_imm` 16 (every hot zlib function), `get_arg_length8` 11,
`put_field` 10, `if_not_null8` 10.
The counts are of functions, not of time: the shell cannot attribute interpreter time to a
function. Since at most 0.014% of any benchmark's instructions run compiled, every refused
function is the time; `push_this` (methods and constructors, J's area) blocks the most functions
on 8 of the 15 Octane benchmarks, then `get_var` (globals, which calls to other functions need:
H) and `get_arg_field8`/`get_field2` (property reads: J). Integer bit operations (`sar_imm`,
`or_imm`, `shr`) block all of mandreel's and zlib's hot functions.

## 2026-11-17 04:27 UTC: integration 8e5a87b3 (K landed: f64, register allocation, recompile)

Same host, tools and versions as the baseline section; branch `claude/project-thread-6ys4ab`
fast-forwarded to integration `8e5a87b3` (which contains the tools). Engine and shell rebuilt
from it. Raw files: [`jit-scorecard-results/2026-11-17-8e5a87b3/`](jit-scorecard-results/2026-11-17-8e5a87b3/).
Startup, RSS, size, warmup and micros were not rerun (K changes no engine or shell startup path).

### Kernels

Median ns per inner iteration over 7 processes, then the ratio to v8-jit / jsc-jit. Baseline
silkjs-jit value in brackets.

| Kernel | silkjs | silkjs-jit | v8-jit | jsc-jit | silkjs-jit outcome |
|---|---:|---:|---:|---:|---|
| sum-calls | 6.98 (14.3/9.9) | **2.37 (4.9/3.4)** [3.47] | 0.49 | 0.71 | compiled; 683 code bytes (989 before); 62.1% of instructions in compiled code |
| sum-long | 10.03 | 9.89 (9.6/13.3) [10.22] | 1.03 | 0.74 | never hot (needs OSR) |
| nested | 9.38 | **2.89 (4.8/2.5)** [11.43] | 0.60 | 1.14 | now compiled; 19,000 runs, 1,708 polls; 64.4% compiled |
| calls | 22.31 | 24.33 (37.5/27.0) [23.16] | 0.65 | 0.90 | refused: `get_var` |
| method | 30.73 | 31.32 (34.3/19.7) [31.26] | 0.91 | 1.59 | refused: `get_field2` |
| doubles | 16.41 | **5.43 (3.3/2.8)** [16.97] | 1.66 | 1.97 | now compiled (f64); 99,000 runs, 984 polls; 69.8% compiled |
| array-sum | 11.09 | 11.21 (16.6/15.6) [10.30] | 0.68 | 0.72 | refused: `get_arg_length8` |
| typed-array | 41.69 | 42.92 (42.0/44.7) [44.59] | 1.02 | 0.96 | refused: `get_var` |

Three kernels now compile, each about 3x faster than the interpreter, and they are 2.5x to 4.9x
behind the JITs. No deopts anywhere. The compiled share fell on sum-calls (76.7% to 62.1%)
because the compiled loop now executes fewer instructions; the rest is the interpreter's outer
loop and call entry. `calls` is 9% slower in the JIT column with nothing compiled (ranges
[240.2, 250.7] against [221.3, 244.9]); with no compiled code involved this is most likely code
layout, not yet checked with instruction counts.

### Octane 2

| Engine | best round | median round | worst round |
|---|---:|---:|---:|
| silkjs | 5955 | 5797 | 5605 |
| silkjs-jit | 6048 | 5853 | 5381 |
| v8-jitless | 4704 | 4555 | 4355 |
| jsc-nojit | 3507 | 3412 | 3284 |
| qjs | 3182 | 3114 | 3014 |
| v8-jit | 56750 | 54900 | 52397 |
| jsc-jit | 55311 | 52633 | 49425 |

silkjs-jit/silkjs, geometric mean of per-benchmark medians: 1.010 (baseline 0.983). This round
was noisier: per-benchmark ratios run from 0.920 to 1.177, and NavierStokes (1.177) and
SplayLatency (0.927) move although nothing in them compiles, so differences under about 10% are
noise here. Box2D is again slower with the JIT (0.920, ranges do not overlap), the cost found in
the baseline (callers of linked functions take the arguments path); it is unchanged by K.

### Coverage

Octane rows and kernels (the v8bench rows match their Octane rows; see `coverage.log`).

| Benchmark | hot | compiled | refused | runs | deopts | polls | compiled instr | top refusals |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| octane/richards | 16 | 0 | 16 | 0 | 0 | 0 | 0.0000% | `push_this` 16 |
| octane/deltablue | 39 | 0 | 39 | 0 | 0 | 0 | 0.0000% | `push_this` 36; `get_arg_field8` 1; `get_var` 1 |
| octane/crypto | 25 | 0 | 25 | 0 | 0 | 0 | 0.0000% | `push_this` 18; `get_var` 5; `get_arg_length8` 1 |
| octane/raytrace | 25 | 0 | 25 | 0 | 0 | 0 | 0.0000% | `push_this` 14; `get_var` 8; `push_atom_value` 1 |
| octane/earley-boyer | 49 | 0 | 49 | 0 | 0 | 0 | 0.0000% | `get_var` 20; a function scope: invalid 8; `if_not_null8` 5 |
| octane/regexp | 2 | 0 | 2 | 0 | 0 | 0 | 0.0000% | `get_scope0` 1; `put_field` 1 |
| octane/splay | 14 | 0 | 14 | 0 | 0 | 0 | 0.0000% | `push_this` 7; `get_var` 4; `get_scope0` 2 |
| octane/navier-stokes | 3 | 0 | 3 | 0 | 0 | 0 | 0.0000% | `get_scope0` 3 |
| octane/pdfjs | 55 | 0 | 55 | 0 | 0 | 0 | 0.0000% | `push_this` 30; `get_scope0` 12; `get_var` 3 |
| octane/mandreel | 48 | 0 | 48 | 0 | 0 | 0 | 0.0000% | `get_var` 48 |
| octane/gbemu | 120 | 0 | 120 | 0 | 0 | 0 | 0.0000% | `get_arg_field8` 74; `push_this` 25; `get_field2` 16 |
| octane/code-load | 8 | 0 | 8 | 0 | 0 | 0 | 0.0003% | `get_var` 3; `fclosure8` 1; `push_atom_value` 1 |
| octane/box2d | 122 | 4 | 118 | 208401 | 0 | 0 | 0.0213% | `push_this` 98; `get_scope0` 9; `is_undefined` 6 |
| octane/zlib | 15 | 0 | 15 | 0 | 0 | 0 | 0.0000% | `put_arg` 15 |
| octane/typescript | 332 | 1 | 331 | 68325 | 0 | 0 | 0.0016% | `push_this` 266; `get_arg_field8` 29; `get_scope0` 16 |
| kernel/sum-calls | 1 | 1 | 0 | 199000 | 0 | 1979 | 62.1470% | - |
| kernel/sum-long | 0 | 0 | 0 | 0 | 0 | 0 | 0.0000% | - |
| kernel/nested | 1 | 1 | 0 | 19000 | 0 | 1708 | 64.4036% | - |
| kernel/calls | 1 | 0 | 1 | 0 | 0 | 0 | 0.0000% | `get_var` 1 |
| kernel/method | 1 | 0 | 1 | 0 | 0 | 0 | 0.0000% | `get_field2` 1 |
| kernel/doubles | 1 | 1 | 0 | 99000 | 0 | 984 | 69.8342% | - |
| kernel/array-sum | 1 | 0 | 1 | 0 | 0 | 0 | 0.0000% | `get_arg_length8` 1 |
| kernel/typed-array | 1 | 0 | 1 | 0 | 0 | 0 | 0.0000% | `get_var` 1 |

Refusals over all rows: `push_this` 602, `get_var` 134, `get_arg_field8` 107, `get_scope0` 50,
a function scope: invalid 26, `get_field2` 25, `put_arg` 17, `put_field` 11, `get_arg_length8`
11. K's integer bit operations removed the first refusal of every hot zlib and mandreel function,
which now stop one opcode later: zlib at `put_arg` (all 15), mandreel at `get_var` (all 48,
up from 10). Still at most 0.021% of any Octane benchmark's instructions run compiled (Box2D).
`push_this` (J) remains the reason that blocks the most functions; `get_var` (H) is second and
now blocks all of mandreel.

## 2026-11-17 05:56 UTC: integration 34c3ae88 (H landed: compiled calls, `--jit-calls`)

Same host and versions. Branch merges integration `34c3ae88` (`d235d8d`) and adds a
`silkjs-jit-calls` column: `silkjs-jit-shell --jit --jit-calls` (harness, `jit_kernels.py`;
`jit_coverage.py --flags=--jit-calls`). Raw files:
[`jit-scorecard-results/2026-11-17-34c3ae88/`](jit-scorecard-results/2026-11-17-34c3ae88/).
The first `bench-octane` attempt refused to measure because a leftover `silkc task` process (from
compiling the edited task) was alive; it was rerun after that process exited. Nothing else ran.

### Kernels

Median ns per inner iteration over 7 processes (ratio to v8-jit / jsc-jit).

| Kernel | silkjs | silkjs-jit | silkjs-jit-calls | v8-jit | jsc-jit | outcome |
|---|---:|---:|---:|---:|---:|---|
| sum-calls | 6.75 | **1.91 (3.4/2.8)** | 1.87 | 0.56 | 0.69 | compiled, 73.1% of instructions compiled |
| sum-long | 9.88 | 9.56 | 9.78 | 1.06 | 0.73 | never hot |
| nested | 10.52 | **2.54 (4.1/2.2)** | 2.50 | 0.62 | 1.15 | compiled, 65.3% |
| calls | 23.78 | 26.21 | 25.80 | 0.61 | 0.92 | refused (`add` is a leaf, never hot; `loop` refused) |
| method | 29.93 | 30.24 | **73.94 (80.3/51.8)** | 0.92 | 1.43 | --jit-calls compiles both functions: 19.8M compiled runs, 0 deopts, 31.2% compiled, 2.4x slower than the interpreter |
| doubles | 16.68 | **5.01 (2.9/2.4)** | 5.10 | 1.72 | 2.05 | compiled, 78.2% |
| array-sum | 11.70 | 10.52 | 10.39 | 0.68 | 0.73 | refused |
| typed-array | 42.71 | 43.30 | 43.07 | 1.13 | 0.95 | refused |

### Box2D, independently

Callgrind, 3 fixed iterations ([`box2d-instructions.log`](jit-scorecard-results/2026-11-17-34c3ae88/box2d-instructions.log)):
no flag 2,508.1M; `--jit --jit-threshold=100000000` 0.9978x; `--jit` 1.0008x (nothing compiled:
the two small functions that cost +4.3% in the baseline now need `--jit-calls`); `--jit
--jit-calls` 1.0134x (3 compiled, 48,133 runs). Splay: `--jit` 1.0001x, `--jit --jit-calls`
1.0118x (8 compiled, 56 deopts, 7 unlinked, 3 recompiled). So the baseline regression is gone in
the default `--jit` configuration (CONFIRMED by instruction count); the wall-time Octane line below
(Box2D silkjs-jit 1.109x) is noise in the other direction, since nothing compiles there.

### Octane 2

| Engine | best round | median round | worst round |
|---|---:|---:|---:|
| silkjs | 5961 | 5763 | 5568 |
| silkjs-jit | 6010 | 5829 | 5569 |
| silkjs-jit-calls | 5447 | 5287 | 5150 |
| v8-jitless | 4638 | 4464 | 4285 |
| jsc-nojit | 3479 | 3385 | 3259 |
| qjs | 3197 | 3056 | 2924 |
| v8-jit | 55923 | 52964 | 51068 |
| jsc-jit | 54695 | 51590 | 48998 |

Geometric mean of per-benchmark medians against silkjs: silkjs-jit 1.012 (noise), silkjs-jit-calls
0.917. With `--jit-calls`, DeltaBlue drops to 0.384 (778 to 819 against 2017 to 2112) and
Richards to 0.857, the two benchmarks where it compiles the most (9.1% and 1.3% of instructions
in compiled code). Like the method kernel, compiled code that calls back into the engine is
currently slower than interpreting it, so `--jit-calls` is right to stay off by default.

### Coverage

| Benchmark | --jit hot / compiled | --jit compiled instr | --jit-calls compiled | runs | deopts | unlinked | --jit-calls compiled instr | top refusals with --jit-calls |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| octane/richards | 22 / 0 | 0.0000% | 1 | 3725696 | 0 | 0 | 1.3000% | `get_var` 5; `put_field` 5; `if_not_nullish8` 3 |
| octane/deltablue | 39 / 0 | 0.0001% | 9 | 20944894 | 16 | 2 | 9.1411% | `get_var` 20; `put_field` 6; deoptimized again where it was already widened 1 |
| octane/crypto | 25 / 0 | 0.0000% | 2 | 258786 | 0 | 0 | 0.0316% | `get_var` 9; `get_loc_el8` 4; `put_field` 4 |
| octane/raytrace | 25 / 0 | 0.0000% | 4 | 179448 | 24 | 3 | 0.0920% | `get_var` 18; `put_field` 3; `push_atom_value` 1 |
| octane/earley-boyer | 49 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | `get_var` 20; a function scope: invalid 8; `if_not_null8` 5 |
| octane/regexp | 2 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | `get_scope0` 1; `put_field` 1 |
| octane/splay | 14 / 0 | 0.0000% | 18 | 391340 | 136 | 17 | 0.1499% | `get_var` 7; `get_scope0` 2; deoptimized again where it was already widened 2 |
| octane/navier-stokes | 3 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | `get_scope0` 3 |
| octane/pdfjs | 55 / 2 | 0.0000% | 2 | 10820 | 0 | 0 | 0.0000% | `get_scope0` 15; `get_var` 7; `push_atom_value` 7 |
| octane/mandreel | 48 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | `get_var` 48 |
| octane/gbemu | 120 / 0 | 0.0000% | 1 | 25504 | 0 | 0 | 0.0081% | `put_field` 61; `get_array_el2` 41; `get_array_el` 12 |
| octane/code-load | 8 / 0 | 0.0003% | 0 | 0 | 0 | 0 | 0.0003% | `get_var` 3; `fclosure8` 2; `push_atom_value` 1 |
| octane/box2d | 122 / 0 | 0.0000% | 7 | 243823 | 0 | 0 | 0.1723% | `get_scope0` 38; `is_undefined` 21; `put_field` 19 |
| octane/zlib | 15 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | `put_arg` 15 |
| octane/typescript | 332 / 0 | 0.0000% | 37 | 5615738 | 32 | 4 | 0.9110% | `get_scope0` 105; `put_field` 66; `get_var_ref` 32 |
| kernel/sum-calls | 1 / 1 | 73.1102% | 1 | 199000 | 0 | 0 | 73.1100% | - |
| kernel/sum-long | 0 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | - |
| kernel/nested | 1 / 1 | 65.3110% | 1 | 19000 | 0 | 0 | 65.3108% | - |
| kernel/calls | 1 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | `get_var` 1 |
| kernel/method | 1 / 0 | 0.0000% | 2 | 19841129 | 0 | 0 | 31.1741% | - |
| kernel/doubles | 1 / 1 | 78.1734% | 1 | 99000 | 0 | 0 | 78.1731% | - |
| kernel/array-sum | 1 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | `get_arg_length8` 1 |
| kernel/typed-array | 1 / 0 | 0.0000% | 0 | 0 | 0 | 0 | 0.0000% | `get_var` 1 |

Refusals without `--jit-calls` (all rows): `get_var` 237, `put_field` 186, `get_scope0` 171, a
call (needs `--jit-calls`) 74, `get_array_el2` 41, `get_array_el` 38, `get_var_ref` 30. With
`--jit-calls`: `get_var` 232, `put_field` 186, `get_scope0` 171, `get_array_el2` 41,
`get_array_el` 40, `get_var_ref` 35, `get_length` 26. `push_this` no longer appears
(INFERRED from the counts, not read in code: the translator now takes `this`), so methods now stop at their first property write (`put_field`) or
global read (`get_var`).

## 2026-11-17 10:37 UTC: integration 4e5e3dba (K round 2, I OSR, J objects, H native nested calls)

Same host and versions. Branch merges integration `4e5e3dba` (`20785a3b`, keeping J's versions
of `jit_coverage.py`, with `--calls` and deopt-site sums, and `jit_kernels.py`). The deopt-site
lines (`jit: deoptimized at:`) are not printed by the 4e5e3dba shell, so this section has deopt
counts but no deopt opcodes. Raw files:
[`jit-scorecard-results/2026-11-17-4e5e3dba/`](jit-scorecard-results/2026-11-17-4e5e3dba/).
This host ran about 15% faster this time (silkjs Octane 6832 against 5763), so compare columns
within this section, not absolute values across sections.

### Kernels

Median ns per inner iteration over 7 processes (ratio to v8-jit / jsc-jit).

| Kernel | silkjs | silkjs-jit | silkjs-jit-calls | v8-jit | jsc-jit | outcome (--jit) |
|---|---:|---:|---:|---:|---:|---|
| sum-calls | 5.42 | **1.03 (2.1/1.7)** | 1.05 | 0.49 | 0.62 | compiled + OSR, 67.6% compiled |
| sum-long | 9.86 | **2.24 (2.5/4.1)** | 2.52 | 0.90 | 0.54 | OSR now enters the long loop: 99.3% compiled |
| nested | 9.21 | **1.59 (2.8/1.2)** | 1.52 | 0.57 | 1.37 | 95.7% compiled |
| calls | 20.73 | 19.95 (33.4/20.8) | 18.66 (31.3/19.4) | 0.60 | 0.96 | needs --jit-calls; with it 10.1M runs, 9,988,091 direct calls, 48.7% compiled, still interpreter speed |
| method | 27.06 | 25.63 | 26.98 (32.1/19.3) | 0.84 | 1.40 | --jit-calls: compiled, 36.7% compiled, no longer 2.4x slower |
| doubles | 13.98 | **2.10 (1.2/1.2)** | 2.32 | 1.70 | 1.71 | 68.2% compiled; level with JSC, 1.2x V8 |
| array-sum | 9.31 | **5.39 (9.1/8.5)** | 4.67 | 0.59 | 0.63 | now compiled (J's element reads), 53.1% |
| typed-array | 33.48 | 36.86 (38.2/39.3) | 35.06 | 0.96 | 0.94 | compiles, then 24 deopts unlink 3 functions |

### Octane 2

| Engine | best round | median round | worst round |
|---|---:|---:|---:|
| silkjs | 7069 | 6832 | 6524 |
| silkjs-jit | 6595 | 6324 | 6012 |
| silkjs-jit-calls | 5893 | 5702 | 5295 |
| v8-jitless | 5394 | 5242 | 5017 |
| jsc-nojit | 4199 | 4032 | 3740 |
| qjs | 3733 | 3614 | 3458 |
| v8-jit | 63056 | 60125 | 55543 |
| jsc-jit | 61911 | 57486 | 54141 |

Geometric mean of per-benchmark medians against silkjs: silkjs-jit **0.926**, silkjs-jit-calls
0.835. The default JIT is now slower than the interpreter on Octane. Lines with non-overlapping
ranges: MandreelLatency 0.565, Mandreel 0.748, Gameboy 0.828, zlib 0.828, Box2D 0.864 (with
`--jit-calls`: DeltaBlue 0.406, Box2D 0.679, MandreelLatency 0.504).

The cause is compile time, MEASURED with callgrind on one fixed iteration
([`compile-cost.txt`](jit-scorecard-results/2026-11-17-4e5e3dba/compile-cost.txt)):

- zlib: 56.10G instructions without `--jit`, 83.66G with it (+49%). Engine instructions are the
  same (55.96G); the extra 27.6G are the compiler: `ssa_ownership` 14.64G, `ssa_translate` 8.58G,
  `ssa` 2.02G, `x64_backend` 0.70G. 85 OSR compilations produced 23.9 MB of code; 123 of the 125
  OSR runs deoptimized.
- mandreel: 23.21G to 35.93G (+55%), `ssa_ownership` 9.56G of the extra 12.7G; 121 OSR
  compilations, 22.5 MB of code, 158 of 160 OSR runs deoptimized.

So the ownership pass is superlinear on zlib's and mandreel's large functions, and OSR compiles
them repeatedly only to deopt almost every entry. Compiled code itself is under 0.04% of the
instructions on both.

### Coverage

`--jit` columns from `jit_coverage.py --instructions --kernels`; `--jit-calls` from the same with
`--calls`.

| Benchmark | hot / compiled | deopts / unlinked | OSR compiled / runs / deopts | compiled instr | --jit-calls: compiled, deopts / unlinked, compiled instr | top refusals (--jit) |
|---|---:|---:|---:|---:|---:|---|
| octane/richards | 26 / 0 | 0 / 0 | 4 / 32 / 32 | 0.0008% | 7, 24 / 3, 3.0308% | `if_not_nullish8` 9; `call_constructor` 8; a call (calls from compiled code need --jit-calls) 4 |
| octane/deltablue | 69 / 12 | 96 / 12 | 32 / 133 / 133 | 0.0013% | 159, 1088 / 136, 15.7770% | a call (calls from compiled code need --jit-calls) 28; `call_constructor` 15; deoptimized again where it was already widened 9 |
| octane/crypto | 57 / 11 | 64 / 8 | 65 / 166 / 165 | 0.1479% | 31, 216 / 27, 0.5996% | a call (calls from compiled code need --jit-calls) 16; deoptimized again where it was already widened 7; `call_constructor` 6 |
| octane/raytrace | 39 / 5 | 40 / 5 | 12 / 66 / 66 | 0.0009% | 19, 152 / 19, 0.0026% | `call_constructor` 24; a call (calls from compiled code need --jit-calls) 5; deoptimized again where it was already widened 2 |
| octane/earley-boyer | 69 / 2 | 16 / 2 | 30 / 96 / 96 | 0.0003% | 18, 144 / 18, 0.0005% | `instanceof` 24; a call (calls from compiled code need --jit-calls) 7; `if_not_null8` 6 |
| octane/regexp | 19 / 3 | 16 / 2 | 87 / 69 / 69 | 0.9620% | 5, 32 / 4, 0.9757% | `regexp` 12; a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| octane/splay | 65 / 5 | 24 / 3 | 52 / 389 / 389 | 0.1713% | 22, 144 / 18, 0.3227% | `call_constructor` 49; a call (calls from compiled code need --jit-calls) 6; `if_not_nullish8` 3 |
| octane/navier-stokes | 27 / 0 | 0 / 0 | 60 / 152 / 139 | 0.6791% | 3, 24 / 3, 0.6824% | `insert3` 7; `get_array_el3` 5; deoptimized again where it was already widened 4 |
| octane/pdfjs | 115 / 10 | 48 / 6 | 121 / 292 / 291 | 0.0051% | 63, 395 / 49, 0.1562% | a call (calls from compiled code need --jit-calls) 31; `array_from` 16; deoptimized again where it was already widened 12 |
| octane/mandreel | 113 / 27 | 192 / 24 | 148 / 262 / 257 | 0.0363% | 86, 607 / 75, 0.2007% | a call (calls from compiled code need --jit-calls) 33; `get_array_el2` 28; deoptimized again where it was already widened 14 |
| octane/gbemu | 207 / 62 | 295 / 24 | 152 / 577 / 449 | 1.2908% | 118, 683 / 68, 1.4290% | `get_array_el2` 60; a call (calls from compiled code need --jit-calls) 31; `insert2` 11 |
| octane/code-load | 29 / 6 | 40 / 5 | 23 / 3 / 2 | 0.0003% | 11, 56 / 7, 0.0003% | `special_object` 6; `get_var_ref` 5; `call_constructor` 4 |
| octane/box2d | 176 / 34 | 240 / 30 | 157 / 190 / 187 | 0.1577% | 76, 539 / 67, 0.1244% | a call (calls from compiled code need --jit-calls) 32; `is_undefined` 29; `call_constructor` 22 |
| octane/zlib | 37 / 0 | 0 / 0 | 104 / 157 / 156 | 0.0008% | 0, 0 / 0, 0.0008% | `put_arg` 28; deoptimized again where it was already widened 8; recompiled too often 1 |
| octane/typescript | 509 / 164 | 1256 / 156 | 131 / 258 / 242 | 0.5245% | 665, 5156 / 642, 0.6931% | a call (calls from compiled code need --jit-calls) 135; `get_var_ref` 67; `call_constructor` 47 |
| kernel/sum-calls | 4 / 1 | 0 / 0 | 3 / 1958 / 16 | 67.6125% | 2, 0 / 0, 67.5511% | a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| kernel/sum-long | 1 / 1 | 0 / 0 | 1 / 2000 / 0 | 99.3311% | 1, 0 / 0, 99.3310% | - |
| kernel/nested | 2 / 1 | 0 / 0 | 3 / 1798 / 2 | 95.6915% | 2, 0 / 0, 95.5802% | a call (calls from compiled code need --jit-calls) 1 |
| kernel/calls | 5 / 0 | 0 / 0 | 4 / 24 / 24 | 0.0001% | 2, 0 / 0, 48.6695% | a call (calls from compiled code need --jit-calls) 4; deoptimized again where it was already widened 1 |
| kernel/method | 5 / 0 | 0 / 0 | 4 / 24 / 24 | 0.0001% | 2, 0 / 0, 36.7112% | a call (calls from compiled code need --jit-calls) 2; `call_constructor` 2; deoptimized again where it was already widened 1 |
| kernel/doubles | 4 / 1 | 0 / 0 | 3 / 988 / 16 | 68.1536% | 2, 0 / 0, 67.9962% | a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| kernel/array-sum | 2 / 1 | 0 / 0 | 2 / 1997 / 3 | 53.0618% | 2, 0 / 0, 53.0462% | a call (calls from compiled code need --jit-calls) 1 |
| kernel/typed-array | 5 / 3 | 24 / 3 | 4 / 3 / 3 | 0.0002% | 4, 24 / 3, 0.0002% | recompiled too often 1; a call (calls from compiled code need --jit-calls) 1 |

Refusals with `--jit` (all rows): a call (needs `--jit-calls`) 420, `call_constructor` 304,
deoptimized again where it was already widened 125, `get_var_ref` 90, `get_array_el2` 88,
`instanceof` 55, `if_not_nullish8` 50, `put_arg` 50. With `--jit-calls`: `call_constructor` 304,
deoptimized again where it was already widened 265, `get_var_ref` 92, `get_array_el2` 77,
`instanceof` 53, recompiled too often 41. `get_var`, `put_field` and `get_scope0` (the top three
last time) are out of the top twelve. Compiled share rose most on deltablue with `--jit-calls` (15.8%), richards
(3.0%) and gbemu (1.3% default), but deopt churn is now large: typescript 1,256 deopts and 156
unlinked by default, 5,156 and 642 with `--jit-calls`.

## 2026-11-17 12:08 UTC: integration ea9965d0 (H constructors and cheaper entry, J inline field reads and transition stores)

Same host and versions. New in the tools: `jit_coverage.py` prints a compile-cost line per
benchmark (compile time from `--jit-stats`, code bytes, OSR compilations, runs and deopts, and
from callgrind the share of instructions in compiled code and in the JIT compiler's own
functions, matched by package in `silkjs-jit-shell.symbols`); [`jit_tables.py`](jit_tables.py)
turns the JSON into the tables below. Raw files:
[`jit-scorecard-results/2026-11-17-ea9965d0/`](jit-scorecard-results/2026-11-17-ea9965d0/).

### Kernels

| Kernel | silkjs | silkjs-jit | silkjs-jit-calls | v8-jit | jsc-jit |
|---|---:|---:|---:|---:|---:|
| sum-calls | 5.23 | 1.04 (2.3/1.7) | 1.03 | 0.46 | 0.60 |
| sum-long | 8.29 | 2.21 (2.3/4.0) | 2.20 | 0.97 | 0.55 |
| nested | 9.24 | 1.76 (3.0/1.6) | 1.76 | 0.58 | 1.11 |
| calls | 19.13 | 18.75 | 18.19 (27.5/22.9) | 0.66 | 0.80 |
| method | 26.29 | 27.16 | **19.75 (24.3/15.3)** | 0.81 | 1.29 |
| doubles | 12.41 | 2.11 (1.3/1.2) | 2.08 | 1.68 | 1.71 |
| array-sum | 9.56 | **3.06 (5.3/5.0)** | 3.28 | 0.58 | 0.61 |
| typed-array | 34.24 | 32.53 (33.5/36.2) | 32.47 | 0.97 | 0.90 |

Median ns per inner iteration, 7 processes (ratio to v8-jit / jsc-jit). New: array-sum 5.39 to
3.06 (inline element reads), method with `--jit-calls` now faster than the interpreter (19.75
against 26.29; it was 2.4x slower at 34c3ae88).

### Octane 2

| Engine | best round | median round | worst round |
|---|---:|---:|---:|
| silkjs | 7074 | 6848 | 6495 |
| silkjs-jit | 6717 | 6514 | 6206 |
| silkjs-jit-calls | 6143 | 5885 | 5585 |
| v8-jitless | 5603 | 5440 | 5302 |
| jsc-nojit | 4305 | 4213 | 4095 |
| qjs | 3829 | 3773 | 3645 |
| v8-jit | 65185 | 62027 | 59466 |
| jsc-jit | 62864 | 59014 | 56370 |

Against silkjs, geometric mean of per-benchmark medians: silkjs-jit 0.951 (0.926 at 4e5e3dba),
silkjs-jit-calls 0.859. Still below the interpreter, with non-overlapping ranges: MandreelLatency
0.568, Gameboy 0.808, Mandreel 0.867, Box2D 0.897, zlib 0.950. With `--jit-calls`: DeltaBlue
0.470, Box2D 0.687.

### Coverage and compile cost

`compiler instr` is the share of all executed instructions spent in the JIT compiler (callgrind,
fixed iterations); `compiled instr` the share in compiled code. Wherever the first is larger than
the second, the JIT costs more than it runs.

| Benchmark | hot / compiled / refused | deopts / unlinked | OSR compiled / runs / deopts | compile ms | code MB | compiled instr | compiler instr | top refusals |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| octane/richards | 26 / 0 / 26 | 0 / 0 | 4 / 32 / 32 | 1.7 | 0.01 | 0.001% | 0.193% | a call (calls from compiled code need --jit-calls) 11; `if_not_nullish8` 9; `is_undefined_or_null` 2 |
| octane/deltablue | 72 / 17 / 55 | 136 / 17 | 33 / 123 / 123 | 8.1 | 0.09 | 0.033% | 0.450% | a call (calls from compiled code need --jit-calls) 42; deoptimized again where it was already widened 7; `if_nullish8` 4 |
| octane/crypto | 56 / 10 / 46 | 52 / 6 | 62 / 159 / 158 | 28.5 | 0.71 | 0.185% | 2.104% | a call (calls from compiled code need --jit-calls) 20; deoptimized again where it was already widened 8; `perm3` 5 |
| octane/raytrace | 37 / 4 / 33 | 24 / 3 | 10 / 81 / 67 | 5.3 | 0.14 | 0.258% | 1.294% | a call (calls from compiled code need --jit-calls) 27; `throw` 2; `special_object` 1 |
| octane/earley-boyer | 68 / 2 / 66 | 16 / 2 | 29 / 93 / 93 | 6.1 | 0.06 | 0.000% | 0.090% | `instanceof` 25; a call (calls from compiled code need --jit-calls) 8; `if_not_null8` 6 |
| octane/regexp | 19 / 3 / 16 | 16 / 2 | 87 / 70 / 70 | 6.8 | 0.22 | 0.977% | 1.715% | `regexp` 12; a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| octane/splay | 58 / 4 / 54 | 24 / 3 | 46 / 343 / 343 | 31.5 | 0.90 | 0.171% | 0.849% | a call (calls from compiled code need --jit-calls) 48; `if_not_nullish8` 3; `throw` 2 |
| octane/navier-stokes | 27 / 2 / 25 | 0 / 0 | 60 / 152 / 139 | 30.7 | 1.39 | 0.941% | 12.538% | `insert3` 8; `get_array_el3` 5; deoptimized again where it was already widened 4 |
| octane/pdfjs | 113 / 10 / 103 | 48 / 6 | 116 / 272 / 271 | 55.6 | 1.07 | 0.005% | 5.795% | a call (calls from compiled code need --jit-calls) 34; `array_from` 16; deoptimized again where it was already widened 12 |
| octane/mandreel | 117 / 27 / 90 | 192 / 24 | 149 / 283 / 278 | 955.5 | 25.73 | 0.038% | 34.015% | a call (calls from compiled code need --jit-calls) 37; `get_array_el2` 29; deoptimized again where it was already widened 17 |
| octane/gbemu | 207 / 62 / 145 | 295 / 24 | 152 / 577 / 449 | 133.6 | 4.00 | 1.491% | 13.217% | `get_array_el2` 60; a call (calls from compiled code need --jit-calls) 31; `insert2` 11 |
| octane/code-load | 28 / 6 / 22 | 40 / 5 | 21 / 3 / 2 | 5.7 | 0.08 | 0.000% | 0.000% | `special_object` 8; a call (calls from compiled code need --jit-calls) 4; `for_in_start` 4 |
| octane/box2d | 165 / 30 / 135 | 198 / 24 | 132 / 178 / 173 | 76.7 | 3.78 | 0.205% | 23.731% | a call (calls from compiled code need --jit-calls) 54; `is_undefined` 28; `special_object` 16 |
| octane/zlib | 37 / 0 / 37 | 0 / 0 | 104 / 157 / 156 | 3240.7 | 33.78 | 0.001% | 32.176% | `put_arg` 28; deoptimized again where it was already widened 8; recompiled too often 1 |
| octane/typescript | 521 / 185 / 336 | 1397 / 172 | 131 / 244 / 222 | 214.7 | 5.91 | 0.839% | 12.567% | a call (calls from compiled code need --jit-calls) 217; `is_undefined_or_null` 29; `if_not_nullish8` 24 |
| kernel/sum-calls | 4 / 1 / 3 | 0 / 0 | 3 / 1958 / 16 | 0.9 | 0.00 | 67.410% | 0.215% | a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| kernel/sum-long | 1 / 1 / 0 | 0 / 0 | 1 / 2000 / 0 | 0.4 | 0.00 | 99.331% | 0.079% | - |
| kernel/nested | 2 / 1 / 1 | 0 / 0 | 3 / 1798 / 2 | 0.9 | 0.01 | 95.665% | 0.493% | a call (calls from compiled code need --jit-calls) 1 |
| kernel/calls | 5 / 0 / 5 | 0 / 0 | 4 / 24 / 24 | 0.5 | 0.00 | 0.000% | 0.015% | a call (calls from compiled code need --jit-calls) 4; deoptimized again where it was already widened 1 |
| kernel/method | 5 / 0 / 5 | 0 / 0 | 4 / 24 / 24 | 0.7 | 0.00 | 0.000% | 0.013% | a call (calls from compiled code need --jit-calls) 4; deoptimized again where it was already widened 1 |
| kernel/doubles | 4 / 1 / 3 | 0 / 0 | 3 / 988 / 16 | 0.6 | 0.00 | 67.947% | 0.497% | a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| kernel/array-sum | 2 / 1 / 1 | 0 / 0 | 2 / 1997 / 3 | 0.4 | 0.01 | 98.683% | 0.054% | a call (calls from compiled code need --jit-calls) 1 |
| kernel/typed-array | 5 / 3 / 2 | 24 / 3 | 4 / 3 / 3 | 1.4 | 0.03 | 0.000% | 0.089% | recompiled too often 1; a call (calls from compiled code need --jit-calls) 1 |

With `--jit-calls`:

| Benchmark | hot / compiled / refused | deopts / unlinked | compile ms | code MB | compiled instr | compiler instr | top refusals |
|---|---:|---:|---:|---:|---:|---:|---|
| octane/richards | 36 / 19 / 17 | 96 / 12 | 4.1 | 0.09 | 4.266% | 0.967% | `if_not_nullish8` 9; deoptimized again where it was already widened 4; `is_undefined_or_null` 2 |
| octane/deltablue | 213 / 186 / 27 | 1296 / 162 | 38.5 | 1.16 | 25.952% | 6.079% | deoptimized again where it was already widened 16; `if_nullish8` 5; a body too short to gain from compiling 3 |
| octane/crypto | 76 / 40 / 36 | 280 / 34 | 56.5 | 1.60 | 0.753% | 4.492% | deoptimized again where it was already widened 15; `perm3` 5; `step_arg8` 4 |
| octane/raytrace | 93 / 67 / 26 | 528 / 66 | 79.3 | 3.19 | 0.216% | 23.361% | deoptimized again where it was already widened 14; recompiled too often 7; `throw` 2 |
| octane/earley-boyer | 76 / 18 / 58 | 130 / 16 | 8.1 | 0.14 | 0.081% | 0.332% | `instanceof` 25; deoptimized again where it was already widened 11; `if_null8` 5 |
| octane/regexp | 18 / 5 / 13 | 32 / 4 | 7.3 | 0.24 | 0.974% | 1.948% | `regexp` 11; deoptimized again where it was already widened 1; recompiled too often 1 |
| octane/splay | 302 / 289 / 13 | 2280 / 285 | 274.9 | 11.64 | 0.397% | 12.259% | deoptimized again where it was already widened 5; `throw` 3; `if_not_nullish8` 3 |
| octane/navier-stokes | 27 / 5 / 22 | 24 / 3 | 38.8 | 1.59 | 0.945% | 12.087% | `insert3` 8; `get_array_el3` 5; deoptimized again where it was already widened 4 |
| octane/pdfjs | 146 / 72 / 74 | 459 / 57 | 51.9 | 1.68 | 0.177% | 8.060% | `array_from` 15; deoptimized again where it was already widened 15; `typeof_is_undefined` 7 |
| octane/mandreel | 151 / 88 / 63 | 607 / 75 | 1148.9 | 32.80 | 0.217% | 31.927% | `get_array_el2` 28; deoptimized again where it was already widened 18; recompiled too often 12 |
| octane/gbemu | 224 / 118 / 106 | 683 / 68 | 215.2 | 4.70 | 1.641% | 31.030% | `get_array_el2` 49; deoptimized again where it was already widened 12; `insert2` 11 |
| octane/code-load | 33 / 14 / 19 | 88 / 11 | 6.6 | 0.11 | 0.000% | 0.000% | `special_object` 7; deoptimized again where it was already widened 3; `fclosure8` 2 |
| octane/box2d | 216 / 119 / 97 | 858 / 106 | 351.9 | 11.52 | 0.153% | 63.992% | `is_undefined` 25; `special_object` 15; deoptimized again where it was already widened 15 |
| octane/zlib | 37 / 0 / 37 | 0 / 0 | 3573.7 | 33.78 | 0.001% | 32.198% | `put_arg` 28; deoptimized again where it was already widened 8; recompiled too often 1 |
| octane/typescript | 1268 / 1034 / 234 | 7892 / 979 | 1092.7 | 31.63 | 1.453% | 34.220% | deoptimized again where it was already widened 123; `is_undefined_or_null` 29; `if_not_nullish8` 24 |
| kernel/sum-calls | 2 / 2 / 0 | 0 / 0 | 0.5 | 0.00 | 67.348% | 0.279% | - |
| kernel/sum-long | 1 / 1 / 0 | 0 / 0 | 0.4 | 0.00 | 99.331% | 0.079% | - |
| kernel/nested | 2 / 2 / 0 | 0 / 0 | 0.9 | 0.01 | 95.554% | 0.566% | - |
| kernel/calls | 2 / 2 / 0 | 0 / 0 | 0.4 | 0.00 | 52.183% | 11.175% | - |
| kernel/method | 2 / 2 / 0 | 0 / 0 | 0.4 | 0.00 | 66.701% | 3.674% | - |
| kernel/doubles | 2 / 2 / 0 | 0 / 0 | 0.7 | 0.01 | 67.784% | 0.668% | - |
| kernel/array-sum | 2 / 2 / 0 | 0 / 0 | 0.6 | 0.01 | 98.644% | 0.079% | - |
| kernel/typed-array | 5 / 4 / 1 | 24 / 3 | 1.4 | 0.04 | 0.000% | 0.098% | recompiled too often 1 |

The compiler outweighs the compiled code on every Octane benchmark. The worst are mandreel (34.0%
of instructions compiling, 27.0 MB of code, 955 ms), zlib (32.2%, 35.4 MB, 3.2 s, with nothing
but OSR entries compiled: 156 of 157 OSR runs deopt), box2d (23.7%), gbemu (13.2%), typescript
(12.6%) and navier-stokes (12.5%). OSR runs deopt on almost every entry everywhere (2,576 of
2,767 over the 15 Octane rows).

Refusals (`--jit`): a call (needs `--jit-calls`) 723, deoptimized again where it was already
widened 118, `get_array_el2` 89, `instanceof` 57, `if_not_nullish8` 54, `put_arg` 53. Deopt sites
of recompiled functions, by opcode: `put_array_el` 116, `call_method` 80, `call2` 39, `add` 37,
`put_field` 29, `mul` 26.

## 2026-11-17 13:18 UTC: integration da86b81c (H machine-code leaf calls, J stores to a second shape and array appends)

Same host, versions and tools (plus J's "refused after deoptimizing at" table in
`jit_coverage.py`, empty in this run). Raw files:
[`jit-scorecard-results/2026-11-17-da86b81c/`](jit-scorecard-results/2026-11-17-da86b81c/).

### Kernels

| Kernel | silkjs | silkjs-jit | silkjs-jit-calls | v8-jit | jsc-jit |
|---|---:|---:|---:|---:|---:|
| sum-calls | 5.74 | 1.04 (2.3/1.8) | 1.05 | 0.45 | 0.59 |
| sum-long | 7.97 | 2.23 (2.5/4.2) | 2.20 | 0.90 | 0.54 |
| nested | 8.36 | 1.75 (3.0/1.3) | 1.75 | 0.58 | 1.35 |
| calls | 19.22 | 18.65 | **13.15 (22.4/16.7)** | 0.59 | 0.79 |
| method | 25.53 | 25.83 | **16.94 (17.7/13.3)** | 0.95 | 1.27 |
| doubles | 12.55 | 2.12 (1.3/1.2) | 2.12 | 1.60 | 1.70 |
| array-sum | 8.35 | 3.09 (5.1/4.5) | 3.13 | 0.61 | 0.68 |
| typed-array | 34.88 | 33.47 (32.8/35.5) | 33.28 | 1.02 | 0.94 |

With `--jit-calls`, calls and method are now clearly faster than the interpreter (13.15 against
19.22, 16.94 against 25.53) but still 17x to 22x behind V8. Without `--jit-calls` nothing changed
from ea9965d0 beyond noise.

### Octane 2

| Engine | best round | median round | worst round |
|---|---:|---:|---:|
| silkjs | 7141 | 6900 | 6678 |
| silkjs-jit | 6819 | 6611 | 6159 |
| silkjs-jit-calls | 6183 | 6010 | 5731 |
| v8-jitless | 5595 | 5428 | 5245 |
| jsc-nojit | 4246 | 4163 | 3957 |
| qjs | 3862 | 3761 | 3640 |
| v8-jit | 64587 | 61738 | 58822 |
| jsc-jit | 62917 | 61045 | 57393 |

Against silkjs: silkjs-jit 0.958 (0.951 at ea9965d0), silkjs-jit-calls 0.871 (0.859). Clearly
below with non-overlapping ranges: MandreelLatency 0.574, Mandreel 0.857, Gameboy 0.906, Box2D
0.907, Splay 0.914. With `--jit-calls`: DeltaBlue 0.557 (0.470 before), Box2D 0.707, Richards
0.902. The compile-cost picture is unchanged, so the default JIT stays below the interpreter until
the OSR backoff (I) and compile budget (K) land.

### Coverage and compile cost

| Benchmark | hot / compiled / refused | deopts / unlinked | OSR compiled / runs / deopts | compile ms | code MB | compiled instr | compiler instr | top refusals |
|---|---:|---:|---:|---:|---:|---:|---:|---|
| octane/richards | 26 / 0 / 26 | 0 / 0 | 4 / 32 / 32 | 1.3 | 0.01 | 0.001% | 0.193% | a call (calls from compiled code need --jit-calls) 11; `if_not_nullish8` 9; `is_undefined_or_null` 2 |
| octane/deltablue | 72 / 17 / 55 | 136 / 17 | 33 / 125 / 125 | 6.2 | 0.09 | 0.033% | 0.455% | a call (calls from compiled code need --jit-calls) 42; deoptimized again where it was already widened 7; `if_nullish8` 4 |
| octane/crypto | 58 / 10 / 48 | 56 / 7 | 66 / 164 / 162 | 24.7 | 0.76 | 0.185% | 2.079% | a call (calls from compiled code need --jit-calls) 22; deoptimized again where it was already widened 8; `perm3` 5 |
| octane/raytrace | 37 / 4 / 33 | 24 / 3 | 10 / 83 / 69 | 5.5 | 0.14 | 0.258% | 1.298% | a call (calls from compiled code need --jit-calls) 27; `throw` 2; `special_object` 1 |
| octane/earley-boyer | 66 / 1 / 65 | 0 / 0 | 29 / 166 / 99 | 5.3 | 0.06 | 0.000% | 0.091% | `instanceof` 25; a call (calls from compiled code need --jit-calls) 9; `if_not_null8` 6 |
| octane/regexp | 20 / 3 / 17 | 16 / 2 | 93 / 70 / 70 | 7.3 | 0.23 | 0.977% | 1.716% | `regexp` 13; a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| octane/splay | 62 / 5 / 57 | 24 / 3 | 49 / 361 / 361 | 28.9 | 0.97 | 0.171% | 0.849% | a call (calls from compiled code need --jit-calls) 51; `if_not_nullish8` 3; `throw` 2 |
| octane/navier-stokes | 27 / 2 / 25 | 0 / 0 | 60 / 152 / 139 | 29.8 | 1.39 | 0.941% | 12.531% | `insert3` 8; `get_array_el3` 5; deoptimized again where it was already widened 4 |
| octane/pdfjs | 115 / 10 / 105 | 48 / 6 | 118 / 280 / 279 | 32.4 | 1.08 | 0.005% | 5.793% | a call (calls from compiled code need --jit-calls) 34; `array_from` 17; deoptimized again where it was already widened 11 |
| octane/mandreel | 117 / 27 / 90 | 192 / 24 | 149 / 283 / 278 | 898.9 | 25.73 | 0.038% | 34.016% | a call (calls from compiled code need --jit-calls) 37; `get_array_el2` 29; deoptimized again where it was already widened 17 |
| octane/gbemu | 210 / 65 / 145 | 212 / 25 | 153 / 652 / 460 | 117.9 | 3.81 | 2.046% | 13.456% | `get_array_el2` 62; a call (calls from compiled code need --jit-calls) 30; `insert2` 11 |
| octane/code-load | 27 / 6 / 21 | 40 / 5 | 21 / 3 / 2 | 5.7 | 0.08 | 0.000% | 0.000% | a call (calls from compiled code need --jit-calls) 5; `for_in_start` 5; `special_object` 5 |
| octane/box2d | 162 / 29 / 133 | 171 / 21 | 128 / 171 / 167 | 76.2 | 3.74 | 0.205% | 23.734% | a call (calls from compiled code need --jit-calls) 54; `is_undefined` 27; `special_object` 16 |
| octane/zlib | 37 / 0 / 37 | 0 / 0 | 104 / 157 / 156 | 3227.8 | 33.78 | 0.001% | 32.177% | `put_arg` 28; deoptimized again where it was already widened 8; recompiled too often 1 |
| octane/typescript | 519 / 184 / 335 | 1388 / 172 | 129 / 246 / 229 | 219.0 | 5.89 | 0.839% | 12.578% | a call (calls from compiled code need --jit-calls) 216; `is_undefined_or_null` 29; `if_not_nullish8` 24 |
| kernel/sum-calls | 4 / 1 / 3 | 0 / 0 | 3 / 1958 / 16 | 0.4 | 0.00 | 67.410% | 0.215% | a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| kernel/sum-long | 1 / 1 / 0 | 0 / 0 | 1 / 2000 / 0 | 0.5 | 0.00 | 99.331% | 0.079% | - |
| kernel/nested | 2 / 1 / 1 | 0 / 0 | 3 / 1798 / 2 | 0.8 | 0.01 | 95.665% | 0.493% | a call (calls from compiled code need --jit-calls) 1 |
| kernel/calls | 5 / 0 / 5 | 0 / 0 | 4 / 24 / 24 | 0.5 | 0.00 | 0.000% | 0.015% | a call (calls from compiled code need --jit-calls) 4; deoptimized again where it was already widened 1 |
| kernel/method | 5 / 0 / 5 | 0 / 0 | 4 / 24 / 24 | 0.6 | 0.00 | 0.000% | 0.013% | a call (calls from compiled code need --jit-calls) 4; deoptimized again where it was already widened 1 |
| kernel/doubles | 4 / 1 / 3 | 0 / 0 | 3 / 988 / 16 | 0.5 | 0.00 | 67.946% | 0.497% | a call (calls from compiled code need --jit-calls) 2; deoptimized again where it was already widened 1 |
| kernel/array-sum | 2 / 1 / 1 | 0 / 0 | 2 / 1997 / 3 | 0.4 | 0.01 | 98.683% | 0.054% | a call (calls from compiled code need --jit-calls) 1 |
| kernel/typed-array | 5 / 3 / 2 | 24 / 3 | 4 / 3 / 3 | 1.6 | 0.03 | 0.000% | 0.089% | recompiled too often 1; a call (calls from compiled code need --jit-calls) 1 |

With `--jit-calls`:

| Benchmark | hot / compiled / refused | deopts / unlinked | compile ms | code MB | compiled instr | compiler instr | top refusals |
|---|---:|---:|---:|---:|---:|---:|---|
| octane/richards | 36 / 19 / 17 | 96 / 12 | 4.9 | 0.10 | 4.859% | 0.849% | `if_not_nullish8` 9; deoptimized again where it was already widened 4; `is_undefined_or_null` 2 |
| octane/deltablue | 151 / 128 / 23 | 803 / 100 | 37.8 | 0.96 | 31.577% | 5.489% | deoptimized again where it was already widened 13; `if_nullish8` 4; a body too short to gain from compiling 3 |
| octane/crypto | 72 / 37 / 35 | 264 / 33 | 49.6 | 1.41 | 0.752% | 4.880% | deoptimized again where it was already widened 13; `perm3` 7; `step_arg8` 4 |
| octane/raytrace | 94 / 68 / 26 | 536 / 67 | 77.2 | 3.38 | 0.216% | 23.543% | deoptimized again where it was already widened 14; recompiled too often 7; `throw` 2 |
| octane/earley-boyer | 74 / 17 / 57 | 114 / 14 | 8.9 | 0.15 | 0.081% | 0.347% | `instanceof` 24; deoptimized again where it was already widened 10; `if_null8` 5 |
| octane/regexp | 18 / 5 / 13 | 32 / 4 | 7.3 | 0.24 | 0.974% | 1.951% | `regexp` 11; deoptimized again where it was already widened 1; recompiled too often 1 |
| octane/splay | 302 / 289 / 13 | 2280 / 285 | 270.4 | 11.76 | 0.422% | 12.307% | deoptimized again where it was already widened 5; `throw` 3; `if_not_nullish8` 3 |
| octane/navier-stokes | 27 / 5 / 22 | 24 / 3 | 39.7 | 1.59 | 0.945% | 12.080% | `insert3` 8; `get_array_el3` 5; deoptimized again where it was already widened 4 |
| octane/pdfjs | 146 / 69 / 77 | 434 / 54 | 56.0 | 1.76 | 0.181% | 8.087% | `array_from` 17; deoptimized again where it was already widened 14; `typeof_is_undefined` 7 |
| octane/mandreel | 151 / 88 / 63 | 607 / 75 | 1239.6 | 32.89 | 0.222% | 31.933% | `get_array_el2` 28; deoptimized again where it was already widened 18; recompiled too often 12 |
| octane/gbemu | 217 / 113 / 104 | 534 / 63 | 185.0 | 4.46 | 2.074% | 31.280% | `get_array_el2` 49; deoptimized again where it was already widened 12; `insert2` 11 |
| octane/code-load | 33 / 13 / 20 | 80 / 10 | 6.1 | 0.12 | 0.000% | 0.000% | `special_object` 8; deoptimized again where it was already widened 3; `for_in_start` 3 |
| octane/box2d | 213 / 116 / 97 | 813 / 101 | 371.9 | 11.64 | 0.156% | 64.015% | `is_undefined` 25; `special_object` 15; deoptimized again where it was already widened 15 |
| octane/zlib | 37 / 0 / 37 | 0 / 0 | 3256.4 | 33.78 | 0.001% | 32.198% | `put_arg` 28; deoptimized again where it was already widened 8; recompiled too often 1 |
| octane/typescript | 1316 / 1085 / 231 | 8280 / 1030 | 1045.5 | 31.92 | 1.396% | 35.163% | deoptimized again where it was already widened 119; `is_undefined_or_null` 29; `if_not_nullish8` 24 |
| kernel/sum-calls | 2 / 2 / 0 | 0 / 0 | 0.5 | 0.01 | 67.345% | 0.282% | - |
| kernel/sum-long | 1 / 1 / 0 | 0 / 0 | 0.3 | 0.00 | 99.331% | 0.079% | - |
| kernel/nested | 2 / 2 / 0 | 0 / 0 | 0.9 | 0.01 | 95.551% | 0.568% | - |
| kernel/calls | 2 / 2 / 0 | 0 / 0 | 0.4 | 0.00 | 87.633% | 8.364% | - |
| kernel/method | 2 / 2 / 0 | 0 / 0 | 0.6 | 0.01 | 96.769% | 0.029% | - |
| kernel/doubles | 2 / 2 / 0 | 0 / 0 | 0.6 | 0.01 | 67.773% | 0.681% | - |
| kernel/array-sum | 2 / 2 / 0 | 0 / 0 | 0.5 | 0.01 | 98.643% | 0.080% | - |
| kernel/typed-array | 5 / 4 / 1 | 24 / 3 | 1.5 | 0.04 | 0.000% | 0.099% | recompiled too often 1 |

Refusals (`--jit`): a call (needs `--jit-calls`) 729, deoptimized again where it was already
widened 115, `get_array_el2` 91, `instanceof` 56, `if_not_nullish8` 53, `put_arg` 53, `array_from`
40. Deopt sites of recompiled functions: `put_array_el` 114, `call_method` 76, `call2` 43, `add`
37, `mul` 26, `put_field` 21.
