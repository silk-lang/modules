# SilkJS

SilkJS is JavaScript written in [Silk](https://github.com/silk-lang/silk). It comes as two
products, split the way Node and V8 are:

- **SilkJS** is the runtime: the engine plus an event loop, Node builtins, `fetch` and a package
  manager. It owns the `silkjs` command.
- **SilkJS Engine** is the embeddable JavaScript engine, a native Silk port of QuickJS, with its
  embedding API. It has no event loop and no Node or web APIs.

[Silk UI](https://github.com/silk-lang/silkui) embeds either one to run JavaScript apps.

| Module | Package | What it is |
| --- | --- | --- |
| [`modules/engine`](modules/engine) | `silkjs-engine` | The SilkJS Engine: the JavaScript engine, its embedding API and the `silkjs-engine` shell |
| [`modules/runtime`](modules/runtime) | `silkjs-runtime` | SilkJS, the Node-compatible runtime and its `silkjs` command; depends on the engine by path |
| [`modules/benchkit`](modules/benchkit) | `benchkit` | The benchmark harness the `bench` tasks of the engine and the runtime are written with |
| [`modules/pm`](modules/pm) | `pm` | The package manager, in Silk on the Silk standard library; it will run as the runtime's `install`, `add` and related commands |

The two are released together. The root [`silk.toml`](silk.toml) is a Silk workspace whose
`silk-version` pins the one toolchain both modules build with, overriding their own pins; move
them all with `silk set <version>` at the root. Both packages share one `version`, kept equal by
hand. `silk build` writes compiled packages to the workspace's `build/` at the repository root.

Each module is its own Silk package with its own `silk.toml` and tasks. Run tasks from the
module's directory:

```sh
silk use              # install the pinned Silk release
silk check --workspace

cd modules/engine
silk task             # list the engine's tasks
silk task check       # the correctness gate (needs `silk build --release`)
silk task bench-octane   # Octane against other engines (modules/engine/bench/README.md)

cd ../runtime
silk task runtime     # the runtime executable, modules/runtime/build/silkjs
silk task compat      # the differential cases against Node 24
silk task bench-all   # the benchmarks against Bun (modules/runtime/bench/README.md)
```

The runtime history was merged from
[julia-script/silkjsruntime](https://github.com/julia-script/silkjsruntime); `git log --follow`
reaches commits from before the move.
