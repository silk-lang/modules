# zlib in Silk

Since the composable runtime merged, these files are the compression package's: `src/stdlib_copy` and
`src/ext/zlib_stream.silk` below are `compress/src/stdlib_copy` and `compress/src/ext/zlib_stream.silk`.

`node:zlib` (deflate, inflate, raw deflate, gzip, gunzip, unzip, `crc32`) runs on Silk code. No
zlib C is compiled or linked: `modules/native/zlib` is gone, and `nm build/silkjs` has no zlib
symbol. Zstandard and Brotli are as they were.

| Layer | File | What it holds |
| --- | --- | --- |
| Codecs | `src/stdlib_copy/compress/deflate.silk`, `inflate.silk` | Local copies of the standard library's `silk.compress.deflate` and `silk.compress.inflate` (Silk 0.1.0-dev.87+37fa5f8857de) with the changes listed below. Nothing in them is specific to Node or SilkJS. |
| Adapter | `src/ext/zlib_stream.silk` | zlib's calling convention over the codecs: window bits that choose a format, gzip or zlib by the first two bytes, zlib's status codes and message texts, the gzip operating system byte. |
| Binding | `src/ext/compression_native.silk`, `ext/node/internal/compression/handle.js` | The zlib kinds call the adapter where they called C, and write in place (see "The binding"). |

