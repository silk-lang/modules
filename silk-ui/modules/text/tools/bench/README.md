# ui-text-bench

Times `ui-text` under css-layout on a chat-like page, with fonts given as files so that runs
compare across machines.

```sh
silk build --manifest-path modules/text/tools/bench/silk.toml --release
BENCH=build/<target>/release/ui-text-bench

$BENCH mount  Inter latin-prose.txt 1000 Inter-Regular.ttf   # first layout of 1,000 messages
$BENCH labels Inter ui-labels.txt   5000 Inter-Regular.ttf   # 5,000 two-word labels
$BENCH stream Inter latin-prose.txt 2000 Inter-Regular.ttf   # a paragraph growing by a word
$BENCH cold   sans-serif                                     # find system fonts, first line
```

The corpora and the script that fetches the fonts are in lib-fonts, under
`modules/shape/bench`. Give fallback faces as more font files:

```sh
$BENCH mount "Noto Sans" mixed.txt 300 NotoSans-Regular.ttf NotoSansCJKsc-Regular.otf \
  NotoNaskhArabic-Regular.ttf NotoSansDevanagari-Regular.ttf NotoColorEmoji.ttf
```

Every mode prints a checksum of each text fragment's place, size and glyphs. A change that
keeps the output keeps the checksum; `stream` also folds the checksums of the layout after
every 32 words into `rolling`.

`fresh-mount`, `fresh-labels` and `fresh-stream` shape every segment instead of taking glyphs
from segments shaped before (`Shaping.reuse` off). Their checksums must equal the plain modes'.

`shaperCalls` and `shaperBytes` count the shaper calls the caches did not answer and the text
they shaped; `taken` and `continued` count the segments that took their glyphs from a segment
shaped before. Wall time on a shared machine moves by tens of percent, so compare instruction
counts for small changes:

```sh
valgrind --tool=callgrind --callgrind-out-file=/dev/null $BENCH mount Inter latin-prose.txt 300 Inter-Regular.ttf
```
