# ui-tree-window

## Shared native host

`host.runWindow` owns the native window, GPU surface, input adapter, accessibility
publication, inspector integration, frame requests, and presentation. It requires no
`loom` runtime. Implement `host.WindowClient<State, Errors, Requirements>` and pass
ordinary client state, a font collection, initial resource mutations, window options,
and an inspector. The app window package now adapts its existing runtime and custom
`WindowContent` hooks to this host.

Use `start` to create nodes with mutation batches and `pump` to consume tree events.
The default `layout` method calls `tree.frame`; clients that virtualize content must
reconcile range requests and settle another frame before it returns. `poll` collects
background work, `wakeAfter` bounds waits, and `nextDeadline` supplies timer deadlines
in seconds relative to host startup. `frame`, `scene`, and `draw` support custom GPU
composition. The host publishes accessibility geometry after client layout settles.

### Several windows

The window `runWindow` opens shows the first root. Every other root the client opens
(`Mutation.OpenRoot`) gets an OS window of its own, with its `RootOptions` title, size and
resizability; an `UpdateRoot` sets a new title or size, and `CloseRoot` closes the window.
Position, parent and kind are requests the window layer has no call for, so they are not
applied. A root whose window or surface cannot be made is closed again and gets a `Failed`
root event. The host's tree says so in `rootSupport` (`ExtraRoot.Window`); in the browser it
shows one root, as before.

Each window's events go to its root: input through `beginAt`, and its size, scale, focus,
appearance and close requests as root events (`reportWindowOf`). Closing such a window only
reports `CloseRequested`: the client closes the root or keeps it. The first window behaves as
before, and closing it ends the loop unless the client's `closing` keeps it. A window is framed
when its root needs it (`tree.needsFrameOf(root)`), through the client's `layoutRoot` hook
(`tree.frameRoot` by default), and only that root is laid out and painted.

All windows draw on the one render thread, with one GPU device and one set of atlas textures:
the render thread makes a surface per window (`RenderThread.openSurface`), takes each window's
frames (`submitTo`), and writes every frame's atlas pixels, in the order they were painted,
before it draws anything. The compositor's fast scrolling, accessibility publication and the
inspector's overlay serve the first window only; the others scroll through the tree and publish
no accessibility tree yet.

### A companion beside the client

`host.runWindowWith` takes a `companion.Companion` besides the client: a second client in the
same tree, on roots of its own, that the client never hears of. The in-process devtools are one
(ui-inspect-devtools' `embedded`); `runWindow` runs `NoCompanion`, and check mode runs none.

```silk
pub interface Companion {
  effect fn attach(self: &mut Self, tree: &mut UiTree<'_>, inspector: &mut Inspector) -> ()
  effect fn key(self: &mut Self, tree: &mut UiTree<'_>, inspector: &mut Inspector, input: &Input) -> bool
  fn owns(self: &Self, root: u32) -> bool
  fn dock(self: &Self, width: f32, height: f32) -> Option<Dock>
  effect fn pump(self: &mut Self, tree: &mut UiTree<'_>, inspector: &mut Inspector, time: f64) -> bool
  effect fn decide(self: &mut Self, tree: &mut UiTree<'_>, inspector: &mut Inspector) -> bool
  effect fn layout(self: &mut Self, tree: &mut UiTree<'_>, inspector: &mut Inspector, root: u32, input: FrameInput) -> ()
  fn nextDeadline(self: &Self) -> Option<f64>
}
```

- Every key press and release, in any window, goes to `key` first; true takes it from the
  tree and the client (a shortcut).
- Input that lands in a root the companion `owns` goes to its `decide`, not the client's, and
  its frames to its `layout`. The companion sets its roots aside in the tree, so the client's
  `takeEvents` never returns their records.
- `pump` runs once per turn of the loop, after the inspector, and whenever its root's window
  needs it. It gets the inspector, so the companion can be an inspector client with no socket
  (`Inspector.openLocal`) and hide its roots from it (`Inspector.hide`).
- A companion root shows in a window of its own, as any root, unless `dock` names it: then it
  has no window, and is drawn in the first one. The dock covers an `area` at the right or bottom
  edge; the client's first root is laid out in the rest of the window, which it sees as its
  window: its viewport, the `Resized` root event and `resize` hook, hit testing and pointer
  coordinates (the dock is at the far edges, so the origin stays). The companion's root is laid
  out at the whole window's size, with its content in `area`, and its scene is drawn over the
  client's (`sceneOf`). Pointer input in `area` goes to the companion's root, the rest to the
  client's; a press keeps going to the side it began on until the release, the side the pointer
  leaves hears `PointerLeave`, and a press moves the keyboard to its side. Compositor scrolling
  is blocked over the dock.

The [direct-tree counter](demo/src/main.silk) is a complete example with no app or
component framework dependency. It runs with the in-process devtools beside it, which it knows
nothing of (`SILK_UI_DEVTOOLS=window`, `dock` or `1`, or F12 with `SILK_UI_INSPECT` set). From
the repository root:

    silk task native demo modules/tree/window/demo
    silk task native demo modules/tree/window/demo -- --check

With `SILK_UI_HEADLESS=<script>` (debug builds) `runWindow` runs the client with no display
instead: `runHeadless` with a `HostPlatform.headless()` platform, no GPU (`startGpu` and
`launch` start nothing), frames drawn on the CPU and a clock that moves 1/60 s per turn.
Script lines are `ui-inspect-cli` commands served through a local inspector session, plus
`wait <time>`, `size` and `record`/`stop` (raw RGBA frames handed to ffmpeg). See
[headless.silk](src/headless.silk) and docs/content/native/testing.md.

    SILK_UI_HEADLESS=script.txt build/x86_64-unknown-linux-gnu/dev/ui-tree-window-demo

With `SILK_UI_BENCH=<frames>` (release builds too) `runWindow` runs the client for that many
frames with no window system, GPU or script (`runBench`) and prints on standard error what the
UI thread spent: the first frame from process start to layout, its layout and its paint, then
for every 120 frames the mean milliseconds of the app's tick, of layout (and the slowest) and
of paint, with the layout passes and boxes laid out. The clock moves 1/120 s a frame.

- `SILK_UI_BENCH_X`, `SILK_UI_BENCH_Y`: the pointer moves to that point (CSS pixels) halfway
  through, so one run has frames with the pointer outside and inside.
- `SILK_UI_BENCH_PAUSE=<ms>`: spins that long before the clock starts, for a sampler that
  attaches as the process starts.
- `SILK_UI_BENCH_HOLD=<ms>`: sleeps that long after the first frame and after the last, so
  `footprint`, `vmmap`, `heap` or `malloc_history` can look at the process at rest.
- `SILK_UI_BENCH_DIGEST=1`: digests of the first frame's layout (every box, every glyph where
  it draws, every text run), to check that two builds lay out the same; `dump` adds a line for
  each text fragment.
