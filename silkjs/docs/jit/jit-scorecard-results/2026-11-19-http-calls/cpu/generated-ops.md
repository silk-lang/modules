# Generated x86-64 code in the order service

With compiled calls enabled on the original HTTP fixture, 1,322 of 3,778 generated-code samples (35.0%) landed in call, entry and resume sequences. Across five service windows this represents 12.1–17.5 µs per order, or 3.47–4.47% of whole-process CPU. The quiet pair measured 15.2 µs per order in these sequences. Native VM and helper execution contributes separately to the cost of crossing the same call boundary. [Per-window results and example disassembly](generated-ops.json) · [Native CPU attribution](README.md)

| Disjoint sequence in calls-on code | Samples |
| --- | ---: |
| Function prologue through six ABI input stores | 633 |
| Select fresh entry or resume | 120 |
| Save live SSA values to the call block | 114 |
| Restore live SSA values from the call block | 232 |
| Load frame and call-block pointer, prepare helper arguments, issue calls and reload ABI registers | 203 |
| Epilogue | 20 |

All 346 live-value transfer samples map to a recorded call-site word and matching resume target. Of these, 277 were at ordinary call or construct sites and 69 at generic interpreter instructions. Identified bytecode sites included 152 samples at method calls, spread across the event emitter, tick processing, HTTP and other modules. A method call may invoke either native or JavaScript code. [Call-site breakdown](generated-ops.json)

A backend experiment worth measuring would retain the caller's native frame across a normal call to a known compiled callee. That path could reuse caller value homes and return directly to the continuation. Guard failure before the call, exceptions, and callee deoptimization each need an explicit recovery path that preserves ownership and executes the call once. The relevant release measurements are call crossings avoided, generated and VM CPU per verified order, and whole-process time.

Two subsequent debugger windows on the same release counted 128 verified orders. At `parserOnBody` PC 54 every `stream.push(b)` entered compiled `Readable.prototype.push` through `CALL_FAST`. The caller passed one argument and the callee expected two. In every case the child yielded on its own four-argument call at PC 48 and the caller returned through the VM, saving and restoring six live values. The second window identified `readableAddChunkPushByteMode` as the nested target with an empty compiled slot on all 64 orders. A separate same-build trace recorded eight deoptimizations in eight runs of that routine before unlinking. An experiment that keeps the nested routine compiled can test how many PC 54 calls then complete in place. [Call-site counts, probe offsets and capture limits](parser-on-body-call.json)

Looking at operands independently, 603 samples landed on reads from the native stack and 449 on writes. SSA value homes accounted for 654 of those. Removing unused ABI saves has little scope here. Across 409 sampled function instances, 2,448 of 2,454 saved input homes have an explicit use somewhere in the body or cold exits. The six unused homes belong to one 92-byte leaf, `debug` in `node:internal/util/debuglog`. Three samples landed on its unused argument-pointer store. [Saved-home audit](generated-ops.json)

All 3,916 generated IP samples, including 138 from the default policy, landed on exact instruction boundaries in the captured executable bytes. Timing interrupts can skid across instructions or control transfers. For example, 246 calls-on samples landed at `push r12`. Their count identifies a busy entry sequence, while the cost of that one instruction remains uncertain. To verify the ledger offline, run `python3 verify_generated_ops.py` with GNU objdump installed. [Sampled offsets and instruction bytes](generated-op-samples.json.gz) · [Verification script](verify_generated_ops.py)
