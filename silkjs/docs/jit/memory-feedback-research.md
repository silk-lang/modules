# JIT memory and feedback research — recovered report

Recovered on 2026-11-16 from the original delegated task. This is the agent's report, not independently reproduced benchmark evidence. Its final worktree-cleanliness uncertainty was resolved during recovery: the research worktree was clean. No memory-model experiment completed. Internal source links refer to the base checkout at `86c3e4db`.

The research is **incomplete**: tool execution repeatedly failed during the release build, so I obtained no benchmark measurements. I cannot report RC totals, instruction shares, cache rates, allocation lifetimes, or opcode frequencies honestly.

I did read both requested READMEs, inspect the ownership and cache implementations, and retrieve the three commits and PR descriptions. Findings below distinguish **code facts**, **historical evidence**, and **inference**. No commits, pushes, or PRs were made. The last successful worktree check was clean; subsequent instrumentation commands had indeterminate execution status, so final cleanup remains unverified.

## 1. Reference-counting cost and what a JIT could elide

**Code facts.** Raw `ValueBits` copies do not change ownership. An owning slot must explicitly acquire a reference when sharing and release it when cleared: [js_value.silk:10](../../modules/engine/src/js_value.silk:10).

The ownership API distinguishes:

- `Value`: affine ownership of one heap reference. `dup` and `retain` acquire another reference; `intoBits` transfers ownership into raw storage; `adoptBits` assumes an existing owned reference.
- `ValueRef`: borrowed bits with a lifetime, without an additional count.
- `lendBits(anchor, bits)`: an unsafe promise that some owner keeps the value alive throughout the anchor’s borrow. The anchor itself need not own that value.
- `lendFor`: the same promise for a caller-chosen lifetime.

See [js_owned_value.silk:11](../../modules/engine/src/js_owned_value.silk:11). Its comment describing `ValueRef` as “one word” is stale relative to the current representation.

`Value.drop` uses deferred release. Strings release through their own path; BigInts can be freed directly; published GC cells reaching zero are queued for draining. Explicit release follows the eager engine path: [js_gc.silk:489](../../modules/engine/src/js_gc.silk:489). That path can enqueue an object and drain its children; it is not merely a decrement.

The count-changing paths inspected include:

| Layer | Operations |
|---|---|
| Primitive | `HeapCell.retain`, `HeapCell.decrement` |
| Raw-value wrappers | `ValueBits.retained`, `decrementReference` |
| Owning wrappers | `Value.retain`, both `dup` forms, `Value.drop`, explicit `Value.release` |
| GC release routes | `releaseDeferred`, `release`, `releaseCompact`, `releaseIfShared`, `releaseHeap`, `releaseHeader`, `releaseObjectHeader`, `releaseLast`, optional-header wrappers |
| Specialized routes | String release and holder adjustment; direct updates in shape transitions, field stores, planned calls, shared-value drops, and object draining |
| Separate semantics | Weak-reference retain/release and collector trial deletion/restoration |

Primitive operations are at [js_heap.silk:505](../../modules/engine/src/js_heap.silk:505). The main release fast paths are at [js_gc.silk:597](../../modules/engine/src/js_gc.silk:597). An instrumentation scheme covering only `retained()` and `HeapCell.decrement()` would miss direct header updates.

**Ownership classification and inference.**

| Operation | Interpreter behavior | Safe JIT opportunity |
|---|---|---|
| Local/argument → operand | Acquires a reference for the operand copy | Borrow while the source slot remains unchanged and alive |
| Operand → local, `put` | Transfers the operand’s ownership; releases the replaced local | Preserve transfer; avoid creating an intermediate owner |
| Operand → local, `set` | Retains because both local and operand remain owners | Borrow the expression result from the destination until that destination can change |
| Captured-variable load/store | Loads retain; stores transfer or duplicate and release the previous value | Borrow only until a call or mutation can replace the captured slot |
| Property load | Ordinary data reads normally retain their result | Borrow during a proven non-reentrant region with a stable owning slot |
| Property store | Transfers or shares the incoming value and releases the replaced value | Elide temporary copies, but retain ownership for values that escape |
| Calls | Caller operands keep callee, receiver, and arguments alive; some callees borrow argument storage | Borrow from caller roots while preserving their lifetime across the call |
| Return | Returned ownership must survive frame cleanup | Transfer an existing owner or acquire/root before its source owner disappears |

Local and captured-variable behavior is explicit in [js_vm_locals.silk:146](../../modules/engine/src/js_vm_locals.silk:146) and [js_vm_locals.silk:245](../../modules/engine/src/js_vm_locals.silk:245). Stack permutations distinguish duplication from movement: [js_vm_values.silk:137](../../modules/engine/src/js_vm_values.silk:137).

