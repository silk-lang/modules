// The web globals a ui-js realm starts with, on top of the engine's ECMAScript: timers,
// animation frames, a console, queueMicrotask, performance.now, reportError and
// navigator.clipboard, and stand-ins that load the rest (web_apis.js) when first used.
// The host evaluates this once, before any application code. Edit it, then run
// `silk task embed-assets` to regenerate generated_prelude.silk.
(function () {
  const native = globalThis.__ui;
  const timers = new Map();
  let nextTimer = 0;

  function start(callback, delay, repeat, args) {
    if (typeof callback !== "function") throw new TypeError("a timer needs a function");
    const id = ++nextTimer;
    delay = Math.max(0, Number(delay) || 0);
    timers.set(id, { callback, delay, repeat, args });
    native.timer(id, delay);
    return id;
  }

  globalThis.setTimeout = (callback, delay, ...args) => start(callback, delay, false, args);
  globalThis.setInterval = (callback, delay, ...args) => start(callback, delay, true, args);
  globalThis.clearTimeout = globalThis.clearInterval = (id) => {
    if (timers.delete(id)) native.cancelTimer(id);
  };

  // The host calls this when timer `id` is due.
  native.fire = function (id) {
    const timer = timers.get(id);
    if (!timer) return;
    if (timer.repeat) native.timer(id, timer.delay);
    else timers.delete(id);
    timer.callback(...timer.args);
  };

  let frames = new Map();
  let nextFrame = 0;

  globalThis.requestAnimationFrame = (callback) => {
    const id = ++nextFrame;
    frames.set(id, callback);
    native.requestFrame();
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };

  // The host calls this before a frame, with the time in milliseconds. Callbacks requested
  // while it runs wait for the next frame, as on the web.
  native.frame = function (time) {
    const due = frames;
    frames = new Map();
    let failure = null;
    for (const callback of due.values()) {
      try {
        callback(time);
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure) throw failure.error;
  };

  globalThis.queueMicrotask = (callback) => {
    if (typeof callback !== "function") throw new TypeError("queueMicrotask needs a function");
    Promise.resolve().then(callback);
  };

  // `timeOrigin` is wall-clock time when `now()` read 0, as on the web.
  globalThis.performance = { timeOrigin: Date.now() - native.now(), now: () => native.now() };



  function show(value, depth) {
    if (typeof value === "string") return depth === 0 ? value : JSON.stringify(value);
    if (typeof value === "function") return "[Function " + (value.name || "anonymous") + "]";
    if (typeof value !== "object" || value === null) return String(value);
    if (value instanceof Error) return value.stack ? String(value) + "\n" + value.stack : String(value);
    if (depth > 2) return Array.isArray(value) ? "[Array]" : "[Object]";
    if (Array.isArray(value)) return "[" + value.map((item) => show(item, depth + 1)).join(", ") + "]";
    const parts = Object.keys(value).map((key) => key + ": " + show(value[key], depth + 1));
    return parts.length ? "{ " + parts.join(", ") + " }" : "{}";
  }

  // Lines inside `console.group` are indented two spaces a level.
  const shared = { groups: 0, show, log: null };
  const log = (shared.log = (level) => (...values) => native.log(level, "  ".repeat(shared.groups) + values.map((value) => show(value, 0)).join(" ")));
  globalThis.console = {
    debug: log(0),
    log: log(1),
    info: log(1),
    warn: log(2),
    error: log(3),
    trace: log(1),
    assert(condition, ...values) {
      if (!condition) native.log(3, "Assertion failed" + (values.length ? ": " + values.map((value) => show(value, 0)).join(" ") : ""));
    },
  };

  // The rest of the web APIs (web_apis.js) are evaluated on their first use: parsing them
  // in every realm would make every app start slower.
  let web = null;
  const api = () => (web ??= (0, eval)(native.webApis())(native, shared));
  const forward = (object, part, names) => {
    for (const name of names) object[name] = (...args) => api()[part][name](...args);
  };
  forward(globalThis.console, "console", ["dir", "table", "group", "groupCollapsed", "groupEnd", "time", "timeLog", "timeEnd", "count", "countReset"]);
  forward(globalThis.performance, "performance", ["mark", "measure", "getEntries", "getEntriesByName", "getEntriesByType", "clearMarks", "clearMeasures"]);
  globalThis.performance.toJSON = () => ({ timeOrigin: globalThis.performance.timeOrigin });
  const own = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  for (const name of ["Blob", "File", "FormData", "SubmitEvent", "FormDataEvent", "setImmediate", "clearImmediate", "requestIdleCallback", "cancelIdleCallback", "atob", "btoa", "TextEncoder", "TextDecoder", "crypto", "Event", "CustomEvent", "PromiseRejectionEvent", "EventTarget", "MediaQueryList", "MediaQueryListEvent", "AbortController", "AbortSignal", "BatteryManager"]) {
    Object.defineProperty(globalThis, name, {
      get: () => {
        const value = api()[name];
        own(name, value);
        return value;
      },
      set: (value) => own(name, value),
      configurable: true,
    });
  }

  globalThis.reportError = (error) => native.log(3, "Uncaught " + show(error, 0));

  // `devicePixelRatio` and `matchMedia` answer for the window's last frame; the host calls
  // `native.media` when that changes, for the lists' `change` events.
  Object.defineProperty(globalThis, "devicePixelRatio", { get: () => native.scale(), set: (value) => own("devicePixelRatio", value), configurable: true });
  globalThis.matchMedia = (query) => api().matchMedia(query);
  native.media = () => web?.mediaChanged();

  // The global object as an event target, for `unhandledrejection`, the one event a realm
  // sends it. The host asks `native.rejected` before it reports a rejection nothing handled.
  let windowTarget = null;
  const target = () => (windowTarget ??= new globalThis.EventTarget());
  globalThis.addEventListener = (...args) => target().addEventListener(...args);
  globalThis.removeEventListener = (...args) => windowTarget?.removeEventListener(...args);
  globalThis.dispatchEvent = (event) => target().dispatchEvent(event);
  native.rejected = (promise, reason) =>
    windowTarget !== null && !windowTarget.dispatchEvent(new globalThis.PromiseRejectionEvent("unhandledrejection", { promise, reason, cancelable: true }));

  // Silk functions on a background thread: `fn.async(...)` of a `.silk` import. The host runs
  // the call on a thread and settles the promise once it ends: kind 0 is a value, 1 a
  // TypeError and 2 an Error.
  const nativeCalls = new Map();
  let nextNativeCall = 0;
  const startNative = native.nativeStart;
  native.nativeStart = (id, ...args) => new Promise((resolve, reject) => {
    const call = ++nextNativeCall;
    nativeCalls.set(call, { resolve, reject });
    startNative(call, id, ...args);
  });
  native.nativeDone = function (call, kind, value) {
    const pending = nativeCalls.get(call);
    if (!pending) return;
    nativeCalls.delete(call);
    if (kind === 0) pending.resolve(value);
    else pending.reject(kind === 1 ? new TypeError(value) : new Error(value));
  };

  // As `navigator.clipboard` and `ClipboardItem` in a browser (clipboard.js, evaluated on
  // first use).
  let clipboardApi = null;
  const clip = () => (clipboardApi ??= (0, eval)(native.clipboardApi())(native));
  const clipboard = {};
  for (const name of ["readText", "writeText", "read", "write"]) clipboard[name] = (...args) => clip().clipboard[name](...args);
  Object.defineProperty(globalThis, "ClipboardItem", {
    get: () => {
      const value = clip().ClipboardItem;
      Object.defineProperty(globalThis, "ClipboardItem", { value, writable: true, configurable: true });
      return value;
    },
    set: (value) => Object.defineProperty(globalThis, "ClipboardItem", { value, writable: true, configurable: true }),
    configurable: true,
  });
  if (typeof globalThis.navigator !== "object" || globalThis.navigator === null) globalThis.navigator = {};
  Object.defineProperty(globalThis.navigator, "clipboard", { value: clipboard, enumerable: true, configurable: true });
  Object.defineProperty(globalThis.navigator, "hardwareConcurrency", { value: native.cpus(), enumerable: true, configurable: true });
  Object.defineProperty(globalThis.navigator, "getBattery", { value: () => api().getBattery(), writable: true, configurable: true });

  // WebGPU (webgpu.js, evaluated on first use): `navigator.gpu` and the GPU globals, in a host
  // that runs WebGPU commands. A canvas node gets its "webgpu" context from `native.gpuLoad`.
  let gpuApi = null;
  const gpu = (native.gpuLoad = () => (native.gpuEnabled() ? (gpuApi ??= (0, eval)(native.gpuApi())(native)) : null));
  Object.defineProperty(globalThis.navigator, "gpu", { get: () => gpu()?.gpu, enumerable: true, configurable: true });
  for (const name of ["GPU", "GPUAdapter", "GPUAdapterInfo", "GPUDevice", "GPUQueue", "GPUBuffer", "GPUTexture", "GPUTextureView", "GPUSampler", "GPUBindGroupLayout", "GPUPipelineLayout", "GPUBindGroup", "GPUShaderModule", "GPUCompilationInfo", "GPURenderPipeline", "GPUComputePipeline", "GPUCommandEncoder", "GPUCommandBuffer", "GPURenderPassEncoder", "GPUComputePassEncoder", "GPUCanvasContext", "GPUSupportedFeatures", "GPUSupportedLimits", "GPUDeviceLostInfo", "GPUError", "GPUValidationError", "GPUOutOfMemoryError", "GPUInternalError", "GPUPipelineError", "GPUUncapturedErrorEvent", "GPURenderBundleEncoder", "GPURenderBundle", "GPUQuerySet", "GPUExternalTexture", "GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage", "GPUMapMode", "GPUColorWrite"]) {
    Object.defineProperty(globalThis, name, {
      get: () => {
        const value = gpu()?.globals[name];
        if (value !== undefined) own(name, value);
        return value;
      },
      set: (value) => own(name, value),
      configurable: true,
    });
  }

  // Canvas 2D (canvas2d.js, evaluated on first use) in a host that shows canvases: a canvas node
  // gets its "2d" context from `native.canvas2dLoad`.
  let canvas2dApi = null;
  const canvas2d = (native.canvas2dLoad = () => (native.canvas2dEnabled() ? (canvas2dApi ??= (0, eval)(native.canvas2dApi())(native)) : null));
  for (const name of ["CanvasRenderingContext2D", "Path2D", "ImageData", "TextMetrics", "CanvasGradient", "CanvasPattern"]) {
    if (name in globalThis) continue;
    Object.defineProperty(globalThis, name, {
      get: () => {
        const value = canvas2d()?.globals[name];
        if (value !== undefined) own(name, value);
        return value;
      },
      set: (value) => own(name, value),
      configurable: true,
    });
  }

  // As `window.open` in a browser, for an address outside the application: the host opens
  // it with the system's browser or mail program. Only http, https and mailto addresses go.
  globalThis.open = (url) => {
    const address = String(url ?? "");
    if (!/^(https?:\/\/|mailto:)/i.test(address)) throw new TypeError("open takes an http, https or mailto address, not '" + address + "'");
    native.open(address);
    return null;
  };
})();
