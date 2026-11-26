# Zstandard in Silk: notes

The runtime's Zstandard (`node:zlib` `zstdCompress`, `zstdDecompress`, their streams, and what is
built on them: `fetch` content decoding, `node:zlib/iter`) is the Silk package
[`../zstd`](../zstd), a port of Zstandard 1.5.7. This file records what the pinned standard
library had, why the port exists, what differs from the C library, and what the compiler or the
standard library would have to gain.

Status of each part is in "State" below; it is updated as the work lands.

## What uses Zstandard in this repository

| Consumer | How | Links the C library? |
| --- | --- | --- |
| `node:zlib` (`src/ext/compression_native.silk`) | `ZSTD_createCStream`, `ZSTD_createDStream`, `ZSTD_freeCStream`, `ZSTD_freeDStream`, `ZSTD_CCtx_setParameter`, `ZSTD_CCtx_setPledgedSrcSize`, `ZSTD_CCtx_loadDictionary`, `ZSTD_CCtx_reset`, `ZSTD_compressStream2`, `ZSTD_DCtx_setParameter`, `ZSTD_DCtx_loadDictionary`, `ZSTD_DCtx_reset`, `ZSTD_decompressStream`, `ZSTD_isError`, `ZSTD_getErrorCode`, `ZSTD_getErrorName`, `ZSTD_getErrorString` | yes, before this change |
| `process.versions.zstd` (`src/ext/os_native.silk`) | `ZSTD_versionString` | yes, before this change |
| `node:zlib/iter`, `internal/streams/iter` | JavaScript on the same native binding | no |
| `fetch` / undici content decoding | JavaScript: `zlib.createZstdDecompress` | no |
| `CompressionStream` (`ext/web/compression.js`) | no Zstandard format | no |
| OpenSSL (`../native/openssl`) | built with `OPENSSL_NO_ZSTD`; `crypto/comp/c_zstd.c` compiles to stubs | no |
| TLS certificate compression (`internal/tls/context.js`) | names `zstd` only to reject it: OpenSSL is built without it | no |
| `../pm`, `../engine` | none | no |
| `../benchkit` `offline-deps` | unpacks a prepared `libzstd.a` for networks that block the build's downloads | no longer needed for the runtime |

So the C library goes when `compression_native.silk` and `os_native.silk` stop naming it.

## What the pinned standard library has (0.1.0-dev.87+37fa5f8857de)

| Module | What it is | Finding |
| --- | --- | --- |
| `silk.compress.zstd` + `zstd_block` | A streaming decoder with fixed memory and limits | Correct on every reference frame tried (levels 1 to 19, four corpora). No dictionaries. 10 to 15 times slower than libzstd (text, level 1 frame: 310 ms against 22 ms for 16 MiB). Its errors are its own enum, not the reference's codes. |
| `silk.compress.zstd_encode` | A streaming encoder, levels 1 to 22 | Valid frames that the reference decodes; ratio within about 1% of the reference. Not the reference's bytes (documented as such). 1.6 to 3 times slower at levels 1 to 9, about the same at 19. No negative levels, no dictionaries, no parameters beyond level, window log, checksum and content size, no long-distance matching. |
| `silk.compress.zstd_checksum` | XXH64 | Correct; byte at a time. |

Measured on this machine with a standalone program on the standard library (`ZstdEncoder.encode`,
`Zstd.step`) against the reference `zstd` 1.5.7 command (`--single-thread`), wall time for the
whole process, one run each, while another build was running (so: order of magnitude only):

| Input | Level | Reference compress | Standard library compress | Sizes (ref / std) | Reference decompress | Standard library decompress |
| --- | --- | --- | --- | --- | --- | --- |
| text 16 MiB | 1 | 0.060 s | 0.114 s | 3586529 / 3589525 | 0.022 s | 0.327 s |
| text 16 MiB | 3 | 0.072 s | 0.132 s | 3556326 / 3554032 | | |
| text 16 MiB | 9 | 0.279 s | 0.769 s | 2958410 / 2963394 | | |
| text 16 MiB | 19 | 7.18 s | 8.92 s | 2573306 / 2601015 | 0.050 s | 0.227 s |
| binary 32 MiB | 1 | 0.129 s | 0.334 s | 15873663 / 15888007 | 0.051 s | 0.774 s |
| binary 32 MiB | 9 | 0.905 s | 2.517 s | 11615585 / 11632717 | | |
| binary 32 MiB | 19 | 17.1 s | 18.1 s | 10405461 / 10541206 | 0.074 s | 0.689 s |
| json 12 MiB | 3 | 0.013 s | 0.023 s | 273007 / 266470 | 0.010 s | 0.132 s |

