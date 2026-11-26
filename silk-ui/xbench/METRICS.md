# Metrics

Every run is one JSON line in `results/<suite>.jsonl`, with the machine, the date, the git commit
of each app's framework (`versions`), and a free label (`--label`). The artifact reads these files.

| Metric | Field | How |
| --- | --- | --- |
| Cold start | `first_paint_ms`, `kind: "cold"` | Spawn to `XB first-paint`, with the app's GPU, shader and code caches deleted and its files dropped from the page cache. Linux: `posix_fadvise(DONTNEED)` on the app's binary, bundle and every file it mapped in an earlier run (`results/mapped-files.json`). macOS: `sudo purge`, with the password from the file `XB_PURGE_SECRET` names, else `sudo -n purge`. `cache_dropped` says whether the drop worked |
| Warm start | `first_paint_ms`, `kind: "warm"` | The same, the runs after the cold one |
| Memory | `marks.NAME.mb` | At each mark, with the tree stopped. macOS: `phys_footprint` summed over the process tree (what Activity Monitor shows). Linux: PSS summed over the tree (`pss`), RSS beside it (`rss`). Electron's tree includes its GPU, renderer and utility processes |
| Frame time | `drivers.NAME.frame_ms` | Wall time of the driver over its frames |
| CPU per frame | `drivers.NAME.cpu_ms_per_frame` | CPU time of the whole tree (all threads) over the driver, per frame |
| Frame intervals | `drivers.NAME.intervals` | The app's own frame-to-frame times: p50, p95, p99, max, and how many were over 8.3 and 16.7 ms |
| FPS | 1000 / `frame_ms` | Uncapped runs only (below) |
| Frames shown | `drivers.NAME.shown`, `shown_per_s`, `cpu_ms_per_shown` | Silk UI, gpu suite: frames the window showed during the driver (`silk-ui: frames shown N`, from `SILK_UI_TRACE_PRESENTS`), and the CPU of the driver over them. `frames` counts the app's frame callbacks. Capped, the two agree when no refresh is missed. Uncapped they differ by what never reached the screen |
| Canvas frames shown | `drivers.NAME.canvas_shown`, `canvas_shown_per_s` | Silk UI, canvas scene: GPU canvas frames the renderer put on screen during the driver (`silk-ui: canvas shown N`, from `SILK_UI_TRACE_CANVAS`). Uncapped, a newer canvas frame replaces one not yet shown, so `frames` counts rAF callbacks and this counts what reached the screen. The path they took is `canvas_path` |
| Idle CPU | `idle.NAME.cpu_pct` | Percent of one core between `idle-begin` and `idle-end` (windowed runs only) |

Start time is the median of the warm runs; the cold run is reported on its own. On macOS the
runner first makes one discarded launch per app (`--prime`), because the first launch of a newly
built binary costs about 950 ms while macOS checks it. Apps are interleaved, and their order flips
every round, so drift hits all of them alike. The record keeps the Mac's appearance
(`machine.appearance`): in dark mode Silk UI lays the page out a second time before its first
frame (LOG.md), so start times from light and dark runs are not comparable. Every other
metric is the median over runs, with the spread shown in the artifact.

## The two suites

- **cpu** (`--suite cpu`): no window, no display, no GPU. It measures what a framework does on
  the CPU: building the tree, style, layout, text shaping, building paint lists, and memory.
  Frames run back to back where the framework allows it (Silk UI's bench, the Rust apps), so
  `frame_ms` is the cost of a frame. Electron's offscreen mode paces its frames at 120 a second
  and rasterizes in software, so for Electron `frame_ms` is pacing and `cpu_ms_per_frame` is the
  comparable number. It runs anywhere (the cloud, CI).
- **gpu** (`--suite gpu`): a real window on a real display, frames presented. It measures what a
  user sees: start time to the first painted frame, frame times with the GPU in the loop, idle
  CPU, and memory with GPU resources. It needs a machine with a display and a GPU (a Mac).

## Capped or uncapped frames

**Recommendation: measure the GPU suite uncapped, and do not run a capped pass by default.**

Uncapped, a frame starts as soon as the last one is done, so frame time is the work of a frame,
and FPS is its inverse. Capped at the display (60 or 120 Hz), every app that keeps up shows the
same FPS, and the numbers say nothing about how close it is to dropping a frame.

Uncapped can mislead in three ways, and the suite covers them without a capped pass:

1. **It hides per-frame CPU cost behind throughput.** A framework that pipelines (Chromium's
   compositor runs ahead of the main thread) can show a high FPS while spending more CPU per
   frame. The suite reports CPU per frame beside frame time, from the same runs.
2. **It misses frame pacing.** Under vsync what matters is the worst frames, not the average: an
   app with a 4 ms median and a 30 ms frame every second drops frames at 120 Hz. The suite
   reports p95, p99, max and the count over 8.3 and 16.7 ms of the app's own frame intervals,
   which are the frames that would miss a deadline when capped.

3. **FPS counts frames produced, not frames shown.** A display at 120 Hz shows at most 120
   pictures a second. Electron uncapped runs its frame callbacks without waiting for the screen,
   so its FPS is how fast it can produce frames. Silk UI uncapped waits until the renderer has
   taken the last frame, and on macOS the window server returns one or two drawables a refresh
   depending on how it composites the window at that moment, so the same build and scene reads
   about 120 or about 250 to 330 FPS from one run to the next. Compare CPU per frame, and for
   Silk UI `shown_per_s`, not uncapped FPS.

A capped run measures one more thing: energy and CPU at a fixed frame rate (how much of a core it
takes to hold 120 Hz). That is the idle and battery question, and the idle steps already answer
part of it. `--uncapped` is a flag, so a capped pass is one command away (`xbench.py run --suite
gpu` without it) if that question comes up.

Not every framework can run uncapped: Silk UI (`SILK_UI_UNCAPPED`) and Electron
(`--disable-frame-rate-limit --disable-gpu-vsync`) can. GPUI and Rune present at the display's
pace, so their gpu runs are capped and their frame times are floored at the refresh interval;
compare CPU per frame and the tail of the intervals for them (LOG.md).

## What is not measured

- GPU time per frame: no app reports it the same way. CPU per frame and frame intervals with the
  GPU in the loop stand in for it.
- Input latency.
