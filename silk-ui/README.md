# Silk UI

Silk UI is the platform for building apps with [Silk](https://github.com/silk-lang/silk). You
choose what you write the app in (Loom, React, Foldkit or plain JS) and where it runs (a
desktop window, a browser canvas with WebGPU, or the browser DOM), and Silk UI puts it on
screen. This repository holds:

- **Silk UI**: the retained UI tree (`ui-tree`, `ui-protocol`, `ui-text`), the hosts for each
  target, the JS adapters as npm packages (`@silkui/core`, `@silkui/react`, `@silkui/foldkit`,
  `@silkui/vite`), and the inspector (`ui-inspect`). The front door is the `silkui` package:
  one dependency that builds and runs an app from its `tasks.silk`.
- **Loom**, the Elm-style UI framework written in Silk, with Loom Components and the DevTools
  (a Loom app), lives in [silk-lang/loom](https://github.com/silk-lang/loom). It is built on
  this repository: silkui's docs and benchmarks depend on it by Git like any other app.

JavaScript apps run on [SilkJS](https://github.com/silk-lang/lib-silkjs), embedded in the app.
The [Products](https://silk-ui-docs.juliaortiz-js.workers.dev/products/) page names every
product once.

## Get started

```sh
silk init my-app -t ui-react  # or ui-loom, ui-foldkit, ui-js
cd my-app
silk dev                      # opens the app in a window, reloading as you edit
silk build --release          # builds the release program into build/
silk build --release --out dist  # and copies it to dist/window/
```

The templates live in [silk-lang/examples](https://github.com/silk-lang/examples), and
[Get started](https://silk-ui-docs.juliaortiz-js.workers.dev/start/) walks through one. Each
project's `silk/tasks.silk` defines the app through [`silkui`](modules/silkui). The JavaScript
templates install the `@silkui/*` packages from npm.

## Documentation

The guides live in [`docs/`](docs/README.md) and are published from `main`. There are three:
Loom apps, native apps, and the UI tree, plus a [Products](docs/content/products.md) page.
Every example in them is a real program under `docs/examples`, tested by `docs/tests`.

```sh
docs/build.sh serve  # builds the site and serves it on http://localhost:8017
```

## Run a demo locally

Run commands from the **silkui repository root**, including when using a Git worktree.
The demo launcher builds the selected executable and opens its window; no workspace-wide
build or sibling repository checkout is needed.

With the Silk launcher (`silk`) installed, first install the compiler selected by `silk.toml`:

```sh
silk use
```

`silk update self` updates the launcher, not the compiler selected by this workspace.
If you see “workspace silk-version … is not installed”, run `silk use` in this checkout.

On **Apple Silicon macOS 26+**, use LLVM 22, its matching LLD, and the Xcode/macOS SDK.
For the versioned Homebrew toolchain, run these in the same terminal:

```sh
export SILK_CLANG=/opt/homebrew/opt/llvm@22/bin/clang
export PATH="/opt/homebrew/opt/lld@22/bin:$PATH"
export SDKROOT="$(xcrun --sdk macosx --show-sdk-path)"
"$SILK_CLANG" --version  # must report clang 22, not Apple clang
silk task native demo modules/tree/demo
```

Change `SILK_CLANG` if LLVM 22 is installed elsewhere. `SDKROOT` matters for CPU-only tools
and test executables too: without it, Silk dev.63 can use system-library stubs missing
`tanf`, `cosf`, `sinf` and `hypotf`, causing `ld64.lld: undefined symbol` errors.

On **Linux**, install LLVM 22 and the X11, xkbcommon, Wayland and wayland-protocols
development packages, set `SILK_CLANG` to the absolute LLVM 22 clang path, then run the
same demo command from a graphical desktop. Windows package builds require an x64 Visual
Studio developer environment and LLVM 22; managed native/browser task execution is blocked
by [silk#3034](https://github.com/silk-lang/silk/issues/3034), with no legacy-script fallback.

| Demo | Interactive command |
| --- | --- |
| Retained tree inbox | `silk task native demo modules/tree/demo` |
| Retained tree editor | `silk task native demo modules/tree/demo -- --editor` |
| Small window/counter | `silk task native demo modules/tree/window/demo` |

Close the window to return to the terminal. The first build fetches pinned dependencies
and prepares native libraries through Silk's manifest hooks.

For the small counter in Chrome/Edge with WebGPU and JSPI (137+), run
`silk task browser serve` and open the URL printed by the server.
Keep the server running; Ctrl+C stops it. Neither serving nor checks require Playwright.
Set `SILK_CLANG` to LLVM 22 before building. Browser checks use native Chromium through CDP;
set `CHROMIUM_EXECUTABLE` to select its executable.

`silk build` builds the workspace, including CLI tools, test executables and maintenance tasks;
it does **not** launch a demo. Commands containing `check`/`test` are automated verification.
`silk task setup-ci` provisions hosted CI; it is not local shell setup.

### Studio design editor

Studio lives in [julia-script/silk-studio](https://github.com/julia-script/silk-studio).
Follow its setup instructions, then run from the **silk-studio repository root**:

- Desktop: `node scripts/studio --release`
- Browser: `node scripts/browser serve`, then open <http://127.0.0.1:8050/> in Chrome/Edge 137+.

### Strict checks

Keep compiler warnings enabled and fix them. Remove genuinely unused imports and bindings.
Imports that register tests or browser C/wasm exports must retain that behavior; use explicit
intentional module bindings, not warning suppression or removal of test/browser coverage.

## Provenance and toolchains

Extracted without removing UI packages, fixtures, goldens, demos, inspector tools, or browser surfaces from `silk-lang/nonstd` commit `7d6c3693a9ad1fec24127985626ab4224f9f1995`. Packages live under `modules/`; public package names and import namespaces are unchanged. Studio lives in its own repository, linked above; it is a consumer, not a dependency of this repository.

Use Silk **0.1.0-dev.100+8f42b4e7342a** and LLVM **22.1.8**. `silk.toml` pins Silk; the official launcher installs and verifies that release. Repository maintenance uses typed, cached `silk task` commands. Browser runtime JavaScript remains runtime code, not task orchestration.

Hosted CI bootstraps Clang and the pinned Silk release before running any compiled task. The official installer is pinned to the compiler commit. `silk task setup-ci` invokes the exact native dependency's tasks; `--linux-gpu` provisions lavapipe and `--browser` selects Chromium. There are no old script entrypoints or Playwright compatibility aliases.

WebAssembly builds select an 8 MiB stack declaratively; no generated shell compiler wrapper is needed. No CI provisioning command is needed to serve a browser demo.

Linux native compilation needs X11, xkbcommon, Wayland, and wayland-protocols development headers; window checks additionally need Xvfb, xauth, Weston, and Vulkan/lavapipe. Windows native builds require the x64 Visual Studio developer environment and Windows SDK. macOS requires Apple Silicon macOS 26+ and `SDKROOT` set to `xcrun --sdk macosx --show-sdk-path`. Managed integration checks currently run on macOS/Linux; Windows lifecycle support is tracked in #3034.

Silk **0.1.0-dev.63+657e3c900f65** fixes Windows Git command paths and the launcher's
`SILK_HOME` representation ([silk#3025](https://github.com/silk-lang/silk/issues/3025)).
Tasks invoke the compiler selected by Silk through `Task.silk`; no direct compiler bypass
or relaxed Git NTFS protection is required.

Golden images include the corrected graphics border rasterization: underline-only tabs no
longer paint phantom side edges, and rounded border corners use opposite-winding contours.
Layout/text references and pixel tolerances are unchanged.

## Package boundaries

All 31 original UI workspace packages remain members of `silk.toml`:

| Role | Package paths |
| --- | --- |
| Consumable text and assets | `modules/text`, `modules/sprites`, `modules/assets` |
| Retained tree and platform hosting | `modules/tree`, `modules/tree/window` |
| Inspection APIs | `modules/inspect`, `modules/inspect/server` |
| Reusable demo/fixture libraries | `modules/tree/fixtures` |
| Developer applications (not library APIs) | `modules/tree/demo`, `modules/tree/window/demo` |
| Developer protocol and comparison executables | `modules/inspect/cli`, `modules/inspect/mcp`, `modules/text/tools/cli`, `modules/tree/browser` |
| Tests and golden runners (not library APIs) | `modules/inspect/tests`, `modules/inspect/server/tests`, `modules/tree/tests`, `modules/tree/window/tests` |

The manifests explicitly export consumable modules. Test-only packages declare their test module as the library entrypoint rather than inventing a runnable application. CLI executables and demos are developer tools, not dependencies of the API packages. Shared scenes, CPU/GPU rendering, vector graphics, codecs, and atlases remain in `lib-graphics`; native windows and WebGPU in `lib-native`; layout/styles in `lib-css`; parsing/shaping/rasterization in `lib-fonts`; SVG parsing/rendering in `lib-svg`. None are copied into this repository.

UI-to-UI dependencies stay local, except in the packages built with Loom (`docs`, `docs/examples`, `docs/live`, `docs/shots`, `docs/tests`, the Loom apps under `docs/examples/apps`, `modules/bench`, `modules/bench/web`, `modules/silkui/examples/loom`). Those pin silk-lang/loom and take every other package of this repository by Git at the commit that Loom pins, since a build can hold only one copy of `ui-tree`; moving Loom's pin means moving theirs (both `rev`s) too. External dependencies use canonical `https://github.com/silk-lang/NAME.git` URLs with exact 40-character revisions and package paths. Consumers must use these same revisions throughout their graph: Silk does not accept two physical checkouts of one named package.

## Building and checking

From this repository root, with the toolchain on `PATH`:

```sh
silk check --manifest-path modules/tree/window/silk.toml  # serial first Git fetch
silk check --workspace
silk build --manifest-path modules/inspect/cli/silk.toml
silk task check
silk task native check
silk task browser check
```

Standalone maintenance tasks need neither Node nor a sibling checkout:

```sh
silk task
silk task check-packages
silk task unit-tests
silk task goldens
silk task build-tools
silk task embed-assets --check
silk task generate-browser-exports --check
```

Windows managed-process tasks are blocked by [silk#3034](https://github.com/silk-lang/silk/issues/3034): the standard library does not expose live child pipes, exit observation, and termination there. These tasks report the unsupported capability; duplicate Python/Node implementations are not retained.

`check` checks every workspace package, the UI unit-test roots, the describe/PNG golden runners, the text/inspector/MCP CLIs, portable wasm APIs, and generated-file freshness. It does not update goldens. `native check` runs three rendering/input scenarios plus socket inspector and MCP interactions. (Loom's demos, the DevTools and the HTTP image test are checked in silk-lang/loom.) Linux runs X11 and Wayland (`--backend x11` or `--backend wayland` selects one). `browser check` compares Chrome text, browser fixture trees, and the counter's real input.

Individual entrypoints remain available:

```sh
silk task native demo modules/tree/demo -- --editor
silk task native inspect
silk task native mcp
silk task native demo modules/tree/window/demo -- --check
silk task browser serve
silk task browser test --width 400 --height 250 --click --click-x 90 --click-y 35
```


## Runtime resources and published browser payloads

No sibling checkout is needed. `src/task_support.silk` resolves external payloads from the exact Git revisions in UI manifests to `$SILK_HOME/git/<revision>` (default `~/.silk/git/<revision>`), rejecting missing or inconsistent pins. Run Silk first so the dependency checkout exists.

These paths are supported payloads for applications using the published Git revision:

- `modules/tree/window/browser/app-host.js` and `index.html` are browser runtime payloads.
- `silk task browser browser-tree-server --wasm APP.wasm --port 8050` serves an externally compiled module.
- `silk task browser parity [--only NAME] [--within PIXELS] [--chrome PATH]` replays the tree's parity cases in Chromium and lists where events, boxes, scrolling or focus differ (see modules/tree/README.md). Not part of `check`.
- `silk task browser test --package PACKAGE [--width W] [--height H] [--scale N] [--click --click-x X --click-y Y] [--typed TEXT] [--stored KEY] [--screenshot FILE]` builds and checks rendering, input, and optional localStorage/reload behavior.
- The page imports `/ui/tree/window/browser/app-host.js`; its imports retain `/native/platform/window/browser/window-host.js` and `/native/gpu/webgpu/browser/host.ts`. The server maps `/ui/tree/window/browser/` to this repository's `modules/tree/window/browser/`, and the two `/native/` prefixes to `modules/platform/window/browser/` and `modules/gpu/webgpu/browser/` in the manifest-pinned native checkout. Custom servers must provide the same distinct URL namespaces; `/modules/` is not a browser URL prefix.
- Browser application roots must import their own WebGPU export module, using the template `modules/gpu/webgpu/browser/generated_webgpu_exports.silk` from that same native revision and direct `webgpu`/`webgpu_sys` aliases. `silk task generate-browser-exports` refreshes the two owned roots; `--check` checks freshness. Silk browser tasks select an 8 MiB stack declaratively through the build profile.

UI fixture assets are owned under `modules/assets/assets` and embedded in `src/generated_assets.silk`. `silk task embed-assets [--check]` refreshes/checks them. `silk task generate-photos` authors procedural photos in Silk, using native ImageMagick 7 only for PNG/JPEG encoding; it is not a build dependency. Regeneration retains the scene geometry and formats but is not byte-identical to the previous Pillow renderer; existing committed photos are unchanged. Additional text-comparison fonts are owned under `modules/text/tests/fonts`; all Noto, Amiri, M+ and Roboto Flex OFL notices accompany their unchanged subset files. Unit tests and golden runners use repository-root working directories. Fonts/icons/photos needed by normal UI fixtures are embedded and do not depend on the working directory.

See [the UI guide](modules/README.md) and [inspection tools](modules/inspect/README.md). Loom, its components and the DevTools are documented in [silk-lang/loom](https://github.com/silk-lang/loom).
