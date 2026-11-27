# Compiled-code entry and deoptimization (milestone 6, part 3)

Design written before the code, on top of [tier-seam.md](tier-seam.md). It is the smallest
mechanism that runs one compiled function inside the engine and falls back to the interpreter
at a bytecode boundary. Measurements are in the last section once they exist; anything not
marked measured or ran is a design statement.

## 1. Where the JIT attaches

The engine never imports `modules/jit`. A JIT-enabled executable is a separate package,
`modules/jit/shell` (binary `silkjs-jit-shell`), that links the engine, `modules/jit` and the same
libc session as `qjs`. It parses its own `--jit*` flags, then runs the ordinary `qjs` launch
with a runtime setup callback that installs three things:

- the hot-function handler (`js_runtime.setHotFunctionHandler`) with the libc host id
  `LIBC_HOT_FUNCTION_C`; `LibcServices.hotFunction` forwards it to a C-ABI function pointer
  in the hook's `opaque`. The handler runs at an interrupt poll and never runs JavaScript: it
  reads the bytecode, compiles or refuses, and links.
- a compiled-code table (`js_runtime.setCompiledTable`): an embedder-owned array of
  `js_compiled.CompiledEntry` (machine-code entry, embedder data word, deopt limit, counters).
- optionally a lower first hot budget (`js_runtime.setHotEntryBudget`, read when a function is
  created; default `HOT_ENTRY_BUDGET` = 1000) so tests and stress runs compile early.

The entry slot is `FunctionBytecode.compiled: u32`, an index into that table plus one (0 =
none). It is runtime state like `hotness`: the binary writer never writes it, the reader and
the compiler initialise it to 0. It is an index, not a pointer, so nothing that could be
stored refers to process memory, and it fits in the struct's existing padding after
`hotness` (to be confirmed by the instruction counts: a grown `FunctionBytecode` moved heap
addresses enough to cost earley-boyer 0.6 percent last time).

Which entries check the slot:

- `callInternal` and `callKnown` (native-stack entries) run the compiled code. The check reads
  a field `describe` already loads.
- `enterFrame` (every inline entry) never takes a linked function, at no cost of its own:
  `js_runtime.linkCompiled` keeps the function's `frameCells` in its `CompiledEntry` and sets
  the field to `STUB_FRAME_CELLS`, the sentinel lazily compiled stubs already use, so the
  existing room check fails and the call falls back through `callInline` to `callInternal`.
  Unlinking restores it. (Ran: a first version that tested `compiled` in `enterFrame` cost
  richards +0.98% instructions; this one +0.02%, see Measurements.)
- Leaf runs, generator and async frames, `vm.resume` and the observed loop never run compiled
  code. While instructions are observed (`observeInstructions`, the debugger) the compiled
  entry is skipped and the interpreter runs.

### Running compiled JavaScript in an embedded Node runtime

An x86-64 Linux application can link both `silkjs-runtime` and `silkjs-jit`. Its
`embed.Host.afterBootstrap` can call `jit_runtime.enable` on the realm's runtime before the
module loader starts the application. The application owns one JIT per runtime, at a stable address from attachment
through heap destruction. Embedded mode creates a fresh heap and runs bootstrap before attaching the compiler.
Each worker owns a separate runtime and would need its own JIT.

`modules/jit/embed-smoke/src/main.silk` is a complete host. It imports `node:timers` in an ES
module and runs a numeric loop in a `setImmediate` callback. Run it from the checkout root:

```sh
silk run --manifest-path modules/jit/embed-smoke/silk.toml
```

A successful run prints `timer checksum 33521664` and JIT counters. The executable checks
the JavaScript exit status, compiler failures and actual entries into compiled code. To run an
external ES module through the same host, pass its path. Place `--jit-calls` before the path to
include call instructions in compiled functions. The flag also works with the built-in smoke module. The
runtime loads it as its normal entry point, resolves imports relative to their importing module
and returns its exit status. JIT counters are printed when the runtime shuts down.

## 2. Calling convention and where a compiled frame lives

