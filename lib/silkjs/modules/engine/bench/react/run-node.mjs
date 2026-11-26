// Node's side of the React benchmark: the same bundle and the same `name value` lines as
// the engine's driver (driver/src/main.silk). Run with --expose-gc, and with --jitless
// for the interpreter-only reference:
//
//   node --expose-gc [--jitless] run-node.mjs mount|stream dist/bundle.js [messages] [ticks]
import { readFileSync } from "node:fs";
import { PerformanceObserver, performance } from "node:perf_hooks";
import vm from "node:vm";

const [mode, bundle, messagesArgument, ticksArgument] = process.argv.slice(2);
if (!bundle || (mode !== "mount" && mode !== "stream")) {
  console.error("usage: node --expose-gc run-node.mjs mount|stream <bundle.js> [messages] [ticks]");
  process.exit(2);
}
const stream = mode === "stream";
const messages = Number(messagesArgument ?? (stream ? 200 : 1000));
const ticks = Number(ticksArgument ?? 200);
const source = readFileSync(bundle, "utf8");

const collections = [];
new PerformanceObserver((list) => collections.push(...list.getEntries())).observe({ entryTypes: ["gc"] });
/** Lets the observer deliver what it has. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
const ns = (milliseconds) => Math.round(milliseconds * 1e6);
const line = (name, value) => console.log(name, Math.round(value));
/** Collections that started in [from, to): major ones, minor ones and their time. */
function collected(prefix, from, to) {
  const inside = collections.filter((entry) => entry.startTime >= from && entry.startTime < to);
  const major = inside.filter((entry) => entry.detail.kind !== 1);
  line(prefix + "_full_collections", major.length);
  line(prefix + "_young_collections", inside.length - major.length);
  line(prefix + "_gc_ns", ns(inside.reduce((sum, entry) => sum + entry.duration, 0)));
}

const start = performance.now();
const script = new vm.Script(source, { filename: "bundle.js" });
const parsed = performance.now();
script.runInThisContext();
const evaluated = performance.now();
const nodes = reactBench.mount(messages);
const mounted = performance.now();
await settle();
line("compile_ns", ns(parsed - start));
line("evaluate_ns", ns(evaluated - parsed));
line("mount_ns", ns(mounted - evaluated));
line("nodes", nodes);
collected("mount", start, mounted);
line("mount_used_bytes", process.memoryUsage().heapUsed);
line("mount_resident_bytes", process.memoryUsage().rss);
if (stream) {
  for (let index = 0; index < 20; index++) reactBench.tick(" warm");
  const before = performance.now();
  for (let index = 0; index < ticks; index++) reactBench.tick(" word");
  const after = performance.now();
  await settle();
  line("stream_ns", ns(after - before));
  line("stream_ticks", ticks);
  collected("stream", before, after);
  line("stream_used_bytes", process.memoryUsage().heapUsed);
}
globalThis.gc();
line("retained_used_bytes", process.memoryUsage().heapUsed);
line("retained_resident_bytes", process.memoryUsage().rss);
reactBench.unmount();
globalThis.gc();
line("unmounted_used_bytes", process.memoryUsage().heapUsed);
line("unmounted_resident_bytes", process.memoryUsage().rss);
line("peak_resident_bytes", process.resourceUsage().maxRSS * 1024);
