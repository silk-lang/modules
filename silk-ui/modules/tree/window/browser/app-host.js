// Runs a Silk UI app in the page: a wasm32 build of a program whose `main` calls ui-tree-window's
// `host.runWindow` (directly, or through loom-window).
//
// In Worker mode (default when Dedicated Workers and OffscreenCanvas are supported; no
// `SharedArrayBuffer`/COOP-COEP required), the window group (`UiTree` WASM and optional JS
// bundle via `runJsApp`) runs in one Dedicated Worker, while the main thread runs the platform
// DOM/IME/rAF shim, evaluates declarative browser-level default-action rules synchronously, and
// drives `WebCompositor` (retained layers, scroll/fling/snap physics, property-tree animations).
// When Worker/OffscreenCanvas support is unavailable or disabled (`worker: false`), falls back
// transparently to single-thread JSPI inline mode.
import { WindowHost } from '/native/platform/window/browser/window-host.js';
import { WebGPUHost } from '/native/gpu/webgpu/browser/host.ts';
import { CODES, NAMED, CODE_TO_NAMED } from '/native/platform/window/browser/keys.js';
import { PageCanvases } from './page-canvases.mjs';
import { AccessMirror } from './access-mirror.js';
import { MediaPreferences } from './media.mjs';
import { SheetFetch } from './sheet-fetch.mjs';
import { WebCompositor, decodeBrowserCommit } from './web-compositor.mjs';
import { WINDOW_EVENT, createEventRecord } from './worker-window-host.mjs';

const decoder = new TextDecoder();
const encoder = new TextEncoder();

/** modules/platform/window's number for the system menu item that closes a window. */
const CLOSE_WINDOW = 6;
const CODE_INDEX = new Map(CODES.map((name, index) => [name, index]));
const NAMED_INDEX = new Map(NAMED.map((name, index) => [name, index]));
const BUTTONS = [0, 2, 1, 3, 4];
const CURSORS = ['default', 'text', 'pointer', 'crosshair', 'grabbing', 'grab', 'not-allowed',
  'ew-resize', 'ns-resize', 'w-resize', 'e-resize', 'n-resize', 's-resize', 'nwse-resize',
  'nesw-resize', 'col-resize', 'row-resize', 'vertical-text', 'copy', 'alias', 'context-menu',
  'none', 'wait', 'progress', 'help', 'zoom-in', 'zoom-out', 'cell', 'no-drop', 'move', 'all-scroll',
  'nw-resize', 'ne-resize', 'sw-resize', 'se-resize'];
const MOD = { SHIFT: 1, CONTROL: 2, ALT: 4, META: 8, CAPS_LOCK: 16 };
const FLAG = { REPEAT: 1, IME_HANDLED: 2, ON: 4, PRECISE: 8 };

/** Feature detection summary for Worker-hosted vs inline JSPI browser modes. */
export function browserCapabilities(env = globalThis) {
  const sab = typeof env.SharedArrayBuffer === 'function';
  const coi = !!env.crossOriginIsolated;
  return {
    webgpu: !!env.navigator?.gpu,
    jspi: typeof env.WebAssembly?.Suspending === 'function' && typeof env.WebAssembly?.promising === 'function',
    worker: typeof env.Worker === 'function',
    offscreenCanvas: typeof env.OffscreenCanvas === 'function',
    sharedArrayBuffer: sab,
    crossOriginIsolated: coi,
    wasmThreads: sab && coi,
  };
}

/**
 * Selects `"worker"` (Worker Document Group + main-thread `WebCompositor`) or `"inline"`
 * (single-thread JSPI fallback). No `SharedArrayBuffer`/COOP-COEP is required for `"worker"`.
 */
export function selectExecutionMode({
  worker = 'auto',
  check = false,
  hasCustomImports = false,
  hasStartedHook = false,
  capabilities = browserCapabilities(),
} = {}) {
  if (worker === false || check || hasCustomImports || hasStartedHook) return 'inline';
  if (worker === true) return 'worker';
  return capabilities.worker && capabilities.offscreenCanvas ? 'worker' : 'inline';
}

/** The page's localStorage, or null where it is blocked (some private windows, sandboxed frames). */
function pageStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Why this browser cannot run the app, or undefined when it can. */
export function unsupported() {
  if (!globalThis.navigator?.gpu) return 'This browser has no WebGPU.';
  if (typeof WebAssembly.Suspending !== 'function' || typeof WebAssembly.promising !== 'function')
    return 'This browser has no WebAssembly JSPI (WebAssembly.Suspending).';
  return undefined;
}

