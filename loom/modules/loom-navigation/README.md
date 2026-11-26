# Loom Navigation

A stack of screens for Loom apps: push, pop, back, sheets and transitions, as a native
navigation controller or React Navigation's stack.

```silk
import loom_navigation.lib { Stack, Screen, Action, Presentation, Message, Owned, Out, header }
```

## Screens

A screen is a model that implements `Screen<M, C>`: `start` (its loader), `update`, `view` and
`subscriptions`, like a `Submodel`. Its `update` moves the stack by reporting an `Action`:

```silk
PageMessage.Opened { id } => Step.of(move model).reporting(
  Action<Page>.Push { screen: Page.Article { id: id, loaded: false } },
)
PageMessage.Closed => Step.of(move model).reporting(Action<Page>.Pop)
```

`Push`, `Pop`, `PopTo { key }`, `PopToRoot`, `Replace` and `Reset` are the actions. Optional
methods say how a screen presents (`Push`, `Modal`, `Sheet`, `Instant`), what back does inside
it (`back`: unsaved changes to ask about, a stack of its own), and give it a message when it
is covered or shows again.

A screen's root should fill its frame (`flex-grow: 1`) and paint a background: screens lie
over each other while they move.

## The stack

`Stack<S>` is a value in the app's model and a `Submodel<Message<M>, Owned<C>, Out>`, so the
parent holds it like any child: `Submodel.start`, `fold`, `h.submodel`, `subs.submodel`.

```silk
let stack = run Stack<Page>.of(1, Page.Feed { loaded: false }, Presentation.Push)
let commands = run Submodel<Msg, Cmd, Out>.start(&stack)
```

- Every screen on the stack stays live until it leaves: model, nodes (scroll, focus),
  subscriptions and commands. A fully covered screen is not painted and its view is not
  rebuilt until it shows again. The screen under a sheet stays visible, out of reach.
- A screen's commands run as `Owned<C>` under the screen's key. When the screen leaves, the
  ones that wait are dropped and the message of one that runs is discarded.
- `Message.Back` goes back: the top screen's own `back` first, else a pop. On the first screen
  the stack reports `Out.Exit` to its parent. Alt+Left (Cmd+[ on a Mac) and the mouse's back
  button send it: the tree turns them into a navigate request that starts at the focused node,
  or the node last pressed, and bubbles (`h.onNavigate`). So each of two stacks side by side
  answers for itself, a stack inside a screen answers before the one around it, and a stack
  that cannot go back lets the request go on. Escape is a close request (`h.onCloseRequest`):
  it closes a sheet or a modal, and `withEscape` makes it go back from any screen. A screen
  that wants a say first handles the request below the stack and stops it, or the app takes
  it above the stack with `h.onCapture`.
- A screen slides with a `translate` transition, which a Silk UI window's render thread runs
  by itself: the slide goes on while the UI thread is busy with the screen that opens. The
  demo's last article holds the UI thread for 1.2 seconds to show it.
- `withoutMotion` turns the transitions off.

## Links

A stack made `withLinks` keeps the location and the stack together. A screen says where it
lives with `path`, and `open` makes the screen a path names:

```silk
effect fn path(model: &Page) -> Option<String> { ... }   // "/article/7"; None for a sheet
effect fn open(path: string) -> Option<Page> { ... }      // "/article/7" is Page.Article
```

- `h.link("/article/7", ...)` pushes the article. On a document backend it is an `a`, so it
  opens in a new tab and shows its address like any link.
- The location follows the top screen that has a path: a push or a pop moves it. A screen
  with no path (a sheet) leaves it at the screen under it.
- When the location changes from outside (the browser's back and forward, the address the app
  starts at), the stack pops to the screen that has that path if one is on the stack, else it
  pushes the screen `open` makes. A path that opens nothing changes nothing.
- A pop from inside the app (the header's back button, the back key) adds a history entry for
  the screen it lands on. It does not rewind the browser's history.

## Slow work

Run the app with `loom_window.program.showWithWorkers` (the `withCommands` front door of
`silkui-window-loom` does): commands run on worker threads, so a click shows the next screen's
loading shell at once and the window stays live while the loader runs. `demo` is a reader
that shows it, and `silk task native navigation` drives it in a window.

The inspector's Program panel (and `silk-ui.program`) shows the stack in the model, and under
`work` the commands that run or wait now, each with the screen it belongs to:
`running Owned<PageCommand> { ... } for 1:6` is a command of the screen with key 6 on stack 1.
