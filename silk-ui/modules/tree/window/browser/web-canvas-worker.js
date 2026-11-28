// Dedicated Worker entrypoint for `web-canvas` (End-State B):
// - Co-locates one window group's `UiTree` WASM + optional JS application (`JsHost`) in ONE Worker.
// - Main thread runs the platform shim (DOM events, IME, AccessMirror, rAF) and `WebCompositor`.
// - Transfers rendered OffscreenCanvas frames (`ImageBitmap`) + binary `LayerCommit` metadata via
//   `postMessage` with transferables — zero `SharedArrayBuffer` / COOP-COEP required.

import { WorkerWindowHost, WINDOW_EVENT } from './worker-window-host.mjs';
import { PageCanvases } from './page-canvases.mjs';
import { SheetFetch } from './sheet-fetch.mjs';
import { CommitTracker } from './web-compositor.mjs';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

async function compileWasm(kind, value) {
  if (value instanceof WebAssembly.Module) return value;
  if (kind === 'bytes' || value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return WebAssembly.compile(value);
  }
  return WebAssembly.compileStreaming(fetch(value));
}

function parseWindowId(selector) {
  const m = /^silk-window-(\d+)$/.exec(String(selector ?? ''));
  return m ? Number(m[1]) : 1;
}

/**
 * Starts the Worker-side `web-canvas` group host bound to `port` (`self` in a Dedicated Worker,
 * or a `MessagePort` in Node/unit tests).
 */
