# Protocol

An app prints lines that start with `XB ` on standard output or standard error. The runner
(`runner/xbench.py`) timestamps each line when it reads it and measures around it. Lines:

| Line | When | What the runner does |
| --- | --- | --- |
| `XB first-paint` | The first frame with content is on screen (see below) | Start time: spawn to this line |
| `XB idle-begin NAME` / `XB idle-end NAME` | An idle step starts / ends | CPU use of the process tree between them |
| `XB mark NAME` | A mark step starts; the app then holds still for 400 ms | Stops the process tree (SIGSTOP), reads its memory, continues it |
| `XB begin NAME` | A driver starts; its frames follow | Wall clock and CPU time of the tree |
| `XB end NAME F` | The driver made F frames | Wall time and CPU time over the driver, per frame |
| `XB frames NAME g1,g2,...` | After `end` | The app's own intervals between the driver's frames, ms (ignored when the app runs on a fake clock) |
| `XB done` | The script is over | Kills the process tree |
| `XB span begin LANE KIND LABEL` / `XB span end LANE KIND LABEL` | A start-up phase starts / ends (only with `XB_TRACE=1`, timeline runs) | Kept with the line's arrival time for `tools/timeline.py` (TIMELINE.md) |

## First paint

- **In a window**: the first frame that has the scene's content reached the screen. Silk UI hides
  its window until it can draw something, so the first frame Silk shows is already content.
  - Silk UI direct uses the host's `presented` callback.
  - Silk UI + React waits for two `requestAnimationFrame` callbacks and for the host's frame
    counter to be past zero.
  - Electron's page waits for two `requestAnimationFrame` callbacks after its first render.
  - Loom, GPUI and Rune pass on no presentation, so they say it at their second frame callback.
  - Electron's line can be checked against Chromium's own first contentful paint, which it stamps
    with the frame's presentation time: launch with `--trace-startup` and read the trace (the
    startup report of 2026-11-19 did this). Tracing
    costs Electron some start time, so the runner does not trace by default.
  - Windowed runs need the Mac unlocked, awake (the runner keeps it awake with `caffeinate`) and
    nothing in front of the app's window.
  - On macOS the runner can also find the first painted frame from a screen recording
    (`tools/record-one.sh`, from the earlier work in this workspace): use it to check the apps'
    own lines, not on every run.
- **Windowless** (the cpu suite): after the second frame, whose predecessor's layout and paint are
  done.

## Clocks

The Silk UI windowless bench (`SILK_UI_BENCH`) and the Rust apps' windowless mode run frames
back to back on a clock that moves 1/120 s a frame. Their script steps (idles of 3 s, marks of
400 ms) are counted on that clock, so they take far less wall time, and their idle CPU is not
meaningful: the runner marks it `"meaningful": false`. Electron's windowless mode (offscreen
rendering) runs on its real clock at 120 frames a second (240 uncapped).
