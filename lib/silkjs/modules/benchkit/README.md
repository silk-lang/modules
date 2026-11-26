# benchkit

The benchmark harness, in Silk. The `bench` tasks of [`../engine`](../engine/bench/README.md) and
[`../runtime`](../runtime/bench/README.md) are written with it: each module's `silk.toml` lists it
under `[dependencies]`. Imports from the task program determine when it is fetched and compiled.

| Module | What it holds |
| --- | --- |
| `kit` | Child processes started with a cleaned environment and measured with `wait4` (wall time, CPU time, peak RSS, page faults), text scanning, medians, result tables as JSON, and the checks before a measurement: no build running, the host idle, CPUs to pin to |
| `engines` | The engine comparison: setup of the reference engines, Octane, the micro benchmarks, fixed work, the report tables |
| `runtimes` | The runtime benchmarks against Bun: setup, the round loop and its report, peak memory, cold start, the offline build dependencies |

The harness is for Linux: it reads `/proc`, pins with `taskset` and installs with `apt-get`.
