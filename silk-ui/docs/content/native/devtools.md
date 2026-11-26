# Devtools

A running Silk UI app can show you what it is doing: its tree of nodes, their styles, every message it handled and the model after each one. The tools are built in. Your app needs no code for them.

They are on in debug builds only. A release build has none of this.

## Open the devtools

Start a debug build with `SILK_UI_DEVTOOLS` set:

```sh
SILK_UI_DEVTOOLS=dock silk task native demo docs/examples/apps/pad -- --debug
```

| Value | Where the devtools show |
| --- | --- |
| `dock` | At the bottom of the app's window |
| `window` | In a window of their own |
| `1` | In a window where the system has windows, else docked |

While they are enabled, F12 opens and closes them. So do Cmd+Option+I on macOS and Ctrl+Shift+I elsewhere.

## What is in them

The devtools have three columns.

- **On the left, the tree.** Every node of the app, with its role, label and text. Point at one and it is washed in the app's window. Press Pick, click something in the app, and it is selected, as in a browser's devtools.
- **In the middle, what the app is doing.** The Program panel lists every message the program handled, what sent it, the commands `update` returned, and the model after each step with the lines that changed. Next to it are the log of events, the frame timeline with layout and paint times, and an accessibility audit.
- **On the right, the selected node.** Design has fields for the common properties, edited in place. Declarations lists the node's styles for each of its looks, with its box model. Change a value and the app changes at once.

The Program panel is the one to open when something is wrong. Since `update` is the only code that changes the model, the list of messages is the complete history of how the app got into its current state.

## Design changes that reach the code

When you edit a style in the devtools, the edit is kept in a list, under Edits, and you can leave comments on nodes too. That list is there for whoever changes the source next, a person or a coding agent: it says which node, which property, and the value you settled on.

## The inspector

The devtools are one client of the **inspector**: a small protocol the app answers on a local socket. Turn it on with another variable:

```sh
SILK_UI_INSPECT=1 silk task native demo docs/examples/apps/pad -- --debug
```

The app prints `ui-inspect: listening on ...` and serves the socket `silk-ui-inspect.sock` in its working directory.

## From the command line

`ui-inspect-cli` sends one request to a running app and prints the answer.

```sh
silk build --manifest-path modules/inspect/cli/silk.toml

ui-inspect-cli snapshot                       # the tree, as text (or to a file: snapshot tree.txt)
ui-inspect-cli click --test-id note           # a real click on a node
ui-inspect-cli type "Hello from a script"     # typed into what has focus
ui-inspect-cli screenshot pad.png             # the window as a PNG
ui-inspect-cli silk-ui.messages               # every message the program handled
ui-inspect-cli silk-ui.model                  # the model, as text
ui-inspect-cli audit                          # accessibility problems
```

A node is named the way a person would name it: `--test-id note`, `--role button --name Save`, `--text "Tide tables"`.

The input commands go through the app's real input path. A click from the CLI is hit tested, focuses, and bubbles exactly as a click from a mouse does. That makes the CLI a way to script an app from outside, and to check it in CI. The same commands, written in a file, also run an app with no display at all: see [headless runs](/native/testing/#the-whole-app-with-no-display).

## For coding agents

`ui-inspect-mcp` serves the same inspector to agents as [Model Context Protocol](https://modelcontextprotocol.io) tools. An agent can then look at the app it is working on, click through it, read the messages and the model, and take screenshots.

```sh
silk build --manifest-path modules/inspect/mcp/silk.toml

claude mcp add silk-ui -- "$PWD/build/x86_64-unknown-linux-gnu/dev/ui-inspect-mcp" \
  --connect "$PWD/silk-ui-inspect.sock"
```

Other MCP clients take the same command in their configuration.

## What people wait for

A debug build times every click, key, scroll and paste from the moment the window gets it to the frame that shows the result. When that takes more than 100 ms, it says so on standard error, naming the control and where the time went:

```text
silk-ui: slow click on button "Save": 183 ms to the next frame (handlers 150 ms, layout 20 ms, paint 13 ms)
```

With the inspector on, `ui-inspect-cli performance` lists the recent interactions with the same split. It also shows how long the app took to open its window, start the GPU and draw its first frame, and how much memory the process uses, as Activity Monitor, the Task Manager or `smem` count it. Agents get the same data from the `ui_performance` tool.

## Try it with a screen reader

Debug builds have a screen reader of their own, so you can hear your app the way a blind user does without turning on VoiceOver, NVDA or Narrator for your whole computer. It plays NVDA, VoiceOver, JAWS, Narrator or Orca on any system, with that screen reader's keys and words: arrows read by line, word and character, H jumps to the next heading, K to the next link, NVDA+F7 lists them, and Enter activates. A ring shows what it is reading, and captions at the bottom of the window show what it says. Speech uses `say` on macOS and `espeak-ng` or `spd-say` on Linux. Elsewhere you get captions only.

Ctrl+Alt+Shift+S turns it on and off at any time. Ctrl+Alt+Shift+F plays the next screen reader, M mutes speech, and C hides the captions. To start with it on, set `SILK_UI_SCREEN_READER`:

```sh
SILK_UI_SCREEN_READER=voiceover,muted silk task native demo docs/examples/apps/pad -- --debug
```

The value is `1` or a screen reader's name (`nvda`, `voiceover`, `jaws`, `narrator`, `orca`), with `muted` for captions only.

With the inspector on, the devtools have a Screen reader tab: a switch, the five screen readers, and a button for every command, each showing the keys the chosen screen reader uses for it, so you can learn them as you go. Scripts and agents use the same commands:

```sh
ui-inspect-cli screen-reader.set --on true --flavor nvda
ui-inspect-cli screen-reader.do --command nextHeading     # prints what it said
ui-inspect-cli screen-reader.transcript
```

## See the frames that reach the screen

An fps counter built on `requestAnimationFrame` counts the frames the app paints. When the GPU falls behind, that is more than the screen shows. Two things count what is presented:

- On macOS 13 and later, the Metal Performance HUD draws the presented frames per second, the frame times and the GPU time over the window. Start any build with `SILK_UI_METAL_HUD=1` (`SILK_UI_METAL_HUD=1 silk dev`) or give the window target `.metalHud(true)`. Metal decides at startup, so the HUD cannot be switched while the app runs. Other systems show nothing.
- In JavaScript, `frameStats()` from `@silkui/core` returns what was presented since its last call: `{ frames, fps, dropped, p50, p95, p99, max }`, with frame times in milliseconds. `dropped` counts painted frames the GPU never drew.

## Turning it off for good

An app that must never serve the inspector, even in a debug build, says so on its window:

```silk
let mut window = run Window.make("Pad", 640.0, 440.0)
window.uninspected()
```
