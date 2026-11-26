# Octane on the integrated x86-64 release

On source `aa564dec`, the default JIT scored **5,646** to the interpreter’s **5,245** and Node/V8’s **55,783**. That is **7.7% above the interpreter and a 9.88× gap to V8** on the geometric mean of 15 throughput workloads. Compiled calls scored 5,616, 7.1% above the interpreter. [Raw scores, row medians, peak RSS samples, digests and checks](octane.json)

| Throughput workload | Interpreter | Default JIT | Compiled calls | Node/V8 | V8 / default |
| --- | ---: | ---: | ---: | ---: | ---: |
| Richards | 1,668 | 1,684 | 2,141 | 43,651 | 25.92× |
| DeltaBlue | 1,935 | 1,931 | 1,940 | 105,749 | 54.76× |
| Crypto | 2,141 | 5,371 | 5,276 | 48,786 | 9.08× |
| RayTrace | 5,380 | 5,333 | 5,154 | 108,778 | 20.40× |
| EarleyBoyer | 6,887 | 6,563 | 5,936 | 86,809 | 13.23× |
| RegExp | 2,821 | 2,830 | 2,250 | 10,294 | 3.64× |
| Splay | 7,269 | 7,514 | 7,481 | 27,997 | 3.73× |
| NavierStokes | 3,742 | 3,856 | 4,749 | 43,943 | 11.40× |
| PdfJS | 9,561 | 9,652 | 9,366 | 39,487 | 4.09× |
| Mandreel | 1,710 | 1,742 | 2,003 | 56,887 | 32.66× |
| Gameboy | 11,736 | 13,118 | 13,668 | 99,005 | 7.55× |
| CodeLoad | 40,364 | 40,016 | 40,513 | 35,904 | 0.90× |
| Box2D | 7,363 | 7,196 | 5,952 | 107,462 | 14.93× |
| zlib | 3,053 | 3,255 | 3,352 | 99,166 | 30.47× |
| Typescript | 18,283 | 18,241 | 15,687 | 68,773 | 3.77× |
| **Geometric mean** | **5,245** | **5,646** | **5,616** | **55,783** | **9.88×** |

| Latency score (higher is better) | Interpreter | Default JIT | Compiled calls | Node/V8 |
| --- | ---: | ---: | ---: | ---: |
| SplayLatency | 19,196 | 19,333 | 18,563 | 41,672 |
| MandreelLatency | 11,153 | 16,186 | 16,030 | 73,312 |

Both release executables were built from clean checkouts of the same source using the manifest commands in the receipt. The map from the first three columns to invocations is `silkjs-engine`, `silkjs-jit-shell --jit` and `silkjs-jit-shell --jit --jit-calls`. Node 24.19.0 used the harness’s global-script loader. The run used the repository’s official `bench-octane` task with the pinned Chromium Octane 2 revision `570ad1cc`. Each workload ran three rounds with one fresh process per mode in the table’s column order. The tables show the median of those rounds. The raw logs verify the executable, mode, workload, and zero exit status of every one of the 180 processes. Verification also required all 204 scores and 180 RSS samples to be present and positive.

The separate fixed-work correctness check passed all 45 fresh processes. The interpreter and both JIT modes ran the workload’s setup, fixed iterations and teardown checks. Both JIT outputs matched the interpreter for every group, including Gameboy and TypeScript. A separate untimed Crypto sample recorded native entries in both JIT modes. [Correctness gate](../../../../modules/engine/scripts/verify_jit_octane.py)

To reproduce, build the two release manifests from the repository root, set `SILKJS_ENGINE` and `SILKJS_JIT` to the resulting absolute binary paths, and set `NODE_REFERENCE` to the desired Node executable. From `modules/engine`, run `silk task bench-setup octane` and `silk task bench-octane --rounds 3 --engines silkjs,silkjs-jit,silkjs-jit-calls,v8-jit`. The task outputs all three samples in `octane.json`. Use the median of each throughput row, then take their geometric mean. [Harness](../../../../modules/benchkit/src/engines.silk)
