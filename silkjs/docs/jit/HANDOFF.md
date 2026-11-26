# SilkJS JIT handoff

**Resume from the [21 November handoff](handoff-2026-11-21.md)** (baseline tier and optimizer, step 4 of the plan). The [19 November x86-64 handoff](handoff-2026-11-19.md) is older. It identifies the local milestone branch, the measured gap to V8, and the nested HTTP call to investigate next. The coordination history below starts on 16 November.

Updated 2026-11-16. Working branch: `claude/sweet-ptolemy-f5t7na`, based on `main` at `d1973537`.
It replaces `t3/jit-compiler-plan` (based on the older `86c3e4db`) as the coordination branch.

> **Current x86-64 assessment.** The milestone branch now emits direct x86 loads for statically addressed lexical reads at `aa564dec`. The 64-item order service handles 4,347 verified orders/s under the default JIT, against 4,247 under the interpreter and 9,440 under Node. The milestone review tracks the suite measurements and AOT follow-up. The HTTP experiments trace execution from the parser through the application listeners and measure the CPU cost of enabling compiled calls. [Milestone review](x86-milestone.md) · [HTTP experiments](jit-scorecard-results/2026-11-19-http-calls/README.md) · [Earlier pause record](pause-2026-11-18.md)

## Objective and standing constraints

Build an optional JIT that competes with V8 and JavaScriptCore on measured throughput, startup,
warmup, latency and memory. No result yet establishes JIT parity. Since 2026-11-17 one narrow
kind of function (integer arithmetic and loops, no calls) is compiled to x86-64 by the separate
`silkjs-jit-shell` executable; it does not move any benchmark yet.

- Interpreter-only SilkJS stays a first-class, easily embedded product. The engine does not import
  `modules/jit`; interpreter regressions are measured, not assumed away.
- The goal is better measured outcomes, not simplicity for its own sake. Tier count and memory
  model are decided by evidence.
- Ahead-of-time compilation must stay possible: relocatable code, serializable compiler inputs,
  runtime references through data-side tables.

## Starting from nothing

Nothing from the machine this was written on is needed or assumed: everything is in this branch
of `silk-lang/lib-silkjs`. No build output, log or toolchain carries over. On a fresh Linux x86-64
machine with at least 16 GB of RAM:

```sh
git clone --branch claude/sweet-ptolemy-f5t7na https://github.com/silk-lang/lib-silkjs
cd lib-silkjs

# Silk, at the version the workspace pins (silk.toml).
curl -fsSL https://raw.githubusercontent.com/silk-lang/silk/main/install.sh -o install-silk.sh
SILK_RELEASE='v0.1.0-dev.74+205aea3f5b2e' sh install-silk.sh
export PATH="$HOME/.silk/bin:$PATH"

# Clang 22.1.8 with llvm-mc. Silk rejects older Clang.
curl -fsSL https://raw.githubusercontent.com/silk-lang/silk/main/scripts/setup-linux-llvm.sh -o setup-llvm.sh
bash setup-llvm.sh "$HOME/llvm-22.1.8"
export SILK_CLANG="$HOME/llvm-22.1.8/bin/clang"

silk test --manifest-path modules/jit/silk.toml          # 28 tests, about 1 second
(cd modules/engine && silk build --release)              # about 5 minutes, 7.2 GiB peak
python3 modules/engine/scripts/differential.py --count 200
```

The Silk installer reads the GitHub release API of `silk-lang/silk`. An agent session therefore
needs `silk-lang/silk` reachable as well as `silk-lang/lib-silkjs`, and needs its user's
permission to attach it; a session with only `lib-silkjs` gets HTTP 403 from the installer.
`valgrind` is needed for the instruction-count benchmarks, Node for the `node` reference
configuration.

## State of each milestone

| Milestone | State |
| --- | --- |
| 1. Foundational validation | Done. Two native tests fail, on `main` too (see below) |
| 2. Scorecard | Done: [scorecard.md](scorecard.md), measured 2026-11-16, with startup, peak RSS, binary size and warmup added to the harness |
| 3. Differential harness | Done for the interpreter: widened generator, per-area self-test, `silk task differential`, a step in `silk task check` |
| 4. Engine seam | Mapped in [tier-seam.md](tier-seam.md); per-function hotness counting with an embedder slot is in the engine. Hook design beyond that is open |
| 5. Machine-code foundations | x86-64 encoder and executable memory done for Linux x86-64 |
| 6. Feedback and ownership-aware SSA | Done: feedback recorder ([feedback.md](feedback.md)), SSA form and translator ([ssa.md](ssa.md)), first compiled function with deoptimization ([compiled-entry.md](compiled-entry.md)) |
| 7. Optimizations | Started 2026-11-17 in five sessions (see "Milestone 7") |

## The plan as recovered (milestone definitions)

Copied unchanged on 2026-11-16 from the earlier handoff on `t3/jit-compiler-plan` (`95a03c95`),
which the first version of this file had shortened to milestone names. This is the fullest
surviving statement of the plan: the original HTML plan was lost with its machine. Where the
work done so far falls short of these definitions it is listed after them.

The initial four-tier plan and immediate tracing-GC replacement were superseded in discussion. The subsequent direction was interpreter plus one SSA compiler with quick and full optimization modes, subject to measured warmup needs. Deopt to interpreter frames at bytecode boundaries; make ownership reconstruction part of the deopt design. The user did not mandate a permanent tier count or memory model.

