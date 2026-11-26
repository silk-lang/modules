# Inspector query benchmark

`src/benchmark.silk` lays out the inbox fixture and repeats tree queries, descriptions of two
nodes, and overlay composition 5,000 times. It excludes PNG encoding and fails if the operations
produce no output. Run the executable from the repository root so fixture assets resolve.

Create an explicit compilation definition with absolute `manifest` and `settings.root` paths to
`modules/inspect/tests/silk.toml` and `modules/inspect/tests/src/benchmark.silk`:

```toml
manifest = "/absolute/path/to/silkui/modules/inspect/tests/silk.toml"
artifact = "executable"
[settings]
root = "/absolute/path/to/silkui/modules/inspect/tests/src/benchmark.silk"
modules = []
[settings.profile]
optimization = "none"
debug = true
codegen-units = 16
[settings.native]
sources = []
link = []
```

Resolve and compile it with `silk resolve --definition dev.toml --output dev.request.toml
--artifact /absolute/path/to/inspect-dev`, then `silk compile --request dev.request.toml`.
For the mixed build, copy the definition and add these package overrides; keep the application
and other dependencies at `none`:

```toml
[packages.ui_tree]
optimization = "speed"
excluded = false
parameters = []
[packages.ui_inspect]
optimization = "speed"
excluded = false
parameters = []
```

Resolve that definition to a separate request and executable. Alternate three runs of each
executable on an idle machine; on Linux, pin both to the same CPU with `taskset`. Record process
CPU time as well as elapsed time. Compilation time is separate from these runtime measurements.

Measured on 2026-11-16 with the pipeline preview compiler, Linux x86-64, one pinned CPU,
three alternating samples per build:

| Build | CPU samples (s) | Median CPU (s) | Median elapsed (s) |
| --- | --- | --- | --- |
| All packages `none` | 23.349, 23.907, 22.639 | 23.349 | 23.482 |
| `ui_tree` and `ui_inspect` at `speed` | 22.956, 22.187, 24.314 | 22.956 | 23.037 |

The mixed build reduced median CPU time by 1.7% and elapsed time by 1.9%. The sample ranges
overlap, so this is a modest measured difference, not evidence of a large inspector speedup.
Neither build uses cross-package ThinLTO. These measurements are evidence, not timing assertions
in the correctness suite.
