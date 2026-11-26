# Silk UI

Native user interfaces in Silk: a retained UI tree, an Elm-style framework on top of it,
components, inspection tools for people and agents, and an example app. Everything runs in a
native window (macOS, Windows, X11, Wayland) through [modules/platform/window](https://github.com/silk-lang/lib-native/tree/main/modules/platform/window) and
[ui_renderer](https://github.com/silk-lang/lib-graphics/tree/main/modules/ui_renderer), and headless on the CPU for tests.

| Package | What it is |
| --- | --- |
| [modules/silkui](silkui) | The front door: an app definition in `tasks.silk` and the pipeline steps that build and run it (`silk dev`, `silk build`) for Loom, React, Foldkit and plain JS apps; it generates each target's host |
| [modules/text](text) | Text for layout: font fallback, line breaking, bidi, shaping |
| [modules/tree](tree) | The retained tree: nodes, typed styles, layout, paint, input, focus, scrolling, text editing. Driven by plain-data `Mutation`s, reports plain-data `Event`s |
| [loom](https://github.com/silk-lang/loom/tree/main/modules/loom) (silk-lang/loom) | The framework: model, messages, `view`, `update`, commands and subscriptions; the view is diffed into tree mutations. Its inspector extension is [loom-inspect](https://github.com/silk-lang/loom/tree/main/modules/loom/inspect) |
| [loom-components](https://github.com/silk-lang/loom/tree/main/modules/loom-components) (silk-lang/loom) | Buttons, checkboxes, switches, sliders, fields, lists, tabs, menus, selects, dialogs, popovers, tooltips, and a theme |
| [modules/inspect](inspect) | Queries, highlights and recording; a socket protocol with a CLI and an MCP server for agents. The devtools window is a Loom app, in [silk-lang/loom](https://github.com/silk-lang/loom/tree/main/modules/devtools) |
| [modules/js](js) | Early: a JavaScript application on the tree with the SilkJS engine embedded. `@silkui/core` gives JavaScript the tree's nodes with DOM style methods and events, and `@silkui/react` renders React components to them; listeners run between the tree's `begin` and `finish`, so `preventDefault` works as on the web. |
| [ghostty](https://github.com/silk-lang/loom/tree/main/modules/ghostty) (silk-lang/loom) | Terminals through libghostty-vt: a `TerminalView` component (selection, scrollback, keys, IME, paste, mouse reporting), a terminal app on a PTY, and the same component in a browser page |
| [examples/notes](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/notes) | The example app: a notes app with a file, search, sorting, an editor, a dialog, shortcuts and a dark theme |
| [examples/showcase](https://github.com/silk-lang/nonstd/tree/7d6c3693a9ad1fec24127985626ab4224f9f1995/examples/showcase) | Silk Loom, a showcase of the drawing layer |

Start with Loom's [todo demo](https://github.com/silk-lang/loom/tree/main/modules/loom/demo/src/main.silk), then the
[loom README](https://github.com/silk-lang/loom/tree/main/modules/loom/README.md) for the framework and [loom-components README](https://github.com/silk-lang/loom/tree/main/modules/loom-components/README.md)
for components. Notes and Showcase above are external application examples.

## Writing an app

An app is a model, a message union, and three functions. A small one, all of it:

```silk
import loom_components.lib { Theme, surface, heading, button, primaryButton }
import loom.app { App, Context, NoCommand }
import loom.ui { Ui }

pub struct Counter {
  pub theme: Theme,
  pub count: i64,
}

pub union Message {
  Increment,
  Reset,
}

impl App<Message, NoCommand> for Counter {
  /// What the window shows, from the model alone. Called again after every update; the
  /// runtime diffs the result into tree mutations.
  fn view(self: &Self, ui: &mut Ui<Message>) -> () {
    let theme = self.theme
    surface(&mut ui, &theme)
    ui.padding(16.0)
    ui.gap(8.0)
    heading(&mut ui, &theme, 1, "Counter")
    ui.box(|ui| { ui.testId("count"); ui.number(self.count) })
    primaryButton(&mut ui, &theme, "Add one", || Message.Increment)
    button(&mut ui, &theme, "Reset", || Message.Reset)
  }

  /// The only code that changes the model.
  fn update(self: &mut Self, message: Message, cx: &mut Context<NoCommand>) -> () {
    match move message {
      Message.Increment => { self.count = self.count + 1 }
      Message.Reset => { self.count = 0 }
    }
  }
}
```

Run it in a window with `runWindow` from `loom-window` (see `modules/loom/demo/src/main.silk` in silk-lang/loom for
a complete `main`: fonts, the runtime, the inspector, error handling), or headless with the
runtime and the `harness` functions, which is how the tests drive apps.

The rules that shape everything else:

- **Handlers are never stored.** `|| Message.Increment` is called while the runtime dispatches
  an event, by running `view` again along the event's path. A handler sees the model as it is
  when the event arrives.
- **The model owns values, the tree owns interaction.** An input's text is in the model, but
  its caret, selection, undo and input method state are in the tree, as are focus, hover and
  scroll offsets.
- **Effects are data.** `update` returns commands (`cx.command(...)`), and `perform` is the
  only effectful code. It runs against services the host provides, so a test swaps a file for
  memory. Timers, animation frames, key bindings and resizes are subscriptions the model asks
  for and stops asking for.
- **Everything is inspectable.** The tree is plain data, so `describe` gives a text snapshot,
  `CpuSnapshot` a PNG, and in debug builds `SILK_UI_INSPECT` serves the inspector protocol to
  ui-inspect-cli, ui-inspect-mcp and the devtools window.

## Testing an app

The harness drives the app through the tree's real input path, by what a person sees:

```silk
let mut app = Runtime<Counter, Message, NoCommand>.make(Counter { theme: Theme.light(1), count: 0 })
run app.start(&mut tree, 0.0)
drop run clickRole(&mut app, &mut tree, viewport, Role.Button, "Add one")
run press(&mut app, &mut tree, viewport, "Tab", 0)
run typeText(&mut app, &mut tree, viewport, "hello")
run tick(&mut app, &mut tree, 1.5, false)          // timers due by then
let text = run snapshot(&mut tree, viewport)        // the describe snapshot
```

Golden tests render a scene with `CpuSnapshot` and compare its PNG and `describe` text; see
`modules/loom/tests/src/main.silk` in silk-lang/loom. A window check there (`silk task native demo modules/loom/demo -- check`)
compares a real GPU frame against the CPU reference.