Calls already avoid some copying. Activation layout can lend the caller’s argument cells; copied arguments are retained and released separately: [js_vm_activation.silk:72](../../modules/engine/src/js_vm_activation.silk:72), [js_vm_activation.silk:305](../../modules/engine/src/js_vm_activation.silk:305). A JIT should not assume every argument currently incurs an entry retain.

The interpreter also already has explicitly borrowed property fast paths: [js_vm_property_ops.silk:303](../../modules/engine/src/js_vm_property_ops.silk:303). Their contract requires keeping the object alive and running nothing that can invalidate the borrowed value before consumption.

**Hazards.** Keeping the receiver alive does not keep an overwritten property value alive. A getter, proxy, coercion helper, host callback, or ordinary callee can replace the property or captured slot that supplied a borrowed register value. Retaining the receiver alone is insufficient.

The interpreter protects these cases with owned operands and helper-specific retained values. For example, the native-getter path retains the getter across its call: [js_vm.silk:2849](../../modules/engine/src/js_vm.silk:2849). Generic property traversal retains the current object across arbitrary callbacks and reloads its shape afterward: [js_property_get.silk:277](../../modules/engine/src/js_property_get.silk:277).

**Measurements:** unavailable for every requested V8 benchmark. No retain/release totals, nonescaping-pair counts, or counting/freeing instruction shares were completed.

**Recommendation — high confidence in correctness, unmeasured performance:** implement ownership-aware SSA and borrow within proven regions. At reentrant boundaries, preserve an independent owner or explicit root for every live value whose supplying owner can change.

## 2. Memory model for the JIT

**Code facts.** The existing young collector is a young-generation **cycle collector**, not an uncounted allocation nursery. It uses reference counts to distinguish references originating outside the collected generation: [js_gc.silk:1537](../../modules/engine/src/js_gc.silk:1537).

Consequently, suppressing nursery reference counts would invalidate the current collector’s reachability calculation. It requires a different rooting and barrier design, not just a new allocator.

| Candidate | Required changes and consequences |
|---|---|
| **Keep RC; elide compiled counts** | Preserve current heap ownership, deferred destruction, embedding handles, and cycle collection. Add compiler ownership analysis, exception cleanup, and deoptimization ownership reconstruction. Lowest immediate integration scope. |
| **RC plus uncounted young allocation** | Introduce nursery membership/allocation, explicit roots, old-to-young tracking or promotion barriers, promotion accounting, and destruction of native payloads. Audit every heap-edge publication and mutation. Address-based APIs favor nonmoving promotion or stable indirection. |
| **Nonmoving tracing** | Replace trial-deletion reachability with explicit root tracing. Audit native temporaries and embedding handles, register host roots, integrate weak processing, and remove or repurpose count-based uniqueness optimizations. Existing edge visitors and arena membership are useful infrastructure. |

The allocator already maintains arena cell and young-membership metadata: [runtime_memory.silk:135](../../modules/engine/src/runtime_memory.silk:135). Stable addresses are an explicit heap invariant: [js_heap.silk:22](../../modules/engine/src/js_heap.silk:22).

**WebAssembly.** Explicit interpreter slots help, but they do **not** establish that all live JS values are discoverable from frame scanning.

There are counted native temporaries across calls. Generic property traversal, for example, holds a retained native `current` pointer while executing a helper that can call user code: [js_property_get.silk:305](../../modules/engine/src/js_property_get.silk:305). RC currently makes that native owner visible indirectly through the positive count. A tracing replacement needs an explicit root for it. This applies to native builds too; WebAssembly prevents relying on conservative native-stack scanning as a shortcut.

The same issue affects public `Value` handles: affine ownership currently provides lifetime safety without registering every handle in a root table. A tracing design must preserve that API guarantee through registered handles or an equivalent mechanism.

**Finalization and weak semantics.** Native payload destruction currently occurs through immediate/deferred RC and cycle cleanup. Either tracing alternative can delay resource reclamation. JS finalizers and native destructors need separate treatment.

WeakRef targets are explicitly kept alive through a job, independently of ordinary reachability: [js_weakref_intrinsics_storage.silk:167](../../modules/engine/src/js_weakref_intrinsics_storage.silk:167). Registry held values remain strong while targets and tokens remain weak: [js_weakref_intrinsics_storage.silk:39](../../modules/engine/src/js_weakref_intrinsics_storage.silk:39). Those rules must survive a collector change; prompt RC timing is not a replacement for them.

