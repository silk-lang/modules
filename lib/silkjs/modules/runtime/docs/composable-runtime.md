# Composable runtime for embedders: design

Nov 14, 2026 · @Julia

## Summary

The runtime should become a small core plus a fixed list of capability services (files, network, crypto, Wasm, SQLite and so on). Each is a Silk `service` the embedder must provide at start. For a capability it does not want, the embedder provides the empty implementation the runtime ships (`Files.empty`, `Wasm.empty`), and that capability's modules, native code and C library are not in the binary. Today it is one package: `libs.core.host` imports all 41 native extension modules, one `Services` struct holds a state pointer for each, and `silk.toml` compiles WAMR, llhttp, OpenSSL, nghttp2, SQLite, zlib, zstd, brotli and libuv into every build, embedded or not.

The design rests on four rules.

1. **Every capability is a required service.** `embed.start` lists each one in its requirements, and the embedder answers each with `Effect.provideMut`: the real implementation the runtime ships, a type of its own, or the shipped empty one. There is no extension list to assemble.
2. **The implementation's type decides what is linked, its value decides what is granted.** Whether a capability is present is a constant of the implementation type, so an empty implementation removes the modules and the native code at build time, and its C library is never a dependency. A real implementation's value (which directory, which hosts, which environment) decides what JavaScript may touch.
3. **Nothing is optional or defaulted.** A new capability adds a service to the list, so every embedder fails to compile until it decides, even when the decision is the empty implementation. This follows the standing rule of no compat defaults.
4. **An absent capability is absent, not stubbed.** With `Files.empty`, `require('node:fs')` fails with the error Node itself uses for a module its build lacks, `process.features` and `builtinModules` say so, and with `Wasm.empty`, `typeof WebAssembly` is `'undefined'`. An embedder who wants a module that exists but is empty or denied provides a memory or denying implementation instead.

Build-time selection follows the package graph: each real implementation that needs a C library lives in its own package, so the library is compiled only when that package is a dependency. Silk package parameters (`pub param`) are kept for scalar knobs only. The heap image and built-in bytecode become a build step any embedder can run for its own choice of implementations, so an embedded runtime can start from an image as the executable does.

The migration is eight steps, each landing on main with the executable unchanged. The first proof arrives at step 1: the embedding smoke test built with `Wasm.empty`, with a check that no WAMR symbol is in the binary. Step 1 also measures the one thing this shape depends on, which is carrying the services through the engine as Effect requirements. Sizes per capability are not measured yet, and step 0 produces that table before boundaries are fixed.

## Current state

Every capability is wired into one place and linked unconditionally. Read at lib-silkjs main `197416d`.

**How a native call travels.** `worker.silk` `configure` defines the native functions on a `__silkNative` object, each a `NativeFunctionId.Host` with a hand-allocated number (fs 2000 to 2007, net 2400 to 2405, tls 2500, workers 6000, sqlite 7000, wasm 9000, wasi 10000, napi 14000 and so on). `bootstrap.js` spreads that object, plus the engine's QuickJS-style `silk:host/std` and `silk:host/os` modules, into `host`, which the built-in JavaScript uses. Calls come back through `Services.nativeGeneric` in `libs/core/host.silk`, an if-chain over id ranges that forwards to each extension's `dispatch`. The same file answers the engine's other hooks (exotic objects for vm and web storage, tracers and finalizers for Wasm, external buffer release, interrupts) by the same ids.

**What is fixed in the type.** `host.silk` imports 41 `ext.*` modules. `Services` has one nullable state pointer per extension (`io`, `crypto`, `network`, `tls`, `http2`, `sqlite`, `napi`, `wasm`, `wasi`, `httpParser`, `tracing`, `inspector`, `sea`, `compression`, `processes`, `workers`). The loop's poll phase calls `fs_async`, `crypto_native`, `net_native`, `compression_native`, `process_native`, `napi_native` and `wasm_native` by name. Startup and teardown in `worker.silk` open and close each by name.

**What is linked.** The README says it plainly: "Every extension is still linked into an embedder, and the heap image is the executable's alone, so an embedded runtime bootstraps cold."

| Capability | Native side today | Behind it | Hard-wired where |
| --- | --- | --- | --- |
| Event loop, timers | `fs_async.silk` owns a `silk.io.reactor` Reactor with libuv as a guest, plus a blocking pool; `immediates.silk` | libuv 1.51 (still used by 11 files) | Created first; process, napi and inspector take its pointer |
| File system | `fs_native`, `fs_async`, `fs_ops`, `uv_fs`, `fs_descriptors` | libuv fs requests, libc | Loader, compile cache, reports, heap snapshots, SEA, DNS config and SQLite each reach files their own way |
| Network, DNS | `net_native` (201 KB), `dns_native`, `uv_net` | `silk.net.socket_native`, `silk.net.dns`, libuv | `net` and `http` are preloaded into the heap image |
| HTTP | `http_parser_native`, `http2_native` | vendored llhttp plus a C bridge, nghttp2 1.66 | llhttp is in the runtime's own `[native] sources` |
| TLS, crypto | `tls_native`, `crypto_native` (135 KB), `openssl*` | OpenSSL 3.5.4 | Only these two import it, but it is always linked |
| Compression | `compression_native` | zlib 1.3.1, zstd 1.5.7, brotli | `os_native` imports its ABI too |
| WebAssembly, WASI | `wasm_native` (105 KB), `wasm_ownership`, `wasi_native` | WAMR interpreter with patches, SIMDe | About 40 WAMR C files listed in the runtime manifest; `host.silk` names its class ids 9096 to 9098 |
| SQLite, web storage | `sqlite_native`, `webstorage_native` | `db-sqlite` package | `localStorage` requires `internal/sqlite/database` |
| Workers | `worker_native` (92 KB), transport, locks | engine `js_os_workers`, threads | `workerNative` is the most used bridge (53 call sites), also for exit and embedding |
| Child processes | `process_native`, `spawn_sync` | libuv process handles, `silk.system.subprocess` | Shares the io loop |
| Inspector, profiling | `inspector_*`, `profile_*`, `coverage_native`, `trace_native` | `inspector_transport.c` (own sockets) | State is created at every start |
| Node-API | `napi_*` (4 files, 225 KB) | `dlopen` | Opened at every start |
| Process, OS | `process_native`, `os_native`, engine std and os modules | libc, libuv | `process.env` reads `getenv` live; cwd, pid, kill and exit go straight to libc |

Five facts shape the design.

- **Raw libc is ambient.** `src/` has 1,479 `extern "C" fn` declarations across 55 files, and `rawOS.open`, `rawStd.getenv`, `rawOS.kill` and friends are reachable from built-in JavaScript. A provider boundary means nothing until these are behind it.
- **JavaScript is one bundle.** `tools/embed.py` embeds all 561 built-in files (11.4 MB of source) with no notion of owner. `publicBuiltinNames` is every non-internal factory. Three vendored files are a large share: amaro 3.8 MB, undici 0.77 MB, acorn 0.25 MB.
- **Capabilities depend on each other in ways the layout hides.** TypeScript stripping (amaro) runs on WebAssembly. `localStorage` needs SQLite. `fetch` needs net, TLS and compression. The loader reads modules through fs natives.
- **There is a per-id permission hook already.** `permission_gate.silk` calls a JavaScript policy before guarded ids (fs, process, workers, SQLite, WASI, napi, inspector). It implements Node's `--permission` and stays, layered above capability absence.
- **An embedding API exists and is the right base.** `runtime.embed` gives `Host.drive`, `Runtime.turn`, `waker`, `evaluateModule` and an `Embedder` slot for the host's own native functions (ids from 1,000,000) through a C function pointer.

The Silk standard library already has the provider pattern this design needs: `FileSystem`, `ChildProcess`, `Random`, `SystemClock`, `MonotonicClock` and `Http` are effect requirements (`? &mut FileSystem`) satisfied with `Effect.provideMut`, and `OsFileSystem.make(root)` is rooted at a directory. The package manager in `modules/pm` is written that way. The runtime's extensions mostly bypass it.

## Prior art

The runtimes that embed well separate three things this runtime merges: the unit of surface (an extension), the resource behind it (a provider or binding), and the per-call policy (permissions). Rows for QuickJS and Bun are from memory, not re-read for this doc.

