# Compile cost (milestone 7b, stream O2)

Built on [ssa.md](ssa.md), [compiled-entry.md](compiled-entry.md) and [osr.md](osr.md).
Statements are design unless marked measured or ran. Numbers are instruction counts under
callgrind (`--smc-check=all-non-file`) for one fixed iteration, or `--jit-stats` counters.

## What it cost, and why

Measured at integration ea9965d0, Octane zlib, one iteration, `--jit`: 83.8G instructions
against 56.0G plain, 27.7G of them in `compileHot`, 24 MB of machine code. Mandreel: 36.0G
against 23.3G, 12.8G compiling, 23 MB of code. Four causes, largest first:

1. Every loop header of a hot function got its own OSR artefact, each a whole run of the
   pipeline over the whole function, again at every report. zlib has one function of 41,803
   bytecode bytes with 47 headers.
2. The ownership pass was quadratic: a sweep of the function per replaced value
   (`replaceAll`), a sweep per unboxed parameter web, a compaction after every pass.
3. Every exit names every local and operand, so exit slots outnumber instructions about ten
   to one (measured on box2d's compiled functions: 8,252 instructions, 3,707 exits, 82,211
   slots). Anything that walks slots per pass, or per value, multiplies that.
4. The backend emitted code per exit slot: 24 MB for zlib.

## What changed

- Loops compile one at a time, when a poll lands in them, bounded to the loop, with a budget
  and a backoff when the code deoptimizes (the loops stream; [osr.md](osr.md)).
- The ownership pass applies replacements through a forward map in one sweep, indexes
  incoming edges, hashes common values (the doubles stream), and:
  - decides parameter unboxing for the whole function first, as fixed points over the
    incoming edges, then rewrites instructions, edges and exit slots in one sweep
    (`ssa_ownership.unboxParams`). The SSA it produces is the same; the goldens did not move.
  - gives exit slots their modes from a table computed once per value (`fixSlots`).
  - compacts only where the next pass reads what a rewrite left stale: block ranges after an
    insertion, parameter ranges after a removal. Passes skip removed instructions.
- The verifier's ownership check counts the distinct moves of an exit against the number of
  outstanding owned values, linear in the exit's slots. It only walks every value, as before,
  to name the offending one when that count fails, so it accepts and rejects exactly what it
  did.
- `--jit-compile-budget=N` (default 32768) caps the bytecode bytes translated for one
  function over all its entry compilations (the doubles stream).
- A function unlinked for deoptimizing waits before it is compiled again: 8 hot budgets of
  entries before the first recompilation, 64 before the second (`jit_recompile.backoff`). A
  report from a loop poll compiles at once: that loop is running now.
- Exits are tables (next section).

## Exit tables

Compiled code no longer carries code per exit. A guard jumps to a two-instruction stub
(`lea rax, [record]`, `jmp common`); the function's one common stub stores the registers
that may hold values below the frame and calls helper `EXIT_STATE` (index 120,
`jit_exit_state.jitExitState`), which writes the interpreter state the record describes and
returns the exit status. The tables are read-only words after the code.

