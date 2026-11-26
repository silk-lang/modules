# ui-js

Runs a JavaScript application on a UI tree, with the [SilkJS](https://github.com/silk-lang/lib-silkjs)
engine embedded in the process. Five parts are here: the Silk host with its native bridge,
`@silkui/core`, the node and event API, `@silkui/react`, a React renderer on it, `@silkui/foldkit`,
which runs Foldkit programs on it, and `@silkui/vite`,
a Vite plugin that builds an application and, in development, replaces edited modules in
the running window.

To start an app, use a template: `silk init my-app -t ui-react` (or `ui-foldkit`, `ui-js`)
gives a project whose `silk dev` builds and opens it through [silkui](../silkui). This
page is the reference for the packages and the host underneath.

## @silkui/core

[packages/core](packages/core) is the node and event API. Its primitives are the tree's own (box,
text, input, image, canvas) and inline svg. Its methods and its event flow are the DOM's.

```js
import { createBox, createText, mount } from "@silkui/core";

const label = createText("Click me");
const button = createBox({ width: 180, height: 70, backgroundColor: "rgb(0, 100, 200)" }, label);
button.tabIndex = 0;
button.look("hover").set({ backgroundColor: "rgb(0, 120, 230)" });

let clicks = 0;
button.addEventListener("click", () => {
  label.data = "Clicked " + ++clicks;
});

mount(createBox({ width: 400, height: 300 }, button));
```

- **Nodes.** `createBox(style, ...children)`, `createText(data)`, `createInput(style)` and
  `createNode(kind)`. A node has `append`, `appendChild`, `insertBefore`, `removeChild`,
  `remove`, `parentNode`, `childNodes` and the sibling getters. `destroy()` frees a node and
  its subtree. `mount(node)` makes a node the root.
- **Style.** `node.style.set({ ... })` sets properties by their camel case names. Numbers are
  CSS pixels, except for unitless properties such as `opacity` and `flexGrow`. `null` takes a
  property out. `fontFamily` takes CSS `font-family` text (`"monospace"`, `"Noto Sans, sans-serif"`),
  resolved in the host's font collection. Grid layouts take the CSS grid properties
  (`gridTemplateColumns: "auto 1fr"`, `repeat()`, `minmax()`, named lines and
  `gridTemplateAreas`, `gridArea`, `gridColumn: "span 2"`); numbers for the placement
  properties are line numbers. Grid properties apply from the base look only. `node.look("hover")` (also `active`, `focus`, `focusVisible`) is the look the
  tree lays over the base in that state; `node.look("starting")` is what transitions start
  from when the node first shows. `defineKeyframes(name, { from: {...}, to: {...} })` defines
  `@keyframes` for `animation` styles.
- **Events.** `addEventListener(type, listener, options)` with `capture` and `once`. An event
  runs the capture phase from the root down, the target, then bubbles, with
  `stopPropagation`, `stopImmediatePropagation` and `preventDefault`. Listeners run before
  the tree's default action, so `preventDefault()` on a `pointerdown` keeps focus where it
  is, as on the web. Events carry the DOM members of their kind (`clientX`, `button`,
  `detail`, `shiftKey`, `key`, `code`, `deltaY`, `inputType`). An `input` event has the new
  `value`.
- **Rich inputs.** `createRichInput(style)` (or `createNode("richinput")`) edits a document
  of styled text and inline atoms: `{ text, marks: [{ start, end, marks: ["bold"] }], atoms:
  [{ kind, label, data }] }`. An atom (a mention, a chip) sits in `text` as one `OBJECT`
  character, so the caret steps over it and Backspace deletes it whole. `defineMark(name,
  style)` and `defineAtom(kind, style)` say what they look like; `document` reads and replaces
  the document; `format(name, on)` and `toggleMark(name)` mark the selection, or the text typed
  next at a caret; `insertAtom(start, end, atom)` replaces a range with an atom (a `@` trigger
  turning into a mention). Offsets are string indices. An `input` event also has `document`,
  and `activeMarks` holds the marks typed text gets. A `selectionchange` event (bubbling, as
  on the web) follows every caret or selection move and every change of `activeMarks`, with
  `selectionStart` and `selectionEnd`: listen for it to open a picker by a `@` the caret moved
  next to. Typing takes the marks before the caret;
  undo, IME and copy (which writes atom labels) work as in a plain input.
