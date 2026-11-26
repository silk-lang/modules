# Loops: polls, loop hotness and on-stack replacement (milestone 7, workstream I)

Built on [compiled-entry.md](compiled-entry.md) and [tier-seam.md](tier-seam.md). Statements
here are design unless marked measured or ran; numbers are in the last section.

## The problem

Before this, a compiled function's loop left for good at its first interrupt poll (the
interpreter finished the loop), and a function entered rarely that loops for long was never
reported hot, because only entries are counted. Most of the time of loop-heavy code
(navier-stokes, crypto, any benchmark's main loop) therefore stayed in the interpreter.

## One mechanism for all three

Everything happens at the interrupt poll on a backward jump, which the plain dispatch loop
already takes at most every `JS_INTERRUPT_COUNTER_INIT` (10000) back edges and calls. The
poll branch of each back-edge arm (ten arms in `js_vm.silk`: `if_false`, `if_true` and their
8-bit forms, `goto`, `goto8`, `goto16`, `if_nullish8`, `if_not_nullish8`, the fused loop
prefix) is one call to `backEdgePoll` (`js_vm.silk`, out of line), which runs
`interrupts.handle`, reports a hand-off to the observed loop, and otherwise calls
`js_vm.osrAtPoll` (which asks `js_compiled_osr.target`) with the frame written back. The observed loop never reaches
it. Measured: adding that call inside each arm cost richards +0.35 percent
instructions, all of it in the dispatch loop's own code (register pressure), none on the poll
path; with the whole slow path behind one out-of-line call the eight benchmarks are 1.000x.

`target` looks at the running frame, base or inline (`current` in `executeLoop`):

1. **Loop hotness.** No code linked (`FunctionBytecode.compiled == 0`): `js_hotness.loopPoll`
   reports the function at once, the way an exhausted entry budget does (parked in
   `hotPending`, budget `u32.MAX`, polls forced, delivered at the next poll), with the header pc
   in `CompiledTable.loopPc` (`js_runtime.hotLoopPc`; `u32.MAX` for a report from entries). A
   poll that lands on a back edge of a frame means that frame has been looping; one is enough
   evidence. A function already reported (budget at or above 2^31), or with no handler set, or
   while another function waits, is skipped. A refused function is not reported again (its
   budget stays parked), unless K's recompile rule resets it.
2. **A header with no entry yet.** Code linked, but no `OsrEntry` for the frame's pc (at depth
   0): the function is reported again with that pc, and the embedder adds an entry for that
   header alone, compiled or refused (null code, so polls there stop asking).
3. **On-stack replacement.** The entry has OSR code for the frame's pc and operand stack depth:
   run it on the live frame (below). After a poll exit, reset the counter, run
   `interrupts.handle` with the frame whole again, and enter again. So a long loop stays
   compiled across polls (step a of the brief) and the handler (debugger, hot-function
   delivery, compile and link) never sees a half-written frame.

A normal compiled entry that leaves through a poll exit (from `callInternal`) resumes in the
interpreter at the loop header with the counter at 0, so the interpreter polls at its next back
edge and enters the OSR code there: one interpreted iteration per call, not the rest of the
loop.

## The OSR artefact

One artefact per loop header (`ssa_translate.translateOsr`, `x64_lower.lowerOsr`), on the
unchanged compiled-entry ABI:

- **Inputs.** The function takes `argumentCount + localCount` arguments: the frame's arguments,
  then its locals (local `i` is argument `argumentCount + i`). The engine writes each as an
  argument word (Int and Bool unboxed, anything else named by its position, kind 6). The entry
  block makes each local an owner of the frame's value with a `retain` of that argument, exactly
  as `get_arg` does, so the ownership pass, verifier and backend need nothing new.
