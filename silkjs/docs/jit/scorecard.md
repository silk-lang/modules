# SilkJS engine scorecard

Measured 2026-11-16 (21:29 to 22:30 UTC) by one run of the engine-comparison harness. Every number
below was MEASURED on the host described here unless it says otherwise. The raw result files and
the full logs of every command are in [`scorecard-results/2026-11-16/`](scorecard-results/2026-11-16/).

**No JavaScript is JIT-compiled by SilkJS.** `silkjs` and `silkjs-wasm` are the bytecode
interpreter. The `v8-jit` and `jsc-jit` columns are the target the JIT programme aims at, shown
for context only. The fair comparison for today's SilkJS is with `v8-jitless`, `jsc-nojit` and `qjs`.

## Host

- Shared cloud VM (KVM guest), Ubuntu 24.04.5 LTS, Linux 6.18.44-fc-v470 x86_64.
- 4 vCPUs, `Intel(R) Xeon(R) Processor @ 2.10GHz`, one thread per core, AVX2 and AVX-512.
- 15.7 GiB RAM, no swap.
- Nothing else ran on the machine while measuring. The harness refuses to measure while a compiler
  runs, and it did not refuse. Other tenants of the physical host are not visible from inside
  the VM.

## Revisions and versions

| Column | What ran | Exact version |
| --- | --- | --- |
| `silkjs` | `build/llvm/x86_64-unknown-linux-gnu/release/silkjs-engine` from `cd modules/engine && silk build --release` (plain release build, not the PGO build) | lib-silkjs `42b98426b70b36c949369fb56167476f8523d130` (branch `claude/sweet-ptolemy-f5t7na`). The harness commit `20600651` changes no engine source. Silk `v0.1.0-dev.74+205aea3f5b2e`, Clang 22.1.8 (`ca7933e47d3a`) |
| `silkjs-wasm` | the same source built for `wasm32-unknown-unknown` by `bench/wasm/build.sh`, precompiled to `.cwasm`, run by wasmtime | same revision as `silkjs`, at `20600651` (which adds `HostInput.variableNames` to `bench/wasm/src/main.silk`, see below) |
| `v8-jitless`, `v8-jit` | `node --jitless` and `node`, official Linux x64 tarball | Node v24.22.3, V8 13.6.233.17-node.63 |
| `jsc-nojit`, `jsc-jit` | `/usr/bin/jsc --useJIT=false` and `/usr/bin/jsc` | Ubuntu package `libjavascriptcoregtk-bin` and `libjavascriptcoregtk-4.1-0` 2.52.6-0ubuntu0.24.04.1 (WebKitGTK 2.52.6) |
| `qjs` | C QuickJS `qjs`, built by `bench-setup` with its own Makefile | `bellard/quickjs` `e585640ffa2cf88ce7c2d587583c6fe15928ec2f` (VERSION 2026-06-04) |
| `qjs-wasm` | the same QuickJS built with wasi-sdk 33.0 (wasi-libc `161b3195fc25`), precompiled, run by wasmtime | as `qjs` |
| wasmtime | runner for both wasm columns | wasmtime 45.0.0 (`377cd917a` 2026-05-21) |
| Octane | `chromium/octane` shallow clone | `570ad1ccfe86e3eecba0636c8f932ac08edec517` |

Omissions: none. All eight columns ran every benchmark in every round.

The handoff names Node 22 for the differential harness, which is what this container has at
`/opt/node22`. The comparison harness asks for Node 24, so Node v24.22.3 was downloaded from
nodejs.org (SHA-256 checked against `SHASUMS256.txt`) and passed as `NODE_REFERENCE`.

## Commands

Run from `modules/engine` with `PATH="$HOME/.silk/bin:$PATH"`, `SILK_CLANG=$HOME/llvm-22.1.8/bin/clang`
and `NODE_REFERENCE=$HOME/node24/node-v24.22.3-linux-x64/bin/node`. Every exit status was RAN and
recorded.

