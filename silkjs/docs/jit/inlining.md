# Inlining

A call from compiled code costs far more than the few instructions a small callee runs:
the call area, the frame, the entry ABI, the exit state and the return. Inlining translates
the callee's bytecode into the caller's SSA function at the call site, so the call
disappears and the callee's values flow into the caller's as ordinary SSA values (an
unboxed `i32` argument stays unboxed, a returned comparison stays a `bool`).

This page describes what is built. The files are `ssa_translate.silk` (the translator's
inline mode), `ssa.silk` (`Exit.drops`, `Inst.frame`, `check.callee`, `inline.frame`),
`x64_backend.silk` (their lowering), `jit_runtime.silk` (candidates, symbols) and the
engine's `js_compiled_inline.silk` (what the engine tells the compiler).

## 1. Which calls

A call (`call0`..`call3`, `call`, `call_method`; not `new`) for which the embedder found a
target, from one of two sources:

- **the recording** (`js_feedback`, taken before the first compilation, `--jit-profile`): the
  call site was recorded calling exactly one function, a bytecode function. This covers
  plain calls (a global function, a local, an argument) as well as method calls;
- **the site cache**, for a `call_method` whose function operand is the value of a
  `get_field2` of the same code, when the recording has nothing for the call: the
  interpreter's cache entry for the `get_field2` is current (its site, a prototype key, the
  runtime's shape epoch) and the slot it names holds a bytecode closure.

In both cases:

- the function is a plain function (`FunctionKind.Normal`) of the caller's realm, with no
  closure variables and no scope of its own, at most 460 bytes of code;
- its code is made of the opcodes `ssa_translate.inlinable` lists (a loop is taken on a
  baseline frame: code-quality.md, "Inlined loops"). The list is its own, not "everything the translator supports": an opcode a later
  change adds to the subset (one whose handler reads a table of the function by pc, say) is
  not inlinable until it is put there;