Record, in u32 words: pc, operand stack depth, code, slot count, entry count, then one word
per chunk: the chunk's byte offset from the record. `code` is the status to return, or
`CODE_FROM_FRAME` plus the frame offset of a u32 that holds it (a call's exit). A chunk is
eight entries of two words, kind and operand; equal chunks are stored once per function, so
exits that agree on a run of eight slots share it. Kinds: an i32, bool or double in a frame
slot or in a register; a constant; a value handed over as it is; a value with one count added
(a borrow); and, after the slots, a value the exit releases.

An exit's last chunk, when it has fewer than eight entries, is stored at its own length after
the full chunks (the helper reads only the entries the record counts), shared with one of the
four tails before it when equal. Measured, code bytes with calls compiled: deltablue (v8 copy)
193 KB to 178 KB for 3,406 bytecode bytes (57 to 52 bytes per bytecode byte), box2d 875 KB to
809 KB (19.2 to 17.8), zlib 482 KB to 443 KB (5.9 to 5.4).

Nothing in a record is an address or a runtime identity: offsets are relative to the record,
so the code stays loadable into another runtime.

Measured (code bytes, one iteration, `--jit`): zlib 24.3 MB to 3.05 MB and mandreel 23.2 MB
to 4.79 MB with the tables alone; 234 KB and 864 KB with per-loop OSR as well.

## Recording before the first compilation

Measured at 1e70f07 with `--jit --jit-calls`, one iteration: of box2d's 31 compiled functions
26 were unlinked for deoptimizing, raytrace 16 of 17, splay 37 of 38, typescript 559 of 615.
The first code guessed int32 at every arithmetic site and a boolean at every branch, and
learned otherwise 8 deopts and one recompilation at a time (`jit_recompile`).

Now a function reported hot is not compiled at once. `jit_runtime.compileHot` starts a
`js_feedback` recording of it (`--jit-profile=N`, default 100 instructions plus 2 per bytecode
byte; 0 compiles at once) and sets its entry count to 24, or to the hot budget when that is
smaller: a count above the budget would make the engine take it for a function without code
(`js_vm.reportedWithoutCode`). At its next report, from those entries or from a poll in one of
its loops, `learn` stops the recording and reads it:

- an arithmetic or comparison site that saw a double operand or an int32 overflow becomes a
  number site (the translator's `doubleSites`, as after a deopt);
- a branch (`KIND_BRANCH`, new in js_feedback: `if_false`, `if_true`, their 8-bit and keep
  forms, `lnot`) that tested something other than a boolean, or that the recording never
  reached, uses ToBoolean instead of a boolean guard;
- the function is refused, never compiled, when the recording shows a site its code would
  deoptimize at every time: a call whose target was reported and has no code, arithmetic or a
  comparison on a string, object or other non-number, a named property of a non-object, a
  store to objects of five or more shapes.

Each refusal has a bit in `Options.foresee` (`--jit-foresee=MASK`, `jit_runtime.FORESEE_*`:
callee 1, numbers 2, receiver 4, store 8). A bit stands for an exit compiled code takes today;
when that exit becomes a slow path, clear the bit and those functions compile again.

A function the translator's first walk refuses (`ssa_translate.admits`) is not recorded.
Recording runs the whole runtime in the observed loop, about 170 instructions per bytecode
instruction (feedback.md), so the length is a trade. Measured on Octane with calls compiled,
instructions for one iteration. Fixed length N = 0, 200, 500, 2000 (no per-byte part): box2d
1458M, 1573M, 1363M, 1413M; typescript 18.1G, 13.66G, 13.66G, 14.43G; splay 1559M, 1441M,
1458M, 1612M; deltablue 78.0M, 78.5M, 83.6M, 92.9M; richards 53.0M, 54.1M, 55.1M, 57.1M.
With 2 per bytecode byte added, N = 1, 100, 500: box2d 1263M, 1307M, 1227M; typescript
13.01G, 13.24G, 13.27G; splay 1488M, 1461M, 1509M; raytrace 202M, 191M, 199M; crypto 775M,
775M, 787M; richards 53.8M, 53.5M, 59.4M (52.2M with no recording). Tiny runs where nothing
was unlinked only pay: the per-byte part keeps that near 3 percent on richards, where a fixed
500 cost 14 percent.

The recompile wait (`jit_recompile.backoff`) leaves the waiting function's count above the
hot budget on purpose. Counting the wait in reports of one budget each, which keeps compiled
callers linked and calling it through the engine, was measured and is worse: box2d 1436M to
1776M, typescript 16.8G to 18.8G.

What recording cannot see is what changes after it: a store the field helper declines (an add
that needs the slot list to grow), a callee that loses its code later, element accesses, a
branch that tested booleans for 500 instructions and an object afterwards. On typescript these
still unlink 222 of 273 compiled functions (`--jit-dump` prints `jit: unlinked after:
<opcodes>` per function: `put_field` 70, `call_method` 68, `put_array_el` 15).

## Counters

`--jit-stats` adds `translate-ns optimize-ns verify-ns backend-ns` (wall time by phase,
refusals included), `attempts` (pipeline runs), `bytecode-bytes` (handed to the translator),
`ssa-translated` and `ssa-optimized` (instructions before and after the ownership pass),
`over-budget`, `waited`, `profiled` (functions recorded first), `learned` (sites the
recordings gave) and `foreseen` (functions refused from their recording). `--jit-dump` prints one `jit: cost entry|osr ...` line per
pipeline run and the SSA the backend receives (`jit: optimized ssa`).

## The test

`ssa.Function.work` counts the instructions and exit slots the rewriting passes walk
(compaction, forward-map sweeps, slot fixing, unboxing). `ssa_tests.compileWorkStaysLinear`
builds the same straight-line function at two sizes and fails when 3.7 times the bytecode
costs more than 6 times the work, or when the work per bytecode byte exceeds twice what it
was when written (78; the bound is 160). Before the one-pass unboxing the larger function
cost 13 times the smaller and 1,220 per byte.

## What is left

- Exits times locals is still the unit of cost. Sharing one snapshot of the locals between
  exits where no local changed would cut the slots about four times on box2d (82,211 to
  19,808, counted from the dumps). It changes `Function.slot` and every pass that walks
  slots, and the calls stream is extending exits now, so it is not done here.
- Compaction costs about 350 instructions per SSA instruction and still runs about eight
  times per compilation.
- Code that is compiled and then unlinked is still the largest waste where the cause is not a
  number guess: see the last paragraph of "Recording before the first compilation". Those
  sites need a slow path in compiled code instead of an exit.
- `OSR_BUDGET_NS` is wall time (read), so what compiles can differ between a native run and
  one under callgrind. typescript's callgrind totals varied by 5 to 7 percent between runs of
  the same binary and flags (measured: 16.8G, 18.1G, 18.8G); whether the budget is the cause
  was not traced.
