# Five engines at 4d63333, 22 November 2026

Release `silkjs-jit-shell` at `4d63333`, Node v22.23.5, `modules/jit/prof/bench/five_engines.py
--rounds 5 --cpu 2` (scale 20, median user CPU), quiet 4-core Firecracker VM. Raw numbers in
`result.json`; the morning's table (`3ff51ae`) is in `../2026-11-22-five-engines/`.

| Benchmark | Interpreter | Baseline | Optimizer | V8 | V8 jitless | Optimizer / interpreter | Morning |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Richards | 799 | 593 | 147 | 75 | 870 | 5.43x | 5.35x |
| DeltaBlue | 1,382 | 1,254 | 402 | 132 | 1,500 | 3.44x | 3.34x |
| Crypto | 4,023 | 2,265 | 1,555 | 338 | 5,449 | 2.59x | 2.46x |
| RayTrace | 2,133 | 2,363 | 2,100 | 334 | 2,621 | 1.02x | 1.04x |
| EarleyBoyer | 1,814 | 2,229 | 1,776 | 437 | 1,776 | 1.02x | 1.08x |
| RegExp | 1,342 | 1,304 | 1,339 | 663 | 1,344 | 1.00x | 1.09x |
| Splay | 388 | 489 | 451 | 394 | 504 | 0.86x | 0.82x |
| NavierStokes | 1,367 | 1,034 | 1,059 | 211 | 2,629 | 1.29x | 1.30x |

Milliseconds. Geometric mean of optimizer over interpreter: 1.65x (morning 1.66x); the
optimizer is 3.1x behind V8 on the geometric mean. Single benchmarks move by up to 10%
between runs on this VM, so read the two columns of ratios as equal but for Crypto.