- the body of a plain call does not read `this` (what it is depends on the callee's mode).

The target is a snapshot taken when the caller is compiled (`jit_runtime.candidates`,
`js_compiled_inline.methodTarget` and `plainTarget`). It is a hint. The code checks the
callee's identity every time (section 3), so a wrong hint costs a deoptimization, never a
wrong result.

Candidates nest: a target's own call sites are looked up too, and the translator inlines
at most seven bodies deep (`MAX_INLINE_DEPTH`), 64 sites per function (`MAX_INLINE_SITES`)
and bodies of at most 460 bytes of code each (`MAX_INLINE_BYTES`).

**How much one function takes in.** Those limits bound each body, not their sum: a short
function at the top of a call tree was compiled as the whole tree (Crypto's `decrypt`, 92
bytes of code, became 3,294 instructions with 781 exits), and so was each function between
it and the loop the time is spent in, each of them again when a shape guard in any of the
bodies failed. `Translator.affords` therefore asks where the call is:

- a call inside a loop (of the function, or of a body the call is nested in: `turning`) is
  inlined whatever was spent, as is a body of at most 96 bytes (`INLINE_SMALL`);
- the bodies inlined at calls in no loop sum to at most 920 bytes (`MAX_INLINED_BYTES`,
  counted along the chain of bodies the translator is in: `inlinedBytes`);
- a body with a loop of its own is inlined at a call in no loop only when the call passes
  a literal number (the body is then compiled for it: section 4's `lin_solve`). Otherwise
  it stays a call and runs in its own optimized code, where the calls in its loop are
  inlined.

At scale 20 Crypto's compiled code went from 3.7 MB to 1.3 MB, its compile time from 208
to 87 ms and its compiles from 94 to 70 (45 unlinked to 21); the run from 585 to 493 ms
against node's 341. Richards went from 146 to 137 ms. A limit on the sum alone, with no
exemption for calls in loops, cost Richards 20 ms and RayTrace 70: their hot loops call
through several levels.

A call site at whose pc compiled code deoptimized before (`jit_recompile`'s sites) is not
inlined again: the next compilation makes an ordinary call there.

`--jit-no-inline` turns all of it off. `--jit-dump` prints, per compilation, `jit: not
inlined: <why>` for each call that stayed a call and `jit: no inline target: <why>` for
each `get_field2` whose site cache named none.

## 2. The SSA

At the call site, with the function value `f`, the receiver and the arguments on the
translator's operand stack:

```
check.callee f, k        exit: the caller's state before the call
inline.frame f, k
...the callee's instructions, `frame k + 1`...
```

then the call's operands are released and the body's return value is pushed in their
place. `k` indexes `Function.inlineTargets`.

Inside the body the translator's locals and operand stack are the callee's (locals start
undefined). The differences from translating a function's own code:

- `get_arg n` is the caller's operand `n` (retained when it holds a count, as the
  interpreter's `get_arg` does), or undefined past the arguments passed; the fused forms that
  read an argument cell read that operand;
- `put_arg`, `set_arg` and `step_arg8` write the caller's operand that is the argument (in
  held, releasing what it held), so later reads, loops and the call's own release after the
  body see the new value. A parameter the call passed no argument for has no operand: the
  attempt fails. After such a write every exit of the attempt leaves with the bodies' frames
  (`Translator.paramWrites`), whose call operands carry the new value, as an exit that ran
  the call again would run it on that value; off a baseline frame the attempt fails then;
- `push_this` is the receiver operand, guarded to be an object as in a function's own code;
- `return` ends the body with its value; the callee's locals and leftover operands are
  released first;
- a call inside the body is inlined in turn or fails the attempt.

A body without branches stays in the caller's block and its value may stay unboxed. A body
with branches gets a block for each of its leaders and one where its returns meet. Each of
those blocks takes as parameters, before the body's own locals and operands, the locals
and operands of every frame around the body (`Translator.held`: the function's own state
before the outermost inlined call first, then each body's around this one), so the
translator's rule that a block's state is its parameters holds across the body. The
arguments and the receiver are places in that list. A `return` jumps to the meeting block
with the frames around and its value; after the body the caller's locals and operands are
read back from the list. Each block starts with `inline.frame` again for every body it is
inside, naming the closure as the value it is in that block (the backend takes the closure
of the frame it builds from the last `inline.frame` it lowered for that target).

`Inst.frame` tells the backend whose `CompiledFrame` an instruction reads: field sites,
variables, scopes and atoms of an inlined body belong to the callee's code, closure and
scope. `inline.frame` reserves that frame on the native stack (nine words per target) and
emits nothing: the fast paths read the callee's code address from its relocation symbol and
the runtime from the caller's own frame, and only a path that calls a helper fills the frame
first, as a direct call builds one (compiled-entry.md 7.7): the closure's bytecode cell,
captured cells and scope, the caller's realm and runtime, and the callee's code address.

## 3. Guards and exits

Every guard inside an inlined body, and `check.callee` itself, exits to **the caller's state
before the call**: the call's pc, the caller's locals and its operand stack with the call's
operands still on it. The interpreter then makes the call itself. No engine structure
changes: exit codes, the state words and the call block are as before.

That is sound only if the body has changed nothing the interpreter's own run of the callee
would change again. So:

- an operation is either on the translator's list of operations without effect
  (`withoutEffect`: constants, arithmetic, guards, reads, counts) or it is an effect
  (`put.field`, `put.var`, `put.scope`, `put.elem`, `call`, and anything added later until
  it is put on the list);
- when a guard is requested after an effect of the same attempt, the attempt fails. An
  operation's own guard comes before its own effect, so a body may end in one store.

A failed attempt is rolled back (`Function.mark` and `rollback`: the instruction, value,
exit, slot, block, parameter and edge lists are truncated) and the site is translated as
an ordinary call.

Counts: a body owns values the interpreter frame will not receive (its retained copies of
arguments, the results of its reads). An exit lists them after the frame's slots
(`Exit.drops`, `Function.slotCount`). The exit writes the frame's slots first, then
releases each drop slot whose mode is `move`; a drop slot the ownership pass turned into a
borrow or an unboxed value has another mode and is ignored. The verifier counts a `move`
drop slot as the one move of its value.

`check.callee f, k` passes when `f` is a bytecode closure (object tag, class) whose
FunctionBytecode cell is target `k`'s. The cell's address reaches the code as relocation
symbol `2k` (`2k + 1` is the first byte of its code, for the frame): `Code.link` fills both
when the code is installed, so stored code holds no address. The runtime retains each target
until it is destroyed (`js_compiled_inline.keep`), so the address cannot come to name
another function.

## 4. Local functions without a closure

A variable that is only ever called holds its function's bytecode, with no closure object
(`js_compiler_known`). A call runs it under the caller's scope chain, at the scope of the
level the function was created in (`js_scopes.atLevel`). On a baseline frame such a function
is a target too (`ssa.TARGET_KNOWN_FN`): `check.callee` compares the bytecode cell.

**Its scope.** A body inlined through a guarded `check.callee` into the function's own code,
or into such a body, runs on the frame's own chain (`Translator.ownChain`), and only such a
body may read its scope (`get_scope0`): the backend walks from the frame's scope to the one
of the callee's level (`x64_backend.loadScopeAt`, `levelScope`). A call the body makes to
another local function passes that scope in the body's record (`callInBody`; bit 31 of the
count, as a call from the function's own code).

**Leaving.** An exit inside the body hands the engine a closure made for it
(`jit_helpers.materializeKnownClosure`), which holds the scope: `x64_frame_exit` makes one
per body, outermost first, while the bodies are local functions. A closure counts its scope,
so the scope must be on the heap. `check.callee` tests that where the body begins (a scope
still in its frame has no count) and leaves otherwise, and `jit_runtime.candidates` does not
offer a body that reads its scope while that scope is in its frame. Resuming a body under a
scope in its frame needs the engine to take the scope beside the function (`js_vm.callKnown`
does for a call); that is not done.

**Which.** A variable call's callee is at most 96 bytes of code (`VAR_CALL_BYTES`), so that
long and looped helpers stay calls. A call that passes a literal number has the general
limit (460 bytes): the body is compiled for that number, the branches it decides go, and
`ssa_ownership.fold` makes constants of the conversions and arithmetic on it (`1 * x` is `x`).
NavierStokes' `lin_solve(0, p, div, 1, 4)` in `project` is the case: the relaxation loop
keeps four additions and one multiplication.

## 5. What is not done yet

- Callees with loops, and a guard after an effect, off a baseline frame: on one an exit
  names the bodies' frames (`ssa.Exit.frames`) and the engine resumes inside the callee.
- Natives and constructors as targets.
- A site with more than one target falls back to a deoptimization and an ordinary call on
  recompilation, instead of a second guarded body or a call on the miss path.