For this milestone the compiled function makes no calls and cannot fail, so a compiled frame is
a native-stack frame nested inside an ordinary interpreter frame: `callInternal` builds the
interpreter frame exactly as it always does (arguments, locals set to undefined, operand stack
empty), then, out of line in `js_compiled.enter`, calls

```
extern "C" fn(arguments: *const ValueBits, state: *mut u64, counter: *mut i32, data: ?*mut u8,
  env: ?*mut u8, frame: *const CompiledFrame) -> u32        (js_compiled.CompiledCode)
```

(Milestone 7 changed this ABI, workstream J: before it arguments and exit slots were 64-bit
"frame-state words", kind << 32 | payload, which cannot hold a heap reference or a double.)

- `arguments`: the frame's argument cells, one `ValueBits` per declared parameter, borrowed.
  The code copies them and never writes them or relies on their address (an OSR entry may pass
  a temporary copy). `js_compiled.runCode` pads a short argument list with `Undefined` in a
  copy. Type guards are in the machine code.
- `state`: `js_compiled.stateWords(locals, stackSize)` words, written on every exit.
- `counter`: the context's interrupt counter (`ContextState.interruptCounter`); compiled loops
  decrement it on every back edge like the interpreter and leave through a poll exit at zero.
- `data`: the entry's embedder word (the stress counter of the deopt-stress configuration).
- `env`: the entry's environment word, the JIT's `jit_helpers.CompiledEnv` (the runtime and
  the table of runtime helpers compiled code calls by index, never by address).
- `frame`: what the function runs for (`js_compiled.CompiledFrame`, a C-layout struct of
  pointers, all borrowed for the call): the receiver cell, the `FunctionBytecode` cell, the
  context, the runtime, the closure's captured variable cells and the running scope.
- Result 0: returned; `state` words 0-1 hold the result `ValueBits`, owned (the caller takes
  the count), word 2 the bytecode offset of the `return`. Result 1: deoptimization. Result 2:
  interrupt poll (an exit that is not counted as a deopt).

**Named field stores.** Helper 2 (`PUT_FIELD`) takes the bytecode offset in the low 32 bits
of its site word. Bit 32 allows a store to replace the last owning reference in a writable
data property. The emitter clears the bit when a live field borrow could depend on that
slot. If the store would remove the last reference, the helper leaves the slot intact and the interpreter
resumes at the store with the exit's saved values. The site word contains no runtime
address. The borrow rules are described in [ssa.md](ssa.md).

**Values in compiled code.** Every SSA value has a 16-byte slot; a boxed `value` is a
`ValueBits` in the engine's own layout. Silk does not promise a union layout, so the JIT reads it
from the engine at compile time (`value_layout.probe`: it writes each variant over zeros and over
ones and finds the tag and payload bytes). On the build measured, the tag is the first word's low
byte (Silk writes the whole word, so compiled code reads one byte and writes the word with zero
upper bytes) and the payload the second word; the seven heap variants have consecutive tags, so
"is a heap reference" is one range check. An unexpected layout refuses every function. The
layout is a property of one engine build: a stored artefact must key on it.

What this choice costs later: a compiled function always pays the interpreter frame setup and a
native call, inline call sites lose their inline frame, and once compiled code calls other
functions or can fail it needs either unwind information through generated frames or a
frame in the call-frame region that `unwind` understands (open question 5 of the seam stays
open). It needs no stack map for this milestone because compiled code holds no heap reference.

## 3. Deoptimization

Every guard and every poll exit jumps to a per-exit stub that writes the frame state as
immediates and returns 1 (or 2). The state is:

- `state[0]`: the bytecode offset to resume at, from the start of `FunctionBytecode.code`, at
  the start of the instruction to re-execute (the state before it);
- `state[1]`: operand stack depth;
- then one `ValueBits` (two words) per local and per stack slot, bottom first. Each owns one
  count, which the interpreter frame takes over as it is: the exit stub has already added the
  count of every `dup` slot and of every deferred `move` (below). Arguments are not written: the
  SSA subset never writes one.

