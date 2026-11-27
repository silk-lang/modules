# Call and type feedback

Milestone 6, part 1. What the interpreter already remembers per site, what was missing for a
speculating compiler, the recorder added in `modules/engine/src/js_feedback.silk`, and what it
costs. Every `file:line` is in `modules/engine/src` on branch `claude/project-thread-kuzo60` at
`d5d0320` unless it says otherwise. Each claim says whether it was **read** in the code,
**ran** (executed, result checked) or **measured**.

## 1. What the interpreter already records

All read in the code.

| State | Where | Keyed by | Per site? | What a compiler can recover for one bytecode offset | Missing |
| --- | --- | --- | --- | --- | --- |
| Inline field key | 8 bytes after the atom of final `get_field`, `get_loc_field8`, `get_arg_field8`, `put_field`, `put_loc_field_*` (`js_opcode_data.silk:339-347`); read by `fieldKeyAt` (`js_vm_property_ops.silk:407`) | the instruction itself: `shape.version << 16 \| slot` of one own data property | yes, in the bytecode | the last own-property shape and slot this site hit, by reading the operand at `offset + 5` | one shape only, overwritten on every refill (`refillFieldKey`, `:433`); prototype, absent and getter answers never go inline; no count; no polymorphism history; mutates the bytecode, so it is not part of a serializable input as is |
| `fieldCache` | `RuntimeState.fieldCache[4096]` (`js_core_types.silk:792`), entry `FieldCacheEntry` (`:928`) | site *address* masked to 12 bits (`fieldCacheIndex`, `:1030`), plus a spare slot `^ 2048` (`storeFieldEntry`, `:1043`) | per site but lossy: two sites with equal low address bits evict each other; the entry checks `site` so it never answers for the wrong site | for the site at address `code + offset + 1`: one second key (the shape the inline key displaced), or a prototype answer (holder, epoch, slot), absent or getter | keyed by a process-local address, so nothing survives serialization or moving code; at most two shapes per site; history lost on eviction |
| `polyFields` | `RuntimeState.polyFields[256]` (`:796`), `PolyFieldEntry` (`:1005`), `polyLookup` (`js_vm_property_ops.silk:512`) | (shape version, atom), shared by every site | no | nothing per site: it says what an atom resolves to on a shape, not which shapes a site saw | site identity |
| Transition memo | `transitions[512]`, `transitionChains[512]` (`js_core_types.silk:778`, `:780`); `memoTarget` (`js_shapes.silk:184`) | base shape address and version, atom, flags | no | which shape an add of atom moves a shape to; useful to predict a store's target shape once the site's input shape is known | site identity; base keyed by address |
| `typedLengthCache` | `[12]` entries (`js_core_types.silk:798`), `TypedLengthEntry` (`:951`), filled at `js_vm_property_ops.silk:239` | typed array class | no | how `length` resolves for a typed array class at an epoch | site identity |
| Known local functions | `FunctionBytecode.known: KnownCall` (`js_core_types.silk:2303`), states `KNOWN_*` (`:2295`); entered by `enterKnownCall` (`js_vm.silk:3274`) | the callee function, decided by the bytecode compiler (`js_compiler_known`) | per callee, static | that a call names a known local function: the target is fixed at compile time, so the call site is monomorphic by construction (the stack value is the callee's `FunctionBytecode`, tag -2) | nothing to learn: it is static |
| Leaf flags | `FunctionBytecode.leaf` (`js_core_types.silk:2313`): `LEAF_CREDITS` 63 (`js_bytecode.silk:677`), decided by `leafCode` (`:741`), spent by `miss` (`js_vm_leaf.silk:64`) | callee | per callee | the callee is small and loop-free (a candidate to inline); remaining credits say how often its frameless run declined | which call sites call it; why runs declined |
| Constructor forms and plans | `FunctionBytecode.constructForm` (`js_core_types.silk:2320`, from `constructForm`, `js_bytecode.silk:909`); `receiverCache[64]` (`js_core_types.silk:813`, `ReceiverCacheEntry` `:1080`, 4-way by constructor address, `js_gc.silk:903-905`); `constructCache[64]` (`js_core_types.silk:868`, `js_construct_eval.silk:86-88`) | constructor function address / code address | per constructor | the final shape a `new F(...)` produces, the argument-to-slot plan, the prototype chain versions | site identity; keyed by addresses; capacity 64 |
| `instanceCache`, `literalCache` | `js_core_types.silk:819`, `:823`; `js_vm_object_ops.silk:108`, `js_gc.silk:1161` | shape version / literal site address | literal: per site (address hash, lossy) | the shape an object literal site makes | address keyed |
| Fused compare-and-branch, slot compares, fused element stores | the `OP_fuse_prefix` arm (`js_vm.silk:805`), `fusedCompare`, `fusedSlotCompare`, `fusedLoopBranch` (`js_vm_operators.silk:718`, `:567`, `:421`) | written by the bytecode compiler into the code | per site, static | the site's operand *sources* (which locals, constants), not the types seen | no runtime history at all: the fusion tries its fast path each time and falls back silently |
| Hotness | `FunctionBytecode.hotness` (`js_core_types.silk:2341`), `js_hotness.silk` | function | per function | that the function was entered `HOT_ENTRY_BUDGET` times | no per-site data |

Conclusion (read): before this change the interpreter kept **no operand type history and no
call-target history anywhere**; every arithmetic fast path (`add_loc_loc8`, `add_imm`, the fused
compares) tests the types each time and forgets. Shape history exists per site for named
property reads, but holds at most two shapes, is split between the bytecode and an
address-keyed table, and loses entries to collisions. None of it can be serialized as is.

## 2. Design

### What is recorded

One `Site` (`js_feedback.silk:61`) per instruction of a recorded function whose opcode
`siteKind` (`:126`) selects, found by one walk over the final bytecode when recording starts:

| Kind | Opcodes (final code) | Recorded |
| --- | --- | --- |
| `KIND_BINARY` | `mul`..`gte`, `eq`..`or`, `add_loc`, the local-operand forms `add/sub/mul_loc_loc8`, `*_top_loc8`, `*_top_arg8`, the immediates `add_imm`..`or_imm`, `shl_imm`, `strict_eq_imm8`, `strict_neq_imm8` | class bits of each operand (`SEEN_INT`, `SEEN_DOUBLE`, `SEEN_STRING`, `SEEN_OBJECT`, `SEEN_OTHER`), `SEEN_OVERFLOW` when int32 operands gave a non-int32 result (overflow, -0, fraction, `>>>` past int32), count |
| `KIND_UNARY` | `neg`, `dec`, `inc`, `post_dec`, `post_inc`, `dec_loc`, `inc_loc` (138..145 except `plus`), `step_loc8`, `step_arg8` | operand class, overflow (step past int32, `-0`), count |
| `KIND_CALL` | `call_constructor`, `call`, `tail_call`, `call_method`, `tail_call_method`, `call0`..`call3` | up to two distinct targets, then megamorphic; a target is a bytecode function (by its `FunctionBytecode`), a native (by `NativeFunctionId` and magic) or other |
| `KIND_PROPERTY` | `get_field`, `get_field2`, `put_field`, `get_length`, `get_loc_field8`, `get_arg_field8`, `put_loc_field_loc8`, `put_loc_field_arg8` | receiver class, up to four distinct receiver shapes (`ShapeData.version`), then megamorphic |

| `KIND_BRANCH` | `if_false`, `if_true`, `if_false8`, `if_true8`, `if_true_keep8`, `if_false_keep8`, `lnot` | class of the value tested, `SEEN_NOT_BOOL` when it was not a boolean, count (added for compile-cost.md, "Recording before the first compilation") |

Element access, `instanceof`, branch directions and constructors' results are not recorded yet (see open
questions). Overflow is computed from the int32 operands before the instruction runs
(`overflows`, `:151`), so it needs no hook after the instruction.

