# Effect UI Showcase on Silk UI

Interactive showcase running [Effect UI](https://ui.effect.website/) (`@effect/ui` and
`@effect/ui-kit`) directly on `@silkui/core/globals` and the Silk UI GPU-rendered retained
tree with Tailwind CSS v4 — no framework-specific adapter required.

## What's inside

- **Studio** — Component-scoped Elm Architecture counter with async `DelayReset` Command
  (`h.isRunning`) and `Stream.tick` Subscription, a 60fps native Silk UI `<canvas>` harmonic
  wave synthesizer driven via `Mount`, a debounced `Query.Service` stack search with caching,
  and a live macOS `memoryUsage()` + FPS telemetry pill in the titlebar.
- **UI Kit** — Headless `@effect/ui-kit` components (`Tabs`, `Switch`, `Checkbox`, `RadioGroup`,
  `Slider`, `Progress`, `Meter`, `Accordion`, `ToggleGroup`, and top-layer `Dialog`) running
  unmodified on Silk UI.
- **Log** — Live inspector powered by Effect UI's `MessageLog` service showing every
  Update, Command, Query, and Mount across components in real time.

## Build & Run

From `modules/js`:

```sh
npm install
npm run build --workspace=effect-ui-showcase
```

Then from the SilkUI repository root:

```sh
silk run --manifest-path modules/js/demo/silk.toml --release \
  modules/js/examples/effect-ui-showcase/dist/app.js
```
