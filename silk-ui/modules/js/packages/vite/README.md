# @silkui/vite

The [Vite](https://vite.dev) plugin for [Silk UI](https://github.com/silk-lang/SilkUI)
JavaScript apps. It builds the app into the one ES module a Silk UI host runs, serves its
modules to the window under the dev server with hot module replacement, and reports the web
and Node APIs the build uses that the embedded SilkJS runtime does not have. It knows no UI
framework: a React app adds `react()` from `@silkui/react/vite`.

## Install

The templates (`silk init my-app -t ui-react`, `ui-foldkit` or `ui-js`) set it up, and
`silk dev` and `silk build` run Vite for you. See
[Get started](https://silk-ui-docs.juliaortiz-js.workers.dev/start/). To add it to an
existing project:

```sh
npm install -D @silkui/vite vite
```

## Usage

```js
// vite.config.js
import { defineConfig } from "vite";
import silk from "@silkui/vite";
import react from "@silkui/react/vite";

export default defineConfig({ plugins: [silk({ entry: "src/main.tsx" }), react()] });
```

- `vite build` writes the production bundle, `dist/app.js`, with `process.env.NODE_ENV`
  from the Vite mode.
- `vite` serves the modules to the host and replaces the ones an edit touches. A module
  nothing accepts restarts the app. With `@silkui/react/vite`, component files keep their
  state (React Fast Refresh). A build error is printed and the running app is left alone.
  `import.meta.hot` works as in Vite.
- `vite build --watch --mode development` rebuilds the bundle on every change and writes
  `<bundle>.stamp` after each successful build. A host that watches it reloads the whole app.
  This is the production code path, so it is the mode to check a bundle in.

The development runner supplies UTF-8 `TextEncoder` and `TextDecoder` for dependencies
that initialize them before production tree shaking, including Effect. Decoding supports
streaming, fatal errors and BOM options; other encoding labels throw. Release engine hosts
still lack these APIs, and the production API report continues to flag retained uses.

## Stylesheets

Import CSS from the application entry or its modules. Vite runs any configured CSS processors
first, then this plugin compiles the resulting CSS with the shared Silk compiler shipped as
WebAssembly. `vite build` writes `dist/app.sheet`; the `silkui` pipeline validates and embeds
it after any explicitly configured `App.stylesheet` files. The generated host adopts all
sheets before the first frame. The application bundle contains no CSS parser or DOM style
injection. Tailwind and other processors remain optional Vite plugins.

Unsupported features produce counted build warnings. Set `strictStylesheets: true` to fail
instead. Compiler and host versions must match; stale compiled sheets fail the build.
CSS imports, including dependencies processed through `@import`, hot-replace their compiled
sheet under the Vite development server. The mounted application and its state remain in
place. Failed compilation preserves the previous sheet until a valid edit arrives.
`App.stylesheet` files hot-reload through the pipeline.

Maintainers rebuild the packaged compiler with `npm run build:compiler --workspace @silkui/vite`
from `modules/js`, using the repository's pinned Silk toolchain. Applications need no Silk
compiler to run the Vite CSS compilation step.

## Options

| Option | Default | Meaning |
| --- | --- | --- |
| `entry` | `src/main.jsx` | Entry module, relative to the Vite root |
| `fileName` | `app.js` | Name of the bundle in `build.outDir` |
| `host` | the `SILKUI_HOST` program, which `silk dev` sets | `{ command, args, cwd }`: a host binary to start, given `--dev <port>` under the dev server and `--watch <bundle>` in watch mode. Without one, the plugin prints the port for a host you start yourself |
| `port` | any free one | Port the dev server listens on for the host |
| `apis` | `"warn"` | What to do when the build uses an API the runtime does not have: `"warn"`, `"error"` or `"off"` |
| `allow` | none | Names of such APIs the app provides itself, such as `provided` from `@silkui/foldkit/apis` |
| `strictStylesheets` | `false` | Fail on unsupported CSS instead of warning |
| `node` | `false` | The host runs the full SilkJS runtime: `node:fs` and the other Node builtins stay imports, and `apis` reports only what that runtime lacks |

## The missing API report

A realm has ECMAScript with `Intl`, timers, `requestAnimationFrame`, `console`,
`performance.now`, `navigator.clipboard` and `@silkui/core`, but no `fetch`, `document`
(`@silkui/core/globals` brings it, with `URL`), `process` or Node modules. Libraries written for browsers or Node often expect them, so the
plugin reads every module of a build and says which are used, and by whom:

```
APIs used here that a ui-js runtime does not have:
  fetch (network): src/api.js, ky
  WebSocket (network): some-client
  node:fs (node): some-package
```

A name counts when a module reads it as a global. A `typeof` test for it, a local of the
same name and `process.env.NAME` do not count. Under the dev server the warning comes when
the module is first served. For Node's APIs at run time, build with `node: true` and give
the app the full runtime (`App.runtime(Runtime.node())` in `silk/tasks.silk`).

## TypeScript

The package ships its types: `silk(options?: SilkOptions): Plugin[]`.

## Requirements

`vite` 8.

## More

- [The ui-js reference](https://github.com/silk-lang/SilkUI/blob/main/modules/js/README.md#silkuivite),
  including how the dev server talks to the host.
- [Templates](https://github.com/silk-lang/examples).
- [Source](https://github.com/silk-lang/SilkUI/tree/main/modules/js/packages/vite). MIT license.

## Silk functions

`import { add } from "../silk/math.silk"` imports the public functions of a module the
project's `silk.toml` exports (`kind = "library"`, `exports = ["math"]`). silkui compiles the
module into the app's host program, and the import becomes calls into it: `add(1, 2)` runs
now, natively, and `add.async(1, 2)` runs on a thread and returns a promise. Numbers, `bool`,
`string` and `String` cross; `i64` and `u64` are `bigint`. Before it runs Vite, silkui runs
`silkui-natives` (this package's bin), which asks `silk doc` for the signatures and writes
`.silk/natives/`: the description the import reads, the host's dispatcher, and declarations.

For editor types, the package is a TypeScript 7.1 content mapper:

```json
"contentMappers": [{ "package": "@silkui/vite", "extensions": [".silk"] }]
```

Under the dev server, an edit to the project's Silk sources rebuilds the host silkui made and starts it again; JavaScript state starts over, as after a reload.
