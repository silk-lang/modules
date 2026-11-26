# Development

Use Silk's toolchain for builds, formatting, tests and documentation. Run commands from the
repository root; every package is a workspace member under `modules/`. CI provisions Clang 22
before installing the Silk release pinned in `silk.toml`.

```sh
silk use
silk format --check
silk check
silk test --manifest-path modules/core/silk.toml --root src/tests.silk
silk build
```

Each library package has its tests under `src/tests.silk`. Keep the package names (`crdt-btree`,
`crdt-core`, `crdt-sync`, `crdt-store-sqlite`, `crdt-server`, `crdt-bench`) and their exports
compatible with existing consumers. lib-sqlite is pinned by an exact commit in
`modules/store-sqlite/silk.toml`; a dev release builds only dependencies written for that same
release, so bump it together with `silk-version`.