- **Attributes.** `setAttribute(name, value)` for the tree's attributes (`tabIndex`,
  `disabled`, `label`, `testId`, `placeholder`, `multiline`, `readOnly`, `checked`,
  `selected`, `expanded`, `focusTrap`, `href`, `cursor`, `transition`). A name the tree does
  not have throws a `TypeError`. `cursor` takes the CSS keywords (`pointer`, `text`, `grab`,
  `not-allowed` and the resize ones); the `cursor` style property does the same, and a node
  without one shows its nearest ancestor's.
- **Accessibility.** `role` and `aria-*` work as in the DOM, as `aria-label` or `ariaLabel`.
  `role` takes the first word that names a role the tree has (`"switch checkbox"`). The
  tree has the ARIA states and properties for names, values, levels, sets, toggles, validity
  and live regions (`aria-level`, `aria-pressed`, `aria-live`, `aria-checked="mixed"` and so
  on), and `aria-labelledby`, `aria-describedby`, `aria-controls` and
  `aria-activedescendant` name other nodes by their `id`. Other roles and ARIA names are
  ignored with one console warning each. `announce(message, { politeness })` has screen
  readers say a message that nothing on screen shows. `inert` puts a subtree out of reach of
  focus, pointers and screen readers, as in HTML.
- **Links.** A node with an `href` is a link, as an `<a>` is: a click on it or inside it that
  no listener prevented calls `open(href)`, which hands the address to the host.
