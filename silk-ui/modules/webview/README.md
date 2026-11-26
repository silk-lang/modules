# ui-webview

Web views for Silk UI: a real browser page shown over a node of the tree, that a person and an
agent can both use and see. JavaScript apps use it through `createWebView` in `@silkui/core`
and the `WebView` component in `@silkui/react`; Silk code uses the contract here directly.

| Backend | Engine | How the page shows | Where |
| --- | --- | --- | --- |
| `MacWebViews` | WKWebView | native child view over the window | macOS |
| `HeadlessWebViews` | none | records, for tests | Linux and Windows for now |

`native.NativeWebViews` picks the backend for the target.

## How it fits together

- **Plain data.** Views are client-chosen `u32` ids. `command.Command` goes in,
  `event.WebViewEvent` records come out of `takeEvents`. Commands that answer carry a `request`
  number and their answer event carries it back.
- **The platform thread owns the views.** WebKit wants the main thread, so
  `ui_tree_window.platform_thread` keeps a `wire.WireViews` there. The UI thread sends calls as
  text (`HostPlatform.webView`) and placements (`placeWebView`), and takes events back
  (`takeWebViewEvents`). `wire.silk` is that text form: the ops and command names JavaScript's
  `__ui.shell` uses, and the event codes `__ui.shellEvent` gets.
- **The tree says where.** `ui_js_window` measures each web view's node after layout and moves
  the view there; a view hides when its node is not shown.
- **Focus goes both ways.** A click into the page gives it keyboard focus; a click on the Silk
  UI takes it back.
- **Every backend runs every command.** What one cannot do queues `Unsupported` naming the
  command rather than doing nothing.

## Checks

- `silk test --root src/tests.silk` here: the headless backend, the agent script and the wire.
- `tests/native`: drives WebKit in a real window (macOS CI, job `macos`).
- `modules/js/examples/webview-check/app.js` drives a page from JavaScript through the whole
  stack: `silk task native demo modules/js/demo -- modules/js/examples/webview-check/app.js`.

## Agent control

Agents drive pages through the same commands on every backend: `Snapshot`, `ClickElement`,
`FillElement`, `ClickAt`, `Scroll`, `TypeText`, `PressKey`, `Screenshot`, `Evaluate`, plus
navigation. It is our own small operation set, not CDP: CDP is only how the WebView2 and
Chromium backends implement parts of it.

`agent/agent.js` is the page side, shared by every backend and embedded as
`generated_agent.silk` (`scripts/embed-agent`; CI fails when it is stale). Backends inject it at
document start. `snapshot()` writes an outline of what the page shows, with refs on what an
agent can act on:

```
- document "Agent fixture" [url=about:blank]
  - main
    - heading "Welcome back" [level=1]
    - form
      - textbox "Email" [ref=e3]: "old@example.com"
      - checkbox "Remember me" [checked] [ref=e5]
      - button "Sign in" [ref=e7]
    - iframe
      - button "Inside frame" [ref=e10]
```

`locate(ref)` scrolls the element into view and returns its center in the top viewport (through
same-origin frames and open shadow roots), and `focusForFill(ref)` focuses it and selects its
value. The backend then clicks or types there with real input (synthesized native events, or
CDP's input domain), so pages see trusted events, the same as from a person. `agent.silk` builds
the calls (only for well-formed refs, so a ref can never inject script) and reads their JSON
results.

The one known gap: WebKit cannot intercept requests or read every response body.

Run `python3 scripts/embed-agent` after editing `agent/agent.js`.
