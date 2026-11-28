import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = await readFile(new URL('../js/silk-ui-dom.js', import.meta.url), 'utf8');
const { Page, selectDomMode, createDomWorkerHost } = await import(
  'data:text/javascript;base64,' +
    Buffer.from(source + '\nexport { Page };').toString('base64')
);

// Minimal WebAssembly binary encoder so tests execute real compiled WASM inside Worker host.
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
function section(id, payload) {
  return [id, ...uleb(payload.length), ...payload];
}
function vec(items) {
  return [...uleb(items.length), ...items.flat()];
}

const I32 = 0x7f;
const F64 = 0x7c;

function concatU8(chunks) {
  return Buffer.from(chunks.flatMap(c => [...c]));
}
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v >>> 0, 0);
  return b;
}
function f32(v) {
  const b = Buffer.alloc(4);
  b.writeFloatLE(v, 0);
  return b;
}
function wtext(s) {
  const b = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(b.length), b]);
}

function buildTestWasm(batchBytes, navigatePath = '/next') {
  // Batch placed at offset 1024, nav path at 2048, measure buffer at 3072, scratch at 4096.
  const navBytes = Buffer.from(navigatePath, 'utf8');
  // Types:
  // 0: (i32, i32) -> ()   [dom#apply, dom#navigate]
  // 1: (i32, i32) -> i32  [dom#measure]
  // 2: () -> i32          [silk_ui_open]
  // 3: (i32, i32, f64, f64, f64) -> f64 [silk_ui_call]
  const types = vec([
    [0x60, ...vec([I32, I32]), ...vec([])],
    [0x60, ...vec([I32, I32]), ...vec([I32])],
    [0x60, ...vec([]), ...vec([I32])],
    [0x60, ...vec([I32, I32, F64, F64, F64]), ...vec([F64])],
  ]);
  const imports = vec([
    [...str('dom'), ...str('apply'), 0x00, 0],
    [...str('dom'), ...str('measure'), 0x00, 1],
    [...str('dom'), ...str('navigate'), 0x00, 0],
  ]);
  // Functions: fn3 = silk_ui_open (type 2), fn4 = silk_ui_call (type 3)
  const functions = vec([2, 3]);
  // Memory: min 1 page (64 KiB)
  const memory = vec([[0x00, 1]]);
  // Globals: global 0 = mut i32 lastMeasuredOk (0), global 1 = mut i32 callsCount (0)
  const globals = vec([
    [I32, 0x01, 0x41, ...sleb(0), 0x0b],
    [I32, 0x01, 0x41, ...sleb(0), 0x0b],
  ]);
  const exports = vec([
    [...str('memory'), 0x02, 0],
    [...str('silk_ui_open'), 0x00, 3],
    [...str('silk_ui_call'), 0x00, 4],
    [...str('last_measured'), 0x03, 0],
    [...str('calls_count'), 0x03, 1],
  ]);

  // fn3: returns 1
  const openBody = [0x00, 0x41, ...sleb(1), 0x0b];

  // fn4(token=0, op=1, a=2, b=3, c=4) -> f64
  const callBody = [
    0x00, // 0 locals
    // global.set 1 (callsCount += 1)
    0x23, 1, 0x41, ...sleb(1), 0x6a, 0x24, 1,
    // if op == 0 (CALL_START): call dom#apply(1024, batchBytes.length); return 0.0
    0x20, 1, 0x41, ...sleb(0), 0x46, 0x04, 0x40,
      0x41, ...sleb(1024), 0x41, ...sleb(batchBytes.length), 0x10, 0,
      0x44, 0, 0, 0, 0, 0, 0, 0, 0, 0x0f,
    0x0b,
    // if op == 1 (CALL_SCRATCH): return 4096.0
    0x20, 1, 0x41, ...sleb(1), 0x46, 0x04, 0x40,
      0x44, ...Buffer.from(new Float64Array([4096]).buffer), 0x0f,
    0x0b,
    // if op == 5 (CALL_DEADLINE): return -1.0
    0x20, 1, 0x41, ...sleb(5), 0x46, 0x04, 0x40,
      0x44, ...Buffer.from(new Float64Array([-1]).buffer), 0x0f,
    0x0b,
    // if op == 6 (CALL_FRAMES): return 0.0
    0x20, 1, 0x41, ...sleb(6), 0x46, 0x04, 0x40,
      0x44, ...Buffer.from(new Float64Array([0]).buffer), 0x0f,
    0x0b,
    // if op == 3 (CALL_TICK): measure(1, 3072) -> global 0; return 0.0
    0x20, 1, 0x41, ...sleb(3), 0x46, 0x04, 0x40,
      0x41, ...sleb(1), 0x41, ...sleb(3072), 0x10, 1, 0x24, 0,
      0x44, ...Buffer.from(new Float64Array([0]).buffer), 0x0f,
    0x0b,
    // if op == 8 (CALL_POST): call dom#navigate(2048, navBytes.length) -> return 0.0
    0x20, 1, 0x41, ...sleb(8), 0x46, 0x04, 0x40,
      0x41, ...sleb(2048), 0x41, ...sleb(navBytes.length), 0x10, 2,
      0x44, ...Buffer.from(new Float64Array([0]).buffer), 0x0f,
    0x0b,
    // default: return 0.0
    0x44, 0, 0, 0, 0, 0, 0, 0, 0,
    0x0b,
  ];
  const code = vec([
    [...uleb(openBody.length), ...openBody],
    [...uleb(callBody.length), ...callBody],
  ]);
  const data = vec([
    [0x00, 0x41, ...sleb(1024), 0x0b, ...uleb(batchBytes.length), ...batchBytes],
    [0x00, 0x41, ...sleb(2048), 0x0b, ...uleb(navBytes.length), ...navBytes],
  ]);

  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    ...section(1, types),
    ...section(2, imports),
    ...section(3, functions),
    ...section(5, memory),
    ...section(6, globals),
    ...section(7, exports),
    ...section(10, code),
    ...section(11, data),
  ]);
}

