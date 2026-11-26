# SilkJS

SilkJS is a Node-compatible JavaScript runtime written in [Silk](https://github.com/silk-lang/silk). It runs on the [SilkJS Engine](../engine), the native Silk port of QuickJS, instead of V8. The package is `silkjs-runtime` and the command is `silkjs`.

Node 24 is the compatibility reference. [Deno](https://github.com/denoland/deno) is an organizational reference for the core/extension split—not a runtime dependency or a source of Deno-specific APIs. JavaScript executes in the SilkJS Engine; there is no Node or V8 execution fallback.

## Build

The verified build target is **macOS arm64**. Linux x64 builds and passes the differential suite (72/72, November 2026); other platforms are not claimed as verified.

Requirements:

- The Silk launcher; `silk.toml` pins the compiler version.
- Clang 22 or newer, and Python 3.12 or newer for `silk task runtime`.
- A macOS SDK supporting the compiler's macOS 11 deployment target. The build selects the installed macOS 15.5 SDK when `SDKROOT` is unset; otherwise set `SDKROOT` explicitly.
- Network access on the first build: Silk downloads the pinned, checksum-verified source releases of the C libraries and compiles them itself.

Nothing needs installing besides. OpenSSL, nghttp2 and Brotli are packages of [`../native`](../native), each compiled from its pinned release (`[native.archive]` in its `silk.toml`, with the build in its `build.silk`). zlib and Zstandard are not among them: `node:zlib` runs on Silk's own DEFLATE code and writes the bytes of Node 24's zlib, which is Chromium's ([`ZLIB_NOTES.md`](ZLIB_NOTES.md)), and Zstandard is the Silk port in [`../zstd`](../zstd) ([`ZSTD_NOTES.md`](ZSTD_NOTES.md)); both are `./compress`'s. There is no libuv: the core's event loop is `silk.io.reactor` alone, and libuv 1.51's C API, which Node-API addons call, is Silk in `./napi` ([`napi/src/ext/uv_loop.silk`](napi/src/ext/uv_loop.silk) and `uv_api_*`; [`LIBUV_REPLACEMENT_NOTES.md`](LIBUV_REPLACEMENT_NOTES.md)). WASI is Silk too (`./wamr`). WAMR, with this runtime's patches, is vendored in [`../native/wamr`](../native/wamr), with the runtime's C over it. The built-in JavaScript is embedded from its files by [`builtin_sources.c`](builtin_sources.c), so an edit to a built-in needs nothing run first; adding or removing one does ([`tools/embed.py`](tools/embed.py)), and so does moving one to another service in [`tools/capabilities.toml`](tools/capabilities.toml). SQLite comes from the `db-sqlite` package of [silk-lang/lib-sqlite](https://github.com/silk-lang/lib-sqlite).

```sh
git clone https://github.com/silk-lang/lib-silkjs.git
cd lib-silkjs/modules/runtime
silk use
silk task runtime
./build/silkjs -p 'process.versions'
```

A plain `silk build` in [`cli`](cli) builds the executable too, and is how a program that embeds the runtime builds (see [Embed](#embed)). `silk task runtime` adds what only an executable that can run on the build machine gets: the built-ins' bytecode, compiled by the executable itself and linked into it, and a startup heap image, so a start does not run the bootstrap.

Use `SILK_CLANG` to select a particular Clang executable. `silk task runtime --release` builds with speed optimization; `--output PATH` selects the output executable. `silk task` lists the other tasks: `embed`, `compat` and `sea` run the Python tools in [`tools/`](tools/), which can still be run directly, and the benchmark tasks of [`bench/`](bench/README.md) are written in Silk. The first build compiles about 1,300 C files once (Silk compiles them one at a time), a few minutes; later builds reuse the objects.

The engine is this repository's [`modules/engine`](../engine), a path dependency in `silk.toml`, so engine and runtime changes land together. An installed Node executable is not required to build or run it.

## Run

```sh
./build/silkjs app.js
./build/silkjs app.mjs
./build/silkjs app.ts
./build/silkjs -e 'console.log(require("node:path").join("a", "b"))'
./build/silkjs --test
./build/silkjs -i
```

The package manager of [`modules/pm`](../pm) is in the executable. Its commands come where a script would, and run without starting the engine:

```sh
./build/silkjs install            # what package.json lists; the lockfile is sjs.lock
./build/silkjs add left-pad       # also: add -D, add name@range, add name@tag
./build/silkjs remove left-pad
./build/silkjs update
./build/silkjs ci                 # install, and fail when the lockfile is out of date
./build/silkjs run build          # a script of package.json; arguments follow the name
./build/silkjs run -r build       # in every package of the workspace that has the script
./build/silkjs exec tsc --noEmit  # a command of the dependencies
./build/silkjs dlx cowsay hello   # a command of a package the project does not have
```

In a workspace, a `package.json` with `workspaces`, the commands install for every package from any of their directories, and `add --filter <name>` or `add -w` choose the package to change.

A script that calls `node` on a machine without Node.js gets this executable, which by that name runs a file and has no package manager commands.

The install scripts of a dependency run only when `allowBuilds` in the `package.json` of the project names it: `"allowBuilds": { "esbuild": true }`.

A dependency can also be a tarball (`https://…/pad.tgz`, `file:vendor/pad.tgz`), a directory (`file:../pad` copies it, `link:../pad` links it) or a repository on GitHub, GitLab or Bitbucket (`github:owner/repo#v1.0.0`, `owner/repo`, `git+https://…`), which is installed without git. [`modules/pm`](../pm) has the details.

A script file named like one of the commands (`install`, `i`, `ci`, `add`, `remove`, `rm`, `uninstall`, `un`, `update`, `up`, `upgrade`, `run`, `run-script`, `exec`, `dlx`) is run with its path: `./build/silkjs ./install`.

The implementation includes CommonJS and ESM package loading, TypeScript execution, filesystem and process APIs, streams, networking and TLS/HTTP2, crypto and WebCrypto, workers and cluster, SQLite, Intl (SilkJS's ECMA-402 implementation in Silk, with its own CLDR-derived locale data; no ICU), Web APIs, WebAssembly/WASI, Node-API addons, the test runner, REPL, inspector, and native profiling. Feature-specific fixtures in [`tests/`](tests/) exercise these contracts, including cross-process and cross-realm ownership and failure paths.

## Embed

Another Silk program can run the runtime inside itself with [`runtime.embed`](src/runtime/embed.silk) (the `silkjs-runtime` package exports it). The executable owns its process; an embedded runtime does not. Its host passes the arguments it would have had, turns the loop from its own loop, and `process.exit()` ends the runtime instead of the process:

```silk
struct App {}
impl Host for App {
  effect fn drive<'e, 'm, C: Composition>(self: &mut Self, runtime: &mut Runtime<'e, 'm, C>) -> i32 ! OutOfMemoryError | JsException ? &mut Allocator {
    run runtime.evaluateModule(b"/app/main.mjs", source)
    while true {
      // Timers, then native completions (waiting at most 16 ms), then immediates.
      match run runtime.turn(16.0) { Turn.Running => () Turn.Finished { status } => { return status } }
    }
    return 0
  }
}
// One implementation per capability: here the process's environment, modules from the files of
// the operating system, no WebAssembly and no functions of the host's.
let capabilities = Capabilities { platform: OsPlatform {}, modules: NodeResolution {}, files: OsFiles {}, compression: NativeCompression.make(), http2: Nghttp2.make(), crypto: OpenSslCrypto.make(), tls: OpenSslTls.make(), database: SqliteDatabase.make(), addons: DlopenAddons.make(), processes: OsProcesses {}, network: OsNetwork {}, http: Llhttp.make(), systemInfo: OsSystemInfo {}, typeStripping: Amaro {}, workers: ThreadWorkers {}, inspector: NodeInspector.make(), wasm: EmptyWasm {}, hostApi: EmptyHostApi {} }
let status = run embed.start(run Options.make(b"app"), &mut app, move capabilities)
```

The capabilities are [`libs.core.capabilities`](src/libs/core/capabilities.silk), and the list is closed: every field of `Capabilities` must be given. The runtime is compiled for their types, so a capability given its empty implementation is not in the program. `Platform` is the environment, working directory and exit the runtime sees: `OsPlatform` is the process's, `FixedPlatform` a fixed environment and directory, where changing either throws `EPERM` ([`libs.core.platforms`](src/libs/core/platforms.silk)). `ModuleResolver` is where `require` and `import` find modules: `NodeResolution` reads the operating system's files, `MemoryModules` serves a module graph bundled into the program ([`libs.core.module_sources`](src/libs/core/module_sources.silk)); both resolve as Node does. `Files` is what `fs` stands on: `OsFiles` is the operating system's, `RootedFiles` the same under one directory, `MemoryFiles` a file system in memory that the host can seed, `GrantedFiles` the operating system's limited to the paths the host grants while it runs (a file dialog's choices), and `EmptyFiles` none, without `node:fs` ([`libs.core.files`](src/libs/core/files.silk), tested by `silk test --root src/files_tests.silk`). `Compression`, `Http2`, `Crypto`, `Tls` and `Database` are libraries: `NativeCompression`, `Nghttp2`, `OpenSslCrypto`, `OpenSslTls` and `SqliteDatabase`, or the empty one of each, without that part of Node (`Tls` needs `Crypto` and `Database` needs `Files`, which the build checks). `NativeAddons` is `DlopenAddons`, or `EmptyAddons`, where `process.dlopen` fails as with `--no-addons`. `Processes` is `OsProcesses`, or `EmptyProcesses`, without `node:child_process` and `node:cluster`. `SystemInfo` (`OsSystemInfo`, or `EmptySystemInfo`, without `node:os`) and `TypeStripping` (`Amaro`, which needs `Wasm`, or `EmptyTypeStripping`) are choices as well, and so is `Workers` (`ThreadWorkers`, or `EmptyWorkers`, where `new Worker()` fails), and `Inspector` (`NodeInspector`, which needs `Network`, or `EmptyInspector`, without `node:inspector` and `--inspect`; tracing and the V8 profiles stay). `Network` (`OsNetwork`, or `EmptyNetwork`, without `net`, `http`, `tty`, `fetch` and `WebSocket`, and with standard output written synchronously) needs `Http` (`Llhttp`); `Tls`, `Http2` and `Processes` need `Network`. With `EmptyWasm`, `typeof WebAssembly` is `'undefined'`. The real implementations that bring a library are packages of their own, and a program that does not depend on one links none of its library: [`./wamr`](wamr) (`WamrWasm`: WAMR), [`./compress`](compress) (`NativeCompression`: zlib, zstd, brotli), [`./http2`](http2) (`Nghttp2`), [`./llhttp`](llhttp) (`Llhttp`), [`./sqlite`](sqlite) (`SqliteDatabase`), [`./openssl`](openssl) (`OpenSslCrypto`, `OpenSslTls`) and [`./inspector`](inspector) (`NodeInspector`, with its server), [`./amaro`](amaro) (`Amaro`, its JavaScript) and [`./napi`](napi) (`DlopenAddons`, Node-API); each is made with `make()`. [`./silkcompress`](silkcompress) is `SilkCompression`, compression over `silk.compress`, [`./silkhttp`](silkhttp) is `SilkHttp`, an HTTP/1 parser in Silk with llhttp's interface, [`./silkhttp2`](silkhttp2) is `SilkHttp2`, an HTTP/2 session in Silk with nghttp2's interface, [`./silkcrypto`](silkcrypto) is `SilkCrypto`, crypto over `silk.crypto` and `silk.tls`'s certificates, and [`./silktls`](silktls) is `SilkTls`, TLS over `silk.tls` (each with the gaps the design document lists): implementations with no C library at all (`cli/src/main_silk.silk` is the executable with all five; `SilkTls` carries `silk.tls`'s client with deferred verification until a toolchain release has it; `tests/compression-differential.mjs` compares the first with Node, `tests/http-parser-differential.mjs` the second with llhttp, Node's `test-http2-*` tests the third, `tests/crypto-differential.mjs` the fourth with Node, and Node's `test-tls-*` and `test-https-*` tests the fifth). `HostApi` is the host's own native functions: `NativeFunctionId.Host` ids from `HOST_API_FIRST` reach its `call`. An embedder whose process ends with the runtime sets `Options.ownsProcess`, and starts from a heap image as the executable does: `silk task image --program PROGRAM` in [`tools/capabilities`](tools/capabilities) has the program write it and appends it. [`docs/composable-runtime.md`](docs/composable-runtime.md) is the design the other capabilities follow.

- `Runtime.turn(milliseconds)` runs one pass of the loop and waits for native completions at most that long (0 never blocks). `Runtime.timeout()` says how long until a timer is due, and `Runtime.waker()` ends a turn's wait from another thread, for a host whose own events arrive elsewhere.
- `Options.keepAlive` (on for `Options.make`): the host's own work keeps the runtime alive, as open windows do, so a loop with nothing referenced is not its end. The runtime finishes with `process.exit()` or `Runtime.finish()`, which runs the `'exit'` listeners.
- The runtime runs on the thread that calls `embed.start`; its JavaScript stays on that thread. It leaves the host's signal dispositions alone (the executable ignores `SIGPIPE` and `SIGXFSZ`, as Node does).
- Capabilities other than WebAssembly are still linked into every embedder, and the heap image is the executable's alone, so an embedded runtime bootstraps cold.

[`tests/embed-smoke.py`](tests/embed-smoke.py) builds [`src/embed_smoke.silk`](src/embed_smoke.silk), a host that runs its own module, twice: from [`./smoke`](smoke) with every optional capability empty (`EmptyWasm`, `EmptyFiles`, `EmptyCompression`, `EmptyHttp2`, `EmptyCrypto`, `EmptyTls`, `EmptyDatabase`, `EmptyAddons`, `EmptyProcesses`, `EmptyNetwork`, `EmptyHttp`, `EmptySystemInfo`, `EmptyTypeStripping`, `EmptyWorkers`), and from [`./cli`](cli) with `WamrWasm`. Its modules come from `MemoryModules` and its environment from `FixedPlatform`; the second has its files in `MemoryFiles`. It checks what each prints and the status its turn reports. `silk task symbols --binary ../../build/embed-smoke/embed-smoke --prefix wasm_runtime_ --absent` in [`tools/capabilities`](tools/capabilities) checks that the first has no WAMR in it.

## Compatibility boundaries

This is a Node compatibility implementation, not an official Node distribution or a claim that every Node package has been tested.

- **Engine artifacts:** compiled bytecode and module caches are SilkJS artifacts bound to source, compilation options, and build identity. They are not V8 code caches. In contrast, `node:v8` value serialization implements the V8 value wire protocol without executing V8.
- **Diagnostics:** heap and CPU data come from the actual SilkJS engine. Heap snapshots use DevTools JSON with SilkJS metadata; engine-specific measurements and limitations are identified rather than fabricated as V8 internals.
- **Native addons:** Node-API addons use the native ABI bridge. Legacy addons requiring V8-specific entry points are rejected explicitly.
- **Single-executable applications:** the macOS arm64 implementation supports source or cached entry points and embedded assets, with executable identity checks and signing. `useSnapshot: true` is rejected: native startup heap images are not implemented, and source replay is not presented as a snapshot.
- **Permissions:** the permission model follows Node's resource checks and documented limitations. It is not an operating-system sandbox; unrestricted networking and symlink behavior must not be mistaken for isolation guarantees.
- **Platform coverage:** build, signing, native library availability, and OS behavior outside the verified target require platform-specific validation.

## Layout

| Location | Responsibility |
| --- | --- |
| [`src/libs/core/`](src/libs/core/) | Engine embedding, host interfaces, the capabilities an embedder chooses |
| [`cli/`](cli/) | The executable (`src/main.silk`): the runtime with the real implementation of every capability |
| [`wamr/`](wamr/) | `WamrWasm`, WebAssembly and WASI over WAMR, and the Silk that binds it |
| [`smoke/`](smoke/) | The embedding smoke test without WebAssembly |
| [`src/runtime/`](src/runtime/) | Runtime startup and teardown (`worker`), the loop in turns (`session`), the embedding API (`embed`) |
| [`runtime/`](runtime/) | Bootstrap and event-loop integration |
| [`libs/node_resolver/`](libs/node_resolver/) | Package resolution, module loading, and loader hooks |
| [`src/ext/`](src/ext/) | Native extension implementations and resource ownership |
| [`ext/node/`](ext/node/) | Node-compatible JavaScript modules |
| [`ext/web/`](ext/web/) | Web-platform JavaScript APIs and vendored standards data |
| [`tools/`](tools/) | Dependency preparation, native builds, embedding, executable tooling; [`tools/capabilities`](tools/capabilities) is the capability graph |
| [`tests/`](tests/) | Differential and real-runtime consumers |
| [`bench/`](bench/) | The benchmarks against Bun: the programs measured, and how to run them |

The engine lives beside the runtime in [`modules/engine`](../engine); the runtime does not maintain a second engine implementation.

## Verification

The published-source build passed **72/72 differential cases against Node 24.22.2** on macOS arm64. These are this project's compatibility cases, not the complete upstream Node test suite.

Use a Node 24 executable as the reference/client for the differential suite:

```sh
silk task compat          # or: node tests/compat.mjs
```

`SILKJS_RUNTIME` selects the runtime executable and `NODE_REFERENCE` selects a different Node reference executable. An optional positional regular expression selects cases. Node is a test oracle or debugger client here, not a production execution backend.

Additional integration consumers cover native addons, permissions, workers, network peers, SQLite, VM caches, inspector transport, profiling, REPL interaction, and standalone executables. Their executable inputs and platform requirements are defined in the individual fixtures. Engine-side native consumers additionally check allocator ownership and compatibility with the pinned QuickJS C reference.

## Benchmarks

`silk task bench-setup` once, then `silk task bench`, `bench-mem`, `bench-cold` or `bench-all` compare a release build with Bun running without its JIT. [`bench/README.md`](bench/README.md) has the options, what the tasks hold fixed, and `silk task offline-deps` for a network that blocks the build's downloads.

## Upstream candidates and licensing

[`UPSTREAM_NOTES.md`](UPSTREAM_NOTES.md) records reusable Silk standard-library candidates, their current implementations, ownership/platform constraints, and exercised evidence. Node policy and engine internals are kept separate from generic stdlib proposals.

Runtime code is licensed under [`LICENSE`](LICENSE). See [`THIRD_PARTY_NOTICES`](THIRD_PARTY_NOTICES), [`vendor/`](vendor/), and the extension provenance manifests for adapted code, vendored data, downloaded dependencies, and their licenses. Redistributing linked binaries also requires the notices applicable to the actual native libraries and engine constituents in that binary.
