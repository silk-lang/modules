import assert from 'node:assert/strict';
import moduleApi from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const repoRoot = path.resolve(new URL('../../../../../', import.meta.url).pathname);
const hook = moduleApi.registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('/native/')) {
      return { url: pathToFileURL(path.join(repoRoot, 'lib/native/modules', specifier.slice('/native/'.length))).href, shortCircuit: true };
    }
    if (specifier.startsWith('/ui/')) {
      return { url: pathToFileURL(path.join(repoRoot, 'silk-ui/modules', specifier.slice('/ui/'.length))).href, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { IMPORTS: WINDOW_IMPORTS_FROM_NATIVE } = await import('../../../../../lib/native/modules/platform/window/browser/imports.js');
const { browserCapabilities, selectExecutionMode } = await import('./app-host.js');
const { WINDOW_IMPORTS, WorkerWindowHost } = await import('./worker-window-host.mjs');
const { createCanvasWorkerHost } = await import('./web-canvas-worker.js');
const { WebCompositor, decodeBrowserCommit } = await import('./web-compositor.mjs');

function uleb(n) {
  const out = [];
  let v = n >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v) b |= 0x80;
    out.push(b);
  } while (v);
  return out;
}
function sleb(n) {
  const out = [];
  let v = n | 0;
  let more = true;
  while (more) {
    let b = v & 0x7f;
    v >>= 7;
    if ((v === 0 && (b & 0x40) === 0) || (v === -1 && (b & 0x40) !== 0)) more = false;
    else b |= 0x80;
    out.push(b);
  }
  return out;
}
function str(s) {
  const b = [...Buffer.from(s, 'utf8')];
  return [...uleb(b.length), ...b];
}
function section(id, payload) { return [id, ...uleb(payload.length), ...payload]; }
function vec(items) { return [...uleb(items.length), ...items.flat()]; }

function f64const(v) {
  return [0x44, ...Buffer.from(new Float64Array([v]).buffer)];
}

function buildRealCanvasTestWasm(commitMetaBytes) {
  const I32 = 0x7f;
  const F64 = 0x7c;
  const types = vec([
    [0x60, ...vec([]), ...vec([I32])],                              // 0: () -> i32
    [0x60, ...vec([I32, I32]), ...vec([])],                          // 1: (i32, i32) -> ()
    [0x60, ...vec([]), ...vec([])],                                  // 2: () -> ()
    [0x60, ...vec([F64, I32]), ...vec([I32])],                       // 3: (f64, i32) -> i32
    [0x60, ...vec([I32, I32, F64, F64, F64, F64, I32]), ...vec([I32])], // 4: silk_window_open
  ]);
  const imports = vec([
    [...str('window'), ...str('silk_window_start'), 0x00, 0],        // fn 0
    [...str('window'), ...str('silk_window_open'), 0x00, 4],         // fn 1
    [...str('window'), ...str('silk_window_next_event'), 0x00, 3],   // fn 2
    [...str('silk_browser'), ...str('commit_meta'), 0x00, 1],        // fn 3
    [...str('silkui'), ...str('ready'), 0x00, 2],                    // fn 4
  ]);
  const functions = vec([0]); // fn 5: main() -> i32
  const memory = vec([[0x00, 1]]);
  const exports = vec([
    [...str('memory'), 0x02, 0],
    [...str('main'), 0x00, 5],
  ]);
  const mainBody = [
    0x00,
    // call silkui#ready()
    0x10, 4,
    // call silk_window_start(); drop
    0x10, 0, 0x1a,
    // call silk_window_open(0, 0, 800, 600, 0, 0, 2); drop
    0x41, 0, 0x41, 0,
    ...f64const(800), ...f64const(600), ...f64const(0), ...f64const(0),
    0x41, 2,
    0x10, 1, 0x1a,
    // poll next_event(0.0, 256); drop
    ...f64const(0),
    0x41, ...sleb(256),
    0x10, 2, 0x1a,
    // commit_meta(1024, len)
    0x41, ...sleb(1024), 0x41, ...sleb(commitMetaBytes.length), 0x10, 3,
    // return 0
    0x41, 0, 0x0b,
  ];
  const code = vec([[...uleb(mainBody.length), ...mainBody]]);
  const data = vec([[0x00, 0x41, ...sleb(1024), 0x0b, ...uleb(commitMetaBytes.length), ...commitMetaBytes]]);
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, types),
    ...section(2, imports),
    ...section(3, functions),
    ...section(5, memory),
    ...section(7, exports),
    ...section(10, code),
    ...section(11, data),
  ]);
}

function makeBinaryCommitHeader(windowId = 1, commitEpoch = 1n, consumedInputSeq = 7n) {
  const buf = new ArrayBuffer(52);
  const v = new DataView(buf);
  v.setUint32(0, 1, true);
  v.setUint32(4, windowId, true);
  v.setUint32(8, Number(commitEpoch & 0xffffffffn), true);
  v.setUint32(12, 0, true);
  v.setUint32(16, Number(consumedInputSeq & 0xffffffffn), true);
  v.setUint32(20, 0, true);
  v.setUint32(24, 800, true);
  v.setUint32(28, 600, true);
  v.setFloat32(32, 2.0, true);
  v.setUint32(36, 0, true);
  v.setUint32(40, 0, true);
  v.setUint32(44, 0, true);
  v.setUint32(48, 0, true);
  return new Uint8Array(buf);
}

test('WorkerWindowHost exposes exact 59 window#silk_window_* imports', () => {
  assert.deepEqual([...WINDOW_IMPORTS].sort(), [...WINDOW_IMPORTS_FROM_NATIVE].sort());
  const host = new WorkerWindowHost();
  for (const name of WINDOW_IMPORTS_FROM_NATIVE) {
    assert.equal(typeof host.imports[name], 'function', `missing import ${name}`);
  }
});

