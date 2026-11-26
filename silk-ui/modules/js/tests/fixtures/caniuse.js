// The checks behind the `javascript` and `javascript-apis` answers of the docs' Can I use
// page (docs/caniuse/support). Each feature, by its caniuse id, has a check that returns (or
// resolves to) true when the feature does what the page says works, and the runtimes it is
// expected to pass in: `engine` is the default runtime of a Silk UI app (the SilkJS Engine
// with the ui-js globals and @silkui/core), `node` the one `App.runtime(Runtime.node())` picks.
// A check that throws counts as false. When a missing feature starts to pass, the test fails
// until the page's answer is corrected.
//
// modules/js/tests/src/caniuse.silk runs this in the engine; modules/js/node/scripts/check
// runs it in the node runtime.
import * as ui from "@silkui/core";

const node = typeof process === "object" && process !== null && typeof process.exit === "function";
const checks = [];

/** `expected` is true (passes in both runtimes), false (in neither) or { engine, node }. */
function check(id, expected, run) {
  const both = typeof expected === "boolean";
  checks.push({ id, engine: both ? expected : expected.engine, node: both ? expected : expected.node, run });
}

const syntax = (source) => (0, eval)(source);
const global = (name) => typeof globalThis[name] === "function" || (typeof globalThis[name] === "object" && globalThis[name] !== null);
const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const NODE = { engine: false, node: true };
// The UI layer (web_apis.js) that the node runtime does not load yet.
const ENGINE = { engine: true, node: false };

// The language.

