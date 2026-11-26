// The web APIs a ui-js realm has beyond the prelude's: Blob, File, FormData, base64, text encoding, crypto random
// values, events (and unhandledrejection on the global object), matchMedia, user timing, setImmediate, idle callbacks and the console's timers. The
// prelude evaluates this on the first use of one of them, so realms that use none start as
// fast as before. It is a function of `__ui` and the prelude's shared console state, and
// returns the APIs by their global names. Edit it, then run `silk task embed-assets`.
(function (native, shared) {
  const entries = [];
  const entry = (name, entryType, startTime, duration, detail) => ({ name, entryType, startTime, duration, detail: detail ?? null, toJSON() { return { ...this }; } });
  const markTime = (name) => {
    if (typeof name === "number") return name;
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].entryType === "mark" && entries[i].name === name) return entries[i].startTime;
    throw new SyntaxError("there is no mark named '" + name + "'");
  };
  const clear = (type, name) => {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].entryType === type && (name === undefined || entries[i].name === name)) entries.splice(i, 1);
  };
  const performance = {
    mark(name, options) {
      const mark = entry(String(name), "mark", options?.startTime ?? native.now(), 0, options?.detail);
      entries.push(mark);
      return mark;
    },
    measure(name, start, end) {
      const options = typeof start === "object" && start !== null ? start : { start, end };
      const to = options.end !== undefined ? markTime(options.end) : options.duration !== undefined ? markTime(options.start ?? 0) + options.duration : native.now();
      const from = options.start !== undefined ? markTime(options.start) : options.duration !== undefined ? to - options.duration : 0;
      const measure = entry(String(name), "measure", from, to - from, options.detail);
      entries.push(measure);
      return measure;
    },
    getEntries: () => entries.slice(),
    getEntriesByType: (type) => entries.filter((item) => item.entryType === type),
    getEntriesByName: (name, type) => entries.filter((item) => item.name === name && (type === undefined || item.entryType === type)),
    clearMarks: (name) => clear("mark", name),
    clearMeasures: (name) => clear("measure", name),
  };

  // As Node's: after the promise jobs and the timers already due.
  const immediates = new Map();
  let nextImmediate = 0;
  const setImmediate = (callback, ...args) => {
    if (typeof callback !== "function") throw new TypeError("setImmediate needs a function");
    const id = ++nextImmediate;
    immediates.set(id, setTimeout(() => {
      immediates.delete(id);
      callback(...args);
    }, 0));
    return id;
  };
  const clearImmediate = (id) => {
    clearTimeout(immediates.get(id));
    immediates.delete(id);
  };

  // Idle callbacks run from a timer, with a 50 ms budget as the web gives at most.
  const requestIdleCallback = (callback) => {
    if (typeof callback !== "function") throw new TypeError("requestIdleCallback needs a function");
    return setTimeout(() => {
      const start = native.now();
      callback({ didTimeout: false, timeRemaining: () => Math.max(0, 50 - (native.now() - start)) });
    }, 1);
  };
  const cancelIdleCallback = (id) => clearTimeout(id);

  // The console's counters, timers and groups. `shared.groups` is how deep `console.group`
  // nests, which the prelude's log lines indent by.
  const timings = new Map();
  const counts = new Map();
  const console = {
    dir: (value) => native.log(1, shared.show(value, 1)),
    table: (...values) => shared.log(1)(...values),
    group: (...values) => {
      if (values.length) shared.log(1)(...values);
      shared.groups++;
    },
    groupCollapsed: (...values) => console.group(...values),
    groupEnd: () => {
      if (shared.groups > 0) shared.groups--;
    },
    time(label = "default") {
      if (timings.has(label)) return native.log(2, "Timer '" + label + "' already exists");
      timings.set(label, native.now());
    },
    timeLog(label = "default", ...values) {
      const start = timings.get(label);
      if (start === undefined) return native.log(2, "Timer '" + label + "' does not exist");
      native.log(1, [label + ": " + (native.now() - start).toFixed(3) + " ms", ...values.map((value) => shared.show(value, 0))].join(" "));
    },
    timeEnd(label = "default") {
      console.timeLog(label);
      timings.delete(label);
    },
    count(label = "default") {
      const count = (counts.get(label) ?? 0) + 1;
      counts.set(label, count);
      native.log(1, label + ": " + count);
    },
    countReset(label = "default") {
      counts.delete(label);
    },
  };

  const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const invalid = (what) => {
    const error = new Error(what);
    error.name = "InvalidCharacterError";
    return error;
  };
  const btoa = (data) => {
    data = String(data);
    let out = "";
    for (let i = 0; i < data.length; i += 3) {
      const a = data.charCodeAt(i), b = data.charCodeAt(i + 1), c = data.charCodeAt(i + 2);
      if (a > 255 || b > 255 || c > 255) throw invalid("btoa takes only characters up to U+00FF");
      out += BASE64[a >> 2] + BASE64[((a & 3) << 4) | (b >> 4 || 0)] +
        (i + 1 < data.length ? BASE64[((b & 15) << 2) | (c >> 6 || 0)] : "=") + (i + 2 < data.length ? BASE64[c & 63] : "=");
    }
    return out;
  };
  const atob = (data) => {
    data = String(data).replace(/[\t\n\f\r ]/g, "");
    if (data.length % 4 === 0) data = data.replace(/==?$/, "");
    if (data.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(data)) throw invalid("atob takes only base64 text");
    let out = "";
    let bits = 0, count = 0;
    for (let i = 0; i < data.length; i++) {
      bits = (bits << 6) | BASE64.indexOf(data[i]);
      count += 6;
      if (count >= 8) {
        count -= 8;
        out += String.fromCharCode((bits >> count) & 255);
      }
    }
    return out;
  };

  class TextEncoder {
    get encoding() { return "utf-8"; }
    encode(input = "") {
      const text = String(input);
      const bytes = new Uint8Array(text.length * 3);
      return bytes.slice(0, this.encodeInto(text, bytes).written);
    }
    encodeInto(input, bytes) {
      const text = String(input);
      let read = 0, written = 0;
      while (read < text.length) {
        let code = text.codePointAt(read);
        const units = code > 0xffff ? 2 : 1;
        if (code >= 0xd800 && code <= 0xdfff) code = 0xfffd;
        const size = code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
        if (written + size > bytes.length) break;
        if (size === 1) bytes[written] = code;
        else {
          bytes[written] = (0xf00 >> size) | (code >> (6 * (size - 1)));
          for (let i = 1; i < size; i++) bytes[written + i] = 0x80 | ((code >> (6 * (size - 1 - i))) & 63);
        }
        read += units;
        written += size;
      }
      return { read, written };
    }
  }
  const LABELS = { "utf-8": "utf-8", utf8: "utf-8", "unicode-1-1-utf-8": "utf-8", "utf-16le": "utf-16le", "utf-16": "utf-16le", "utf-16be": "utf-16be", latin1: "windows-1252", "iso-8859-1": "windows-1252", ascii: "windows-1252", "us-ascii": "windows-1252", "windows-1252": "windows-1252" };
  class TextDecoder {
    #encoding;
    #fatal;
    #ignoreBOM;
    #pending = [];
    constructor(label = "utf-8", options) {
      const encoding = LABELS[String(label).trim().toLowerCase()];
      if (!encoding) throw new RangeError("TextDecoder has no encoding '" + label + "'");
      this.#encoding = encoding;
      this.#fatal = !!options?.fatal;
      this.#ignoreBOM = !!options?.ignoreBOM;
    }
    get encoding() { return this.#encoding; }
    get fatal() { return this.#fatal; }
    get ignoreBOM() { return this.#ignoreBOM; }
    decode(input, options) {
      let bytes = input === undefined ? new Uint8Array(0) : ArrayBuffer.isView(input) ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength) : new Uint8Array(input);
      if (this.#pending.length) bytes = Uint8Array.from([...this.#pending, ...bytes]);
      const stream = !!options?.stream;
      let text = "", i = 0;
      const fail = () => {
        if (this.#fatal) throw new TypeError("the bytes are not valid " + this.#encoding);
        return "\ufffd";
      };
      if (this.#encoding === "windows-1252") {
        for (; i < bytes.length; i++) text += String.fromCharCode(bytes[i]);
      } else if (this.#encoding !== "utf-8") {
        const little = this.#encoding === "utf-16le";
        for (; i + 1 < bytes.length; i += 2) text += String.fromCharCode(little ? bytes[i] | (bytes[i + 1] << 8) : (bytes[i] << 8) | bytes[i + 1]);
        if (!this.#ignoreBOM && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      } else {
        // The WHATWG decoder: each invalid sequence becomes one U+FFFD, or throws when fatal.
        let codes = [], code = 0, need = 0, seen = 0, lower = 0x80, upper = 0xbf, start = 0;
        const flush = () => {
          text += String.fromCodePoint(...codes);
          codes = [];
        };
        const bad = () => codes.push(fail().codePointAt(0));
        for (; i < bytes.length; i++) {
          const byte = bytes[i];
          if (need === 0) {
            start = i;
            if (byte < 0x80) codes.push(byte);
            else if (byte >= 0xc2 && byte <= 0xdf) {
              need = 1;
              code = byte & 0x1f;
            } else if (byte >= 0xe0 && byte <= 0xef) {
              need = 2;
              code = byte & 0xf;
              if (byte === 0xe0) lower = 0xa0;
              if (byte === 0xed) upper = 0x9f;
            } else if (byte >= 0xf0 && byte <= 0xf4) {
              need = 3;
              code = byte & 7;
              if (byte === 0xf0) lower = 0x90;
              if (byte === 0xf4) upper = 0x8f;
            } else bad();
          } else if (byte < lower || byte > upper) {
            need = seen = 0;
            lower = 0x80;
            upper = 0xbf;
            bad();
            i--;
          } else {
            lower = 0x80;
            upper = 0xbf;
            code = (code << 6) | (byte & 0x3f);
            if (++seen === need) {
              codes.push(code);
              need = seen = 0;
            }
          }
          if (codes.length >= 4096) flush();
        }
        if (need !== 0) {
          if (stream) i = start;
          else bad();
        }
        flush();
        if (!this.#ignoreBOM && text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      }
      this.#pending = stream ? Array.from(bytes.subarray(i)) : [];
      if (!stream && i < bytes.length) text += fail();
      return text;
    }
  }

  // Secure random numbers from the operating system: `native.random()` is 32 random bits.
  const randomFill = (array) => {
    if (!/^(Big)?(Ui|I)nt(8|16|32|64)(Clamped)?Array$/.test(array?.[Symbol.toStringTag])) throw new TypeError("getRandomValues takes an integer typed array");
    if (array.byteLength > 65536) throw new RangeError("getRandomValues fills at most 65536 bytes");
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i += 4) {
      const bits = native.random();
      for (let j = 0; j < 4 && i + j < bytes.length; j++) bytes[i + j] = bits >>> (8 * j);
    }
    return array;
  };
  const crypto = {
    getRandomValues: randomFill,
    randomUUID() {
      const bytes = randomFill(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 0x40;
      bytes[8] = (bytes[8] & 63) | 0x80;
      const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
      return hex.slice(0, 8) + "-" + hex.slice(8, 12) + "-" + hex.slice(12, 16) + "-" + hex.slice(16, 20) + "-" + hex.slice(20);
    },
  };

  // Events as on the web, for objects of the app's own: nodes of @silkui/core take these too.
  class Event {
    #type;
    #bubbles;
    #cancelable;
    #composed;
    #stopped = false;
    #immediate = false;
    #prevented = false;
    constructor(type, options) {
      if (arguments.length === 0) throw new TypeError("an Event needs a type");
      this.#type = String(type);
      this.#bubbles = !!options?.bubbles;
      this.#cancelable = !!options?.cancelable;
      this.#composed = !!options?.composed;
      this.target = null;
      this.currentTarget = null;
      this.eventPhase = 0;
      this.isTrusted = false;
      this.timeStamp = native.now();
    }
    get type() { return this.#type; }
    get bubbles() { return this.#bubbles; }
    get cancelable() { return this.#cancelable; }
    get composed() { return this.#composed; }
    get defaultPrevented() { return this.#prevented; }
    get cancelBubble() { return this.#stopped; }
    set cancelBubble(value) { if (value) this.#stopped = true; }
    get returnValue() { return !this.#prevented; }
    set returnValue(value) { if (!value) this.preventDefault(); }
    preventDefault() { if (this.#cancelable) this.#prevented = true; }
    stopPropagation() { this.#stopped = true; }
    stopImmediatePropagation() { this.#stopped = this.#immediate = true; }
    composedPath() { return this.target ? [this.target] : []; }
    // What a dispatcher reads: whether a listener stopped the event, and stopped it at once.
    get _stopped() { return this.#stopped; }
    get _immediate() { return this.#immediate; }
  }
  Event.NONE = 0;
  Event.CAPTURING_PHASE = 1;
  Event.AT_TARGET = 2;
  Event.BUBBLING_PHASE = 3;
  class CustomEvent extends Event {
    #detail;
    constructor(type, options) {
      super(type, options);
      this.#detail = options?.detail ?? null;
    }
    get detail() { return this.#detail; }
  }
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
  class EventTarget {
    #listeners = new Map();
    addEventListener(type, listener, options) {
      if (listener == null || options?.signal?.aborted) return;
      const capture = options === true || !!options?.capture;
      let list = this.#listeners.get(type);
      if (!list) this.#listeners.set(type, (list = []));
      if (list.some((item) => item.listener === listener && item.capture === capture)) return;
      const entry = { listener, capture, once: !!options?.once };
      list.push(entry);
      options?.signal?.addEventListener?.("abort", () => this.removeEventListener(type, listener, capture));
    }
    removeEventListener(type, listener, options) {
      const list = this.#listeners.get(type);
      const capture = options === true || !!options?.capture;
      const index = list ? list.findIndex((item) => item.listener === listener && item.capture === capture) : -1;
      if (index >= 0) list.splice(index, 1);
    }
    dispatchEvent(event) {
      if (!(event instanceof Event)) throw new TypeError("dispatchEvent takes an Event");
      event.target = event.currentTarget = this;
      event.eventPhase = 2;
      for (const item of (this.#listeners.get(event.type) ?? []).slice()) {
        if (event._immediate) break;
        if (item.once) this.removeEventListener(event.type, item.listener, item.capture);
        try {
          if (typeof item.listener === "function") item.listener.call(this, event);
          else item.listener.handleEvent(event);
        } catch (error) {
          globalThis.reportError(error);
        }
      }
      event.currentTarget = null;
      event.eventPhase = 0;
      return !event.defaultPrevented;
    }
  }

  // AbortController and AbortSignal, which Node and the SilkJS runtime already have: drop
  // these when apps move to that runtime.
  class AbortSignal extends EventTarget {
    #aborted = false;
    #reason = undefined;
    #onabort = null;
    constructor(key) {
      if (key !== made) throw new TypeError("Illegal constructor");
      super();
    }
    get aborted() { return this.#aborted; }
    get reason() { return this.#reason; }
    get onabort() { return this.#onabort; }
    set onabort(handler) {
      if (this.#onabort) this.removeEventListener("abort", this.#onabort);
      this.#onabort = typeof handler === "function" ? handler : null;
      if (this.#onabort) this.addEventListener("abort", this.#onabort);
    }
    throwIfAborted() { if (this.#aborted) throw this.#reason; }
    _abort(reason) {
      if (this.#aborted) return;
      this.#aborted = true;
      this.#reason = reason === undefined ? new DOMError("This operation was aborted", "AbortError") : reason;
      this.dispatchEvent(new Event("abort"));
    }
    static abort(reason) {
      const signal = new AbortSignal(made);
      signal._abort(reason);
      return signal;
    }
    static timeout(milliseconds) {
      const signal = new AbortSignal(made);
      setTimeout(() => signal._abort(new DOMError("The operation timed out.", "TimeoutError")), Number(milliseconds));
      return signal;
    }
    static any(signals) {
      const signal = new AbortSignal(made);
      for (const source of signals) {
        if (!(source instanceof AbortSignal)) throw new TypeError("AbortSignal.any takes AbortSignals");
        if (source.aborted) { signal._abort(source.reason); return signal; }
      }
      for (const source of signals) source.addEventListener("abort", () => signal._abort(source.reason), { once: true });
      return signal;
    }
  }
  const made = Symbol("AbortSignal");
  class AbortController {
    #signal = new AbortSignal(made);
    get signal() { return this.#signal; }
    abort(reason) { this.#signal._abort(reason); }
  }
  // `DOMException` where the runtime has one, else an Error with the same name.
  function DOMError(message, name) {
    if (typeof globalThis.DOMException === "function") return new globalThis.DOMException(message, name);
    const error = new Error(message);
    error.name = name;
    return error;
  }

  // navigator.getBattery(): one BatteryManager, read from the host. With no battery to read it
  // reports a full battery on external power, as the spec allows. Change events come from
  // re-reading every 30 seconds while something listens.
  const BATTERY_EVENTS = ["chargingchange", "levelchange", "chargingtimechange", "dischargingtimechange"];
  class BatteryManager extends EventTarget {
    #state = { charging: true, level: 1, chargingTime: 0, dischargingTime: Infinity };
    #listening = 0;
    #poll = 0;
    constructor(key) {
      if (key !== made) throw new TypeError("Illegal constructor");
      super();
      this._read();
    }
    get charging() { return this.#state.charging; }
    get level() { return this.#state.level; }
    get chargingTime() { return this.#state.chargingTime; }
    get dischargingTime() { return this.#state.dischargingTime; }
    addEventListener(type, listener, options) {
      super.addEventListener(type, listener, options);
      if (listener != null && BATTERY_EVENTS.includes(type) && this.#listening++ === 0) this.#poll = setInterval(() => this._read(), 30000);
    }
    removeEventListener(type, listener, options) {
      super.removeEventListener(type, listener, options);
      if (listener != null && BATTERY_EVENTS.includes(type) && this.#listening > 0 && --this.#listening === 0) clearInterval(this.#poll);
    }
    _read() {
      const next = native.battery(0) === 1
        ? { charging: native.battery(1) === 1, level: native.battery(2), chargingTime: native.battery(3), dischargingTime: native.battery(4) }
        : { charging: true, level: 1, chargingTime: 0, dischargingTime: Infinity };
      const last = this.#state;
      this.#state = next;
      if (next.charging !== last.charging) this.dispatchEvent(new Event("chargingchange"));
      if (next.level !== last.level) this.dispatchEvent(new Event("levelchange"));
      if (next.chargingTime !== last.chargingTime) this.dispatchEvent(new Event("chargingtimechange"));
      if (next.dischargingTime !== last.dischargingTime) this.dispatchEvent(new Event("dischargingtimechange"));
    }
  }
  for (const type of BATTERY_EVENTS) {
    Object.defineProperty(BatteryManager.prototype, "on" + type, {
      get() { return this._handler?.(type) ?? null; },
      set(handler) {
        this._handlers ??= new Map();
        const old = this._handlers.get(type);
        if (old) this.removeEventListener(type, old);
        if (typeof handler === "function") { this._handlers.set(type, handler); this.addEventListener(type, handler); }
        else this._handlers.delete(type);
      },
      configurable: true,
    });
  }
  BatteryManager.prototype._handler = function (type) { return this._handlers?.get(type); };
  let battery;
  const getBattery = () => Promise.resolve((battery ??= new BatteryManager(made)));

  // matchMedia lists with change listeners: `mediaChanged` runs after the window's media
  // changed (a resize, a move to a display of another scale, a new appearance).
  const watched = new Set();
  class MediaQueryListEvent extends Event {
    #media;
    #matches;
    constructor(type, options) {
      super(type, options);
      this.#media = String(options?.media ?? "");
      this.#matches = !!options?.matches;
    }
    get media() { return this.#media; }
    get matches() { return this.#matches; }
  }
  class MediaQueryList extends EventTarget {
    #media;
    #last;
    #onchange = null;
    constructor(media) {
      super();
      this.#media = media;
      this.#last = native.matchMedia(media);
    }
    get media() { return this.#media; }
    get matches() { return native.matchMedia(this.#media); }
    get onchange() { return this.#onchange; }
    set onchange(handler) {
      if (this.#onchange) this.removeEventListener("change", this.#onchange);
      this.#onchange = typeof handler === "function" ? handler : null;
      if (this.#onchange) this.addEventListener("change", this.#onchange);
    }
    addEventListener(type, listener, options) {
      super.addEventListener(type, listener, options);
      if (type === "change" && !watched.has(this)) {
        this.#last = this.matches;
        watched.add(this);
      }
    }
    addListener(listener) { this.addEventListener("change", listener); }
    removeListener(listener) { this.removeEventListener("change", listener); }
    _check() {
      const now = this.matches;
      if (now === this.#last) return;
      this.#last = now;
      this.dispatchEvent(new MediaQueryListEvent("change", { media: this.#media, matches: now }));
    }
  }
  const matchMedia = (query) => {
    return new MediaQueryList(String(query));
  };
  const mediaChanged = () => {
    for (const list of watched) list._check();
  };

  // As the File API's Blob: immutable bytes with a MIME type. No stream().
  const blobBytes = new WeakMap();
  const partBytes = (part) => {
    if (part instanceof Blob) return blobBytes.get(part);
    if (part instanceof ArrayBuffer) return new Uint8Array(part.slice(0));
    if (ArrayBuffer.isView(part)) return new Uint8Array(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength));
    return new TextEncoder().encode(String(part));
  };
  const blobType = (type) => {
    const value = String(type ?? "");
    return /^[\x20-\x7e]*$/.test(value) ? value.toLowerCase() : "";
  };
  class Blob {
    constructor(parts = [], options = {}) {
      if (parts === null || typeof parts !== "object" || typeof parts[Symbol.iterator] !== "function") throw new TypeError("Blob takes a sequence of parts");
      const chunks = [...parts].map(partBytes);
      const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
      let at = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.length;
      }
      blobBytes.set(this, bytes);
      Object.defineProperty(this, "type", { value: blobType(options?.type), enumerable: true });
    }
    get size() {
      return blobBytes.get(this).length;
    }
    slice(start = 0, end = this.size, type = "") {
      const blob = new Blob([], { type });
      blobBytes.set(blob, blobBytes.get(this).slice(start, end));
      return blob;
    }
    async arrayBuffer() {
      return blobBytes.get(this).slice().buffer;
    }
    async bytes() {
      return blobBytes.get(this).slice();
    }
    async text() {
      return new TextDecoder().decode(blobBytes.get(this));
    }
  }
  Object.defineProperty(Blob.prototype, Symbol.toStringTag, { value: "Blob" });

  // As the File API's File: a Blob with a name and a modification time.
  class File extends Blob {
    constructor(parts, name, options = {}) {
      if (arguments.length < 2) throw new TypeError("File takes parts and a name");
      super(parts, options);
      Object.defineProperty(this, "name", { value: String(name), enumerable: true });
      Object.defineProperty(this, "lastModified", { value: options?.lastModified === undefined ? Date.now() : Number(options.lastModified), enumerable: true });
    }
  }
  Object.defineProperty(File.prototype, Symbol.toStringTag, { value: "File" });

  class SubmitEvent extends Event {
    constructor(type, init) {
      super(type, init);
      this.submitter = init?.submitter ?? null;
    }
  }
  class FormDataEvent extends Event {
    constructor(type, init) {
      super(type, init);
      if (!init || !(init.formData instanceof FormData)) {
        throw new TypeError("FormDataEvent requires a formData option");
      }
      this.formData = init.formData;
    }
  }

  // As XMLHttpRequest's FormData: an ordered list of names with strings or Files.
  const formValue = (value, filename) => {
    if (!(value instanceof Blob)) return String(value);
    if (!(value instanceof File) || filename !== undefined) {
      return new File([value], filename === undefined ? (value instanceof File ? value.name : "blob") : String(filename), { type: value.type, lastModified: value.lastModified });
    }
    return value;
  };
  const isInDataList = (node) => {
    for (let p = node?.parentNode; p; p = p.parentNode) {
      if (String(p.localName ?? "").toLowerCase() === "datalist") return true;
    }
    return false;
  };
  const isControlActuallyDisabled = (control) => {
    if (typeof control?._isActuallyDisabled === "function") return control._isActuallyDisabled();
    if (control?.disabled || control?.hasAttribute?.("disabled")) return true;
    let child = control;
    for (let p = control?.parentNode; p; child = p, p = p.parentNode) {
      if (String(p.localName ?? "").toLowerCase() === "fieldset" && (p.disabled || p.hasAttribute?.("disabled"))) {
        let firstLegend = null;
        for (const c of p.childNodes ?? []) {
          if (String(c.localName ?? "").toLowerCase() === "legend") { firstLegend = c; break; }
        }
        if (child !== firstLegend) return true;
      }
    }
    return false;
  };
  const isSubmitButton = (el) => {
    if (!el || typeof el !== "object") return false;
    const tag = String(el.localName ?? "").toLowerCase();
    const type = String(el.type ?? el.getAttribute?.("type") ?? (tag === "button" ? "submit" : "")).toLowerCase();
    return (tag === "button" && type === "submit") || (tag === "input" && (type === "submit" || type === "image"));
  };
  // The form data set of a form element's controls (HTML §4.10.21.4 "constructing the entry list").
  const formEntries = (form, submitter) => {
    const entries = [];
    const controls = form.elements ?? form.querySelectorAll("button, input, select, textarea");
    for (const control of controls) {
      if (isInDataList(control) || isControlActuallyDisabled(control)) continue;
      const tag = String(control.localName ?? "").toLowerCase();
      if (tag === "fieldset") continue;
      const type = String(control.type ?? control.getAttribute?.("type") ?? (tag === "button" ? "submit" : "text")).toLowerCase();
      if (tag === "button" || type === "submit" || type === "button" || type === "reset") {
        if (control === submitter && type === "submit") {
          const name = control.getAttribute?.("name") ?? control.name;
          if (name) entries.push([String(name), String(control.value ?? control.getAttribute?.("value") ?? "")]);
        }
        continue;
      }
      if (type === "image") {
        if (control === submitter) {
          const name = control.getAttribute?.("name") ?? control.name ?? "";
          entries.push([name ? `${name}.x` : "x", "0"]);
          entries.push([name ? `${name}.y` : "y", "0"]);
        }
        continue;
      }
      if ((type === "checkbox" || type === "radio") && !control.checked) continue;
      const name = control.getAttribute?.("name") ?? control.name;
      if (!name) continue;
      if (tag === "input" && type === "hidden" && String(name).toLowerCase() === "_charset_") {
        entries.push([String(name), "UTF-8"]);
        continue;
      }
      if (tag === "select") {
        for (const option of control.options ?? control.querySelectorAll("option")) {
          if (option.selected && !option.disabled && !option.hasAttribute?.("disabled")) {
            const parent = option.parentNode;
            if (String(parent?.localName ?? "").toLowerCase() === "optgroup" && (parent.disabled || parent.hasAttribute?.("disabled"))) continue;
            entries.push([String(name), String(option.value ?? option.textContent ?? "")]);
          }
        }
        continue;
      }
      if (type === "file") {
        const files = [...(control.files ?? [])];
        if (files.length === 0) entries.push([String(name), new File([], "", { type: "application/octet-stream" })]);
        for (const file of files) entries.push([String(name), file instanceof Blob ? formValue(file) : file]);
        continue;
      }
      const rawValue = control.value ?? control.getAttribute?.("value") ?? ((type === "checkbox" || type === "radio") ? "on" : "");
      // Normalize line breaks to CRLF per HTML spec §4.10.21.4 for textarea/text controls.
      const normalized = tag === "textarea" ? String(rawValue).replace(/\r\n|\r|\n/g, "\r\n") : String(rawValue);
      entries.push([String(name), normalized]);
      const dirname = control.getAttribute?.("dirname");
      if (dirname) {
        const dir = control.getAttribute?.("dir") || "ltr";
        entries.push([String(dirname), dir === "rtl" ? "rtl" : "ltr"]);
      }
    }
    return entries;
  };
  class FormData {
    #entries = [];
    constructor(form, submitter) {
      if (form === undefined || form === null) return;
      if (typeof form !== "object" || (form.elements === undefined && typeof form.querySelectorAll !== "function")) {
        throw new TypeError("FormData takes a form element");
      }
      if (submitter !== undefined && submitter !== null) {
        if (!isSubmitButton(submitter)) throw new TypeError("The specified element is not a submit button.");
        if (submitter.form !== undefined && submitter.form !== form) {
          const err = new Error("The specified element is not owned by this form element.");
          err.name = "NotFoundError";
          throw err;
        }
      }
      if (form._constructingEntryList) {
        const err = new Error("Form is already constructing an entry list.");
        err.name = "InvalidStateError";
        throw err;
      }
      form._constructingEntryList = true;
      try {
        this.#entries = formEntries(form, submitter ?? null);
        if (typeof form.dispatchEvent === "function") {
          form.dispatchEvent(new FormDataEvent("formdata", { bubbles: true, formData: this }));
        }
      } finally {
        form._constructingEntryList = false;
      }
    }
    append(name, value, filename) {
      this.#entries.push([String(name), formValue(value, filename)]);
    }
    set(name, value, filename) {
      name = String(name);
      const entry = [name, formValue(value, filename)];
      const first = this.#entries.findIndex(([key]) => key === name);
      if (first < 0) {
        this.#entries.push(entry);
        return;
      }
      this.#entries = this.#entries.filter(([key], index) => key !== name || index === first);
      this.#entries[first] = entry;
    }
    get(name) {
      name = String(name);
      return this.#entries.find(([key]) => key === name)?.[1] ?? null;
    }
    getAll(name) {
      name = String(name);
      return this.#entries.filter(([key]) => key === name).map(([, value]) => value);
    }
    has(name) {
      name = String(name);
      return this.#entries.some(([key]) => key === name);
    }
    delete(name) {
      name = String(name);
      this.#entries = this.#entries.filter(([key]) => key !== name);
    }
    forEach(callback, thisArg) {
      for (const [name, value] of this.#entries) callback.call(thisArg, value, name, this);
    }
    *entries() {
      for (const [name, value] of this.#entries) yield [name, value];
    }
    *keys() {
      for (const [name] of this.#entries) yield name;
    }
    *values() {
      for (const [, value] of this.#entries) yield value;
    }
    [Symbol.iterator]() {
      return this.entries();
    }
  }
  Object.defineProperty(FormData.prototype, Symbol.toStringTag, { value: "FormData" });

  return { Blob, File, FormData, SubmitEvent, FormDataEvent, AbortController, AbortSignal, BatteryManager, getBattery, matchMedia, mediaChanged, MediaQueryList, MediaQueryListEvent, performance, setImmediate, clearImmediate, requestIdleCallback, cancelIdleCallback, console, atob, btoa, TextEncoder, TextDecoder, crypto, Event, CustomEvent, PromiseRejectionEvent, EventTarget };
})
