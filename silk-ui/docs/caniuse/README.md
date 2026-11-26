# Can I use

The data behind the docs' [Can I use](../content/can-i-use.md) page.

- `features.json` is caniuse's feature list, from <https://github.com/Fyrd/caniuse> (CC BY 4.0), cut down to the CSS, SVG and JavaScript features. `python3 docs/caniuse/sync.py --fetch` takes it again.
- `silk.json` lists Silk UI's own APIs that caniuse has no feature for, in `features.json`'s shape plus a `link`; `--fetch` leaves it alone.
- `areas.json` splits the features into areas, and `support/<area>.json` is what Silk UI does with the features of one area. Two people answering different areas never edit the same file, written or generated.
- `sync.py` checks the answers and writes the Silk modules the page and the tests read (`docs/src/caniuse_*.silk`, `modules/tree/tests/src/caniuse_probes*.silk`). Run it after every edit and commit what it writes.

## Answering a feature

```json
{
  "id": "border-radius",
  "support": "a",
  "note": "Lengths work on every corner. A percentage radius is ignored.",
  "probes": [{ "sheet": ".sample{border-radius:8px}", "setup": "background-color:red" }],
  "missing": [{ "sheet": ".sample{border-top-left-radius:50%}", "setup": "background-color:red" }]
}
```

`support` is `y` (works), `a` (partly), `n` (not yet) or `x` (not for apps: it is about web pages or printing). Everything but `y` needs a `note`, written for someone deciding whether to use the feature: what works, what does not.

A probe is a stylesheet that must change what the tree draws. The test `cssCoverageCanIUseProbes` builds a small fixture twice, with and without the sheet, and compares where the boxes are and every pixel. The fixture is a 400 by 300 root (class `root`) holding a leading box (`lead`), the target (`sample`, with the text "Hello wide world of text" and a 20px box, `inner`, inside) and a 10px tall box after it (`after`).

- `sheet` holds only the feature being asked about. Whatever else the feature needs goes in `base` (a stylesheet both runs adopt) or in `root`, `lead` and `setup` (inline styles of those nodes). A probe whose sheet also sets `display: grid` proves grid, not the feature. Inline styles win over sheets, so a property the sheet sets cannot also be set inline.
- The fixture sets a few inline styles itself, which a sheet cannot override: `font-family` on `sample`, and `width` and `height` (20px) on `inner`. Probe a font family through `.sample::before { content: ... }`, and a taller `inner` through `min-height`.
- The test sees boxes and pixels, not computed style. A property with nothing to draw in the fixture (`cursor`, `pointer-events`, `caret-color`) answers with `evidence`.
- `probes` must change something. `y` and `a` need at least one, covering each part the note says works.
- `missing` must change nothing, for the parts an `a` or `n` says are absent. When one starts to work the test fails, and the answer gets corrected.
- A feature the fixture cannot show (a pointer state, an animation over time, an input) names the test that covers it in `evidence` instead, as a path. The `javascript` and `javascript-apis` areas are not stylesheets at all, and always answer with `evidence`.

Run the probes with:

```sh
python3 docs/caniuse/sync.py
silk test --manifest-path modules/tree/tests/silk.toml --root src/tests.silk --filter CanIUse
```

A probe that does not do what its answer says is printed with its sheet. A probe costs about 60 ms, so two or three a feature is plenty.
