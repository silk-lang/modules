# Following one HTTP order through SilkJS

The service receives one POST over a persistent connection, decodes its body, parses the order, sums the line items and writes a JSON response. The Python client independently computes the expected response bytes for four alternating orders. It checks every response, including the shutdown request. The application and the runtime's Node-compatible JavaScript modules are identical across these experiments.

## Release decision

Keep `62790abf` as a local experiment. The candidate default used more server CPU and delivered fewer verified orders per second than the previous default in all five paired rounds. The keyed-read change keeps the emitter linked, and the JSON change reduces instructions spent parsing. Neither result establishes a wall-time improvement for the service. Compiled calls remain opt-in.

| 64-item order, median of five processes | Verified orders/s | Server CPU, µs/order | First response, ms | Scheduled p99, ms |
| --- | ---: | ---: | ---: | ---: |
| Previous default JIT | 4,196 | 227.11 | 135.15 | 1.64 |
| Candidate interpreter | 4,295 | 224.27 | 133.19 | 6.44 |
| Candidate default JIT | 4,034 | 236.31 | 133.30 | 3.10 |
| Candidate with compiled calls | 2,873 | 330.82 | 127.80 | 4.56 |
| Node v24.19.0, default V8 | 9,450 | 55.38 | 104.54 | 1.72 |

Across matched rounds, the candidate default delivered 3.9% fewer orders/s (range 2.4–9.8% fewer) and used 3.1% more CPU/order (range 0.7–10.5% more) than the previous default. It delivered 42.8% of Node's throughput at 4.25× its CPU/order. Enabling compiled calls on the candidate increased median paired CPU/order by 42.7%. Against the build with the identical JSON change and compiled calls enabled, adding keyed reads changed CPU/order by +4.8%, with individual pairs spanning −6.6% to +17.9%. This comparison cannot assign the whole-build regression to keyed reads.

The same candidate on four-item orders delivered 4,605/s in interpreter mode, 4,351/s with the default JIT, 3,447/s with compiled calls and 10,569/s with Node. Over three paired rounds the default used 5.5% more CPU/order than the candidate interpreter and 4.74× as much as Node. Reducing the payload retained the throughput gap, consistent with a substantial fixed cost per request.

Both sweeps ran on an AMD EPYC 9V74. The client and server used separate cores. Each fresh server handled one initial order, 1,200 warmups, a three-second sequential throughput interval, 400 scheduled orders at 100/s, then a verified shutdown. The 64-item sweep interleaved nine conditions over five rounds. The four-item sweep interleaved four over three rounds. Instructions, breakpoint counts and wall timing were collected in separate processes. The client verified 869,902 orders in the wall sweeps. [64-item timings](wall-64.json) · [Four-item timings](wall-4.json) · [Concurrent load](wall-quiet.json)

## Original request path

A debugger followed 1,600 requests on the original production engine with compiled calls enabled. Counts include warmup and shutdown. The debugger did not supply timing data.

| Function or site | What the original binary did |
| --- | --- |
| Native HTTP parser `event` | Stayed compiled on 6,917 entries. |
| Native HTTP parser `callback` | All eight compiled entries stopped at the initial `parser[index]` read. All eight indices named own data properties of ordinary parser objects. |
| `parserOnMessageComplete` | Stopped at a symbol lookup on all eight entries. The symbol was absent across the ordinary prototype chain. |
| `parserOnIncoming` | Eight exits at the inherited `needDrain` accessor. Calling the getter is observable. |
| `EventEmitter.emit` | Four installs and 32 compiled entries, all exiting at `events[type]`. The receiver was ordinary and the key was a flat event-name string each time. Nineteen returned an own listener and thirteen missed, including three with a non-null prototype. |
| Application data listener | Its `body += chunk` requires string addition. |
| Application end listener | All 1,600 orders reached the native JSON parser. Eight arrived from compiled code and 1,592 through the interpreter. Each compiled invocation reached `response.setHeader('content-type', 'application/json')` and deoptimized there. The response then reached the already-compilable `totalCents` loop, stringify and `response.end`. |

The single-listener branch loads the actual `handler.apply` method at bytecode PC 130 and calls it at PC 138. An isolated check allowed the unmodified emitter body to reach this branch using a dense array and integer key. It completed 1,476 compiled invocations with zero exits while the listener ran interpreted. Getter and overridden-method tests checked the receiver, argument identity, side effects and exceptions. [Production trace](baseline-route.json) · [Isolated listener call](listener-call.json)

## What stayed compiled

On production source `62790abf`, feedback for reads on ordinary objects selects an x86-64 operation with a boxed key. Its helper uses the interpreter's non-calling lookup for flat strings, symbols and nonnegative integer keys. It returns an owned value for data properties or a proven miss. Accessors, coercions and unsupported receivers resume at the same bytecode. Existing numeric array and typed-array reads retain their fast lowering. The helper lives in the runtime table, so the generated code embeds no key or heap address. [Implementation](../../../../modules/engine/src/js_compiled_objects.silk)