### When it is collected: only while an embedder records a function

The recorder runs in the **observed** dispatch loop only. `RuntimeState.feedback.recording`
counts functions being recorded; `refreshObservation` (`js_core_types.silk:2669`) turns
`observeInstructions` on while it is nonzero, exactly as the debugger, coverage and the CPU
profiler do. `observeInstruction` (`js_vm.silk:633`) then calls `feedback.observe`
(`js_feedback.silk:395`) before each instruction (`js_vm.silk:638-640`). The plain loop has no
new code: it hands off to the observed loop at its next interrupt poll, and is handed back at
the next instruction after the last recording stops (both existing mechanisms, tier-seam.md).

Why this and not always-on recording (read and measured):
- Always-on would need recording code in the plain loop's arithmetic arms, every fusion and
  every call path. The plain loop answers most arithmetic inside fused superinstructions and
  `OP_fuse_prefix` without dispatching the covered instructions, so "always" means adding a
  type test and a site store to each of those fast paths. The hotness counter alone, one
  decrement per entry, cost up to +0.34 percent (tier-seam.md, measured there); a per-site
  record is several loads and stores per arithmetic instruction, so it could not meet the
  0.5 percent target. Not prototyped: not plausible, by that comparison.
- Recording in the observed loop sees every instruction unfused, so the sites are the
  bytecode's own instructions and nothing a fusion answered is lost.