- **Markdown.** `parseMarkdown(text, options)` returns the syntax tree of the text in
  the shape of [mdast](https://github.com/syntax-tree/mdast), the tree remark gives, so
  renderers written for remark's tree work on it, and an application needs no Markdown
  parser in its bundle. The parser is the Silk standard library's (`silk.markdown`):
  CommonMark with GitHub's tables, strikethrough, task lists and autolinks. `gfm: false`
  turns those four off, each can be set alone (`tables`, `strikethrough`, `taskLists`,
  `autolinkLiterals`), and `footnotes`, `frontmatter` (a `yaml` or `toml` node) and
  `alerts` (`> [!NOTE]`, a node of type `alert` with a `kind`) turn on more. Nodes have no
  `position`.
- **Errors.** A listener that throws does not stop the dispatch. `setErrorHandler` receives
  the exception. Without a handler the host reports the first one after the input.

### Virtual lists

The tree requests **sorted logical indices**, including any separately retained
focus, active-descendant or browse-cursor rows. Do not turn the first and last
indices into a contiguous range. Give the list a bounded height. `overscan` is
in CSS pixels above and below the viewport (JS default: 128).

With React, return ordinary JSX for each requested item:

```tsx
import { VirtualList } from "@silkui/react";

<VirtualList items={messages} itemKey={m => m.id} style={{ height: 480 }}
  estimatedRowHeight={48} rowHeight={m => m.collapsed ? 32 : "auto"}>
  {m => <box>{m.subject}</box>}
</VirtualList>
```

`rowHeight={32}` styles every mounted wrapper at 32 px and supplies the tree's
estimate. This uses the existing measured layout path, not a measurement bypass.
Pass `revision` when reordering data or invalidating cached measurements.

With plain JS, call `port.setVirtualList({ count, estimatedRowHeight, overscan,
gap, revision }, onRange)` on a bounded, scrolling flex column. In `onRange`,
reconcile direct child boxes by stable key, keep surviving nodes, then call
`port.bindVirtualRows(indices)` in child order. Give each row `flexShrink: 0`
and use `list`/`listitem` roles with logical position and total count. Pass
`null` to clear the controller without deleting the children.

Foldkit exposes `VirtualList(options, onRange)` and `VirtualRows(indices)` as
properties for the scroll container. Send requested indices into your model;
render one keyed child per index, and pass those same indices to `VirtualRows`
so the adapter binds the boxes after Foldkit patches its children.

## @silkui/react

[packages/react](packages/react) renders React components to the tree. Host elements are the
tree's node kinds, and strings in children become text nodes.

```jsx
import { useState } from "react";
import { createRoot } from "@silkui/react";

function Counter() {
  const [clicks, setClicks] = useState(0);
  return (
    <box
      tabIndex={0}
      style={{ width: 180, height: 70, backgroundColor: "rgb(0, 100, 200)" }}
      hoverStyle={{ backgroundColor: "rgb(0, 120, 230)" }}
      onClick={() => setClicks(clicks + 1)}
    >
      Clicked {clicks} times
    </box>
  );
}

createRoot().render(<Counter />);
```

- **Props.** `style`, and `hoverStyle`, `activeStyle`, `focusStyle` and `focusVisibleStyle`
  for the looks of those states. `startingStyle` is what transitions start from when the node
  first shows (CSS `@starting-style`). `onClick`, `onPointerDown`, `onKeyDown`, `onInput` and so
  on for every event of the tree, with a `Capture` suffix for the capture phase. Listeners
  receive the `@silkui/core` event. Every other prop is a tree attribute (`tabIndex`, `testId`,
  `label`, `disabled`, `placeholder`), and `role` and `aria-*` work as in React DOM.
- **Inputs.** `value` on `<input>` is controlled as in React DOM: the field shows what the
  component keeps, whatever was typed. `<richinput>` takes `marks` and `atoms` (name to
  style), and `document` controlled the same way (`defaultDocument` for an uncontrolled one):
  keep `event.document` from `onInput`.
- **Timing.** `root.render` commits before it returns, so the first frame of a window has
  the content. A state change in a click, key or input listener commits before the host
  applies the mutations, so the next frame shows it. Other updates go through React's
  scheduler on the host's timers.
- **JSX.** Set the JSX import source to `@silkui/react`, or use React's own runtime: both
  work.

[examples/react-counter](examples/react-counter) is a starter page in React where the counter
is the page: click anywhere and the number rolls, with rings, sparks and a field of dots
that answer the click and the pointer. The count and the theme are React state;
[motion.js](examples/react-counter/src/motion.js) draws every frame on nodes it gets by
ref. It is bundled with Vite into one ES module. From `modules/js`, `npm ci && npm run build`, then from the repository root:

```sh
silk run --manifest-path modules/js/demo/silk.toml modules/js/examples/react-counter/dist/app.js
```

[examples/text-showcase](examples/text-showcase) is a magazine in five spreads that shows the
tree's text layout (scripts, bidi, vertical writing modes, floats), each feature labelled, and
runs in a browser from the same files for comparison.

React 19.3 with react-reconciler 0.34 runs on the engine as it is: the bundle needs only
the web globals below.

## @silkui/foldkit

[packages/foldkit](packages/foldkit) runs [Foldkit](https://foldkit.dev) programs (the
Elm architecture on Effect) on the tree, with the `foldkit` package as it is published.
Foldkit has no renderer interface: its virtual DOM patches through `document`. So the package
provides a `document` and the DOM members Foldkit uses, and every element is a tree node.
Import it before `foldkit`:

```ts
import '@silkui/foldkit'
import { Runtime } from 'foldkit'
import { Model, init, update, view } from './main'

Runtime.run(Runtime.makeApplication({ Model, init, update, view, container: document.getElementById('root') }))
```

```ts
export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `Counter: ${model.count}`,
  body: h.div(
    [h.Style({ display: 'flex', gap: '12px', padding: '24px' })],
    [
      h.p([], [model.count.toString()]),
      h.button([h.OnClick(Message.ClickedIncrement()), HoverStyle({ color: 'rgb(0, 120, 230)' })], ['+']),
    ],
  ),
})
```

- **The page.** The document is `<html><body><div id="root">`, filling the window, so a
  program boots in `document.getElementById('root')` as it does from a browser's
  `index.html`. Foldkit puts the view's root element in its place.
- **Elements.** Every tag is a box, except `input` and `textarea` (the tree's input), `img`
  (image), `canvas` and `svg` (one node drawing its elements as markup). A tag brings what it means, not how a browser draws it:
  `button` and `a` take the focus and have their roles, `h1` to `h6`, `p`, `ul`, `ol` and
  `li` have theirs, and nothing has a default style.
- **Style.** `h.Style` with CSS values (`fontSize: '13px'`) and `h.Class` for adopted
  stylesheets. `HoverStyle`, `ActiveStyle`, `FocusStyle`, `FocusVisibleStyle`
  and `StartingStyle` from this package are the looks the tree lays over an element in those
  states, as attributes.
- **Events.** The `On*` attributes of the events the tree has: clicks, pointers, keys, focus,
  input, scroll, wheel, and the transition and animation ones. Mouse events arrive as the
  pointer events they are. For an event the tree does not have (drag and drop, clipboard,
  `change`, `submit`) the listener never runs, with one console warning.
- **Attributes.** `Id`, `Role` and the `Aria*` ones, `Tabindex`, `Disabled`, `Readonly`,
  `Placeholder`, `Value`, `Href` (a click opens it), `Hidden`, `Inert`, and `data-testid` as
  the tree's test id. Others are kept on the element (`getAttribute`, selectors) and do
  nothing else.
- **Mounts and Commands.** An element is `Element`-shaped where Foldkit and its `Dom`
  commands reach: `querySelector` with tag, `#id`, `.class` and `[attribute="value"]`
  selectors, `focus`, `closest`, `contains`, `textContent`. `element.node` is the
  `@silkui/core` node behind it, for code that draws on the tree itself. Layout reads
  (`getBoundingClientRect`) are not there.
- **Routing.** `location` and `history` keep an address in memory, starting at
  `http://localhost/`, where the realm has `URL` (the [SilkJS runtime](node) does).
- **Timing.** The first render is there for the window's first frame. After that Foldkit
  renders the Model in an animation frame, as in a browser.
- **Building.** `silk({ entry: "src/entry.ts", allow: provided })` with
  `provided` from `@silkui/foldkit/apis`, so the missing API report leaves out what this
  package provides. `vite build --watch` reloads the application on every change; the dev
  server's module replacement does not run Foldkit programs yet.

[examples/foldkit-counter](examples/foldkit-counter) is the starter page as a Foldkit
program, the React example's twin: the count, the streak and the theme are the Model, and
the same `motion.js` draws every frame, started by a Mount on the page element.

## Effect UI (`@silkui/core/globals`)

Standard DOM frameworks such as [Effect UI](https://ui.effect.website/) (`@effect/ui` and
`@effect/ui-kit`) run directly on `@silkui/core/globals` without a framework-specific
adapter. Import `@silkui/core/globals` before mounting and pass `html: true` to
`@silkui/vite` to load `@silkui/core/html.css` (the HTML user-agent default stylesheet)
before your app CSS.
[examples/effect-ui-showcase](examples/effect-ui-showcase) demonstrates Effect UI
components, Commands, Subscriptions, Providers, Queries, `@effect/ui-kit` primitives,
Tailwind CSS v4, a live `MessageLog` viewer, live `memoryUsage()` telemetry, and a native
`<canvas>` 2D synthesizer.

## @silkui/vite

[packages/vite](packages/vite) is the Vite plugin. A host evaluates one ES module, so the
plugin sets up a library build with a single output file and `process.env.NODE_ENV` from
the Vite mode. It knows no UI framework. For React, add `@silkui/react/vite` beside it: it
compiles JSX with the `@silkui/react` runtime, applies the reconciler's sibling-walk fix
(see [reconciler.js](packages/react/src/reconciler.js)), and adds Fast Refresh under the dev
server (`react({ refresh: false })` turns it off).

```js
import { defineConfig } from "vite";
import silk from "@silkui/vite";
import react from "@silkui/react/vite";

export default defineConfig({
  plugins: [silk({ entry: "src/main.jsx", host: { command: "path/to/host" } }), react()],
});
```

`vite build` writes `dist/app.js`, the bundle a host runs in production.

### APIs the runtime does not have

A realm has ECMAScript with `Intl`, the web globals below and `@silkui/core`: no `fetch`,
`document` (`@silkui/core/globals` brings it, with `URL`), `process` or Node modules. Libraries written for browsers or Node often expect
them, so the plugin reads every module of a build and reports the ones that are used, and
by whom:

```
APIs used here that a ui-js runtime does not have:
  fetch (network): src/api.js, ky
  WebSocket (network): some-client
  node:fs (node): some-package
```

- A name counts when a module reads it as a global. A `typeof` test for it, a local of the
  same name, `process.env.NAME` and a `require("…")` the bundler resolves do not count.
- `apis: "error"` fails the build instead, `apis: "off"` turns the report off, and
  `allow: ["fetch"]` leaves out names the application provides itself.
- Under the dev server the warning comes when the module is first served.
- At run time, the window host adds a line of explanation to an uncaught
  `ReferenceError: … is not defined`.

The areas in parentheses are the units a build will choose from, once the engine's
features can be picked for each build.

### Development: `vite`

Under the dev server the host runs the application's modules as Vite serves them, and an
edit replaces only the modules it touches:

- With `@silkui/react/vite`, a component file (every export is a React component) is
  swapped where it is with React Fast Refresh. Component state and the rest of the
  application stay as they were.
- Any other module passes the update on to its importers. When nothing accepts it, the
  window gets a new realm and the application starts again.
- `import.meta.hot` works as in Vite: `accept`, `dispose`, `invalidate`, `data`.
- A build error is printed and the running application is left alone.

With `host` set the plugin starts that binary with `--dev <port>`; without it, it prints
the port for a host you start yourself. Closing the window ends the session.

How it works: the plugin adds a Vite environment named `silk` and listens on a local TCP
port. The host connects when its window opens (`DevTools.server(port)`), and the server sends one
script first: Vite's module runner, bundled, with the host's line transport under it
(`__ui.devSend` out, `__ui.devMessage` in). The runner asks the server for each module,
already transformed, and evaluates it in the realm. Dependencies are pre-bundled by Vite,
so CommonJS packages such as React load as ES modules. The host needs no module resolution
of its own.

### Development without the dev server: `vite build --watch`

`vite build --watch --mode development` rebuilds the bundle on every change; with `host`
set, the plugin starts that binary with `--watch <bundle>` after the first build, and the
window reloads the whole application after each later one: the plugin writes
`<bundle>.stamp` after a successful build, the window host looks at that file five times a
second (`JsApp.watch`), and when it changed the host destroys the application's nodes,
starts a new realm and runs the new bundle. JavaScript state does not survive. This is
the same code path as production, so it is the mode to check a bundle in.

For the React example, from `modules/js/examples/react-counter`:

```sh
silk build --manifest-path ../../demo/silk.toml --optimization none
export SILK_UI_HOST=$PWD/../../../../build/<target>/dev/ui-js-demo
npm run dev     # dev server, Fast Refresh
npm run watch   # rebuild and reload
```

The `dev` profile is the development host with optimizations on. Use it for JavaScript
work: in a plain debug build the engine itself is unoptimized, and JavaScript runs tens of
times slower (the starter page's motion drops well under 60 frames a second there).
`ui-js-bench-frames <bundle>`
([bench/frames](bench/frames)) prints what a frame of an application costs in JavaScript,
in applying its mutations and in the tree, without a window.

## The host

JavaScript runs on the thread that owns the tree.

```silk
let mut host = run JsHost.open(&memory, domain.handle())
run host.define(b"@silkui/core", package)
run host.module(source, b"app.js")
run host.flush(&mut tree)
run host.input(&mut tree, Input.press(10.0, 50.0))
run host.close()
```

Provide the `RuntimeAllocator` that `memory` observes as the `Allocator` of these calls.

- **Scripts and modules.** `evaluate` runs a script. `module` runs an ES module, and its
  imports load from the sources given to `define`. Relative specifiers resolve against the
  importing module's name. A bundler can also produce one script, which needs no `define`.
- **Promise jobs.** The host runs queued promise jobs after a script, after a module, and
  after each event it delivers, before the mutations reach the tree.
- **Nodes.** JavaScript calls native functions on the global `__ui` (`create`, `append`,
  `insertBefore`, `remove`, `destroy`, `root`, `setText`, `listen`, `style`, `clearStyle`,
  `attribute`, `focus`, `scrollTo`, `select`, `fontFamily`). Each call appends a mutation to one
  ui-protocol batch and returns. `JsHost.flush` applies the batch to the tree. `style` takes
  CSS text and parses it with css-style, so every property the tree knows is available.
- **Events.** `JsHost.input` runs one input: the tree queues its event records (`begin`), the
  host calls `__ui.dispatch(kind, target, a, b, modifiers, d, e, first, second)` for each,
  the tree runs or skips the default action depending on whether a listener prevented it
  (`finish`), and the mutations the listeners made are flushed. `kind` is the bit position
  of the event in the ui-protocol `LISTEN_*` flags. The numbers and strings depend on the
  kind, and `numbersOf` in [src/host.silk](src/host.silk) lists them.
- **Errors.** An uncaught exception fails the call with a `JsError` that carries its message.
  The host stays usable, and an input that failed in JavaScript still finishes in the tree.

## Web globals

Every realm starts with the globals of [src/prelude.js](src/prelude.js) on top of the
engine's ECMAScript: `setTimeout`, `setInterval`, `requestAnimationFrame`, `queueMicrotask`,
`performance.now`, `console`, `reportError`, `open` and `navigator.clipboard` (`readText` and
`writeText`). They sit on native timer, clock, frame and log functions, and the host decides
what those mean:

- `JsHost.tick(seconds, animation)` moves the clock, runs the timers that are due, and with
  `animation` the frame callbacks. `nextDeadline` and `wantsFrame` tell a loop when to wake.
- `JsHost.takeLogs` hands over the console lines.
- A promise that is still rejected with no handler once the promise jobs ran becomes a
  console error, `Uncaught (in promise) …`, as in a browser. A handler added later is too
  late. A module that fails is reported by `JsHost.module` alone.
- `JsHost.takeOpened` hands over the addresses `open(url)` asked for (http, https and mailto
  only). The window opens them with `xdg-open` on Linux and `open` on macOS, without waiting
  for it; other systems print that they could not.
- `JsHost.takeClipboard` hands over the `navigator.clipboard` calls, and
  `JsHost.answerClipboard` settles each one. Both windows do them on the system clipboard
  once the code that asked has run, so a copy button works from any listener, timer or
  promise job. A host that has no clipboard leaves the promises pending.
- Desktop calls from `@silkui/core` (`new Notification`, `setTray`, `registerShortcut`,
  menus, dialogs, `appWindow`, `openExternal`, `startFileDrag`) go
  the same way: `JsHost.takeShell` hands them over (`ShellRequest` says how each packs its
  arguments) and `JsHost.answerShell` settles them. Both windows serve them on the
  platform (`ui_js_window.shell`). File drags, global shortcuts, tray clicks and
  notification clicks, menu choices, closed dialogs and context menus, full screen and page
  zoom changes come back through `JsHost.shellEvent`; the window aims a drag at the
  node under it.

`silk task embed-assets` regenerates `src/generated_prelude.silk` after an edit to
`prelude.js`.

## WebGPU in a canvas

In a window, `navigator.gpu` and a canvas node's `getContext("webgpu")` follow the
[W3C WebGPU API](https://www.w3.org/TR/webgpu/), so code written for a browser canvas runs
as it is:

```js
import { createNode, mount } from "@silkui/core";

const canvas = createNode("canvas");
canvas.width = 480; // the drawing size in pixels; `style` gives the size on screen
canvas.height = 360;
mount(canvas);

const adapter = await navigator.gpu.requestAdapter();
const device = await adapter.requestDevice();
const context = canvas.getContext("webgpu");
context.configure({ device, format: navigator.gpu.getPreferredCanvasFormat() });
// ... pipelines and passes into context.getCurrentTexture().createView() ...
```

[examples/webgpu-canvas](examples/webgpu-canvas/app.js) draws a triangle and reads a pixel
back; run it with `silk run --manifest-path modules/js/demo/silk.toml -- modules/js/examples/webgpu-canvas/app.js`.
[examples/three-canvas](examples/three-canvas/src/main.js) is three.js with its WebGPU
renderer (`three/webgpu`), unchanged: `npm run build` there, then run `dist/app.js` the same
way. Its Vite config defines `self` as `globalThis`, which three.js reads
`requestAnimationFrame` from.

How it works:

- The application draws on a GPU device of its own, apart from the one that draws the
  window. A canvas that takes long to draw does not slow the rest of the interface, and a
  frame it presents shows at the window's next refresh without a frame of the UI.
- [src/webgpu.js](src/webgpu.js) is the API. It is evaluated on first use, and every call
  writes a command into a stream of bytes (`ui_js_gpu.wire` lists them). Objects are numbers
  JavaScript picks, so no call waits for the GPU.
- When the JavaScript turn ends, the window takes the stream (`JsHost.takeGpuCommands`) and
  the GPU service (`ui_js_gpu.service`, [gpu/](gpu)) runs it, presents each canvas whose
  current texture was taken, and answers the calls that return promises
  (`JsHost.answerGpu`). A command the GPU refuses is dropped alone: its promise rejects, or
  the device gets an `uncapturederror` event.
- A host turns it on with `JsHost.enableGpu`; without that `navigator.gpu` is undefined. The
  window does it for every application, and makes the device only when one asks for it.

- A present of a `bgra8unorm` canvas (what `getPreferredCanvasFormat()` answers) stays on the
  GPU where both devices can share images (macOS): the canvas draws into a swap chain of
  IOSurfaces that the window's device samples after the application's fences
  ([gpu_canvas.silk](../tree/window/src/gpu_canvas.silk)). A canvas nothing covers, with a
  rectangular clip, can also show in a compositor layer of its own, whose frames do not draw the
  window ([canvas_layer_plan.silk](../tree/window/src/canvas_layer_plan.silk)). That is opt-in
  for now: `SILK_UI_CANVAS_LAYERS=on`. An `rgba8unorm` canvas, and every canvas on other
  systems, copies the frame through the CPU.

What is not there yet: query sets, render bundles and external textures throw, compilation
info is always empty, and `copyExternalImageToTexture` takes `ImageData` only. The canvas
formats are `rgba8unorm` and `bgra8unorm`.
On the web canvas target ([web](web)) `navigator.gpu` is the browser's own, and a canvas
node's `getContext("webgpu")` is the browser's context of a canvas outside the document, so
the same bundle runs there: see "WebGPU in a canvas" in [web/README.md](web/README.md).

`silk task embed-assets` regenerates `src/generated_webgpu_api.silk` after an edit to
`webgpu.js`.

## In a window

[window](window) is `ui-js-window`: `JsApp` and `JsClient`, a client of the window host
(`ui-tree-window`). It runs the entry module at start, delivers event records between the
tree's `begin` and `finish`, runs timers and animation frames on the host's clock, and
prints console lines on standard error. An uncaught exception is printed as a browser
console prints it, and the window keeps running.

The window client takes the host's tools as a type: `JsClient.make(NoTools {})` runs the
application as it was built, and `JsClient.make(DevTools.make())` adds the development ones
from [window/dev](window/dev) (`ui-js-window-dev`): `DevTools.watch` for `--watch`,
`DevTools.server` for the dev server. Only a client with `DevTools` serves the inspector
(`WindowClient.servesInspector`).

[demo](demo) is the starter page in plain JavaScript, the React example's twin. Its window
has a transparent title bar (`JsClient.titleBar`, `titleBarHeight`): on macOS the page
reaches the top edge and the window controls sit over the bar it draws; other systems keep
their title bar. A press moves the window where the pressed element or its nearest ancestor
that sets `app-region` (or `-webkit-app-region`) says `drag`, as Electron decides.

```sh
silk run --manifest-path modules/js/demo/silk.toml
```

`@silkui/core` and the starter page are part of the binary (`uiPackage()` from `ui_js.lib` and
`Source.read("app.js")`), so the executable runs from any directory. After an edit to
`packages/core/src/index.js`, `silk task embed-assets` regenerates
`src/generated_library.silk`. `silk task native check` runs the demo with `--check`.

### Production builds

A production build leaves out everything that is there for development: the dev server
client, `--watch` reloading, and the inspector server. The demo's `production` profile
builds [demo/src/production.silk](demo/src/production.silk), which runs `NoTools` and
passes an inspector that is off; since its client answers `servesInspector` with a
constant false, the window host's inspector code is not in the program either.

```sh
silk task --manifest-path modules/js/demo/silk.toml production --release
```

Engine features are chosen per build too. The bridge answers `EngineServices.includesIntl`
with true and `includesTemporal` with false: a realm has `Intl`, as pages expect, and the
engine's Temporal code and time zone tables are left out, so a local `Date` string ends at
its offset. WebAssembly is not part of
the engine here (it lives in the SilkJS runtime, which ui-js does not link).

### Bytecode images

A production host need not parse its bundle at every launch. `JsHost.writeImage(source,
name)` compiles a module into a bytecode image without running it (its imports must be
defined), and `JsHost.moduleFrom(image, source, name)` starts the module from that image
when the engine build linked into the program is the one that wrote it, and from `source`
otherwise. `JsHost.defineImaged` does the same for a module the entry imports, such as
`@silkui/core`. The engine reads each function's code from the image when the function is
first called, so the image must live as long as the realm: `moduleFrom` and `defineImaged`
take bytes embedded in the program (`&'static`), and `moduleFromHeld` is the unsafe form
for bytes the caller keeps alive itself.

```silk
// build time, in a program that links the same engine as the host
run host.define(b"@silkui/core", uiPackage())
let image = run host.writeImage(source, b"app.js")

// launch
let fromImage = run host.moduleFrom(app_image.data, app_bundle.data, b"app.js")
```

An image is tied to the engine build: `imageLoadable(bytes)` says whether this build can
load it, and `imageBuild(bytes)` and `engineBuild()` give the two build numbers. Images are
trusted input, so only the app's own build should write them. `silkui` does all of this for
a generated host (`silkui_window.image` is the build step; see
[silkui's README](../silkui/README.md)). In a window, `JsApp.entryImage` and
`JsApp.defineImaged` hand the images over, a reload goes back to source, and
`SILK_UI_TRACE_JS=1` says on standard error what the entry started from. An image from
another engine build is always reported there, traced or not.

## On the web canvas

[web](web) (`ui-js-web`) runs the same bundle in a browser: the tree compiled to WebAssembly
draws on a canvas and the application runs on the browser's JavaScript engine, through a
second implementation of the `__ui` natives. Foldkit bundles add `define: pageGlobals` from
`@silkui/foldkit/apis`. See [web/README.md](web/README.md) for how it works and its first
frame numbers.

```sh
silk task browser serve --app modules/js/examples/plain-counter/dist/app.js
```

## Status

- Tests: `silk test --manifest-path modules/js/tests/silk.toml --root src/tests.silk` from the
  repository root for the host, `npm test` in `modules/js` for the JavaScript packages
  against a stand-in for the native functions, and
  `silk test --manifest-path modules/js/examples/tests/silk.toml --root src/tests.silk` for
  the bundled examples on the engine (build them first).
- Memory, release builds on Linux x86-64 under Xvfb with a software GPU, resident after six
  seconds: the Silk window demo 155 MB, the JavaScript counter 169 MB, the React counter
  174 MB. The GPU stack is most of each; the engine with `@silkui/core` adds about 14 MB and
  React about 5 MB more.

### Selector identity

Core nodes expose a string `id`, `className`, a live `classList` (`add`, `remove`,
`toggle`, `contains`, `replace`), and `getAttribute`, `hasAttribute`, and
`removeAttribute`. `setAttribute` accepts `data-*`, `aria-*`, `lang`, and `dir`;
empty strings and `"false"` are present values, while null removes the attribute.
React passes `className`, `id`, `data-*`, and `aria-*` props through. Foldkit's
existing class and data attributes reach the same native nodes.

The numeric handle formerly exposed as `node.id` is now the read-only
`node.nodeId`. Use it with `nodeById` and low-level host calls; changing the CSS
`id` does not change that handle or event routing. Existing accessibility
relations continue to resolve by the string id.

CSS imports processed by `@silkui/vite` are compiled and adopted by the native tree.
Production sheets embed local font assets, including Vite public-directory fonts.
Development sheets use the Vite asset server; CSS and font edits preserve the mounted
application. Middleware-mode integrations that serve fonts must set `server.origin`.
See the [stylesheet guide](../../docs/content/core/stylesheets.md) for adoption APIs,
runtime loading, and supported CSS.