function modifiersOf(e) {
  let bits = 0;
  if (e.shiftKey) bits |= MOD.SHIFT;
  if (e.ctrlKey) bits |= MOD.CONTROL;
  if (e.altKey) bits |= MOD.ALT;
  if (e.metaKey) bits |= MOD.META;
  if (e.getModifierState?.('CapsLock')) bits |= MOD.CAPS_LOCK;
  return bits;
}

function singleCharacter(text) {
  if (!text) return false;
  const first = text.codePointAt(0);
  return String.fromCodePoint(first).length === text.length && first >= 0x20 && first !== 0x7f;
}

async function prepareWasmPayload(wasm) {
  if (wasm instanceof WebAssembly.Module) return { wasmKind: 'module', wasm, transfer: [] };
  if (wasm instanceof ArrayBuffer) {
    const copy = wasm.slice(0);
    return { wasmKind: 'bytes', wasm: copy, transfer: [copy] };
  }
  if (ArrayBuffer.isView(wasm)) {
    const copy = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength);
    return { wasmKind: 'bytes', wasm: copy, transfer: [copy] };
  }
  if (wasm instanceof Response) {
    if (!wasm.ok) throw new Error(`silk-ui: ${wasm.url} answered ${wasm.status}`);
    const copy = await wasm.arrayBuffer();
    return { wasmKind: 'bytes', wasm: copy, transfer: [copy] };
  }
  const url = typeof wasm === 'string' || wasm instanceof URL
    ? (typeof globalThis.location?.href === 'string' ? new URL(wasm, globalThis.location.href).href : String(wasm))
    : String(wasm);
  return { wasmKind: 'url', wasm: url, transfer: [] };
}

function snapshotStorage(storage, prefix) {
  const entries = [];
  if (!storage) return entries;
  try {
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(prefix)) entries.push([k.slice(prefix.length), storage.getItem(k) ?? '']);
    }
  } catch {}
  return entries;
}

/**
 * Worker-hosted `web-canvas` runner: main thread owns DOM `<canvas>`, IME `<textarea>`,
 * `AccessMirror`, `rAF`, declarative browser-level rules, and `WebCompositor`. Worker owns
 * the window group's `UiTree` WASM (+ optional co-located JS bundle).
 */