- Cold code stays free: a function is recorded only after its hot report, and only for its
  budget.

A recording stops by itself after `budget` observed instructions of that function
(`DEFAULT_FUNCTION_BUDGET` = 20000 for the CLI switch, `:57`), and every recording stops once
the observed loop ran `WINDOW_FACTOR` (4) times the latest start's budget in all functions
together (`:58`, `begin` `:256`), so a recorded function that stops running cannot keep the
whole runtime in the slow loop. `stop` ends one explicitly.

### Read API (for workstream G)

In `js_feedback.silk`, exported from the engine package:

- `start(runtime, bytecode, budget) -> bool` (`:207`): call it from the `hotFunction` handler
  with the reported `FunctionBytecode`. Resumes a stopped record with a fresh budget. Allocates
  all sites and room for two targets per call site up front, so `observe` never allocates.
- `stop(runtime, bytecode)`, `isRecording(runtime, bytecode)`.
- `snapshot(runtime, bytecode) -> Option<Snapshot>` (`:294`): a copy, `Snapshot { recording,
  observed, sites: List<Site>, targets: List<Target> }`, with each site's `first`/`second`
  renumbered into the snapshot's own target table.
- `releaseAll(hooks, runtime)` (`:320`), also called from `gc.destroyRuntime`.
- `summary(runtime)`: counts over all records (used by the CLI).

`Site` is plain data (`Copy`, integers only). Pointers live only in the separate `Target`
table, so a serializer writes sites as they are and replaces each target by a descriptor;
`NativeFunctionId` (family, method) plus magic already is one. Shapes are named by
`ShapeData.version`, a runtime id: meaningful in the recording process only, which is what a
guard needs; a stored artifact must not rely on it. `Site.offset` is the bytecode offset of the
instruction, the key a compiler uses. Snapshot targets are borrowed from the recorder.

Ownership (read in the code, test checks no leak): a record retains its `FunctionBytecode` and
every bytecode target; `releaseAll` releases them outside the runtime borrow. A target the
recorder holds therefore lives until `releaseAll`; the cycle collector sees the extra count as
an external owner. Acceptable for a prototype, not for long-running embedders (open question 4).

### CLI

Hidden switches in `qjs` (`cli_options.silk:138-139`): `--debug-feedback` installs a hot
function handler (`qjs_feedback.silk`, handled in `js_libc_services.silk:163`) that records
every reported function; `--debug-feedback-stats` also prints one `key=value` line per kind to
stderr before the session closes (`qjs_launch.silk:73`).

## 3. Measurements

Host: the 4-CPU, 15 GiB Linux x86-64 cloud container of this session, Silk
0.1.0-dev.74+205aea3f5b2e, Clang 22.1.8, release builds (`silk build --release`). Baseline:
integration head `6341d15`.

### Interpreter-only cost, no handler (measured)

`python3 scripts/v8bench.py --instructions BASE NEW` in `modules/engine` (exit 0), NEW built at
`87d8ad2`:

| Benchmark | Base | Recorder build | Ratio |
| --- | --- | --- | --- |
| richards | 518,289,632 | 518,289,858 | 1.000x |
| deltablue | 749,205,519 | 749,186,759 | 1.000x |
| crypto | 3,015,753,566 | 3,015,688,347 | 1.000x |
| raytrace | 1,230,856,052 | 1,230,856,276 | 1.000x |
| earley-boyer | 1,148,237,784 | 1,148,238,148 | 1.000x |
| regexp | 1,380,245,816 | 1,357,603,556 | 0.984x |
| splay | 1,373,669,354 | 1,373,675,412 | 1.000x |
| navier-stokes | 1,100,981,129 | 1,100,981,354 | 1.000x |

Rerun with the final binary (`d5d0320`, exit 0): richards 518,289,536 / 518,289,827, deltablue
749,205,609 / 749,186,779, crypto 3,015,463,144 / 3,015,452,286, raytrace 1,230,856,379 /
1,230,856,245, earley-boyer 1,148,237,918 / 1,148,237,961, regexp 1,357,606,577 / 1,357,603,615,
splay 1,373,669,368 / 1,373,669,962, navier-stokes 1,100,981,316 / 1,100,981,437: **1.000x on
all eight**.

The target (under 0.5 percent on every benchmark) is met. The first run's regexp 0.984x is not
the change: the *baseline* binary itself counted 1,380,245,816 in the first run and 1,357,606,577
in the second (and the recorder build 1,380,237,591 once in the recording-cost run), so regexp's
instruction count varies by about 1.7 percent between runs of one binary (measured; cause not
traced, possibly time-dependent work in the benchmark). Treat regexp deltas under 2 percent as
noise.

### Cost while recording (measured)

Instructions of the same release binary on the same fixed-iteration scripts, without and with
`--debug-feedback` (callgrind; script `reccost.py` reproduced below), at `d5d0320`:

| Benchmark | Plain | `--debug-feedback` | Ratio | Recorded functions | Observed instructions (in recorded functions) |
| --- | --- | --- | --- | --- | --- |
| richards | 518,289,481 | 589,633,022 | 1.138 | 11 | 437,046 (75,674) |
| deltablue | 749,186,752 | 885,603,098 | 1.182 | 28 | 953,947 (70,652) |
| crypto | 3,015,705,351 | 3,088,111,056 | 1.024 | 9 | 515,795 (33,215) |
| raytrace | 1,231,230,226 | 1,412,619,562 | 1.147 | 24 | 1,187,391 (83,908) |
| earley-boyer | 1,148,237,820 | 1,333,115,212 | 1.161 | 24 | 1,125,941 (173,292) |
| regexp | 1,380,237,591 | 1,370,620,860 | 0.993 | 2 | 51,950 (40,000) |
| splay | 1,373,669,688 | 1,423,970,701 | 1.037 | 9 | 266,884 (83,498) |
| navier-stokes | 1,100,981,267 | 1,100,982,316 | 1.000 | 0 | 0 |

