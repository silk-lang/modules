# Code quality passes

What the JIT does to the SSA form between the ownership pass and the verifier, and what the
backend does beyond lowering one instruction at a time. The compile cost side is
[compile-cost.md](compile-cost.md); the form and its rules are [ssa.md](ssa.md).

`ssa_opt.pipeline` is the one entry: `ssa_ownership.optimize`, then each pass below, in this
order. Every pass lives in its own file (`ssa_opt_<pass>.silk`), has one bit in
`ssa_opt.PASS_*` and one shell flag that clears it, so a wrong answer or a slowdown is pinned
on a pass by turning it off. The verifier runs after the pipeline as before: a pass that
breaks a rule turns into a refused function, not into wrong code.

| Pass | File | Off with |
| --- | --- | --- |
| Reads without counts | `ssa_opt_borrow.silk` | `--jit-no-borrow` |
| Hoisting | `ssa_opt_hoist.silk` | `--jit-no-hoist` |
| Exits name the unboxed number | `ssa_opt_unboxed.silk` | `--jit-no-unboxed` |
| Products that need no sign of zero | `ssa_opt_unboxed.silk` | `--jit-no-unboxed` |

## Reads without counts

`get.elem`, `get.length`, `get.var` and `get.scope` answer an owned value: the read takes a
count and a `release` drops it. For `s = s + a[i]` that is two tag tests around the element
and two more around `a.length`, on values that are numbers.

When the value is released in the block that read it and nothing between could let go of
what holds it, the read borrows: its result becomes `borrowed`, the read takes no count and
the `release` goes. This is the rule `ssa_ownership.borrowFields` has for `get.field`, with
what each read needs kept away:

