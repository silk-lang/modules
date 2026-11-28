# font-shape

Text shaping for Silk: it turns a string and a font into positioned glyphs. It is a native
port of [harfrust](https://github.com/harfbuzz/harfrust) (itself a Rust port of HarfBuzz),
pinned at [`1503ff0`](https://github.com/harfbuzz/harfrust/tree/1503ff054384cc1d6a701b5ffbdc2f24118a2790),
built on [font-parse](../parse) and the standard library's `silk.text` Unicode modules. There is no Rust, C, FFI or
subprocess anywhere in the library.

## What it shapes

- OpenType GSUB and GPOS, including contextual, chained and variation lookups, GDEF classes
  and the 24-bit extended formats.
- The complex-script shapers: Arabic and Syriac joining, Hebrew, Hangul, Indic, Khmer,
  Myanmar, Thai and Lao, and the Universal Shaping Engine.
- Apple Advanced Typography: `morx`, `mort`, `kerx`, `kern` and `trak`.
- Normalization, fallback mark positioning and fallback substitutions.
- Features with ranges, variation coordinates, all four directions and all cluster levels.
- Reusable shape plans, custom font callbacks (`FontFuncs`) and step-by-step tracing.
- HarfBuzz's text serialization formats.

## Example

```silk
import harfrust.lib { Buffer, GlyphPosition, ShaperData, ShapeError, ShapeOptions, shape }
import read_fonts.lib { FontRef }
import silk.core.option { Option }
import silk.core.result { Result }
import silk.mem.allocator { Allocator, OutOfMemoryError }

/// Shapes `text` with `font` and returns the total horizontal advance in font units.
pub effect fn advance<'a>(font: &FontRef<'a>, text: string) -> i32
  ! OutOfMemoryError
  ? &mut Allocator {
  let data = ShaperData.new(font)
  let shaper = ShaperData.shaper(&data)
  let mut buffer = Buffer.new()
  run Buffer.pushStr(&mut buffer, text)
  Buffer.guessSegmentProperties(&mut buffer)
  if let Result<(), ShapeError>.Failure { error: _ } = run shape(&shaper, &mut buffer, ShapeOptions.new()) {
    return 0
  }
  let positions = Buffer.glyphPositions(&buffer)
  let mut total: i32 = 0
  let mut i: usize = 0
  while i < positions.len() {
    if let Option<GlyphPosition>.Some { value } = positions.get(i) {
      total = total + value.xAdvance
    }
    i = i + 1
  }
  return total
}
```

`Buffer.glyphInfos` gives the glyph IDs and clusters. A buffer can be cleared and reused, and
it keeps its capacity. Malformed layout tables are skipped instead of trapping, and
allocation goes through the `Allocator` effect. The [API notes](docs/api.md) cover plans,
variations, scaling, custom callbacks, tracing and serialization.

The package is still imported as `harfrust` by its dependents, so the dependency key in their
manifests is `harfrust`.

## Keeping glyphs across a cut

`GlyphInfo.unsafeToBreak` says where text shaped as a whole may be cut. It says nothing about
text that grows afterwards: words added after it can complete a match that reaches back over
a cut the shorter text had as safe. `separable.separation(data, plan, glyph)` reads which of a
plan's lookups can match on past a glyph, usually the space, and which glyphs they take as
input. `Separation.separates` then tells whether a cut right after that glyph shapes the same on
either side. When no lookup reads past a space, every such cut holds. When some do, the cut
holds unless one of their inputs is within their reach. In Inter, for example, `calt` gives a
closing bracket the case form of its opening one, and gives `- : + =` between capitals their
case forms, across spaces. A cut with such punctuation near it is not trusted.
`font-shape-space-separable FONT [TEXT]` prints what a font's default plan does across a space,
and with `TEXT` whether each cut after a space holds.

## Packages

| Path | Package | What it is |
| --- | --- | --- |
| `modules/shape` | `font-shape` | The shaping library |
| `font-shape-test-harness` | `font-shape-test-harness` | Internal validation executable and runner for the pinned test suite |
| `modules/shape/tools/wasm` | `font-shape-wasm` | WebAssembly build with a typed JavaScript wrapper ([README](tools/wasm/README.md)) |
| `modules/shape/tools/space-separable` | `font-shape-space-separable` | Prints which lookups of a font read past a space, and which cuts after a space hold |

`modules/shape/test-data/harfrust` is the pinned harfrust checkout. It supplies the test fonts
and expectations and is never modified.

The internal harness takes a font and text and prints the glyph string:

```sh
build/x86_64-unknown-linux-gnu/release/font-shape-test-harness font.ttf 'office' --features=-liga
build/x86_64-unknown-linux-gnu/release/font-shape-test-harness font.ttf --text-file=text.txt --direction=rtl --script=Arab
```

It accepts the shaping and serialization options the upstream suite uses, including
`--variations`, `--font-size`, `--face-index` and `--trace`.

## Tests

All 6,090 data-driven cases of the pinned suite pass, with no skip list. The 129 cases that
need Apple system fonts are excluded. From the repository root:

```sh
silk test --release --manifest-path modules/shape/silk.toml --root src/tests.silk
silk build --release --manifest-path font-shape-test-harness/silk.toml
build/x86_64-unknown-linux-gnu/release/font-shape-test-harness --suite modules/shape/tests/shaping.bin
build/x86_64-unknown-linux-gnu/release/font-shape-test-harness --regressions
silk task check-shaping-trace
silk task check-shaping-malformed
```

These run in the `font` CI workflow. Every week the same workflow also compares all cases
against the pinned Rust harfrust, mutates every corpus font, and runs the benchmarks.
[Validation](docs/validation.md) has the details.

## Performance

`silk task bench-shaping` runs harfrust's own benchmark workloads in both implementations
and checks that their glyph output matches. On 2026-10-29 (Silk dev.29, release builds), Silk
took **0.89×** Rust's wall time and **0.85×** its instruction count, as geometric means over
seven workloads. Every workload except Roboto with long Latin text, which is at parity
(1.01× wall), was faster than Rust.

[Performance history](docs/performance.md) records how the port got there from 11.25×.

## Differences from harfrust

No glyph differences are known on the pinned suite. The API is native Silk rather than a
transliteration: `ShaperData` borrows the font bytes, and custom font functions are interface
implementations, not closures. [Differences](docs/differences.md) lists the rest.

## License

[MIT](LICENSE), keeping harfrust's HarfBuzz and rustybuzz notices. The pinned fonts and Unicode
data keep their own licenses.
