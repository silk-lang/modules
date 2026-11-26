# Get started

A Silk UI app starts from a template. One command makes the project, a second opens it in a window, and from then on an edit shows up while it runs.

## Make an app

You need [Silk](https://github.com/silk-lang/silk), and for the JavaScript templates also Node and npm.

```sh
silk init my-app -t ui-react
cd my-app
silk dev
```

`silk run` does the same in the JavaScript templates. The first `dev` installs the npm packages and builds the window, which takes a few minutes. After that it starts in seconds. Edit `js/App.tsx` while the window is open: Vite replaces the modules you changed, and the counter keeps its count.

On Linux the window system's headers have to be installed first:

```sh
sudo apt-get install libx11-dev libxkbcommon-dev libwayland-dev wayland-protocols
```

## Pick a template

The template decides what you write the app in. Each one is a hello-world you can run right away.

| Template | You write the app in | Runs on |
| --- | --- | --- |
| `ui-react` | React and TypeScript, in `js/` | `window` |
| `ui-foldkit` | Foldkit, in `js/` | `window` |
| `ui-js` | Plain TypeScript with `@silkui/core`, in `js/` | `window` |
| `ui-loom` | [Loom](/core/), Silk's own framework, in `silk/app.silk` | `window`, `web-dom`, `web-canvas` |

JavaScript apps run in the window on the SilkJS Engine, embedded in the program: there is no browser inside. The [Products](/products/) page says what each name means.

## What is in the project

The project root holds both the Silk and the npm side, so `silk dev` and `npm install` both run there:

| Path | What it is |
| --- | --- |
| `silk.toml` | The manifest. `source = "silk"` points Silk at `silk/`. Its explicit dependencies include the tasks, hosts and runtime packages |
| `silk/tasks.silk` | The app definition, and the `dev`, `build` and `plan` tasks |
| `js/` | The app |
| `package.json`, `vite.config.js` | The npm packages, and Vite with `@silkui/vite` in its config |

A Loom template has `silk/app.silk` in place of `js/` and the npm files, and depends on `loom` as well.

In a Loom app, `dev` rebuilds and restarts the window when you save a file in `silk/`, and the model comes back as it was. Fields are matched by name: a field you add starts with its `init` value, and one whose type you changed starts over, which the terminal reports. Only `pub` fields are kept, and enums start over. The window keeps its size, focus and scroll positions too. Each new `silk dev` starts from `init`.

The app definition is a few lines at the top of `silk/tasks.silk`:

```silk title="silk/tasks.silk"
effect fn app() -> App ! OutOfMemoryError ? &mut Allocator {
  return run App.make("my-app")
    |> App.framework(Framework.react("."))
    |> App.target(Target.window(Window { title: "My app", width: 1040.0, height: 720.0 }))
}
```

Below it, `dev` and `build` are pipelines of steps, written out so you can read and change them. silkui generates the window entry module as a cached build step, so there is no host code to maintain in the project.

## Build it

```sh
silk build --release --out dist
```

`dist/window/my-app`, named after the project, is the release program, with the bundle inside and no development tools. Copy it anywhere and run it. Without `--out`, the build keeps it in `build/<triple>/release/`, beside the other builds, and lists where it is. Without `--release` the task builds the same program unoptimized, into `build/<triple>/dev/`, which builds faster.

## Add a target

A target is where the app runs, and it is one line in `app()`. A Loom app can also run in a browser page:

```silk
    |> App.target(Target.webDom(Page { title: "My app" }))
    |> App.target(Target.webCanvas(Page { title: "My app" }))
```

`silk dev --target web-dom` serves the page on `http://127.0.0.1:8090/` and reloads it when `silk/` changes. `silk build --release --out dist` writes each page to `dist/<target>/` as a static site, and `--target web-dom` builds only that one. JavaScript apps run in a window for now; the web canvas comes next.

## Call Silk from JavaScript

A JavaScript app can import Silk functions. They are compiled into the app's program and run natively, with no WebAssembly:

```silk title="silk/math.silk"
/// Whether `n` is prime.
pub fn isPrime(n: u32) -> bool {
  if n < 2 { return false }
  let mut d: u32 = 2
  while d * d <= n {
    if n % d == 0 { return false }
    d = d + 1
  }
  return true
}

/// How many primes are below `limit`.
pub fn countPrimes(limit: u32) -> u32 {
  let mut found: u32 = 0
  let mut n: u32 = 0
  while n < limit {
    if isPrime(n) { found = found + 1 }
    n = n + 1
  }
  return found
}
```

```js title="js/main.js"
import { countPrimes } from "../silk/math.silk";

const count = countPrimes(1000);                 // runs now, on the app's thread
const later = await countPrimes.async(2_000_000); // runs on a thread of its own
```

The manifest says which modules JavaScript can import. The package becomes a library, and the tasks get a profile of their own:

```toml title="silk.toml"
[package]
# name, version, silk-version as before
source = "silk"
kind = "library"
main = "math.silk"
exports = ["math"]

[profiles.tasks]
main = "tasks.silk"

[profiles.tasks.dependencies]
silkui = { … }
```

Public functions cross when their parameters and result are numbers (`i64` and `u64` become `bigint`), `bool`, `string` or `String`. An `effect fn` can fail (it throws an `Error` naming the failure) and can allocate. Other functions are left out, and the build says why. Arguments that do not fit, such as a string for a `u32` or a number out of its range, throw a `TypeError`.

For types in the editor, add the TypeScript plugin to `tsconfig.json`. It needs TypeScript 7.1 or newer, and `silk` on `PATH`:

```json title="tsconfig.json"
"contentMappers": [{ "package": "@silkui/vite", "extensions": [".silk"] }]
```

Hover shows the Silk doc comment, go to definition opens the `.silk` file, and Silk errors show in the editor. `tsc` needs `--runExternalCode`. With an older TypeScript, `.silk/natives/types/` has the same declarations as `.d.silk.ts` files, for `rootDirs` with `allowArbitraryExtensions`.

Under `silk dev`, saving a `.silk` file rebuilds the window's program and starts it again, in a few seconds. The JavaScript state starts over, as after a page reload; if the build fails, the previous program keeps running until the next save.

## Draw the title bar

On macOS the app can fill the whole window, with the window controls floating over its top:

```silk
    |> App.target(Target.window(Window { title: "My app", width: 1040.0, height: 720.0 })
      .titleBar(TitleBar.transparent(56.0)))
```

The app draws its own bar in those top 56 pixels and leaves room on the left for the controls, which are centred in it. In a JavaScript app a press moves the window only where CSS says so, as in Electron: give the bar `app-region: drag` (or `-webkit-app-region: drag`), and buttons inside it `no-drag` so they still get clicks. Import `TitleBar` from `silkui.app` beside `Window`. Windows and Linux keep the system's bar above the app.

To put the three window buttons somewhere else in the bar, give their top-left corner in pixels from the window's left and top edges: `TitleBar.transparent(56.0).buttons(20.0, 18.0)`. A 0 keeps that one centred.

## Next

- Write a Loom app: [your first program](/core/first-program/), then the [tutorial](/core/tutorial/).
- See what a window app is made of underneath: [your first window](/native/).
- Give a JavaScript app Node's APIs: add `|> App.runtime(Runtime.node())` to `app()`.