- **Only the loop** is translated: the code reachable from the header (`shapeAt` walks from the
  header with an empty stack) inside the outermost loop around it (`loopRegion`: the ranges
  [target, jump] of backward jumps that overlap the header's, merged). Code before and after
  that loop never matters; a jump out of it is an exit, which the engine counts as the loop
  finishing, not a deopt (`OsrEntry.start`/`end`). Covering the outermost loop keeps a short
  inner loop compiled across its outer iterations. Before this, the artefact ran to the end of
  the function, and a 41 KB emscripten function in zlib translated most of itself once per
  header (85 artefacts, 23.9 MB, 2.4 s of compiling).
- **Side exits.** An opcode outside the subset does not refuse the artefact: the block ends
  with an exit there that is always taken (`sideExit`: an `unbox.i32` of `undefined`). Cold
  paths in or after a loop (a property write on the last iteration, the code after the loop)
  then cost nothing; a hot one costs one entry and one exit per poll until the deopt limit.
- **Headers** are the targets of backward jumps (`loopHeaders`, a linear decode).
- **Operands at the header.** A header inside a try region or a for-of loop has operands on the
  stack, and their layout is static: `ssa_translate.osrMarkers` lists them from the bytecode,
  outermost first. A catch marker is a constant (`CatchOffset`). A for-of record whose loop has
  the parser's shape (`for_of_start; goto next; body ... next: for_of_next 0; if_false body`) and
  is open at the header is three slots, iterator and method (inputs) and its marker (a
  constant), plus the element when the header is the body's start. Any other for_of_start
  before the header refuses the artefact. Inputs follow the locals as arguments
  `argumentCount + localCount + slot`; `OsrEntry.depth` is the slot count, and the engine enters
  only at that depth (`knownHeader`). On every exit, return included, the engine pops those
  operands and releases them; the exit state holds the whole stack.
- **for-of steps.** `for_of_next` compiles for the interpreter's stand-in record over a fast
  Array (`js_iterators.forOfStart`: the array in the iterator slot, the next index as an Int in
  the method slot): unbox the index, `get.elem` with `k = ELEM_STEP`, whose miss (a hole, the
  end, an array no longer fast) is a deopt exit at the `for_of_next`, then index + 1. That exit
  is no OSR deopt when the record is a stand-in (`standInStep`): the interpreter takes the end
  or the slow step as it would. A real record (Set, Map, string, generator, a custom iterator)
  fails the unbox at the first step, which is an ordinary deopt and backs off.

`jit_runtime.compileHot` compiles OSR code only for the header in the report, next to the
normal entry; a function reported from entries gets none until a poll lands in one of its
loops (step 2 above, `addHeader`). Per table entry, at most `OSR_HEADERS` (8) headers compile and
at most `OSR_BUDGET_NS` (50 ms) is spent on them; a loop over `OSR_LOOP_BYTES` (16 KB) of bytecode
is refused. `CompiledEntry` has `osr`/`osrCount` (an embedder array of `OsrEntry { pc, depth,
code, callWords, start, end }` plus counters the engine writes; the embedder replaces the array
to add a header, keeping the old one allocated) and `osrRuns`/`osrDeopts`. A function whose
normal entry is refused but has OSR code is linked with `js_runtime.linkOsr`: the entry's
`code` is null, `js_compiled.enter` returns at once for it, and inline calls are not redirected
(no `frameCells` swap), so its calls keep interpreting and only its loops run compiled.

## Entering and leaving a live frame (`js_compiled_osr`)

Unlike a normal entry, the frame's locals hold owned values while the code runs.

- **Deopt and poll exits** (`restoreLive`): every exit word is materialized first (kind 6 is a
  retained copy of the named argument or local, read from cells the code never wrote), then each
  local that changes is written and its old value released. A word naming the local's own cell
  leaves it alone. Operand stack slots are pushed; the stack was empty at entry.
- **Return.** The backend now also writes the return instruction's pc to `state[1]` on
  `EXIT_RETURNED` (a normal entry ignores it). The engine pushes the result (for `OP_return`)
  or drops it (`OP_return_undef`) and sets the pc there, and the interpreter executes the return.
  The frame's locals still hold their entry values, which that return releases. Base frames and
  inline frames (`finishInline`) need nothing of their own, and construct frames keep their
  return rule.
- **Deopts.** OSR deopts (exits inside the loop) are counted apart from the normal entry's.
  An OSR-only function is unlinked at `deoptLimit` and reported again, so jit_recompile widens
  the sites it deoptimized at (new information; it refuses a function that deopts again where it
  was widened). A linked function's OSR code is not recompiled: after its nth deopt the header's
  next 2^n - 1 polls interpret (`OsrEntry.wait`), after 6 it is never entered again, and at
  `deoptLimit` deopts over all its headers no poll enters any. `--jit-dump` prints the opcode
  each OSR entry last deoptimized at, at exit (`jit: osr deoptimized at:`).

## Ahead of time

The OSR artefact is the same compiler run with a different entry, keyed by the bytecode and the
header pc. It has no relocation and names no runtime address (the interrupt counter and stress
word are arguments, as before). `OsrEntry` tables are runtime state, never stored.

## Limits

- for-in loops, and for-of over anything but a stand-in record, have no compiled step yet: they
  need the generic instruction (stream N). A function's normal entry still refuses
  `for_of_start`, so a for-of loop runs compiled only through OSR.
- A loop in a generator, async function or module body is never entered (the translator refuses
  them; `vm.resume` frames would need their own transfer).
- Loop hotness reports at the first back-edge poll in a frame. Calls also charge the counter, so a
  function that only calls in a loop can be reported by a poll on its back edge too; that is
  still a function spending its time in a loop.
- What the hot loops of navier-stokes and crypto need is outside this workstream: element reads
  and writes, closure scope reads (`get_scope0`), bit operations, doubles (see Measurements).

## Measurements

Cloud container (x86-64 Linux, 4 cores), release builds, head of
`claude/project-thread-xytm2y` after merging J's value ABI (a6c063b).

- Interpreter-only cost, no JIT (measured, `v8bench.py --instructions`): against a 14e4181
  (no hook) build, all eight benchmarks 1.000x except regexp 0.984x (that benchmark varies by
  about 1.7 percent between builds of the same code). The first placement, a call in each arm,
  was richards 1.0035x, earley-boyer 1.003x.
- A loop that stays compiled (measured, wall clock, 3 runs): 1e8 iterations of an int loop in
  a function called once, plain engine 835-990 ms, `--jit` 478-637 ms; 10000 OSR runs, 9999
  poll re-entries, 0 deopts. (Before the value ABI: 379-472 ms.)
- Differential (ran, 3000 programs, plain, observed, jit, jit-stress, node, with the long-loop
  phases): 3000 agree. jit: 33707 OSR runs, 23889 OSR entries compiled, 13980 functions linked
  for OSR only, 31831 OSR deopts (mostly side exits). jit-stress: 39392 OSR runs.
- navier-stokes and crypto (ran, `--jit-stats --jit-dump`): navier-stokes now reports 8 loop
  functions (none before) and compiles 25 OSR entries; crypto reports 14 and compiles 17. Every
  entry leaves at its first side exit, so the time does not move (5 runs each, within noise).
  Opcodes outside the subset inside their loop bodies (static sites): navier-stokes
  `get_scope0` 96, `put_array_el` 33, `get_arg_el8` 29, `get_array_el` 16, `insert3` 10;
  crypto `put_array_el` 24, `get_loc_field8` 24, `get_loc_el8` 23, `get_var` 22, `get_field2`
  16, `call_method` 12, `and` 11, `shl`/`sar` 7 each, plus doubles throughout.
