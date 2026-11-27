# Five engines, 23 November 2026

Shell: release `silkjs-jit-shell` at `8fbb7fa`. Node v22.23.5. Taken with
`modules/jit/prof/bench/five_engines.py --rounds 3 --cpu 2` (scale 20, median user CPU per run).
Raw numbers in `result.json`; Crypto alone with 15 rounds in `crypto-15-rounds.json`.

| Benchmark | Interpreter | Baseline | Optimizer | V8 | V8 jitless |
| --- | ---: | ---: | ---: | ---: | ---: |
| Richards | 687 | 652 | 141 | 94 | 886 |
| DeltaBlue | 1,184 | 1,189 | 451 | 176 | 1,408 |
| Crypto | 3,893 | 2,053 | **655** | 323 | 5,669 |
| RayTrace | 2,215 | 2,411 | 2,234 | 314 | 2,505 |
| EarleyBoyer | 1,705 | 2,056 | 1,721 | 402 | 1,754 |
| RegExp | 1,409 | 1,280 | 1,317 | 602 | 1,311 |
| Splay | 431 | 703 | 444 | 307 | 593 |
| NavierStokes | 1,500 | 1,205 | 1,037 | 223 | 2,512 |

Milliseconds. Crypto with 15 rounds: optimizer 637 against V8's 332 (1.92x); it was 1,597 at the
start of the Crypto work. DeltaBlue and NavierStokes run the same instructions as before it
(within 0.1%): their differences from 22 November are this VM's noise.

HTTP order service (`http_modes.py`, `http-modes.json`), CPU per verified order: interpreter
241.8 us, baseline 320.6, optimizer 359.5, V8 47.4, V8 without its JIT 147.3.
