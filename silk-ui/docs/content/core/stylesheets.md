# Stylesheets

A stylesheet is another way to give a tree its CSS. Keep using `h.style` for values computed from your model, and use classes when you want shared rules, themes, or a CSS processor such as Tailwind. Both paths feed the same property resolver.

## The plan picker, with a sheet

::demo plans-sheet

This is the plan picker of [Styling](/core/styling/), with every style moved into a CSS file. Click a plan, move the pointer over the others, press Tab. The program only names classes:

::source examples/src/core/plans_sheet.silk

The sheet holds the values. The colors are custom properties on the picker, the pointer and focus states are selectors, and the chosen card is one more class:

::source styles/plans.css

The frame above runs on the browser's DOM, so the browser applies the sheet. In a window or on a canvas there is no browser CSS: Silk UI's own tree matches the selectors, runs the cascade and draws the result on the GPU. This is the same program and the same file drawn that way:

::shot native-plans-sheet "The plan picker in a window, styled by plans.css. Where the browser has WebGPU it runs here."

## Load CSS at build time

In `silk/tasks.silk`, add files to the app definition in cascade order:

```silk
App.make("my-app")
  |> App.framework(Framework.loom("app"))
  |> App.stylesheet("styles/app.css")
  |> App.stylesheet("styles/theme.css")
```

The pipeline accepts ordinary CSS. It compiles and embeds sheets for native windows and WebGPU canvas apps, and links the original CSS for DOM pages. Compiled sheets are adopted before the first layout. Release hosts decode compiled sheets instead of parsing stylesheet text at startup.

In the view, use a literal class string:

```silk
h.box(
  &[h.class("card"), h.id("summary"), h.attribute("data-state", "ready")],
  &[h.text("Ready")],
)
```

```css
@layer components {
  .card {
    --card-gap: 12px;
    padding: var(--card-gap);
    border-radius: 8px;
    background-color: oklch(96% 0.02 250);
  }
  .card:hover { background-color: color-mix(in oklab, white 80%, blue); }
  .card[data-state="ready"] { border: 1px solid currentColor; }
}
```

`silk dev` watches configured sheets and replaces their rules without resetting application state. A missing or invalid update keeps the previous sheet until a valid replacement arrives. Editing Silk code still rebuilds the application.

## Classes and inline styles

Sheet declarations follow CSS specificity, source order, layers and `!important`. The node's style object has the place of an inline style: it overrides normal sheet declarations, while important sheet declarations override normal inline values. State looks and state selectors read the same interaction state.

Custom properties inherit through the tree and can be written on either side. `h.customProperty("--card-gap", "16px")` sets an inline variable; a declaration using `var(--card-gap)` can read a value from a sheet or an ancestor. `@property` supplies registered defaults and inheritance behavior. Values such as `var()`, `calc()`, `oklch()` and `color-mix()` share the resolver used by style objects.

Selectors read element tags, IDs, classes, named attributes and state. `data-*` and literal `aria-*` attributes can be matched. Literal ARIA relation values name element IDs within the same root; typed protocol relations continue to use node numbers. Numeric `aria-valuemin`, `aria-valuemax`, and `aria-valuenow` values also update native accessibility while retaining their literal spelling for selectors. Native `ValueRange` attributes expose the corresponding selector attributes. Explicit native roles and tab indices can be matched with `[role]` and `[tabindex]`; implicit defaults leave those attributes absent.

## Tailwind

Tailwind writes a CSS file from the classes it finds in your source, and the app loads that file like any other stylesheet. Silk UI itself has no Tailwind dependency.

::demo inbox-tailwind

Move the pointer over a row and over the Dark button, click a row, switch the theme. Every style here is a Tailwind class in the view:

::source examples/src/core/inbox_tailwind.silk

And the same inbox in a window, where the tree applies the sheet Tailwind wrote and the GPU draws it:

::shot native-inbox-tailwind "The Tailwind inbox in a window. Where the browser has WebGPU it runs here: hover a row, click it, switch the theme."

### Start with a template

The quickest way is a template that has everything below in place:

```sh
silk init my-app -t ui-loom-tailwind
cd my-app
silk dev
```

`ui-react-tailwind`, `ui-foldkit-tailwind` and `ui-js-tailwind` do the same for JavaScript apps.

### Add Tailwind to a Loom app

1. Add the Tailwind step to the tasks dependencies in `silk.toml`, at the same revision as `silkui`:

   ```toml
   [profiles.tasks.dependencies]
   silkui = { git = "https://github.com/silk-lang/silkui.git", rev = "<rev>", path = "modules/silkui", package = "silkui" }
   tailwind = { git = "https://github.com/silk-lang/silkui.git", rev = "<rev>", path = "modules/tailwind", package = "ui-tailwind" }
   ```

