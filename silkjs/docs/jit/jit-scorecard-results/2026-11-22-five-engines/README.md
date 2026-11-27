# Five engines, 22 November 2026

Shell: release `silkjs-jit-shell` at `3ff51ae`. Node v22.23.5. Taken with
`modules/jit/prof/bench/five_engines.py --rounds 5 --cpu 2` (scale 20, median user CPU per run) on a
quiet 4-core Firecracker VM. Raw numbers in `result.json`.

| Benchmark | Interpreter | Baseline | Optimizer | V8 | V8 jitless | Optimizer on 21 Nov (`b5813cf3`) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Richards | 782 | 611 | 146 | 86 | 932 | 139 |
| DeltaBlue | 1,320 | 1,433 | **396** | 150 | 1,642 | 1,075 |
| Crypto | 4,377 | 2,188 | 1,776 | 331 | 6,221 | 1,676 |
| RayTrace | 2,302 | 2,655 | 2,222 | 306 | 2,779 | 2,364 |
| EarleyBoyer | 1,860 | 2,272 | 1,722 | 380 | 1,828 | 1,636 |
| RegExp | 1,482 | 1,346 | 1,358 | 632 | 1,365 | 1,291 |
| Splay | 304 | 363 | 371 | 338 | 458 | 425 |
| NavierStokes | 1,412 | 1,102 | 1,090 | 223 | 2,643 | 897 |

Milliseconds. The interpreter column ran 2% to 10% slower than on 21 November (Splay 18% faster),
so compare columns within one table, not across days. On this VM the clock does not follow
instruction counts closely: machine code runs at a lower IPC than the interpreter here. Under
callgrind DeltaBlue's optimizer is at 4.01x the interpreter's instructions; the clock gives 3.33x.

DeltaBlue moved from 1.15x to 3.33x the interpreter, and from 7.8x to 2.6x behind V8.
