# Testing without a window

A native app is a program plus services. Swap the services, and the whole app runs inside a test: no window, no display, no files on disk. This page tests Pad from [The shell](/native/shell/), menus and dialogs included.

```sh
silk test --manifest-path docs/tests/silk.toml --root src/tests.silk
```

## The test

::source tests/src/native.silk "effect fn padBody"

::source tests/src/native.silk "test effect fn aNativeAppWithoutAWindow"

## A shell that takes notes

`ShellLog` is a `Shell` for tests. It does nothing on a screen. It writes down what the program asked of it, one line for each request, and keeps a clipboard of its own.

```silk
let mut shell = ShellLog.make()
run padBody() |> Effect.provideMut<Shell>(&mut shell)

run Testing.expect(shell.has("setTitle Pad (edited)"), "the title was marked")
```

After the program has run, the test reads the log. `shell.has(line)` asks whether a request was made.

## Saying what a window would say

A real window tells the program things through subscriptions: a menu item was chosen, a dialog closed. In a test, the test says them, by posting to the ports those subscriptions listen on.

| Port | Posted text | Is heard by |
| --- | --- | --- |
| `PORT_MENU` | The action, as a number: `"3"` | `subs.menuAction` |
| `PORT_FILES` | The request, then one path per line: `"2\n/tmp/note.txt"` | `subs.files` |
| `PORT_APPEARANCE` | `"dark"` or `"light"` | `subs.appearance` |
| `PORT_FOCUS` | `"1"` or `"0"` | `subs.windowFocus` |
| `PORT_CLOSE` | Anything | `subs.closeRequested` |

So "the user chose Save As, picked a file, and it was written" is three lines:

```silk
run post(&mut app, &mut page, PORT_MENU, "3")
run post(&mut app, &mut page, PORT_FILES, "2\n/tmp/note.txt")
run Testing.expect(!app.model.value.dirty, "a save cleans the note")
```

A dialog that was cancelled is the request with no paths: `"2"`.

## A disk in memory

::source tests/src/native.silk "struct OneFile"

::source tests/src/native.silk "impl Disk for OneFile"

The program's own service gets the same treatment. This disk holds one file, in memory. After the test, `disk.text` is what the app saved.

## The whole app, with no display

The tests above run the program. A **headless run** runs the whole app: the same binary, its real window host, its fonts and its frames, with no display, no GPU and no window. Point `SILK_UI_HEADLESS` at a script and start a debug build:

```sh
SILK_UI_HEADLESS=pad.script ./build/llvm/x86_64-unknown-linux-gnu/debug/pad
```

```sh
# pad.script
size 640 440
screenshot empty.png
record typing.mp4
type "Tide tables" --test-id note
wait 500ms
stop
wait --text "Tide tables"
screenshot edited.png
snapshot tree.txt
silk-ui.model
```

Each line is a command of [`ui-inspect-cli`](/native/devtools/#from-the-command-line), with the same names for nodes, run inside the app. There is no system around the app, so menus, dialogs and other parts of [the shell](/native/shell/) do nothing, but the script can play the desktop's part. A few lines are the run's own:

| Line | Does |
| --- | --- |
| `wait 500ms`, `wait 2s` | Lets that much time pass |
| `size 640 440`, `size 640 440 2` | Resizes the window, optionally with a device pixel ratio |
| `record pad.mp4` ... `stop` | Records the frames in between as a 60 fps video, with ffmpeg. A name ending in `/` keeps the frames as PNG files instead |
| `record pad.mp4 --show-input` | Also draws the input into the video: a ring where the pointer goes down, and the keys pressed and text typed in a caption at the bottom. Only the video sees them, never the app or its screenshots |
| `record pad.mp4 --overview pad.png` | At `stop`, also writes one image of twelve frames picked evenly from the recording, in rows of four, for a pull request or a review |
| `drop notes.txt at 120 80` | Drags files in from the desktop and drops them there, the window's middle without `at` |
| `shortcut 1`, `tray`, `tray right`, `tray-item 3`, `click-notification 1` | A global shortcut, a click on the tray icon or an item of its menu, a click on a notification |

`snapshot` without a file and commands that answer with data, such as `query` or `silk-ui.model`, print to standard output. `#` starts a comment.

Time in a headless run is not the clock's. Every frame moves it exactly 1/60 of a second, however long the frame took to draw, and frames are drawn on the CPU. So the same script gives the same pixels on every machine, and `wait 2s` takes as long as drawing 120 frames, often far less than two seconds. Work outside the program, such as JavaScript timers and network requests, still runs on the real clock.

A command that fails, or a `wait` for a node that does not appear within 10 seconds of the run's time, stops the run: it says which line and exits with status 1. A script that reaches its end exits with 0. That makes a script a test of the real app, for CI machines without a display.

## The real window, checked

The tests above cover the program. One thing they cannot cover is the window itself: that the GPU draws what the program describes.

For that, a window can run in **check mode**. It opens for real, clicks one node, waits for another to appear, compares what the GPU drew with the same frame drawn on the CPU, and exits with the result.

```silk
let mut window = run Window.make("Counter", 360.0, 160.0)
window.checking("+", "1")
```

`checking(click, expect)` names the node to click and the node that must show afterwards. It is meant for one smoke test per app, run in CI on a machine with a display.

## The same program everywhere

Look back at what stayed the same on every page of this guide: the program. The counter ran in a page, in a window and in a test. Pad ran in a window with real menus and in a test with a log.

| Where | Who draws | Who provides the services |
| --- | --- | --- |
| A native window | The UI tree, on the GPU | The window's shell, your own structs |
| [A web page](/core/browser/) | The browser's DOM | Structs that call JavaScript |
| A test | Nobody, or the tree without a GPU | Structs the test controls |

The window draws through the [UI tree](/tree/). You do not need to know it to build an app, but if you want to see what is underneath, or build something other than an app on it, that guide is next.
