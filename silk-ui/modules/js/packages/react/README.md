# @silkui/react

A React renderer for the [Silk UI](https://github.com/silk-lang/SilkUI) tree, for apps that
run on the SilkJS engine embedded in a Silk UI program. Components render to the tree's own
nodes (`<box>`, `<input>`, `<richinput>`, `<img>`, `<canvas>`, inline `<svg>`), not to a DOM, and
React itself runs unmodified. It is a reconciler only: React is your app's own dependency.

## Install

The quickest start is the React template:

```sh
silk init my-app -t ui-react
cd my-app
silk dev   # opens the window; edits keep component state (Fast Refresh)
```

See [Get started](https://silk-ui-docs.juliaortiz-js.workers.dev/start/). To add it to an
existing Silk UI web project:

```sh
npm install @silkui/react @silkui/core react
npm install -D @silkui/vite vite @types/react
```

## Usage

```tsx
import { useState } from "react";
import { createRoot } from "@silkui/react";

function Counter() {
  const [clicks, setClicks] = useState(0);
  return (
    <box
      tabIndex={0}
      style={{ paddingTop: 12, paddingBottom: 12, paddingLeft: 20, paddingRight: 20, borderRadius: 10, backgroundColor: "rgb(37, 99, 235)", color: "white" }}
      hoverStyle={{ backgroundColor: "rgb(59, 130, 246)" }}
      onClick={() => setClicks(clicks + 1)}
    >
      Clicked {clicks} times
    </box>
  );
}

createRoot().render(<Counter />);
```

With Vite, add `react()` from `@silkui/react/vite` beside `silk()` from `@silkui/vite`:

```js
// vite.config.js
import { defineConfig } from "vite";
import silk from "@silkui/vite";
import react from "@silkui/react/vite";

export default defineConfig({ plugins: [silk({ entry: "src/main.tsx" }), react()] });
```

It compiles JSX with this package's runtime, fixes a quadratic sibling walk in
`react-reconciler` for long lists, and adds React Fast Refresh under the dev server.
`react({ refresh: false })` turns Fast Refresh off.

### Try local renderer sources

To try an unpublished renderer in an app that already has its dependencies installed,
add this `vite.local.config.mjs` beside the app's `vite.config.js`. Point `SILK_PACKAGES`
at the checkout's `modules/js/packages` directory. Alias both packages, including the
core globals, `react-dom` and the JSX runtime, so the app and renderer use the same core
node registry, even with an older installed `@silkui/react/vite`. The app keeps its installed build plugins, React and reconciler; use versions
compatible with the checkout.

```js
import { resolve } from "node:path";
import { mergeConfig } from "vite";
import app from "./vite.config.js";

const source = (file) => resolve(process.env.SILK_PACKAGES, file);
export default mergeConfig(app, {
  resolve: {
    alias: [
      { find: /^@silkui\/core$/, replacement: source("core/src/index.js") },
      { find: /^@silkui\/core\/globals$/, replacement: source("core/src/globals.js") },
      { find: /^@silkui\/react$/, replacement: source("react/src/index.js") },
      { find: /^(?:@silkui\/react\/dom|react-dom(?:\/client)?)$/, replacement: source("react/src/dom.js") },
      { find: /^@silkui\/react\/jsx-(?:dev-)?runtime$/, replacement: source("react/src/jsx-runtime.js") },
    ],
    dedupe: ["react", "react-reconciler", "scheduler"],
  },
});
```

From the app's web directory, build into a fresh directory. This builds the JS bundle
and stylesheet only, without launching the app, installing packages or editing the lockfile.

```sh
SILK_PACKAGES=/absolute/path/to/SilkUI/modules/js/packages \
  ./node_modules/.bin/vite build --configLoader runner --config vite.local.config.mjs --outDir "$(mktemp -d)"
```

## API

| Export | What it does |
| --- | --- |
| `createRoot(container?)` | A React root in a `@silkui/core` node. Without one it renders into the window's root, mounting a new box when there is none |
| `root.render(element)` | Renders and commits before it returns, so the window's first frame has the content |
| `root.unmount()` | Unmounts what the root rendered |
| `flushSync(callback)` | Runs `callback` and commits its updates before returning |
| `createPortal(children, container)` | Renders `children` into another `@silkui/core` node |
| `@silkui/react/dom` | `react-dom` and `react-dom/client` for code written for React DOM; the Vite plugin points both at it |
| `@silkui/react/vite` | The Vite plugin above (`react(options?)`) |
| `@silkui/react/jsx-runtime` | The JSX runtime, for `"jsxImportSource": "@silkui/react"` |

### Elements and props

Host elements are the tree's node kinds, and strings in children become text nodes.

- **Style.** `style` is the base look, as a `@silkui/core` style object (numbers are CSS
  pixels). `hoverStyle`, `activeStyle`, `focusStyle` and `focusVisibleStyle` are the looks the
  tree lays over it in those states, and `startingStyle` is what transitions start from when
  the node first shows (`@starting-style`).
- **Events.** `onClick`, `onPointerDown`, `onKeyDown`, `onInput`, `onSelectionChange`,
  `onScroll`, `onLayout`, `onTransitionEnd` and the rest, one for every event of the tree,
  with a `Capture` suffix for the capture phase. Listeners receive the `@silkui/core` event.
- **Attributes.** `id`, `role`, `tabIndex`, `testId`, `label`, `disabled`, `inert`,
  `focusTrap`, `cursor`, `href`, and `aria-*` as in React DOM.
- **Inputs.** `value` on `<input>` is controlled as in React DOM (`defaultValue` for an
  uncontrolled one), with `placeholder`, `multiline` and `readOnly`. `<richinput>` takes
  `marks` and `atoms` (name to style) and a controlled `document` (`defaultDocument` for an
  uncontrolled one): keep `event.document` from `onInput`.
- **SVG.** Inline `<svg>` works as in React DOM: `<path>`, `<circle>`, `<g>`, gradients and
  the rest inside it, with React DOM's prop spellings (`viewBox`, `strokeWidth`, `fillRule`).
  The whole `<svg>` is one tree node: `className`, `style` and events go on the `<svg>`, its
  `currentColor` is its `color`, and without a CSS size it takes its `width` and `height`.
  Elements inside it are markup, so their own listeners never run. Icon components written
  for React DOM, such as `lucide-react`'s, render as they are.
- **Images.** `<img src>` (or `<image src>`) takes a `data:` URL (base64 or percent-encoded),
  a file or an `http(s):` address, as a browser's does, with `alt`, `onLoad` and `onError`.
  An SVG file draws as inline `<svg>` does, so markup you hold as a string (a `?raw` import,
  an icon set's string export) goes in as `<img src={"data:image/svg+xml," + encodeURIComponent(markup)}>`.
  To tint any other picture with the text color, use CSS `mask-image` over `background-color: currentColor`.
- **Refs** are the `@silkui/core` nodes (`Node`, `Input`, `RichInput`, `Image`, `Svg`), for code that
  draws on the tree directly, such as animation on every frame.

### HTML elements

Apps and libraries written for React DOM render as they are: `<div>`, `<span>`, `<p>`,
`<button>`, `<label>`, `<ul>`, `<table>` and every other HTML tag become tree nodes that know
their tag, so type selectors, `:root`, implicit roles and the default stylesheet
(`@silkui/react/html.css`, which the Vite plugin puts before the app's CSS) apply. Props are
React DOM's: `className`, `style` with CSS custom properties, `onChange` on fields,
`checked`, `htmlFor`, `hidden`, `autoFocus`, `dangerouslySetInnerHTML` and other attributes,
which selectors see (`[type=checkbox]`, `details[open]`). `onFocus` and `onBlur` bubble as
in React DOM. A click checks a checkbox or radio, passes from a label to its control, opens a
`<details>` from its summary and submits a form from its button. `react({ html: false })`
leaves out the stylesheet and the `react-dom` aliases.

### Timing

A state change in a click, key or input listener commits before the host applies the
mutations, so the next frame shows it. Other updates go through React's scheduler on the
host's timers.

## TypeScript

The package types every element against its props and events. Set the JSX import source in
`tsconfig.json` and install `@types/react`:

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "jsxImportSource": "@silkui/react"
  }
}
```

`<box onClick={(event) => event.clientX}>` then knows `event` is a pointer event, a ref on
`<input>` is a `RefObject<Input>`, and an unknown prop is an error.

## Requirements

React 19.3 or newer. `vite` 8 for `@silkui/react/vite`.

## More

- [The ui-js reference](https://github.com/silk-lang/SilkUI/blob/main/modules/js/README.md#silkuireact)
  and [`@silkui/core`](https://www.npmjs.com/package/@silkui/core) for nodes, styles and events.
- [The React template](https://github.com/silk-lang/examples/tree/main/ui-react).
- [Source](https://github.com/silk-lang/SilkUI/tree/main/modules/js/packages/react). MIT license.