check("array-find", true, () => [1, 5, 9].find((x) => x > 2) === 5);
check("array-find-index", true, () => [1, 5, 9].findIndex((x) => x > 2) === 1);
check("array-flat", true, () => [1, [2, [3]]].flat(Infinity).join() === "1,2,3" && [1, 2].flatMap((x) => [x, x]).join() === "1,1,2,2");
check("array-includes", true, () => [1, NaN].includes(NaN) && !["a"].includes("b"));
check("arrow-functions", true, () => {
  const box = { value: 7, get() { return (() => this.value)(); } };
  return box.get() === 7 && ((a, b) => a + b)(1, 2) === 3;
});
check("asmjs", true, () => {
  const module = syntax("(function (stdlib) { 'use asm'; var imul = stdlib.Math.imul; function f(x) { x = x | 0; return imul(x, 3) | 0; } return { f: f }; })");
  return module(globalThis).f(5) === 15;
});
check("async-functions", true, async () => {
  const twice = async (x) => (await Promise.resolve(x)) * 2;
  return (await twice(21)) === 42;
});
check("bigint", true, () => 2n ** 64n === 18446744073709551616n && BigInt.asUintN(8, 257n) === 1n && typeof 1n === "bigint");
check("const", true, () => {
  const a = 1;
  { const a = 2; if (a !== 2) return false; }
  try { syntax("(() => { const b = 1; b = 2; })()"); return false; } catch (error) { return error instanceof TypeError && a === 1; }
});
check("date-tolocaledatestring", true, () => typeof new Date(0).toLocaleDateString() === "string");
check("date-tolocaledatestring", true, () => new Date(Date.UTC(2020, 0, 15, 12)).toLocaleDateString("de-DE", { year: "numeric", month: "long", timeZone: "UTC" }) === "Januar 2020");
check("decorators", false, () => syntax("(() => { const tag = (value, context) => { context.addInitializer(function () { this.tagged = true; }); }; @tag class A {} return true; })()"));
check("es5", true, () => {
  "use strict";
  const bound = function () { return this.x; }.bind({ x: 3 });
  const object = Object.create(null, { y: { value: 4, enumerable: true } });
  return bound() === 3 && Object.keys(object).join() === "y" && [1, 2, 3].filter((x) => x > 1).reduce((a, b) => a + b) === 5 &&
    " a ".trim() === "a" && Array.isArray([]) && JSON.parse("[1]")[0] === 1 && Object.isFrozen(Object.freeze({})) && Date.now() > 0;
});
check("es6", true, () => {
  const [a, , b = 3, ...rest] = [1, 2, undefined, 4, 5];
  const { x, ...others } = { x: 1, y: 2 };
  const map = new Map([[1, "one"]]);
  const set = new Set([1, 1, 2]);
  const weak = new WeakMap([[map, 1]]);
  const symbol = Symbol("s");
  const iterable = { *[Symbol.iterator]() { yield 1; yield 2; } };
  return a === 1 && b === 3 && rest.join() === "4,5" && x === 1 && others.y === 2 && map.get(1) === "one" && set.size === 2 &&
    weak.get(map) === 1 && typeof symbol === "symbol" && [...iterable].join() === "1,2" && Reflect.ownKeys({ [symbol]: 1 }).length === 1 &&
    Object.assign({}, { z: 1 }).z === 1 && Array.from("ab").join() === "a,b" && "x".repeat(3) === "xxx" && Number.isInteger(5) &&
    `${a}` === "1" && (function (p = 2) { return p; })() === 2 && Math.trunc(-1.5) === -1 && 0o17 === 15 && 0b11 === 3;
});
check("es6-class", true, () => {
  class Base { #secret = 1; static made = 0; constructor() { Base.made++; } get secret() { return this.#secret; } }
  class Derived extends Base { constructor() { super(); this.own = 2; } }
  const value = new Derived();
  return value.secret === 1 && value.own === 2 && Base.made === 1 && value instanceof Base;
});
check("es6-generators", true, () => {
  function* count(limit) { for (let i = 0; i < limit; i++) { const sent = yield i; if (sent) return sent; } }
  const iterator = count(5);
  return iterator.next().value === 0 && iterator.next().value === 1 && iterator.next("stop").value === "stop" && iterator.next().done;
});
// This file is a module: its import of @silkui/core ran.
check("es6-module", true, () => typeof ui.createBox === "function" && typeof import.meta === "object");
check("es6-module-dynamic-import", true, async () => (await import("@silkui/core")).createBox === ui.createBox);
check("es6-number", true, () => Number.EPSILON > 0 && Number.MAX_SAFE_INTEGER === 2 ** 53 - 1 && Number.isNaN(NaN) && !Number.isFinite(Infinity) &&
  Number.isSafeInteger(3) && Number.parseFloat("1.5") === 1.5);
check("es6-string-includes", true, () => "Hello wide world".includes("wide") && !"abc".includes("d"));
check("internationalization", true, () => new Intl.NumberFormat("de-DE").format(1234.5) === "1.234,5" &&
  new Intl.Collator("de").compare("ä", "z") < 0 && new Intl.DateTimeFormat("en-US", { timeZone: "UTC" }).format(new Date(0)) === "1/1/1970");
check("intl-pluralrules", true, () => new Intl.PluralRules("en-US").select(1) === "one" && new Intl.PluralRules("en-US", { type: "ordinal" }).select(2) === "two");
check("js-regexp-lookbehind", true, () => /(?<=\$)\d+/.exec("cost $42")[0] === "42" && /(?<!\$)\b\d+/.exec("$4 7")[0] === "7");
check("json", true, () => JSON.stringify({ a: [1, "x", null] }) === '{"a":[1,"x",null]}' && JSON.parse('{"b":{"c":true}}').b.c === true);
check("let", true, () => {
  const seen = [];
  for (let i = 0; i < 3; i++) seen.push(() => i);
  return seen.map((f) => f()).join() === "0,1,2";
});
check("localecompare", true, () => "a".localeCompare("b") < 0 && "b".localeCompare("a") > 0 && "a".localeCompare("a") === 0);
check("localecompare", true, () => "ä".localeCompare("z", "de") < 0 && "a".localeCompare("A", "en", { sensitivity: "base" }) === 0);
check("object-entries", true, () => Object.entries({ a: 1, b: 2 }).map(([k, v]) => k + v).join() === "a1,b2");
check("object-observe", false, () => typeof Object.observe === "function");
check("object-values", true, () => Object.values({ a: 1, b: 2 }).join() === "1,2");
check("pad-start-end", true, () => "5".padStart(3, "0") === "005" && "ab".padEnd(4, "-") === "ab--");
check("promise-finally", true, async () => {
  let ran = 0;
  const value = await Promise.resolve(3).finally(() => ran++);
  const reason = await Promise.reject(new Error("x")).finally(() => ran++).catch((error) => error.message);
  return value === 3 && reason === "x" && ran === 2;
});
check("promises", true, async () => {
  const all = await Promise.all([1, Promise.resolve(2)]);
  const settled = await Promise.allSettled([Promise.reject(1)]);
  const first = await Promise.race([later(50).then(() => "slow"), Promise.resolve("fast")]);
  const any = await Promise.any([Promise.reject(1), Promise.resolve(2)]);
  return all.join() === "1,2" && settled[0].status === "rejected" && first === "fast" && any === 2;
});
check("proxy", true, () => {
  const logged = [];
  const proxy = new Proxy({ a: 1 }, { get(target, key, receiver) { logged.push(key); return Reflect.get(target, key, receiver) * 10; } });
  return proxy.a === 10 && logged.join() === "a";
});
check("rest-parameters", true, () => ((first, ...others) => others.length * 10 + first)(1, 2, 3) === 21);
check("sharedarraybuffer", true, () => {
  const shared = new SharedArrayBuffer(16);
  const view = new Int32Array(shared);
  Atomics.add(view, 0, 5);
  return Atomics.load(view, 0) === 5 && Atomics.notify(view, 1) === 0;
});
// As on a browser's main thread, the engine's UI thread cannot block.
check("sharedarraybuffer", NODE, () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 1, 0) === "not-equal");
check("template-literals", true, () => {
  const tag = (strings, ...values) => strings.raw.join("|") + values.join();
  return `1 + 1 = ${1 + 1}` === "1 + 1 = 2" && tag`a${1}b\n` === "a|b\\n1" && `line
two`.includes("\n");
});
check("temporal", false, () => typeof Temporal === "object" && Temporal.PlainDate.from("2020-01-15").add({ days: 20 }).toString() === "2020-02-04");
check("typedarrays", true, () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const view = new DataView(bytes.buffer);
  return new Float64Array(2).byteLength === 16 && view.getUint16(0) === 0x0102 && bytes.subarray(2).join() === "3,4" &&
    new Uint8ClampedArray([300])[0] === 255 && new BigInt64Array(1).length === 1;
});
check("unhandledrejection", true, () => new Promise((resolve) => {
  const reason = new Error("caniuse");
  const listener = (event) => {
    if (event.reason !== reason) return;
    event.preventDefault();
    globalThis.removeEventListener("unhandledrejection", listener);
    resolve(event instanceof PromiseRejectionEvent && event.promise instanceof Promise);
  };
  globalThis.addEventListener("unhandledrejection", listener);
  Promise.reject(reason);
}));
check("use-strict", true, () => {
  try { syntax("'use strict'; undeclaredName = 1"); return false; } catch (error) { if (!(error instanceof ReferenceError)) return false; }
  return (function () { "use strict"; return this; })() === undefined;
});