export function createCanvasWorkerHost(port, env = {}) {
  let stopped = false;
  let instance = null;
  let memory = null;
  let windowHost = null;
  let gpuHost = null;
  let canvases = null;
  let sheetFetch = null;
  let jsHost = null;
  let mediaBits = 212;
  let accessibilityEnabled = false;
  const storageMap = new Map();
  const trackers = new Map();
  const pendingCommits = new Map();
  const latestMetaByWindow = new Map();
  const accessRequests = new Map();
  const offscreenCanvases = new Map();
  let line = '';

  const post = (msg, transfer) => {
    if (stopped) return;
    if (transfer && transfer.length) port.postMessage(msg, transfer);
    else port.postMessage(msg);
  };

  const print = (chunk) => {
    line += chunk;
    let end;
    while ((end = line.indexOf('\n')) >= 0) {
      post({ type: 'log', text: line.slice(0, end) });
      line = line.slice(end + 1);
    }
  };

  const trackerFor = (windowId) => {
    let t = trackers.get(windowId);
    if (!t) {
      t = new CommitTracker();
      trackers.set(windowId, t);
    }
    return t;
  };

  const emitCommit = async (windowId, metaBuffer, canvas) => {
    if (stopped) return;
    const tracker = trackerFor(windowId);
    let bitmap = null;
    if (canvas?.transferToImageBitmap) {
      bitmap = canvas.transferToImageBitmap();
    } else if (canvas && typeof (env.createImageBitmap ?? globalThis.createImageBitmap) === 'function') {
      bitmap = await (env.createImageBitmap ?? globalThis.createImageBitmap)(canvas);
    }

    if (tracker.isInFlight()) {
      tracker.markDirty();
      const prev = pendingCommits.get(windowId);
      try { prev?.bitmap?.close?.(); } catch {}
      pendingCommits.set(windowId, { windowId, metaBuffer, bitmap });
      return;
    }

    const ticket = tracker.beginCommit('delta');
    if (!ticket) return;
    const transfer = [];
    if (metaBuffer instanceof ArrayBuffer) transfer.push(metaBuffer);
    if (typeof ImageBitmap === 'function' && bitmap instanceof ImageBitmap) transfer.push(bitmap);

    post({
      type: 'layerCommit',
      windowId,
      commitEpoch: ticket.commitEpoch,
      baseEpoch: ticket.baseEpoch,
      kind: ticket.kind,
      consumedInputSeq: windowHost?.consumedInputSeq() ?? 0,
      metaBuffer: metaBuffer ?? null,
      bitmap: bitmap ?? null,
    }, transfer);
  };

  const flushPendingCommit = (windowId) => {
    const tracker = trackerFor(windowId);
    if (tracker.isInFlight()) return;
    const queued = pendingCommits.get(windowId);
    if (!queued) return;
    pendingCommits.delete(windowId);
    const ticket = tracker.beginCommit(tracker.needsKeyframe() ? 'keyframe' : 'delta');
    if (!ticket) return;
    const transfer = [];
    if (queued.metaBuffer instanceof ArrayBuffer) transfer.push(queued.metaBuffer);
    if (queued.bitmap && typeof queued.bitmap.close === 'function') transfer.push(queued.bitmap);
    post({
      type: 'layerCommit',
      windowId,
      commitEpoch: ticket.commitEpoch,
      baseEpoch: ticket.baseEpoch,
      kind: ticket.kind,
      consumedInputSeq: windowHost?.consumedInputSeq() ?? 0,
      metaBuffer: queued.metaBuffer ?? null,
      bitmap: queued.bitmap ?? null,
    }, transfer);
  };

  const ensureOffscreen = (windowId, width, height) => {
    const selector = `silk-window-${windowId}`;
    let canvas = offscreenCanvases.get(selector);
    if (!canvas) {
      const w = Math.max(1, Math.round(width || 800));
      const h = Math.max(1, Math.round(height || 600));
      if (typeof env.createOffscreenCanvas === 'function') canvas = env.createOffscreenCanvas(w, h, selector);
      else if (typeof OffscreenCanvas === 'function') canvas = new OffscreenCanvas(w, h);
      if (canvas) {
        offscreenCanvases.set(selector, canvas);
        gpuHost?.registerCanvas?.(selector, canvas);
      }
    }
    return canvas;
  };

  const startApp = async (msg) => {
    mediaBits = msg.mediaBits ?? 212;
    accessibilityEnabled = !!msg.accessibility;
    for (const [k, v] of msg.storageSnapshot ?? []) storageMap.set(k, v);

    windowHost = new WorkerWindowHost({
      post,
      width: msg.width ?? 800,
      height: msg.height ?? 600,
      scaleFactor: msg.scaleFactor ?? 1,
      appearance: msg.appearance ?? 0,
    });
    windowHost.onOpenWindow = (win) => ensureOffscreen(win.id, win.width, win.height);

    let WebGPUHostCtor = env.WebGPUHost;
    if (!WebGPUHostCtor) {
      const gpuUrl = msg.webgpuHostUrl || '/native/gpu/webgpu/browser/host.js';
      const mod = await import(gpuUrl);
      WebGPUHostCtor = mod.WebGPUHost;
    }

    gpuHost = new WebGPUHostCtor({
      gpu: env.gpu ?? globalThis.navigator?.gpu,
      onPresent: (selector, canvas) => {
        const windowId = parseWindowId(selector);
        const metaBuffer = latestMetaByWindow.get(windowId) ?? null;
        latestMetaByWindow.delete(windowId);
        void emitCommit(windowId, metaBuffer, canvas);
      },
    });

    canvases = new PageCanvases(gpuHost.table);
    ensureOffscreen(1, msg.width ?? 800, msg.height ?? 600);

    let extraImports = {};
    if (msg.app) {
      const jsHostUrl = msg.jsHostUrl || '/ui/js/web/browser/js-host.js';
      const { JsHost } = env.JsHost ? { JsHost: env.JsHost } : await import(jsHostUrl);
      jsHost = new JsHost();
      extraImports = { silkui: jsHost.imports };
    }

    const text = (pointer, length) => decoder.decode(new Uint8Array(memory.buffer, pointer, length));
    sheetFetch = new SheetFetch(() => {
      for (const id of windowHost.windows.keys()) windowHost.silk_window_request_frame(id);
    });

    const yieldFn = typeof WebAssembly?.Suspending === 'function'
      ? new WebAssembly.Suspending(() => new Promise(resolve => setTimeout(resolve, 0)))
      : () => {};

    const imports = {
      ...extraImports,
      window: windowHost.suspendingImports,
      webgpu: gpuHost.imports,
      math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, hypot: Math.hypot, fmod: (x, y) => x % y },
      silk_browser: {
        ...canvases.imports(),
        access_attach: (winId) => (accessibilityEnabled ? (post({ type: 'accessAttach', windowId: winId }), 1) : 0),
        access_update: (winId, ptr, len) => {
          post({ type: 'accessUpdate', windowId: winId, json: text(ptr, len) });
        },
        access_take: (winId, into, capacity) => {
          const pending = accessRequests.get(winId);
          if (!pending?.length) return 0;
          const taken = pending.splice(0, capacity);
          const words = new BigUint64Array(memory.buffer, into, taken.length * 2);
          taken.forEach(([action, node], i) => { words[2 * i] = BigInt(action); words[2 * i + 1] = BigInt(node); });
          return taken.length;
        },
        commit_meta: (ptr, len) => {
          if (!len || !memory) return;
          const copy = new Uint8Array(memory.buffer, ptr, len).slice();
          const winId = len >= 8 ? new DataView(copy.buffer).getUint32(4, true) : 1;
          latestMetaByWindow.set(winId, copy.buffer);
        },
        write: (ptr, len) => print(text(ptr, len)),
        now: () => performance.now(),
        check: () => (msg.check ? 1 : 0),
        media: () => mediaBits,
        sheet_fetch: (ptr, len) => sheetFetch.start(text(ptr, len)),
        sheet_length: (id) => sheetFetch.length(id),
        sheet_read: (id, ptr, len) => sheetFetch.read(id, memory, ptr, len),
        sheet_forget: (id) => sheetFetch.forget(id),
        stylesheet_length: () => 0,
        stylesheet_read: () => -1,
        yield: yieldFn,
        stored_length: (key, keyLen) => {
          const val = storageMap.get(text(key, keyLen)) ?? null;
          return val === null ? -1 : encoder.encode(val).length;
        },
        stored_read: (key, keyLen, into, len) => {
          const val = storageMap.get(text(key, keyLen)) ?? null;
          if (val === null) return -1;
          const bytes = encoder.encode(val);
          if (bytes.length !== len) return -1;
          new Uint8Array(memory.buffer, into, len).set(bytes);
          return len;
        },
        store: (key, keyLen, val, valLen) => {
          const k = text(key, keyLen);
          const v = text(val, valLen);
          storageMap.set(k, v);
          post({ type: 'store', key: k, value: v });
          return 1;
        },
      },
    };

    const module = await compileWasm(msg.wasmKind, msg.wasm);
    instance = await WebAssembly.instantiate(module, imports);
    memory = instance.exports.memory;
    windowHost.attach(instance);
    gpuHost.attach(instance);

    if (jsHost) {
      jsHost.instance = instance;
      jsHost.windowHost = windowHost;
      jsHost.canvases = canvases;
      canvases.wake = () => jsHost.wake();
      jsHost.ran = Promise.resolve()
        .then(() => (typeof env.loadApp === 'function' ? env.loadApp(msg.app) : import(msg.app)))
        .then(() => undefined, err => {
          post({ type: 'error', message: String(err?.message ?? err) });
        });
    }

    post({ type: 'started', wasmThreads: !!msg.wasmThreads });
    const entry = typeof WebAssembly?.promising === 'function' && windowHost.blocking
      ? WebAssembly.promising(instance.exports.main)
      : instance.exports.main;
    const status = await entry();
    if (line) {
      post({ type: 'log', text: line });
      line = '';
    }
    post({ type: 'exit', status });
  };

  const onMessage = (incoming) => {
    if (stopped) return;
    const msg = incoming?.data ?? incoming;
    if (!msg || typeof msg !== 'object') return;
    switch (msg.type) {
      case 'init':
        void startApp(msg).catch(err => {
          post({ type: 'error', message: String(err?.message ?? err) });
        });
        break;
      case 'event': {
        if (!windowHost) break;
        const record = { ...msg.event, texts: msg.event?.texts ?? [] };
        windowHost.enqueueStamped(record);
        if (record.gestureId) {
          post({
            type: 'gestureAck',
            windowId: record.window,
            gestureId: record.gestureId,
            inputSeq: record.inputSeq ?? 0,
            consumed: !!record.preConsumed,
          });
        }
        break;
      }
      case 'frame': {
        if (!windowHost) break;
        const record = {
          kind: WINDOW_EVENT.REQUEST_FRAME,
          window: msg.windowId ?? 1,
          code: 0, named: 0, modifiers: 0, flags: 0, count: 0, phase: 0,
          x: 0, y: 0, dx: 0, dy: 0, value: msg.targetTime ?? performance.now() / 1000,
          start: 0n, end: 0n, texts: [],
        };
        windowHost.push(record);
        break;
      }
      case 'resize':
        windowHost?.setViewport(msg.windowId ?? 1, msg.width, msg.height, msg.scaleFactor);
        break;
      case 'media':
        mediaBits = msg.bits ?? mediaBits;
        for (const id of windowHost?.windows.keys() ?? []) windowHost.silk_window_request_frame(id);
        break;
      case 'commitAck': {
        const ack = msg.ack;
        if (!ack) break;
        const tracker = trackerFor(ack.windowId);
        const again = tracker.onAck(ack);
        if (again) flushPendingCommit(ack.windowId);
        break;
      }
      case 'accessAction': {
        let list = accessRequests.get(msg.windowId);
        if (!list) accessRequests.set(msg.windowId, (list = []));
        list.push([msg.action, BigInt(msg.nodeId)]);
        windowHost?.silk_window_request_frame(msg.windowId);
        break;
      }
      case 'clipboardSync':
        windowHost?.setClipboardSnapshot(msg.entries);
        break;
      case 'stop':
        stopped = true;
        sheetFetch?.close();
        for (const q of pendingCommits.values()) {
          try { q.bitmap?.close?.(); } catch {}
        }
        pendingCommits.clear();
        break;
    }
  };

  if (typeof port.addEventListener === 'function') port.addEventListener('message', onMessage);
  else port.onmessage = onMessage;
  port.start?.();

  return {
    emitCommitForTest: emitCommit,
    windowHost: () => windowHost,
    stop() {
      onMessage({ type: 'stop' });
      if (typeof port.removeEventListener === 'function') port.removeEventListener('message', onMessage);
      else if (port.onmessage === onMessage) port.onmessage = null;
    },
  };
}

if (
  typeof window === 'undefined' &&
  typeof document === 'undefined' &&
  typeof self !== 'undefined' &&
  typeof self.postMessage === 'function'
) {
  createCanvasWorkerHost(self);
}