`js_compiled.restore` copies those into the interpreter frame's locals, pushes the stack slots,
sets `ip`, and `callInternal` continues into its ordinary `execute` loop, so everything after a
deopt (exceptions, calls, polls, the debugger) is the interpreter's own. The interpreter
re-executes the instruction that failed its guard (an `add` that overflowed makes its
`Float64` there). `enter` is `runCode` (no `Machine`), then `result` or `restore`.

Ownership: the frame's locals still hold what `callInternal` put there (`Undefined`), so writing
over them needs no release. Retains of argument values are deferred to the consumption: the
only owned values the integer subset makes are `retain`s of an argument, which the backend holds
as the argument's bits with no count, `release` emits nothing, and each consumption that hands
one to the engine (a `move` slot, `return`) adds the count inline (`add dword [ref], 1` when the
tag is a heap variant, which is all `HeapCell.retain` does). That is exact because G's verifier
proves every owned value is consumed exactly once on every path. The backend refuses a `retain`
of anything but an argument.

After a deopt the function is kept: the entry counts deopts and the engine unlinks it
(`FunctionBytecode.compiled = 0`) after `deoptLimit` deopts, since a guard that failed that
often will keep failing until feedback recompiles it. The code itself stays with the embedder,
which frees all of it when the session ends. Poll exits do not count. Each `CompiledEntry`
counts runs, deopts and poll exits; the JIT sums them, with compile counts, code bytes and
compile time, for `silkjs-jit-shell --jit-stats`.

## 4. Ahead of time

Machine code is emitted with `asm_x64` and its relocation records only. The compiled function
refers to nothing outside its arguments (the interrupt counter and the data word arrive as
arguments), so its bytes contain no process-local pointer and could be stored and linked
elsewhere. The table index in `FunctionBytecode` is runtime state and never serialized.

Ran (`jit_engine_tests.compiledCodeLoadsIntoAnotherRuntime`): `sum` is lowered in one runtime,
its `Code` (bytes and relocation records) is copied as plain data, and a second, fresh runtime
in the same process checks that its own `sum` has the same bytecode, links the copy at a
different address (`jit_runtime.install`), runs it and deopts it. What the artefact depends on,
all of it data a loader can check rather than identities:

- the bytecode it was translated from (offsets in exit stubs, local and stack counts): a loader
  keys the code by the function's bytecode bytes and counts, as the test does;
- nothing else. The code has no relocation, names no atom, shape, cell or function address,
  and reads the interrupt counter and the stress word from its arguments. The table index and
  the saved `frameCells`/`leaf` are runtime state written at link time.