| Compiled entries / exits in 1,600 verified requests, calls enabled | Original | Candidate |
| --- | ---: | ---: |
| Native parser `event` | 6,917 / 0 | 6,916 / 0 |
| Native parser `callback` | 8 / 8 | 8 / 8 |
| `parserOnMessageComplete` | 8 / 8 | 1,728 / 0 |
| `parserOnIncoming` | 24 / 8 | 24 / 8 |
| `EventEmitter.emit` | 32 / 32 | 14,813 / 1 |
| Application `end` listener | 8 / 8 | 24 / 8 |

`emit` stayed installed. Its sole remaining exit was the multi-listener branch at PC 171. The end listener reached JSON.parse from compiled code for eight orders in a separate 1,600-order trace. Its call to `setHeader` still exited. An isolated trial allowed the real header setter to reach the next observable operation. Fresh response objects stopped at a symbol-keyed write, while reused objects reached the string method read. The string-method trial is outside the candidate. [Candidate routes and builtin stacks](candidate-route.json) · [Header setter control](set-header-exits.json)

The native parser's `callback` compiled before its recorder saw the first instruction. In a same-binary debugger experiment, marking just that read as an observed ordinary-object lookup eliminated its original exit. The callback then exited eight times on an object used as a boolean at PC 23 and unlinked. In a separate run, the function's recorder stopped with 275 of its 296 instructions still available when the shared recording budget reached zero. Instructions in other functions count against that shared budget. A deployment profile that records from the next entry into the intended function could observe several related guards at once. Its impact on CPU per order still needs measuring. [Feedback control](callback-feedback-control.json) · [Recording window](callback-window.json)

A separate JS function performing a single `table[type]` read used about 939 instructions per incremental call when linked, versus 893 with the earlier JIT. The generated body contributed 36 instructions, the keyed-read helper 157 and the VM's compiled-entry routine 159 in its own code. On the service, all flat-string lookup work reached from the new helper cost at most 0.19% of the measured calls-on instructions. The largest opportunity at this site is the surrounding code that can continue executing after the lookup. [Isolated call costs](own-key-cost.json) · [Actual service budget](service-key-cost.json)

## CPU at the listener call boundary

On the unchanged 64-item service, the default policy entered the generic `Function.prototype.apply` once per order. Enabling compiled calls raised that to nine. After 4,800 warmup orders, the wrapper, argument-list construction and reclamation together cost 524 and 5,086 instructions per order respectively, or 0.069% and 0.550% of server instructions. These counts cover every caller of the builtin during the 400 verified orders. Entering the listener's VM frame, executing its body and returning to the caller fall outside this accounting. [Instruction counts](listener-apply-instructions.json) · [Callgrind analysis](listener_apply_ir.py)

To measure the cost of forwarding a listener call, a diagnostic version of the service registered each of its two listeners behind zero, four or eight forwarding functions. It checked response bytes, listener counts, the receiver and arguments at every depth. We timed 432,000 orders in fresh processes and 216,000 orders while varying depth within the same six server processes. At eight wrappers per listener, each order made 16 extra calls. With compiled calls enabled, the three same-process median differences per added call were −0.87, +1.36 and +0.51 µs. The direction varied across processes for both policies, so the experiment did not resolve the CPU cost of one listener call. A separate sampling profiler accounted for only about 1% of the CPU time recorded by the kernel and was excluded from per-function attribution. [Fresh-process samples](listener-cpu-fresh.json) · [Within-process samples](listener-cpu-blocked.json) · [CPU sampling check](listener-sampling-check.json)

To repeat the within-process comparison on Linux, run `python3 "$results/listener_cpu.py" --repo . --host "$host" --out /tmp/listener-samples.jsonl` from the repository root, with `results` set to this directory. The driver accepts `--server-cpu` and `--client-cpu` to select two available cores. [Driver](listener_cpu.py) · [Diagnostic service](listener-forwarding.mjs)

## Where compiled calls add work

On the same `62790abf` release, switching on compiled calls added 168,154 instructions per 64-item order after 4,800 warmups. Seven VM functions that enter, dispatch and return from compiled activations accounted for 57,220 of the increase (34.0%), counting only instructions inside each function. The same seven added 67,819 per 64-item order and 70,805 per four-item order after 1,200 warmups.

The activation runner dispatched 113 extra operations per long-warmup order. Roughly 60 were callable dispatches, 52 ran generic bytecodes in the VM, and one invoked a constructor. The object-bytecode handler made 28 additional calls to its fast own-field definition routine. This identifies two costs that persist even when a caller stays compiled: preparing another activation and leaving generated code to execute a frequent individual opcode. [Matched counts and call edges](call-mode-cost.json) · [Callgrind analysis](call_mode_cost.py)

## Locating the V8 gap