function makeFakeDom() {
  const listeners = new Map();
  class FakeNode {
    constructor(tagName, nodeType = 1) {
      this.tagName = tagName;
      this.nodeName = tagName;
      this.nodeType = nodeType;
      this.attrs = new Map();
      this.childNodes = [];
      this.children = [];
      this.parentNode = null;
      this.parentElement = null;
      this.nextSibling = null;
      this.previousSibling = null;
      this.firstChild = null;
      this.lastChild = null;
      this.style = {
        values: new Map(),
        setProperty: (k, v, p) => this.style.values.set(k, [v, p]),
        removeProperty: k => this.style.values.delete(k),
      };
      this.dataset = {};
      this.data = '';
      this.value = '';
      this.textContent = '';
      this.isConnected = true;
      this.tabIndex = 0;
      this.disabled = false;
      this._listeners = new Map();
      this._rect = { left: 10, top: 20, right: 110, bottom: 60, width: 100, height: 40 };
    }
    setAttribute(k, v) { this.attrs.set(k, String(v)); if (k === 'id') this.id = String(v); }
    get attributes() { return [...this.attrs.entries()].map(([name, value]) => ({ name, value })); }
    getAttribute(k) { return this.attrs.get(k) ?? null; }
    hasAttribute(k) { return this.attrs.has(k); }
    removeAttribute(k) { this.attrs.delete(k); }
    getAttributeNames() { return [...this.attrs.keys()]; }
    append(...nodes) { for (const n of nodes) this.insertBefore(n, null); }
    prepend(...nodes) { for (let i = nodes.length - 1; i >= 0; i--) this.insertBefore(nodes[i], this.firstChild); }
    insertBefore(child, before) {
      child.remove();
      child.parentNode = this;
      child.parentElement = this;
      const idx = before ? this.childNodes.indexOf(before) : -1;
      if (idx >= 0) this.childNodes.splice(idx, 0, child);
      else this.childNodes.push(child);
      this.children = this.childNodes.filter(c => c.nodeType === 1);
      for (let i = 0; i < this.childNodes.length; i++) {
        this.childNodes[i].previousSibling = this.childNodes[i - 1] ?? null;
        this.childNodes[i].nextSibling = this.childNodes[i + 1] ?? null;
      }
      this.firstChild = this.childNodes[0] ?? null;
      this.lastChild = this.childNodes[this.childNodes.length - 1] ?? null;
      return child;
    }
    replaceChildren(...nodes) {
      for (const old of [...this.childNodes]) old.remove();
      this.append(...nodes);
    }
    replaceWith(next) {
      const parent = this.parentNode;
      if (!parent) return;
      parent.insertBefore(next, this);
      this.remove();
    }
    remove() {
      if (!this.parentNode) return;
      const list = this.parentNode.childNodes;
      const idx = list.indexOf(this);
      if (idx >= 0) list.splice(idx, 1);
      this.parentNode.children = list.filter(c => c.nodeType === 1);
      this.parentNode.firstChild = list[0] ?? null;
      this.parentNode.lastChild = list[list.length - 1] ?? null;
      this.parentNode = null;
      this.parentElement = null;
    }
    addEventListener(type, fn, opts) {
      if (typeof opts === 'object' && opts?.signal) {
        opts.signal.addEventListener?.('abort', () => this.removeEventListener(type, fn), { once: true });
      }
      let arr = this._listeners.get(type);
      if (!arr) this._listeners.set(type, (arr = []));
      arr.push(fn);
    }
    removeEventListener(type, fn) {
      const arr = this._listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    }
    dispatchEvent(event) {
      event.target ??= this;
      event.defaultPrevented ??= false;
      event.preventDefault ??= () => { if (event.cancelable !== false) event.defaultPrevented = true; };
      for (const fn of [...(this._listeners.get(event.type) ?? [])]) fn(event);
      if (!event.cancelBubble && this.parentNode && this.parentNode !== this) {
        this.parentNode.dispatchEvent(event);
      }
      return !event.defaultPrevented;
    }
    querySelectorAll() { return []; }
    closest() { return null; }
    contains(other) {
      for (let at = other; at; at = at.parentNode) if (at === this) return true;
      return false;
    }
    getBoundingClientRect() { return this._rect; }
    getClientRects() { return [this._rect]; }
    matches() { return false; }
    focus() { doc.activeElement = this; }
    blur() { if (doc.activeElement === this) doc.activeElement = null; }
  }

  const head = new FakeNode('HEAD');
  const body = new FakeNode('BODY');
  const root = new FakeNode('DIV');
  root.clientWidth = 800;
  root.clientHeight = 600;
  root._rect = { left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 };
  body.append(root);

  const doc = {
    head,
    body,
    documentElement: new FakeNode('HTML'),
    activeElement: null,
    createElement(tag) {
      const el = new FakeNode(tag.toUpperCase(), 1);
      if (tag === 'style') el.sheet = { cssRules: [], insertRule: (r, idx) => { el.sheet.cssRules.splice(idx, 0, { style: el.style }); return idx; }, deleteRule: idx => el.sheet.cssRules.splice(idx, 1) };
      return el;
    },
    createTextNode(text) {
      const t = new FakeNode('#text', 3);
      t.data = text;
      return t;
    },
    createTreeWalker() { return { nextNode: () => null }; },
  };
  const win = {
    innerWidth: 800,
    innerHeight: 600,
    devicePixelRatio: 1,
    addEventListener(type, fn, opts) {
      if (typeof opts === 'object' && opts?.signal) {
        opts.signal.addEventListener?.('abort', () => win.removeEventListener(type, fn), { once: true });
      }
      let arr = listeners.get(type);
      if (!arr) listeners.set(type, (arr = []));
      arr.push(fn);
    },
    removeEventListener(type, fn) {
      const arr = listeners.get(type);
      if (!arr) return;
      const idx = arr.indexOf(fn);
      if (idx >= 0) arr.splice(idx, 1);
    },
    dispatchEvent(event) {
      event.defaultPrevented = false;
      event.preventDefault = () => { if (event.cancelable !== false) event.defaultPrevented = true; };
      for (const fn of [...(listeners.get(event.type) ?? [])]) fn(event);
      return !event.defaultPrevented;
    },
  };
  return { document: doc, window: win, root };
}