The extra instructions are a fixed amount per run (about 70 to 185 million here, roughly 150 to
200 native instructions per observed bytecode instruction), so the ratio says how short these
fixed scripts are (richards' 20 iterations take about 0.1 s) more than what a long run pays.
regexp's ratio is inside its run-to-run noise (above).

The cost is a one-time cost at warm-up, not a slowdown that stays: richards run 3 iterations at
a time printed 4-6 ms per round with and without the switch except the first round (15 ms with
the first window, 9 ms with the final one) (measured, wall time, one run). The first, larger
window (1,000,000 observed instructions per start, `87d8ad2`) cost +1 to +74 percent on the same
scripts (richards 1.434, deltablue 1.739, crypto 1.244, raytrace 1.731, earley-boyer 1.635,
regexp 1.009, splay 1.129, navier-stokes 1.000), which is why the window now follows the budget.

Where the recording cost goes (callgrind on richards, measured, symbols from
`silkjs-engine.symbols`): most of it is the observed loop running every instruction of every
function while anything records, about 82 percent of observed instructions being outside the
recorded functions (richards: 437,046 observed, 75,674 in recorded functions). `observe` itself
is about 68 instructions per call (a linear scan of the records on a function change plus a
binary search for the site). Cheaper options, not tried: a per-function recording flag that
lets non-recorded frames run plain, which needs a per-frame loop choice the engine does not
have; a direct-mapped record cache.

### What the eight benchmarks record (measured)

`--debug-feedback-stats` on each fixed-iteration script (as `v8bench.py --instructions` builds
it), at `d5d0320`, summed over the seven benchmarks that reported functions. Counts are sites
that ran at least once while recorded.

| | richards | deltablue | crypto | raytrace | earley-boyer | regexp | splay | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| functions recorded | 11 | 28 | 9 | 24 | 24 | 2 | 9 | 107 |
| arithmetic/compare sites | 21 | 13 | 85 | 90 | 32 | 30 | 37 | 308 |
| int32 only, no overflow | 21 | 11 | 85 | 8 | 20 | 13 | 12 | 170 (55%) |
| int32 with overflow | 0 | 0 | 0 | 1 | 0 | 3 | 3 | 7 (2%) |
| numbers with a double | 0 | 0 | 0 | 79 | 0 | 14 | 21 | 114 (37%) |
| a string operand | 0 | 0 | 0 | 0 | 2 | 0 | 1 | 3 (1%) |
| other mixes | 0 | 2 | 0 | 2 | 10 | 0 | 0 | 14 (5%) |
| call sites | 19 | 55 | 14 | 84 | 63 | 1 | 18 | 254 |
| monomorphic | 18 | 43 | 14 | 83 | 63 | 1 | 18 | 240 (94%) |
| of which bytecode / native | 18 / 0 | 37 / 6 | 11 / 3 | 77 / 6 | 63 / 0 | 0 / 1 | 16 / 2 | 222 / 18 |
| two targets | 0 | 12 | 0 | 1 | 0 | 0 | 0 | 13 (5%) |
| megamorphic (3+) | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |
| property sites | 112 | 147 | 69 | 402 | 62 | 2 | 68 | 862 |
| one shape | 111 | 123 | 67 | 364 | 58 | 2 | 27 | 752 (87%) |
| 2 to 4 shapes | 1 | 24 | 0 | 38 | 0 | 0 | 41 | 104 (12%) |
| 5+ shapes | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| a primitive receiver | 0 | 0 | 2 | 0 | 4 | 0 | 0 | 6 |

navier-stokes reports no function: its few functions are entered rarely and loop for long, the
on-stack-replacement case tier-seam.md leaves open. With the first, larger window deltablue
showed 9 two-target and 3 megamorphic call sites instead of 12 and 0: what a short window sees
depends on when it runs, so these fractions describe the first 20,000 instructions after a
report, not a whole run.

What this suggests for the first compiler (inference): int32 arithmetic with an overflow guard,
monomorphic direct calls of bytecode functions, and single-shape own-property loads cover most
recorded sites; raytrace and splay need doubles early; deltablue and splay need a two-shape
property guard.

## 4. Tests and checks

| Command | Exit | Result |
| --- | --- | --- |
| `silk test --file src/js_feedback_tests.silk --optimization debug` (in `modules/engine`) | 0 | 1 passed: int-only add and compare, an add that saw a double, an add whose int32 sum overflowed, a monomorphic call naming `inc`'s code, a call with two targets, a property site with two shapes, no leak after `destroyRuntime` |
| the same with `feedback.observe` disabled in `observeInstruction` | 1 | `assertion failed: the add and the compare ran while recording` |
| `python3 scripts/differential.py --engine RECORDER --count 500 --config feedback='{engine} --debug-feedback {file}' --configs plain,observed,node,feedback` (binary at `87d8ad2`) | 0 | agree 500, mismatch 0, reference-only 0; the generated programs do get functions reported (seed 5: 7 recorded functions) |
| `silk task check` (in `modules/engine`, at `d5d0320`) | 1 | native suite 564 passed, 2 failed (566 tests: the 565 of the integration branch plus the new one); every other step PASS, including entry points type-check and `differential plain vs observed` |
| `silk test --file src/js_for_in_tests.silk --optimization debug` | 1 | the two failures are the known ones: `fatal trap: QuickJS invariant violated` at `js_array_storage_test_support:32` and `assertion failed: iteration yields the independently expected property name` |

## 5. Open questions

1. Budget and window are guesses (20,000 own instructions, window 4x). Shorter is cheaper
   (measured: the 1,000,000 window cost several times more); whether 5,000 records the same
   classes was not measured.
2. Recording forces every function into the observed loop. A per-frame choice of loop would
   cut the recording cost by about the 82 percent of observed instructions that are not in
   recorded functions; it needs the dispatch loop to switch copy at calls and returns.
3. Element access, `instanceof`, branch direction counts, constructor sites
   (`call_constructor` records the target only) and `get_array_el` index kinds are not recorded.
4. Retained targets keep functions alive until `releaseAll`. A weak table, or retaining only
   while a compiled function depends on the target, would fix that.
5. A leaf function never runs as a frame, so it is neither reported nor recorded; its call site
   in the caller is.
6. The serialized form is not written: sites are plain data and targets have a descriptor
   (`NativeFunctionId`, or the `FunctionBytecode` to be named by the serializer), but no
   encoder exists yet.
7. regexp's instruction count varies about 1.7 percent between runs of the same binary; why was not traced.

## 6. Restructures worth doing (proposed, not done)

The engine is unreleased and may change where that serves the JIT. Ordered by expected value:

1. **Feedback slots assigned by the bytecode compiler.** Have the compiler number the feedback
   sites as it emits them (one u16 operand or a side table `offset -> slot` in
   `FunctionBytecode`), so `observe` indexes instead of binary-searching, and a compiled
   function and its deopt metadata can name sites by slot. Small cost: bytecode size, and the
   serialized format gains the table (still pointer-free).
2. **A per-frame choice of dispatch loop.** Today observation is runtime-wide, so recording one
   function runs every function observed; about 82 percent of recording-time observed
   instructions are outside recorded functions (measured, richards). Choosing the loop copy at
   frame entry and return (a function flag read in `enterFrame` and `finishInline`) would bound
   recording to the recorded frames, and would let the debugger's per-function stepping use the
   same mechanism. Needs a measurement of the flag test on the call path (hotness showed the
   call path is sensitive at the 0.3 percent level).
3. **Move the inline field key out of the bytecode.** It mutates the code (so code is not a
   pure, shareable, serializable input) and holds one shape. A per-function side vector of
   field slots, indexed by the slot numbers of (1), could hold the inline key and the recorded
   shapes together, replacing the address-keyed `fieldCache` for prototype answers too. Must be
   measured against the current inline-key hit path, which reads no other cache line.
4. **Weak call-target table.** See open question 4.

## Reproduce

```sh
cd modules/engine
silk build --release            # baseline at the integration head first, copied aside as BASE
python3 scripts/v8bench.py --instructions BASE build/.../release/silkjs-engine
ENGINE=../../build/llvm/x86_64-unknown-linux-gnu/release/silkjs-engine
$ENGINE --debug-feedback-stats some.js        # summary on stderr
python3 scripts/differential.py --engine $ENGINE --count 500 \
  --config feedback='{engine} --debug-feedback {file}' --configs plain,observed,node,feedback
silk test --file src/js_feedback_tests.silk --optimization debug
```

`reccost.py`, used for the recording-cost table:

```python
import re, subprocess, sys, tempfile
sys.path.insert(0, "modules/engine/scripts")
import v8bench
engine, flag = sys.argv[1], sys.argv[2]
def count(args):
    r = subprocess.run(["valgrind", "--tool=callgrind", "--callgrind-out-file=/dev/null"] + args,
                       capture_output=True, text=True)
    return int(re.search(r"Collected : (\d+)", r.stderr).group(1))
with tempfile.TemporaryDirectory() as d:
    for name in v8bench.BENCHMARKS:
        path = v8bench.script(d, [name], v8bench.FIXED_RUNNER % v8bench.FIXED[name], name)
        a, b = count([engine, path]), count([engine, flag, path])
        print(name, a, b, round(b / a, 3))
```
