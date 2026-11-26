# ui-js-node

Runs a ui-js application on the SilkJS runtime instead of the bare engine: the realm has
Node's APIs and the web APIs Node has (`fetch`, `WebSocket`, `URL`, `TextEncoder`,
`crypto`, `AbortController`, `structuredClone`, `Intl`, timers, `process` and the rest), with
`@silkui/core` beside them. Use it when an application needs the network or other platform APIs;
`ui-js-window` stays the smaller choice for one that does not.

The runtime runs on the window's UI thread. The window host waits in the runtime's loop
(`NodeClient` waits itself), and window events end that wait, so timers, sockets and files
cost nothing while idle. Animation frames and events are the window's, as with
`ui-js-window`. An uncaught exception is printed and the window keeps running.

```silk
let mut window = NodeWindow.make(&fonts, options, NodeClient.make())
run window.define(b"@silkui/core", uiPackage())
run window.entry(b"/app/app.js", source)
let status = run window.start(b"my-app")
```

The entry is named by an absolute path or a URL; its relative imports and `import.meta.url`
resolve from it.

## Building

A plain `silk build` of the program builds everything, the runtime included. Silk downloads the
pinned source releases of the C libraries the runtime uses (libuv, OpenSSL, nghttp2, zlib,
Zstandard, Brotli) on the first build and compiles them itself; nothing needs installing besides
Silk and Clang. The runtime does not build for Windows yet.

The first build compiles about 1,300 C files and takes a few minutes more; later builds reuse
them. The first link of a program needs memory: allow about 9 GB for silkc.

## Checking

`tests` is a program that runs `fixtures/net.js` in the runtime-backed realm against a local
HTTP and WebSocket server (`fixtures/server.mjs`, run by Node). CI's `node` job runs it on Linux,
building the runtime and its pinned native dependencies with Silk:

```sh
silk build --manifest-path modules/js/node/tests/silk.toml
python3 modules/js/node/scripts/check modules/js/node/tests/build/<binary>
```