export async function runAppWorker({
  wasm, app, jsHostUrl, container = document.body, check = false, log = console.log,
  storage = check ? null : pageStorage(), storagePrefix = 'silk-app:', focus = true,
  windows, accessibility = true, workerUrl, workerFactory, compositor = new WebCompositor(),
}) {
  const capabilities = browserCapabilities();
  const resolvedWebgpuUrl = new URL('/native/gpu/webgpu/browser/host.ts', import.meta.url).href;
  const resolvedWorkerUrl = workerUrl ?? new URL('./web-canvas-worker.js', import.meta.url).href;

  const canvas = document.createElement('canvas');
  canvas.id = 'silk-window-1';
  canvas.tabIndex = 0;
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', outline: 'none', touchAction: 'none' });
  container.appendChild(canvas);

  const input = document.createElement('textarea');
  Object.assign(input.style, {
    position: 'fixed', left: '0px', top: '0px', width: '1px', height: '1px', opacity: '0',
    padding: '0', border: '0', margin: '0', resize: 'none', overflow: 'hidden',
    outline: 'none', caretColor: 'transparent', zIndex: '-1', whiteSpace: 'pre',
  });
  input.setAttribute('autocomplete', 'off');
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  document.body.appendChild(input);

  const winRecords = new Map();
  const abort = new AbortController();
  let focusedWindow = 1;
  let composing = false;
  let compositorRaf = 0;
  const clicks = new Map();
  const workerFramePending = new Set();

  const worker = typeof workerFactory === 'function'
    ? workerFactory()
    : new Worker(resolvedWorkerUrl, { type: 'module' });

  const accessHostShim = { input, focused: 1, windows: winRecords, focusInput: id => focusWindow(id), frame: id => requestWorkerFrame(id) };
  const mirror = new AccessMirror(accessHostShim);

  const scheduleComposite = () => {
    if (compositorRaf) return;
    compositorRaf = requestAnimationFrame(nowMs => {
      compositorRaf = 0;
      compositor.tick(nowMs);
      compositor.present(nowMs);
      if (compositor.hasActiveMotion()) scheduleComposite();
    });
  };

  const requestWorkerFrame = (windowId) => {
    if (workerFramePending.has(windowId)) return;
    workerFramePending.add(windowId);
    requestAnimationFrame(time => {
      workerFramePending.delete(windowId);
      worker.postMessage({ type: 'frame', windowId, targetTime: (time + 1000 / 60) / 1000 });
    });
  };

  const sendEvent = (record) => worker.postMessage({ type: 'event', event: record });

  const placeInput = (rec) => {
    const rect = rec.canvas.getBoundingClientRect();
    const ime = rec.ime;
    Object.assign(input.style, {
      left: `${rect.left + ime.x}px`,
      top: `${rect.top + ime.y}px`,
      width: `${Math.max(ime.width, 1)}px`,
      height: `${Math.max(ime.height, 1)}px`,
      fontSize: `${Math.max(ime.height, 1)}px`,
      lineHeight: `${Math.max(ime.height, 1)}px`,
    });
  };

  const focusWindow = (id) => {
    const rec = winRecords.get(id);
    if (!rec) return;
    if (focusedWindow !== id && focusedWindow) {
      const blurEv = createEventRecord(WINDOW_EVENT.FOCUSED, focusedWindow);
      sendEvent(blurEv);
    }
    focusedWindow = id;
    accessHostShim.focused = id;
    placeInput(rec);
    if (document.activeElement !== input) input.focus({ preventScroll: true });
  };

  const attachCanvasListeners = (rec) => {
    const c = rec.canvas;
    const opts = { signal: abort.signal };
    const at = (kind, e) => {
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const route = compositor.routePointer(rec.id, kind === WINDOW_EVENT.MOUSE_MOVED ? 'move' : 'pointer', x, y, performance.now());
      const r = createEventRecord(kind, rec.id);
      r.x = x;
      r.y = y;
      r.modifiers = modifiersOf(e);
      r.inputSeq = route.inputSeq;
      r.presentedEpoch = route.presentedEpoch;
      return r;
    };

    c.addEventListener('pointerdown', e => {
      focusWindow(rec.id);
      e.preventDefault();
      if (e.pointerId !== undefined) try { c.setPointerCapture(e.pointerId); } catch {}
      if (e.pointerType === 'touch') {
        const r = at(WINDOW_EVENT.TOUCH, e);
        r.code = e.pointerId >>> 0;
        r.phase = 1;
        sendEvent(r);
        return;
      }
      const r = at(WINDOW_EVENT.MOUSE_DOWN, e);
      r.code = BUTTONS[e.button] ?? 5;
      const prev = clicks.get(rec.id) ?? { count: 0, time: 0, x: 0, y: 0, button: -1 };
      const nowMs = performance.now();
      const near = Math.abs(r.x - prev.x) < 4 && Math.abs(r.y - prev.y) < 4;
      prev.count = near && prev.button === e.button && nowMs - prev.time < 500 ? prev.count + 1 : 1;
      Object.assign(prev, { time: nowMs, x: r.x, y: r.y, button: e.button });
      clicks.set(rec.id, prev);
      r.count = prev.count;
      sendEvent(r);
    }, opts);

    c.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch') {
        if (!e.buttons) return;
        const r = at(WINDOW_EVENT.TOUCH, e);
        r.code = e.pointerId >>> 0;
        r.phase = 2;
        sendEvent(r);
        return;
      }
      sendEvent(at(WINDOW_EVENT.MOUSE_MOVED, e));
      scheduleComposite();
    }, opts);

    c.addEventListener('pointerup', e => {
      if (e.pointerType === 'touch') {
        const r = at(WINDOW_EVENT.TOUCH, e);
        r.code = e.pointerId >>> 0;
        r.phase = 3;
        sendEvent(r);
        return;
      }
      const r = at(WINDOW_EVENT.MOUSE_UP, e);
      r.code = BUTTONS[e.button] ?? 5;
      sendEvent(r);
    }, opts);

    c.addEventListener('pointerenter', e => { if (e.pointerType !== 'touch') sendEvent(at(WINDOW_EVENT.MOUSE_ENTERED, e)); }, opts);
    c.addEventListener('pointerleave', e => { if (e.pointerType !== 'touch') sendEvent(createEventRecord(WINDOW_EVENT.MOUSE_EXITED, rec.id)); }, opts);
    c.addEventListener('contextmenu', e => e.preventDefault(), opts);
    c.addEventListener('wheel', e => {
      e.preventDefault();
      const rect = c.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const scale = e.deltaMode === 2 ? rec.height || 1 : 1;
      const dx = -e.deltaX * scale;
      const dy = -e.deltaY * scale;
      if (e.ctrlKey && e.deltaMode === 0) {
        const pinch = createEventRecord(WINDOW_EVENT.PINCH, rec.id);
        pinch.x = x;
        pinch.y = y;
        pinch.dx = Math.exp(-e.deltaY / 100) - 1;
        pinch.modifiers = modifiersOf(e);
        pinch.inputSeq = compositor.nextInputSeq();
        sendEvent(pinch);
        return;
      }
      const route = compositor.routeWheel(rec.id, x, y, -dx, -dy, performance.now());
      if (route.scrolledOnCompositor || compositor.hasActiveMotion()) scheduleComposite();
      const r = createEventRecord(WINDOW_EVENT.SCROLL, rec.id);
      r.x = x;
      r.y = y;
      r.dx = dx;
      r.dy = dy;
      r.modifiers = modifiersOf(e);
      if (e.deltaMode === 0) r.flags |= FLAG.PRECISE;
      r.inputSeq = route.inputSeq;
      r.presentedEpoch = route.presentedEpoch;
      r.gestureId = route.gestureId;
      sendEvent(r);
    }, { ...opts, passive: false });
  };

  const registerWindow = (id, existingCanvas) => {
    let rec = winRecords.get(id);
    if (rec) return rec;
    const c = existingCanvas ?? document.createElement('canvas');
    if (!existingCanvas) {
      c.id = `silk-window-${id}`;
      c.tabIndex = 0;
      Object.assign(c.style, { display: 'block', outline: 'none', touchAction: 'none' });
      container.appendChild(c);
    }
    const width = c.clientWidth || container.clientWidth || 800;
    const height = c.clientHeight || container.clientHeight || 600;
    rec = { id, canvas: c, owned: !existingCanvas, width, height, visible: true, ime: { enabled: false, x: 0, y: 0, width: 0, height: 0 } };
    winRecords.set(id, rec);
    compositor.attachWindow(id, c, { width, height, deviceScale: globalThis.devicePixelRatio || 1 });
    attachCanvasListeners(rec);
    if (typeof ResizeObserver === 'function') {
      rec.observer = new ResizeObserver(() => {
        const rect = c.getBoundingClientRect();
        const w = c.clientWidth || rect.width;
        const h = c.clientHeight || rect.height;
        if (w === rec.width && h === rec.height) return;
        rec.width = w;
        rec.height = h;
        worker.postMessage({ type: 'resize', windowId: id, width: w, height: h, scaleFactor: globalThis.devicePixelRatio || 1 });
      });
      rec.observer.observe(c);
    }
    return rec;
  };

  registerWindow(1, canvas);
  windows?.({
    close: id => {
      const r = createEventRecord(WINDOW_EVENT.CLOSE_REQUESTED, id);
      sendEvent(r);
    },
  });

  const keyRecord = (kind, e) => {
    const r = createEventRecord(kind, focusedWindow);
    r.code = CODE_INDEX.get(e.code) ?? 0;
    const named = NAMED_INDEX.get(e.key) ?? NAMED_INDEX.get(CODE_TO_NAMED[e.code] ?? '') ?? 0;
    const character = !named && singleCharacter(e.key);
    r.named = character ? 0 : named;
    r.modifiers = modifiersOf(e);
    if (character) r.texts = [e.key];
    return r;
  };

  input.addEventListener('focus', () => {
    if (!focusedWindow) return;
    const r = createEventRecord(WINDOW_EVENT.FOCUSED, focusedWindow);
    r.flags |= FLAG.ON;
    sendEvent(r);
  }, { signal: abort.signal });
  input.addEventListener('blur', () => {
    if (focusedWindow) sendEvent(createEventRecord(WINDOW_EVENT.FOCUSED, focusedWindow));
  }, { signal: abort.signal });
  input.addEventListener('keydown', e => {
    if (!focusedWindow) return;
    if (compositor.shouldPreventKey(focusedWindow, e)) e.preventDefault();
    const r = keyRecord(WINDOW_EVENT.KEY_DOWN, e);
    if (e.isComposing || e.keyCode === 229) r.flags |= FLAG.IME_HANDLED;
    if (e.repeat) r.flags |= FLAG.REPEAT;
    sendEvent(r);
    if (r.named && e.key !== 'Unidentified' && !['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].includes(e.key)) {
      e.preventDefault();
    }
  }, { signal: abort.signal });
  input.addEventListener('keyup', e => {
    if (focusedWindow) sendEvent(keyRecord(WINDOW_EVENT.KEY_UP, e));
  }, { signal: abort.signal });
  input.addEventListener('compositionstart', () => { composing = true; }, { signal: abort.signal });
  input.addEventListener('compositionupdate', e => {
    const r = createEventRecord(WINDOW_EVENT.IME_PREEDIT, focusedWindow);
    const data = e.data ?? '';
    r.texts = [data];
    const len = BigInt(encoder.encode(data).length);
    r.start = len;
    r.end = len;
    sendEvent(r);
  }, { signal: abort.signal });
  input.addEventListener('compositionend', e => {
    composing = false;
    const clear = createEventRecord(WINDOW_EVENT.IME_PREEDIT, focusedWindow);
    clear.texts = [''];
    sendEvent(clear);
    if (e.data) {
      const r = createEventRecord(WINDOW_EVENT.TEXT_INPUT, focusedWindow);
      r.texts = [e.data];
      sendEvent(r);
    }
    input.value = '';
  }, { signal: abort.signal });
  input.addEventListener('input', e => {
    if (composing || e.isComposing) return;
    const text = e.data ?? input.value;
    if (text) {
      const r = createEventRecord(WINDOW_EVENT.TEXT_INPUT, focusedWindow);
      r.texts = [text];
      sendEvent(r);
    }
    input.value = '';
  }, { signal: abort.signal });

  if (focus) focusWindow(1);
  const media = !check ? new MediaPreferences(() => worker.postMessage({ type: 'media', bits: media.bits })) : null;
  const wasmPayload = await prepareWasmPayload(wasm);

  return await new Promise((resolve, reject) => {
    const cleanup = () => {
      abort.abort();
      cancelAnimationFrame(compositorRaf);
      media?.close();
      for (const rec of winRecords.values()) {
        rec.observer?.disconnect();
        if (rec.owned) rec.canvas.remove();
      }
      input.remove();
      for (const id of winRecords.keys()) compositor.removeWindow(id);
      try { worker.postMessage({ type: 'stop' }); } catch {}
      worker.terminate?.();
    };

    worker.addEventListener('message', incoming => {
      const msg = incoming?.data ?? incoming;
      if (!msg || typeof msg !== 'object') return;
      switch (msg.type) {
        case 'layerCommit': {
          const decoded = msg.metaBuffer ? decodeBrowserCommit(msg.metaBuffer) : null;
          const commit = {
            ...(decoded ?? {}),
            windowId: msg.windowId ?? decoded?.windowId ?? 1,
            commitEpoch: msg.commitEpoch ?? decoded?.commitEpoch ?? 1,
            baseEpoch: msg.baseEpoch ?? 0,
            kind: msg.kind ?? 'keyframe',
            consumedInputSeq: Math.max(msg.consumedInputSeq ?? 0, decoded?.consumedInputSeq ?? 0),
          };
          const ack = compositor.applyCommit(commit, msg.bitmap ?? null);
          worker.postMessage({ type: 'commitAck', ack });
          scheduleComposite();
          break;
        }
        case 'gestureAck':
          compositor.ackGesture(msg.windowId, msg);
          scheduleComposite();
          break;
        case 'windowOpen': {
          const rec = registerWindow(msg.windowId);
          if (msg.title && msg.windowId === 1) document.title = msg.title;
          if (msg.width && msg.height && rec.owned) {
            rec.canvas.style.width = `${msg.width}px`;
            rec.canvas.style.height = `${msg.height}px`;
          }
          break;
        }
        case 'windowClose': {
          const rec = winRecords.get(msg.windowId);
          rec?.observer?.disconnect();
          if (rec?.owned) rec.canvas.remove();
          winRecords.delete(msg.windowId);
          compositor.removeWindow(msg.windowId);
          break;
        }
        case 'requestFrame':
          requestWorkerFrame(msg.windowId ?? 1);
          break;
        case 'setTitle':
          if (msg.windowId === 1) document.title = msg.title ?? '';
          break;
        case 'setContentSize': {
          const rec = winRecords.get(msg.windowId);
          if (rec) {
            rec.canvas.style.width = `${msg.width}px`;
            rec.canvas.style.height = `${msg.height}px`;
          }
          break;
        }
        case 'setVisible': {
          const rec = winRecords.get(msg.windowId);
          if (rec) rec.canvas.style.visibility = msg.visible ? '' : 'hidden';
          break;
        }
        case 'focus':
          focusWindow(msg.windowId);
          break;
        case 'setCursor': {
          const rec = winRecords.get(msg.windowId);
          if (rec) rec.canvas.style.cursor = CURSORS[msg.cursor] ?? 'default';
          break;
        }
        case 'setIme': {
          const rec = winRecords.get(msg.windowId);
          if (rec) {
            rec.ime = { enabled: !!msg.enabled, x: msg.x, y: msg.y, width: msg.width, height: msg.height };
            if (focusedWindow === rec.id) placeInput(rec);
          }
          break;
        }
        case 'clipboardWrite':
          globalThis.navigator?.clipboard?.writeText?.(msg.text).catch(() => {});
          break;
        case 'openUrl':
          globalThis.open?.(msg.url, '_blank', 'noopener');
          break;
        case 'accessAttach':
          if (accessibility) mirror.attach(msg.windowId);
          break;
        case 'accessUpdate':
          if (accessibility) mirror.update(msg.windowId, msg.json);
          break;
        case 'store':
          try { storage?.setItem(storagePrefix + msg.key, msg.value); } catch {}
          break;
        case 'log':
          log(msg.text);
          break;
        case 'exit':
          cleanup();
          resolve(msg.status ?? 0);
          break;
        case 'error':
          cleanup();
          reject(new Error(msg.message || 'silk-ui: worker failed'));
          break;
      }
    });

    worker.addEventListener('error', ev => {
      cleanup();
      reject(ev?.error instanceof Error ? ev.error : new Error(ev?.message || 'silk-ui: worker error'));
    });
    worker.start?.();

    const first = winRecords.get(1);
    worker.postMessage({
      type: 'init',
      ...wasmPayload,
      app,
      jsHostUrl,
      webgpuHostUrl: resolvedWebgpuUrl,
      width: first.width,
      height: first.height,
      scaleFactor: globalThis.devicePixelRatio || 1,
      check,
      accessibility: accessibility && !check,
      mediaBits: media?.bits ?? 212,
      storagePrefix,
      storageSnapshot: snapshotStorage(storage, storagePrefix),
      wasmThreads: capabilities.wasmThreads,
    }, wasmPayload.transfer);
  });
}

