# Runtime benchmarks

The runtime against Bun with its JIT off (`BUN_JSC_useJIT=0`), on the benchmarks Bun advertises:
`serve`, `node:http`, Express over HTTPS, WebSocket chat, Postgres (100k queries), SQLite,
`spawnSync`, `cat` of a 1 GB file and `setImmediate`. The tasks run from `modules/runtime`, on
Linux with at least 4 CPUs:

```sh
silk task build --release        # 10 to 14 minutes, about 8 GB
silk task bench-setup            # once: wrk, Postgres, Bun's bench folders and their installs,
                                 # the Northwind database, a TLS certificate, a 1 GB file
silk task bench                  # 6 interleaved rounds, about 20 minutes; prints medians
silk task bench-mem              # peak RSS of the non-server benchmarks, 3 rounds
silk task bench-cold             # cold start: wall, CPU, peak RSS, page faults; 30 runs per case
silk task bench-all              # the three above into one results directory, about 30 minutes
```

| Option | Meaning | Default |
| --- | --- | --- |
| `--rounds N` | Interleaved rounds; runs per case for `bench-cold` | 6, 3, 30 |
| `--runtime PATH` | The runtime executable | `$SILKJS_RUNTIME`, else `build/silkjs` |
| `--runtimes a,b` | Columns: `silkjs`, `bun_nojit`, `bun_nojit_smol`; `bench-cold` also takes `bun` (JIT on) | `$RUNTIMES`, else the three |
| `--out DIR` | Where results go | `<work>/results/<UTC time>` |
| `--work DIR` | The work directory `bench-setup` fills | `$SILKJS_BENCH_WORK`, else `build/bench` |
| `--force` | Measure although a build is running | off |

`silk task bench http sqlite` runs only those groups (`http ws pg sqlite spawn cat imm`, or a
benchmark name such as `node_http`); `silk task bench-cold hello esm` only those cases;
`silk task bench-setup cert bigfile` only those steps. `$BUN` selects the Bun executable; `bench-all`
also takes `--mem-rounds` and `--cold-runs`.

Results: `res.json` holds every sample, `results.csv` the medians with the server's peak RSS and
user and system microseconds per request, `mem.json` the peak RSS samples, `cold.json` and
`cold.txt` the cold start table.

## HTTP orders on the JIT embedding host and Node

The JIT embedding host and Node load the same ES module. From the repository root on Linux
with Python 3.11+ and two available CPUs, build the host, then run the benchmark while
the compiler is idle.

```sh
silk build --release --manifest-path modules/jit/embed-smoke/silk.toml
python3 modules/runtime/bench/jit_http.py --runtime build/llvm/x86_64-unknown-linux-gnu/release/silkjs-jit-embed-smoke \
  --node /absolute/path/node --json /tmp/http-orders.json
```

To measure compiled calls, add `--jit-calls` and use a separate JSON output file.
Use `--no-jit` for the interpreter baseline in the same host executable. The client verifies that its JIT counters stayed at zero. Node uses its default JIT in each comparison.

Each process runs the same `node:http` module. One client sends JSON orders with 64 line items by default (set `--items` to vary the payload),
checks each total and uses a single persistent loopback connection. Server and client
are pinned to separate CPUs. Each server has a single-CPU budget including its compiler threads.
Each of three rounds launches both engines, alternating order. Launch-to-first-response
includes fresh-process startup and the first verified order with ordinary OS file caching. After 1,200
warmup requests, three seconds of sequential request/response exchanges measure single-client
throughput. The latency interval schedules 400 arrivals at 100 orders/s. Latency starts
at each scheduled arrival so client-side backlog counts. The rate must be below half
the measured sequential throughput in every run. Set the same lower `--rate` for both
engines on a slower host.

The report includes times for all scheduled orders, per-process p99, CPU/request
during the throughput interval, high-water RSS before shutdown, binary and workload hashes
and JIT counters. Each SilkJS process must complete successfully. In JIT modes the client also verifies that compiled code ran.
Use a representative service and concurrent clients for a production capacity estimate.

## What the tasks hold fixed

The tasks are Silk all the way: `src/tasks.silk` calls the `runtimes` module of
[`../../benchkit`](../../benchkit), which starts and measures every process itself. It refuses to
measure otherwise:

- `BUN_OPTIONS` and `NODE_OPTIONS` are dropped. The cloud container exports `BUN_OPTIONS=--smol`,
  which makes Bun about 25% slower (and `cat` 7.9 s instead of 1.4 s); every Bun number before
  2026-11-14 had it. Only the `bun_nojit_smol` column sets it, to show what those numbers measured.
  The runtime rejects the container's `NODE_OPTIONS=--use-openssl-ca`. An ad hoc run needs
  `env -u BUN_OPTIONS -u NODE_OPTIONS`.
- silkjs runs with `SILKJS_PREPARSE_THREADS=0`, one thread.
- Servers run on CPU 0, `wrk` and the clients on CPUs 2 and 3.
- Every round runs each benchmark and runtime pair once in shuffled order, so host noise (about 8%
  of wall time) falls on all runtimes alike. Take several rounds.
- Nothing is measured while a compiler runs (`--force` overrides); a busy host gets a warning.

## Reading the numbers

- Compare server CPU (user microseconds per request) as well as requests per second.
- On Postgres, Bun uses its native `Bun.sql` while the runtime runs postgres.js.
- Bun's `console.time` writes to stderr.
- Valgrind never maps the heap image, so instruction counts of the runtime under Valgrind measure
  the slower start without it.

## Files

| Path | What it is |
| --- | --- |
| `../../benchkit/src/runtimes.silk` | The harness: setup, the round loop, the report, peak memory, cold start |
| `../../benchkit/src/kit.silk` | Measured child processes, the cleaned environment, the checks before a measurement |
| `scripts/` | The JavaScript programs the runtimes run: what is measured, not harness |
| `coldstart/cases/` | The cold start cases |

Express, the WebSocket chat, Postgres, SQLite and `cat` are Bun's own programs, from the `bench/`
folder of [oven-sh/bun](https://github.com/oven-sh/bun) at its current head; `bench-setup` prints
the commit. `scripts/q.mjs` runs Bun's SQLite queries from Bun's `bench/sqlite` folder.

Cold start runs each runtime through `/usr/bin/env`, as every recorded table did. Tables recorded
before 2026-11-15 came from a Python harness that started each process with `fork`: they count
about 180 more page faults per start, for every runtime alike. `res.json` names
the SQLite queries by the ids of `results.csv` (`sqlite_order`, ...).

## A network that blocks the build's downloads

`silk task build` downloads the C libraries it compiles. Where codeload.github.com, sqlite.org and
dist.libuv.org are blocked, prepared copies stand in:

```sh
silk task offline-deps --from DIR     # or SILKJS_OFFLINE_DEPS=DIR
```

It unpacks `runtime-native-prefix.tgz`, `runtime-sqlite-amalgamation.tgz`,
`runtime-zstd-nghttp2-system.tgz` (into `/usr`, as root) and `runtime-build-deps.tgz` from `DIR`,
fetches Brotli and libuv with git at the revisions `../native/*/silk.toml` pin, writes
`~/.silk/native-overrides.toml` and prints the build command. The tasks themselves are built with
the runtime's C libraries, so on such a network the first `silk task offline-deps` needs the
overrides already: write `native-overrides.toml` by hand once, or run the task from a checkout
where it is built.

Where the GitHub release API is blocked too, the Silk installer cannot list releases. The release
assets themselves download:

```sh
V=$(sed -n 's/^silk-version = "\(.*\)"/\1/p' ../../silk.toml); E=$(printf %s "$V" | sed 's/+/%2B/')
curl -fsSLo silk.tgz "https://github.com/silk-lang/silk/releases/download/v$E/silk-$E-x86_64-unknown-linux-gnu.tar.gz"
mkdir -p ~/.silk/toolchains/$V ~/.silk/bin && tar xzf silk.tgz -C ~/.silk/toolchains/$V --strip-components 1
cp ~/.silk/toolchains/$V/bin/silk ~/.silk/bin/ && echo "default = \"$V\"" > ~/.silk/settings.toml
# Silk's Clang and lld, one multicall binary
curl -fsSLo llvm.tgz https://github.com/silk-lang/silk/releases/download/llvm-23.1.5-silk.1/silk-llvm-23.1.5-silk.1-x86_64-unknown-linux-gnu.tar.gz
mkdir -p ~/.silk/llvm && tar xzf llvm.tgz -C ~/.silk/llvm --strip-components 1
(cd ~/.silk/llvm/bin && for n in clang clang++ ld.lld lld wasm-ld llvm-ar llvm-nm llvm-objcopy llvm-strip llvm-ranlib; do ln -sf llvm $n; done)
export PATH=~/.silk/bin:~/.silk/llvm/bin:$PATH SILK_CLANG=~/.silk/llvm/bin/clang
```
