// Worker-side backend of modules/platform/window: implements all `window#silk_window_*`
// imports inside a Dedicated Web Worker with zero DOM dependencies. Window mutations travel
// to the main-thread shim via `postMessage`, while stamped events + frame ticks arrive back
// asynchronously. Works with JSPI (`WebAssembly.Suspending`) when available.

export const WINDOW_IMPORTS = [
  'silk_window_start', 'silk_window_backend', 'silk_window_open', 'silk_window_close',
  'silk_window_next_event', 'silk_window_event_text', 'silk_window_wake', 'silk_window_request_frame',
  'silk_window_content_size', 'silk_window_scale_factor', 'silk_window_raw_surface',
  'silk_window_set_title', 'silk_window_set_content_size', 'silk_window_set_min_content_size',
  'silk_window_set_visible', 'silk_window_focus', 'silk_window_minimize',
  'silk_window_toggle_full_screen', 'silk_window_start_window_drag', 'silk_window_set_cursor',
  'silk_window_set_cursor_image', 'silk_window_set_ime', 'silk_window_menu_begin_bar',
  'silk_window_menu_begin', 'silk_window_menu_end', 'silk_window_menu_action',
  'silk_window_menu_separator', 'silk_window_menu_system', 'silk_window_menu_commit',
  'silk_window_open_dialog', 'silk_window_save_dialog', 'silk_window_clipboard_read',
  'silk_window_clipboard_write', 'silk_window_clipboard_types', 'silk_window_clipboard_read_type',
  'silk_window_clipboard_begin', 'silk_window_clipboard_add', 'silk_window_clipboard_commit',
  'silk_window_appearance', 'silk_window_test_key', 'silk_window_test_mouse',
  'silk_window_test_preedit', 'silk_window_test_commit', 'silk_window_test_resize',
  'silk_window_test_ime_rect', 'silk_window_tray_begin', 'silk_window_tray_commit',
  'silk_window_tray_remove', 'silk_window_shortcut_register', 'silk_window_shortcut_unregister',
  'silk_window_notify', 'silk_window_test_drop', 'silk_window_context_menu_begin',
  'silk_window_context_menu_commit', 'silk_window_set_badge', 'silk_window_set_progress',
  'silk_window_open_url', 'silk_window_reveal_path', 'silk_window_start_file_drag',
];

export const WINDOW_EVENT = {
  REQUEST_FRAME: 1, RESIZED: 2, SCALE_FACTOR_CHANGED: 3, MOVED: 4, FOCUSED: 5, OCCLUDED: 6,
  CLOSE_REQUESTED: 7, FULL_SCREEN_CHANGED: 8, KEY_DOWN: 9, KEY_UP: 10, MODIFIERS_CHANGED: 11,
  TEXT_INPUT: 12, IME_PREEDIT: 13, MOUSE_MOVED: 14, MOUSE_DOWN: 15, MOUSE_UP: 16,
  MOUSE_ENTERED: 17, MOUSE_EXITED: 18, SCROLL: 19, PINCH: 20, MENU_ACTION: 21,
  DIALOG_CLOSED: 22, APPEARANCE_CHANGED: 23, QUIT_REQUESTED: 24, FILE_DRAG_ENTERED: 25,
  FILE_DRAG_MOVED: 26, FILE_DRAG_LEFT: 27, FILE_DROPPED: 28, GLOBAL_SHORTCUT: 29,
  TRAY_CLICKED: 30, NOTIFICATION_CLICKED: 31, CONTEXT_MENU_CLOSED: 32, TOUCH: 33,
};

const MENU = { BEGIN: 1, END: 2, ACTION: 3, SEPARATOR: 4, SYSTEM: 5 };
const BACKEND_BROWSER = 4;
const SURFACE_CANVAS = 5;
const CLIPBOARD_TYPES = ['text/plain', 'text/html', 'image/png'];

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createEventRecord(kind, window = 0) {
  return {
    kind, window, code: 0, named: 0, modifiers: 0, flags: 0, count: 0, phase: 0,
    x: 0, y: 0, dx: 0, dy: 0, value: 0, start: 0n, end: 0n, texts: [],
    inputSeq: 0, presentedEpoch: 0, gestureId: 0,
  };
}

