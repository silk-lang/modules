# Stylesheet comparison with Chromium

Run from a desktop session, or under Xvfb on Linux:

```sh
node modules/tree/tests/chrome/stylesheets.mjs
```

This local development check is intentionally outside CI. It needs Node 22+, the repository's Silk toolchain and Chromium (`CHROMIUM=/path/to/chromium` overrides the executable). Headless Chromium does not expose a hover-capable pointer on every platform; the runner requires desktop hover rather than skipping those cases. `PARITY_BINARY` can select an already-built native runner. `PARITY_REPORT=/path/to/report.json` saves all differences, diagnostic counts and the browser version.

The runner builds identical trees against the three committed stylesheet fixtures and compares computed properties and the border boxes of a subject and three children. `cases.json` defines the supported cases: handwritten cascade, nesting and relational selectors; the small Tailwind fixture's utility and state combinations; and numeric spacing, dimensions, flex/grid, fonts, colors, borders and opacity from the large application fixture. Each case uses fresh native tree state. Chromium retains the stylesheet but replaces the nodes between cases.

`baseline.css` gives both engines the same initial box and font styles. Silk UI has no HTML user-agent sheet. The baseline also removes the browser's special button layout by giving button subjects an explicit flex layout. There is no text in the probes: font properties are compared, but glyph shaping and rasterization are covered by the separate text and paint suites. Geometry tolerates 0.05 CSS pixels for Chromium's 1/64-pixel layout quantization; numeric properties tolerate 0.02; premultiplied colors tolerate two 8-bit sRGB levels.

`diagnostics.json` records the reviewed dropped features and counts: browser-specific form-control parts, vendor properties/selectors, and `text-box`. The handwritten sheet has none. Changes to this list require reviewing the affected feature, rather than accepting a snapshot automatically.

This is a comparison of the cases in the table, not a claim that every utility emitted by the large fixture renders correctly. The tree's `css_coverage` tests separately cover every owned property through both inline declarations and compiled sheets. See the stylesheet guide for unsupported parts, compound grammars and host differences.
