# Silk Modules

Unified Silk workspace containing the official Silk libraries and UI frameworks.

## Layout

| Path | Description |
| --- | --- |
| `lib/crdt` | CRDT data structures, sync protocol, SQLite store, and server |
| `lib/css` | CSS properties, style engine, and layout engine |
| `lib/fonts` | Font parsing, shaping, outlining, rasterization, and web fonts |
| `lib/graphics` | 2D vector graphics, geometry, codecs, atlas, GPU scene, and UI renderer |
| `lib/native` | Native platform windowing, WebGPU (Dawn / browser), and Metal bindings |
| `lib/silkjs` | SilkJS JavaScript engine, runtime, CLI, and native codecs/crypto |
| `lib/sqlite` | SQLite bindings (`db-sqlite`) |
| `lib/svg` | SVG parsing, filters, text, CPU/GPU rasterization, and Wasm renderer |
| `loom` | Loom UI framework, components, navigation, DOM bridge, devtools, and Ghostty terminal |
| `silk-ui` | SilkUI framework, tree/window/browser/JS runtimes, `@silkui/*` npm packages, and docs site |

## Common Commands

All Silk packages share a single root workspace (`silk.toml`), a single pinned `silk-version`, and a single content-addressed `build/` directory.

```sh
silk use
silk format --check
silk check --workspace
silk task check
```

Every package that defines automation places its `tasks.silk` at the package root:

```sh
silk task --manifest-path lib/crdt/silk.toml ci
silk task --manifest-path lib/css/silk.toml ci
silk task --manifest-path lib/fonts/silk.toml check
silk task --manifest-path lib/graphics/silk.toml check
silk task --manifest-path lib/native/silk.toml check-workspace
silk task --manifest-path lib/svg/silk.toml check
silk task --manifest-path loom/silk.toml check
silk task --manifest-path silk-ui/silk.toml check
```

## CI & Incremental Builds

CI runs through [`silk-lang/action`](https://github.com/silk-lang/action) with two layers of incrementality:

1. **Dependency-graph job planning**: `silk task ci-plan` inspects `git diff` against the workspace `silk.toml` dependency graph so pull requests only run the platform/subsystem jobs whose transitive dependency closure changed.
2. **Content-addressed Silk caching**: `silk-lang/action@v1` restores and saves the shared `build/` directory, `~/.silk/git`, and `~/.silk/archives`, so unchanged packages and tests are skipped automatically.
