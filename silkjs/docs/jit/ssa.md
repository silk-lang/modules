# The ownership-aware SSA form

Status: design and first implementation, workstream G of milestone 6 (2026-11-16). The code is in
`modules/jit/src/ssa.silk` (the form, its builder and printer), `ssa_verify.silk`,
`ssa_translate.silk` and `ssa_ownership.silk`; tests in `ssa_tests.silk`. Everything below was
read in the engine at `6341d15` (branch `claude/sweet-ptolemy-f5t7na`) unless it says "ran" or
"measured". Engine paths are relative to `modules/engine/src`.

Nothing here generates machine code. The backend (workstream E) lowers this form; the interface
it consumes is [The backend interface](#the-backend-interface).

## What the interpreter owns, and when

The SSA form models the interpreter's reference counts exactly, then removes the ones it can
prove redundant. The facts it starts from:

- `ValueBits` (`js_value.silk:14`) is a 16-byte tagged union. Copying it copies bits; it does not
  retain. Tags below 0 (`BigInt` to `Object`) are heap references with a count; `Int`, `Bool`,
  `Null`, `Undefined`, `Uninitialized`, `Float64`, `ShortBigInt`, `CatchOffset` and `Exception`
  hold no count.
- `Value` (`js_owned_value.silk:23`) owns one count; `ValueRef` borrows one for a lifetime;
  `lendBits` (`:104`) is the unsafe promise that some other owner keeps the bits alive.
- Every operand stack slot and every local slot owns one count for the value in it. Pushing a
  local or argument copies the slot and retains (`pushCopy`, `js_vm_state.silk:232`, via
  `pushLocal`/`pushArgument`, `js_vm_locals.silk:148`, `:176`). `put_loc` moves the top operand
  into the slot and releases the value it replaces; `set_loc` retains a second count and keeps
  the operand (`storeLocal`, `js_vm_locals.silk:196`). `drop` releases (`js_vm.silk:796`), `dup`
  retains (`:797`).
- Arithmetic consumes its two operand counts and pushes a new owner of its result. For two Ints
  the result is an Int or, on overflow, a Float64 (`cellArithmetic`,
  `js_vm_operators.silk:350`); a zero product of a negative operand is `-0`, a Float64
  (`finishIntProduct`, `:286`).
- Arguments live in the frame's argument cells. A function whose code never writes, aliases or
  captures a parameter (`FunctionBytecode.borrowsArguments`, `js_core_types.silk:2313`) may have
  those cells lent by the caller instead of copied (`js_vm_activation.silk:72`). Either way the
  compiled body does not own them and must not release them.
- A frame's locals and operands are released when the frame is left (`leaveInline`,
  `js_vm_activation.silk:804`, and `callInternal`'s cleanup); `return` pops the result and
  transfers its count to the caller (`js_vm.silk:1908`).

## Values, types and ownership

A function in SSA form is a list of blocks; each block has parameters, a list of instructions and
one terminator. Every parameter and every instruction result is a *value*, numbered densely from 0
in block order.

Types:

| Type | Meaning |
| --- | --- |
| `i32` | An unboxed 32-bit integer. Holds no count. |
| `bool` | An unboxed truth value. Holds no count. |
| `value` | A boxed `ValueBits`. Has an ownership. |

The ownership of a `value`:

| Ownership | Meaning | How it ends |
| --- | --- | --- |
| `owned` | Holds one count | Consumed exactly once on every path: `release`, `return`, passed to an owned block parameter, or moved into a deoptimization slot on the path that exits |
| `borrowed(root)` | Holds no count; valid while its root is | Never consumed; must not be used after an event that can invalidate the root |
| `imm` | Proven to hold no heap reference (a constant, a boxed `i32` or `bool`) | Free: may be used any number of times, passed where an owner is expected, or dropped |

A root is `arg n` (the frame's argument cell `n`) or an owned value `vK` (valid until `vK` is
consumed).

**What invalidates a borrow.** A borrow from `arg n` is invalidated by a write to argument `n` and
by anything that can run JavaScript or reenter the engine (a call, a getter, a coercion, a
`poll`), because the arguments object or a debugger could replace the cell. A borrow from `vK`
is invalidated when `vK` is consumed. The first subset has no instruction that writes an
argument (the translator refuses `put_arg`, `set_arg` and anything that makes an arguments
object) and none that runs JavaScript, so a borrow from an argument stays valid for the whole
body. `poll` runs the embedder's interrupt callback (`interrupts.handle`,
`js_interrupts.silk:52`), which does not run JavaScript in this frame; when that callback turns
on observation (the debugger), the backend must leave through the poll's exit, as the plain loop
hands off to the observed one at its poll. Every instruction has a `mayReenter` property in the
code; the ownership pass treats a reentering instruction as the end of every borrow it would
otherwise extend, and none exists in the subset yet.