After 4,800 warmup orders, a 400-order fixed window took approximately 767,000 x86-64 instructions per order on the original default SilkJS and 217,000–220,000 on Node v24.19.0. The complete call to JSON.parse accounted for about 205,000 on SilkJS and 112,000 on Node. Subtracting these inclusive parser counts from each process total leaves about 83% of the instruction gap outside parsing. Cycles per instruction and operating-system costs can differ between runtimes. Server CPU and throughput come from separate processes running without instrumentation. [Node profiles](node-fixed-work.json)

The original server's default-JIT count fell from 761,000 instructions per 64-line order to 543,000 per four-line order after 1,200 warmup requests. Parsing fell from 205,000 to 16,400 instructions. The line count explains most of the change in parsing work. Roughly 527,000 instructions per small order remained outside the parser.

## Fixed work on matched builds

Three builds used the same application. The original engine is `b52550c7`, `141e0645` has the revised JSON reader, and `62790abf` adds the keyed JIT operation. The interpreter control `8781b74c` adds the host's `--no-jit` switch to the original engine. Each number below is x86-64 instructions per verified order, measured after 1,200 warmup requests over a fixed 400 requests.

| Payload and policy | Original | JSON change only | JSON and keyed reads |
| --- | ---: | ---: | ---: |
| 64 items, default JIT | 761,206 | 747,183 | 749,693 |
| 64 items, compiled calls | 913,609 | 875,446 | 882,905 |
| 4 items, default JIT | 543,102 | 542,218 | 544,422 |
| 4 items, compiled calls | 664,497 | 691,356 | 663,757 |

With `--no-jit`, the original and combined hosts used 775,746 and 762,020 instructions per 64-item order. The inclusive cost of parsing fell from 204,626 to 191,234, accounting for 13,392 of the 13,726 instructions saved. For four-item orders, total instructions fell just 0.17%. With calls on and 4,800 warmup orders, the combined build used 924,531 instructions against 931,610 on JSON alone. At 1,200 warmup orders that pair moved in the opposite direction. Relative to JSON alone with calls enabled, the new keyed reads removed 11.0% of VM dispatches at the shorter warmup (6,146 to 5,469 per order) and 11.3% at the longer one (6,469 to 5,738). Total instructions changed by +0.85% and −0.76%, respectively. Compilations during the measured window affect these counts. [Fixed JIT windows](fixed.json) · [Interpreter windows](interpreter.json)

The parser now reuses the hash computed while scanning a plain ASCII key and converts exact decimal integers of up to 15 digits without the general-purpose decimal converter. It preserves signed zero, fractional and exponent forms, extended mode and reviver source spans. Isolated 64-line parse-and-total instructions fell 3.80%. Wide integers fell 8.69%, while decimals and strings cost 1.03% and 0.12% more on the control arrays. [Parser controls](json-controls.json)

## Broader x86 throughput

The 15-workload Octane throughput geometric mean was 5,527 for the candidate default JIT, 5,491 for the previous JIT, 5,199 for the candidate interpreter and 56,178 for Node/V8. This puts the candidate 6.3% above its interpreter and 10.16× behind V8. The 0.66% increase over the previous JIT is small relative to variation among workloads. Each engine/workload ran in a fresh process three times. The geometric means use per-workload medians. Two latency scores are reported separately. [Samples, commands and provenance](octane-regression.json) · [Three fixed-work profiles](octane-fixed-work.json)

## Correctness

All 93 uncached JIT tests passed. All 23 fixed Octane and V8 workloads passed in four modes. Three hundred stratified programs matched in 13 configurations, including under forced deoptimization. The 416 native JSON comparisons covered strict and extended input with source records on and off. The candidate and previous SilkJS produced byte-identical results, including diagnostic positions. All 238 accepted graphs matched the pinned QuickJS reference. Of 178 rejected cases, 164 had pre-existing differences in diagnostic formatting relative to QuickJS. All 104 strict inputs matched Node 24's acceptance and error messages. [JIT and workload gates](gate.json) · [Native JSON oracle](json-oracle.json) · [Node JSON oracle](node-json-oracle.json)

## Reproducing the Node profile and dispatch count

Run the following commands from the repository root. The first command needs Node 24.19.0, Valgrind and `callgrind_control`. The output directory must be new. Repeat with `--warmup 1200` for the shorter warmup.

```sh
results=docs/jit/jit-scorecard-results/2026-11-18-http-service
python3 "$results/profile_node.py" --repo . --node "$(command -v node)" --warmup 4800 --out /tmp/node-http-4800
python3 "$results/dispatch.py" /path/to/silkjs-jit-embed-smoke /path/to/400-order/profile.PID.1
```

The dispatch counter uses the release ELF and its matching `.symbols` file. In each specialization of the main interpreter loop and leaf evaluator, it locates the 256-entry opcode jump table and counts executed jumps to that table in the instruction-address dump. A fused bytecode group can execute in a single dispatch. The count includes interpreter execution throughout the server and excludes transitions within emitted JIT code.