**Inference.** Allocation-heavy Splay and EarleyBoyer are plausible beneficiaries of nursery allocation and reduced child-release traffic. Richards and DeltaBlue may benefit more from eliminating repeated ownership traffic and optimizing property/call paths. Without allocation and lifetime measurements, neither the magnitude nor the ordering is established.

I did not verify the LXR paper during this run and make no published-performance claim about it. The requested migration call-site counts were not completed.

**Recommendation — medium confidence:** begin with RC and compiled count elision. Treat an uncounted nursery as a separate experiment after adding explicit safepoint roots and measuring allocation survival. There is insufficient evidence here to justify replacing RC before the JIT.

## 3. NaN-boxing revert and a globally smaller value

**Historical evidence, retrieved with:**

```sh
git log --all --oneline --grep='NaN-box\|packed-word'
git show -s --format=fuller f27873db 79936933 ae39be70
gh pr view 779 --json title,body,comments
gh pr view 799 --json title,body,comments
gh pr view 802 --json title,body,comments
```

The recorded reason for [PR 802](https://github.com/julia-script/silkjs/pull/802) was throughput regression from unpacking property slots, despite a substantial memory reduction. [PR 779](https://github.com/julia-script/silkjs/pull/779) already acknowledged field-read decode overhead. [PR 799](https://github.com/julia-script/silkjs/pull/799) reduced destruction overhead by examining packed words directly; it did not remove field-load conversion.

Thus the available record supports a performance-motivated revert. I found no discussion identifying correctness failure as its cause. I did not independently reproduce its historical benchmark results.

**Code facts.** The current variants are declared at [js_value.silk:14](../../modules/engine/src/js_value.silk:14). ShortBigInt is deliberately constrained to a signed payload that fits the old packed representation: [js_value.silk:35](../../modules/engine/src/js_value.silk:35).

A global packed representation could use the previous scheme:

| Values | Encoding approach |
|---|---|
| BigInt, Symbol, String, Rope, Module, FunctionBytecode, Object | Distinct reserved NaN tags plus pointer payload |
| Int and CatchOffset | Tagged integer payload |
| Bool, Null, Undefined, Uninitialized, Exception | Tagged immediate payload |
| ShortBigInt | Tagged signed payload |
| Float64 | IEEE bits, canonicalizing NaNs that overlap reserved tags |

Pointer packing requires a supported-address-range invariant. Arbitrary wider virtual addresses cannot silently be truncated. WebAssembly pointers fit, but pointer conversion and numeric behavior still need target-specific validation.

The change reaches beyond property slots:

- SIMD heap detection and bulk copying assume the current discriminant position and value width: [js_value.silk:134](../../modules/engine/src/js_value.silk:134).
- Frame storage and reference-cache placement depend on `Layout.of<ValueBits>()`: [js_vm_activation.silk:74](../../modules/engine/src/js_vm_activation.silk:74).
- Slot access, native signatures, argument arrays, constants, scopes, async frames, and count/tag fast paths require auditing.
- Serialization needs an audit of its logical encoding and raw-layout assumptions; a representation change does not automatically require changing every serialized format.

**Inference.** Globally packed values avoid the old design’s repeated conversion between packed property storage and an unpacked VM value. They reduce value-array traffic and permit a boxed value to occupy one machine register. Specialized JIT values should nevertheless remain unboxed in registers where possible.

The revert establishes that the **mixed representation** was costly for that interpreter. It does not establish that globally packed values would lose, or that a cheaper encoding is impossible.

**Recommendation — medium confidence:** design the compiler with representation-independent value operations now; evaluate a globally packed interpreter prototype before freezing helper and deoptimization ABIs. Do not restore packed property slots alone based on memory savings. The affected-site count and independent A/B measurement remain outstanding.

## 4. Per-function feedback vectors

**Code facts: the background description is incomplete for this checkout.** Own-field reads already use a shape-version/slot key embedded in bytecode; misses refill it or use the runtime side table for prototype cases: [js_vm_property_ops.silk:401](../../modules/engine/src/js_vm_property_ops.silk:401). Field stores also write an inline key: [js_vm_property_ops.silk:1595](../../modules/engine/src/js_vm_property_ops.silk:1595).

The inspected runtime inventory includes:

| Cache | Key and validity |
|---|---|
| Inline field key | Bytecode operand location; receiver shape version and slot |
| `fieldCache` | Direct-mapped bytecode address; checks site, shape versions, and prototype validity |
| `typedLengthCache` | Typed-array class; receiver version, epoch, holder slot, getter identity |
| `instanceCache` | Constructor shape version and prototype slot |
| `receiverCache` | Constructor address/version, prototype slot, cached shapes and constructor plan |
| `literalCache` | Literal bytecode site; owns a resulting shape |
| `constructCache` | Constructor code address and base shape/version; recipe, final shape, chain validity |
| `transitions` / `transitionChains` | Base address/version, atom, flags; target and prototype-chain validity |
| Shape-retention/reuse tables | Construct pins, retired shapes, empty shapes, closure shapes, spare cells |
| RegExp caches | Standard-layout proof and compiled pattern/flags/program storage |
| String/conversion caches | Join pieces/result, integer strings, unit strings, last text-number conversion |
| Parser caches | Identifier entries, preparser stamp arrays, stack-analysis scratch |
| Context caches | Builtin shapes, RegExp exec slot proof, iterator/spread slot proof |

Layouts and capacities are in [js_core_types.silk:685](../../modules/engine/src/js_core_types.silk:685); field-entry layout starts at [js_core_types.silk:829](../../modules/engine/src/js_core_types.silk:829). Context caches start at [js_core_types.silk:1054](../../modules/engine/src/js_core_types.silk:1054).

The field side table masks the site address to select an entry: [js_core_types.silk:892](../../modules/engine/src/js_core_types.silk:892). A different colliding site can overwrite it. Prototype hits use `shapeEpoch` to avoid repeating a chain walk, while version changes protect against changed layouts.

This is **not a completed exhaustive inventory**: individual associativity, eviction, invalidation, and opcode-user audits remain unfinished.

**Proposed design—inference.**

Give `FunctionBytecode` an optional mutable feedback allocation, excluded from serialization. Build immutable descriptors from bytecode offsets to feedback indices; allocate mutable slots when execution becomes warm. This supports read-only/shared bytecode without rewriting it.

| Slot kind | Feedback and compiler use |
|---|---|
| Property load/store | Receiver versions, slot indices, own/prototype distinction, chain validity; select direct access and guards |
| Call/construct | Target identities and polymorphism; inline or specialize dispatch |
| Arithmetic | Operand/result type sets and exceptional observations; select integer, floating-point, or generic operations |
| Element access | Array/storage kinds, holes, index types, typed-array observations; specialize addressing and bounds checks |
| Comparison | Operand types; select numeric/string/reference comparison |
| Branch | Saturating taken/not-taken counts; guide layout and optimization priority |

Target identities should preferably be weak observations, cleared before reclamation. Any strongly owned templates or shapes must participate in RC and cycle tracing. Numeric versions alone do not make a cached raw holder pointer safe after collection. Shape invalidation must cover generated-code dependencies as well as feedback slots.

Feedback candidates include named and indexed loads/stores and their fused forms, calls and constructors, arithmetic/coercion operators, comparisons, `instanceof`, and conditional branches. Dynamic frequency rankings were not measured.

To preserve interpreter speed, introduce vectors for compiler consumption first, retaining existing interpreter fast paths. Migrate one cache family at a time only after fixed-workload instruction and memory-traffic comparisons. Moving every own-field hit into another allocation could regress the current inline-key path.

**Recommendation — high confidence in architecture, unmeasured performance:** use per-function mutable vectors with immutable offset descriptors. Start with call/type feedback and compiler consumption; migrate field caches only after measuring both existing field-cache layers.

## Undetermined results and settling experiments

- **RC totals and short-lived pairs:** build counters covering primitive and direct header updates; run the fixed workloads generated by `scripts/v8bench.py`. Track ownership tokens or operand provenance to distinguish nonescaping temporaries from address-matched pairs.
- **Instruction share in counting/freeing:** run an uninstrumented release binary under Callgrind. Inline counting must be attributed from instructions or source-aware instrumentation; function totals alone undercount it.
- **Allocation survival:** record logical object births, reuse, deaths, and collection boundaries. Separate death before any collection from death before a young collection.
- **Cache rates:** count inline-key hits/refills separately from side-table hits, misses, and actual cross-site replacements; run the full V8 suite and `bench/macro/parse.js`.
- **Opcode heat:** count dispatches and separately account for instructions consumed by fused paths. Dispatch counts alone are not semantic bytecode counts.
- **Migration scope:** count call expressions and layout dependencies with explicit inclusion rules; distinguish mechanical rewrites from semantic rooting/barrier audits.
- **Collector choice:** prototype explicit roots and a nursery, then compare instruction counts, allocation traffic, peak memory, and collection pauses.
- **Global packed values:** compare complete representations, including helper boundaries and destruction, against the current release build.
- **Workspace state:** inspect `git diff` and restore any throwaway instrumentation before using this checkout for production work. Tool failures prevented that final verification.