So for this subset "compile ahead, load later" is the same compiler run at another time plus a
key match. It stops being free when compiled code calls a function, reads a property through a
shape or uses an atom: those would need relocations against symbols the loader resolves per
runtime (the `asm_x64` relocation records and `Code.link`'s symbol table are that mechanism).

## 5. Limits as built

- Leaf functions (`FunctionBytecode.leaf`, run frameless by `js_vm_leaf`) are never compiled:
  leaf runs are not counted, so they never get hot. Linking clears `leaf` anyway (restored on
  unlink) so a linked function is never run frameless.
- A poll exit ends compiled execution for the rest of that call; the interpreter finishes the
  loop (no re-entry, no OSR). The interrupt counter is shared with the interpreter and runs at
  most 10000 back edges, so a compiled loop runs at most that many iterations per call.
- Lowering: `ssa_input.inputOf |> ssa_translate.translate |> ssa_ownership.optimize |>
  ssa_verify.verify |> x64_backend.lower`; the first stage that declines gives the refusal.

## 6. Measurements

All on the cloud container (x86-64 Linux), release builds.

- Interpreter-only cost, no JIT attached (measured, `v8bench.py --instructions`): against a
  4bd0ef29 build, all eight benchmarks 1.000x (largest change crypto +0.02%). Against 6341d15
  with the first hook (a `compiled != 0` test in `enterFrame`): richards 1.010x, raytrace
  1.004x; moving that refusal into the room check brought richards to 1.000x.
- Differential (ran, `differential.py --count 3000 --configs plain,observed,jit,jit-stress,node`
  on d07f63a): 3000 agree, 0 mismatch. `jit`: 994 programs ran compiled code, 978 deopted,
  1166 functions compiled, 32468 refusals, 167839 compiled runs, 8560 deopts, 49 poll exits,
  1025 unlinks. `jit-stress` (threshold 1, a guard fails every 3rd check, never unlinked): 1035
  programs ran compiled code, 905772 runs, 859202 deopts. Refusals in 200 sampled programs
  (ran, `--jit-dump`): opcode outside the subset 1801, a function scope 257, retain of a value
  that is not an argument (backend) 71, closure variables 58.
- Timing (measured on the 7f19981 shell and the 6341d15 engine, wall clock of the whole process, 5 runs each, 2,000,000 calls of `sum(100)`
  from an interpreted loop): plain engine 1013-1328 ms (median 1279), JIT shell without `--jit`
  1250-1336 ms (median 1276), with `--jit` 657-749 ms (median 695). Startup is 5-6 ms for all
  three. Of the 1,999,000 compiled runs, 19,889 left through a poll exit (ran, d07f63a).
- Code size and compile time (measured, `--jit-stats`): `sum` is 989 bytes and took 162-283 µs
  to compile (first compile includes reserving code memory). Over the differential run, 1916
  bytes per compiled function on average and 13.7 µs per hot report, refusals included.

## 7. Calls and frames (milestone 7, workstream H)

Design written before the code of each step; "measured" and "ran" mark what was checked.

### 7.1 Entering compiled code from a call site, before any frame

A call made by the dispatch loop to a linked function no longer goes through `callInternal`.
`enterCallWith` (and `enterKnownCall` for known local functions) still refuses a linked callee
for free (its `frameCells` is the stub sentinel, section 1); the refusal branch, which runs only
when `enterFrame` refused, re-decodes the call out of line (`linkedCall`) and, when the callee is
linked, runs the machine code on the caller's operand cells (`enterCompiled`): no frame, no
`activation.publish`, no debugger activation. The interrupt counter is charged as for an inline
entry.

- **Return**: the operands from the callee's cell up are released and replaced by the result;
  the caller continues at the next instruction, as after a leaf run.
- **Deopt or poll exit**: the exit already carries the whole interpreter state, so only now is a
  frame built: an *inline* frame (`activation.enterResumed`: `enterFrame` with the frame size
  the link saved in `CompiledEntry.frameCells`, not counted, without the `push_this` prologue),
  into which `js_compiled.restore` writes the exit state. The dispatch loop then simply runs that
  frame; its return goes through `finishInline` like any inline call.
- **Skipped**: while instructions are observed, or when the region has no room for the frame a
  deopt would need (checked before running the code, `activation.linkedRoom`), the call falls
  back to `callInline`, which runs the code too (`callCompiled`) and on a deopt continues in a
  base frame: `callInternal` is a wrapper of `callResuming`, whose extra `Resume` argument (a
  constant "none" at every other call site, so the inlined copies fold it away) makes the new
  frame restore an exit instead of starting at offset 0. `callKnown` takes the same argument.

Why the refusal is decoded again instead of passing its values on (measured): passing the
already decoded function, callee, arguments and receiver to the out-of-line path from the
refusal branch kept them live across the inlined `enterFrame` in every call arm and cost the
interpreter-only micro loop below 2.2 percent more instructions; re-decoding cost 0.1 percent.

### 7.2 Leaf functions

A leaf (`FunctionBytecode.leaf`) runs frameless and uncounted from interpreted callers, and
counting leaf runs cost up to 0.9 percent of all instructions (tier-seam.md). The trigger chosen
is "the caller is compiled": a call made by compiled code goes through the runtime call (7.3),
which enters callees through `callInternal`'s `describe` and therefore counts them, leaves
included. A hot leaf called from compiled code is reported, compiled and linked (linking already
clears `leaf`); from then on interpreted callers reach it through 7.1 and compiled callers
through 7.4. A leaf called only from interpreted code stays an interpreter leaf, which is the
cheap case the leaf runner exists for; the interpreter-only cost of this choice is zero.

### 7.3 Calls from compiled code: call exits

As built, and off by default: the shell compiles functions that make calls only with
`--jit-calls` (`Options.calls`), because a generic call from compiled code still costs more than
the interpreter's inline call (measured below). Without the flag, `lowerFunction` refuses a
function that makes a call, so `--jit` behaves as before.

SSA: `call.arg v, k` (one per argument, contiguous) then `v = call v_function, v_this, n exit e`,
which produces an owned `value` and is `mayReenter`. The exit names the frame state before the
call, with the call's operands still on the operand stack as the interpreter holds them. The
translator emits it for `call0..3`, `call` and `call_method`, refuses more than 8 arguments,
and refuses a callee that is not a boxed value.

**A call is an exit, not a native call.** The first design called a helper from machine code;
that needs the engine's hooks and allocator from inside generated code, which the engine cannot
give without making them process-local. Instead the code leaves and the engine makes the call:

- `CompiledFrame.calls` (offset 48) points to the frame's *call block*, `u64` words:
  word 0 the resume word, word 1 the site (pc low, argument count high), words 2-3 the result,
  from word 4 the area (callee, receiver, up to 8 arguments, 2 words each), from word 24 the
  saved values (value `v` at `24 + 2v`). `CompiledEntry.callWords` is its size, 0 when the code
  makes no calls.
- At a call the code writes the area and the site, writes `(point + 1) << 2` to word 0, copies
  the values live after the call (`ssa_liveness.savedAcross`, plus the call exit's values) from
  their frame slots to the saved area, and returns `EXIT_CALL` (4).
- `enterBase` (js_vm) loops while the exit is `EXIT_CALL`: `compiledCall` sets the frame's pc to
  the instruction after the call (backtraces show the right line), makes the call through the
  engine's catching entry (`callForCompiled`: natives as the interpreter calls them, bytecode
  through `callInternal`, a linked callee without calls frameless through `runCode`), writes
  the result and ORs how it went into word 0 (0 returned, 1 threw, 2 deopt), then runs the code
  again with the same arguments.
- The prologue reads word 0: 0 is a fresh run; otherwise it jumps to that call's resume label,
  which copies the saved values back to their slots and continues, or on a throw or deopt
  returns `EXIT_THROW` (3) or `EXIT_DEOPT` from the call's exit stub with the state before the
  call.
- **Throws.** No unwinding through generated code happens. After `EXIT_THROW` the engine
  restores the state into the base frame and takes the branch the `callInternal` loop takes when
  `execute` fails at the call (`exceptionBoundary`, then `unwindFrames`), so handlers and the
  release of the call's operands are the interpreter's own.
- **Deopt at the call.** A callee the engine wants to run inline (a known local function,
  `FunctionBytecode` value) gives `CALL_DEOPT`: the frame is restored at the call and the
  interpreter makes it.
- **Reentry, GC, the debugger.** The engine reference-counts and never moves objects. Saved
  values are owned (external roots for the cycle collector), immediates, unboxed `i32`/`bool`,
  or borrows of argument cells, which nothing writes while the function runs; other borrows end
  at a `mayReenter` instruction. No stack map is needed. Compiled code never runs while
  instructions are observed.

Functions that make calls run only from a base frame (`enterBase`); `enterCompiled` and
`callCompiled` refuse them, because the frameless entry has no frame to restore a throw into.
No value is held in a register across a call: everything a later exit needs is in its slot.

AOT: the block offsets and exit codes are fixed by the ABI; the block lives on the native stack
of `enterBase`. No per-runtime value enters the code bytes.

Cost (measured, callgrind): with call exits alone, a call from compiled code costs more than
the interpreter's inline call (7.4 has the numbers), which is why `--jit-calls` stays off.

Box2D under `--jit` (measured): the inline `apply`/`call`/`Reflect.apply` and lazy-`arguments`
paths in `callInline` refused linked targets and built an arguments object instead, which made
Box2D 4.3 percent slower than plain once its two empty functions were compiled. `callLinked`
now runs a linked target from those paths frameless, and `lowerFunction` refuses bodies shorter
than 3 bytes (nothing to gain, ~180 instructions of entry per call). Box2D with `--jit` is now
0.12 percent below plain (2,506.5M against 2,509.5M).

### 7.4 Direct calls to a compiled callee

As built (behind `--jit-calls`, like 7.3). Before taking the call exit, the code calls helper
`CALL_FAST` (jit_helpers, index 32) with the frame and the call block; the helper is
`js_vm.fastCall`, which needs no hooks because only machine code runs:

- When the callee is a bytecode closure linked to code that makes no calls, instructions are
  not observed, and its exit state fits the block's `CALL_STATE` area (64 words), it builds the
  callee's `CompiledFrame` (receiver = the area's cell, captures from the closure object) and
  runs `runCode` on the area's argument cells. A return writes the owned result to
  `CALL_RESULT` and the caller continues **without leaving** (`FAST_RETURNED`).
