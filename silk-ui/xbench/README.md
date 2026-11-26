# xbench

In the Silk UI repository since 2026-11-19. It started in another repository; the merge keeps
its commits.

A benchmark of UI frameworks on the same content: Silk UI + React, Silk UI + Loom, Silk UI with
a hand-built tree, Electron, GPUI, Rune and FerroUI.

- SCENES.md: the four scenes (long feed, a wall of visible cells, a growing chat stream, memory
  churn) and their scripts, the WebGPU canvas scene of the gpu suite, and the chat page scene of
  the two React apps.
- METRICS.md: what is measured, how, and why the GPU suite runs uncapped.
- PROTOCOL.md: the `XB ...` lines an app prints and what the runner does with them.
- LOG.md: what each app does differently. Read it before comparing numbers.
- TIMELINE.md: the start-up of each app as phases on its threads, and how it is traced.

## Two suites

- `--suite cpu` runs with no window, display or GPU. It runs anywhere, including the cloud.
- `--suite gpu` opens real windows and presents frames. It needs a display and a GPU, and it takes
  over the screen while it runs.

## Build

Everything builds from `xbench/`, the folder this README is in. Linux needs `xvfb` for Electron, and the GPUI build needs
`libxkbcommon-x11-dev`, `libxcb1-dev` and `libfreetype-dev`.

```sh
# React (for Electron and Silk UI + React)
(cd apps/react/web && npm ci)
for s in feed wall stream churn canvas chat input; do (cd apps/react/web && VITE_XB_SCENE=$s npx vite build --config vite.web.config.js); done
(cd apps/electron && npm ci)

# Silk UI apps. SILKUI is the Silk UI checkout to measure: by default this one, the repository
# the suite lives in. LOOM is the Loom checkout for silk-loom.
SILKUI=... apps/silk-react/build.sh
SILKUI=... tools/silk-native-build.sh apps/silk-direct
SILKUI=... LOOM=... tools/silk-native-build.sh apps/silk-loom

# Rust apps (each fetches its framework at a pinned commit; FerroUI comes from crates.io)
apps/rune/fetch.sh && (cd apps/rune && cargo build --release)
apps/gpui/fetch.sh && (cd apps/gpui && cargo build --release)
(cd apps/ferroui && cargo build --release)
```

The Rust apps pin their toolchain with `rust-toolchain.toml`, so rustup installs it on first build.

Gotchas:

- `silk-loom`: Loom pins Silk UI by revision. `silk-native-build.sh` links that revision in the
  Silk home's git cache (`$SILK_HOME/git/<rev>`) to `$SILKUI`, so all three Silk apps build against
  the same Silk UI. Check the Silk UI revision in `apps/*/VERSION` before comparing runs.
- Electron: if `npm ci` skipped the download (`ignore-scripts`, or a cache), the binary is missing;
  run `node node_modules/electron/install.js` in `apps/electron`.
- GPUI on macOS compiles Metal shaders: it needs Xcode's Metal toolchain
  (`xcodebuild -downloadComponent MetalToolchain`).
- App names for `--apps`: `silk-direct`, `silk-loom`, `silk-react`, `electron`, `rune`, `gpui`,
  `ferroui`.

## Run

```sh
runner/xbench.py run --suite cpu --runs 5                    # every app, every scene
runner/xbench.py run --suite cpu --apps rune,silk-direct --scenes feed
runner/xbench.py start --suite gpu --runs 10                 # start-up only: 1 cold, then warm
runner/xbench.py run --suite gpu --uncapped --runs 3         # the full GPU suite (macOS)
runner/xbench.py timeline --suite cpu --scenes feed,wall --runs 5   # start-up phases (TIMELINE.md)
tools/summarize.py && tools/timeline.py                      # results/summary.json, results/timeline.json
```

- `--cold N`: how many of the first runs start cold (default 1).
- `--label TEXT`: stored with every record, to say what changed ("after the font scan fix").
- `--prime N`: discarded launches per app first (default 1 on macOS, for its first-launch check).
- macOS cold runs need `sudo purge`: set `XB_PURGE_SECRET` to a file that holds the password, or
  allow `purge` without one in sudoers. Without either, results say `cache_dropped: false`.
- GPU runs need the Mac unlocked and nothing in front of the windows.

Every run appends one JSON line to `results/<suite>.jsonl`, with the machine, the date and the
commit of each framework. The comparison page reads those files, so runs from different days
show up as history.