// The APIs.

check("abortcontroller", true, () => {
  const controller = new AbortController();
  let fired = false;
  controller.signal.addEventListener("abort", () => (fired = true));
  const box = ui.createBox();
  let heard = 0;
  box.addEventListener("focus", () => heard++, { signal: controller.signal });
  controller.abort();
  box.dispatchEvent(new Event("focus"));
  const either = AbortSignal.any([new AbortController().signal, AbortSignal.abort("why")]);
  return controller.signal.aborted && fired && heard === 0 && either.aborted && either.reason === "why" && AbortSignal.timeout(10) instanceof AbortSignal;
});
check("accelerometer", false, () => global("Accelerometer"));
check("ambient-light", false, () => global("AmbientLightSensor"));
check("async-clipboard", true, () => typeof navigator.clipboard.readText === "function" && typeof navigator.clipboard.writeText === "function");
check("async-clipboard", true, async () => {
  const item = new ClipboardItem({ "text/html": "<b>Silk</b>", "image/png": new Blob([new Uint8Array([137, 80])], { type: "image/png" }) });
  return typeof navigator.clipboard.read === "function" && typeof navigator.clipboard.write === "function"
    && ClipboardItem.supports("text/html") && ClipboardItem.supports("image/png") && !ClipboardItem.supports("text/rtf")
    && item.types.join() === "text/html,image/png" && (await (await item.getType("text/html")).text()) === "<b>Silk</b>";
});
check("atob-btoa", true, () => btoa("Silk UI") === "U2lsayBVSQ==" && atob("U2lsayBVSQ==") === "Silk UI");
check("audio-api", false, () => global("AudioContext"));
// Nodes take listeners of any type, but the tree never sends these.
check("auxclick", false, () => "onauxclick" in ui.createBox());
check("battery-status", ENGINE, () => typeof navigator.getBattery === "function" && navigator.getBattery() instanceof Promise);
check("blobbuilder", true, async () => {
  const blob = new Blob(["Silk", new Uint8Array([32, 85, 73])], { type: "text/plain" });
  return blob.size === 7 && blob.type === "text/plain" && (await blob.text()) === "Silk UI" && (await blob.slice(5).arrayBuffer()).byteLength === 2;
});
check("bloburls", NODE, () => {
  const url = URL.createObjectURL(new Blob(["x"]));
  URL.revokeObjectURL(url);
  return url.startsWith("blob:");
});
check("broadcastchannel", NODE, () => {
  const channel = new BroadcastChannel("caniuse");
  channel.close();
  return channel.name === "caniuse";
});
check("channel-messaging", NODE, () => new Promise((resolve) => {
  const { port1, port2 } = new MessageChannel();
  port2.onmessage = (event) => { port1.close(); port2.close(); resolve(event.data.n === 2); };
  port1.postMessage({ n: 2 });
}));
check("clipboard", true, () => {
  const data = new DataTransfer();
  data.setData("text/plain", "x");
  const event = new ClipboardEvent("copy", { clipboardData: data });
  let heard = null;
  const node = ui.createBox();
  node.addEventListener("copy", (copy) => (heard = copy.clipboardData.getData("text")));
  node.dispatchEvent(event);
  return event instanceof ClipboardEvent && heard === "x";
});
check("console-basic", true, () => ["log", "info", "warn", "error", "debug"].every((name) => typeof console[name] === "function"));
check("console-time", true, () => typeof console.time === "function" && typeof console.timeEnd === "function" && typeof console.timeLog === "function");
check("constraint-validation", true, () => {
  const input = ui.createInput();
  input.required = true;
  if (input.checkValidity() !== false || !input.validity.valueMissing) return false;
  input.value = "ok";
  if (input.checkValidity() !== true || !input.validity.valid) return false;
  input.setCustomValidity("bad");
  return input.checkValidity() === false && input.validity.customError && input.validationMessage === "bad";
});
check("createimagebitmap", false, () => typeof globalThis.createImageBitmap === "function");
check("credential-management", false, () => typeof navigator.credentials === "object");
check("cryptography", NODE, async () => {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("abc")));
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt", "decrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const sealed = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new Uint8Array([1, 2, 3]));
  const opened = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, sealed));
  return digest[0] === 0xba && digest[31] === 0xad && opened.join() === "1,2,3";
});
check("css-supports-api", true, () => typeof CSS === "object" && typeof CSS.supports === "function");
check("customevent", true, () => new CustomEvent("ping", { detail: 3 }).detail === 3);
check("customevent", true, () => {
  const outer = ui.createBox();
  const inner = ui.createBox();
  outer.append(inner);
  let detail = 0;
  outer.addEventListener("ping", (event) => { detail = event.target === inner ? event.detail : -1; });
  inner.dispatchEvent(new CustomEvent("ping", { detail: 3, bubbles: true }));
  const target = new EventTarget();
  let heard = false;
  target.addEventListener("ping", () => { heard = true; });
  target.dispatchEvent(new Event("ping"));
  return detail === 3 && heard;
});
check("deviceorientation", false, () => global("DeviceOrientationEvent"));
check("dom-range", true, () => {
  const box = ui.createBox(null, ui.createText("Hello world"));
  const range = new Range();
  range.setStart(box.firstChild, 2);
  range.setEnd(box.firstChild, 7);
  box.firstChild.insertData(0, ">");
  const moved = range.startOffset === 3 && range.toString() === "llo w";
  const fragment = range.extractContents();
  return moved && fragment.firstChild.data === "llo w" && box.firstChild.data === ">Heorld" && range.collapsed;
});
check("element-scroll-methods", true, () => typeof ui.createBox().scrollTo === "function");
check("element-scroll-methods", true, () => typeof ui.createBox().scroll === "function");
check("element-scroll-methods", true, () => typeof ui.createBox().scrollBy === "function");
check("eme", false, () => typeof navigator.requestMediaKeySystemAccess === "function");
check("eventsource", false, () => global("EventSource"));
check("fetch", NODE, () => typeof fetch === "function" && new Request("http://localhost/x", { method: "POST" }).method === "POST" &&
  new Headers({ a: "1" }).get("a") === "1" && new Response("ok").status === 200);