test('browserCapabilities and selectExecutionMode select worker without SAB and fall back cleanly to inline', () => {
  const noSab = browserCapabilities({
    navigator: { gpu: {} },
    WebAssembly: { Suspending() {}, promising() {} },
    Worker() {},
    OffscreenCanvas() {},
  });
  assert.equal(noSab.sharedArrayBuffer, false);
  assert.equal(noSab.wasmThreads, false);
  assert.equal(selectExecutionMode({ worker: 'auto', capabilities: noSab }), 'worker', 'Worker mode works without SAB/COOP-COEP');

  const withCoopCoep = browserCapabilities({
    navigator: { gpu: {} },
    WebAssembly: { Suspending() {}, promising() {} },
    Worker() {},
    OffscreenCanvas() {},
    SharedArrayBuffer() {},
    crossOriginIsolated: true,
  });
  assert.equal(withCoopCoep.wasmThreads, true);
  assert.equal(selectExecutionMode({ worker: 'auto', capabilities: withCoopCoep }), 'worker');

  const noWorker = browserCapabilities({
    navigator: { gpu: {} },
    WebAssembly: { Suspending() {}, promising() {} },
  });
  assert.equal(selectExecutionMode({ worker: 'auto', capabilities: noWorker }), 'inline', 'Falls back to inline when Worker/OffscreenCanvas missing');
  assert.equal(selectExecutionMode({ worker: 'auto', check: true, capabilities: noSab }), 'inline');
  assert.equal(selectExecutionMode({ worker: false, capabilities: noSab }), 'inline');
});

test('Worker group host co-locates WASM + JsHost and streams Transferable layerCommits + 1-in-flight backpressure', async () => {
  const channel = new MessageChannel();
  const compositor = new WebCompositor();
  const bitmaps = [];
  let onPresentRef = null;
  let jsRanInWorker = false;

  class MockWebGPUHost {
    table = { add() { return 1; }, get() {}, size: 0 };
    imports = {};
    constructor({ onPresent }) { onPresentRef = onPresent; }
    registerCanvas() {}
    attach() {}
  }
  class MockJsHost {
    imports = { ready() {}, settle() {}, pending: () => 0, take() {}, dispatch: () => 0, virtualRequest() {} };
  }

  const workerHost = createCanvasWorkerHost(channel.port2, {
    WebGPUHost: MockWebGPUHost,
    JsHost: MockJsHost,
    gpu: {},
    createOffscreenCanvas: (w, h, selector) => ({
      width: w,
      height: h,
      selector,
      transferToImageBitmap() {
        const b = { id: bitmaps.length + 1, width: w, height: h };
        bitmaps.push(b);
        return b;
      },
    }),
    loadApp: async () => { jsRanInWorker = true; },
  });

  try {
    const meta = makeBinaryCommitHeader(1, 1n, 9n);
    const wasm = buildRealCanvasTestWasm(meta);
    const receivedCommits = [];

    await new Promise((resolve, reject) => {
      channel.port1.addEventListener('message', (ev) => {
        const msg = ev.data;
        if (msg.type === 'layerCommit') {
          const decoded = msg.metaBuffer ? decodeBrowserCommit(msg.metaBuffer) : null;
          receivedCommits.push({ msg, decoded });
          const ack = compositor.applyCommit({
            ...(decoded ?? {}),
            windowId: msg.windowId,
            commitEpoch: msg.commitEpoch,
            baseEpoch: msg.baseEpoch,
            kind: msg.kind,
            consumedInputSeq: Math.max(msg.consumedInputSeq ?? 0, decoded?.consumedInputSeq ?? 0),
          }, msg.bitmap);
          channel.port1.postMessage({ type: 'commitAck', ack });
          compositor.present(16);
        } else if (msg.type === 'exit') {
          assert.equal(msg.status, 0);
          resolve();
        } else if (msg.type === 'error') {
          reject(new Error(msg.message));
        }
      });
      channel.port1.start();
      channel.port1.postMessage({
        type: 'init',
        wasmKind: 'bytes',
        wasm: wasm.buffer,
        app: 'mock://app.js',
        width: 800,
        height: 600,
        scaleFactor: 2,
        check: false,
        accessibility: false,
      }, [wasm.buffer]);
    });

    // Trigger back-to-back presents before commitAck arrives to verify 1-in-flight coalescing.
    onPresentRef('silk-window-1', {
      transferToImageBitmap: () => ({ id: 'in-flight-1', width: 800, height: 600 }),
    });
    const superseded = { id: 'superseded', closed: false, close() { this.closed = true; } };
    const kept = { id: 'kept', width: 800, height: 600 };
    onPresentRef('silk-window-1', { transferToImageBitmap: () => superseded });
    onPresentRef('silk-window-1', { transferToImageBitmap: () => kept });

    await new Promise(r => setTimeout(r, 30));

    assert.equal(jsRanInWorker, true, 'JS app ran inside the Worker group');
    assert.equal(superseded.closed, true, 'coalesced un-sent bitmap was closed cleanly');
    assert.ok(receivedCommits.length >= 2, 'subsequent commit flushed after commitAck');
    assert.equal(receivedCommits[0].decoded.viewportWidth, 800);
    assert.equal(receivedCommits[0].decoded.consumedInputSeq, 9);
    assert.equal(receivedCommits[0].msg.commitEpoch, 1);
    assert.equal(receivedCommits[1].msg.commitEpoch, 2);
  } finally {
    workerHost.stop();
    channel.port1.close();
    channel.port2.close();
    hook.deregister?.();
  }
});
