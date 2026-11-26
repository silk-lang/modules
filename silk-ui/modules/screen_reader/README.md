# ui-screen-reader

A screen reader for development. It plays NVDA, VoiceOver, JAWS, Narrator or Orca on any system,
so an app can be heard the way a blind user hears it without turning a real screen reader on.

It reads the same AccessKit `TreeUpdate`s a platform adapter gets, keeps them in an AccessKit
consumer `Tree`, and turns them into a document of items (text runs, controls) in reading order,
grouped into lines. Keys come in, and speech and AccessKit `ActionRequest`s go out, so it runs
headless and in tests.

```silk
let mut reader = Reader.make(Flavor.Nvda)
run reader.update(move update)                    // each TreeUpdate, the first one full
if run reader.key("h", "KeyH", 0, true) { ... }   // true: the reader took it, the app must not see it
run reader.takeSpeech(&mut said)                  // what to say, and whether it interrupts
run reader.takeRequests(&mut actions)             // Focus, Click, ScrollIntoView for the app
run reader.perform(Command.SayAll)                // what a panel button or a tool asks for
```

What it does, in each flavor's keys and words:

- A virtual cursor over everything, static text included: by line, item, word and character,
  start and end of line, top and bottom.
- Quick navigation by headings (and levels), links, form fields, buttons, edits, check boxes,
  radio buttons, combo boxes, tables, lists, list items, landmarks and graphics.
- The elements list (NVDA+F7, the VoiceOver rotor, JAWS and Orca lists), filtered by typing.
- Browse and focus mode (forms mode, scan mode), entered on its own in text fields and
  composite widgets; VoiceOver has none.
- Roles, names, values, states, levels and positions as each screen reader phrases them, and
  the containers entered and left on the way.
- Table navigation by row and column, with headers.
- Focus changes, state changes of the focused element, and live regions.

`command.silk` names every command (`commandName`, `commandTitle`) and `flavor.keyLabel` gives
the keys a flavor uses for one, for panels that show them.

The window host runs it beside every client in debug builds: see
`modules/tree/window/src/screen_reader.silk` and the devtools page of the docs.
