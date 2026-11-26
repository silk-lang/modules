# Loom

Loom is the Elm-style UI framework for [Silk](https://github.com/silk-lang/silk): a model,
messages, a pure `view`, an `update`, and commands and subscriptions as plain data. It runs on
[Silk UI](https://github.com/silk-lang/silkui): the `loom` package depends only on
`ui-protocol`, and the hosts below put a Loom app in a native window, on a WebGPU canvas or in
the browser DOM.

| Package | What it is |
| --- | --- |
| [modules/loom](modules/loom) (`loom`) | The framework: builder, diff, app contract, runtime, commands on fibers. Start with its [README](modules/loom/README.md) |
| [modules/loom/tree](modules/loom/tree) (`loom-tree`) | Loom on ui-tree: input, frames, and the headless test harness |
| [modules/loom/window](modules/loom/window) (`loom-window`) | A Loom app in a native window, with the inspector and the DevTools |
| [modules/loom/dom](modules/loom/dom) (`loom-dom`) | A Loom app in a browser document |
| [modules/loom/inspect](modules/loom/inspect) (`loom-inspect`) | The inspector extension: messages, the model after each, the Program panel |
| [modules/loom-components](modules/loom-components) | Loom Components: buttons, fields, lists, tabs, menus, dialogs and more |
| [modules/devtools](modules/devtools) | The Silk UI DevTools, a Loom app: in a window of their own or in the app's process |
| [modules/ghostty](modules/ghostty) | Terminals through libghostty-vt: a `TerminalView` component, a terminal app, a browser page |
| [modules/silkui](modules/silkui) | The Loom targets of the `silkui` front door: `window`, `web-canvas`, `web-dom` |

## Using Loom in an app

Depend on `loom` (and the host you run on) at one commit of this repository:

```toml
[dependencies]
loom = { git = "https://github.com/silk-lang/loom.git", rev = "<commit>", path = "modules/loom", package = "loom" }
loom_window = { git = "https://github.com/silk-lang/loom.git", rev = "<commit>", path = "modules/loom/window", package = "loom-window" }
```

With the `silkui` package (from the silkui repository) the app depends on `loom` alone: silkui builds the Loom targets
from the same commit as the app's `loom` dependency, so the app and its host share one Loom.

## Working here

Commands run from the repository root, with the compiler `silk.toml` names (`silk use`).

```sh
silk task check                          # packages, unit tests, HTTP images, goldens
silk task native demo modules/loom/demo  # the todo demo in a window
silk task native devtools                # the DevTools on the todo demo
```

Silk UI's packages (`ui-protocol`, `ui-tree`, the window host, the inspector) come from
[silkui](https://github.com/silk-lang/silkui), pinned to one commit in every manifest. A Silk
build takes one copy of each package, so all manifests must name the same silkui commit, and
the other pins (lib-native, lib-graphics, lib-fonts, lib-css) must match the ones that silkui
commit uses. To move to a new silkui commit:

```sh
scripts/pin-silkui.sh <silkui commit>
```

then update the other pins if that silkui commit moved them. silkui's docs and benchmarks
build Loom apps, so they pin this repository and, through it, the same silkui commit.
