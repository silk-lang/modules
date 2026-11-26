// Runs a ui-js application in the page, on the browser's own JavaScript engine, against the
// wasm build of the UI tree in ../app (the web-canvas target of JavaScript frameworks).
//
//   import { runJsApp } from '/ui/js/web/browser/js-host.js';
//   await runJsApp({ wasm: '/app.wasm', app: '/app.js', container: document.body });
//
// The application's bundle is the one a window runs: @silkui/core and the framework above it
// call the `__ui` functions, and this file provides them. A node call is written into one
// byte buffer and returns; the wasm's client (../src/lib.silk) takes the buffer on every turn
// of the window's loop and applies it as one batch (the encoding is ../src/wire.silk). Event
// records come the other way, one `dispatch` import each, before the tree's default action.
//
// The wasm waits through JSPI, so JavaScript never calls into its loop: `ready` and `settle`
// are the imports that suspend it, for the application module to run and for the promise jobs
// a dispatch queued. Calls made outside a turn (a timer, a fetch, an animation frame) ask the
// window for a frame. Timers, animation frames, fetch, console and the clipboard are the
// browser's own, so what an animation frame callback changes is painted in the next frame.
import { runApp, unsupported } from '/ui/tree/window/browser/app-host.js';
import { CANVAS_USAGE } from '/ui/tree/window/browser/page-canvases.mjs';

export { unsupported };

/** Opcodes of the calls, as ../src/wire.silk reads them. */
const OP = {
  create: 1, append: 2, insertBefore: 3, root: 4, setText: 5, listen: 6, style: 7, clearStyle: 8,
  attribute: 9, valueRange: 10, focus: 11, remove: 12, destroy: 13, scrollTo: 14, select: 15,
  fontFamily: 16, defineIcon: 17, source: 18, release: 19, keyframe: 20, keyframes: 21,
  richText: 22, mark: 23, atomStyle: 24, format: 25, insertAtom: 26, styleSheet: 27, load: 28,
  capture: 29, svgInsert: 30, svgRemove: 31, svgAttribute: 32, surface: 33, canvasFrame: 34,
  virtualList: 35, virtualItems: 36, clearVirtualList: 37,
};

// The attribute names the tree has besides `role` and `aria-*` (ui-js-calls `attributeOf`):
// any other throws a TypeError, as in a window.
const ATTRIBUTES = new Set([
  'element', 'tabIndex', 'disabled', 'focusTrap', 'multiline', 'readOnly', 'checked', 'selected', 'expanded',
  'indeterminate', 'label', 'testId', 'inert', 'id', 'class', 'className', 'lang', 'dir', 'placeholder', 'href', 'transition', 'cursor',
]);
// HTML attributes the tree keeps as text for selectors (ui-protocol's `isHtmlAttribute`).
for (const name of [
  'abbr', 'accept', 'accept-charset', 'accesskey', 'action', 'align', 'allow', 'allowfullscreen', 'async',
  'autocapitalize', 'autocomplete', 'autocorrect', 'autofocus', 'autoplay', 'bgcolor', 'border', 'charset',
  'cite', 'color', 'cols', 'content', 'contenteditable', 'controls', 'coords', 'crossorigin', 'datetime',
  'decoding', 'default', 'defer', 'dirname', 'download', 'draggable', 'enctype', 'enterkeyhint', 'face',
  'for', 'form', 'formaction', 'formmethod', 'formnovalidate', 'formtarget', 'frameborder', 'headers',
  'height', 'hidden', 'high', 'hreflang', 'http-equiv', 'inputmode', 'integrity', 'is', 'itemprop',
  'itemscope', 'itemtype', 'kind', 'list', 'loading', 'loop', 'low', 'max', 'maxlength', 'media', 'method',
  'min', 'minlength', 'multiple', 'muted', 'name', 'nomodule', 'novalidate', 'open', 'optimum', 'pattern',
  'ping', 'playsinline', 'popover', 'popovertarget', 'poster', 'preload', 'referrerpolicy', 'rel',
  'required', 'reversed', 'rows', 'sandbox', 'scope', 'scrolling', 'shape', 'size', 'sizes', 'slot',
  'spellcheck', 'srcdoc', 'srclang', 'srcset', 'step', 'summary', 'target', 'title', 'translate', 'type',
  'usemap', 'valign', 'width', 'wrap', 'xmlns', 'part', 'nowrap',
]) ATTRIBUTES.add(name);

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** The calls the page made since the wasm last took them. */
class Calls {
  bytes = new Uint8Array(1 << 16);
  view = new DataView(this.bytes.buffer);
  length = 0;