**The local copies are temporary, and this is the one open follow-up.** The changes are merged
upstream in [silk-lang/silk#3122](https://github.com/silk-lang/silk/pull/3122) (commit `252b301`
on Silk's `main`, 2026-11-16); the newest Silk release when this branch merged, 0.1.0-dev.81,
predates it. Once a Silk release contains it: move `silk-version` to that release, delete `src/stdlib_copy`, point the imports in
`src/ext/zlib_stream.silk` (and `tests/zlib-differential/build.sh`) back at
`silk.compress.deflate` and `silk.compress.inflate`, and run `tests/zlib-differential` and
the zlib cases of `silk task compat` again.

## Who else used zlib

Checked at main `df9c30b`. Only the runtime's own binding linked against it.

| Possible consumer | Finding |
| --- | --- |
| `src/ext/compression_native.silk` | The only caller: `deflateInit2_`, `deflate`, `deflateParams`, `deflateReset`, `deflateSetDictionary`, `deflateEnd`, `inflateInit2_`, `inflate`, `inflateReset`, `inflateSetDictionary`, `inflateEnd`. |
| `src/ext/os_native.silk` | `zlibVersion`, for `process.versions.zlib`. It now says `1.3.2.1-motley-285e94b`, as Node 24 does: the zlib whose bytes the Silk code reproduces (see "Compressed bytes"). |
| `zlib.crc32` | Already `silk.compress.checksum` before this change. |
| OpenSSL (`modules/native/openssl`) | Built with `OPENSSL_NO_ZLIB` (`generated/include/openssl/configuration.h`); `crypto/comp/c_zlib.c` compiles to stubs. |
| nghttp2, libuv, Zstandard, Brotli | No reference. |
| WAMR (`vendor/wamr`) | No reference. |
| SQLite (`db-sqlite` of lib-sqlite) | No zlib option in its manifest (no `zipfile`, `sqlar` or `SQLITE_HAVE_ZLIB`). |
| Package manager (`modules/pm`) | Unpacks tarballs with `silk.compress.inflate` of the standard library (`pkg/store.silk`), never the C zlib. It does not use the local copies. |
| Engine (`modules/engine`) | `intl_zone_name.silk` uses `silk.compress.inflate` of the standard library. |
| fetch/undici content decoding, WebSocket permessage-deflate, `CompressionStream` | JavaScript over `node:zlib`, so they follow the binding. |

The link is the proof: the executable links with the package removed.

## What the standard library already had

`silk.compress.deflate` (3,551 lines) and `silk.compress.inflate` (2,088 lines) of the pinned
release, plus `silk.compress.checksum` (CRC-32, Adler-32).

- **Deflate:** an encoder modelled on zlib: levels 0 to 9, the five strategies, window bits 8 to
  15, memory levels 1 to 9, all six flush modes, preset dictionaries, `reset`, a change of
  parameters, raw, zlib and gzip framing, steps with any input and output lengths. Its Huffman
  tree code (`trees.c`) already produced zlib's blocks. Its own documentation said: "The bytes are
  a valid stream but are not the same bytes that zlib writes."
- **Inflate:** a decoder of its own design (64-bit bit buffer, a fast loop with unaligned 8 and 16
  byte copies and a BMI2 variant), raw, zlib and gzip with several members, preset dictionaries,
  limits, steps with any input and output lengths. One coarse error kind per class of failure.
- **Missing for Node:** zlib's bytes; zlib's exact accounting of consumed and written bytes per
  call; zlib's error causes (the message texts); window bits for inflate; stopping at the end of
  one gzip member; `Z_BLOCK` for inflate; the gzip operating system byte.

## Changes to the copied files

Each is generic: it makes the codec match zlib 1.3.1, or adds an option that zlib (or
Chromium's zlib) has.

### `deflate.silk`

Found with a differential fuzzer against zlib 1.3.1 (below). Before these changes the first
mismatch came within a few scenarios; after them none in the runs recorded under "Verification".

| # | Change | Why |
| --- | --- | --- |
| D1 | `step` follows zlib's `deflate()` call for call: zlib's `last_flush` (with "never" and "output was full"), the rank test for a repeated flush, the header and trailer flushes, and a `FINISHING` phase for a last block that is written before the trailer. | The encoder wrote the trailer and counted flushes its own way, so consumed and written bytes per call, and sometimes the bytes, differed. As in zlib, a `Sync` or `Full` flush whose output fills can now write its marker again (zlib documents this; give more than 6 bytes of room). |
| D2 | Level 0 is zlib's `deflate_stored`: stored blocks go straight to the output, and their lengths depend on the room there. | The old level 0 cut 32 KiB blocks through the window; every level 0 stream differed from zlib's. |
| D3 | `flushBlock` reports "the output has room" as zlib's `FLUSH_BLOCK` tests it, and lazy matching returns after a literal when the output is full. | The encoder consumed more input in a call than zlib does when a block exactly filled the output. |
| D4 | `setDictionary` is zlib's `deflateSetDictionary`: it goes through the window fill, hashes every position, takes the tail of a long dictionary, adds to the dictionary id, and is allowed mid-stream for raw. The zlib header sets the dictionary flag when the window holds bytes, not when the method was called. | Different hash chains gave different matches; an empty dictionary set the flag. |
| D5 | `setParameters` follows `deflateParams`: the block is ended only when the strategy or the kind of level (0, 1 to 3, 4 to 9) changes and a step ran before; the hash is slid or cleared when leaving level 0. | The encoder ended a block on every change, and left stale hash chains after level 0. |
| D6 | The window slide moves only the bytes up to the end of the data, as zlib's `fill_window`. | The longest match can read past the data; what stays there must be what zlib leaves, or matches differ at the end of the input after a slide. |
| D7 | `longestMatch` starts from the previous length as it is, with no lower bound of 2. | After a change from lazy to greedy matching the previous length can be 0, and zlib then also compares the byte before the candidate. |
| D8 | The RLE strategy clears the match length on each pass. | A later change of strategy starts from it (zlib sets `match_length = 0`). |
| D9 | `Encoder.setGzipSystem(code)`: the operating system byte of the gzip header, 255 by default as before. | zlib writes its build's system (3 on Unix, 19 on macOS); the adapter sets it. |
| D10 | `reset` keeps the match start and sets the dictionary id to 1 (Adler-32 of nothing). | As `deflateReset`. |
| D11 | The match search reads through pointers after proving once that its reads are in the window, and compares 8 bytes at a time; the hash insert is inlined and goes through one slice per table. | Speed. After D1–D10 the encoder ran at 0.80–0.95 of zlib's throughput; callgrind, 2 MiB of text at level 6: 948M instructions, zlib 489M. After: about 580M, and 1.04 of zlib's throughput on average. A vectorized hash slide (`u16x8.saturatingSubtract`) was tried and measured no better, so it was not kept. |
| D12 | `Options.hash`: `Hash.Rolling` (zlib's hash, the default, as before) or `Hash.Multiplicative`, the hash of Chromium's zlib (`insert_string.h` with `chromium_zlib_hash`): the 4 bytes at a position as a little-endian `u32`, times 66,521, plus 66,521, shifted right by 16 and masked. With it, as in Chromium: at least 15 hash bits whatever the memory level, the window is allocated zero-filled with 16 bytes of padding, and the window fill inserts positions while more than 3 bytes are there. The adapter asks for `Multiplicative`. | Node 24 builds Chromium's zlib, so this is what gives Node's bytes. It is also cheaper than the rolling hash: one multiply per position and no dependency on the previous position's hash. Chromium's other deflate changes (the CRC-32 based hash it uses with SIMD, which Node's build does not enable; a `longest_match` that skips a compare it proves is equal) leave the bytes as they are. |

### `inflate.silk`

| # | Change | Why |
| --- | --- | --- |
| I1 | `ErrorDetail` and `Decoder.failureDetail()`: the cause of a failure with zlib's granularity (18 causes; `ErrorKind` is unchanged). | Node reports zlib's message ("invalid stored block lengths", "invalid distance too far back", ...). One kind covered several. |
| I2 | Headers are checked in zlib's units and order: the two zlib header bytes together (check, method, window), the gzip magic as two bytes, method with flags; a dictionary id is read before its absence is reported. | With one byte of input the decoder failed where zlib waits for the second; the cause differed for some headers. |
| I3 | `Decoder.setWindowBits(bits)`, as `inflateInit2`: a match reaches `1 << bits` bytes of earlier output plus all output of its own step; a zlib header naming a larger window fails; 0 takes the header's. Unset, the old strict behaviour stays. | Node passes `windowBits` to inflate; "invalid window size" and "invalid distance too far back" depend on it. |
| I4 | `Decoder.setMemberStop(true)`: a gzip decoder finishes at the end of the first member and leaves the rest unconsumed. | zlib returns `Z_STREAM_END` there; Node decides about the next member itself. Before, the decoder waited for more input or the final input. |
| I5 | `Decoder.setBlockStop(true)`: a step returns at the start of each block. | `Z_BLOCK` for inflate. |
| I6 | A literal that meets a full output is consumed and held (`PHASE_LITERAL`); the distance of a match is checked when the copy has room, and again when a later step continues it. | zlib decodes before it looks for room, so the input consumed when the output fills is the same now; and an invalid distance is reported in the same call as zlib reports it. |
| I7 | A dynamic block with more than 30 distance codes fails (`SymbolCounts`); a repeat is checked after its extra bits are there; a code-length code with no lengths at all reads as zlib reads it. | Same accept, reject and "need more input" as zlib on damaged data. |
| I8 | A final input that ends inside a header unit whose first bytes already prove it wrong fails with that cause, not `TruncatedInput`; a zlib header with both a bad check and a bad method keeps the kind `UnsupportedMethod` (the detail is zlib's `HeaderCheck`). | The standard library's own corpus (`streaming-inflate`, `http-content-decoding`) relies on those kinds; with I8 it passes unchanged. |

## The binding

The C binding copied the input into the native side and the output back one byte at a time,
and for a stream it copied the whole remaining input again for every output chunk (quadratic
in the input over the number of chunks). That cost more than the codec. Now:

- `write` (op 8) takes the input and output buffers with their offsets, as Node's
  `handle.write(flush, in, inOff, inLen, out, outOff, outLen)` does, and loops in native code
  while zlib asks for more room, as Node's `ZlibContext` does. A sync write reads and writes the
  engine's buffers in place and returns the consumed and written counts through a shared
  `Uint32Array(2)`, like Node's `writeResult`.
- An async write on the thread pool reads in place only from ranges of 64 KiB or more
  (`LEASE_MINIMUM`), and copies smaller ones. A lease calls the engine's `refresh`, which walks
  every live view (O(views)), so a stream of 1 KiB writes with thousands of live buffers spent its
  time there.
- An async zlib write of at most 4 KiB of input into at most 64 KiB of output runs on the main
  thread (`internal/compression/handle.js`), and its callback comes on a later turn of the loop
  (an Immediate) inside the handle's `ZLIB` resource. The thread pool's round trip cost more
  than such a write: 35 to 45 microseconds per hop on the measuring host, against a few
  microseconds of codec work for 1 KiB. The bounds keep main-thread time to a few hundred
  microseconds at worst. Larger writes, Brotli and Zstandard go to the thread pool, as in Node,
  and so does every write while an async hook is installed, so that hooks see the resources
  Node creates (no extra Immediate). Compat case `zlib-small-async-write-context` checks the
  async context, the error path and that the callback is still asynchronous.
- Each handle has one `AsyncResource('ZLIB')`, as Node's handle does, instead of one per call.
- `zlib.crc32` (op 9) reads its input in place.
- `params()` on a gzip stream changes nothing, as in Node: its `ZlibContext::SetParams` calls
  `deflateParams` for DEFLATE and DEFLATERAW only. The C binding called it for gzip too, so a
  gzip stream with `params()` had other bytes than Node's.

## Compressed bytes

**Node 24's bytes.** Node builds Chromium's zlib (`process.versions.zlib` is
`1.3.2.1-motley-285e94b`), which hashes differently from zlib 1.3.1: 697 of the 1,089 cases of
`tests/fixtures/zlib/bytes.cjs` differ between Node 24.22.3 and zlib 1.3.1, so the runtime with the
C zlib 1.3.1 never had Node's bytes either. The first version of this branch matched zlib 1.3.1;
it was then decided to match Node instead, with D12. Behaviour that does not depend on the hash
(status codes, messages, accounting, inflate) is the same in both zlibs.

- `silk task compat` case `zlib-compressed-bytes-matrix`: the 1,089 cases (levels, strategies,
  window and memory levels, dictionaries, chunk sizes, flushes, parameter changes, resets, with the
  lengths of the emitted chunks, and the gzip operating system byte) against the reference Node.
  The test against digests of zlib 1.3.1 (`tests/zlib-bytes-smoke.cjs`) is gone.
- `tests/zlib-differential` builds Node's zlib from `deps/zlib` at v24.22.3 (35 files, pinned by
  SHA-256 in `node-zlib.sha256`) with the defines of Node's x64 build, and checks the encoder with
  `Hash.Multiplicative` against it, call by call. `Hash.Rolling` is still checked against zlib
  1.3.1. Node's build is deterministic: it does not pick a hash by CPU.

## Verification

Last run on the final code, branch `feature/zlib-silk`, Linux x86_64:

- Differential fuzzers (`tests/zlib-differential`), comparing status, message, consumed, written
  and bytes per call:
  - against zlib 1.3.1 over the course of the work: deflate 90,000 scenarios, inflate 180,000;
  - after the Chromium hash (D12), against Node 24's zlib: deflate 54,000 scenarios;
  - with `Hash.Rolling` against zlib 1.3.1: deflate 29,000;
  - inflate: 3,000 against Node's zlib and 5,000 against zlib 1.3.1.
  - 0 mismatches. The harness does tell the hashes apart: the rolling hash against Node's zlib
    mismatches within the first 200 seeds.
- `silk task compat` against Node 24.22.3: 81 passed, 0 failed. That is the 75 existing cases
  and six zlib ones: the behaviour matrix, three fuzz seeds, the compressed-bytes matrix (1,089
  cases equal to Node's bytes) and the small async write case.
- `tests/ws-native-smoke.cjs` and `tests/web-boundaries-smoke.cjs`: pass.
- `nm build/silkjs`: no zlib symbol. The executable is 70 KB larger than with the C zlib.
- After merging `main` at `14973b6` (the libuv replacement included): `silk task compat` 81
  passed, 0 failed, and both smoke tests pass. `tools/zlib_bench.py`, `main` against this branch,
  three rounds: every one of the 100 zlib cases is faster on this branch (2.4 to 224 times; the
  smallest gains are 1 KiB streams, the largest one-call inflate, where `main` copies byte by
  byte), `gzip-http` serves 1.43 times the requests per second, and peak RSS is lower in every
  measured case (0.67 to 0.96) or equal (`gzip-http`, 1.02).

## Performance

`silk task build --release` of this branch against Node 24.22.3 (the official Linux x64 build),
run in turns, median of three rounds, `bench/scripts/zlib.cjs` (4 MiB of text, JSON and random
bytes, 16 MiB of an executable; levels 1, 6 and 9; gzip and raw; one call, and 1 KiB stream
writes). Ratio is SilkJS throughput over Node's; host noise is about 10%.

| Group | Cases | Min | Median | Max |
| --- | --- | --- | --- | --- |
| deflate, one call, text/JSON/binary | 18 | 0.78 | 1.05 | 1.17 |
| deflate, one call, random | 6 | 0.84 | 0.88 | 1.00 |
| inflate, one call, text/JSON/binary | 18 | 1.08 | 1.23 | 1.71 |
| inflate, one call, random | 6 | 0.74 | 1.01 | 1.30 |
| deflate, 1 KiB writes | 24 | 1.74 | 2.15 | 3.10 |
| inflate, 1 KiB writes | 24 | 1.60 | 1.90 | 2.38 |
| crc32 | 4 | 3.58 | 4.29 | 4.81 |

Geometric mean over the 100 cases: 1.56. Before this work, with the C zlib 1.3.1 and the old
binding, the same runs were below Node almost everywhere. The binding copied input and output a
byte at a time, and copied the remaining input again for every output chunk.

- **Codec** (`tests/zlib-differential/bench_codec`, against Node's zlib built with gcc `-O2` and
  Node's defines): deflate 0.89–1.31 on real data and about 0.97 on random and binary data;
  inflate 1.35–2.7 (0.74–1.09 on random data, where both only copy stored blocks; libc's AVX
  `memcpy` copies faster than the Silk loop).
- **Below Node:**
  - deflate of incompressible data, one call: the encoder still runs about 20% more instructions
    per position than zlib's `deflate_fast` there (311M against 254M for 2 MiB at level 1), mostly
    loads and stores of encoder fields that LLVM keeps in memory;
  - inflate of random data in one call: noisy across runs. A direct measurement of
    `inflateRawSync` on 4 MiB of stored data gives 1,368–1,460 MB/s against Node's
    1,159–1,329.
- **Streams of small writes** are faster than Node because of the inline path (see "The binding"):
  per 1 KiB write, a thread-pool round trip here costs about 40 microseconds in either runtime.

Earlier measurements against zlib 1.3.1 (the codec before D12): deflate 1.04 of zlib's
throughput on average (0.89–1.26), inflate 2.65 (0.81–5.05). Callgrind, 2 MiB of text at level 6:
about 460M instructions, zlib 489M.

Not measured: a package install through `modules/pm`. The package manager unpacks with the
standard library's own `silk.compress.inflate`, which this change does not touch.

## Compiler walls

None that blocked. The encoder needed unaligned 2-, 4- and 8-byte loads, a trailing-zero count,
and `u16x8` saturating subtraction (tried, not kept). The standard library has all of them; the
decoder already had SIMD copies and a BMI2 build. Two gaps, worked around:

- No byte swap for integers, so the multiplicative hash's single 4-byte load is used on
  little-endian targets only (`static if`), and other targets read the 4 bytes one at a time.
- `Slice.copyInto` is not turned into a `memcpy` call. Its comment expects LLVM to form one, but
  the build has no `memcpy` there, and the vectorized loop copies large stored blocks at about
  0.7 of the speed of libc's AVX `memcpy` (inflate of random data in `bench_codec`).

## Upstreaming

[silk-lang/silk#3122](https://github.com/silk-lang/silk/pull/3122), merged into Silk's `main` as
`252b301` (squash), with all of Silk's CI green. It holds:

- the two files as in `src/stdlib_copy`, without their header note, including `Options.hash`
  (D12);
- `corpus/native/deflate-zlib-bytes`, which checks both hashes against bytes that zlib 1.3.1 and
  Node 24 wrote;
- `hash: Hash.Rolling` in the corpus's `Options` literals;
- a changeset with migration notes (`Options` has a new field);
- the regenerated `reference/stdlib`.

With Silk 0.1.0-dev.74 these ran on the final files:

- `deflate-zlib-bytes`, `deflate-encode`, `inflate-fast-loop`, `streaming-inflate`,
  `http-content-decoding` and `tar-write` exit with their expected codes;
- `silk doctest --stdlib`: 414 passed, 4 skipped, 0 failed.

Once a release contains it, delete `src/stdlib_copy` as described at the top of this file.