| Read | Borrows from | Ends at |
| --- | --- | --- |
| `get.elem a, i` | `a`, or what `a` borrows from | a call, a `put.elem` (the store's slow path releases the element it replaces, and a string is freed at once) other than the store of the value itself, the release of `a` |
| `get.length a` | the same | a call, the release of `a` (a length is a number, or the length of a string `a` keeps) |
| `get.var k`, `get.scope k` | the binding (`RootKind.Binding`, printed `borrowed(binding)`) | a call, `put.var`, `put.scope` (a captured variable and a global can be one cell), `put.field` (a global is a property of the global object) |

An element or a length read from an object that itself borrows from a binding borrows from
the binding too, and ends at both lists.

A poll ends none of them, and no borrow of a field's value either. What a poll runs (the
report of a hot function, the host's interrupt callback) stores to no property, element or
binding: `js_interrupts.handle` states it, next to the rule that it runs no JavaScript and
changes no shape. So `x.array` read in front of a loop stays a borrow through the loop's
latch and through the poll `ssa_opt_bounds` puts in front of a counted loop inside it. In
Crypto's `bnpSquareTo` each outer turn runs two inlined `am` loops, each with such a poll
in front: `x.am`, `this.array` and `w.array` were read, tested, counted and released around
each of them, and the outer loop's own element reads went through the general path
because the Array they read was a new value on every turn. With the borrows the outer turn
runs 329 instructions where it ran 457, `montReduce`'s 163 where it ran 225.

`a[i] = b[j]` borrows as well: a `put.elem` that stores the element read, as its last reader
with only releases up to the value's own, takes the Array's count of the value before it
lets go of the element it replaces (`writeElement`), so the store may be what ends the
borrow, even when it replaces the very element that was read. A copy loop runs 16
instructions a turn where it ran 21 (`tests/baseline/t90.js` copies numbers, strings and
objects, an Array onto itself and shifted within itself).

"A call" is any instruction not listed in `ssa_opt_borrow.quiet`: the instructions known not
to run the program's code or free a holder. An instruction a stream adds later ends every
borrow and stops hoisting in its loop until it is listed there.

The helpers follow: `get_var` and `get_scope` take a flag (bit 31 of the index, bit 29 of
the site) and do not retain; `get_elem_borrowed` (helper 121) gives its count back, and
answers 0 when the element is a cell only the read holds (nothing would keep it alive for a
borrower), so the code deoptimizes there. Exits write a borrowed value as `dup`, which
takes the count the interpreter needs.

## Hoisting

A loop is a header block with a back edge from a latch, the block the translator makes to
poll and jump back. An instruction in the loop whose operands are all defined outside it,
and whose answer nothing in the loop can change, moves to a new block on the loop's one
entry edge. One call moves instructions out of one loop level; the pipeline calls it twice.

What moves:

- `unbox.*`, `check.tag` and the exiting arithmetic (`add.i32` and the like) of invariant
  operands, when their block runs on every iteration (it dominates every latch). A guard the
  loop would not have reached must not fail in front of it.
- `get.length`, `get.field`, `get.var` and `get.scope` whose result is a borrow, under the
  same condition, in a loop that holds nothing that could change the answer: a call,
  `put.elem` (for a length: an append), `put.field`, and for bindings `put.var` and
  `put.scope`. An owned result stays: its `release` would have to move too.
- Arithmetic and comparisons that cannot fail, from anywhere in the loop.

**The exit of a moved guard.** A guard that fails in front of the loop resumes the
interpreter at the loop's header, before the first iteration. Its state is the state at the
header as the entry edge carries it. The latch's `poll` already names the state at the
header as the back edge carries it; the entry state is built from it slot by slot:

- a slot whose block parameter the header kept takes that parameter's argument on the entry
  edge. Parameters are matched by `ValueInfo.state`, the place among the block's parameters
  the translator gave each one (locals, then the operand stack), which stays true when
  passes remove other parameters. Matching by value would be wrong: two locals can hold one
  value at the latch and different values at entry.
- any other slot lost its parameter because it holds one value around the loop; the latch's
  slot names it. If that value is defined inside the loop the pass gives the loop up.

A loop with more than one entry edge, or no `poll`, is left alone. So is the loop of an
inlined body (docs/jit/inlining.md), and an instruction of an inlined body stays in its loop:
it may read the frame `inline.frame` builds there.

**Code entered at the loop.** In an OSR artefact (docs/jit/osr.md) the entry edge comes from
the entry block, so the front block sits between the entry and the header and a moved guard
exits with the values the entry brought (`ssa_tests.goldenHoistedInLoopEntry`).

**Recompilation.** A deopt at a hoisted guard is recorded at the header's offset, which
says nothing about which instruction to widen. So a loop whose header is among the offsets
earlier code of the function deoptimized at (`jit_recompile` sites) is not hoisted from:
the guard stays in the loop, the next deopt names the instruction, and the compilation
after that widens it.

**Counters that enter boxed.** A header parameter the loop unboxes as an i32 on every
iteration and passes back as `box.i32` of a number (an index, a counter, an accumulator)
would still be a boxed value if its entry value is no box, typically an argument: the
ownership pass unboxes only parameters fed by boxes. So the pass puts that unbox on the
entry edge too, with the moved guards' exit, and has the edge pass `box.i32` of its
number; the ownership pass then runs again (`ssa_opt.pipeline`) and unboxes the parameter,
which ends the boxing at the latch and the unbox at the top of each iteration
(`ssa_tests.argumentCounterUnboxedOnEntry`; Crypto's `am3` carries `i`, `j` and `c` so).
An entry value the code owns (an argument copied into a local, as in Crypto's
`bnpDRShiftTo`) is no longer passed on, so the front block releases it after its last exit
(`ssa_tests.ownedCounterReleasedOnEntry`, `tests/baseline/t68.js`). Without that release
the verifier refused bnpDRShiftTo, montReduce and bnpFromString from the change that brought
these unboxes in until this one: montReduce ran its baseline code, and half of `am3`'s calls
went through the baseline call stubs.
The entry unbox takes a Float64 holding an exact int32 too (`ssa.UNBOX_EXACT`, x64_backend):
a value of double arithmetic that is an integer runs the loop as an Int instead of failing
in front of it. What it refuses exits at the header and costs the one more compile above.
The latch's state names a box's number where the latch passes the box (an exit writes
`int x` for `box.i32 x`), and the entry state maps such a slot through the box.

**Locals a block does not read.** An edge passes a local as `undefined` when no path from
its target's offset reads the local before writing it (the translator's liveness). A value
that holds no count (a number, an immediate, a borrow) is simply not passed. A temporary
written at the top of each iteration (`var l = a[i]`) was a header parameter for its exits
only, boxed at every latch; a loop counter dead after the loop was passed to the exit
block. Both go. A value that holds a count is released on the edge
(`Translator.edgeTo`): in front of the jump when the edge is its block's only way out, and
otherwise in a block of the edge's own, since the branch's other arm may still read the
local. Every edge into the target then passes undefined and the target has no parameter
for the local. Such a parameter is typed as a value that may hold a count, so a number
that reached it was boxed on its edge and the parameter released where the local was
written next: in `montReduce` the index `j` of the carry loop went boxed from the loop's
pre-test to the end of the outer turn, about 10 instructions a turn. The edges to a latch
and from it carry the count as before: the latch decides (optimizer.md, "Dead stores").
Most of those releases are of values that turn out to hold no count (an argument's
borrow, a number), and the edge's block is left with its jump alone: an edge into such a
block goes where the jump goes, with the jump's arguments (`ssa_ownership.passEmpty`), so
that what reads edges (`sinkBoxes`, the loop passes) finds them as it did. A loop's
latch is not passed by. `tests/baseline/t101.js` lets objects, strings and numbers go on
one arm of a branch, in front of a loop and behind one, and leaves compiled code after
each.

**Conditions of several tests.** `a || b` and `a && b` as a condition, and an inlined
function that returns one, meet in a block whose parameter is the answer and which only
branches on it. Each test's flags became a number there (`setne`, a move), and the number
was tested again. Once the borrows are made (the block after an inlined call releases what
the call held until then), each jump into such a block goes where the branch would send it
(`ssa_ownership.threadBranches`): straight to one side when the block before the jump
branched on the argument (the `||` that was already true), and otherwise the jump becomes
the branch, on the test made last, whose flags the backend's fused compares then use. A
parameter anything else reads stays (`var r = a || b`), and so do loop edges. Richards:
1.618G to 1.583G instructions (its scheduler asks `isHeldOrSuspended()` every turn).
`tests/baseline/t104.js` has the shapes, the kept answer, operands that are not booleans
and tests that leave the code.

**Boxes for one exit edge.** A loop's exit edge often passes its numbers boxed, to a block
whose parameters stay boxed because it is also reached from in front of the loop. Those
boxes ran on every iteration, between the loop's compare and its branch, which then could
not branch on the compare's flags. `sinkBoxes` moves a box whose one reader is an argument
of one edge of a branch onto that edge, in a new block (Crypto's `am3`: five boxes and the
compare's setcc, store and test per iteration).

## Array checks in front of the loop

An element access (`get.elem` with `k` 0, `put.elem`) of an Array the loop does not
define tests the object's tag, its class and its fast flag on every turn: seven
instructions before the index test. `ssa_opt_hoist` puts one `check.array` per such Array
on the loop's entry edge, with an exit of its own at the header, and marks the accesses
trusted (`Inst.trusted`): they load the object, compare the index with the count and leave
where it is not below it. Their helper never runs, but a trusted store of a counted value
below the count, which keeps the Array fast.

Nothing else in the loop may change what kind of object the Array is: no call and no
stepped read (they run the program's code), no store of a field or a binding, and every
element store is trusted (an untrusted store's helper may append past the end, and an
append far enough out ends the fast kind; it could be this Array under another name). The
access must run on every turn and its site must never have left compiled code. With
recorded kinds (code made off a baseline frame) the site saw fast Arrays alone; on a
baseline frame, where no kinds are recorded, it saw no keyed reads (ELEMENT_ORDINARY).

An access that runs on some turns only (`if (c >= DV) { r[i + t] -= DV; r[i + t + 1] = 1 }`)
is trusted with the others when one that runs on every turn checks its Array already: it
adds no check, so nothing can fail in front of the loop that the loop would not have come
to. Where no such access checks its Array a read stays as it was, and a store ends the
loop's trust like any untrusted store. `tests/baseline/t97.js` runs such loops with the
branch taken on no turn, on some and on all, on Arrays that are too short, and with a
second Array only the branch stores to.

A `check.array` that fails (a typed array, a string, `arguments`) leaves at the header
with a record that says so (`jit_exit_state.CODE_ARRAY_CHECK`). `jit_runtime.noteLeft`
remembers the header's pc with `ssa.SITE_ARRAY`, and the next compile trusts nothing in
that loop but keeps the rest of its hoisting, where a failure of the other hoisted guards
keeps all of them in the loop. `tests/baseline/t67.js` runs such loops on arrays, typed
arrays, strings, `arguments`, frozen, holey and getter-holding arrays, past the end and
with stores that append.

A borrowed copy of the Array (`this_array` read from a local the loop's front block
copied) is checked as what it copies: one `check.array` per object. That is the value the
copy's `retain` names, through copies of copies (`ssa_opt_hoist.copied`), and not what the
copy borrows from: `x.array` read into a local borrows from `x`, and it is the Array that
is checked, not the object that holds it (`tests/baseline/t98.js`: objects that are
Arrays themselves and hold an Array under the name the loop reads).

**A loop around the loop.** The second round of `ssa_opt_hoist` finds an inner loop's front
block, with its checks, among the blocks of the loop around it. Where that loop keeps its
own trust (nothing in it changes what kind of object an Array is) and the Array comes from
outside it, its front block makes the check and the inner one tests nothing
(`Inst.proven`, printed `check.array v43 proven`): once for the outer loop, not once a
turn. The inner check stays in its block, where `ssa_opt_bounds` reads from it which
Arrays the inner loop's front block may take the count of; both passes look through all of
a loop's front blocks for the Arrays checked already (`ssa_opt_hoist.frontChecks`), so a
round adds no check an earlier one made. This holds for an inner loop that some turns
skip too (`while (--n >= 0)` is entered through a test): its accesses saw fast Arrays and
the Array is the same on every turn. A check that fails in front of an outer loop whose
inner loop would never have run costs one recompile, which leaves the outer loop's trust
out (`SITE_ARRAY` at its header) and the inner check where it was.

Crypto's `bnpSquareTo` runs two inlined `am` loops on each outer turn, four checks of the
same two Arrays: its outer turn runs 264 instructions where it ran 296. With the reads
that borrow through a poll and the accesses trusted on some turns (both above), Crypto at
scale 20 runs 4.88G instructions where it ran 5.34G (V8: 4.41G).

Crypto's `am3`: 143 instructions an iteration where there were 164; Crypto at scale 4,
3.26G instructions where there were 3.48G. At scale 20 the optimizer takes 1,019 ms (V8:
325), where before this and the fragile registers it took 1,256.

## Bounds in front of the loop

A trusted access still loads the Array's count and compares its index with it on every
turn, and the `++` that makes the index tests for overflow: three or four instructions an
access. `ssa_opt_bounds` proves both once, in front of the loop, for a counted loop: one
latch, reached only by the true edge of `branch (i + n < limit)` or `(i + n <= limit)`,
where `i` is a header parameter the latch passes back plus 1 (the counter) and `limit` is
defined outside the loop. Turn m (from 0) then runs only when m is at most
`limit - start(i) + e` for a constant `e`, the trip bound, `start` being what the entry
edge passes. A header parameter the latch passes back plus a positive constant (a step,
`++currentRow`) is `start + m * step` in turn m, so an index `q + d` of a step `q` stays
between `start(q) + d` and `start(q) + d + bound * step(q)`.

For each Array and step the loop's trusted accesses index that way, a new block on the
entry edge computes those ends with exiting arithmetic and tests each against the count:
`check.bound a, x` leaves unless `x` is an index below the count of `a` and below 2^31. It
tests the first turn's least and greatest index and the last turn's greatest, so a trip
bound below zero (a `do` loop entered past its limit) still covers the one turn that runs.
The accesses are then proven (`Inst.proven`): they load the elements and index them, with
no count and no test. An `add.i32` or `sub.i32` whose result is a step plus a constant
between the offsets checked cannot overflow, as the ends were computed without, and is
proven too; so is the counter's own add, after `start(i) + 1` and `limit + 1` were
computed in front (`limit` alone under `<`).

The count must not change in the loop. The pass asks of the whole loop, loops inside it
included, what trust asks: no call, no stepped read, no store of a field or a binding,
every element store trusted (it leaves instead of appending). An index must be a header
parameter plus a constant: `a[base + i]` with `base` from outside the loop is not proven
yet, nor is an index that is a product.

The new arithmetic exits at the header like the other hoisted guards. A `check.bound`
that fails has a record of its own (`jit_exit_state.CODE_BOUND_CHECK`), remembered as the
header's pc with `ssa.SITE_BOUND`: the next compile proves nothing in that loop and keeps
its trust and its hoisting. Such a loop would have left at the access anyway (a trusted
access leaves where its index is not below the count), a turn or a hundred later.
`--jit-no-bounds` turns the pass off. `tests/baseline/t88.js` runs counted loops in
bounds, before the start, past the end, with steps of two and three, with a limit above
the Array, an Array that grows, counters next to 2^31, and a relaxation step on grids too
small for it.

A loop that counts down is the same proof from the other end: one latch reached by the
true edge of `branch (i + n > limit)` or `(i + n >= limit)`, the counter passed back minus
1 (`while (--n >= 0)`, `for (i = n - 1; i >= 0; --i)`). The trip bound is then
`start(i) - limit + e`, and the counter's own subtraction is proven after `start(i) - 1`
(and `limit - 1` under `>=`) were computed in front. A step may go either way in either
loop: one that goes down is between `start(q) + d - bound * |step(q)|` and `start(q) + d`.
Crypto's `am3` is `while (--n >= 0)` with `i` and `j` stepping up: its two reads, its store
and its three counters lost their tests, 11 of the loop's 81 instructions.
`tests/baseline/t91.js` runs loops that count down by one and by two, with none and one
turn, one past the end, an Array that grows and elements that are no int32 part of the way.

Such a loop ends before long whatever the program does: its turns are counted, nothing in
it calls, and its accesses stay inside the Arrays it reads. Its `poll` (three instructions a
turn: the realm, the countdown, a branch) is therefore taken once in the front block, with
an exit of its own at the header, and the latch is left a bare jump. A loop inside a
counted loop keeps its own poll unless it is counted too.

**What the front leaves out.** Inlined code hands the pass constants: `am3(i, x[i], r,
2 * i, 0, 1)` is a loop from 1 down with a start of `2 * i`. Arithmetic on two constants
is done when the block is made, where its result fits an int32 (`ssa_opt_bounds.guarded`;
one that would leave stays, and leaves), a sum with 0 is its other operand, and the
counter's own guards make nothing when both ends are constants (`fitting`). The ownership
folds do the same for `add.i32`, `sub.i32` and `mul.i32` of two constants anywhere
(`ssa_ownership.fold`; a product that is -0 stays). A bound the block has tested already
is not tested again: with a constant trip bound of 0 the first and the last index are one
value, and two steps that start at one value share their checks. `check.bound` itself is
one unsigned compare with the count: an Array's elements are a `ThinList`, whose capacity
stays below 2^30 (`fields.capacityMask`), so an index below the count is below 2^31
without a test of its sign.

A front block's poll is for its own loop, but in front of a loop that runs inside another
it is taken on every turn of the outer one. When the loop around polls on each turn (its
latch still has its `poll`: it is not counted), the inner fronts' polls go: between two of
the outer loop's polls there are then only counted loops, which end. A counted outer loop
has no latch poll, so the fronts inside it keep theirs (`ssa_opt_bounds.settle`).
`tests/baseline/t100.js` runs inlined loops with constant counts of one, none and more,
constant arithmetic that overflows or makes -0, and counted loops inside loops that poll
for them. In `bnpSquareTo` an outer turn went from 264 instructions to 214.

## A fill grows its Array in front

`nbi()` gives Crypto's big numbers a fresh Array, and `multiplyTo`, `squareTo` and `copyTo`
fill it from the top down (`while (--i >= 0) r[i] = 0`). The first store is past the end
with a gap below it, which ends the Array's fast kind: every store of the loop was then a
step in the interpreter on a slow Array (3,180 instructions each, 155,000 a run at scale
20), and the last one made it fast again.

A counted loop that only fills (`ssa_opt_bounds.fills`) stores to every index from its
first to its last once it is entered: one reach of the Array, by a step of 1 or -1; a store
in a block that runs on every turn; the loop's test the one way out; and nothing in the
loop that can leave or run anything, only the proven accesses and adds, the poll that
moves in front, and operations on their operands. For such a loop the front block has
`grow.bound a, high, low` in place of the far end's `check.bound`: where `high` is not
below the count, the engine grows the Array to `high + 1` elements, the new ones undefined
(`baseline.ARRAY_GROW`, `js_native_functions.quickGrow`), when `low` is at most the count
(no index stays without a store), the Array is fast with a writable length, and an append
may add to it (extensible, no accessor or value for an index on the prototype chain). It
leaves otherwise, with nothing changed, like a `check.bound` that fails. The undefined
elements are never seen: the loop cannot leave before it has stored them all, and reads of
the same Array through another value were proved against the count from before. The
`elements` of every Array of the loop are loaded after the grow, which moves them.

Baseline code notes the store as one that missed, and a noted store is compiled by key
(a helper, then a step) from the first compile on. `ssa_translate.fillStore` keeps it an
element store where the loop may be a fill: optimized code never left at it, its index is a
local as it stands (`r[i + n]` leaves a gap below, which cannot be grown), and the innermost
loop around it has no other element store, no call, no field store, no loop inside, and
no failed check in front. A loop that is no fill after all leaves at the store once and is
compiled by key next time.

Crypto's slow stores went from 155,081 to 76,441 a run; the rest are `dlShiftTo` and
`lShiftTo`, whose first loop stores above a gap. `tests/baseline/t93.js` fills from both
ends, with offsets, two counters, Arrays that are shorter, as long and longer, one Array on
both sides, loops that are no fill, Arrays that may not grow (sealed, frozen, a fixed
length, sparse, a prototype's), and setters and values on the prototype chain.

## Elements in front of the loop

A proven access still loaded the Array from its slot and the elements from the Array, and
made the element's address with two `lea`: five instructions before the element is touched.
Where the elements are cannot change while the count cannot, so the front block of a
counted loop loads them once: `elements a` (after the `check.array` of `a`) answers a raw
word (`Type.Raw`: no value of the program, in no exit and on no edge), and every access the
loop proves on `a` takes that value for its first operand in place of `a`
(`Function.arrayOf` gives the Array back, which a store's helper still needs). The
allocator gives it an integer register like any number, all 64 bits of it.

The access is then one addressing mode: an element is 16 bytes, so R11 takes twice the
index (`lea r11d, [i + i]`; the index is below 2^31, so twice it fits 32 bits) and the tag
and the payload are at `[elements + r11 * 8]` and `[elements + r11 * 8 + 8]`
(`x64_backend.Element`). Accesses of the same index one after another (`x[i] += dt * s[i]`)
share R11 (`Emitter.scaled`, kept over the instructions that leave R11 alone). Elements
that got no register are loaded to R9 from their slot, one load, and stay there for the
next access of that Array.

| Loop, instructions a turn | Before | After |
| --- | --- | --- |
| `x[i] += dt * s[i]` | 27 | 16 |
| `lin_solve`'s relaxation | 47 | 36 |
| `x[i] = x0[i]` (with the borrowed copy above) | 27 | 16 |
| `advect` (with the backend items below) | 145 | 128 |

NavierStokes' `lin_solve` runs 49 instructions a turn where it ran 68 (five accesses, four
steps), and the benchmark at scale 20 2.69G instructions where it ran 3.29G. The clock
moves far less than that: the loop's time is the chain of four additions and two
multiplications from one turn's result to the next (about 14 cycles), which the removed
compares and branches were never part of.

## Inlined loops

Code inlined from a callee with a loop (Crypto's `am3` in `montReduce` and `bnpSquareTo`)
gets what a function's own loop gets. The edge liveness that passes undefined for a dead
local uses the body's own liveness and block pcs (`Translator.leaderPc` holds a body's
leaders and latches too), so the body's temporaries no longer go around its loop boxed and
released; and the array checks move in front of an inlined loop as well (an inlined body
records no element kinds and has none of the caller's sites). With parameter writes in
inlined bodies (inlining.md), `am3` is inlined: its calls no longer go through the baseline
call stubs (about 230 instructions a call) and its prologue. Crypto at scale 4 with a fixed
seed: 2.01G instructions where there were 2.44G; at scale 20, about 680 ms where there
were 810 (medians of 15 runs; node 322).

NavierStokes' `project` calls `lin_solve(0, p, div, 1, 4)`, a local function with no closure
object, whose body starts `if (a === 0 && c === 1)`. A call that passes a literal number to
a parameter the callee compares with a literal is inlined at the general size limit
(inlining.md 4), and the body is compiled for those numbers: the copying branch goes, and
`ssa_ownership.fold` makes a constant of `1 / c` and takes `a * (...)` for its operand
(a product with 1 is the other operand for every double). The relaxation loop's chain from
one turn's result to the next is then four additions and one multiplication where it had
two. Against node run in the same round (40 frames after 20 of warm-up, medians of 15
rounds), `project` takes 1.12 times node's time where it took 1.40, and the whole step 1.20
where it took 1.45.

## Loops in one piece

`Function.compact` orders blocks in reverse postorder. Its search used to take a branch's
edges in order, so a loop whose continuing edge comes first (`while (--n >= 0)`, an inlined
`am3`) had its latch placed after everything the loop exits to: in montReduce, after the
rest of the function and the other inlined bodies. Every value the loop carried then had a
linear-scan interval over all of that, calls included, so none could take a fragile
register, and the allocator's loop depths (blocks h..s of a back edge s -> h) counted the
whole range as the inner loop. Now the search takes first the successor in fewer loops
(`loopDepths`: for each edge u -> v with v <= u, v and the blocks that reach u without
passing v), so the exit comes after the loop's blocks, which follow their header with
nothing between. It is still a reverse postorder, which the dominator computations need.
A back edge is one to a block the search is still inside (`backEdges`), not one to a lower
block number: the front blocks the hoisting passes append sit after the headers they jump
to until the next compaction, and counting those jumps as loops laid the latch of a loop
inside another out after the outer loop (NavierStokes' `advect`: two taken jumps a turn,
and the inner counter in a frame slot).
montReduce's inner loop: 90 instructions a turn where there were 106; Crypto at scale 4
with a fixed seed, 1.80G instructions where there were 1.85G.

## Repeated element reads

`a[i]` read twice in one block, with nothing between that could change an array (only
arithmetic, compares, boxes, unboxes and tag tests), reads the same element: the second read
and its `unbox.i32` take the first's (`ssa_opt_unboxed.repeatedReads`,
`ssa_tests.repeatedElementReadOnce`). Only a plain read (`k` 0, whose misses exit: no getter
runs in it) of a borrowed result; the array is matched through borrowed copies of it, so
`this_array[i]` read once from the local and once from the copy the loop's front block made
is one read.

## Exits name the unboxed number

After `u = unbox.i32 v` passed, `v` is an Int and `u` is its number. An exit later in the
block that writes `v` to the interpreter's frame writes `int u` instead: the same value. `v`
then has no reader past its unbox, which is what lets the backend load an element's number
straight from the array (below). Only a borrowed `v` (an owned one is moved by the exit, and
the ownership rules count that), and only exits one instruction uses: an exit shared with an
instruction in front of the unbox (the front block of a hoist) runs before `u` exists.

**The unbox moves up to its read.** `(this.state & HELD) != 0` reads the field and the
variable before it unboxes either, so each boxed value crossed its frame slot on the way to
its number. A plain `unbox.i32` (and an `unbox.f64`) that is the one reader of a borrowed
read in its block, with nothing between that changes or reads the value
(`safeBetweenUnbox`), is moved right behind the read (`ssa_opt_unboxed.hoistUnboxes`): of a
field, a trusted element, and for integers a closure variable's cell in an inlined body.
It takes a copy of the first exit after the read, and the exits behind it name the number.
A value that is not a number then leaves one instruction earlier than its operation would
have; where the function's own code already left at an instruction between the two (the
compile's deopt sites), an integer's unbox stays, so that the exit taken is the one the
next compile learns from. A double's moves all the same, as it did before integers were
moved: the exits behind an `unbox.f64` hand the interpreter its number as a Float64, also
when it was an Int, and which of two operands is unboxed first decides whether a division
that leaves at a string divisor is redone on `100` or on `100.0` (RayTrace's
`canvasHeight /= pixelHeight`; a Float64 height then fails the integer test of
`y < canvasHeight` in the render loop).

## Exits leave dead locals out

An exit writes every local to the interpreter's frame, so every local was live at every
guard: a temporary read once kept its register, or its slot's store, until the last guard
of the loop. An exit now names undefined for a local the bytecode's liveness says no path
reads from the exit's pc on (`Translator.deadLocal`, in `exitHere` and for the innermost
frame of `inlineExit`), when letting the value go costs nothing: an unboxed number, an
immediate or a borrowed value (an owned one still has to be released by someone, so it
stays). The interpreter resumes at that pc and writes the local before any read. The
liveness is per instruction start; an offset inside an instruction keeps every local live.
In `am3` the values of `l`, `h` and `m` from the turn before, and `xl`'s and `xh`'s
sources, no longer hold registers across the loop: 70 instructions a turn became 60.

The frames around an inlined body are written by every exit of the body as they were at
the call, so a local of the caller that is dead at the call lived through the body, and
through its loop, for those exits alone. At an inlined call the caller's dead locals that
hold no count (a number, a borrow) are undefined from there on, for the body's exits and
for the caller after the call (`Translator.inlineOne`). A value that holds a count stays.
Releasing it at the call was tried: a copy of the local among the call's operands (`f(v)`,
`v.m()`) borrows from the local while the local lives, and is a count of its own once the
local is gone, a retain and a release where there were none. Richards' compiled code ran
8% more instructions that way. What the translator sees as a value that may hold a count
is often a number once parameters unbox (a result of an inlined call, as the first
carry `c` of `bnpSquareTo`, which still holds a register through the second call's loop:
two instructions a turn); telling those apart is left to do.

**A copy that takes the count.** `v = retain x` with `release x` behind it and only
copies between them is one value: the count neither rises nor falls
(`ssa_ownership.handOver`). A local that is returned is that (`return r` copies r, then
the function's end releases it), and so is a local an edge lets go right behind its last
read. It runs after `borrowArguments`: a local that only ever holds an argument is a borrow
with no count at all, unless the value it is returned as were the local itself. In the
compiled functions of Richards, DeltaBlue, Crypto, RayTrace and Splay 7 to 35 owned
copies go this way.

**A store to the field that was read.** `var v = this.v1; this.v1 = null` followed by a
release of `v` close by made the read a borrow (`borrowFields`) and marked the store to
leave when the field holds the value's last count, which it then does on every call: with
the local released where it died, Richards' `DeviceTask.run` left at each store, 42% more
instructions for the suite. `borrowFields` gives up at a store to the field the value was
read from, of the same object. The translator records the atom of each named read and
store for that (`Function.nameField`, `fieldAtom`); a store to another field of the object
is crossed as before.

## Products that need no sign of zero

`0 * -5` is -0, which no i32 holds, so a `mul.i32` leaves when its product is zero and a
factor is negative: a `test`, a branch, and both factors kept in their places for the piece
after the blocks that tells which zero it was. `ssa_opt_unboxed.zeroProducts`, the last
pass, marks the products where nothing can tell (`Inst.proven` on a `mul.i32`, printed
`proven`): the product has one reader, in its block and its frame, which is

- a bit operation, a shift, `Math.imul` or a compare: ToInt32 of -0 is 0, and -0 compares
  as 0;
- an `add.i32` or `sub.i32` that takes it second: `x + -0` and `x - -0` are `x` for an i32
  `x`, which is never -0;
- an `add.i32` that takes it first, when the second operand is no product (two products
  that are both -0 add up to -0, and `-0 - x` is -0 for a zero `x`, so a difference never
  takes it first).

The exits are what is left to get right, since an exit hands the product to the
interpreter as the number 0:

- An exit may name the product only as one operand on a stack (the frame's or an inlined
  body's), once, at or in front of the reader. The interpreter that resumes there takes it
  with the same instruction the compiled reader stands for. A local or an argument is read
  by whatever runs next, so a product named as one, twice, after its reader, on an edge or
  in a virtual object keeps its test.
- For a sum or a difference no instruction between the product and its reader may leave.
  The other operand is an i32 only at the reader: in `a[i] + x * y` the element is unboxed
  between the two, and where that leaves (the element is -0, say) the interpreter adds the
  product to a value that is no i32. The reader's own exit (overflow) has both as i32s.

A marked product whose range cannot overflow either (`ssa_ranges.mulRangeSafe`) has no
exit to keep its factors for, so the register allocator gives it the register of a factor
that dies there and the backend multiplies in place; any other product still avoids both
factors' registers. In `am3`, `h * xl` and `xh * h` lose the test and `xh * h` no longer
goes through `rax`: 54 instructions a turn became 49. `xh * l` keeps its test, as its sum
takes two products. Checked by `tests/baseline/t92.js`: every reader above and every way
to keep the test, with zero products of both signs, an element, a field and a `valueOf`
that yield -0, compared through `1 / x`.

## In the backend

- **Constant operands are immediates.** `and`, `or` and `xor` with a constant, and
  shifts by a constant, read it as an immediate (`sar eax, 28`); such a shift needs no
  `cl` and no save of `rcx`; `x >>> c` with a count that is not 0 has no sign test, as its
  result is below 2^31. `mul.i32` by a positive constant is `imul` with an immediate and
  no -0 test. A `const.i32` takes no register (x64_regalloc): its readers take it as an
  immediate, or from its slot, so the three integer registers of code on a baseline frame
  go to values.

- **Eight integer registers on a baseline frame.** Code on a baseline frame had three
  (rbx, r14, r15). rsi, rdi, rdx, r10 and rcx join them as fragile registers
  (`Pool.fragile`): only a value whose interval holds nothing but instructions that keep
  them (`x64_regalloc.keepsFragile`) takes one. Those are the gentle ones (integer
  arithmetic, compares, constants, boxes and unboxes of numbers, jumps and branches), which
  never touch them, and an inlined body's `inline.frame`, which emits nothing; a
  `check.array` and a trusted element read, which leave instead of calling; and a trusted
  element store and a poll, whose slow paths keep the five registers in the scratch slots
  over their call (`keepFragile`). rax, r8, r9 and r11 stay the lowering's own: an exit
  takes how it left in r8 (it was rcx), a variable shift keeps rcx in r11, and a trusted
  store's heap test takes r8. The exit dump holds the eight (`jit_exit_state.DUMP_INTEGERS`).
  Crypto's `am3` then carries its counters in registers: at scale 20 the optimizer took
  about 745 ms where it took 850, though the instruction count hardly moved (moves between
  registers cost next to nothing, a value's trip through a frame slot does).

- **A branch jumps through an empty latch.** A branch whose fall-through block holds only
  a jump with no moves (a counted loop's latch, its poll taken in front) jumps straight to
  that jump's target on its true edge (`through`): one taken jump a turn where there were
  two.
- **Additions next to counted accesses keep the count.** `d0[i0 + row1]` with the sum in
  no register: the add ran in RAX, which holds the Array's count for the accesses around
  it, so each of advect's four reads loaded the Array, its count and its elements again.
  The add now runs in R8 while EAX holds a count (`cachedCount`), and the access takes its
  index from the scratch register the add left it in (`r8Holds`, `raxHolds`) instead of
  from the slot: 11 instructions a read where there were 15.
- **A constant is stored from its immediate.** `p[i] = 0` wrote the constant to its slot
  (two stores), loaded it and stored it; the fused store writes the immediate, and the
  constant takes no slot (`countUses`).
- **Results take the register of an operand that ends there.** `x64_regalloc.scan` prefers,
  for the result of an add, a sub, a multiplication or a division, the register of an
  operand whose interval ends at that instruction (the first operand's; the second's too
  where the operands may change sides), so the operation runs in place; and for a
  difference or a quotient it avoids the second operand's register, where the operation
  has to go through a scratch register and back (`movapd xmm0, a; subsd xmm0, b; movapd b,
  xmm0`). The hint an edge gives (a loop's parameter) still wins when its register is free.
- **`mul.i32` tests for -0 out of line.** The product is taken from the second operand's
  register or slot (`imul eax, [slot]`); a zero product jumps to a piece after the blocks
  that ors the operands, still in their places, and leaves when that is negative, so a
  nonzero product runs `imul`, `jo`, `test` and a branch not taken. Operands known never
  to be negative (a constant that is not, an `and` with one, `>>>` by a nonzero constant)
  need no test at all, and neither does a product whose one reader cannot tell the zeros
  apart (above).
- **Trusted accesses keep their slow paths out of line.** A trusted read fused with its
  unbox branches to a piece after the blocks when the element is no Int (it copies the
  element to its slot and leaves at the unbox's exit) and the unbox itself is not lowered
  (`omitAt`); a trusted store branches there when the old or the new value is counted (the
  helper, with the fragile registers kept). The loop then runs straight through both, with
  no jump over code it does not run (`coldPieces`).
- **A trusted store reuses the element a read of it found.** `a[j] = f(a[j])`: the store
  of a trusted Array element whose object and index are those of the trusted read before
  it in the same block, with nothing between that touches R11 (arithmetic, compares,
  constants, number boxes and unboxes, shifts by a constant: `r11Kept`), takes the element's
  address from R11 instead of loading the object, testing the count and indexing again
  (`reusesElement`). Seven instructions of each turn of Crypto's `am3` loop.
  When the read's unbox found a number (the fused read leaves through its piece
  otherwise), the element still holds that number at the store: nothing in between
  writes memory. The store then has no test of the old value and no cold piece
  (`elementNumber`): two instructions a turn.
- **A plain store reads no index and has no exit.** Such a store through an Array's
  elements, of a number boxed right before it, into an element whose read went on with
  an Int, writes through R11 and nothing else: its index is not read, and it cannot
  leave. `x64_regalloc.plainStores` says which stores these are before registers are
  given (the same test on the instructions that the lowering makes on its own state: a
  trusted read of the same elements and index earlier in the block, its result read by
  the unbox after it alone, only `r11Kept` instructions between, the box right before
  the store read by the store alone), and the allocator then counts neither the store's
  index nor its exit's values as read there. In `w[j++] = l & 0xfffffff` the index ends
  at `j + 1`, which is computed in `j`'s register, and the back edge moves nothing for
  it: two instructions a turn of `am3`. A store of an Int also leaves the tag where it
  is, as the read found an Int's: one more. Should the lowering find such a store with
  R11 or the Int gone (its own state disagrees with the test), it marks the code faulty
  and the function stays in baseline code (`Emitter.fault`); a stress run, whose stores
  do leave, has no plain stores.
- **A loop's branch goes straight back to its top.** A counted loop's latch holds only
  its jump back (and, in an inlined body, an `inline.frame`, which emits nothing). The
  branch that reaches it jumps to the loop's header itself (`through`), also when the
  jump back has moves to make: they run in front of the conditional jump, as moves keep
  the flags the compare set, when no move writes where a value that lives past the block
  is (`movesAbove`, by the allocator's intervals), so the loop's other way out still
  reads what it needs. One jump a turn where there were two.
- **A number is added from its element.** `l + w[j]`: an Int a trusted read found, read
  by its unbox alone and then only by the add or subtraction right after (as the term
  that is not the result's place), stays in the element: the unbox tests the tag and the
  operation takes the payload from memory (`add r15d, [r9 + r11 * 8 + 8]`). The number
  has no register and no slot's store (`x64_regalloc.foldedUnbox`, in `Shortcuts.folds`;
  `Emitter.memFor`). Where the operation overflows, a piece after the blocks writes the
  number to its slot for the exit, and undoes the operation when it ran in place. Not
  with a constant as the other term, whose slot the operation would read.
- **What a loop carries around stays in a register.** A loop header's parameter in its
  slot is stored on every turn and loaded on the next, and that load waits for the
  store; a value the loop only reads costs a load nothing waits for. `am3`'s carry `c`
  was in its slot. `x64_regalloc.weigh` counts a header's parameter 12 where it counted
  4, so the value that goes to its slot is one the loop only reads. An Array's elements, loaded to R9 for an access and mostly
  still there at the next one in the block (`preservesArrCache`, which bit operations
  and products without a zero test now keep), count once a block. Of values whose
  weights are within a quarter of each other the one that ends last goes, so a
  temporary a little lighter than a long value does not go first and the long value at
  the next temporary all the same.
- **Bit operations run in place.** `l & 0xfffffff`, `m >> 14`: a bit operation or a
  shift by a constant whose operand ends there takes the operand's register
  (`scan`'s `operand`), with no move in front.
- **Spill weights count what a slot costs.** A value read from its slot by an operation
  that takes a memory operand (`imul esi, [slot]`, `add`, `and`, a compare) costs one
  micro-operation more; one that must be loaded first, or stored when it is defined,
  costs a load or a store. `x64_regalloc.weigh` counts 4 for those and 1 for a second
  operand read from memory (and a first operand that lives on), times 8 for each loop
  level, where it counted every read alike. `am3` then keeps `i` and `n` in registers and
  reads `xl` and `xh` from their slots in the multiplications: 58 instructions a turn
  became 54.
- **An index a trusted access bounded does not overflow.** `i + 1` after a trusted read
  or store of element `i` in the same block has no overflow test: `i` is below an
  Array's count, far below 2^31 (`cannotOverflow`). And a compare that reads the value the
  operation before it just stored from RAX takes it from RAX (`raxHolds`).
- **Byte compares in memory, flags reused.** A trusted read's tag test and a trusted
  store's test of the old value compare the tag byte in memory (`cmp byte [r11], k`); a
  fused store writes the number's register as the payload word (it is zero-extended). A
  compare with 0 of the value the add, sub or bitwise operation just before computed, with
  no code between, takes that operation's flags (`flagsAfter`, `flagsHold`): without an
  overflow they are a compare's for the signed conditions and equality.
- **A store of an immediate skips its heap test.** `put.elem` of a value that is
  `Own.Imm` (a boxed number, undefined, a boolean) does not test whether the new value is
  counted.
- **A compare of doubles feeds its branch.** `lt.f64`, `le.f64`, `gt.f64` and `ge.f64`
  whose one reader is the branch right after are `ucomisd` and one conditional jump
  (`compareDoublesFlags`, with the operands swapped for `<` and `<=` so that an unordered
  compare takes the false edge), where they were `setcc`, a test and a jump.
- **`x | 0` of a double converts in line.** `to.int32` is `cvttsd2si` to 64 bits, a
  compare that overflows only for the one value the conversion answers what it cannot
  convert with, and a 32-bit move; NaN, the infinities and values past 2^63 go to a piece
  after the blocks (`toInt32Slow`). And `x | 0` or `x ^ 0` of an int32 is `x`
  (ssa_ownership.fold): after `(a * b) | 0` only the conversion is left.
- **`add.i32` and `sub.i32` in place.** When the result takes the first operand's register
  the operation runs there, two instructions where there were four. The exit state reads
  the operand, so the overflow jump goes to a short piece after the blocks that undoes the
  operation and then jumps to the exit.
- An Array's length is a number: its inline read took a count it never needed.
- **One test for an Array.** The flags byte and the 16-bit class of an object share a
  32-bit word, so "class Array and fast" is one masked compare, where it was two loads and
  two compares.
- **`get.elem` followed by its unbox.** When the element's only reader is the `unbox.i32`
  next to it (and that unbox's own exit), an Int goes from the array to the number's
  register and the unbox is skipped; anything else is copied to its frame slot as before
  and the unbox refuses it. No exit changes.

- **A field or a variable followed by its unbox.** As for elements: when the one reader of
  a keyed `get.field` (a known shape, no prototype steps) or of an owned variable's cell is
  the plain `unbox.i32` next to it, the tag byte is compared in the object (or the cell)
  and the number loaded from there (`fusedUnboxI32`, `loadInt`). Anything but an Int is
  copied to the value's frame slot by a piece after the blocks, which then takes the
  unbox's exit. Richards: 1.583G to 1.533G.
- **`==` with a number known.** Two boxed operands make a generic `equals`, since a guard
  that both are integers would leave at the first object. Where an earlier unbox that
  dominates the test proved one operand an Int (`this.state & HELD` in front of
  `this.state == RUNNABLE`: both read the same field, `ssa_shapes.sameAs`), the test first
  compares the other operand's tag byte with Int and then the two numbers, and only another
  kind of value goes on to the generic code (`knownInts`, kept alive for the test by
  `Shortcuts.keeps`; `equalsFlags`). When the other operand is an owned variable's cell
  read right in front, the compare reads the cell and the boxed copy is made only on the
  generic path (`fusedEqualsVar`). Richards: 1.533G to 1.473G.
- **A null test of a fresh value** is `lea r8d, [rax - low]; cmp r8b, 1` where it was a
  byte load, a subtraction and a compare; `&`, `|` and `^` of two registers compute in the
  result's register (`mov; and; mov` became `and`). Richards: 1.473G to 1.451G.

## What it is checked with

- `tests/baseline/t105.js`: fields and closure variables read as integers by `&`, `==`,
  `===` and compares in inlined methods, then changed to doubles, strings, null,
  undefined, booleans and an object with `valueOf`, so every fused read and every hinted
  test takes its other path and leaves compiled code.

- `ssa_tests.goldenBorrowedElements`, `goldenHoistedLength`, `goldenHoistedInLoopEntry`: the
  form after the passes.
- The differential (modules/engine/scripts/differential.py):
  - flavour `aliases`: the array is the only owner of its strings and arrays, a store
    replaces the element just read (the same slot or another) before the value is used
    again, and the length changes inside the loop that reads it;
  - flavour `hoists`: a loop reads a field, a global, a length or a typed array element that
    does not change, and then it does, at one iteration or at every one: the shape through a
    call (`__poke`: add, delete and re-add, a getter, a double) or a store, the binding, the
    array's length, the typed array's buffer (`__cut`: detached, shrunk, grown);
  - flavour `conversions`: conversions of loop-invariant values on -0, NaN, doubles and
    non-numbers, with the sign of zero in the checksum;
  - the long loops read an array's length and a global's field, in code entered at the loop;
  - configurations `jit-no-hoist` and `jit-no-borrow` run without one pass each, so a
    mismatch is pinned on a pass. `jit-stress` takes every guard's exit in turn, the hoisted
    ones included, so a wrong entry state shows as a wrong checksum.

## Measured

Callgrind instructions for the whole run over the kernel's units (`--jit`; x86-64, one
process, `--smc-check=all-non-file`), on the kernels of the scorecard. Before is the tree
without this work (for typed-array: both passes off, with the doubles stream's inline
element code). V8 is node 22 run the same way, less an empty script's run; both columns
include their warm-up.

| Kernel | Before | After | Without hoisting | Without borrowing | V8 | After / V8 |
| --- | --- | --- | --- | --- | --- | --- |
| array-sum (`s + a[i]` over 1000 ints) | 78.2 | 29.3 | 46.2 | 67.2 | 13.1 | 2.2 |
| sum-long (counted loop, one branch) | 15.4 | 11.4 | 11.4 | 11.4 | 16.5 | 0.7 |
| nested (`s + i * j`, two loops) | 26.6 | 24.6 | 24.6 | 24.6 | 13.1 | 1.9 |
| doubles (`s * 0.999 + i * 0.25`) | 20.4 | 18.3 | 18.3 | 18.3 | 17.3 | 1.1 |
| typed-array (Float64Array multiply-add) | 373.7 | 182.0 | 301.8 | 377.7 | 16.3 | 11.2 |

## What is left

- **array-sum, 29 against 13.** Each `a[i]` still tests the tag of `a`, its class and fast
  flag (seven instructions), compares the index with the count (three) and jumps over the
  code for the other kinds of object (one). A `check.array` guard in front of the loop and
  an element read that trusts it need the element kind each site saw (now recorded in js_feedback): without it a loop over a typed array would deoptimize at
  its entry. The bounds check then goes when the loop's bound is the hoisted length.
  Monomorphic typed-array sites now try the recorded class before the Array path.
- **typed-array, 178 against 16.** Every element crosses a frame slot as a boxed double, and each access
  tests the class and the count again. The recorded kind now selects the typed arm. Keeping an unboxed double in the
  arithmetic path and safely reusing the view checks are the next candidates.
- **nested, 25 against 13.** `mul.i32` spends eight instructions on overflow and -0; the
  ranges of `i` and `j` (both counted up from 0) would drop the -0 test.
- A loop end costs four instructions (the conditional jump to the latch, the poll's two,
  the jump back); placing the latch after the loop's last block saves one.
- Hoisted instructions are not merged with equal ones that already ran before the loop
  (array-sum reads `a.length` in the pre-test and again in the front block).