2. Choose where Tailwind comes from. Either install it in the project with `npm install tailwindcss @tailwindcss/cli`, or copy [`tailwind.lock.json`](https://github.com/silk-lang/SilkUI/blob/main/modules/tailwind/tailwind.lock.json) into the project. With the lock file, the step downloads the standalone Tailwind program once, checks its SHA-256 and caches it, so the project needs no Node installation.

3. Write `styles/input.css`. It imports Tailwind and names the Silk files to read classes from:

   ```css
   @import "tailwindcss" source(none);
   @source "../silk/**/*.silk";
   ```

4. In `silk/tasks.silk`, load the file Tailwind writes, and run Tailwind around the build:

   ```silk
   import tailwind.tailwind { Tailwind }

   effect fn app() -> App ! OutOfMemoryError ? &mut Allocator {
     return run App.make("my-app")
       |> App.framework(Framework.loom("app"))
       |> App.stylesheet("styles/app.css")
       |> App.target(Target.window(Window { title: "My app", width: 420.0, height: 200.0 }))
   }
   ```

   ```silk
   let processor = Tailwind.make("styles/input.css", "styles/app.css")
   match move self {
     // Builds the CSS, then keeps Tailwind watching while the app runs.
     Tasks.Dev { options } => run processor.watching(app()
       |> App.dev(&options)
       |> Built.launch()
       |> Running.watch())
     Tasks.Build { options, out } => {
       drop run processor.build()
       run app() |> App.build(&options) |> Built.write(out.view())
     }
   }
   ```

5. Add `styles/app.css` to `.gitignore`: it is build output.

6. Use classes in the view, and run `silk dev`. Saving a Silk file adds its new classes to the sheet, and the running app takes the new sheet without losing its state.

The [Tailwind step's page](https://github.com/silk-lang/SilkUI/tree/main/modules/tailwind) covers musl Linux, a project in a subfolder and updating the pinned version.

### Classes in the view

Tailwind finds classes by reading your source as text, so each class has to appear whole in a string. `"bg-" + color` is invisible to it; `if danger { "bg-red-600" } else { "bg-teal-600" }` works.

Class attributes on one node add up, so a node can take its classes in pieces instead of in one long string:

```silk
h.box(&[
  h.class("rounded-xl border p-4"),
  h.classWhen(model.busy, "opacity-50"),
  h.classSelect(chosen, "border-teal-700 bg-teal-50", "border-gray-300 bg-white"),
  h.classes(&[CARD, SPACING]),
], children)
```

`classWhen` adds its classes while the condition holds. `classSelect` adds the first string while it holds and the second otherwise. `classes` adds every string in a list. `className` replaces what the node has so far.

Here is the plan picker of this page again with Tailwind. A card's fixed classes are one attribute and the chosen look is another:

::source examples/src/core/plans_tailwind.silk

### Variants

The inbox above uses these, and the tests of the docs examples check each one on a real tree:

| In the example | What it does |
| --- | --- |
| `hover:bg-teal-50`, `focus-visible:…`, `active:…` | The node's own pointer and focus state |
| `group` on the row, `group-hover:opacity-100` inside it | A descendant follows the row's state |
| `group-data-[state=read]:text-gray-500` | A descendant follows an attribute of the row, set with `h.attribute("data-state", …)` |
| `peer` on the button, `peer-hover:opacity-100` after it | A later sibling follows the button's state |
| `has-[.dot]:font-semibold` | The row follows what it contains |
| `odd:bg-gray-50`, `last:rounded-b-xl` | Position among siblings |
| `divide-y divide-gray-200` | Lines between children |
| `dark:bg-gray-900` | A `dark` class on an ancestor, see below |
| `text-[13px]`, `w-[min(100%,26rem)]` | Arbitrary values |

Hover variants are written inside `@media (hover: hover)`. Windows and pages report a pointer that can hover; a tree you build yourself in a test needs `tree.setStylePreferences(Preferences.desktop(false))` first.

Without configuration, `dark:` follows the system's color scheme. To switch it from your model, declare the variant in the input file and put the class on a node around the themed part with `h.classWhen(model.dark, "dark")`:

::source styles/inbox.tailwind.input.css

## JavaScript apps

Import CSS from the Vite entry. With Tailwind, add `@tailwindcss/vite` before the Silk plugin:

```js
import tailwind from "@tailwindcss/vite";
import silk from "@silkui/vite";

export default { plugins: [tailwind(), silk({ entry: "src/main.ts" })] };
```

```js
import "./app.css";
```

`@silkui/vite` compiles Vite's processed CSS into `dist/app.sheet`; the app pipeline embeds it. Development CSS updates replace sheets in the running tree. React uses `className`, Foldkit uses `h.Class`, and core nodes expose `className`, `classList`, `id` and named attribute methods. In JavaScript, build conditional class strings as you would on the web, with template strings or a helper such as `clsx`; the same rule holds that each class appears whole in the source.

JavaScript hosts always include the text compiler, so a sheet can be constructed at any time. A Loom release host needs `App.runtimeStylesheets()` for it. After mounting a root:

```js
import { CSSStyleSheet, root } from "@silkui/core";

const sheet = new CSSStyleSheet();
sheet.replaceSync(".card { padding: 20px; }");
root().adoptedStyleSheets = [sheet];
```

These are the browser's names: `replaceSync(text)` compiles the text and swaps the rules before it returns, and returns nothing. `replace(text)` is the other one: it returns a promise that resolves to the sheet once the rules are in. `CSSStyleSheet.fromCompiled(bytes)` and `replaceCompiled(bytes)` need no text compiler. Replacing a sheet preserves its place in the adoption order.

## Runtime sources

Custom Silk hosts can load CSS text with `StyleSheet.load(&mut tree, run StyleSource.text(bytes))`, or a URL with `tree.loadStyleSheet(root, run StyleSource.url(url))`. Install the runtime compiler on the host loader, or use `App.runtimeStylesheets()` with a generated host. A compiled-only host rejects text loads before starting network I/O.

A handle exposes loading, ready or failed state, and methods to replace or remove the sheet. Loads reserve their cascade position immediately. A failed replacement preserves the old rules; a completion arriving after removal or another replacement is discarded.

Native file and HTTP reads run on workers. Canvas fetches follow browser URL and CORS rules; local files must be served over HTTP. DOM uses browser stylesheets and needs no Silk compiler option.

## Browser differences and current limits

On `web-dom`, the browser implements CSS. Window and canvas targets use the tree's CSS implementation:

- There is no HTML document stylesheet collection or HTML user-agent stylesheet. Nodes without an explicit tag match as `div`; tags such as `h1` do not bring browser default styles. Sheets belong to a tree root.
- Class, attribute, structural, combinator, state and `:has()` selectors, layers, nesting, custom properties, `@property`, `@media` and `@supports` are supported. Shadow DOM selectors match nothing.
- Media queries use the root's viewport and scale. Canvas also receives browser preference and pointer changes. Native windows supply appearance and desktop pointer capabilities; native reduced-motion and forced-colors preferences are not exposed by the platform API yet.
- CSS transitions and `@starting-style` rules use the existing motion engine, including custom properties, cascade priority, and entry after `display: none`. Starting styles inherit the parent’s normal after-change style, as in the browser. Inspector overrides apply after motion.
- Sheet `@keyframes` use the same animation engine as inline keyframe definitions. Names are scoped to the root, with layer, adoption and media-condition ordering. Keyframe values resolve variables per node; replacing the sheet preserves the animation's clock. Important declarations override animated values. Animating custom properties themselves is not implemented and produces a build warning.
- `::before` and `::after` on box nodes support string and `attr()` content, including empty strings. Generated boxes participate in layout, paint, motion, and accessible names; pointer actions target their originating node. Counters, quote controls, and image content remain unsupported.
- `::selection` on inputs supports foreground and background colors, with a separate highlight inheritance chain, custom properties, origin states, and container queries. Transparent foregrounds replace selected ink; rich-text runs share the input highlight. Selection text shadows and decoration overrides remain incomplete. Selectors for unavailable parts such as `::marker`, `::backdrop`, and `::file-selector-button` produce build diagnostics.
- `::placeholder` supports fonts, foreground and background colors, opacity, text spacing, and text decorations. It has its own font metrics and container-unit dependencies, without changing typed text or rich runs. Its line height remains `normal`; layout, writing-mode, and text-shadow overrides, and part transitions and animations, are not implemented.
- `::-webkit-scrollbar`, `::-webkit-scrollbar-thumb`, and `::-webkit-scrollbar-track` style the existing overlay scrollbars. Solid backgrounds, borders, corner radii, visibility, and scrollbar width and height are supported; painting and dragging share the styled dimensions. Origin states, container queries, and relative units work. Standard `scrollbar-width: thin` or `none` takes precedence over vendor part rules. The native overlay does not reserve a layout gutter, retains its native minimum thumb size and default appearance, and has no buttons or corner part. Part states (such as `::-webkit-scrollbar-thumb:hover`), gradients, shadows, and part motion remain unsupported.
- Size container queries support `container-name`, `container-type: size` and `inline-size`, physical and logical dimensions, ranges, boolean conditions, and query lists. The six container units (`cqw`, `cqh`, `cqi`, `cqb`, `cqmin`, `cqmax`) also work in style objects, grid tracks, transforms, paint effects, and keyframes. Layout settles within the same frame while preserving motion. Missing unit axes fall back to the viewport. Style and scroll-state queries remain unsupported.
- Sheet `@font-face` supports family, weight and width ranges, normal/italic/oblique faces, Unicode subsets, `local()` sources, and ordered URL alternatives through the host font loader. Fonts load when text needs them, remain scoped to their root, and respond to media conditions, layer/adoption order, replacement, and removal. URL-loaded sheets resolve font URLs against the requested stylesheet URL using RFC 3986 reference resolution; redirect response URLs are not currently exposed by the loader. Loaded faces are cached for the tree’s lifetime, so unchanged rules reuse data across removal and HMR. Tree hosts use swap behavior for `font-display: auto` and `swap`; other display timing policies, descriptor math, and font metric/feature overrides produce diagnostics. Build-time `App.stylesheet` inputs embed local font files, resolving relative paths from the original CSS file and `/` paths from the app root. Vite bundles imported, emitted, and public font assets for production; development URLs point to its asset server and update through HMR. Nested runtime `@import` loading remains unsupported.
- Ordinary lengths, transforms, grid tracks, and paint effects use measured font bases for `ch`, `ex`, `cap`, `lh` and their root-relative forms. Relative font sizes use parent metrics; other lengths use the resolved element font and line height. The same bases apply to starting styles, keyframes, and rich-text runs; font-size animations update dependent lengths in the same frame. Some compound value grammars remain incomplete.
- Unknown properties, vendor selectors and other dropped features produce compiler diagnostics. Vite's `strictStylesheets: true` option can turn diagnostics into a build failure. Tailwind preflight includes browser-specific form-control rules that the tree drops.
- Local class, pointer-state and focus changes restyle the affected subtree, including changes to rules that set custom properties. So does a changed style object that sets no custom properties, and so does anything set on a node before it joins the tree. Inserting or removing a node restyles that node and what the root's selectors can read from it: the parent for `:empty`, the neighbouring elements for `:first-child`, `:last-child` and `:only-child`, the parent's subtree for sibling combinators, `:nth-*` and `*-of-type`. A change that a sibling combinator or `:nth-child(… of …)` filter can observe restyles the parent's subtree. `:has()` dependencies, `:focus-within`, class changes that touch `display`, `content` or `all`, other attribute changes on attached nodes and inline custom properties restyle the root, and so does every pass once a root holds more than 4,096 distinct variable scopes. Equal sibling elements, and the matching children of equal siblings such as the cells of list rows, share one matched style and skip selector matching, unless the root's sheets use sibling combinators, `:nth-*` or `*-of-type` selectors, or `:has()`; other repeated cascade results are shared after matching. Nodes that share a matched style this way also copy one set of computed values instead of applying the declarations again, while no transition or animation exists in the tree and the node has no focus, transition or container units of its own. Style-object-only roots avoid selector matching.

The tree's property coverage suite checks the supported declarations through both style objects and compiled sheets. A stylesheet does not add rendering support for a property the tree does not yet implement.

Repeated rows styled by classes cost about as much memory as inline styles; creating them costs up to 4% more and a theme change up to 1.12 times as much. Elements with distinct classes still pay full selector matching and compute their own values. The [stylesheet benchmark report](https://github.com/silk-lang/SilkUI/tree/main/modules/bench#computed-values-copied-between-equal-rows) records the instruction counts and storage measurements.

The local [Chromium stylesheet comparison](https://github.com/silk-lang/SilkUI/tree/main/modules/tree/tools/stylesheet-parity) checks computed values and box geometry against three committed CSS fixtures. Its case table covers these utility families:

| Coverage | Utilities or behavior |
| --- | --- |
| Compared with Chromium | Numeric padding, margins, gaps, width/height constraints, flex/grid layouts and alignment, border widths/radii/colors, foreground/background colors, font size/weight, line height, letter spacing, and opacity |
| Compared state combinations | Hover and group-hover, checked peers, disabled opacity, focus-visible outlines, data attributes, dark classes, responsive grids, nesting, layers, important declarations, and `:has()` |
| Separate tree tests | Motion, container queries, generated content, font loading, text shaping, selection, placeholders, and overlay scrollbars |
| Host differences | No HTML user-agent styles; native overlay scrollbar sizing and preferences as described above |
| Dropped by the fixture compiler | Unavailable browser form-control parts, vendor-only selectors/properties, and `text-box`; unexpected diagnostic changes fail the comparison |

This table describes the checked cases, not every class emitted by Tailwind. See the comparison's `cases.json` for the exact combinations; unsupported compound values and parts still follow the limits above.


Next: [Images and fonts](/core/images-and-fonts/).
