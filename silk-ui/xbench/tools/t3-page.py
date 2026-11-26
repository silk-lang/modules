#!/usr/bin/env python3
"""Writes content/t3-page.json, the input scene's page (SCENES.md), from the T3 page fixture of
Silk UI's restyle bench (modules/tree/tools/restyle-bench/fixtures/t3-page.tree).

The fixture holds a snapshot of T3 Code's chat view as the Silk port rendered it: one line per
node, `E<TAB>depth<TAB>tag<TAB>attributes` (name=value pairs split by 0x1f) or
`T<TAB>depth<TAB>text`. An element is [tag, {attributes}, ...children], a text node a string.
`html` and `body` become plain divs that keep their attributes, so both apps own the same tree
under their own root."""
import json, pathlib, sys

here = pathlib.Path(__file__).resolve().parent
source = here.parent.parent / "modules/tree/tools/restyle-bench/fixtures/t3-page.tree"
root, stack = None, []
for line in source.read_text().splitlines():
    kind, depth, rest = line.split("\t", 2)
    depth = int(depth)
    del stack[depth:]
    if kind == "T":
        node = rest
    else:
        tag, _, attrs = rest.partition("\t")
        pairs = {}
        for pair in filter(None, attrs.split("\x1f")):
            name, _, value = pair.partition("=")
            pairs[name] = value
        node = ["div" if tag in ("html", "body") else tag, pairs]
    if stack:
        stack[-1].append(node)
    else:
        root = node
    if kind == "E":
        stack.append(node)
out = here.parent / "content/t3-page.json"
out.write_text(json.dumps(root, separators=(",", ":")) + "\n")
print(f"wrote {out} ({out.stat().st_size} bytes)", file=sys.stderr)