| Command | Exit | Notes |
| --- | --- | --- |
| `silk test --manifest-path modules/jit/silk.toml --no-cache` (from the repo root) | 0 | `Tests  28 passed, 0 failed` |
| `python3 modules/jit/scripts/encodings.py --check` (from the repo root) | 0 | `src/asm_x64_fixtures.silk is current` |
| `silk build --release` | 0 | 5 m 41 s. The largest single process peaked at 3.08 GiB, from `ru_maxrss` of the children. That is not the sum over processes. |
| `silk task bench-setup` | 1 | Every step passed except `wasm`: `bench/wasm/src/main.silk:19:1: error[SEM0083] Invalid conformance: HostInput requires variableNames, which this implementation does not define`. Fixed in `20600651` (an empty list: the wasm host has no environment). |
| `silk task bench-setup wasm` | 0 | after that fix |
| `silk task bench-octane --jit` | 0 | 41 min, 3 interleaved rounds |
| `silk task bench-startup --jit` | 0 | new task, 30 measured starts per engine |
| `silk task bench-warmup --jit` | 0 | new task, richards and deltablue, 200 iterations, 3 rounds |
| `silk task bench-micro --jit` | 0 | 19 min, 3 interleaved rounds, 72 tests per engine and round |
| `silk task bench-report --native` | 0 | [`report.log`](scorecard-results/2026-11-16/report.log) |
| `silk task bench-report` | 0 | the table with the wasm columns, [`report-wasm.log`](scorecard-results/2026-11-16/report-wasm.log) |
| `silk task bench-report --spread` | 0 | new option: min, median and max over rounds, [`spread.log`](scorecard-results/2026-11-16/spread.log) |
| `python3 docs/jit/scorecard-results/2026-11-16/summary.py` | 0 | the geometric means below |

## What the harness gained

These are in `modules/benchkit/src/engines.silk` and `modules/engine/src/tasks.silk`:

- `bench-octane` also writes `octane-rss.json`, the peak RSS of every benchmark process. It is
  `ru_maxrss` from `wait4` on the `timeout` wrapper, which Linux reports as the larger of the
  wrapper's own peak and that of its waited-for child, so it is the engine process's peak.
- `bench-startup` runs an empty script (a 0-byte file) once per engine without measuring, so the
  binaries are in the page cache. It then runs `--rounds` (default 30) interleaved measured starts
  and records wall time, user+sys CPU time and peak RSS. It also records binary sizes: the
  executable as installed, a `strip -o` copy of it, the shared JavaScriptCore library that `ldd`
  finds for the jsc columns, and the `.wasm` and `.cwasm` modules for the wasm columns. Engines
  start their script directly, with no Node loader and no jsc clock shim.
- `bench-warmup` runs N timed iterations (default 200) of one Octane benchmark's `run()` in one
  process. The timing is inside the script: `preciseTime()` on jsc, `performance.now()` elsewhere.
  The rounds are processes, interleaved across engines. Each process yields: the first iteration;
  the "steady" time, which is the median of the last third of the iterations; their ratio; and
  the iterations and milliseconds until the first iteration within 10% of steady. Each of these
  is reported as min, median and max over the processes.
- `bench-report --spread` prints min, median and max over rounds for Octane, the Octane RSS and
  startup. For the micros it prints, per engine, the geometric mean over tests of max/min.

## Throughput: Octane 2

Score, higher is better: median of 3 rounds [min, max]. One process per benchmark, engine and
round. V8 runs Octane through the harness's global-script loader (`node -e <loader>`).