  reserve(more) {
    if (this.length + more <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.length + more) size *= 2;
    const bytes = new Uint8Array(size);
    bytes.set(this.bytes.subarray(0, this.length));
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer);
  }

  op(code, id) {
    this.reserve(5);
    this.bytes[this.length] = code;
    this.view.setUint32(this.length + 1, id >>> 0, true);
    this.length += 5;
  }

  byte(value) {
    this.reserve(1);
    this.bytes[this.length++] = value;
  }

  u32(value) {
    this.reserve(4);
    this.view.setUint32(this.length, value >>> 0, true);
    this.length += 4;
  }

  f64(value) {
    this.reserve(8);
    this.view.setFloat64(this.length, Number(value) || 0, true);
    this.length += 8;
  }

  text(value) {
    const string = value == null ? '' : String(value);
    // UTF-8 takes at most three bytes per UTF-16 unit.
    this.reserve(4 + string.length * 3);
    const { written } = encoder.encodeInto(string, this.bytes.subarray(this.length + 4));
    this.view.setUint32(this.length, written, true);
    this.length += 4 + written;
  }

  // An attribute value as ui-js-calls `Arg` takes it.
  value(value) {
    if (typeof value === 'number') { this.byte(1); this.f64(value); }
    else if (typeof value === 'string') { this.byte(2); this.text(value); }
    else if (value === false) this.byte(3);
    else if (value == null) this.byte(0);
    else this.byte(4);
  }
}

const NO_SURFACE = 0xffffffff;

/**
 * What `getContext("webgpu")` of a canvas node gives in the page: the browser's own context
 * of a canvas that is not in the document. The application draws it with the browser's
 * WebGPU on a device of its own, and the window's renderer shows the picture in the node
 * (`PageCanvases` in app-host.js copies it across at the next frame).
 */
function canvasContext(host, node) {
  const page = new OffscreenCanvas(Math.max(1, node.width | 0), Math.max(1, node.height | 0));
  const context = page.getContext('webgpu');
  if (!context) return null;
  const surface = host.canvases.open(page);
  let opaque = true;
  let configured = false;
  let announced = false;
  const show = () => {
    host.write(OP.surface, node.nodeId);
    const calls = host.calls;
    calls.u32(configured ? surface : NO_SURFACE); calls.u32(page.width); calls.u32(page.height); calls.byte(opaque ? 1 : 0);
    announced = false;
  };
  const { configure, unconfigure, getCurrentTexture } = context;
  // The node the context draws for, as `context.canvas` of a canvas element.
  Object.defineProperty(context, 'canvas', { value: node, configurable: true });
  context.configure = configuration => {
    // The window's renderer may have to read the picture back (page-canvases.mjs).
    configure.call(context, { ...configuration, usage: (configuration.usage ?? 0x10) | CANVAS_USAGE });
    opaque = (configuration.alphaMode ?? 'opaque') === 'opaque';
    configured = true;
    host.canvases.configured(surface, configuration.device, configuration.format, opaque);
    show();
  };
  context.unconfigure = () => {
    unconfigure.call(context);
    configured = false;
    show();
  };
  context.getCurrentTexture = () => {
    const texture = getCurrentTexture.call(context);
    host.canvases.drawn(surface, texture);
    // One call per turn has the window draw a frame with the new picture.
    if (!announced) {
      announced = true;
      host.write(OP.canvasFrame, node.nodeId);
      queueMicrotask(() => { announced = false; });
    }
    return texture;
  };
  // The node's `width` or `height` changed: the canvas takes the new size, which clears it.
  context._resized = () => {
    page.width = Math.max(1, node.width | 0);
    page.height = Math.max(1, node.height | 0);
    if (configured) show();
  };
  return context;
}

