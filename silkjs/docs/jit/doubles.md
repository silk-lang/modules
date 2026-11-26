# Doubles and the int32 operators in the JIT

How compiled code handles numbers beyond int32 and the int32 operators other than add, sub and
mul. The SSA form is in [ssa.md](ssa.md), the entry ABI in [compiled-entry.md](compiled-entry.md).
Code: `ssa.silk` (operations), `ssa_translate.silk` (number sites), `ssa_ownership.silk`
(unboxing), `x64_backend_float.silk` (lowering), `jit_recompile.silk` (recompilation).

## The f64 type

`f64` is an unboxed IEEE double. It lives in an SSE register or an 8-byte spill slot holding its
64 bits, and is boxed only where it leaves compiled code: an exit slot (mode `f64`), a return,
a call argument. `box.f64` makes a Float64, `unbox.f64` is a guard that accepts an Int
(converted exactly) or a Float64 and exits on anything else.

Operations: `const.f64 #k` (the bits are `Function.numbers[k]`), `f64 a` (i32 to double, exact),
`add.f64`, `sub.f64`, `mul.f64`, `div.f64`, `<cmp>.f64`, `neg.f64`, `abs.f64`, `sqrt.f64`,
`floor.f64`, and two guards back to i32: `toint32` (ToInt32; exits when the truncation leaves
the int64 range, which the interpreter then answers) and `int.f64` (exactly an int32 and not -0).

The int32 operators: `and`, `or`, `xor`, `shl`, `sar`, `not`, `imul` never fail; `shr` exits
when the unsigned result is above the int32 maximum, `mod` unless the divisor is positive and
the result is not -0, `neg` on 0 and on the minimum. Each exit is where the interpreter would
make a Float64.

## Semantics that are easy to get wrong

- Comparisons with NaN are false except `!=`: `lt`/`le`/`gt`/`ge` use `ucomisd` with the
  unsigned "above" conditions (operands swapped for less-than), `eq` needs ZF and not PF, `ne`
  takes either.
- `-0`: `neg.f64` and `abs.f64` flip or clear the sign bit on the bits, so they need no special
  case. `int.f64` refuses -0 by checking the sign bit when the truncation is 0. `floor.f64` keeps
  the sign of its operand on a zero result (`floor(-0)` is -0, `floor(-0.5)` is -1).
- `floor.f64` uses SSE2 only (no `roundsd`): truncate to int64, step down by one when the
  truncation is above the operand, and return the operand itself when the truncation does not fit
  int64 (NaN, the infinities, |x| >= 2^63, all already integral).
- Representation: the interpreter keeps `add`/`mul` results as Float64 even when they are
  integral, but its increments normalize an integral Float64 back to Int. Compiled code may
  therefore hand back a Float64 where the interpreter had an Int of the same value, or the
  reverse. Both are the same JavaScript number, so programs cannot tell; tests that compare
  value kinds must compare numbers instead.
- `%` of doubles (fmod) is refused for now: a translation needs a call.

## Number sites

The translator lowers an arithmetic site to i32 operations by default. A site in
`FunctionInput.doubleSites` (a bytecode pc) is lowered to f64 instead: its operands are unboxed
or converted to f64 and the result is f64. Parameters whose incoming values are all `box.f64` or
`box.i32` become f64 block parameters (`unboxNumberParam`), so a double accumulator in a loop
stays unboxed.

## Recompilation

The sites come from deoptimizations, not from recorded feedback. When the engine unlinks a
function for deoptimizing too often, it records the pcs where it deoptimized
(`CompiledEntry.deoptPcs`, up to 4) and re-arms the function's hotness. When it is reported hot
again, `jit_recompile.History.plan` adds those pcs to the function's double sites and compiles it
again. A function has at most `MAX_RECOMPILES` (2) compilations after the first; it is refused
for good after that, or as soon as it deoptimized only at sites already widened. So a function
that keeps deoptimizing ends refused, never in a compile loop.

Functions are recognised by a hash of their bytecode with the argument and local counts; the
cell address only separates a re-report of the same function from another function with the same
code, which starts from the sites the first one learned. Both are hints: every guard stays in the
compiled code, so a wrong match costs speed, never correctness.

## Boxing

Under the compiled-entry ABI a boxed value is a 16-byte ValueBits in the engine's layout
(`value_layout.ValueLayout`). `unbox.f64` reads the tag: Int converts its signed payload with
`cvtsi2sd`, Float64 takes its payload bits, anything else exits. `box.f64`, an `f64` exit slot and
a returned double write the Float64 tag and the bits. An integral double stays a Float64 (see
"Representation" above).