- `SILK_UI_BENCH_CENSUS=1`: after the first frame and at four later marks (`steady-a`,
  `inside-a`, `steady-b`, `last`), what the engine holds and did, one line a row, each line
  carrying its mark. A number above 1 also prints one every that many frames (phase `every`):

      census: phase=first frame=0 footprint=50355200
      census: phase=first frame=0 held tree.layout-table.links entries=4 capacity=4 each=28 used=112 reserved=112
      census: phase=first frame=0 unit tree.layout-table.nodes count=4
      census: phase=first frame=0 work css.tree.revision count=13

  `held` rows are containers: entries in use and room for `capacity`, `each` bytes an entry,
  so `used` and `reserved` bytes. `unit` rows count the document (nodes, lines, glyphs),
  `work` rows count work since the start. Rows come from every package: the type is
  css-properties' `census.Census` (re-exported as `ui_tree.census`), and each owner adds its
  own with `held`, `bytes`, `unit` or `work`. To add a container, add a row in its owner's
  `census` method: `UiTree.census` (modules/tree/src/engine.silk) calls the tree's own
  (`LayoutTable`, style pool, sheet cache, stacking, repair), css-layout's and css-style's
  (lib-css), ui-text's (`TextSystem.census`) and the scenes'; the JS host adds the
  engine's heap, pools and work counters (lib-silkjs `js_census`, through modules/js); and a
  client adds its own through `WindowClient.census`. Counters only: nothing changes what is
  laid out or painted.

    SILK_UI_BENCH=2400 SILK_UI_BENCH_X=520 SILK_UI_BENCH_Y=400 build/aarch64-apple-darwin/release/my-app-host-window

The check dispatches a click and Tab through the real input path, verifies the
updated text, and compares GPU output with the CPU reference. `--debug` builds a
development binary; `--build-only` compiles without opening a window.
The default renderer and the check use a white window background. CPU snapshots
also expose `renderSceneOver` for reference rendering with an explicit clear color.

## In the browser

The same host runs in a browser tab: a wasm32 build of the program draws on a canvas through
`navigator.gpu`, with modules/platform/window's browser backend for input and the input method.
From the repository root:

    silk task browser serve                       # the owned counter
    silk task browser serve --package /path/to/app/package
    silk task browser test --package modules/tree/window/demo --size 400,250 --click 90,35
    silk task browser build --package /path/to/app/package
    silk task browser test --package /path/to/app/package --stored notes