/**
 * The page's side of one application: the `__ui` functions and the `silkui` imports of the
 * wasm. Making one installs `globalThis.__ui`, so make it before the application's bundle runs.
 */
export class JsHost {
  calls = new Calls();
  instance = null;
  windowHost = null;
  ran = null;
  wakeQueued = false;
  dispatched = false;
  /** The page's GPU canvases (`PageCanvases` of app-host.js), once the app has started. */
  canvases = null;
  contexts = new WeakMap();

  constructor() {
    const calls = this.calls;
    const host = this;
    const write = this.write = (code, id) => {
      calls.op(code, id);
      host.queueWake();
    };
    this.ui = {
      create(id, kind) { write(OP.create, id); calls.u32(kind); },
      append(parent, child) { write(OP.append, parent); calls.u32(child); },
      insertBefore(parent, child, before) { write(OP.insertBefore, parent); calls.u32(child); calls.u32(before); },
      root(id) { write(OP.root, id); },
      setText(id, value) { write(OP.setText, id); calls.text(value); },
      listen(id, flags) { write(OP.listen, id); calls.u32(flags); },
      style(id, css, state) { write(OP.style, id); calls.u32(state); calls.text(css); },
      styleSheet(operation, id, bytes) {
        if (operation < 0 || operation > 3 || (operation !== 0 && (id < 1 || id >= 0x80000000))) throw new TypeError('invalid stylesheet operation');
        if (operation !== 3) host.validateStyleSheet(bytes);
        if (operation === 0) return;
        write(OP.styleSheet, operation); calls.u32(id); calls.text(bytes);
      },
      clearStyle(id, state) { write(OP.clearStyle, id); calls.u32(state); },
      attribute(id, name, value, max, now) {
        name = String(name);
        if (name === 'valueRange') {
          write(OP.valueRange, id);
          calls.byte(typeof value === 'number' ? 1 : 0);
          calls.f64(value); calls.f64(max); calls.f64(now);
          return undefined;
        }
        // Whether the tree has a role or ARIA text cannot wait for the wasm: it reports the
        // ones it does not have on the console instead.
        const known = name === 'role' || /^(?:aria|data)-[a-z0-9_.:-]+$/.test(name);
        if (!known && !ATTRIBUTES.has(name)) throw new TypeError(`the tree has no attribute '${name}'`);
        write(OP.attribute, id);
        calls.text(name);
        calls.value(value);
        return known ? true : undefined;
      },
      focus(id) { write(OP.focus, id); },
      capture(id) { write(OP.capture, id); },
      remove(id) { write(OP.remove, id); },
      destroy(id) { write(OP.destroy, id); },
      scrollTo(id, x, y) { write(OP.scrollTo, id); calls.f64(x); calls.f64(y); },
      virtualList(id, count, estimate, overscan, gap, revision) {
        if (count === undefined) { write(OP.clearVirtualList, id); return; }
        write(OP.virtualList, id); calls.u32(count); calls.f64(estimate); calls.f64(overscan); calls.f64(gap); calls.f64(revision);
      },
      virtualItems(id, ...pairs) {
        write(OP.virtualItems, id); calls.u32(pairs.length / 2);
        for (const value of pairs) calls.u32(value);
      },
      select(id, anchor, focus) { write(OP.select, id); calls.u32(anchor); calls.u32(focus); },
      fontFamily(id, names) { write(OP.fontFamily, id); calls.text(names); },
      defineIcon(resource, markup) { write(OP.defineIcon, resource); calls.text(markup); },
      source(id, resource) { write(OP.source, id); calls.u32(resource); },
      svgInsert(id, element, tag, parent, before) { write(OP.svgInsert, id); calls.u32(element); calls.text(tag); calls.u32(parent); calls.u32(before < 0 ? 0xffffffff : before); },
      svgRemove(id, element) { write(OP.svgRemove, id); calls.u32(element); },
      svgAttribute(id, element, name, value) { write(OP.svgAttribute, id); calls.u32(element); calls.text(name); calls.byte(typeof value === 'string' ? 1 : 0); calls.text(typeof value === 'string' ? value : ''); },
      load(resource, url, icon) { write(OP.load, resource); calls.text(url); calls.byte(icon ? 1 : 0); },
      release(resource) { write(OP.release, resource); },
      keyframe(offset, css) { calls.byte(OP.keyframe); calls.f64(offset); calls.text(css); host.queueWake(); },
      keyframes(name) { calls.byte(OP.keyframes); calls.text(name); host.queueWake(); },
      richText(id, value, marks, atoms) { write(OP.richText, id); calls.text(value); calls.text(marks); calls.text(atoms); },
      mark(id, mark, css) { write(OP.mark, id); calls.u32(mark); calls.text(css); },
      atomStyle(id, kind, css) { write(OP.atomStyle, id); calls.u32(kind); calls.text(css); },
      format(id, mark, on) { write(OP.format, id); calls.u32(mark); calls.byte(on ? 1 : 0); },
      insertAtom(id, start, end, atom) { write(OP.insertAtom, id); calls.u32(start); calls.u32(end); calls.text(atom); },
      markdown: (text, flags) => this.markdown(text, flags),
      svgMeasure: (op, packed, distance) => this.svgMeasure(op, packed, distance),
      // WebGPU is the browser's own (`navigator.gpu`); a canvas node asks here for its context.
      gpuLoad: () => (this.canvases && navigator.gpu && typeof OffscreenCanvas === 'function' ? this.gpu : null),
      log(level, text) { (level >= 3 ? console.error : level === 2 ? console.warn : console.log)(text); },
      now: () => performance.now(),
      // The page's JavaScript heap has no standard measure: only the wasm tree's memory counts.
      memoryUsage: () => this.instance?.exports.memory.buffer.byteLength ?? 0,
    };
    this.gpu = {
      context: node => {
        let context = this.contexts.get(node);
        if (context === undefined) this.contexts.set(node, (context = canvasContext(this, node)));
        return context;
      },
    };
    globalThis.__ui = this.ui;
    this.imports = {
      pending: () => calls.length,
      virtualRequest: (port, ptr, count) => {
        this.ui.virtualRequest?.(port, ...new Uint32Array(this.memory().buffer, ptr, count));
      },
      take: (pointer, length) => {
        new Uint8Array(this.memory().buffer, pointer, length).set(calls.bytes.subarray(0, length));
        calls.length = 0;
      },
      dispatch: (kind, target, a, b, modifiers, d, e, strings, first, second, third, fourth, present) => {
        const bytes = new Uint8Array(this.memory().buffer, strings, first + second + third + fourth);
        const text = (start, length) => decoder.decode(bytes.subarray(start, start + length));
        this.dispatched = true;
        try {
          return this.ui.dispatch?.(kind, target, a, b, modifiers, d, e,
            present & 1 ? text(0, first) : undefined,
            present & 2 ? text(first, second) : undefined,
            text(first + second, third),
            text(first + second + third, fourth)) ? 1 : 0;
        } catch (error) {
          reportError(error);
          return 0;
        }
      },
      ready: new WebAssembly.Suspending(() => this.ran),
      settle: new WebAssembly.Suspending(async () => {
        // The promise jobs a listener queued (a framework's render) ran before this one.
        await null;
        await null;
        this.report();
      }),
    };
  }