| Octane | silkjs | v8-jitless | jsc-nojit | qjs | silkjs-wasm | qjs-wasm | v8-jit | jsc-jit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Richards | 1698 [1668, 1763] | 1553 [1516, 1567] | 1416 [1382, 1423] | 1259 [1126, 1333] | 907 [906, 921] | 762 [753, 837] | 41127 [40721, 41300] | 45494 [44315, 47096] |
| DeltaBlue | 2105 [1898, 2343] | 1724 [1658, 1729] | 1193 [1126, 1242] | 1053 [988, 1144] | 1231 [1173, 1329] | 764 [757, 775] | 100678 [99428, 105643] | 67824 [65239, 70753] |
| Crypto | 2555 [2547, 2555] | 1553 [1460, 1608] | 1846 [1826, 1849] | 1383 [1362, 1446] | 1089 [1070, 1108] | 753 [714, 782] | 46827 [45466, 47172] | 56227 [55479, 58859] |
| RayTrace | 5156 [5113, 5914] | 4095 [4087, 4552] | 2476 [2166, 2534] | 1975 [1928, 2008] | 3013 [2827, 3044] | 1219 [1185, 1221] | 93609 [90797, 95903] | 155620 [142152, 161022] |
| EarleyBoyer | 7056 [6815, 7164] | 6581 [6559, 6803] | 3205 [3187, 3485] | 2616 [2545, 2681] | 3481 [3412, 3516] | 1729 [1676, 1738] | 68605 [66404, 71164] | 77691 [75347, 78375] |
| RegExp | 2979 [2892, 2994] | 2755 [2653, 2821] | 691 [642, 695] | 496 [491, 497] | 1334 [1249, 1387] | 289 [288, 294] | 9110 [9110, 9346] | 9110 [8819, 9446] |
| Splay | 6764 [6690, 6870] | 5729 [5370, 5855] | 4286 [4209, 4372] | 3525 [3240, 3663] | 3623 [3440, 3724] | 2711 [2603, 2741] | 26167 [25140, 26305] | 26631 [26134, 27226] |
| SplayLatency | 18828 [17448, 19420] | 8424 [8375, 8492] | 15528 [14943, 15557] | 8560 [8502, 9010] | 11138 [10358, 11411] | 7491 [7483, 7542] | 62347 [62022, 64157] | 51689 [51235, 51806] |
| NavierStokes | 4702 [4382, 4815] | 1903 [1895, 2044] | 2882 [2835, 2953] | 2581 [2428, 2730] | 1998 [1975, 2060] | 1537 [1461, 1550] | 46356 [45559, 46551] | 39800 [39692, 40068] |
| PdfJS | 10332 [9579, 10792] | 10125 [9707, 10537] | 6864 [6289, 7933] | 6667 [6587, 6874] | 5002 [4808, 5170] | 3729 [3652, 3971] | 39473 [38207, 41512] | 39174 [39058, 41979] |
| Mandreel | 1600 [1561, 1610] | 1337 [1316, 1370] | 1043 [1033, 1057] | 1118 [1107, 1145] | 824 [798, 850] | 654 [650, 671] | 47082 [46663, 49073] | 60054 [59935, 60353] |
| MandreelLatency | 9756 [9680, 9775] | 8172 [7989, 8378] | 4447 [4358, 4528] | 8336 [8254, 8640] | 4946 [4907, 5025] | 5005 [4960, 5188] | 71217 [68290, 71217] | 40530 [37767, 43350] |
| Gameboy | 12799 [12627, 13493] | 8814 [8372, 9042] | 7454 [7079, 7729] | 9273 [8676, 9525] | 6279 [6203, 6376] | 5249 [5199, 5472] | 85302 [84123, 98130] | 115094 [108780, 128172] |
| CodeLoad | 33343 [32445, 37449] | 36920 [36145, 37382] | 23288 [21823, 23461] | 16419 [15777, 16437] | 19465 [17880, 19503] | 10498 [9751, 10564] | 36320 [35424, 36476] | 31061 [31054, 33754] |
| Box2D | 8147 [7591, 8350] | 4812 [4766, 4813] | 6156 [5836, 6392] | 4316 [4224, 4433] | 3804 [3750, 4077] | 2590 [2475, 2670] | 116030 [104748, 121994] | 106164 [99321, 111150] |
| zlib | 3276 [3263, 3320] | 2618 [2590, 2628] | 2008 [1994, 2012] | 2408 [2325, 2441] | 1627 [1602, 1637] | 1385 [1384, 1397] | 85372 [84335, 86093] | 75952 [73575, 79015] |
| Typescript | 16399 [16061, 16529] | 20333 [19634, 20362] | 14438 [14035, 14597] | 13481 [13137, 13520] | 9910 [9841, 10168] | 8820 [8639, 8820] | 79891 [79098, 83941] | 75626 [69034, 77700] |