`retain v` makes a new owned value with the same bits as `v` (adds one count). `release v`
consumes an owned `v` (drops one count, with the interpreter's deferred release,
`Value.drop`). Neither applies to `i32` or `bool`.

### Borrowed fields at an overwrite

An own field can be the last owner of a string or object. A borrowed read of that field can
survive a store through an alias, even while the receiver stays rooted. During borrow elimination,
the ownership pass marks every named store crossed by such a borrow as conservative. At these
sites, overwriting the last owner exits to the interpreter before changing the slot. A retained
copy of a borrowed field inherits that constraint. A direct argument or independently owned
value can keep its own lifetime.

For other sites, the compiled store may take a reference to the incoming value, replace the
writable own data slot and release the displaced value through `releaseDeferred`. This path
can queue an object for destruction or free short-lived storage. The helper's site argument
carries the bytecode offset in its low 32 bits. Bit 32 permits the last release, and a zero
high word preserves the conservative behavior. [Ownership pass](../../modules/jit/src/ssa_ownership.silk) · [Helper ABI](../../modules/jit/src/jit_helpers.silk)

## Instructions of the first subset

| Instruction | Result | Notes |
| --- | --- | --- |
| `arg n` | `value`, `borrowed(arg n)` | The argument cell's bits |
| `const.i32 k` | `i32` | |
| `imm undefined` / `null` / `true` / `false` / `uninitialized` | `value`, `imm` | |
| `unbox.i32 v` | `i32` | Guard: exits when `v` is not an `Int` |
| `unbox.bool v` | `bool` | Guard: exits when `v` is not a `Bool` |
| `truthy v` | `bool` | ToBoolean of boxed `v`; no exit |
| `put.key o, v, k` | none | Stores `v` into `o` under boxed key `k` (frame mode); may run code |
| `box.i32 x`, `box.bool c` | `value`, `imm` | |
| `add.i32`, `sub.i32`, `mul.i32 x, y` | `i32` | Guard: exits on overflow; `mul` also exits when the result is `-0` (zero with a negative operand), where the interpreter makes a Float64 |
| `lt`, `le`, `gt`, `ge`, `eq`, `ne` `.i32 x, y` | `bool` | Signed |
| `retain v` | `value`, `owned` | |
| `release v` | none | |
| `poll` | none | Interrupt safepoint on a loop back edge; carries a frame state for the loop target |
| `jump b(args)` | terminator | |
| `branch c, b1(args), b2(args)` | terminator | `c: bool` |
| `return v` | terminator | `v` owned or `imm`; transferred to the caller |

Guards and `poll` name a *deoptimization exit*.

**Block parameters, not phis.** A jump passes its arguments to the target's parameters. This was
chosen over phis for ownership: passing an owned value to an owned parameter is a visible
consumption on that edge, so the verifier's "consumed exactly once on every path" is a local
check per edge, and a conditional branch states separately what each successor receives. With
phis the consumption would sit on the edge implicitly and every check would need the edge
reconstructed. The translator also gets block parameters for free: the interpreter state at a
bytecode label (locals and operand stack) is the parameter list.

An owned value may also stay outstanding across a jump without being passed (it is then live in
the successor because it dominates it); the rule is that every predecessor of a block hands it
the same set of outstanding owned values.

## Deoptimization exits

