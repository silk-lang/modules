# @silkui/foldkit

Runs [Foldkit](https://foldkit.dev) programs (the Elm architecture on Effect) on the
[Silk UI](https://github.com/silk-lang/SilkUI) tree, for apps that run on the SilkJS engine
embedded in a Silk UI program. It works with the `foldkit` package as it is published.
Foldkit has no renderer interface, since its virtual DOM patches through `document`, so this
package provides a `document` and the DOM members Foldkit uses, with every element a tree
node.

## Install

The quickest start is the Foldkit template:

```sh
silk init my-app -t ui-foldkit
cd my-app
silk dev
```

See [Get started](https://silk-ui-docs.juliaortiz-js.workers.dev/start/). To add it to an
existing Silk UI web project:

```sh
npm install @silkui/foldkit @silkui/core foldkit effect @effect/platform-browser
npm install -D @silkui/vite vite
```

## Usage

Import the package before `foldkit`, then boot the program in `#root` as from a browser's
`index.html`:

```ts
// src/entry.ts
import "@silkui/foldkit";
import { Runtime } from "foldkit";
import { Model, init, update, view } from "./main";

Runtime.run(Runtime.makeApplication({ Model, init, update, view, container: document.getElementById("root") }));
```

```ts
// src/main.ts (the view)
import { HoverStyle } from "@silkui/foldkit";

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: `Counter: ${model.count}`,
  body: h.div(
    [h.Style({ display: "flex", gap: "12px", padding: "24px" })],
    [
      h.p([], [model.count.toString()]),
      h.button([h.OnClick(Message.ClickedIncrement()), HoverStyle({ color: "rgb(0, 120, 230)" })], ["+"]),
    ],
  ),
});
```

In `vite.config.js`, pass `provided` to `silk()` so the build's missing API report leaves out
what this package provides:

```js
import { defineConfig } from "vite";
import silk from "@silkui/vite";
import { provided } from "@silkui/foldkit/apis";

export default defineConfig({ plugins: [silk({ entry: "src/entry.ts", allow: provided })] });
```

## API

| Export | What it does |
| --- | --- |
| `import "@silkui/foldkit"` | Installs `document`, `window`, `location`, `history` and the DOM classes Foldkit uses |
| `document` | The same document, as an export |
| `HoverStyle(style)`, `ActiveStyle`, `FocusStyle`, `FocusVisibleStyle` | Attributes for the looks the tree lays over an element in those states (`:hover`, `:active`, `:focus`, `:focus-visible`) |
| `StartingStyle(style)` | What transitions start from when the element first shows (`@starting-style`) |
| `provided` from `@silkui/foldkit/apis` | The names this package provides, for `silk({ allow })` |
| `pageGlobals` from `@silkui/foldkit/apis` | For `define` in a Vite config, when the bundle also runs on the web canvas, where the page's own `document` would win |

### How the page behaves

- **The page.** The document is `<html><body><div id="root">`, filling the window. Foldkit
  puts the view's root element in place of `#root`.
- **Elements.** Every tag is a box, except `input` and `textarea` (the tree's input), `img`
  (image, with `h.Src` a `data:` URL, a file or an `http(s):` address; an SVG draws as inline `<svg>`
  does), `canvas`, and `h.svg` with its `h.path`, `h.circle` and the rest: the whole `<svg>`
  is one node, its `currentColor` is its `color`, and
  the elements inside are its markup, so classes, styles and events go on the `<svg>`. A tag brings what it means, not how a browser draws it:
  `button` and `a` take the focus and have their roles, `h1` to `h6`, `p`, `ul`, `ol` and
  `li` have theirs, and nothing has a default style.
- **Style.** `h.Style` takes CSS values (`fontSize: "13px"`). `h.Class` matches rules in
  imported CSS, including Tailwind output. Stylesheets can use state selectors such as
  `:hover`; the look attributes above also remain available.
- **Events.** The `On*` attributes of the events the tree has: clicks, pointers, keys, focus,
  input, scroll, wheel, transitions and animations. Mouse events arrive as the pointer events
  they are. For an event the tree does not have (drag and drop, clipboard, `change`,
  `submit`) the listener never runs, with one console warning.
- **Attributes.** `Id`, `Role` and the `Aria*` ones, `Tabindex`, `Disabled`, `Readonly`,
  `Placeholder`, `Value`, `Href` (a click opens it), `Hidden`, `Inert`, and `data-testid` as
  the tree's test id. Classes, `data-*`, `aria-*`, `lang`, and `dir` also reach native
  stylesheet matching. Other attributes remain available through `getAttribute` and
  the document's selectors.
- **Mounts and commands.** Elements support `querySelector` with tag, `#id`, `.class` and
  `[attribute="value"]` selectors, `focus`, `closest`, `contains` and `textContent`.
  `element.node` is the `@silkui/core` node behind it, for code that draws on the tree
  directly. Layout reads (`getBoundingClientRect`) are not there yet.
- **Routing.** `location` and `history` keep an address in memory, starting at
  `http://localhost/`, where the realm has `URL`.
- **Timing.** The first render is there for the window's first frame. After that Foldkit
  renders in an animation frame, as in a browser.
- **Development.** `vite build --watch` reloads the app on every change. The dev server's
  CSS replacement updates the native stylesheet while preserving the running Foldkit
  program and its model. Application-module replacement does not preserve Foldkit models yet.

## TypeScript

The package ships its types, and adds `node` to the DOM `Node` interface. Keep `"DOM"` in
`lib` in `tsconfig.json`, as Foldkit's own types need it.

## Requirements

`foldkit` 0.170 or newer.

## More

- [The ui-js reference](https://github.com/silk-lang/SilkUI/blob/main/modules/js/README.md#silkuifoldkit)
  and [`@silkui/core`](https://www.npmjs.com/package/@silkui/core).
- [The Foldkit template](https://github.com/silk-lang/examples/tree/main/ui-foldkit).
- [Source](https://github.com/silk-lang/SilkUI/tree/main/modules/js/packages/foldkit). MIT license.
