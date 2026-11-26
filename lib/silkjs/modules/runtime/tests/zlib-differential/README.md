# zlib differential harness

The runtime's zlib is Silk code (`compress/src/ext/zlib_stream.silk` over `compress/src/stdlib_copy/compress`). These
programs link it next to a C zlib and give both the same calls. Two C zlibs are built: Node 24's
(Chromium's, `deps/zlib` of Node v24.22.3, files pinned in `node-zlib.sha256`, with the defines of
Node's x64 build), whose bytes the runtime writes, and zlib 1.3.1 from its pinned release, whose
bytes the standard library's default hash (`Hash.Rolling`) writes.

| Program | Against | What it compares |
| --- | --- | --- |
| `fuzz_deflate <first seed> <count>` | Node's zlib | Per `deflate` call: status, input consumed, output written, and the bytes. Scenarios vary the level, strategy, window and memory level, the format, dictionaries, the input and output lengths of each call, every flush mode, `deflateParams` as Node calls it, and `deflateReset`. The encoder uses `Hash.Multiplicative`, as the runtime does. |
| `fuzz_deflate_rolling <first seed> <count>` | zlib 1.3.1 | The same, with `Hash.Rolling`. |
| `fuzz_inflate_node`, `fuzz_inflate_1.3.1 <first seed> <count>` | both | Per `inflate` call: status, zlib's message, consumed, written, bytes. Streams are valid, damaged (bits flipped, cut, bytes replaced, noise), with several gzip members or bytes after the end, opened with the right or another format and window, with the right, a wrong or no dictionary, with `Z_BLOCK` and `Z_FINISH`. |
| `bench_codec <large file> <rounds>` | Node's zlib | Throughput of both, in turns, for the cases of `bench/scripts/zlib.cjs`. |
| `bench_crc <large file> <rounds>` | Node's zlib | `crc32` throughput. |

`./build.sh` writes them to `build/zlib-differential/`. A mismatch prints its seed; a third
argument to a fuzzer traces that seed's calls. `ZLIB_NOTES.md` has the results.