1. **Finish foundational validation.** Correct overstated package docs; review the two saved commits; test memory permissions/lifetimes and the observed-dispatch option. Complete a bounded workspace check and relevant engine/runtime checks, recording commands and results. Integrate only validated changes.
2. **Establish a scorecard.** Extend existing benchmark tooling for configurable SilkJS, Node, d8, and JSC commands. Record versions, host, source revision, binary provenance, repetitions, throughput, warmup, startup, per-process peak RSS, binary size, and an explicitly labeled pause proxy. Missing engines are explicit omissions. Keep benchmark runs isolated from builds. A worst-iteration ratio is not a measured GC pause or p99 latency.
3. **Finish the differential harness.** Deterministic seeded programs; plain versus observed interpreter configurations; optional external reference engines; normalized output and exit classification; timeouts, reproducible failures, minimization, and explicit unsupported-case reporting. Generate stable hot calls followed by changed types/shapes/call targets. Add future JIT/deopt configurations through the same interface.
4. **Implement the engine seam.** Define hotness and native-entry hooks with zero/verified-minimal interpreter-only cost. Cover normal calls, leaf paths, constructors, loops, exceptions, and invalidation; do not serialize process-local pointers. Prove frame and ownership contracts before compiled JavaScript entry.
5. **Finish machine-code foundations.** Typed x64 operands and labels, relocation records, ABI handling, encoding comparisons against a real assembler, executable tests, and platform-gated extension points. One constant byte string is not an assembler.
6. **Add feedback and ownership-aware SSA.** Begin with call/type feedback; specify safepoints, guards, deoptimization state, native helper effects, and roots. Keep compiler inputs serializable for background compilation/AOT. Build a narrow end-to-end compiled function before broad optimization passes.
7. **Broaden optimizations from measurements.** Inlining, unboxed arithmetic, load/check elimination, register allocation, OSR, and allocation/RC optimizations. Evaluate background compilation, persisted profiles/code, cross-module optimization, and regexp compilation with correctness and performance gates.

The historical phase durations were estimates, not delivery commitments. Define progress through tests and measured gates.

### AOT context and historical artifacts

The original HTML plan at `/tmp/silkjs-jit-plan/silkjs-jit-plan.html` no longer exists on this VM. The design above was recovered from conversation and the saved notes at `/home/user/.claude/projects/-home-user-silkjs/memory/`.

