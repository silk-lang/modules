# React first render benchmark

What a Silk UI app pays before native layout can start: evaluating a production React
bundle and running React's first render, with no window and no GPU.

`dist/bundle.js` (committed, so the benchmark runs without npm) is React 19.3.1 and
react-reconciler 0.34.0, the versions SilkUI's packages use, built for production with a
custom reconciler host whose operations do nothing (`src/host.js`). marked and
highlight.js ride along, as they do in a chat app's bundle: they cost parse and compile
time and are not called.

- **mount**: a transcript of 1,000 messages, 33,001 host elements and 21,000 text nodes,
  rendered and committed synchronously.
- **stream**: 200 messages mounted, then one `setState` per tick that appends to the last
  message (a memo list where one item changes), committed synchronously.

The driver (`driver/`, a Silk program on the engine's embedding API) reports each phase:
realm creation, parse + compile, bundle top-level evaluation, render + commit, the
collections that ran and their time, heap in use (peak, after mount, after a forced
full collection, after unmounting) and the memory the process holds: resident memory on
Linux, the footprint on macOS (what `footprint` and Activity Monitor show, which falls
as soon as pages are given back; resident size there falls only when the system takes
them). After unmounting it asks the runtime for its idle arenas back
(`js_runtime.releaseIdle`), as a host does when its app goes idle; the runtime does the
same after a full collection of its own. `run-node.mjs` reports the same
lines for Node.

    cd driver && silk build --release && cd ..
    python3 run.py                       # engine, node --jitless, node: median of 5 runs
    python3 run.py --runs 9 --engine before=/path/old-driver --engine after=/path/new-driver

To measure a launch that parses nothing, write the bundle as a bytecode image
(`js_bytecode_image`; the shell's `--write-image` writes the same bytes) and load it:

    ../../../../build/x86_64-unknown-linux-gnu/release/silkjs-react-bench image dist/bundle.js > dist/bundle.bin
    python3 run.py --engine source=DRIVER --engine "image=DRIVER --bytecode dist/bundle.bin"

An image only loads in the engine build that wrote it, so it is not committed.

Runs are interleaved across engines, one fresh process each. Compare builds on a quiet
machine: a compile running beside the benchmark moves the numbers by 10% or more.

To rebuild the bundle after changing `src/` or the versions in `package.json`:

    npm install && node build.mjs