Geometric mean over the 17 score lines (from `summary.py`):

| Engine | best round | median round | worst round |
| --- | ---: | ---: | ---: |
| silkjs | 6249 | 6019 | 5810 |
| v8-jitless | 4819 | 4695 | 4572 |
| jsc-nojit | 3729 | 3626 | 3479 |
| qjs | 3346 | 3243 | 3126 |
| silkjs-wasm | 3169 | 3087 | 2986 |
| qjs-wasm | 2085 | 2036 | 1987 |
| v8-jit | 55659 | 53956 | 52625 |
| jsc-jit | 55342 | 53180 | 51383 |

From the best rounds, `bench-report --native` gives a geometric mean of silkjs/v8-jitless 1.30
and silkjs/jsc-nojit 1.68. silkjs is behind V8 jitless only on Typescript (0.81) and level with it
on CodeLoad (1.00). Against the JIT columns the median-round geometric mean is about 9.0x behind
V8 and 8.8x behind JSC (6019 against 53956 and 53180).

`SplayLatency` and `MandreelLatency` are Octane's own latency scores. Octane's `base.js` takes
the root mean square of per-operation pause samples that the benchmark records (Splay records
the time of each tree operation) and scales it against a reference. They are neither a GC-pause
measurement nor a p99. This scorecard reports no other latency figure.

Spread between rounds: 66 of the 136 engine and benchmark cells have max/min of 1.05 or less.
Seventy are wider, and twelve are above 1.13: jsc-nojit PdfJS 1.26, silkjs DeltaBlue 1.23, qjs
Richards 1.18, jsc-jit Gameboy 1.18, jsc-nojit RayTrace 1.17, v8-jit Gameboy 1.17, v8-jit Box2D
1.17, qjs DeltaBlue 1.16, silkjs RayTrace 1.16, silkjs CodeLoad 1.15, jsc-jit MandreelLatency 1.15
and silkjs-wasm DeltaBlue 1.13. Three rounds cannot tell a 10% difference between engines from
noise on those lines.

## Throughput: microbench.js

The full per-test table is in [`report-wasm.log`](scorecard-results/2026-11-16/report-wasm.log). The
per-round values are in [`micro.json`](scorecard-results/2026-11-16/micro.json).

- `bench-report --native` covers 72 tests. The geometric mean of silkjs/v8-jitless ns is 0.71,
  and silkjs is more than 3% slower on 4 tests. The geometric mean of silkjs/jsc-nojit is 0.61,
  with 7 slower tests.
- Engine ns divided by silkjs ns, geometric mean over the tests, best round each (`summary.py`;
  above 1 means silkjs is faster): v8-jitless 1.403, jsc-nojit 1.639, qjs 1.931, silkjs-wasm
  1.980, qjs-wasm 3.611, v8-jit 0.155, jsc-jit 0.155.
- Spread per engine, as the geometric mean over tests of max/min across the 3 rounds: silkjs
  1.069 (worst test 1.143), v8-jitless 1.091 (1.375), jsc-nojit 1.107 (1.755), qjs 1.080,
  silkjs-wasm 1.084, qjs-wasm 1.077, v8-jit 1.105 (1.364), jsc-jit 1.094 (1.278).
- Several JIT-column micro times are near 0 ns per operation, for example `float_to_string` on
  both. The optimizer probably removed the work, so the JIT micro ratios understate how far the
  interpreters are behind on real code. That cause is a hypothesis; it was not checked.

## Memory: peak RSS per Octane process (MB, median of 3)