  memory() {
    return this.instance.exports.memory;
  }

  /** An exception a listener threw: @silkui/core keeps it for the host, as in a window. */
  report() {
    if (!this.dispatched) return;
    this.dispatched = false;
    try {
      this.ui.takeError?.();
    } catch (error) {
      reportError(error);
    }
  }

  /** Has the window's loop take the calls soon, when they were made outside its turn. */
  queueWake() {
    if (this.wakeQueued) return;
    this.wakeQueued = true;
    queueMicrotask(() => {
      this.wakeQueued = false;
      if (this.calls.length > 0) this.wake();
    });
  }

  wake() {
    const windows = this.windowHost?.windows;
    if (!windows) return;
    for (const window of windows.values()) this.windowHost.frame(window);
  }

  validateStyleSheet(text) {
    const exports = this.instance?.exports;
    if (!exports) throw new Error('Stylesheets are available once the page has started the app');
    const source = encoder.encode(String(text));
    if (source.length > 89478488) throw new RangeError('Compiled stylesheet exceeds the size limit');
    const pointer = exports.webgpu_alloc(source.length);
    if (!pointer && source.length) throw new Error('Stylesheet validation ran out of memory');
    try {
      new Uint8Array(exports.memory.buffer, pointer, source.length).set(source);
      if (!exports.silkui_validate_stylesheet(pointer, source.length)) throw new TypeError('invalid compiled stylesheet');
    } finally { exports.webgpu_free(pointer, source.length); }
  }

