# Start-up timelines

`runner/xbench.py timeline` launches each app as `start` does (cold, then warm), and keeps every
line the app prints with the time it arrived, from launch. For Electron it also records Chromium's
startup trace (`--trace-startup`, the categories in `ELECTRON_TRACE_CATS`). The launch ends a
little after first paint. Each launch is a file in `results/timelines/<session>/` (not committed,
the Electron ones are about 17 MB); the records go to `results/<suite>-timeline.jsonl`.

`tools/timeline.py` turns those into `results/timeline.json`: for each session, suite, app, scene
and cold or warm start, the phases on each thread with the median start and end of each phase over
the launches. The file is a flat table, one row per phase (the dashboard's data runtime does not
keep nested lists), and the dashboard groups the rows back by app and start kind. It draws one row
of bars per thread, with the warm and the cold start of each app on one time axis, like the
start-up report of 2026-11-19. Solid bars are the critical path to the first frame. Hatched bars run beside it.

Tracing costs some start time (Electron's trace most), so timeline numbers are not the start
times of the `start` mode. Compare phases inside a timeline, and start times from `start` runs.

## Where the phases come from

| App | Source | Threads |
| --- | --- | --- |
| Silk UI (all three) | The Silk host's own lines. Headless: `bench: startup setup-ms start-ms open-to-layout-ms` and `bench: first frame start-to-layout-ms layout-ms`, plus `silkui: ...` stamps from the React host. Windowed, on a Silk UI build with the start-up trace points (`SILK_UI_TRACE_FRAMES`, `SILK_UI_TRACE_JS`): the main, UI and render thread phases of the start-up report | process, main, UI, render |
| Electron | Chromium's startup trace: browser init, Node and `main.cjs`, GPU process, renderer init, bundle compile and evaluate, React render, then style, layout and paint of each main frame, raster workers, draw and swap | browser, GPU, renderer main, renderer workers |
| Rune, GPUI, FerroUI | `XB span` lines the apps print around their own phases (`apps/rust-scenes`: `span`, `Phase`), with `XB_TRACE=1`. A span inside another splits it. Main-thread time no span covers is "untraced" | main |

Phase kinds (the colours): process and runtime start, view code (JavaScript and React, or a Rust
app building its elements), style, font loading, layout and text, paint and raster, GPU and
window system, draw and present, wait, untraced.

## Limits

- Silk UI's windowless bench reports its first frame as one style, layout and text phase, and
  does not say what happens between that and the second frame (for Silk UI + React about 1.6 s on
  the cloud machine, `until frame 2 (untraced)`). The start-up trace points are on the windowed
  path only, in a Silk UI build that has them (`engine/work/startup`), so the finer Silk phases
  come from the GPU suite on a Mac.
- In the CPU suite there is no window and no GPU, so only CPU phases show. GPUI, Rune and FerroUI
  rasterize nothing on a GPU there; FerroUI and Electron rasterize in software.
- GPUI's first frame span is inside `open window`: GPUI draws the first frame when the window
  opens. Rune's first view build is inside its first frame.
- First frame is the app's own first-paint line (PROTOCOL.md). For Electron, Chromium's first
  contentful paint is drawn too, as a dashed line: it comes one main frame earlier, before the
  second layout.