| peak RSS MB | silkjs | v8-jitless | jsc-nojit | qjs | silkjs-wasm | qjs-wasm | v8-jit | jsc-jit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| richards | 24.6 | 49.9 | 25.6 | 4.3 | 74.2 | 24.3 | 60.5 | 72.9 |
| deltablue | 24.6 | 51.9 | 58.6 | 4.7 | 75.7 | 24.6 | 99.0 | 88.6 |
| crypto | 23.0 | 50.1 | 40.7 | 4.6 | 73.9 | 24.4 | 64.3 | 86.4 |
| raytrace | 22.9 | 56.4 | 58.3 | 4.3 | 73.3 | 24.2 | 77.9 | 97.6 |
| earley-boyer | 42.2 | 163.1 | 58.7 | 15.6 | 89.3 | 33.1 | 191.5 | 178.1 |
| regexp | 29.4 | 60.0 | 59.7 | 7.5 | 78.5 | 27.4 | 91.2 | 107.0 |
| splay | 136.9 | 514.7 | 63.3 | 112.9 | 181.4 | 115.0 | 480.3 | 189.9 |
| navier-stokes | 25.1 | 54.3 | 25.9 | 5.1 | 75.9 | 25.3 | 63.4 | 41.3 |
| pdfjs | 61.5 | 150.1 | 67.5 | 21.1 | 109.7 | 37.6 | 286.1 | 164.9 |
| mandreel | 96.5 | 95.3 | 121.3 | 57.8 | 163.8 | 79.3 | 123.4 | 236.9 |
| gbemu | 47.9 | 82.9 | 50.1 | 22.1 | 97.0 | 42.5 | 124.7 | 132.5 |
| code-load | 217.9 | 258.3 | 181.4 | 70.9 | 143.1 | 61.5 | 261.0 | 282.9 |
| box2d | 37.5 | 71.1 | 57.7 | 8.6 | 86.1 | 27.5 | 143.5 | 110.8 |
| zlib | 154.3 | 53.3 | 29.1 | 134.1 | 205.2 | 154.5 | 68.6 | 241.6 |
| typescript | 222.4 | 269.6 | 98.9 | 99.7 | 261.9 | 106.7 | 376.2 | 313.8 |

Geometric mean over the 15 processes (`summary.py`, MB): silkjs 54.4, v8-jitless 96.9, jsc-nojit
57.6, qjs 17.8, silkjs-wasm 108.5, qjs-wasm 43.1, v8-jit 132.5, jsc-jit 135.9. silkjs uses more
memory than C QuickJS on every benchmark: about 3x on the geomean, and 20 MB of that is already
there at startup (next section). On zlib silkjs (154 MB) and qjs (134 MB) are far above
V8 (53 MB) and JSC (29 MB). This is peak RSS only: it says nothing about when the memory was
used or how long collection took. The wasm columns include wasmtime and the mapped module.

## Startup of an empty script and binary size

30 measured starts per engine of a 0-byte script, with a warm page cache: min / median / max.
Sizes are in MiB (2^20 bytes), from one reading. "executable" is the file as installed: the
silkjs build output, the Node release binary, `/usr/bin/jsc`, the `qjs` that `make` built, and
wasmtime for the wasm columns. "stripped" is `strip -o` of it.

| startup / size | silkjs | v8-jitless | jsc-nojit | qjs | silkjs-wasm | qjs-wasm | v8-jit | jsc-jit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| empty wall ms | 3.00 / 3.44 / 5.22 | 22.00 / 26.71 / 34.99 | 7.91 / 8.57 / 15.65 | 1.87 / 2.10 / 2.71 | 8.97 / 9.96 / 12.79 | 7.11 / 7.85 / 12.14 | 22.49 / 26.67 / 34.41 | 8.04 / 8.92 / 11.80 |
| empty user+sys ms | 2.80 / 3.21 / 4.28 | 22.17 / 26.53 / 35.05 | 7.58 / 8.29 / 11.24 | 1.64 / 1.87 / 2.44 | 9.26 / 10.13 / 13.05 | 7.68 / 8.38 / 12.70 | 23.53 / 27.40 / 35.12 | 7.83 / 8.69 / 11.60 |
| empty peak RSS MB | 19.42 / 19.47 / 19.48 | 41.40 / 41.45 / 41.52 | 21.83 / 21.96 / 22.07 | 3.70 / 3.87 / 3.98 | 71.45 / 71.64 / 71.77 | 23.23 / 23.47 / 23.79 | 43.64 / 43.69 / 43.90 | 23.39 / 23.49 / 23.63 |
| executable MB | 21.97 | 121.01 | 0.35 | 9.18 | 64.41 | 64.41 | 121.01 | 0.35 |
| executable stripped MB | 21.62 | 103.68 | 0.35 | 2.75 | 51.56 | 51.56 | 103.68 | 0.35 |
| engine library MB | - | - | 30.60 | - | - | - | - | 30.60 |
| engine library stripped MB | - | - | 30.60 | - | - | - | - | 30.60 |
| cwasm module MB | - | - | - | - | 69.02 | 3.61 | - | - |
| wasm module MB | - | - | - | - | 19.80 | 1.38 | - | - |