  svgMeasure(op, packed, distance) {
    const exports = this.instance?.exports;
    if (!exports?.silkui_svg_measure) return op === 1 ? '0' : op === 2 ? '0 0' : '0 0 0 0';
    const source = encoder.encode(String(packed));
    const pointer = exports.webgpu_alloc(source.length);
    new Uint8Array(exports.memory.buffer, pointer, source.length).set(source);
    const result = exports.silkui_svg_measure(pointer, source.length, op, Number(distance) || 0);
    exports.webgpu_free(pointer, source.length);
    if (!result) throw new Error('svg measuring ran out of memory');
    const length = new DataView(exports.memory.buffer).getUint32(result, true);
    const answer = decoder.decode(new Uint8Array(exports.memory.buffer, result + 4, length));
    exports.webgpu_free(result, length + 4);
    return answer;
  }

  markdown(text, flags) {
    const exports = this.instance?.exports;
    if (!exports) throw new Error('parseMarkdown runs once the page has started the app');
    const source = encoder.encode(String(text));
    const pointer = exports.webgpu_alloc(source.length);
    new Uint8Array(exports.memory.buffer, pointer, source.length).set(source);
    const result = exports.silkui_markdown(pointer, source.length, flags);
    exports.webgpu_free(pointer, source.length);
    if (!result) throw new Error('parseMarkdown ran out of memory');
    const length = new DataView(exports.memory.buffer).getUint32(result, true);
    const json = decoder.decode(new Uint8Array(exports.memory.buffer, result + 4, length));
    exports.webgpu_free(result, length + 4);
    return json;
  }
}

/**
 * Starts the wasm and then the application, and resolves with `main`'s exit status when the
 * window closes. `app` is the bundle's URL, or a function that imports it. The other options
 * are `runApp`'s (app-host.js). The application runs while the wasm waits for the GPU, so
 * building its first tree overlaps starting the renderer.
 */
export function runJsApp({ app, ...options }) {
  const host = new JsHost();
  return runApp({
    ...options,
    imports: { ...options.imports, silkui: host.imports },
    started: ({ instance, windowHost, canvases }) => {
      host.instance = instance;
      host.windowHost = windowHost;
      host.canvases = canvases;
      canvases.wake = () => host.wake();
      // After `main` first suspends: `ready` waits for it.
      host.ran = Promise.resolve()
        .then(() => (typeof app === 'function' ? app() : import(new URL(app, location.href).href)))
        .then(() => undefined, error => { reportError(error); });
    },
  });
}