| Runtime | Unit of composition | Chosen when | Without the capability | What to take |
| --- | --- | --- | --- | --- |
| [Deno `deno_core`](https://docs.rs/deno_core/latest/deno_core/macro.extension.html) | `extension!`: `ops`, `esm`, `lazy_loaded_esm`, `deps`, `state`, `options`; generic `parameters` carry the permission trait | Build time: the embedder passes a list of extensions to the runtime, and the snapshot is built from the same list | The op and its JS do not exist. Linked ops check a permissions object per call | Extensions bundle native ops, JS and state, declare dependencies, and are generic over their policy type. The snapshot is a function of the extension list |
| [workerd](https://www.mintlify.com/cloudflare/workerd/concepts/capabilities) | Bindings in config: a named grant that appears in `env` | Run time, per worker | "Cannot access any resource not present in `env`". No outbound fetch without `globalOutbound` | No ambient authority: a resource is a value someone handed over, not a global name. One binary serves tenants with different grants |
| [workerd `node:fs`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/) | A virtual file system behind the real module | Compatibility flag | `/bundle` read-only modules, `/tmp` in memory per request, `/dev` devices | "Bring your own file system" works for unmodified packages when the module is real and the storage is virtual |
| [wasmtime WASI](https://docs.wasmtime.dev/api/wasmtime_wasi/struct.WasiCtxBuilder.html) | `WasiCtxBuilder` plus host traits per interface | Run time, per instance | Empty by default: stdin closed, no env, no args, "no preopened directories", name lookup denied | Start from nothing and add. Clocks and random are replaceable providers too. A directory grant is a root handle with permissions |
| QuickJS | `JS_NewContextRaw` plus `JS_AddIntrinsic*`; `std` and `os` live in `quickjs-libc.c`, outside the engine; the embedder sets the module loader | Build and run time | The global or module is not there | The engine has no OS. Our engine already matches this (it builds to wasm32); the runtime does not |
| [Javy](https://docs.rs/javy-plugin-api/4.1.0/javy_plugin_api/struct.Config.html) | A `Config` of intrinsics (`event_loop`, `text_encoding`, `javy_stream_io`, output streams) fixed when the plugin is built | Build time of the plugin | Intrinsic absent | The capability set is frozen into the artifact, and output streams are a provider |
| [Node](https://nodejs.org/download/nightly/v27.0.0-nightly20261018f88a1d25e9/docs/api/embedding.md) | Configure flags (`--without-ssl`, `--without-intl`, `--without-inspector`) and the C++ embedder API | Build time for the whole binary | `require('crypto')` throws `ERR_NO_CRYPTO`; inspector calls throw `ERR_INSPECTOR_NOT_AVAILABLE`; `process.features` reports it | Node already defines how a build without a capability behaves, with error codes its own tests and packages check. The embedder API cannot pick modules, and the docs warn it breaks on majors |
| Bun | None public. One binary, `bun build --compile` for apps, plugins for virtual modules | Not offered | Not offered | A gap this runtime can fill |

Three lessons carry into the proposal.

- Deno's lesson fits Silk: what is composed must be known at build time, and the snapshot follows it. A Silk service provided at start is specialized like a Rust generic, so the choice costs nothing at dispatch and a constant in the implementation can remove what is not wanted.
- workerd and WASI show that the resource boundary must be a value passed in, and that nothing is ambient.
- Node's own error codes answer the surface question without inventing behaviour.

## Proposed architecture

The runtime becomes a core plus a closed list of capability services. `embed.start` requires every one of them, and the embedder provides each with `Effect.provideMut`. Silk specializes a provided service into monomorphic code and has no interface objects, so the compiler knows the implementation at every call. The choice costs nothing at run time, and a constant in the implementation can remove code.

```
embedder ── embed.start(options, host)
              │  provides every service with Effect.provideMut
              ▼
core (always linked): engine, loop and immediates, bootstrap, loader, id registry,
                      every service contract and every empty implementation
              │
              ▼
capability services: Files · Network · Processes · SystemInfo · Workers · Crypto · Tls ·
                     Compression · Http · Http2 · Wasm · Database · TypeStripping ·
                     Inspector · NativeAddons · HostApi   (plus Platform, ModuleResolver: always real)
              each one: a shipped real implementation │ the embedder's own │ Service.empty
```

Read top down: the embedder provides every service, the core is the only part that is always linked, and each service is given as a real implementation, the embedder's own, or the empty one.

### Capabilities as services

Each part of the runtime that an embedder can choose is one service. None can be left out: the embedder provides a real implementation, its own, or the empty one the runtime ships.

```silk
/// The file capability: the operations `node:fs` can ask for.
pub service Files {
  /// A constant of the implementation type. False means the capability is not there: its modules,
  /// globals and native functions are not registered, and the code behind them is not linked.
  fn present(self: &Self) -> bool
  /// True when operations may block, so asynchronous calls go to the blocking pool.
  fn blocks(self: &Self) -> bool

  effect fn open(self: &Self, path: &[u8], flags: OpenFlags, mode: u32) -> Descriptor ! FileError
  effect fn readAt(self: &Self, file: Descriptor, into: &mut [u8], offset: u64) -> usize ! FileError
  effect fn stat(self: &Self, path: &[u8], follow: bool) -> Metadata ! FileError
  // ... write, close, links, directories, watch
}

/// The empty implementation, declared beside the service and reached as `Files.empty`.
/// Its operations are never called, because `present` is false.
impl Files for EmptyFiles {
  fn present(self: &Self) -> bool { return false }
  fn blocks(self: &Self) -> bool { return false }
  effect fn open(self: &Self, path: &[u8], flags: OpenFlags, mode: u32) -> Descriptor ! FileError { return raise FileError.notSupported() }
  // ... every operation spelled out, since nothing is defaulted
}

// An embedder that wants no files says so:
//   |> Effect.provideMut<Files>(&mut Files.empty)
```

Every service has its `empty` under the same name (`Wasm.empty`, `Http2.empty`), so there is no second list of type names to learn or import.

The list of services:

| Service | Node surface that stands on it | Real implementations shipped | Empty implementation |
| --- | --- | --- | --- |
| `Platform` | The core: wall and monotonic time, entropy, waiting and waking the loop, the three standard streams, arguments, environment, working directory, exit | `OsPlatform`; `FixedPlatform` for tests and images | None. Always real |
| `ModuleResolver` | The loader | `NodeResolution`; `BuiltinsOnly` | None. Always real |
| `Files` | `fs`, and through it WASI preopens, SQLite's VFS, compile cache, reports and snapshots | `OsFiles` rooted at a directory; `MemoryFiles` | `Files.empty` |
| `Network` | `net`, `dgram`, `dns`, and through it `http`, `fetch`, `WebSocket` | `OsNetwork`; `NoEgress` for listeners only | `Network.empty` |
| `Processes` | `child_process` | `OsProcesses` | `Processes.empty` |
| `SystemInfo` | `os` | `OsSystemInfo`; `FixedSystemInfo` | `SystemInfo.empty` |
| `Workers` | `worker_threads` | `ThreadWorkers` | `Workers.empty` |
| `Crypto` | `crypto`, `crypto.subtle` | `OpenSslCrypto` | `Crypto.empty` |
| `Tls` | `tls`, `https` | `OpenSslTls` | `Tls.empty` |
| `Compression` | `zlib`, compression streams | `NativeCompression` (zlib, zstd, brotli) | `Compression.empty` |
| `Http` | The HTTP/1 parser under `http` | `Llhttp` | `Http.empty` |
| `Http2` | `http2` | `Nghttp2` | `Http2.empty` |
| `Wasm` | `WebAssembly`, and `wasi` when `Files` is present too | `WamrWasm` | `Wasm.empty` |
| `Database` | `sqlite`, `localStorage` | `Sqlite` | `Database.empty` |
| `TypeStripping` | Running TypeScript files | `Amaro` | `TypeStripping.empty` |
| `Inspector` | `inspector`, profiler, coverage, tracing | `NodeInspector` | `Inspector.empty` |
| `NativeAddons` | Node-API, `process.dlopen` | `DlopenAddons` | `NativeAddons.empty` |
| `HostApi` | The embedder's own native functions and modules | The embedder's type | `HostApi.empty` |

**How an empty service removes code.** Two things work together. The C library is a dependency of the package that holds the real implementation, so a program that never names `WamrWasm` never compiles WAMR. And the runtime's own code for the capability (registering its native functions and built-in JavaScript, its state, its turn in the loop) sits under `if wasm.present()`. The provided service is specialized, so for `Wasm.empty` that condition is the constant false and the code behind it is not linked. The engine already does this for Intl: `EngineServices.includesIntl` returning false removes the Intl code and its CLDR tables. Step 1 proves it for Wasm with a symbol check on the binary.

**Two depths of contract.** The first seven services in the table describe a resource in terms of operations, as `Files` does above. The Node surface over them is runtime code in the core, and an embedder can reasonably write its own implementation. The rest wrap a library. `crypto_native` is 135 KB written against OpenSSL, so a library-neutral `Crypto` contract cannot be the first step. These services start with the contract below, which is what `host.silk` and `worker.silk` spell out per extension by hand today, and the package of the real implementation carries the native glue and the built-in JavaScript together with the library. An embedder picks the shipped implementation or the empty one. When a vendored library is replaced (step 8), its service narrows to operations, and `silk.crypto` becomes one more implementation of `Crypto`.

```silk
/// What a library service answers until its contract narrows. Every method is required.
pub service Binding {
  fn present(self: &Self) -> bool
  /// Its native functions: bootstrap name and id, inside the id block registered for the service.
  fn natives(self: &Self) -> &[Native]
  /// Its built-in JavaScript: name, embedded source, public or internal, preloaded into an image or not.
  fn builtins(self: &Self) -> &[Builtin]
  /// The ids Node's permission policy is asked about before the call.
  fn guarded(self: &Self, id: u32) -> bool

  effect fn open<'m, S>(self: &mut Self, engine: &mut Engine<'m, S>, realm: Realm) -> () ! OutOfMemoryError | JsException
  effect fn call<'m, S>(self: &mut Self, engine: &mut Engine<'m, S>, realm: Realm, id: u32, arguments: Arguments) -> ValueBits ! OutOfMemoryError | JsException
  /// The loop's poll phase: deliver completions. True when something ran.
  effect fn poll<'m, S>(self: &mut Self, engine: &mut Engine<'m, S>, realm: Realm) -> bool ! OutOfMemoryError | JsException
  /// Referenced work that keeps the loop alive, and what a leak report lists.
  fn openHandles(self: &Self) -> usize
  effect fn close<'m, S>(self: &mut Self, engine: &mut Engine<'m, S>, realm: Realm) -> ()

  /// The engine's hooks for objects of its classes: exotic property access, trace, finalize, buffer release.
  /// (One method per EngineServices hook that host.silk routes by id today.)

  /// A fresh instance for a worker thread.
  effect fn forWorker(self: &Self) -> Self ! OutOfMemoryError
  /// After a heap image is mapped: reopen native state the image cannot hold.
  effect fn hydrate<'m, S>(self: &mut Self, engine: &mut Engine<'m, S>, realm: Realm) -> ()
}
```

**The list is closed.** A new capability in the runtime is a new service in the list, and every embedder then fails to compile until it names an implementation. The host's own native functions and modules go through the one slot made for them, `HostApi`, which replaces today's `Embedder` struct and its C function pointer. A third party cannot add a service from outside. That is the trade against a free list of extensions, and it buys an entry point with no set to assemble.

**Dispatch.** `Services.nativeGeneric` stays an if-chain over constant id ranges, with each arm under its service's constant `present`. The calls the loop makes per callback (immediates 2230 to 2241, the clock, `bufferOperation`) stay in the core ahead of the chain, as today. Id blocks stay fixed numbers in one registry file in the core, because bytecode caches and heap images store them, and a block belongs to a service, not to an implementation. The gate is equal instruction counts on Octane and the HTTP benchmarks.

**Services that need each other.** `Tls` needs `Network` and `Crypto`. `Http2` and `Inspector` need `Network`. `TypeStripping` needs `Wasm`, because amaro runs on WebAssembly. `localStorage` needs `Database` and `Files`. `embed.start` checks the `present` constants in a static assertion, so a wrong combination fails the build with a message naming both services (`checkCombination`, step 5).

**The one dependency of this shape.** Native functions reach a service as an Effect requirement, and they are called through the engine's host hooks, whose requirement is fixed at `? &mut Allocator` today. The hooks have to carry a generic requirement row. Step 1 measures that on Octane instruction counts before anything else moves. If it costs, the same services become the fields of one `Capabilities` struct passed to `embed.start`. The embedder then writes a field per service instead of a `provideMut` line per service, and nothing else in this design changes.

### Rules for implementations

- An operation is synchronous and may block. The runtime runs it on the blocking pool for asynchronous calls and inline for `Sync` calls, as `fs_async` does now. `blocks` returning false lets `MemoryFiles` run on the loop thread without a pool hop.
- Operations take `&Self` and are called from pool and worker threads. Sharing and locking are the implementation's business.
- Where the Silk standard library has the interface, the service is defined in its terms: `Random`, `SystemClock`, `MonotonicClock`, `ChildProcess`. `silk.system.filesystem.FileSystem` is whole-file (read, write, stat, create, remove), so `Files` is new. Its descriptor-level operations are a candidate to upstream, so std's `FileSystem` and Node's share one native implementation.
- `Network` starts as a policy and factory over real sockets (`silk.net` connections registered with the reactor), which covers allowlists, egress control and pre-opened listeners. A byte-level virtual transport over `silk.io.byte_duplex` is a later addition if an embedder needs to serve requests without sockets.
- After the migration, only packages of real implementations may declare `extern "C"` or import a `*_native` standard module. A CI script enforces it. That is what makes "no file system" true instead of approximately true.

### Build time and run time

**Build time is the package graph.** The module becomes several Silk packages. An embedder's `silk.toml` lists the core and the packages of the real implementations it provides, and a C library is compiled only when its package is a dependency.

| Package | Holds | Native code it brings |
| --- | --- | --- |
| `silkjs` (engine) | Unchanged. The runtime stops importing its `js_std` and `js_os` libc modules | None |
| `silkjs-runtime-core` | `Runtime`, the loop and immediates, bootstrap, loader, every service contract and every empty implementation, the registry of id blocks, the Node surface over the resource services (`fs`, `net`, `dgram`, `dns`, `child_process`, `os`, `worker_threads`, fetch, WebSocket), and the JavaScript with no outside dependency: `events`, `buffer`, `util`, `path`, `url`, `stream`, `timers`, `assert`, `console`, `string_decoder`, `querystring`, `async_hooks`, `diagnostics_channel`, `vm`, `module`, `process` | None |
| `silkjs-runtime-os` | `OsPlatform`, `OsFiles`, `OsNetwork`, `OsProcesses`, `OsSystemInfo`, `ThreadWorkers`, the reactor and blocking pool | libc (libuv left with the loop plan) |
| `silkjs-runtime-memory` | `MemoryFiles`, `FixedPlatform`, `FixedSystemInfo`, bundle module storage | None |
| `silkjs-runtime-openssl` | `OpenSslCrypto`, `OpenSslTls` | OpenSSL |
| `silkjs-runtime-compress` | `NativeCompression` | zlib, zstd, brotli |
| `silkjs-runtime-llhttp`, `-nghttp2` | `Llhttp`, `Nghttp2` | llhttp, nghttp2 |
| `silkjs-runtime-wamr` | `WamrWasm`, with WASI | WAMR, SIMDe |
| `silkjs-runtime-sqlite` | `Sqlite` | SQLite |
| `silkjs-runtime-amaro` | `Amaro` | None (3.8 MB of JavaScript) |
| `silkjs-runtime-inspector`, `-napi` | `NodeInspector` with profiler, coverage and tracing; `DlopenAddons` | `inspector_transport.c` until ported; `dlopen` |
| `silkjs` | The executable: the real implementation of every service, the command line, REPL, test runner, SEA, package manager | Everything |

**Run time is values.** Which directory, which environment variables, which hosts, which standard streams: all are values of the implementations the embedder constructs. One rule keeps this simple: presence never varies at run time, because `present` is a constant of the type. A host that serves tenants with different surfaces calls `embed.start` with different implementation types in one binary, and each combination is its own specialization with its own image.

**Package parameters are for scalars.** Silk's `pub param` with `[config]` in the manifest fits knobs that are values, not surface: debugger hooks compiled into the dispatch loop, the CLDR data tier for Intl, default heap limits. They are not used to switch modules, because a boolean per module cannot express "my own file system" and multiplies untested combinations. Module-level `static if` is listed in the Silk reference as a confirmed contract with implementation tracked separately, so it should be verified on the pinned toolchain before any use.

An embedder then reads like this:

```silk
// A sandboxed plugin host: its own file system, outbound HTTPS to chosen hosts, no Wasm, no child processes.
return run embed.start(move options, &mut host)
  |> Effect.provideMut<Platform>(&mut platform)            // FixedPlatform: chosen arguments, environment, output
  |> Effect.provideMut<ModuleResolver>(&mut plugins)       // the host's own: a table of plugin modules
  |> Effect.provideMut<Files>(&mut tenantFiles)            // the host's own
  |> Effect.provideMut<Network>(&mut allowlist)            // the host's own, over OsNetwork
  |> Effect.provideMut<Crypto>(&mut crypto)                // OpenSslCrypto
  |> Effect.provideMut<Tls>(&mut tls)                      // OpenSslTls
  |> Effect.provideMut<Http>(&mut http)                    // Llhttp
  |> Effect.provideMut<Compression>(&mut compression)      // NativeCompression
  |> Effect.provideMut<HostApi>(&mut api)                  // the host's own functions
  |> Effect.provideMut<Http2>(&mut Http2.empty)
  |> Effect.provideMut<Processes>(&mut Processes.empty)
  |> Effect.provideMut<SystemInfo>(&mut SystemInfo.empty)
  |> Effect.provideMut<Workers>(&mut Workers.empty)
  |> Effect.provideMut<Wasm>(&mut Wasm.empty)
  |> Effect.provideMut<Database>(&mut Database.empty)
  |> Effect.provideMut<TypeStripping>(&mut TypeStripping.empty)
  |> Effect.provideMut<Inspector>(&mut Inspector.empty)
  |> Effect.provideMut<NativeAddons>(&mut NativeAddons.empty)
  |> Effect.provideMut<Allocator>(&mut allocator)
```

The list is long on purpose: it is the whole surface of the program, readable in one place, and the empty lines say what the program cannot do. The executable is the same call with the real implementation on every line and `HostApi.empty`.

### Starting a simple case

The smallest embedder is a manifest with two dependencies and one file. It runs JavaScript with the language, timers, `console`, events, buffers, streams and URL, and with no file system, network or Wasm, because every capability service gets its empty implementation. This is a sketch of the proposed API, not code that builds today.

```toml
# silk.toml
[package]
name = "hello-embed"

[dependencies]
silkjs-runtime-core = { git = "https://github.com/silk-lang/lib-silkjs", package = "silkjs-runtime-core" }
silkjs-runtime-os   = { git = "https://github.com/silk-lang/lib-silkjs", package = "silkjs-runtime-os" }
```

```silk
// src/main.silk
import silk.mem.allocator { Allocator, OutOfMemoryError }
import silk.core.effect { Effect }
import silkjs.js_exceptions { JsException }
import runtime.core.embed { Host, Options, Runtime, Turn }
import runtime.core.embed
import runtime.core.services { Platform, ModuleResolver, Files, Network, Processes, SystemInfo, Workers, Crypto, Tls,
  Compression, Http, Http2, Wasm, Database, TypeStripping, Inspector, NativeAddons, HostApi }
import runtime.core.modules { BuiltinsOnly }
import runtime.os.platform { OsPlatform }

const SOURCE: &[u8] = b"setTimeout(() => console.log('hello from JavaScript'), 10)"

struct App {}

impl Host for App {
  // Called once the runtime is up. Evaluate a module, then turn the loop until it has nothing left.
  effect fn drive<'e, 'm>(self: &mut Self, runtime: &mut Runtime<'e, 'm>) -> i32 ! OutOfMemoryError | JsException ? &mut Allocator {
    run runtime.evaluateModule(b"/app/main.mjs", SOURCE)
    while true {
      match run runtime.turn(-1.0) { Turn.Running => () Turn.Finished { status } => { return status } }
    }
    return 0
  }
}

pub effect fn main() -> i32 {
  let mut allocator = Allocator.systemAllocatorProvider()
  let mut platform = OsPlatform.make()        // real clock, entropy, stdout and stderr
  let mut modules = BuiltinsOnly {}           // imports resolve to built-in modules only
  let mut app = App {}
  let mut options = run Options.make(b"hello") |> Effect.provideMut<Allocator>(&mut allocator)
  options.keepAlive = false                    // finish when the loop is empty, as Node does

  return run embed.start(move options, &mut app)
    |> Effect.provideMut<Platform>(&mut platform)
    |> Effect.provideMut<ModuleResolver>(&mut modules)
    |> Effect.provideMut<Files>(&mut Files.empty)
    |> Effect.provideMut<Network>(&mut Network.empty)
    |> Effect.provideMut<Processes>(&mut Processes.empty)
    |> Effect.provideMut<SystemInfo>(&mut SystemInfo.empty)
    |> Effect.provideMut<Workers>(&mut Workers.empty)
    |> Effect.provideMut<Crypto>(&mut Crypto.empty)
    |> Effect.provideMut<Tls>(&mut Tls.empty)
    |> Effect.provideMut<Compression>(&mut Compression.empty)
    |> Effect.provideMut<Http>(&mut Http.empty)
    |> Effect.provideMut<Http2>(&mut Http2.empty)
    |> Effect.provideMut<Wasm>(&mut Wasm.empty)
    |> Effect.provideMut<Database>(&mut Database.empty)
    |> Effect.provideMut<TypeStripping>(&mut TypeStripping.empty)
    |> Effect.provideMut<Inspector>(&mut Inspector.empty)
    |> Effect.provideMut<NativeAddons>(&mut NativeAddons.empty)
    |> Effect.provideMut<HostApi>(&mut HostApi.empty)
    |> Effect.provideMut<Allocator>(&mut allocator)
}
```

`silk build` then gives a binary with the engine and the core only. In it, `require('node:fs')` throws `ERR_UNKNOWN_BUILTIN_MODULE` and `typeof fetch` is `'undefined'`.

Adding a capability is one changed line, plus one dependency when the implementation brings a library. Files limited to a directory:

```silk
import runtime.os.files { OsFiles }

let mut files = run OsFiles.make("/srv/hello/data")   // JavaScript sees this directory as /

  // in the call to embed.start, in place of the Files.empty line:
  |> Effect.provideMut<Files>(&mut files)
```

Deleting a line is a compile error, since `embed.start` requires every service. Replacing `OsFiles` with `MemoryFiles`, or with a type of the embedder's own that implements `Files`, changes nothing else. WebAssembly is the same step with a dependency: add `silkjs-runtime-wamr` to the manifest and provide `WamrWasm` in place of `Wasm.empty`. If the step 1 measurement rules out requirement rows through the engine, the same choices are written as fields of one `Capabilities` struct, and the rest reads the same.

### One product: the runtime re-exports the engine

The engine and the runtime are offered as one product under one name, and the runtime package re-exports the engine's embedding API. Someone who wants only the engine depends on the same product and imports the engine modules through it; someone who wants Node surface provides services as above.

The design is unchanged by this: the core stays always linked when the runtime is used, and the engine stays its own Silk package underneath, since the runtime depends on it and it also builds to wasm32. Two things follow:

- The core package lists the engine's public modules in its `exports` (or re-exports them from one `engine` module), so one dependency line gives both. A program that imports only the engine modules links only the engine, because nothing of the runtime is reachable.
- Documentation and naming present one product with two entry points: the engine API for running JavaScript with nothing around it, and `embed.start` with its services for a runtime.

Splitting the core itself into services, so that providing every empty implementation would give the bare engine, was considered and set aside as more machinery than the naming problem needs.

### Custom module resolution

Module resolution becomes a required service of its own, `ModuleResolver`, separate from module storage. The embedder provides one at start like any other service, and the runtime ships `NodeResolution`, which is today's algorithm.

```silk
pub service ModuleResolver {
  /// Turns a specifier into what to load. `kind` is import, require or the entry point;
  /// `conditions` are the active export conditions.
  effect fn resolve(self: &Self, specifier: &[u8], referrer: &[u8], kind: RequestKind, conditions: &[Bytes]) -> Resolution ! ResolveError
  /// Gives the module's code for a resolved location.
  effect fn load(self: &Self, location: &[u8]) -> Loaded ! LoadError
}

pub union Resolution {
  /// A built-in of the core or of a service that is present.
  Builtin { name: Bytes },
  /// A location for `load`, with the module format when the resolver already knows it.
  Module { location: Bytes, format: Option<Format> },
}

pub union Loaded {
  Source { text: Bytes, format: Format },      // ESM, CommonJS, JSON, TypeScript, Wasm
  Bytecode { bytes: Bytes },                    // compiled ahead with the same build
}
```

Three levels of customization result, from least to most code:

| Level | Who writes it | Typical use |
| --- | --- | --- |
| Storage only | Embedder gives `NodeResolution` over its own module storage (a directory, a memory bundle, its file system provider) | Node rules, but modules come from a bundle or a virtual tree |
| Wrap the Node resolver | A type of the embedder's that holds a `NodeResolution`, answers some specifiers itself and passes the rest on | Virtual modules (`app:config`), aliases and import maps, pinning versions, refusing bare specifiers or `node:` modules, serving precompiled bytecode |
| Replace it | A type that implements `ModuleResolver` alone | A host with no `node_modules` at all: a fixed module table, URL imports, a plugin registry |

Notes on fit with what exists:

- The engine already asks the runtime to normalize and load every import (`Services.normalize` and `load`, answered by `__silkRuntime` in `bootstrap.js`), and `libs/node_resolver/loader.js` holds the Node algorithm in JavaScript. `NodeResolution` is that code behind the service, so the executable's behaviour does not change.
- Node's own customization hooks (`module.register`, `module.registerHooks`, in `hooks.js`) stay and run inside `NodeResolution`. They are the JavaScript-level way to customize; the service is the native one, and it runs first, so a script cannot undo what the embedder's resolver refuses.
- The resolver is required, with no default, in line with the rule for every other service. The executable names `NodeResolution` explicitly.
- It lands in step 3, with the platform's module storage, since both replace the loader's direct file access.

## The Node surface when a capability is absent

A module whose service has the empty implementation does not exist, and the runtime says so the way a Node build without that capability does. The runtime generates no stub modules.

An embedder has three explicit choices per capability, and each has one behaviour:

| Choice | Example | What JavaScript sees |
| --- | --- | --- |
| Real implementation | `OsFiles` rooted at `/srv/app` | Node behaviour inside the root |
| Virtual or denying implementation | `MemoryFiles`, or a type of the embedder's whose operations fail | The module loads and works against that implementation. A denied operation fails with the errno it returns (`EACCES`, `ENOSYS`), in Node's uv error shape |
| Empty implementation | `Files.empty` | The module is absent, as below |

The second row is the answer for packages that `require('fs')` at load and never call it. The embedder provides `MemoryFiles`, which is what workerd does. That is an implementation chosen by the embedder, not a shim hidden in the runtime.

With the empty implementation:

| Surface | Behaviour | Precedent |
| --- | --- | --- |
| `require('node:X')`, `import 'node:X'` | Throws `ERR_UNKNOWN_BUILTIN_MODULE`. For crypto: `ERR_NO_CRYPTO`. Inspector entry points: `ERR_INSPECTOR_NOT_AVAILABLE` | Node built `--without-ssl` or `--without-inspector`; all three codes are already in `internal/errors.js` |
| `module.builtinModules`, `module.isBuiltin`, `process.moduleLoadList` | List only what is present | Node lists what the build has |
| `process.features`, `process.versions`, `process.config.variables` | Report what is present: no `openssl` version with `Crypto.empty`, `features.inspector` false, and so on | Node |
| Globals | Not defined: `WebAssembly` with `Wasm.empty`; `fetch`, `WebSocket`, `EventSource` with `Network.empty`; `localStorage` with `Database.empty`; `process.stdin` without a platform stream | `typeof WebAssembly === 'undefined'` is the standard feature test |
| `globalThis.crypto` | `getRandomValues` and `randomUUID` are core, over the platform's entropy. `subtle` exists only when `Crypto` is present | Split by dependency, since the two halves need different things |
| Command line flags for an absent capability (`--inspect`, `--experimental-wasm-*`) | Rejected as unknown options | Node without the inspector |
| A built-in that needs an absent service | Cannot happen: the check on the `present` constants in `embed.start` refuses the combination | Deno's `deps` |

The last row is where the work is. Built-in JavaScript requires across capability lines freely today, mostly lazily inside functions. Three cases need a decision in the design, not a guard at run time:

- **Hard dependency.** `https` needs `tls`, `tls` needs `net` and `crypto`, `localStorage` needs SQLite, TypeScript stripping needs WebAssembly. These are the pairs `embed.start` checks.
- **Core module using a capability for one feature.** `console` writing to a TTY, `util.inspect` of a `KeyObject`, `stream` helpers that import `fs`, `process.stdout` being a `net.Socket` or `fs.WriteStream`. The core side takes the feature through a registration the capability's JavaScript makes when it loads (it adds its inspect formatter, its stream kind), so the core never names the capability. The platform's output stream is a plain writable in the core, and a present `Network` or a terminal platform stream upgrades it.
- **Convenience import.** A module that requires another only for a validator or constant moves that piece to the core.

A build-time check enforces the result: a script reads every built-in's `require` and `import` strings and fails when a file of one service names a module of another that is not among its declared needs. It replaces review as the guard, the same way `seal()` guards environment reads in the image build.

Node's own test suite runs against the build with every service real. Builds with empty services get their own smaller suite that asserts absence (the error codes above, the missing globals, no symbols of the dropped library in the binary).

## Binary size, cold start and the heap image

Size and startup both become functions of the implementations the embedder provides, and the heap image has to become one too, or embedders keep paying a cold bootstrap.

**Size.** No per-extension numbers exist yet, so none are claimed here. What is known from project notes: the executable is about 71 MB before the image is appended and about 115 to 120 MB with it, the first build compiles about 1,300 C files, and the built-in JavaScript is 11.4 MB of source across 561 files before bytecode. The expected order of savings, to be confirmed by measurement in step 0, is OpenSSL first, then built-in JavaScript and its bytecode (amaro alone is a third of the source), then SQLite, WAMR, the three compression libraries, nghttp2, libuv and llhttp. Step 0 produces the table from the linker map: bytes of text and data per archive and per `ext` module, and bytes of JavaScript and bytecode per extension.

Two things beyond dropped libraries shrink a reduced build. Each engine hook that `host.silk` routes to an extension today keeps that extension reachable, so an empty service removes its Silk code as well as its C. And the image only holds modules of services that are present.

**Cold start.** From the cold start work: an empty script takes about 10.3 ms without the image and 5.7 ms with it, a new page costs about 2 microseconds however it arrives, and a cold image dirties about 540 pages. A smaller set helps in three ways: fewer native functions defined and fewer states opened in `configure` (napi and the inspector open at every start today), fewer built-ins registered, and a smaller image with fewer pages to touch. The full set must not get slower: gates are the existing cold start harness and equal instruction counts for the bootstrap.

**The heap image today** is tied to the executable in four ways: it is written by running the linked binary with `--silk-write-heap-image`, appended by `tools/build.py` with a trailer, mapped at a fixed address, and valid only for that exact binary because it holds code addresses. Built-in bytecode is produced the same way (`--silk-write-builtin-cache`, then a relink). Embedders get neither.

**The heap image in the new design:**

1. The two-stage build moves from `tools/build.py` into a build step of the core package that any dependent package can run for its own program: link, run the program's image entry, append. The embed API gains `embed.writeImage(options, path)`, which requires the same services as `embed.start`, and `embed.start` looks for the trailer in its own executable, so an embedder's binary gets an image by adding one task.
2. The image is built with `FixedPlatform`, never the OS one. Today the build guards against the bootstrap reading the environment (`seal()` fails on an unlisted read). With a platform service the guard is structural: there is no environment to read while the image is built, and the real platform takes over at start.
3. Each service declares which of its built-ins preload into the image (`Builtin.image`), replacing the `imageModules` list in `bootstrap.js`. `net` and `http` are in that list today, so the core cannot build an image without them until this moves.
4. Each service reopens its own native state after the image is mapped (`hydrate`). This replaces the by-name reopen code in `worker.silk` and the `host.onHydrate` registrations.
5. The image identity already hashes the compiler, the JavaScript and the sources. It additionally covers the implementation type given for each service, so an image built for one combination is refused by another.
6. A program that cannot run on the build machine (a cross build) has no image and no bytecode cache and bootstraps cold. That is today's behaviour for `silk build`, and it stays the documented fallback.

A runtime with the profile-guided image layout (page packing from pagemap data, startup function ordering) keeps those per combination: the ordering files are inputs of the build step, produced by the same tasks against the embedder's binary.

## Migration plan

Eight steps, each merged to main with the executable's behaviour unchanged. The standing gates apply to every step: the Node suite and the 72 differential cases do not regress, Octane and HTTP instruction counts stay equal, and cold start does not get slower.

0. **Measure and draw the lines.** Produce the size table from the linker map, and a dependency graph of built-in JavaScript (every `require` and `import` string, marked load-time or lazy) plus which `host.*` natives each file uses. Fix the service boundaries and which services need each other from that data. Output: a report in project files. No code changes.
1. **Services through the engine, proven on Wasm.** First the spike: thread a generic requirement row through the engine's host hooks and compare Octane instruction counts. That decides whether services arrive as Effect requirements or as fields of one `Capabilities` struct. Then add the `Wasm` service with `WamrWasm` and `Wasm.empty`, move WAMR out of the runtime manifest into `modules/native/wamr` and a `silkjs-runtime-wamr` package, and put the Wasm parts of `host.silk`, `worker.silk` and the bootstrap under `present`. Everything else stays wired as it is. The embedding smoke test gains a second build with `Wasm.empty`, and CI checks with `nm` that it has no WAMR symbol and that `typeof WebAssembly` is `'undefined'`. The `Embedder` function pointer becomes the `HostApi` service in the same step.
2. **Built-in JavaScript per service.** `tools/embed.py` writes one index per service. The bootstrap registers the built-ins of services that are present, and `builtinModules`, `process.features`, the loader's errors and the command line options follow it. The cross-service `require` check goes into CI. Amaro moves behind `TypeStripping`.
3. **`Platform` and `ModuleResolver`.** Time, entropy, waiting, standard streams, arguments, environment, working directory and exit go through `Platform`. The bootstrap stops spreading `silk:host/std` and `silk:host/os` into `host`, and the loader resolves and reads through `ModuleResolver`. Output: an embedding smoke test with `Files.empty` that runs a bundled module graph from memory.
4. **`Files`.** `fs_native`, `fs_async`, `fs_ops` and `uv_fs` are rewritten over the `Files` service, with `OsFiles`, `MemoryFiles` and `Files.empty`. WASI preopens, SQLite's VFS, the compile cache, reports, snapshots, the DNS resolver configuration and TLS root loading route through it. Output: smoke tests for a rooted directory and for an embedder-defined file system.
5. **`Network` and what stands on it.** `Network`, then `Tls`, `Crypto`, `Http`, `Http2` and `Compression`, each with its empty implementation. Fetch and WebSocket follow `Network`. The core gets the small hashes it needs from `silk.crypto` so it does not reach OpenSSL.
6. **The rest.** `Workers`, `Processes`, `SystemInfo`, `Database`, `Inspector` with profiling, coverage and tracing, `NativeAddons`. When the last one moves, `Services` has no state pointer per extension left, and `host.silk` only routes id blocks to services.
7. **Packages, image, enforcement.** Split the module into the packages of the table above. Move the image and bytecode pipeline into a build step embedders can run, with the implementation types in the image identity. Turn on the rule that only packages of real implementations touch libc. CI builds a matrix: everything real, everything empty, `Wasm.empty`, `MemoryFiles`, each with its absence assertions and its own cold start number.
8. **Replace vendored libraries behind stable seams.** With each library private to one implementation package, the standing goal of removing vendored code becomes a series of local swaps: llhttp for `silk.http`, zlib, zstd and brotli for `silk.compress`, OpenSSL for `silk.crypto` and `silk.tls`, libuv out of `silkjs-runtime-os` as the loop plan finishes. Each swap is a new implementation of the same service, and it is when a library service narrows from a binding to operations.

Steps 1 to 3 are sequential. After step 3, steps 4, 5 and 6 can run as parallel streams, since each service owns different files and code that has not moved compiles unchanged. Step 7's package split is last on purpose: boundaries are cheap to move inside one package and expensive across several.

## Progress

**Step 0.** `silk task graph` in `tools/capabilities` writes [capability-graph.md](capability-graph.md)
and [capability-crossings.txt](capability-crossings.txt) from the sources. They give the service of
each built-in, native function and Silk module, bytes per service, and the 240 requires and native
calls that cross a service line. `--sizes` adds linked sizes from a `tools/build.py` build. The
rules are data in `tools/capabilities.toml`, which `tools/embed.py` also reads to tag each built-in.
CI (`.github/workflows/capability-graph.yml`) runs `--check`, which fails on a new crossing. Service
boundaries are a first cut by name and are not fixed yet.

**Step 2, first part.** Every built-in carries its service (`builtinService`, from
`tools/capabilities.toml` through `tools/embed.py`), and the native side lists the services this
runtime has (`native.services`, every one for now). The bootstrap registers only the built-ins of
present services, so `builtinModules`, `isBuiltin` and the web globals follow presence. Requiring a
missing one fails as in a Node build without it: `ERR_UNKNOWN_BUILTIN_MODULE` for `node:X`, a
package lookup for a bare name, `ERR_NO_CRYPTO` for crypto and TLS, and
`ERR_INSPECTOR_NOT_AVAILABLE` for the inspector. `process.features` and that capability's command
line options follow presence too. With every service present the executable behaves as before.
TypeScript follows `TypeStripping`: without it a `.ts` file and `module.stripTypeScriptTypes`
throw `ERR_NO_TYPESCRIPT`, `process.features.typescript` is false and `node_use_amaro` is false, as
in a Node build without amaro. Two parts of step 2 move to the step whose service they need:
`globalThis.crypto` split between core randomness and `subtle` comes with the `Crypto` service
(step 5), since only then can a runtime be without Crypto; one index of built-ins per service
rather than one tagged index comes with the package split (step 7), since only then can a
service's JavaScript leave the program with its package.

**Step 1, the spike.** Neither route in "The one dependency of this shape" works on the then-pinned
toolchain (0.1.0-dev.74) as written:

- *Requirement rows through the engine hooks* put a row parameter on every signature that reaches
  a hook: 4,493 `? &mut Allocator` rows in all 474 engine files.
- *A generic services type*, `Services<C>` with `C` the embedder's capabilities, is cheap in the
  runtime. Only 223 references in 12 files name `Services`, the `ext` modules are mostly generic
  over the engine's services already, and the engine already specializes per services type, so
  dispatch would cost nothing. But the runtime has 266 `export "C" fn` callbacks (WAMR imports,
  SQLite user functions, every Node-API function, llhttp, OpenSSL, the worker entry handed to
  `pthread_create`), and each recovers the engine from a C pointer as one concrete type. Silk
  cannot take a C callback address of a generic instantiation (synchronous-native-callbacks.md,
  "Exported addresses"), and it has no type-erased generic values (CALLABLE-001).

What does work, as probes on the pinned compiler confirmed: an interface's `static fn present()`
read under `static if` removes the absent arm before name resolution, in debug builds too, and
`compileError` there can carry the dependency check. A forwarding interface over one
`Capabilities<W, A>` struct keeps the runtime generic over a single type however many capabilities
there are. Dependency C sources are linked as loose objects, so an empty capability leaves its
library out only when the package holding it is not in the program's dependency graph.

**Step 1.** The compiler change is [silk-lang/silk#3113](https://github.com/silk-lang/silk/pull/3113):
a generic export's name with type arguments is the C address of that instantiation, so a callback
is written once and handed over for the runtime's own type. On that compiler the runtime is generic
over the embedder's capabilities, `Services<C>` with `C: Composition` (`libs/core/capabilities.silk`):

- `Capabilities { wasm, hostApi }` was the closed list then (step 3 adds `platform` and `modules`); `Composition`, implemented by it alone,
  forwards each capability's operations, so every signature carries one type parameter however
  many capabilities there are.
- `Wasm` has `WamrWasm` (`./wamr`, the package that depends on WAMR) and `EmptyWasm` (the core).
  Presence is `Wasm.present`, a static function read under `static if`, so with `EmptyWasm` the
  Wasm natives, classes and loop turns are not compiled. The bootstrap sees no `wasmNative`:
  `typeof WebAssembly` is `'undefined'` and the Wasm built-ins are not registered.
- `HostApi` replaces the `Embedder` struct and its C function pointer.
- The C callbacks that re-enter the engine (SQLite, Node-API's bridge, TLS, the HTTP parser,
  WAMR's imports, the worker thread entry) are generic exports instantiated where the runtime
  hands them over. The HTTP parser's C bridge now takes its callback as a pointer instead of
  calling a fixed symbol.
- The executable moved to `./cli`; `./smoke` is the embedding smoke test without WebAssembly.

The smoke test with `EmptyWasm` links no WAMR symbol (`silk task symbols ... --absent`) and prints
`wasm undefined`; with `WamrWasm` it prints `wasm object`. The workspace is pinned to
0.1.0-dev.78, the first release with #3113, and SQLite's package moved with it
(silk-lang/lib-sqlite, the same branch name as this one).

One gap in the compiler remains: Silk emits a C export of a dependency package only where Silk
code takes it as a value, while the reference (FFI-010) says every export of the loaded modules is
a root. The core takes most of its exports as values (`ext/keep_exports.silk`), but a function
with a callback parameter cannot be one, so the 15 Node-API functions that take a callback
(`napi_define_class`, `napi_wrap` and the others) are plain functions in the core, and
`cli/src/napi_exports.silk` declares them as the executable's C exports. An embedder that loads
addons declares the same until the compiler roots dependency exports.

**Step 3, `ModuleResolver`.** The loader asks the program's `ModuleResolver` for what it needs of
module files: the type of a path, its real path and its source (`moduleNative`, id 19000). The
resolution algorithm stays the loader's, so `require` and `import` resolve as Node's do against
whatever the resolver serves. `NodeResolution` reads the operating system's files, as before;
`MemoryModules` serves a module graph bundled into the program, with directories implied by the
paths and nothing else there. The embedding smoke test runs on `MemoryModules`: its main module
imports an ES module, requires a CommonJS package through its package.json, and gets
`ERR_MODULE_NOT_FOUND` for a module that is not there. A worker thread's capabilities are now made
from its parent's (`forWorker(self)`), so a worker sees the same bundled graph. A module the host
evaluates (`Runtime.evaluateModule`) now has the loader's `import.meta` (`url`, `filename`,
`dirname`), as the runtime's own entry module does. `Files.empty` comes
with step 4, when `fs` stands on `Files`; until then `fs` still reads the operating system.

**Step 3, `Platform`.** `process.env`, `process.cwd()`, `process.chdir()` and exit go through the
program's `Platform` instead of the engine's `silk:host/std` and `silk:host/os`: the bootstrap's
calls through `platformNative` (id 19100), and `process.env` through the environment the worker
natives keep, where the shared one (the main thread's, and a worker's with `SHARE_ENV`) is the
Platform's and a worker's own copy is made from it. `OsPlatform` is the process's own; `FixedPlatform` gives the runtime an environment
and working directory of the embedder's, which it cannot change (`EPERM`). The smoke test runs on
`FixedPlatform` and sees only its one variable. Native code that reads the environment itself, and
child processes, still see the process's. What the bootstrap still takes from those two engine
modules is file access (`host.readFile`, `host.stat`, the permission model's lookups), the standard
streams' descriptors, `kill` and `getpid`, and `gc`: they move with `Files` (step 4), `Processes`
and `SystemInfo` (step 6). Time and entropy are the engine's (`EngineServices`) and stay there
until an embedder needs to fix them; `FixedPlatform` would then carry them.

**Step 4, first part: `Files`.** Every `fs` operation already went through one seam,
`ext/fs_ops.silk`'s `Call` and `Outcome`, run on the loop thread for a synchronous call and on a
blocking thread for an asynchronous one. That seam is now the `Files` capability (ids 2000 to
2007): `fs_native` and `fs_async` run each call through the program's implementation, and a
blocking thread gets it as `runRequest` instantiated for the runtime's capabilities, with the
address of the runtime's own. `OsFiles` is the operating system's file system, as before.
`MemoryFiles` keeps files in memory behind a lock, shared by every thread of the runtime; the
embedder can seed it (`addFile`). Its descriptors start at 1000, and 0 to 2 stay the process's
standard streams. It has no links and keeps no owners, and a relative path is taken from `/`. The
read that skips the blocking threads (`preadv2` with `RWF_NOWAIT`) runs only for `OsFiles`, and an
abandoned open is closed through the capability. Some of `fs`, and the bootstrap's own reads, call
the engine's `os` module on files directly; with a file system other than the operating system's
(`Files.direct` false), the bootstrap points those calls at the capability as well. The embedding smoke test runs on `MemoryFiles`:
a seeded file, a write and an append, `readdir`, `stat`, `existsSync` of a host path (false), and
`fs.promises.readFile` on the blocking threads.

**Step 4, second part: `EmptyFiles` and `RootedFiles`.** With `EmptyFiles` the program has no
file system: `Files` is not among the services, so `node:fs` and the built-ins that stand on it are
not registered (`import('node:fs')` fails with `ERR_UNKNOWN_BUILTIN_MODULE`,
`process.getBuiltinModule('fs')` is undefined), fs's natives (2000 to 2003) are not registered and
their dispatch is not compiled, and the bootstrap's own reads of files fail with `ENOSYS`. The
built-ins that start without `fs` no longer need it at load: `constants`, the constants binding,
the TTY writer, `internal/net`, the compile cache and `Utf8Stream` load it when used, the loader
checks for a patched `fs` only when there is one, and `package_json_reader` takes its stat from the
`ModuleResolver`. The smoke test without WebAssembly now has no file system either; the one with
WebAssembly keeps `MemoryFiles`. `RootedFiles` is the operating system's files under one
directory: paths are taken from the root and `..` stops there, and `realpath` and `mkdtemp` hand
paths back without it. The rooting is lexical, so a link inside the tree that points out of it is
followed. Its descriptors are the system's (`Files.native`), but a path does not mean the same to
it as to the system (`Files.direct` is false), so the bootstrap sends the engine's `os` calls
through the capability, as for `MemoryFiles`. `src/files_tests.silk`
(`silk test --root src/files_tests.silk`) tests both.

The readers that do not go through `fs` and open files in C follow the program's files too.
OpenSSL's root certificates were already read by `fs`. SQLite opens a database through a VFS over
`Files` (`sqlite/src/ext/sqlite_files.silk`) whenever the program's file system is not the host's
(`Files.direct` false), so a database in `MemoryFiles` or under a `RootedFiles` root stays there;
with `OsFiles` SQLite keeps its own unix VFS. OpenSSL's configuration file (`OPENSSL_CONF`,
`--openssl-config`) is then read by `fs` and parsed from memory. WASI's preopens are host
directories (`wamr/src/ext/wasi_host`, with uvwasi's semantics): a program whose files are its own
gives a guest no preopen (`ENOTCAPABLE`, uvwasi's own refusal). The embedding smoke test checks all three. A
`ModuleResolver` over a `Files` (so a rooted or in-memory file system also serves modules) is a
small addition when an embedder needs it.

**Step 5, first part: Compression, Http2, Crypto, Tls.** Each is a library service with a
presence constant and an empty implementation: `NativeCompression` and `EmptyCompression`,
`Nghttp2` and `EmptyHttp2`, `OpenSslCrypto` and `EmptyCrypto`, `OpenSslTls` and `EmptyTls`.
`Capabilities` is now `{ platform, modules, files, compression, http2, crypto, tls, wasm, hostApi }`.
Without one, its natives are not registered, its state is not opened, its loop turn and resource
report are not compiled, and its built-ins are not there; `require('crypto')` fails with
`ERR_NO_CRYPTO` and `globalThis.crypto` is undefined, as in a Node build without OpenSSL, and
fetch asks for no content encoding without compression. The built-ins of other services that
reached into these at load (`constants`, the constants binding, `stream/web`, the iterable stream
transforms, fetch's transport, WebSocket and `internal/ws`, `crypto`'s cipher lists, the option
lookup) load them when used. Their C exports stay kept (`ext/keep_exports.silk`): the C glue that
calls them is still linked until the package split (step 7). Their contract is presence for now:
the natives, state and poll of each still live in the core and move with their package in step 7.

"Services that need each other" is settled at build time: `checkCombination` runs a `static if`
with `compileError` for each rule, so a program that gives `Capabilities` a real `Tls` and an
empty `Crypto` does not build ("Tls needs Crypto: give Capabilities a real crypto (OpenSslCrypto),
or no TLS (EmptyTls)"). `silk check` does not report it, since it does not instantiate the
runtime; `silk build` does.

The smoke test without WebAssembly has none of the four; the one with it has all of them.

**Step 5, second part: Network and Http.** `OsNetwork` and `EmptyNetwork`, `Llhttp` and
`EmptyHttp`. Without the network `node:net`, `node:dgram`, `node:dns`, `node:http`, `node:tty`,
`fetch` and `WebSocket` are not there, and the network's natives (2400 to 2405), state, loop turn
and resource report are not compiled; without the HTTP/1 parser its native (11000) and state are
not. Standard output and error are then written synchronously, as a file's are (`process.stdout.isTTY`
still says whether it is a terminal), and standard input is read as a file when there is a file
system. `tty` is the network's now (a terminal stream is a socket of libuv's, as in Node), and the
message event classes that worker ports use are the core's. `checkCombination` has the rules the
graph declares: the network needs Http, and Tls, Http2 and Processes need the network.  The
inspector's own server needs the network as well (step 6).

**Step 6, first part: Database, NativeAddons and Processes.** `SqliteDatabase` and
`EmptyDatabase`, `DlopenAddons` and `EmptyAddons`, `OsProcesses` and `EmptyProcesses`, in the same
shape as the libraries of step 5. Without a database
`node:sqlite` and `localStorage` are not there, and the database needs `Files`
(`checkCombination`). Without addons `process.dlopen` fails with `ERR_DLOPEN_DISABLED`, as with
`--no-addons`, and Node-API's natives, state and loop turn are not compiled; the Node-API C
functions stay exported until the package split. Without child processes `node:child_process` and
`node:cluster` are not there, a runtime started by a parent does not connect to its IPC channel,
and the process executor stays: it serves signals (`process.on('SIGINT')`, the inspector's SIGUSR1)
and handle transfer, which every runtime has, until those move to the core.

**Step 6, second part: SystemInfo and TypeStripping.** `OsSystemInfo` and `EmptySystemInfo`:
the errno, signal and dlopen numbers that `constants`, dotenv and the socket binding need are the
core's now (`internal/os_constants`, which `os.constants` is), so without system information only
`node:os` is gone; its native stays, as it also answers the process's own facts (its executable's
path, the component versions). `Amaro` and `EmptyTypeStripping`: what step 2 made follow the
service is now the embedder's choice, and `checkCombination` checks that amaro has WebAssembly to
run on.

**Step 6, third part: Workers.** `ThreadWorkers` and `EmptyWorkers`. `worker_threads`, message
ports, `process.env` and the thread identities stand on the worker natives, which every runtime
has, so they stay; without worker threads `new Worker()` fails with `ERR_WORKER_INIT_FAILED` and
the native start of a thread is not compiled.

**Step 6, fourth part: Inspector.** `NodeInspector` and `EmptyInspector`. The inspector here is
the protocol: `node:inspector`, `--inspect` and its kind, the in-process sessions the REPL uses, the
debugger and the network and storage views. Tracing (`trace_events`), the console's hook and the
V8 profiles that use the engine directly (heap snapshots, `v8.takeCoverage`, `NODE_V8_COVERAGE`) are
the core's now, since the console, diagnostics channels, fs and http report to them at load.
Without the inspector its natives (15000 to 15032) and state are not compiled,
`require('inspector')` fails with `ERR_INSPECTOR_NOT_AVAILABLE`, `--inspect`, `--cpu-prof` and
`--heap-prof` are bad options, `process.features.inspector` is false, the REPL has no previews,
`vm` contexts are not listed, and `console.profile` and `console.context` do nothing, as in a Node
build `--without-inspector`. The inspector needs the network (`checkCombination`).

With this, every capability of the design is a service with an empty implementation.

**Step 7, first parts: the library packages.** A library service now has a contract of
operations, not only its presence: `open`, `call` for its native ids, and `poll`,
`appendResources`, `openHandles` and `close` where it has work in flight, each forwarded by
`Composition` (`compressionCall`, `http2Open` and so on), with the state inside the
implementation's value instead of a pointer field of `Services`. Its version for
`process.versions` comes from its own native. So the real implementation can live in a package
that depends on the core, as `WamrWasm` does in ./wamr:

| Package | Implementation | Brings |
| --- | --- | --- |
| ./compress (`silkjs-runtime-compress`) | `NativeCompression` | brotli (zlib and Zstandard are its own Silk) |
| ./http2 (`silkjs-runtime-nghttp2`) | `Nghttp2` | nghttp2 |
| ./llhttp (`silkjs-runtime-llhttp`) | `Llhttp` | llhttp and its bridge |
| ./sqlite (`silkjs-runtime-sqlite`) | `SqliteDatabase` | SQLite (lib-sqlite) |
| ./openssl (`silkjs-runtime-openssl`) | `OpenSslCrypto`, `OpenSslTls` | OpenSSL |
| ./inspector (`silkjs-runtime-inspector`) | `NodeInspector` | the inspector's WebSocket server (its own sockets and thread) |
| ./amaro (`silkjs-runtime-amaro`) | `Amaro` | amaro's JavaScript (3.8 MB) |
| ./napi (`silkjs-runtime-napi`) | `DlopenAddons` | Node-API's C functions |
| ./wamr (`silkjs-runtime-wamr`) | `WamrWasm` | WAMR, SIMDe |

The core's manifest no longer lists those libraries. The embedding smoke test checks with `nm`
that the program of the core alone defines no symbol of any of them, and that the program with
every capability defines one of each. Their C entry points are kept by the implementation's
`open` (`keepExports`), since a dependency's C exports are emitted only when taken as values.

Two core services reach OpenSSL without being its natives: the network runs the TLS sessions of
native sockets (2405), and a worker thread's start sets OpenSSL's providers up first. Both go
through C function tables the core defines and the implementation fills
(`ext/library_hooks`: `SecureOps` from `Tls.secureOps`, `ThreadSetup` from
`Crypto.threadSetup`), so the core names no OpenSSL symbol; the empty implementations give tables
that attach no session and set nothing up. A library's version is a call of its native with no
arguments, so ordinary calls pay nothing for it.

The inspector's server computes the WebSocket handshake's SHA-1 itself, so it needs no OpenSSL.
`NodeInspector` holds the protocol's natives and the server; the engine's hooks reach it through
`Inspector` (`compiledSource`, `markEntry`, `debuggerCallback`, `pumpCallback`). The debugger
metadata the engine keeps on code (`ext/inspector_debugger` and what it uses) stays in the core,
since `vm` and the loader defer sources whether or not there is an inspector.

Built-in JavaScript can belong to a package too. `tools/embed.py` writes the built-ins of a
service listed in its `PACKAGED` into that package's C (`amaro/amaro_sources.c`), and the core's
table (`builtin_sources.c`) keeps an empty entry for each, which a pointer the package's C sets
when the program loads fills. `Amaro.link`, called once at start, is what makes a program that
depends on the package link that file, so a program without it holds none of amaro's bytes.

The Embedding workflow (`.github/workflows/embedding.yml`) is the matrix's first two rows: the
program of the core alone and the program with every capability package, each with its
expected output and its symbol checks (`silk task symbols`). The executable is the third.

**What is left of step 7.**

- `DlopenAddons` is ./napi (`silkjs-runtime-napi`): Node-API's C functions, which addons find by
  name, are emitted because `DlopenAddons.open` takes them as values (`keepExports`), as the other
  packages do. The 15 that take a callback cannot be taken as values, so a program that loads
  addons exports those itself (`cli/src/napi_exports.silk`, in the executable's program). Silk
  0.1.0-dev.86 emits every loaded dependency's exports, so that file can now go.
- The loop plan took libuv out of the core; `OsFiles`, `OsNetwork`, `OsProcesses`,
  `OsSystemInfo` and `ThreadWorkers` stay in it for now (a `silkjs-runtime-os` package next, so
  that the core touches no libc).
- The heap image is now an embedder's too. An embedder whose process ends with the runtime says
  so (`Options.ownsProcess`), and gets the executable's image modes: it starts from an image
  appended to its program, and `--silk-write-heap-image PATH` as its second argument writes one.
  `silk task image --program PROGRAM` (tools/capabilities) has the program write its image and
  appends it with the loader's trailer; the image holds the code addresses of that binary, so it
  is tied to its implementation types without more identity. The image build loads only the
  built-ins of the program's capabilities, and warms the main-script path and console only on the
  host's files. The embedding smoke test runs its full program a second time from the image and
  checks that the start was one (it lists the image pages it wrote): about 195 ms against 307 ms
  cold, in debug builds. What stays with `tools/build.py` is the executable's
  profile-guided extras: the page layout from its startup profiles and the built-ins' bytecode
  cache, which needs a second link.

**Step 8, the real compression.** `NativeCompression` (./compress) now has no zlib or zstd C
either: its zlib streams are Silk that write Node 24's bytes (`compress/src/ext/zlib_stream.silk`,
../ZLIB_NOTES.md) and its Zstandard is the port in ../../zstd (../ZSTD_NOTES.md), so brotli is its
only C library. `SilkCompression` below is the alternative with brotli in Silk too, over
`silk.compress`.

**Step 8, first swap: compression.** `SilkCompression` (./silkcompress) is `Compression` over
`silk.compress`, with no C library: the same handle and job protocol as `NativeCompression`, and
the encoders and decoders of the standard library in place of zlib, brotli and zstd. It has
deflate, zlib, gzip, their inverses and unzip with every flush, dictionaries and `params`,
multi-member gzip with zero padding and strict trailing-junk checks, brotli with its quality and
window, and Zstandard with its level, window, checksum, content size and pledged size; it fails
at creation for what `silk.compress` lacks (brotli and Zstandard dictionaries, brotli's large
window, Zstandard's worker threads). Its errors are zlib's, brotli's and zstd's codes and
messages, in zlib's order of checks.

`cli/silk` is the executable with it in place of `NativeCompression` (and `SilkHttp`, below), and
`tests/compression-differential.mjs` runs the same cases (`tests/compression-cases.cjs`: one-shot
and streamed, every format, levels, strategies, windows, flushes, `params`, reset, dictionaries,
corrupt, truncated and trailing input, async work, `CompressionStream`) under Node and a runtime.
Both executables agree with Node on all 94; compressed bytes may differ from zlib's but always
decode under Node, and a brotli format error keeps its code family and message but not always
its number, which depends on where the decoder notices the fault. The compatibility suite passes
with it as well. On 8 MB, debug builds, gzip and Zstandard run as fast as the C libraries and
brotli compresses about 2.6 times slower and decompresses faster.

**Step 8, second swap: the HTTP/1 parser.** `SilkHttp` (./silkhttp) is `Http` with an HTTP/1
parser written in Silk (`silkhttp/src/ext/http1.silk`) in place of llhttp. It has llhttp 9's
interface, so the bridge above it (`ext/http_parser_native`) is llhttp's with the import changed:
the same callbacks in the same order, the same pause, upgrade and error protocol, flags,
keep-alive and body rules, `HPE_*` codes and reasons, and error positions by llhttp's rule (one
past the byte that ended a span or step when that byte was consumed, the byte itself when it was
refused). Strict parsing is the default and llhttp's lenient flags are honoured, and the HTTP/2
preface pauses the parser as llhttp's does; RTSP and ICE start lines and chunk extension callbacks
are not there (extensions are checked and skipped). `process.versions.llhttp` comes from the implementation (`silk` for this one).
`tests/http-parser-differential.mjs` runs `tests/http-parser-cases.cjs` (73 cases: requests and
responses split at every byte, pipelining, chunked bodies and trailers, upgrades, pauses,
keep-alive, lenient flags and the malformed inputs of each state) under the executable and under
one with `SilkHttp`, and compares every event, consumed byte count, error code, reason and
position: all 73 agree. The compatibility suite passes with it, and so do HTTP/1, HTTP/2, HTTPS
and TLS servers and clients and `fetch`.

**Step 8, third swap: HTTP/2.** `SilkHttp2` (./silkhttp2) is `Http2` with an HTTP/2 session
written in Silk (`silkhttp2/src/ext/h2.silk`, HPACK in `h2_hpack.silk`) in place of nghttp2. It
has the part of nghttp2 1.66's interface the bridge uses, so the bridge is nghttp2's with the
import changed, and it ports nghttp2's session rules: the inbound state machine frame by frame
and byte by byte (padding, CONTINUATION, SETTINGS entries, GOAWAY debug data, ALTSVC and ORIGIN),
stream states and the concurrency limits, flow control with window updates the application
drives, the urgent, regular and request queues and the DATA scheduler, SETTINGS and their
acknowledgement, PING and SETTINGS ACK flood limits, GOAWAY, the RST_STREAM rate limit, the HTTP
messaging checks of http.c, the error codes and their texts, and the callbacks in nghttp2's
order. HPACK indexes and Huffman-codes as nghttp2's deflater does, with the static table and
Huffman trie of `silk.http`. Not there, as the bridge does not use them: RFC 9218 urgencies,
user extension frames, upgrade from HTTP/1 and no-copy DATA; nghttp2 1.66 has no RFC 7540
priority tree either. Header blocks are decoded whole when they end rather than as they arrive.
Node's own HTTP/2 tests (`test-http2-*`, 283, through `tests/node-suite`) measure it: 280 of the 282 that pass under Node pass, the same 280 as with nghttp2 (both fail
the two `misbehaving-flow-control` tests). The compatibility suite passes with it, and the CI job
runs Node's HTTP/2 tests with both and requires every test that passes with nghttp2 to pass with
it.

**Step 8, fourth swap: crypto.** `SilkCrypto` (./silkcrypto) is `Crypto` over `silk.crypto` and
`silk.tls`'s certificate code. It keeps ../openssl's bridge (the operations by name, their
arguments, handles, worker jobs and results: `ext/crypto_silk`) and replaces its OpenSSL calls:

- `ext/crypto_algorithms`: random bytes, constant-time comparison, PBKDF2, scrypt, HKDF, hashes
  (MD5, SHA-1, SHA-2, SHA-3, SHAKE, BLAKE2, RIPEMD-160, SM3, MD5-SHA1, under all of OpenSSL's names
  and aliases), HMAC, and the ciphers: AES in ECB, CBC, CFB, CFB8, CFB1, OFB, CTR, GCM, CCM and key
  wrap, 3DES, ChaCha20 with and without Poly1305 (tags of any length), found by name, nid or OID;
- `ext/crypto_blocks`: ARIA, Camellia, SM4 and two- and three-key DES in the generic modes, CBC
  with ciphertext stealing (CS1, CS2, CS3), AES-XTS, AES-OCB and the CMS 3DES key wrap;
- `ext/crypto_keys`: RSA, RSA-PSS (with its restrictions), DSA, DH, EC (P-256, P-384, P-521,
  secp256k1, P-224, P-192), Ed25519, X25519, Ed448, X448, ML-DSA and ML-KEM keys: PEM and DER
  (SubjectPublicKeyInfo, PKCS #8 plain and PBES2-encrypted, PKCS #1, SEC1, legacy encrypted PEM,
  certificates), JWK and raw forms, generation (DSA and DH parameters and primes included),
  signatures (PKCS #1 v1.5, PSS, DSA, ECDSA, EdDSA, ML-DSA with context), key agreement (ECDH, X25519,
  X448, DH, and the `createECDH` and `createDiffieHellman` objects), RSA encryption, and
  `encapsulate` and `decapsulate` (ML-KEM, DHKEM over P-256/384/521, X25519 and X448, RSASVE);
- `ext/crypto_x509`: `X509Certificate` (names, times, fingerprints, serial, extensions, host,
  e-mail and IP checks, `checkIssued`, `checkPrivateKey`, `verify`, the legacy object) and SPKAC;
- `ext/crypto_argon2`: Argon2d, Argon2i and Argon2id (with its own BLAKE2b, whose output length
  H' needs); `ext/crypto_keccak`: TurboSHAKE, KangarooTwelve's sponge, cSHAKE's KECCAK-KMAC and KMAC;
  `ext/crypto_mac`: `createMac` with HMAC, KMAC, CMAC, GMAC, Poly1305, SipHash and keyed BLAKE2b
  and BLAKE2s; `ext/crypto_mldsa`: the public key of an ML-DSA private key given only in its
  expanded form (`silk.crypto.ml_dsa` makes keys from seeds only).

Failures carry OpenSSL's error strings, so Node's error codes come out the same, and
`process.versions.openssl` is `3.5.4+silk`: the OpenSSL release whose behaviour it follows, marked
as not OpenSSL. Not there, and failing with `ERR_CRYPTO_UNSUPPORTED_OPERATION` or OpenSSL's
"unsupported": SLH-DSA, PKCS #12, key stores, Ed25519 with a context (Ed25519ctx), multi-prime RSA,
RSA keys under 512 bits, RSA OAEP with an MGF1 digest other than its OAEP digest, AES-SIV,
AES-GCM-SIV and the inverse key wraps. DH parameters are slow to generate: a 1024-bit safe prime
takes tens of seconds (`silk.crypto.prime` sieves the two primes separately).

`tests/crypto-differential.mjs` runs `tests/crypto-cases.cjs` (811 cases over fixed keys and
certificates in `tests/fixtures/crypto`) under Node and a runtime: SilkCrypto agrees on all of
them. The compatibility suite passes with it; of Node's 207 crypto and Web Crypto tests that pass
under Node, 182 pass with it (all 55 Web Crypto ones), against all 207 with OpenSSL.

**Step 8, fifth swap: TLS.** `SilkTls` (./silktls) is `Tls` over `silk.tls`'s sans-IO client and
server. It keeps ../openssl's bridge (`ext/tls_silk`: the operations `host.tls` takes by name,
their arguments and OpenSSL's error strings, the contexts and sessions by id, and the `SecureOps`
the network's native TLS sockets run a session's records with) and replaces OpenSSL's memory-BIO
sessions with `ext/tls_engine`, which feeds and drains ciphertext, reads and writes plaintext and
answers each handshake step as `SSL_do_handshake` does:

- A context holds key and certificate pairs (Node's arrays of them; a server signs with the first
  that matches), its CA list, ALPN, versions and a ticket key. A server stops after the
  ClientHello for JavaScript to pick a context (SNI, `SNICallback`, the ALPN callback, which can
  reject), then completes a chain that is only a leaf from its CA list, as OpenSSL does.
- Node finishes a handshake whatever the server's certificate, and judges it afterwards
  (`rejectUnauthorized`, `checkServerIdentity`), which `silk.tls`'s client did not allow: it gains
  `Client.deferVerification` (with `verificationFailure` and `peerCertificateDer`). The verdict
  is OpenSSL's: the engine checks the peer's chain as `X509_verify_cert` does (chain building from
  the CA list and the peer's certificates, CA flags, the purpose, signatures through
  `silk.tls.signature`, validity, `allowPartialTrustChain`, and Node's blocklist of public keys),
  with OpenSSL's error codes. `silk.tls`'s own validation follows a stricter profile (critical
  basicConstraints on intermediates, CA anchors only) that certificates Node accepts, its test
  fixtures among them, do not meet.
- Session resumption: a client offers the session JavaScript gives it and reports the ones the
  server's tickets give (`session`, `getSession`, `getTLSTicket`, `isSessionReused`; a session
  carries the peer's chain and result, as `SSL_SESSION` does); a server issues tickets (a random
  key, or `ticketKeys`; `sessionTimeout`; not with `SSL_OP_NO_TICKET`).
- Client certificates (requested, required), `setMaxSendFragment`, one record per read, the
  negotiated suite, version, group and ALPN, and cipher lists checked against OpenSSL's names.

`silk.tls`'s deferred verification is not in the pinned toolchain yet, so `SilkTls` carries
`silk.tls.client` with it (`silktls/src/ext/tls_client.silk`: the pinned toolchain's module with the
change on silk-lang/silk's `tls-client-deferred-verification` branch); everything else is the
toolchain's `silk.tls`, and the executable builds with the released toolchain alone. Once a
release has the change, `SilkTls` imports `silk.tls.client` again and the copy goes.
`cli/silk` is the executable with all five Silk libraries, `SilkTls` among them.

Of Node's TLS and HTTPS tests (`test-tls-*`, `test-https-*`, through `tests/node-suite`), 231 of the
283 that pass under Node pass with it, against 279 with OpenSSL, and the compatibility suite
and the crypto differential pass with it. The CI job `silk-libraries` runs those tests too (no
fewer than 225 must pass). What `silk.tls` does not have
fails, with OpenSSL's errors where Node checks them: TLS 1.0 and 1.1, CBC and static-RSA suites
and finite-field DHE (`test-tls-min-max-version` and the `test-tls-cli-*-version` tests that run
it, `getprotocol`, `honorcipherorder`); choosing the suites (`ciphers` and suite lists are checked
but do not restrict, so the suite is the one `silk.tls` prefers: AES-128-GCM where OpenSSL's
client picks AES-256-GCM); the hybrid ML-KEM group; PSK, keylog, `getFinished`,
`exportKeyingMaterial`, renegotiation, tracing, OCSP stapling and a server-side session cache
(`newSession`, `resumeSession`) or resuming a session with a client certificate; SNI names
outside the HTTPS profile, such as `sni.0`; PKCS #12 (`pfx`, as in `SilkCrypto`) and CRLs.

The CI job `silk-libraries` (`.github/workflows/embedding.yml`) builds `cli/silk`
and the executable with the C libraries, runs the compression and crypto differentials against
Node, the parser differential against llhttp, Node's HTTP/2, TLS and HTTPS tests and the
compatibility suite.

What is left of step 8 is the gaps of `SilkCrypto` and `SilkTls` listed with them, and dropping
`SilkTls`'s copy of `silk.tls.client` once a toolchain release has its deferred verification.
libuv left the core with the loop plan, below.

### The loop plan: libuv out of the runtime

libuv was the last vendored library every build linked. It was not one library service: the event
loop itself was libuv's (`fs_async` ran a `silk.io.reactor` Reactor with libuv's loop as a guest),
and files, sockets, terminals, child processes, signals and the facts about the computer each
reached it from their own modules. It left area by area, each moved onto the standard library and
measured against Node's tests for that area, and the loop went last, when nothing else needed it:

| Step | Area | libuv today | In its place | Measured by |
| ---: | --- | --- | --- | --- |
| 1 | Facts about the computer and the process (`os`, `process.resourceUsage`, `cpuUsage`, `availableMemory`, `ppid`, priorities, user info) | `os_native`: `uv_cpu_info`, `uv_interface_addresses`, `uv_os_*`, `uv_get_*_memory`, `uv_getrusage*`, `uv_uptime`, `uv_loadavg`, `uv_exepath` | `silk.system.system_info`, with libuv's semantics where they differ (free memory is `MemAvailable`; available memory is the cgroup limit less its whole use; uptime is `/proc/uptime`'s) | `test-os*`, `test-process-*` |
| 2 | The clock outside the loop | `uv_hrtime` in `spawn_sync` (`system_errors` already has libuv's error names and texts in Silk) | The engine's monotonic clock, the one `uv_hrtime` reads | `test-child-process-spawnsync*` |
| 3 | Addresses as text, in DNS and the interfaces | `dns_native`, `os_native`: `uv_ip4_addr`, `uv_ip6_addr`, `uv_ip4_name`, `uv_ip6_name` | `ext/inet`: parsing through `silk.net.address`, and libuv's `inet_ntop6` rules (embedded IPv4 dotted) | `test-dns*`, `src/inet_tests.silk` |
| 4 | Child processes and signals | `process_native`, `process_abi`: `uv_spawn`, `uv_process_kill`, `uv_signal_*`, `uv_poll_*` | `silk.system.subprocess`, `silk.system.signal_watch` on the reactor | `test-child-process-*`, `test-process-kill*`, `test-signal-*` |
| 5 | File requests | none: the `Files` service's operations (fs_ops) make their system calls themselves; `uv_fs` kept only unused declarations | (done: the declarations are gone) | `test-fs-*` |
| 6 | Sockets, pipes and terminals | none: `net_native` is `silk.net.socket_native`, `silk.net.datagram_native` and the reactor's; `uv_net` kept only unused declarations | (done: the declarations are gone) | `test-net-*`, `test-dgram-*`, `test-tty-*`, `test-http-*` |
| 7 | The loop and its handles | `fs_async` (the guest loop, `uv_async_*`, `uv_fs_event_*` for `fs.watch`, `uv_fs_poll_*` for `fs.watchFile`, idle-time metrics), `vm_interrupt` (its signal loop), `process_native` (the handles of step 4), `resource_snapshot` and `host` (handle bookkeeping, `uv_walk`, `uv_metrics_info`) | `silk.io.reactor` alone: the runtime's own handle table (kind, reference, active, closing) for liveness, `process.getActiveResourcesInfo` and loop metrics; wakeups through the reactor's waker; inotify and kqueue descriptors, and a timer with `stat`, for the watchers | the whole suite |

All seven steps are done: the core links no libuv, and its loop is `silk.io.reactor` alone.

- Steps 1 to 3. `os_native` reads `silk.system.system_info`, with libuv's semantics kept where the
  two differ, and every `os` and `process` fact a probe reads matches Node; `spawnSync` times with
  the engine's monotonic clock; `ext/inet` converts addresses (`silk test --root
  src/inet_tests.silk`). Steps 5 and 6 needed no move: file requests and sockets were already off
  libuv, which only kept unused declarations, now deleted; `uv_thread_setname` is
  `pthread_setname_np` (as libuv truncates the name).
- Step 4. A child starts with `ext/spawn_sync`'s `posix_spawn`, as `spawnSync`'s do. Its exit is a
  `silk.system.subprocess` `ExitWatch` (a pidfd on Linux, a kqueue `EVFILT_PROC` on Darwin) in the
  reactor, reported once, as libuv's exit callback was; an IPC channel's descriptor joins the
  reactor in place of a `uv_poll` handle; `kill` is kill(2). As libuv's child does, an inherited
  standard descriptor is made blocking before the child starts.
- Signals. One `silk.system.signal_watch` per runtime holds every signal with a listener (and
  SIGUSR1 for the inspector's activation) as a reactor descriptor. SIGINT goes through
  `ext/vm_interrupt`'s broker, which watches it on a thread with a reactor of its own while an
  execution (`breakOnSigint`, the REPL) or a listener is registered, marks the newest execution or
  counts the signal for each listener, and wakes the listener's loop through its `Waker` (in place
  of `uv_async_send`). Callbacks run in the order the events arrived, as libuv's. A watched signal
  is blocked (Linux) in the thread that adds it, the main thread, so each thread the runtime starts
  (the blocking pool, workers, the broker, the engine's pre-parse helpers) starts and stays with
  process signals blocked (`ext/thread_signals`): they reach the main thread or its watch, and a
  signal without a listener takes its default action, as in Node.
- Step 7. `fs.watch` is an inotify instance (Linux) or a kqueue `EVFILT_VNODE` filter (Darwin) for
  each watcher (`ext/file_watch`), with libuv's rename and change events and names; `fs.watchFile`
  is a stat timer with libuv `fs_poll`'s rules (a change when the status differs, an error once).
  Liveness is each executor's own references (`fs_async.hold`), `process.getActiveResourcesInfo`
  and the report's handle list read the runtime's records, and idle time is the reactor's.
  An N-API addon that asks `napi_get_uv_event_loop` gets a libuv loop from `silkjs-runtime-napi`,
  which runs it as the reactor's guest (`fs_async.Guest`). That loop and the rest of libuv 1.51's
  C API are Silk (`napi/src/ext/uv_loop.silk`, `uv_api_*`; main's libuv replacement,
  ../LIBUV_REPLACEMENT_NOTES.md), so no build compiles libuv's C. `process.versions.uv` is 1.51.0, the
  libuv of the Node release the runtime follows.
- WASI. uvwasi is gone: `silkjs-runtime-wamr`'s WASI Preview 1 is Silk (`wamr/src/ext/wasi_host`),
  uvwasi 0.0.23's semantics call by call (its descriptor table and rights, its path resolver with
  the sandbox check and up to 32 symbolic links, whole-second times, `poll_oneoff` waiting for
  every descriptor), over `silk.platform.native.file` and POSIX. Each of Node's 27 WASI programs
  (`test/wasi/wasm`, run through `test/fixtures/wasi-preview-1.js`) exits and prints as under
  Node, as with uvwasi, and Node's `wasi`/`wasm` tests in `test/parallel` pass as before.

Measured with the libuv-free build: Node's `os` and `process` tests pass as with libuv (94 of the 98
that pass under Node), its DNS, `spawnSync` and `exec` tests all pass (59 of 59); its child
process, worker, `fs.watch`, `fs.watchFile`, signal and `process.kill` tests pass as with libuv
(304 of 307); 909 more (`vm`, `repl`, `process`, `report`, WASI, timers, `fs`, async hooks,
diagnostics, trace events, `readline`, terminals and standard streams) pass as with libuv (895),
with no test that passed before failing; and the compatibility suite passes (75 of 75). The core
program of `tests/embed-smoke.py` defines no libuv symbol.

Gaps. Darwin's `fs.watch` is kqueue's, without FSEvents' recursive watching of a directory tree. On
Linux, a worker thread's `vm` `breakOnSigint` does not stop the process's SIGINT: the watch blocks
SIGINT in the thread that registers, and a worker's is the only one, so the main thread takes
it with its default action (Node interrupts the worker). libuv's C API stays for Node-API addons
alone: their ABI includes libuv (`napi_get_uv_event_loop`, and the `uv_*` functions an addon
calls, as the runtime's own fixture `tests/fixtures/napi/async.c` does), so only
`silkjs-runtime-napi` has it, and a program without addons links none of it. That loop has
FSEvents for an addon's `uv_fs_event` on Darwin (`napi/src/ext/uv_fsevents.silk`), which the
core's `ext/file_watch` could take over to close the gap above. WASI's preopens
are host directories still; the `Files` service in their place is step 4 of the migration plan.
The Os* implementations move to `silkjs-runtime-os` next, so that the core touches no libc.

## Risks and decisions taken

Decisions made here without asking, each reversible before step 1 lands:

- Each capability is a required service with a shipped empty implementation, as Julia asked. The earlier draft's single extension set written as a type is dropped. Silk's optional services, which would let an unwanted capability simply be omitted, were considered and set aside: Julia prefers the whole surface written out here, and an optional service that one signature forgets to forward goes absent with no error.
- The list of services is closed. The host's own API goes through `HostApi`, which replaces the existing `Embedder` hook. Nothing depends on that hook but the smoke test.
- Absent means absent, with Node's error codes. No stub modules.
- Presence is a constant of the implementation type, fixed at build time. Run time varies values only.
- Services arrive as Effect requirements if the measurement in step 1 allows it, and as fields of one `Capabilities` struct if it does not.
- Library services (crypto, TLS, Wasm and the like) start with the binding contract and narrow to operations when their library is replaced.
- `globalThis.crypto` is split: random in the core, `subtle` with the `Crypto` service.

Risks:

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Requirement rows through the engine | The host hooks are fixed at the allocator today, and the engine is 474 files written against that. Past notes record that small changes to the call path cost measurable Octane instructions | The spike is the first thing in step 1, gated on equal instruction counts. The fallback is the same services as fields of one struct |
| Dispatch cost | Any per-call check on the native path is expensive | Hot ids stay in the core ahead of the chain. The chain is static with constant ranges, and `present` is a constant, so no check survives into the binary |
| An empty service does not remove everything | The design relies on the compiler and linker dropping code and embedded JavaScript behind a constant false | Step 1 checks the binary with `nm` and compares sizes. If embedded JavaScript survives, each service's JavaScript index moves into the package of its real implementation |
| Compile time and code size | The runtime is specialized once per combination of implementations, and the engine is large | One combination per binary is the normal case. Measure build time in step 1. Binaries with several combinations pay per combination, which is stated in the embedder docs |
| A long list at the entry point | 18 services, so 18 lines even for hello world | Deliberate: the list is the program's whole surface. The docs give two starting points to copy, everything real and everything empty |
| JavaScript untangling is larger than the native work | 561 files written as one bundle, many lazy requires | Step 0 sizes it from data before committing. The CI check stops regressions as other threads keep porting Node modules |
| A rooted `OsFiles` is not a sandbox by itself | Symlinks and `..` races escape a path prefix check | `OsFiles` resolves beneath a directory descriptor (`openat2` with `RESOLVE_BENEATH` on Linux, component-wise `openat` with no-follow elsewhere). The docs state which guarantees hold per platform |
| Leaks around services | Node-API loads arbitrary native code, SQLite and OpenSSL open files themselves, the inspector opens a socket | Each is routed through `Files` or `Network` in steps 4 to 6, or is a service a sandboxing embedder gives the empty implementation. The libc rule in step 7 catches what review misses |
| Concurrent streams | Compat and performance threads edit `host.silk`, `worker.silk` and `bootstrap.js` daily | Each step moves one service and leaves the rest compiling unchanged, so other threads only meet the new shape when their area moves. Announce step 1 and step 2 to open threads before merging |
| Silk features assumed | Generic requirement rows on interface methods, a static assertion over service constants, package build steps | Step 1 exercises all three on the pinned toolchain. A gap becomes a compiler change, which is in scope for this project |

Open points the measurements in step 0 should settle: whether `Http` should need `Network` or accept any byte stream (which decides if an embedder can serve HTTP without sockets), whether 18 services is the right grain or some should merge (`Crypto` with `Tls`, `Http` with `Http2`), and how much of `process` belongs to the core against the `Processes` service.

## Sources

- Code read: `silk-lang/lib-silkjs` at `197416d` (`modules/runtime/silk.toml`, `src/libs/core/host.silk`, `src/runtime/worker.silk`, `session.silk`, `embed.silk`, `runtime/bootstrap.js`, `tools/embed.py`, `src/ext/*`), and `silk-lang/silk` main (`stdlib/silk/system`, `reference/compilation-profiles.md`, `reference/module-static-selection.md`, `reference/generics-interfaces-and-specialization.md`).
- [deno\_core `extension!`](https://docs.rs/deno_core/latest/deno_core/macro.extension.html)
- [workerd capabilities](https://www.mintlify.com/cloudflare/workerd/concepts/capabilities) and [Workers `node:fs`](https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/)
- [wasmtime `WasiCtxBuilder`](https://docs.wasmtime.dev/api/wasmtime_wasi/struct.WasiCtxBuilder.html)
- [Javy plugin `Config`](https://docs.rs/javy-plugin-api/4.1.0/javy_plugin_api/struct.Config.html)
- [Node C++ embedder API](https://nodejs.org/download/nightly/v27.0.0-nightly20261018f88a1d25e9/docs/api/embedding.md)