The jsc shell is a 0.35 MB program over `libjavascriptcoregtk-4.1.so.0` (30.6 MB). That library
also loads the system ICU (`libicudata.so.74` and others), which is not counted. silkjs and qjs
are single static-ish executables. Node bundles V8, ICU data and libuv in its 121 MB binary. The
silkjs release binary is only 0.35 MB larger than its stripped copy, because its symbols are
written to a separate `silkjs-engine.symbols` file (2.2 MB).

Startup does not exercise the JIT. The `v8-jit` and `v8-jitless` lines measure the same thing, and
so do the two jsc lines.

## Warmup

Per-iteration milliseconds of one Octane `run()` over 200 iterations in one process. These were
measured by `bench-warmup` with its defaults. "steady" is the median of iterations 134 to 199.
"to steady" counts up to the first iteration within 10% of steady.

richards: median over 3 processes [min, max]

| | silkjs | v8-jitless | jsc-nojit | qjs | silkjs-wasm | qjs-wasm | v8-jit | jsc-jit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| first iteration ms | 2.26 [2.125, 2.435] | 2.892 [2.798, 3.714] | 3.181 [3.163, 3.419] | 2.941 [2.796, 3.273] | 4.243 [3.888, 4.365] | 4.203 [4.174, 4.389] | 2.801 [2.5, 3.015] | 2.911 [2.674, 3.345] |
| steady ms | 1.821 [1.769, 1.926] | 2.264 [2.185, 2.266] | 2.277 [2.244, 2.345] | 2.83 [2.747, 2.898] | 3.818 [3.43, 3.944] | 4.434 [4.287, 4.624] | 0.064 [0.062, 0.07] | 0.07 [0.068, 0.072] |
| first / steady | 1.241 [1.201, 1.264] | 1.277 [1.235, 1.699] | 1.41 [1.397, 1.458] | 1.015 [0.988, 1.192] | 1.112 [0.986, 1.273] | 0.974 [0.909, 0.99] | 43.386 [40.524, 44.005] | 40.708 [39.383, 47.923] |
| iterations to steady | 2 [2, 2] | 2 [2, 2] | 2 [2, 2] | 1 [1, 2] | 2 [1, 3] | 1 [1, 1] | 17 [17, 51] | 79 [63, 82] |
| ms to steady | 4.188 [3.882, 4.46] | 5.167 [5.087, 5.953] | 5.653 [5.55, 5.872] | 2.941 [2.796, 6.221] | 8.049 [3.888, 11.887] | 4.203 [4.174, 4.389] | 6.226 [6.037, 13.988] | 16.987 [16.354, 20.883] |

deltablue: median over 3 processes [min, max]

