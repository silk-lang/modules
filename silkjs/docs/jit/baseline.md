# The baseline tier

Status on 2026-11-20: a tier on x86-64 that runs the eight V8 benchmarks end to end. It answers
step 2 of the plan of 20 November (one vertical at a time, Richards first): is a tier that
compiles every bytecode instruction to a fixed template, on the interpreter's own frame, a
better base than the SSA compiler's separate frame world? Both gates of that step are measured
below: Richards first, then all eight benchmarks.

Both gates count instructions. On the clock the tier is worth 1.4x to 1.8x on numeric code,
loses on call-heavy code and is 1.23x slower than the interpreter on the HTTP order service
(On the clock, below). It stays opt-in: its job is the frame and the generic operations under
the optimizing tier. The instruction tables of the two gates are from the inline-template
build (8fa76e9b); the shared stubs that came after trade some of those instructions for a
third of the code.

Everything here was measured on the JIT shell (`modules/jit/shell`) in release mode unless it
says otherwise. Code: `modules/jit/src/baseline.silk` (the compiler), `baseline_env.silk` (what
the code reaches at run time), `modules/engine/src/js_baseline.silk` (the engine's side) and
`js_vm.silk` (`enterBaseline`, `baselineService`, `baselineFinish`, `baselineStep`,
`baselineCallNative`, `baselineQuick`, `baselineLoop`).

## Result

### The first gate: Richards

The numbers of this part are the state at the first gate (commit `6afdf7ec`). Richards, fixed work, marginal instructions for 20 runs of the benchmark (40 runs minus 20, so
startup and compilation cancel):

| Build | Instructions | Against the interpreter | Instructions per call |
| --- | ---: | ---: | ---: |
| Interpreter | 512.7M | 1.00x | 157 to 335 |
| SSA tier, `--jit --jit-calls` | 385.1M | 1.33x fewer | |
| Baseline, first complete (`0f3925af`) | 313.3M | 1.64x fewer | 103 |
| Baseline, lazy frames and trimmed checks | 260.8M | 1.97x fewer | 75 |
| Baseline, second pass (this state) | 240.0M | 2.14x fewer | 63 |

On the clock, 400 runs in one process, user time, 15 paired rounds on a shared 4-core host: the
interpreter's median is 0.780 s and baseline's 0.510 s, 1.53x. The SSA tier with compiled calls
takes 0.60 to 0.66 s on the same script.

Against the spike's gate (Richards at 1.5x or better, zero departures, 25 instructions or fewer
per call):

- **1.5x: met, narrowly.** 1.53x on medians, 2.14x in instructions.
- **Zero departures: met.** All 17 hot functions compile, no reachable instruction lacks a
  template, and the run records no departure to the interpreter. In a 20-run script 772,322
  calls go straight from baseline code to baseline code and 8,933 go through the engine
  (callees that are not hot yet).
- **25 instructions per call: not met.** A call costs 63: 29.5 at the call site, 17.3 in the
  prologue, 12.8 leaving and 3 for the return. The 25 came from the SSA tier's 18-instruction
  call, which passes values in registers, has no frame record and drops no counts. A tier that
  keeps the interpreter's frame and counted 16-byte cells cannot get there; the anatomy below
  says where the 63 go and what a higher tier removes.

86.7% of the run's instructions are in baseline code. The rest is the engine's helpers for
polymorphic field reads (about 4%) and startup.

### The second gate: all eight

The gate: no benchmark above the interpreter's instruction count, and 95% of bytecode
instructions in machine code. A fixed run of each benchmark, whole process, compilation
included:

| Benchmark | Runs | Interpreter | Baseline | Fewer | In machine code, whole run | Runs 22 to 27 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Richards | 20 | 521.9M | 258.9M | 2.02x | 99.6% | 100.0% |
| DeltaBlue | 20 | 750.1M | 627.6M | 1.20x | 95.0% | 98.6% |
| Crypto | 4 | 3,020.9M | 1,379.9M | 2.19x | 99.5% | 100.0% |
| RayTrace | 8 | 1,245.6M | 1,175.8M | 1.06x | 99.2% | 99.9% |
| EarleyBoyer | 2 | 1,153.4M | 1,110.3M | 1.04x | 97.4% | 97.9% |
| RegExp | 2 | 1,367.5M | 1,244.5M | 1.10x | 88.8% | 99.7% |
| Splay | 4 | 1,320.3M | 1,272.3M | 1.04x | 98.5% | 99.2% |
| NavierStokes | 2 | 1,100.5M | 669.8M | 1.64x | 97.3% | 100.0% |

- **No benchmark above the interpreter: met.** The margin is 4% or more everywhere. Whole-run
  counts of the baseline column move by 1% to 2% from build to build (placement of code and of
  collections), so the three smallest ratios are not ranked against each other.
- **95% in machine code: met in steady state on all eight, and on seven in the short runs.**
  "In machine code" counts bytecode instructions: entries into templates, less the steps,
  against the interpreter's dispatches (`jit_baseline_profile.py --coverage`). The last column
  is runs 22 to 27 of a 27-run process (the difference of two processes), which is the tier
  without its warm-up. RegExp's fixed run is two runs of the benchmark. Its twelve block
  functions are entered once per run, so they never count 100 entries and get their code
  through loop entry, which needs three polls of a loop that is running; much of the first run
  is over by then. Over 27 runs the whole process is at 95.0%. What stays interpreted in
  steady state is the functions the tier refuses (four in EarleyBoyer, most of its 2%) and
  steps.