check("fileapi", true, async () => {
  const file = new File(["Silk"], "a.txt", { type: "text/plain" });
  return file.name === "a.txt" && (await file.text()) === "Silk";
});
// A file dropped on a window arrives as a File-like DroppedFile: a path and a name.
check("fileapi", true, () => new ui.DataTransfer(["/tmp/a.txt"]).files[0].name === "a.txt");
check("filereader", NODE, () => global("FileReader"));
check("filereadersync", false, () => global("FileReaderSync"));
check("gamepad", false, () => typeof navigator.getGamepads === "function");
check("geolocation", false, () => typeof navigator.geolocation === "object");
check("getboundingclientrect", true, () => typeof ui.createBox().getBoundingClientRect === "function");
check("getrandomvalues", true, () => {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return bytes.some((byte) => byte !== 0) && typeof crypto.randomUUID() === "string";
});
check("gyroscope", false, () => global("Gyroscope"));
check("hardwareconcurrency", true, () => navigator.hardwareConcurrency >= 1);
check("high-resolution-time", true, () => {
  const start = performance.now();
  return typeof start === "number" && performance.now() >= start;
});
check("high-resolution-time", true, () => typeof performance.timeOrigin === "number" && performance.timeOrigin > 0);
check("imagecapture", false, () => global("ImageCapture"));
check("ime", false, () => typeof ui.createInput().inputMethodContext === "object");
check("indexeddb", false, () => global("indexedDB"));
check("indexeddb2", false, () => global("indexedDB"));
check("input-file-directory", false, () => typeof globalThis.showDirectoryPicker === "function");
check("input-selection", true, () => {
  const field = ui.createInput();
  field.value = "a\u{1F600}\u00e9b";
  field.setSelectionRange(1, 4, "backward");
  if (field.selectionStart !== 1 || field.selectionEnd !== 4 || field.selectionDirection !== "backward") return false;
  field.setRangeText("XY", 1, 3, "select");
  if (field.value !== "aXY\u00e9b" || field.selectionEnd !== 3) return false;
  field.select();
  return field.selectionStart === 0 && field.selectionEnd === 5;
});
check("intersectionobserver", true, () => global("IntersectionObserver"));
check("intersectionobserver-v2", true, () => global("IntersectionObserver"));
check("magnetometer", false, () => global("Magnetometer"));
check("matchesselector", true, () => ["matches", "webkitMatchesSelector", "closest", "querySelector", "querySelectorAll"].every((name) => typeof ui.createBox()[name] === "function"));
check("matchmedia", true, () => typeof globalThis.matchMedia === "function" && typeof matchMedia("(min-width: 1px)").matches === "boolean");
// The tree's inputs have no length limit attribute: setting one throws.
check("maxlength", false, () => { ui.createInput().setAttribute("maxLength", 3); return true; });
check("mediacapture-fromelement", false, () => typeof ui.createNode("canvas").captureStream === "function");
check("mediarecorder", false, () => global("MediaRecorder"));
check("mediasource", false, () => global("MediaSource"));
check("midi", false, () => typeof navigator.requestMIDIAccess === "function");
check("mutationobserver", false, () => global("MutationObserver"));
check("namevalue-storage", false, () => global("localStorage") || global("sessionStorage"));
check("native-filesystem-api", false, () => typeof globalThis.showOpenFilePicker === "function");
check("netinfo", false, () => typeof navigator.connection === "object");
check("silkui-memory-usage", true, () => {
  const usage = ui.memoryUsage();
  return usage !== null && usage.footprint > 0 && usage.processes === 1;
});
check("silkui-frame-stats", true, () => {
  const stats = ui.frameStats();
  return stats !== null && typeof stats.fps === "number" && typeof stats.p95 === "number";
});
check("notifications", true, () => Notification === ui.Notification && Notification.permission === "granted" &&
  typeof Notification.requestPermission === "function");