An exit names a bytecode offset `pc`, counted from the start of `FunctionBytecode.code`, and the
interpreter state *before* the instruction at `pc` runs. That instruction is re-executed by the
interpreter, so a guard must exit before any effect of its instruction (for `step_loc8`, before
the local is written). Every exit lists:

- `locals[i]` for every local `i` (`variableCount` of them), and
- `stack[j]` for every operand stack slot live at `pc`, bottom first.

Arguments are not listed: the first subset never writes one, so every argument cell still holds
what the caller passed. Each slot is a value and a mode:

| Mode | The value is | The exit writes |
| --- | --- | --- |
| `int` | `i32` | `ValueBits.Int` |
| `bool` | `bool` | `ValueBits.Bool` |
| `imm` | `value`, `imm` | its bits; no count changes |
| `move` | `value`, `owned` | its bits; the slot takes the count |
| `dup` | `value`, `borrowed(root)` | its bits, retained; `Slot.root` names the argument index for a borrow of an argument (informational: the bits are what is written) |

The ownership rule at an exit: on the path that leaves, every owned value outstanding at that
point appears in exactly one `move` slot. The interpreter frame then owns exactly what the
interpreter would own at that boundary: one count per slot (from `move`, from `dup`'s retain, or
none needed for `int`, `bool`, `imm`). An exit performs every `dup` retain before it hands
anything to the interpreter, so a value that sits in a `move` slot and, borrowed, in a `dup` slot
is correct.

`poll` exits at the loop target with the state the interpreter has after the back edge jumped.

## Serializability

The form holds no pointer. Values, blocks, exits and slots are indices; constants are `i32`
payloads or immediate tags; bytecode positions are offsets into the function's own code. When the
subset grows, functions are named by an index into a per-compilation table, atoms by their atom
number in a table serialized beside the code, and shapes by a guard on a version read at run time
(never an address), as `asm_x64` names external code by symbol numbers (`Relocation`).

## The translator

`ssa_translate` reads a `FunctionInput` (the code bytes and the counts it needs, copied from a
`FunctionBytecode`; serializable) and either returns a function or refuses with the bytecode
offset, the opcode and a reason. Refusal is the normal outcome for now; it never miscompiles a
function it does not understand.

It reads opcode numbers, sizes and formats from the engine's generated table `js_opcode_data`
(exported for this; final, "short" view). Jump displacements are relative to the first operand
byte (`Machine.jump`, `js_vm_state.silk:186`).

It refuses a function whose kind is not normal, that has closure variables or a scope
(`varRefCount`, `scopeSlots`), that uses `arguments`, and any opcode outside this list:

- values: `push_i32`, `push_i8`, `push_i16`, `push_0`, `push_1`, `undefined`, `null`,
  `push_true`, `push_false`, `drop`, `dup`, `nip`, `swap`;
- slots: `get_loc*`, `put_loc*`, `set_loc*`, `get_arg*` (all short forms),
  `set_loc_uninitialized`, `get_loc_check`/`put_loc_check`/`put_loc_check_init` when the slot's
  state is known statically (otherwise refused: a read before initialization throws);
- arithmetic: `add`, `sub`, `mul`, `add_imm`, `inc`, `dec`, `inc_loc`, `dec_loc`, `add_loc`,
  `step_loc8`, and the local-operand forms `add_loc_loc8`, `sub_loc_loc8`, `mul_loc_loc8`,
  `add_top_loc8`, `sub_top_loc8`, `mul_top_loc8`, `add_top_arg8`, `sub_top_arg8`,
  `mul_top_arg8`;
- comparisons: `lt`, `lte`, `gt`, `gte`, `eq`, `neq`, `strict_eq`, `strict_neq` (on two `i32`
  they agree);
- control: `if_false`, `if_true`, `if_false8`, `if_true8`, `goto`, `goto8`, `goto16`, `return`,
  `return_undef`.

