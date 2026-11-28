# ui-bench-chat

The first layout of xbench's chat scene (`chat-1000`: a 1,000-message chatbot transcript, see
`silk-ui/xbench/SCENES.md`) on the real ui-tree, headless, to measure Silk UI's text shaping on
the same machine before and after a change, and to prove a change keeps the output.

- Nodes: `fixtures/chat.tree`, written by `scripts/generate.mjs` from a verbatim copy of the
  generator in `silk-ui/xbench/apps/react/web/src/Chat.tsx` (same PRNG, words and structure). The
  bench makes one ui-tree node per React host node: a root box (`createRoot`), then
  `.app.chat > .bar, .chat-body > .chat-scroll > .chat-log > .msg...`, each box with its
  `className`, each string child a text node. An `<img>` is a leaf box sized by the stylesheet
  (480 x 270); no image is decoded.
- Styles: `fixtures/chat.sheet`, `silk-ui/xbench/style/bench.css` + `chat.css` compiled with the
  `@silkui/vite` compiler, adopted as the tree's stylesheet. The `@font-face` rules are left out:
  the bench adds `Inter-Regular`, `Inter-Bold`, `Inter-Italic` and `JetBrainsMono-Regular` from
  `silk-ui/xbench/assets/fonts` to the font collection, where `font-family: "Inter"` and
  `"JetBrains Mono"` find them (the bench prints the glyphs drawn from each face).
- Viewport 1040 x 720, scale 1. Each run makes a new font collection, tree and `TextSystem`.

## Build and run

From the repository root:

```sh
export PATH=$HOME/.silk/bin:$PATH
silk build --manifest-path silk-ui/modules/bench/chat/silk.toml --release --progress plain
build/x86_64-unknown-linux-gnu/release/ui-bench-chat              # one first layout
build/x86_64-unknown-linux-gnu/release/ui-bench-chat --runs 7     # 7 in one process, and the medians
build/x86_64-unknown-linux-gnu/release/ui-bench-chat --paint      # also time the first paint
build/x86_64-unknown-linux-gnu/release/ui-bench-chat --fresh      # Shaping.reuse off: same checksum
build/x86_64-unknown-linux-gnu/release/ui-bench-chat --no-timing  # no clock reads in the provider
```

Fonts are read at run time from `silk-ui/xbench/assets/fonts` relative to the working
directory; elsewhere pass `--fonts DIR`.

Profile once under callgrind, collecting only inside the text provider:

```sh
valgrind --tool=callgrind --callgrind-out-file=chat-text.cg \
  '--toggle-collect=*provider.silk::TextMeasure for .shape*' \
  '--toggle-collect=*provider.silk::TextMeasure for .analyze*' \
  build/x86_64-unknown-linux-gnu/release/ui-bench-chat --no-timing
callgrind_annotate --inclusive=yes --threshold=100 chat-text.cg | head -80
```

Without the `--toggle-collect` options the profile is the whole process (start-up, building the
tree, styles and layout).

Regenerate the fixtures after changing Chat.tsx, bench.css or chat.css (and keep the copy of the
generator in `scripts/generate.mjs` equal to Chat.tsx's):

```sh
node silk-ui/modules/bench/chat/scripts/generate.mjs   # [count], default 1000
```

## What it prints

- `style_ms`: `UiTree.stylesNow` (style resolution of the whole tree).
- `layout_ms`: `Tree.layoutNow` after that (css-layout over the tree, text included; no paint).
- `text_ms`: wall time inside the text provider's `TextMeasure.analyze` and `TextMeasure.shape`
  during that layout, and each apart. The ui-tree `Provider` reads the clock around each call
  when `TextSystem.timing` is set (benchmark-only fields; off by default, a branch per call). The
  bench prints the cost of a clock read, and about how much of `text_ms` the reads are.
- `paint_ms` (`--paint`): the first `Tree.frame` after layout.
- Counts: `ui_nodes` (live tree nodes), `text_nodes`, `analyze_calls`, `shape_calls`
  (`TextSystem.shapeCalls`, lines asked, cache hits included), `line_cache_hits`, `shape_tokens`,
  `text_fragments` (fragment text runs), `glyphs`, `glyph_runs`; then `plain_lines` (lines that
  took ui-text's plain-word runs, `token_runs.silk`), `plain_hits` and `plain_misses` (runs found
  kept, and runs shaped for them), and `shaper_calls` (calls the shaper itself answered).
- `checksum`: FNV-style hash over every text fragment run (source range, location, size, bidi
  level, face) and its glyphs (id, cluster, x, y, advance), as in `ui-text-bench`. An
  optimization that keeps the output keeps it. Runs that differ print a warning.

## Results

Medians of `--runs 7` on one 4-core x86_64 cloud machine (2.1 GHz Xeon), 2026-11-28. The
checksum was `0x69a01e8ce1e1779f` in every row and equal to `--fresh`.

| ui-text | text_ms | of which shape | layout_ms | provider instructions (callgrind) |
| --- | ---: | ---: | ---: | ---: |
| before plain-word runs | 202.9 | 192.0 | 455.1 | 1,664 M |
| with plain-word runs | 38.9 | 30.5 | 258.5 | 245 M |

Chromium 158 (the one Playwright ships) on the same machine, the same page built from the same
generator with bench.css and chat.css, fonts loaded first, 1040 x 720 at scale 2: the trace's
`InlineNode::ShapeTextIncludingFirstLine` events (13,045, one per text node) take 101.2 ms
(median of 5), inside a first `Layout` of 205.8 ms.