test('selectDomMode keeps main-thread mode for SSR hydration and chooses worker otherwise without SAB', () => {
  assert.equal(selectDomMode({ worker: 'auto', hasSsrNodes: false, hasCustomImports: false, hasWorker: true }), 'worker');
  assert.equal(selectDomMode({ worker: 'auto', hasSsrNodes: true, hasCustomImports: false, hasWorker: true }), 'main');
  assert.equal(selectDomMode({ worker: 'auto', hasSsrNodes: false, hasCustomImports: true, hasWorker: true }), 'main');
  assert.equal(selectDomMode({ worker: 'auto', hasSsrNodes: false, hasCustomImports: false, hasWorker: false }), 'main');
  assert.equal(selectDomMode({ worker: false, hasSsrNodes: false, hasCustomImports: false, hasWorker: true }), 'main');
  assert.equal(selectDomMode({ worker: true, hasSsrNodes: true, hasCustomImports: false, hasWorker: true }), 'worker');
});

test('loom-dom Worker host transfers wire.silk batches, preserves sync preventDefault under stall, and handles measure/navigate/post', async () => {
  const prevGlobals = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    history: globalThis.history,
    NodeFilter: globalThis.NodeFilter,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
  };
  const { document, window, root } = makeFakeDom();
  const pushedHistory = [];
  globalThis.document = document;
  globalThis.window = window;
  globalThis.location = { pathname: '/', search: '', hash: '', origin: 'https://example.test' };
  globalThis.history = { pushState: (_, __, url) => pushedHistory.push(url) };
  globalThis.NodeFilter = { SHOW_ELEMENT: 1, SHOW_COMMENT: 128 };
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};

  let page = null;
  let channel = null;
  let workerHost = null;
  try {
    channel = new MessageChannel();
    let stallQueue = null;
    const workerSideMessages = [];
    // Wrap port2 so we can simulate a stalled Worker while testing synchronous main-thread preventDefault.
    workerHost = createDomWorkerHost({
      postMessage: (msg, transfer) => channel.port2.postMessage(msg, transfer),
      addEventListener: (type, fn) => channel.port2.addEventListener(type, (ev) => {
        workerSideMessages.push(ev.data);
        if (stallQueue) { stallQueue.push(() => fn(ev)); return; }
        fn(ev);
      }),
      removeEventListener: (type, fn) => channel.port2.removeEventListener(type, fn),
      start: () => channel.port2.start(),
    });

    // Wire batch:
    // - Create node 1 (Div, kind=0)
    // - Create node 2 (Input, kind=4)
    // - Attribute 1 PreventRules (code 23, actions=2 PREVENT_SCROLL, 1 keyRule preventing Ctrl+KeyK)
    // - Attribute 1 Href (code 16, "/docs")
    // - Attribute 2 EditMode (code 25, ownership=2 AppOwned)
    // - Root 0 -> 1
    // - Insert 1 <- 2 before 0
    // - SubscribeGeometry (45) for [1]
    const batch = Buffer.concat([
      Buffer.from([1]), u32(1), Buffer.from([0]),
      Buffer.from([1]), u32(2), Buffer.from([4]),
      Buffer.from([9]), u32(1), Buffer.from([23]), u32(2), u32(1),
        Buffer.from([0, 1]), wtext('KeyK'), u32(2), u32(2), u32(0), Buffer.from([1, 0]),
      Buffer.from([9]), u32(1), Buffer.from([16]), wtext('/docs'),
      Buffer.from([9]), u32(2), Buffer.from([25]), Buffer.from([2]), u32(0), Buffer.from([0]), wtext(''), Buffer.from([0, 0]),
      Buffer.from([11]), u32(0), u32(1),
      Buffer.from([2]), u32(1), u32(2), u32(0),
      Buffer.from([45]), u32(1), u32(1),
    ]);

    const wasmBytes = buildTestWasm(batch, '/next-route');
    const transferredBuffers = [];
    const rawPost = channel.port1.postMessage.bind(channel.port1);
    channel.port1.postMessage = (msg, transfer) => {
      if (transfer?.length) transferredBuffers.push(...transfer);
      return rawPost(msg, transfer);
    };

    page = new Page(root, { fonts: {}, loaders: {}, base: '' });
    await page.startWorker(channel.port1, { kind: 'bytes', value: wasmBytes.buffer, transfer: [wasmBytes.buffer] });
    assert.equal(page.mode, 'worker');
    assert.equal(page.nodes.get(1).tagName, 'A');
    assert.equal(page.nodes.get(1).getAttribute('href'), '/docs');
    assert.equal(page.nodes.get(2).tagName, 'INPUT');
    assert.equal(page.geometryNodes.has(1), true);

    // Wait a tick so geometry arrives at worker, then run CALL_TICK to test dom#measure from cached geometry.
    await new Promise(r => setTimeout(r, 15));
    channel.port1.postMessage({ type: 'tick', now: 1.5, frame: false });
    await new Promise(r => setTimeout(r, 15));

    // Stall worker completely, verify synchronous preventDefault works without waiting on worker!
    stallQueue = [];

    const wheelEv = { type: 'wheel', target: page.nodes.get(1), clientX: 20, clientY: 30, deltaX: 0, deltaY: 120, cancelable: true };
    page.nodes.get(1).dispatchEvent(wheelEv);
    assert.equal(wheelEv.defaultPrevented, true, 'wheel PREVENT_SCROLL fires synchronously during Worker stall');

    const keyEv = { type: 'keydown', target: page.nodes.get(2), key: 'k', code: 'KeyK', ctrlKey: true, cancelable: true };
    window.dispatchEvent(keyEv);
    assert.equal(keyEv.defaultPrevented, true, 'Ctrl+KeyK PreventRule fires synchronously during Worker stall');

    const beforeInputEv = { type: 'beforeinput', target: page.nodes.get(2), data: 'x', inputType: 'insertText', cancelable: true };
    page.nodes.get(2).dispatchEvent(beforeInputEv);
    assert.equal(beforeInputEv.defaultPrevented, true, 'AppOwned beforeinput prevented synchronously during Worker stall');

    const clickEv = { type: 'click', target: page.nodes.get(1), button: 0, clientX: 15, clientY: 25, cancelable: true };
    page.nodes.get(1).dispatchEvent(clickEv);
    assert.equal(clickEv.defaultPrevented, true, 'internal href="/docs" click prevented synchronously during Worker stall');

    // Unblock worker and verify queued messages (incl. post -> navigate) arrive in order.
    const queued = stallQueue;
    stallQueue = null;
    for (const run of queued) run();
    page.post('route', 'go');
    await new Promise(r => setTimeout(r, 20));
    assert.deepEqual(pushedHistory, ['/next-route']);
    assert.ok(transferredBuffers.some(b => b.byteLength === 0), 'sent ArrayBuffers were transferred (zero-copy detach)');
  } finally {
    page?.close();
    workerHost?.stop();
    channel?.port1?.close();
    channel?.port2?.close();
    Object.assign(globalThis, prevGlobals);
  }
});
