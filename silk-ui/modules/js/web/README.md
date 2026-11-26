# ui-js-web

Runs a JavaScript application on the web canvas target: the tree and window host compiled to
WebAssembly, drawing with WebGPU, and the application on the browser's own JavaScript engine.
The same `app.js` that `@silkui/vite` builds for a window runs here unchanged, for plain
`@silkui/core`, React and Foldkit apps alike.

```sh
cd modules/js/examples/plain-counter && npm run build && cd -
silk task browser serve --app modules/js/examples/plain-counter/dist/app.js
```

`--app` builds [app](app) (`ui-js-web-app`, the generic wasm client) and serves it with the
bundle at `/app.js` and the page [browser/index.html](browser/index.html).

## How it works

[browser/js-host.js](browser/js-host.js) is a second implementation of the `globalThis.__ui`
natives that `@silkui/core` calls. Each call is appended to a byte buffer (opcode, ids as
u32, numbers as f64, strings as UTF-8); the wasm client pulls the buffer through
`silkui#pending` and `silkui#take`, decodes it into ui-protocol mutations
([src/wire.silk](src/wire.silk)) and applies them to the tree. Event records go the other way
through `silkui#dispatch`, one call per record between the tree's `begin` and `finish`, and
its result is the record's prevented flag. Two suspending imports (JSPI) let the loop wait for
JavaScript: `silkui#ready` until the app module has run, and `silkui#settle` for the
microtasks after a dispatch, so a React commit lands in the same frame as its event.
JavaScript never calls into the loop; the two exports, `silkui_markdown` and `silkui_svg_measure`, are pure.

The attribute and event-string helpers are shared with the native host in
[../calls](../calls) (`ui-js-calls`), so both hosts accept the same attributes.

Timers and `requestAnimationFrame` are the browser's own. A call made outside a turn (a timer,
a fetch, an animation frame) asks the window host for a frame, so a change made in an
animation frame callback is painted one frame later than in a window.

## WebGPU in a canvas

`navigator.gpu` is the browser's own here, and a canvas node's `getContext("webgpu")` gives
the browser's `GPUCanvasContext` of an `OffscreenCanvas`, so an application draws as in a
window: on a device of its own, apart from the one that draws the interface.
[examples/three-canvas](../examples/three-canvas/src/main.js) runs unchanged:

```sh
cd modules/js/examples/three-canvas && npm run build && cd -
silk task browser serve --app modules/js/examples/three-canvas/dist/app.js
```

The picture has to reach the renderer's device, which is another one. `__ui.gpuLoad`
([browser/js-host.js](browser/js-host.js)) wraps the context: `configure` tells the tree
which surface the node shows (`surface` on the wire, `Mutation.SetCanvasSurface`), and the
first `getCurrentTexture` of a turn asks the window for a frame (`canvasFrame`) and has
`PageCanvases` ([page-canvases.mjs](../../tree/window/browser/page-canvases.mjs)) take the
picture once the code that draws it has run. Before each frame the renderer asks for the
textures that are new (`silk_browser#canvas_sync`, `render_inline.silk`).

A picture crosses in one of two ways. `copyExternalImageToTexture` from the canvas stays on
the GPU; Chromium on a software Vulkan copies an empty picture that way, so the first canvas
tries it once with a picture it knows. Until the answer is there, and where it is no, the
picture is read back on the application's device and written into the renderer's texture,
which shows it a frame or two later. CI runs headless Chromium on lavapipe, where the
answer is no and only the read back path runs. Headless Chrome on an Apple GPU (Metal)
answers yes: the three.js example then shows the same picture as with the read back path,
pixel for pixel (checked in November 2026 by reading the window's texture back).

A canvas keeps its surface and texture until the page goes away, also after its node is
destroyed.

## Foldkit

The browser's `document` and DOM classes cannot be replaced, so a Foldkit bundle renames them
at build time: `@silkui/foldkit/apis` exports `pageGlobals` for Vite's `define`, which points
`document`, `Node`, `Element`, `MutationObserver`, `getComputedStyle` and the rest at the
ones `@silkui/foldkit` puts on `globalThis.__silkuiDom`. The same bundle still runs in a
window (see [foldkit-counter](../examples/foldkit-counter/vite.config.js)).

## First frame

Measured 2026-11-15 in headless Chromium with a software GPU (SwiftShader) on 4 cores, served
from localhost, time to the first presented frame:

| App | Web canvas | react-dom build |
| --- | --- | --- |
| Silk tree demo (no JS) | 185 ms | |
| plain counter | 187 ms | |
| React starter | 418 ms cold, 398 ms warm | 52 ms cold, 46 ms warm |
| Foldkit starter | 398 ms | |

The bridge itself costs next to nothing (plain counter against the Silk demo). Most of the
time is V8 compiling the 8.65 MB wasm code section on first use (the module is 11.2 MB,
3.4 MB gzipped), then the first layout and render; Chromium kept no compiled code for warm
visits. Shrinking the module (wasm-opt, leaving features out of the generic client) is the
lever, not the JS side.

## Tests

`silk test --manifest-path modules/js/web/tests/silk.toml --root src/tests.silk` encodes calls
as `js-host.js` does and checks the tree they produce.
