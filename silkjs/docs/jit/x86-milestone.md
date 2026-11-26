# SilkJS on x86-64 Linux

## Decision

**On `aa564dec`, default SilkJS scored 5,646 on Octane throughput versus 5,245 for its interpreter and 55,783 for Node/V8.** That is a 7.65% gain over the interpreter and a 9.88× gap to V8, against the original 1.3× target. Crypto scored 2.51× its interpreter. Across the other 14 workloads the default gain was 1.34% on the geometric mean. Twelve of 15 workloads scored within 5% of their interpreter. DeltaBlue had the widest V8 gap at 54.76×. The full run of 180 processes included separate latency scores. [Per-workload medians, raw scores and build identities](jit-scorecard-results/2026-11-19-http-calls/octane.md)

The local milestone branch now emits direct x86 reads of statically known lexical scope slots. On the 64-item HTTP service its default JIT served 4,347 verified orders/s at 221.98 µs of server CPU per order. Node served 9,440/s at 55.65 µs. The default candidate used 3.0% less paired CPU than `62790abf` in fresh processes and 2.2% less in alternating warmed blocks. The JIT-disabled controls also moved. Compiled calls remain opt-in. [Matched release and control measurements](jit-scorecard-results/2026-11-19-http-calls/#reading-lexical-scope-slots-directly)

In the preceding run at `62790abf`, the default JIT scored 6.3% above its interpreter and Node scored 10.16× higher. The earlier integration at `b52550c7` scored 5.1% above its interpreter with a 10.23× V8 gap. The original handoff candidate was 2.8% above its interpreter with a 10.28× gap. Each comparison used that revision’s own interpreter and Node runs. The standalone shell led Node on several cold commands, while the embedded service took longer to deliver its first verified response.

Keep the optional JIT and its shared compiler for eventual AOT. Change how we select compiler work. Run the application or CLI workload on which a proposed change should pay for itself, measure its time against default Node/V8, and identify where SilkJS spends the extra time. Use kernels to isolate the mechanism afterwards. Keep correctness and the cost of interpreter-only operation as independent release gates.

The [original plan](https://github.com/silk-lang/lib-silkjs/blob/8237a590/docs/jit/archive/2026-11-12-plan.html) set a first throughput target within 1.3× of V8 and JSC on the suite geometric mean. Its longer-term ambition was parity on the mean with the slowest workload within about 1.3×. For this milestone use the first target on x86-64 with default V8 in a pinned Node release. Report the slowest workload and each suite separately. For the server, propose the same 1.3× budget independently on CPU-bound request time and p99 under agreed load, and report startup and RSS alongside them. Preserve the longer-term ambition. A geometric mean that includes cold startup, request latency and throughput makes it impossible to tell which target the engine met.

## Earlier integrated throughput at `b52550c7`

Three fresh-process rounds of all 15 Octane groups used the same pinned x86-64 toolchain, full release binaries, Octane source and default Node 24.19.0. All 180 processes exited successfully. Each score below takes the median per workload before the geometric mean. The second row also includes the two latency scores and serves as a comparison with the historical all-score headline.

| Octane score, higher is better | Interpreter | Default JIT | Compiled calls | Node/V8 |
| --- | ---: | ---: | ---: | ---: |
| 15 throughput scores | 5,155 | 5,419 | 5,441 | 55,419 |
| All 17 scores | 5,791 | 6,185 | 6,189 | 55,400 |

Compiled calls scored 5.5% above the interpreter and took the V8 throughput-score gap from 10.49× on the handoff candidate to 10.19×. Workload medians show why the aggregate moved so little. With compiled calls, Crypto scored 2.54× the interpreter and Richards 1.35×. RegExp scored 0.72× the interpreter, Box2D 0.78× and TypeScript 0.86×. Keep calls opt-in and use timed application work to guide the next change. [Per-workload scores and build identities](jit-scorecard-results/2026-11-18-b52550c7/comparison.json) · [Raw scores](jit-scorecard-results/2026-11-18-b52550c7/octane.json) · [Memory samples](jit-scorecard-results/2026-11-18-b52550c7/octane-rss.json) · [Process audit](jit-scorecard-results/2026-11-18-b52550c7/octane-processes.json)

## Validating the O2 integration

The original O2 tip `25e45217` passed 89 JIT tests and every fixed V8-suite output comparison. Its compiled-call mode still failed Octane Gameboy’s final emulator-state assertion. Turning off hoisting, borrowing, unboxed exits and inlining together reproduced the failure. The earlier milestone at `c39cc03d` returned the correct state on the same input with compiled calls enabled.

The first divergent operation stored the correct byte at index 0 instead of index 34,896 after a callback. The JIT saved the first two operands of an instruction across a call. Its indexed store encodes the index in a third operand. Tracking that operand keeps the index live on resumption. A focused regression reads index 17, invokes a callback, then writes to 17 and checks that index 0 retained its value.

A second defect affected monomorphic sites, where all recorded accesses had seen one typed-array class. The x86 emitter used an unsigned 16-bit read or a 16-bit store as its final case. A hot read of the Float16 value 1.5 returned the raw bits as the integer 15872. The signed and unsigned BigInt views also returned Numbers, and accepted Number stores that should throw. The emitter now explicitly selects the supported 16-bit integer classes and lets the runtime perform unsupported conversions. The regression warms separate access sites for each affected class.

On the Float64Array multiply-add loop, the original O2 build already inlined element accesses. The next change carries numbers through the arithmetic as doubles in SSE registers. On the isolated change at `34427e76`, fixed work fell from 133.90 to 88.81 instructions per update, a 33.7% reduction. Disassembly shows three indexed double loads, two multiplies, an add and a double store. Each access still checks the receiver, view and bounds. The normal and forced-exit probes cover getters and setters, shared and detached buffers, resize, aliasing, signed zero, NaN and infinities. [Instruction counts, binary identities and checksums](jit-scorecard-results/2026-11-18-34427e76/unboxed.json)

Nine interleaved rounds of the unchanged 10-million-update kernel took a median 74.64 ms on the original O2 branch, 46.66 ms with the isolated change, 46.56 ms on the integrated release and 8.56 ms on Node/V8. Every process returned 12,486,251. The integrated loop took 37.6% less time than O2 and 5.44× as long as V8. Hoisting view and range checks remains a candidate for loops where calls, resize, detachment and re-entry cannot invalidate them. [All 36 samples](jit-scorecard-results/2026-11-18-34427e76/wall.json)

The integrated release `b52550c7` reproduced the correct registers and all 65,536 Gameboy memory bytes. All fixed Octane and V8 cases passed in the previous interpreter, new interpreter, default JIT and compiled-call JIT. All 92 JIT tests passed. All 3,000 generated programs agreed in 13 configurations, and each JIT configuration ran native code on every program. The eight interpreter-only instruction counts stayed within 0.0011% of `c39cc03d`. The native suite reproduced the two known for-in failures with 564 passes. [Integrated release gate](jit-scorecard-results/2026-11-18-b52550c7/gate.json) · [Original O2 gate](jit-scorecard-results/2026-11-18-25e45217/gate.json) · [Gameboy regression](jit-scorecard-results/2026-11-18-b52550c7/gameboy.json) · [Typed-view regression](jit-scorecard-results/2026-11-18-b52550c7/typed-view-classes.json)

## What the earlier measurements establish

| Evidence | Consequence |
| --- | --- |
| On `d82fa5e8`, Octane scored 5,261 for the interpreter, 5,377 for the JIT, 5,332 with compiled calls and 49,435 for Node/V8. The aggregate includes two latency scores. | Default JIT was 9.19× behind V8 on the historical score. Restricting the geomean to the 15 throughput scores gives 4,767 versus 47,814, a 10.03× gap. Moving every benchmark just below interpreter instruction count would still leave most of this gap. |
| In the same scorecard, six warmed Octane workloads took 10.0–24.4× as long as V8. The empty JIT shell started in 3.4 ms versus 26.0 ms for Node. | The shell has a cold-start advantage. A server can spend that entire saving many times over processing requests. Measure from launch to first successful request, then at steady load. |
| The ungated inlining preview `6623564` narrowed the eight-kernel geomean with compiled calls to 2.3× V8. RayTrace executed 1.429× the interpreter’s instructions. | Keep call inlining as an experiment. Its admission policy, code size, compilation time and repeated exits matter as much as the fast call itself. |
| On `d82fa5e8`, compiled calls increased fixed-work instruction counts on Box2D (1.250×), RegExp (1.193×) and TypeScript (1.095×). TypeScript ran 2,003 deopts and unlinked code 246 times. | Keep calls opt-in until the full-suite regressions have been addressed. Count compiler instructions and transitions alongside time spent running useful compiled code. |

The pause report and the measurement branch contain different kernel runs. Use ratios from a single run, with its own host and configuration. The 31 output comparisons in the historical record span Octane, the V8 benchmark scripts and kernels. [Integration scorecard and preview](https://github.com/silk-lang/lib-silkjs/blob/b3ca2f88/docs/jit/jit-scorecard.md) · [Pause record](pause-2026-11-18.md)

## Candidate gate

The uploaded pause record’s interrupted candidate was `9c7cb585`. On this host, 82/82 JIT tests passed, llvm-mc fixtures matched and the engine and JIT shell built in release mode. The interpreter stayed inside its 0.5% instruction budget on all eight fixed-work V8 comparisons against `1941679d`. Both JIT modes matched plain output on all eight. All 3,000 seeds agreed across ten configurations, with actual native entries under each JIT configuration. The harness detected its planted defects in all eight areas. The full native suite executed 566 tests and reproduced the two recorded `js_for_in_tests` failures. [Gate record and exact failed tests](jit-scorecard-results/2026-11-18-9c7cb585/gate.json)

### Combined release gate

The combined runtime and field-store changes at `c39cc03d` passed all 83 JIT tests, the x86 encoding checks and all 16 fixed-output comparisons. All 3,000 differential seeds agreed across ten configurations, and all seven JIT configurations entered native code on every seed. The interpreter’s largest instruction-count increase relative to `9c7cb585` was 0.0604% on RayTrace. The full native suite reproduced the same two for-in failures, with 564 passes. [Combined release gate and binary hashes](jit-scorecard-results/2026-11-18-c39cc03d/gate.json)

### Checking application results

Run the application correctness checks before a timed Octane comparison. The runner
executes all 15 groups in fresh interpreter, default JIT and compiled-call processes.
It treats a failed setup, run or teardown, a missing completion marker and a difference
in output as failures. To repeat one case, append `--only gbemu`.

```sh
python3 modules/engine/scripts/verify_jit_octane.py \
  --engine /path/to/silkjs-engine --shell /path/to/silkjs-jit-shell \
  --octane /path/to/octane
```

## Candidate measurements

We built `9c7cb585` in release mode on Linux x86-64 with the pinned Silk dev.74 and Clang 22.1.8. The host was a KVM guest on AMD EPYC 9V74 with a four-CPU quota. Node was 24.19.0 with V8 13.6.233.17. The full Octane run used three interleaved rounds of 15 benchmark groups and four engines. All 180 processes exited successfully, producing 204 score samples. Taking the median of each workload before the geometric mean gives the following scores.

| Octane score, higher is better | Interpreter | Default JIT | Compiled calls | Node/V8 |
| --- | ---: | ---: | ---: | ---: |
| 15 throughput scores | 5,094 | 5,235 | 5,129 | 53,812 |
| All 17 scores, including two latency scores | 5,675 | 5,901 | 5,797 | 53,383 |

On throughput alone the default JIT scored 2.77% above the interpreter and compiled calls scored 0.69% above it. V8 scored 10.28× and 10.49× higher respectively. With calls enabled, Richards improved 24.5% over the interpreter, while RegExp fell 23.4% and RayTrace fell 14.0%. The best default-JIT result was CodeLoad, where SilkJS beat V8. The largest gap was DeltaBlue at 50.82×. [Per-workload medians and provenance](jit-scorecard-results/2026-11-18-9c7cb585/comparison.json) · [Raw scores](jit-scorecard-results/2026-11-18-9c7cb585/octane.json) · [Peak memory samples](jit-scorecard-results/2026-11-18-9c7cb585/octane-rss.json)

The CLI table gives the median paired ratio of SilkJS time to Node time over five fresh process pairs. The cold measurement includes process startup and the entire script. The repeated measurement runs two untimed invocations then five timed invocations per process. Every invocation has a checked result. Ratios below 1 favor SilkJS.

| CLI workload | Cold, default JIT | Repeated, default JIT | Cold, compiled calls | Repeated, compiled calls |
| --- | ---: | ---: | ---: | ---: |
| Nested JSON round trip | 0.42× | 1.16× | 0.38× | 1.17× |
| Dynamic function construction | 0.98× | 20.42× | 0.88× | 23.05× |
| String/integer Map and Set operations | 0.45× | 0.83× | 0.41× | 1.15× |
| RegExp matching, replace and split | 0.17× | 1.62× | 0.19× | 1.60× |

The interpreter-only control also finished ahead of Node on all four cold workloads. Its repeated ratios in table order were 1.03×, 32.25×, 0.70× and 1.14×. These runs used separate Node-paired windows. [Interpreter samples](jit-scorecard-results/2026-11-18-9c7cb585/cli-interpreter.json)

The parse workload regenerates the same three 238 KB function bodies on every invocation. In a paired diagnostic, adding a distinct trailing comment to each body changed the repeated default-JIT gap from 14.98× to 1.91×. Median SilkJS time changed from 35.1 to 30.0 ms, and Node time from 2.48 to 16.1 ms. Reusing identical source accounts for much of the gap on this fixture. SilkJS already has an opt-in bytecode cache keyed by source, filename and flags. It admits ordinary global scripts and linked modules after a repeated miss. The Function constructor here takes the indirect-eval path, outside that admission rule. Test reuse on deployed module loads first. A constructor-specific experiment must preserve the calling realm, fresh function identity, prototypes and observable coercions. [Compiler cache rules](../../modules/engine/src/js_eval_compile.silk) · [Function constructor](../../modules/engine/src/js_function_intrinsics.silk) · [Diagnostic samples and exact source change](jit-scorecard-results/2026-11-18-9c7cb585/parse-reuse.json)

On eight fixed-work kernels (seven fresh processes per engine), the default JIT took 7.59× Node’s time on the geometric mean. Compiled calls brought this to 5.08×. The doubles kernel was 1.14× with calls, the typed-array kernel 44.75×. A typed-array benchmark this far behind earns a separate profile of compilation versus steady-state element access. The earlier preview on a different branch and host reached 7.5× on the typed-array kernel and still needs independent application-level validation.

[CLI runner and reproduction](../../modules/engine/bench/README.md) · [Default JIT samples](jit-scorecard-results/2026-11-18-9c7cb585/cli-jit.json) · [Compiled-calls samples](jit-scorecard-results/2026-11-18-9c7cb585/cli-calls.json) · [Kernel samples and counters](jit-scorecard-results/2026-11-18-9c7cb585/candidate-kernels.json)

## Why the suite stays near the interpreter

A function can enter machine code thousands of times and still spend most of its work outside that code. Fixed-work profiles on the handoff candidate show how the default compilation policy, the cost of crossing back into the engine and the quality of emitted code affect different workloads. The figures below are guest instructions counted by Callgrind. CPU time per instruction varies, and the generated-code column excludes native helpers called by generated code.

| Workload and JIT configuration | What executed | Consequence |
| --- | --- | --- |
| Richards, default JIT versus compiled calls | Default refused 11 hot functions because they make calls and compiled one. Generated code handled 1.11% of instructions. Enabling calls compiled all 13 reported functions and raised the generated share to 59.8%. | Default took 1.011× the interpreter’s instructions. Calls took 0.834×. The benefit came from keeping this call chain together. |
| RegExp, compiled calls | 284,939 compiled entries, zero direct calls and 10.7% of instructions in generated code. The regexp executor, builtin entry, result construction and compiled-call adapter all appear among the hot native functions. | 1.234× interpreter instructions. A compiler that optimizes the wrapper still has to pay for matching, constructing results and transitions. |
| Box2D, compiled calls | 15 functions compiled and 35 were refused, including 20 argument-write refusals. The VM dispatch loop alone consumed 54.4% of instructions. Generated code accounted for 1.33%, compiler pass and backend symbols 15.07%, and helper symbols 0.04%. | 1.242× interpreter instructions. Compile work is a large cost on this fixed input and yields little time in generated code. |
| RayTrace, compiled calls | 98,882 entries, two direct calls, 144 deopts, 18 unlinks and 2.21% of instructions in generated code. Interpreter execution and constructor paths dominate. | 1.099× interpreter instructions. Constructor and call specialization are better candidates here than another numerical lowering. |
| Float64Array multiply-add, compiled calls | The inner function compiled with zero deopts. Per additional element the code performed about four global lookup calls, three element reads and one write through helpers. Those helpers and their callees cost about 222 instructions per element. V8’s optimized hot loop uses indexed floating-point loads and a store. | SilkJS used about 444 instructions per element versus 528 interpreted, a 16% reduction. Passing the same arrays as arguments removed repeated global lookup and cut the JIT to 280 instructions per element with identical checksums and the same four element helpers. An optimizer can target stable bindings while preserving ordinary JS mutation semantics. |

We tested the queued typed-array and hoisting work on a separate release build at `25e45217`. On the same Float64Array loop and checksums, it used 133.90 instructions per element (69.8% below the handoff candidate). Element read/write helper calls fell to zero. Global lookup calls fell from 4.0005 to 0.0053 per element. With hoisting disabled on this build, element helpers stayed at zero and the cost rose to 253.75 instructions per element. These tests isolate two useful mechanisms on one loop. These measurements motivated the O2 integration and the application checks above. [Checksums, counters, build identities and controls](jit-scorecard-results/2026-11-18-25e45217/receipt.json)

Wall time on the original 10-million-update kernel confirms the effect. In seven interleaved fresh processes per engine the medians were 355.94 ms interpreted, 386.05 ms with compiled calls on the candidate, 74.80 ms with the same flags on O2 and 8.92 ms on default Node. All 28 checksums matched. O2 was 5.16× faster than the candidate here and still took 8.39× as long as V8. The O2 loop still boxes and unboxes numbers and repeats typed-array view checks. Test keeping doubles unboxed across the loop and moving view checks where calls and buffer mutations can safely invalidate them. [Raw elapsed times, checksums and binary hashes](jit-scorecard-results/2026-11-18-25e45217/wall.json)

The compiler and helper percentages count instructions in the named symbols themselves. The earlier scorecard assigned some JIT runtime helpers to the compiler. The new profiler reports their self costs separately and marks missing symbol information. [Fixed-work comparisons and counters](jit-scorecard-results/2026-11-18-9c7cb585/coverage-fixed.json)

On the optimized field branch’s TypeScript run, the interpreter’s `executeLoop` alone accounts for 51.1% of self instructions and emitted code accounts for 4.73%. Richards on the same branch spends 59.8% in emitted code. Increasing an aggregate count of hot functions would give both profiles the same prescription. Measure successful direct calls, repeated exits, the work remaining in helpers and the compiler’s own cost on each workload. [Source-level self-instruction profiles](jit-scorecard-results/2026-11-18-d5b0bb73/hotspots.json)

## Compiler change

The candidate dropped back to the interpreter when a compiled named-property store would replace an own writable slot’s last reference. The field-store change at `d5b0bb73` allows a deferred release at each store where the ownership pass proves it safe. At a store crossed by a live borrowed field, the conservative path reconstructs interpreter state before removing that last owner. This also protects copies borrowed across aliases. Accessors, proxies and other unsupported destinations retain their ordinary behavior. [Ownership rule](ssa.md#borrowed-fields-at-an-overwrite) · [Machine-code helper interface](compiled-entry.md)

On the [overwrite fixture](jit-scorecard-results/2026-11-18-d5b0bb73/last-owner.js), the old and new shells returned 162900000. Fixed-work instructions fell from 481,059,543 to 167,317,837 and deopts from 16 to zero. An initial version that blocked all borrows across a named store added 2.26% on Richards. Limiting the rule to the individual store brought Richards to +0.0013%, DeltaBlue to +0.0057% and RayTrace to +0.0030%.

One fixed TypeScript iteration fell from 13.805 to 13.709 billion instructions (−0.70%). Deopts fell from 1,915 to 1,730 and unlinks from 233 to 210. OSR compilations also changed from 11 to eight. Seven alternating pairs comparing the combined release to the candidate returned identical output. The median paired wall-time ratio was 1.008× (range 0.915–1.037×), with three of seven pairs faster. An application speedup remains unproven. [Paired wall times](jit-scorecard-results/2026-11-18-c39cc03d/typescript-wall.json) [Per-workload instruction counts, flags and exit counters](jit-scorecard-results/2026-11-18-d5b0bb73/field-stores.json)

## Embedded host

The opt-in host links the JIT and the Node-compatible runtime. It attaches one JIT on the runtime thread after bootstrap and before loading the application entry point. A separate executable keeps ordinary embedders free to choose interpreter-only operation. An external ES module goes through the runtime module loader, including relative import resolution and exit status propagation.

The x86-64 release host at `0c20dab2` ran a `node:timers` callback and returned checksum 33521664. Its counters recorded 3,535 compiled entries, six OSR entries, zero compiler failures and zero deopts. An external module with a relative import and a filename containing spaces produced the same checksum and propagated exit status 7. This host uses a fresh heap and attaches only to the main runtime. The production CLI bootstrap, snapshot restoration and worker lifecycle need their own validation on main. [Embedding example](../../modules/jit/embed-smoke/src/main.silk) · [Host setup](compiled-entry.md)

### First HTTP comparison

The same ES module ran in the embedded host and Node 24.19.0. It accepted a JSON order with 64 line items, computed a total and replied over a single persistent connection. The client verified every response. Three process pairs alternated order with the server pinned to CPU 0 and the client to CPU 4. Each process served 1,200 warmup requests, a three-second sequential throughput interval, and 400 requests scheduled at 100/s for the latency measurement.

| Median of three processes | Embedded SilkJS JIT | Node/V8 |
| --- | ---: | ---: |
| Launch to first validated response | 146 ms | 80 ms |
| Completed requests/s, one connection | 4,152 | 9,709 |
| Server CPU per request | 231 µs | 53.9 µs |
| Scheduled-arrival p99, measured at 100 requests/s | 9.41 ms | 0.82 ms |
| Peak RSS | 96,984 KiB | 56,044 KiB |

Node sustained 2.34× the throughput. In each SilkJS process the JIT ran more than 50,000 times without compiler failures. These are process-wide counters. The p99 varied from 1.66 to 20.01 ms for SilkJS and 0.63 to 1.23 ms for Node. Attribute latency only after tracing scheduling, request handling, runtime work and collection within the request intervals. This embedded mode bootstraps a fresh heap. Production CLI startup with its image needs a separate measurement. [Fixture and reproduction](../../modules/runtime/bench/README.md) · [Raw timings, counters and executable hashes](jit-scorecard-results/2026-11-18-0c20dab2/http-orders.json)

On the combined release (`c39cc03d`), a second three-round run used the same application, client, CPU pins and Node executable. The median rate was 4,047 requests/s for SilkJS and 9,665 for Node. The median of paired throughput ratios was 42.9%. Median server CPU per request was 236 µs versus 54.5 µs, first response 151 ms versus 100 ms, and peak RSS 96,352 versus 54,840 KiB. Scheduled-arrival p99 ranged from 3.07 to 8.91 ms for SilkJS and from 1.33 to 8.21 ms for Node. Throughput replicated closely, while the three pairs give limited precision on tail latency. [Combined release samples](jit-scorecard-results/2026-11-18-c39cc03d/http-orders.json)

### Where the warmed service spends its instructions

On the combined release `c39cc03d`, we warmed the same service with 1,200 orders, zeroed the Callgrind counters, ran 400 verified orders over the same connection and dumped the counters before shutdown. Callgrind counted 304,975,643 server instructions in that window. Emitted code accounted for 1.75%, VM modules for 52.96% in their own code (`executeLoop` alone 32.61%) and GC functions for 4.30% in their own code. The native HTTP parsing bridge and llhttp together accounted for 1.03% in their own code. The call into `JSON.parse` accounted for 26.83% **including its callees**, versus 0.17% for stringify. Inclusive and self shares overlap. These are SilkJS instruction counts. They locate work on this service. Attributing the gap to V8 requires a corresponding Node profile.

Prioritize the interpreted callback chain and JSON materialization on this fixture. Count dispatches and property reads saved, verify the response, then repeat request CPU and p99 measurements on the same offered load. Run a second request size to separate per-request overhead from per-line-item decoding cost. [Profile, measured window and provenance](jit-scorecard-results/2026-11-18-c39cc03d/http-profile.json)

### HTTP on the integrated release

Five interleaved fresh-process rounds on the same 64-line-item service compared the ordinary `b52550c7` release, its compiled-call option and default Node 24.19.0. The table shows the median for each executable and policy. The within-round comparison below preserves the pairing.

| Median, one persistent connection | SilkJS default | SilkJS compiled calls | Node/V8 |
| --- | ---: | ---: | ---: |
| Verified orders/s | 3,606 | 2,584 | 8,428 |
| Server CPU per order | 264 µs | 357 µs | 63.3 µs |
| Launch to first verified response | 143 ms | 148 ms | 85 ms |
| Scheduled-arrival p99 at 100 orders/s | 5.40 ms | 5.66 ms | 6.62 ms |
| Peak RSS | 96,772 KiB | 101,244 KiB | 55,240 KiB |

The median within-round throughput ratio for default SilkJS was 38.3% of Node (range 34.1–44.3%). The median within-round CPU ratio was 4.56×. Enabling compiled calls reduced throughput in every pair, by 28.8% at the median, and raised CPU per order by 39.2%. Tail latency varied across processes. These five rounds give a clearer result on throughput and CPU.

In a diagnostic build, changing only strict-equality admission with calls enabled allowed the native-parser `event` callback to enter compiled code 6,927 times with zero deopts, compared with zero compiled entries when admission was disabled. The same policy gave `parserOnIncoming` 24 compiled entries and eight field-read deopts. `EventEmitter.emit` deoptimized on all 32 compiled entries on an indexed property read. Across five paired diagnostic processes, allowing equality changed median throughput by −2.8% and CPU per order by +3.9%, with individual pairs on both sides of zero. At 4,800 warmup orders, the 400-order profile still showed compilation work and a 3.9% higher instruction count with equality admitted and calls enabled. This service supports keeping compiled calls opt-in. Specializing its repeated indexed property reads or reducing the cost of JSON materialization are the next measurable targets. [Controlled experiment and raw samples](jit-scorecard-results/2026-11-18-b52550c7/http/README.md)

### Following a complete HTTP request on `62790abf`

The guarded keyed reads fixed the original emitter exits. Across the same 1,600 verified orders with compiled calls enabled, `EventEmitter.emit` went from 32 native entries and 32 deoptimizations to 14,813 entries and one deoptimization. The parser's message-completion callback went from eight entries and eight exits to 1,728 entries without an exit. The application's end listener still fell back at `setHeader`, and only eight of 1,600 calls to JSON.parse came from compiled code. One upstream parser callback exhausted its shared profile window before recording the first lookup. Forcing that observation cleared the lookup and exposed an unobserved truthiness guard three source lines later.

Using the new interpreter switch in the same release host, the 64-item service delivered median rates of 4,295 verified orders/s in the interpreter, 4,034 with the default JIT, 2,873 with compiled calls and 9,450 with Node 24.19.0. Default SilkJS consumed 4.25× Node's CPU per order. Against the previous default rerun in the same five rounds, the candidate used 3.1% more CPU and delivered 3.9% fewer orders/s at the median of paired comparisons. Four-item orders also favored the interpreter over the candidate JIT in every pair. Keep this as an experiment. The changed JSON parser reduced interpreter instructions per 64-item request by 1.77%, a saving that did not produce a consistent throughput gain.

For the next compiler change, record entry, return and fallback costs for a hot caller and its actual callees, and acquire type feedback while that caller is running. Measure CPU per verified order and instructions spent in VM call handling together. The real flat-string lookup inside the new helper accounted for at most 0.19% of warmed calls-on service instructions. [Full request traces, matched builds and raw measurements](jit-scorecard-results/2026-11-18-http-service/README.md)

### Warm request CPU and call admission

On 19 November, six interleaved fresh-process rounds on the 64-item order service put the `62790abf` default at 228.54 µs/order and Node at 54.36 µs/order. That leaves 174.18 µs/order to close on this workload. Globally enabling compiled calls raised the SilkJS median to 328.76 µs/order. Sampling actual CPU shows the effect on execution. In three paired runs interpreter dispatch fell by 8.3 µs/order while generated machine code added 34.4 µs, other VM functions added 22.4 µs, and JIT helpers added 13.2 µs. These timings cover user code and the Node-compatible runtime. [Verified timings and independent engine changes](jit-scorecard-results/2026-11-19-http-calls/) · [CPU attribution](jit-scorecard-results/2026-11-19-http-calls/cpu/)

Admitting calls only on 15 parser, emitter and application functions recovered most of the global policy’s instruction penalty. Across two independent runs it still used 1.2–1.6% more instructions than the default and left the application request and end listeners interpreted. Subtracting the measured compiler hook preserved that ordering. A deployment profile can select which functions enter the tier, while the execution cost of those functions needs its own budget. Measure a candidate region’s CPU and total server CPU on the same request before expanding admission. The separate AOT experiment below targets cold startup and warmup. [Selected functions and recorded refusals](jit-scorecard-results/2026-11-19-http-calls/selective/)

Tracing the individual calls on the same release pinned the interruption to a third function. In two windows of 64 verified orders each, `parserOnBody` entered compiled `Readable.prototype.push` every time. All 128 calls then suspended at the call inside `push`, went through the VM and resumed the parser normally. The second window identified the inner target on all 64 calls as `readableAddChunkPushByteMode`. It had no installed machine code. An earlier trace saw its entry run eight times, deoptimize eight times and unlink, with exits recorded at a length read and an indexed read. Improving the outer call's argument handling alone would still leave that inner suspension. The next whole-path experiment should keep the byte-mode routine linked across those reads and measure normal returns and CPU per verified order. [Call-site counts and generated-code analysis](jit-scorecard-results/2026-11-19-http-calls/cpu/generated-ops.md)

## Server milestone

1. **Broaden host coverage.** Keep the JSON order service above and add a callback-heavy application using the module loader. Run the same unchanged program in both full runtimes. Verify response contents and request counts. Record wall time to first response in fresh processes, sustained successful requests/s, p99 at the same offered load below saturation, CPU/request and peak RSS. Record concurrency, warmup, client placement, versions, flags and binary identities. Publish the two workloads individually. The runtime bench currently defaults to Bun with its JIT disabled. [Runtime benchmark configuration](../../modules/runtime/bench/README.md)
2. **Spend CPU where it matters.** Profile the hot service interval with diagnostics separate from timing. Distinguish compiled bodies, interpreter, compiler, builtins, allocation/destruction and host I/O. When most excess CPU sits in a builtin, profile that builtin before broadening bytecode coverage. When it sits on call or field exits, group by function and site, and estimate the time recovered after compilation cost. Confirm each change with fixed-work interpreter and JIT A/B runs on the workload that motivated it.
3. **Use deployment information the host actually has.** The loader already owns module identity, bootstrap and bytecode caching. A stable deployment can seed a profile at restart, specialize a known callee behind an identity guard, or prebuild hot code before serving requests. Measure time-to-first-request, cumulative CPU through warmup and post-warmup throughput with those features independently enabled. Dynamic import, eval, monkey-patching and invalidation still require working fallback paths. [Runtime bytecode cache](../../modules/runtime/src/ext/script_cache.silk)
4. **Keep production integration close.** Main at `719650d1` has the composable runtime on Silk dev.86. This JIT branch uses dev.74 and forked at `d1973537`. A trial Git merge of the candidate and that main revision reports conflicts in the workspace manifest, engine tasks and benchmark engine registry. A clean textual merge of the VM files still requires compiling the new package graph and rerunning differential and host tests. Move the tested tier seam to main’s embedding API before accumulating another independent runtime.

### Integration queue

The next narrow iteration patch is `3da9846b` on top of the candidate’s iteration changes. Its recorded win is per-element cost in an array `for-of` loop. Verify it on iteration-heavy application code. The integrated milestone incorporates the O2 recorder fix `a2fa3354`, typed-view feedback from `d0a0f6d5`, and writable argument support from `db75ee41`, with the call-liveness and typed-view corrections above. Preserve the separate call-inlining experiment through `ab69c4d`. Its successor `366f0b61` is a WIP re-entry prototype with additional recursion, throw and lifetime requirements.

A faster kernel, a passing differential or an unchanged interpreter instruction count can each justify a narrowly scoped integration decision. A V8 milestone decision needs full representative timings on the same revision. [Iteration patch](https://github.com/silk-lang/lib-silkjs/commit/3da9846b) · [O2 fixes](https://github.com/silk-lang/lib-silkjs/commit/25e45217) · [Call experiment](https://github.com/silk-lang/lib-silkjs/commit/ab69c4d)

### AOT follow-up

The two-runtime tests already take generated code for arithmetic and object/element/global operations, install it at a different address and exercise deopt. Both runtimes live in one process. Inlined targets are bound to live bytecode and callee identities. The existing Linux heap image depends on fixed addresses and its own executable. [Relocation tests](../../modules/jit/src/jit_engine_tests.silk) · [Installation](../../modules/jit/src/jit_runtime.silk) · [Heap image](../../modules/runtime/src/ext/heap_image.silk)

The first deliverable is a fresh-process round trip on one hot function through the existing compiler. Store code and the symbolic dependencies needed by its guards, deopt exits and inline callees. Validate the module and function contents, target CPU features and engine/helper ABI before publishing executable code. Resolve live references into runtime-owned data. Test a matching image at a new address, a changed module, a changed ABI and a changed callee. A rejected entry should take the ordinary interpreter/JIT path and produce the same result. Measure startup and first useful work against both a cold JIT and the existing bytecode cache before extending the format.
