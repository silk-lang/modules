# loom-inspect

silk-ui's inspector extension, `silk-ui`: what a silk-ui program adds to the inspector
([ui-inspect-server](https://github.com/silk-lang/silkui/tree/main/modules/inspect/server)), which knows the tree and nothing else. It is
registered and served through the inspector's extension API
([Extensions](https://github.com/silk-lang/silkui/blob/main/modules/inspect/server/README.md#extensions)), the way any other framework would add
its own; loom itself knows no inspector, and the inspector, its CLI, its MCP bridge and the
devtools know nothing of silk-ui.

| Name | Members | What |
| --- | --- | --- |
| `silk-ui.program` | | `attached`; `steps` held with the `first` and `last` seq; the `model` now, as text; `subscriptions`; `stats`: `renders`, `dispatches`, `messages`, `commands`, `mutations`, `nodes`, `reused` |
| `silk-ui.messages` | `since` (a `seq`), `limit` | `messages`: the steps after `since`, oldest first, each `{"seq", "time", "cause", "message", "commands", "changed"}`; `next` |
| `silk-ui.model` | `seq` (default: the last step) | `model`: the model after that step, one line per field; `diff`: `{"op": " "\|"+"\|"-", "line"}` against the step before; `changed` (lines) |
| `silk-ui.restore` | `seq`, or `file` | `restoring`: puts back the model after step `seq`, or the one in a state file, on the host's next turn; the log gets a step for it (cause `devtools`) |
| `silk-ui.save` | `file` | writes the model now to a state file, `{"step", "model"}`; `file` and `step` |
| topic `silk-ui.message` | | the program handled messages; `next` is the `seq` the next one gets |
| panel `program` | | "Program": data `silk-ui.program`, read again on `silk-ui.message`, and a view on `silk-ui.view.program` |

The MCP bridge makes `silk_ui_program`, `silk_ui_messages`, `silk_ui_model`, `silk_ui_restore`
and `silk_ui_save` of the commands;
the CLI runs them by name (`ui-inspect-cli silk-ui.messages --since 4`).

```silk
let mut inspector = run startInspector(InspectorOptions.make())
run inspector.extend(run SilkUi.extension())
let mut silkUi = SilkUi.make()
// on every turn of the loop, while the inspector is on:
run silkUi.record(&mut runtime)                  // the journal's new steps, counters, subscriptions
run inspector.serveExtension(ID, &mut silkUi)    // answer, push the topic, render the panel
run silkUi.apply(&mut runtime, &mut tree)        // a model asked for with restore, rendered
```

`loom-window` does exactly this for every program it runs.

## The Program panel

`panel.silk` is a silk-ui program of its own, written with `Document`: the counters and
subscriptions, then every message newest first with what sent it and the commands `update`
returned, a marker on the steps that changed the model, and a click on a step opens the model
after it with the lines it added and removed. "Return here" on an older step puts that model back. It runs in the app, on a `ViewBackend` whose
batches go to the clients that opened the panel and whose events come back from them, only while
one has it open; opening it again starts it from nothing. A client draws it with its own fonts
and look (the devtools replay it, see
[Remote views](../../devtools/README.md#remote-views)).

## Tests

- `modules/loom/window/tests` (`silk_ui.silk`): a counter program and the extension over a
  session in the same process: hello lists it, the inspector itself has no `messages`, a request
  waits until the extension is served and then gets the messages, the topic is pushed, a model
  diff, the program and an unknown step; returning to a step on the next turn, logged as a step;
  saving to a state file and restoring from it after the app moved on; the Program panel's view runs only while subscribed,
  starts from nothing, follows a new message, and stops when closed.
- `modules/devtools/tests`: the devtools show the Program panel the app renders, in the
  tests' session and in the app's own process, and a golden scene of it.

## Limits

- The log keeps the last 200 steps. A model is text (what `show` prints), so `model` diffs
  lines, not values.
- Going back puts the model back, not the world: commands that already ran stay done, and
  later messages go on from the restored model. Each step keeps its model as `loom.keep`
  writes it, so what `keep` cannot write (enums, arrays, maps, private fields) keeps its
  current value, and a model past 256 KiB as JSON cannot be returned to.
- A state file holds the model a debug build had; `SILKUI_STATE=<file>` starts a debug build
  from it when there is no model kept across a restart. Relative paths are from the app's
  working directory.
- While the panel is open it keeps its own copy of the steps the log holds.