/**
 * Worker-side `window` module host. Replaces DOM `WindowHost` when the Document/Engine group
 * executes inside a Dedicated Web Worker.
 */
export class WorkerWindowHost {
  constructor({ post = () => {}, width = 800, height = 600, scaleFactor = 1, appearance = 0 } = {}) {
    this.post = post;
    this.defaultWidth = width;
    this.defaultHeight = height;
    this.scale = scaleFactor || 1;
    this.appearance = appearance | 0;
    this.windows = new Map();
    this.nextId = 1;
    this.queue = [];
    this.current = [];
    this.pendingMenu = null;
    this.menu = [];
    this.clipboard = new Map();
    this.pendingClipboard = null;
    this.readCache = null;
    this.started = false;
    this.focused = 0;
    this.waiter = null;
    this.onWake = undefined;
    this.onOpenWindow = undefined;
    this.onCloseWindow = undefined;
    this.lastInputSeq = 0;
    this.lastPresentedEpoch = 0;
    this.activeGesture = null;
    this.exports = null;
    this.blocking = false;
    this.imports = Object.fromEntries(WINDOW_IMPORTS.map(name => [name, (...args) => this[name](...args)]));
  }

  attach(instance) {
    this.exports = instance.exports ?? instance;
    if (!(this.exports.memory instanceof WebAssembly.Memory)) {
      throw new TypeError('Silk wasm must export memory');
    }
  }

  get suspendingImports() {
    if (typeof WebAssembly?.Suspending !== 'function') {
      return { ...this.imports };
    }
    this.blocking = true;
    return {
      ...this.imports,
      silk_window_next_event: new WebAssembly.Suspending((t, p) => this.waitEvent(t, p)),
    };
  }

  view() { return new DataView(this.exports.memory.buffer); }
  bytes(ptr, length) { return new Uint8Array(this.exports.memory.buffer, ptr, length); }
  text(ptr, length) { return length ? decoder.decode(this.bytes(ptr, length)) : ''; }
  f64(ptr, value) { if (ptr) this.view().setFloat64(ptr, value, true); }

  push(record) {
    this.queue.push(record);
    if (this.waiter) {
      const wake = this.waiter;
      this.waiter = null;
      wake();
    }
    this.onWake?.();
  }

  enqueueStamped(record) {
    if (record.inputSeq && record.inputSeq > this.lastInputSeq) {
      this.lastInputSeq = record.inputSeq;
    }
    if (record.presentedEpoch && record.presentedEpoch > this.lastPresentedEpoch) {
      this.lastPresentedEpoch = record.presentedEpoch;
    }
    this.push(record);
  }

  consumedInputSeq() { return this.lastInputSeq; }

  write(ptr, record) {
    const view = this.view();
    const fields = ['kind', 'window', 'code', 'named', 'modifiers', 'flags', 'count', 'phase'];
    fields.forEach((field, i) => view.setUint32(ptr + i * 4, (record[field] ?? 0) >>> 0, true));
    ['x', 'y', 'dx', 'dy', 'value'].forEach((field, i) => view.setFloat64(ptr + 32 + i * 8, record[field] ?? 0, true));
    view.setBigUint64(ptr + 72, BigInt(record.start ?? 0n), true);
    view.setBigUint64(ptr + 80, BigInt(record.end ?? 0n), true);
    this.current = (record.texts ?? []).map(text => encoder.encode(text));
    if (record.gestureId) {
      this.activeGesture = {
        gestureId: record.gestureId,
        inputSeq: record.inputSeq ?? 0,
        windowId: record.window,
      };
    }
  }

  pop(ptr) {
    const record = this.queue.shift();
    if (!record) return 0;
    this.write(ptr, record);
    return 1;
  }

