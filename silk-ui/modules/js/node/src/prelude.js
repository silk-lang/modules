// What a ui-js realm on the SilkJS runtime adds to Node's globals: animation and idle frames,
// `window.open`, `navigator.clipboard`, the `@silkui/core` modules the host defines, and
// uncaught exceptions printed as a browser console prints them, with the window left running.
(() => {
  const native = globalThis.__ui;

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

  // The window's pixels per CSS pixel in its last frame, as in the engine runtime.
  if (native.scale && !("devicePixelRatio" in globalThis)) {
    Object.defineProperty(globalThis, "devicePixelRatio", {
      get: () => native.scale(),
      set: (value) => Object.defineProperty(globalThis, "devicePixelRatio", { value, writable: true, configurable: true }),
      configurable: true,
    });
  }

  // Media queries answer for the window's last frame, as in the engine runtime. The host
  // calls `native.media` when the media changes; lists with listeners send `change` then.
  if (native.matchMedia && globalThis.matchMedia === undefined) {
    const watched = new Set();
    class MediaQueryList extends EventTarget {
      #media;
      #last;
      constructor(media) {
        super();
        this.#media = media;
        this.#last = native.matchMedia(media);
        this.onchange = null;
      }
      get media() { return this.#media; }
      get matches() { return native.matchMedia(this.#media); }
      addEventListener(type, listener, options) {
        if (type === "change") {
          this.#last = this.matches;
          watched.add(this);
        }
        super.addEventListener(type, listener, options);
      }
      addListener(listener) { this.addEventListener("change", listener); }
      removeListener(listener) { this.removeEventListener("change", listener); }
      set onchange(handler) {
        this._onchange = handler;
        if (handler) watched.add(this);
      }
      get onchange() { return this._onchange ?? null; }
      _changed() {
        const matches = this.matches;
        if (matches === this.#last) return;
        this.#last = matches;
        const event = new Event("change");
        Object.defineProperties(event, { matches: { value: matches }, media: { value: this.#media } });
        if (typeof this._onchange === "function") this._onchange.call(this, event);
        this.dispatchEvent(event);
      }
    }
    globalThis.MediaQueryList ??= MediaQueryList;
    globalThis.matchMedia = (query) => new MediaQueryList(String(query));
    native.media = () => {
      for (const list of [...watched]) list._changed();
    };
  }

  // Idle callbacks run from a timer, with a 50 ms budget as the web gives at most.
  globalThis.requestIdleCallback ??= (callback) => {
    if (typeof callback !== "function") throw new TypeError("requestIdleCallback needs a function");
    return setTimeout(() => {
      const start = performance.now();
      callback({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (performance.now() - start)) });
    }, 1);
  };
  globalThis.cancelIdleCallback ??= (id) => clearTimeout(id);

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

  // Canvas 2D (the engine runtime's canvas2d.js, evaluated on first use) in a window that shows
  // canvases: a canvas node gets its "2d" context from `native.canvas2dLoad`.
  const own = (name, value) => Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
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

  // WebGPU (`navigator.gpu` and GPU* globals, evaluated on first use), matching the engine runtime.
  let gpuApi = null;
  const gpu = (native.gpuLoad = () => (native.gpuEnabled?.() ? (gpuApi ??= (0, eval)(native.gpuApi())(native)) : null));
  if (!("gpu" in globalThis.navigator)) {
    Object.defineProperty(globalThis.navigator, "gpu", { get: () => gpu()?.gpu, enumerable: true, configurable: true });
  }
  for (const name of ["GPU", "GPUAdapter", "GPUAdapterInfo", "GPUDevice", "GPUQueue", "GPUBuffer", "GPUTexture", "GPUTextureView", "GPUSampler", "GPUBindGroupLayout", "GPUPipelineLayout", "GPUBindGroup", "GPUShaderModule", "GPUCompilationInfo", "GPURenderPipeline", "GPUComputePipeline", "GPUCommandEncoder", "GPUCommandBuffer", "GPURenderPassEncoder", "GPUComputePassEncoder", "GPUCanvasContext", "GPUSupportedFeatures", "GPUSupportedLimits", "GPUDeviceLostInfo", "GPUError", "GPUValidationError", "GPUOutOfMemoryError", "GPUInternalError", "GPUPipelineError", "GPUUncapturedErrorEvent", "GPURenderBundleEncoder", "GPURenderBundle", "GPUQuerySet", "GPUExternalTexture", "GPUBufferUsage", "GPUTextureUsage", "GPUShaderStage", "GPUMapMode", "GPUColorWrite"]) {
    if (name in globalThis) continue;
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

  // Asynchronous image decode and PNG encode on `AppPool`, with synchronous fallback.
  const codecCalls = new Map();
  let nextCodecCall = 0;
  const byteView = (value) => (value instanceof ArrayBuffer ? new Uint8Array(value) : value);
  native.codecDone = function (call, ok, width, height, byteLength, errorText) {
    const pending = codecCalls.get(call);
    if (!pending) return;
    codecCalls.delete(call);
    if (!ok) {
      pending.reject(new Error(errorText || "Codec operation failed"));
      return;
    }
    const bytes = new Uint8Array(byteLength);
    if (byteLength > 0 && native.codecTake) native.codecTake(bytes);
    if (pending.kind === "decode") {
      pending.resolve({ width, height, data: new Uint8ClampedArray(bytes.buffer, bytes.byteOffset, bytes.byteLength) });
    } else {
      pending.resolve(bytes);
    }
  };
  native.imageDecodeAsync = function (bytes) {
    const view = byteView(bytes);
    if (!view || typeof view.byteLength !== "number") {
      return Promise.reject(new TypeError("imageDecodeAsync requires typed array bytes"));
    }
    if (native.imageDecodeStart) {
      const call = ++nextCodecCall;
      const entry = { kind: "decode", resolve: null, reject: null };
      const promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      codecCalls.set(call, entry);
      if (native.imageDecodeStart(call, view) === 1) return promise;
      codecCalls.delete(call);
    }
    if (!native.imageDecode || native.imageDecode(view) !== 2) {
      return Promise.reject(new Error("The source image could not be decoded."));
    }
    const width = native.geometry(0);
    const height = native.geometry(1);
    const data = new Uint8ClampedArray(width * height * 4);
    native.imageTake(data);
    return Promise.resolve({ width, height, data });
  };
  native.pngEncodeAsync = function (width, height, rgba) {
    const view = byteView(rgba);
    if (native.pngEncodeStart) {
      const call = ++nextCodecCall;
      const entry = { kind: "encode", resolve: null, reject: null };
      const promise = new Promise((resolve, reject) => {
        entry.resolve = resolve;
        entry.reject = reject;
      });
      codecCalls.set(call, entry);
      if (native.pngEncodeStart(call, width, height, view) === 1) return promise;
      codecCalls.delete(call);
    }
    if (!native.pngEncode || !native.pngTake) return Promise.resolve(null);
    const len = native.pngEncode(width, height, view);
    if (!len || len <= 0) return Promise.resolve(null);
    const bytes = new Uint8Array(len);
    native.pngTake(bytes);
    return Promise.resolve(bytes);
  };

  // Bridge-less Web Worker backed by node:worker_threads (workers receive an inert UiApi).
  if (typeof globalThis.Worker === "undefined") {
    const workerThreads = process.getBuiltinModule("node:worker_threads");
    const nodeUrl = process.getBuiltinModule("node:url");
    if (workerThreads?.Worker) {
      const NodeWorker = workerThreads.Worker;
      const WEB_WORKER_BOOTSTRAP = `(() => {
  const wt = process.getBuiltinModule("node:worker_threads");
  const port = wt?.parentPort;
  if (typeof globalThis.self === "undefined") globalThis.self = globalThis;
  const target = typeof EventTarget === "function" ? new EventTarget() : null;
  const listeners = new Map();
  if (typeof globalThis.addEventListener !== "function") {
    globalThis.addEventListener = target
      ? target.addEventListener.bind(target)
      : (type, fn) => {
          if (typeof fn !== "function") return;
          let set = listeners.get(type);
          if (!set) listeners.set(type, (set = new Set()));
          set.add(fn);
        };
    globalThis.removeEventListener = target
      ? target.removeEventListener.bind(target)
      : (type, fn) => {
          listeners.get(type)?.delete(fn);
        };
    globalThis.dispatchEvent = target
      ? target.dispatchEvent.bind(target)
      : (event) => {
          const set = listeners.get(event?.type);
          if (set) for (const fn of [...set]) fn.call(globalThis, event);
          return true;
        };
  }
  if (!("onmessage" in globalThis)) globalThis.onmessage = null;
  globalThis.postMessage = (message, transfer) => {
    if (transfer !== undefined) port?.postMessage(message, transfer);
    else port?.postMessage(message);
  };
  globalThis.close = () => {
    try { port?.close?.(); } catch {}
    process.exit(0);
  };
  const deliver = (data) => {
    const event = typeof globalThis.MessageEvent === "function"
      ? new globalThis.MessageEvent("message", { data })
      : (typeof Event === "function" ? Object.assign(new Event("message"), { data }) : { type: "message", data });
    if (typeof globalThis.onmessage === "function") globalThis.onmessage(event);
    globalThis.dispatchEvent(event);
  };
  globalThis.__silkWorkerQueue = null;
  globalThis.__silkWorkerDeliverReady = () => {
    const queued = globalThis.__silkWorkerQueue;
    globalThis.__silkWorkerQueue = null;
    if (queued) for (const item of queued) deliver(item);
  };
  port?.on("message", (data) => {
    if (globalThis.__silkWorkerQueue) globalThis.__silkWorkerQueue.push(data);
    else deliver(data);
  });
})();`;
      const dataWorkerSource = (address) => {
        const comma = address.indexOf(",");
        if (comma < 0) return null;
        const meta = address.slice(5, comma);
        const body = address.slice(comma + 1);
        if (meta.endsWith(";base64") && typeof globalThis.atob === "function") {
          return globalThis.atob(body);
        }
        return decodeURIComponent(body);
      };
      class WebWorker extends EventTarget {
        #worker;
        onmessage = null;
        onmessageerror = null;
        onerror = null;
        constructor(scriptURL, _options) {
          super();
          const raw = scriptURL instanceof URL ? scriptURL.href : String(scriptURL);
          if (raw.startsWith("data:")) {
            const code = dataWorkerSource(raw);
            if (code === null) throw new SyntaxError("Invalid data: worker URL");
            this.#worker = new NodeWorker(`${WEB_WORKER_BOOTSTRAP}\n${code}`, { eval: true });
          } else {
            const targetUrl = raw.startsWith("file://")
              ? raw
              : (nodeUrl?.pathToFileURL ? nodeUrl.pathToFileURL(raw).href : raw);
            const loader = `${WEB_WORKER_BOOTSTRAP}\nglobalThis.__silkWorkerQueue = [];\nimport(${JSON.stringify(targetUrl)}).then(() => globalThis.__silkWorkerDeliverReady(), (err) => { throw err; });`;
            this.#worker = new NodeWorker(loader, { eval: true });
          }
          this.#worker.on("message", (data) => {
            const event = typeof globalThis.MessageEvent === "function"
              ? new globalThis.MessageEvent("message", { data })
              : Object.assign(new Event("message"), { data });
            if (typeof this.onmessage === "function") this.onmessage(event);
            this.dispatchEvent(event);
          });
          this.#worker.on("error", (err) => {
            const event = Object.assign(new Event("error", { cancelable: true }), {
              message: err?.message ?? String(err),
              error: err,
            });
            if (typeof this.onerror === "function") this.onerror(event);
            this.dispatchEvent(event);
          });
        }
        postMessage(message, transfer) {
          if (transfer !== undefined) this.#worker.postMessage(message, transfer);
          else this.#worker.postMessage(message);
        }
        terminate() {
          return this.#worker.terminate();
        }
      }
      globalThis.Worker = WebWorker;
    }
  }

  // As `window.open` in a browser, for an address outside the application: the host opens
  // it with the system's browser or mail program. Only http, https and mailto addresses go.
  globalThis.open = (url) => {
    const address = String(url ?? "");
    if (!/^(https?:\/\/|mailto:)/i.test(address)) throw new TypeError("open takes an http, https or mailto address, not '" + address + "'");
    native.open(address);
    return null;
  };

  // A window stays open after an exception nothing caught, as a browser tab does.
  const uncaught = (error) => console.error("Uncaught", error);
  native.report = uncaught;
  process.on("uncaughtException", uncaught);
  // As on the web: `unhandledrejection` on the global object first, and a listener that
  // prevents its default keeps the rejection off the console.
  class PromiseRejectionEvent extends Event {
    #promise;
    #reason;
    constructor(type, options) {
      super(type, options);
      this.#promise = options?.promise;
      this.#reason = options?.reason;
    }
    get promise() { return this.#promise; }
    get reason() { return this.#reason; }
  }
  globalThis.PromiseRejectionEvent ??= PromiseRejectionEvent;
  if (typeof globalThis.addEventListener !== "function") {
    const target = new EventTarget();
    globalThis.addEventListener = target.addEventListener.bind(target);
    globalThis.removeEventListener = target.removeEventListener.bind(target);
    globalThis.dispatchEvent = target.dispatchEvent.bind(target);
  }
  process.on("unhandledRejection", (reason, promise) => {
    const event = new globalThis.PromiseRejectionEvent("unhandledrejection", { promise, reason, cancelable: true });
    if (globalThis.dispatchEvent(event)) console.error("Uncaught (in promise)", reason);
  });
  globalThis.reportError ??= uncaught;

  // Modules the host defines (`@silkui/core`), importable by name from any module.
  const modules = new Map();
  native.defineModule = (name, source) => {
    modules.set(name, source);
  };
  const scheme = "silk-module:";
  process.getBuiltinModule("node:module").registerHooks({
    resolve(specifier, context, next) {
      if (modules.has(specifier)) return { url: scheme + specifier, format: "module", shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.startsWith(scheme)) return { format: "module", source: modules.get(url.slice(scheme.length)), shortCircuit: true };
      return next(url, context);
    },
  });
})();