| | silkjs | v8-jitless | jsc-nojit | qjs | silkjs-wasm | qjs-wasm | v8-jit | jsc-jit |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| first iteration ms | 3.557 [3.394, 5.405] | 4.542 [4.536, 4.615] | 5.82 [5.381, 8.256] | 6.56 [6.497, 6.662] | 6.376 [5.943, 9.064] | 10.653 [8.674, 18.34] | 4.824 [4.154, 5.606] | 5.825 [5.569, 9.073] |
| steady ms | 2.803 [2.683, 2.812] | 3.578 [3.479, 3.661] | 4.352 [4.295, 4.387] | 5.813 [5.79, 6.2] | 4.924 [4.884, 4.983] | 8.704 [8.507, 8.721] | 0.117 [0.112, 0.193] | 0.173 [0.173, 0.176] |
| first / steady | 1.265 [1.265, 1.928] | 1.268 [1.261, 1.306] | 1.355 [1.227, 1.897] | 1.122 [1.058, 1.146] | 1.305 [1.192, 1.841] | 1.221 [0.997, 2.156] | 35.369 [29.03, 43.21] | 33.673 [32.191, 51.433] |
| iterations to steady | 2 [2, 20] | 2 [2, 3] | 2 [2, 12] | 2 [1, 2] | 2 [2, 4] | 3 [1, 3] | 43 [14, 87] | 46 [40, 126] |
| ms to steady | 6.414 [6.128, 89.725] | 8.5 [8.199, 11.969] | 10.346 [9.611, 67.92] | 12.506 [6.56, 12.991] | 11.655 [10.939, 31.088] | 30.219 [8.674, 40.211] | 19.954 [16.098, 33.272] | 22.651 [20.051, 54.957] |

Reading these:

- The interpreters reach steady within 1 to 3 iterations (one outlier process for silkjs on
  deltablue took 20). Their first iteration is 1.0x to 1.4x the steady one, which is lazy
  compilation of the benchmark functions plus caches warming.
- V8 and JSC with their JITs take 14 to 126 iterations, and their first iteration is 30x to 50x
  their steady one. Because each iteration is short, all of that fits in 6 to 55 ms of execution.
  In cumulative in-script time, V8 with JIT is ahead of silkjs after 2 iterations, and JSC with JIT after 2 or 3, in every process (computed from `warmup.json`).
- Limits: 200 iterations take V8 with JIT only about 13 to 25 ms of total work. A later tier could
  still change "steady" after that, so the JIT steady values are an upper bound on the true
  steady state. The 10% threshold is crossed by noise, which is why the iteration counts vary so
  much between processes. Process startup is not included (see the startup table).

## What to rerun to check this

```sh
cd modules/engine
silk build --release
silk task bench-setup
silk task bench-octane --jit
silk task bench-startup --jit
silk task bench-warmup --jit
silk task bench-micro --jit
silk task bench-report --native
silk task bench-report --spread
python3 ../../docs/jit/scorecard-results/2026-11-16/summary.py build/bench/results
```

On a different host only the ratios between columns are comparable, not the absolute numbers.

## Cross-check on a second host

The lead session reran part of this on a different container of the same kind (4 vCPUs, 15 GiB,
same Silk, Clang, Node v24.22.3 and jsc package) on 2026-11-16, with the harness merged at the
integration branch. All commands exited 0: `silk task bench-setup`, `bench-startup --jit`,
`bench-octane --jit richards deltablue splay`, `bench-warmup --jit richards`. MEASURED there:

| | this scorecard | second host |
| --- | ---: | ---: |
| Richards, best round, silkjs / v8-jitless / v8-jit | 1763 / 1567 / 41300 | 2160 / 1873 / 51467 |
| DeltaBlue, best round, silkjs / v8-jitless / v8-jit | 2343 / 1729 / 105643 | 2732 / 2116 / 107462 |
| Splay, best round, silkjs / v8-jitless / v8-jit | 6870 / 5855 / 26305 | 8345 / 7077 / 33428 |
| Empty script, silkjs wall ms, median | 3.44 | 3.25 |
| Empty script, silkjs peak RSS MB, median | 19.5 | 16.2 |
| Empty script, v8-jitless wall ms, median | 26.7 | 22.8 |
| Richards warmup, iterations to steady, median: silkjs / v8-jit / jsc-jit | see above | 2 / 18 / 108 |

Absolute scores are about 20 percent higher on the second host, so scores from two hosts must
not be compared with each other. The ratios between engines on one host agree (silkjs over
v8-jitless: 1.13, 1.36, 1.17 here against 1.15, 1.29, 1.18 there). The 3 MB difference in
SilkJS's empty-script RSS between hosts is unexplained.
