# The tier seam: where a JIT can attach to the SilkJS interpreter

Read from the code of `modules/engine` at `42b98426` (branch `claude/sweet-ptolemy-f5t7na`,
2026-11-16). Every `file:line` below is in `modules/engine/src` at that revision, except in
[Hotness counting](#hotness-counting), which cites `c56dd8d`, the revision that adds the hook. Everything here
was read in the code unless it says "ran" or "measured". Points I could not settle are listed as
open questions in the last section instead of guessed.

The hotness hook prototyped on top of this reading is described in
[Hotness counting](#hotness-counting) and its cost in [Measurements](#measurements).

## The shape of execution

There is one dispatch loop in the source, `executeLoop` (`js_vm.silk:760`), generic over an
`Observation` type (`js_vm.silk:753`). It is instantiated twice:

- the plain loop, `executePlain` (`js_vm.silk:736`), with `PlainRun`, where `observe` is the
  constant `false`;
- the observed loop, `executeObserved` (`js_vm.silk:744`), with `ObservedRun`, which runs
  `observeInstruction` (debugger, coverage, CPU profile, restricted evaluation) before every
  instruction (`js_vm.silk:776-787`).

`execute` (`js_vm.silk:698`) picks one by reading `RuntimeState.observeInstructions` and loops
when a run hands off (`handoff`). The hidden `--debug-observed` switch (`cli_options.silk:135`)
calls `js_debugger.configure(rt, true)` at launch (`qjs_launch.silk:44`), which sets the flag
through `refreshObservation` (`js_core_types.silk:2655`) and forces a poll in every context
(`js_debugger.silk:44`) so a running plain loop hands off at its next poll.

A single run of `executeLoop` executes many JavaScript frames. Calls between bytecode
functions usually do not recurse on the native stack: the callee's `StackFrame` and `Machine` are
written into the runtime's call-frame region (`RuntimeState.callFramesTop/End`) and the loop
switches its `current` machine (`js_vm.silk:766`). Such a frame is an *inline frame*; it is marked
by a non-null `Machine.record` and by `FRAME_INLINE` in its mode (`js_vm_activation.silk:491`).
The frame a native caller created is the *base frame* of that run (`record` null). A return from
an inline frame (`OP_return`, `OP_return_undef`, `js_vm.silk:1908-1920`) goes through
`finishInline` (`js_vm.silk:3791`) back to the caller's machine in the same loop.

A JIT therefore has two kinds of entry to replace or interpose on: native-stack entries (one
`callInternal`-like function per entry, recursion on the native stack, failures caught there), and
inline entries (a frame pushed into the region and dispatch continuing in the same loop).

## Every way a function body starts executing

"Counted" says whether the hotness prototype below counts the entry.

### Native-stack entries

| Entry | Where | Notes | Counted |
| --- | --- | --- | --- |
| `callInternal` | `js_vm.silk:245` | The general call. Polls interrupts (`:254`), sends non-bytecode callees to `callClass` (`:256-258`), finishes a deferred or lazy function (`finishStub`, `:262-265`, `:216`), describes and enters the frame (`:266-290`) and runs `execute` in a loop that catches failures and unwinds (`:296-311`). | Yes |
| `call` | `js_vm.silk:206` | Public wrapper: `callInternal` with `COPY_ARGUMENTS`. Used by script and eval execution (`js_eval.silk:81`) and job callbacks (`js_async_execution_consumers.silk:74`). | via `callInternal` |
| `callKnown` | `js_vm.silk:330` | A *known local function* (`js_compiler_known`: the value on the stack is its `FunctionBytecode`, tag -2) whose inline frame did not fit. Its scope lives on the native stack. | Yes |
| `callFromBytecode` / `callBytecode` | `js_vm.silk:2038`, `:2082` | Fallback from the dispatch loop when no inline frame could be made: natives skip the frame setup; bound functions with no bound arguments go to `callBound` (`:2060`); bytecode goes to `callInternal` with flags 0 (arguments not copied). | via `callInternal` |
| `construct` / `constructInternal` | `js_vm.silk:394`, `:403` | Polls (`:408`), checks constructibility, creates the receiver for a base constructor (`:422`) and runs `constructWith` (`:426`), which is `callInternal` plus [[Construct]]'s result rule. Derived constructors call `callInternal` with an undefined receiver (`:421`). | via `callInternal` |
| Native reentry | `js_engine.silk:135` (`CoercionHooks.call`), `:150` (`CallHooks.callArguments`), `:155` (`CallHooks.construct`) | Every builtin that calls back into JS funnels through these: Proxy traps (`js_proxy_core.silk:226`, `js_proxy.silk:482`), `toString`/`valueOf` conversion (`js_coercions.silk:56`, `:71`), sort comparators (`js_array_intrinsics_order.silk:220` through `compareBody`), getters on the generic property path, bound functions (`js_bound_functions.silk:350`), `Function.prototype.call/apply` from natives. All end in `callInternal` with `COPY_ARGUMENTS`. | via `callInternal` |
| Direct eval | `OP_eval`, `OP_apply_eval` in `instruction` (`js_vm.silk:3930`, `:3938`) then `evaluate` (`:2024`) | When the callee is the realm's `eval` the source is compiled and run by `hooks.evaluateObject` (`:2030`); otherwise it is an ordinary `callInternal` (`:2032`). The eval code itself runs through `js_eval.execute` (`js_vm.silk:3970`): a closure is made and called with `vm.call`. | via `callInternal` |
| Indirect eval, scripts | `js_eval.silk:60-90` | Same `execute`: closure plus `vm.call`. | via `callInternal` |
| Generators, async functions, async generators: the call | `generators.call` (`js_generators.silk:76`), async (`js_async_functions.silk:195`), async generators (`js_async_generators.silk:295`), all reached from `callInternal` through `callClass` (the closure's class is not `JS_CLASS_BYTECODE_FUNCTION`; class callbacks are set in `js_runtime_classes.silk:414`, `:448` and dispatched in `js_builtin_dispatch.silk:254-256`) | Each makes a heap frame with `frames.create` (`js_async_functions_frame.silk:59`, which calls `allocate`, `:37`), then runs it with `frames.resume` up to `OP_initial_yield` or the first `await`. | Yes, in `frames.allocate` |
| Generator and async resumption | `vm.resume` (`js_vm.silk:442`) via `frames.resume` (`js_async_functions_frame.silk:112`) | Not a new activation: it restores pc and sp from the heap frame and runs `dispatch` (`js_vm.silk:546`). `throwing` enters at the unwinder (`:562-563`). | No (see open questions) |
| Modules | `js_module_execution.silk:96` (`callHandled`), `:113` (`callKeepingFrame`) | The module function runs as an async function body (`js_async_functions.silk:167`, `:174`), so it starts through `frames.create` and `vm.resume`. | Yes, in `frames.allocate` |

### Inline entries (no native recursion)

All inline frames are built by one function, `enterFrame` (`js_vm_activation.silk:450`), reached
through:

| Entry | Where | Reached from |
| --- | --- | --- |
| `enterDecoded` | `js_vm_activation.silk:408` | `enterCallWith` (`js_vm.silk:3225`), the common path of `OP_call0..3`, `OP_call`, `OP_call_method` (`js_vm.silk:1898-1907`), getters (`readGetter`, `:3306`, used at `:1635`, `:1654`, `:1666`), setters (`writeSetter`, `:3389`, used at `:1723`) and spread calls (`applyInline`, `:3169`) |
| `enterInline` | `js_vm_activation.silk:371` | `enterAny`/`enterCallee` (`js_vm.silk:3092`, `:3105`): `f.call(...)`, `f.apply(this, array)`, `Reflect.apply`, bound functions up to depth 4, `f.apply(x, arguments)` on a lazy arguments slot (`:3466`), and `constructInline` (`:3626`) for base-class constructors including the `Class.create` forwarder (`:3693-3697`) |
| `enterKnown` | `js_vm_activation.silk:431` | known local functions (`enterKnownCall`, `js_vm.silk:3271`; `callInlineKnown`, `:3429`) |
| `enterIteration` | `js_vm_activation.silk:442` | `iteration.enter` (`js_vm_iteration.silk:138`): `every`, `some`, `forEach`, `map`, `filter`, `reduce`, `reduceRight` called from bytecode run as a frame of synthetic iteration bytecode in the caller's loop; the callback is then an ordinary inline call from that frame |

An inline entry is refused, and the call falls back to a native-stack entry, when the region has
no room (`js_vm_activation.silk:472`) or when an interrupt poll is due (`left <= 1`, for example
`js_vm.silk:3252`, `:3283`, `:3190`): the fallback (`callInline`, `:3444`) polls first (`:3453`).
The hotness prototype counts inline entries in `enterFrame` after the room check, so a refused
entry is not counted twice. `enterIteration` is not counted: its bytecode is synthetic and has
nothing for a compiler.

### Frameless and answered calls (the function's own bytecode does not run as a frame)

| Path | Where | What runs |
| --- | --- | --- |
| Leaf runs (not counted) | `leaves.attempt` (`js_vm_leaf.silk:75`), `attemptKnown` (`:101`); tried in `enterCallWith` (`js_vm.silk:3242-3249`), `enterKnownCall` (`:3274-3280`), `applyInline` (`:3180-3186`) | A small function (`FunctionBytecode.leaf`, decided by `js_bytecode.leafCode`) whose bytecode is evaluated on scratch cells with no frame. A one-line accessor (`LEAF_ACCESSOR`) runs without even that (`js_vm_leaf.silk:83-89`). A leaf may call one more leaf (`Outer.call`, `:824`). A declined run changes nothing and costs the leaf one credit (`miss`, `:64`). |
| Planned constructors | `constructStores` (`js_vm.silk:3549`), `constructPlanned`/`constructRecipe` (`:3746`, `:3765`), `simpleConstruct` and `constructGrowing` in `constructInline` (`:3672-3684`) | `new F(...)` for a constructor whose body is a recognised list of stores: the object is built from a cached plan and the body never runs. |
| Field initialisers | `fieldsPrefix` (`js_vm.silk:3582`) | A class's constant instance fields are defined without calling the initializer. |
| Comparator patterns | `js_array_intrinsics_order.silk:208-218` | `(a, b) => a - b` and `b - a` comparators are recognised and computed without calling the function. |
| Native answers | `quickInline` (`js_vm.silk:2904`), `pushInline` (`:2129`), `nativeInline` (`:2504`), `framelessCall` (`:2538`), `leanCall` (`:2649`), `literalCall` (`:2758`) | Calls of builtins answered in the loop. Not JavaScript bodies, listed because a call site's target can be one of these. |

The hotness prototype counts none of these. Planned constructors, field initialisers and comparator
patterns do not run their bodies. Leaf runs do, but counting them cost up to 0.9 percent of all
instructions on call-heavy benchmarks (measured, see [Measurements](#measurements)), and a leaf is
small, never loops and is the kind of callee a compiler would inline into its hot caller, which is
counted. A leaf that only ever runs frameless from uncounted code is never reported.

### Tail calls

`OP_tail_call` and `OP_tail_call_method` (`js_vm.silk:1899`, `:1901`) go to `callOperation`
(`:3861`), which makes an ordinary native-stack call and then returns its value as the frame's own
(`:3878`). There is no frame reuse: a tail call is a normal entry plus a return.

## Back edges and the interrupt poll

The poll counter is per context (`ContextState.interruptCounter`), read through
`interrupts.counter` (`js_interrupts.silk:28`) once per run (`js_vm.silk:771`). `dueAt`
(`js_interrupts.silk:37`) decrements it and reports due at zero, resetting to
`JS_INTERRUPT_COUNTER_INIT` = 10000 (`:16`). When due, `interrupts.handle` (`:52`) runs the
embedder's interrupt callback and, while observation is on and a plain loop is live, re-forces
polls (`:59-64`). Calls charge the same counter: `callInternal` (`js_vm.silk:254`), the inline
entry paths (`enterCallWith` `:3250-3254`, `enterKnownCall` `:3281-3285`, `applyInline`
`:3188-3192`, refunded on failure, `refund` `:3425`), `callInline` (`:3453`), `constructInline`
(`:3651`, `:3669`), `constructInternal` (`:408`), `resume` (`:446`). Leaf runs are not charged
(`:3240-3242`): a leaf cannot loop.

Back edges in the dispatch loop. Both copies share this source; `observe` decides what each copy
compiles to.

| Opcode | Arm | Poll | Hands off to the observed loop at the poll |
| --- | --- | --- | --- |
| `OP_if_false`, `OP_if_true` | `js_vm.silk:1236-1247` | `displacement < 0 && dueAt`, polled whether or not the branch is taken | yes |
| `OP_if_false8`, `OP_if_true8` | `:1248-1259` | same | yes |
| `OP_goto`, `OP_goto8`, `OP_goto16` | `:1260-1274` | same | yes |
| `OP_if_nullish8`, `OP_if_not_nullish8` | `:1170-1187` | same | yes |
| `OP_if_null8`, `OP_if_not_null8` | `:1189-1207` | same | **no**: these arms poll but do not check `observeInstructions` |
| `OP_fuse_prefix` (184), slot-compare loop fusion | arm `:802`, loop test `:839`, poll at `:890` | `backward && dueAt` | yes |
| Fused compare-and-branch (`OP_lt` etc. with a following `if_true8`/`if_false8`) | `:1434-1519` via `operators.fusedLoopBranch` (`js_vm_operators.silk:421`) | charges the counter itself and declines when a poll is due (`:426-429`), so the `if_*8` arm then polls | via the `if_*8` arm |

In the observed loop `OP_fuse_prefix` answers nothing (`js_vm.silk:808`: the fusions run only
`if !observe`) and fused compare-and-branch is skipped (`observe ||` at `:1434` and following), so
every observed back edge is one of the plain branch arms above. The plain loop moves to the
observed loop only at a poll on an arm with the handoff check (`if !observe && ...
observeInstructions`), and the observed loop moves back at its next instruction once the flag is
clear (`:779`).

Other loops that poll: the Array iteration frame's `goto8 -6` is an ordinary back edge in its
synthetic bytecode (`js_vm_iteration.silk:16`); natives with their own loops poll through
`interrupts.poll` (`js_for_in.silk:448`, `:539`, `js_membership.silk:63`,
`js_object_intrinsics.silk:677`, `:700`); the debugger boundary polls (`js_debugger.silk:332`,
`:341`). `controlInstructions.step` also implements `goto` and `if_*` with an unconditional poll
(`js_vm_control.silk:201-221`), but the dispatch loop handles those opcodes inline and sends only
`throw`, `catch`, `gosub`, `ret` and the iterator opcodes there (`js_vm.silk:1275-1295`); I found no
caller that reaches the jump arms. `OP_ret` (`js_vm_control.silk:234`) jumps backwards to a
`gosub` return address without polling; that cannot form a loop without another back edge.

## How exceptions unwind

- Failures are Silk typed failures (`OutOfMemoryError | StringLengthError | BigIntError |
  JsException`). Each run of `execute` is wrapped once in `Intrinsic.catchFailure`
  (`js_vm.silk:298`, `:366`, `:564`), not per instruction. `execute` leaves pc and sp at the
  failing instruction.
- On failure: `core.materialize` turns the failure into the pending exception
  (`RuntimeState.currentException`), `exceptionBoundary` (`:578`) reports it to the debugger,
  then `unwindFrames` (`:3845`) runs `unwind` (`:489`) on the innermost inline frame and its
  callers in turn, leaving each frame without a handler with `leaveInline`
  (`js_vm_activation.silk:804`), its owned scope and, for a construct frame, its receiver.
- `unwind` builds the backtrace if needed (`:494-505`), records the throw site
  (`noteFirstFrame`, `:476`), gives up on an uncatchable exception (`:509-511`), then pops the
  operand stack releasing each value until a `ValueBits.CatchOffset`. Offset 0 marks a for-of
  iterator, which is closed (`:516-527`); any other offset is a `catch` handler, which gets the
  exception pushed and the pc set (`:529-535`).
- `OP_catch` pushes the `CatchOffset` (`js_vm_control.silk:222-227`); `finally` is `OP_gosub`,
  which pushes the return pc as an `Int` (`:228-231`), and `OP_ret` (`:234`). `OP_nip_catch`
  drops a handler.
- If no frame of this run catches it, `callInternal` releases its frame and fails with
  `JsException` (`js_vm.silk:313-318`): native frames between JS frames are crossed by Silk
  failure propagation, and the next `callInternal` up catches it in its own loop.
- Generators and async frames: `dispatchBody` (`js_vm.silk:558`) starts at the unwinder when
  resumed with a throw (`:562-563`); an uncaught failure leaves `resume` as a failure (`:468-471`)
  after saving pc and sp, and the family caller completes the generator or rejects the promise.
- A JIT frame must therefore either look like an interpreter frame to `unwind` (pc, sp and operand
  stack with `CatchOffset` entries in the same places), or catch failures itself and rebuild an
  interpreter frame at the bytecode boundary of the failing instruction before unwinding.

## What invalidates shape assumptions

- **Shapes and versions.** Every shape has a `version` that no other shape has had
  (`renewVersion`, `js_shapes.silk:422`; counter `RuntimeState.nextShapeVersion`). Hashed
  (shared) shapes are immutable; adding a property moves the object to another shape. Unhashed
  shapes (dictionary objects, globals) change in place and get a new version each time
  (`js_shapes.silk:830`, `:842` in `prepareUpdate`; `:1725` in `deleteProperty`; `:1583` in
  `appendMetadata`; `js_global_bindings.silk:146`; `js_auto_init.silk:69`, `:177`).
- **Prototypes and the epoch.** Objects that are or were a prototype carry
  `OBJECT_ROLE_PROTOTYPE` (`js_core_types.silk:1979`, set by `markPrototype`,
  `js_shapes.silk:402`). Any change to such an object's shape bumps the global
  `RuntimeState.shapeEpoch` (`noteShapeChange`, `js_shapes.silk:415`; `bumpEpoch`, `:496`).
  Callers: adding properties (`swapAdd`, `js_shapes.silk:210`), `setPrototypeOf`
  (`js_prototypes.silk:164`), object spread (`js_copy_data_properties.silk:225`), loss of the fast
  array form (`js_array_storage.silk:620`), global declarations (`js_global_bindings.silk:147`),
  lazy property initialisation (`js_auto_init.silk:70`, `:178`).
- **What the caches check.** The get_field site cache (`RuntimeState.fieldCache`, 4096 entries,
  `FieldCacheEntry`, `js_core_types.silk:919`) keys own properties by shape version and slot;
  prototype properties additionally record the epoch at which the chain last matched and the
  holder (`:928-933`). The polymorphic cache (`polyFields`), typed array length cache
  (`TypedLengthEntry`, `:942`), transition memo (`transitions`, `transitionChains`) and the
  enumeration cache (`enumVersion` vs `version`, `js_shapes.silk:446`) follow the same
  version-plus-epoch rule.
- **Property deletion** goes to `deleteProperty` (`js_shapes.silk:1711`), which makes the shape
  unhashed and renews its version.
- **defineProperty and accessor conversion** change records through `prepareUpdate`
  (`js_shapes.silk:823`), which renews the version of an unhashed shape or moves a hashed one.
  A data property turned into an accessor keeps the same atom but a different slot kind, so a
  cached data read must check the version, not just the atom.
- **Array fast paths** depend on `OBJECT_FAST_ARRAY` (`js_core_types.silk:1973`); conversion to
  a slow array swaps the shape and calls `noteShapeChange` (`js_array_storage.silk:610-621`).
- **What a compiled guard would watch**, by the same rules: the receiver's shape version for own
  properties; the epoch plus the holder's shape version for prototype properties; the fast-array
  flag and length for elements; for globals, the global object's shape version (its shape is
  unhashed, so every declaration renews it, `js_global_bindings.silk:140-147`). The epoch is one
  global counter: any prototype change anywhere invalidates every prototype guard.

## Hotness counting

Prototype added on top of `42b98426`. Nothing compiles anything; the hook only reports.

- **Counter.** `FunctionBytecode.hotness: u32` counts down from `HOT_ENTRY_BUDGET` (`js_hotness`)
  per entry. When it reaches zero, `exhausted` runs out of line.
- **Where it counts.** In `activation.describe` and `describeKnown` (`js_vm_activation.silk:84`,
  `:112`) when called with `counted`: `callInternal` and `callKnown` pass true (`js_vm.silk:266`,
  `:343`), `vm.resume` passes false (`:460`). In `enterFrame` after the region room check
  (`js_vm_activation.silk:577`; `enterDecoded` and `enterKnown` count, `enterIteration` does not).
  In `frames.allocate` (`js_async_functions_frame.silk:47`: generator, async and module calls).
  Leaf runs and generator resumption are not counted. Counting inside `describe`, where the
  `FunctionBytecode` payload is already loaded, was cheaper than a separate call after it
  (measured below).
- **Back edges are not counted.** A per-function back-edge counter would cost on every loop
  iteration in both dispatch loops. A function entered a few times that loops for long (a
  benchmark's main loop) is therefore never reported; that is the OSR case, left open. A cheap
  option for later is to attribute the interrupt poll (every 10000 back edges and calls) to the
  running frame in `interrupts.handle`, which costs nothing on the fast path.
- **The slot.** `RuntimeState.hotFunctions: HostHook` (an embedder `NativeFunctionId` plus opaque
  pointer, as for the interrupt handler), set with `js_runtime.setHotFunctionHandler`. It defaults
  to none.
- **Null slot.** `exhausted` re-arms the budget and returns. The interpreter-only cost is the
  decrement and test per entry plus one out-of-line call every `HOT_ENTRY_BUDGET` entries.
- **Non-null slot.** `exhausted` cannot call the embedder where it runs (the inline paths have no
  hooks), so it parks the function, retained, in `RuntimeState.hotPending`, sets its budget to
  `u32.MAX` and forces a poll in every context. The next poll, at most one call or back edge
  later, delivers it in `interrupts.handle` through `InterruptHooks.hotFunction` (default: nothing)
  and `EngineServices.hotFunction`, then releases it. While one function is pending another that
  runs out of budget keeps a budget of 1 and retries at its next entry, so none is lost. A function
  is reported once, then again only after 2^32 more entries.
- **Ahead-of-time.** The counter is runtime state, not part of the serialized bytecode
  (`js_binary_object_writer` does not write it; the reader initialises it).

## Measurements

All measured on the cloud container, release builds (`silk build --release`), with
`python3 scripts/v8bench.py --instructions BASELINE NEW` (instructions under callgrind, ratio
NEW / BASELINE). Baseline is `42b98426`. Target: under 0.5 percent on every benchmark.

| Benchmark | First placement (`4b5e1da`) | No leaf counting | Count in `describe`, no leaf (`c56dd8d`) | Layout only, no counting (control) |
| --- | --- | --- | --- | --- |
| richards | 1.006x | 0.999x | 0.999x | 0.999x |
| deltablue | 1.009x | 1.000x | 0.999x | 0.996x |
| crypto | 1.000x | not run | 0.999x | 0.999x |
| raytrace | 1.002x | 1.000x | 0.999x | 0.999x |
| earley-boyer | 1.008x | 1.006x | **1.008x** | 1.006x |
| regexp | 1.001x | not run | 1.002x | 1.001x |
| splay | 1.001x | not run | 0.999x | 0.998x |
| navier-stokes | 1.000x | not run | 0.998x | 0.998x |

`c56dd8d` is the committed placement. It is under target on seven benchmarks and over on
earley-boyer (+0.82 percent). Most of that is not the counting:

- The control build has every field the change adds (`FunctionBytecode.hotness`,
  `RuntimeState.hotFunctions` and `hotPending`) but an empty `js_hotness.enter`. It already shows
  earley-boyer at +0.58 percent (measured).
- Callgrind with `--dump-instr=yes` on earley-boyer (measured) puts the extra instructions in one
  call-path function called 532,558 times, about 14 more per call. The hotness decrement is not in
  that function. The difference is a 4-way set probe keyed by an object address
  (`(address >> 4) * 0x9e3779b97f4a7c15 >> 58`): at baseline the first way hits, with the change
  the first two miss. Object addresses moved because `FunctionBytecode` grew.
- Moving the two `RuntimeState` fields to the end of the struct did not change any number
  (measured), so the shift comes from the heap, not from `RuntimeState` offsets.
- The counting alone (control to `c56dd8d`) costs at most +0.34 percent (deltablue), +0.23 percent
  on earley-boyer and +0.13 percent on regexp, under 0.05 percent elsewhere.

This address sensitivity will move with any change to the size of a heap cell, so it is a property
of that cache rather than of this hook (open question 7).

### The receiver cache fix

The cache is `RuntimeState.receiverCache`, the constructor receiver cache, probed by
`js_gc.receiverWay` (64 entries, 16 sets of 4 ways, keyed by the constructor's cell address). On
earley-boyer one constructor (`sc_Pair`, through `js_gc.plannedShape`) is entered 532,558 times. At
`42b98426` it sits in way 0 of its set; once `FunctionBytecode` grew by 8 bytes it sat in way 2,
behind two other constructors of the same set, and every construct paid two missed probes of
136-byte entries: 13 instructions, 6.92 million in all, which is the whole control-build delta
(measured, callgrind `--dump-instr=yes`). Two unrelated 8-byte cell growths on `42b98426`
(`ShapeData`, `VarRef`) left earley-boyer at 1.000x (measured), so the effect is specific to which
address `sc_Pair` gets, not to any growth.

The probe now starts at the set's last hit, so the way a constructor landed in no longer decides
its cost:
- `RuntimeState.receiverFunctions` holds each entry's constructor address apart from the entry
  (`ReceiverCacheEntry.function` is gone), so a set's four keys share one cache line and a probe
  is one compare with scaled addressing.
- `RuntimeState.receiverHints` holds, per set, the way of its last hit. `receiverWay` compares the
  hinted way, then the four ways in order (`otherWay`, inlined), which also moves the hint.
  `refillReceiver` points the hint at the way it fills.
- A miss is returned as the way plus `RECEIVER_MISS`, so callers do not reload the key to learn
  whether the way they got holds their constructor.

`v8bench.py --instructions` against `42b98426`, every variant measured (round-to-round spread of
the baseline under 0.0006 percent). The first three variants sit on `6341d15`, the kept one on
`4bd0ef2`; "Fix without hook" is the kept cache on `42b98426` itself:

| Benchmark | Hook, old cache (`4bd0ef2`) | Packed keys | + hint | + miss in way | + inline fallback (kept) | Fix without hook |
| --- | --- | --- | --- | --- | --- | --- |
| richards | 0.9987x | 0.9987x | 0.9987x | 0.9987x | 0.9987x | 1.0000x |
| deltablue | 1.0002x | 1.0003x | 1.0002x | 1.0002x | 0.9999x | 0.9998x |
| crypto | 0.9998x | 1.0000x | 0.9999x | 0.9998x | 1.0000x | 1.0000x |
| raytrace | 0.9992x | 1.0034x | 1.0026x | 1.0022x | 1.0008x | 1.0021x |
| earley-boyer | 1.0075x | 1.0046x | 1.0008x | 1.0008x | 1.0005x | 0.9991x |
| regexp | 1.0012x | 1.0012x | 1.0012x | 1.0012x | 1.0012x | 1.0000x |
| splay | 1.0008x | 1.0008x | 1.0007x | 1.0007x | 1.0007x | 1.0000x |
| navier-stokes | 1.0000x | 1.0000x | 1.0000x | 1.0000x | 1.0000x | 1.0000x |

Raytrace constructs two constructors of one set in alternation (about 50,000 times each way per
run), so the hint changes on every second construct there; with the fallback out of line that cost
a call each time (the "+ hint" column). The probe itself is shorter than before on every path; the
raytrace delta that remains (+0.16 percent with the hook, +0.21 percent without) moves between
variants that do not touch raytrace's probes. For the packed-key variant callgrind put it in a few
instructions of spills and register moves scattered over the interpreter's construct paths, not in
the probe (measured); the kept variant was not traced that far.

## Open questions

1. Generator and async resumption (`vm.resume`) is not counted. A generator that is created
   once and resumed many times is never reported. Counting resumes in `resume` would be one
   decrement there; not done to keep "entry" meaning "new activation".
2. Whether every inline frame entered while observation is on goes through the observed loop:
   `enterFrame` publishes a debugger activation when `observeInstructions` is set
   (`js_vm_activation.silk:573-588`), but I did not trace every handoff ordering.
3. `OP_if_null8`/`OP_if_not_null8` poll without the handoff check (`js_vm.silk:1189-1207`).
   Probably harmless (other back edges and calls hand off), not confirmed as intended.
4. The jump arms of `controlInstructions.step` (`js_vm_control.silk:201-221`) look unreachable
   from the dispatch loop; not confirmed for every caller of `step`.
5. Whether a JIT frame can be an inline frame (living in the call-frame region and returning
   through `finishInline`) or must be a native-stack frame: depends on how compiled code calls
   back into the loop. Not decided here.
6. Which getters on the generic path (`js_property_get.silk`) reach `callInternal` and which run
   natively without it was not traced exhaustively.
7. Settled: the earley-boyer cost was the receiver cache's probe order (see "The receiver cache
   fix"). Two other address-keyed caches still probe two ways in a fixed order
   (`js_gc.pinConstructed`'s `constructPins` and `js_construct_eval.cacheWay`'s `constructCache`);
   neither showed up in these measurements, but a change that moves cells can still shift their
   hits by one probe.
8. Leaf runs are not counted (see above). If a tier needs leaves reported on their own, counting
   in `leaves.miss`-style credit bookkeeping or sampling at the interrupt poll would be cheaper
   than one decrement per run. Not measured.
