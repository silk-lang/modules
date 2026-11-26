# silkjs-jit

Foundations for an optional native JIT, kept apart from the engine. The engine and the runtime do
not import this package, so an interpreter-only build never compiles it.

It does not compile JavaScript yet. What exists is listed below; everything else is not there.

| Module | What it holds |
| --- | --- |
| `code_memory` | W^X executable memory for Linux x86-64: reserve a range, write code into whole pages, publish them as executable, free them |
| `asm_x64` | An x86-64 encoder: typed registers and memory operands, labels, relocation records, and linking at a chosen address |

Only Linux x86-64 compiles. Every other target stops with a compile error: Linux arm64 (needs an
instruction-cache flush), macOS arm64 (needs `MAP_JIT`) and Windows are not implemented or tested.

## Running the tests

From the repository root:

```sh
silk test --manifest-path modules/jit/silk.toml
```

The tests read `/proc/self/maps` to check page protections, so they need Linux `procfs`.

`src/asm_x64_fixtures.silk` is generated: `scripts/encodings.py` pairs each encoder call with the
Intel-syntax instruction it must produce, has `llvm-mc` assemble the instructions, and writes the
bytes as the expectation. The checked-in tests therefore need no LLVM. After changing the encoder
or the case list:

```sh
SILK_CLANG=/path/to/clang python3 modules/jit/scripts/encodings.py           # rewrite the fixtures
SILK_CLANG=/path/to/clang python3 modules/jit/scripts/encodings.py --check   # fail if they are stale
```

`llvm-mc` is `$LLVM_MC`, else the one beside `$SILK_CLANG`, else the one on `PATH`. The fixtures
were generated with LLVM 22.1.8.

## Executable memory

`CodeMemory.reserve` reserves address space with no access. `allocate` returns a `CodeWriter` that
owns whole read-write pages; `append` copies bytes in without handing out a writable pointer.
`finish` consumes the writer and returns a `CodeBlock` whose pages are read-execute: pages the code
did not reach go back to the region, and the rest of the last page is filled with `int3`. Dropping
a writer or a block removes all access to its pages, returns their physical memory to the kernel
and makes them reusable. A block keeps the region mapped after its `CodeMemory` has dropped.

No page is writable and executable at the same time, and a page has one owner, so publishing one
block cannot change another writer's protection. The price is that every block takes at least one
page (4 KiB): a compiler that emits many small functions must put several in one writer, and then
frees them together. Whether that, or a different scheme such as a dual mapping, gives the better
memory and publish cost is not measured yet.

All owners of one region must stay on one thread; the bookkeeping is not synchronized.

## The encoder

`Assembler` appends instructions to a byte list. It covers what a first compiler needs: integer
moves, loads and stores of 1, 2, 4 and 8 bytes, `lea`, `push`/`pop`, the eight two-operand
arithmetic operations with register, constant and memory operands, `test`, `imul`, `not`, `neg`,
`mul`, `div`, `idiv`, shifts and rotates, `setcc`, `cmovcc`, SSE2 scalar doubles with their
conversions, and jumps, calls and returns. Operand widths are 32 and 64 bits. It has no AVX, no
8-bit or 16-bit arithmetic, no string instructions and no atomics.

Jumps and calls to a `Label` always use a 32-bit displacement; `finish` fills them in and fails
on an unbound label. References to anything outside the code (`movSymbol`, `callSymbol`) become
`Relocation` records naming a symbol number, and `Code.link(base, addresses)` writes the addresses
in. Until then the bytes do not depend on where they will run or on any process-local pointer, so
the same `Code` can be linked at another address or stored and linked later.

`argument` and `isCalleeSaved` describe the System V AMD64 C calling convention. Nothing else of
an ABI is here: no frame layout, no prologue or epilogue helper, no register allocator.

## Calling generated code

Calling a block is unsafe and uses the platform C ABI. Read the entry address as an
`extern "C" fn` through `Pointer.read`, as `call` in `src/code_memory_tests.silk` does. The block
must outlive every call and every function pointer made from it. Generated code must preserve the
callee-saved registers and keep the stack aligned. There is no unwind metadata and there are no
stack maps: Effects, failures and garbage-collector scans cannot cross a generated frame.