- No function departs: every reachable instruction has a template or runs as a step.

How much the tier can take out depends on where the interpreter spends its instructions. Per
bytecode instruction executed, in the same runs:

| Benchmark | Interpreter, instructions per bytecode instruction | Baseline takes out | Calls through the engine | Steps |
| --- | ---: | ---: | ---: | ---: |
| Crypto | 24 | 13 | 18,466 | 15,936 |
| NavierStokes | 23 | 9 | 13 | 496 |
| Richards | 38 | 19 | 970 | 0 |
| DeltaBlue | 36 | 6 | 118,153 | 187 |
| EarleyBoyer | 51 | 2 | 529,713 | 52,636 |
| RayTrace | 65 | 4 | 615,096 | 11,356 |
| Splay | 83 | 3 | 41,938 | 201 |
| RegExp | 87 | 8 | 350,832 | 13,610 |

Where the interpreter spends 23 to 38 instructions per bytecode instruction the work is the
bytecode itself, and templates remove a third to a half of it. Where it spends 51 to 87 the
work is in the runtime (allocation, collection, natives, the regular expression engine), which
this tier calls exactly as the interpreter does. There a template can only remove dispatch and
operand traffic, and each call that still goes through the engine (a native, a construction, a
callee that is not hot yet) and each step (about 450 instructions) gives some of that back.

## On the clock

Both gates above count instructions, and both were met. Time was measured afterwards, and it
says something else: **fewer instructions did not mean less time.** From here on the tier is
judged by CPU time, interleaved with the interpreter on one core
(`jit-scorecard-results/2026-11-20-http-baseline/paired_modes.py` for the order service,
`jit-scorecard-results/2026-11-20-baseline-time/four_engines.py` for the benchmarks).

### The HTTP order service

CPU per verified order, interpreter against baseline code, paired medians:

| Build | Code | Touched per order | Instructions per order | Baseline against interpreter |
| --- | ---: | ---: | ---: | ---: |
| Inline templates (8fa76e9b) | 2.93 MB | 600 KB | 688K against 789K | 1.69x slower |
| Shared stubs | 1.47 MB | 424 KB | | 1.37x slower |
| Stubs, cell base, known calls in the call stub | 0.95 MB | 238 KB | 732K against 791K | 1.35x slower |
| The same with the slot index from the key (below) | 0.95 MB | 238 KB | | 1.23x slower |

The first row was a code size problem. Every function sat on pages of its own, an order ran
81,000 distinct instructions about once each, and the simulated second-level cache
(`--LL=2097152,16,64`) missed 1,078 instruction lines per order where the interpreter misses 4.
The stubs and the cell base (Design, below) fixed that: the same simulation now gives 112, and
fewer first-level instruction misses than the interpreter has (21,281 against 25,561).

The time did not follow all the way. What is left, from a program-counter sampler over
30,000 orders (µs per order):

| Where | Interpreter | Baseline |
| --- | ---: | ---: |
| Interpreter loop and the VM's call and property code | 142 | 15 |
| Baseline code | | 122 |
| of that, shared stubs | | 74 |
| of that, the first instruction of a function | | 17 |
| Helpers and services baseline code calls | | 42 |
| Kernel and libc (the same three system calls) | 32 | 49 |
| Everything else (natives, JSON, collection, runtime) | 110 | 150 |
| Whole process | 284 | 377 |

Three things are in that table.

1. **Baseline code and its helpers take 164 µs for the work the interpreter does in 127.** The
   stubs run about 110,000 instructions per order at 0.67 ns each, where the interpreter loop
   averages 0.43 (275,000 instructions in 117 µs). Their samples sit after the loads both tiers make: the site cache line of
   `get_field2`, the count of the value just read, the callee's bytecode object. The
   interpreter makes the same loads but has several times more instructions to run while it
   waits, so removing those instructions removes little time.
2. **Entering a function costs about 60 ns before its first instruction retires.** Each
   function starts on its own page, reached by an indirect call. With all code on one 2 MB
   page (an experiment on the dev host: `MADV_HUGEPAGE`, no per-page protection) those samples
   halve and baseline code as a whole takes 13% fewer samples. Packed pages are worth doing;
   a huge page needs write protection for the whole region at once.
3. **Everything else runs slower beside baseline code**, the kernel included (17 µs more for
   the same system calls). The cache simulation does not show it, so it is state the
   simulation does not model: translation and branch prediction entries for 38,000 distinct
   instructions per order where the interpreter needs a few thousand.

Compiling less does not fix it. With the threshold raised so that only what an order calls 20
times or more has code (22 functions), baseline code is still 1.07x slower: 17 µs of code and
12 of helpers replace 8 µs of the interpreter loop, because 66 calls per order now cross
between baseline code and the interpreter through the engine, and 13 instructions step.
Thresholds of 10,000, 30,000 and 100,000 entries gave 1.27x, 1.28x and 1.14x slower.

### The eight benchmarks, four engines

CPU time of a fixed run (the fixed-count runner at 20 times `v8bench.FIXED`), all four engines
interleaved on one core, Node 22.23.5 for V8:

| Benchmark | Interpreter | Baseline | V8 | V8 jitless | Interpreter / baseline | Interpreter / V8 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Richards | 785 ms | 564 ms | 79 ms | 869 ms | 1.39x | 9.9x |
| DeltaBlue | 1242 ms | 1557 ms | 143 ms | 1560 ms | 0.80x | 8.7x |
| Crypto | 3962 ms | 2194 ms | 328 ms | 5548 ms | 1.81x | 12.1x |
| RayTrace | 2134 ms | 2235 ms | 297 ms | 2482 ms | 0.95x | 7.2x |
| EarleyBoyer | 1806 ms | 1897 ms | 346 ms | 1674 ms | 0.95x | 5.2x |
| RegExp | 1248 ms | 1201 ms | 573 ms | 1294 ms | 1.04x | 2.2x |
| Splay | 303 ms | 390 ms | 307 ms | 550 ms | 0.78x | 1.0x |
| NavierStokes | 1321 ms | 938 ms | 204 ms | 2410 ms | 1.41x | 6.5x |

The geometric mean of interpreter over baseline is 1.10x. Single benchmarks move by up to
10% between builds of equal instruction counts (DeltaBlue and Crypto did between the two
runs of this table), so read a row as that coarse.

Inline templates were faster on three of them. The same run for the two builds of the tier,
baseline code against baseline code, five rounds: the stub build takes 1.25x the time on
DeltaBlue, 1.27x on NavierStokes and 1.11x on Crypto, the same on Richards and EarleyBoyer,
and 12% less on RayTrace and Splay; 1.05x over the eight. A stub call adds about eight
instructions to a field or element read of twenty, and in a hot loop instructions are time.

One change came out of the Richards profile and stays: a keyed field read took the slot index
from the difference of shape version and key, so the slot's load waited for the object, its
shape and the shape's version. It now takes the index from the key's low word, the load waits
for the object alone, and the shape feeds only the branch (3% to 4% on Richards and
DeltaBlue on a dev build, and the order service went from 1.35x to 1.23x slower). A count without a branch (the count goes to the value or to a dead word) was
tried in the stubs and was 13% slower on Richards: the branch predicts well there, and the
conditional move holds the store's address back.

### What it means

- A tier that only removes dispatch and operand decoding from this interpreter is worth 1.4x
  to 1.8x on numeric and tight code, nothing on call-heavy code, and less than nothing on
  code a server runs once per request. The interpreter's site caches, fused instructions and
  inline frames already took what a baseline tier usually takes.
- Dense code is the right form for the tier all the same. It is what the order service needs,
  it compiles faster, and the stubs are the generic operations an optimizing tier calls
  instead of leaving its code. Hot loops are the optimizer's to win, not this tier's.
- Baseline code stays opt-in (`--jit-baseline`). It should run where a function is on its way
  to the optimizer, or is the frame an optimized function falls back to, not for everything
  that gets warm.
- The gap to V8 with its JIT is 5x to 12x on six of the eight. That is type-specialized code
  in registers with inlined calls, which is step 3 of the plan.

## How to run it

```sh
silkjs-jit-shell --jit-baseline script.js          # hot functions get baseline code
    --jit-threshold=N                              # entries before a function is hot (default 100)
    --jit-stats=FILE                               # counters, among them baseline-*
    --jit-dump                                     # code bytes and the code map on stderr
```

`--jit-baseline` implies `--jit` and replaces the SSA compiler: a hot function gets baseline
code or stays interpreted. The HTTP embedding host (`modules/jit/embed-smoke`) takes the same
flag, and `modules/runtime/bench/jit_http.py --jit-baseline` runs the order service on it.

A function is hot after 100 entries with this tier, where the engine's default for the SSA
compiler is 1,000 (`jit_runtime.BASELINE_ENTRIES`). Baseline code costs about 4,700
instructions to make per bytecode instruction and saves about 20 each time one runs, so it has
paid for itself after a few hundred executions. Whole fixed runs at thresholds 20, 50, 100 and
200 differ by less than the build-to-build noise on six benchmarks; Richards runs 4% fewer
instructions at any of them than at 1,000 and DeltaBlue 3% to 6% fewer.

## Design

### One template per instruction

`compile` walks the bytecode once to find the depth of the operand stack at every reachable
instruction, then emits one template per instruction in bytecode order. Every value lives in its
cell, exactly where the interpreter keeps it: a template loads its operands from their cells
into scratch registers and stores its result back. Nothing is cached in registers between
instructions, so the frame is a valid interpreter frame at every instruction boundary.

An instruction without a template is a **step**: the code asks the engine to run that one
instruction in the interpreter, on the same cells, and goes on after it (`SERVICE_STEP`,
`js_vm.baselineStep`, which runs a copy of the dispatch loop that stops before the frame's
next instruction). A template that meets a case it does not handle, such as an element read on
something that is not a fast Array, steps the same way. A step costs about 450 instructions:
75 to build the frame, 110 to describe the activation and make the interpreter's state, 170 in
the one-instruction loop, 45 in the trampolines and 15 in the code. The compiler reports
stepped opcodes (`Outcome.stepped`, and `step:<opcode>` counts in `--jit-stats`).

The interpreter may leave the frame somewhere else than the next instruction: at a branch
target, after a pair it runs as one, or at a handler that took what the instruction threw. The
service then answers where the frame is (`js_baseline.moved`: bytecode offset and operands on
the stack), and the code looks that offset up in the function's **resume table**, one word per
bytecode byte after the code, with the distance to the instruction's template and the operand
depth it expects. If the table has it, the code jumps there (`baseline-resumes`). If not, the
interpreter finishes the activation (`SERVICE_FINISH`), which is the only way an activation
still leaves baseline code and counts as a departure (`baseline-departures`). No benchmark of
the eight departs.

Work that is rare stays out of the straight path as a slow path (`Slow`, emitted after the
body): a count that drops to zero, a cache miss, a call of a function without baseline code, a
poll.