### Why the runtime does not use those modules as they are

The task was to use the standard library where it is right and fast, and to fix a local copy
where it is not. The decoder's slowness and the encoder's different bytes are not local defects:
the decoder decodes Huffman and sequences a symbol at a time through checked slices, and the
encoder is its own design (its own block cutting, match finders and table choices), so making
either match libzstd means replacing its core. The port in `../zstd` is therefore new code that
follows the reference file by file, and the pinned modules were used for comparison and as a
second decoder in tests, not copied. Nothing of it is specific to Node or to SilkJS: the
runtime's adapter is `src/ext/compression_native.silk`, and the package has no dependency but the
C allocator and `memcpy`/`memmove`/`memset`. Whether it should replace the standard library's
modules is the owner's decision (see "Upstreaming").

## State

Everything the runtime asks of Zstandard is the Silk package; `../native/zstd`, which compiled
the C library, is removed, and the runtime links no `ZSTD_*` symbol.

### Verified

| What | How | Result |
| --- | --- | --- |
| Decoder | `../zstd/tests/decode_diff.py`: the bytes, the status and every `ZSTD_decompressStream` call's positions and return value, against libzstd 1.5.7 in the same call pattern; frames of every level, skippable and concatenated frames, window limits, dictionaries, 3000 mutated and truncated frames | 5351 comparisons, 0 differences |
| Compressor, no dictionary | `../zstd/tests/compress_diff.py`: the bytes and every `ZSTD_compressStream2` call's result and positions; levels -131072 to 22, every strategy, parameter overrides and bounds, one-shot and streamed with flushes, windows smaller than the input, checksum, pledged sizes, several frames per context | 2489 cases, 0 failures |
| Compressor, dictionaries | the same with raw, trained and corrupt dictionaries of 1 B to 3 MB, input sizes on both sides of every attach/copy/reload cut-off | 5668 cases, 0 failures (and 2739 one-shot cases identical to Node) |
| Long-distance matching, `nbWorkers` | the ports' own harnesses against a multithreaded build of 1.5.7 | 268 and 371 cases, bytes identical (call traces differ with workers: Differences 1); 371 again on the threaded version (`298ebbe`), 0 failures, and identical to the serial port in 3 runs of each case |
| Runtime against Node 24 | `silk task compat` (`tests/compat.mjs` with `tests/compat-zstd.mjs`: every level on 14 inputs, 120 fuzzed round trips, every parameter's bounds and errors, streams, async, decoding of corrupt input, dictionaries, workers, LDM) | 87 passed, 0 failed (final build, Node 24.22.1; with Node 22 on `PATH` every build, `main` included, fails 12 cases) |
| `node:zlib/iter` | `tests/iterable-streams-smoke.cjs` | ok |

### Measurements

**Final: against `main` at `d197353`** (zlib in Silk, #1277, and the libuv replacement, #1278,
merged in; `main`'s binding now reads input and writes output in place for every codec, which
supersedes this branch's own binding changes, `fce17c9`, `2b78cf1` and `ec34732`, listed under
Found in the runtime's binding). Release builds, interleaved in shuffled order,
`SILKJS_PREPARSE_THREADS=0`, `NODE_OPTIONS` unset, nothing else running.

One-shot with `chunkSize` 8 MiB (`ZSTD_CHUNK=8388608`), which shows the codec; five rounds:

| case | C MB/s | Silk MB/s | Silk/C | C RSS MiB | Silk RSS MiB | sizes C / Silk |
| --- | --- | --- | --- | --- | --- | --- |
| c:binary:-5 | 341.1 | 347.8 | 1.02 | 119 | 120 | 10850964 / 10850964 |
| c:binary:1 | 280.8 | 261.1 | 0.93 | 86 | 88 | 7954313 / 7954313 |
| c:text:3 | 228.2 | 215.8 | 0.95 | 58 | 60 | 3549252 / 3549252 |
| c:text:9 | 47.0 | 38.6 | 0.82 | 76 | 78 | 2958542 / 2958542 |
| c:binary:9 | 38.1 | 24.7 | 0.65 | 98 | 100 | 5996711 / 5996711 |
| c:json:19 | 1.6 | 1.5 | 0.94 | 92 | 95 | 117074 / 117074 |
| d:binary:1 | 425.7 | 406.7 | 0.96 | 122 | 125 | 7954313 / 7954313 |
| d:binary:3 | 403.3 | 403.6 | 1.00 | 122 | 125 | 6816591 / 6816591 |
| d:text:1 | 461.3 | 477.6 | 1.04 | 101 | 105 | 3586493 / 3586493 |
| d:text:3 | 421.7 | 439.1 | 1.04 | 103 | 106 | 3549252 / 3549252 |
| d:json:3 | 939.1 | 967.1 | 1.03 | 89 | 93 | 272294 / 272294 |
| d:binary:19 | 276.4 | 264.8 | 0.96 | 157 | 160 | 5409670 / 5409670 |

The default `chunkSize`, the streams (1 KiB writes), the thread-pool calls (four at a time) and
HTTP (a server compressing each 1 MiB response with `Content-Encoding: zstd`, a client decoding
it with `http.get` into `createZstdDecompress`); three rounds:

| case | C MB/s | Silk MB/s | Silk/C | C RSS MiB | Silk RSS MiB | sizes C / Silk |
| --- | --- | --- | --- | --- | --- | --- |
| c:text:3 | 181.8 | 206.7 | 1.14 | 61 | 64 | 3556322 / 3556322 |
| d:text:3 | 504.9 | 553.9 | 1.10 | 95 | 96 | 3556322 / 3556322 |
| c:binary:1 | 247.4 | 241.3 | 0.98 | 97 | 98 | 7954313 / 7954313 |
| d:binary:1 | 496.3 | 505.2 | 1.02 | 115 | 125 | 7954313 / 7954313 |
| cs:text:3 | 17.9 | 14.4 | 0.80 | 58 | 64 | 655020 / 655029 |
| ds:text:3 | 74.8 | 66.7 | 0.89 | 65 | 68 | 655024 / 655024 |
| cs:binary:3 | 13.3 | 14.2 | 1.07 | 79 | 81 | 1561230 / 1561239 |
| ds:binary:3 | 35.9 | 35.2 | 0.98 | 80 | 83 | 1561234 / 1561234 |
| ca:text:3 | 412.6 | 383.0 | 0.93 | 114 | 119 | 3556321 / 3556321 |
| da:text:3 | 300.0 | 288.2 | 0.96 | 236 | 244 | 3556322 / 3556322 |
| ca:binary:1 | 342.0 | 359.8 | 1.05 | 183 | 184 | 7954312 / 7954312 |
| da:binary:1 | 236.7 | 296.1 | 1.25 | 314 | 318 | 7954313 / 7954313 |
| http:json:3 | 126.6 | 104.3 | 0.82 | 63 | 66 | 97337 / 97337 |
| http:text:3 | 73.0 | 61.9 | 0.85 | 65 | 67 | 194578 / 194578 |
| http:binary:1 | 75.9 | 62.9 | 0.83 | 78 | 81 | 404568 / 404568 |

- Level with the C library: decompression at every level (0.96 to 1.04 at 8 MiB, 0.98 to 1.25
  through the default chunk and the thread pool), compression at levels -5 to 3 and 19 (0.93 to
  1.14).
- Levels 5 to 12 compress at 0.65 to 0.82: the row match finder without prefetch (Compiler
  walls 2; 0.88 to 0.94 with dev.81's prefetch, measured standalone).
- **Open:** the HTTP rows (0.82 to 0.85) and the text streams (`cs:text:3` 0.80, `ds:text:3`
  0.89) are below the C library by more than noise against this `main`. Each HTTP request
  creates a compressor and a decompressor for 1 MiB, and a stream writes 1 KiB at a time, so
  these are dominated by per-context and per-call costs (context creation, table clears) rather
  than by the codec loops. Not yet profiled.
- Peak RSS is within 1 to 10 MiB of the C build in every row.

The measurements below were taken against `main` before #1277, whose binding still copied
inputs and outputs; they explain the investigation and are kept for that.

#### Before merging main (against `main` at the branch point)


Release builds of `main` with the C library (`C`) and of this branch at `298ebbe` (`Silk`),
interleaved in shuffled order, `SILKJS_PREPARSE_THREADS=0`, `NODE_OPTIONS` unset, nothing
compiling; `bench/scripts/zstd.cjs` (one case per process; MB/s of uncompressed data, the median
of the runs of a case, then the median over the rounds; peak RSS of the process). Host noise is
about 8%; it is much more while anything else runs (an earlier pass under a parallel test load
moved single rows by 20 to 30%, and those numbers are not used). The compressed sizes are the
same in every row (the bytes are compared by the tests above).

**One-shot with `chunkSize` 8 MiB** (`ZSTD_CHUNK=8388608`), which shows the codec; five rounds:

| case | C MB/s | Silk MB/s | Silk/C | C RSS MiB | Silk RSS MiB | sizes C / Silk |
| --- | --- | --- | --- | --- | --- | --- |
| c:binary:-5 | 277.8 | 374.2 | 1.35 | 166 | 144 | 10850964 / 10850964 |
| c:binary:1 | 238.5 | 265.0 | 1.11 | 138 | 140 | 7954313 / 7954313 |
| c:text:3 | 185.9 | 219.8 | 1.18 | 127 | 127 | 3549252 / 3549252 |
| c:text:9 | 61.7 | 49.1 | 0.80 | 116 | 112 | 2958542 / 2958542 |
| c:json:19 | 2.2 | 2.3 | 1.05 | 110 | 106 | 117074 / 117074 |
| d:binary:1 | 551.5 | 473.2 | 0.86 | 145 | 141 | 7954313 / 7954313 |
| d:binary:3 | 560.8 | 486.7 | 0.87 | 142 | 138 | 6816591 / 6816591 |
| d:text:1 | 695.6 | 556.2 | 0.80 | 133 | 113 | 3586493 / 3586493 |
| d:text:3 | 715.9 | 543.5 | 0.76 | 133 | 114 | 3549252 / 3549252 |
| d:json:3 | 2042.9 | 2204.5 | 1.08 | 129 | 103 | 272294 / 272294 |
| d:binary:19 | 331.6 | 401.6 | 1.21 | 207 | 195 | 5409670 / 5409670 |

**The default `chunkSize`** (16 KiB), the streams (`cs`, `ds`: 1 KiB writes), the thread-pool
calls (`ca`, `da`: four at a time) and HTTP (a server compressing each 1 MiB response with
`Content-Encoding: zstd`, the client `http.get` into `createZstdDecompress`); three rounds. The
one-shot and thread-pool rows are the binding fix (Found in the runtime's binding, 1), which helps
zlib and Brotli the same way; the 9 more bytes of the `cs` rows are Node's empty trailing frame:

| case | C MB/s | Silk MB/s | Silk/C | C RSS MiB | Silk RSS MiB | sizes C / Silk |
| --- | --- | --- | --- | --- | --- | --- |
| c:text:3 | 13.0 | 195.9 | 15.07 | 115 | 96 | 3556322 / 3556322 |
| d:text:3 | 11.5 | 707.9 | 61.56 | 108 | 106 | 3556322 / 3556322 |
| c:binary:1 | 5.8 | 274.5 | 47.33 | 138 | 119 | 7954313 / 7954313 |
| d:binary:1 | 5.7 | 591.7 | 103.81 | 136 | 121 | 7954313 / 7954313 |
| c:binary:9 | 6.4 | 36.9 | 5.77 | 147 | 128 | 5997161 / 5997161 |
| c:json:9 | 64.8 | 101.5 | 1.57 | 116 | 87 | 277239 / 277239 |
| cs:text:3 | 21.2 | 20.4 | 0.96 | 77 | 71 | 655020 / 655029 |
| ds:text:3 | 88.1 | 85.0 | 0.96 | 77 | 75 | 655024 / 655024 |
| cs:binary:3 | 19.0 | 19.3 | 1.02 | 92 | 86 | 1561230 / 1561239 |
| ds:binary:3 | 44.5 | 45.7 | 1.03 | 92 | 88 | 1561234 / 1561234 |
| ca:text:3 | 12.8 | 382.8 | 29.91 | 295 | 207 | 3556321 / 3556321 |
| da:text:3 | 11.2 | 320.3 | 28.60 | 229 | 254 | 3556322 / 3556322 |
| ca:binary:1 | 5.5 | 419.2 | 76.22 | 368 | 284 | 7954312 / 7954312 |
| da:binary:1 | 5.4 | 292.3 | 54.13 | 292 | 347 | 7954313 / 7954313 |
| http:json:3 | 82.6 | 136.8 | 1.66 | 69 | 64 | 97337 / 97337 |
| http:text:3 | 59.7 | 103.1 | 1.73 | 71 | 67 | 194578 / 194578 |
| http:binary:1 | 52.8 | 91.8 | 1.74 | 86 | 81 | 404568 / 404568 |

- Compression: levels -5 to 3 and 19 are at 1.05 to 1.35 of the C library. Level 9 (row match
  finder, levels 5 to 12) is 0.80: prefetch, which dev.81 has and this workspace cannot use yet
  (Compiler walls 2, measured there at 0.88 to 0.94 with it).
- Decompression: **the level 1/3 gap was the binding and glibc's heap, not the decoder; fixed
  in `ec34732`.** Build of `ec34732` against C, seven interleaved rounds, default malloc
  settings: d:binary:1 0.97, d:binary:3 1.01, d:text:1 1.01, d:text:3 0.96, d:binary:19 1.20
  (and c:binary:1 1.56, c:text:3 1.40). How it was found:
  - The standalone decoder is at 0.95 to 1.01 of libzstd (`tools/dcli`), and callgrind counts
    fewer instructions for the Silk runtime process (715 M against 820 M) with fewer cache
    misses. The difference was system time: minor page faults.
  - With `MALLOC_MMAP_THRESHOLD_=1073741824 MALLOC_TRIM_THRESHOLD_=1073741824` (glibc never
    mmaps a block and never returns the heap top), the build of `298ebbe` decoded at 1.25 to
    1.39 of C on the same cases where it had been 0.76 to 0.87. So the codec was faster, and
    the loss was memory handed back to the system and faulted in again.
  - An allocation tracer (`LD_PRELOAD`, blocks of 256 KiB and more, with their frees) showed
    why the two builds differ: per call, the C decoder holds a 2.4 MB window (`M 2382671`,
    `C 2382545`) across the steps, which keeps the heap top in use; the port needs no window,
    so when the step's large buffers are freed the free top passes glibc's (dynamic) trim
    threshold and is returned. And per call the binding churned large buffers Node's does
    not: the input twice (a JavaScript `slice` and the native copy) and each output chunk
    twice (a native buffer, then JavaScript's `set` into zlib.js's chunk).
  - Fix: the binding copies only the input range from the caller's buffer, and a synchronous
    step decodes straight into the caller's output range, as `node_zlib.cc` does (asynchronous
    steps keep their own buffer, since JavaScript runs meanwhile). Earlier, `2b78cf1`: one
    `memcpy` per input instead of a call per byte.
  - Left: zlib.js's output chunks and the final `Buffer.concat` are allocated the same way in
    both builds, and glibc still returns some of that memory depending on what else the heap
    holds. That makes the fastest cases noisy: d:json:3 decodes 10 to 15 ms of 16 MB per call
    and measured 0.86, 1.01 and 0.82 (json:1) of C in three runs at default settings, while a
    loop of 40 calls gives 6.1 to 8.2 ms a frame against 8.0 to 10.4 for C, and with the heap
    pinned it is 1.75 to 3.0 of C and 1.74 of the build before the fix. A runtime-wide
    `mallopt` (trim and mmap thresholds) would remove this for every module; it is a policy
    for the runtime's owners, not part of this change.
- Peak RSS is equal or lower than the C build's in every one-shot and stream row; `da` is 20 to
  55 MiB higher (four decoders' outputs in flight are external buffers now, freed by the
  collector rather than at once).

### Start-up memory: the function order was stale

An idle start of the runtime (`-e 0`) had 33.8 MiB peak RSS on `main` and 37.5 MiB on this
branch. It was code pages: `tools/startup-order.txt` names the functions a start runs, by the hash
of what each is, for the linker to place together, and only 38 of its 896 names existed in this
branch's executable (it also had gone stale on `main`). Regenerated with `tools/startup_order.py`
(the server list keeps the committed entries this run does not produce, from its profiles of
servers under load), median of 30 interleaved starts and peak RSS:

| Build | Start | Idle peak RSS | HTTP server case peak RSS |
| --- | --- | --- | --- |
| `main`, C library | 5.0 ms | 33.8 MiB | 68.6 MiB |
| this branch, old order | 4.4 ms | 37.5 MiB | 72.2 MiB |
| this branch, regenerated order | 4.0 ms | 19.8 MiB | 63.8 MiB |

Sibling branches will want to regenerate it again after merging; the lists are generated files.

## Compiler walls

Each is reduced to what the port needed. None was worked around with C.

1. **No integer-to-pointer conversion, and pointer offsets only through `Pointer.at`.**
   `zstd` addresses a window as `base + index` where `base` may lie before the buffer (after the
   window slides, or with a dictionary). The port keeps a base pointer and a `usize` index and
   forms `Pointer.at(base, index)` with an index that can be "negative" (wrapped). It works, but
   whether an offset outside the allocation is defined is not stated anywhere.
   Proposed: `Pointer.fromAddress<T>(address: usize) -> ?*mut T` and
   `Pointer.offset<T>(pointer: [*]const T, delta: isize) -> [*]const T` documented as plain address
   arithmetic (no in-bounds assumption).
2. **No prefetch.** The reference prefetches hash rows, the match candidate of the next position
   and, in the decoder, far match sources. Measured cost: the row match finder (levels 5 to 12) is 1.18 to 1.30 times
   the C library's time; the reference itself built with `NO_PREFETCH` is 1.27 times slower at level
   9 (321 to 331 ms against 250 to 256 ms), which accounts for the gap. A dummy read of the row a few
   positions ahead (`rowTouch` in `../zstd/src/zlazy.silk`) brought level 9 from 1.5 to 1.2 times.

   **Fixed upstream, blocked here.** Silk 0.1.0-dev.81+e483585cc453 has `silk.mem.prefetch`
   (`Prefetch.hintMany<T>(pointer, static PrefetchOptions)`, silk-lang/silk#3126). With
   `rowTouch` rewritten as the four hints of `ZSTD_row_prefetch` (the patch is below), the
   compressor's own CPU time on 16 MiB inputs, 5 runs each, interleaved, against the C library
   (`agent-mt/cref`, gcc -O3), with output byte-identical to C in every run:

   | input, level | C (ms) | dev.74, dummy read | dev.81, dummy read | dev.81, prefetch |
   |---|---|---|---|---|
   | binary, 6 | 199–221 | 248–335 (0.71×) | 247–308 | 218–241 (0.91×) |
   | binary, 9 | 338–350 | 385–498 (0.71×) | 424–487 | 378–423 (0.90×) |
   | text, 6 | 141–153 | 169–188 (0.82×) | 167–185 | 156–164 (0.94×) |
   | text, 9 | 223–253 | 283–383 (0.72×) | 307–321 | 269–283 (0.88×) |

   The compiler change alone is worth nothing (third column); the prefetch is the gain. The
   workspace cannot move to dev.81 yet, for two reasons outside this work:
   - `silk-lang/lib-sqlite` at the pinned rev `b633d16` declares `silk-version` dev.74, and a dev
     release builds only packages written for it. lib-sqlite needs a dev.81 revision.
   - dev.81 rejects two foreign declarations of one C symbol with different types (SEM0192):
     `modules/engine/src/js_os_platform.silk:28,30` (`darwinMkdir`/`linuxMkdir`, both `mkdir`),
     `modules/engine/src/js_os_events_platform.silk:21,23` (`poll`), and `uvwasi_host.silk:561,566`
     declaring them again. Those files belong to the engine and libuv work; the fix is one
     declaration per symbol (or the per-OS one under `static if`).
   With a local copy of lib-sqlite bumped, these four errors are the whole build failure.
   Once both are done, bump every `silk-version` (14 manifests; CI reads the root one) and apply:

   ```diff
   +import silk.mem.prefetch { Prefetch, PrefetchOptions, PrefetchAccess, PrefetchLocality, PrefetchCache }
    unsafe fn rowTouch(ms: &MatchState, hash: u32, rowLog: u32) -> u32 {
      let relRow = mem.z(mem.shl32(mem.shr32(hash, ROW_TAG_BITS), rowLog))
   -  ...the dummy reads...
   +  let static options = PrefetchOptions { access: PrefetchAccess.Read, locality: PrefetchLocality.High, cache: PrefetchCache.Data }
   +  let hashRow = unsafe mem.addc(unsafe mem.ro(ms.hashTable), usize.wrappingMultiply(relRow, 4))
   +  Prefetch.hintMany<u8>(hashRow, options)
   +  if rowLog >= 5 { Prefetch.hintMany<u8>(unsafe mem.addc(hashRow, 64), options) }
   +  let tagRow = unsafe mem.addc(unsafe mem.ro(unsafe mem.nn(ms.tagTable)), relRow)
   +  Prefetch.hintMany<u8>(tagRow, options)
   +  if rowLog == 6 { Prefetch.hintMany<u8>(unsafe mem.addc(tagRow, 32), options) }
   +  return 0
    }
   ```
3. **No branch hints.** `LIKELY`/`UNLIKELY` shape the reference's hot loops (sequence execution,
   the lazy parser). `@cold` on a function exists; a hint on a condition does not. Proposed:
   `Intrinsic.likely(condition: bool) -> bool` / `Intrinsic.unlikely`.
4. **A parameter of type reference-to-raw-pointer does not parse** (`current: &mut [*]const u8`
   is read as the start of a slice type). Minimal case:
   `unsafe fn set(target: &mut [*]const u8, value: [*]const u8) -> () { target.* = value }`.
5. **No symbol alias for a foreign function.** Two Silk declarations of one C symbol with
   different parameter lists (a variadic `printf` in a test tool) are rejected, and there is no
   variadic foreign declaration. Only the test tools wanted it.
6. **A function that calls a foreign function is never inlined, and `@inlineAlways` on it is
   ignored without a diagnostic.** The function is emitted `noinline` with a foreign personality.
   Found when a `@features("bmi2")` wrapper around the sequence decoder's body ran the generic
   body: the body called `memmove` for the rare match that reaches into a dictionary. 43.2 M
   instructions for a 4 MB text frame became 37.6 M once the calls went through plain Silk
   wrappers (`mem.copyBytes`, `mem.moveBytes`, `mem.fillBytes`); the C library takes 35.3 M.
   Minimal case:
   ```silk
   unsafe extern "C" fn labs(v: i64) -> i64
   @inlineAlways
   unsafe fn body(a: u64, n: u64) -> u64 {
     if n == 9 { return i64.toU64(unsafe labs(u64.wrappingToI64(a))) }
     return u64.shiftRight(u64.shiftLeft(a, n & 63), (64 - n) & 63)
   }
   ```
   `silk build --emit llvm-ir` shows `define internal ... noinline ... personality ptr
   @__silk_foreign_personality` for `body`; without the `labs` call it is `alwaysinline`.
   Wanted: either inline it (calls that cannot unwind, such as libc's, need no personality), or
   report that the attribute cannot be honoured.
7. **The check server replays stale diagnostics** (silk-lang/silk#3116): `silk check` kept
   reporting an unused import after the file changed; `--no-server` is right.

## Found in the runtime's binding, not in the codec

Seen while measuring the build of `main` with the C library; they are in
`ext/node/internal/compression/handle.js` and `src/ext/compression_native.silk`, which zlib and
Brotli share.

1. **The default chunk size costs about 2 ms per output chunk, for every codec.** 16 MiB of text,
   release build of `main`, `SILKJS_PREPARSE_THREADS=0`:

   | Call | `chunkSize` 16384 (default) | `chunkSize` 1 MiB | Node 24, default |
   | --- | --- | --- | --- |
   | `zstdDecompressSync` | 2308 ms | 74 ms | 48 ms |
   | `zstdCompressSync`, level 3 | 2300 ms | 142 ms | 88 ms |
   | `gzipSync` level 1 + `gunzipSync` | 5193 ms | | 254 ms |

   The time grows with input size times the number of output chunks: `_write()` in `handle.js`
   took a snapshot of the remaining input on every write, and `zlib.js` writes again each time
   the 16 KiB output buffer fills. **Fixed (`fce17c9`):** the native side keeps the unconsumed
   input, and a write of the same remaining range continues from it. 16 MiB, default chunk:
   `zstdDecompressSync` 1411 ms to 36 ms (Node 28 ms), gzip + gunzip 3239 ms to 158 ms (Node
   112 ms), Brotli quality 5 227 ms to 45 ms.
5. **Inputs were copied a byte at a time** (`buffers.loadScalar` per byte) into the job, and every
   output chunk was copied into a new ArrayBuffer. Fixed (`2b78cf1`): one `copyBytes` (a `memcpy`
   for unshared memory), and a mostly full output becomes the result's memory, freed by the host
   finalizer `compression_native.OUTPUT_FREE` (one line in `libs/core/host.silk`).
2. **Node appends an empty frame** (9 bytes; 13 with a dictionary identifier) when a
   `ZstdCompress` stream's last chunk is written after `end()` was called: the chunk goes out with
   `ZSTD_e_end`, then `_flush` asks for `ZSTD_e_end` again and libzstd starts and ends a new
   frame. The binding held a finished compressor back and did not. Fixed in
   `compression_native.silk`.
3. **A rejected Zstandard dictionary** reported "Initialization failed" where Node reports
   "Failed to load zstd dictionary". Fixed in `handle.js`.
4. **Node loses output with `ZSTD_c_nbWorkers` on a stream**: `ZSTD_compressStream2` returns
   before the workers finish and Node's stream stops asking, so the result is cut short or empty,
   depending on timing. The runtime gives the whole frame, and keeps doing so.
6. **Each call copied its input range twice and each output chunk twice** (a JavaScript slice
   plus the native copy; a native buffer plus JavaScript's `set`). Fixed (`ec34732`): the
   arguments of `process` are `[id, input, flush, avail, inOffset, inLength, out, outOffset]`;
   the binding copies `[inOffset, inOffset + inLength)` only, and a synchronous step writes into
   `out` at `outOffset` (bit 2 of the result's `again` word says it did). The iterable streams
   (`streams/iter/compression.js`) pass four arguments and keep the old behaviour.

## Differences from the C library

1. **`ZSTD_c_nbWorkers` >= 1 runs on native threads** (`../zstd/src/zmt.silk`, `298ebbe`): up
   to `nbWorkers` `NativeThread`s, each with its own context, take jobs in order and publish
   finished output every 512 KB so the oldest job flushes while it runs; the calling thread cuts
   jobs, runs long-distance matching and XXH64, as the reference does. The frame bytes are the C
   library's (371 cases), and the same run to run. What each call consumes and returns depends
   on thread timing, as it does in the C library (its own output also varies: one case gave
   5208285 or 5208288 bytes over 15 runs, with or without a final empty block; the port always
   writes 5208288). One wait the reference does not have: a job's input section is not reused
   while a queued or running job still reads it. Without threads, jobs run inline. 48 MB, 4
   workers, wall time: level 3 133 ms (C 127, serial port 267), level 9 497 ms (C 380), level 19
   13.4 s (C 14.1 s); peak RSS equal to C. No ThreadSanitizer exists for Silk; race freedom rests
   on the protocol and the stress and determinism runs.
2. **Row match finder levels (5 to 12) are about 20% slower** than the C library, for want of a
   prefetch (Compiler walls 2: available in Silk dev.81, which the workspace cannot pin yet).


## Upstreaming

No standard library file was copied or changed, so there is nothing to upstream as a fix and no
pull request on silk-lang/silk. The pinned `silk.compress.zstd`, `zstd_block`, `zstd_encode` and
`zstd_checksum` are correct as far as tried; they are slower than the C library and the encoder
does not write its bytes, by design (What the pinned standard library has).

`../zstd` is a complete port of Zstandard 1.5.7 that could replace them: it has no dependency on
the runtime or on Node (only the C allocator and `memcpy`/`memmove`/`memset`), its API is the
reference's (`ZSTD_compressStream2`, `ZSTD_decompressStream`, parameters, dictionaries, error
codes), and its tests compare it with the reference library call by call. Moving it into the
standard library would need its API wrapped in the standard library's style (effects, `Result`,
an `Allocator` in place of `calloc`) and its tests turned into that repository's tests. Whether
to do that is the owner's decision; nothing here depends on it.