/**
 * Starts the app and resolves with `main`'s exit status when it returns (the window closed, or
 * the check finished). Defaults to Worker + main-thread `WebCompositor` mode when supported,
 * and falls back transparently to single-thread JSPI inline mode otherwise.
 */
export async function runApp({
  wasm, container = document.body, check = false, log = console.log,
  storage = check ? null : pageStorage(), storagePrefix = 'silk-app:', imports: more = {},
  focus = true, windows, accessibility = true, started, stylesheetUpdates,
  worker = 'auto', workerUrl, workerFactory, app, jsHostUrl,
}) {
  const mode = selectExecutionMode({
    worker,
    check,
    hasCustomImports: Boolean(more && Object.keys(more).length > 0),
    hasStartedHook: typeof started === 'function',
  });
  if (mode === 'worker' && (workerFactory || (typeof Worker === 'function' && typeof OffscreenCanvas === 'function'))) {
    return runAppWorker({
      wasm, app, jsHostUrl, container, check, log, storage, storagePrefix,
      focus, windows, accessibility, workerUrl, workerFactory,
    });
  }

  const problem = unsupported();
  if (problem) throw new Error(problem);
  const text = (pointer, length) => decoder.decode(new Uint8Array(memory.buffer, pointer, length));
  const storedItem = key => {
    try {
      return storage?.getItem(storagePrefix + key) ?? null;
    } catch {
      return null;
    }
  };
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  Object.assign(canvas.style, { width: '100%', height: '100%', display: 'block', outline: 'none' });
  container.appendChild(canvas);
  const windowHost = new WindowHost({ container });
  windowHost.addCanvas(canvas);
  windows?.({
    close: id => {
      const focused = windowHost.focused;
      windowHost.focused = id;
      windowHost.systemItem(CLOSE_WINDOW);
      windowHost.focused = focused;
    },
  });
  const gpuHost = new WebGPUHost();
  const canvases = new PageCanvases(gpuHost.table);
  const mirror = new AccessMirror(windowHost);
  let memory;
  let media;
  let sheetFetch;
  let styles;
  let line = '';
  const print = text => {
    line += text;
    let end;
    while ((end = line.indexOf('\n')) >= 0) { log(line.slice(0, end)); line = line.slice(end + 1); }
  };
  const imports = {
    ...more,
    window: windowHost.suspendingImports,
    webgpu: gpuHost.imports,
    math: { sin: Math.sin, cos: Math.cos, tan: Math.tan, hypot: Math.hypot, fmod: (x, y) => x % y },
    silk_browser: {
      ...mirror.imports(() => memory, accessibility && !check),
      ...canvases.imports(),
      commit_meta: () => {},
      write: (pointer, length) => print(decoder.decode(new Uint8Array(memory.buffer, pointer, length))),
      now: () => performance.now(),
      check: () => (check ? 1 : 0),
      media: () => media?.bits ?? 212,
      sheet_fetch: (pointer, length) => sheetFetch?.start(text(pointer, length)) ?? 0,
      sheet_length: id => sheetFetch?.length(id) ?? -1,
      sheet_read: (id, pointer, length) => sheetFetch?.read(id, memory, pointer, length) ?? -1,
      sheet_forget: id => sheetFetch?.forget(id),
      stylesheet_length: () => styles?.length ?? 0,
      stylesheet_read: (pointer, length) => styles?.read(memory, pointer, length) ?? -1,
      yield: new WebAssembly.Suspending(() => new Promise(resolve => setTimeout(resolve, 0))),
      stored_length: (key, keyLength) => {
        const value = storedItem(text(key, keyLength));
        return value === null ? -1 : encoder.encode(value).length;
      },
      stored_read: (key, keyLength, into, length) => {
        const value = storedItem(text(key, keyLength));
        if (value === null) return -1;
        const bytes = encoder.encode(value);
        if (bytes.length !== length) return -1;
        new Uint8Array(memory.buffer, into, length).set(bytes);
        return length;
      },
      store: (key, keyLength, value, valueLength) => {
        try {
          storage?.setItem(storagePrefix + text(key, keyLength), text(value, valueLength));
          return storage ? 1 : 0;
        } catch {
          return 0;
        }
      },
    },
  };
  const module = wasm instanceof WebAssembly.Module ? wasm
    : ArrayBuffer.isView(wasm) || wasm instanceof ArrayBuffer ? await WebAssembly.compile(wasm)
    : await WebAssembly.compileStreaming(fetch(wasm));
  const instance = await WebAssembly.instantiate(module, imports);
  memory = instance.exports.memory;
  windowHost.attach(instance);
  gpuHost.attach(instance);
  if (focus) canvas.focus();
  const report = () => {
    const length = instance.exports.silk_report_length?.() ?? 0;
    if (!length) return '';
    return decoder.decode(new Uint8Array(memory.buffer, instance.exports.silk_report(), length).slice());
  };
  started?.({ instance, windowHost, canvases });
  let status;
  try {
    sheetFetch = new SheetFetch(() => {
      for (const id of windowHost.windows.keys()) windowHost.silk_window_request_frame(id);
    });
    if (!check) media = new MediaPreferences(() => {
      for (const id of windowHost.windows.keys()) windowHost.silk_window_request_frame(id);
    });
    if (stylesheetUpdates) {
      const { StyleUpdates } = await import('./style-updates.mjs');
      styles = new StyleUpdates(stylesheetUpdates);
    }
    status = await WebAssembly.promising(instance.exports.main)();
  } catch (error) {
    const text = report();
    throw new Error(text ? `${text}\n${error?.message ?? error}` : String(error?.message ?? error), { cause: error });
  } finally {
    media?.close();
    sheetFetch?.close();
    styles?.close();
    if (line) log(line);
  }
  if (gpuHost.failures.length) throw new Error(gpuHost.failures.join('\n'));
  if (status !== 0) {
    const text = report();
    if (text) log(text);
  }
  return status;
}