Two adjacent instructions compile as one where the second only consumes what the first makes
and no branch reaches it (`fused`): `push_this; put_loc`, `is_undefined_or_null` followed by a
branch, and a comparison followed by a branch.

Numbers: two Ints compute inline, and so do two Float64 and an Int with a Float64 for `+`, `-`,
`*` and the orderings. An overflow, a product of 0, a remainder or any other pair of numbers
goes to one helper (`arithmetic`, the interpreter's `numericFast`), and only what is not a pair
of numbers is a step.

Truthiness is inline for booleans, Ints, undefined, null, flat strings (by length) and objects
(true unless the object is one of the falsy kind); a flat string's `length` is one load.

Object and array literals, `define_field`, closures, a literal's `__proto__`, a field store that
must allocate and the `+` of a string with a string or a number go through services that build
no frame (`SERVICE_QUICK`, `SERVICE_CONCAT`): they only allocate, so nothing can read the frame
chain meanwhile.

`to_object` on an object is nothing, and strict code reads `this` as the cell it was passed;
only a conversion (a primitive, or a sloppy function's missing receiver) is a step.

### Frame

The code runs on the native stack:

```
[rbp + 8]        return address
[rbp]            the caller's rbp
[rbp - R, rbp)   the BaselineFrame record (js_baseline); its last word is the state
below it         the cells: [arguments][locals][operand stack], 16 bytes each, ascending
below them       the scope of a function that has one of its own: a header, then its slots
```

The record holds a `StackFrame`, which is what the engine reads when it walks frames, plus the
caller's `argv` and `argc`, the bytecode's address and a slot for a service's result.

A frame starts **bare**. The prologue stores only what a call needs: the function, the
receiver, the arguments, the locals as undefined and the bytecode's address. When the code asks
the engine for anything (every `SERVICE_*` request), `js_baseline.build` first completes the
bare frames from the innermost outwards and publishes them as the runtime's current frame
chain. It finds the callers through the saved rbp chain; the entry stub keeps two zero words
where a record's state would be, which ends the walk. A frame that was built is unlinked when
it returns; a frame that stayed bare just pops. A frame entered through the function's
construct entry is in the construct state of each (`FRAME_BARE_CONSTRUCT`,
`FRAME_BUILT_CONSTRUCT`), which is where `new.target` lives: it is the function itself. Anything that reads the frame chain (error
stacks, closures attaching to a frame, the debugger) therefore sees every frame, and a call that
never leaves baseline code pays for none of it.

### Registers and calls

r12 is the `BaselineEnv` and r13 the runtime for the whole run of baseline code. rbp is the
frame and rbx its cell base (below). r14 and r15 belong to the shared stubs; everything else
is scratch.

A call passes rdi the function (the closure object's cell), r11 its bytecode object, rsi argv,
rdx argc and rcx:r8 the receiver. Arguments stay in the caller's operand cells and are borrowed:
the callee copies them only when it writes a parameter or was passed fewer than it declares.
The result returns in rax:rdx (tag word, payload); the Exception tag means the call threw and
the exception is pending in the runtime.

A call site checks that the callee is a bytecode function with baseline code
(`FunctionBytecode.baseline`, one plus an index into a table the embedder lends) and calls
through the table. Anything else goes through the engine (`SERVICE_CALL`).

The engine enters baseline code from `callInternal` through a stub (`entryStub`) that turns the
C ABI into this one. It does so for a plain call and for a `new` of the function itself
(through the construct entry, the second table slot of each function), never for a resumed
generator or under an instruction observer (debugger, coverage, profiler).

A known local function (`js_compiler_known`) has no closure object. Its frame names its
bytecode as the function, and the caller passes the scope it runs in where a closure's caller
passes the object (rdi). The call stub finds that scope on the caller's chain. The interpreter runs
a small one without a frame (`js_vm_leaf`) and counts no entry for it, so a function that only
baseline code calls would never be hot: a call site that finds no code counts the entry itself
(`js_baseline.countLeaf`) before it hands the call to the interpreter.

A native callee is called without any frame of the engine's (`CALL_NATIVE`,
`js_vm.baselineCallNative`), as the interpreter's call instruction calls one: first the answers
that need no native frame (Math on numbers, `push` and `pop`, the string methods with a
primitive entry, `String(int)`, regular expression `exec` and `replace`, the collection
reads), then the native itself. The call charges the interrupt counter as the interpreter's
does. The request has a path of its own in the service, apart from the one that serves steps,
finishes and calls of bytecode: that one is 113 instructions long before it reaches a native,
and a native is the most frequent thing baseline code asks the engine for (135 of 163 requests
per HTTP order).

### Shared stubs

The heavy templates are not copied into every function. They are assembled once per JIT
runtime into one block of code (`baseline.stubs`, 31 stubs in 5.6 KB), and a function's code
calls them with a rel32 call. A site is three instructions, about 17 bytes:

```
lea  r14, [the operand cell at the site's depth]
mov  eax, the instruction's bytecode offset        ; or the value the stub's comment names
call stub
```

The stub finds its operands under r14 (`[r14-16]` is the top of the operand stack) and the
instruction's inline operands and cache key through the frame's code address plus eax. It
keeps rbp, rbx, r12 and r13 and nothing else. It returns with the zero flag clear when it did
the instruction and set when it declined with nothing changed, so a site that can decline
follows the call with one `je` to the path the template had before (a getter, a helper, a
step). A stub that had to ask a helper returns the helper's answer the same way.

Stubs: field reads (`get_field2`, the top-of-stack form, the cell form the slot variants use),
scope reads with and without the initialization check, calls and method calls (bytecode
callees with code directly, known local functions, natives and everything else through the
engine), the step request, truthiness and the four equalities, element reads and stores,
field stores, getter and setter calls, the prologue's frame setup and the release of a frame's
cells at its end.

What stays inline is what is short: loads and stores of locals and arguments, constants,
integer and double arithmetic, comparisons with a branch, the count of a value.

**The cell base.** rbx points 128 bytes above the frame's first local, so the first sixteen
cells of locals and operands are reached with a one-byte displacement where rbp needs four.
The assembler rewrites every `[rbp + d]` in that window (`Assembler.alias`). The prologue
stub saves the caller's rbx in the record and the function's end restores it.

Together these took the order service's code from 2.93 MB to 0.95 MB (87 to 28 bytes of code
per bytecode byte; a template from 74 to 27 bytes on average) and what one order touches from
600 KB to 238 KB. Half of what is left is cold: step requests (169 KB), resume tables
(136 KB), exits, the arithmetic helper calls and the finish tails.

### What the code asks the engine for

One entry, `baselineService(hooks, allocator, record, request, base, count)`, reached through
the runtime:

| Request | Meaning |
| --- | --- |
| `SERVICE_FINISH` | The interpreter finishes this activation from the published bytecode offset, with `count` operands on the stack. With `FINISH_THROWING` an exception is pending and it unwinds first: when a handler of the frame takes it, the answer is `moved` to the handler and the code goes on there |
| `SERVICE_CALL` | Call the value at `base` on `count` arguments; with `CALL_METHOD` the cell before it is the receiver, with `CALL_NATIVE` the callee is a native and gets no engine frame |
| `SERVICE_CONSTRUCT` | Construct with the function at `base`, `new.target` after it, then `count` arguments |
| `SERVICE_POLL` | The interrupt counter ran out |
| `SERVICE_OVERFLOW` | No room on the native stack: throw the RangeError |
| `SERVICE_STEP` | Run the one instruction at the published offset in the interpreter |
| `SERVICE_QUICK` | An allocating instruction (`object`, `define_field`, `array_from`, `rest`, `fclosure`, `set_proto`, a `put_field` that adds past the object's room or sets an Array's length) without a frame; the engine may decline, and the instruction is a step then |
| `SERVICE_CONCAT` | The `+` of a string and a string or number, without a frame |
| `SERVICE_RESUME` | Only from a resume entry: fill the new frame from an interpreter activation (below) |
| `SERVICE_SCOPE` | From the leave tail of a function whose own scope a closure moved to the heap: drop the frame's count of it |

The first five and the step build the bare frames first; the last four do not.

Helpers (`BaselineEnv.helpers`, C functions named by index) cover the misses that run no user
code: field reads and writes that miss their cache, `get_var`, equality, truthiness, `!`,
`typeof`, lengths, arithmetic and comparisons of numbers, string constants, element reads and
stores, and finding a getter or a setter to call. A helper that would have to run user code returns 0 and
the template steps instead, so user code never runs under a bare frame. A helper has no hooks
to free a cell with, so a count it drops to zero is queued (`releaseDeferred`) and the engine
drains the queue later; a count that stays above zero drops in the helper itself.

**try, catch and finally.** `catch` stores the handler marker (the catch offset) in its operand
cell, `nip_catch` drops it, `gosub` pushes the return offset as an Int and jumps to the finally
block, and `ret` goes back through the function's resume table, since the offset is a value.
A function with `try` therefore runs whole in machine code; the unwinder finds the marker in
the cells as it does for the interpreter.

### Exceptions

A throw in baseline code, or in anything it called, reaches the code as a service or a call
that answers "threw". The code asks the engine to unwind (`FINISH_THROWING`). The interpreter's
unwinder runs on the frame's cells, where the catch markers are operands as in any frame: with
a handler in this frame the code goes on at the handler through the resume table, and without
one the cells are released and the caller sees the exception. Handlers therefore run in
baseline code.

### Entering a running loop

A function that is called once and loops for long is hot before it is ever entered again. The
interpreter reports it at a back-edge poll (`js_hotness.loopPoll`), it compiles at the next
poll, and from the poll after that the running activation moves over (`js_vm.baselineLoop`,
called from `backEdgePoll`, which only runs when the interrupt counter is out):

1. The function has a **resume entry**, a third way into its code next to the plain and the
   construct entries. Its distance from the construct entry is in the four bytes before that
   entry (0 for none), so the table needs no third slot.
2. The engine calls the resume entry through the usual stub with a `js_baseline.Resume` in
   place of the arguments: the activation's argument cells, locals, operand stack, bytecode
   offset and operand depth.
3. The resume entry makes the frame as the prologue does, then asks `SERVICE_RESUME`. The
   engine fills the cells: arguments as the prologue would (the frame's own copies when the
   function writes a parameter), locals and operands moved out of the interpreter's frame. It
   answers `moved` to the back edge's target, and the code goes on there through the resume
   table.
4. When the code returns, the interpreter's activation holds no values. It gets the result on
   its stack and its instruction pointer at a `return` of the function, so it ends as any
   activation does. An exception the code let out is raised with the activation's operand
   stack empty, so no handler of it sees the exception a second time.

While the code runs, its frame stands in the frame chain where the activation's did, so an
error stack shows the function once. A function gets a resume entry unless it reads how it was
called (`arguments`, a rest parameter) or has no `return` instruction to end at. Only a plain
call's activation moves: not a construction, not a setter's.

On NavierStokes, whose `lin_solve` runs for about 10M instructions per call, this took the
share of bytecode instructions in machine code from 76% to 96% and the run from 1.43x to 1.63x
fewer instructions than the interpreter (both at the 1,000-entry threshold the tier had then).

### Scopes and closures

A function whose variables an inner function captures has a scope of its own
(`FunctionBytecode.scopeSlots`). The interpreter keeps that scope in the frame while no closure
holds it and moves it to the heap when one does (`js_scopes.placeFrameScope`, `promote`), and
baseline frames do the same:

- The prologue reserves the scope's header and slots below the cells and calls one helper
  (`SCOPE`, `js_baseline.beginScope`): it places the scope, links its parent (the scope the
  closure captured, or the one the caller passed to a known local function) and moves the
  captured parameters in. `BaselineFrame.scope` names it, and the scope templates
  (`get_scope0`, `put_scope0` and their checked forms) read it from there.
- `fclosure` goes through `SERVICE_QUICK` (`js_vm_factories.closureAt`). A known local child
  is just its bytecode, with the level of the scope it will run in. Any other child gets a
  closure object, and the frame's scope moves to the heap first; the record then names it
  there. A closure that would capture a local or an argument by frame slot is declined, and
  the instruction steps.
- The leave tail compares the record's scope with the frame's own address. Still in the
  frame: the slots are released inline. Moved: `SERVICE_SCOPE` drops the frame's count.
- A known local function with a scope of its own never moves it: every function it makes is
  known as well, so its leave tail has no compare.
- When the interpreter steps or finishes such an activation it runs on the record's scope and
  writes back the one it ends with, since a closure it made may have moved it.

A function with a scope of its own gets no resume entry, so a loop in it is not entered while
it runs.

### Fields, variables, elements

- `get_field`, `get_loc_field8`, `get_arg_field8`, `put_field`, `put_loc_field_loc8` use the
  interpreter's inline key in the bytecode (`version << 16 | slot` at the operand + 4): shape
  version shifted and xored against the key leaves the slot index or a miss.
- `get_field2` uses the interpreter's site cache (`RuntimeState.fieldCache`), own and prototype
  entries.
- `get_var` reads the closure's variable cell inline, detached or attached to a frame.
  `get_var_ref` and `get_var_ref_check` read a captured variable up the scope chain (the
  operand names the depth and the slot) or a closure cell.
- `get_scope0_check`, `put_scope0_check`, `get_loc_check`, `put_loc_check` and
  `set_loc_uninitialized` test the slot's tag for the uninitialized marker and step only when
  the read or write must throw.
- `get_array_el`, `get_array_el2`, `get_array_el3`, `get_scope0_el`, the four slot forms
  (`get_loc_el8` and so on) and `put_array_el` handle a fast Array with an Int index in
  bounds, and a Symbol key through the element site cache below. Everything else that runs
  no user code goes to a helper: an indexed or named property found without a getter, a
  flat string key that an atom already spells.
- Lengths: an Array's inline, a string's, a typed array's and any other plain `length`
  property through a helper.
- A read that finds a getter calls it from machine code. The helper asks the interpreter's
  getter caches (`siteGetter`, `functionGetter`) for the function, puts it above the
  operands with the receiver, and the template's slow path makes an ordinary call. Node's
  stream state is all getters (`destroyed`, `readable`, `writableHighWaterMark`), so on the
  HTTP service this was 46 calls per order that had been steps.
- A store by name (`put_field` and its slot forms) that misses the inline key goes on in a
  helper: an own writable data property, or an add along a verified transition memo entry.
  What the helper declines on a `put_field` is tried twice more before it is a step. A
  bytecode setter is called from machine code as a getter is: the helper finds it
  (`functionSetter`), the slow path turns `object value` into `object setter value` and makes
  an ordinary method call whose result it drops. Then the engine's store without a frame
  (`SERVICE_QUICK`): an add that needs a new shape or more room, and `array.length = n`.
  On the HTTP service these were 15 steps per order.
- `typeof`, `!` of any value and `===` answer without the interpreter. `===` is decided in
  the slow path from tags and words where that is enough (one cell twice, two objects, two
  symbols, anything against `undefined` or `null`); numbers, strings and booleans go to the
  helper.

The code and the interpreter share the field caches, so either one warms them for the other.

**The element site cache.** `this[kState]` is how Node's own modules keep private state: a
Symbol key from a module scope, read and written about 340 times per HTTP order. The
interpreter looks the symbol's atom up in the shape's hash on every one (92 instructions a
read). Baseline code keeps a table of 2,048 entries in its environment, picked by the
instruction's address and the object's shape version together, so a site that sees several
shapes (the same module code on a request, a response and a socket) keeps an entry for each:
the instruction, the symbol's cell, and `version << 16 | slot` of the own plain data property
it found last time, once for reads and once for stores (zero when the property is not
writable). The template compares the three and reads or writes the
slot: about 25 instructions. A helper fills the entry on a miss. Only own data properties are
entered, so a getter, a prototype's property or a missing one keeps taking the helper. The
entry cannot go stale: a shape's version changes with its records, and a shape that has the
property holds the symbol, so while an object has that version the cell address still names
the same symbol. A store also asks the object for the exotic flag, since an entry is per
shape and an exotic object keeps its own `[[Set]]`. The table lives in `BaselineEnv`, not in
the code, so the code still holds no address.

### Counts

Cells are counted as in the interpreter. A copy adds a count when the tag is a heap tag (one
byte compare, since the heap tags are 0 to 6). A drop subtracts first and takes the slow path
when the result is zero or below; the slow path adds the count back and calls the engine's
release through a stub that preserves every register.

### Polls

A taken backward branch charges the realm's interrupt counter and polls when it runs out, and
so does a call of a native. A function entry does not: recursion is bounded by the stack check,
so every unbounded run passes a backward branch or interpreted code.

### No addresses in the code

The code holds no process-local address. Helpers are reached by index through the environment,
the engine's service and the code table through the runtime, bytecode and caches through the
frame. Inline caches stay in the bytecode and the runtime, where the interpreter keeps them.
A call of a shared stub is a rel32 relocation against the stub's index (`callSymbol`), which
the publisher resolves, as a linker would for code compiled ahead of time.
This is what ahead-of-time compilation needs.

### What the interpreter pays

A linked function sets `FunctionBytecode.baseline` and reuses the frame-cells sentinel, so the
interpreter's inline call and inline construction find no room for it and the call reaches
`callInline` or `constructWith`, which enter the code. The interpreter gains no check on its
fast paths; the checks sit where an inline frame was already refused. Its instruction counts on
the eight V8 benchmarks, against the build before the tier (`74490486`, `scripts/v8bench.py
--instructions`):

| Benchmark | Before | With the tier | |
| --- | ---: | ---: | ---: |
| richards | 521,963,339 | 521,920,059 | 1.000x |
| deltablue | 749,732,780 | 750,203,328 | 1.001x |
| crypto | 3,020,678,796 | 3,019,926,091 | 1.000x |
| raytrace | 1,245,110,287 | 1,249,627,662 | 1.004x |
| earley-boyer | 1,153,452,637 | 1,153,416,570 | 1.000x |
| regexp | 1,367,250,776 | 1,367,498,331 | 1.000x |
| splay | 1,319,620,824 | 1,320,347,019 | 1.001x |
| navier-stokes | 1,100,563,338 | 1,100,521,749 | 1.000x |

Two rows of this tool move with things that are not the tier, in either build:

- RayTrace swings by 4M (0.3%) with the script's path, which decides where bytecode lands and
  so which sites share a slot of the prototype field cache. At another path of the same length
  the build before the tier counts 1,249.35M and this one 1,245.57M. By function, the tier's
  own cost there is 0.73M in `constructInline` and 0.16M in `executeLoop`, 0.07%.
- RegExp has two levels, 1,367M and 1,390M, picked by the size of the process environment
  (it moves the native stack, and with it the alignment of the matcher's buffers). Each build
  hits the high level at some sizes: the old one with 5 or 13 more bytes of environment, this
  one with 64. The row above is from a run where both sit on the low level.

An earlier state of this branch did break the 0.5% budget on RayTrace (0.57%), with a test for
baseline code on every construction. The test now runs only after an inline frame was refused.
`joinText` is marked `@inlineAlways` for the same reason: a second caller (the tier's concat
service) had moved it out of line under the interpreter's `+`.

One exception keeps its interpreter path: a leaf the interpreter runs without a frame
(`js_vm_leaf`) whose runs were never declined stays frameless for interpreted callers, which
costs less than any entry into machine code; baseline callers reach its code through the table.
Any other function has its leaf credits cleared when it is linked. Without that, a small
function the interpreter had tried as a leaf kept running interpreted after it had code.

### What compiling costs

Richards' 17 functions (409 bytecode instructions) compile in 0.64 ms in total and take 57,041
bytes of code, about 140 bytes per bytecode instruction with slow paths and exits included.

## Where a call's 63 instructions go

| Part | Instructions | What it does |
| --- | ---: | --- |
| Call site | 29.5 | Callee is an object, a bytecode function, has code (9). Publish the bytecode offset (1). Arguments, receiver, table (6). Call and check for a throw (3). Drop the callee's count, the receiver's and each argument's (8 and up). Store the result (2) |
| Prologue | 17.3 | Frame and stack check (5). State, function, receiver, argv, argc, arguments pointer (8). Bytecode address (2). One store per local |
| Leave | 12.8 | Drop the frame's own arguments and locals, check the state, pop |
| Return | 3 | Result into rax:rdx, jump to leave |

About 20 of the 63 are count traffic for the callee, the receiver and the locals, and about 10
are the frame record. Those are what an optimizing tier removes with values in registers and
calls it can see through; the remaining checks (callee kind, stack, throw) cost about 15.

## Where the rest goes

Shares of baseline code on Richards (40 runs, 443M instructions), and of time from 1,400
samples:

| Part | Instructions each | Share of instructions | Share of time |
| --- | ---: | ---: | ---: |
| `get_loc_field8` | 19.6 | 23.2% | 26.8% |
| `get_field2` | 37.6 | 15.2% | 12.7% |
| `call_method` | 29.5 | 10.6% | 10.2% |
| `put_field` | 22.4 | 9.8% | 12.4% |
| `get_var` | 17.0 | 6.2% | 2.4% |
| prologue | 17.3 | 6.2% | 5.0% |
| leave | 12.8 | 4.6% | 3.8% |
| `get_field` | 21.4 | 3.2% | 7.2% |

Field access is half of the instructions and almost 60% of the time. Time follows instructions
closely, so there is no single stall to remove; the code is bound by loads that depend on loads
(cell, object, slots, value, cell again), and fewer instructions is what makes it faster.

## Checks

- `scripts/differential.py --configs plain,baseline,baseline-eager`: generated programs agree
  with the interpreter at thresholds 20 and 1. 1,500 of 1,500 agree on the final state, with
  11.6M resumes through the resume table, 112M steps and 0.5M departures among them (generated
  programs use what the benchmarks do not: generators, `for-of`, private fields, `try`).
- `silk test` in `modules/jit`: 94 of 94. `hotFunctionsRunBaselineCode` runs a linked list,
  field stores, a throw through two baseline frames, deep recursion, operators, keep branches,
  `length`, string constants, constructions, handlers that catch in baseline code, steps that
  move the frame, and three loops that are entered while they run.
- `python3 modules/jit/scripts/baseline_scripts.py <shell>`: the 29 scripts of
  `modules/jit/tests/baseline` print the interpreter's output at thresholds 1, 5 and 60. They
  cover deep recursion and the stack overflow, exceptions through baseline frames, error
  stacks from frames built lazily, closures and scopes that escape or die with the frame,
  `arguments`, getters and setters, constructors, natives that answer, throw or call back,
  every comparison on mixed operand types, symbol keys under several shapes, stores that grow
  an object, and loop entry with live operands. Fixed-work Richards and DeltaBlue pass the
  same way.
- All eight benchmarks print the interpreter's output with baseline code.

## Tools

`scripts/jit_baseline_profile.py <shell> <script.js>` runs the script under callgrind and joins
the count of every machine instruction with the code map that `--jit-dump` prints: one row per
kind of part (opcode, prologue, leave, each slow path, each entry), with instructions, share,
entries and instructions per entry. `--show NAME` disassembles the hottest instance with its
counts, `--functions` adds a row per function, and `--time SAMPLER.so` prints time shares from
an LD_PRELOAD program-counter sampler instead.

`--coverage` prints the gate's measure: bytecode instructions run by templates (entries into
templates, less the steps) against the interpreter's dispatches in `executeLoop` and the
frameless leaf evaluator. Steady state is the difference of two processes that run the
benchmark a different number of times (22 and 27 here).

`docs/jit/jit-scorecard-results/2026-11-20-http-baseline/instructions.py --host <embed host>
--out DIR [--stats]` gives instructions per order of the HTTP order service by function, for
baseline code and for the interpreter. It runs the host under callgrind with 400 and with
1,400 orders and charges the difference to an order, so start-up, warm-up and compilation
cancel and the figure does not depend on how busy the machine is. `--stats` adds steps by
opcode, service calls and direct calls per order.

`--jit-stats=FILE` has the tier's counters: `baseline-compiled`, `-refused`, `-departures`,
`-resumes`, `-service-calls`, `-direct-calls`, `-steps`, and `step:<opcode>` and
`exit:<opcode>` per opcode.

## Not done

- Functions the tier refuses: one with locals an inner function captures by frame slot, a
  derived class constructor, async functions and generators.
- Instructions without a template run as steps, and so do the cases a template does not
  handle. The benchmarks step most on the `regexp` literal (RegExp), on `get_length`,
  `special_object` and element reads (EarleyBoyer), on element reads and stores outside the
  fast case (Crypto) and on `mod` (RayTrace).
- The cold half of a function's code (step requests, resume tables, exits, finish tails)
  sits between its templates. A cold region would cut what an order touches further (On the
  clock). Functions no longer start on pages of their own: all code is published packed
  (`CodeMemory.allocatePacked`), each block at the next cache line after the last, so
  blocks share pages and their entry points do not all fall in the same cache sets.
- A call between baseline code and an interpreted function goes through the engine in both
  directions, about 240 ns, so a program that is half compiled pays for the seam.
- A call that leaves baseline code for a native, a construction or a callee without code
  goes through the engine. RayTrace and EarleyBoyer make half a million of those per run. A
  native with no frameless answer still gets a native frame there, as it does from the
  interpreter (188 instructions in `callPlain`).
- `for-in`, `for-of`, private fields, `special_object` and the slot forms of a store that
  meets a setter are steps.
- A function that keeps stepping or departing is never given back to the interpreter.
- A loop is entered only from a plain call's activation, and only in a function that has a
  `return` and does not read `arguments`.
- Code is never freed, and the table holds 4,096 functions.
- No feedback is recorded for a higher tier yet.
- x86-64 only.

## Next cuts

For the six benchmarks where the runtime dominates, in the order the tables above suggest:

| Change | What it reaches |
| --- | --- |
| A frameless path for constructions and for natives without a quick answer | RayTrace's 615,000 and EarleyBoyer's 530,000 calls through the engine per run |
| `regexp` literals without a step | 13,000 steps per RegExp run, 450 instructions each, 0.5% of the run |
| The cases `mod`, `add_imm`, `get_array_el` and `put_array_el` still step on | RayTrace's 11,000 and Crypto's 16,000 steps per run |
| A step that does not describe the activation for instructions that cannot throw | Every step: 110 of its 450 instructions |

Measured or estimated on Richards:

| Change | Saves |
| --- | --- |
| The top of the operand stack in a register pair between templates | About 4 instructions per pushed value, 10% |
| `get_loc_field8; get_field` as one template, without the middle count | 9 per pair, 1.2% |
| Callee count elided between `get_field2` and its call when the arguments run no user code | 6 per method call, 2% |
| A stub in table slot 0 instead of the has-code test | 2 per call, 0.7% |
| Bytecode offset from the return address instead of a store per call | 1 per call, and the table an optimizing tier needs anyway |