  waitEvent(timeout, ptr) {
    if (this.queue.length || timeout === 0) return this.pop(ptr);
    return new Promise(resolve => {
      let timer;
      const finish = () => {
        clearTimeout(timer);
        this.waiter = null;
        resolve(this.pop(ptr));
      };
      this.waiter = finish;
      if (timeout > 0) timer = setTimeout(finish, timeout * 1000);
    });
  }

  setViewport(id, width, height, scaleFactor) {
    if (scaleFactor && scaleFactor > 0) this.scale = scaleFactor;
    const win = this.windows.get(id);
    if (!win) {
      this.defaultWidth = width;
      this.defaultHeight = height;
      return;
    }
    if (width === win.width && height === win.height && !scaleFactor) return;
    win.width = width;
    win.height = height;
    const record = createEventRecord(WINDOW_EVENT.RESIZED, id);
    record.x = width;
    record.y = height;
    record.value = this.scale;
    this.push(record);
  }

  setClipboardSnapshot(entries) {
    const map = new Map();
    for (const [mime, buf] of entries ?? []) map.set(mime, new Uint8Array(buf));
    this.clipboard = map;
  }

  silk_window_start() {
    if (this.started) return 1;
    this.started = true;
    return 0;
  }

  silk_window_backend() { return this.started ? BACKEND_BROWSER : 0; }
  silk_window_appearance() { return this.appearance; }

  silk_window_open(titlePtr, titleLength, width, height, minWidth, minHeight, flags) {
    if (!this.started) return 0;
    const id = this.nextId++;
    const title = this.text(titlePtr, titleLength);
    const w = width > 0 ? width : this.defaultWidth;
    const h = height > 0 ? height : this.defaultHeight;
    const win = {
      id,
      title,
      width: w,
      height: h,
      minWidth,
      minHeight,
      visible: (flags & 2) !== 0,
      ime: { enabled: false, x: 0, y: 0, width: 0, height: 0 },
    };
    this.windows.set(id, win);
    if (!this.focused) this.focused = id;
    this.onOpenWindow?.(win);
    this.post({
      type: 'windowOpen',
      windowId: id,
      title,
      width: w,
      height: h,
      minWidth,
      minHeight,
      flags,
    });
    const resize = createEventRecord(WINDOW_EVENT.RESIZED, id);
    resize.x = w;
    resize.y = h;
    resize.value = this.scale;
    this.push(resize);
    this.silk_window_request_frame(id);
    return id;
  }

  silk_window_close(id) {
    if (!this.windows.has(id)) return;
    this.windows.delete(id);
    this.queue = this.queue.filter(r => r.window !== id);
    if (this.focused === id) this.focused = this.windows.keys().next().value ?? 0;
    this.onCloseWindow?.(id);
    this.post({ type: 'windowClose', windowId: id });
  }

  silk_window_next_event(timeout, ptr) { return this.pop(ptr); }

  silk_window_event_text(index, ptr, capacity) {
    const bytes = this.current[index];
    if (!bytes) return 0;
    if (ptr && capacity) this.bytes(ptr, Math.min(capacity, bytes.length)).set(bytes.subarray(0, capacity));
    return bytes.length;
  }

  silk_window_wake() {
    if (this.waiter) {
      const wake = this.waiter;
      this.waiter = null;
      wake();
    }
    this.onWake?.();
  }

  silk_window_request_frame(id) {
    if (this.windows.has(id)) this.post({ type: 'requestFrame', windowId: id });
  }

  silk_window_content_size(id, widthPtr, heightPtr) {
    const win = this.windows.get(id);
    this.f64(widthPtr, win ? win.width : 0);
    this.f64(heightPtr, win ? win.height : 0);
  }

  silk_window_scale_factor() { return this.scale; }

  silk_window_raw_surface(id, firstPtr, secondPtr, idPtr) {
    const view = this.view();
    if (firstPtr) view.setUint32(firstPtr, 0, true);
    if (secondPtr) view.setUint32(secondPtr, 0, true);
    if (idPtr) view.setBigUint64(idPtr, BigInt(this.windows.has(id) ? id : 0), true);
    return this.windows.has(id) ? SURFACE_CANVAS : 0;
  }