Earlier Bun research cited [Bun PR 45631](https://github.com/oven-sh/bun/pull/45631), [WebKit PR 757](https://github.com/oven-sh/WebKit/pull/757), and [Bun AOT documentation](https://bun.com/docs/compiler/aot). Those sources and historical numerical claims were **not revalidated during this recovery**. The useful design hypotheses are immutable file-backed code, runtime data-side references, generic entry fallback, and opt-in closed-world assumptions. Preserve ordinary JS semantics by default. Do not assume static TypeScript annotations are sound runtime facts.

### Where the work so far falls short of these definitions

- Milestone 2: `d8` is not a column (V8 is measured through Node 24, with and without
  `--jitless`), and there is no pause proxy of any kind in the scorecard.
- Milestone 4: only hotness counting exists. It does not cover leaf paths, loops (back edges)
  or generator resumption, and there is no native-entry hook, no frame or ownership contract
  for compiled entry yet (in progress in milestone 6's sessions).
- Ahead-of-time compilation: nothing is implemented. What exists is the rule and two places
  that follow it: the encoder emits relocation records instead of addresses, and the hotness
  counter is not serialized with bytecode. No persisted code or profile format, no
  closed-world mode, and no plan for when AOT work starts has been written.

## What is on this branch

| Commit | Content |
| --- | --- |
| `2f2e2495` | The recovered handoff and research report (cherry-picked from `95a03c95`) |
| `f9825d88` | The `modules/jit` package with W^X executable memory (cherry-picked from `82349ee1`, adapted to `main`: package `silkjs-jit`, Silk dev.74) |
| `1827a101` | The hidden `--debug-observed` switch (cherry-picked from `c1c68890`) |
| `e801def7` | Code memory hardened and tested |
| `cc1ed33a` | The x86-64 encoder, its llvm-mc fixtures and executable tests |
| `b6ee60e6` | `modules/engine/scripts/differential.py` |

### Executable memory (`modules/jit/src/code_memory.silk`)

Reserve an inaccessible range, write into whole read-write pages, publish them read-execute, free
them. Publishing returns the pages the code did not reach and fills the rest of the last page
with `int3`; freeing gives the physical memory back with `MADV_DONTNEED`. Nine tests read
`/proc/self/maps` and `mincore`: no page is writable and executable at once, drops revoke
access, a block outlives its region owner, and exhaustion, fragmentation, overflow and empty
publication fail with documented codes. Each property was also checked by breaking the
implementation and seeing the test fail.

Known limit: a block takes at least one 4 KiB page. A compiler emitting many small functions must
batch them per writer and then frees them together. Whether that or a dual mapping is better for
memory and publish cost is not measured.

### x86-64 encoder (`modules/jit/src/asm_x64.silk`)

Typed registers and memory operands; integer moves, loads and stores of 1 to 8 bytes, the eight
two-operand arithmetic operations, `imul`, unary group, shifts, `setcc`, `cmovcc`, SSE2 scalar
doubles and conversions, jumps, calls, labels. External references are relocation records
(`Absolute64`, `Relative32`) applied by `Code.link(base, addresses)`, so assembled bytes contain no
process-local pointer.

`scripts/encodings.py` generates `src/asm_x64_fixtures.silk`: 1,717 encoder calls, each compared
with the bytes llvm-mc 22.1.8 assembles. All match. `src/asm_x64_tests.silk` runs assembled code,
including a call back into Silk through a relocation.

Not there: short (8-bit) jumps, AVX, 8/16-bit arithmetic, atomics, a frame layout, a register
allocator, arm64, macOS, Windows, unwind metadata, stack maps.

### Differential harness (`modules/engine/scripts/differential.py`)

One program per seed: functions called hot with stable types, then with changed types, shapes,
call targets and prototypes; a checksum is printed per phase. Configurations are command
templates (`plain`, `observed`, `node`, or `--config NAME=TEMPLATE`), so a JIT or deopt-stress
flag joins later through the same interface. Failing programs are written with seed and results
and reduced by deleting lines. A missing reference engine is reported as skipped.

Result on this branch: seeds 1..3000 agree across plain, `--debug-observed` and Node 22.23.4.
`--self-test` finds a planted disagreement in 3 of 40 programs and reduces 60 lines to 12.

Since `dfcd50a` the generator also covers closures (captured variables read and written, closures
made in loops), property and element writes inside the hot functions (shape-changing adds,
deletes, `length` writes), exceptions (thrown late in a hot loop through intermediate frames,
local catch and rethrow, `finally` overriding the result) and typed arrays (nine element kinds,
NaN, -0, out-of-range stores, an aliasing view). `--self-test` plants one source-level miscompile
per area and requires that it is found and minimized. `silk task differential` wraps the script,
and `silk task check` runs 200 programs, plain against observed, as its fifth step.

Limits: it does not generate generators, async code, getters or setters defined in hot functions,
Proxy, named writes on typed arrays, or strict mode. It found no bug, which says the two
interpreter loops agree on this slice, not that the slice is wide. `--debug-observed` is
confirmed to change the dispatch loop (the same script runs about 3x slower); that every path
enters observed dispatch is still not established. A JIT joins as
`--config jit='{engine} --jit {file}'`; it is not a reference engine, so any disagreement with
`plain` is a mismatch.

## Validation record

Rerun on 2026-11-16 by the lead session on a fresh 4-CPU, 15 GiB Linux x86-64 cloud container
(Silk 0.1.0-dev.74+205aea3f5b2e, Clang 22.1.8, Node 22.23.4), at `b4fbe1b` unless noted. Every
row was run there; the exit status is given. Logs were not kept beyond the session.

| Command | Exit | Result |
| --- | --- | --- |
| `silk test --manifest-path modules/jit/silk.toml` | 0 | 28 passed, 0 failed |
| `python3 modules/jit/scripts/encodings.py --check` | 0 | `src/asm_x64_fixtures.silk is current` |
| `silk build --release` in `modules/engine` | 0 | 5 m 33 s |
| native suite (command below) at `42b98426` | 1 | 562 passed, 2 failed, 13 m 10 s |
| native suite at `main` `d1973537` (separate worktree) | 1 | 562 passed, 2 failed, same two tests and messages |
| `python3 scripts/differential.py --self-test` | 0 | PASS: prototypes 9 of 40, closures 21, property writes 12, exceptions 34, typed arrays 8 |
| `python3 scripts/differential.py --count 3000 --configs plain,observed,node` | 0 | agree 3000, mismatch 0, reference-only 0 |
| `silk task differential --count 20` | 0 | agree 20 |
| `silk task bench-setup`, `bench-startup --jit`, `bench-octane --jit richards deltablue splay`, `bench-warmup --jit richards` (with the scorecard harness merged) | 0 | see the cross-check table in scorecard.md |
| `silk build --release` with the hotness hook merged | 0 | 4 m 35 s |
| `python3 scripts/v8bench.py --instructions BASE HOT` | 0 | ratios above; earley-boyer 1.008x |
| `python3 scripts/differential.py --count 500 --configs plain,observed,node` on the hook binary | 0 | agree 500 |
| `silk test --file src/js_hotness_tests.silk --optimization debug` | 0 | 1 passed (exit 1 with the hook broken) |
| `silk task check` on the hook binary | 1 | native suite 563 passed, 2 failed (the count is the 562 plus the new hotness test; `check.py` does not print the failing names); all 314 other steps PASS |

Not rerun by the lead: `silk check --workspace`.
The native suite needs `modules/engine/build/` to exist: without it `silk test ... -o
build/core-tests` exits 1 with `silk: cannot create temporary directory: not found`
(`mkdir -p build`, or run the release build first). `/usr/bin/time` is not installed on these
containers. Peak memory of the largest single process was 5.3 GiB for the native suite build
and 3.1 GiB for the release build (`getrusage`, one process, not the sum of the build's
processes; the 13.9 GiB and 7.2 GiB figures elsewhere in this file came from the earlier
machine and were not reproduced as totals).

### Two native tests fail on `main` as well

`silk test src/tests.silk -o build/core-tests --optimization speed --debug false` (step 1 of
`silk task check`) reports 562 passed, 2 failed, both in `js_for_in_tests`:

- `forInAllocationFailuresReleaseInputSnapshotsAndVisitedState`: fatal trap "QuickJS invariant
  violated" at `js_array_storage_test_support:32`.
- `forInFailSafeAndFastCompletionAreNotPermanentlyLatched`: assertion "iteration yields the
  independently expected property name" at `js_for_in_tests:141`.

The same command on untouched `main` at `d1973537` gives the same two failures with the same
messages (rerun by the lead session on 2026-11-16, both revisions on one machine), so they
predate this branch and are not caused by it. They are not fixed here, by decision: the
programme moves on without them.

## Operating notes for this kind of host

- One memory-heavy command at a time. The native test suite build peaks near 13.9 GiB, the release
  build at 7.2 GiB.
- `silk task` leaves a `silkc task` process (about 2.6 GiB, parent 1) after compiling the task
  program, and `silk test` and `silk build` leave a `silkc` too. The benchmark harness refuses
  to measure while it sees one. Kill it by PID before benchmarking.
- `silk check` can leave a `silkc check` process alive after its parent exits, reparented to init
  and holding about 4.8 GiB. Look for it with `ps` and kill it before the next heavy step. Several
  of these across worktrees would explain the memory pressure that stalled the previous VM; that
  link is a hypothesis.
- A second `silk check` on changed source once replayed a stale diagnostic in 0.00 s. `silk test
  --no-cache` did not. Treat a suspiciously instant check result as stale.
- Do not benchmark while a compiler runs.

## Scorecard (measured 2026-11-16)

[scorecard.md](scorecard.md) has the host, every engine version, the commands, the tables, the
spread between rounds and the raw results. The harness (`modules/benchkit`, `silk task`) gained
`bench-startup`, `bench-warmup`, per-process peak RSS in `bench-octane`, and
`bench-report --spread`. Headline, all measured on one host: Octane geometric mean of median
rounds silkjs 6019, v8-jitless 4695, jsc-nojit 3626, qjs 3243, v8-jit 53956, jsc-jit 53180, so
the JIT engines are about 9x ahead of the interpreter. Empty-script startup: silkjs 3.4 ms, qjs
2.1 ms, jsc 8.6 ms, node 26.7 ms. Octane peak RSS geometric mean: silkjs 54 MB, qjs 18 MB.
The JIT engines' first iteration is 20x to 50x slower than their steady state, yet they pass
SilkJS in cumulative time after 2 or 3 iterations. The lead reran startup, three Octane
benchmarks and the richards warmup on a second host: engine ratios agree, absolute scores were
about 20 percent higher there (table at the end of the scorecard). No GC pause or p99 figure
exists yet.

`silk task bench-setup` failed at its `wasm` step on dev.74 until `20600651` added
`HostInput.variableNames` to `bench/wasm/src/main.silk`. The comparison harness wants Node 24
(`NODE_REFERENCE`; v24.22.3 from nodejs.org was used), the differential harness used Node 22.

## Tier seam and the hotness hook

[tier-seam.md](tier-seam.md) lists, with file:line references at `42b98426`, every way a function
body starts executing, every back edge and its interrupt poll in both dispatch loops, how
exceptions unwind, and what invalidates shape assumptions, and ends with eight open questions.

In the engine (`c56dd8d`): `FunctionBytecode.hotness` counts entries down from
`HOT_ENTRY_BUDGET` (1000). At zero, if the embedder set `RuntimeState.hotFunctions` with
`js_runtime.setHotFunctionHandler` (default none), the function is parked in
`RuntimeState.hotPending` and reported at the next interrupt poll through
`InterruptHooks.hotFunction`. The engine does not import `modules/jit`. Not counted: leaf runs,
generator and async resumption, back edges. So a function entered rarely that loops for long is
never reported; on-stack replacement is open.

Interpreter-only cost. As first merged, `python3 scripts/v8bench.py --instructions` against the
binary without the hook (`42b98426`) gave earley-boyer 1.008x and everything else within 0.1
percent (measured by the worker and again by the lead). The cause was not the counter:
`js_gc.receiverWay`, the constructor receiver cache (16 sets of 4 ways keyed by cell address,
probed in order), took more probes once `FunctionBytecode` grew and earley-boyer's pair
constructor moved from way 0 to way 2 (worker's callgrind measurement; tier-seam.md, "The
receiver cache fix"). Fixed in `633aede` and following: keys moved into
`RuntimeState.receiverFunctions`, a per-set last-hit hint probed first.

Current state, measured by the lead at `e889c65e`: the no-hook binary `42b98426` against the
integration head with the hook, the feedback recorder, the compiled-entry slot and the cache fix,
no JIT attached: richards 0.999x, deltablue 1.000x, crypto 1.000x, raytrace 1.001x,
earley-boyer 1.001x, regexp 1.001x, splay 1.001x, navier-stokes 1.000x. The 0.5 percent target
is met on all eight. On that binary: `differential.py --count 500 --configs
plain,observed,jit,jit-stress,node` exit 0, agree 500; the hotness test exit 0; the JIT suite
exit 0, 50 passed; `tests/silkjs/receiver_cache_sets.js` exit 0. `silk task check` was not
rerun by the lead after this last merge (the worker ran it: only the two known failures).

`src/js_hotness_tests.silk` fails when the hook stops firing: with `deliverHot` commented out in
`js_interrupts.handle` it fails with "an inline frame's function is reported once" (the lead
reran both the passing and the broken case).

## Feedback (milestone 6, part 1)

[feedback.md](feedback.md): inventory of what the interpreter already records, the design, costs
and what the benchmarks record. `modules/engine/src/js_feedback.silk` records, per bytecode site
of a function the embedder starts recording for (from the hot report): operand classes and
int32 overflow for arithmetic and comparisons, up to two call targets, up to four receiver
shapes. It records only in the observed dispatch loop (recording switches
`observeInstructions` on); the plain loop has no new code. Read API: `start`, `stop`,
`snapshot` (plain data). Hidden CLI switches `--debug-feedback`, `--debug-feedback-stats`.

Measured: with no handler, `v8bench.py --instructions` is 1.000x on all eight (worker, and
rerun by the lead against the hotness-hook binary). While recording, the worker measured a
one-time cost of 70 to 185 M instructions per run, about 82 percent of it from functions that
are not being recorded but run in the observed loop meanwhile (not rerun by the lead). Site
fractions over the seven benchmarks that report functions (worker's measurement):
arithmetic/compare int32-only 55 percent, with a double 37; calls monomorphic 94; property
sites with one shape 87. navier-stokes reports no function at all: its time is in loops of
functions entered rarely, the on-stack-replacement case.

Open: budget (20,000 observed instructions) and window are guesses; element access,
`instanceof` and branch counts are not recorded; no serializer; always-on recording was judged
too costly and not prototyped.

## SSA form (milestone 6, part 2)

[ssa.md](ssa.md): the design and the backend interface. In `modules/jit/src`: `ssa.silk` (blocks
with parameters, deoptimization exits that name the bytecode offset and the value and
ownership of every local and operand slot), `ssa_translate.silk` (bytecode to SSA for integer
arithmetic, comparisons, branches, loops, return; everything else is refused with a reason),
`ssa_verify.silk` (every owned value consumed exactly once on every path, exits included),
`ssa_ownership.silk` (removes the interpreter's redundant retain and release). The only engine
change is exporting `js_opcode_data` from `modules/engine/silk.toml`.

Run by the lead: `silk test --manifest-path modules/jit/silk.toml --no-cache` exit 0, 47 passed
(was 28). The opt-in census (`cd modules/jit && mkdir -p build && touch build/ssa-census &&
silk test --file src/ssa_census_tests.silk --optimization debug`) exit 0: of 429 finished
functions after one run of each v8 benchmark the translator accepts 28, the verifier rejects
none. First refusals, largest first (worker's count): `push_this` 190, `get_var` 80, function
scopes and scope reads 52.

## First compiled function (milestone 6, part 3)

[compiled-entry.md](compiled-entry.md) is the design as built. `modules/jit/shell` builds
`silkjs-jit-shell`, the engine CLI plus `modules/jit` (flags `--jit`, `--jit-threshold=N`,
`--jit-stress=N`, `--jit-deopt-limit=N`, `--jit-stats`, `--jit-dump`); the engine's own
executable never links the JIT. The shell sets the hot-function handler, which runs bytecode
through `ssa_translate`, `ssa_ownership.optimize`, `ssa_verify` and `x64_backend`, and links the
code through an embedder-owned table (`js_runtime.setCompiledTable`, `linkCompiled`);
`FunctionBytecode.compiled` is an index into it. `callInternal` and `callKnown` enter compiled
code through `js_compiled.enter` after building the interpreter frame. Inline call sites
refuse a linked function for free (linking sets `frameCells` to the stub sentinel). A guard
failure (non-int32 argument, overflow) or an interrupt poll returns a frame state; the engine
writes it into the interpreter frame and the interpreter continues at that bytecode offset. A
function is unlinked after 8 deoptimizations.

Rerun by the lead at `0e940d3a` (each exit status as shown):

| Command | Exit | Result |
| --- | --- | --- |
| `silk test --manifest-path modules/jit/silk.toml --no-cache` | 0 | 50 passed |
| `silk build --release` in `modules/engine`, then in `modules/jit/shell` | 0 | about 6 minutes each |
| `python3 scripts/v8bench.py --instructions` (feedback-merge binary against this one, no JIT attached) | 0 | 1.000x on seven; regexp 0.984x, which is run-to-run noise of that benchmark (the same baseline binary gave 1,357,6xx,xxx and 1,380,2xx,xxx on two runs) |
| `python3 scripts/differential.py --count 3000 --configs plain,observed,jit,jit-stress,node` | 0 | agree 3000; jit: 994 programs ran compiled code, 978 deoptimized, 1166 functions compiled, 32468 refused; jit-stress: 1035 and 995 |
| `silk task check` | 1 | native suite 564 passed, 2 failed (the known two); 272 other steps PASS |

Measured by the lead, one host, whole process, median of 7 runs, 2,000,000 calls of
`function sum(n){let s=0;for(let i=0;i<n;i++)s=s+i;return s}` with n = 100: jsc with JIT 127 ms,
Node 24 with JIT 123 ms, silkjs-jit-shell `--jit` 662 ms, jsc `--useJIT=false` 1277 ms, silkjs
interpreter 1299 ms, Node `--jitless` 2583 ms, qjs 3336 ms. This is one function, not a
benchmark. Empty-script start is about 28 ms of Node's time and 10 ms of jsc's.

Limits as built: compiled code makes no calls, holds no heap reference, has no doubles; leaf
functions never get hot; a poll exit ends compiled execution for the rest of that call (in the
timing above 19,889 of 1,999,000 runs left that way); the interpreter frame is built before
every compiled entry; register assignment is naive.

## Ahead-of-time compilation: what is known

Julia's direction (2026-11-16): start AOT only if it is cheap, meaning the same compiler run at
a different time; otherwise keep it possible. The SSA side passes its check: the same function
translated in two runtime instances gives byte-identical translator input and IR
(`independentOfTheRuntimeInstance`). That holds because the subset has no atom, constant,
closure or realm operand. As it grows these need re-resolving at load time: atom numbers in
the code bytes are per runtime, constants and function constants need table indices, shape
versions are runtime ids. The machine-code side passes too (`jit_engine_tests.compiledCodeLoadsIntoAnotherRuntime`):
code lowered in one runtime is carried as bytes plus relocation records, linked at another
address in a fresh runtime, run and deoptimized. The artefact has zero relocations and depends
only on the bytecode it came from. So for the call-free subset, compiling ahead is the same
compiler run at another time; it stops being free at calls, shapes and atoms. No file format
or cache exists, and none was started.

## Engine restructuring is allowed

Julia (2026-11-16): the engine and its bytecode compiler are unreleased; that they must keep
working without a JIT is no reason to avoid changing them, including large restructures, when
integration is better for it. Restructures the workers proposed and did not do:

- compiler-assigned feedback slot numbers per site (also names sites for deoptimization);
- choosing the dispatch loop per frame, so recording one function does not run everything in
  the observed loop;
- moving the inline field key out of the bytecode into a per-function slot vector, which makes
  the code bytes pure and serializable (to be measured against today's inline hit);
- atom operands as indices into a per-function atom list, so code bytes do not depend on the
  runtime;
- fixed-layout captured-variable slots (about 12 percent of translator refusals);
- entering compiled code before building the interpreter frame, and building it only on
  deoptimization; dispatching to compiled code from inline call sites;
- letting leaf functions get hot or run compiled frameless;
- polling without leaving compiled code.

## How the work was split

On 2026-11-16 worker sessions ran in parallel (three, then four more), each on its own machine, and a lead session
reran each one's key commands before merging into `claude/sweet-ptolemy-f5t7na`. The lead is the
only one that edits this file. The briefs are in the Silk UI project's shared files under
`jit/briefs/`, the workers' reports under `jit/reports/`; neither is needed to continue.

| Workstream | Worker branch | Merged |
| --- | --- | --- |
| A. Scorecard | `claude/project-thread-0jp1hn` (`f9ca0ee`) | yes |
| B. Tier seam and hotness hook | `claude/project-thread-br37a3` (`b9afce9`) | yes |
| C. Differential harness widening | `claude/project-thread-sisu3y` (`b4fbe1b`) | yes |
| F. Call and type feedback | `claude/project-thread-kuzo60` (`5569a15`) | yes |
| G. SSA form and translator | `claude/project-thread-38jcx9` (`1fe07af`) | yes |
| D. Receiver cache behind the earley-boyer cost | `claude/project-thread-rdl3vl` (`7a62053`) | yes |
| E. Compiled entry, deoptimization, first compiled function | `claude/project-thread-do7odg` (`0e940d3a`) | yes |

## Milestone 7 (started 2026-11-17)

Five sessions, briefs in the project's shared files (`jit/briefs/M7-common.md` and one file
each). Every one must pass `differential.py --count 3000 --configs
plain,observed,jit,jit-stress,node` with counters proving its feature ran compiled, keep
interpreter-only instruction counts within 0.5 percent, and show before/after on the
benchmarks it targets.

| Workstream | Scope |
| --- | --- |
| H. Calls and frames | compiled entry before frame setup, inline call sites dispatching to compiled code, leaf functions, calls from compiled code, exceptions through compiled frames, then inlining |
| I. Loops | polls without leaving compiled code, loop hotness, on-stack replacement (navier-stokes compiles nothing today) |
| J. Objects | owned values in compiled code, `this`, property reads and writes with shape guards from feedback, globals, scope variables, fast array elements |
| K. Doubles and code quality | unboxed doubles, recompilation from feedback, remaining operators, typed arrays and Math intrinsics, register allocation |
| L. Measurement | a `silkjs-jit` column in the comparison harness, per-benchmark compile coverage, feature kernels against V8 and JSC, `docs/jit/jit-scorecard.md` as a dated series |

### Milestone 7 progress

Merged so far, with the lead's own reruns (2026-11-17, all RAN on this host unless marked):

| Merge | Head | What it adds | Lead's checks |
| --- | --- | --- | --- |
| K. Doubles and code quality | `f87c61d3` | f64 values in SSA, remaining arithmetic and comparison operators, short jumps, guard removal, recompilation after deopt (`deoptPcs` in `CompiledEntry`, hotness rearmed on unlink, at most 2 recompiles), linear-scan register allocation, J's ABI | JIT tests 65 passed; `encodings.py --check` current; engine and shell release builds exit 0; `v8bench.py --instructions` against the 14e41811 engine 1.000x on all eight; `differential.py --count 3000 --configs plain,observed,jit,jit-stress,node` agree 3000, mismatch 0 (jit: compiled 1850, deopts 13214, recompiled 1607); `--self-test` PASS; native suite 564 passed, 2 failed (the two known `js_for_in_tests`) |
| L. Measurement | `e47ae731` (merge of `d473e12`) | `silkjs-jit` harness column, `bench/kernels/`, `scripts/jit_kernels.py`, `scripts/jit_coverage.py`, `docs/jit/jit-scorecard.md` | JIT tests 65 passed; builds exit 0; differential 600 agree; `jit_kernels.py --rounds 7` exit 0 (table below) |

A first gate run on K's earlier head `ea2ca9d` timed out in the differential (exit 124): three
seeds ended `timeout` in every configuration because a new generator flavour (numloop) produced
programs that ran too long. `f87c61d3` fixes the generator; it was not an engine fault.

The shared compiled-code ABI is frozen (J, `a6c063b`, already inside K's merge):
`CompiledCode = extern "C" fn(args, state, counter, data, env, frame) -> u32`, `stateWords = 3 +
2*(locals+stack)`, a return writes an owned ValueBits to words 0-1 and the return pc to word 2,
an exit writes pc, depth and one ValueBits per slot. `CompiledEnv.helpers[128]` is split J 0-31,
H 32-63, I 64-95, K 96-127.

Kernels at `e47ae731`, MEASURED by the lead (`python3 scripts/jit_kernels.py --rounds 7`, ms per
`kernel()` call, median of 7 processes; compile and warmup included, startup excluded):

| Kernel | silkjs | silkjs-jit | v8-jit | jsc-jit | silkjs-jit vs v8 / jsc | Compiled? |
| --- | --- | --- | --- | --- | --- | --- |
| sum-calls | 128.3 | 37.9 | 10.7 | 11.7 | 3.5x / 3.2x | yes |
| sum-long | 191.9 | 163.9 | 21.4 | 11.8 | 7.7x / 13.9x | never reported hot (needs I's OSR) |
| nested | 152.4 | 49.2 | 10.6 | 25.4 | 4.7x / 1.9x | yes |
| calls | 189.5 | 204.3 | 6.4 | 8.3 | 31.8x / 24.5x | refused (needs H) |
| method | 264.0 | 291.2 | 9.4 | 12.6 | 31.1x / 23.1x | refused (needs H, J) |
| doubles | 118.2 | 39.1 | 15.8 | 17.7 | 2.5x / 2.2x | yes |
| array-sum | 197.5 | 213.7 | 13.3 | 12.6 | 16.1x / 17.0x | refused (needs J) |
| typed-array | 377.9 | 373.8 | 13.2 | 10.0 | 28.3x / 37.5x | refused (needs J, K) |

Where code compiles it is 2.2x to 4.7x behind V8 and JSC; where it is refused it runs at
interpreter speed, 16x to 38x behind. Octane as a whole does not move yet (L, worker-measured at
14e41811: geomean silkjs 5959, silkjs-jit 5858, v8-jit 54836, jsc-jit 52714), because at most
0.014 percent of any benchmark's instructions run compiled. The most-blocking refusal is
`push_this` (602 hot functions), then `get_arg_field8` (107) and `get_var` (94).

Open finding (L, worker-measured, sent to H): Box2D executes 4.3 percent more instructions with
`--jit`, with only 2 functions compiled. Hypothesis, read not proved: linking sets
`STUB_FRAME_CELLS`, the inline call path refuses, and callers build a real arguments object.

Second round of merges (2026-11-17, lead's reruns on this host):

| Head | Contains | Lead's checks |
| --- | --- | --- |
| `34c3ae88` | H: compiled entry from inline call sites, `callLinked` (apply, call, lazy arguments run a linked target frameless), bodies under 3 bytecode bytes refused, `--jit-calls` (off by default) | JIT tests 68; builds exit 0; v8bench vs `8e5a87b3` at most 1.002x; differential 3000 with `plain,observed,jit,jit-stress,jit-calls,jit-calls-stress,node` agree 3000; self-test PASS; native 564/2 known |
| `427f9fca` | H: direct calls to compiled leaf callees through helper `CALL_FAST` (index 32) | JIT tests 68; v8bench vs `34c3ae88` 1.000x; differential 3000 agree (jit-calls direct-calls 24690); native 564/2 known |
| `b2b8778f` | K round 2 (`14f848c`: compare fused into branch, i32 immediates, register hints, loop-depth spill weights) and L's `6229fac` | JIT tests 69; engine binary identical to `427f9fca`; differential 3000 agree; self-test PASS |
| `295c2bdb` | I (`1d0ad3d`: OSR at back-edge polls, loop hotness, OSR-only entries), J (`a182e6e`: `this`, field reads and stores, atoms, globals, own scope slots, fast array elements; NaN truthiness fix), K (`d2ee2cf`: NaN branch tests, differential number loops with NaN and Infinity), H (`94d3b67a`: activation side stack, native nested calls, suspended-frame experiment removed) | JIT tests 70; encodings current; builds exit 0; v8bench vs the previous engine 1.000x on all eight (regexp's count is bimodal, 1359.8M or 1382.4M, on every binary); differential 3000 with seven configs agree 3000; self-test PASS; native 564/2 known |

Notes on that record:

- Box2D: the 4.3 percent `--jit` cost is gone (H MEASURED 2506.5M vs 2509.5M plain; L confirmed
  independently, 1.0008x). The cause was `callInline` refusing linked targets on the apply, call
  and lazy-arguments paths.
- Intermediate head `4a0d4fbe` (I and K's NaN generator without J) had 4 differential
  mismatches, all F64 truthiness at NaN (`ne.f64 x, 0`); J's `0524c48` fixes it (`abs` then
  `gt 0`). The lead reproduced the 4 programs failing before and passing after.
- Intermediate head `9cf82b2e` (I, J, K without H's later work) failed one JIT test,
  `callsFromCompiledCode`; H's merge `e5d7037c` adapts it. It was never pushed.
- The lead once started a gate while the previous one was still in its native-suite build; that
  native run was OOM-killed (exit 137) and its result discarded. The native result above is from
  the later, clean run.
- Workers' containers have `llvm-mc` 18.1.3, so `encodings.py --check` exits 1 there on the
  header line only; it is current on the lead's host (22.1.8).

Kernels at `295c2bdb`, MEASURED by the lead (`jit_kernels.py --rounds 7`, ms per `kernel()`
call, median of 7; the host was noisier than for the table above, compare ratios not rows):

| Kernel | silkjs | silkjs-jit | silkjs-jit-calls | v8-jit | jsc-jit | jit vs v8 / jsc |
| --- | --- | --- | --- | --- | --- | --- |
| sum-calls | 157.2 | 27.6 | 24.9 | 16.7 | 19.7 | 1.7x / 1.4x |
| sum-long | 241.3 | 54.8 | 70.7 | 21.8 | 13.1 | 2.5x / 4.2x |
| nested | 210.0 | 37.0 | 33.3 | 11.9 | 27.7 | 3.1x / 1.3x |
| calls | 236.8 | 243.4 | 226.1 | 6.6 | 8.7 | 36.7x / 28.1x |
| method | 344.9 | 333.1 | 354.2 | 9.9 | 17.3 | 33.6x / 19.2x |
| doubles | 168.2 | 26.0 | 24.7 | 15.8 | 20.5 | 1.6x / 1.3x |
| array-sum | 253.0 | 117.0 | 118.3 | 17.1 | 19.6 | 6.9x / 6.0x |
| typed-array | 420.9 | 433.2 | 415.3 | 12.2 | 10.6 | 35.6x / 41.0x |

Loops, integer and double arithmetic are within 1.3x to 3.1x of V8 and JSC. Calls are the
problem: compiled code that calls is no faster than the interpreter, because each call leaves
through a C helper. Worker-measured on deltablue with `--jit-calls` (callgrind): 1.164x plain at
`427f9fca`, 2.37x once J made 45 of 63 hot functions compile, 1.90x after J's inline field
reads and H's inlined activation push (`a701fc89`, not merged yet). That is why `--jit-calls`
stays off by default, and why Octane's geomean has not moved (L at `34c3ae88`: silkjs 5763,
silkjs-jit 5829, silkjs-jit-calls 5287, v8-jit 52964, jsc-jit 51590).

### Milestone 7, third round (2026-11-17): calls from machine code, compile cost

Heads pushed after `4e5e3dba`, each gated by the lead with the chain below (RAN, all exit 0
except the native suite's two known `js_for_in_tests` failures; interpreter-only instructions
MEASURED against the previous head, 1.000x on all eight at every step):

| Head | Contents |
| --- | --- |
| `ea9965d0` | H `a701fc89` (`new` from compiled code, inlined activation push), J `484f69d` (inline keyed field reads, array length and elements) |
| `da86b81c` | H `94c98b74` (machine-code direct calls for leaf callees), J `e2cf2db8` |
| `3d6558e6` | H `da834ff7` (cheaper interpreted-to-compiled entry), J `1622c07` (type tests, truthiness), I `5445fea` (OSR entry speculation) |
| `ed2454e9` | H `8b963ca4` (nested callees from machine code), J `84f23162` (stack shuffles), L `af0449aa` |
| `8f5cc66e` | O2 `1e70f07` (exit tables instead of code per exit, linear ownership pass and verifier, recompile backoff), I `9acf8f4` (OSR compiled lazily per polled header, backoff), J `cb9be3f4` (`instanceof`, `deoptKinds`), L `fd6c6a6f` |

Gate chain, from `modules/engine`, one step at a time (`/home/user/bins/gate.sh` on the lead's
container holds it): `silk test --manifest-path ../jit/silk.toml --no-cache`; `(cd ../jit &&
python3 scripts/encodings.py --check)`; `silk build --release`; `silk build --release
--manifest-path ../jit/shell/silk.toml`; `python3 scripts/v8bench.py --instructions <previous
engine> <new engine>`; `python3 scripts/differential.py --count 3000 --configs
plain,observed,jit,jit-stress,jit-calls,jit-calls-stress,jit-inline-stress,node` (add
`jit-eager,jit-calls-eager` once O2's recording is merged: recording cuts what the other
configs compile); `--self-test`; `python3 scripts/jit_kernels.py --rounds 7 --engines
silkjs,silkjs-jit,silkjs-jit-calls,v8-jit,jsc-jit`; `silk test src/tests.silk -o
build/core-tests --optimization speed --debug false`. About 100 minutes. Never start a chain
while another runs.

Kernels at `8f5cc66e`, MEASURED by the lead (ms per `kernel()` call, median of 7):

| Kernel | silkjs | silkjs-jit | silkjs-jit-calls | v8-jit | jsc-jit | best jit vs v8 / jsc |
| --- | --- | --- | --- | --- | --- | --- |
| sum-calls | 128.4 | 23.2 | 19.2 | 11.3 | 13.9 | 1.7x / 1.4x |
| sum-long | 167.7 | 17.4 | 16.4 | 21.5 | 12.9 | 0.8x / 1.3x |
| nested | 170.9 | 37.3 | 38.6 | 12.1 | 27.0 | 3.1x / 1.4x |
| calls | 203.6 | 218.8 | 155.8 | 7.0 | 8.9 | 22x / 18x |
| method | 285.7 | 297.2 | 200.8 | 9.2 | 14.3 | 22x / 14x |
| doubles | 135.6 | 23.3 | 25.2 | 15.5 | 20.4 | 1.5x / 1.1x |
| array-sum | 198.4 | 79.5 | 71.6 | 12.5 | 13.9 | 5.7x / 5.2x |
| typed-array | 413.5 | 289.8 | 300.7 | 11.2 | 10.8 | 26x / 27x |

Findings of this round:

- **Compile cost made `--jit` slower than the interpreter on Octane.** L MEASURED at `4e5e3dba`
  geomean silkjs 6832, silkjs-jit 6324 (0.926); zlib went from 56.10G to 83.66G instructions
  (superlinear `ssa_ownership`, 85 OSR compilations, 23.9 MB of code). Fixed by K `43536460`
  (zlib compile share 33.5 to 1.15 percent, worker-measured), I `f253780` and O2 `1e70f07`
  (zlib code 24 MB to 3 MB). O2 worker-measured at `1e70f07`: `--jit` between 0.977x and 1.077x
  of plain instructions on Octane; `--jit --jit-calls` up to 1.5x to 1.7x.
- **Calls still lose.** O1 worker-measured on deltablue with `--jit --jit-calls` at `5fa2348`:
  1.188x plain; of the 140M extra instructions about 50M are compiling, 57M call glue
  (`startActivation`, `callForCompiled`, `linkedCall`), and compiled code is only about 20
  percent cheaper than the interpreter work it replaces (264,700 global reads through a
  helper). 23 of 48 functions end unlinked, mostly from a call to a callee without code being
  counted as a deopt of the caller.
- L at `da86b81c` (worker-measured): Octane geomean silkjs 6900, silkjs-jit 6611 (0.958),
  silkjs-jit-calls 6010, v8-jit 61738, jsc-jit 61045.

### Phase 2 of milestone 7 (Julia, 2026-11-17)

Julia's direction: prove x86-64 first (arm64 macOS waits); widen coverage right away so
benchmarks stop falling back; keep optimization going in parallel; Opus sessions implement from
detailed plans, Fable sessions optimize from goals and measurements; start milestone 8 as soon
as 7 is done. Briefs are in `/mnt/project-files/jit/briefs/` (`M7b-common.md` first), reports in
`/mnt/project-files/jit/reports/`.

| Stream | Thread branch (`claude/project-thread-*`) | Scope | Latest head reported |
| --- | --- | --- | --- |
| N (H) | `g1zedu` | generic instruction exits (`SITE_GENERIC`), `SITE_CALL_ALWAYS` for callees without code | `bd6e6d9f` |
| J2 (J) | `k45qjk` | type tests, shuffles, `instanceof`, equality on any values, argument writes, global read cache | `8982524` |
| P | `j8unvc` | try/catch/finally, throw, uninitialized-local checks, OSR in try regions | `cff4712` |
| Q (I) | `xytm2y` | OSR code that calls, then `for-of` and `for-in` | `92a10b8` |
| K2 (K) | `ikmpm7` | typed arrays inline, Math calls, ToInt32 of doubles, arithmetic sites | `8a0767d3` |
| O1 | `5supa2` | calls and inlining (small prototype methods behind a callee check) | `5fa2348` |
| O2 | `h2d0uv` | compile cost, recording before the first compilation (`--jit-profile`), then guard hoisting | `704c57e` |
| L | `6ys4ab` | Octane and v8 series against V8 and JSC per integration head, coverage tools | `fd6c6a6f` |

In the gate when this was written: `8f5cc66e` + P `cff4712` + I `92a10b8` + O1 `5fa2348`, with
one lead patch (`0e21d6e2`: bodies with try regions or checked locals are not inlined, because
the translator's `catchTop` and `tdz` tables are the caller's).

Rules that came out of merging: a stream that changes a shared encoding (exit state, call
block, `CompiledEntry` layout) announces it to the affected threads and the lead before coding;
streams merge each other's reported heads before handing over, so the lead's merge is trivial;
`silk check` can serve a stale result after a merge, `silk check --no-server` does not.

### Exit criteria for milestone 7 and what milestone 8 is

Milestone 7 is done when, on x86-64 Linux: `--jit` with calls on is at or below the interpreter
in instructions on every Octane and v8 benchmark; calls are the default (`--jit-no-calls`
remains for debugging); the common refusals and repeated deopts in L's coverage tables are gone.

Milestone 8, to start at once after that: feedback-driven inlining beyond small methods and
load/check elimination across calls; compilation off the main thread; persisted code (AOT only
because it is the same compiler run at another time); an evaluation of regexp compilation;
pause and p99 latency and a `d8` column in the scorecard. arm64 follows once x86-64 is proven.

## Next steps

1. Gate and merge heads in the order they are reported; rerun each one's key commands.
2. Take refusal and deopt reasons from L's coverage tables and O1's and O2's per-benchmark
   breakdowns, and assign each to the stream that owns the opcode.
3. Open from earlier milestones: no pause or p99 measurement, no `d8` column, AOT has no file
   format.

Every session doing this work needs `silk-lang/silk` attached with GitHub API access as well as
`silk-lang/lib-silkjs`: the Silk installer reads the release API and gets HTTP 403 otherwise
(two earlier sessions failed on exactly this). In a Claude cloud session, read-only access is
not enough; attaching it with push access is what enables the API.

## Research

See [the memory and feedback report](memory-feedback-research.md). It is code inspection and
history, with no instrumentation measurements; its source links refer to `86c3e4db`. Its
recommendation stands as a hypothesis: start with ownership-aware SSA on the existing reference
counting; treat a nursery, a tracing collector and globally packed values as separate experiments.

The Bun AOT material cited in the earlier handoff ([Bun PR 45631](https://github.com/oven-sh/bun/pull/45631),
[WebKit PR 757](https://github.com/oven-sh/WebKit/pull/757)) has not been revalidated.