`silk task browser serve` builds the package for `wasm32-unknown-unknown` (release unless `--debug`) and prints
the page's address, by default http://127.0.0.1:8050/ (`--port` changes it). It needs WebGPU and
WebAssembly JSPI: Chrome or Edge 137 or later. The server reads the module on each request, so after
`silk task browser build` a reload shows the new build. Add `?check` to the address for the
rendering check of `--check`. `test` runs that check and then real input in installed
Chromium. Its options are `--click X,Y`, `--type TEXT`, `--size WIDTH,HEIGHT`, `--scale N`,
`--screenshot FILE`, and `--stored KEY`; `CHROMIUM_EXECUTABLE` selects a browser.
The host automation is Silk, while browser runtime modules remain JavaScript. Managed browser
tests require Darwin or Linux until [Silk #3034](https://github.com/silk-lang/silk/issues/3034)
adds the Windows subprocess capability; building and serving do not have that limitation.

How it differs from a native window:

- **One thread.** The host's loop runs in the module as it does natively. The page calls
  `main` through JSPI ([browser/app-host.js](browser/app-host.js)), so a wait for input
  suspends the module and gives the page its turn. Frames are drawn on the same thread by
  [render_inline.silk](src/render_inline.silk), which has `RenderThread`'s API; while WebGPU
  answers a request it yields to the page through the `silk_browser#yield` import. There is
  no platform thread and no compositor scroll: wheel scrolling goes through the tree.
- **The program brings its fonts and data.** There are no system fonts and no files; pass a
  bundled collection (for example `ui_fixtures.fixtures.fonts()`) to `runWindow`. The
  inspector is always off.
- **Text the app keeps goes to localStorage.** `browser.store(key, text)` keeps it and
  `browser.stored(key)` reads it back on the next visit (both do nothing natively). The page
  puts `silk-app:` before each key, and gives the app no storage in check mode, so a check
  always starts from nothing.
- **Screen readers read a hidden DOM copy of the tree.** [browser/access-mirror.js](browser/access-mirror.js)
  keeps one element per accessibility node over the canvas, with its ARIA role, name and
  states, from the updates [web_access.silk](src/web_access.silk) sends. A screen reader's click
  or focus on an element comes back to the app as an AccessKit action. The keyboard stays on the
  window host's text area, which names the focused node with `aria-activedescendant`. Pass
  `accessibility: false` to `runApp` to turn the copy off.
- **An 8 MiB stack.** Browser tasks set the compiler's declarative `stackSize` profile input to
  `8MiB` on every platform. No clang or shell wrapper is generated. The compiler's default 1 MiB
  stack is too small for deep layouts, which otherwise trap with "memory access out of bounds".
- **`main` takes no arguments.** Read `browser.checkRequested()` for `?check`, and print with
  `console.StderrWriter`: standard error natively, the browser console in the page.
- **Two modules in the program's own package.** A dependency exports no wasm symbols, so the
  program's package holds `generated_webgpu_exports.silk` (copied from the manifest-pinned
  `lib-native/modules/gpu/webgpu/browser` payload) and `libm.silk`,
  and imports both under `static if Intrinsic.targetArchitecture() == "wasm32"`. See
  [demo/src/main.silk](demo/src/main.silk) and
  [examples/notes/browser](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/notes/browser/src/main.silk).

To put an app on another page, serve the module with `app-host.js` and the two hosts it
imports, and call `runApp({ wasm, container })`.

The server resolves native payloads from `$SILK_HOME/git/<revision>`, as declared in the UI
manifests. No sibling source checkout is required. See the root README for stable virtual URL
prefixes and the public payload contract. `silk task generate-browser-exports`
refreshes the two owned export modules; `--check` compares them with the pinned template.

## Background images

`images.Images` queues file or HTTP(S) requests, decodes on native workers, installs
completed pixels in `UiTree`, and exposes loading/error states. Call `poll` from the
host loop while `pending()` is true. Replacement and cancellation reject stale
results. `release` cancels work and releases the installed resource. The request state
and generation checks come from portable `ui-tree.image_load` code; OS threads and
I/O stay in this native package.

`background.Background` and `Cancellation` are also available without `loom`.
Work and results must own transferable storage. Keep cancelled jobs until completion:
dropping an unfinished job joins the worker. Compatibility imports remain available
under `loom-window.background` and `loom-window.images`.

## Extraction validation

Validated on macOS arm64 with the pinned compiler: 31 tree tests, 11 app tests,
16 component tests, 5 inspector tests, and the native image-worker test pass.
Tree, inspector, app, and component goldens pass against current `main`. Tree tests cover crop
reuse, idle refinement, atlas eviction, and anchored popup placement.

The direct-tree counter passes its scripted input and CPU/GPU comparison. The
10,000-section scroll demo passes both its normal and growing-content GPU checks.
Core tree and app code check for wasm32. CPU scroll measurements are recorded in
[shared-primitives.json](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/scroll-demo/measurements/shared-primitives.json);
they exclude GPU work and presentation.