  silk_window_set_title(id, ptr, length) {
    const title = this.text(ptr, length);
    const win = this.windows.get(id);
    if (win) win.title = title;
    this.post({ type: 'setTitle', windowId: id, title });
  }

  silk_window_set_content_size(id, width, height) {
    const win = this.windows.get(id);
    if (!win) return;
    win.width = width;
    win.height = height;
    this.post({ type: 'setContentSize', windowId: id, width, height });
  }

  silk_window_set_min_content_size(id, width, height) {
    const win = this.windows.get(id);
    if (!win) return;
    win.minWidth = width;
    win.minHeight = height;
    this.post({ type: 'setMinContentSize', windowId: id, width, height });
  }

  silk_window_set_visible(id, visible) {
    const win = this.windows.get(id);
    if (!win) return;
    win.visible = !!visible;
    this.post({ type: 'setVisible', windowId: id, visible: !!visible });
  }

  silk_window_focus(id) {
    if (!this.windows.has(id)) return;
    this.focused = id;
    this.post({ type: 'focus', windowId: id });
  }

  silk_window_minimize() {}

  silk_window_toggle_full_screen(id) {
    if (this.windows.has(id)) this.post({ type: 'toggleFullScreen', windowId: id });
  }

  silk_window_start_window_drag() {}

  silk_window_set_cursor(id, cursor) {
    if (this.windows.has(id)) this.post({ type: 'setCursor', windowId: id, cursor });
  }

  silk_window_set_cursor_image(id, ptr, width, height, hotX, hotY, scale) {
    if (!this.windows.has(id)) return 0;
    const pixels = this.bytes(ptr, width * height * 4).slice().buffer;
    this.post({ type: 'setCursorImage', windowId: id, pixels, width, height, hotX, hotY, scale }, [pixels]);
    return 1;
  }

  silk_window_set_ime(id, enabled, x, y, width, height) {
    const win = this.windows.get(id);
    if (!win) return;
    win.ime = { enabled: !!enabled, x, y, width, height };
    this.post({ type: 'setIme', windowId: id, ...win.ime });
  }

  silk_window_menu_begin_bar() { this.pendingMenu = []; }
  silk_window_menu_begin(ptr, length) { this.pendingMenu?.push({ type: MENU.BEGIN, title: this.text(ptr, length) }); }
  silk_window_menu_end() { this.pendingMenu?.push({ type: MENU.END }); }
  silk_window_menu_action(ptr, length, action, keyKind, keyValue, modifiers, enabled, checked) {
    this.pendingMenu?.push({
      type: MENU.ACTION,
      title: this.text(ptr, length),
      action, keyKind, keyValue, modifiers, enabled: !!enabled, checked: !!checked,
    });
  }
  silk_window_menu_separator() { this.pendingMenu?.push({ type: MENU.SEPARATOR }); }
  silk_window_menu_system(item) { this.pendingMenu?.push({ type: MENU.SYSTEM, item }); }
  silk_window_menu_commit() {
    if (this.pendingMenu) {
      this.menu = this.pendingMenu;
      this.post({ type: 'menuCommit', menu: this.menu });
    }
    this.pendingMenu = null;
  }

  silk_window_open_dialog() { return 0; }
  silk_window_save_dialog() { return 0; }

  serveRead(ptr, capacity, read) {
    if (!ptr || !this.readCache) this.readCache = { bytes: read() };
    const bytes = this.readCache.bytes;
    if (!bytes) return -1n;
    if (ptr && capacity) this.bytes(ptr, Math.min(capacity, bytes.length)).set(bytes.subarray(0, capacity));
    if (ptr) this.readCache = null;
    return BigInt(bytes.length);
  }

  silk_window_clipboard_read(ptr, capacity) {
    return this.serveRead(ptr, capacity, () => this.clipboard.get('text/plain') ?? null);
  }