check("objectrtc", false, () => global("RTCIceGatherer"));
check("online-status", false, () => typeof navigator.onLine === "boolean");
check("orientation-sensor", false, () => global("AbsoluteOrientationSensor"));
check("pagevisibility", false, () => typeof globalThis.document?.visibilityState === "string");
check("passkeys", false, () => global("PublicKeyCredential"));
check("permissions-api", false, () => typeof navigator.permissions === "object");
check("picture-in-picture", false, () => typeof globalThis.documentPictureInPicture === "object");
check("pointerlock", false, () => typeof ui.createBox().requestPointerLock === "function");
check("proximity", false, () => global("ProximitySensor"));
// The node runtime's check runs with no window, so no frame comes there.
check("requestanimationframe", true, () => node ? typeof requestAnimationFrame === "function" : new Promise((resolve) => {
  const id = requestAnimationFrame((time) => resolve(typeof time === "number"));
  if (typeof id !== "number") resolve(false);
}));
check("requestidlecallback", true, () => new Promise((resolve) => requestIdleCallback((deadline) => resolve(deadline.timeRemaining() > 0 && deadline.didTimeout === false))));
check("resizeobserver", true, () => global("ResizeObserver"));
check("rtcpeerconnection", false, () => global("RTCPeerConnection"));
check("screen-orientation", false, () => typeof globalThis.screen?.orientation === "object");
check("scrollintoview", true, () => typeof ui.createBox().scrollIntoView === "function");
check("scrollintoviewifneeded", true, () => typeof ui.createBox().scrollIntoViewIfNeeded === "function");
check("selection-api", true, () => typeof globalThis.getSelection === "function" && getSelection() === ui.getSelection() && typeof Selection === "function");
check("setimmediate", true, () => new Promise((resolve) => setImmediate((value) => resolve(value === 5), 5)));
check("speech-recognition", false, () => global("SpeechRecognition") || global("webkitSpeechRecognition"));
check("speech-synthesis", false, () => typeof globalThis.speechSynthesis === "object");
check("stream", false, () => typeof navigator.mediaDevices?.getUserMedia === "function");
check("streams", NODE, async () => {
  const stream = new ReadableStream({ start(controller) { controller.enqueue("a"); controller.enqueue("b"); controller.close(); } });
  const upper = stream.pipeThrough(new TransformStream({ transform(chunk, controller) { controller.enqueue(chunk.toUpperCase()); } }));
  const seen = [];
  await upper.pipeTo(new WritableStream({ write(chunk) { seen.push(chunk); } }));
  return seen.join() === "A,B";
});
check("textencoder", true, () => {
  const bytes = new TextEncoder().encode("Silk ✓");
  return bytes.length === 8 && new TextDecoder().decode(bytes) === "Silk ✓" && new TextDecoder("utf-16le").decode(new Uint8Array([65, 0])) === "A";
});
check("touch", true, () => {
  const box = ui.createBox();
  let seen = null;
  box.addEventListener("touchstart", (event) => { seen = event; });
  const finger = 2 * 256 + 2 * 16 + 64;
  globalThis.__ui.dispatch(30, box.nodeId, 5, 6, finger, 1, 0);
  globalThis.__ui.dispatch(32, box.nodeId, 5, 6, finger, 1, 0);
  return seen !== null && seen.cancelable && seen.touches.length === 1 && seen.changedTouches.item(0).identifier === 2
    && seen.targetTouches[0].target === box && seen.changedTouches[0].clientY === 6;
});
check("url", NODE, () => {
  const url = new URL("../b?x=1#top", "https://example.com/a/c");
  return url.href === "https://example.com/b?x=1#top" && url.hostname === "example.com" && url.searchParams.get("x") === "1";
});
check("urlsearchparams", NODE, () => {
  const params = new URLSearchParams("a=1&b=2&a=3");
  params.append("c", "x y");
  return params.getAll("a").join() === "1,3" && params.toString() === "a=1&b=2&a=3&c=x+y";
});
check("user-timing", true, () => {
  performance.mark("caniuse-start");
  performance.mark("caniuse-end");
  const measure = performance.measure("caniuse", "caniuse-start", "caniuse-end");
  return measure.name === "caniuse" && performance.getEntriesByName("caniuse-start").length === 1;
});
check("vibration", false, () => typeof navigator.vibrate === "function");
check("wake-lock", false, () => typeof navigator.wakeLock === "object");
check("web-animation", false, () => typeof ui.createBox().animate === "function");
check("web-bluetooth", false, () => typeof navigator.bluetooth === "object");
check("web-serial", false, () => typeof navigator.serial === "object");
check("web-share", false, () => typeof navigator.share === "function");
check("webcodecs", false, () => global("VideoDecoder"));
check("webgpu", false, () => typeof navigator.gpu === "object");
check("webhid", false, () => typeof navigator.hid === "object");
check("webnfc", false, () => global("NDEFReader"));
check("websockets", NODE, () => typeof WebSocket === "function" && WebSocket.OPEN === 1);
check("webtransport", false, () => global("WebTransport"));
check("webusb", false, () => typeof navigator.usb === "object");
check("webworkers", false, () => global("Worker"));
check("webxr", false, () => typeof navigator.xr === "object");
check("xhr2", false, () => global("XMLHttpRequest"));

// A check still waiting after a second of the runtime's clock failed.
async function outcome(entry) {
  try {
    return (await Promise.race([entry.run(), later(1000).then(() => false)])) === true;
  } catch {
    return false;
  }
}

const results = Promise.all(checks.map(async (entry) => {
  const expected = node ? entry.node : entry.engine;
  const passed = await outcome(entry);
  return passed === expected ? null : entry.id + (expected ? ": the page says this works, and the check failed" : ": the page says this is missing, and the check passed");
}));

let report = null;
results.then((lines) => { report = lines.filter(Boolean); });

function finish() {
  if (report === null) throw new Error("the Can I use checks did not settle");
  if (report.length) throw new Error(report.length + " Can I use checks disagree with the page (" + (node ? "node" : "engine") + " runtime):\n" + report.join("\n"));
}

if (node) {
  results.then(() => {
    try {
      finish();
      console.log(checks.length + " Can I use checks agree with the page (node runtime)");
      process.exit(0);
    } catch (error) {
      console.error(error.message);
      process.exit(1);
    }
  });
} else {
  globalThis.caniuseFinish = finish;
}
