# Optional Tailwind build step

`ui-tailwind` runs Tailwind before the UI pipeline reads its CSS. It has no UI runtime dependencies and is never linked into an app. Plain CSS needs only `App.stylesheet`; Vite apps should use `@tailwindcss/vite` with `@silkui/vite` instead.

Add `modules/tailwind` from the same SilkUI revision as a tasks dependency named `tailwind`. Import `tailwind.tailwind { Tailwind }` in `tasks.silk`.

```silk
let processor = Tailwind.make("styles/input.css", "styles/app.css")
```

For a release task, run `processor.build()` before `App.build(&options)`:

```silk
drop run processor.build()
run app() |> App.build(&options) |> Built.write("dist")
```

For development, wrap the app task:

```silk
run processor.watching(
  app() |> App.dev(&options) |> Built.launch() |> Running.watch()
)
```

Both paths finish an initial CSS build before the app starts. `watching` then starts Tailwind with `--watch=always`, so edits to scanned sources and imported CSS rebuild the output. The UI pipeline watches that output and replaces the stylesheet while preserving app state. The watcher is stopped when the wrapped task returns or fails. Tailwind's diagnostics share the task's terminal.

The app definition uses the generated output:

```silk
App.make("my-app") |> App.stylesheet("styles/app.css")
```

The input can scan Silk source as plain text:

```css
@import "tailwindcss" source(none);
@source "../src/**/*.silk";
```

Use literal classes such as `class("flex gap-2")`. Tailwind cannot discover classes assembled at runtime. Ignore generated CSS in Git; commit the input CSS, sources and lock file.

## Choosing the executable

The helper first uses `node_modules/.bin/tailwindcss` in the project directory. Install `tailwindcss` and `@tailwindcss/cli` with your package manager and commit its lock file. The helper never runs an implicit package installation or `npx`.

Without a project CLI, copy this package's [`tailwind.lock.json`](tailwind.lock.json) into the project. It pins Tailwind 4.3.5 and the SHA-256 of each official standalone asset. Commit it. The helper downloads the selected binary over HTTPS using `curl`, verifies it before publication, and stores it under `~/.silk/cache/tailwind/<version>/<sha256>/`. Subsequent builds verify and reuse the cached binary without a download. A checksum mismatch fails the build; a modified cached binary must be removed before retrying. The lock file is never updated implicitly.

To update Tailwind, change the exact version and platform hashes together using the release's `sha256sums.txt`. The executable URL is derived from the version and platform on the official Tailwind GitHub release. The lock does not accept an arbitrary executable URL.

`Tailwind.within("frontend")` selects a project directory; input, output, lock and local CLI paths resolve within it. `Tailwind.locked("tools/tailwind.lock.json")` changes the lock path. `build()` returns the output path relative to the tasks working directory. The helper works with macOS and Linux tasks, matching the pipeline's subprocess support. The Linux default uses the glibc asset; select `Tailwind.forPlatform("linux-x64-musl")` or `"linux-arm64-musl"` on musl systems. Windows task support is not implemented.

The standalone download needs `curl` and `chmod`, but no Node installation. Build failures stop the app build; a failed CSS rebuild leaves the last successfully adopted sheet in the running UI. Tailwind watch errors are printed to the task terminal. The first standalone download is about 100 MB.
