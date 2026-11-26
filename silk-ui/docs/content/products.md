# Products

Silk has four brands, and each does one job. Silk compiles, SilkJS runs JavaScript, Silk UI puts things on screen, and Loom is the Silk-native way to write what goes on screen. This page names every product once, so the rest of the docs can use the names without explaining them.

## The four brands

| Brand | You meet it as | What it is |
| --- | --- | --- |
| **Silk** | `silk` | The programming language and its toolchain |
| **SilkJS** | `silkjs` | JavaScript, written in Silk: an embeddable engine and a Node-compatible runtime |
| **Silk UI** | `silkui`, `@silkui/*` | The platform for apps: the UI tree, the targets an app runs on, the JS adapters and the DevTools |
| **Loom** | `loom` | An Elm-style UI framework written in Silk: a model, messages, `update` and `view` |

## Silk

| Product | What it is |
| --- | --- |
| Silk | The language |
| `silk` | The command you type: `build`, `check`, `test`, `task`, `init`, `pack`. It runs the compiler for you |
| `silkc` | The compiler binary behind `silk`. You only name it when you need the binary itself |

## SilkJS

| Product | Package | What it is |
| --- | --- | --- |
| SilkJS Engine | `silkjs-engine` | The JavaScript engine and its embedding API, a Silk port of QuickJS. No event loop, no Node or web APIs. |
| SilkJS | `silkjs-runtime` | The runtime: the engine plus an event loop, Node builtins, `fetch` and a package manager. It owns the `silkjs` command and knows nothing about UI. |

The split is the same as Node and V8: "SilkJS" and the `silkjs` command mean the runtime, and the engine is always called the SilkJS Engine.

## Silk UI

Silk UI is everything that puts an app on screen. Building an app comes down to two choices: what you write it in, and where it runs.

| Product | Package | What it is |
| --- | --- | --- |
| Front door | `silkui` | One dependency that takes your app definition and gives your project `dev` and `build` steps for its `tasks.silk`. The templates are set up with it: [Get started](/start/) |
| Silk UI Tree | `ui-tree` | The retained tree: nodes, CSS styles, layout, text, input, focus, scrolling and paint. The "DOM" of Silk UI, driven by plain-data changes and events |
| Targets | | Where an app runs: `window` (a desktop window), `web-canvas` (a browser canvas with WebGPU) or `web-dom` (real elements in a browser page). You pick them in the app definition |
| Adapters | `@silkui/*` | What lets a JavaScript framework run on Silk UI: `@silkui/core` for plain JS or TS, `@silkui/react`, `@silkui/foldkit`, and `@silkui/vite` for bundling and hot reload. React and Foldkit stay your own npm dependencies |
| DevTools | `ui-inspect` | The inspector, a command line, and an MCP server for agents. Never in a production build |

The tree sits under the `window` and `web-canvas` targets. On `web-dom` the browser's own DOM takes its place, driven by the same protocol.

JavaScript apps in a window run on SilkJS, embedded in the app: the lean SilkJS Engine by default, or the full runtime when the app needs Node or web APIs. In a browser, a JavaScript app runs on the browser's own engine.

## Loom

| Product | Package | What it is |
| --- | --- | --- |
| Loom | `loom` | The Elm-style framework written in Silk. A peer of React and Foldkit: it reaches Silk UI only through the protocol. |
| Loom Components | `loom-components` | Buttons, fields, menus, dialogs and a theme for Loom apps. |

Both live in their own repository, [silk-lang/loom](https://github.com/silk-lang/loom), with the window that shows the DevTools (itself a Loom app).

The [first guide](/core/) on this site teaches Loom, the [second](/native/) runs the same programs in native windows, and the [third](/tree/) uses the Silk UI Tree directly.

## What runs where

| Written in | `window` | `web-canvas` | `web-dom` |
| --- | --- | --- | --- |
| Loom | Works | Works | Works |
| React | Works | Planned | Later |
| Foldkit | Works | Planned | Later |
| Plain JS or TS | Works | Planned | Later |

## Words we use

- **Framework** means what the app is written in: Loom, React, Foldkit or plain JS. Silk UI itself is not a framework.
- **Target** means where the app runs: `window`, `web-canvas` or `web-dom`. "Backend" is not used for this.
- **Silk UI** is written with a space in prose. The package is `silkui` and the npm scope is `@silkui`.