  silk_window_clipboard_write(ptr, length) {
    const copy = this.bytes(ptr, length).slice();
    this.clipboard = new Map([['text/plain', copy]]);
    this.post({ type: 'clipboardWrite', text: decoder.decode(copy) });
  }

  silk_window_clipboard_types(ptr, capacity) {
    return this.serveRead(ptr, capacity, () => {
      const types = CLIPBOARD_TYPES.filter(type => this.clipboard.has(type));
      return types.length ? encoder.encode(types.join('\n')) : null;
    });
  }

  silk_window_clipboard_read_type(mime, mimeLength, ptr, capacity) {
    const type = this.text(mime, mimeLength);
    return this.serveRead(ptr, capacity, () => this.clipboard.get(type) ?? null);
  }

  silk_window_clipboard_begin() { this.pendingClipboard = new Map(); }
  silk_window_clipboard_add(mime, mimeLength, ptr, length) {
    const type = this.text(mime, mimeLength);
    if (CLIPBOARD_TYPES.includes(type)) this.pendingClipboard?.set(type, this.bytes(ptr, length).slice());
  }
  silk_window_clipboard_commit() {
    const item = this.pendingClipboard ?? new Map();
    this.pendingClipboard = null;
    this.clipboard = item;
    const entries = [...item.entries()].map(([type, bytes]) => {
      const buf = bytes.slice().buffer;
      return [type, buf];
    });
    const transfer = entries.map(([, buf]) => buf);
    this.post({ type: 'clipboardCommit', entries }, transfer);
  }

  silk_window_tray_begin() {}
  silk_window_tray_commit() { return 0; }
  silk_window_tray_remove() {}
  silk_window_shortcut_register() { return 0; }
  silk_window_shortcut_unregister() {}
  silk_window_context_menu_begin() {}
  silk_window_context_menu_commit() { return 0; }
  silk_window_set_badge() { return 0; }
  silk_window_set_progress() { return 0; }
  silk_window_notify() { return 0; }

  silk_window_open_url(ptr, length) {
    const url = this.text(ptr, length);
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) return 0;
    this.post({ type: 'openUrl', url });
    return 1;
  }
  silk_window_reveal_path() { return 0; }
  silk_window_start_file_drag() { return 0; }

  silk_window_test_key(id, code, ptr, length, modifiers) {
    if (!this.windows.has(id)) return 0;
    const text = this.text(ptr, length);
    const down = createEventRecord(WINDOW_EVENT.KEY_DOWN, id);
    down.code = code;
    down.modifiers = modifiers;
    if (text) down.texts = [text];
    this.push(down);
    return 1;
  }

  silk_window_test_mouse(id, kind, button, x, y, dx, dy) {
    if (!this.windows.has(id)) return 0;
    const map = [WINDOW_EVENT.MOUSE_MOVED, WINDOW_EVENT.MOUSE_DOWN, WINDOW_EVENT.MOUSE_UP, WINDOW_EVENT.SCROLL];
    const r = createEventRecord(map[kind] ?? WINDOW_EVENT.SCROLL, id);
    r.code = button;
    r.x = x;
    r.y = y;
    r.dx = -dx;
    r.dy = -dy;
    this.push(r);
    return 1;
  }

  silk_window_test_preedit() { return 0; }
  silk_window_test_commit() { return 0; }
  silk_window_test_resize(id, width, height) {
    if (!this.windows.has(id)) return 0;
    this.setViewport(id, width, height);
    return 1;
  }
  silk_window_test_ime_rect(id, xPtr, yPtr, widthPtr, heightPtr) {
    const ime = this.windows.get(id)?.ime ?? { x: 0, y: 0, width: 0, height: 0 };
    this.f64(xPtr, ime.x);
    this.f64(yPtr, ime.y);
    this.f64(widthPtr, ime.width);
    this.f64(heightPtr, ime.height);
  }
  silk_window_test_drop() { return 0; }
}