**Fused forms.** The local-operand opcodes above are real opcodes with their own meaning (read
two locals in place, then the operator); the translator gives each its meaning directly.
`OP_fuse_prefix` (5 bytes) is different: the instructions it covers follow it unchanged and the
prefix only lets the plain loop answer them faster, which the observed loop proves by skipping it
(`js_vm.silk:808`: the fusions run only `if !observe`). The translator therefore treats the prefix
as a no-op and translates the covered instructions. An exit may name a covered instruction's
offset: resuming there runs it unfused, exactly as the observed loop does. The dynamic
compare-and-branch fusion (`fusedLoopBranch`, `js_vm_operators.silk:421`) is an interpreter
shortcut over ordinary `lt` and `if_*8` bytes and needs nothing.

**Types at the translator.** Every local and stack slot is tracked as an abstract value. An
operand of an arithmetic or comparison instruction is unboxed with a guard unless it is already an
`i32` or a boxed `i32`; results stay unboxed until something needs them boxed (a local holding an
`i32` is an `i32` value; the exit's mode is `int`). A branch on a comparison result branches on
the `bool`, a branch on an `i32` on `ne.i32 x, 0`, and a branch on a boxed value on
`truthy`, ToBoolean with no exit (docs/jit/optimizer.md, Conditions and keyed elements). `post_inc`/`post_dec` and every other opcode not listed are refused. Loop headers get one parameter per
local and live stack slot, typed after the whole function has been seen (see below).

**Speculation.** Every guard records the bytecode offset of its instruction. The first subset
assumes `int32` everywhere and guards. A feedback read API (workstream F) plugs in by answering,
per offset, whether to guard for `int32`, refuse, or (later) choose another representation.

## The ownership pass

The translator emits the interpreter's counts literally: `get_arg` becomes `retain (arg n)`,
`drop` becomes `release`, a local written over releases its old value, `return` releases every
local and leftover operand. `ssa_ownership.optimize` then runs, in order: simplify, the
argument-web rule, simplify again.

1. **Argument webs.** Values connected through block parameters form a web. A web whose sources
   are all `retain` of an argument-rooted value or immediates, and whose members are consumed
   only by `release`, by being passed to another member, or by `move` exit slots, never by
   `return`, is replaced by the borrows: the retains and releases go, the parameters become
   `borrowed(arg)`, and the `move` slots become `dup`. Sound because nothing in the subset
   invalidates an argument borrow (see above).

**Simplify** repeats, compacting after each round, until nothing changes:

- folds: one `arg n` per argument (in the entry block), `unbox.i32 (box.i32 x)` to `x`,
  `unbox.bool (box.bool c)` to `c`, a retain or release of an `imm` value removed;
- trivial parameters: a block parameter whose incoming arguments are all one value (or itself)
  is replaced by that value;
- idle parameters: a block parameter nothing reads but its releases, when no edge passes it an
  owned value, goes with its releases and its edge arguments (a loop's exit block that took
  every local, as boxes and borrows, where the code after reads one);
- exit slots: a slot holding `box.i32 x` or `box.bool c` becomes an `int`/`bool` slot of `x`/`c`,
  so the box is no longer needed for the exit;
- dead code: pure instructions (constants, `arg`, `imm`, boxes, comparisons) with no use go;
- parameter unboxing: a `value` parameter whose every incoming argument is an `i32` (or bool) or
  a box of one becomes an `i32` (`bool`) parameter, so a counted loop carries its counters
  unboxed. Parameters that pass a value between each other unchanged (a loop header's and a
  merge's, for a counter updated on one branch only) form a web and are unboxed together when
  every argument entering the web from outside is a box of the kind;
- common values: an instruction that repeats one dominating it (same operation, operands and
  constant) is replaced by it. Guards are included: a guard's outcome depends only on its
  operands, so once the dominating copy did not exit, the repeat cannot. The loop condition's
  `unbox.i32` of an argument goes this way, as do the duplicate `f64 x` conversions the
  translator makes for each branch edge. `box.f64` and everything with an effect (counts,
  `poll`, terminators) are left alone. The search is quadratic in the candidates, which is fine
  at the sizes the JIT compiles today.

Guards are never removed by dead code: an unused `unbox.i32` still checks a type, and an unused
`add.i32` still exits on overflow where the interpreter would make a Float64.

A rule for local retain/release pairs inside one block (retain, uses, release, nothing reentering
between) was designed but is not implemented: in the first subset every such pair comes from an
argument and the web rule removes it. It becomes necessary once values other than arguments
(property loads, call results) are held in locals.

For integer code nothing is left. A function that returns an argument keeps exactly one `retain`,
the count the caller receives.

## The verifier

`ssa_verify` checks, and the tests check that it rejects each violation:

- structure: block parameters and instruction results defined once; operands defined before use
  and dominating it; one terminator per block, last; edge arguments match the target's parameters
  in number and type; operand types match each instruction;
- ownership: computed forward over the blocks, every owned value is consumed exactly once on every
  path, never used after it is consumed, every predecessor of a block agrees on the outstanding
  owned values, `return` leaves nothing outstanding but its operand; a borrowed value is not used
  after its root is consumed;
- exits: slot counts match the function's locals and the stack depth recorded for the exit; every
  slot's mode matches its value's type and ownership; on the exiting path every outstanding owned
  value is in exactly one `move` slot; `dup` slots name a borrowed value and its root.

## The backend interface

What workstream E consumes, all in `ssa.silk`:

- `Function.blocks` in their final order: reverse postorder, entry first, with a branch's successor in fewer loops searched first so each loop's blocks follow its header (`Function.compact`, `loopDepths`). `Block.params` and the
  instruction range are indices into `Function.params` and `Function.insts`.
- `Inst`: `op`, `result` (a value index or `NONE`), operands `a`, `b`, the immediate `k`
  (constant, argument index, comparison, immediate tag), `edge` (first edge of a terminator),
  `exit` (exit index or `NONE`) and `pc` (bytecode offset of the instruction it came from).
- `Function.values[v]`: type, ownership, root kind and index, defining block.
- `Edge`: target block and the range of `Function.edgeArgs` passed to its parameters.
- `Exit`: `pc`, `stackDepth` and the range of `Function.slots` (locals first, then stack bottom
  first); `Slot`: value, mode, root argument for `dup`.

Every value in a `move` slot is `owned`; a `dup` slot is `borrowed`, written as its bits and
retained (an `imm` value uses an `imm` slot, never `dup`). An `i32`/`bool` value is boxed by the
exit itself (`int`/`bool` slots). `Op.Removed` never appears in a compacted function.

The printer (`Function.print`) writes the textual form the tests compare against. For
`sum(n){var s=0;for(var i=0;i<n;i++)s+=i;return s}` (test `goldenSumLoop` in
`modules/jit/src/ssa_tests.silk`):

```
b0:
  v0: value borrowed(arg 0) = arg 0   @0
  jump b1()   @0
b1:
  v1: i32 = const.i32 0   @0
  v2: i32 = const.i32 0   @2
  v3: i32 = unbox.i32 v0 exit e0   @11
  v4: bool = lt.i32 v2, v3   @11
  branch v4, b2(v1, v2), b3(v1, v2)   @12
b2(v5: i32, v6: i32):
  v7: i32 = add.i32 v5, v6 exit e1   @15
  v8: i32 = const.i32 1   @22
  v9: i32 = add.i32 v6, v8 exit e2   @22
  v10: i32 = unbox.i32 v0 exit e3   @26
  v11: bool = lt.i32 v9, v10   @26
  branch v11, b4(), b3(v7, v9)   @27
b3(v12: i32, v13: i32):
  v14: value imm = box.i32 v12   @29
  return v14   @30
b4:
  poll exit e4   @27
  jump b2(v7, v9)   @27
e0: pc 11 locals [int v1, int v2] stack [int v2, dup v0 (arg 0)]
e1: pc 15 locals [int v5, int v6] stack [int v6]
e2: pc 22 locals [int v7, int v6] stack []
e3: pc 26 locals [int v7, int v9] stack [int v9, dup v0 (arg 0)]
e4: pc 14 locals [int v7, int v9] stack []
```

Each instruction ends with `@pc`, the offset it came from. The back edge goes through a latch
block (`b4`) holding the `poll`, whose exit resumes at the loop target (offset 14).