- A callee that leaves at a deopt or poll has already run: its state stays in `CALL_STATE`
  and `CALL_CALLEE_EXIT` names its exit and index (`FAST_EXITED`). The caller then takes the
  call exit as usual, and `compiledCall` finishes the callee interpreted from that state
  (`callResuming` with a `Resume`), so nothing runs twice.
- Anything else is `FAST_GENERIC`: the ordinary call exit of 7.3.

The guard is dynamic (the callee's own `compiled` index), not call-target feedback: a site
whose callee changes still takes the right path, and no address enters the code. Values live
across a call are already in their slots (x64_regalloc), so the helper call needs nothing but
the usual input reload.

**Calls to interpreted code.** A call exit to a bytecode callee that has no code costs more
than the interpreter's inline call (a base frame through `callInternal`). When js_hotness has
already reported that callee (its count is past the runtime's budget) and it still has no code,
it was refused or is waiting to compile, so `compiledCall` answers `CALL_DEOPT`: the caller
deoptimizes there and the interpreter makes the call; enough of these unlink the caller. A
callee that is not hot yet is still called through the exit, which counts its entry, so a
callee that is hot only through compiled callers still gets compiled.

Measured (callgrind, `--jit --jit-calls`): `each(inc, 10)` 3000 times, 18,992 direct calls,
21.8M instructions with call exits only, 17.4M with direct calls, 15.2M interpreted. Box2D
(Octane, 3 runs): 2,549.3M before the interpreted-callee rule, 2,511.0M after (plain
2,509.5M). The remaining gap to the interpreter on the micro is the helper (about 90
instructions per call, `fastCall` and `capturesOf`) and `runCode` (about 57); calling the
callee's code from machine code would remove both but needs object layouts in the code.

### 7.6 Callees that make calls: the activation stack and native nesting

As built (behind `--jit-calls`). Code that makes calls no longer needs a base frame of its own.
Each such run is an **activation**: a LIFO record on a per-runtime side stack that the JIT lends
the engine (`runtime.setActivationStack`, 2 MiB, `CompiledTable.activations`). A record holds
the `CompiledFrame`, the prepared code, the argument cells, the exit state, the call block and
a `StackFrame` that is published only when something reads the frame chain.

- **Nesting.** `fastCall` (CALL_FAST) pushes an activation for a linked callee whose code makes
  calls and runs it at once on the native stack, up to 64 levels (`NATIVE_NESTING`). A return
  writes the result into the caller's `CALL_RESULT`, pops, and the caller goes on without
  leaving. Any other exit is recorded in the child's activation, and the caller's block is
  marked `CALLEE_PUSHED` (with the child at `CALL_STATE`), so every native level returns at once
  to the runner.
- **Runner.** `runActivations` continues the innermost activation from its recorded exit:
  calls the code cannot make go through the engine (`activationCall`, with the CALL_DEOPT rule
  of 7.4), and a deopt, poll or throw is finished interpreted from the saved state
  (`callResuming`, or `callKnown` for a known root), then the parent continues with the result.
  Interpreted callers enter code that makes calls the same way (`callCompiled` from
  `callInline`), on the caller's operand cells.
- **Depth.** When the side stack is full, or past the native nesting limit, the call is generic
  (`callInternal`), whose stack check raises the engine's usual RangeError. Measured maximum
  recursion: plain 2273, `--jit-calls` 1842.
- **Frames.** Before a call through the engine and before a deopt finish, `publishActivations`
  links the activations' `StackFrame`s, so backtraces, `arguments` and the active function see
  the compiled callers (backtraces name the call's pc + 1, as the interpreter does).
- **GC.** Every value a native frame or call block holds across a call owns a count; the
  refcount collector treats running activations as external roots, so nothing needs scanning.
- **AOT.** The side stack, its records and the prepared code pointers are per runtime and never
  stored; the code only sees the ABI's block offsets, `CALLEE_PUSHED` and CALL_FAST's index.

The design is a side stack rather than calls from a C helper straight into the engine because
the engine's call path is generic over its hooks and allocator effect, which a helper reached
from machine code cannot name; only a caller with the concrete types (the runner) can make
those calls.

### 7.7 Calls from machine code

As built (behind `--jit-calls`). Before CALL_FAST, an ordinary call site (not `new`) checks in
machine code whether it can call the callee's code itself: the callee is a bytecode closure
(object tag, class), its bytecode has a `compiled` index within the runtime's table,
instructions are not observed, and the entry's `directArity` is at most the site's argument
count. The code then builds the callee's `CompiledFrame` in the call block (`CALL_FRAME`, 9
words), counts the run and calls the entry's code through the runtime's entry table. A return
leaves the owned result at `CALL_STATE`; an exit stores `exit | index << 32` in
`CALL_CALLEE_EXIT` and takes the call exit, which `compiledCall` finishes as in 7.4.

- **Nothing is baked in.** The guard is the callee's own index and the code address is loaded
  from its entry, so a site whose callee changes, or code that is relinked, still takes the right
  path, and AOT code needs only the offsets.
- **Offsets.** The object, closure, bytecode, runtime and entry offsets the code reads are the
  `DIRECT_*` constants in js_compiled. `js_vm.directLayoutHolds` checks every one against the
  engine's own accessors, and a JIT test runs it on a plain and a capturing closure, so a layout
  change fails a test instead of the code.
- **Readiness.** `directArity` stays `DIRECT_NOT_READY` until the first CALL_FAST call of a leaf
  callee caches its realm, code, counter and arity, and only when its exit state fits
  `CALL_STATE`. For a callee whose code makes calls, the first CALL_FAST call that pushes its
  activation readies it the same way, with the arity at the site's argument count.
- **Callees that make calls.** When the entry's `callWords` is not zero, the code pushes the
  callee's activation itself (`nestedCall` in x64_backend): it checks the runtime's depth against
  `DIRECT_NESTING` and the activation stack's room, fills every `DIRECT_ACT_*` field of the next
  record (28 words, header 48), calls the code and drops the depth. A return pops the record, or
  calls helper `CALL_POP` (`vm.popDirect`) when the engine published it during the run; an exit
  marks the record `CALLEE_PUSHED` and takes the call exit, and `compiledCall` continues the
  activation as in 7.6. Any failed check takes CALL_FAST instead.
- **Interpreted callers.** An interpreted call to code that makes calls (`callInline`, through
  `linkedCall` with `handOff`) starts an activation and runs it on the native stack; a run that
  leaves is parked in `CompiledTable.handedOff` and that `callInline` continues it before
  anything else. Getter and setter calls keep the base-frame path.

Measured (callgrind): calls kernel 336 instructions per call interpreted, 227 compiled; method
kernel 496 per iteration interpreted, 318 compiled; deltablue `--jit-calls` 1.739x plain,
richards 1.031x (the rest is mostly the 17 functions the JIT refuses).

### 7.8 Generic instruction exits (milestone 7, stream N)

As built. An instruction the JIT has no machine code for, but whose effect on the stack is
plain (it pops n values and pushes zero or one, and touches nothing else of the frame), is
translated as a call exit that runs that one instruction in the engine. There is no separate
exit kind: it is an SSA `call` with `k = n | calls.GENERIC`, an undefined function and receiver
and the operands as `CallArg 0..n-1`, so liveness, register allocation and ownership treat it as
any call, and the site word carries `SITE_GENERIC` (bit 41).

- **Which instructions.** `ssa_translate.genericOpcode`: typeof, instanceof, in, delete, pow,
  to_object, to_propkey, object and regexp literals, array_from, the class and private-field
  instructions (define_field, set_name, set_proto, define_method(_computed), get_super,
  get(put/define)_private_field, private_in, add_brand, private_symbol), push_bigint_i32 and
  push_const of a non-number. At most 8 operands.
- **Frame state.** The exit state is the state before the instruction, operands on the stack,
  so a throw is unwound by the interpreter from the instruction's own pc, and a deopt resumes
  there.
- **Engine side.** `compiledCall` and `activationCall` send a `SITE_GENERIC` site to
  `compiledOp`. It retains the operands (they sit at `CALL_AREA + 2` slots, borrowed from the
  code), copies the caller's `Machine` (an activation's comes from `activationMachine`), points
  its stack at the area with `ip = pc + 1` and the pc published, and runs `genericStep`, which
  calls each family's general step only, never a fused or quickened path. The pc must then be
  the next instruction, or it traps. The result is left owned in the area's first slot
  (undefined when nothing is pushed); a throw is materialized, what is left on the stack is
  released and the exit reports `CALL_THREW`.
- **Several values.** An instruction that leaves more than one value (for-of and for-in
  steps, define_array_el, append, check_ctor_return) carries the count R in `k` bits 12-15 and
  a mask of the operand cells it leaves unchanged in bits 16-23 (`ssa_translate.genericResults`
  and `genericKeptCells`; site bits 44-55). `compiledOp` checks the stack holds R values and
  releases its copies of the kept cells. The code keeps its own values for those cells, takes
  cell 0 from the call and reads every other cell with `call.result c`, right after the call.
  One mechanism serves streams P and Q.
- **Widened equality and named stores.** Bits 56–57 of the site word encode the
  specialized fallback for a named store (2) or equality (3). The operands are the
  two values at the front of the call area. Generated code first tries the native
  helper. When that helper declines, the engine runs the bytecode operation with
  its normal coercion, setter and exception behavior, then returns the result in
  `CALL_RESULT`. The code generator uses bit 26 of the SSA immediate to distinguish
  `!=` from `==` on the helper path. The engine reads the original opcode. The
  multi-result counts, kept-cell mask and call-policy flags use their existing bits.
- **No `--jit-calls` needed.** `calls.callsFunctions` ignores generic sites, so a function whose
  only calls are generic exits compiles with plain `--jit`.
- **OSR.** Loops compiled for OSR refuse calls, so they refuse generic sites too.
- **Counters.** `generic-sites` (sites installed) and `generic-runs` (exits taken, counted in
  machine code at `CompiledEnv.genericRuns`).

### 7.9 Calls to callees without code

As built. A call from compiled code to a bytecode callee that has no code is made by the
engine (`callFromCompiled`) when the callee is not hot yet or waits to compile: it is pending
report, or `jit_recompile.backoff` put its recompilation off (its count is past the budget but
below `js_hotness.REPORTED_FLOOR`). A callee the JIT refused for good (count parked at or above
REPORTED_FLOOR, or loop code only) makes the caller leave with CALL_DEOPT, because the
interpreter's inline call costs less than a base frame (`js_vm.leavesForCallee`). A known local
function (`ValueBits.FunctionBytecode`) always leaves, since its value needs the caller's frame.

A call pc that deoptimized in an earlier compilation carries `SITE_CALL_ALWAYS` (bit 42, k flag
`calls.ALWAYS`; not at `Translator.depth != 0`). Whether such a site calls a refused callee is
the one constant `js_vm.CALL_ALWAYS_REFUSED`, off: measured with it on (callgrind, v8 suite,
`--jit --jit-calls`), deltablue went 1281.6M to 1152.3M instructions but raytrace 1819M to
2224M and earley-boyer 1226M to 1463M, their calls to refused callees paying a base frame each.
Turn it on once calls from compiled code into the interpreter cost less than its inline call.

### 7.5 Inlining (design only unless time allows)

A small monomorphic callee is translated into the caller's SSA at the call (its `arg n` are the
call's operands). Every exit inside the inlined body carries two frame states, the caller's
(at the call, its operands on the stack) and the callee's; the engine rebuilds the caller's frame,
then the callee's frame inline above it, so the interpreter returns into the caller normally.
