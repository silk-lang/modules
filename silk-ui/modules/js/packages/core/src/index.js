// @silkui/core: the nodes of a Silk UI tree and their events, for JavaScript that runs on the
// embedded SilkJS engine. The primitives are the tree's own (box, text, input, image, canvas)
// and inline svg; the methods and the event flow are the DOM's, so code written for the web reads
// the same here.
//
// Every call queues a mutation through the native `__ui` functions. The host applies the
// queue after the script, and after each event it delivers.

const native = globalThis.__ui;
if (!native) throw new Error("@silkui/core needs the __ui functions of a ui-js host");

const KINDS = { box: 0, text: 1, input: 2, image: 3, icon: 4, canvas: 5 };
const STATES = { base: 0, hover: 1, active: 2, focus: 3, focusVisible: 4, starting: 5 };

// Event types by the kind number the host dispatches. Up to `selectionchange`, `pointerover`
// and `pointerout` the kind is also the bit of the tree's LISTEN_* flags a node listens with;
// `error` shares the bit of `load`, the touch kinds share bit 30, copy, cut, paste and
// beforeinput bit 31, and the requests (closerequest, navigate) bit 18 (see `bitOf`).
const TYPES = [
  "pointerdown", "pointerup", "click", "pointermove", "pointerenter", "pointerleave", "wheel",
  "keydown", "keyup", "focus", "blur", "input", "scroll", "layout", "pointercancel",
  "gotpointercapture", "lostpointercapture", "load", "error", "transitionrun", "transitionstart",
  "transitionend", "transitioncancel", "animationstart", "animationiteration", "animationend",
  "animationcancel", "selectionchange", "pointerover", "pointerout", "touchstart", "touchmove",
  "touchend", "touchcancel", "copy", "cut", "paste", "beforeinput", "closerequest", "navigate",
];
const KIND_OF = new Map(TYPES.map((type, kind) => [type, kind]));

// The live `Range`s (see Range below), held weakly: a range nobody holds stops being updated.
const liveRanges = new Set();
// Above zero while a move keeps the ranges itself (see moveNodePreservingRanges).
let rangesPaused = 0;
// The `MutationObserver`s observing a node (see MutationObserver below). Registrations are
// indexed per target (`target._mutationTargets`) so each mutation only walks `target` and
// its ancestors (when any `subtree` observer wants that kind) instead of scanning all observers.
const mutationObservers = new Set();
const pendingMutationObservers = new Set();
let mutationObserverOrder = 0;
let moChildListCount = 0;
let moAttrCount = 0;
let moCharDataCount = 0;
let moSubtreeChildList = 0;
let moSubtreeAttr = 0;
let moSubtreeCharData = 0;

function eachLiveRange(update) {
  for (const ref of liveRanges) {
    const range = ref.deref();
    if (range) update(range);
    else liveRanges.delete(ref);
  }
}

const CLICK = KIND_OF.get("click");
const FOCUS = KIND_OF.get("focus");
const BLUR = KIND_OF.get("blur");
const SELECTION_CHANGE = KIND_OF.get("selectionchange");
const TOUCH_START = KIND_OF.get("touchstart");
const COPY = KIND_OF.get("copy");
const CUT = KIND_OF.get("cut");
const PASTE = KIND_OF.get("paste");
const BEFORE_INPUT = KIND_OF.get("beforeinput");
const LOAD = KIND_OF.get("load");
const ERROR = KIND_OF.get("error");
const CLOSE_REQUEST = KIND_OF.get("closerequest");
const NAVIGATE = KIND_OF.get("navigate");
// The listen bit of a kind: `error` shares the bit of `load`, the touch kinds share bit 30,
// copy, cut, paste and beforeinput bit 31, and the two requests have the bit after `load`.
const bitOf = (kind) =>
  kind === ERROR ? LOAD : kind < TOUCH_START ? kind : kind < COPY ? 30 : kind < CLOSE_REQUEST ? 31 : LOAD + 1;
const SHARES_BIT = (kind) => kind >= TOUCH_START || kind === LOAD || kind === ERROR;
const KINDS_OF_BIT = (bit) => TYPES.map((_, kind) => kind).filter((kind) => bitOf(kind) === bit);
// Compatibility mouse events, as the web fires them after pointer events: each listens
// through the pointer kind it follows.
const MOUSE_OF = new Map([
  ["pointerdown", "mousedown"], ["pointerup", "mouseup"], ["pointermove", "mousemove"],
  ["pointerover", "mouseover"], ["pointerout", "mouseout"], ["pointerenter", "mouseenter"],
  ["pointerleave", "mouseleave"],
]);
const POINTER_OF = new Map([...MOUSE_OF].map(([pointer, mouse]) => [mouse, pointer]));
// Types the tree reports through another kind's records: `selectstart` comes as a
// `SelectionChange` record at the node pressed.
const LISTENS_AS = new Map([...POINTER_OF, ["selectstart", "selectionchange"]]);
// As on the web: these reach the target alone.
const NO_BUBBLE = new Set([
  "pointerenter", "pointerleave", "mouseenter", "mouseleave", "focus", "blur", "scroll", "layout", "load",
  "error",
]);
// The tree has a default action to skip for these. Touch records say for themselves.
const CANCELABLE = new Set([
  "pointerdown", "pointerup", "click", "wheel", "keydown", "keyup", "dragenter", "dragover", "drop",
  "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "selectstart", "copy", "cut", "paste", "beforeinput",
  "closerequest", "navigate", "submit", "reset", "invalid",
]);
// Files dragged from the desktop: the host dispatches these itself, so nodes need no flag.
const DRAG_TYPES = new Set(["dragenter", "dragover", "dragleave", "drop"]);

// Properties whose numbers are not lengths. Every other number is CSS pixels.
const UNITLESS = new Set([
  "opacity", "flexGrow", "flexShrink", "flex", "order", "zIndex", "fontWeight", "lineHeight",
  "aspectRatio", "tabSize", "scale", "animationIterationCount", "gridRow", "gridRowStart", "gridRowEnd",
  "gridColumn", "gridColumnStart", "gridColumnEnd", "gridArea", "columnCount", "columns", "orphans", "widows",
]);

const nodes = [];
// HTML boolean attributes that are also the tree's own.
const BOOLEAN_TREE_ATTRIBUTES = new Set(["disabled", "checked", "selected", "inert", "readonly", "multiline", "required"]);
// The tag stylesheets match a tree node by, by its kind (see ui-tree's `SelectorTree`).
const LOCAL_NAMES = { box: "div", input: "input", image: "img", canvas: "canvas", svg: "svg", text: "#text" };
const NO_CHILDREN = Object.freeze([]);
let nextId = 0;

// Property names repeat across nodes: each is converted once.
const CSS_NAMES = new Map();

function cssName(name) {
  if (name.startsWith("--")) return name;
  let css = CSS_NAMES.get(name);
  if (css === undefined) {
    css = name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
    CSS_NAMES.set(name, css);
  }
  return css;
}

// A CSS name as the camel case name looks take: `background-color` is `backgroundColor`,
// `-webkit-line-clamp` is `WebkitLineClamp`; custom properties stay as they are.
function camelName(name) {
  if (name.startsWith("--") || !name.includes("-")) return name;
  return name.replace(/^-ms-/, "ms-").replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

// `color: red; --gap: 4px` as camel case properties. Semicolons inside parentheses or
// quotes (`url("a;b")`) stay in their value.
function parseDeclarations(text) {
  const properties = {};
  let depth = 0;
  let quote = "";
  let start = 0;
  const take = (end) => {
    const part = text.slice(start, end);
    const colon = part.indexOf(":");
    if (colon > 0) {
      const name = part.slice(0, colon).trim();
      const value = part.slice(colon + 1).trim();
      if (name && value) properties[camelName(name.startsWith("--") ? name : name.toLowerCase())] = value;
    }
    start = end + 1;
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && depth <= 0) take(i);
  }
  take(text.length);
  return properties;
}

// `element.style` of an HTML element: the base look, whose CSS properties also read and write
// as fields (`style.height = "10px"`), as a CSSStyleDeclaration's do.
const styleProxies = new WeakMap();
function styleProxy(look) {
  let proxy = styleProxies.get(look);
  if (proxy) return proxy;
  proxy = new Proxy(look, {
    get(target, key) {
      if (typeof key !== "string" || key in target) {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      if (/^(?:0|[1-9]\d*)$/.test(key)) {
        const index = Number(key);
        return index < target.length ? target.item(index) : undefined;
      }
      return target.get(key) ?? "";
    },
    set(target, key, value) {
      if (typeof key !== "string" || key in target) return Reflect.set(target, key, value, target);
      target._setOne(key, value);
      return true;
    },
  });
  styleProxies.set(look, proxy);
  return proxy;
}

// The tree names font family lists by number: each `fontFamily` text is defined once, as a
// list of its own. The numbers start high, clear of the lists a host defines, and stay
// small enough to be exact in the 32-bit float a style value is.
const FAMILIES = new Map();
let nextFamily = 0x10000;

function familyOf(names) {
  let id = FAMILIES.get(names);
  if (id === undefined) {
    id = nextFamily++;
    FAMILIES.set(names, id);
    native.fontFamily(id, names);
  }
  return String(id);
}

// A declared value as CSSOM serializes it: lengths given as numbers are pixels, and a color
// written as hex, rgb() or hsl() reads as rgb() or rgba(), as CSS Color serializes it.
function cssomValue(name, value) {
  if (typeof value === "number") return !UNITLESS.has(name) && !name.startsWith("--") ? value + "px" : String(value);
  const text = String(value);
  if ((name === "color" || name.endsWith("Color")) && /^(#|rgba?\(|hsla?\()/i.test(text.trim())) return parseCssColor(text) ?? text;
  return text;
}

function cssValue(name, value) {
  if (name.startsWith("--")) return String(value);
  if (name === "fontFamily") return familyOf(String(value));
  return typeof value === "number" && !UNITLESS.has(name) ? value + "px" : String(value);
}

const warned = new Set();
// Style elements, and those in the document's sheets now (see `StyleElement`).
const styleElements = new Set();
let appliedStyles = [];
let stylesPending = false;

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(message);
}

// The part of an ARIA attribute name after `aria`, lowercase: `aria-valuenow` (the DOM
// attribute) and `ariaValueNow` (the DOM property) are both `valuenow`. Null for other names.
function ariaName(name) {
  if (name.startsWith("aria-")) return name.slice(5).toLowerCase();
  if (name.length > 4 && name.startsWith("aria") && name[4] >= "A" && name[4] <= "Z") return name.slice(4).toLowerCase();
  return null;
}

/** The declarations of one look of a node: the base look, or what a state lays over it. */
class Look {
  #node;
  #state;
  // Plain objects share their shape across nodes: a Map here costs four times the memory.
  // A number or string is kept as given, which the caller's style object holds too, and
  // turned into CSS text when it is read: no node keeps a string of its own per value.
  #values = Object.create(null);
  // Whether CSSOM changed a declaration since the style attribute was set: the attribute
  // reads as the declarations' serialization then.
  _touched = false;

  constructor(node, state) {
    this.#node = node;
    this.#state = state;
  }

  /**
   * Sets properties by their camel case names: `{ width: 120, backgroundColor: "red" }`.
   * Numbers are CSS pixels except for unitless properties. `null`, `undefined` and `""`
   * take a property out.
   */
  set(properties) {
    if (!this._touched && this.#state === 0 && this.#node._tag !== undefined) this.#node._styleAttributeAppeared();
    let css = "";
    let removed = false;
    for (const name of Object.keys(properties)) {
      const value = properties[name];
      if (value === null || value === undefined || value === "") {
        if (name in this.#values) {
          this._touched = true;
          delete this.#values[name];
          removed = true;
        }
        continue;
      }
      this._touched = true;
      if (this.#values[name] === value) continue;
      const text = cssValue(name, value);
      this.#values[name] = typeof value === "number" || typeof value === "string" ? value : text;
      css += cssName(name) + ":" + text + ";";
    }
    if (removed) {
      // The tree sets declarations over earlier ones, so taking one out means starting the
      // look again.
      native.clearStyle(this.#node.nodeId, this.#state);
      css = this.#nativeText();
    }
    if (css) native.style(this.#node.nodeId, css, this.#state);
  }

  /** Replaces the whole look. */
  replace(properties) {
    native.clearStyle(this.#node.nodeId, this.#state);
    this.#values = Object.create(null);
    this.set(properties);
  }

  get(name) {
    const value = this.#values[name];
    return value === undefined ? undefined : cssomValue(name, value);
  }

  // What the tree's style parser takes: font families go by their list's number.
  #nativeText() {
    let css = "";
    for (const name in this.#values) css += cssName(name) + ":" + cssValue(name, this.#values[name]) + ";";
    return css;
  }

  /** The declarations serialized as CSSOM serializes a declaration block: `color: red; width: 1px;`. */
  get cssText() {
    let css = "";
    for (const name in this.#values) css += (css ? " " : "") + cssName(name) + ": " + cssomValue(name, this.#values[name]) + ";";
    return css;
  }

  /** Replaces the look with declarations in CSS text, as `element.style.cssText`. */
  set cssText(text) {
    this.replace(parseDeclarations(String(text ?? "")));
  }

  get length() {
    return Object.keys(this.#values).length;
  }

  item(index) {
    const name = Object.keys(this.#values)[index];
    return name === undefined ? "" : cssName(name);
  }

  _setOne(name, value) {
    if (!this._touched && this.#state === 0 && this.#node._tag !== undefined) this.#node._styleAttributeAppeared();
    if (value === null || value === undefined || value === "") {
      if (name in this.#values) {
        this._touched = true;
        delete this.#values[name];
        native.clearStyle(this.#node.nodeId, this.#state);
        const css = this.#nativeText();
        if (css) native.style(this.#node.nodeId, css, this.#state);
      }
      return;
    }
    this._touched = true;
    if (this.#values[name] === value) return;
    const text = cssValue(name, value);
    this.#values[name] = typeof value === "number" || typeof value === "string" ? value : text;
    native.style(this.#node.nodeId, cssName(name) + ":" + text + ";", this.#state);
  }

  // CSSStyleDeclaration's methods, which take CSS names (`background-color`, `--gap`).
  setProperty(name, value, priority) {
    const text = value === null || value === undefined ? "" : String(value) + (priority === "important" ? " !important" : "");
    this._setOne(camelName(String(name)), text);
  }

  removeProperty(name) {
    const camel = camelName(String(name));
    const old = this.get(camel) ?? "";
    this._setOne(camel, null);
    return old;
  }

  getPropertyValue(name) {
    return this.get(camelName(String(name))) ?? "";
  }

  getPropertyPriority() {
    return "";
  }

  _copyTo(look) {
    look.#values = Object.assign(Object.create(null), this.#values);
    look._touched = this._touched;
    const css = this.#nativeText();
    if (css) native.style(look.#node.nodeId, css, look.#state);
  }
}

const CLASS_SPACE = /[\t\n\f\r ]/;
function classToken(value) {
  const token = String(value);
  if (!token || CLASS_SPACE.test(token)) {
    const error = new Error(!token ? "A class token cannot be empty" : "A class token cannot contain whitespace");
    error.name = !token ? "SyntaxError" : "InvalidCharacterError";
    throw error;
  }
  return token;
}

/** A live token list backed by the node's class attribute. */
// `element.dataset`: a DOMStringMap over the `data-*` attributes, `fooBar` for `data-foo-bar`.
function datasetOf(element) {
  const attribute = (key) => typeof key === "string" && !/-[a-z]/.test(key) ? "data-" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()) : null;
  const keys = () => element.getAttributeNames().filter((name) => name.startsWith("data-")).map((name) => name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase()));
  return new Proxy(Object.create(null), {
    get(_, key) {
      const name = attribute(key);
      return name === null ? undefined : element.getAttribute(name) ?? undefined;
    },
    set(_, key, value) {
      const name = attribute(key);
      if (name === null) throw new (globalThis.DOMException ?? Error)("'" + String(key) + "' is not a valid dataset name", "SyntaxError");
      element.setAttribute(name, String(value));
      return true;
    },
    deleteProperty(_, key) {
      const name = attribute(key);
      if (name !== null) element.removeAttribute(name);
      return true;
    },
    has(_, key) {
      const name = attribute(key);
      return name !== null && element.hasAttribute(name);
    },
    ownKeys: keys,
    getOwnPropertyDescriptor(_, key) {
      const name = attribute(key);
      const value = name === null ? null : element.getAttribute(name);
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
  });
}

export class ClassList {
  #node;
  constructor(node) { this.#node = node; }
  #tokens() { return [...new Set(this.value.split(/[\t\n\f\r ]+/).filter(Boolean))]; }
  #write(tokens) { this.#node.className = tokens.join(" "); }
  get value() { return this.#node.className; }
  set value(value) { this.#node.className = value; }
  get length() { return this.#tokens().length; }
  item(index) { return this.#tokens()[Number(index) >>> 0] ?? null; }
  contains(token) { return this.#tokens().includes(classToken(token)); }
  add(...values) {
    const tokens = values.map(classToken);
    this.#write([...new Set([...this.#tokens(), ...tokens])]);
  }
  remove(...values) {
    const tokens = values.map(classToken);
    this.#write(this.#tokens().filter((token) => !tokens.includes(token)));
  }
  toggle(value, force) {
    const token = classToken(value);
    const present = this.contains(token);
    const wanted = force === undefined ? !present : !!force;
    if (wanted && !present) this.add(token);
    else if (!wanted && present) this.remove(token);
    return wanted;
  }
  replace(oldValue, newValue) {
    const oldToken = classToken(oldValue), newToken = classToken(newValue);
    const tokens = this.#tokens(), index = tokens.indexOf(oldToken);
    if (index === -1) return false;
    if (oldToken !== newToken) {
      if (tokens.includes(newToken)) tokens.splice(index, 1);
      else tokens[index] = newToken;
    }
    this.#write(tokens);
    return true;
  }
  values() { return this.#tokens().values(); }
  keys() { return this.#tokens().keys(); }
  entries() { return this.#tokens().entries(); }
  forEach(callback, thisArg) { this.#tokens().forEach((value, index) => callback.call(thisArg, value, index, this)); }
  [Symbol.iterator]() { return this.values(); }
  toString() { return this.value; }
}

const sheetData = new WeakMap();
const adoptedLists = new WeakMap();
const importedSheets = new Map();
let installedSheets = [];
let nextSheet = 1;

function sheetError(message) {
  const error = new Error(message);
  error.name = "NotAllowedError";
  return error;
}

function base64Bytes(value) {
  if (typeof value === "string") return value;
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
  if (!(bytes instanceof Uint8Array)) throw new TypeError("Expected compiled stylesheet bytes");
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let encoded = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const bits = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    encoded += alphabet[bits >>> 18] + alphabet[(bits >>> 12) & 63]
      + (i + 1 < bytes.length ? alphabet[(bits >>> 6) & 63] : "=")
      + (i + 2 < bytes.length ? alphabet[bits & 63] : "=");
  }
  return encoded;
}

function replaceSheet(sheet, bytes) {
  native.styleSheet(0, 0, bytes);
  const state = sheetData.get(sheet);
  state.bytes = bytes;
  for (const entry of installedSheets) {
    if (entry.sheet !== sheet) continue;
    native.styleSheet(entry.live ? 2 : 1, entry.id, bytes);
    entry.live = true;
  }
}

/** A constructed stylesheet, adopted on an application's root. */
export class CSSStyleSheet {
  constructor() { sheetData.set(this, { bytes: null, replacing: false }); }

  static fromCompiled(bytes) {
    const sheet = new CSSStyleSheet();
    replaceSheet(sheet, base64Bytes(bytes));
    return sheet;
  }

  replaceCompiled(bytes) {
    if (sheetData.get(this).replacing) throw sheetError("A stylesheet replacement is already pending");
    replaceSheet(this, base64Bytes(bytes));
  }

  replaceSync(text) {
    if (sheetData.get(this).replacing) throw sheetError("A stylesheet replacement is already pending");
    if (!native.compileStyleSheet) throw sheetError("Runtime CSS compilation is disabled in this host");
    replaceSheet(this, native.compileStyleSheet(String(text)));
  }

  replace(text) {
    const state = sheetData.get(this);
    if (state.replacing) return Promise.reject(sheetError("A stylesheet replacement is already pending"));
    const source = String(text);
    state.replacing = true;
    return Promise.resolve().then(() => {
      if (!native.compileStyleSheet) throw sheetError("Runtime CSS compilation is disabled in this host");
      replaceSheet(this, native.compileStyleSheet(source));
      return this;
    }).finally(() => { state.replacing = false; });
  }
}

function clearAdoptedSheets() {
  for (const entry of installedSheets) if (entry.live) native.styleSheet(3, entry.id, "");
  installedSheets = [];
}

function syncAdoptedSheets() {
  if (!rootNode) return;
  clearAdoptedSheets();
  const sheets = [...importedSheets.values()];
  if (registeredPropertiesSheet) sheets.push(registeredPropertiesSheet);
  for (const element of appliedStyles) if (element._styleSheet) sheets.push(element._styleSheet);
  sheets.push(...(adoptedLists.get(rootNode)?.values ?? []));
  for (const sheet of sheets) {
    if (nextSheet >= 0x80000000) throw new RangeError("Too many stylesheet adoptions");
    const entry = { sheet, id: nextSheet++, live: false };
    installedSheets.push(entry);
    const bytes = sheetData.get(sheet).bytes;
    if (bytes !== null) { native.styleSheet(1, entry.id, bytes); entry.live = true; }
  }
}

function validateSheets(values) {
  for (const sheet of values) if (!sheetData.has(sheet)) throw new TypeError("adoptedStyleSheets accepts constructed CSSStyleSheet objects");
  return values;
}

const sheetMutators = new Set(["copyWithin", "fill", "pop", "push", "reverse", "shift", "sort", "splice", "unshift"]);
function adoptedList(node) {
  let list = adoptedLists.get(node);
  if (list) return list;
  const values = [];
  const assign = next => {
    validateSheets(next);
    values.splice(0, values.length, ...next);
    if (rootNode === node) syncAdoptedSheets();
  };
  const numeric = key => typeof key === "string" && /^(0|[1-9][0-9]*)$/.test(key);
  const proxy = new Proxy(values, {
    get(target, key, receiver) {
      if (!sheetMutators.has(key)) return Reflect.get(target, key, receiver);
      return (...args) => {
        const next = values.slice();
        const result = Array.prototype[key].apply(next, args);
        assign(next);
        return result === next ? proxy : result;
      };
    },
    set(target, key, value) {
      if (key !== "length" && !numeric(key)) return Reflect.set(target, key, value);
      const next = values.slice();
      Reflect.set(next, key, value);
      assign(next);
      return true;
    },
    defineProperty(target, key, descriptor) {
      if (key !== "length" && !numeric(key)) return Reflect.defineProperty(target, key, descriptor);
      if (!Object.hasOwn(descriptor, "value") || descriptor.get || descriptor.set || descriptor.configurable === false || descriptor.writable === false) {
        throw new TypeError("adoptedStyleSheets entries must remain mutable values");
      }
      const next = values.slice();
      Reflect.set(next, key, descriptor.value);
      assign(next);
      return true;
    },
    deleteProperty(target, key) {
      if (!numeric(key)) return Reflect.deleteProperty(target, key);
      return Number(key) >= values.length;
    },
  });
  list = { values, proxy, assign };
  adoptedLists.set(node, list);
  return list;
}

/** Installs or replaces a CSS import compiled by the development build tool. */
export function updateStyleSheet(id, compiled) {
  const key = String(id);
  const previous = importedSheets.get(key);
  if (compiled === null) {
    if (importedSheets.delete(key)) syncAdoptedSheets();
  } else if (previous) {
    previous.replaceCompiled(compiled);
  } else {
    importedSheets.set(key, CSSStyleSheet.fromCompiled(compiled));
    syncAdoptedSheets();
  }
}

// What few nodes have, made on first use (see `Node`).
class NodeState {
  listeners = null;
  // The state looks by name.
  looks = null;
  flags = 0;
  // Kinds the node hears whatever its listeners: an input keeps its value and selection current.
  kept = 0;
  attributes = null;
  classList = null;
  dataset = null;
}

/** A node of the tree. Make one with `createBox`, `createText`, `createInput` or `createNode`. */
export class Node {
  // A node is a handle on the tree's node: it keeps only what the tree cannot answer at once
  // (its place among its siblings, its class, its base look), and puts the state few nodes
  // have (listeners, attributes, state looks) in one record made on first use. Every field
  // is a slot in every node, and a node of up to eight fits its object's own cell.
  // The base look: most nodes have the base alone.
  #base = null;
  #className = null;
  #rare = null;

  constructor(kind) {
    Object.defineProperty(this, "nodeId", { value: ++nextId, enumerable: true });
    // A text node's kind is its prototype's: one slot fewer in the most numerous node.
    if (kind !== "text") this.kind = kind;
    this.parentNode = null;
    // A node with no children shares one empty list, and gets its own at its first child.
    this.childNodes = NO_CHILDREN;
    nodes[this.nodeId] = this;
    native.create(this.nodeId, KINDS[kind]);
  }

  #more() {
    return (this.#rare ??= new NodeState());
  }

  // The node's own child list, made on its first child.
  _ownChildren() {
    if (this.childNodes === NO_CHILDREN) this.childNodes = [];
    return this.childNodes;
  }

  get adoptedStyleSheets() { return adoptedList(this).proxy; }
  set adoptedStyleSheets(value) { adoptedList(this).assign(Array.from(value)); }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }

  get previousSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }

  /** Whether the node is in the mounted tree. */
  get isConnected() {
    return inDocument(this);
  }

  /** 1 for an element, 3 for text, 11 for a document fragment, as in the DOM. */
  get nodeType() {
    return 1;
  }

  /**
   * The element's tag: the HTML tag it was made with (see `createElement`), or for a tree
   * node the tag stylesheets match it by (`div` for a box).
   */
  get localName() {
    return this._tag ?? LOCAL_NAMES[this.kind] ?? "div";
  }

  set localName(value) {
    this._tag = String(value);
  }

  /** The tag in upper case for HTML elements, as in the DOM. */
  get tagName() {
    const name = this.localName;
    const namespace = this.namespaceURI;
    return namespace === undefined || namespace === null || namespace === "http://www.w3.org/1999/xhtml" ? name.toUpperCase() : name;
  }

  set tagName(_value) {}

  get nodeName() {
    return this.tagName;
  }

  hasChildNodes() {
    return this.childNodes.length > 0;
  }

  /** A copy with the same looks and attributes, and with `deep` copies of the children. */
  cloneNode(deep = false) {
    const copy = this._shallowClone();
    if (this.#base) this.#base._copyTo(copy.look("base"));
    const looks = this.#rare?.looks;
    for (const state in looks ?? {}) looks[state]._copyTo(copy.look(state));
    if (this.#className !== null) copy.setAttribute("class", this.#className);
    for (const [name, value] of this.#rare?.attributes ?? []) copy.setAttribute(name, value);
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }

  _shallowClone() {
    return elementLike(this) ?? new Node(this.kind);
  }

  /** Joins adjacent text children and drops empty ones, in the whole subtree. */
  normalize() {
    for (let node = this.firstChild; node; ) {
      if (node.nodeType !== 3) {
        node.normalize();
        node = node.nextSibling;
        continue;
      }
      let next = node.nextSibling;
      if (node.length === 0) {
        node.remove();
        node = next;
        continue;
      }
      let joined = "";
      for (let sibling = next; sibling?.nodeType === 3; sibling = sibling.nextSibling) joined += sibling.data;
      let length = node.length;
      node.replaceData(length, 0, joined);
      for (let current = next; current?.nodeType === 3; current = current.nextSibling) {
        const index = indexIn(current);
        eachLiveRange((range) => range._joined(current, node, length, index));
        length += current.length;
      }
      while (next?.nodeType === 3) {
        const after = next.nextSibling;
        next.remove();
        next = after;
      }
      node = next;
    }
  }

  /** Whether `other` is this node or inside it. */
  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  /** Inserts `child` before `before`, or last without it. A child already in the tree moves. */
  insertBefore(child, before = null) {
    if (child.contains(this)) throw domError("HierarchyRequestError", "a node cannot be inserted into itself or its own subtree");
    if (this.nodeType === 3) throw domError("HierarchyRequestError", "text has no children");
    if (before && before.parentNode !== this) throw domError("NotFoundError", "the node to insert before is not a child of this node");
    if (child.nodeType === 11) {
      for (const node of [...child.childNodes]) this.insertBefore(node, before);
      return child;
    }
    if (before === child) before = child.nextSibling;
    const old = child.parentNode;
    if (old) {
      const index = old.childNodes.indexOf(child);
      if (liveRanges.size && !rangesPaused) eachLiveRange((range) => range._removing(child, old, index));
      if (moChildListCount && (old._mutationTargets || moSubtreeChildList)) childListRecord(old, null, child, old.childNodes[index - 1], old.childNodes[index + 1]);
      old.childNodes.splice(index, 1);
    }
    child.parentNode = this;
    if (liveRanges.size && !rangesPaused) {
      const index = before ? this.childNodes.indexOf(before) : this.childNodes.length;
      eachLiveRange((range) => range._inserted(this, index));
    }
    if (before) {
      this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
      native.insertBefore(this.nodeId, child.nodeId, before.nodeId);
    } else {
      this._ownChildren().push(child);
      native.append(this.nodeId, child.nodeId);
    }
    if (moChildListCount && (this._mutationTargets || moSubtreeChildList)) childListRecord(this, child, null, child.previousSibling, before);
    if (old && old._onChildrenChange) old._onChildrenChange();
    if (this._onChildrenChange) this._onChildrenChange();
    if (formCount) { syncAncestorForm(this); if (old) syncAncestorForm(old); }
    if (styleElements.size) stylesChanged();
    return child;
  }

  appendChild(child) {
    return this.insertBefore(child, null);
  }

  /** Puts `node` where `child` is and detaches `child`. */
  replaceChild(node, child) {
    if (child.parentNode !== this) throw domError("NotFoundError", "the node to replace is not a child of this node");
    if (node === child) return child;
    let before = child.nextSibling;
    if (before === node) before = node.nextSibling;
    this.removeChild(child);
    this.insertBefore(node, before);
    return child;
  }

  /** Appends nodes, and strings as text nodes. */
  append(...children) {
    for (const child of children) this.insertBefore(typeof child === "string" ? createText(child) : child, null);
  }

  /** Detaches `child` and its subtree. It keeps its state and can be inserted again. */
  removeChild(child) {
    if (child.parentNode !== this) throw domError("NotFoundError", "the node to remove is not a child of this node");
    const index = this.childNodes.indexOf(child);
    if (liveRanges.size) eachLiveRange((range) => range._removing(child, this, index));
    if (moChildListCount && (this._mutationTargets || moSubtreeChildList)) childListRecord(this, null, child, this.childNodes[index - 1], this.childNodes[index + 1]);
    this.childNodes.splice(index, 1);
    child.parentNode = null;
    native.remove(child.nodeId);
    if (this._onChildrenChange) this._onChildrenChange();
    if (formCount) syncAncestorForm(this);
    if (styleElements.size) stylesChanged();
    return child;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  /** Detaches and frees this node and its subtree. They cannot be used again. */
  destroy() {
    if (openSelectPopup && (this === openSelectPopup.select || this.contains(openSelectPopup.select))) closeSelectPopup();
    if (rootNode && this.contains(rootNode)) { clearAdoptedSheets(); rootNode = null; }
    const parent = this.parentNode;
    if (parent) {
      const index = parent.childNodes.indexOf(this);
      if (liveRanges.size) eachLiveRange((range) => range._removing(this, parent, index));
      if (moChildListCount && (parent._mutationTargets || moSubtreeChildList)) childListRecord(parent, null, this, parent.childNodes[index - 1], parent.childNodes[index + 1]);
      parent.childNodes.splice(index, 1);
      this.parentNode = null;
      if (parent._onChildrenChange) parent._onChildrenChange();
      if (formCount) syncAncestorForm(parent);
    }
    native.destroy(this.nodeId);
    forget(this);
    if (styleElements.size) stylesChanged();
  }

  /**
   * The base look. `node.style.set({ width: 120 })` sets properties,
   * `node.style = { ... }` replaces the look.
   */
  get style() {
    return this._tag === undefined ? this.look("base") : styleProxy(this.look("base"));
  }

  set style(properties) {
    if (typeof properties === "string") this.look("base").cssText = properties;
    else this.look("base").replace(properties);
  }

  /** The look the tree lays over the base in `state`: hover, active, focus, focusVisible, or
   * starting (what transitions start from when the node first shows, as `@starting-style`). */
  look(state) {
    if (state === "base") return (this.#base ??= new Look(this, 0));
    if (!(state in STATES)) throw new TypeError("the tree has no look '" + state + "'");
    const rare = this.#more();
    rare.looks ??= Object.create(null);
    return (rare.looks[state] ??= new Look(this, STATES[state]));
  }

  /**
   * Sets a tree attribute: tabIndex, disabled, label, testId, placeholder and so on. A node
   * with an `href` is a link: a click on it or inside it that no listener prevented opens
   * the address with `open`, as a click on an `<a>` follows it.
   *
   * `role` and `aria-*` work as in the DOM, spelled `aria-checked` or `ariaChecked`. A role
   * the tree does not know is ignored with a warning. Literal ARIA and data attributes
   * remain available to selectors even when they have no native accessibility mapping.
   */
  get id() { return this._elementId ?? ""; }
  set id(value) { this.setAttribute("id", String(value)); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(value) { this.setAttribute("class", String(value)); }
  get classList() { return this.#more().classList ??= new ClassList(this); }
  /** The `data-*` attributes by camelCase name, as `HTMLElement.dataset`. */
  get dataset() { return this.#more().dataset ??= datasetOf(this); }

  getAttribute(name) {
    name = String(name);
    if (name === "className" || name === "class") return this.#className;
    if (name === "tabIndex" && (this._tag !== undefined || this.kind === "svg")) name = "tabindex";
    // The style attribute reflects the declarations, as CSSOM serializes them.
    if (name === "style" && this._tag !== undefined && this.#base?._touched) return this.#base.cssText;
    const aria = ariaName(name);
    return this.#rare?.attributes?.get(aria === null ? name : "aria-" + aria) ?? null;
  }

  hasAttribute(name) { return this.getAttribute(name) !== null; }

  // CSSOM sets the style attribute when it changes a declaration: selectors see it then.
  _styleAttributeAppeared() {
    if (this.#rare?.attributes?.has("style")) return;
    native.attribute(this.nodeId, "style", "");
  }

  getAttributeNames() {
    const names = this.#className === null ? [] : ["class"];
    for (const name of this.#rare?.attributes?.keys() ?? []) names.push(name);
    if (this._tag !== undefined && this.#base?._touched && !names.includes("style")) names.push("style");
    return names;
  }

  /** The children as HTML; setting it replaces them with nodes parsed from HTML. */
  get innerHTML() {
    let html = "";
    for (const child of this.childNodes) html += markupOf(child);
    return html;
  }

  set innerHTML(html) {
    for (const child of this.childNodes.slice()) child.destroy();
    parseHTML(String(html ?? ""), this);
  }

  get outerHTML() {
    return markupOf(this);
  }
  removeAttribute(name) { this.setAttribute(name, null); }

  setAttribute(name, value) {
    name = String(name);
    // HTML attribute names have no case: React's `tabIndex` prop is the `tabindex` attribute.
    if (name === "tabIndex" && (this._tag !== undefined || this.kind === "svg")) name = "tabindex";
    let text = value == null ? null : String(value);
    if (moAttrCount && (this._mutationTargets || moSubtreeAttr)) attributeRecord(this, name, text);
    if (name === "className" || name === "class") {
      if (this.#className === text) return;
      native.attribute(this.nodeId, "class", text);
      this.#className = text;
      return;
    }
    const aria = ariaName(name);
    if (aria !== null) name = "aria-" + aria;
    if (name === "role") {
      if (!native.attribute(this.nodeId, "role", text ?? "")) warnOnce("the tree has no role '" + text + "': it is ignored");
    } else if (name === "id") {
      this.#identify(text);
    } else if (aria !== null) {
      const prev = this.#rare?.attributes?.get(name) ?? null;
      if (prev === text) return;
      native.attribute(this.nodeId, name, text);
    } else if (name === "src") {
      // An image's address, as `<img src>`.
      if ("src" in this) this.src = text ?? "";
      else warnOnce("only an image has a src: it is ignored");
    } else if (name === "alt") {
      native.attribute(this.nodeId, "label", text ?? "");
    } else if ((this._tag !== undefined || this.kind === "svg") && name === "tabindex") {
      this._keep("focus", "blur");
      native.attribute(this.nodeId, "tabIndex", text === null ? -2147483648 : Number(text));
    } else if (this._tag !== undefined && name === "style") {
      this.style.cssText = text ?? "";
      // The attribute keeps its own text until CSSOM changes a declaration.
      this.#base._touched = false;
      native.attribute(this.nodeId, "style", text);
    } else if (this._tag !== undefined && BOOLEAN_TREE_ATTRIBUTES.has(name)) {
      // An HTML boolean attribute is on whatever its text, `disabled=""` included.
      const on = value !== null && value !== undefined && value !== false;
      text = on ? "" : null;
      if (name === "checked" && "checked" in this) this.checked = on;
      else native.attribute(this.nodeId, name === "readonly" ? "readOnly" : name, on);
    } else if (this._tag !== undefined && name !== "href" && name !== "placeholder" && name !== "label") {
      // Any other HTML attribute is text the tree keeps for selectors (`[type=checkbox]`). One
      // the tree does not know (React 19's `precedence`, a library's own) stays on the element.
      const prev = this.#rare?.attributes?.get(name) ?? null;
      if (prev === text) return;
      try {
        native.attribute(this.nodeId, name, text);
      } catch (error) {
        if (!(error instanceof TypeError)) throw error;
      }
    } else {
      if (name === "href") {
        this._href = text || null;
        this.#want(KIND_OF.get("click"));
      } else if (name === "lang" || name === "dir" || name.startsWith("data-")) {
        const prev = this.#rare?.attributes?.get(name) ?? null;
        if (prev === text) return;
      }
      native.attribute(this.nodeId, name,
        name === "lang" || name === "dir" || name.startsWith("data-") ? text : value);
    }
    if (text === null) this.#rare?.attributes?.delete(name);
    else (this.#more().attributes ??= new Map()).set(name, text);
    if (name === "contenteditable") this.#editableChanged();
  }

  // An editing host takes focus (as a tab stop, unless its tabindex says otherwise) and hears
  // the tree's edits, which `hostEdit` makes.
  #editableChanged() {
    if (editableState(this) === "host") {
      this._keep("beforeinput", "focus", "blur");
      if (!this.hasAttribute("tabindex")) native.attribute(this.nodeId, "tabIndex", 0);
    } else if (!this.hasAttribute("tabindex") && !FOCUSABLE_TAGS.has(this._tag)) {
      native.attribute(this.nodeId, "tabIndex", -2147483648);
    }
  }

  /** "true", "false", "plaintext-only" or "inherit", from the `contenteditable` attribute. */
  get contentEditable() {
    const value = this.getAttribute("contenteditable");
    if (value === null) return "inherit";
    const lower = value.toLowerCase();
    return lower === "" || lower === "true" ? "true" : lower === "false" || lower === "plaintext-only" ? lower : "inherit";
  }

  set contentEditable(value) {
    const lower = String(value).toLowerCase();
    if (lower === "inherit") this.removeAttribute("contenteditable");
    else if (lower === "true" || lower === "false" || lower === "plaintext-only") this.setAttribute("contenteditable", lower);
    else throw domError("SyntaxError", "contentEditable takes true, false, plaintext-only or inherit");
  }

  /** Whether the user can edit the element: it is in an editing host (see `contentEditable`). */
  get isContentEditable() {
    return editingHostOf(this) !== null;
  }

  // The `id` other nodes' relations name this node by.
  #identify(id) {
    const old = this._elementId ?? "";
    if (old === (id ?? "") && this.getAttribute("id") === id) return;
    this._elementId = id || undefined;
    native.attribute(this.nodeId, "id", id);
  }

  // Tells the tree which events this node wants: its listeners', and clicks on a link.
  #want(kind) {
    const [wanted, bit] = this.#wanted(kind);
    const rare = this.#rare;
    const old = rare?.flags ?? 0;
    const flags = ((wanted ? old | bit : old & ~bit) | (rare?.kept ?? 0) | (this._extra ?? 0)) >>> 0;
    if (flags === old) return;
    this.#more().flags = flags;
    // A destroyed node has no tree node to tell: effect cleanups remove listeners after React frees it.
    if (nodes[this.nodeId] !== undefined) native.listen(this.nodeId, flags);
  }

  // Whether this node's listeners (or link) want `kind`, and the flag bit that carries it.
  #wanted(kind) {
    const listeners = this.#rare?.listeners;
    const has = (type) => (listeners?.get(type)?.length ?? 0) > 0;
    if (SHARES_BIT(kind)) return [KINDS_OF_BIT(bitOf(kind)).some((each) => has(TYPES[each])), (1 << bitOf(kind)) >>> 0];
    const type = TYPES[kind];
    const wanted = has(type) || (MOUSE_OF.has(type) && has(MOUSE_OF.get(type))) || (kind === CLICK && (this._href || this._activate))
      || (kind === SELECTION_CHANGE && has("selectstart"));
    return [wanted, 1 << kind];
  }

  /** Listens again for every kind its listeners, kept kinds and `_extra` flags ask for. */
  _relisten() {
    let flags = (this.#rare?.kept ?? 0) | (this._extra ?? 0);
    for (let kind = 0; kind < TYPES.length; kind++) {
      const [wanted, bit] = this.#wanted(kind);
      if (wanted) flags |= bit;
    }
    flags >>>= 0;
    if (flags === (this.#rare?.flags ?? 0)) return;
    this.#more().flags = flags;
    if (nodes[this.nodeId] !== undefined) native.listen(this.nodeId, flags);
  }

  _keep(...types) {
    const rare = this.#more();
    for (const type of types) rare.kept = (rare.kept | (1 << bitOf(KIND_OF.get(type)))) >>> 0;
    this.#want(KIND_OF.get(types[0]));
  }

  /** The `tabindex` attribute as a number, else 0 for what takes focus by default and -1. */
  get tabIndex() {
    const text = this._tag !== undefined ? this.getAttribute("tabindex") : this._tabIndex;
    const number = text == null ? NaN : parseInt(String(text), 10);
    if (!Number.isNaN(number)) return number;
    const focusable = this instanceof Input || this instanceof CheckInput || this instanceof RangeInput
      || this instanceof ColorInput || this instanceof FileInput || this instanceof ButtonInput
      || this instanceof SelectElement || this instanceof ButtonElement || FOCUSABLE_TAGS.has(this._tag)
      || (this._tag === "a" && this.hasAttribute("href"));
    return focusable ? 0 : -1;
  }

  // An element reflects it to its `tabindex` attribute, as roving-focus code reads it back.
  set tabIndex(value) {
    const number = Math.trunc(Number(value)) || 0;
    if (this._tag !== undefined) this.setAttribute("tabindex", String(number));
    else {
      this._tabIndex = number;
      native.attribute(this.nodeId, "tabIndex", number);
    }
  }

  get disabled() {
    return this._tag !== undefined ? this.hasAttribute("disabled") : Boolean(this._disabled);
  }

  set disabled(value) {
    if (this._tag !== undefined) {
      if (value) this.setAttribute("disabled", "");
      else this.removeAttribute("disabled");
    } else {
      this._disabled = Boolean(value);
      native.attribute(this.nodeId, "disabled", value);
    }
  }

  focus() {
    native.focus(this.nodeId);
  }

  /**
   * Sends the pointer's records here until it lifts, as DOM `setPointerCapture`. Throws
   * `NotFoundError` for a pointer that is not down. The tree moves the capture of the
   * primary pointer; another finger keeps sending to the node it went down on.
   */
  setPointerCapture(pointerId) {
    const pointer = pointers.get(pointerId);
    if (!pointer) throw domError("NotFoundError", `no active pointer with id ${pointerId}`);
    if (!pointer.buttons) return;
    pointer.capture = this;
    if (pointer.primary) native.capture(this.nodeId);
  }

  releasePointerCapture(pointerId) {
    const pointer = pointers.get(pointerId);
    if (!pointer) throw domError("NotFoundError", `no active pointer with id ${pointerId}`);
    if (pointer.capture !== this) return;
    pointer.capture = null;
    if (pointer.primary) native.capture(0);
  }

  hasPointerCapture(pointerId) {
    return pointers.get(pointerId)?.capture === this;
  }

  /** `scrollTo(x, y)` or `scrollTo({ left, top, behavior })`; `behavior: "smooth"` animates, and `auto` follows `scroll-behavior`. */
  scrollTo(x, y) {
    scrollNode(this.nodeId, x, y, 0);
  }

  scroll(x, y) {
    scrollNode(this.nodeId, x, y, 0);
  }

  /** As `scrollTo`, by an amount from where the node is scrolled. */
  scrollBy(x, y) {
    scrollNode(this.nodeId, x, y, 4);
  }

  /** The border box in window coordinates, after any pending layout, as on the web. */
  getBoundingClientRect() {
    return readRect(this.nodeId);
  }

  /** One rectangle per fragment (a wrapped inline box has one per line). */
  getClientRects() {
    return readRects(native.rects?.(this.nodeId) ?? 0);
  }

  get clientLeft() { return metric(this.nodeId, 0); }
  get clientTop() { return metric(this.nodeId, 1); }
  get clientWidth() { return metric(this.nodeId, 2); }
  get clientHeight() { return metric(this.nodeId, 3); }
  get scrollWidth() { return metric(this.nodeId, 4); }
  get scrollHeight() { return metric(this.nodeId, 5); }
  get scrollLeft() { return metric(this.nodeId, 6); }
  set scrollLeft(value) { scrollNode(this.nodeId, { left: value }, undefined, 0); }
  get scrollTop() { return metric(this.nodeId, 7); }
  set scrollTop(value) { scrollNode(this.nodeId, { top: value }, undefined, 0); }
  get offsetParent() { return nodes[metric(this.nodeId, 8)] ?? null; }
  get offsetLeft() { return metric(this.nodeId, 9); }
  get offsetTop() { return metric(this.nodeId, 10); }
  get offsetWidth() { return metric(this.nodeId, 11); }
  get offsetHeight() { return metric(this.nodeId, 12); }

  /**
   * Scrolls every scroll container around this node to show it, as on the web: `true` or
   * nothing aligns to the start, `false` to the end, or `{ block, inline, behavior }`.
   * `scroll-margin`, `scroll-padding` and `scroll-snap` apply.
   */
  scrollIntoView(options = true) {
    if (options === null || typeof options !== "object") {
      const top = options !== false;
      native.scrollIntoView?.(this.nodeId, top ? 0 : 2, 3, 0, 0);
      return;
    }
    native.scrollIntoView?.(this.nodeId, alignment(options.block, 0), alignment(options.inline, 3), BEHAVIORS[options.behavior] ?? 0, 0);
  }

  /** WebKit's: scrolls only containers that do not already show the node, centering it unless `center` is false. */
  scrollIntoViewIfNeeded(center = true) {
    const code = center ? 1 : 3;
    native.scrollIntoView?.(this.nodeId, code, code, 0, 1);
  }

  /** Whether this node matches CSS `selector`, by the same matcher as stylesheets. */
  matches(selector) {
    const trimmed = String(selector).trim();
    if (trimmed === ":popover-open") return Boolean(this._popoverOpen);
    if (trimmed === ":modal") return Boolean(this._modal);
    return queried(0, this, selector) === 1;
  }

  webkitMatchesSelector(selector) {
    return this.matches(selector);
  }

  /** This node or its nearest ancestor that matches `selector`, or null. */
  closest(selector) {
    return nodes[queried(1, this, selector)] ?? null;
  }

  /** The first descendant, in tree order, that matches `selector`, or null. */
  querySelector(selector) {
    return nodes[queried(2, this, selector)] ?? null;
  }

  /** Every descendant that matches `selector`, in tree order: a static list. */
  querySelectorAll(selector) {
    const ids = queried(3, this, selector);
    return typeof ids === "string" && ids !== "" ? ids.split(",").map((id) => nodes[Number(id)]).filter(Boolean) : [];
  }

  setVirtualList(options, onRange) {
    if (!options) {
      this._virtualRange = null;
      native.virtualList(this.nodeId);
      return;
    }
    const { count, estimatedRowHeight, overscan = 128, gap = 0, revision = 0 } = options;
    if (!Number.isInteger(count) || count < 0 || count >= 0xffffffff || !Number.isFinite(estimatedRowHeight) || estimatedRowHeight <= 0 ||
        !Number.isFinite(overscan) || overscan < 0 || !Number.isFinite(gap) || gap < 0 ||
        !Number.isSafeInteger(revision) || revision < 0 || typeof onRange !== "function") {
      throw new TypeError("Invalid virtual list configuration");
    }
    this._virtualRange = onRange;
    native.virtualList(this.nodeId, count, estimatedRowHeight, overscan, gap, revision);
  }

  bindVirtualRows(indices) {
    if (indices.length !== this.childNodes.length) throw new Error("Bind every direct virtual row");
    const pairs = [];
    for (let i = 0; i < indices.length; i++) {
      if (!Number.isInteger(indices[i]) || indices[i] < 0 || indices[i] >= 0xffffffff ||
          (i > 0 && indices[i] <= indices[i - 1])) throw new RangeError("Virtual indices must be sorted and unique");
      pairs.push(indices[i], this.childNodes[i].nodeId);
    }
    native.virtualItems(this.nodeId, ...pairs);
  }

  /**
   * As on the web. `options` is `true` or `{ capture: true }` for the capture phase, and
   * `{ once: true }` for a listener that runs once. A type the tree has no event for is the
   * app's own, sent with `dispatchEvent`.
   */
  addEventListener(type, listener, options) {
    const signal = options?.signal;
    if (listener == null || signal?.aborted) return;
    const kind = KIND_OF.get(LISTENS_AS.get(type) ?? type);
    const capture = options === true || !!options?.capture;
    const listeners = (this.#more().listeners ??= new Map());
    let list = listeners.get(type);
    if (!list) listeners.set(type, (list = []));
    if (list.some((entry) => entry.listener === listener && entry.capture === capture)) return;
    list.push({ listener, capture, once: !!options?.once });
    if (kind !== undefined) this.#want(kind);
    signal?.addEventListener("abort", () => this.removeEventListener(type, listener, capture), { once: true });
  }

  removeEventListener(type, listener, options) {
    const list = this.#rare?.listeners?.get(type);
    if (!list) return;
    const capture = options === true || !!options?.capture;
    const index = list.findIndex((entry) => entry.listener === listener && entry.capture === capture);
    if (index < 0) return;
    list.splice(index, 1);
    const kind = KIND_OF.get(LISTENS_AS.get(type) ?? type);
    if (kind !== undefined) this.#want(kind);
  }

  /** Sends `event` (an `Event` or `CustomEvent`) through the tree from this node, as on the web. */
  dispatchEvent(event) {
    if (typeof event?.type !== "string") throw new TypeError("dispatchEvent takes an Event");
    return dispatchEvent(adopt(event, this));
  }

  /** Runs the capture or the bubble listeners of `event.type`. Used by the dispatcher. */
  _run(event, capture) {
    const list = this.#rare?.listeners?.get(event.type);
    if (!list) return;
    for (const entry of list.slice()) {
      if (event._immediate) return;
      if (entry.capture !== capture) continue;
      if (entry.once) this.removeEventListener(event.type, entry.listener, entry.capture);
      try {
        if (typeof entry.listener === "function") entry.listener.call(this, event);
        else entry.listener.handleEvent(event);
      } catch (error) {
        reportError(error);
      }
    }
  }
}

/** A text leaf. It takes its look from its parent. */
export class Text extends Node {
  #data = "";

  constructor(data = "") {
    super("text");
    this.data = data;
  }

  get data() {
    return this.#data;
  }

  set data(value) {
    this.replaceData(0, this.#data.length, value == null ? "" : value);
  }

  get nodeType() {
    return 3;
  }

  get nodeName() {
    return "#text";
  }

  get nodeValue() {
    return this.#data;
  }

  set nodeValue(value) {
    this.data = value;
  }

  get textContent() {
    return this.#data;
  }

  set textContent(value) {
    this.data = value;
  }

  get length() {
    return this.#data.length;
  }

  _shallowClone() {
    return new Text(this.#data);
  }

  substringData(offset, count) {
    offset = offset >>> 0;
    if (offset > this.#data.length) throw domError("IndexSizeError", "the offset is past the end of the text");
    return this.#data.substring(offset, offset + (count >>> 0));
  }

  appendData(data) {
    this.replaceData(this.#data.length, 0, data);
  }

  insertData(offset, data) {
    this.replaceData(offset, 0, data);
  }

  deleteData(offset, count) {
    this.replaceData(offset, count, "");
  }

  replaceData(offset, count, data) {
    offset = offset >>> 0;
    count = count >>> 0;
    data = String(data);
    const old = this.#data;
    if (offset > old.length) throw domError("IndexSizeError", "the offset is past the end of the text");
    if (offset + count > old.length) count = old.length - offset;
    if (liveRanges.size) eachLiveRange((range) => range._replaced(this, offset, count, data.length));
    const value = old.slice(0, offset) + data + old.slice(offset + count);
    if (value === old && value !== "") return;
    this.#data = value;
    native.setText(this.nodeId, value);
    if (moCharDataCount && (this._mutationTargets || moSubtreeCharData)) characterDataRecord(this, old);
    if (this.parentNode instanceof OptionElement) this.parentNode._notifySelect();
    else if (this.parentNode instanceof OutputElement) this.parentNode._textChanged();
    if (this._svgText) svgChanged(this);
    if (styleElements.size && this.parentNode instanceof StyleElement) stylesChanged();
  }

  /** Splits at `offset`: this keeps the text before it, and a new next sibling the rest. */
  splitText(offset) {
    offset = offset >>> 0;
    const length = this.#data.length;
    if (offset > length) throw domError("IndexSizeError", "the offset is past the end of the text");
    const rest = new Text(this.#data.slice(offset));
    const parent = this.parentNode;
    if (parent) {
      parent.insertBefore(rest, this.nextSibling);
      const index = indexIn(this);
      if (liveRanges.size) eachLiveRange((range) => range._split(this, rest, offset, parent, index));
    }
    this.replaceData(offset, length - offset, "");
    return rest;
  }
}

Object.defineProperty(Text.prototype, "kind", { value: "text", writable: true, configurable: true });

// `<br>`: to the tree a text node of U+2028, which breaks the line whatever `white-space`
// says and gives an empty block its line, and to scripts an element with no children. Its
// attributes stay here: the tree's text nodes have none.
const LINE_BREAK = "\u2028";

export class LineBreak extends Node {
  #attributes = new Map();

  constructor() {
    super("text");
    this.kind = "text";
    this._tag = "br";
    native.setText(this.nodeId, LINE_BREAK);
  }

  get nodeType() { return 1; }
  get textContent() { return ""; }
  set textContent(_value) {}
  getAttribute(name) { return this.#attributes.get(String(name).toLowerCase()) ?? null; }
  hasAttribute(name) { return this.#attributes.has(String(name).toLowerCase()); }
  getAttributeNames() { return [...this.#attributes.keys()]; }
  removeAttribute(name) { this.setAttribute(name, null); }

  setAttribute(name, value) {
    name = String(name).toLowerCase();
    if (name === "classname") name = "class";
    if (value == null) this.#attributes.delete(name);
    else this.#attributes.set(name, String(value));
  }

  get className() { return this.getAttribute("class") ?? ""; }
  set className(value) { this.setAttribute("class", value); }
  appendChild() { throw domError("HierarchyRequestError", "a br has no children"); }
  insertBefore() { throw domError("HierarchyRequestError", "a br has no children"); }

  _shallowClone() {
    const copy = new LineBreak();
    for (const [name, value] of this.#attributes) copy.setAttribute(name, value);
    return copy;
  }

  cloneNode() { return this._shallowClone(); }
}

// A point the tree has in a `<br>` (its text node), as a point in the br's parent.
function fromTreePoint(node, offset) {
  if (!(node instanceof LineBreak) || !node.parentNode) return [node, offset];
  return [node.parentNode, indexIn(node) + (offset > 0 ? 1 : 0)];
}

/**
 * An editable text field. `value` follows what the user types. Selection offsets are UTF-16
 * string indices, as on the web; the tree counts UTF-8 bytes, converted here.
 */
export class Input extends Node {
  #value = "";
  #start = 0;
  #end = 0;
  #direction = "forward";
  #dirtyValue = false;
  #committedValue = "";
  #defaultTextValue = "";
  #checked = false;
  #indeterminate = false;
  #files = [];
  _customValidity = "";
  _userInteracted = false;

  constructor(type = "text") {
    super("input");
    this._inputType = canonicalInputType(type);
    this._keep("input", "selectionchange", "focus", "blur", "keydown");
  }

  /** The text the selection offsets index into. */
  _text() {
    return this.#value;
  }

  _shallowClone() {
    const copy = elementLike(this) ?? new this.constructor();
    copy.value = this.#value;
    return copy;
  }

  get type() {
    if (this._tag === "textarea") return "textarea";
    return canonicalInputType(this.getAttribute("type") ?? this._inputType ?? "text");
  }

  set type(value) {
    if (this._tag === "textarea") return;
    const next = canonicalInputType(value);
    this._inputType = next;
    super.setAttribute("type", String(value));
    syncValidationState(this);
  }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get placeholder() { return this.getAttribute("placeholder") ?? ""; }
  set placeholder(v) { this.setAttribute("placeholder", String(v)); }

  get readOnly() { return this.hasAttribute("readonly"); }
  set readOnly(v) { if (v) this.setAttribute("readonly", ""); else this.removeAttribute("readonly"); }

  get required() { return this.hasAttribute("required"); }
  set required(v) { if (v) this.setAttribute("required", ""); else this.removeAttribute("required"); }

  get multiple() { return this.hasAttribute("multiple"); }
  set multiple(v) { if (v) this.setAttribute("multiple", ""); else this.removeAttribute("multiple"); }

  get pattern() { return this.getAttribute("pattern") ?? ""; }
  set pattern(v) { this.setAttribute("pattern", String(v)); }

  get min() { return this.getAttribute("min") ?? ""; }
  set min(v) { this.setAttribute("min", String(v)); }

  get max() { return this.getAttribute("max") ?? ""; }
  set max(v) { this.setAttribute("max", String(v)); }

  get step() { return this.getAttribute("step") ?? ""; }
  set step(v) { this.setAttribute("step", String(v)); }

  get accept() { return this.getAttribute("accept") ?? ""; }
  set accept(v) { this.setAttribute("accept", String(v)); }

  get autocomplete() { return this.getAttribute("autocomplete") ?? ""; }
  set autocomplete(v) { this.setAttribute("autocomplete", String(v)); }

  get dirName() { return this.getAttribute("dirname") ?? ""; }
  set dirName(v) { this.setAttribute("dirname", String(v)); }

  get minLength() {
    const raw = this.getAttribute("minlength");
    if (raw === null) return -1;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : -1;
  }
  set minLength(v) {
    const n = Math.trunc(Number(v));
    if (n < 0) throw domError("IndexSizeError", "minLength cannot be negative");
    this.setAttribute("minlength", String(n));
  }

  get maxLength() {
    const raw = this.getAttribute("maxlength");
    if (raw === null) return -1;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : -1;
  }
  set maxLength(v) {
    const n = Math.trunc(Number(v));
    if (n < 0) throw domError("IndexSizeError", "maxLength cannot be negative");
    this.setAttribute("maxlength", String(n));
  }

  get size() {
    const raw = this.getAttribute("size");
    const n = raw === null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
  }
  set size(v) {
    const n = Math.trunc(Number(v));
    if (n <= 0) throw domError("IndexSizeError", "size must be greater than zero");
    this.setAttribute("size", String(n));
  }

  get rows() {
    const raw = this.getAttribute("rows");
    const n = raw === null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 2;
  }
  set rows(v) {
    const n = Math.trunc(Number(v));
    this.setAttribute("rows", String(n > 0 ? n : 2));
  }

  get cols() {
    const raw = this.getAttribute("cols");
    const n = raw === null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 20;
  }
  set cols(v) {
    const n = Math.trunc(Number(v));
    this.setAttribute("cols", String(n > 0 ? n : 20));
  }

  get wrap() { return this.getAttribute("wrap") ?? ""; }
  set wrap(v) { this.setAttribute("wrap", String(v)); }

  get textLength() { return this.#value.length; }

  get defaultValue() {
    if (this._tag === "textarea") return this.#defaultTextValue;
    return this.getAttribute("value") ?? "";
  }
  set defaultValue(v) {
    const text = String(v);
    if (this._tag === "textarea") {
      this.#defaultTextValue = text;
      if (!this.#dirtyValue) this._setValueInternal(text, false);
    } else {
      this.setAttribute("value", text);
    }
  }

  // Fallback checked/indeterminate/files for dynamically re-typed inputs (`createElement("input"); el.type = "checkbox"`).
  get checked() { return this.#checked; }
  set checked(v) {
    const next = !!v;
    if (next === this.#checked) return;
    this.#checked = next;
    native.attribute(this.nodeId, "checked", next);
    syncValidationState(this);
  }
  get indeterminate() { return this.#indeterminate; }
  set indeterminate(v) {
    const next = !!v;
    if (next === this.#indeterminate) return;
    this.#indeterminate = next;
    native.attribute(this.nodeId, "indeterminate", next);
  }
  get files() { return this.type === "file" ? createFileList(this.#files) : null; }
  set files(list) {
    if (this.type !== "file") return;
    this.#files = list ? Array.from(list) : [];
    syncValidationState(this);
  }

  get form() { return formOwnerOf(this); }
  get labels() { return this.type === "hidden" ? [] : labelsOf(this); }
  get list() {
    const id = this.getAttribute("list");
    if (!id) return null;
    const target = findById(id);
    return target?.localName === "datalist" ? target : null;
  }

  get value() {
    return this.#value;
  }

  set value(value) {
    this._setValueInternal(value == null ? "" : String(value), true);
  }

  _setValueInternal(value, markDirty) {
    if (this._tag !== "textarea") value = sanitizeInputValue(this.type, value);
    if (markDirty) this.#dirtyValue = true;
    if (value !== this.#value) {
      this.#value = value;
      native.setText(this.nodeId, value);
      this.#start = this.#end = value.length;
      this.#direction = "forward";
    }
    syncValidationState(this);
  }

  get valueAsNumber() {
    return parseInputValueAsNumber(this.type, this.#value);
  }

  set valueAsNumber(v) {
    const t = this.type;
    if (!NUMERIC_OR_TEMPORAL_TYPES.has(t)) {
      throw domError("InvalidStateError", "This input element does not support valueAsNumber.");
    }
    const n = Number(v);
    if (!Number.isFinite(n)) {
      this.value = "";
      return;
    }
    this.value = formatNumberForInputType(t, n);
  }

  get valueAsDate() {
    const t = this.type;
    if (!DATE_VALUE_TYPES.has(t)) return null;
    const ms = parseInputValueAsNumber(t, this.#value);
    return Number.isFinite(ms) ? new Date(t === "month" ? Date.UTC(1970 + Math.floor(ms / 12), ((ms % 12) + 12) % 12, 1) : ms) : null;
  }

  set valueAsDate(date) {
    const t = this.type;
    if (!DATE_VALUE_TYPES.has(t)) {
      throw domError("InvalidStateError", "This input element does not support valueAsDate.");
    }
    if (date === null) {
      this.value = "";
      return;
    }
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      this.value = "";
      return;
    }
    const ms = date.getTime();
    if (t === "month") {
      this.value = formatNumberForInputType("month", (date.getUTCFullYear() - 1970) * 12 + date.getUTCMonth());
    } else if (t === "time") {
      const dayMs = ((ms % 86400000) + 86400000) % 86400000;
      this.value = formatNumberForInputType("time", dayMs);
    } else {
      this.value = formatNumberForInputType(t, ms);
    }
  }

  stepUp(n = 1) {
    stepInputValue(this, Math.trunc(Number(n) || 0));
  }

  stepDown(n = 1) {
    stepInputValue(this, -Math.trunc(Number(n) || 0));
  }

  get willValidate() { return isCandidateForConstraintValidation(this); }
  get validity() { return computeValidity(this); }
  get validationMessage() { return validationMessageFor(this); }
  setCustomValidity(message) {
    this._customValidity = String(message);
    syncValidationState(this);
  }
  checkValidity() { return runCheckValidity(this); }
  reportValidity() { return runReportValidity(this); }

  _reset() {
    this.#dirtyValue = false;
    this._userInteracted = false;
    this._setValueInternal(this.defaultValue, false);
    this.#committedValue = this.#value;
  }

  _handleFocus() {
    this.#committedValue = this.#value;
  }

  _handleBlur() {
    if (this.#value !== this.#committedValue) {
      this.#committedValue = this.#value;
      this._userInteracted = true;
      syncValidationState(this);
      const change = new Event("change", this);
      change.bubbles = true;
      dispatchEvent(change);
    }
  }

  _handleKey(event) {
    if (isControlDisabled(this)) return false;
    if (this._tag === "input" && event.key === "Enter") {
      event.preventDefault();
      if (this.#value !== this.#committedValue) {
        this.#committedValue = this.#value;
        this._userInteracted = true;
        const change = new Event("change", this);
        change.bubbles = true;
        dispatchEvent(change);
      }
      implicitFormSubmit(this);
      return true;
    }
    if (this._tag === "input" && this.type === "number" && !this.readOnly && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      event.preventDefault();
      const before = this.#value;
      try {
        if (event.key === "ArrowUp") this.stepUp(1);
        else this.stepDown(1);
      } catch {}
      if (this.#value !== before) {
        this._userInteracted = true;
        const inputEv = new Event("input", this);
        inputEv.bubbles = true;
        dispatchEvent(inputEv);
        const changeEv = new Event("change", this);
        changeEv.bubbles = true;
        dispatchEvent(changeEv);
      }
      return true;
    }
    return false;
  }

  setAttribute(name, value) {
    const lower = String(name).toLowerCase();
    if (lower === "value" && this._tag !== "textarea") {
      super.setAttribute(name, value);
      if (!this.#dirtyValue) this._setValueInternal(value == null ? "" : String(value), false);
      else syncValidationState(this);
      return;
    }
    if (lower === "type" && this._tag !== "textarea") {
      this._inputType = canonicalInputType(value);
    }
    super.setAttribute(name, value);
    if (VALIDATION_ATTRS.has(lower)) syncValidationState(this);
  }

  get selectionStart() {
    return this.#start;
  }

  set selectionStart(value) {
    const start = clampIndex(value, this._text().length);
    this.setSelectionRange(start, Math.max(start, this.#end), this.#direction);
  }

  get selectionEnd() {
    return this.#end;
  }

  set selectionEnd(value) {
    this.setSelectionRange(this.#start, clampIndex(value, this._text().length), this.#direction);
  }

  get selectionDirection() {
    return this.#direction;
  }

  set selectionDirection(value) {
    this.setSelectionRange(this.#start, this.#end, value);
  }

  /** Selects `start` to `end`; with `direction` "backward" the caret sits at `start`. */
  setSelectionRange(start, end, direction = "none") {
    const text = this._text();
    end = clampIndex(end, text.length);
    start = Math.min(clampIndex(start, text.length), end);
    const backward = direction === "backward";
    this.#start = start;
    this.#end = end;
    this.#direction = backward ? "backward" : "forward";
    const anchor = byteOf(text, backward ? end : start);
    const focus = byteOf(text, backward ? start : end);
    native.select(this.nodeId, anchor, focus);
  }

  /** Selects the whole value. */
  select() {
    this.setSelectionRange(0, this._text().length);
  }

  /**
   * Replaces `start` to `end` (the selection by default) with `replacement`. `selectionMode`
   * is "select", "start", "end" or "preserve", as on the web.
   */
  setRangeText(replacement, start, end, selectionMode = "preserve") {
    replacement = String(replacement);
    const text = this._text();
    if (start === undefined) {
      start = this.#start;
      end = this.#end;
    } else if (end === undefined) {
      throw new TypeError("setRangeText needs both start and end");
    } else if (Number(start) > Number(end)) {
      throw domError("IndexSizeError", "setRangeText: start is after end");
    }
    start = clampIndex(start, text.length);
    end = clampIndex(end, text.length);
    let selectionStart = this.#start;
    let selectionEnd = this.#end;
    const delta = replacement.length - (end - start);
    const newEnd = start + replacement.length;
    if (selectionMode === "select") {
      selectionStart = start;
      selectionEnd = newEnd;
    } else if (selectionMode === "start") {
      selectionStart = selectionEnd = start;
    } else if (selectionMode === "end") {
      selectionStart = selectionEnd = newEnd;
    } else {
      if (selectionStart > end) selectionStart += delta;
      else if (selectionStart > start) selectionStart = start;
      if (selectionEnd > end) selectionEnd += delta;
      else if (selectionEnd > start) selectionEnd = newEnd;
    }
    const direction = this.#direction;
    this._replace(start, end, replacement);
    this.setSelectionRange(selectionStart, selectionEnd, direction);
  }

  _replace(start, end, replacement) {
    const text = this.#value;
    this.value = text.slice(0, start) + replacement + text.slice(end);
  }

  // From the tree: the value and selection in UTF-8 bytes.
  _changed(value, anchor, focus) {
    const maxLen = this.maxLength;
    if (maxLen >= 0 && value.length > maxLen && value.length > this.#value.length) {
      value = value.slice(0, maxLen);
      native.setText(this.nodeId, value);
    }
    this.#value = value;
    this.#dirtyValue = true;
    this._userInteracted = true;
    this.#take(byteIndex(value, anchor), byteIndex(value, focus));
    syncValidationState(this);
  }

  _selected(start, end) {
    const text = this._text();
    this.#take(byteIndex(text, start), byteIndex(text, end));
  }

  // The tree reports the low and high offsets only, so a selection it changed reads forward
  // unless it is the one set here.
  #take(a, b) {
    const start = Math.min(a, b);
    const end = Math.max(a, b);
    if (start === this.#start && end === this.#end) return;
    this.#start = start;
    this.#end = end;
    this.#direction = "forward";
  }
}

function clampIndex(value, length) {
  const number = Math.trunc(Number(value)) || 0;
  return Math.min(Math.max(number, 0), length);
}

// A UTF-8 offset from the tree as a string index; NaN and missing read as 0.
function byteIndex(text, byte) {
  return indexOf(text, Number(byte) || 0);
}

// Inline SVG markup as icon resources: identical markup shares one, freed when no `<svg>`
// shows it. The ids start high, clear of resources a host or a URL table numbers from 1.
const ICONS = new Map();
let nextIcon = 0x40000000;

function holdIcon(markup) {
  let entry = ICONS.get(markup);
  if (!entry) {
    entry = { id: nextIcon++, count: 0 };
    ICONS.set(markup, entry);
    native.defineIcon(entry.id, markup);
  }
  entry.count++;
  return entry.id;
}

function dropIcon(markup) {
  const entry = ICONS.get(markup);
  if (entry && --entry.count === 0) {
    ICONS.delete(markup);
    native.release(entry.id);
  }
}

// Addresses as image resources, shared and freed as markup is. The tree keeps a load state per
// number, so these count from 1. The loader tells an SVG file from a bitmap by itself.
const ADDRESSES = new Map();
let nextAddress = 1;

function holdAddress(url) {
  let entry = ADDRESSES.get(url);
  if (!entry) {
    entry = { id: nextAddress++, count: 0 };
    ADDRESSES.set(url, entry);
    native.load(entry.id, url, false);
  }
  entry.count++;
  return entry.id;
}

function dropAddress(url) {
  const entry = ADDRESSES.get(url);
  if (entry && --entry.count === 0) {
    ADDRESSES.delete(url);
    native.release(entry.id);
  }
}

/**
 * An image, as an `<img>`: `src` is its address, a `data:` URL (base64 or percent-encoded),
 * a file or `http(s):`. An SVG file draws as an inline `<svg>` does. It hears `load` and
 * `error` when the address loads or fails.
 */
export class Image extends Node {
  #src = "";
  #settled = 0;
  #naturalWidth = 0;
  #naturalHeight = 0;
  #decodeWaiters = [];

  constructor(src = "") {
    super("image");
    this._keep("load", "error");
    this._relisten();
    this.src = src;
  }

  get src() {
    return this.#src;
  }

  set src(url) {
    url = url == null ? "" : String(url);
    if (url === this.#src) return;
    if (this.#src) dropAddress(this.#src);
    this.#src = url;
    this.#settled = 0;
    this.#naturalWidth = 0;
    this.#naturalHeight = 0;
    if (!url && this.#decodeWaiters.length) this._settleDecode(false);
    native.source(this.nodeId, url ? holdAddress(url) : 0);
  }

  get currentSrc() {
    return this.#src;
  }

  #syncInfo() {
    if (!this.#src) return { state: 0, width: 0, height: 0 };
    if (this.#settled !== 0) {
      return { state: this.#settled, width: this.#naturalWidth, height: this.#naturalHeight };
    }
    if (native.imageInfo?.(this.nodeId) === 3) {
      const state = native.geometry(0) | 0;
      const width = Math.round(native.geometry(1));
      const height = Math.round(native.geometry(2));
      if (state !== 0) {
        this.#settled = state;
        this.#naturalWidth = width;
        this.#naturalHeight = height;
        this._settleDecode(state === 1);
      }
      return { state, width, height };
    }
    return { state: 0, width: 0, height: 0 };
  }

  get naturalWidth() {
    return this.#syncInfo().width;
  }

  get naturalHeight() {
    return this.#syncInfo().height;
  }

  get complete() {
    if (!this.#src) return true;
    return this.#syncInfo().state !== 0;
  }

  get width() {
    const attr = this.getAttribute("width");
    if (attr != null) {
      const n = parseInt(attr, 10);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
    return this.naturalWidth;
  }

  set width(value) {
    const n = Math.max(0, Number(value) | 0);
    this.setAttribute("width", String(n));
  }

  get height() {
    const attr = this.getAttribute("height");
    if (attr != null) {
      const n = parseInt(attr, 10);
      if (!Number.isNaN(n) && n >= 0) return n;
    }
    return this.naturalHeight;
  }

  set height(value) {
    const n = Math.max(0, Number(value) | 0);
    this.setAttribute("height", String(n));
  }

  decode() {
    if (!this.#src) {
      const ErrorClass = globalThis.DOMException ?? Error;
      return Promise.reject(new ErrorClass("The image has no source.", "EncodingError"));
    }
    const info = this.#syncInfo();
    if (info.state === 1) return Promise.resolve();
    if (info.state === 2) {
      const ErrorClass = globalThis.DOMException ?? Error;
      return Promise.reject(new ErrorClass("The source image cannot be decoded.", "EncodingError"));
    }
    return new Promise((resolve, reject) => {
      this.#decodeWaiters.push({ resolve, reject });
    });
  }

  _onSourceEvent(ok) {
    if (!this.#src) return;
    if (ok && native.imageInfo?.(this.nodeId) === 3) {
      this.#settled = 1;
      this.#naturalWidth = Math.round(native.geometry(1));
      this.#naturalHeight = Math.round(native.geometry(2));
    } else {
      this.#settled = ok ? 1 : 2;
      if (!ok) {
        this.#naturalWidth = 0;
        this.#naturalHeight = 0;
      }
    }
    this._settleDecode(ok);
  }

  _settleDecode(ok) {
    if (!this.#decodeWaiters.length) return;
    const waiters = this.#decodeWaiters.splice(0, this.#decodeWaiters.length);
    if (ok) {
      for (const waiter of waiters) waiter.resolve();
    } else {
      const ErrorClass = globalThis.DOMException ?? Error;
      const err = new ErrorClass("The source image cannot be decoded.", "EncodingError");
      for (const waiter of waiters) waiter.reject(err);
    }
  }

  _readPixels() {
    if (!this.#src || native.imagePixels?.(this.nodeId) !== 2) return null;
    const width = native.geometry(0) | 0;
    const height = native.geometry(1) | 0;
    if (width <= 0 || height <= 0) return null;
    const data = new Uint8ClampedArray(width * height * 4);
    native.imageTake(data);
    return { width, height, data };
  }

  setAttribute(name, value) {
    if (name === "src") {
      this.src = value == null ? "" : String(value);
    }
    super.setAttribute(name, value);
  }

  _forget() {
    if (this.#src) dropAddress(this.#src);
    this.#src = "";
    this.#settled = 0;
    this.#naturalWidth = 0;
    this.#naturalHeight = 0;
    if (this.#decodeWaiters.length) this._settleDecode(false);
  }

  _shallowClone() {
    const copy = elementLike(this) ?? new Image();
    copy.src = this.#src;
    return copy;
  }
}

/**
 * A canvas the application draws with WebGPU or Canvas 2D, as a `<canvas>`: `width` and
 * `height` are the size of what is drawn in pixels (300 by 150 at first), `getContext("webgpu")`
 * gives a `GPUCanvasContext` and `getContext("2d")` a `CanvasRenderingContext2D`. The node lays out as an image of that size does: its style can
 * stretch it, and `objectFit` says how the drawing fits. Drawing happens on a GPU device of
 * the application's own, so a canvas that is slow to draw does not slow the rest of the window.
 */
export class Canvas extends Node {
  #width = 300;
  #height = 150;
  #context = null;
  #kind = "";

  constructor() {
    super("canvas");
  }

  get width() {
    return this.#width;
  }

  set width(value) {
    value = Math.max(0, Number(value) | 0);
    if (value === this.#width) return;
    this.#width = value;
    this.#context?._resized();
  }

  get height() {
    return this.#height;
  }

  set height(value) {
    value = Math.max(0, Number(value) | 0);
    if (value === this.#height) return;
    this.#height = value;
    this.#context?._resized();
  }

  /**
   * The canvas's `GPUCanvasContext` for "webgpu" or `CanvasRenderingContext2D` for "2d"; null
   * for any other kind, or for a kind other than the one the canvas already has.
   */
  getContext(kind, options) {
    if (kind !== "webgpu" && kind !== "2d") return null;
    if (this.#context) return this.#kind === kind ? this.#context : null;
    const api = kind === "2d" ? native.canvas2dLoad?.() : native.gpuLoad?.();
    if (!api) return null;
    this.#kind = kind;
    return (this.#context = api.context(this, options));
  }

  #encodePng() {
    const w = this.#width | 0;
    const h = this.#height | 0;
    if (w <= 0 || h <= 0 || !native.pngEncode || !native.pngTake) return null;
    const data = this.#kind === "2d" && this.#context?.getImageData
      ? this.#context.getImageData(0, 0, w, h).data
      : new Uint8ClampedArray(w * h * 4);
    const len = native.pngEncode(w, h, data);
    if (!len || len <= 0) return null;
    const bytes = new Uint8Array(len);
    native.pngTake(bytes);
    return bytes;
  }

  toBlob(callback, _type = "image/png", _quality) {
    if (typeof callback !== "function") throw new TypeError("Canvas.toBlob requires a callback");
    const bytes = this.#encodePng();
    const BlobClass = globalThis.Blob;
    const blob = bytes && BlobClass ? new BlobClass([bytes], { type: "image/png" }) : null;
    queueMicrotask(() => callback(blob));
  }

  toDataURL(_type = "image/png", _quality) {
    const bytes = this.#encodePng();
    if (!bytes) return "data:,";
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return "data:image/png;base64," + globalThis.btoa(binary);
  }

  setAttribute(name, value) {
    if (name === "width") this.width = value == null ? 300 : value;
    else if (name === "height") this.height = value == null ? 150 : value;
    else super.setAttribute(name, value);
  }

  getAttribute(name) {
    if (name === "width") return String(this.#width);
    if (name === "height") return String(this.#height);
    return super.getAttribute(name);
  }

  _shallowClone() {
    const copy = elementLike(this) ?? new Canvas();
    copy.width = this.#width;
    copy.height = this.#height;
    return copy;
  }
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// SVG attribute names that are camel case in SVG itself. Any other name with a capital letter
// is a React-style spelling of a hyphenated one (`strokeWidth` for `stroke-width`).
const SVG_CAMEL = new Set([
  "viewBox", "preserveAspectRatio", "gradientUnits", "gradientTransform", "patternUnits",
  "patternContentUnits", "patternTransform", "clipPathUnits", "maskUnits", "maskContentUnits",
  "markerUnits", "markerWidth", "markerHeight", "refX", "refY", "spreadMethod", "stdDeviation",
  "textLength", "lengthAdjust", "startOffset", "pathLength", "baseFrequency", "numOctaves",
  "filterUnits", "primitiveUnits", "kernelMatrix", "kernelUnitLength", "tableValues",
  "surfaceScale", "specularConstant", "specularExponent", "diffuseConstant", "limitingConeAngle",
  "pointsAtX", "pointsAtY", "pointsAtZ", "edgeMode", "targetX", "targetY", "xChannelSelector",
  "yChannelSelector", "attributeName", "attributeType", "calcMode", "keyTimes", "keySplines",
  "keyPoints", "repeatCount", "repeatDur", "systemLanguage", "requiredFeatures", "zoomAndPan",
  "glyphRef", "stitchTiles", "viewTarget", "contentScriptType", "contentStyleType",
]);
const SVG_NAMES = new Map([
  ["className", "class"], ["htmlFor", "for"], ["xlinkHref", "xlink:href"], ["xlinkTitle", "xlink:title"],
  ["xmlSpace", "xml:space"], ["xmlLang", "xml:lang"], ["xmlnsXlink", "xmlns:xlink"],
]);

function svgName(name) {
  name = String(name);
  const named = SVG_NAMES.get(name);
  if (named) return named;
  if (SVG_CAMEL.has(name) || !/[A-Z]/.test(name)) return name;
  return name.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
}

function escaped(text, attribute) {
  text = String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return attribute ? text.replace(/"/g, "&quot;") : text;
}

// The svg roots whose markup changed, drawn again once, before the host applies the mutations.
const changedSvgs = new Set();

function drawSvgs() {
  for (const svg of changedSvgs) svg._draw();
  changedSvgs.clear();
}

/** The element of `node` in an `<svg>` subtree: its text, or its element. */
function svgOwner(node) {
  for (let at = node; at; at = at.parentNode) if (at instanceof Svg) return at;
  return null;
}

function svgChanged(node) {
  const svg = svgOwner(node);
  if (!svg || changedSvgs.has(svg)) return;
  if (changedSvgs.size === 0) queueMicrotask(drawSvgs);
  changedSvgs.add(svg);
}

// A live svg: after its first drawing, an `<svg>` whose elements change sends each change to
// the tree as it happens (`svgInsert`, `svgAttribute`, `svgRemove`), and the tree draws its
// shapes as paths, so a frame of an animation costs what it changes. This needs content the
// tree's live svg draws; anything else keeps the svg drawn as markup.
const LIVE_TAGS = new Set([
  "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "defs", "clipPath",
  "linearGradient", "radialGradient", "stop", "title", "desc", "metadata",
]);
const QUIET_TAGS = new Set(["title", "desc", "metadata"]);
const UNLIVE_ATTRIBUTES = new Set(["mask", "filter", "marker", "marker-start", "marker-mid", "marker-end"]);
const UNLIVE_STYLE = /(^|;)\s*(mask|filter|marker)[\w-]*\s*:/;

function liveAttribute(name, text) {
  return !UNLIVE_ATTRIBUTES.has(name) && !(name === "style" && UNLIVE_STYLE.test(text));
}

/** Whether any element inside `child` carries class/data attributes that page CSS can target. */
function hasStyledDescendant(child) {
  if (!(child instanceof SvgElement)) return false;
  for (const [name] of child._attributes()) {
    if (name === "class" || name.startsWith("data-")) return true;
  }
  for (const grandchild of child.childNodes) if (hasStyledDescendant(grandchild)) return true;
  return false;
}

/** Whether the tree's live svg can draw `child` and what is in it. */
function liveable(child, quiet = false) {
  if (!(child instanceof SvgElement)) return quiet;
  if (!LIVE_TAGS.has(child.localName)) return false;
  for (const [name, value] of child._attributes()) if (!liveAttribute(name, value)) return false;
  const inner = quiet || QUIET_TAGS.has(child.localName);
  for (const grandchild of child.childNodes) if (!liveable(grandchild, inner)) return false;
  return true;
}

/** The live svg `node` is in, or null. */
function liveOwner(node) {
  const svg = svgOwner(node);
  return svg?._live ? svg : null;
}

function svgStyle(value) {
  if (typeof value !== "object" || value === null) return String(value);
  let css = "";
  for (const name of Object.keys(value)) {
    const part = value[name];
    if (part === null || part === undefined || part === "") continue;
    css += cssName(name) + ":" + (typeof part === "number" && !UNITLESS.has(name) ? part + "px" : part) + ";";
  }
  return css;
}

// Elements of any svg by id, for `<use href="#id">` in another svg: icon sprites define
// symbols in one hidden svg and every icon uses them.
const SVG_IDS = new Map();

function nameSvgElement(element, old, id) {
  if (old !== undefined && SVG_IDS.get(old)?.deref() === element) SVG_IDS.delete(old);
  if (id !== undefined) SVG_IDS.set(id, new WeakRef(element));
}

const REFERENCE = /href="#([^"]+)"/g;

// The tree draws each svg as a document of its own, so the elements its `href="#id"`s name
// in other svgs go into its markup, in a `<defs>`.
function withReferences(markup) {
  if (!markup.includes('href="#')) return markup;
  const own = new Set();
  for (const found of markup.matchAll(/\sid="([^"]+)"/g)) own.add(found[1]);
  let defs = "";
  let pending = markup;
  while (pending) {
    let next = "";
    for (const found of pending.matchAll(REFERENCE)) {
      const id = found[1];
      if (own.has(id)) continue;
      own.add(id);
      const element = SVG_IDS.get(id)?.deref();
      if (!element || element.getAttribute("id") !== id) continue;
      const added = element._markup();
      defs += added;
      next += added;
    }
    pending = next;
  }
  if (!defs) return markup;
  return markup.slice(0, markup.lastIndexOf("</svg>")) + "<defs>" + defs + "</defs></svg>";
}

// The children of an element of an `<svg>`: the markup they write, and how they move.
const svgChildren = {
  insertBefore(child, before = null) {
    if (before && before.parentNode !== this) throw new Error("the node to insert before is not a child of this node");
    if (before === child) return child;
    for (let at = this; at; at = at.parentNode) if (at === child) throw new Error("a node cannot be inserted into itself or its own subtree");
    const old = child.parentNode;
    const listening = shapeListeners(child);
    if (old) {
      liveOwner(old)?._removed(child);
      svgChanged(old);
      old.childNodes.splice(old.childNodes.indexOf(child), 1);
      if (listening) svgOwner(old)?._listenShapes();
    }
    child.parentNode = this;
    if (before) this.childNodes.splice(this.childNodes.indexOf(before), 0, child);
    else (this.childNodes === NO_CHILDREN ? (this.childNodes = []) : this.childNodes).push(child);
    if (child instanceof Text) child._svgText = true;
    liveOwner(this)?._inserted(child, this, before);
    svgChanged(this);
    if (listening) svgOwner(this)?._listenShapes();
    return child;
  },
  appendChild(child) {
    return this.insertBefore(child, null);
  },
  append(...children) {
    for (const child of children) this.insertBefore(typeof child === "string" ? new SvgText(child) : child, null);
  },
  removeChild(child) {
    if (child.parentNode !== this) throw new Error("the node to remove is not a child of this node");
    liveOwner(this)?._removed(child);
    svgChanged(this);
    this.childNodes.splice(this.childNodes.indexOf(child), 1);
    child.parentNode = null;
    if (shapeListeners(child)) svgOwner(this)?._listenShapes();
    return child;
  },
  get textContent() {
    let text = "";
    for (const child of this.childNodes) text += child.textContent ?? child.data ?? "";
    return text;
  },
  set textContent(value) {
    for (const child of this.childNodes.slice()) this.removeChild(child);
    if (value !== null && value !== undefined && value !== "") this.insertBefore(new SvgText(String(value)), null);
  },
  _markupOf(children) {
    let markup = "";
    for (const child of children) {
      if (child instanceof SvgElement) markup += child._markup();
      else markup += escaped(child.data ?? "", false);
    }
    return markup;
  },
};

// `element` and what is inside it as `__ui.svgMeasure` reads them (ui-tree `live_svg.measure`):
// records split by U+001E, each the parent's record number, the tag, then name/value pairs.
function svgPacked(element) {
  const records = [];
  const visit = (at, parent) => {
    const number = records.length + 1;
    let record = parent + "\x1f" + at.localName;
    for (const [name, value] of at._attributes()) record += "\x1f" + name + "\x1f" + value;
    records.push(record);
    for (const child of at.childNodes) if (child instanceof SvgElement) visit(child, number);
  };
  visit(element, 0);
  return records.join("\x1e");
}

function svgBox(element) {
  const [x, y, width, height] = native.svgMeasure(0, svgPacked(element), 0).split(" ").map(Number);
  const Rect = globalThis.DOMRect;
  return Rect ? new Rect(x, y, width, height) : { x, y, width, height };
}

// Whether `element` or an element inside it has listeners.
function shapeListeners(element) {
  if (!(element instanceof SvgElement)) return false;
  for (const list of element._listeners?.values() ?? []) if (list.length > 0) return true;
  return element.childNodes.some(shapeListeners);
}

function quietAncestor(element) {
  for (let at = element; at && at instanceof SvgElement; at = at.parentNode) if (QUIET_TAGS.has(at.localName)) return true;
  return false;
}

/** The declarations of `element`'s `style` attribute, read and written as properties. */
function svgDeclarations(element) {
  const read = () => {
    const map = new Map();
    for (const part of (element.getAttribute("style") ?? "").split(";")) {
      const colon = part.indexOf(":");
      if (colon > 0) map.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim());
    }
    return map;
  };
  const write = (map) => {
    let css = "";
    for (const [name, value] of map) css += name + ": " + value + ";";
    if (css) element.setAttribute("style", css);
    else element.removeAttribute("style");
  };
  const set = (name, value) => {
    const map = read();
    if (value === null || value === undefined || value === "") map.delete(name);
    else map.set(name, String(value));
    write(map);
  };
  const methods = {
    setProperty: (name, value) => set(String(name), value),
    removeProperty: (name) => {
      const old = read().get(String(name)) ?? "";
      set(String(name), null);
      return old;
    },
    getPropertyValue: (name) => read().get(String(name)) ?? "",
    getPropertyPriority: () => "",
    item: (index) => [...read().keys()][index] ?? "",
  };
  return new Proxy(methods, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return target[key];
      if (key === "cssText") return element.getAttribute("style") ?? "";
      if (key === "length") return read().size;
      if (/^(?:0|[1-9]\d*)$/.test(key)) return [...read().keys()][Number(key)];
      return read().get(cssName(key)) ?? "";
    },
    set(target, key, value) {
      if (key === "cssText") element.setAttribute("style", String(value));
      else if (typeof key === "string") set(cssName(key), value);
      return true;
    },
  });
}

/** Text in an `<svg>`: its `<text>` and `<title>` contents. */
export class SvgText {
  #data;

  constructor(data = "") {
    this.#data = String(data);
    this.parentNode = null;
    this.childNodes = NO_CHILDREN;
  }

  get data() {
    return this.#data;
  }

  set data(value) {
    value = String(value);
    if (value === this.#data) return;
    this.#data = value;
    const live = liveOwner(this);
    if (live && !QUIET_TAGS.has(this.parentNode?.localName)) live._leave();
    svgChanged(this);
  }

  get textContent() {
    return this.#data;
  }

  set textContent(value) {
    this.data = value;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }

  get previousSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }

  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  destroy() {
    this.remove();
  }

  cloneNode() {
    return new SvgText(this.#data);
  }
}

/**
 * An element inside an `<svg>`: `path`, `circle`, `g`, `linearGradient` and the rest. It is
 * no node of the tree: it is markup its `Svg` root draws. Its attributes take SVG's names or
 * React's spellings (`strokeWidth`, `xlinkHref`).
 */
export class SvgElement {
  #attributes = new Map();

  constructor(tag) {
    this.localName = String(tag);
    this.tagName = this.localName;
    this.namespaceURI = SVG_NAMESPACE;
    this.parentNode = null;
    this.childNodes = [];
  }

  getAttribute(name) {
    return this.#attributes.get(svgName(name)) ?? null;
  }

  hasAttribute(name) {
    return this.#attributes.has(svgName(name));
  }

  getAttributeNames() {
    return [...this.#attributes.keys()];
  }

  get dataset() {
    return (this._dataset ??= datasetOf(this));
  }

  setAttribute(name, value) {
    name = svgName(name);
    if (value === null || value === undefined || value === false) {
      this.removeAttribute(name);
      return;
    }
    const text = name === "style" ? svgStyle(value) : String(value);
    if (this.#attributes.get(name) === text) return;
    if (name === "id") nameSvgElement(this, this.#attributes.get(name), text);
    this.#attributes.set(name, text);
    this._written(name, text);
  }

  removeAttribute(name) {
    name = svgName(name);
    if (name === "id" && this.#attributes.has(name)) nameSvgElement(this, this.#attributes.get(name), undefined);
    if (this.#attributes.delete(name)) this._written(name, null);
  }

  setAttributeNS(namespace, name, value) {
    this.setAttribute(name, value);
  }

  getAttributeNS(namespace, name) {
    return this.getAttribute(name);
  }

  removeAttributeNS(namespace, name) {
    this.removeAttribute(name);
  }

  /** The element's `style` attribute as a declaration object: `style.display = "none"`. */
  get style() {
    return this._style ??= svgDeclarations(this);
  }

  _attributes() {
    return this.#attributes;
  }

  _written(name, text) {
    const live = liveOwner(this);
    if (!live) svgChanged(this);
    else if (text !== null && !liveAttribute(name, text)) live._leave();
    else native.svgAttribute(live.nodeId, this._n, name, text);
  }

  get firstChild() {
    return this.childNodes[0] ?? null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get nextSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) + 1] ?? null : null;
  }

  get previousSibling() {
    const siblings = this.parentNode?.childNodes;
    return siblings ? siblings[siblings.indexOf(this) - 1] ?? null : null;
  }

  contains(other) {
    for (let node = other; node; node = node.parentNode) if (node === this) return true;
    return false;
  }

  remove() {
    this.parentNode?.removeChild(this);
  }

  cloneNode(deep = false) {
    const copy = new SvgElement(this.localName);
    for (const [name, value] of this.#attributes) copy.setAttribute(name, value);
    if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
    return copy;
  }

  /** Takes the element out of its `<svg>`. It is plain markup, so nothing else is freed. */
  destroy() {
    this.remove();
  }

  /**
   * Hears pointer events on this element's shapes, as on the web: its `<svg>` turns live (see
   * `Svg`) and the tree tells which shape is under the pointer.
   */
  addEventListener(type, listener, options) {
    if (listener == null) return;
    const capture = options === true || !!options?.capture;
    this._listeners ??= new Map();
    let list = this._listeners.get(type);
    if (!list) this._listeners.set(type, (list = []));
    if (list.some((entry) => entry.listener === listener && entry.capture === capture)) return;
    list.push({ listener, capture, once: !!options?.once });
    svgOwner(this)?._listenShapes();
  }

  removeEventListener(type, listener, options) {
    const list = this._listeners?.get(type);
    if (!list) return;
    const capture = options === true || !!options?.capture;
    const index = list.findIndex((entry) => entry.listener === listener && entry.capture === capture);
    if (index < 0) return;
    list.splice(index, 1);
    svgOwner(this)?._listenShapes();
  }

  dispatchEvent(event) {
    if (typeof event?.type !== "string") throw new TypeError("dispatchEvent takes an Event");
    return dispatchEvent(adopt(event, this));
  }

  /** The box of its geometry in its own user space: a shape's fill, a group's children. */
  getBBox() {
    return svgBox(this);
  }

  /** The length of a shape's outline in user units. */
  getTotalLength() {
    return Number(native.svgMeasure(1, svgPacked(this), 0));
  }

  /** The point `distance` along a shape's outline, clamped to its ends. */
  getPointAtLength(distance) {
    const [x, y] = native.svgMeasure(2, svgPacked(this), Number(distance) || 0).split(" ").map(Number);
    return { x, y };
  }

  _run(event, capture) {
    const list = this._listeners?.get(event.type);
    if (!list) return;
    for (const entry of list.slice()) {
      if (event._immediate) return;
      if (entry.capture !== capture) continue;
      if (entry.once) this.removeEventListener(event.type, entry.listener, entry.capture);
      try {
        if (typeof entry.listener === "function") entry.listener.call(this, event);
        else entry.listener.handleEvent(event);
      } catch (error) {
        reportError(error);
      }
    }
  }

  _markup() {
    let markup = "<" + this.localName;
    for (const [name, value] of this.#attributes) markup += " " + name + '="' + escaped(value, true) + '"';
    if (this.childNodes.length === 0) return markup + "/>";
    return markup + ">" + svgChildren._markupOf(this.childNodes) + "</" + this.localName + ">";
  }
}

for (const name of ["insertBefore", "appendChild", "append", "removeChild"]) SvgElement.prototype[name] = svgChildren[name];
Object.defineProperty(SvgElement.prototype, "textContent", Object.getOwnPropertyDescriptor(svgChildren, "textContent"));

// Attributes of an `<svg>` root the tree has: they go to its node. Every other one is markup.
function treeAttribute(name) {
  return name === "class" || name === "className" || name === "id" || name === "role" || name === "tabIndex"
    || name === "tabindex" || name === "testId" || name === "label" || name === "cursor" || name === "transition"
    || name === "inert" || name === "disabled" || name === "element" || name === "lang" || name === "dir"
    || name.startsWith("data-") || ariaName(name) !== null;
}

/**
 * An inline `<svg>`, as the web has it: its children are `SvgElement`s and `SvgText`s, and
 * the tree draws the markup they make as an icon. Its look, class, events and accessibility
 * are the node's; `viewBox`, `fill`, `width` and the other SVG attributes are markup.
 * Changes are drawn once, before the host applies the batch.
 */
export class Svg extends Node {
  #attributes = new Map();
  #markup = "";
  // Live: element numbers in use, and freed ones to use again.
  _live = false;
  _count = 0;
  _free = [];

  constructor() {
    // The tree's node for drawn SVG markup is an icon; to code it is an `svg`.
    super("icon");
    this.kind = "svg";
    this.namespaceURI = SVG_NAMESPACE;
    // Page selectors such as `button svg` and preflight's `svg { display: block }` name it.
    native.attribute(this.nodeId, "element", "svg");
    svgChanged(this);
  }

  _shallowClone() {
    const copy = new Svg();
    for (const [name, value] of this.#attributes) copy.setAttribute(name, value);
    return copy;
  }

  getAttribute(name) {
    return treeAttribute(String(name)) ? super.getAttribute(name) : this.#attributes.get(svgName(name)) ?? null;
  }

  setAttribute(name, value) {
    name = String(name);
    if (treeAttribute(name)) {
      super.setAttribute(name === "tabindex" ? "tabIndex" : name, value);
      return;
    }
    name = svgName(name);
    if (name === "xmlns") return;
    if (value === null || value === undefined || value === false || value === "") {
      this.removeAttribute(name);
      return;
    }
    const text = name === "style" ? svgStyle(value) : String(value);
    if (this.#attributes.get(name) === text) return;
    this.#attributes.set(name, text);
    this._written(name, text);
  }

  removeAttribute(name) {
    name = String(name);
    if (treeAttribute(name)) super.removeAttribute(name);
    else if (this.#attributes.delete(svgName(name))) this._written(svgName(name), null);
  }

  setAttributeNS(namespace, name, value) {
    this.setAttribute(name, value);
  }

  getAttributeNS(namespace, name) {
    return this.getAttribute(name);
  }

  /** The box of what it draws, in its user space (inside `viewBox`). */
  getBBox() {
    return svgBox(this);
  }

  _attributes() {
    return this.#attributes;
  }

  _written(name, text) {
    if (!this._live) svgChanged(this);
    else if (text !== null && !liveAttribute(name, text)) this._leave();
    else native.svgAttribute(this.nodeId, 0, name, text);
  }

  /** Sends the elements to the tree as a live svg, once its markup was drawn and changed. */
  _goLive() {
    this._forget();
    this._live = true;
    for (const [name, value] of this.#attributes) native.svgAttribute(this.nodeId, 0, name, value);
    for (const child of this.childNodes) this._inserted(child, this, null);
  }

  /** Back to markup: content the live svg does not draw came in. */
  _leave() {
    if (!this._live) return;
    this._live = false;
    this._count = 0;
    this._free = [];
    native.svgRemove(this.nodeId, 0);
    svgChanged(this);
  }

  _inserted(child, parent, before) {
    if (!(child instanceof SvgElement)) {
      if (!QUIET_TAGS.has(parent.localName) && !(parent !== this && svgOwner(parent) && quietAncestor(parent))) this._leave();
      return;
    }
    if (!liveable(child, quietAncestor(parent))) {
      this._leave();
      return;
    }
    this._send(child, parent === this ? 0 : parent._n, before instanceof SvgElement ? before._n : -1);
  }

  _send(element, parent, before) {
    element._n = this._free.pop() ?? ++this._count;
    native.svgInsert(this.nodeId, element._n, element.localName, parent, before);
    for (const [name, value] of element._attributes()) native.svgAttribute(this.nodeId, element._n, name, value);
    for (const child of element.childNodes) if (child instanceof SvgElement) this._send(child, element._n, -1);
  }

  _removed(child) {
    if (!(child instanceof SvgElement) || !child._n) return;
    native.svgRemove(this.nodeId, child._n);
    const free = (element) => {
      if (element._n) this._free.push(element._n);
      element._n = 0;
      for (const grandchild of element.childNodes) if (grandchild instanceof SvgElement) free(grandchild);
    };
    free(child);
  }

  /** The markup the tree draws, as `outerHTML` gives it. */
  get outerHTML() {
    let markup = '<svg xmlns="' + SVG_NAMESPACE + '"';
    const children = svgChildren._markupOf(this.childNodes);
    let xlink = this.#attributes.has("xmlns:xlink");
    for (const [name, value] of this.#attributes) {
      markup += " " + name + '="' + escaped(value, true) + '"';
    }
    if (!xlink && children.includes("xlink:")) markup += ' xmlns:xlink="http://www.w3.org/1999/xlink"';
    return markup + ">" + children + "</svg>";
  }

  _draw() {
    if (nodes[this.nodeId] === undefined || this._live) return;
    const canGoLive = this.childNodes.length > 0 && this.childNodes.every((child) => liveable(child));
    if (canGoLive && (this._extra || !this.#attributes.has("viewBox") || this.childNodes.some(hasStyledDescendant))) {
      this._goLive();
      return;
    }
    const markup = withReferences(this.outerHTML);
    if (markup === this.#markup) return;
    if (this.#markup && this.childNodes.every((child) => liveable(child))) {
      this._goLive();
      return;
    }
    this._forget();
    this.#markup = markup;
    native.source(this.nodeId, holdIcon(markup));
  }

  _forget() {
    if (this.#markup) dropIcon(this.#markup);
    this.#markup = "";
  }

  /**
   * Listens for what the listeners on its elements need. Elements are told apart only once
   * the svg is live, so listeners make it go live.
   */
  _listenShapes() {
    let types = new Set();
    const visit = (element) => {
      for (const [type, list] of element._listeners ?? []) if (list.length > 0) types.add(type);
      for (const child of element.childNodes) if (child instanceof SvgElement) visit(child);
    };
    for (const child of this.childNodes) if (child instanceof SvgElement) visit(child);
    let extra = 0;
    for (const type of types) {
      const kind = KIND_OF.get(type);
      if (kind === undefined) continue;
      extra = (extra | (1 << bitOf(kind))) >>> 0;
      if (HOVER_TYPES.has(type)) extra |= HOVER_FLAGS;
    }
    if (extra === (this._extra ?? 0)) return;
    this._extra = extra;
    this._relisten();
    if (extra && !this._live) svgChanged(this);
  }

  /** The element numbered `n`, or null. */
  _numbered(n) {
    if (!n) return null;
    const find = (element) => {
      if (element._n === n) return element;
      for (const child of element.childNodes) {
        if (child instanceof SvgElement) {
          const found = find(child);
          if (found) return found;
        }
      }
      return null;
    };
    for (const child of this.childNodes) {
      if (child instanceof SvgElement) {
        const found = find(child);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Sends a pointer record that came to the svg to the element under the pointer, with the
   * over, out, enter and leave events the web sends as the pointer moves between elements.
   */
  _pointer(event) {
    const type = event.type;
    const leaving = type === "pointerout" || type === "pointerleave" || type === "pointercancel";
    const shape = leaving ? null : this._numbered(event._element);
    const old = this._hovered && this._hovered.parentNode && svgOwner(this._hovered) === this ? this._hovered : null;
    let replaced = false;
    if (shape !== old && type !== "pointerenter" && type !== "pointerleave") {
      this._hovered = shape;
      if (old) {
        dispatchEvent(pointerCopy("pointerout", old, event));
        for (let at = old; at instanceof SvgElement && !at.contains(shape); at = at.parentNode) {
          dispatchEvent(pointerCopy("pointerleave", at, event));
        }
        if (type === "pointerout") replaced = true;
      }
      if (shape) {
        dispatchEvent(pointerCopy("pointerover", shape, event));
        if (type === "pointerover") {
          replaced = true;
          this._entering = true;
        } else {
          enterChain(shape, old, event);
        }
      }
    }
    if (replaced) return false;
    if (type === "pointerenter") {
      dispatchEvent(event);
      if (this._entering && this._hovered) enterChain(this._hovered, null, event);
      this._entering = false;
      return event.defaultPrevented;
    }
    if (shape && type !== "pointerleave") event.target = shape;
    dispatchEvent(event);
    return event.defaultPrevented;
  }
}

// Element listeners for these need the svg's moves, enters and leaves to tell hovering apart.
const HOVER_TYPES = new Set(["pointerover", "pointerout", "pointerenter", "pointerleave"]);
const HOVER_FLAGS = (1 << 3) | (1 << 4) | (1 << 5) | (1 << 28) | (1 << 29);

// A pointer event like `base` of type `type` at `target`.
function pointerCopy(type, target, base) {
  const event = new Event(type, target);
  for (const key of Object.keys(base)) {
    if (!(key in event) || key === "clientX" || key === "clientY" || key === "x" || key === "y") event[key] = base[key];
  }
  event.type = type;
  event.target = target;
  event.bubbles = !NO_BUBBLE.has(type);
  event.cancelable = CANCELABLE.has(type);
  return event;
}

// pointerenter at `shape` and its element ancestors not containing `from`, outermost first.
function enterChain(shape, from, base) {
  const chain = [];
  for (let at = shape; at instanceof SvgElement && !(from && at.contains(from)); at = at.parentNode) chain.push(at);
  for (let i = chain.length - 1; i >= 0; i--) dispatchEvent(pointerCopy("pointerenter", chain[i], base));
}

for (const name of ["insertBefore", "appendChild", "append", "removeChild"]) Svg.prototype[name] = svgChildren[name];
Object.defineProperty(Svg.prototype, "textContent", Object.getOwnPropertyDescriptor(svgChildren, "textContent"));

/**
 * An element of tag `tag` in the SVG namespace: an `Svg` root for `svg`, an `SvgElement`
 * inside one for anything else. `document.createElementNS` with the SVG namespace, as it were.
 */
export function createSvgElement(tag) {
  return tag === "svg" ? new Svg() : new SvgElement(tag);
}

/** Draws the `<svg>` roots that changed now, instead of before the host applies the batch. */
export function flushSvg() {
  drawSvgs();
}

// Offsets cross the bridge as UTF-8 bytes; a rich input speaks JavaScript string indices.
const ASCII = /^[\x00-\x7f]*$/;

function byteOf(text, index) {
  if (ASCII.test(text)) return Math.min(index, text.length);
  let bytes = 0;
  for (let i = 0; i < index && i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

function indexOf(text, byte) {
  if (ASCII.test(text)) return Math.min(byte, text.length);
  let bytes = 0;
  let i = 0;
  while (i < text.length && bytes < byte) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code < 0xdc00 && i + 1 < text.length) {
      bytes += 4;
      i++;
    } else bytes += 3;
    i++;
  }
  return i;
}

function cssTextOf(properties) {
  let css = "";
  for (const name of Object.keys(properties ?? {})) {
    const value = properties[name];
    if (value === null || value === undefined || value === "") continue;
    css += cssName(name) + ":" + cssValue(name, value) + ";";
  }
  return css;
}

/** Where an atom sits in a rich input's text: U+FFFC OBJECT REPLACEMENT CHARACTER. */
export const OBJECT = "\ufffc";

/**
 * A rich text field: styled runs (marks) and inline atoms (mentions, chips) over the text the
 * user edits, with the caret, selection, undo and input method composition of `Input`.
 *
 * Its `document` is `{ text, marks, atoms }`. Each atom sits in `text` as one `OBJECT`
 * character, so the caret steps over it as one unit; `atoms` lists them in text order as
 * `{ kind, label, data }`. `marks` lists `{ start, end, marks }` spans with mark names.
 * Offsets here, in `selectionStart` and in `insertAtom`, are string indices.
 */
export class RichInput extends Input {
  #markBits = new Map();
  #markNames = [];
  #kinds = new Map();
  #kindNames = [];
  #document = { text: "", marks: [], atoms: [] };

  constructor() {
    super();
    /** The marks text typed at the caret gets, as of the last change. */
    this.activeMarks = [];
  }

  #bit(name) {
    let bit = this.#markBits.get(name);
    if (bit === undefined) {
      bit = this.#markNames.length;
      if (bit >= 32) throw new RangeError("a rich input has at most 32 marks");
      this.#markBits.set(name, bit);
      this.#markNames.push(name);
    }
    return bit;
  }

  #kind(name) {
    let kind = this.#kinds.get(name);
    if (kind === undefined) {
      kind = this.#kindNames.length;
      this.#kinds.set(name, kind);
      this.#kindNames.push(name);
    }
    return kind;
  }

  #names(bits) {
    const names = [];
    for (let bit = 0; bit < this.#markNames.length; bit++) if (bits & (1 << bit)) names.push(this.#markNames[bit]);
    return names;
  }

  /** What text with mark `name` looks like: properties as `style.set` takes them. */
  defineMark(name, style) {
    native.mark(this.nodeId, this.#bit(name), cssTextOf(style));
  }

  /** What atoms of `kind` look like: the inline block holding the label. */
  defineAtom(kind, style) {
    native.atomStyle(this.nodeId, this.#kind(kind), cssTextOf(style));
  }

  get document() {
    return this.#document;
  }

  _shallowClone() {
    const copy = new RichInput();
    copy.document = this.#document;
    return copy;
  }

  /** Replaces the document. The caret goes to the end and the undo history is forgotten. */
  set document(document) {
    const text = String(document?.text ?? "");
    const marks = (document?.marks ?? []).map((span) => ({ start: span.start, end: span.end, marks: [...span.marks] }));
    const atoms = (document?.atoms ?? []).map((atom) => ({ kind: atom.kind, label: String(atom.label ?? ""), data: atom.data ?? "" }));
    this.#document = { text, marks, atoms };
    let packedMarks = "";
    for (const span of marks) {
      let bits = 0;
      for (const name of span.marks) bits |= 1 << this.#bit(name);
      packedMarks += byteOf(text, span.start) + "," + byteOf(text, span.end) + "," + (bits >>> 0) + ";";
    }
    let packedAtoms = "";
    for (const atom of atoms) packedAtoms += this.#packAtom(atom);
    native.richText(this.nodeId, text, packedMarks, packedAtoms);
    const end = byteOf(text, text.length);
    super._changed(text, end, end);
  }

  #packAtom(atom) {
    return this.#kind(atom.kind) + "\0" + String(atom.label ?? "") + "\0" + String(atom.data ?? "") + "\0";
  }

  /** Turns mark `name` on or off over the selection, or for the text typed next. */
  format(name, on = true) {
    native.format(this.nodeId, this.#bit(name), !!on);
  }

  /** Turns mark `name` off where the caret's text has it, on where it does not. */
  toggleMark(name) {
    this.format(name, !this.activeMarks.includes(name));
  }

  /** Replaces the text from `start` to `end` with `atom` (`{ kind, label, data }`). */
  insertAtom(start, end, atom) {
    const text = this.#document.text;
    native.insertAtom(this.nodeId, byteOf(text, start), byteOf(text, end), this.#packAtom(atom));
  }

  // Marks around the range stay, shifted; the replacement takes none. Atoms in the range go,
  // and OBJECT characters in the replacement become U+FFFD, since they would name no atom.
  _replace(start, end, replacement) {
    const { text, marks, atoms } = this.#document;
    replacement = replacement.replaceAll(OBJECT, "\ufffd");
    const delta = replacement.length - (end - start);
    const shift = (index, inside) => (index <= start ? index : index >= end ? index + delta : inside);
    const spans = [];
    for (const span of marks) {
      const from = shift(span.start, start + replacement.length);
      const to = shift(span.end, start);
      if (to > from) spans.push({ start: from, end: to, marks: span.marks });
    }
    let before = 0;
    let inside = 0;
    for (let i = 0; i < end; i++) {
      if (text[i] !== OBJECT) continue;
      if (i < start) before++;
      else inside++;
    }
    const kept = atoms.slice(0, before).concat(atoms.slice(before + inside));
    this.document = { text: text.slice(0, start) + replacement + text.slice(end), marks: spans, atoms: kept };
  }

  _changed(value, anchor, focus, marks, atoms, active) {
    super._changed(value, anchor, focus);
    if (marks === undefined) return;
    const spans = [];
    for (const part of String(marks).split(";")) {
      if (!part) continue;
      const [start, end, bits] = part.split(",").map(Number);
      spans.push({ start: indexOf(value, start), end: indexOf(value, end), marks: this.#names(bits) });
    }
    const list = [];
    const fields = String(atoms ?? "").split("\0");
    for (let i = 0; i + 2 < fields.length; i += 3) {
      list.push({ kind: this.#kindNames[Number(fields[i])] ?? Number(fields[i]), label: fields[i + 1], data: fields[i + 2] });
    }
    this.#document = { text: value, marks: spans, atoms: list };
    this.activeMarks = this.#names(active ?? 0);
  }

  _selected(start, end, active) {
    super._selected(start, end);
    this.activeMarks = this.#names(active ?? 0);
  }
}

/** A rich text field with `style` as its base look. */
export function createRichInput(style) {
  const input = new RichInput();
  if (style) input.style.set(style);
  return input;
}

function forget(node) {
  nodes[node.nodeId] = undefined;
  node._forget?.();
  for (const child of node.childNodes) {
    child.parentNode = null;
    forget(child);
  }
  node.childNodes = NO_CHILDREN;
}

export function createNode(kind) {
  if (kind === "richinput") return new RichInput();
  if (kind === "svg") return new Svg();
  if (kind === "img") kind = "image";
  if (!(kind in KINDS) || kind === "icon") throw new TypeError("the tree has no node kind '" + kind + "'");
  if (kind === "text") return new Text();
  if (kind === "input") return new Input();
  if (kind === "image") return new Image();
  if (kind === "canvas") return new Canvas();
  return new Node(kind);
}

// WHATWG HTML §4.10.5 input types; any unknown keyword falls back to "text".
const CANONICAL_INPUT_TYPES = new Set([
  "hidden", "text", "search", "tel", "url", "email", "password",
  "date", "month", "week", "time", "datetime-local", "number", "range",
  "color", "checkbox", "radio", "file", "submit", "image", "reset", "button",
]);
function canonicalInputType(raw) {
  const lower = String(raw ?? "text").toLowerCase();
  return CANONICAL_INPUT_TYPES.has(lower) ? lower : "text";
}

// `<input>` types that are not a text field.
const BOX_INPUTS = new Set(["checkbox", "radio", "range", "color", "file", "hidden", "submit", "button", "reset", "image"]);
// Tags that take focus without a tabindex, as on the web.
const FOCUSABLE_TAGS = new Set(["button", "select", "summary", "iframe"]);
// Input types supporting `valueAsNumber` and `stepUp`/`stepDown`.
const NUMERIC_OR_TEMPORAL_TYPES = new Set(["number", "range", "date", "time", "datetime-local", "month", "week"]);
// Input types supporting `valueAsDate` (WHATWG §4.10.5.4 excludes datetime-local).
const DATE_VALUE_TYPES = new Set(["date", "time", "month", "week"]);
// Attributes whose change can affect constraint validation or `:valid`/`:invalid`.
const VALIDATION_ATTRS = new Set(["required", "disabled", "readonly", "minlength", "maxlength", "min", "max", "step", "pattern", "type", "multiple", "form"]);
// Submittable / listed / resettable / labelable element tag sets (WHATWG §4.10.2).
const LISTED_TAGS = new Set(["button", "fieldset", "input", "object", "output", "select", "textarea"]);
const SUBMITTABLE_TAGS = new Set(["button", "input", "object", "select", "textarea"]);
const LABELABLE_TAGS = new Set(["button", "input", "meter", "output", "progress", "select", "textarea"]);
// Single-line text input types that strip CR/LF per WHATWG §4.10.5.1.
const SINGLE_LINE_TYPES = new Set(["text", "search", "tel", "url", "email", "password"]);
// RFC 5322 / WHATWG §4.10.5.1.5 email regex.
const EMAIL_RE = /^[a-zA-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function sanitizeInputValue(type, value) {
  let s = String(value);
  if (SINGLE_LINE_TYPES.has(type)) {
    s = s.replace(/[\r\n]/g, "");
    if (type === "email") {
      if (s.includes(",")) s = s.split(",").map((part) => part.trim()).join(",");
      else s = s.trim();
    } else if (type === "url") {
      s = s.trim();
    }
    return s;
  }
  if (type === "number") {
    const trimmed = s.trim();
    if (trimmed === "") return "";
    return Number.isFinite(Number(trimmed)) ? trimmed : "";
  }
  if (type === "color") return normalizeHexColor(s);
  return s;
}

function normalizeHexColor(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(s) ? s : "#000000";
}

function isoWeek1MondayUtc(year) {
  const jan4 = Date.UTC(year, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // Mon=0..Sun=6
  return jan4 - dow * 86400000;
}

function parseInputValueAsNumber(type, raw) {
  const s = String(raw ?? "").trim();
  if (!s) return NaN;
  if (type === "number" || type === "range") {
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  if (type === "date") {
    const m = /^(\d{4,})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return NaN;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return NaN;
    const ms = Date.UTC(y, mo - 1, d);
    const dt = new Date(ms);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return ms;
  }
  if (type === "time") {
    const m = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(s);
    if (!m) return NaN;
    const h = Number(m[1]), mi = Number(m[2]), sec = m[3] ? Number(m[3]) : 0;
    const frac = m[4] ? Number(m[4].padEnd(3, "0")) : 0;
    if (h > 23 || mi > 59 || sec > 59) return NaN;
    return ((h * 60 + mi) * 60 + sec) * 1000 + frac;
  }
  if (type === "datetime-local") {
    const m = /^(\d{4,})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(s);
    if (!m) return NaN;
    const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    const h = Number(m[4]), mi = Number(m[5]), sec = m[6] ? Number(m[6]) : 0;
    const frac = m[7] ? Number(m[7].padEnd(3, "0")) : 0;
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return NaN;
    const ms = Date.UTC(y, mo - 1, d, h, mi, sec, frac);
    const dt = new Date(ms);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return NaN;
    return ms;
  }
  if (type === "month") {
    const m = /^(\d{4,})-(\d{2})$/.exec(s);
    if (!m) return NaN;
    const y = Number(m[1]), mo = Number(m[2]);
    if (y < 1 || mo < 1 || mo > 12) return NaN;
    return (y - 1970) * 12 + (mo - 1);
  }
  if (type === "week") {
    const m = /^(\d{4,})-W(\d{2})$/.exec(s);
    if (!m) return NaN;
    const y = Number(m[1]), w = Number(m[2]);
    if (y < 1 || w < 1 || w > 53) return NaN;
    const mon = isoWeek1MondayUtc(y) + (w - 1) * 7 * 86400000;
    if (w === 53 && mon >= isoWeek1MondayUtc(y + 1)) return NaN;
    return mon;
  }
  return NaN;
}

function pad2(n) { return String(n).padStart(2, "0"); }
function pad4(n) { return String(n).padStart(4, "0"); }

function formatNumberForInputType(type, n) {
  if (!Number.isFinite(n)) return "";
  if (type === "number" || type === "range") return String(Number(n.toPrecision(12)));
  if (type === "date") {
    const dt = new Date(n);
    return `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
  }
  if (type === "time") {
    const total = ((Math.trunc(n) % 86400000) + 86400000) % 86400000;
    const ms = total % 1000;
    const s = Math.floor(total / 1000) % 60;
    const mi = Math.floor(total / 60000) % 60;
    const h = Math.floor(total / 3600000);
    if (ms) return `${pad2(h)}:${pad2(mi)}:${pad2(s)}.${String(ms).padStart(3, "0").replace(/0+$/, "")}`;
    if (s) return `${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
    return `${pad2(h)}:${pad2(mi)}`;
  }
  if (type === "datetime-local") {
    const dt = new Date(n);
    const datePart = `${pad4(dt.getUTCFullYear())}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    const timePart = formatNumberForInputType("time", ((dt.getUTCHours() * 60 + dt.getUTCMinutes()) * 60 + dt.getUTCSeconds()) * 1000 + dt.getUTCMilliseconds());
    return `${datePart}T${timePart}`;
  }
  if (type === "month") {
    const total = Math.trunc(n);
    const y = 1970 + Math.floor(total / 12);
    const mo = ((total % 12) + 12) % 12 + 1;
    return `${pad4(y)}-${pad2(mo)}`;
  }
  if (type === "week") {
    const dt = new Date(n);
    const thu = new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
    thu.setUTCDate(thu.getUTCDate() + 3 - ((thu.getUTCDay() + 6) % 7));
    const weekYear = thu.getUTCFullYear();
    const w = 1 + Math.round((thu.getTime() - isoWeek1MondayUtc(weekYear)) / (7 * 86400000));
    return `${pad4(weekYear)}-W${pad2(w)}`;
  }
  return String(n);
}

// Step scale & default step per WHATWG §4.10.5.3.9.
function stepScaleOf(type) {
  if (type === "date") return 86400000;
  if (type === "week") return 604800000;
  if (type === "time" || type === "datetime-local") return 1000;
  return 1;
}
function defaultStepOf(type) {
  if (type === "time" || type === "datetime-local") return 60;
  return 1;
}
function allowedValueStep(control) {
  const type = control.type;
  const raw = control.getAttribute("step");
  const scale = stepScaleOf(type);
  if (raw === null || raw.trim() === "") return defaultStepOf(type) * scale;
  if (raw.trim().toLowerCase() === "any") return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultStepOf(type) * scale;
  return parsed * scale;
}
function stepBaseOf(control) {
  const type = control.type;
  const minVal = parseInputValueAsNumber(type, control.getAttribute("min"));
  if (Number.isFinite(minVal)) return minVal;
  const defVal = parseInputValueAsNumber(type, control.getAttribute("value"));
  if (Number.isFinite(defVal)) return defVal;
  if (type === "week") return -259200000; // 1970-W01 Monday
  return 0;
}

function stepInputValue(control, delta) {
  const type = control.type;
  if (!NUMERIC_OR_TEMPORAL_TYPES.has(type)) {
    throw domError("InvalidStateError", "This input element does not support stepUp/stepDown.");
  }
  const step = allowedValueStep(control);
  if (step === null) throw domError("InvalidStateError", "This input element has step=\"any\".");
  const min = parseInputValueAsNumber(type, control.getAttribute("min"));
  const max = parseInputValueAsNumber(type, control.getAttribute("max"));
  const base = stepBaseOf(control);
  let current = control.valueAsNumber;
  if (!Number.isFinite(current)) current = Number.isFinite(min) ? min : 0;
  let next;
  const rem = ((current - base) % step + step) % step;
  if (rem > 1e-9 && step - rem > 1e-9 && delta !== 0) {
    const snapped = delta > 0 ? current - rem + step : current - rem;
    next = snapped + (delta > 0 ? delta - 1 : delta + 1) * step;
  } else {
    next = current + delta * step;
  }
  if (Number.isFinite(min) && next < min) {
    next = min + Math.ceil((min - base) / step) * step - (min - base);
    if (next < min) next = min;
  }
  if (Number.isFinite(max) && next > max) {
    next = base + Math.floor((max - base) / step) * step;
    if (next > max) next = max;
  }
  control.value = formatNumberForInputType(type, next);
}

// WHATWG §4.10.18.5: disabled directly or inside a disabled `<fieldset>` (exempting its first `<legend>` child).
export function isControlDisabled(node) {
  if (!node || node.nodeType !== 1) return false;
  if (node.hasAttribute("disabled")) return true;
  if (node instanceof OptionElement) {
    if (node.parentNode instanceof OptGroupElement && node.parentNode.hasAttribute("disabled")) return true;
  }
  let child = node;
  for (let parent = node.parentNode; parent; child = parent, parent = parent.parentNode) {
    if (parent.localName === "fieldset" && parent.hasAttribute("disabled")) {
      let firstLegend = null;
      for (const c of parent.childNodes) {
        if (c.localName === "legend") { firstLegend = c; break; }
      }
      if (!firstLegend || child !== firstLegend) return true;
    }
  }
  return false;
}

function isInDataList(node) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (p.localName === "datalist") return true;
  }
  return false;
}

// WHATWG §4.10.18.3: form owner via `form` attribute (if connected) or nearest `<form>` ancestor.
function formOwnerOf(node) {
  if (!node || node.nodeType !== 1) return null;
  const tag = node.localName;
  if (!LISTED_TAGS.has(tag) && tag !== "img") return null;
  const formId = node.getAttribute("form");
  if (formId !== null) {
    if (!inDocument(node) || formId === "") return null;
    const target = findById(formId);
    return target instanceof FormElement ? target : null;
  }
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (p instanceof FormElement) return p;
  }
  return null;
}

function isLabelable(node) {
  if (!node || node.nodeType !== 1) return false;
  if (!LABELABLE_TAGS.has(node.localName)) return false;
  if (node.localName === "input" && node.type === "hidden") return false;
  return true;
}

function labelsOf(control) {
  if (!isLabelable(control)) return [];
  const out = [];
  const top = rootOf(control);
  eachDescendant(top, (node) => {
    if (node instanceof LabelElement && node.control === control) out.push(node);
  });
  return out;
}

function createFileList(files) {
  const list = Array.from(files);
  list.item = (index) => list[index] ?? null;
  return list;
}

/**
 * Constraint validation state (WHATWG HTML §4.10.20.3).
 */
export class ValidityState {
  constructor(flags = {}) {
    this.valueMissing = !!flags.valueMissing;
    this.typeMismatch = !!flags.typeMismatch;
    this.patternMismatch = !!flags.patternMismatch;
    this.tooLong = !!flags.tooLong;
    this.tooShort = !!flags.tooShort;
    this.rangeUnderflow = !!flags.rangeUnderflow;
    this.rangeOverflow = !!flags.rangeOverflow;
    this.stepMismatch = !!flags.stepMismatch;
    this.badInput = !!flags.badInput;
    this.customError = !!flags.customError;
    this.valid = !(
      this.valueMissing || this.typeMismatch || this.patternMismatch || this.tooLong
      || this.tooShort || this.rangeUnderflow || this.rangeOverflow || this.stepMismatch
      || this.badInput || this.customError
    );
  }
}

function isCandidateForConstraintValidation(node) {
  if (!node || node.nodeType !== 1) return false;
  if (isControlDisabled(node) || isInDataList(node)) return false;
  if (node instanceof FieldSetElement || node instanceof OutputElement) return false;
  if (node instanceof ButtonElement) return false;
  if (node instanceof ButtonInput || node instanceof HiddenInput) return false;
  if (node instanceof Input) {
    if (node.hasAttribute("readonly")) return false;
    const t = node.type;
    if (t === "hidden" || t === "reset" || t === "button") return false;
    return true;
  }
  if (node instanceof CheckInput || node instanceof RangeInput || node instanceof ColorInput || node instanceof FileInput || node instanceof SelectElement) {
    return true;
  }
  return false;
}

function isValidEmailValue(value, multiple) {
  if (!value) return true;
  const parts = multiple ? value.split(",").map((p) => p.trim()) : [value];
  return parts.every((part) => EMAIL_RE.test(part));
}

function isValidUrlValue(value) {
  if (!value) return true;
  try {
    new URL(value);
    return true;
  } catch {
    return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/\S+$/.test(value);
  }
}

function radioGroupPeers(radio) {
  const name = radio.name;
  if (!name) return [radio];
  const form = formOwnerOf(radio);
  const scope = form ?? rootOf(radio);
  const peers = [];
  const visit = (node) => {
    if (node instanceof CheckInput && node.type === "radio" && node.name === name && formOwnerOf(node) === form) {
      peers.push(node);
    }
  };
  if (form) {
    for (const el of collectFormControls(form)) visit(el);
  } else {
    eachDescendant(scope, visit);
  }
  return peers.length ? peers : [radio];
}

function computeValidity(control) {
  const customError = Boolean(control._customValidity);
  if (!isCandidateForConstraintValidation(control)) {
    return new ValidityState({ customError });
  }
  let valueMissing = false;
  let typeMismatch = false;
  let patternMismatch = false;
  let tooLong = false;
  let tooShort = false;
  let rangeUnderflow = false;
  let rangeOverflow = false;
  let stepMismatch = false;
  const badInput = false;

  if (control instanceof CheckInput) {
    if (control.type === "checkbox") {
      valueMissing = control.required && !control.checked;
    } else if (control.type === "radio") {
      const peers = radioGroupPeers(control);
      const anyRequired = peers.some((p) => p.required && !isControlDisabled(p));
      const anyChecked = peers.some((p) => p.checked);
      valueMissing = anyRequired && !anyChecked;
    }
  } else if (control instanceof FileInput) {
    valueMissing = control.required && control.files.length === 0;
  } else if (control instanceof SelectElement) {
    if (control.required) {
      const selected = control.selectedOptions;
      if (selected.length === 0) {
        valueMissing = true;
      } else if (!control.multiple && control.size <= 1) {
        // Placeholder label option check (WHATWG §4.10.7).
        const firstOpt = control.childNodes.find((c) => c instanceof OptionElement) ?? null;
        if (firstOpt && firstOpt.value === "" && selected.length === 1 && selected[0] === firstOpt) {
          valueMissing = true;
        }
      }
    }
  } else if (control instanceof Input) {
    const val = control.value;
    const t = control.type;
    if (control.required && val === "") valueMissing = true;
    if (val !== "") {
      if (t === "email" && !isValidEmailValue(val, control.multiple)) typeMismatch = true;
      else if (t === "url" && !isValidUrlValue(val)) typeMismatch = true;

      if (control._tag !== "textarea" && (t === "text" || t === "search" || t === "tel" || t === "url" || t === "email" || t === "password")) {
        const pattern = control.getAttribute("pattern");
        if (pattern !== null && pattern !== "") {
          try {
            const re = new RegExp(`^(?:${pattern})$`, "v");
            if (!re.test(val)) patternMismatch = true;
          } catch {
            try {
              const re = new RegExp(`^(?:${pattern})$`, "u");
              if (!re.test(val)) patternMismatch = true;
            } catch {}
          }
        }
      }

      if (control._userInteracted) {
        const minLen = control.minLength;
        const maxLen = control.maxLength;
        if (minLen >= 0 && val.length < minLen) tooShort = true;
        if (maxLen >= 0 && val.length > maxLen) tooLong = true;
      }

      if (NUMERIC_OR_TEMPORAL_TYPES.has(t)) {
        const num = parseInputValueAsNumber(t, val);
        if (Number.isFinite(num)) {
          const min = parseInputValueAsNumber(t, control.getAttribute("min"));
          const max = parseInputValueAsNumber(t, control.getAttribute("max"));
          if (Number.isFinite(min) && num < min) rangeUnderflow = true;
          if (Number.isFinite(max) && num > max) rangeOverflow = true;
          const step = allowedValueStep(control);
          if (step !== null && step > 0) {
            const base = stepBaseOf(control);
            const rem = Math.abs((num - base) % step);
            const eps = Math.max(1e-9, Math.abs(step) * 1e-9);
            if (rem > eps && Math.abs(step - rem) > eps) stepMismatch = true;
          }
        }
      }
    }
  }
  return new ValidityState({
    valueMissing, typeMismatch, patternMismatch, tooLong, tooShort,
    rangeUnderflow, rangeOverflow, stepMismatch, badInput, customError,
  });
}

function validationMessageFor(control) {
  const v = computeValidity(control);
  if (v.valid) return "";
  if (v.customError) return control._customValidity;
  if (v.valueMissing) return "Please fill out this field.";
  if (v.typeMismatch) return control.type === "email" ? "Please enter an email address." : "Please enter a URL.";
  if (v.patternMismatch) return "Please match the requested format.";
  if (v.tooShort) return `Please lengthen this text to ${control.minLength} characters or more.`;
  if (v.tooLong) return `Please shorten this text to ${control.maxLength} characters or fewer.`;
  if (v.rangeUnderflow) return `Value must be greater than or equal to ${control.getAttribute("min")}.`;
  if (v.rangeOverflow) return `Value must be less than or equal to ${control.getAttribute("max")}.`;
  if (v.stepMismatch) return "Please enter a valid value.";
  if (v.badInput) return "Please enter a valid value.";
  return "";
}

function syncValidationState(control) {
  if (!control || control.nodeId === undefined) return;
  if (!isCandidateForConstraintValidation(control)) {
    native.attribute(control.nodeId, "-silk-valid", null);
    native.attribute(control.nodeId, "-silk-user-valid", null);
    return;
  }
  const v = computeValidity(control);
  native.attribute(control.nodeId, "-silk-valid", v.valid ? "1" : "0");
  native.attribute(control.nodeId, "-silk-user-valid", control._userInteracted ? (v.valid ? "1" : "0") : null);
  const form = formOwnerOf(control);
  if (form) form._syncValidity();
}

function runCheckValidity(control) {
  if (!isCandidateForConstraintValidation(control)) return true;
  const v = computeValidity(control);
  if (v.valid) return true;
  const ev = new Event("invalid", control);
  ev.bubbles = false;
  ev.cancelable = true;
  dispatchEvent(ev);
  return false;
}

function runReportValidity(control) {
  if (!isCandidateForConstraintValidation(control)) return true;
  const v = computeValidity(control);
  if (v.valid) return true;
  control._userInteracted = true;
  syncValidationState(control);
  const ev = new Event("invalid", control);
  ev.bubbles = false;
  ev.cancelable = true;
  const notCancelled = dispatchEvent(ev);
  if (notCancelled && typeof control.focus === "function") control.focus();
  return false;
}

function isSubmitButton(node) {
  if (node instanceof ButtonElement) return node.type === "submit";
  if (node instanceof ButtonInput) return node.type === "submit" || node.type === "image";
  return false;
}

function collectFormControls(form) {
  const top = rootOf(form);
  const out = [];
  eachDescendant(top, (node) => {
    if (node.nodeType !== 1 || !LISTED_TAGS.has(node.localName)) return;
    if (node instanceof ButtonInput && node.type === "image") return;
    if (formOwnerOf(node) === form) out.push(node);
  });
  return out;
}

function defaultSubmitButtonOf(form) {
  const top = rootOf(form);
  let found = null;
  eachDescendant(top, (node) => {
    if (!found && isSubmitButton(node) && formOwnerOf(node) === form) found = node;
  });
  return found;
}

function implicitFormSubmit(control) {
  const form = formOwnerOf(control);
  if (!form) return;
  const submitBtn = defaultSubmitButtonOf(form);
  if (submitBtn) {
    if (!isControlDisabled(submitBtn)) form.requestSubmit(submitBtn);
    return;
  }
  // WHATWG §4.10.18.6: implicit submission without a submit button applies when the form
  // has at most one text field blocking implicit submission.
  const textControls = collectFormControls(form).filter((el) =>
    el instanceof Input && el._tag === "input" && (SINGLE_LINE_TYPES.has(el.type) || NUMERIC_OR_TEMPORAL_TYPES.has(el.type))
  );
  if (textControls.length <= 1) form.requestSubmit();
}

function makeRadioNodeList(items) {
  const list = items.slice();
  list.item = (index) => list[index] ?? null;
  Object.defineProperty(list, "value", {
    get() {
      const checked = list.find((el) => el instanceof CheckInput && el.type === "radio" && el.checked);
      return checked ? checked.value : "";
    },
    set(val) {
      const target = String(val);
      for (const el of list) {
        if (el instanceof CheckInput && el.type === "radio") {
          el.checked = el.value === target;
        }
      }
    },
    configurable: true,
  });
  return list;
}

function makeFormControlsCollection(items) {
  const namedItem = (name) => {
    const key = String(name);
    if (!key) return null;
    const matches = items.filter((el) => el.getAttribute("id") === key || el.getAttribute("name") === key);
    if (matches.length === 0) return null;
    return matches.length === 1 ? matches[0] : makeRadioNodeList(matches);
  };
  items.item = (index) => items[index] ?? null;
  items.namedItem = namedItem;
  return new Proxy(items, {
    get(target, prop, receiver) {
      if (prop in target || typeof prop === "symbol") return Reflect.get(target, prop, receiver);
      return namedItem(prop);
    },
  });
}

let formCount = 0;

function syncAncestorForm(node) {
  for (let p = node; p; p = p.parentNode) {
    if (p instanceof FormElement) {
      p._onChildrenChange();
      return;
    }
  }
}

/**
 * `<form>`: groups form-associated controls, manages submission, reset, validation, and `:valid`/`:invalid`.
 */
export class FormElement extends Node {
  #defaultButton = null;

  constructor() {
    super("box");
    this._tag = "form";
    formCount++;
    native.attribute(this.nodeId, "element", "form");
  }

  _shallowClone() {
    return new FormElement();
  }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get action() { return this.getAttribute("action") ?? ""; }
  set action(v) { this.setAttribute("action", String(v)); }

  get method() {
    const raw = (this.getAttribute("method") ?? "").toLowerCase();
    return raw === "post" || raw === "dialog" ? raw : "get";
  }
  set method(v) { this.setAttribute("method", String(v)); }

  get enctype() {
    const raw = (this.getAttribute("enctype") ?? "").toLowerCase();
    return raw === "multipart/form-data" || raw === "text/plain" ? raw : "application/x-www-form-urlencoded";
  }
  set enctype(v) { this.setAttribute("enctype", String(v)); }
  get encoding() { return this.enctype; }
  set encoding(v) { this.enctype = v; }

  get target() { return this.getAttribute("target") ?? ""; }
  set target(v) { this.setAttribute("target", String(v)); }

  get acceptCharset() { return this.getAttribute("accept-charset") ?? ""; }
  set acceptCharset(v) { this.setAttribute("accept-charset", String(v)); }

  get autocomplete() { return this.getAttribute("autocomplete") === "off" ? "off" : "on"; }
  set autocomplete(v) { this.setAttribute("autocomplete", String(v)); }

  get noValidate() { return this.hasAttribute("novalidate"); }
  set noValidate(v) { if (v) this.setAttribute("novalidate", ""); else this.removeAttribute("novalidate"); }

  get rel() { return this.getAttribute("rel") ?? ""; }
  set rel(v) { this.setAttribute("rel", String(v)); }

  get elements() {
    return makeFormControlsCollection(collectFormControls(this));
  }

  get length() {
    return collectFormControls(this).length;
  }

  _syncDefaultButton() {
    const next = defaultSubmitButtonOf(this);
    if (this.#defaultButton && this.#defaultButton !== next && nodes[this.#defaultButton.nodeId] !== undefined) {
      native.attribute(this.#defaultButton.nodeId, "-silk-default", null);
    }
    this.#defaultButton = next;
    if (next) native.attribute(next.nodeId, "-silk-default", "1");
  }

  _syncValidity() {
    const controls = collectFormControls(this);
    const valid = controls.every((c) => !isCandidateForConstraintValidation(c) || computeValidity(c).valid);
    native.attribute(this.nodeId, "-silk-valid", valid ? "1" : "0");
  }

  _onChildrenChange() {
    this._syncDefaultButton();
    this._syncValidity();
  }

  checkValidity() {
    const controls = collectFormControls(this);
    let allValid = true;
    for (const control of controls) {
      if (typeof control.checkValidity === "function" && !control.checkValidity()) allValid = false;
    }
    return allValid;
  }

  reportValidity() {
    const controls = collectFormControls(this);
    let firstInvalid = null;
    for (const control of controls) {
      if (!isCandidateForConstraintValidation(control)) continue;
      if (computeValidity(control).valid) continue;
      control._userInteracted = true;
      syncValidationState(control);
      const ev = new Event("invalid", control);
      ev.bubbles = false;
      ev.cancelable = true;
      const notCancelled = dispatchEvent(ev);
      if (notCancelled && !firstInvalid) firstInvalid = control;
    }
    if (firstInvalid) {
      firstInvalid.focus?.();
      return false;
    }
    // Check if any invalid control had its `invalid` event cancelled — form is still invalid.
    return controls.every((c) => !isCandidateForConstraintValidation(c) || computeValidity(c).valid);
  }

  requestSubmit(submitter = null) {
    if (submitter !== null && submitter !== undefined) {
      if (!isSubmitButton(submitter)) throw new TypeError("The specified element is not a submit button.");
      if (formOwnerOf(submitter) !== this) throw domError("NotFoundError", "The specified element is not owned by this form element.");
    }
    const skipValidation = this.noValidate || Boolean(submitter?.formNoValidate);
    if (!skipValidation && !this.reportValidity()) return;
    const SubmitEventClass = globalThis.SubmitEvent;
    let ev;
    if (typeof SubmitEventClass === "function") {
      ev = new SubmitEventClass("submit", { bubbles: true, cancelable: true, submitter: submitter ?? null });
      adopt(ev, this);
    } else {
      ev = new Event("submit", this);
      ev.bubbles = true;
      ev.cancelable = true;
      ev.submitter = submitter ?? null;
    }
    dispatchEvent(ev);
  }

  submit() {
    // Programmatic submit bypasses `submit` event and constraint validation per WHATWG §4.10.18.6.
  }

  reset() {
    const ev = new Event("reset", this);
    ev.bubbles = true;
    ev.cancelable = true;
    if (!dispatchEvent(ev)) return;
    for (const control of collectFormControls(this)) {
      control._reset?.();
    }
    this._syncValidity();
  }
}

/**
 * `<input type="checkbox">` and `type="radio"`: a box a click checks, as on the web. It fires
 * `input` and `change` when the click changes it.
 */
export class CheckInput extends Node {
  #checked = false;
  #dirtyChecked = false;
  #indeterminate = false;
  #value = null;
  _customValidity = "";
  _userInteracted = false;

  constructor(type = "checkbox") {
    super("box");
    this._tag = "input";
    this._inputType = type === "radio" ? "radio" : "checkbox";
    native.attribute(this.nodeId, "element", "input");
    native.attribute(this.nodeId, "type", this._inputType);
    native.attribute(this.nodeId, "role", this._inputType === "radio" ? "radio" : "checkbox");
    native.attribute(this.nodeId, "tabIndex", 0);
    this._keep("focus", "blur", "keydown");
    this._relisten();
    syncValidationState(this);
  }

  _shallowClone() {
    const copy = new CheckInput(this.type);
    copy.checked = this.#checked;
    copy.indeterminate = this.#indeterminate;
    return copy;
  }

  get type() { return this._inputType; }
  set type(v) {
    const next = canonicalInputType(v);
    if (next === "checkbox" || next === "radio") {
      this._inputType = next;
      native.attribute(this.nodeId, "type", next);
      native.attribute(this.nodeId, "role", next === "radio" ? "radio" : "checkbox");
      syncValidationState(this);
    }
  }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get required() { return this.hasAttribute("required"); }
  set required(v) { if (v) this.setAttribute("required", ""); else this.removeAttribute("required"); }

  get value() {
    if (this.#value !== null) return this.#value;
    return this.getAttribute("value") ?? "on";
  }
  set value(v) {
    this.#value = String(v);
    super.setAttribute("value", this.#value);
  }

  get defaultValue() { return this.getAttribute("value") ?? ""; }
  set defaultValue(v) { this.setAttribute("value", String(v)); }

  get defaultChecked() { return this.hasAttribute("checked"); }
  set defaultChecked(v) {
    if (v) this.setAttribute("checked", "");
    else this.removeAttribute("checked");
  }

  get checked() { return this.#checked; }
  set checked(value) {
    this.#dirtyChecked = true;
    this.#setChecked(!!value);
  }

  #setChecked(value) {
    if (value === this.#checked) return;
    this.#checked = value;
    native.attribute(this.nodeId, "checked", value);
    if (value && this.type === "radio" && this.name) {
      for (const peer of radioGroupPeers(this)) {
        if (peer !== this && peer.checked) peer._uncheckFromGroup();
      }
    }
    syncValidationState(this);
    if (this.type === "radio" && this.name) {
      for (const peer of radioGroupPeers(this)) {
        if (peer !== this) syncValidationState(peer);
      }
    }
  }

  _uncheckFromGroup() {
    if (!this.#checked) return;
    this.#checked = false;
    native.attribute(this.nodeId, "checked", false);
  }

  get indeterminate() { return this.#indeterminate; }
  set indeterminate(value) {
    const next = !!value;
    if (next === this.#indeterminate) return;
    this.#indeterminate = next;
    native.attribute(this.nodeId, "indeterminate", next);
  }

  get form() { return formOwnerOf(this); }
  get labels() { return labelsOf(this); }

  get willValidate() { return isCandidateForConstraintValidation(this); }
  get validity() { return computeValidity(this); }
  get validationMessage() { return validationMessageFor(this); }
  setCustomValidity(message) {
    this._customValidity = String(message);
    syncValidationState(this);
  }
  checkValidity() { return runCheckValidity(this); }
  reportValidity() { return runReportValidity(this); }

  setAttribute(name, value) {
    const lower = String(name).toLowerCase();
    if (lower === "checked") {
      super.setAttribute(name, value);
      if (!this.#dirtyChecked) this.#setChecked(value !== null && value !== undefined && value !== false);
      return;
    }
    if (lower === "value") {
      this.#value = value == null ? null : String(value);
      super.setAttribute(name, value);
      return;
    }
    super.setAttribute(name, value);
    if (VALIDATION_ATTRS.has(lower)) syncValidationState(this);
  }

  _reset() {
    this.#dirtyChecked = false;
    this._userInteracted = false;
    this.indeterminate = false;
    this.#setChecked(this.defaultChecked);
  }

  _activate() {
    if (isControlDisabled(this)) return true;
    if (this.type === "radio" && this.#checked) return true;
    this._userInteracted = true;
    if (this.type === "checkbox" && this.#indeterminate) this.indeterminate = false;
    this.checked = this.type === "radio" ? true : !this.#checked;
    const input = new Event("input", this);
    input.bubbles = true;
    dispatchEvent(input);
    const change = new Event("change", this);
    change.bubbles = true;
    dispatchEvent(change);
    return true;
  }

  _handleKey(event) {
    if (isControlDisabled(this)) return false;
    if (event.key === " ") {
      event.preventDefault();
      return this._activate();
    }
    if (event.key === "Enter") {
      event.preventDefault();
      implicitFormSubmit(this);
      return true;
    }
    if (this.type === "radio" && (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "ArrowLeft" || event.key === "ArrowUp")) {
      const peers = radioGroupPeers(this).filter((p) => !isControlDisabled(p));
      if (peers.length <= 1) return false;
      const idx = peers.indexOf(this);
      if (idx < 0) return false;
      event.preventDefault();
      const delta = (event.key === "ArrowRight" || event.key === "ArrowDown") ? 1 : -1;
      const next = peers[(idx + delta + peers.length) % peers.length];
      next.focus();
      next._activate();
      return true;
    }
    return false;
  }
}

/**
 * `<input type="range">`: a slider control whose track, progress fill and thumb are painted
 * natively using `accent-color` unless `appearance: none` is set. Supports pointer dragging
 * and keyboard stepping, firing `input` while moving and `change` on commit.
 */
export class RangeInput extends Node {
  #min = 0;
  #max = 100;
  #step = "1";
  #value = 50;
  #hasValue = false;
  #dragging = false;
  #dragPointerId = -1;
  #dragStartValue = 50;
  _customValidity = "";
  _userInteracted = false;

  constructor() {
    super("box");
    this._tag = "input";
    this.type = "range";
    native.attribute(this.nodeId, "element", "input");
    native.attribute(this.nodeId, "type", "range");
    native.attribute(this.nodeId, "role", "slider");
    native.attribute(this.nodeId, "tabIndex", 0);
    this._keep("focus", "blur", "pointerdown", "pointermove", "pointerup", "pointercancel", "keydown");
    this._relisten();
    this.#syncRange();
    syncValidationState(this);
  }

  _shallowClone() {
    const copy = new RangeInput();
    copy.min = this.min;
    copy.max = this.max;
    copy.step = this.step;
    if (this.#hasValue) copy.value = this.value;
    return copy;
  }

  #effectiveMin() { return Number.isFinite(this.#min) ? this.#min : 0; }
  #effectiveMax() {
    const min = this.#effectiveMin();
    const max = Number.isFinite(this.#max) ? this.#max : 100;
    return max < min ? min : max;
  }
  #stepNumber() {
    if (typeof this.#step === "string" && this.#step.trim().toLowerCase() === "any") return 0;
    const n = Number(this.#step);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  #snap(raw) {
    const min = this.#effectiveMin();
    const max = this.#effectiveMax();
    let v = Number.isFinite(raw) ? raw : min + (max - min) * 0.5;
    if (v < min) v = min;
    if (v > max) v = max;
    const step = this.#stepNumber();
    if (step > 0 && max > min) {
      const steps = Math.round((v - min) / step);
      v = min + steps * step;
      if (v > max) v = min + Math.floor((max - min) / step) * step;
      if (v < min) v = min;
      v = Number(v.toPrecision(12));
    }
    return v;
  }
  #syncRange() {
    const min = this.#effectiveMin();
    const max = this.#effectiveMax();
    const val = this.#snap(this.#hasValue ? this.#value : min + (max - min) * 0.5);
    this.#value = val;
    native.attribute(this.nodeId, "valueRange", min, max, val);
  }

  get min() { return this.getAttribute("min") ?? ""; }
  set min(value) {
    const text = value == null ? "" : String(value);
    const n = text.trim() === "" ? 0 : Number(text);
    this.#min = Number.isFinite(n) ? n : 0;
    super.setAttribute("min", text === "" ? null : text);
    this.#syncRange();
  }

  get max() { return this.getAttribute("max") ?? ""; }
  set max(value) {
    const text = value == null ? "" : String(value);
    const n = text.trim() === "" ? 100 : Number(text);
    this.#max = Number.isFinite(n) ? n : 100;
    super.setAttribute("max", text === "" ? null : text);
    this.#syncRange();
  }

  get step() { return this.getAttribute("step") ?? ""; }
  set step(value) {
    const text = value == null ? "" : String(value);
    this.#step = text.trim() === "" ? "1" : text;
    super.setAttribute("step", text === "" ? null : text);
    this.#syncRange();
  }

  get defaultValue() { return this.getAttribute("value") ?? ""; }
  set defaultValue(v) { this.setAttribute("value", String(v)); }

  get value() { return String(this.#value); }
  set value(val) {
    const n = Number(val);
    this.#hasValue = true;
    this.#value = this.#snap(Number.isFinite(n) ? n : this.#effectiveMin() + (this.#effectiveMax() - this.#effectiveMin()) * 0.5);
    this.#syncRange();
  }

  get valueAsNumber() { return this.#value; }
  set valueAsNumber(val) { this.value = val; }

  stepUp(n = 1) {
    const step = this.#stepNumber();
    if (step <= 0) throw domError("InvalidStateError", "This input element has step=\"any\".");
    this.value = this.#value + (Math.trunc(Number(n)) || 1) * step;
  }
  stepDown(n = 1) {
    const step = this.#stepNumber();
    if (step <= 0) throw domError("InvalidStateError", "This input element has step=\"any\".");
    this.value = this.#value - (Math.trunc(Number(n)) || 1) * step;
  }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get form() { return formOwnerOf(this); }
  get labels() { return labelsOf(this); }

  get willValidate() { return isCandidateForConstraintValidation(this); }
  get validity() { return computeValidity(this); }
  get validationMessage() { return validationMessageFor(this); }
  setCustomValidity(message) {
    this._customValidity = String(message);
    syncValidationState(this);
  }
  checkValidity() { return runCheckValidity(this); }
  reportValidity() { return runReportValidity(this); }

  _reset() {
    this.#hasValue = false;
    this._userInteracted = false;
    const def = this.getAttribute("value");
    if (def !== null && def !== "") {
      const n = Number(def);
      this.#value = this.#snap(Number.isFinite(n) ? n : this.#effectiveMin() + (this.#effectiveMax() - this.#effectiveMin()) * 0.5);
      this.#hasValue = true;
    }
    this.#syncRange();
    syncValidationState(this);
  }

  setAttribute(name, value) {
    const lower = String(name).toLowerCase();
    if (lower === "min") {
      const text = value == null ? "" : String(value);
      const n = text.trim() === "" ? 0 : Number(text);
      this.#min = Number.isFinite(n) ? n : 0;
      super.setAttribute(name, value);
      this.#syncRange();
      return;
    }
    if (lower === "max") {
      const text = value == null ? "" : String(value);
      const n = text.trim() === "" ? 100 : Number(text);
      this.#max = Number.isFinite(n) ? n : 100;
      super.setAttribute(name, value);
      this.#syncRange();
      return;
    }
    if (lower === "step") {
      const text = value == null ? "" : String(value);
      this.#step = text.trim() === "" ? "1" : text;
      super.setAttribute(name, value);
      this.#syncRange();
      return;
    }
    if (lower === "value") {
      super.setAttribute(name, value);
      if (value != null && !this.#hasValue) {
        const n = Number(value);
        this.#value = this.#snap(Number.isFinite(n) ? n : this.#effectiveMin() + (this.#effectiveMax() - this.#effectiveMin()) * 0.5);
        this.#syncRange();
      }
      return;
    }
    super.setAttribute(name, value);
    if (VALIDATION_ATTRS.has(lower)) syncValidationState(this);
  }

  #setFromClientX(clientX) {
    const rect = this.getBoundingClientRect();
    if (!rect || rect.width <= 0) return false;
    const thumbDiameter = Math.min(16, Math.max(10, rect.height || 16));
    const thumbR = thumbDiameter * 0.5;
    const travel = Math.max(1, rect.width - thumbDiameter);
    const ratio = Math.min(1, Math.max(0, (clientX - (rect.left + thumbR)) / travel));
    const min = this.#effectiveMin();
    const max = this.#effectiveMax();
    const next = this.#snap(min + (max - min) * ratio);
    if (next === this.#value) return false;
    this.#hasValue = true;
    this.#value = next;
    this._userInteracted = true;
    native.attribute(this.nodeId, "valueRange", min, max, next);
    const input = new Event("input", this);
    input.bubbles = true;
    dispatchEvent(input);
    return true;
  }

  _handlePointer(kind, event) {
    if (isControlDisabled(this)) return false;
    if (kind === 0) {
      if (event.button !== 0) return false;
      this.focus();
      this.#dragging = true;
      this.#dragPointerId = event.pointerId;
      this.#dragStartValue = this.#value;
      this.setPointerCapture(event.pointerId);
      this.#setFromClientX(event.clientX);
      return true;
    }
    if (kind === 3 && this.#dragging) {
      this.#setFromClientX(event.clientX);
      return true;
    }
    if ((kind === 1 || kind === 14) && this.#dragging) {
      this.#dragging = false;
      if (kind === 1) this.#setFromClientX(event.clientX);
      try { this.releasePointerCapture(this.#dragPointerId); } catch {}
      this.#dragPointerId = -1;
      if (kind === 1 && this.#value !== this.#dragStartValue) {
        const change = new Event("change", this);
        change.bubbles = true;
        dispatchEvent(change);
      }
      return true;
    }
    return false;
  }

  _handleKey(event) {
    if (isControlDisabled(this)) return false;
    const min = this.#effectiveMin();
    const max = this.#effectiveMax();
    const step = this.#stepNumber() || (max - min) / 100 || 1;
    const big = Math.max(step, (max - min) * 0.1);
    let next = this.#value;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = this.#value + step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = this.#value - step;
    else if (event.key === "PageUp") next = this.#value + big;
    else if (event.key === "PageDown") next = this.#value - big;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return false;
    event.preventDefault();
    const snapped = this.#snap(next);
    if (snapped === this.#value) return true;
    this.#hasValue = true;
    this.#value = snapped;
    this._userInteracted = true;
    native.attribute(this.nodeId, "valueRange", min, max, snapped);
    const input = new Event("input", this);
    input.bubbles = true;
    dispatchEvent(input);
    const change = new Event("change", this);
    change.bubbles = true;
    dispatchEvent(change);
    return true;
  }
}

/**
 * `<input type="color">`: holds a 7-character lowercase `#rrggbb` color and paints an inset swatch.
 */
export class ColorInput extends Node {
  #value = "#000000";
  #dirtyValue = false;
  _customValidity = "";
  _userInteracted = false;

  constructor() {
    super("box");
    this._tag = "input";
    this.type = "color";
    native.attribute(this.nodeId, "element", "input");
    native.attribute(this.nodeId, "type", "color");
    native.attribute(this.nodeId, "tabIndex", 0);
    native.attribute(this.nodeId, "-silk-color", this.#value);
    this._keep("focus", "blur");
    this._relisten();
    syncValidationState(this);
  }

  _shallowClone() {
    const copy = new ColorInput();
    copy.value = this.#value;
    return copy;
  }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get defaultValue() { return this.getAttribute("value") ?? ""; }
  set defaultValue(v) { this.setAttribute("value", String(v)); }

  get value() { return this.#value; }
  set value(v) {
    this.#dirtyValue = true;
    this.#setColor(normalizeHexColor(v));
  }

  #setColor(hex) {
    if (hex === this.#value) return;
    this.#value = hex;
    native.attribute(this.nodeId, "-silk-color", hex);
    syncValidationState(this);
  }

  get form() { return formOwnerOf(this); }
  get labels() { return labelsOf(this); }
  get willValidate() { return isCandidateForConstraintValidation(this); }
  get validity() { return computeValidity(this); }
  get validationMessage() { return validationMessageFor(this); }
  setCustomValidity(message) { this._customValidity = String(message); syncValidationState(this); }
  checkValidity() { return runCheckValidity(this); }
  reportValidity() { return runReportValidity(this); }

  _reset() {
    this.#dirtyValue = false;
    this._userInteracted = false;
    this.#setColor(normalizeHexColor(this.getAttribute("value")));
  }

  setAttribute(name, value) {
    const lower = String(name).toLowerCase();
    super.setAttribute(name, value);
    if (lower === "value" && !this.#dirtyValue) {
      this.#setColor(normalizeHexColor(value));
    } else if (VALIDATION_ATTRS.has(lower)) {
      syncValidationState(this);
    }
  }
}

/**
 * `<input type="file">`: holds a `FileList`, reports `C:\fakepath\<name>` from `.value`, and validates `required`.
 */
export class FileInput extends Node {
  #files = [];
  _customValidity = "";
  _userInteracted = false;

  constructor() {
    super("box");
    this._tag = "input";
    this.type = "file";
    native.attribute(this.nodeId, "element", "input");
    native.attribute(this.nodeId, "type", "file");
    native.attribute(this.nodeId, "tabIndex", 0);
    this._keep("focus", "blur");
    this._relisten();
    syncValidationState(this);
  }

  _shallowClone() { return new FileInput(); }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get accept() { return this.getAttribute("accept") ?? ""; }
  set accept(v) { this.setAttribute("accept", String(v)); }

  get multiple() { return this.hasAttribute("multiple"); }
  set multiple(v) { if (v) this.setAttribute("multiple", ""); else this.removeAttribute("multiple"); }

  get required() { return this.hasAttribute("required"); }
  set required(v) { if (v) this.setAttribute("required", ""); else this.removeAttribute("required"); }

  get files() { return createFileList(this.#files); }
  set files(list) {
    this.#files = list ? Array.from(list) : [];
    syncValidationState(this);
  }

  get value() {
    return this.#files.length ? "C:\\fakepath\\" + (this.#files[0].name ?? "") : "";
  }
  set value(v) {
    if (String(v) === "") {
      this.#files = [];
      syncValidationState(this);
    } else {
      throw domError("InvalidStateError", "This input element accepts a filename, which may only be programmatically set to the empty string.");
    }
  }

  get form() { return formOwnerOf(this); }
  get labels() { return labelsOf(this); }
  get willValidate() { return isCandidateForConstraintValidation(this); }
  get validity() { return computeValidity(this); }
  get validationMessage() { return validationMessageFor(this); }
  setCustomValidity(message) { this._customValidity = String(message); syncValidationState(this); }
  checkValidity() { return runCheckValidity(this); }
  reportValidity() { return runReportValidity(this); }

  _reset() {
    this.#files = [];
    this._userInteracted = false;
    syncValidationState(this);
  }

  setAttribute(name, value) {
    const lower = String(name).toLowerCase();
    super.setAttribute(name, value);
    if (VALIDATION_ATTRS.has(lower)) syncValidationState(this);
  }
}

/**
 * `<input type="button|submit|reset|image">`: button-like input controls.
 */
export class ButtonInput extends Node {
  _customValidity = "";

  constructor(type = "button") {
    super("box");
    this._tag = "input";
    this._inputType = canonicalInputType(type);
    native.attribute(this.nodeId, "element", "input");
    native.attribute(this.nodeId, "type", this._inputType);
    native.attribute(this.nodeId, "role", "button");
    native.attribute(this.nodeId, "tabIndex", 0);
    this._keep("focus", "blur", "keydown");
    this._relisten();
  }

  _shallowClone() { return new ButtonInput(this._inputType); }

  get type() { return this._inputType; }
  set type(v) {
    this._inputType = canonicalInputType(v);
    native.attribute(this.nodeId, "type", this._inputType);
    formOwnerOf(this)?._syncDefaultButton();
  }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get value() { return this.getAttribute("value") ?? ""; }
  set value(v) { this.setAttribute("value", String(v)); }
  get defaultValue() { return this.value; }
  set defaultValue(v) { this.value = v; }

  get formAction() { return this.getAttribute("formaction") ?? ""; }
  set formAction(v) { this.setAttribute("formaction", String(v)); }
  get formEnctype() { return this.getAttribute("formenctype") ?? ""; }
  set formEnctype(v) { this.setAttribute("formenctype", String(v)); }
  get formMethod() { return this.getAttribute("formmethod") ?? ""; }
  set formMethod(v) { this.setAttribute("formmethod", String(v)); }
  get formNoValidate() { return this.hasAttribute("formnovalidate"); }
  set formNoValidate(v) { if (v) this.setAttribute("formnovalidate", ""); else this.removeAttribute("formnovalidate"); }
  get formTarget() { return this.getAttribute("formtarget") ?? ""; }
  set formTarget(v) { this.setAttribute("formtarget", String(v)); }

  get form() { return formOwnerOf(this); }
  get labels() { return labelsOf(this); }
  get willValidate() { return false; }
  get validity() { return new ValidityState({ customError: Boolean(this._customValidity) }); }
  get validationMessage() { return this._customValidity; }
  setCustomValidity(message) { this._customValidity = String(message); }
  checkValidity() { return true; }
  reportValidity() { return true; }

  _activate() {
    if (isControlDisabled(this)) return true;
    const form = formOwnerOf(this);
    if (!form) return false;
    if (this._inputType === "submit" || this._inputType === "image") {
      form.requestSubmit(this);
      return true;
    }
    if (this._inputType === "reset") {
      form.reset();
      return true;
    }
    return false;
  }

  _handleKey(event) {
    if (isControlDisabled(this)) return false;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.click?.() ?? this._activate();
      return true;
    }
    return false;
  }
}

/**
 * `<input type="hidden">`: non-rendered form value carrier.
 */
export class HiddenInput extends Node {
  _customValidity = "";

  constructor() {
    super("box");
    this._tag = "input";
    this.type = "hidden";
    native.attribute(this.nodeId, "element", "input");
    native.attribute(this.nodeId, "type", "hidden");
  }

  _shallowClone() { return new HiddenInput(); }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get value() { return this.getAttribute("value") ?? ""; }
  set value(v) { this.setAttribute("value", String(v)); }
  get defaultValue() { return this.value; }
  set defaultValue(v) { this.value = v; }

  get form() { return formOwnerOf(this); }
  get labels() { return []; }
  get willValidate() { return false; }
  get validity() { return new ValidityState({ customError: Boolean(this._customValidity) }); }
  get validationMessage() { return this._customValidity; }
  setCustomValidity(message) { this._customValidity = String(message); }
  checkValidity() { return true; }
  reportValidity() { return true; }
}

/**
 * `<option>`: an item inside a `<select>` or `<optgroup>`.
 */
export class OptionElement extends Node {
  #selected = false;
  #dirtySelected = false;

  constructor(text, value, defaultSelected = false, selected = false) {
    super("box");
    this._tag = "option";
    native.attribute(this.nodeId, "element", "option");
    native.attribute(this.nodeId, "role", "option");
    if (text !== undefined && text !== null && String(text) !== "") {
      this.appendChild(createText(String(text)));
    }
    if (value !== undefined) this.setAttribute("value", String(value));
    if (defaultSelected) this.setAttribute("selected", "");
    if (selected) this.selected = true;
  }

  _shallowClone() {
    const copy = new OptionElement();
    copy.selected = this.#selected;
    return copy;
  }

  _ownerSelect() {
    if (this.parentNode instanceof SelectElement) return this.parentNode;
    if (this.parentNode instanceof OptGroupElement && this.parentNode.parentNode instanceof SelectElement) {
      return this.parentNode.parentNode;
    }
    return null;
  }

  _notifySelect() {
    this._ownerSelect()?._syncSelectDisplay();
  }

  _onChildrenChange() {
    this._notifySelect();
  }

  get text() {
    let out = "";
    for (const child of this.childNodes) if (child.nodeType === 3) out += child.data;
    return out.trim().replace(/[\t\n\f\r ]+/g, " ");
  }
  set text(v) {
    for (const child of [...this.childNodes]) child.remove();
    const s = String(v);
    if (s) this.appendChild(createText(s));
    this._notifySelect();
  }

  get label() {
    const attr = this.getAttribute("label");
    return attr !== null && attr !== "" ? attr : this.text;
  }
  set label(v) {
    this.setAttribute("label", String(v));
    this._notifySelect();
  }

  get value() {
    const attr = this.getAttribute("value");
    return attr !== null ? attr : this.text;
  }
  set value(v) {
    this.setAttribute("value", String(v));
    this._notifySelect();
  }

  get defaultSelected() { return this.hasAttribute("selected"); }
  set defaultSelected(v) {
    if (v) this.setAttribute("selected", "");
    else this.removeAttribute("selected");
  }

  get selected() { return this.#selected; }
  set selected(v) {
    const next = !!v;
    this.#dirtySelected = true;
    this._setSelectedInternal(next);
    const select = this._ownerSelect();
    if (select) select._optionSelectionChanged(this, next);
  }

  _setSelectedInternal(next) {
    if (next === this.#selected) return;
    this.#selected = next;
    native.attribute(this.nodeId, "checked", next);
  }

  _resetSelection() {
    this.#dirtySelected = false;
    this._setSelectedInternal(this.defaultSelected);
  }

  get index() {
    const select = this._ownerSelect();
    if (!select) return 0;
    const idx = select.options.indexOf(this);
    return idx >= 0 ? idx : 0;
  }

  get form() {
    const select = this._ownerSelect();
    return select ? select.form : null;
  }

  setAttribute(name, value) {
    const lower = String(name).toLowerCase();
    super.setAttribute(name, value);
    if (lower === "selected" && !this.#dirtySelected) {
      const on = value !== null && value !== undefined && value !== false;
      this._setSelectedInternal(on);
      this._ownerSelect()?._optionSelectionChanged(this, on);
    } else if (lower === "label" || lower === "value" || lower === "disabled") {
      this._notifySelect();
    }
  }
}

/**
 * `<optgroup>`: groups `<option>` elements inside a `<select>`.
 */
export class OptGroupElement extends Node {
  constructor() {
    super("box");
    this._tag = "optgroup";
    native.attribute(this.nodeId, "element", "optgroup");
  }

  _shallowClone() { return new OptGroupElement(); }

  get label() { return this.getAttribute("label") ?? ""; }
  set label(v) { this.setAttribute("label", String(v)); }

  _onChildrenChange() {
    if (this.parentNode instanceof SelectElement) this.parentNode._onChildrenChange();
  }
}

// Floating popup listbox for an open single-select `<select>`, mounted on the document root
// (never inside `<select>.childNodes`, keeping React reconciliation untouched).
let openSelectPopup = null;

function isInsideSelectPopup(target) {
  if (!openSelectPopup) return false;
  return target === openSelectPopup.box || openSelectPopup.box.contains(target) || target === openSelectPopup.select || openSelectPopup.select.contains(target);
}

function closeSelectPopup() {
  if (!openSelectPopup) return;
  const popup = openSelectPopup;
  openSelectPopup = null;
  if (popup.select && nodes[popup.select.nodeId] !== undefined) {
    native.attribute(popup.select.nodeId, "expanded", false);
  }
  if (nodes[popup.box.nodeId] !== undefined) popup.box.destroy();
}

function popupHostFor(select) {
  let top = rootOf(select);
  if (top.localName === "html") {
    const body = top.childNodes.find((c) => c.localName === "body");
    if (body) return body;
  }
  return top;
}

/**
 * `<select>`: single- or multi-select list box with native dropdown popup and keyboard support.
 */
export class SelectElement extends Node {
  #hasExplicitSelection = false;
  #typeahead = "";
  #typeaheadAt = 0;
  _customValidity = "";
  _userInteracted = false;

  constructor() {
    super("box");
    this._tag = "select";
    native.attribute(this.nodeId, "element", "select");
    native.attribute(this.nodeId, "role", "combobox");
    native.attribute(this.nodeId, "tabIndex", 0);
    this._keep("focus", "blur", "keydown");
    this._relisten();
    syncValidationState(this);
  }

  _shallowClone() { return new SelectElement(); }

  get multiple() { return this.hasAttribute("multiple"); }
  set multiple(v) {
    if (v) this.setAttribute("multiple", "");
    else this.removeAttribute("multiple");
  }

  get size() {
    const raw = this.getAttribute("size");
    const n = raw === null ? NaN : parseInt(raw, 10);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  set size(v) {
    const n = Math.trunc(Number(v));
    if (n < 0) throw domError("IndexSizeError", "size cannot be negative");
    this.setAttribute("size", String(n));
  }

  get type() { return this.multiple ? "select-multiple" : "select-one"; }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get required() { return this.hasAttribute("required"); }
  set required(v) { if (v) this.setAttribute("required", ""); else this.removeAttribute("required"); }

  get autocomplete() { return this.getAttribute("autocomplete") ?? ""; }
  set autocomplete(v) { this.setAttribute("autocomplete", String(v)); }

  get options() {
    const list = [];
    for (const child of this.childNodes) {
      if (child instanceof OptionElement) list.push(child);
      else if (child instanceof OptGroupElement) {
        for (const sub of child.childNodes) {
          if (sub instanceof OptionElement) list.push(sub);
        }
      }
    }
    list.item = (index) => list[index] ?? null;
    list.namedItem = (name) => {
      const key = String(name);
      return list.find((o) => o.getAttribute("id") === key || o.getAttribute("name") === key) ?? null;
    };
    list.add = (el, before) => this.add(el, before);
    list.remove = (index) => this.remove(index);
    return list;
  }

  get length() { return this.options.length; }
  set length(n) {
    const target = Math.max(0, Math.trunc(Number(n)) || 0);
    const opts = this.options;
    if (target < opts.length) {
      for (let i = opts.length - 1; i >= target; i--) opts[i].remove();
    } else {
      for (let i = opts.length; i < target; i++) this.appendChild(new OptionElement());
    }
  }

  item(index) { return this.options[index] ?? null; }
  namedItem(name) { return this.options.namedItem(name); }

  add(element, before = null) {
    if (!(element instanceof OptionElement) && !(element instanceof OptGroupElement)) return;
    if (before === null || before === undefined) {
      this.appendChild(element);
      return;
    }
    if (typeof before === "number") {
      const target = this.options[before] ?? null;
      if (target && target.parentNode) target.parentNode.insertBefore(element, target);
      else this.appendChild(element);
      return;
    }
    if (before.parentNode === this) this.insertBefore(element, before);
    else this.appendChild(element);
  }

  remove(index) {
    if (arguments.length === 0) {
      super.remove();
      return;
    }
    const target = this.options[Math.trunc(Number(index))];
    if (target) target.remove();
  }

  get selectedOptions() {
    return this.options.filter((o) => o.selected);
  }

  get selectedIndex() {
    const opts = this.options;
    for (let i = 0; i < opts.length; i++) if (opts[i].selected) return i;
    return -1;
  }

  set selectedIndex(index) {
    const idx = Math.trunc(Number(index));
    const opts = this.options;
    this.#hasExplicitSelection = true;
    for (let i = 0; i < opts.length; i++) opts[i]._setSelectedInternal(i === idx);
    this._syncSelectDisplay();
  }

  get value() {
    const selected = this.selectedOptions[0];
    return selected ? selected.value : "";
  }

  set value(val) {
    const target = String(val);
    const opts = this.options;
    this.#hasExplicitSelection = true;
    let matched = false;
    for (const opt of opts) {
      if (!matched && opt.value === target) {
        opt._setSelectedInternal(true);
        matched = true;
      } else {
        opt._setSelectedInternal(false);
      }
    }
    this._syncSelectDisplay();
  }

  get form() { return formOwnerOf(this); }
  get labels() { return labelsOf(this); }
  get willValidate() { return isCandidateForConstraintValidation(this); }
  get validity() { return computeValidity(this); }
  get validationMessage() { return validationMessageFor(this); }
  setCustomValidity(message) { this._customValidity = String(message); syncValidationState(this); }
  checkValidity() { return runCheckValidity(this); }
  reportValidity() { return runReportValidity(this); }

  _ensureSingleSelection() {
    if (this.multiple || this.size > 1) return;
    const opts = this.options;
    if (opts.length === 0) return;
    let lastSelected = null;
    for (const opt of opts) if (opt.selected) lastSelected = opt;
    if (lastSelected) {
      for (const opt of opts) opt._setSelectedInternal(opt === lastSelected);
    } else if (!this.#hasExplicitSelection) {
      const first = opts.find((o) => !isControlDisabled(o)) ?? opts[0];
      if (first) first._setSelectedInternal(true);
    }
  }

  _optionSelectionChanged(option, on) {
    this.#hasExplicitSelection = true;
    if (on && !this.multiple) {
      for (const opt of this.options) {
        if (opt !== option) opt._setSelectedInternal(false);
      }
    }
    this._syncSelectDisplay();
  }

  _syncSelectDisplay() {
    this._ensureSingleSelection();
    const selected = this.selectedOptions[0];
    const label = selected ? selected.label : "";
    native.attribute(this.nodeId, "-silk-select-label", this.multiple || this.size > 1 ? null : label);
    syncValidationState(this);
  }

  _onChildrenChange() {
    this._syncSelectDisplay();
  }

  _reset() {
    this.#hasExplicitSelection = false;
    this._userInteracted = false;
    for (const opt of this.options) opt._resetSelection();
    this._syncSelectDisplay();
  }

  #commitSelection(option) {
    if (!option || isControlDisabled(option)) return;
    const prevValue = this.value;
    const prevIndex = this.selectedIndex;
    this.#hasExplicitSelection = true;
    this._userInteracted = true;
    if (this.multiple) {
      option._setSelectedInternal(!option.selected);
    } else {
      for (const opt of this.options) opt._setSelectedInternal(opt === option);
    }
    this._syncSelectDisplay();
    if (this.multiple || this.value !== prevValue || this.selectedIndex !== prevIndex) {
      const inputEv = new Event("input", this);
      inputEv.bubbles = true;
      dispatchEvent(inputEv);
      const changeEv = new Event("change", this);
      changeEv.bubbles = true;
      dispatchEvent(changeEv);
    }
  }

  #openPopup() {
    if (isControlDisabled(this) || this.multiple || this.size > 1) return;
    if (openSelectPopup?.select === this) {
      closeSelectPopup();
      return;
    }
    closeSelectPopup();
    const host = popupHostFor(this);
    if (!host || host === this) return;
    const rect = this.getBoundingClientRect();
    const box = new Node("box");
    box.style.set({
      position: "fixed",
      left: rect ? rect.left : 0,
      top: rect ? rect.bottom + 2 : 0,
      minWidth: rect ? Math.max(rect.width, 120) : 160,
      maxHeight: 240,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
      backgroundColor: "#ffffff",
      borderWidth: 1,
      borderColor: "#cbd5e1",
      borderRadius: 6,
      paddingTop: 4,
      paddingBottom: 4,
      zIndex: 2147483640,
      boxShadow: "0 8px 24px rgba(0, 0, 0, 0.16)",
    });
    native.attribute(box.nodeId, "role", "listbox");
    const addOptionRow = (opt, indented) => {
      const row = new Node("box");
      const disabled = isControlDisabled(opt);
      row.style.set({
        paddingTop: 6,
        paddingBottom: 6,
        paddingLeft: indented ? 20 : 10,
        paddingRight: 10,
        fontSize: 13,
        color: disabled ? "#94a3b8" : opt.selected ? "#ffffff" : "#0f172a",
        backgroundColor: opt.selected ? "#2563eb" : "transparent",
        cursor: disabled ? "default" : "pointer",
      });
      if (!disabled && !opt.selected) row.look("hover").set({ backgroundColor: "#f1f5f9" });
      row.appendChild(createText(opt.label));
      if (!disabled) {
        row.addEventListener("pointerdown", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          this.#commitSelection(opt);
          closeSelectPopup();
          this.focus();
        });
      }
      box.appendChild(row);
    };
    for (const child of this.childNodes) {
      if (child instanceof OptionElement) addOptionRow(child, false);
      else if (child instanceof OptGroupElement) {
        if (child.label) {
          const hdr = new Node("box");
          hdr.style.set({ paddingTop: 6, paddingBottom: 2, paddingLeft: 10, paddingRight: 10, fontSize: 11, fontWeight: 600, color: "#64748b" });
          hdr.appendChild(createText(child.label));
          box.appendChild(hdr);
        }
        for (const sub of child.childNodes) if (sub instanceof OptionElement) addOptionRow(sub, true);
      }
    }
    host.appendChild(box);
    native.attribute(this.nodeId, "expanded", true);
    openSelectPopup = { select: this, box };
  }

  _activate() {
    if (isControlDisabled(this)) return true;
    this.focus();
    if (!this.multiple && this.size <= 1) this.#openPopup();
    return true;
  }

  _handleBlur() {
    if (openSelectPopup?.select === this) closeSelectPopup();
  }

  _handleKey(event) {
    if (isControlDisabled(this)) return false;
    const opts = this.options;
    const enabled = opts.filter((o) => !isControlDisabled(o));
    if (event.key === "Escape") {
      if (openSelectPopup?.select === this) {
        event.preventDefault();
        closeSelectPopup();
        return true;
      }
      return false;
    }
    if (event.key === " " || event.key === "Enter") {
      if (!this.multiple && this.size <= 1) {
        event.preventDefault();
        this.#openPopup();
        return true;
      }
      return false;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      if (enabled.length === 0) return false;
      event.preventDefault();
      const curIdx = enabled.findIndex((o) => o.selected);
      let nextIdx;
      if (event.key === "Home") nextIdx = 0;
      else if (event.key === "End") nextIdx = enabled.length - 1;
      else if (event.key === "ArrowDown") nextIdx = curIdx < 0 ? 0 : Math.min(enabled.length - 1, curIdx + 1);
      else nextIdx = curIdx < 0 ? enabled.length - 1 : Math.max(0, curIdx - 1);
      this.#commitSelection(enabled[nextIdx]);
      return true;
    }
    if (event.key && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const now = Date.now();
      if (now - this.#typeaheadAt > 750) this.#typeahead = "";
      this.#typeaheadAt = now;
      this.#typeahead += event.key.toLowerCase();
      const match = enabled.find((o) => o.label.toLowerCase().startsWith(this.#typeahead));
      if (match) {
        event.preventDefault();
        this.#commitSelection(match);
        return true;
      }
    }
    return false;
  }

  setAttribute(name, value) {
    const lower = String(name).toLowerCase();
    super.setAttribute(name, value);
    if (lower === "multiple" || lower === "size") {
      native.attribute(this.nodeId, "role", this.multiple || this.size > 1 ? "listbox" : "combobox");
      this._syncSelectDisplay();
    } else if (VALIDATION_ATTRS.has(lower)) {
      syncValidationState(this);
    }
  }
}

/**
 * `<button>`: submit (default), reset, or plain button.
 */
export class ButtonElement extends Node {
  _customValidity = "";

  constructor() {
    super("box");
    this._tag = "button";
    native.attribute(this.nodeId, "element", "button");
    native.attribute(this.nodeId, "tabIndex", 0);
    this._keep("focus", "blur", "keydown");
    this._relisten();
  }

  _shallowClone() { return new ButtonElement(); }

  get type() {
    const raw = (this.getAttribute("type") ?? "").toLowerCase();
    return raw === "button" || raw === "reset" ? raw : "submit";
  }
  set type(v) {
    this.setAttribute("type", String(v));
    formOwnerOf(this)?._syncDefaultButton();
  }

  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get value() { return this.getAttribute("value") ?? ""; }
  set value(v) { this.setAttribute("value", String(v)); }

  get formAction() { return this.getAttribute("formaction") ?? ""; }
  set formAction(v) { this.setAttribute("formaction", String(v)); }
  get formEnctype() { return this.getAttribute("formenctype") ?? ""; }
  set formEnctype(v) { this.setAttribute("formenctype", String(v)); }
  get formMethod() { return this.getAttribute("formmethod") ?? ""; }
  set formMethod(v) { this.setAttribute("formmethod", String(v)); }
  get formNoValidate() { return this.hasAttribute("formnovalidate"); }
  set formNoValidate(v) { if (v) this.setAttribute("formnovalidate", ""); else this.removeAttribute("formnovalidate"); }
  get formTarget() { return this.getAttribute("formtarget") ?? ""; }
  set formTarget(v) { this.setAttribute("formtarget", String(v)); }

  get form() { return formOwnerOf(this); }
  get labels() { return labelsOf(this); }
  get willValidate() { return false; }
  get validity() { return new ValidityState({ customError: Boolean(this._customValidity) }); }
  get validationMessage() { return this._customValidity; }
  setCustomValidity(message) { this._customValidity = String(message); }
  checkValidity() { return true; }
  reportValidity() { return true; }

  _activate() {
    if (isControlDisabled(this)) return true;
    const type = this.type;
    if (type !== "submit" && type !== "reset") return false;
    const form = formOwnerOf(this);
    if (!form) return false;
    if (type === "submit") form.requestSubmit(this);
    else form.reset();
    return true;
  }

  _handleKey(event) {
    if (isControlDisabled(this)) return false;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (typeof this.click === "function") this.click();
      else this._activate();
      return true;
    }
    return false;
  }
}

/**
 * `<fieldset>`: groups controls and propagates `disabled` (exempting its first `<legend>` child).
 */
export class FieldSetElement extends Node {
  _customValidity = "";

  constructor() {
    super("box");
    this._tag = "fieldset";
    native.attribute(this.nodeId, "element", "fieldset");
  }

  _shallowClone() { return new FieldSetElement(); }

  get type() { return "fieldset"; }
  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }
  get form() { return formOwnerOf(this); }

  get elements() {
    const out = [];
    eachDescendant(this, (node) => {
      if (node.nodeType === 1 && LISTED_TAGS.has(node.localName) && !(node instanceof ButtonInput && node.type === "image")) {
        out.push(node);
      }
    });
    return makeFormControlsCollection(out);
  }

  get willValidate() { return false; }
  get validity() { return new ValidityState({ customError: Boolean(this._customValidity) }); }
  get validationMessage() { return this._customValidity; }
  setCustomValidity(message) { this._customValidity = String(message); }
  checkValidity() { return true; }
  reportValidity() { return true; }

  setAttribute(name, value) {
    super.setAttribute(name, value);
    if (String(name).toLowerCase() === "disabled") {
      eachDescendant(this, (node) => {
        if (node.nodeType === 1 && LISTED_TAGS.has(node.localName)) syncValidationState(node);
      });
    }
  }
}

/**
 * `<label>`: associates a caption with a labelable form control via `for` or containment.
 */
export class LabelElement extends Node {
  constructor() {
    super("box");
    this._tag = "label";
    native.attribute(this.nodeId, "element", "label");
    this._relisten();
  }

  _shallowClone() { return new LabelElement(); }

  get htmlFor() { return this.getAttribute("for") ?? ""; }
  set htmlFor(v) { this.setAttribute("for", String(v)); }

  get control() {
    const id = this.getAttribute("for");
    if (id !== null) {
      if (id === "") return null;
      const target = findById(id);
      return isLabelable(target) ? target : null;
    }
    let found = null;
    eachDescendant(this, (node) => {
      if (!found && isLabelable(node)) found = node;
    });
    return found;
  }

  get form() {
    const c = this.control;
    return c ? (c.form ?? null) : null;
  }

  _activate() {
    const control = this.control;
    if (!control || isControlDisabled(control)) return false;
    if (control instanceof CheckInput || control instanceof ButtonElement || control instanceof ButtonInput || control instanceof SelectElement) {
      control.focus();
      control._activate();
    } else {
      control.focus();
    }
    return true;
  }
}

/**
 * `<progress>`: completion progress bar (determinate when `value` attribute is present, else indeterminate).
 */
export class ProgressElement extends Node {
  constructor() {
    super("box");
    this._tag = "progress";
    native.attribute(this.nodeId, "element", "progress");
    native.attribute(this.nodeId, "role", "progressbar");
    this.#syncProgress();
  }

  _shallowClone() { return new ProgressElement(); }

  get max() {
    const raw = this.getAttribute("max");
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  set max(v) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) this.setAttribute("max", String(n));
  }

  get value() {
    const raw = this.getAttribute("value");
    if (raw === null) return 0;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, this.max);
  }
  set value(v) {
    const n = Number(v);
    if (Number.isFinite(n)) this.setAttribute("value", String(Math.max(0, n)));
  }

  get position() {
    if (!this.hasAttribute("value")) return -1;
    return this.value / this.max;
  }

  get labels() { return labelsOf(this); }

  #syncProgress() {
    if (!this.hasAttribute("value")) {
      native.attribute(this.nodeId, "valueRange", 0, 1, -1);
    } else {
      native.attribute(this.nodeId, "valueRange", 0, this.max, this.value);
    }
  }

  setAttribute(name, value) {
    super.setAttribute(name, value);
    const lower = String(name).toLowerCase();
    if (lower === "value" || lower === "max") this.#syncProgress();
  }
}

/**
 * `<meter>`: scalar measurement within a known range with optimum/suboptimal/even-less-good regions (WHATWG §4.10.14).
 */
export class MeterElement extends Node {
  constructor() {
    super("box");
    this._tag = "meter";
    native.attribute(this.nodeId, "element", "meter");
    native.attribute(this.nodeId, "role", "meter");
    this.#syncMeter();
  }

  _shallowClone() { return new MeterElement(); }

  get min() {
    const raw = this.getAttribute("min");
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  set min(v) { this.setAttribute("min", String(Number(v))); }

  get max() {
    const raw = this.getAttribute("max");
    const n = raw === null ? NaN : Number(raw);
    const min = this.min;
    const parsed = Number.isFinite(n) ? n : 1;
    return Math.max(min, parsed);
  }
  set max(v) { this.setAttribute("max", String(Number(v))); }

  get value() {
    const raw = this.getAttribute("value");
    const n = raw === null ? 0 : Number(raw);
    const v = Number.isFinite(n) ? n : 0;
    return Math.min(this.max, Math.max(this.min, v));
  }
  set value(v) { this.setAttribute("value", String(Number(v))); }

  get low() {
    const raw = this.getAttribute("low");
    const n = raw === null ? NaN : Number(raw);
    const min = this.min, max = this.max;
    if (!Number.isFinite(n)) return min;
    return Math.min(max, Math.max(min, n));
  }
  set low(v) { this.setAttribute("low", String(Number(v))); }

  get high() {
    const raw = this.getAttribute("high");
    const n = raw === null ? NaN : Number(raw);
    const low = this.low, max = this.max;
    if (!Number.isFinite(n)) return max;
    return Math.min(max, Math.max(low, n));
  }
  set high(v) { this.setAttribute("high", String(Number(v))); }

  get optimum() {
    const raw = this.getAttribute("optimum");
    const n = raw === null ? NaN : Number(raw);
    const min = this.min, max = this.max;
    if (!Number.isFinite(n)) return (min + max) * 0.5;
    return Math.min(max, Math.max(min, n));
  }
  set optimum(v) { this.setAttribute("optimum", String(Number(v))); }

  get labels() { return labelsOf(this); }

  #meterRegion() {
    const v = this.value, low = this.low, high = this.high, opt = this.optimum;
    if (opt < low) {
      if (v <= low) return "optimum";
      if (v <= high) return "suboptimal";
      return "even-less-good";
    }
    if (opt > high) {
      if (v >= high) return "optimum";
      if (v >= low) return "suboptimal";
      return "even-less-good";
    }
    if (v >= low && v <= high) return "optimum";
    return "suboptimal";
  }

  #syncMeter() {
    native.attribute(this.nodeId, "valueRange", this.min, this.max, this.value);
    native.attribute(this.nodeId, "-silk-meter-state", this.#meterRegion());
  }

  setAttribute(name, value) {
    super.setAttribute(name, value);
    const lower = String(name).toLowerCase();
    if (lower === "value" || lower === "min" || lower === "max" || lower === "low" || lower === "high" || lower === "optimum") {
      this.#syncMeter();
    }
  }
}

/**
 * `<output>`: displays the result of a calculation and resets to `defaultValue` on `form.reset()`.
 */
export class OutputElement extends Node {
  #defaultValue = null;
  _customValidity = "";

  constructor() {
    super("box");
    this._tag = "output";
    native.attribute(this.nodeId, "element", "output");
    native.attribute(this.nodeId, "role", "status");
  }

  _shallowClone() { return new OutputElement(); }

  get type() { return "output"; }
  get name() { return this.getAttribute("name") ?? ""; }
  set name(v) { this.setAttribute("name", String(v)); }

  get htmlFor() {
    const self = this;
    return {
      get value() { return self.getAttribute("for") ?? ""; },
      set value(v) { self.setAttribute("for", String(v)); },
      toString() { return this.value; },
    };
  }

  #descendantText() {
    let out = "";
    for (const child of this.childNodes) {
      if (child.nodeType === 3) out += child.data;
      else if (child.textContent) out += child.textContent;
    }
    return out;
  }

  get defaultValue() {
    return this.#defaultValue !== null ? this.#defaultValue : this.#descendantText();
  }
  set defaultValue(v) {
    const s = String(v);
    if (this.#defaultValue === null) {
      for (const child of [...this.childNodes]) child.remove();
      if (s) this.appendChild(createText(s));
    } else {
      this.#defaultValue = s;
    }
  }

  get value() { return this.#descendantText(); }
  set value(v) {
    if (this.#defaultValue === null) this.#defaultValue = this.#descendantText();
    for (const child of [...this.childNodes]) child.remove();
    const s = String(v);
    if (s) this.appendChild(createText(s));
  }

  _textChanged() {}
  _onChildrenChange() {}

  _reset() {
    const def = this.defaultValue;
    this.#defaultValue = null;
    for (const child of [...this.childNodes]) child.remove();
    if (def) this.appendChild(createText(def));
  }

  get form() { return formOwnerOf(this); }
  get labels() { return labelsOf(this); }
  get willValidate() { return false; }
  get validity() { return new ValidityState({ customError: Boolean(this._customValidity) }); }
  get validationMessage() { return this._customValidity; }
  setCustomValidity(message) { this._customValidity = String(message); }
  checkValidity() { return true; }
  reportValidity() { return true; }
}

function eachDescendant(node, visit) {
  for (const child of node.childNodes) {
    visit(child);
    if (child.childNodes.length) eachDescendant(child, visit);
  }
}

function findById(id) {
  for (let i = 0; i < nodes.length; i++) { const node = nodes[i]; if (node && node._elementId === id && (node.parentNode || node === rootNode)) return node; }
  return null;
}

function summaryActivate() {
  const details = this.parentNode;
  if (details?.localName !== "details") return false;
  details.setAttribute("open", details.hasAttribute("open") ? null : "");
  const toggle = new Event("toggle", details);
  dispatchEvent(toggle);
  return true;
}

/**
 * The node for HTML element `tag`, as `document.createElement` makes it: `<input>` and
 * `<textarea>` are text fields (an `<input>` whose `type` is not a text field's is a specialized
 * control), `<img>` an image, `<canvas>` a canvas, `<svg>` inline SVG, and every other tag a box
 * the tree knows by its tag, for selectors, its implicit role and the default stylesheet of
 * `@silkui/react`. `localName` and `tagName` give the tag.
 */
// A style element in the document applies its text as a stylesheet, after the compiled
// imports and before adopted sheets, in tree order. Changes apply together at the next microtask.

function stylesChanged() {
  if (stylesPending) return;
  stylesPending = true;
  queueMicrotask(applyStyleElements);
}

function applyStyleElements() {
  stylesPending = false;
  const live = [];
  for (const element of styleElements) {
    if (nodes[element.nodeId] === undefined) styleElements.delete(element);
    else if (inDocument(element)) live.push(element);
  }
  live.sort(treeOrder);
  let changed = live.length !== appliedStyles.length;
  for (let i = 0; i < live.length; i++) {
    if (live[i]._compile()) changed = true;
    if (live[i] !== appliedStyles[i]) changed = true;
  }
  appliedStyles = live;
  if (changed) syncAdoptedSheets();
}

/** `<style>`: its text is a stylesheet while it is in the document. */
export class StyleElement extends Node {
  _styleSheet = null;
  #compiled = null;

  constructor() {
    super("box");
    styleElements.add(this);
  }

  /** The element's stylesheet while it is in the document, else null. */
  get sheet() {
    return inDocument(this) ? this._styleSheet : null;
  }

  // Compiles changed text. True when the element gained its first sheet.
  _compile() {
    let text = "";
    for (const child of this.childNodes) if (child.nodeType === 3) text += child.data;
    if (text === this.#compiled) return false;
    this.#compiled = text;
    if (!native.compileStyleSheet) {
      warnOnce("@silkui/core: a style element's CSS needs the host's CSS text compiler (App.runtimeStylesheets() in a release build)");
      return false;
    }
    let bytes;
    try {
      bytes = native.compileStyleSheet(text);
    } catch (error) {
      console.warn("@silkui/core: a style element's CSS did not compile: " + (error?.message ?? error));
      return false;
    }
    const first = this._styleSheet === null;
    this._styleSheet ??= new CSSStyleSheet();
    replaceSheet(this._styleSheet, bytes);
    return first;
  }
}

// A fresh element of `node`'s tag and class, as `cloneNode` starts from; null for a node that
// is not an HTML element.
function elementLike(node) {
  if (node._tag === undefined) return null;
  const type = node instanceof CheckInput || node instanceof RangeInput || node instanceof ColorInput
    || node instanceof FileInput || node instanceof ButtonInput || node instanceof HiddenInput
    ? node.type
    : node instanceof Input ? undefined : node.getAttribute("type") ?? undefined;
  return createElement(node._tag, { type });
}

export function createElement(tag, options) {
  tag = String(tag).toLowerCase();
  const type = canonicalInputType(options?.type ?? "text");
  let node;
  if (tag === "svg") return new Svg();
  if (tag === "br") return new LineBreak();
  if (tag === "form") return new FormElement();
  if (tag === "select") return new SelectElement();
  if (tag === "option") return new OptionElement();
  if (tag === "optgroup") return new OptGroupElement();
  if (tag === "button") return new ButtonElement();
  if (tag === "fieldset") return new FieldSetElement();
  if (tag === "label") return new LabelElement();
  if (tag === "progress") return new ProgressElement();
  if (tag === "meter") return new MeterElement();
  if (tag === "output") return new OutputElement();
  if (tag === "input") {
    if (type === "checkbox" || type === "radio") return new CheckInput(type);
    if (type === "range") return new RangeInput();
    if (type === "color") return new ColorInput();
    if (type === "file") return new FileInput();
    if (type === "hidden") return new HiddenInput();
    if (type === "button" || type === "submit" || type === "reset" || type === "image") return new ButtonInput(type);
    node = new Input(type);
  } else if (tag === "textarea") {
    node = new Input("text");
  } else if (tag === "img") {
    node = new Image();
  } else if (tag === "canvas") {
    node = new Canvas();
  } else if (tag === "style") {
    node = new StyleElement();
  } else {
    node = new Node("box");
  }
  node._tag = tag;
  native.attribute(node.nodeId, "element", tag);
  if (tag === "textarea") native.attribute(node.nodeId, "multiline", true);
  if (tag === "input" && type !== "text") native.attribute(node.nodeId, "type", type);
  if (node instanceof Input) {
    syncValidationState(node);
  } else if (FOCUSABLE_TAGS.has(tag)) {
    native.attribute(node.nodeId, "tabIndex", 0);
    node._keep("focus", "blur");
  }
  if (tag === "summary") {
    node._activate = summaryActivate;
    node._relisten();
  }
  return node;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
// Elements whose content is not markup. Scripts and styles in parsed HTML are left out.
// Raw text and RCDATA elements: their text is not markup. RCDATA (textarea, title) still
// decodes character references.
const RAW_TAGS = new Set(["script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes"]);
// Elements whose text children serialize as they are, unescaped.
const RAW_TEXT_PARENTS = new Set(["style", "script", "xmp", "iframe", "noembed", "noframes", "plaintext"]);
// The HTML Standard's named character references (html.spec.whatwg.org/entities.json),
// by name without the semicolon. LEGACY_ENTITIES may also appear without one.
const ENTITIES = {AElig:"Æ",AMP:"&",Aacute:"Á",Abreve:"Ă",Acirc:"Â",Acy:"А",Afr:"𝔄",Agrave:"À",Alpha:"Α",Amacr:"Ā",And:"⩓",Aogon:"Ą",Aopf:"𝔸",ApplyFunction:"\u2061",Aring:"Å",Ascr:"𝒜",Assign:"≔",Atilde:"Ã",Auml:"Ä",Backslash:"∖",Barv:"⫧",Barwed:"⌆",Bcy:"Б",Because:"∵",Bernoullis:"ℬ",Beta:"Β",Bfr:"𝔅",Bopf:"𝔹",Breve:"˘",Bscr:"ℬ",Bumpeq:"≎",CHcy:"Ч",COPY:"©",Cacute:"Ć",Cap:"⋒",CapitalDifferentialD:"ⅅ",Cayleys:"ℭ",Ccaron:"Č",Ccedil:"Ç",Ccirc:"Ĉ",Cconint:"∰",Cdot:"Ċ",Cedilla:"¸",CenterDot:"·",Cfr:"ℭ",Chi:"Χ",CircleDot:"⊙",CircleMinus:"⊖",CirclePlus:"⊕",CircleTimes:"⊗",ClockwiseContourIntegral:"∲",CloseCurlyDoubleQuote:"”",CloseCurlyQuote:"’",Colon:"∷",Colone:"⩴",Congruent:"≡",Conint:"∯",ContourIntegral:"∮",Copf:"ℂ",Coproduct:"∐",CounterClockwiseContourIntegral:"∳",Cross:"⨯",Cscr:"𝒞",Cup:"⋓",CupCap:"≍",DD:"ⅅ",DDotrahd:"⤑",DJcy:"Ђ",DScy:"Ѕ",DZcy:"Џ",Dagger:"‡",Darr:"↡",Dashv:"⫤",Dcaron:"Ď",Dcy:"Д",Del:"∇",Delta:"Δ",Dfr:"𝔇",DiacriticalAcute:"´",DiacriticalDot:"˙",DiacriticalDoubleAcute:"˝",DiacriticalGrave:"`",DiacriticalTilde:"˜",Diamond:"⋄",DifferentialD:"ⅆ",Dopf:"𝔻",Dot:"¨",DotDot:"⃜",DotEqual:"≐",DoubleContourIntegral:"∯",DoubleDot:"¨",DoubleDownArrow:"⇓",DoubleLeftArrow:"⇐",DoubleLeftRightArrow:"⇔",DoubleLeftTee:"⫤",DoubleLongLeftArrow:"⟸",DoubleLongLeftRightArrow:"⟺",DoubleLongRightArrow:"⟹",DoubleRightArrow:"⇒",DoubleRightTee:"⊨",DoubleUpArrow:"⇑",DoubleUpDownArrow:"⇕",DoubleVerticalBar:"∥",DownArrow:"↓",DownArrowBar:"⤓",DownArrowUpArrow:"⇵",DownBreve:"̑",DownLeftRightVector:"⥐",DownLeftTeeVector:"⥞",DownLeftVector:"↽",DownLeftVectorBar:"⥖",DownRightTeeVector:"⥟",DownRightVector:"⇁",DownRightVectorBar:"⥗",DownTee:"⊤",DownTeeArrow:"↧",Downarrow:"⇓",Dscr:"𝒟",Dstrok:"Đ",ENG:"Ŋ",ETH:"Ð",Eacute:"É",Ecaron:"Ě",Ecirc:"Ê",Ecy:"Э",Edot:"Ė",Efr:"𝔈",Egrave:"È",Element:"∈",Emacr:"Ē",EmptySmallSquare:"◻",EmptyVerySmallSquare:"▫",Eogon:"Ę",Eopf:"𝔼",Epsilon:"Ε",Equal:"⩵",EqualTilde:"≂",Equilibrium:"⇌",Escr:"ℰ",Esim:"⩳",Eta:"Η",Euml:"Ë",Exists:"∃",ExponentialE:"ⅇ",Fcy:"Ф",Ffr:"𝔉",FilledSmallSquare:"◼",FilledVerySmallSquare:"▪",Fopf:"𝔽",ForAll:"∀",Fouriertrf:"ℱ",Fscr:"ℱ",GJcy:"Ѓ",GT:">",Gamma:"Γ",Gammad:"Ϝ",Gbreve:"Ğ",Gcedil:"Ģ",Gcirc:"Ĝ",Gcy:"Г",Gdot:"Ġ",Gfr:"𝔊",Gg:"⋙",Gopf:"𝔾",GreaterEqual:"≥",GreaterEqualLess:"⋛",GreaterFullEqual:"≧",GreaterGreater:"⪢",GreaterLess:"≷",GreaterSlantEqual:"⩾",GreaterTilde:"≳",Gscr:"𝒢",Gt:"≫",HARDcy:"Ъ",Hacek:"ˇ",Hat:"^",Hcirc:"Ĥ",Hfr:"ℌ",HilbertSpace:"ℋ",Hopf:"ℍ",HorizontalLine:"─",Hscr:"ℋ",Hstrok:"Ħ",HumpDownHump:"≎",HumpEqual:"≏",IEcy:"Е",IJlig:"Ĳ",IOcy:"Ё",Iacute:"Í",Icirc:"Î",Icy:"И",Idot:"İ",Ifr:"ℑ",Igrave:"Ì",Im:"ℑ",Imacr:"Ī",ImaginaryI:"ⅈ",Implies:"⇒",Int:"∬",Integral:"∫",Intersection:"⋂",InvisibleComma:"\u2063",InvisibleTimes:"\u2062",Iogon:"Į",Iopf:"𝕀",Iota:"Ι",Iscr:"ℐ",Itilde:"Ĩ",Iukcy:"І",Iuml:"Ï",Jcirc:"Ĵ",Jcy:"Й",Jfr:"𝔍",Jopf:"𝕁",Jscr:"𝒥",Jsercy:"Ј",Jukcy:"Є",KHcy:"Х",KJcy:"Ќ",Kappa:"Κ",Kcedil:"Ķ",Kcy:"К",Kfr:"𝔎",Kopf:"𝕂",Kscr:"𝒦",LJcy:"Љ",LT:"<",Lacute:"Ĺ",Lambda:"Λ",Lang:"⟪",Laplacetrf:"ℒ",Larr:"↞",Lcaron:"Ľ",Lcedil:"Ļ",Lcy:"Л",LeftAngleBracket:"⟨",LeftArrow:"←",LeftArrowBar:"⇤",LeftArrowRightArrow:"⇆",LeftCeiling:"⌈",LeftDoubleBracket:"⟦",LeftDownTeeVector:"⥡",LeftDownVector:"⇃",LeftDownVectorBar:"⥙",LeftFloor:"⌊",LeftRightArrow:"↔",LeftRightVector:"⥎",LeftTee:"⊣",LeftTeeArrow:"↤",LeftTeeVector:"⥚",LeftTriangle:"⊲",LeftTriangleBar:"⧏",LeftTriangleEqual:"⊴",LeftUpDownVector:"⥑",LeftUpTeeVector:"⥠",LeftUpVector:"↿",LeftUpVectorBar:"⥘",LeftVector:"↼",LeftVectorBar:"⥒",Leftarrow:"⇐",Leftrightarrow:"⇔",LessEqualGreater:"⋚",LessFullEqual:"≦",LessGreater:"≶",LessLess:"⪡",LessSlantEqual:"⩽",LessTilde:"≲",Lfr:"𝔏",Ll:"⋘",Lleftarrow:"⇚",Lmidot:"Ŀ",LongLeftArrow:"⟵",LongLeftRightArrow:"⟷",LongRightArrow:"⟶",Longleftarrow:"⟸",Longleftrightarrow:"⟺",Longrightarrow:"⟹",Lopf:"𝕃",LowerLeftArrow:"↙",LowerRightArrow:"↘",Lscr:"ℒ",Lsh:"↰",Lstrok:"Ł",Lt:"≪",Map:"⤅",Mcy:"М",MediumSpace:" ",Mellintrf:"ℳ",Mfr:"𝔐",MinusPlus:"∓",Mopf:"𝕄",Mscr:"ℳ",Mu:"Μ",NJcy:"Њ",Nacute:"Ń",Ncaron:"Ň",Ncedil:"Ņ",Ncy:"Н",NegativeMediumSpace:"\u200b",NegativeThickSpace:"\u200b",NegativeThinSpace:"\u200b",NegativeVeryThinSpace:"\u200b",NestedGreaterGreater:"≫",NestedLessLess:"≪",NewLine:"\u000a",Nfr:"𝔑",NoBreak:"\u2060",NonBreakingSpace:"\u00a0",Nopf:"ℕ",Not:"⫬",NotCongruent:"≢",NotCupCap:"≭",NotDoubleVerticalBar:"∦",NotElement:"∉",NotEqual:"≠",NotEqualTilde:"≂̸",NotExists:"∄",NotGreater:"≯",NotGreaterEqual:"≱",NotGreaterFullEqual:"≧̸",NotGreaterGreater:"≫̸",NotGreaterLess:"≹",NotGreaterSlantEqual:"⩾̸",NotGreaterTilde:"≵",NotHumpDownHump:"≎̸",NotHumpEqual:"≏̸",NotLeftTriangle:"⋪",NotLeftTriangleBar:"⧏̸",NotLeftTriangleEqual:"⋬",NotLess:"≮",NotLessEqual:"≰",NotLessGreater:"≸",NotLessLess:"≪̸",NotLessSlantEqual:"⩽̸",NotLessTilde:"≴",NotNestedGreaterGreater:"⪢̸",NotNestedLessLess:"⪡̸",NotPrecedes:"⊀",NotPrecedesEqual:"⪯̸",NotPrecedesSlantEqual:"⋠",NotReverseElement:"∌",NotRightTriangle:"⋫",NotRightTriangleBar:"⧐̸",NotRightTriangleEqual:"⋭",NotSquareSubset:"⊏̸",NotSquareSubsetEqual:"⋢",NotSquareSuperset:"⊐̸",NotSquareSupersetEqual:"⋣",NotSubset:"⊂⃒",NotSubsetEqual:"⊈",NotSucceeds:"⊁",NotSucceedsEqual:"⪰̸",NotSucceedsSlantEqual:"⋡",NotSucceedsTilde:"≿̸",NotSuperset:"⊃⃒",NotSupersetEqual:"⊉",NotTilde:"≁",NotTildeEqual:"≄",NotTildeFullEqual:"≇",NotTildeTilde:"≉",NotVerticalBar:"∤",Nscr:"𝒩",Ntilde:"Ñ",Nu:"Ν",OElig:"Œ",Oacute:"Ó",Ocirc:"Ô",Ocy:"О",Odblac:"Ő",Ofr:"𝔒",Ograve:"Ò",Omacr:"Ō",Omega:"Ω",Omicron:"Ο",Oopf:"𝕆",OpenCurlyDoubleQuote:"“",OpenCurlyQuote:"‘",Or:"⩔",Oscr:"𝒪",Oslash:"Ø",Otilde:"Õ",Otimes:"⨷",Ouml:"Ö",OverBar:"‾",OverBrace:"⏞",OverBracket:"⎴",OverParenthesis:"⏜",PartialD:"∂",Pcy:"П",Pfr:"𝔓",Phi:"Φ",Pi:"Π",PlusMinus:"±",Poincareplane:"ℌ",Popf:"ℙ",Pr:"⪻",Precedes:"≺",PrecedesEqual:"⪯",PrecedesSlantEqual:"≼",PrecedesTilde:"≾",Prime:"″",Product:"∏",Proportion:"∷",Proportional:"∝",Pscr:"𝒫",Psi:"Ψ",QUOT:"\"",Qfr:"𝔔",Qopf:"ℚ",Qscr:"𝒬",RBarr:"⤐",REG:"®",Racute:"Ŕ",Rang:"⟫",Rarr:"↠",Rarrtl:"⤖",Rcaron:"Ř",Rcedil:"Ŗ",Rcy:"Р",Re:"ℜ",ReverseElement:"∋",ReverseEquilibrium:"⇋",ReverseUpEquilibrium:"⥯",Rfr:"ℜ",Rho:"Ρ",RightAngleBracket:"⟩",RightArrow:"→",RightArrowBar:"⇥",RightArrowLeftArrow:"⇄",RightCeiling:"⌉",RightDoubleBracket:"⟧",RightDownTeeVector:"⥝",RightDownVector:"⇂",RightDownVectorBar:"⥕",RightFloor:"⌋",RightTee:"⊢",RightTeeArrow:"↦",RightTeeVector:"⥛",RightTriangle:"⊳",RightTriangleBar:"⧐",RightTriangleEqual:"⊵",RightUpDownVector:"⥏",RightUpTeeVector:"⥜",RightUpVector:"↾",RightUpVectorBar:"⥔",RightVector:"⇀",RightVectorBar:"⥓",Rightarrow:"⇒",Ropf:"ℝ",RoundImplies:"⥰",Rrightarrow:"⇛",Rscr:"ℛ",Rsh:"↱",RuleDelayed:"⧴",SHCHcy:"Щ",SHcy:"Ш",SOFTcy:"Ь",Sacute:"Ś",Sc:"⪼",Scaron:"Š",Scedil:"Ş",Scirc:"Ŝ",Scy:"С",Sfr:"𝔖",ShortDownArrow:"↓",ShortLeftArrow:"←",ShortRightArrow:"→",ShortUpArrow:"↑",Sigma:"Σ",SmallCircle:"∘",Sopf:"𝕊",Sqrt:"√",Square:"□",SquareIntersection:"⊓",SquareSubset:"⊏",SquareSubsetEqual:"⊑",SquareSuperset:"⊐",SquareSupersetEqual:"⊒",SquareUnion:"⊔",Sscr:"𝒮",Star:"⋆",Sub:"⋐",Subset:"⋐",SubsetEqual:"⊆",Succeeds:"≻",SucceedsEqual:"⪰",SucceedsSlantEqual:"≽",SucceedsTilde:"≿",SuchThat:"∋",Sum:"∑",Sup:"⋑",Superset:"⊃",SupersetEqual:"⊇",Supset:"⋑",THORN:"Þ",TRADE:"™",TSHcy:"Ћ",TScy:"Ц",Tab:"\u0009",Tau:"Τ",Tcaron:"Ť",Tcedil:"Ţ",Tcy:"Т",Tfr:"𝔗",Therefore:"∴",Theta:"Θ",ThickSpace:"  ",ThinSpace:" ",Tilde:"∼",TildeEqual:"≃",TildeFullEqual:"≅",TildeTilde:"≈",Topf:"𝕋",TripleDot:"⃛",Tscr:"𝒯",Tstrok:"Ŧ",Uacute:"Ú",Uarr:"↟",Uarrocir:"⥉",Ubrcy:"Ў",Ubreve:"Ŭ",Ucirc:"Û",Ucy:"У",Udblac:"Ű",Ufr:"𝔘",Ugrave:"Ù",Umacr:"Ū",UnderBar:"_",UnderBrace:"⏟",UnderBracket:"⎵",UnderParenthesis:"⏝",Union:"⋃",UnionPlus:"⊎",Uogon:"Ų",Uopf:"𝕌",UpArrow:"↑",UpArrowBar:"⤒",UpArrowDownArrow:"⇅",UpDownArrow:"↕",UpEquilibrium:"⥮",UpTee:"⊥",UpTeeArrow:"↥",Uparrow:"⇑",Updownarrow:"⇕",UpperLeftArrow:"↖",UpperRightArrow:"↗",Upsi:"ϒ",Upsilon:"Υ",Uring:"Ů",Uscr:"𝒰",Utilde:"Ũ",Uuml:"Ü",VDash:"⊫",Vbar:"⫫",Vcy:"В",Vdash:"⊩",Vdashl:"⫦",Vee:"⋁",Verbar:"‖",Vert:"‖",VerticalBar:"∣",VerticalLine:"|",VerticalSeparator:"❘",VerticalTilde:"≀",VeryThinSpace:" ",Vfr:"𝔙",Vopf:"𝕍",Vscr:"𝒱",Vvdash:"⊪",Wcirc:"Ŵ",Wedge:"⋀",Wfr:"𝔚",Wopf:"𝕎",Wscr:"𝒲",Xfr:"𝔛",Xi:"Ξ",Xopf:"𝕏",Xscr:"𝒳",YAcy:"Я",YIcy:"Ї",YUcy:"Ю",Yacute:"Ý",Ycirc:"Ŷ",Ycy:"Ы",Yfr:"𝔜",Yopf:"𝕐",Yscr:"𝒴",Yuml:"Ÿ",ZHcy:"Ж",Zacute:"Ź",Zcaron:"Ž",Zcy:"З",Zdot:"Ż",ZeroWidthSpace:"\u200b",Zeta:"Ζ",Zfr:"ℨ",Zopf:"ℤ",Zscr:"𝒵",aacute:"á",abreve:"ă",ac:"∾",acE:"∾̳",acd:"∿",acirc:"â",acute:"´",acy:"а",aelig:"æ",af:"\u2061",afr:"𝔞",agrave:"à",alefsym:"ℵ",aleph:"ℵ",alpha:"α",amacr:"ā",amalg:"⨿",amp:"&",and:"∧",andand:"⩕",andd:"⩜",andslope:"⩘",andv:"⩚",ang:"∠",ange:"⦤",angle:"∠",angmsd:"∡",angmsdaa:"⦨",angmsdab:"⦩",angmsdac:"⦪",angmsdad:"⦫",angmsdae:"⦬",angmsdaf:"⦭",angmsdag:"⦮",angmsdah:"⦯",angrt:"∟",angrtvb:"⊾",angrtvbd:"⦝",angsph:"∢",angst:"Å",angzarr:"⍼",aogon:"ą",aopf:"𝕒",ap:"≈",apE:"⩰",apacir:"⩯",ape:"≊",apid:"≋",apos:"'",approx:"≈",approxeq:"≊",aring:"å",ascr:"𝒶",ast:"*",asymp:"≈",asympeq:"≍",atilde:"ã",auml:"ä",awconint:"∳",awint:"⨑",bNot:"⫭",backcong:"≌",backepsilon:"϶",backprime:"‵",backsim:"∽",backsimeq:"⋍",barvee:"⊽",barwed:"⌅",barwedge:"⌅",bbrk:"⎵",bbrktbrk:"⎶",bcong:"≌",bcy:"б",bdquo:"„",becaus:"∵",because:"∵",bemptyv:"⦰",bepsi:"϶",bernou:"ℬ",beta:"β",beth:"ℶ",between:"≬",bfr:"𝔟",bigcap:"⋂",bigcirc:"◯",bigcup:"⋃",bigodot:"⨀",bigoplus:"⨁",bigotimes:"⨂",bigsqcup:"⨆",bigstar:"★",bigtriangledown:"▽",bigtriangleup:"△",biguplus:"⨄",bigvee:"⋁",bigwedge:"⋀",bkarow:"⤍",blacklozenge:"⧫",blacksquare:"▪",blacktriangle:"▴",blacktriangledown:"▾",blacktriangleleft:"◂",blacktriangleright:"▸",blank:"␣",blk12:"▒",blk14:"░",blk34:"▓",block:"█",bne:"=⃥",bnequiv:"≡⃥",bnot:"⌐",bopf:"𝕓",bot:"⊥",bottom:"⊥",bowtie:"⋈",boxDL:"╗",boxDR:"╔",boxDl:"╖",boxDr:"╓",boxH:"═",boxHD:"╦",boxHU:"╩",boxHd:"╤",boxHu:"╧",boxUL:"╝",boxUR:"╚",boxUl:"╜",boxUr:"╙",boxV:"║",boxVH:"╬",boxVL:"╣",boxVR:"╠",boxVh:"╫",boxVl:"╢",boxVr:"╟",boxbox:"⧉",boxdL:"╕",boxdR:"╒",boxdl:"┐",boxdr:"┌",boxh:"─",boxhD:"╥",boxhU:"╨",boxhd:"┬",boxhu:"┴",boxminus:"⊟",boxplus:"⊞",boxtimes:"⊠",boxuL:"╛",boxuR:"╘",boxul:"┘",boxur:"└",boxv:"│",boxvH:"╪",boxvL:"╡",boxvR:"╞",boxvh:"┼",boxvl:"┤",boxvr:"├",bprime:"‵",breve:"˘",brvbar:"¦",bscr:"𝒷",bsemi:"⁏",bsim:"∽",bsime:"⋍",bsol:"\\",bsolb:"⧅",bsolhsub:"⟈",bull:"•",bullet:"•",bump:"≎",bumpE:"⪮",bumpe:"≏",bumpeq:"≏",cacute:"ć",cap:"∩",capand:"⩄",capbrcup:"⩉",capcap:"⩋",capcup:"⩇",capdot:"⩀",caps:"∩\ufe00",caret:"⁁",caron:"ˇ",ccaps:"⩍",ccaron:"č",ccedil:"ç",ccirc:"ĉ",ccups:"⩌",ccupssm:"⩐",cdot:"ċ",cedil:"¸",cemptyv:"⦲",cent:"¢",centerdot:"·",cfr:"𝔠",chcy:"ч",check:"✓",checkmark:"✓",chi:"χ",cir:"○",cirE:"⧃",circ:"ˆ",circeq:"≗",circlearrowleft:"↺",circlearrowright:"↻",circledR:"®",circledS:"Ⓢ",circledast:"⊛",circledcirc:"⊚",circleddash:"⊝",cire:"≗",cirfnint:"⨐",cirmid:"⫯",cirscir:"⧂",clubs:"♣",clubsuit:"♣",colon:":",colone:"≔",coloneq:"≔",comma:",",commat:"@",comp:"∁",compfn:"∘",complement:"∁",complexes:"ℂ",cong:"≅",congdot:"⩭",conint:"∮",copf:"𝕔",coprod:"∐",copy:"©",copysr:"℗",crarr:"↵",cross:"✗",cscr:"𝒸",csub:"⫏",csube:"⫑",csup:"⫐",csupe:"⫒",ctdot:"⋯",cudarrl:"⤸",cudarrr:"⤵",cuepr:"⋞",cuesc:"⋟",cularr:"↶",cularrp:"⤽",cup:"∪",cupbrcap:"⩈",cupcap:"⩆",cupcup:"⩊",cupdot:"⊍",cupor:"⩅",cups:"∪\ufe00",curarr:"↷",curarrm:"⤼",curlyeqprec:"⋞",curlyeqsucc:"⋟",curlyvee:"⋎",curlywedge:"⋏",curren:"¤",curvearrowleft:"↶",curvearrowright:"↷",cuvee:"⋎",cuwed:"⋏",cwconint:"∲",cwint:"∱",cylcty:"⌭",dArr:"⇓",dHar:"⥥",dagger:"†",daleth:"ℸ",darr:"↓",dash:"‐",dashv:"⊣",dbkarow:"⤏",dblac:"˝",dcaron:"ď",dcy:"д",dd:"ⅆ",ddagger:"‡",ddarr:"⇊",ddotseq:"⩷",deg:"°",delta:"δ",demptyv:"⦱",dfisht:"⥿",dfr:"𝔡",dharl:"⇃",dharr:"⇂",diam:"⋄",diamond:"⋄",diamondsuit:"♦",diams:"♦",die:"¨",digamma:"ϝ",disin:"⋲",div:"÷",divide:"÷",divideontimes:"⋇",divonx:"⋇",djcy:"ђ",dlcorn:"⌞",dlcrop:"⌍",dollar:"$",dopf:"𝕕",dot:"˙",doteq:"≐",doteqdot:"≑",dotminus:"∸",dotplus:"∔",dotsquare:"⊡",doublebarwedge:"⌆",downarrow:"↓",downdownarrows:"⇊",downharpoonleft:"⇃",downharpoonright:"⇂",drbkarow:"⤐",drcorn:"⌟",drcrop:"⌌",dscr:"𝒹",dscy:"ѕ",dsol:"⧶",dstrok:"đ",dtdot:"⋱",dtri:"▿",dtrif:"▾",duarr:"⇵",duhar:"⥯",dwangle:"⦦",dzcy:"џ",dzigrarr:"⟿",eDDot:"⩷",eDot:"≑",eacute:"é",easter:"⩮",ecaron:"ě",ecir:"≖",ecirc:"ê",ecolon:"≕",ecy:"э",edot:"ė",ee:"ⅇ",efDot:"≒",efr:"𝔢",eg:"⪚",egrave:"è",egs:"⪖",egsdot:"⪘",el:"⪙",elinters:"⏧",ell:"ℓ",els:"⪕",elsdot:"⪗",emacr:"ē",empty:"∅",emptyset:"∅",emptyv:"∅",emsp:" ",emsp13:" ",emsp14:" ",eng:"ŋ",ensp:" ",eogon:"ę",eopf:"𝕖",epar:"⋕",eparsl:"⧣",eplus:"⩱",epsi:"ε",epsilon:"ε",epsiv:"ϵ",eqcirc:"≖",eqcolon:"≕",eqsim:"≂",eqslantgtr:"⪖",eqslantless:"⪕",equals:"=",equest:"≟",equiv:"≡",equivDD:"⩸",eqvparsl:"⧥",erDot:"≓",erarr:"⥱",escr:"ℯ",esdot:"≐",esim:"≂",eta:"η",eth:"ð",euml:"ë",euro:"€",excl:"!",exist:"∃",expectation:"ℰ",exponentiale:"ⅇ",fallingdotseq:"≒",fcy:"ф",female:"♀",ffilig:"ﬃ",fflig:"ﬀ",ffllig:"ﬄ",ffr:"𝔣",filig:"ﬁ",fjlig:"fj",flat:"♭",fllig:"ﬂ",fltns:"▱",fnof:"ƒ",fopf:"𝕗",forall:"∀",fork:"⋔",forkv:"⫙",fpartint:"⨍",frac12:"½",frac13:"⅓",frac14:"¼",frac15:"⅕",frac16:"⅙",frac18:"⅛",frac23:"⅔",frac25:"⅖",frac34:"¾",frac35:"⅗",frac38:"⅜",frac45:"⅘",frac56:"⅚",frac58:"⅝",frac78:"⅞",frasl:"⁄",frown:"⌢",fscr:"𝒻",gE:"≧",gEl:"⪌",gacute:"ǵ",gamma:"γ",gammad:"ϝ",gap:"⪆",gbreve:"ğ",gcirc:"ĝ",gcy:"г",gdot:"ġ",ge:"≥",gel:"⋛",geq:"≥",geqq:"≧",geqslant:"⩾",ges:"⩾",gescc:"⪩",gesdot:"⪀",gesdoto:"⪂",gesdotol:"⪄",gesl:"⋛\ufe00",gesles:"⪔",gfr:"𝔤",gg:"≫",ggg:"⋙",gimel:"ℷ",gjcy:"ѓ",gl:"≷",glE:"⪒",gla:"⪥",glj:"⪤",gnE:"≩",gnap:"⪊",gnapprox:"⪊",gne:"⪈",gneq:"⪈",gneqq:"≩",gnsim:"⋧",gopf:"𝕘",grave:"`",gscr:"ℊ",gsim:"≳",gsime:"⪎",gsiml:"⪐",gt:">",gtcc:"⪧",gtcir:"⩺",gtdot:"⋗",gtlPar:"⦕",gtquest:"⩼",gtrapprox:"⪆",gtrarr:"⥸",gtrdot:"⋗",gtreqless:"⋛",gtreqqless:"⪌",gtrless:"≷",gtrsim:"≳",gvertneqq:"≩\ufe00",gvnE:"≩\ufe00",hArr:"⇔",hairsp:" ",half:"½",hamilt:"ℋ",hardcy:"ъ",harr:"↔",harrcir:"⥈",harrw:"↭",hbar:"ℏ",hcirc:"ĥ",hearts:"♥",heartsuit:"♥",hellip:"…",hercon:"⊹",hfr:"𝔥",hksearow:"⤥",hkswarow:"⤦",hoarr:"⇿",homtht:"∻",hookleftarrow:"↩",hookrightarrow:"↪",hopf:"𝕙",horbar:"―",hscr:"𝒽",hslash:"ℏ",hstrok:"ħ",hybull:"⁃",hyphen:"‐",iacute:"í",ic:"\u2063",icirc:"î",icy:"и",iecy:"е",iexcl:"¡",iff:"⇔",ifr:"𝔦",igrave:"ì",ii:"ⅈ",iiiint:"⨌",iiint:"∭",iinfin:"⧜",iiota:"℩",ijlig:"ĳ",imacr:"ī",image:"ℑ",imagline:"ℐ",imagpart:"ℑ",imath:"ı",imof:"⊷",imped:"Ƶ",in:"∈",incare:"℅",infin:"∞",infintie:"⧝",inodot:"ı",int:"∫",intcal:"⊺",integers:"ℤ",intercal:"⊺",intlarhk:"⨗",intprod:"⨼",iocy:"ё",iogon:"į",iopf:"𝕚",iota:"ι",iprod:"⨼",iquest:"¿",iscr:"𝒾",isin:"∈",isinE:"⋹",isindot:"⋵",isins:"⋴",isinsv:"⋳",isinv:"∈",it:"\u2062",itilde:"ĩ",iukcy:"і",iuml:"ï",jcirc:"ĵ",jcy:"й",jfr:"𝔧",jmath:"ȷ",jopf:"𝕛",jscr:"𝒿",jsercy:"ј",jukcy:"є",kappa:"κ",kappav:"ϰ",kcedil:"ķ",kcy:"к",kfr:"𝔨",kgreen:"ĸ",khcy:"х",kjcy:"ќ",kopf:"𝕜",kscr:"𝓀",lAarr:"⇚",lArr:"⇐",lAtail:"⤛",lBarr:"⤎",lE:"≦",lEg:"⪋",lHar:"⥢",lacute:"ĺ",laemptyv:"⦴",lagran:"ℒ",lambda:"λ",lang:"⟨",langd:"⦑",langle:"⟨",lap:"⪅",laquo:"«",larr:"←",larrb:"⇤",larrbfs:"⤟",larrfs:"⤝",larrhk:"↩",larrlp:"↫",larrpl:"⤹",larrsim:"⥳",larrtl:"↢",lat:"⪫",latail:"⤙",late:"⪭",lates:"⪭\ufe00",lbarr:"⤌",lbbrk:"❲",lbrace:"{",lbrack:"[",lbrke:"⦋",lbrksld:"⦏",lbrkslu:"⦍",lcaron:"ľ",lcedil:"ļ",lceil:"⌈",lcub:"{",lcy:"л",ldca:"⤶",ldquo:"“",ldquor:"„",ldrdhar:"⥧",ldrushar:"⥋",ldsh:"↲",le:"≤",leftarrow:"←",leftarrowtail:"↢",leftharpoondown:"↽",leftharpoonup:"↼",leftleftarrows:"⇇",leftrightarrow:"↔",leftrightarrows:"⇆",leftrightharpoons:"⇋",leftrightsquigarrow:"↭",leftthreetimes:"⋋",leg:"⋚",leq:"≤",leqq:"≦",leqslant:"⩽",les:"⩽",lescc:"⪨",lesdot:"⩿",lesdoto:"⪁",lesdotor:"⪃",lesg:"⋚\ufe00",lesges:"⪓",lessapprox:"⪅",lessdot:"⋖",lesseqgtr:"⋚",lesseqqgtr:"⪋",lessgtr:"≶",lesssim:"≲",lfisht:"⥼",lfloor:"⌊",lfr:"𝔩",lg:"≶",lgE:"⪑",lhard:"↽",lharu:"↼",lharul:"⥪",lhblk:"▄",ljcy:"љ",ll:"≪",llarr:"⇇",llcorner:"⌞",llhard:"⥫",lltri:"◺",lmidot:"ŀ",lmoust:"⎰",lmoustache:"⎰",lnE:"≨",lnap:"⪉",lnapprox:"⪉",lne:"⪇",lneq:"⪇",lneqq:"≨",lnsim:"⋦",loang:"⟬",loarr:"⇽",lobrk:"⟦",longleftarrow:"⟵",longleftrightarrow:"⟷",longmapsto:"⟼",longrightarrow:"⟶",looparrowleft:"↫",looparrowright:"↬",lopar:"⦅",lopf:"𝕝",loplus:"⨭",lotimes:"⨴",lowast:"∗",lowbar:"_",loz:"◊",lozenge:"◊",lozf:"⧫",lpar:"(",lparlt:"⦓",lrarr:"⇆",lrcorner:"⌟",lrhar:"⇋",lrhard:"⥭",lrm:"\u200e",lrtri:"⊿",lsaquo:"‹",lscr:"𝓁",lsh:"↰",lsim:"≲",lsime:"⪍",lsimg:"⪏",lsqb:"[",lsquo:"‘",lsquor:"‚",lstrok:"ł",lt:"<",ltcc:"⪦",ltcir:"⩹",ltdot:"⋖",lthree:"⋋",ltimes:"⋉",ltlarr:"⥶",ltquest:"⩻",ltrPar:"⦖",ltri:"◃",ltrie:"⊴",ltrif:"◂",lurdshar:"⥊",luruhar:"⥦",lvertneqq:"≨\ufe00",lvnE:"≨\ufe00",mDDot:"∺",macr:"¯",male:"♂",malt:"✠",maltese:"✠",map:"↦",mapsto:"↦",mapstodown:"↧",mapstoleft:"↤",mapstoup:"↥",marker:"▮",mcomma:"⨩",mcy:"м",mdash:"—",measuredangle:"∡",mfr:"𝔪",mho:"℧",micro:"µ",mid:"∣",midast:"*",midcir:"⫰",middot:"·",minus:"−",minusb:"⊟",minusd:"∸",minusdu:"⨪",mlcp:"⫛",mldr:"…",mnplus:"∓",models:"⊧",mopf:"𝕞",mp:"∓",mscr:"𝓂",mstpos:"∾",mu:"μ",multimap:"⊸",mumap:"⊸",nGg:"⋙̸",nGt:"≫⃒",nGtv:"≫̸",nLeftarrow:"⇍",nLeftrightarrow:"⇎",nLl:"⋘̸",nLt:"≪⃒",nLtv:"≪̸",nRightarrow:"⇏",nVDash:"⊯",nVdash:"⊮",nabla:"∇",nacute:"ń",nang:"∠⃒",nap:"≉",napE:"⩰̸",napid:"≋̸",napos:"ŉ",napprox:"≉",natur:"♮",natural:"♮",naturals:"ℕ",nbsp:"\u00a0",nbump:"≎̸",nbumpe:"≏̸",ncap:"⩃",ncaron:"ň",ncedil:"ņ",ncong:"≇",ncongdot:"⩭̸",ncup:"⩂",ncy:"н",ndash:"–",ne:"≠",neArr:"⇗",nearhk:"⤤",nearr:"↗",nearrow:"↗",nedot:"≐̸",nequiv:"≢",nesear:"⤨",nesim:"≂̸",nexist:"∄",nexists:"∄",nfr:"𝔫",ngE:"≧̸",nge:"≱",ngeq:"≱",ngeqq:"≧̸",ngeqslant:"⩾̸",nges:"⩾̸",ngsim:"≵",ngt:"≯",ngtr:"≯",nhArr:"⇎",nharr:"↮",nhpar:"⫲",ni:"∋",nis:"⋼",nisd:"⋺",niv:"∋",njcy:"њ",nlArr:"⇍",nlE:"≦̸",nlarr:"↚",nldr:"‥",nle:"≰",nleftarrow:"↚",nleftrightarrow:"↮",nleq:"≰",nleqq:"≦̸",nleqslant:"⩽̸",nles:"⩽̸",nless:"≮",nlsim:"≴",nlt:"≮",nltri:"⋪",nltrie:"⋬",nmid:"∤",nopf:"𝕟",not:"¬",notin:"∉",notinE:"⋹̸",notindot:"⋵̸",notinva:"∉",notinvb:"⋷",notinvc:"⋶",notni:"∌",notniva:"∌",notnivb:"⋾",notnivc:"⋽",npar:"∦",nparallel:"∦",nparsl:"⫽⃥",npart:"∂̸",npolint:"⨔",npr:"⊀",nprcue:"⋠",npre:"⪯̸",nprec:"⊀",npreceq:"⪯̸",nrArr:"⇏",nrarr:"↛",nrarrc:"⤳̸",nrarrw:"↝̸",nrightarrow:"↛",nrtri:"⋫",nrtrie:"⋭",nsc:"⊁",nsccue:"⋡",nsce:"⪰̸",nscr:"𝓃",nshortmid:"∤",nshortparallel:"∦",nsim:"≁",nsime:"≄",nsimeq:"≄",nsmid:"∤",nspar:"∦",nsqsube:"⋢",nsqsupe:"⋣",nsub:"⊄",nsubE:"⫅̸",nsube:"⊈",nsubset:"⊂⃒",nsubseteq:"⊈",nsubseteqq:"⫅̸",nsucc:"⊁",nsucceq:"⪰̸",nsup:"⊅",nsupE:"⫆̸",nsupe:"⊉",nsupset:"⊃⃒",nsupseteq:"⊉",nsupseteqq:"⫆̸",ntgl:"≹",ntilde:"ñ",ntlg:"≸",ntriangleleft:"⋪",ntrianglelefteq:"⋬",ntriangleright:"⋫",ntrianglerighteq:"⋭",nu:"ν",num:"#",numero:"№",numsp:" ",nvDash:"⊭",nvHarr:"⤄",nvap:"≍⃒",nvdash:"⊬",nvge:"≥⃒",nvgt:">⃒",nvinfin:"⧞",nvlArr:"⤂",nvle:"≤⃒",nvlt:"<⃒",nvltrie:"⊴⃒",nvrArr:"⤃",nvrtrie:"⊵⃒",nvsim:"∼⃒",nwArr:"⇖",nwarhk:"⤣",nwarr:"↖",nwarrow:"↖",nwnear:"⤧",oS:"Ⓢ",oacute:"ó",oast:"⊛",ocir:"⊚",ocirc:"ô",ocy:"о",odash:"⊝",odblac:"ő",odiv:"⨸",odot:"⊙",odsold:"⦼",oelig:"œ",ofcir:"⦿",ofr:"𝔬",ogon:"˛",ograve:"ò",ogt:"⧁",ohbar:"⦵",ohm:"Ω",oint:"∮",olarr:"↺",olcir:"⦾",olcross:"⦻",oline:"‾",olt:"⧀",omacr:"ō",omega:"ω",omicron:"ο",omid:"⦶",ominus:"⊖",oopf:"𝕠",opar:"⦷",operp:"⦹",oplus:"⊕",or:"∨",orarr:"↻",ord:"⩝",order:"ℴ",orderof:"ℴ",ordf:"ª",ordm:"º",origof:"⊶",oror:"⩖",orslope:"⩗",orv:"⩛",oscr:"ℴ",oslash:"ø",osol:"⊘",otilde:"õ",otimes:"⊗",otimesas:"⨶",ouml:"ö",ovbar:"⌽",par:"∥",para:"¶",parallel:"∥",parsim:"⫳",parsl:"⫽",part:"∂",pcy:"п",percnt:"%",period:".",permil:"‰",perp:"⊥",pertenk:"‱",pfr:"𝔭",phi:"φ",phiv:"ϕ",phmmat:"ℳ",phone:"☎",pi:"π",pitchfork:"⋔",piv:"ϖ",planck:"ℏ",planckh:"ℎ",plankv:"ℏ",plus:"+",plusacir:"⨣",plusb:"⊞",pluscir:"⨢",plusdo:"∔",plusdu:"⨥",pluse:"⩲",plusmn:"±",plussim:"⨦",plustwo:"⨧",pm:"±",pointint:"⨕",popf:"𝕡",pound:"£",pr:"≺",prE:"⪳",prap:"⪷",prcue:"≼",pre:"⪯",prec:"≺",precapprox:"⪷",preccurlyeq:"≼",preceq:"⪯",precnapprox:"⪹",precneqq:"⪵",precnsim:"⋨",precsim:"≾",prime:"′",primes:"ℙ",prnE:"⪵",prnap:"⪹",prnsim:"⋨",prod:"∏",profalar:"⌮",profline:"⌒",profsurf:"⌓",prop:"∝",propto:"∝",prsim:"≾",prurel:"⊰",pscr:"𝓅",psi:"ψ",puncsp:" ",qfr:"𝔮",qint:"⨌",qopf:"𝕢",qprime:"⁗",qscr:"𝓆",quaternions:"ℍ",quatint:"⨖",quest:"?",questeq:"≟",quot:"\"",rAarr:"⇛",rArr:"⇒",rAtail:"⤜",rBarr:"⤏",rHar:"⥤",race:"∽̱",racute:"ŕ",radic:"√",raemptyv:"⦳",rang:"⟩",rangd:"⦒",range:"⦥",rangle:"⟩",raquo:"»",rarr:"→",rarrap:"⥵",rarrb:"⇥",rarrbfs:"⤠",rarrc:"⤳",rarrfs:"⤞",rarrhk:"↪",rarrlp:"↬",rarrpl:"⥅",rarrsim:"⥴",rarrtl:"↣",rarrw:"↝",ratail:"⤚",ratio:"∶",rationals:"ℚ",rbarr:"⤍",rbbrk:"❳",rbrace:"}",rbrack:"]",rbrke:"⦌",rbrksld:"⦎",rbrkslu:"⦐",rcaron:"ř",rcedil:"ŗ",rceil:"⌉",rcub:"}",rcy:"р",rdca:"⤷",rdldhar:"⥩",rdquo:"”",rdquor:"”",rdsh:"↳",real:"ℜ",realine:"ℛ",realpart:"ℜ",reals:"ℝ",rect:"▭",reg:"®",rfisht:"⥽",rfloor:"⌋",rfr:"𝔯",rhard:"⇁",rharu:"⇀",rharul:"⥬",rho:"ρ",rhov:"ϱ",rightarrow:"→",rightarrowtail:"↣",rightharpoondown:"⇁",rightharpoonup:"⇀",rightleftarrows:"⇄",rightleftharpoons:"⇌",rightrightarrows:"⇉",rightsquigarrow:"↝",rightthreetimes:"⋌",ring:"˚",risingdotseq:"≓",rlarr:"⇄",rlhar:"⇌",rlm:"\u200f",rmoust:"⎱",rmoustache:"⎱",rnmid:"⫮",roang:"⟭",roarr:"⇾",robrk:"⟧",ropar:"⦆",ropf:"𝕣",roplus:"⨮",rotimes:"⨵",rpar:")",rpargt:"⦔",rppolint:"⨒",rrarr:"⇉",rsaquo:"›",rscr:"𝓇",rsh:"↱",rsqb:"]",rsquo:"’",rsquor:"’",rthree:"⋌",rtimes:"⋊",rtri:"▹",rtrie:"⊵",rtrif:"▸",rtriltri:"⧎",ruluhar:"⥨",rx:"℞",sacute:"ś",sbquo:"‚",sc:"≻",scE:"⪴",scap:"⪸",scaron:"š",sccue:"≽",sce:"⪰",scedil:"ş",scirc:"ŝ",scnE:"⪶",scnap:"⪺",scnsim:"⋩",scpolint:"⨓",scsim:"≿",scy:"с",sdot:"⋅",sdotb:"⊡",sdote:"⩦",seArr:"⇘",searhk:"⤥",searr:"↘",searrow:"↘",sect:"§",semi:";",seswar:"⤩",setminus:"∖",setmn:"∖",sext:"✶",sfr:"𝔰",sfrown:"⌢",sharp:"♯",shchcy:"щ",shcy:"ш",shortmid:"∣",shortparallel:"∥",shy:"\u00ad",sigma:"σ",sigmaf:"ς",sigmav:"ς",sim:"∼",simdot:"⩪",sime:"≃",simeq:"≃",simg:"⪞",simgE:"⪠",siml:"⪝",simlE:"⪟",simne:"≆",simplus:"⨤",simrarr:"⥲",slarr:"←",smallsetminus:"∖",smashp:"⨳",smeparsl:"⧤",smid:"∣",smile:"⌣",smt:"⪪",smte:"⪬",smtes:"⪬\ufe00",softcy:"ь",sol:"/",solb:"⧄",solbar:"⌿",sopf:"𝕤",spades:"♠",spadesuit:"♠",spar:"∥",sqcap:"⊓",sqcaps:"⊓\ufe00",sqcup:"⊔",sqcups:"⊔\ufe00",sqsub:"⊏",sqsube:"⊑",sqsubset:"⊏",sqsubseteq:"⊑",sqsup:"⊐",sqsupe:"⊒",sqsupset:"⊐",sqsupseteq:"⊒",squ:"□",square:"□",squarf:"▪",squf:"▪",srarr:"→",sscr:"𝓈",ssetmn:"∖",ssmile:"⌣",sstarf:"⋆",star:"☆",starf:"★",straightepsilon:"ϵ",straightphi:"ϕ",strns:"¯",sub:"⊂",subE:"⫅",subdot:"⪽",sube:"⊆",subedot:"⫃",submult:"⫁",subnE:"⫋",subne:"⊊",subplus:"⪿",subrarr:"⥹",subset:"⊂",subseteq:"⊆",subseteqq:"⫅",subsetneq:"⊊",subsetneqq:"⫋",subsim:"⫇",subsub:"⫕",subsup:"⫓",succ:"≻",succapprox:"⪸",succcurlyeq:"≽",succeq:"⪰",succnapprox:"⪺",succneqq:"⪶",succnsim:"⋩",succsim:"≿",sum:"∑",sung:"♪",sup:"⊃",sup1:"¹",sup2:"²",sup3:"³",supE:"⫆",supdot:"⪾",supdsub:"⫘",supe:"⊇",supedot:"⫄",suphsol:"⟉",suphsub:"⫗",suplarr:"⥻",supmult:"⫂",supnE:"⫌",supne:"⊋",supplus:"⫀",supset:"⊃",supseteq:"⊇",supseteqq:"⫆",supsetneq:"⊋",supsetneqq:"⫌",supsim:"⫈",supsub:"⫔",supsup:"⫖",swArr:"⇙",swarhk:"⤦",swarr:"↙",swarrow:"↙",swnwar:"⤪",szlig:"ß",target:"⌖",tau:"τ",tbrk:"⎴",tcaron:"ť",tcedil:"ţ",tcy:"т",tdot:"⃛",telrec:"⌕",tfr:"𝔱",there4:"∴",therefore:"∴",theta:"θ",thetasym:"ϑ",thetav:"ϑ",thickapprox:"≈",thicksim:"∼",thinsp:" ",thkap:"≈",thksim:"∼",thorn:"þ",tilde:"˜",times:"×",timesb:"⊠",timesbar:"⨱",timesd:"⨰",tint:"∭",toea:"⤨",top:"⊤",topbot:"⌶",topcir:"⫱",topf:"𝕥",topfork:"⫚",tosa:"⤩",tprime:"‴",trade:"™",triangle:"▵",triangledown:"▿",triangleleft:"◃",trianglelefteq:"⊴",triangleq:"≜",triangleright:"▹",trianglerighteq:"⊵",tridot:"◬",trie:"≜",triminus:"⨺",triplus:"⨹",trisb:"⧍",tritime:"⨻",trpezium:"⏢",tscr:"𝓉",tscy:"ц",tshcy:"ћ",tstrok:"ŧ",twixt:"≬",twoheadleftarrow:"↞",twoheadrightarrow:"↠",uArr:"⇑",uHar:"⥣",uacute:"ú",uarr:"↑",ubrcy:"ў",ubreve:"ŭ",ucirc:"û",ucy:"у",udarr:"⇅",udblac:"ű",udhar:"⥮",ufisht:"⥾",ufr:"𝔲",ugrave:"ù",uharl:"↿",uharr:"↾",uhblk:"▀",ulcorn:"⌜",ulcorner:"⌜",ulcrop:"⌏",ultri:"◸",umacr:"ū",uml:"¨",uogon:"ų",uopf:"𝕦",uparrow:"↑",updownarrow:"↕",upharpoonleft:"↿",upharpoonright:"↾",uplus:"⊎",upsi:"υ",upsih:"ϒ",upsilon:"υ",upuparrows:"⇈",urcorn:"⌝",urcorner:"⌝",urcrop:"⌎",uring:"ů",urtri:"◹",uscr:"𝓊",utdot:"⋰",utilde:"ũ",utri:"▵",utrif:"▴",uuarr:"⇈",uuml:"ü",uwangle:"⦧",vArr:"⇕",vBar:"⫨",vBarv:"⫩",vDash:"⊨",vangrt:"⦜",varepsilon:"ϵ",varkappa:"ϰ",varnothing:"∅",varphi:"ϕ",varpi:"ϖ",varpropto:"∝",varr:"↕",varrho:"ϱ",varsigma:"ς",varsubsetneq:"⊊\ufe00",varsubsetneqq:"⫋\ufe00",varsupsetneq:"⊋\ufe00",varsupsetneqq:"⫌\ufe00",vartheta:"ϑ",vartriangleleft:"⊲",vartriangleright:"⊳",vcy:"в",vdash:"⊢",vee:"∨",veebar:"⊻",veeeq:"≚",vellip:"⋮",verbar:"|",vert:"|",vfr:"𝔳",vltri:"⊲",vnsub:"⊂⃒",vnsup:"⊃⃒",vopf:"𝕧",vprop:"∝",vrtri:"⊳",vscr:"𝓋",vsubnE:"⫋\ufe00",vsubne:"⊊\ufe00",vsupnE:"⫌\ufe00",vsupne:"⊋\ufe00",vzigzag:"⦚",wcirc:"ŵ",wedbar:"⩟",wedge:"∧",wedgeq:"≙",weierp:"℘",wfr:"𝔴",wopf:"𝕨",wp:"℘",wr:"≀",wreath:"≀",wscr:"𝓌",xcap:"⋂",xcirc:"◯",xcup:"⋃",xdtri:"▽",xfr:"𝔵",xhArr:"⟺",xharr:"⟷",xi:"ξ",xlArr:"⟸",xlarr:"⟵",xmap:"⟼",xnis:"⋻",xodot:"⨀",xopf:"𝕩",xoplus:"⨁",xotime:"⨂",xrArr:"⟹",xrarr:"⟶",xscr:"𝓍",xsqcup:"⨆",xuplus:"⨄",xutri:"△",xvee:"⋁",xwedge:"⋀",yacute:"ý",yacy:"я",ycirc:"ŷ",ycy:"ы",yen:"¥",yfr:"𝔶",yicy:"ї",yopf:"𝕪",yscr:"𝓎",yucy:"ю",yuml:"ÿ",zacute:"ź",zcaron:"ž",zcy:"з",zdot:"ż",zeetrf:"ℨ",zeta:"ζ",zfr:"𝔷",zhcy:"ж",zigrarr:"⇝",zopf:"𝕫",zscr:"𝓏",zwj:"\u200d",zwnj:"\u200c"};
const LEGACY_ENTITIES = new Set("AElig AMP Aacute Acirc Agrave Aring Atilde Auml COPY Ccedil ETH Eacute Ecirc Egrave Euml GT Iacute Icirc Igrave Iuml LT Ntilde Oacute Ocirc Ograve Oslash Otilde Ouml QUOT REG THORN Uacute Ucirc Ugrave Uuml Yacute aacute acirc acute aelig agrave amp aring atilde auml brvbar ccedil cedil cent copy curren deg divide eacute ecirc egrave eth euml frac12 frac14 frac34 gt iacute icirc iexcl igrave iquest iuml laquo lt macr micro middot nbsp not ntilde oacute ocirc ograve ordf ordm oslash otilde ouml para plusmn pound quot raquo reg sect shy sup1 sup2 sup3 szlig thorn times uacute ucirc ugrave uml uuml yacute yen yuml".split(" "));
const ATTRIBUTE = /\s*([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/y;
// Numeric references to C1 controls mean the windows-1252 characters at those bytes.
const C1_REFERENCES = { 0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021, 0x88: 0x2c6, 0x89: 0x2030, 0x8a: 0x160, 0x8b: 0x2039, 0x8c: 0x152, 0x8e: 0x17d, 0x91: 0x2018, 0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x2dc, 0x99: 0x2122, 0x9a: 0x161, 0x9b: 0x203a, 0x9c: 0x153, 0x9e: 0x17e, 0x9f: 0x178 };

// Character references as the HTML tokenizer reads them: numeric ones with or without the
// semicolon, named ones by the longest name, and the legacy names without a semicolon,
// except in an attribute value where the next character is "=" or alphanumeric.
function decodeEntities(text, inAttribute = false) {
  if (!text.includes("&")) return text;
  return text.replace(/&(?:#([xX][0-9a-fA-F]+|[0-9]+);?|([a-zA-Z][a-zA-Z0-9]*;?))/g, (whole, number, name, at) => {
    if (number !== undefined) {
      let code = number[0] === "x" || number[0] === "X" ? parseInt(number.slice(1), 16) : parseInt(number, 10);
      if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || !Number.isFinite(code)) code = 0xfffd;
      return String.fromCodePoint(C1_REFERENCES[code] ?? code);
    }
    if (name.endsWith(";") && Object.hasOwn(ENTITIES, name.slice(0, -1))) return ENTITIES[name.slice(0, -1)];
    for (let length = Math.min(name.length, 6); length >= 2; length--) {
      const prefix = name.slice(0, length);
      if (!LEGACY_ENTITIES.has(prefix)) continue;
      const next = text[at + 1 + length];
      if (inAttribute && next !== undefined && /[=a-zA-Z0-9]/.test(next)) return whole;
      return ENTITIES[prefix] + name.slice(length);
    }
    return whole;
  });
}

// The HTML fragment serialization algorithm's escaping, in text and attribute modes.
const escapeText = (text) => text.replace(/&/g, "&amp;").replace(/\u00a0/g, "&nbsp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttribute = (text) => text.replace(/&/g, "&amp;").replace(/\u00a0/g, "&nbsp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function markupOf(node) {
  if (node.nodeType === 3) return RAW_TEXT_PARENTS.has(node.parentNode?.localName) ? node.data : escapeText(node.data);
  if (node instanceof Svg || node instanceof SvgElement) return node.outerHTML ?? node._markup();
  if (node.nodeType === 11) return node.innerHTML;
  const tag = node.localName;
  let html = "<" + tag;
  const tagged = node._tag !== undefined;
  for (const name of node.getAttributeNames()) if (tagged || name !== "style") html += " " + name + '="' + escapeAttribute(node.getAttribute(name)) + '"';
  const css = tagged ? "" : node.look("base").cssText;
  if (css) html += ' style="' + escapeAttribute(css) + '"';
  html += ">";
  if (VOID_TAGS.has(tag)) return html;
  if (node instanceof Input) html += escapeText(node.value);
  else html += node.innerHTML;
  return html + "</" + tag + ">";
}

// The HTML Standard's tree construction sets, for the "in body" and "in table" modes.
const SPECIAL_TAGS = new Set(("address applet area article aside base basefont bgsound blockquote body br button caption center col colgroup dd details dir div dl dt embed fieldset figcaption figure footer form frame frameset h1 h2 h3 h4 h5 h6 head header hgroup hr html iframe img input keygen li link listing main marquee menu meta nav noembed noframes noscript object ol p param plaintext pre script search section select source style summary table tbody td template textarea tfoot th thead title tr track ul wbr xmp").split(" "));
const CLOSES_P = new Set(("address article aside blockquote center details dialog dir div dl fieldset figcaption figure footer header hgroup main menu nav ol p search section summary ul h1 h2 h3 h4 h5 h6 pre listing form table hr xmp plaintext dd dt li").split(" "));
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);
const IMPLIED_END = new Set(["dd", "dt", "li", "optgroup", "option", "p", "rb", "rp", "rt", "rtc"]);
const SCOPE_TAGS = new Set(["applet", "caption", "html", "table", "td", "th", "marquee", "object", "template"]);
const TABLE_ROWS = new Set(["tbody", "thead", "tfoot"]);
const TABLE_CONTEXT = new Set(["table", "tbody", "thead", "tfoot", "tr"]);
const TABLE_PARTS = new Set(["caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"]);

/**
 * Parses `html` and appends its nodes to `parent`, as `innerHTML` does: elements, text with
 * character references, and `<svg>` markup, with the HTML Standard's implied end tags and
 * table sections. Comments, scripts and styles are left out.
 */
export function parseHTML(html, parent) {
  const stack = [parent];
  const top = () => stack[stack.length - 1];
  const inSvg = () => top() instanceof Svg || top() instanceof SvgElement;
  const nameAt = (at) => (at === 0 ? null : stack[at] instanceof Svg || stack[at] instanceof SvgElement ? "svg:" + stack[at].localName : stack[at].localName);
  // The stack position of `names` in scope, or -1: scopes stop at the fragment's parent too.
  const inScope = (names, extra) => {
    for (let at = stack.length - 1; at > 0; at--) {
      const name = nameAt(at);
      if (names.has(name)) return at;
      if (SCOPE_TAGS.has(name) || extra?.has(name)) return -1;
    }
    return -1;
  };
  const BUTTON = new Set(["button"]);
  const LIST = new Set(["ol", "ul"]);
  const endImplied = (except) => {
    while (stack.length > 1 && IMPLIED_END.has(nameAt(stack.length - 1)) && nameAt(stack.length - 1) !== except) stack.pop();
  };
  const closeTo = (at) => { if (at > 0) stack.length = at; };
  const closeP = () => {
    const at = inScope(new Set(["p"]), BUTTON);
    if (at > 0) {
      endImplied("p");
      closeTo(at);
    }
  };
  const tableScope = (names) => {
    for (let at = stack.length - 1; at > 0; at--) {
      const name = nameAt(at);
      if (names.has(name)) return at;
      if (name === "table" || name === "template" || name === "html") return -1;
    }
    return -1;
  };
  const insert = (node) => {
    // Content other than table parts in a table goes before it ("foster parenting").
    const at = top();
    const name = at === parent ? null : at.localName;
    if (TABLE_CONTEXT.has(name) && !(node instanceof Element && /^(caption|colgroup|col|tbody|thead|tfoot|tr|td|th|script|style|template)$/.test(node.localName))) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (nameAt(k) === "table") {
          const table = stack[k];
          if (table.parentNode) table.parentNode.insertBefore(node, table);
          else stack[k - 1].appendChild(node);
          return;
        }
      }
    }
    at.appendChild(node);
  };
  let i = 0;
  const text = (data) => {
    if (!data) return;
    // "In body", a U+0000 character is a parse error and is dropped.
    const value = inSvg() ? decodeEntities(data) : decodeEntities(data.replace(/\0/g, "")).replace(/\0/g, "");
    if (!value) return;
    if (inSvg()) top().appendChild(new SvgText(value));
    else if (/^[\t\n\f\r ]*$/.test(value)) top().appendChild(createText(value));
    else insert(createText(value));
  };
  while (i < html.length) {
    const open = html.indexOf("<", i);
    if (open < 0) {
      text(html.slice(i));
      break;
    }
    text(html.slice(i, open));
    if (html.startsWith("<!--", open)) {
      const end = html.indexOf("-->", open + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html[open + 1] === "!" || html[open + 1] === "?") {
      const end = html.indexOf(">", open);
      i = end < 0 ? html.length : end + 1;
      continue;
    }
    if (html[open + 1] === "/") {
      const end = html.indexOf(">", open);
      const name = html.slice(open + 2, end < 0 ? html.length : end).trim().toLowerCase();
      i = end < 0 ? html.length : end + 1;
      if (inSvg()) {
        for (let at = stack.length - 1; at > 0; at--) {
          if (stack[at].localName.toLowerCase() === name) {
            stack.length = at;
            break;
          }
        }
        continue;
      }
      if (name === "p") {
        if (inScope(new Set(["p"]), BUTTON) < 0) insert(createElement("p"));
        else closeP();
      } else if (name === "br") {
        insert(createElement("br"));
      } else if (name === "li") {
        const at = inScope(new Set(["li"]), LIST);
        if (at > 0) { endImplied("li"); closeTo(at); }
      } else if (HEADINGS.has(name)) {
        const at = inScope(HEADINGS);
        if (at > 0) { endImplied(); closeTo(at); }
      } else if (name === "table" || TABLE_ROWS.has(name) || name === "tr" || name === "td" || name === "th") {
        const at = tableScope(new Set([name]));
        if (at > 0) { endImplied(); closeTo(at); }
      } else if (SPECIAL_TAGS.has(name) || CLOSES_P.has(name)) {
        const at = inScope(new Set([name]));
        if (at > 0) { endImplied(name); closeTo(at); }
      } else {
        // Any other end tag closes the nearest such element, unless a special element is nearer.
        for (let at = stack.length - 1; at > 0; at--) {
          const open = nameAt(at);
          if (open === name) {
            endImplied(name);
            closeTo(at);
            break;
          }
          if (SPECIAL_TAGS.has(open)) break;
        }
      }
      continue;
    }
    const nameMatch = /^[a-zA-Z][^\s\/>]*/.exec(html.slice(open + 1, open + 64));
    if (!nameMatch) {
      text("<");
      i = open + 1;
      continue;
    }
    const written = nameMatch[0];
    const tag = inSvg() ? written : written.toLowerCase();
    let at = open + 1 + written.length;
    const attributes = [];
    ATTRIBUTE.lastIndex = at;
    for (let match; (match = ATTRIBUTE.exec(html)); ATTRIBUTE.lastIndex = at) {
      at = ATTRIBUTE.lastIndex;
      attributes.push([match[1], decodeEntities(match[2] ?? match[3] ?? match[4] ?? "", true)]);
    }
    while (at < html.length && html[at] !== ">") at++;
    const selfClosing = html[at - 1] === "/";
    i = at + 1;
    if (RAW_TAGS.has(tag)) {
      const close = html.toLowerCase().indexOf("</" + tag, i);
      const content = html.slice(i, close < 0 ? html.length : close);
      const end = close < 0 ? html.length : html.indexOf(">", close);
      i = end < 0 ? html.length : end + 1;
      if (tag === "script" || tag === "style") continue;
      const node = createElement(tag);
      for (const [name, value] of attributes) node.setAttribute(name, value);
      const value = tag === "textarea" || tag === "title" ? decodeEntities(content) : content;
      if (tag === "textarea") node.defaultValue = value;
      else if (value) node.appendChild(createText(value));
      top().appendChild(node);
      continue;
    }
    const svg = inSvg() || tag === "svg";
    if (!svg) {
      if (tag === "li" || tag === "dd" || tag === "dt") {
        const same = tag === "li" ? ["li"] : ["dd", "dt"];
        for (let k = stack.length - 1; k > 0; k--) {
          const open = nameAt(k);
          if (same.includes(open)) {
            endImplied(open);
            closeTo(k);
            break;
          }
          if (SPECIAL_TAGS.has(open) && open !== "address" && open !== "div" && open !== "p") break;
        }
      }
      if (CLOSES_P.has(tag)) closeP();
      if (HEADINGS.has(tag) && HEADINGS.has(nameAt(stack.length - 1))) stack.pop();
      // Table parts outside a table are parse errors the tree builder ignores.
      if (TABLE_PARTS.has(tag) && tableScope(new Set(["table"])) < 0) continue;
      if (tag === "td" || tag === "th" || tag === "tr" || TABLE_ROWS.has(tag)) {
        const current = () => nameAt(stack.length - 1);
        if (tag === "td" || tag === "th") {
          const cell = tableScope(new Set(["td", "th"]));
          if (cell > 0) { endImplied(); closeTo(cell); }
          if (TABLE_ROWS.has(current()) || current() === "table") {
            if (current() === "table") stack.push(insertSection(top(), "tbody"));
            stack.push(insertSection(top(), "tr"));
          }
        } else if (tag === "tr") {
          const row = tableScope(new Set(["tr"]));
          if (row > 0) closeTo(row);
          if (current() === "table") stack.push(insertSection(top(), "tbody"));
        } else {
          const section = tableScope(new Set(["tbody", "thead", "tfoot"]));
          if (section > 0) closeTo(section);
        }
      }
    }
    const type = attributes.find(([name]) => name.toLowerCase() === "type")?.[1];
    const node = svg ? createSvgElement(tag) : createElement(tag, { type });
    for (const [name, value] of attributes) {
      node.setAttribute(svg ? name : name.toLowerCase(), value);
    }
    if (svg) top().appendChild(node);
    else insert(node);
    if (!(VOID_TAGS.has(tag) && !svg) && !(selfClosing && svg)) stack.push(node);
  }
}

function insertSection(parent, tag) {
  const node = createElement(tag);
  parent.appendChild(node);
  return node;
}

/** A box with `style` as its base look and `children` appended. */
export function createBox(style, ...children) {
  const box = new Node("box");
  if (style) box.style.set(style);
  box.append(...children);
  return box;
}

export function createText(data = "") {
  return new Text(data);
}

/** An image showing `src` (see `Image`), with `style` as its base look. */
export function createImage(src, style) {
  const image = new Image(src);
  if (style) image.style.set(style);
  return image;
}

export function createInput(style) {
  const input = new Input();
  if (style) input.style.set(style);
  return input;
}

/**
 * Nodes held together outside the tree, as the DOM's `DocumentFragment`. Inserting it
 * inserts its children, in order, and leaves it empty.
 */
export class DocumentFragment extends Node {
  constructor() {
    super("box");
  }

  get nodeType() {
    return 11;
  }

  _shallowClone() {
    return new DocumentFragment();
  }
}

export function createDocumentFragment() {
  return new DocumentFragment();
}

// Ranges, as the DOM Standard defines them, over the nodes of this module. Every change to
// the tree passes through these nodes, so live ranges follow it here, with no native calls.

function nodeLength(node) {
  return node.nodeType === 3 ? node.length : node.childNodes.length;
}

function indexIn(node) {
  return node.parentNode ? node.parentNode.childNodes.indexOf(node) : 0;
}

function rootOf(node) {
  while (node.parentNode) node = node.parentNode;
  return node;
}

function isInclusiveAncestor(ancestor, node) {
  for (; node; node = node.parentNode) if (node === ancestor) return true;
  return false;
}

// -1 when `a` comes before `b` in tree order, 1 after, 0 the same node. One root.
function treeOrder(a, b) {
  if (a === b) return 0;
  const up = [];
  for (let node = a; node; node = node.parentNode) up.push(node);
  const other = [];
  for (let node = b; node; node = node.parentNode) other.push(node);
  let i = up.length - 1;
  let j = other.length - 1;
  while (i >= 0 && j >= 0 && up[i] === other[j]) {
    i--;
    j--;
  }
  if (i < 0) return -1;
  if (j < 0) return 1;
  const siblings = up[i + 1].childNodes;
  return siblings.indexOf(up[i]) < siblings.indexOf(other[j]) ? -1 : 1;
}

// The position of boundary point (a, aOffset) relative to (b, bOffset): -1 before, 0 equal,
// 1 after. Both are in one tree.
function comparePoints(a, aOffset, b, bOffset) {
  if (a === b) return aOffset === bOffset ? 0 : aOffset < bOffset ? -1 : 1;
  if (treeOrder(a, b) > 0) return -comparePoints(b, bOffset, a, aOffset);
  if (isInclusiveAncestor(a, b)) {
    let child = b;
    while (child.parentNode !== a) child = child.parentNode;
    if (indexIn(child) < aOffset) return 1;
  }
  return -1;
}

// The next node in tree order inside `within`, or null.
function following(node, within, skipChildren = false) {
  if (!skipChildren && node.childNodes.length) return node.childNodes[0];
  for (; node && node !== within; node = node.parentNode) {
    const next = node.nextSibling;
    if (next) return next;
  }
  return null;
}

function checkNode(node, what) {
  if (!(node instanceof Node)) throw new TypeError(what + " is not a node");
  return node;
}

/** The fields every range has: two boundary points. */
export class AbstractRange {
  constructor() {
    if (new.target === AbstractRange) throw new TypeError("Illegal constructor");
  }

  get startContainer() {
    return this._startNode;
  }

  get startOffset() {
    return this._startOffset;
  }

  get endContainer() {
    return this._endNode;
  }

  get endOffset() {
    return this._endOffset;
  }

  get collapsed() {
    return this._startNode === this._endNode && this._startOffset === this._endOffset;
  }
}

/** A range that does not follow changes to the tree, and is not checked when made. */
export class StaticRange extends AbstractRange {
  constructor(init) {
    super();
    if (init == null || typeof init !== "object") throw new TypeError("StaticRange needs its four members");
    for (const key of ["startContainer", "startOffset", "endContainer", "endOffset"]) {
      if (init[key] === undefined) throw new TypeError("StaticRange needs " + key);
    }
    this._startNode = checkNode(init.startContainer, "startContainer");
    this._startOffset = init.startOffset >>> 0;
    this._endNode = checkNode(init.endContainer, "endContainer");
    this._endOffset = init.endOffset >>> 0;
  }
}

// The node a new range starts in: the mounted root, else a detached one of its own.
let rangeHome = null;

/** A live range: it follows insertions, removals and text changes, as on the web. */
export class Range extends AbstractRange {
  static START_TO_START = 0;
  static START_TO_END = 1;
  static END_TO_END = 2;
  static END_TO_START = 3;

  constructor() {
    super();
    const home = rootNode ?? (rangeHome ??= new Node("box"));
    this._startNode = this._endNode = home;
    this._startOffset = this._endOffset = 0;
    this._live = new WeakRef(this);
    liveRanges.add(this._live);
    if (commandRanges) commandRanges.push(this);
  }

  get commonAncestorContainer() {
    let container = this._startNode;
    while (!isInclusiveAncestor(container, this._endNode)) container = container.parentNode;
    return container;
  }

  // Called after the boundary points change; a selection's range tells the tree.
  _changed() {}

  #set(node, offset, start) {
    checkNode(node, "the container");
    offset = offset >>> 0;
    if (offset > nodeLength(node)) throw domError("IndexSizeError", "the offset is past the end of the node");
    if (start) {
      if (rootOf(node) !== rootOf(this._startNode) || comparePoints(node, offset, this._endNode, this._endOffset) > 0) {
        this._endNode = node;
        this._endOffset = offset;
      }
      this._startNode = node;
      this._startOffset = offset;
    } else {
      if (rootOf(node) !== rootOf(this._startNode) || comparePoints(node, offset, this._startNode, this._startOffset) < 0) {
        this._startNode = node;
        this._startOffset = offset;
      }
      this._endNode = node;
      this._endOffset = offset;
    }
    this._changed();
  }

  setStart(node, offset) {
    this.#set(node, offset, true);
  }

  setEnd(node, offset) {
    this.#set(node, offset, false);
  }

  /** One rectangle per line piece of the range, from the tree's last layout (laid out first if something changed). */
  getClientRects() {
    return rangeClientRects(this._startNode, this._startOffset, this._endNode, this._endOffset);
  }

  getBoundingClientRect() {
    return rangeBoundingClientRect(this._startNode, this._startOffset, this._endNode, this._endOffset);
  }

  setStartBefore(node) {
    this.#set(parentOf(node), indexIn(node), true);
  }

  setStartAfter(node) {
    this.#set(parentOf(node), indexIn(node) + 1, true);
  }

  setEndBefore(node) {
    this.#set(parentOf(node), indexIn(node), false);
  }

  setEndAfter(node) {
    this.#set(parentOf(node), indexIn(node) + 1, false);
  }

  collapse(toStart = false) {
    if (toStart) {
      this._endNode = this._startNode;
      this._endOffset = this._startOffset;
    } else {
      this._startNode = this._endNode;
      this._startOffset = this._endOffset;
    }
    this._changed();
  }

  selectNode(node) {
    const parent = parentOf(node);
    const index = indexIn(node);
    this.#select(parent, index, parent, index + 1);
  }

  selectNodeContents(node) {
    checkNode(node, "the node");
    this.#select(node, 0, node, nodeLength(node));
  }

  #select(startNode, startOffset, endNode, endOffset) {
    this._startNode = startNode;
    this._startOffset = startOffset;
    this._endNode = endNode;
    this._endOffset = endOffset;
    this._changed();
  }

  compareBoundaryPoints(how, sourceRange) {
    how = Number(how) & 0xffff;
    if (how > 3) throw domError("NotSupportedError", "compareBoundaryPoints takes 0 to 3");
    if (!(sourceRange instanceof Range)) throw new TypeError("compareBoundaryPoints takes a Range");
    if (rootOf(this._startNode) !== rootOf(sourceRange._startNode)) throw domError("WrongDocumentError", "the ranges are in different trees");
    const thisStart = how === 0 || how === 3;
    const otherStart = how === 0 || how === 1;
    return comparePoints(
      thisStart ? this._startNode : this._endNode,
      thisStart ? this._startOffset : this._endOffset,
      otherStart ? sourceRange._startNode : sourceRange._endNode,
      otherStart ? sourceRange._startOffset : sourceRange._endOffset,
    );
  }

  #checkPoint(node, offset) {
    if (offset > nodeLength(node)) throw domError("IndexSizeError", "the offset is past the end of the node");
  }

  comparePoint(node, offset) {
    checkNode(node, "the node");
    offset = offset >>> 0;
    if (rootOf(node) !== rootOf(this._startNode)) throw domError("WrongDocumentError", "the node is in a different tree");
    this.#checkPoint(node, offset);
    if (comparePoints(node, offset, this._startNode, this._startOffset) < 0) return -1;
    if (comparePoints(node, offset, this._endNode, this._endOffset) > 0) return 1;
    return 0;
  }

  isPointInRange(node, offset) {
    checkNode(node, "the node");
    offset = offset >>> 0;
    if (rootOf(node) !== rootOf(this._startNode)) return false;
    this.#checkPoint(node, offset);
    return comparePoints(node, offset, this._startNode, this._startOffset) >= 0
      && comparePoints(node, offset, this._endNode, this._endOffset) <= 0;
  }

  intersectsNode(node) {
    checkNode(node, "the node");
    if (rootOf(node) !== rootOf(this._startNode)) return false;
    const parent = node.parentNode;
    if (!parent) return true;
    const offset = indexIn(node);
    return comparePoints(parent, offset, this._endNode, this._endOffset) < 0
      && comparePoints(parent, offset + 1, this._startNode, this._startOffset) > 0;
  }

  cloneRange() {
    const copy = new Range();
    copy.#select(this._startNode, this._startOffset, this._endNode, this._endOffset);
    return copy;
  }

  detach() {}

  #contains(node) {
    return rootOf(node) === rootOf(this._startNode)
      && comparePoints(node, 0, this._startNode, this._startOffset) > 0
      && comparePoints(node, nodeLength(node), this._endNode, this._endOffset) < 0;
  }

  #partlyContains(node) {
    return isInclusiveAncestor(node, this._startNode) !== isInclusiveAncestor(node, this._endNode);
  }

  toString() {
    const start = this._startNode;
    const end = this._endNode;
    if (start === end && start.nodeType === 3) return start.data.slice(this._startOffset, this._endOffset);
    let text = start.nodeType === 3 ? start.data.slice(this._startOffset) : "";
    const within = this.commonAncestorContainer;
    for (let node = following(within, within); node; node = following(node, within)) {
      if (node.nodeType === 3 && this.#contains(node)) text += node.data;
    }
    if (end.nodeType === 3) text += end.data.slice(0, this._endOffset);
    return text;
  }

  // The parts of the contents algorithms the three of them share.
  #split() {
    const startNode = this._startNode;
    const endNode = this._endNode;
    const common = this.commonAncestorContainer;
    const children = common.childNodes;
    const first = isInclusiveAncestor(startNode, endNode) ? null : children.find((child) => this.#partlyContains(child)) ?? null;
    let last = null;
    if (!isInclusiveAncestor(endNode, startNode)) {
      for (let i = children.length - 1; i >= 0; i--) {
        if (this.#partlyContains(children[i])) {
          last = children[i];
          break;
        }
      }
    }
    return { common, first, last, contained: children.filter((child) => this.#contains(child)) };
  }

  // Where the range collapses after its contents leave.
  #after() {
    if (isInclusiveAncestor(this._startNode, this._endNode)) return [this._startNode, this._startOffset];
    let reference = this._startNode;
    while (reference.parentNode && !isInclusiveAncestor(reference.parentNode, this._endNode)) reference = reference.parentNode;
    return [reference.parentNode, indexIn(reference) + 1];
  }

  deleteContents() {
    if (this.collapsed) return;
    const startNode = this._startNode;
    const startOffset = this._startOffset;
    const endNode = this._endNode;
    const endOffset = this._endOffset;
    if (startNode === endNode && startNode.nodeType === 3) {
      startNode.replaceData(startOffset, endOffset - startOffset, "");
      return;
    }
    const remove = [];
    const within = this.commonAncestorContainer;
    for (let node = following(within, within); node; ) {
      if (this.#contains(node)) {
        remove.push(node);
        node = following(node, within, true);
      } else {
        node = following(node, within);
      }
    }
    const [node, offset] = this.#after();
    if (startNode.nodeType === 3) startNode.replaceData(startOffset, startNode.length - startOffset, "");
    for (const child of remove) child.remove();
    if (endNode.nodeType === 3) endNode.replaceData(0, endOffset, "");
    this.#select(node, offset, node, offset);
  }

  #contents(extract) {
    const fragment = new DocumentFragment();
    if (this.collapsed) return fragment;
    const startNode = this._startNode;
    const startOffset = this._startOffset;
    const endNode = this._endNode;
    const endOffset = this._endOffset;
    if (startNode === endNode && startNode.nodeType === 3) {
      const clone = startNode.cloneNode();
      clone.data = startNode.substringData(startOffset, endOffset - startOffset);
      fragment.appendChild(clone);
      if (extract) startNode.replaceData(startOffset, endOffset - startOffset, "");
      return fragment;
    }
    const { first, last, contained } = this.#split();
    const after = extract ? this.#after() : null;
    if (first?.nodeType === 3) {
      const clone = startNode.cloneNode();
      clone.data = startNode.substringData(startOffset, startNode.length - startOffset);
      fragment.appendChild(clone);
      if (extract) startNode.replaceData(startOffset, startNode.length - startOffset, "");
    } else if (first) {
      const clone = first.cloneNode();
      fragment.appendChild(clone);
      const inner = new Range();
      inner.#select(startNode, startOffset, first, nodeLength(first));
      clone.appendChild(inner.#contents(extract));
    }
    for (const child of contained) fragment.appendChild(extract ? child : child.cloneNode(true));
    if (last?.nodeType === 3) {
      const clone = endNode.cloneNode();
      clone.data = endNode.substringData(0, endOffset);
      fragment.appendChild(clone);
      if (extract) endNode.replaceData(0, endOffset, "");
    } else if (last) {
      const clone = last.cloneNode();
      fragment.appendChild(clone);
      const inner = new Range();
      inner.#select(last, 0, endNode, endOffset);
      clone.appendChild(inner.#contents(extract));
    }
    if (extract) this.#select(after[0], after[1], after[0], after[1]);
    return fragment;
  }

  /** Moves the contents into a new fragment and collapses the range where they were. */
  extractContents() {
    return this.#contents(true);
  }

  /** Copies the contents into a new fragment. */
  cloneContents() {
    return this.#contents(false);
  }

  /** The nodes `html` parses to, in a new fragment, as the DOM Parsing spec's createContextualFragment. */
  createContextualFragment(html) {
    const fragment = new DocumentFragment();
    parseHTML(String(html), fragment);
    return fragment;
  }

  /** Inserts `node` at the start of the range. */
  insertNode(node) {
    checkNode(node, "the node");
    const start = this._startNode;
    if ((start.nodeType === 3 && !start.parentNode) || start === node) {
      throw domError("HierarchyRequestError", "cannot insert the node there");
    }
    let reference = start.nodeType === 3 ? start : start.childNodes[this._startOffset] ?? null;
    const parent = reference ? reference.parentNode : start;
    if (isInclusiveAncestor(node, parent)) throw domError("HierarchyRequestError", "a node cannot be inserted into itself");
    if (parent.nodeType === 3) throw domError("HierarchyRequestError", "text has no children");
    if (start.nodeType === 3) reference = start.splitText(this._startOffset);
    if (node === reference) reference = node.nextSibling;
    if (node.parentNode) node.remove();
    let offset = reference ? indexIn(reference) : nodeLength(parent);
    offset += node.nodeType === 11 ? node.childNodes.length : 1;
    parent.insertBefore(node, reference);
    if (this.collapsed) this.#set(parent, offset, false);
  }

  /** Wraps the contents in `newParent`. */
  surroundContents(newParent) {
    checkNode(newParent, "the new parent");
    const within = this.commonAncestorContainer;
    for (let node = within; node; node = following(node, within)) {
      if (node.nodeType !== 3 && this.#partlyContains(node)) {
        throw domError("InvalidStateError", "the range splits an element");
      }
    }
    if (newParent.nodeType === 11) throw domError("InvalidNodeTypeError", "a fragment cannot surround the range");
    const fragment = this.extractContents();
    while (newParent.firstChild) newParent.removeChild(newParent.firstChild);
    this.insertNode(newParent);
    newParent.appendChild(fragment);
    this.selectNode(newParent);
  }

  // The DOM Standard's live range steps, run by the nodes as they change.

  _inserted(parent, index) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (this._startNode === parent && this._startOffset > index) this._startOffset++;
    if (this._endNode === parent && this._endOffset > index) this._endOffset++;
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }

  _removing(child, parent, index) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (isInclusiveAncestor(child, this._startNode)) {
      this._startNode = parent;
      this._startOffset = index;
    }
    if (isInclusiveAncestor(child, this._endNode)) {
      this._endNode = parent;
      this._endOffset = index;
    }
    if (this._startNode === parent && this._startOffset > index) this._startOffset--;
    if (this._endNode === parent && this._endOffset > index) this._endOffset--;
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }

  _replaced(node, offset, count, added) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (this._startNode === node) {
      if (this._startOffset > offset + count) this._startOffset += added - count;
      else if (this._startOffset > offset) this._startOffset = offset;
    }
    if (this._endNode === node) {
      if (this._endOffset > offset + count) this._endOffset += added - count;
      else if (this._endOffset > offset) this._endOffset = offset;
    }
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }

  _split(node, rest, offset, parent, index) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (this._startNode === node && this._startOffset > offset) {
      this._startNode = rest;
      this._startOffset -= offset;
    }
    if (this._endNode === node && this._endOffset > offset) {
      this._endNode = rest;
      this._endOffset -= offset;
    }
    if (this._startNode === parent && this._startOffset === index + 1) this._startOffset++;
    if (this._endNode === parent && this._endOffset === index + 1) this._endOffset++;
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }

  _joined(current, node, length, index) {
    const a = this._startNode, b = this._startOffset, c = this._endNode, d = this._endOffset;
    if (this._startNode === current) {
      this._startNode = node;
      this._startOffset += length;
    }
    if (this._endNode === current) {
      this._endNode = node;
      this._endOffset += length;
    }
    if (this._startNode === current.parentNode && this._startOffset === index) {
      this._startNode = node;
      this._startOffset = length;
    }
    if (this._endNode === current.parentNode && this._endOffset === index) {
      this._endNode = node;
      this._endOffset = length;
    }
    if (a !== this._startNode || b !== this._startOffset || c !== this._endNode || d !== this._endOffset) this._changed();
  }
}

for (const [name, value] of [["START_TO_START", 0], ["START_TO_END", 1], ["END_TO_END", 2], ["END_TO_START", 3]]) {
  Object.defineProperty(Range.prototype, name, { value, enumerable: true });
}

function parentOf(node) {
  checkNode(node, "the node");
  if (!node.parentNode) throw domError("InvalidNodeTypeError", "the node has no parent");
  return node.parentNode;
}

/** A new live range, collapsed at the start of the root. */
export function createRange() {
  return new Range();
}

// The document's selection. The tree keeps it (presses, drags, keys, select all) and paints
// it; the one `Selection` reads it from there and tells the tree what scripts change. Its
// ranges are live Ranges in tree order, one per stretch: a selection across children that
// layout reorders (flex order, placed grid cells, positioned boxes) has one per piece seen.
const SELECTION = Symbol("selection");
let theSelection = null;

function checkOffset(node, offset) {
  offset = offset >>> 0;
  if (offset > nodeLength(node)) throw domError("IndexSizeError", "the offset is past the end of the node");
  return offset;
}

function inDocument(node) {
  return rootNode !== null && rootOf(node) === rootNode;
}

/** The document's selection, as `getSelection()` answers it. */
export class Selection {
  #anchor = null;
  #anchorOffset = 0;
  #focus = null;
  #focusOffset = 0;
  #ranges = [];
  #backward = false;
  // Changed by a script and not yet told to the tree.
  #pending = false;

  constructor(token) {
    if (token !== SELECTION) throw new TypeError("Illegal constructor");
  }

  // Reads what the tree has, after telling it what a script changed.
  #sync() {
    if (this.#pending) this.#flush();
    const count = native.selection?.() ?? 0;
    const rawAnchor = count ? nodes[geometry(0)] : null;
    const rawFocus = count ? nodes[geometry(2)] : null;
    if (!rawAnchor || !rawFocus) {
      if (this.#anchor) this.#forget();
      return;
    }
    const [anchor, anchorOffset] = fromTreePoint(rawAnchor, geometry(1));
    const [focus, focusOffset] = fromTreePoint(rawFocus, geometry(3));
    const stretches = [];
    for (let i = 0; i < count; i++) {
      const at = 4 + 4 * i;
      const start = nodes[geometry(at)];
      const end = nodes[geometry(at + 2)];
      if (start && end) stretches.push([...fromTreePoint(start, geometry(at + 1)), ...fromTreePoint(end, geometry(at + 3))]);
    }
    const same = anchor === this.#anchor && anchorOffset === this.#anchorOffset && focus === this.#focus
      && focusOffset === this.#focusOffset && stretches.length === this.#ranges.length
      && stretches.every(([a, b, c, d], i) => {
        const range = this.#ranges[i];
        return range._startNode === a && range._startOffset === b && range._endNode === c && range._endOffset === d;
      });
    if (same) return;
    this.#unhook();
    this.#anchor = anchor;
    this.#anchorOffset = anchorOffset;
    this.#focus = focus;
    this.#focusOffset = focusOffset;
    this.#backward = comparePoints(anchor, this.#anchorOffset, focus, this.#focusOffset) > 0;
    this.#ranges = stretches.map(([a, b, c, d]) => {
      const range = new Range();
      range._startNode = a;
      range._startOffset = b;
      range._endNode = c;
      range._endOffset = d;
      return this.#hook(range);
    });
  }

  #flush() {
    this.#pending = false;
    if (!this.#anchor) native.setSelection?.(0, 0, 0, 0);
    else native.setSelection?.(this.#anchor.nodeId, this.#anchorOffset, this.#focus.nodeId, this.#focusOffset);
  }

  #schedule() {
    if (this.#pending) return;
    this.#pending = true;
    queueMicrotask(() => {
      if (this.#pending) this.#flush();
    });
  }

  #hook(range) {
    range._changed = () => this.#moved(range);
    return range;
  }

  #unhook() {
    for (const range of this.#ranges) delete range._changed;
  }

  #forget() {
    this.#unhook();
    this.#anchor = this.#focus = null;
    this.#anchorOffset = this.#focusOffset = 0;
    this.#ranges = [];
    this.#backward = false;
  }

  // A script or a mutation moved one of the ranges: the selection becomes that range.
  #moved(range) {
    const backward = this.#backward;
    this.#unhook();
    this.#ranges = [this.#hook(range)];
    this.#anchor = backward ? range._endNode : range._startNode;
    this.#anchorOffset = backward ? range._endOffset : range._startOffset;
    this.#focus = backward ? range._startNode : range._endNode;
    this.#focusOffset = backward ? range._startOffset : range._endOffset;
    this.#schedule();
  }

  #set(anchor, anchorOffset, focus, focusOffset) {
    const range = new Range();
    const forward = comparePoints(anchor, anchorOffset, focus, focusOffset) <= 0;
    range._startNode = forward ? anchor : focus;
    range._startOffset = forward ? anchorOffset : focusOffset;
    range._endNode = forward ? focus : anchor;
    range._endOffset = forward ? focusOffset : anchorOffset;
    this.#unhook();
    this.#ranges = [this.#hook(range)];
    this.#anchor = anchor;
    this.#anchorOffset = anchorOffset;
    this.#focus = focus;
    this.#focusOffset = focusOffset;
    this.#backward = !forward;
    this.#schedule();
  }

  get anchorNode() { this.#sync(); return this.#anchor; }
  get anchorOffset() { this.#sync(); return this.#anchorOffset; }
  get focusNode() { this.#sync(); return this.#focus; }
  get focusOffset() { this.#sync(); return this.#focusOffset; }

  get isCollapsed() {
    this.#sync();
    return this.#anchor === this.#focus && this.#anchorOffset === this.#focusOffset;
  }

  get rangeCount() { this.#sync(); return this.#ranges.length; }

  /** "None", "Caret" (collapsed) or "Range". */
  get type() {
    this.#sync();
    return !this.#anchor ? "None" : this.isCollapsed ? "Caret" : "Range";
  }

  /** "forward" when the focus comes after the anchor, "backward" before it, "none" when collapsed. */
  get direction() {
    this.#sync();
    if (!this.#anchor || this.isCollapsed) return "none";
    return this.#backward ? "backward" : "forward";
  }

  getRangeAt(index) {
    this.#sync();
    index = index >>> 0;
    if (index >= this.#ranges.length) throw domError("IndexSizeError", "the selection has no range " + index);
    return this.#ranges[index];
  }

  /** Selects `range`, which then is the selection's own: changing it changes the selection. Does nothing while something is selected. */
  addRange(range) {
    if (!(range instanceof Range)) throw new TypeError("addRange takes a Range");
    this.#sync();
    if (this.#ranges.length || !inDocument(range._startNode)) return;
    this.#unhook();
    this.#ranges = [this.#hook(range)];
    this.#anchor = range._startNode;
    this.#anchorOffset = range._startOffset;
    this.#focus = range._endNode;
    this.#focusOffset = range._endOffset;
    this.#backward = false;
    this.#schedule();
  }

  removeRange(range) {
    this.#sync();
    if (!this.#ranges.includes(range)) throw domError("NotFoundError", "the range is not in the selection");
    this.removeAllRanges();
  }

  removeAllRanges() {
    if (!this.#anchor && !this.#pending && !this.#ranges.length) {
      this.#sync();
      if (!this.#anchor) return;
    }
    this.#forget();
    this.#schedule();
  }

  empty() { this.removeAllRanges(); }

  /** Puts a caret at (`node`, `offset`); `null` removes the selection. */
  collapse(node, offset = 0) {
    if (node === null) return this.removeAllRanges();
    checkNode(node, "the node");
    offset = checkOffset(node, offset);
    if (inDocument(node)) this.#set(node, offset, node, offset);
  }

  setPosition(node, offset = 0) { return this.collapse(node, offset); }

  collapseToStart() {
    this.#sync();
    if (!this.#ranges.length) throw domError("InvalidStateError", "nothing is selected");
    const first = this.#ranges[0];
    this.#set(first._startNode, first._startOffset, first._startNode, first._startOffset);
  }

  collapseToEnd() {
    this.#sync();
    if (!this.#ranges.length) throw domError("InvalidStateError", "nothing is selected");
    const last = this.#ranges[this.#ranges.length - 1];
    this.#set(last._endNode, last._endOffset, last._endNode, last._endOffset);
  }

  /** Moves the focus to (`node`, `offset`); the anchor stays. */
  extend(node, offset = 0) {
    checkNode(node, "the node");
    this.#sync();
    if (!this.#anchor) throw domError("InvalidStateError", "nothing is selected");
    offset = checkOffset(node, offset);
    if (inDocument(node)) this.#set(this.#anchor, this.#anchorOffset, node, offset);
  }

  setBaseAndExtent(anchorNode, anchorOffset, focusNode, focusOffset) {
    checkNode(anchorNode, "the anchor node");
    checkNode(focusNode, "the focus node");
    anchorOffset = checkOffset(anchorNode, anchorOffset);
    focusOffset = checkOffset(focusNode, focusOffset);
    if (inDocument(anchorNode) && inDocument(focusNode)) this.#set(anchorNode, anchorOffset, focusNode, focusOffset);
  }

  selectAllChildren(node) {
    checkNode(node, "the node");
    if (inDocument(node)) this.#set(node, 0, node, node.childNodes.length);
  }

  deleteFromDocument() {
    this.#sync();
    for (const range of [...this.#ranges]) range.deleteContents();
  }

  /** Whether the selection holds all of `node`, or any of it with `allowPartialContainment`. */
  containsNode(node, allowPartialContainment = false) {
    checkNode(node, "the node");
    this.#sync();
    if (!this.#ranges.length || !inDocument(node)) return false;
    const parent = node.parentNode;
    const startNode = parent ?? node;
    const start = parent ? indexIn(node) : 0;
    const endNode = parent ?? node;
    const end = parent ? start + 1 : nodeLength(node);
    return this.#ranges.some((range) => allowPartialContainment
      ? comparePoints(startNode, start, range._endNode, range._endOffset) < 0 && comparePoints(endNode, end, range._startNode, range._startOffset) > 0
      : comparePoints(range._startNode, range._startOffset, startNode, start) <= 0 && comparePoints(endNode, end, range._endNode, range._endOffset) <= 0);
  }

  getComposedRanges() {
    this.#sync();
    return this.#ranges.map((range) => new StaticRange({
      startContainer: range._startNode, startOffset: range._startOffset, endContainer: range._endNode, endOffset: range._endOffset,
    }));
  }

  /**
   * Moves (`alter` "move") or extends ("extend") the selection one `granularity` ("character",
   * "word", "line", "lineboundary", "paragraph", "paragraphboundary", "sentence",
   * "sentenceboundary", "documentboundary") "forward", "backward", "left" or "right".
   */
  modify(alter, direction, granularity) {
    modifySelection(this, alter, direction, granularity);
  }

  // Anchor node, offset, focus node, offset, or null: what a script set without asking the tree again.
  _ends() {
    if (!this.#pending) this.#sync();
    return this.#anchor ? [this.#anchor, this.#anchorOffset, this.#focus, this.#focusOffset] : null;
  }

  /** The selected text as copying gives it: rendered white space, line breaks between blocks. */
  toString() {
    this.#sync();
    if (!this.#ranges.length) return "";
    return native.selectionText?.() ?? this.#ranges.map((range) => range.toString()).join("");
  }
}

/** The document's selection: what the user selected, which scripts can read and change. */
export function getSelection() {
  return (theSelection ??= new Selection(SELECTION));
}

globalThis.Selection ??= Selection;
globalThis.getSelection ??= getSelection;

// A `SelectionChange` record at a node that is not an input: `selectstart` where a press
// started a selection (its `selectionStart` is 1), else the document's `selectionchange` at
// the root.
function selectionRecord(target, start) {
  const event = new Event(start === 1 ? "selectstart" : "selectionchange", target);
  if (start !== 1) event.bubbles = false;
  dispatchEvent(event);
  // As on the web, `selectionchange` is the document's event too.
  if (start !== 1 && outerTargets.length) outerTargets[0].dispatchEvent?.(new Event("selectionchange", null));
  if (event.defaultPrevented) {
    const selection = getSelection();
    selection.removeAllRanges();
    // Read back at once, so the tree stops the press before the pointer moves on.
    void selection.rangeCount;
  }
  return false;
}

let rootNode = null;
// What events pass above the root, outermost last: the document and the window of a DOM layer
// over the tree (`@silkui/core/globals`). Each has `_run(event, capture)` as a node does.
let outerTargets = [];
// The targets above the root on the path of an event of `type`, as DOM's "get the parent"
// gives them: the document for every event, and the window for all but `load`. An event that
// does not bubble (`scroll`, `error`) still passes them in the capture phase. `layout` is the
// tree's own and stays in it.
function outerPath(type) {
  if (type === "layout") return [];
  return type === "load" ? outerTargets.slice(0, 1) : outerTargets;
}

/** Has events that reach the root go on to `targets` (outermost last), as `@silkui/core/globals` does for `document` and `window`. */
export function setOuterTargets(...targets) {
  outerTargets = targets;
}

/** Makes `node` the root of the window's tree. */
/**
 * Defines `@keyframes name` as CSS would: `{ from: { opacity: 0 }, "50%": {...}, to: {...} }`,
 * with selectors such as `"0%, 100%"` too. Style objects name it in `animation` or
 * `animationName`. Defining a name again replaces its rule; `null` removes it.
 */
export function defineKeyframes(name, frames) {
  for (const selector of Object.keys(frames ?? {})) {
    let css = "";
    const declarations = frames[selector];
    for (const property of Object.keys(declarations)) {
      const value = declarations[property];
      if (value === null || value === undefined || value === "") continue;
      css += cssName(property) + ":" + cssValue(property, value) + ";";
    }
    for (const part of selector.split(",")) {
      const text = part.trim().toLowerCase();
      const offset = text === "from" ? 0 : text === "to" ? 1 : parseFloat(text) / 100;
      if (!(offset >= 0 && offset <= 1)) throw new Error(`@silkui/core: bad keyframe selector '${part}'`);
      native.keyframe(offset, css);
    }
  }
  native.keyframes(String(name));
}

export function mount(node) {
  if (rootNode) clearAdoptedSheets();
  rootNode = node;
  native.root(node.nodeId);
  syncAdoptedSheets();
  if (styleElements.size) stylesChanged();
  return node;
}

export function root() {
  return rootNode;
}

// The live regions `announce` speaks through, one per politeness, made on first use.
const regions = Object.create(null);
// A box screen readers read and nothing shows, as the web's visually hidden pattern.
const VISUALLY_HIDDEN = {
  position: "absolute",
  width: 1,
  height: 1,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  pointerEvents: "none",
};

/**
 * Has screen readers say `message` without showing it, as a toast or a "Saved" would. Polite
 * messages wait for the reader to finish; `{ politeness: "assertive" }` interrupts it. The
 * same message twice is said twice. Nothing happens before `mount`.
 */
export function announce(message, { politeness = "polite" } = {}) {
  if (!rootNode) return;
  const key = politeness === "assertive" ? "assertive" : "polite";
  let region = regions[key];
  if (!region || region.parentNode !== rootNode) {
    region = regions[key] = createBox(VISUALLY_HIDDEN);
    region.setAttribute("aria-live", key);
    region.setAttribute("aria-atomic", "true");
    rootNode.appendChild(region);
  }
  // A region announces changes, not what it holds when it appears, so the text waits a
  // moment; each message is a node of its own so a repeat is a change too.
  setTimeout(() => {
    if (region.parentNode !== rootNode) return;
    for (const child of region.childNodes.slice()) child.destroy();
    const text = createText(String(message));
    region.appendChild(text);
    setTimeout(() => {
      if (text.parentNode === region) text.destroy();
    }, ANNOUNCEMENT_LIFETIME);
  }, ANNOUNCEMENT_DELAY);
}

const ANNOUNCEMENT_DELAY = 100;
const ANNOUNCEMENT_LIFETIME = 7000;

/** The node with tree id `id`, for hosts and tools. */
export function nodeById(id) {
  return nodes[id] ?? null;
}

native.virtualRequest = (port, ...indices) => nodes[port]?._virtualRange?.(indices);

// The option bits of `__ui.markdown`.
const MARKDOWN_FLAGS = { tables: 1, strikethrough: 2, taskLists: 4, autolinkLiterals: 8, footnotes: 16, frontmatter: 32, alerts: 64 };
const GFM = 1 | 2 | 4 | 8;

/**
 * The syntax tree of Markdown `text`, in the shape of mdast (what remark gives): plain
 * objects with `type` and `children`. CommonMark, with GitHub's tables, strikethrough,
 * task lists and autolinks unless `gfm` is false. `footnotes`, `frontmatter` and
 * `alerts` (`> [!NOTE]`, a node of type `alert` with a `kind`) turn those on.
 */
export function parseMarkdown(text, options = {}) {
  let flags = options.gfm === false ? 0 : GFM;
  for (const name in MARKDOWN_FLAGS) {
    if (options[name] === true) flags |= MARKDOWN_FLAGS[name];
    else if (options[name] === false) flags &= ~MARKDOWN_FLAGS[name];
  }
  return JSON.parse(native.markdown(String(text), flags));
}

let errorHandler = null;
let pendingError = null;

/**
 * What happens to an exception a listener throws. As on the web, it does not stop the
 * dispatch. Without a handler, the host reports the first one after the input is handled.
 */
export function setErrorHandler(handler) {
  errorHandler = handler;
}

function reportError(error) {
  if (errorHandler) errorHandler(error);
  else pendingError ??= { error };
}

/** An event of the tree, with the members of the DOM event it corresponds to. */
const MODIFIER_FIELDS = { __proto__: null, Shift: "shiftKey", Control: "ctrlKey", Alt: "altKey", Meta: "metaKey" };

export class Event {
  constructor(type, target) {
    this.type = type;
    this.target = target;
    this.currentTarget = null;
    this.eventPhase = 0;
    this.bubbles = !NO_BUBBLE.has(type);
    this.cancelable = CANCELABLE.has(type);
    this.defaultPrevented = false;
    this.isTrusted = false;
    this.timeStamp = typeof native.now === "function" ? native.now() : 0;
    this._stopped = false;
    this._immediate = false;
  }

  preventDefault() {
    if (this.cancelable) this.defaultPrevented = true;
  }

  stopPropagation() {
    this._stopped = true;
  }

  stopImmediatePropagation() {
    this._stopped = true;
    this._immediate = true;
  }

  /**
   * Whether modifier `key` ("Shift", "Control", "Alt", "Meta") was down, for keyboard, mouse,
   * pointer and touch events. Lock keys and others answer false.
   */
  getModifierState(key) {
    return this[MODIFIER_FIELDS[key]] === true;
  }

  /** The nodes the event passes, target first. */
  composedPath() {
    const path = [];
    for (let node = this.target; node; node = node.parentNode) path.push(node);
    if (outerTargets.length && path[path.length - 1] === rootNode) path.push(...outerPath(this.type));
    return path;
  }
}

// The pointers down or hovering, by `pointerId`: their buttons and the node holding their
// capture.
const pointers = new Map();

function domError(name, message) {
  const DOMExceptionClass = globalThis.DOMException;
  if (DOMExceptionClass) return new DOMExceptionClass(message, name);
  const error = new Error(message);
  error.name = name;
  return error;
}

const POINTER_TYPES = ["mouse", "pen", "touch"];
// DOM `buttons` bits by `button`: primary 1, secondary 2, auxiliary 4, back 8, forward 16.
const BUTTON_BITS = [1, 4, 2, 8, 16];

function isPointerKind(kind) {
  return kind <= 5 || kind === 14 || kind === 28 || kind === 29;
}

// The fingers down, by `identifier`: the `Touch` each last reported.
const touches = new Map();

function touchList(list) {
  list.item = (index) => list[index] ?? null;
  return list;
}

// A touch record as DOM `TouchEvent`: the finger it is about is `changedTouches[0]`, and it
// goes to the node the finger went down on. No host reports contact size or force: a touch is
// 1 by 1 pixel, as its pointer is, with force 0.
function fillTouch(event, kind, a, b, bits, d) {
  const identifier = Math.floor(bits / 256) % 16777216;
  const touch = {
    identifier,
    target: event.target,
    clientX: a,
    clientY: b,
    pageX: a,
    pageY: b,
    screenX: a,
    screenY: b,
    radiusX: 0.5,
    radiusY: 0.5,
    rotationAngle: 0,
    force: 0,
  };
  const start = touches.get(identifier);
  if (start) touch.target = start.target;
  if (kind === TOUCH_START || kind === TOUCH_START + 1) touches.set(identifier, touch);
  else touches.delete(identifier);
  event.cancelable = d === 1;
  event.changedTouches = touchList([touch]);
  event.touches = touchList([...touches.values()]);
  event.targetTouches = touchList([...touches.values()].filter((t) => t.target === event.target));
}

// The members of DOM `PointerEvent` the record carries (see ui-js-calls `pointerBits`), and the
// spec defaults for what no host reports: pressure 0.5 while a button is down, 0 otherwise, and
// a contact of 1 by 1 pixel with no tilt.
function fillPointer(event, kind, bits, d) {
  const pointerId = Math.floor(bits / 256) % 16777216;
  event._element = Math.floor(bits / 4294967296);
  const pointerType = POINTER_TYPES[Math.floor(bits / 16) % 4] ?? "mouse";
  const isPrimary = Math.floor(bits / 64) % 2 === 1;
  let pointer = pointers.get(pointerId);
  if (!pointer) {
    pointer = { buttons: 0, capture: null, primary: isPrimary, mute: false };
    // A click comes after its pointer lifted: it leaves no pointer behind.
    if (kind !== 2) pointers.set(pointerId, pointer);
  }
  if (kind === 0) pointer.buttons |= BUTTON_BITS[d] ?? 0;
  else if (kind === 1) pointer.buttons &= ~(BUTTON_BITS[d] ?? 0);
  event.pointerId = pointerId;
  event.pointerType = pointerType;
  event.isPrimary = isPrimary;
  event.buttons = pointer.buttons;
  event.pressure = pointer.buttons ? 0.5 : 0;
  event.tangentialPressure = 0;
  event.tiltX = 0;
  event.tiltY = 0;
  event.twist = 0;
  event.altitudeAngle = Math.PI / 2;
  event.azimuthAngle = 0;
  event.width = 1;
  event.height = 1;
  if (kind !== 0 && kind !== 1 && kind !== 2) event.button = kind === 3 ? -1 : 0;
  const coalesced = kind === 3 ? [event] : [];
  event.getCoalescedEvents = () => coalesced;
  event.getPredictedEvents = () => [];
  // A pointer that lifted, or a touch that left, is gone; the mouse stays.
  if ((kind === 1 && !pointer.buttons) || kind === 14) {
    pointer.capture = null;
    if (pointerType !== "mouse") pointers.delete(pointerId);
  }
}

function fill(event, kind, a, b, modifiers, d, e, first, second, third, fourth) {
  if (kind >= TOUCH_START && kind < COPY) {
    fillTouch(event, kind, a, b, modifiers, d);
    event.shiftKey = (modifiers & 1) !== 0;
    event.ctrlKey = (modifiers & 2) !== 0;
    event.altKey = (modifiers & 4) !== 0;
    event.metaKey = (modifiers & 8) !== 0;
    return;
  }
  if (kind <= 6 || kind === 14 || kind === 28 || kind === 29) {
    event.clientX = event.x = a;
    event.clientY = event.y = b;
  }
  if (isPointerKind(kind)) fillPointer(event, kind, modifiers, d);
  if (kind === 16) for (const pointer of pointers.values()) if (pointer.capture === event.target) pointer.capture = null;
  if (kind <= 8 || kind === 14 || kind === 28 || kind === 29) {
    event.shiftKey = (modifiers & 1) !== 0;
    event.ctrlKey = (modifiers & 2) !== 0;
    event.altKey = (modifiers & 4) !== 0;
    event.metaKey = (modifiers & 8) !== 0;
  }
  if (kind <= 2) {
    event.button = d;
    event.detail = e;
  } else if (kind === 6) {
    event.deltaX = d;
    event.deltaY = e;
    event.deltaZ = 0;
    event.deltaMode = 0;
  } else if (kind === 7 || kind === 8) {
    event.key = first;
    event.code = second;
    event.repeat = d !== 0;
  } else if (kind === 11) {
    const before = event.target instanceof Input ? event.target._text() : null;
    event.value = first;
    event.inputType = second;
    event.target._changed?.(first, a, b, third, fourth, d);
    event.data = insertedText(second, before, first);
    event.isComposing = second === "insertCompositionText";
    event.dataTransfer = null;
    if (event.target instanceof RichInput) event.document = event.target.document;
  } else if (kind === 12) {
    event.scrollLeft = a;
    event.scrollTop = b;
  } else if (kind === 13) {
    event.bounds = { x: a, y: b, width: d, height: e };
  } else if (kind >= 19 && kind <= 22) {
    event.propertyName = first;
    event.elapsedTime = a;
    event.pseudoElement = second ?? "";
  } else if (kind === 27) {
    event.target._selected?.(a, b, d);
    event.selectionStart = event.target.selectionStart;
    event.selectionEnd = event.target.selectionEnd;
  } else if (kind >= 23) {
    event.animationName = first;
    event.elapsedTime = a;
    event.pseudoElement = second ?? "";
  }
}

// An `input` event's `data`: the text an insertion put in, found by what `before` and `after`
// share at their ends. Deletions and line breaks have none.
function insertedText(inputType, before, after) {
  if (before === null || !inputType?.startsWith("insert") || inputType === "insertLineBreak" || inputType === "insertParagraph") return null;
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  return after.slice(start, after.length - end);
}

/**
 * Runs `event` through the tree as the DOM does: the capture phase from the root down, the
 * target, then the bubble phase back up for events that bubble. Returns false when a
 * listener prevented the default.
 */
export function dispatchEvent(event) {
  // `window.event` is the event being dispatched, as on the web. React DOM reads it to give
  // updates from discrete events (input, keydown, click) sync priority.
  const outer = globalThis.event;
  globalThis.event = event;
  try {
    return dispatchThrough(event);
  } finally {
    globalThis.event = outer;
  }
}

function dispatchThrough(event) {
  const path = [];
  for (let node = event.target; node; node = node.parentNode) path.push(node);
  if (outerTargets.length && path[path.length - 1] === rootNode) path.push(...outerPath(event.type));
  for (let i = path.length - 1; i > 0 && !event._stopped; i--) {
    event.eventPhase = 1;
    event.currentTarget = path[i];
    path[i]._run(event, true);
  }
  if (!event._stopped) {
    event.eventPhase = 2;
    event.currentTarget = path[0];
    path[0]._run(event, true);
    if (!event._stopped) path[0]._run(event, false);
  }
  if (event.bubbles) {
    for (let i = 1; i < path.length && !event._stopped; i++) {
      event.eventPhase = 3;
      event.currentTarget = path[i];
      path[i]._run(event, false);
    }
  }
  event.eventPhase = 0;
  event.currentTarget = null;
  return !event.defaultPrevented;
}

// An event the app made, from the runtime's `Event` class: its target and phase become
// fields the dispatcher sets, and its stop methods record what the dispatcher reads.
function adopt(event, target) {
  if (!("_stopped" in event)) {
    let stopped = false;
    let immediate = false;
    const stop = event.stopPropagation;
    const stopNow = event.stopImmediatePropagation;
    Object.defineProperties(event, {
      _stopped: { get: () => stopped || event.cancelBubble === true, configurable: true },
      _immediate: { get: () => immediate, configurable: true },
      stopPropagation: { value() { stopped = true; stop?.call(event); }, configurable: true },
      stopImmediatePropagation: { value() { stopped = immediate = true; stopNow?.call(event); }, configurable: true },
    });
  }
  for (const [name, value] of [["target", target], ["currentTarget", null], ["eventPhase", 0]]) {
    if (Object.getOwnPropertyDescriptor(event, name)?.writable) event[name] = value;
    else Object.defineProperty(event, name, { value, writable: true, configurable: true });
  }
  return event;
}

// The compatibility mouse event of `type` that follows pointer event `from`.
function mouseEvent(type, from, target) {
  const event = new Event(type, target);
  event.timeStamp = from.timeStamp;
  for (const name of ["clientX", "clientY", "x", "y", "button", "buttons", "detail", "shiftKey", "ctrlKey", "altKey", "metaKey"]) {
    event[name] = from[name];
  }
  if (type === "mousemove") event.button = 0;
  return event;
}

// Mouse events after a pointer event of a mouse or pen, as the web sends them: a prevented
// `pointerdown` mutes `mousedown`, `mousemove` and `mouseup` until the pointer lifts.
function compatMouse(kind, event, target) {
  const type = MOUSE_OF.get(event.type);
  if (!type) return;
  const pointer = pointers.get(event.pointerId);
  if (kind === 0 && event.defaultPrevented && pointer) pointer.mute = true;
  const muted = pointer?.mute && (kind === 0 || kind === 1 || kind === 3);
  if (kind === 1 && pointer) pointer.mute = false;
  if (muted || !event.isPrimary) return false;
  const mouse = mouseEvent(type, event, target);
  dispatchEvent(mouse);
  return mouse.defaultPrevented;
}

// The finger whose prevented `pointerdown` mutes its tap's mouse events.
let mutedTap = null;

// A tap's mouse events come just before its click, as on the web.
function compatTap(click, target) {
  if (mutedTap === click.pointerId) return;
  for (const type of ["mousemove", "mousedown", "mouseup"]) {
    const event = mouseEvent(type, click, target);
    event.buttons = type === "mousedown" ? 1 : 0;
    dispatchEvent(event);
  }
}

// The host calls this for every event record, before the tree runs the default action.
native.dispatch = function (kind, id, a, b, modifiers, d, e, first, second, third, fourth) {
  const target = nodes[id];
  if (!target) return false;
  if (kind >= CLOSE_REQUEST) return dispatchRequest(kind, target, a);
  if (kind >= COPY) return dispatchEditing(kind, target, first, second, third);
  if (kind === SELECTION_CHANGE && !(target instanceof Input)) return selectionRecord(target, a);
  if (target instanceof Image && (kind === LOAD || kind === ERROR)) target._onSourceEvent(kind === LOAD);
  if (kind === FOCUS) focusing(target);
  const event = new Event(TYPES[kind], target);
  event.isTrusted = true;
  fill(event, kind, a, b, modifiers, d, e, first, second, third, fourth);
  if (kind === FOCUS || kind === BLUR) event.relatedTarget = kind === FOCUS ? blurredNode : null;
  const live = target instanceof Svg && target._live && isPointerKind(kind);
  if (kind === CLICK && event.pointerType === "touch" && event.isPrimary) compatTap(event, target);
  // A live svg sends pointer records on to the element under the pointer.
  let prevented;
  if (live) prevented = target._pointer(event);
  else {
    dispatchEvent(event);
    prevented = event.defaultPrevented;
  }
  if (kind === FOCUS) {
    focusEvent("focusin", target, blurredNode);
    blurredNode = null;
    target._handleFocus?.();
  }
  else if (kind === BLUR) {
    blurring(target);
    target._handleBlur?.();
  }
  if (kind === 0 && openSelectPopup && !isInsideSelectPopup(target)) closeSelectPopup();
  if (kind === CLICK && !prevented && !activate(target)) follow(target);
  if (!prevented) {
    if ((kind === 0 || kind === 1 || kind === 3 || kind === 14) && target._handlePointer) target._handlePointer(kind, event);
    else if (kind === 7 && target._handleKey) target._handleKey(event);
  }
  if (kind !== CLICK && isPointerKind(kind)) {
    // A prevented mousedown keeps focus and the selection where they are, as on the web.
    if (event.pointerType !== "touch") {
      if (compatMouse(kind, event, live && event.target instanceof SvgElement ? event.target : target) && kind === 0) prevented = true;
    }
    // A finger's defaults (pan, focus, the tap's click) follow its touch events, not its
    // pointer events, as on the web.
    else {
      if (kind === 0 && event.isPrimary) mutedTap = prevented ? event.pointerId : null;
      return false;
    }
  }
  return prevented;
};

// The tree's requests, raised after an Escape, a back key or a back mouse button that nothing
// prevented: `closerequest` asks to close what is on top, as a web close watcher hears, and
// `navigate` asks to go back or forward, with `navigationType` "traverse" and `direction`
// "back" or "forward". The listener that acts stops the event; the tree does nothing itself.
function dispatchRequest(kind, target, forward) {
  const event = new Event(TYPES[kind], target);
  if (kind === NAVIGATE) {
    event.navigationType = "traverse";
    event.direction = forward ? "forward" : "back";
  }
  dispatchEvent(event);
  return event.defaultPrevented;
}

// Editing hosts, as the HTML Standard's contenteditable, the W3C Editing spec (execCommand)
// and the Input Events and UI Events specs have them. The tree sends a focused host's typing,
// composition, deleting, line breaks, pastes, undo and formatting keys as `beforeinput`
// records; unless a listener prevents one, the edit runs the Editing spec's command for it
// (typing is `insertText`, Enter `insertParagraph`, Backspace `delete`, as its "Additional
// requirements" say), and `input` follows. Editors that keep their own model (ProseMirror)
// prevent what they handle and read the rest back from the nodes, through mutation observers.

// The state of the contenteditable attribute: "true" and "plaintext-only" for an editing host
// keyword (the empty string is true), "false", or "inherit" (missing or invalid).
function contentEditableState(node) {
  const value = node.nodeType === 1 && typeof node.getAttribute === "function" ? node.getAttribute("contenteditable") : null;
  if (value === null) return "inherit";
  const lower = value.toLowerCase();
  if (lower === "" || lower === "true") return "true";
  if (lower === "plaintext-only" || lower === "false") return lower;
  return "inherit";
}

// "host" for an editing host, "false" for a contenteditable="false" element, else "".
function editableState(node) {
  const state = contentEditableState(node);
  if (state === "true" || state === "plaintext-only") return "host";
  return state === "false" ? "false" : "";
}

/** The editing host `node` is in (the outermost editable element up to a `contenteditable="false"`), or null. */
export function editingHostOf(node) {
  let host = null;
  for (let at = node; at; at = at.parentNode) {
    const state = editableState(at);
    if (state === "false") return host;
    if (state === "host") host = at;
  }
  return host;
}

// A `contenteditable="plaintext-only"` host takes raw text alone: rich formatting is off.
function isPlain(host) {
  return contentEditableState(host) === "plaintext-only";
}

export class CompositionEvent extends Event {
  constructor(type, init = {}) {
    super(String(type), null);
    this.bubbles = init.bubbles ?? true;
    this.cancelable = !!init.cancelable;
    this.composed = init.composed ?? true;
    this.data = init.data ?? "";
  }
}

globalThis.CompositionEvent ??= CompositionEvent;

// Caret steps, for the target ranges of deletes and for Selection.modify. A block here is an
// element whose display is not inline.
function isBlock(node) {
  if (node.nodeType !== 1 || node instanceof LineBreak) return false;
  const display = typeof node.nodeId === "number" ? String(readComputed(node.nodeId, "display") ?? "") : "";
  if (display) return !/^(inline|inline-block|inline-table|none|contents)$/.test(display);
  return node.kind === "box" && node._tag === undefined;
}

// The block `node` is in, inside `host` (the host itself when there is none).
function blockIn(host, node) {
  for (let at = node; at && at !== host; at = at.parentNode) if (isBlock(at)) return at;
  return host;
}

// What the caret steps over whole: an element that is not editable (`contenteditable="false"`
// inside the host), a `<br>`, or a replaced element (an image, a control, a canvas).
const REPLACED = new Set(["img", "svg", "video", "audio", "canvas", "iframe", "object", "embed", "input", "select", "textarea", "button", "meter", "progress"]);

function isAtom(node) {
  if (node.nodeType !== 1) return false;
  return node instanceof LineBreak || editableState(node) === "false" || node.kind !== "box" || REPLACED.has(node.localName);
}

function isLeaf(node) {
  return node.nodeType === 3 ? node.length > 0 : isAtom(node);
}

// The next node in tree order inside `within`, stepping over what is inside an atom.
function nextOutsideAtoms(node, within) {
  return following(node, within, isAtom(node));
}

// The node before `node` in tree order (its previous sibling's last descendant outside atoms,
// or its parent), inside `within`.
function preceding(node, within) {
  if (node === within) return null;
  let at = node.previousSibling;
  if (!at) return node.parentNode === within ? null : node.parentNode;
  while (at.lastChild && !isAtom(at)) at = at.lastChild;
  return at;
}

// The leaf before (or after) the point (`container`, `offset`) in tree order, inside `host`.
function leafBeside(host, container, offset, forward) {
  let at;
  if (forward) {
    at = container.nodeType === 3 ? following(container, host, true) : container.childNodes[offset] ?? following(container, host, true);
    for (; at; at = nextOutsideAtoms(at, host)) if (isLeaf(at)) return at;
    return null;
  }
  at = container.nodeType === 3 ? null : container.childNodes[offset - 1];
  if (at) while (at.lastChild && !isAtom(at)) at = at.lastChild;
  else at = preceding(container, host);
  for (; at; at = preceding(at, host)) if (isLeaf(at)) return at;
  return null;
}

const segmenter = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter() : null;

// The UTF-16 offset of the grapheme boundary before (or after) `offset` in `text`.
function graphemeStep(text, offset, forward) {
  if (segmenter) {
    let last = 0;
    for (const { index } of segmenter.segment(text)) {
      if (forward && index > offset) return index;
      if (!forward && index >= offset) return last;
      last = index;
    }
    return forward ? text.length : last;
  }
  const code = forward ? text.charCodeAt(offset) : text.charCodeAt(offset - 1);
  const pair = forward ? code >= 0xd800 && code < 0xdc00 : code >= 0xdc00 && code < 0xe000;
  return forward ? Math.min(text.length, offset + (pair ? 2 : 1)) : Math.max(0, offset - (pair ? 2 : 1));
}

function wordStep(text, offset, forward) {
  if (forward) {
    const rest = /^\s*\S*/.exec(text.slice(offset))[0];
    return offset + Math.max(rest.length, 1);
  }
  const before = /\S*\s*$/.exec(text.slice(0, offset))[0];
  return offset - Math.max(before.length, 1);
}

// The first point in text (or the start) inside `node`.
function startIn(node) {
  for (let at = node; at; at = nextOutsideAtoms(at, node)) {
    if (at.nodeType === 3) return [at, 0];
    if (at !== node && isAtom(at)) return [at.parentNode, indexIn(at)];
  }
  return [node, 0];
}

// The last point in text (or the end) inside `node`; before a `<br>` that ends it.
function endIn(node) {
  let at = node;
  while (at.lastChild && (at === node || !isAtom(at))) at = at.lastChild;
  if (at === node) return [node, node.childNodes.length];
  if (at.nodeType === 3) return [at, at.length];
  return [at.parentNode, indexIn(at) + (at instanceof LineBreak ? 0 : 1)];
}

// The point one `unit` ("character", "word", "line" to the line's edge, "paragraph" to the
// block's edge) before or after (`node`, `offset`), inside `host`. A step out of a block
// crosses only the boundary; a step onto an atom takes it whole.
function stepFrom(host, node, offset, forward, unit) {
  if (unit === "line") {
    const found = nativeLineStep(node, offset, forward, true);
    if (found && host.contains(found[0])) return found;
    unit = "paragraph";
  }
  const block = blockIn(host, node);
  if (unit === "paragraph") {
    const [edgeNode, edgeOffset] = forward ? endIn(block) : startIn(block);
    if (comparePoints(edgeNode, edgeOffset, node, offset) !== 0) return [edgeNode, edgeOffset];
  } else if (node.nodeType === 3 && (forward ? offset < node.length : offset > 0)) {
    const to = unit === "word" ? wordStep(node.data, offset, forward) : graphemeStep(node.data, offset, forward);
    return [node, Math.max(0, Math.min(node.length, to))];
  }
  const leaf = leafBeside(host, node, offset, forward);
  if (!leaf) return [node, offset];
  if (blockIn(host, leaf) !== block) return leaf.nodeType === 3 ? [leaf, forward ? 0 : leaf.length] : [leaf.parentNode, indexIn(leaf) + (forward ? 0 : 1)];
  if (leaf.nodeType === 3) {
    const edge = forward ? 0 : leaf.length;
    if (unit === "paragraph") return [leaf, edge];
    return stepFrom(host, leaf, edge, forward, unit);
  }
  return [leaf.parentNode, indexIn(leaf) + (forward ? 1 : 0)];
}

// A line step the tree lays out: to the line's edge (`boundary`), else to the next line. Null
// where the tree cannot tell (no layout, or a host without one).
function nativeLineStep(node, offset, forward, boundary) {
  if (!native.lineStep || typeof node.nodeId !== "number") return null;
  if (!native.lineStep(node.nodeId, offset, forward ? 1 : 0, boundary ? 1 : 0)) return null;
  const found = nodes[geometry(0)];
  return found ? fromTreePoint(found, geometry(1)) : null;
}

const compositions = new WeakMap();

function staticRange(startContainer, startOffset, endContainer, endOffset) {
  return new StaticRange({ startContainer, startOffset, endContainer, endOffset });
}

function editEvent(type, host, inputType, data, isComposing, cancelable, targetRanges = [], dataTransfer = null) {
  const event = new InputEvent(type, { bubbles: true, cancelable, composed: true, inputType, data, isComposing, targetRanges, dataTransfer });
  event.target = host;
  dispatchEvent(event);
  return event;
}

function compositionEvent(type, host, data) {
  const event = new CompositionEvent(type, { data, cancelable: type === "compositionstart" });
  event.target = host;
  dispatchEvent(event);
  return event;
}

// The selection's range when it is in `host`, else null.
function rangeIn(host) {
  const selection = getSelection();
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  return range && host.contains(range.startContainer) && host.contains(range.endContainer) ? range : null;
}

const DELETES = /^delete(Content|Word|SoftLine|HardLine)(Backward|Forward)$/;
const UNITS = { Content: "character", Word: "word", SoftLine: "line", HardLine: "paragraph" };

// What edit `inputType` changes, for its target ranges: the selection, or the step a
// collapsed delete takes. Null without a selection in `host`.
function targetOf(host, inputType, range) {
  if (!range) return null;
  const ends = [range.startContainer, range.startOffset, range.endContainer, range.endOffset];
  const match = range.collapsed && DELETES.exec(inputType);
  if (!match) return ends;
  const forward = match[2] === "Forward";
  const [node, offset] = stepFrom(host, ends[0], ends[1], forward, UNITS[match[1]]);
  return forward ? [ends[0], ends[1], node, offset] : [node, offset, ends[0], ends[1]];
}

// Edits that carry their data in `dataTransfer` in a rich host, as `data` in a plain one.
const TRANSFERS = new Set(["insertFromPaste", "insertFromDrop", "insertReplacementText", "insertFromYank", "insertFromPasteAsQuotation", "insertTranspose"]);

// The Editing spec's command for each input type a user's edit has, with its value.
const USER_COMMANDS = {
  insertText: "inserttext", insertReplacementText: "inserttext", insertFromYank: "inserttext",
  insertFromDrop: "inserttext", insertFromPaste: "inserttext", insertFromPasteAsQuotation: "inserttext",
  insertTranspose: "inserttext", insertParagraph: "insertparagraph", insertLineBreak: "insertlinebreak",
  insertOrderedList: "insertorderedlist", insertUnorderedList: "insertunorderedlist",
  insertHorizontalRule: "inserthorizontalrule", insertLink: "createlink",
  deleteContentBackward: "delete", deleteContentForward: "forwarddelete",
  formatBold: "bold", formatItalic: "italic", formatUnderline: "underline",
  formatStrikeThrough: "strikethrough", formatSuperscript: "superscript", formatSubscript: "subscript",
  formatJustifyFull: "justifyfull", formatJustifyCenter: "justifycenter", formatJustifyRight: "justifyright",
  formatJustifyLeft: "justifyleft", formatIndent: "indent", formatOutdent: "outdent", formatRemove: "removeformat",
  formatBackColor: "backcolor", formatFontColor: "forecolor", formatFontName: "fontname",
};
// Rich formatting, which a plaintext-only host does not take.
const RICH_COMMANDS = new Set([
  "backcolor", "bold", "createlink", "fontname", "fontsize", "forecolor", "hilitecolor", "italic", "removeformat",
  "strikethrough", "subscript", "superscript", "underline", "unlink", "formatblock", "indent", "outdent",
  "inserthorizontalrule", "inserthtml", "insertimage", "insertorderedlist", "insertunorderedlist",
  "justifycenter", "justifyfull", "justifyleft", "justifyright",
]);

// The edit `inputType` with `data` that the tree asked of `host`. Returns whether a listener
// prevented it.
function hostEdit(host, inputType, data) {
  if (inputType === "historyUndo" || inputType === "historyRedo") return historyStep(host, inputType === "historyRedo", true);
  const composing = compositions.get(host);
  if (inputType === "insertCompositionText" || composing && inputType === "insertText") return compose(host, data, composing, inputType === "insertText");
  const range = rangeIn(host);
  const target = targetOf(host, inputType, range);
  const plain = isPlain(host);
  let transfer = null;
  if (TRANSFERS.has(inputType)) {
    transfer = inputType === "insertFromPaste" ? pasted(host, data) : textTransfer(data);
    if (plain) transfer = null;
    else data = "";
  }
  const ranges = target ? [staticRange(...target)] : [];
  if (transfer) transfer._mode = "readonly";
  const event = editEvent("beforeinput", host, inputType, data || null, false, true, ranges, transfer);
  if (event.defaultPrevented || !target) {
    if (transfer) transfer._mode = "protected";
    return event.defaultPrevented;
  }
  const changed = recorded(host, historyKind(inputType), () => userEdit(host, inputType, data, target, transfer, plain));
  if (changed) editEvent("input", host, inputType, data || null, false, false, [], transfer);
  if (transfer) transfer._mode = "protected";
  return false;
}

// Runs the command for a user's edit over `target`. Returns whether it ran.
function userEdit(host, inputType, data, target, transfer, plain) {
  const selection = getSelection();
  const collapsed = target[0] === target[2] && target[1] === target[3];
  // Within a text node the target is the grapheme to delete. Across nodes, the delete commands
  // take their step from the caret themselves, a non-editable island whole.
  const fromCaret = selection.isCollapsed && target[0] !== target[2] && USER_COMMANDS[inputType] && DELETES.test(inputType);
  if (!collapsed && !fromCaret && DELETES.test(inputType)) selection.setBaseAndExtent(target[0], target[1], target[2], target[3]);
  if (inputType === "deleteByCut" || inputType === "deleteByDrag" || inputType === "deleteContent" || DELETES.test(inputType) && !USER_COMMANDS[inputType]) {
    if (collapsed) return false;
    return runCommand("delete", "");
  }
  let command = USER_COMMANDS[inputType];
  if (!command) return false;
  let value = data ?? "";
  if (transfer) {
    const html = inputType === "insertFromPaste" || inputType === "insertFromDrop" || inputType === "insertFromPasteAsQuotation" ? transfer.getData("text/html") : "";
    if (html) {
      command = "inserthtml";
      value = pastedMarkup(html);
    } else {
      value = transfer.getData("text/plain");
    }
  }
  if (plain) {
    if (RICH_COMMANDS.has(command)) return false;
    if (command === "insertparagraph" || command === "insertlinebreak") return plainLineBreak();
    if (command === "inserttext") return plainText(value);
  }
  return runCommand(command, value);
}

// A line break in a plaintext-only host: a line feed where white-space keeps them, else a
// `<br>`, which is how such text shows one.
function plainLineBreak() {
  const range = getActiveRange();
  const at = range.startContainer.nodeType === 3 ? range.startContainer.parentNode : range.startContainer;
  if (!/^(pre|pre-wrap|pre-line|break-spaces)/.test(getComputedStyle(at).whiteSpace)) return runCommand("insertlinebreak", "");
  const changed = plainText("\n");
  // As insertlinebreak follows a <br> that ends its block with a second: a line feed that ends
  // the block shows no line after it, so another one gives the caret its line.
  const { startContainer: node, startOffset: offset } = getActiveRange();
  if (changed && node.nodeType === 3 && offset === node.length && endsBlock(node)) node.insertData(offset, "\n");
  return changed;
}

// Whether nothing visible follows `node` in its block.
function endsBlock(node) {
  for (let at = node; at && !isBlockNode(at); at = at.parentNode) {
    for (let next = at.nextSibling; next; next = next.nextSibling) if (isVisible(next)) return false;
  }
  return true;
}

// Text into a plaintext-only host: line feeds stay line feeds.
function plainText(value) {
  literalLineFeeds = true;
  try {
    return runCommand("inserttext", value);
  } finally {
    literalLineFeeds = false;
  }
}

// Markup from the clipboard: the fragment between a page's StartFragment and EndFragment
// marks, or its body, sanitized as the Clipboard API asks of a paste: no scripts, styles,
// frames or event handler attributes, nor the classes and ids of the page it came from.
const PASTE_STRIPPED = new Set(["script", "style", "meta", "title", "link", "head", "base", "iframe", "frame", "object", "embed", "template", "noscript"]);

function pastedMarkup(html) {
  const marked = /<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/.exec(html);
  const body = /<body[^>]*>([\s\S]*?)(<\/body>|$)/i.exec(html);
  const holder = createElement("div");
  holder.innerHTML = marked ? marked[1] : body ? body[1] : html;
  const clean = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType !== 1) continue;
      if (PASTE_STRIPPED.has(child.localName)) {
        child.remove();
        continue;
      }
      for (const name of child.getAttributeNames()) {
        if (/^on/i.test(name) || name === "class" || name === "id" || name === "contenteditable") child.removeAttribute(name);
      }
      clean(child);
    }
  };
  clean(holder);
  return holder.innerHTML;
}

// The input method's composition, as UI Events and Input Events order it: compositionstart,
// then for each change of the text a beforeinput (not cancelable), compositionupdate and
// input of insertCompositionText, then compositionend. Committing (`insertText` while
// composing) keeps the text; an empty text cancels it.
function compose(host, data, composing, committing) {
  const range = rangeIn(host);
  if (!composing) {
    if (!data || !range) return false;
    compositionEvent("compositionstart", host, range.toString());
  }
  if (!committing || (composing && data !== composing.text)) {
    const ranges = composing
      ? [staticRange(composing.node, composing.offset, composing.node, composing.offset + composing.length)]
      : [staticRange(range.startContainer, range.startOffset, range.endContainer, range.endOffset)];
    editEvent("beforeinput", host, "insertCompositionText", data, true, false, ranges);
    compositionEvent("compositionupdate", host, data);
    let next = null;
    recorded(host, "typing", () => {
      if (composing && composing.node.parentNode && composing.node.nodeType === 3) {
        const length = Math.min(composing.length, composing.node.length - composing.offset);
        getSelection().setBaseAndExtent(composing.node, composing.offset, composing.node, composing.offset + length);
      }
      const selection = getSelection().getRangeAt(0);
      if (!selection.collapsed) runCommand("delete", "");
      const start = [getActiveRangeNow().startContainer, getActiveRangeNow().startOffset];
      if (data) runCommand("inserttext", data);
      const end = getActiveRangeNow();
      const node = end.startContainer;
      const offset = node.nodeType === 3 ? end.startOffset - data.length : start[1];
      next = { node, offset: Math.max(0, offset), length: data.length, text: data };
      return true;
    });
    editEvent("input", host, "insertCompositionText", data || null, true, false);
    if (data) compositions.set(host, next);
  }
  if (committing || !data) {
    compositions.delete(host);
    compositionEvent("compositionend", host, data);
  }
  return false;
}

function getActiveRangeNow() {
  return getSelection().getRangeAt(0);
}

function pasted(host, text) {
  const last = lastPaste;
  lastPaste = null;
  if (last && last.host === host) return last.data;
  return textTransfer(text);
}

function textTransfer(text) {
  const transfer = new DataTransfer();
  if (text) transfer.setData("text/plain", text);
  return transfer;
}

// The paste whose `insertFromPaste` comes next, with the clipboard's markup.
let lastPaste = null;

// Undo and redo, as a browser keeps them for editing hosts: each edit records its changes
// (the mutation records of the host) with the selection before and after. Typing in a row,
// and deleting in a row, undo as one step, until the caret moves elsewhere.
const histories = new WeakMap();
const HISTORY_LIMIT = 100;

function historyKind(inputType) {
  if (inputType === "insertText" || inputType === "insertParagraph" || inputType === "insertLineBreak") return "typing";
  if (/^delete.*Backward$/.test(inputType)) return "backward";
  if (/^delete.*Forward$/.test(inputType)) return "forward";
  return null;
}

// The selection's ends, without asking the tree when a script just set them.
const selectionNow = () => getSelection()._ends();

const sameSelection = (a, b) => a === b || !!a && !!b && a.every((value, i) => value === b[i]);

// Runs `edit` with the host's changes recorded for undo (as `kind`, to join a run of them).
// Returns whether `edit` changed the host.
function recorded(host, kind, edit) {
  const recorder = new MutationObserver(() => {});
  recorder.observe(host, { childList: true, subtree: true, characterData: true, characterDataOldValue: true, attributes: true, attributeOldValue: true });
  const before = selectionNow();
  let records;
  try {
    edit();
  } finally {
    records = recorder.takeRecords();
    recorder.disconnect();
  }
  if (!records.length) return false;
  let history = histories.get(host);
  if (!history) histories.set(host, (history = { undo: [], redo: [] }));
  const after = selectionNow();
  const last = history.undo[history.undo.length - 1];
  if (kind && last && last.kind === kind && !history.redo.length && sameSelection(last.after, before)) {
    last.records.push(...records);
    last.after = after;
  } else {
    history.undo.push({ kind, records, before, after });
    if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
  }
  history.redo.length = 0;
  return true;
}

// Undoes (or redoes) the host's last step; `events` fires beforeinput and input, as keys and
// the edit menu do (the Editing spec's undo and redo commands fire none). Returns whether a
// listener prevented it.
function historyStep(host, redo, events) {
  const history = histories.get(host);
  const stack = redo ? history?.redo : history?.undo;
  if (!stack?.length) return false;
  const inputType = redo ? "historyRedo" : "historyUndo";
  if (events && editEvent("beforeinput", host, inputType, null, false, true, []).defaultPrevented) return true;
  const step = stack.pop();
  if (redo) for (const record of step.records) replay(record, true);
  else for (let i = step.records.length - 1; i >= 0; i--) replay(step.records[i], false);
  (redo ? history.undo : history.redo).push(step);
  const ends = redo ? step.after : step.before;
  const selection = getSelection();
  if (ends && inDocument(ends[0]) && inDocument(ends[2])) {
    try {
      selection.setBaseAndExtent(ends[0], Math.min(ends[1], nodeLength(ends[0])), ends[2], Math.min(ends[3], nodeLength(ends[2])));
      // The undo and redo commands end with this selection, not the active range they began with.
      globalRange = null;
    } catch {
      // A node the step left behind has gone: the selection stays where it is.
    }
  }
  if (events) editEvent("input", host, inputType, null, false, false);
  return false;
}

// Undoes (or with `forward`, redoes) one mutation record. Changes a script made since are kept
// where they do not collide: a record that no longer fits is passed over.
function replay(record, forward) {
  const target = record.target;
  try {
    if (record.type === "characterData") {
      const now = target.data;
      target.data = forward ? record._newValue : record.oldValue;
      if (!forward) record._newValue = now;
    } else if (record.type === "attributes") {
      const now = target.getAttribute(record.attributeName);
      const value = forward ? record._newValue : record.oldValue;
      if (!forward) record._newValue = now;
      if (value === null) target.removeAttribute(record.attributeName);
      else target.setAttribute(record.attributeName, value);
    } else {
      const out = forward ? record.removedNodes : record.addedNodes;
      const back = forward ? record.addedNodes : record.removedNodes;
      for (const node of out) if (node.parentNode === target) node.remove();
      const next = record.nextSibling?.parentNode === target ? record.nextSibling
        : record.previousSibling?.parentNode === target ? record.previousSibling.nextSibling : null;
      for (const node of back) target.insertBefore(node, next);
    }
  } catch {
    // The record no longer fits the nodes: a script changed them in a way this step cannot undo.
  }
}

/** Moves or extends the selection by `granularity` in `direction`, as the Selection API's `modify` does. */
function modifySelection(selection, alter, direction, granularity) {
  alter = String(alter).toLowerCase();
  direction = String(direction).toLowerCase();
  granularity = String(granularity).toLowerCase();
  if (alter !== "move" && alter !== "extend") return;
  if (!["forward", "backward", "left", "right"].includes(direction)) return;
  if (!selection.rangeCount) return;
  const forward = direction === "forward" || direction === "right";
  const anchor = [selection.anchorNode, selection.anchorOffset];
  let focus = [selection.focusNode, selection.focusOffset];
  const host = editingHostOf(focus[0]) ?? rootOf(focus[0]);
  if (alter === "move" && !selection.isCollapsed) {
    const range = selection.getRangeAt(0);
    focus = forward ? [range.endContainer, range.endOffset] : [range.startContainer, range.startOffset];
    if (granularity === "character") return selection.collapse(focus[0], focus[1]);
  }
  let next;
  switch (granularity) {
    case "character":
    case "word":
      next = stepFrom(host, focus[0], focus[1], forward, granularity);
      break;
    case "line":
      next = nativeLineStep(focus[0], focus[1], forward, false) ?? blockStep(host, focus, forward);
      break;
    case "lineboundary":
      next = nativeLineStep(focus[0], focus[1], forward, true) ?? stepFrom(host, focus[0], focus[1], forward, "paragraph");
      break;
    case "sentence":
    case "sentenceboundary":
    case "paragraphboundary":
      next = stepFrom(host, focus[0], focus[1], forward, "paragraph");
      break;
    case "paragraph":
      next = blockStep(host, focus, forward);
      break;
    case "documentboundary":
      next = forward ? endIn(host) : startIn(host);
      break;
    default:
      return;
  }
  if (!host.contains(next[0])) return;
  if (alter === "move") selection.collapse(next[0], next[1]);
  else selection.setBaseAndExtent(anchor[0], anchor[1], next[0], next[1]);
}

// The same place in the next (or previous) block: its edge, as a line step falls back to.
function blockStep(host, [node, offset], forward) {
  const edge = stepFrom(host, node, offset, forward, "paragraph");
  const out = stepFrom(host, edge[0], edge[1], forward, "character");
  return comparePoints(out[0], out[1], edge[0], edge[1]) === 0 ? edge : stepFrom(host, out[0], out[1], forward, "paragraph");
}

// execCommand and the queryCommand methods, as the Editing spec's "Methods to query and
// execute commands" has them. The commands are below.

// "Miscellaneous commands": no beforeinput or input of their own.
const MISCELLANEOUS = new Set(["copy", "cut", "paste", "defaultparagraphseparator", "redo", "selectall", "stylewithcss", "undo", "usecss"]);

// "To map an edit command to input type value". The table leaves out italic, underline,
// subscript and removeFormat, which take the input types Input Events names for them.
const COMMAND_INPUT_TYPES = {
  italic: "formatItalic", underline: "formatUnderline", subscript: "formatSubscript", removeformat: "formatRemove",
  backcolor: "formatBackColor", bold: "formatBold", createlink: "insertLink", fontname: "formatFontName",
  forecolor: "formatFontColor", strikethrough: "formatStrikeThrough", superscript: "formatSuperscript",
  delete: "deleteContentBackward", forwarddelete: "deleteContentForward", indent: "formatIndent",
  inserthorizontalrule: "insertHorizontalRule", insertlinebreak: "insertLineBreak",
  insertorderedlist: "insertOrderedList", insertparagraph: "insertParagraph", inserttext: "insertText",
  insertunorderedlist: "insertUnorderedList", justifycenter: "formatJustifyCenter",
  justifyfull: "formatJustifyFull", justifyleft: "formatJustifyLeft", justifyright: "formatJustifyRight",
  outdent: "formatOutdent", cut: "deleteByCut", paste: "insertFromPaste", redo: "historyRedo", undo: "historyUndo",
};

// The editing host that holds both ends of the active range, and no other editing host that does.
function affectedEditingHost() {
  const range = getActiveRange();
  if (!range) return null;
  for (let at = range.commonAncestorContainer; at; at = at.parentNode) if (isEditingHost(at)) return at;
  return null;
}

// Above zero while a command runs.
let commandDepth = 0;

// The ranges made while an editing command runs, or null.
let commandRanges = null;

// The selection as the command left the active range, when the command replaced the
// selection's range on the way (some steps select a stand-in range while they split text).
function selectActiveRange() {
  const active = globalRange;
  if (!active || !inDocument(active.startContainer) || !inDocument(active.endContainer)) return;
  const selection = getSelection();
  const now = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (now === active) return;
  if (now && now.startContainer === active.startContainer && now.startOffset === active.startOffset
    && now.endContainer === active.endContainer && now.endOffset === active.endOffset) return;
  selection.setBaseAndExtent(active.startContainer, active.startOffset, active.endContainer, active.endOffset);
}

// Runs `action` as a command: nested commands share its active range.
function withActiveRange(action) {
  if (commandDepth === 0) {
    globalRange = null;
    commandRanges = [];
  }
  commandDepth++;
  try {
    return action();
  } finally {
    commandDepth--;
    if (commandDepth === 0) {
      selectActiveRange();
      globalRange = null;
      // The algorithms' own ranges are garbage once the command ends, but a WeakRef keeps
      // each until a full collection, and every mutation walks the live ones: they leave
      // now. A range the selection took (it hooks _changed) stays.
      for (const range of commandRanges) if (!Object.hasOwn(range, "_changed")) liveRanges.delete(range._live);
      commandRanges = null;
    }
  }
}

// Takes the action of `command` (supported and enabled) with `value`. Returns its result.
function runCommand(command, value) {
  return withActiveRange(() => {
    if (!(command in commands) || !commandEnabled(command)) return false;
    return commands[command].action(String(value)) === true;
  });
}

function commandEnabled(command) {
  if (!(command in commands)) return false;
  if (command === "undo" || command === "redo" || command === "copy" || command === "defaultparagraphseparator" || command === "selectall" || command === "stylewithcss" || command === "usecss") return true;
  const range = getActiveRange();
  if (!range) return false;
  const start = range.startContainer;
  const end = range.endContainer;
  if (!(isEditable(start) || isEditingHost(start)) || !(isEditable(end) || isEditingHost(end))) return false;
  const host = affectedEditingHost();
  if (!host) return false;
  return !(isPlain(host) && RICH_COMMANDS.has(command));
}

/**
 * Runs editing command `command` with `value` on the selection, as the Editing spec's
 * execCommand does: beforeinput first (a listener can cancel it), then the command, then
 * input when the editing host changed. Returns whether the command ran.
 */
export function execCommand(command, _showUI = false, value = "") {
  command = String(command).toLowerCase();
  return withActiveRange(() => {
    if (!commandEnabled(command)) return false;
    let host = null;
    const inputType = COMMAND_INPUT_TYPES[command] ?? "";
    if (!MISCELLANEOUS.has(command)) {
      host = affectedEditingHost();
      if (editEvent("beforeinput", host, inputType, null, false, true, []).defaultPrevented) return false;
      globalRange = null;
      if (!commandEnabled(command)) return false;
      host = affectedEditingHost();
    }
    let result = false;
    const changed = host
      ? recorded(host, historyKind(inputType), () => { result = commands[command].action(String(value)) === true; })
      : (result = commands[command].action(String(value)) === true, false);
    if (!result) return false;
    if (changed) editEvent("input", host, inputType, null, false, false);
    return true;
  });
}

/** Whether `execCommand` knows `command`. */
export function queryCommandSupported(command) {
  return String(command).toLowerCase() in commands;
}

/** Whether `command` is supported and enabled: the active range is in one editing host. */
export function queryCommandEnabled(command) {
  command = String(command).toLowerCase();
  return withActiveRange(() => commandEnabled(command));
}

/** Whether `command` is indeterminate over the active range (some of it formatted, some not). */
export function queryCommandIndeterm(command) {
  command = String(command).toLowerCase();
  return withActiveRange(() => command in commands && "indeterm" in commands[command] ? !!commands[command].indeterm() : false);
}

/** The state of `command` over the active range, as its state override has it when one is set. */
export function queryCommandState(command) {
  command = String(command).toLowerCase();
  return withActiveRange(() => {
    if (!(command in commands) || !("state" in commands[command])) return false;
    if (getActiveRange() && getStateOverride(command) !== undefined) return getStateOverride(command);
    return !!commands[command].state();
  });
}

/** The value of `command` over the active range, as its value override has it when one is set. */
export function queryCommandValue(command) {
  command = String(command).toLowerCase();
  return withActiveRange(() => {
    if (!(command in commands) || !("value" in commands[command])) return "";
    if (getActiveRange()) {
      if (command === "fontsize" && getValueOverride("fontsize") !== undefined) return getLegacyFontSize(getValueOverride("fontsize"));
      if (getValueOverride(command) !== undefined) return getValueOverride(command);
    }
    return commands[command].value();
  });
}

// What the ported algorithms below take from the DOM.
const DOM = {
  ELEMENT_NODE: 1, TEXT_NODE: 3, PROCESSING_INSTRUCTION_NODE: 7, COMMENT_NODE: 8, DOCUMENT_NODE: 9,
  DOCUMENT_TYPE_NODE: 10, DOCUMENT_FRAGMENT_NODE: 11,
  DOCUMENT_POSITION_DISCONNECTED: 1, DOCUMENT_POSITION_PRECEDING: 2, DOCUMENT_POSITION_FOLLOWING: 4,
  DOCUMENT_POSITION_CONTAINS: 8, DOCUMENT_POSITION_CONTAINED_BY: 16,
};

// Node.compareDocumentPosition(a, b), for nodes in a tree.
function documentPosition(a, b) {
  if (a === b) return 0;
  const chain = (node) => { const list = []; for (; node; node = node.parentNode) list.unshift(node); return list; };
  const mine = chain(a);
  const theirs = chain(b);
  // Nodes in different trees: disconnected, in an order that stays the same both ways (no
  // node, as some steps pass at the end of a walk, comes after everything).
  if (mine[0] !== theirs[0]) {
    return DOM.DOCUMENT_POSITION_DISCONNECTED | 32
      | (!mine.length || !theirs.length || mine[0].nodeId < theirs[0].nodeId ? DOM.DOCUMENT_POSITION_FOLLOWING : DOM.DOCUMENT_POSITION_PRECEDING);
  }
  let depth = 0;
  while (mine[depth] === theirs[depth]) depth++;
  if (depth === mine.length) return DOM.DOCUMENT_POSITION_CONTAINED_BY | DOM.DOCUMENT_POSITION_FOLLOWING;
  if (depth === theirs.length) return DOM.DOCUMENT_POSITION_CONTAINS | DOM.DOCUMENT_POSITION_PRECEDING;
  const siblings = mine[depth - 1].childNodes;
  return siblings.indexOf(theirs[depth]) > siblings.indexOf(mine[depth]) ? DOM.DOCUMENT_POSITION_FOLLOWING : DOM.DOCUMENT_POSITION_PRECEDING;
}

// An element's attributes, as Element.attributes lists them.
function attributesOf(node) {
  return (node.getAttributeNames?.() ?? []).map((name) => ({ name, value: node.getAttribute(name), namespaceURI: null }));
}

// The body element, else the root.
function documentBody() {
  return rootNode?.childNodes?.find?.((child) => child.localName === "body") ?? rootNode;
}

// The legacy font sizes 1 to 7 in pixels, as the HTML Standard's rendering maps them from a
// medium of 16px.
const LEGACY_FONT_PIXELS = {
  "x-small": "10px", small: "13px", medium: "16px", large: "18px", "x-large": "24px", "xx-large": "32px", "xxx-large": "48px",
};

// An absolute CSS length in pixels.
function cssLengthInPixels(length) {
  const match = /^([0-9]+(?:\.[0-9]+)?)(cm|mm|in|pt|pc|px)$/.exec(length);
  if (!match) return NaN;
  const per = { px: 1, pt: 4 / 3, pc: 16, in: 96, cm: 96 / 2.54, mm: 96 / 25.4 }[match[2]];
  return Number(match[1]) * per;
}

const NAMED_COLORS = Object.fromEntries(("aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32")
  .split(" ").reduce((pairs, word, index, words) => (index % 2 ? pairs : [...pairs, [word, words[index + 1]]]), []));

// A CSS color as CSSOM serializes a computed one ("rgb(r, g, b)", or "rgba(r, g, b, a)" when
// not opaque), or null for currentcolor and for what is not a color.
function parseCssColor(text) {
  const value = String(text).trim().toLowerCase();
  if (value === "transparent") return "rgba(0, 0, 0, 0)";
  const serialize = (r, g, b, a) => {
    const [x, y, z] = [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))));
    const alpha = Math.max(0, Math.min(1, a));
    return alpha === 1 ? "rgb(" + x + ", " + y + ", " + z + ")" : "rgba(" + x + ", " + y + ", " + z + ", " + Math.round(alpha * 1000) / 1000 + ")";
  };
  let hex = NAMED_COLORS[value] ?? (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(value)?.[1] ?? null);
  if (hex) {
    if (hex.length <= 4) hex = [...hex].map((c) => c + c).join("");
    const parts = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2) || "ff", 16));
    return serialize(parts[0], parts[1], parts[2], parts[3] / 255);
  }
  const call = /^(rgba?|hsla?)\((.*)\)$/.exec(value);
  if (!call) return null;
  const args = call[2].split(/\s*[,/]\s*|\s+/).filter(Boolean);
  if (args.length < 3 || args.length > 4) return null;
  const alpha = args[3] === undefined ? 1 : args[3].endsWith("%") ? parseFloat(args[3]) / 100 : parseFloat(args[3]);
  if (Number.isNaN(alpha)) return null;
  if (call[1].startsWith("rgb")) {
    const channels = args.slice(0, 3).map((arg) => (arg.endsWith("%") ? parseFloat(arg) * 2.55 : parseFloat(arg)));
    if (channels.some(Number.isNaN)) return null;
    return serialize(channels[0], channels[1], channels[2], alpha);
  }
  const h = (((parseFloat(args[0]) % 360) + 360) % 360) / 360;
  const s = parseFloat(args[1]) / 100;
  const l = parseFloat(args[2]) / 100;
  if ([h, s, l].some(Number.isNaN)) return null;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    t = (t + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return serialize(channel(h + 1 / 3) * 255, channel(h) * 255, channel(h - 1 / 3) * 255, alpha);
}

// Moves `node` to index `newIndex` of `newParent` (counted before it leaves its old place),
// keeping every live range's boundary points with the content, as the Editing spec's "move
// preserving ranges" has it instead of the usual range mutation rules.
function moveNodePreservingRanges(node, newParent, newIndex) {
  const oldParent = node.parentNode;
  const oldIndex = oldParent ? indexIn(node) : -1;
  const before = newParent.childNodes[newIndex] ?? null;
  const moved = [];
  const adjust = (point) => {
    if (point[0] === newParent && point[1] > newIndex) point[1]++;
    if (point[0] === oldParent && (point[1] === oldIndex || point[1] === oldIndex + 1)) {
      point[0] = newParent;
      point[1] += newIndex - oldIndex;
    } else if (point[0] === oldParent && point[1] > oldIndex + 1) {
      point[1]--;
    }
    return point;
  };
  eachLiveRange((range) => moved.push([range, adjust([range._startNode, range._startOffset]), adjust([range._endNode, range._endOffset])]));
  rangesPaused++;
  try {
    if (before === node) newParent.insertBefore(node, node.nextSibling);
    else newParent.insertBefore(node, before);
  } finally {
    rangesPaused--;
  }
  for (const [range, start, end] of moved) {
    const changed = range._startNode !== start[0] || range._startOffset !== start[1] || range._endNode !== end[0] || range._endOffset !== end[1];
    range._startNode = start[0];
    range._startOffset = start[1];
    range._endNode = end[0];
    range._endOffset = end[1];
    if (changed) range._changed();
  }
}

// Text that insertText takes with its line feeds as text, for a plaintext-only host.
let literalLineFeeds = false;

// The Editing spec's algorithms and commands, after its reference implementation by Aryeh
// Gregor (web-platform-tests editing/include/implementation.js, 3-Clause BSD License,
// Copyright © web-platform-tests contributors). The quoted lines are the spec's steps.
// Where the spec defines something by layout (a collapsed or extraneous line break), it is
// read from the tree's structure and computed style instead.


var htmlNamespace = "http://www.w3.org/1999/xhtml";

var cssStylingFlag = false;

var defaultSingleLineContainerName = "div";

// This is bad :(
var globalRange = null;

// Commands are stored in a dictionary where we call their actions and such
var commands = {};

///////////////////////////////////////////////////////////////////////////////
////////////////////////////// Utility functions //////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//@{

function nextNode(node) {
    if (node.hasChildNodes()) {
        return node.firstChild;
    }
    return nextNodeDescendants(node);
}

function previousNode(node) {
    if (node.previousSibling) {
        node = node.previousSibling;
        while (node.hasChildNodes()) {
            node = node.lastChild;
        }
        return node;
    }
    if (node.parentNode
    && node.parentNode.nodeType == DOM.ELEMENT_NODE) {
        return node.parentNode;
    }
    return null;
}

function nextNodeDescendants(node) {
    while (node && !node.nextSibling) {
        node = node.parentNode;
    }
    if (!node) {
        return null;
    }
    return node.nextSibling;
}

/**
 * Returns true if ancestor is an ancestor of descendant, false otherwise.
 */
function isAncestor(ancestor, descendant) {
    return ancestor
        && descendant
        && Boolean(documentPosition(ancestor, descendant) & DOM.DOCUMENT_POSITION_CONTAINED_BY);
}

/**
 * Returns true if ancestor is an ancestor of or equal to descendant, false
 * otherwise.
 */
function isAncestorContainer(ancestor, descendant) {
    return (ancestor || descendant)
        && (ancestor == descendant || isAncestor(ancestor, descendant));
}

/**
 * Returns true if descendant is a descendant of ancestor, false otherwise.
 */
function isDescendant(descendant, ancestor) {
    return ancestor
        && descendant
        && Boolean(documentPosition(ancestor, descendant) & DOM.DOCUMENT_POSITION_CONTAINED_BY);
}

/**
 * Returns true if node1 is before node2 in tree order, false otherwise.
 */
function isBefore(node1, node2) {
    return Boolean(documentPosition(node1, node2) & DOM.DOCUMENT_POSITION_FOLLOWING);
}

/**
 * Returns true if node1 is after node2 in tree order, false otherwise.
 */
function isAfter(node1, node2) {
    return Boolean(documentPosition(node1, node2) & DOM.DOCUMENT_POSITION_PRECEDING);
}

function getAncestors(node) {
    var ancestors = [];
    while (node.parentNode) {
        ancestors.unshift(node.parentNode);
        node = node.parentNode;
    }
    return ancestors;
}

function getInclusiveAncestors(node) {
    return getAncestors(node).concat(node);
}

function getDescendants(node) {
    var descendants = [];
    var stop = nextNodeDescendants(node);
    while ((node = nextNode(node))
    && node != stop) {
        descendants.push(node);
    }
    return descendants;
}

function getInclusiveDescendants(node) {
    return [node].concat(getDescendants(node));
}

function convertProperty(property) {
    // Special-case for now
    var map = {
        "fontFamily": "font-family",
        "fontSize": "font-size",
        "fontStyle": "font-style",
        "fontWeight": "font-weight",
        "textDecoration": "text-decoration",
    };
    if (typeof map[property] != "undefined") {
        return map[property];
    }

    return property;
}

// Return the <font size=X> value for the given CSS size, or undefined if there
// is none.
function cssSizeToLegacy(cssVal) {
    return {
        "x-small": 1,
        "small": 2,
        "medium": 3,
        "large": 4,
        "x-large": 5,
        "xx-large": 6,
        "xxx-large": 7
    }[cssVal];
}

// Return the CSS size given a legacy size.
function legacySizeToCss(legacyVal) {
    return {
        1: "x-small",
        2: "small",
        3: "medium",
        4: "large",
        5: "x-large",
        6: "xx-large",
        7: "xxx-large",
    }[legacyVal];
}

// Opera 11 puts HTML elements in the null namespace, it seems.
// Core's elements carry no namespaceURI of their own unless they are svg (globals.js gives
// them the HTML one): undefined is the HTML namespace too.
function isHtmlNamespace(ns) {
    return ns === null
        || ns === undefined
        || ns === htmlNamespace;
}

// "the directionality" from HTML.  I don't bother caring about non-HTML
// elements.
//
// "The directionality of an element is either 'ltr' or 'rtl', and is
// determined as per the first appropriate set of steps from the following
// list:"
function getDirectionality(element) {
    // "If the element's dir attribute is in the ltr state
    //     The directionality of the element is 'ltr'."
    if (element.dir == "ltr") {
        return "ltr";
    }

    // "If the element's dir attribute is in the rtl state
    //     The directionality of the element is 'rtl'."
    if (element.dir == "rtl") {
        return "rtl";
    }

    // "If the element's dir attribute is in the auto state
    // "If the element is a bdi element and the dir attribute is not in a
    // defined state (i.e. it is not present or has an invalid value)
    //     [lots of complicated stuff]
    //
    // Skip this, since no browser implements it anyway.

    // "If the element is a root element and the dir attribute is not in a
    // defined state (i.e. it is not present or has an invalid value)
    //     The directionality of the element is 'ltr'."
    if (!isHtmlElement(element.parentNode)) {
        return "ltr";
    }

    // "If the element has a parent element and the dir attribute is not in a
    // defined state (i.e. it is not present or has an invalid value)
    //     The directionality of the element is the same as the element's
    //     parent element's directionality."
    return getDirectionality(element.parentNode);
}

//@}

///////////////////////////////////////////////////////////////////////////////
///////////////////////////// DOM Range functions /////////////////////////////
///////////////////////////////////////////////////////////////////////////////
//@{

function getNodeIndex(node) {
    return indexIn(node);
}

// "The length of a Node node is the following, depending on node:
//
// ProcessingInstruction
// DocumentType
//   Always 0.
// Text
// Comment
//   node's length.
// Any other node
//   node's childNodes's length."
function getNodeLength(node) {
    switch (node.nodeType) {
        case DOM.PROCESSING_INSTRUCTION_NODE:
        case DOM.DOCUMENT_TYPE_NODE:
            return 0;

        case DOM.TEXT_NODE:
        case DOM.COMMENT_NODE:
            return node.length;

        default:
            return node.childNodes.length;
    }
}

/**
 * The position of two boundary points relative to one another, as defined by
 * DOM Range.
 */
function getPosition(nodeA, offsetA, nodeB, offsetB) {
    // "If node A is the same as node B, return equal if offset A equals offset
    // B, before if offset A is less than offset B, and after if offset A is
    // greater than offset B."
    if (nodeA == nodeB) {
        if (offsetA == offsetB) {
            return "equal";
        }
        if (offsetA < offsetB) {
            return "before";
        }
        if (offsetA > offsetB) {
            return "after";
        }
    }

    // "If node A is after node B in tree order, compute the position of (node
    // B, offset B) relative to (node A, offset A). If it is before, return
    // after. If it is after, return before."
    if (documentPosition(nodeB, nodeA) & DOM.DOCUMENT_POSITION_FOLLOWING) {
        var pos = getPosition(nodeB, offsetB, nodeA, offsetA);
        if (pos == "before") {
            return "after";
        }
        if (pos == "after") {
            return "before";
        }
    }

    // "If node A is an ancestor of node B:"
    if (documentPosition(nodeB, nodeA) & DOM.DOCUMENT_POSITION_CONTAINS) {
        // "Let child equal node B."
        var child = nodeB;

        // "While child is not a child of node A, set child to its parent."
        while (child.parentNode != nodeA) {
            child = child.parentNode;
        }

        // "If the index of child is less than offset A, return after."
        if (getNodeIndex(child) < offsetA) {
            return "after";
        }
    }

    // "Return before."
    return "before";
}

/**
 * Returns the furthest ancestor of a Node as defined by DOM Range.
 */
function getFurthestAncestor(node) {
    var root = node;
    while (root.parentNode != null) {
        root = root.parentNode;
    }
    return root;
}

/**
 * "contained" as defined by DOM Range: "A Node node is contained in a range
 * range if node's furthest ancestor is the same as range's root, and (node, 0)
 * is after range's start, and (node, length of node) is before range's end."
 */
function isContained(node, range) {
    var pos1 = getPosition(node, 0, range.startContainer, range.startOffset);
    var pos2 = getPosition(node, getNodeLength(node), range.endContainer, range.endOffset);

    return getFurthestAncestor(node) == getFurthestAncestor(range.startContainer)
        && pos1 == "after"
        && pos2 == "before";
}

/**
 * Return all nodes contained in range that the provided function returns true
 * for, omitting any with an ancestor already being returned.
 */
function getContainedNodes(range, condition) {
    if (typeof condition == "undefined") {
        condition = function() { return true };
    }
    var node = range.startContainer;
    if (node.hasChildNodes()
    && range.startOffset < node.childNodes.length) {
        // A child is contained
        node = node.childNodes[range.startOffset];
    } else if (range.startOffset == getNodeLength(node)) {
        // No descendant can be contained
        node = nextNodeDescendants(node);
    } else {
        // No children; this node at least can't be contained
        node = nextNode(node);
    }

    var stop = range.endContainer;
    if (stop.hasChildNodes()
    && range.endOffset < stop.childNodes.length) {
        // The node after the last contained node is a child
        stop = stop.childNodes[range.endOffset];
    } else {
        // This node and/or some of its children might be contained
        stop = nextNodeDescendants(stop);
    }

    var nodeList = [];
    while (isBefore(node, stop)) {
        if (isContained(node, range)
        && condition(node)) {
            nodeList.push(node);
            node = nextNodeDescendants(node);
            continue;
        }
        node = nextNode(node);
    }
    return nodeList;
}

/**
 * As above, but includes nodes with an ancestor that's already been returned.
 */
function getAllContainedNodes(range, condition) {
    if (typeof condition == "undefined") {
        condition = function() { return true };
    }
    var node = range.startContainer;
    if (node.hasChildNodes()
    && range.startOffset < node.childNodes.length) {
        // A child is contained
        node = node.childNodes[range.startOffset];
    } else if (range.startOffset == getNodeLength(node)) {
        // No descendant can be contained
        node = nextNodeDescendants(node);
    } else {
        // No children; this node at least can't be contained
        node = nextNode(node);
    }

    var stop = range.endContainer;
    if (stop.hasChildNodes()
    && range.endOffset < stop.childNodes.length) {
        // The node after the last contained node is a child
        stop = stop.childNodes[range.endOffset];
    } else {
        // This node and/or some of its children might be contained
        stop = nextNodeDescendants(stop);
    }

    var nodeList = [];
    while (isBefore(node, stop)) {
        if (isContained(node, range)
        && condition(node)) {
            nodeList.push(node);
        }
        node = nextNode(node);
    }
    return nodeList;
}

// Returns either null, or something of the form rgb(x, y, z), or something of
// the form rgb(x, y, z, w) with w != 0.
function normalizeColor(color) {
    return parseCssColor(color);
}

// Returns either null, or something of the form #xxxxxx.
function parseSimpleColor(color) {
    color = normalizeColor(color);
    var matches = /^rgb\(([0-9]+), ([0-9]+), ([0-9]+)\)$/.exec(color);
    if (matches) {
        return "#"
            + parseInt(matches[1]).toString(16).replace(/^.$/, "0$&")
            + parseInt(matches[2]).toString(16).replace(/^.$/, "0$&")
            + parseInt(matches[3]).toString(16).replace(/^.$/, "0$&");
    }
    return null;
}

//@}

//////////////////////////////////////////////////////////////////////////////
/////////////////////////// Edit command functions ///////////////////////////
//////////////////////////////////////////////////////////////////////////////

/////////////////////////////////////////////////
///// Methods of the HTMLDocument interface /////
/////////////////////////////////////////////////
//@{

//////////////////////////////
///// Common definitions /////
//////////////////////////////
//@{

// "An HTML element is an Element whose namespace is the HTML namespace."
//
// I allow an extra argument to more easily check whether something is a
// particular HTML element, like isHtmlElement(node, "OL").  It accepts arrays
// too, like isHtmlElement(node, ["OL", "UL"]) to check if it's an ol or ul.
function isHtmlElement(node, tags) {
    if (typeof tags == "string") {
        tags = [tags];
    }
    if (typeof tags == "object") {
        tags = tags.map(function(tag) { return tag.toUpperCase() });
    }
    return node
        && node.nodeType == DOM.ELEMENT_NODE
        && isHtmlNamespace(node.namespaceURI)
        && (typeof tags == "undefined" || tags.indexOf(node.tagName) != -1);
}

// "A prohibited paragraph child name is "address", "article", "aside",
// "blockquote", "caption", "center", "col", "colgroup", "dd", "details",
// "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
// "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li",
// "listing", "menu", "nav", "ol", "p", "plaintext", "pre", "section",
// "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul", or
// "xmp"."
var prohibitedParagraphChildNames = ["address", "article", "aside",
    "blockquote", "caption", "center", "col", "colgroup", "dd", "details",
    "dir", "div", "dl", "dt", "fieldset", "figcaption", "figure", "footer",
    "form", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hgroup", "hr", "li",
    "listing", "menu", "nav", "ol", "p", "plaintext", "pre", "section",
    "summary", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "ul",
    "xmp"];

// "A prohibited paragraph child is an HTML element whose local name is a
// prohibited paragraph child name."
function isProhibitedParagraphChild(node) {
    return isHtmlElement(node, prohibitedParagraphChildNames);
}

// "A block node is either an Element whose "display" property does not have
// resolved value "inline" or "inline-block" or "inline-table" or "none", or a
// Document, or a DocumentFragment."
function isBlockNode(node) {
    return node
        && ((node.nodeType == DOM.ELEMENT_NODE && ["inline", "inline-block", "inline-table", "none"].indexOf(getComputedStyle(node).display) == -1)
        || node.nodeType == DOM.DOCUMENT_NODE
        || node.nodeType == DOM.DOCUMENT_FRAGMENT_NODE);
}

// "An inline node is a node that is not a block node."
function isInlineNode(node) {
    return node && !isBlockNode(node);
}

// "An editing host is a node that is either an HTML element with a
// contenteditable attribute set to the true state, or the HTML element child
// of a Document whose designMode is enabled."
// "An editing host is either an HTML element with its contenteditable
// attribute in the true state or plaintext-only state, or a child HTML element
// of a Document whose design mode enabled is true." (HTML)
function isEditingHost(node) {
    return node
        && isHtmlElement(node)
        && editableState(node) == "host";
}

// "Something is editable if it is a node; it is not an editing host; it does
// not have a contenteditable attribute set to the false state; its parent is
// an editing host or editable; and either it is an HTML element, or it is an
// svg or math element, or it is not an Element and its parent is an HTML
// element."
function isEditable(node) {
    return node
        && !isEditingHost(node)
        && (node.nodeType != DOM.ELEMENT_NODE || editableState(node) != "false")
        && (isEditingHost(node.parentNode) || isEditable(node.parentNode))
        && (isHtmlElement(node)
        || (node.nodeType == DOM.ELEMENT_NODE && node.namespaceURI == "http://www.w3.org/2000/svg" && node.localName == "svg")
        || (node.nodeType == DOM.ELEMENT_NODE && node.namespaceURI == "http://www.w3.org/1998/Math/MathML" && node.localName == "math")
        || (node.nodeType != DOM.ELEMENT_NODE && isHtmlElement(node.parentNode)));
}

// Helper function, not defined in the spec
function hasEditableDescendants(node) {
    for (var i = 0; i < node.childNodes.length; i++) {
        if (isEditable(node.childNodes[i])
        || hasEditableDescendants(node.childNodes[i])) {
            return true;
        }
    }
    return false;
}

// "The editing host of node is null if node is neither editable nor an editing
// host; node itself, if node is an editing host; or the nearest ancestor of
// node that is an editing host, if node is editable."
function getEditingHostOf(node) {
    if (isEditingHost(node)) {
        return node;
    } else if (isEditable(node)) {
        var ancestor = node.parentNode;
        while (!isEditingHost(ancestor)) {
            ancestor = ancestor.parentNode;
        }
        return ancestor;
    } else {
        return null;
    }
}

// "Two nodes are in the same editing host if the editing host of the first is
// non-null and the same as the editing host of the second."
function inSameEditingHost(node1, node2) {
    return getEditingHostOf(node1)
        && getEditingHostOf(node1) == getEditingHostOf(node2);
}

// "A collapsed line break is a br that begins a line box which has nothing
// else in it, and therefore has zero height."
// "A collapsed line break is a br that begins a line box which has nothing
// else in it, and therefore has zero height." Nothing that takes room on a line
// follows it before its block ends or another block starts.
function isCollapsedLineBreak(br) {
    // A br out of the document lays out on no line.
    if (!isHtmlElement(br, "br") || !br.parentNode) {
        return false;
    }
    var block = nearestBlock(br);
    for (var node = nextNodeDescendants(br); node && isDescendant(node, block); ) {
        if (isBlockNode(node)) {
            return true;
        }
        if (node.nodeType == DOM.ELEMENT_NODE && getComputedStyle(node).display == "none") {
            node = nextNodeDescendants(node);
            continue;
        }
        if (takesRoomOnLine(node)) {
            return false;
        }
        node = nextNode(node);
    }
    return true;
}

// The nearest ancestor of node whose display is not inline.
function nearestBlock(node) {
    var ref = node.parentNode;
    while (ref.parentNode && getComputedStyle(ref).display == "inline") {
        ref = ref.parentNode;
    }
    return ref;
}

// Whether node is a leaf that puts something on its line: text that does not
// collapse away, a br, an img, or an inline-block.
function takesRoomOnLine(node) {
    if (node.nodeType == DOM.TEXT_NODE) {
        return !isWhitespaceNode(node);
    }
    if (isHtmlElement(node, ["br", "img"])) {
        return true;
    }
    return node.nodeType == DOM.ELEMENT_NODE
        && ["inline-block", "inline-table"].indexOf(getComputedStyle(node).display) != -1;
}

// "An extraneous line break is a br that has no visual effect, in that
// removing it from the DOM would not change layout, except that a br that is
// the sole child of an li is not extraneous."
//
// FIXME: This doesn't work in IE, since IE ignores display: none in
// contenteditable.
// "An extraneous line break is a br that has no visual effect, in that
// removing it from the DOM would not change layout, except that a br that is
// the sole child of an li is not extraneous." That is a collapsed line break
// that ends a line something else is on.
function isExtraneousLineBreak(br) {
    if (!isHtmlElement(br, "br") || !br.parentNode) {
        return false;
    }
    if (isHtmlElement(br.parentNode, "li")
    && br.parentNode.childNodes.length == 1) {
        return false;
    }
    if (!isCollapsedLineBreak(br)) {
        return false;
    }
    var block = nearestBlock(br);
    for (var node = previousNode(br); node && node != block; node = previousNode(node)) {
        // Going back in tree order meets a block's contents before the block: they are on
        // lines of their own.
        if (isBlockNode(node) || getAncestors(node).some(function(ancestor) {
            return ancestor != block && isDescendant(ancestor, block) && isBlockNode(ancestor);
        })) {
            return false;
        }
        if (getAncestors(node).concat(node).some(function(ancestor) {
            return ancestor.nodeType == DOM.ELEMENT_NODE && isDescendant(ancestor, block)
                && getComputedStyle(ancestor).display == "none";
        })) {
            continue;
        }
        if (isHtmlElement(node, "br")) {
            return false;
        }
        if (takesRoomOnLine(node)) {
            return true;
        }
    }
    return false;
}

// "A whitespace node is either a Text node whose data is the empty string; or
// a Text node whose data consists only of one or more tabs (0x0009), line
// feeds (0x000A), carriage returns (0x000D), and/or spaces (0x0020), and whose
// parent is an Element whose resolved value for "white-space" is "normal" or
// "nowrap"; or a Text node whose data consists only of one or more tabs
// (0x0009), carriage returns (0x000D), and/or spaces (0x0020), and whose
// parent is an Element whose resolved value for "white-space" is "pre-line"."
function isWhitespaceNode(node) {
    return node
        && node.nodeType == DOM.TEXT_NODE
        && (node.data == ""
        || (
            /^[\t\n\r ]+$/.test(node.data)
            && node.parentNode
            && node.parentNode.nodeType == DOM.ELEMENT_NODE
            && ["normal", "nowrap"].indexOf(getComputedStyle(node.parentNode).whiteSpace) != -1
        ) || (
            /^[\t\r ]+$/.test(node.data)
            && node.parentNode
            && node.parentNode.nodeType == DOM.ELEMENT_NODE
            && getComputedStyle(node.parentNode).whiteSpace == "pre-line"
        ));
}

// "node is a collapsed whitespace node if the following algorithm returns
// true:"
function isCollapsedWhitespaceNode(node) {
    // "If node is not a whitespace node, return false."
    if (!isWhitespaceNode(node)) {
        return false;
    }

    // "If node's data is the empty string, return true."
    if (node.data == "") {
        return true;
    }

    // "Let ancestor be node's parent."
    var ancestor = node.parentNode;

    // "If ancestor is null, return true."
    if (!ancestor) {
        return true;
    }

    // "If the "display" property of some ancestor of node has resolved value
    // "none", return true."
    if (getAncestors(node).some(function(ancestor) {
        return ancestor.nodeType == DOM.ELEMENT_NODE
            && getComputedStyle(ancestor).display == "none";
    })) {
        return true;
    }

    // "While ancestor is not a block node and its parent is not null, set
    // ancestor to its parent."
    while (!isBlockNode(ancestor)
    && ancestor.parentNode) {
        ancestor = ancestor.parentNode;
    }

    // "Let reference be node."
    var reference = node;

    // "While reference is a descendant of ancestor:"
    while (reference != ancestor) {
        // "Let reference be the node before it in tree order."
        reference = previousNode(reference);

        // "If reference is a block node or a br, return true."
        if (isBlockNode(reference)
        || isHtmlElement(reference, "br")) {
            return true;
        }

        // "If reference is a Text node that is not a whitespace node, or is an
        // img, break from this loop."
        if ((reference.nodeType == DOM.TEXT_NODE && !isWhitespaceNode(reference))
        || isHtmlElement(reference, "img")) {
            break;
        }
    }

    // "Let reference be node."
    reference = node;

    // "While reference is a descendant of ancestor:"
    var stop = nextNodeDescendants(ancestor);
    while (reference != stop) {
        // "Let reference be the node after it in tree order, or null if there
        // is no such node."
        reference = nextNode(reference);

        // "If reference is a block node or a br, return true."
        if (isBlockNode(reference)
        || isHtmlElement(reference, "br")) {
            return true;
        }

        // "If reference is a Text node that is not a whitespace node, or is an
        // img, break from this loop."
        if ((reference && reference.nodeType == DOM.TEXT_NODE && !isWhitespaceNode(reference))
        || isHtmlElement(reference, "img")) {
            break;
        }
    }

    // "Return false."
    return false;
}

// "Something is visible if it is a node that either is a block node, or a Text
// node that is not a collapsed whitespace node, or an img, or a br that is not
// an extraneous line break, or any node with a visible descendant; excluding
// any node with an ancestor container Element whose "display" property has
// resolved value "none"."
function isVisible(node) {
    if (!node) {
        return false;
    }

    if (getAncestors(node).concat(node)
    .filter(function(node) { return node.nodeType == DOM.ELEMENT_NODE })
    .some(function(node) { return getComputedStyle(node).display == "none" })) {
        return false;
    }

    if (isBlockNode(node)
    || (node.nodeType == DOM.TEXT_NODE && !isCollapsedWhitespaceNode(node))
    || isHtmlElement(node, "img")
    || (isHtmlElement(node, "br") && !isExtraneousLineBreak(node))) {
        return true;
    }

    for (var i = 0; i < node.childNodes.length; i++) {
        if (isVisible(node.childNodes[i])) {
            return true;
        }
    }

    return false;
}

// "Something is invisible if it is a node that is not visible."
function isInvisible(node) {
    return node && !isVisible(node);
}

// "A collapsed block prop is either a collapsed line break that is not an
// extraneous line break, or an Element that is an inline node and whose
// children are all either invisible or collapsed block props and that has at
// least one child that is a collapsed block prop."
function isCollapsedBlockProp(node) {
    if (isCollapsedLineBreak(node)
    && !isExtraneousLineBreak(node)) {
        return true;
    }

    if (!isInlineNode(node)
    || node.nodeType != DOM.ELEMENT_NODE) {
        return false;
    }

    var hasCollapsedBlockPropChild = false;
    for (var i = 0; i < node.childNodes.length; i++) {
        if (!isInvisible(node.childNodes[i])
        && !isCollapsedBlockProp(node.childNodes[i])) {
            return false;
        }
        if (isCollapsedBlockProp(node.childNodes[i])) {
            hasCollapsedBlockPropChild = true;
        }
    }

    return hasCollapsedBlockPropChild;
}

// "The active range is the range of the selection given by calling
// getSelection() on the context object. (Thus the active range may be null.)"
//
// We cheat and return globalRange if that's defined.  We also ensure that the
// active range meets the requirements that selection boundary points are
// supposed to meet, i.e., that the nodes are both Text or Element nodes that
// descend from a Document.
// "The active range is the range of the selection given by calling
// getSelection() on the context object. (Thus the active range may be null.)"
// While a command runs, the range it first read stays the active range: the algorithms
// below move it alongside each change they make to the selection (as the reference
// implementation does), and the selection takes it when the command ends.
function getActiveRange() {
    if (globalRange) {
        return globalRange;
    }
    var selection = getSelection();
    var range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (commandDepth > 0) {
        globalRange = range;
    }
    return range;
}

// "For some commands, each HTMLDocument must have a boolean state override
// and/or a string value override. These do not change the command's state or
// value, but change the way some algorithms behave, as specified in those
// algorithms' definitions. Initially, both must be unset for every command.
// Whenever the number of ranges in the Selection changes to something
// different, and whenever a boundary point of the range at a given index in
// the Selection changes to something different, the state override and value
// override must be unset for every command."
//
// We implement this crudely by using setters and getters.  To verify that the
// selection hasn't changed, we copy the active range and just check the
// endpoints match.  This isn't really correct, but it's good enough for us.
// Unset state/value overrides are undefined.  We put everything in a function
// so no one can access anything except via the provided functions, since
// otherwise callers might mistakenly use outdated overrides (if the selection
// has changed).
var getStateOverride, setStateOverride, unsetStateOverride,
    getValueOverride, setValueOverride, unsetValueOverride;
(function() {
    var stateOverrides = {};
    var valueOverrides = {};
    var storedRange = null;

    function resetOverrides() {
        if (!storedRange
        || storedRange.startContainer != getActiveRange().startContainer
        || storedRange.endContainer != getActiveRange().endContainer
        || storedRange.startOffset != getActiveRange().startOffset
        || storedRange.endOffset != getActiveRange().endOffset) {
            stateOverrides = {};
            valueOverrides = {};
            storedRange = getActiveRange().cloneRange();
        }
    }

    getStateOverride = function(command) {
        resetOverrides();
        return stateOverrides[command];
    };

    setStateOverride = function(command, newState) {
        resetOverrides();
        stateOverrides[command] = newState;
    };

    unsetStateOverride = function(command) {
        resetOverrides();
        delete stateOverrides[command];
    }

    getValueOverride = function(command) {
        resetOverrides();
        return valueOverrides[command];
    }

    // "The value override for the backColor command must be the same as the
    // value override for the hiliteColor command, such that setting one sets
    // the other to the same thing and unsetting one unsets the other."
    setValueOverride = function(command, newValue) {
        resetOverrides();
        valueOverrides[command] = newValue;
        if (command == "backcolor") {
            valueOverrides.hilitecolor = newValue;
        } else if (command == "hilitecolor") {
            valueOverrides.backcolor = newValue;
        }
    }

    unsetValueOverride = function(command) {
        resetOverrides();
        delete valueOverrides[command];
        if (command == "backcolor") {
            delete valueOverrides.hilitecolor;
        } else if (command == "hilitecolor") {
            delete valueOverrides.backcolor;
        }
    }
})();

//@}

/////////////////////////////
///// Common algorithms /////
/////////////////////////////

///// Assorted common algorithms /////
//@{

// Magic array of extra ranges whose endpoints we want to preserve.
var extraRanges = [];

function movePreservingRanges(node, newParent, newIndex) {
    // For convenience, I allow newIndex to be -1 to mean "insert at the end".
    if (newIndex == -1) {
        newIndex = newParent.childNodes.length;
    }
    moveNodePreservingRanges(node, newParent, newIndex);
}

function setTagName(element, newName) {
    // "If element is an HTML element with local name equal to new name, return
    // element."
    if (isHtmlElement(element, newName.toUpperCase())) {
        return element;
    }

    // "If element's parent is null, return element."
    if (!element.parentNode) {
        return element;
    }

    // "Let replacement element be the result of calling createElement(new
    // name) on the ownerDocument of element."
    var replacementElement = createElement(newName);

    // "Insert replacement element into element's parent immediately before
    // element."
    element.parentNode.insertBefore(replacementElement, element);

    // "Copy all attributes of element to replacement element, in order."
    for (var i = 0; i < attributesOf(element).length; i++) {
        replacementElement.setAttribute(attributesOf(element)[i].name, attributesOf(element)[i].value);
    }

    // "While element has children, append the first child of element as the
    // last child of replacement element, preserving ranges."
    while (element.childNodes.length) {
        movePreservingRanges(element.firstChild, replacementElement, replacementElement.childNodes.length);
    }

    // "Remove element from its parent."
    element.parentNode.removeChild(element);

    // "Return replacement element."
    return replacementElement;
}

function removeExtraneousLineBreaksBefore(node) {
    // "Let ref be the previousSibling of node."
    var ref = node.previousSibling;

    // "If ref is null, abort these steps."
    if (!ref) {
        return;
    }

    // "While ref has children, set ref to its lastChild."
    while (ref.hasChildNodes()) {
        ref = ref.lastChild;
    }

    // "While ref is invisible but not an extraneous line break, and ref does
    // not equal node's parent, set ref to the node before it in tree order."
    while (isInvisible(ref)
    && !isExtraneousLineBreak(ref)
    && ref != node.parentNode) {
        ref = previousNode(ref);
    }

    // "If ref is an editable extraneous line break, remove it from its
    // parent."
    if (isEditable(ref)
    && isExtraneousLineBreak(ref)) {
        ref.parentNode.removeChild(ref);
    }
}

function removeExtraneousLineBreaksAtTheEndOf(node) {
    // "Let ref be node."
    var ref = node;

    // "While ref has children, set ref to its lastChild."
    while (ref.hasChildNodes()) {
        ref = ref.lastChild;
    }

    // "While ref is invisible but not an extraneous line break, and ref does
    // not equal node, set ref to the node before it in tree order."
    while (isInvisible(ref)
    && !isExtraneousLineBreak(ref)
    && ref != node) {
        ref = previousNode(ref);
    }

    // "If ref is an editable extraneous line break:"
    if (isEditable(ref)
    && isExtraneousLineBreak(ref)) {
        // "While ref's parent is editable and invisible, set ref to its
        // parent."
        while (isEditable(ref.parentNode)
        && isInvisible(ref.parentNode)) {
            ref = ref.parentNode;
        }

        // "Remove ref from its parent."
        ref.parentNode.removeChild(ref);
    }
}

// "To remove extraneous line breaks from a node, first remove extraneous line
// breaks before it, then remove extraneous line breaks at the end of it."
function removeExtraneousLineBreaksFrom(node) {
    removeExtraneousLineBreaksBefore(node);
    removeExtraneousLineBreaksAtTheEndOf(node);
}

//@}
///// Wrapping a list of nodes /////
//@{

function wrap(nodeList, siblingCriteria, newParentInstructions) {
    // "If not provided, sibling criteria returns false and new parent
    // instructions returns null."
    if (typeof siblingCriteria == "undefined") {
        siblingCriteria = function() { return false };
    }
    if (typeof newParentInstructions == "undefined") {
        newParentInstructions = function() { return null };
    }

    // "If every member of node list is invisible, and none is a br, return
    // null and abort these steps."
    if (nodeList.every(isInvisible)
    && !nodeList.some(function(node) { return isHtmlElement(node, "br") })) {
        return null;
    }

    // "If node list's first member's parent is null, return null and abort
    // these steps."
    if (!nodeList[0].parentNode) {
        return null;
    }

    // "If node list's last member is an inline node that's not a br, and node
    // list's last member's nextSibling is a br, append that br to node list."
    if (isInlineNode(nodeList[nodeList.length - 1])
    && !isHtmlElement(nodeList[nodeList.length - 1], "br")
    && isHtmlElement(nodeList[nodeList.length - 1].nextSibling, "br")) {
        nodeList.push(nodeList[nodeList.length - 1].nextSibling);
    }

    // "While node list's first member's previousSibling is invisible, prepend
    // it to node list."
    while (isInvisible(nodeList[0].previousSibling)) {
        nodeList.unshift(nodeList[0].previousSibling);
    }

    // "While node list's last member's nextSibling is invisible, append it to
    // node list."
    while (isInvisible(nodeList[nodeList.length - 1].nextSibling)) {
        nodeList.push(nodeList[nodeList.length - 1].nextSibling);
    }

    // "If the previousSibling of the first member of node list is editable and
    // running sibling criteria on it returns true, let new parent be the
    // previousSibling of the first member of node list."
    var newParent;
    if (isEditable(nodeList[0].previousSibling)
    && siblingCriteria(nodeList[0].previousSibling)) {
        newParent = nodeList[0].previousSibling;

    // "Otherwise, if the nextSibling of the last member of node list is
    // editable and running sibling criteria on it returns true, let new parent
    // be the nextSibling of the last member of node list."
    } else if (isEditable(nodeList[nodeList.length - 1].nextSibling)
    && siblingCriteria(nodeList[nodeList.length - 1].nextSibling)) {
        newParent = nodeList[nodeList.length - 1].nextSibling;

    // "Otherwise, run new parent instructions, and let new parent be the
    // result."
    } else {
        newParent = newParentInstructions();
    }

    // "If new parent is null, abort these steps and return null."
    if (!newParent) {
        return null;
    }

    // "If new parent's parent is null:"
    if (!newParent.parentNode) {
        // "Insert new parent into the parent of the first member of node list
        // immediately before the first member of node list."
        nodeList[0].parentNode.insertBefore(newParent, nodeList[0]);

        // "If any range has a boundary point with node equal to the parent of
        // new parent and offset equal to the index of new parent, add one to
        // that boundary point's offset."
        //
        // Only try to fix the global range.
        if (globalRange.startContainer == newParent.parentNode
        && globalRange.startOffset == getNodeIndex(newParent)) {
            globalRange.setStart(globalRange.startContainer, globalRange.startOffset + 1);
        }
        if (globalRange.endContainer == newParent.parentNode
        && globalRange.endOffset == getNodeIndex(newParent)) {
            globalRange.setEnd(globalRange.endContainer, globalRange.endOffset + 1);
        }
    }

    // "Let original parent be the parent of the first member of node list."
    var originalParent = nodeList[0].parentNode;

    // "If new parent is before the first member of node list in tree order:"
    if (isBefore(newParent, nodeList[0])) {
        // "If new parent is not an inline node, but the last visible child of
        // new parent and the first visible member of node list are both inline
        // nodes, and the last child of new parent is not a br, call
        // createElement("br") on the ownerDocument of new parent and append
        // the result as the last child of new parent."
        if (!isInlineNode(newParent)
        && isInlineNode([].filter.call(newParent.childNodes, isVisible).slice(-1)[0])
        && isInlineNode(nodeList.filter(isVisible)[0])
        && !isHtmlElement(newParent.lastChild, "BR")) {
            newParent.appendChild(createElement("br"));
        }

        // "For each node in node list, append node as the last child of new
        // parent, preserving ranges."
        for (var i = 0; i < nodeList.length; i++) {
            movePreservingRanges(nodeList[i], newParent, -1);
        }

    // "Otherwise:"
    } else {
        // "If new parent is not an inline node, but the first visible child of
        // new parent and the last visible member of node list are both inline
        // nodes, and the last member of node list is not a br, call
        // createElement("br") on the ownerDocument of new parent and insert
        // the result as the first child of new parent."
        if (!isInlineNode(newParent)
        && isInlineNode([].filter.call(newParent.childNodes, isVisible)[0])
        && isInlineNode(nodeList.filter(isVisible).slice(-1)[0])
        && !isHtmlElement(nodeList[nodeList.length - 1], "BR")) {
            newParent.insertBefore(createElement("br"), newParent.firstChild);
        }

        // "For each node in node list, in reverse order, insert node as the
        // first child of new parent, preserving ranges."
        for (var i = nodeList.length - 1; i >= 0; i--) {
            movePreservingRanges(nodeList[i], newParent, 0);
        }
    }

    // "If original parent is editable and has no children, remove it from its
    // parent."
    if (isEditable(originalParent) && !originalParent.hasChildNodes()) {
        originalParent.parentNode.removeChild(originalParent);
    }

    // "If new parent's nextSibling is editable and running sibling criteria on
    // it returns true:"
    if (isEditable(newParent.nextSibling)
    && siblingCriteria(newParent.nextSibling)) {
        // "If new parent is not an inline node, but new parent's last child
        // and new parent's nextSibling's first child are both inline nodes,
        // and new parent's last child is not a br, call createElement("br") on
        // the ownerDocument of new parent and append the result as the last
        // child of new parent."
        if (!isInlineNode(newParent)
        && isInlineNode(newParent.lastChild)
        && isInlineNode(newParent.nextSibling.firstChild)
        && !isHtmlElement(newParent.lastChild, "BR")) {
            newParent.appendChild(createElement("br"));
        }

        // "While new parent's nextSibling has children, append its first child
        // as the last child of new parent, preserving ranges."
        while (newParent.nextSibling.hasChildNodes()) {
            movePreservingRanges(newParent.nextSibling.firstChild, newParent, -1);
        }

        // "Remove new parent's nextSibling from its parent."
        newParent.parentNode.removeChild(newParent.nextSibling);
    }

    // "Remove extraneous line breaks from new parent."
    removeExtraneousLineBreaksFrom(newParent);

    // "Return new parent."
    return newParent;
}


//@}
///// Allowed children /////
//@{

// "A name of an element with inline contents is "a", "abbr", "b", "bdi",
// "bdo", "cite", "code", "dfn", "em", "h1", "h2", "h3", "h4", "h5", "h6", "i",
// "kbd", "mark", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "small",
// "span", "strong", "sub", "sup", "u", "var", "acronym", "listing", "strike",
// "xmp", "big", "blink", "font", "marquee", "nobr", or "tt"."
var namesOfElementsWithInlineContents = ["a", "abbr", "b", "bdi", "bdo",
    "cite", "code", "dfn", "em", "h1", "h2", "h3", "h4", "h5", "h6", "i",
    "kbd", "mark", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "small",
    "span", "strong", "sub", "sup", "u", "var", "acronym", "listing", "strike",
    "xmp", "big", "blink", "font", "marquee", "nobr", "tt"];

// "An element with inline contents is an HTML element whose local name is a
// name of an element with inline contents."
function isElementWithInlineContents(node) {
    return isHtmlElement(node, namesOfElementsWithInlineContents);
}

function isAllowedChild(child, parent_) {
    // "If parent is "colgroup", "table", "tbody", "tfoot", "thead", "tr", or
    // an HTML element with local name equal to one of those, and child is a
    // Text node whose data does not consist solely of space characters, return
    // false."
    if ((["colgroup", "table", "tbody", "tfoot", "thead", "tr"].indexOf(parent_) != -1
    || isHtmlElement(parent_, ["colgroup", "table", "tbody", "tfoot", "thead", "tr"]))
    && typeof child == "object"
    && child.nodeType == DOM.TEXT_NODE
    && !/^[ \t\n\f\r]*$/.test(child.data)) {
        return false;
    }

    // "If parent is "script", "style", "plaintext", or "xmp", or an HTML
    // element with local name equal to one of those, and child is not a Text
    // node, return false."
    if ((["script", "style", "plaintext", "xmp"].indexOf(parent_) != -1
    || isHtmlElement(parent_, ["script", "style", "plaintext", "xmp"]))
    && (typeof child != "object" || child.nodeType != DOM.TEXT_NODE)) {
        return false;
    }

    // "If child is a Document, DocumentFragment, or DocumentType, return
    // false."
    if (typeof child == "object"
    && (child.nodeType == DOM.DOCUMENT_NODE
    || child.nodeType == DOM.DOCUMENT_FRAGMENT_NODE
    || child.nodeType == DOM.DOCUMENT_TYPE_NODE)) {
        return false;
    }

    // "If child is an HTML element, set child to the local name of child."
    if (isHtmlElement(child)) {
        child = child.tagName.toLowerCase();
    }

    // "If child is not a string, return true."
    if (typeof child != "string") {
        return true;
    }

    // "If parent is an HTML element:"
    if (isHtmlElement(parent_)) {
        // "If child is "a", and parent or some ancestor of parent is an a,
        // return false."
        //
        // "If child is a prohibited paragraph child name and parent or some
        // ancestor of parent is an element with inline contents, return
        // false."
        //
        // "If child is "h1", "h2", "h3", "h4", "h5", or "h6", and parent or
        // some ancestor of parent is an HTML element with local name "h1",
        // "h2", "h3", "h4", "h5", or "h6", return false."
        var ancestor = parent_;
        while (ancestor) {
            if (child == "a" && isHtmlElement(ancestor, "a")) {
                return false;
            }
            if (prohibitedParagraphChildNames.indexOf(child) != -1
            && isElementWithInlineContents(ancestor)) {
                return false;
            }
            if (/^h[1-6]$/.test(child)
            && isHtmlElement(ancestor)
            && /^H[1-6]$/.test(ancestor.tagName)) {
                return false;
            }
            ancestor = ancestor.parentNode;
        }

        // "Let parent be the local name of parent."
        parent_ = parent_.tagName.toLowerCase();
    }

    // "If parent is an Element or DocumentFragment, return true."
    if (typeof parent_ == "object"
    && (parent_.nodeType == DOM.ELEMENT_NODE
    || parent_.nodeType == DOM.DOCUMENT_FRAGMENT_NODE)) {
        return true;
    }

    // "If parent is not a string, return false."
    if (typeof parent_ != "string") {
        return false;
    }

    // "If parent is on the left-hand side of an entry on the following list,
    // then return true if child is listed on the right-hand side of that
    // entry, and false otherwise."
    switch (parent_) {
        case "colgroup":
            return child == "col";
        case "table":
            return ["caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"].indexOf(child) != -1;
        case "tbody":
        case "thead":
        case "tfoot":
            return ["td", "th", "tr"].indexOf(child) != -1;
        case "tr":
            return ["td", "th"].indexOf(child) != -1;
        case "dl":
            return ["dt", "dd"].indexOf(child) != -1;
        case "dir":
        case "ol":
        case "ul":
            return ["dir", "li", "ol", "ul"].indexOf(child) != -1;
        case "hgroup":
            return /^h[1-6]$/.test(child);
    }

    // "If child is "body", "caption", "col", "colgroup", "frame", "frameset",
    // "head", "html", "tbody", "td", "tfoot", "th", "thead", or "tr", return
    // false."
    if (["body", "caption", "col", "colgroup", "frame", "frameset", "head",
    "html", "tbody", "td", "tfoot", "th", "thead", "tr"].indexOf(child) != -1) {
        return false;
    }

    // "If child is "dd" or "dt" and parent is not "dl", return false."
    if (["dd", "dt"].indexOf(child) != -1
    && parent_ != "dl") {
        return false;
    }

    // "If child is "li" and parent is not "ol" or "ul", return false."
    if (child == "li"
    && parent_ != "ol"
    && parent_ != "ul") {
        return false;
    }

    // "If parent is on the left-hand side of an entry on the following list
    // and child is listed on the right-hand side of that entry, return false."
    var table = [
        [["a"], ["a"]],
        [["dd", "dt"], ["dd", "dt"]],
        [["h1", "h2", "h3", "h4", "h5", "h6"], ["h1", "h2", "h3", "h4", "h5", "h6"]],
        [["li"], ["li"]],
        [["nobr"], ["nobr"]],
        [namesOfElementsWithInlineContents, prohibitedParagraphChildNames],
        [["td", "th"], ["caption", "col", "colgroup", "tbody", "td", "tfoot", "th", "thead", "tr"]],
    ];
    for (var i = 0; i < table.length; i++) {
        if (table[i][0].indexOf(parent_) != -1
        && table[i][1].indexOf(child) != -1) {
            return false;
        }
    }

    // "Return true."
    return true;
}


//@}

//////////////////////////////////////
///// Inline formatting commands /////
//////////////////////////////////////

///// Inline formatting command definitions /////
//@{

// "A node node is effectively contained in a range range if range is not
// collapsed, and at least one of the following holds:"
function isEffectivelyContained(node, range) {
    if (range.collapsed) {
        return false;
    }

    // "node is contained in range."
    if (isContained(node, range)) {
        return true;
    }

    // "node is range's start node, it is a Text node, and its length is
    // different from range's start offset."
    if (node == range.startContainer
    && node.nodeType == DOM.TEXT_NODE
    && getNodeLength(node) != range.startOffset) {
        return true;
    }

    // "node is range's end node, it is a Text node, and range's end offset is
    // not 0."
    if (node == range.endContainer
    && node.nodeType == DOM.TEXT_NODE
    && range.endOffset != 0) {
        return true;
    }

    // "node has at least one child; and all its children are effectively
    // contained in range; and either range's start node is not a descendant of
    // node or is not a Text node or range's start offset is zero; and either
    // range's end node is not a descendant of node or is not a Text node or
    // range's end offset is its end node's length."
    if (node.hasChildNodes()
    && [].every.call(node.childNodes, function(child) { return isEffectivelyContained(child, range) })
    && (!isDescendant(range.startContainer, node)
    || range.startContainer.nodeType != DOM.TEXT_NODE
    || range.startOffset == 0)
    && (!isDescendant(range.endContainer, node)
    || range.endContainer.nodeType != DOM.TEXT_NODE
    || range.endOffset == getNodeLength(range.endContainer))) {
        return true;
    }

    return false;
}

// Like get(All)ContainedNodes(), but for effectively contained nodes.
function getEffectivelyContainedNodes(range, condition) {
    if (typeof condition == "undefined") {
        condition = function() { return true };
    }
    var node = range.startContainer;
    // A tree whose every node is in the range ends at its root: there is no parent above.
    while (node.parentNode && isEffectivelyContained(node.parentNode, range)) {
        node = node.parentNode;
    }

    var stop = nextNodeDescendants(range.endContainer);

    var nodeList = [];
    while (isBefore(node, stop)) {
        if (isEffectivelyContained(node, range)
        && condition(node)) {
            nodeList.push(node);
            node = nextNodeDescendants(node);
            continue;
        }
        node = nextNode(node);
    }
    return nodeList;
}

function getAllEffectivelyContainedNodes(range, condition) {
    if (typeof condition == "undefined") {
        condition = function() { return true };
    }
    var node = range.startContainer;
    // A tree whose every node is in the range ends at its root: there is no parent above.
    while (node.parentNode && isEffectivelyContained(node.parentNode, range)) {
        node = node.parentNode;
    }

    var stop = nextNodeDescendants(range.endContainer);

    var nodeList = [];
    while (isBefore(node, stop)) {
        if (isEffectivelyContained(node, range)
        && condition(node)) {
            nodeList.push(node);
        }
        node = nextNode(node);
    }
    return nodeList;
}

// "A modifiable element is a b, em, i, s, span, strong, sub, sup, or u element
// with no attributes except possibly style; or a font element with no
// attributes except possibly style, color, face, and/or size; or an a element
// with no attributes except possibly style and/or href."
function isModifiableElement(node) {
    if (!isHtmlElement(node)) {
        return false;
    }

    if (["B", "EM", "I", "S", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "U"].indexOf(node.tagName) != -1) {
        if (attributesOf(node).length == 0) {
            return true;
        }

        if (attributesOf(node).length == 1
        && node.hasAttribute("style")) {
            return true;
        }
    }

    if (node.tagName == "FONT" || node.tagName == "A") {
        var numAttrs = attributesOf(node).length;

        if (node.hasAttribute("style")) {
            numAttrs--;
        }

        if (node.tagName == "FONT") {
            if (node.hasAttribute("color")) {
                numAttrs--;
            }

            if (node.hasAttribute("face")) {
                numAttrs--;
            }

            if (node.hasAttribute("size")) {
                numAttrs--;
            }
        }

        if (node.tagName == "A"
        && node.hasAttribute("href")) {
            numAttrs--;
        }

        if (numAttrs == 0) {
            return true;
        }
    }

    return false;
}

function isSimpleModifiableElement(node) {
    // "A simple modifiable element is an HTML element for which at least one
    // of the following holds:"
    if (!isHtmlElement(node)) {
        return false;
    }

    // Only these elements can possibly be a simple modifiable element.
    if (["A", "B", "EM", "FONT", "I", "S", "SPAN", "STRIKE", "STRONG", "SUB", "SUP", "U"].indexOf(node.tagName) == -1) {
        return false;
    }

    // "It is an a, b, em, font, i, s, span, strike, strong, sub, sup, or u
    // element with no attributes."
    if (attributesOf(node).length == 0) {
        return true;
    }

    // If it's got more than one attribute, everything after this fails.
    if (attributesOf(node).length > 1) {
        return false;
    }

    // "It is an a, b, em, font, i, s, span, strike, strong, sub, sup, or u
    // element with exactly one attribute, which is style, which sets no CSS
    // properties (including invalid or unrecognized properties)."
    //
    // Not gonna try for invalid or unrecognized.
    if (node.hasAttribute("style")
    && node.style.length == 0) {
        return true;
    }

    // "It is an a element with exactly one attribute, which is href."
    if (node.tagName == "A"
    && node.hasAttribute("href")) {
        return true;
    }

    // "It is a font element with exactly one attribute, which is either color,
    // face, or size."
    if (node.tagName == "FONT"
    && (node.hasAttribute("color")
    || node.hasAttribute("face")
    || node.hasAttribute("size")
    )) {
        return true;
    }

    // "It is a b or strong element with exactly one attribute, which is style,
    // and the style attribute sets exactly one CSS property (including invalid
    // or unrecognized properties), which is "font-weight"."
    if ((node.tagName == "B" || node.tagName == "STRONG")
    && node.hasAttribute("style")
    && node.style.length == 1
    && node.style.fontWeight != "") {
        return true;
    }

    // "It is an i or em element with exactly one attribute, which is style,
    // and the style attribute sets exactly one CSS property (including invalid
    // or unrecognized properties), which is "font-style"."
    if ((node.tagName == "I" || node.tagName == "EM")
    && node.hasAttribute("style")
    && node.style.length == 1
    && node.style.fontStyle != "") {
        return true;
    }

    // "It is an a, font, or span element with exactly one attribute, which is
    // style, and the style attribute sets exactly one CSS property (including
    // invalid or unrecognized properties), and that property is not
    // "text-decoration"."
    if ((node.tagName == "A" || node.tagName == "FONT" || node.tagName == "SPAN")
    && node.hasAttribute("style")
    && node.style.length == 1
    && node.style.textDecoration == "") {
        return true;
    }

    // "It is an a, font, s, span, strike, or u element with exactly one
    // attribute, which is style, and the style attribute sets exactly one CSS
    // property (including invalid or unrecognized properties), which is
    // "text-decoration", which is set to "line-through" or "underline" or
    // "overline" or "none"."
    //
    // The weird extra node.style.length check is for Firefox, which as of
    // 8.0a2 has annoying and weird behavior here.
    if (["A", "FONT", "S", "SPAN", "STRIKE", "U"].indexOf(node.tagName) != -1
    && node.hasAttribute("style")
    && (node.style.length == 1
        || (node.style.length == 4
            && "MozTextBlink" in node.style
            && "MozTextDecorationColor" in node.style
            && "MozTextDecorationLine" in node.style
            && "MozTextDecorationStyle" in node.style)
        || (node.style.length == 4
            && "MozTextBlink" in node.style
            && "textDecorationColor" in node.style
            && "textDecorationLine" in node.style
            && "textDecorationStyle" in node.style)
    )
    && (node.style.textDecoration == "line-through"
    || node.style.textDecoration == "underline"
    || node.style.textDecoration == "overline"
    || node.style.textDecoration == "none")) {
        return true;
    }

    return false;
}

// "A formattable node is an editable visible node that is either a Text node,
// an img, or a br."
function isFormattableNode(node) {
    return isEditable(node)
        && isVisible(node)
        && (node.nodeType == DOM.TEXT_NODE
        || isHtmlElement(node, ["img", "br"]));
}

// "Two quantities are equivalent values for a command if either both are null,
// or both are strings and they're equal and the command does not define any
// equivalent values, or both are strings and the command defines equivalent
// values and they match the definition."
function areEquivalentValues(command, val1, val2) {
    if (val1 === null && val2 === null) {
        return true;
    }

    if (typeof val1 == "string"
    && typeof val2 == "string"
    && val1 == val2
    && !("equivalentValues" in commands[command])) {
        return true;
    }

    if (typeof val1 == "string"
    && typeof val2 == "string"
    && "equivalentValues" in commands[command]
    && commands[command].equivalentValues(val1, val2)) {
        return true;
    }

    return false;
}

// "Two quantities are loosely equivalent values for a command if either they
// are equivalent values for the command, or if the command is the fontSize
// command; one of the quantities is one of "x-small", "small", "medium",
// "large", "x-large", "xx-large", or "xxx-large"; and the other quantity is
// the resolved value of "font-size" on a font element whose size attribute has
// the corresponding value set ("1" through "7" respectively)."
function areLooselyEquivalentValues(command, val1, val2) {
    if (areEquivalentValues(command, val1, val2)) {
        return true;
    }

    if (command != "fontsize"
    || typeof val1 != "string"
    || typeof val2 != "string") {
        return false;
    }

    return val1 === LEGACY_FONT_PIXELS[val2]
        || val2 === LEGACY_FONT_PIXELS[val1];
}

//@}
///// Assorted inline formatting command algorithms /////
//@{

function getEffectiveCommandValue(node, command) {
    // "If neither node nor its parent is an Element, return null."
    if (node.nodeType != DOM.ELEMENT_NODE
    && (!node.parentNode || node.parentNode.nodeType != DOM.ELEMENT_NODE)) {
        return null;
    }

    // "If node is not an Element, return the effective command value of its
    // parent for command."
    if (node.nodeType != DOM.ELEMENT_NODE) {
        return getEffectiveCommandValue(node.parentNode, command);
    }

    // "If command is "createLink" or "unlink":"
    if (command == "createlink" || command == "unlink") {
        // "While node is not null, and is not an a element that has an href
        // attribute, set node to its parent."
        while (node
        && (!isHtmlElement(node)
        || node.tagName != "A"
        || !node.hasAttribute("href"))) {
            node = node.parentNode;
        }

        // "If node is null, return null."
        if (!node) {
            return null;
        }

        // "Return the value of node's href attribute."
        return node.getAttribute("href");
    }

    // "If command is "backColor" or "hiliteColor":"
    if (command == "backcolor"
    || command == "hilitecolor") {
        // "While the resolved value of "background-color" on node is any
        // fully transparent value, and node's parent is an Element, set
        // node to its parent."
        //
        // Another lame hack to avoid flawed APIs.
        while ((getComputedStyle(node).backgroundColor == "rgba(0, 0, 0, 0)"
        || getComputedStyle(node).backgroundColor === ""
        || getComputedStyle(node).backgroundColor == "transparent")
        && node.parentNode
        && node.parentNode.nodeType == DOM.ELEMENT_NODE) {
            node = node.parentNode;
        }

        // "Return the resolved value of "background-color" for node."
        return getComputedStyle(node).backgroundColor;
    }

    // "If command is "subscript" or "superscript":"
    if (command == "subscript" || command == "superscript") {
        // "Let affected by subscript and affected by superscript be two
        // boolean variables, both initially false."
        var affectedBySubscript = false;
        var affectedBySuperscript = false;

        // "While node is an inline node:"
        while (isInlineNode(node)) {
            var verticalAlign = getComputedStyle(node).verticalAlign;

            // "If node is a sub, set affected by subscript to true."
            if (isHtmlElement(node, "sub")) {
                affectedBySubscript = true;
            // "Otherwise, if node is a sup, set affected by superscript to
            // true."
            } else if (isHtmlElement(node, "sup")) {
                affectedBySuperscript = true;
            }

            // "Set node to its parent."
            node = node.parentNode;
        }

        // "If affected by subscript and affected by superscript are both true,
        // return the string "mixed"."
        if (affectedBySubscript && affectedBySuperscript) {
            return "mixed";
        }

        // "If affected by subscript is true, return "subscript"."
        if (affectedBySubscript) {
            return "subscript";
        }

        // "If affected by superscript is true, return "superscript"."
        if (affectedBySuperscript) {
            return "superscript";
        }

        // "Return null."
        return null;
    }

    // "If command is "strikethrough", and the "text-decoration" property of
    // node or any of its ancestors has resolved value containing
    // "line-through", return "line-through". Otherwise, return null."
    if (command == "strikethrough") {
        do {
            if (getComputedStyle(node).textDecoration.indexOf("line-through") != -1) {
                return "line-through";
            }
            node = node.parentNode;
        } while (node && node.nodeType == DOM.ELEMENT_NODE);
        return null;
    }

    // "If command is "underline", and the "text-decoration" property of node
    // or any of its ancestors has resolved value containing "underline",
    // return "underline". Otherwise, return null."
    if (command == "underline") {
        do {
            if (getComputedStyle(node).textDecoration.indexOf("underline") != -1) {
                return "underline";
            }
            node = node.parentNode;
        } while (node && node.nodeType == DOM.ELEMENT_NODE);
        return null;
    }

    if (!("relevantCssProperty" in commands[command])) {
        throw "Bug: no relevantCssProperty for " + command + " in getEffectiveCommandValue";
    }

    // "Return the resolved value for node of the relevant CSS property for
    // command."
    return getComputedStyle(node)[commands[command].relevantCssProperty];
}

function getSpecifiedCommandValue(element, command) {
    // "If command is "backColor" or "hiliteColor" and element's display
    // property does not have resolved value "inline", return null."
    if ((command == "backcolor" || command == "hilitecolor")
    && getComputedStyle(element).display != "inline") {
        return null;
    }

    // "If command is "createLink" or "unlink":"
    if (command == "createlink" || command == "unlink") {
        // "If element is an a element and has an href attribute, return the
        // value of that attribute."
        if (isHtmlElement(element)
        && element.tagName == "A"
        && element.hasAttribute("href")) {
            return element.getAttribute("href");
        }

        // "Return null."
        return null;
    }

    // "If command is "subscript" or "superscript":"
    if (command == "subscript" || command == "superscript") {
        // "If element is a sup, return "superscript"."
        if (isHtmlElement(element, "sup")) {
            return "superscript";
        }

        // "If element is a sub, return "subscript"."
        if (isHtmlElement(element, "sub")) {
            return "subscript";
        }

        // "Return null."
        return null;
    }

    // "If command is "strikethrough", and element has a style attribute set,
    // and that attribute sets "text-decoration":"
    if (command == "strikethrough"
    && element.style.textDecoration != "") {
        // "If element's style attribute sets "text-decoration" to a value
        // containing "line-through", return "line-through"."
        if (element.style.textDecoration.indexOf("line-through") != -1) {
            return "line-through";
        }

        // "Return null."
        return null;
    }

    // "If command is "strikethrough" and element is a s or strike element,
    // return "line-through"."
    if (command == "strikethrough"
    && isHtmlElement(element, ["S", "STRIKE"])) {
        return "line-through";
    }

    // "If command is "underline", and element has a style attribute set, and
    // that attribute sets "text-decoration":"
    if (command == "underline"
    && element.style.textDecoration != "") {
        // "If element's style attribute sets "text-decoration" to a value
        // containing "underline", return "underline"."
        if (element.style.textDecoration.indexOf("underline") != -1) {
            return "underline";
        }

        // "Return null."
        return null;
    }

    // "If command is "underline" and element is a u element, return
    // "underline"."
    if (command == "underline"
    && isHtmlElement(element, "U")) {
        return "underline";
    }

    // "Let property be the relevant CSS property for command."
    var property = commands[command].relevantCssProperty;

    // "If property is null, return null."
    if (property === null) {
        return null;
    }

    // "If element has a style attribute set, and that attribute has the
    // effect of setting property, return the value that it sets property to."
    if (element.style[property] != "") {
        return element.style[property];
    }

    // "If element is a font element that has an attribute whose effect is
    // to create a presentational hint for property, return the value that the
    // hint sets property to.  (For a size of 7, this will be the non-CSS value
    // "xxx-large".)"
    if (isHtmlNamespace(element.namespaceURI)
    && element.tagName == "FONT") {
        if (property == "color" && element.hasAttribute("color")) {
            return element.getAttribute("color");
        }
        if (property == "fontFamily" && element.hasAttribute("face")) {
            return element.getAttribute("face");
        }
        if (property == "fontSize" && element.hasAttribute("size")) {
            // This is not even close to correct in general.
            var size = parseInt(element.getAttribute("size"));
            if (size < 1) {
                size = 1;
            }
            if (size > 7) {
                size = 7;
            }
            return {
                1: "x-small",
                2: "small",
                3: "medium",
                4: "large",
                5: "x-large",
                6: "xx-large",
                7: "xxx-large"
            }[size];
        }
    }

    // "If element is in the following list, and property is equal to the
    // CSS property name listed for it, return the string listed for it."
    //
    // A list follows, whose meaning is copied here.
    if (property == "fontWeight"
    && (element.tagName == "B" || element.tagName == "STRONG")) {
        return "bold";
    }
    if (property == "fontStyle"
    && (element.tagName == "I" || element.tagName == "EM")) {
        return "italic";
    }

    // "Return null."
    return null;
}

function reorderModifiableDescendants(node, command, newValue) {
    // "Let candidate equal node."
    var candidate = node;

    // "While candidate is a modifiable element, and candidate has exactly one
    // child, and that child is also a modifiable element, and candidate is not
    // a simple modifiable element or candidate's specified command value for
    // command is not equivalent to new value, set candidate to its child."
    while (isModifiableElement(candidate)
    && candidate.childNodes.length == 1
    && isModifiableElement(candidate.firstChild)
    && (!isSimpleModifiableElement(candidate)
    || !areEquivalentValues(command, getSpecifiedCommandValue(candidate, command), newValue))) {
        candidate = candidate.firstChild;
    }

    // "If candidate is node, or is not a simple modifiable element, or its
    // specified command value is not equivalent to new value, or its effective
    // command value is not loosely equivalent to new value, abort these
    // steps."
    if (candidate == node
    || !isSimpleModifiableElement(candidate)
    || !areEquivalentValues(command, getSpecifiedCommandValue(candidate, command), newValue)
    || !areLooselyEquivalentValues(command, getEffectiveCommandValue(candidate, command), newValue)) {
        return;
    }

    // "While candidate has children, insert the first child of candidate into
    // candidate's parent immediately before candidate, preserving ranges."
    while (candidate.hasChildNodes()) {
        movePreservingRanges(candidate.firstChild, candidate.parentNode, getNodeIndex(candidate));
    }

    // "Insert candidate into node's parent immediately after node."
    node.parentNode.insertBefore(candidate, node.nextSibling);

    // "Append the node as the last child of candidate, preserving ranges."
    movePreservingRanges(node, candidate, -1);
}

function recordValues(nodeList) {
    // "Let values be a list of (node, command, specified command value)
    // triples, initially empty."
    var values = [];

    // "For each node in node list, for each command in the list "subscript",
    // "bold", "fontName", "fontSize", "foreColor", "hiliteColor", "italic",
    // "strikethrough", and "underline" in that order:"
    nodeList.forEach(function(node) {
        ["subscript", "bold", "fontname", "fontsize", "forecolor",
        "hilitecolor", "italic", "strikethrough", "underline"].forEach(function(command) {
            // "Let ancestor equal node."
            var ancestor = node;

            // "If ancestor is not an Element, set it to its parent."
            if (ancestor.nodeType != DOM.ELEMENT_NODE) {
                ancestor = ancestor.parentNode;
            }

            // "While ancestor is an Element and its specified command value
            // for command is null, set it to its parent."
            while (ancestor
            && ancestor.nodeType == DOM.ELEMENT_NODE
            && getSpecifiedCommandValue(ancestor, command) === null) {
                ancestor = ancestor.parentNode;
            }

            // "If ancestor is an Element, add (node, command, ancestor's
            // specified command value for command) to values. Otherwise add
            // (node, command, null) to values."
            if (ancestor && ancestor.nodeType == DOM.ELEMENT_NODE) {
                values.push([node, command, getSpecifiedCommandValue(ancestor, command)]);
            } else {
                values.push([node, command, null]);
            }
        });
    });

    // "Return values."
    return values;
}

function restoreValues(values) {
    // "For each (node, command, value) triple in values:"
    values.forEach(function(triple) {
        var node = triple[0];
        var command = triple[1];
        var value = triple[2];

        // "Let ancestor equal node."
        var ancestor = node;

        // "If ancestor is not an Element, set it to its parent."
        if (!ancestor || ancestor.nodeType != DOM.ELEMENT_NODE) {
            ancestor = ancestor.parentNode;
        }

        // "While ancestor is an Element and its specified command value for
        // command is null, set it to its parent."
        while (ancestor
        && ancestor.nodeType == DOM.ELEMENT_NODE
        && getSpecifiedCommandValue(ancestor, command) === null) {
            ancestor = ancestor.parentNode;
        }

        // "If value is null and ancestor is an Element, push down values on
        // node for command, with new value null."
        if (value === null
        && ancestor
        && ancestor.nodeType == DOM.ELEMENT_NODE) {
            pushDownValues(node, command, null);

        // "Otherwise, if ancestor is an Element and its specified command
        // value for command is not equivalent to value, or if ancestor is not
        // an Element and value is not null, force the value of command to
        // value on node."
        } else if ((ancestor
        && ancestor.nodeType == DOM.ELEMENT_NODE
        && !areEquivalentValues(command, getSpecifiedCommandValue(ancestor, command), value))
        || ((!ancestor || ancestor.nodeType != DOM.ELEMENT_NODE)
        && value !== null)) {
            forceValue(node, command, value);
        }
    });
}


//@}
///// Clearing an element's value /////
//@{

function clearValue(element, command) {
    // "If element is not editable, return the empty list."
    if (!isEditable(element)) {
        return [];
    }

    // "If element's specified command value for command is null, return the
    // empty list."
    if (getSpecifiedCommandValue(element, command) === null) {
        return [];
    }

    // "If element is a simple modifiable element:"
    if (isSimpleModifiableElement(element)) {
        // "Let children be the children of element."
        var children = Array.prototype.slice.call(element.childNodes);

        // "For each child in children, insert child into element's parent
        // immediately before element, preserving ranges."
        for (var i = 0; i < children.length; i++) {
            movePreservingRanges(children[i], element.parentNode, getNodeIndex(element));
        }

        // "Remove element from its parent."
        element.parentNode.removeChild(element);

        // "Return children."
        return children;
    }

    // "If command is "strikethrough", and element has a style attribute that
    // sets "text-decoration" to some value containing "line-through", delete
    // "line-through" from the value."
    if (command == "strikethrough"
    && element.style.textDecoration.indexOf("line-through") != -1) {
        if (element.style.textDecoration == "line-through") {
            element.style.textDecoration = "";
        } else {
            element.style.textDecoration = element.style.textDecoration.replace("line-through", "");
        }
        if (element.getAttribute("style") == "") {
            element.removeAttribute("style");
        }
    }

    // "If command is "underline", and element has a style attribute that sets
    // "text-decoration" to some value containing "underline", delete
    // "underline" from the value."
    if (command == "underline"
    && element.style.textDecoration.indexOf("underline") != -1) {
        if (element.style.textDecoration == "underline") {
            element.style.textDecoration = "";
        } else {
            element.style.textDecoration = element.style.textDecoration.replace("underline", "");
        }
        if (element.getAttribute("style") == "") {
            element.removeAttribute("style");
        }
    }

    // "If the relevant CSS property for command is not null, unset the CSS
    // property property of element."
    if (commands[command].relevantCssProperty !== null) {
        element.style[commands[command].relevantCssProperty] = '';
        if (element.getAttribute("style") == "") {
            element.removeAttribute("style");
        }
    }

    // "If element is a font element:"
    if (isHtmlNamespace(element.namespaceURI) && element.tagName == "FONT") {
        // "If command is "foreColor", unset element's color attribute, if set."
        if (command == "forecolor") {
            element.removeAttribute("color");
        }

        // "If command is "fontName", unset element's face attribute, if set."
        if (command == "fontname") {
            element.removeAttribute("face");
        }

        // "If command is "fontSize", unset element's size attribute, if set."
        if (command == "fontsize") {
            element.removeAttribute("size");
        }
    }

    // "If element is an a element and command is "createLink" or "unlink",
    // unset the href property of element."
    if (isHtmlElement(element, "A")
    && (command == "createlink" || command == "unlink")) {
        element.removeAttribute("href");
    }

    // "If element's specified command value for command is null, return the
    // empty list."
    if (getSpecifiedCommandValue(element, command) === null) {
        return [];
    }

    // "Set the tag name of element to "span", and return the one-node list
    // consisting of the result."
    return [setTagName(element, "span")];
}


//@}
///// Pushing down values /////
//@{

function pushDownValues(node, command, newValue) {
    // "If node's parent is not an Element, abort this algorithm."
    if (!node.parentNode
    || node.parentNode.nodeType != DOM.ELEMENT_NODE) {
        return;
    }

    // "If the effective command value of command is loosely equivalent to new
    // value on node, abort this algorithm."
    if (areLooselyEquivalentValues(command, getEffectiveCommandValue(node, command), newValue)) {
        return;
    }

    // "Let current ancestor be node's parent."
    var currentAncestor = node.parentNode;

    // "Let ancestor list be a list of Nodes, initially empty."
    var ancestorList = [];

    // "While current ancestor is an editable Element and the effective command
    // value of command is not loosely equivalent to new value on it, append
    // current ancestor to ancestor list, then set current ancestor to its
    // parent."
    while (isEditable(currentAncestor)
    && currentAncestor.nodeType == DOM.ELEMENT_NODE
    && !areLooselyEquivalentValues(command, getEffectiveCommandValue(currentAncestor, command), newValue)) {
        ancestorList.push(currentAncestor);
        currentAncestor = currentAncestor.parentNode;
    }

    // "If ancestor list is empty, abort this algorithm."
    if (!ancestorList.length) {
        return;
    }

    // "Let propagated value be the specified command value of command on the
    // last member of ancestor list."
    var propagatedValue = getSpecifiedCommandValue(ancestorList[ancestorList.length - 1], command);

    // "If propagated value is null and is not equal to new value, abort this
    // algorithm."
    if (propagatedValue === null && propagatedValue != newValue) {
        return;
    }

    // "If the effective command value for the parent of the last member of
    // ancestor list is not loosely equivalent to new value, and new value is
    // not null, abort this algorithm."
    if (newValue !== null
    && !areLooselyEquivalentValues(command, getEffectiveCommandValue(ancestorList[ancestorList.length - 1].parentNode, command), newValue)) {
        return;
    }

    // "While ancestor list is not empty:"
    while (ancestorList.length) {
        // "Let current ancestor be the last member of ancestor list."
        // "Remove the last member from ancestor list."
        var currentAncestor = ancestorList.pop();

        // "If the specified command value of current ancestor for command is
        // not null, set propagated value to that value."
        if (getSpecifiedCommandValue(currentAncestor, command) !== null) {
            propagatedValue = getSpecifiedCommandValue(currentAncestor, command);
        }

        // "Let children be the children of current ancestor."
        var children = Array.prototype.slice.call(currentAncestor.childNodes);

        // "If the specified command value of current ancestor for command is
        // not null, clear the value of current ancestor."
        if (getSpecifiedCommandValue(currentAncestor, command) !== null) {
            clearValue(currentAncestor, command);
        }

        // "For every child in children:"
        for (var i = 0; i < children.length; i++) {
            var child = children[i];

            // "If child is node, continue with the next child."
            if (child == node) {
                continue;
            }

            // "If child is an Element whose specified command value for
            // command is neither null nor equivalent to propagated value,
            // continue with the next child."
            if (child.nodeType == DOM.ELEMENT_NODE
            && getSpecifiedCommandValue(child, command) !== null
            && !areEquivalentValues(command, propagatedValue, getSpecifiedCommandValue(child, command))) {
                continue;
            }

            // "If child is the last member of ancestor list, continue with the
            // next child."
            if (child == ancestorList[ancestorList.length - 1]) {
                continue;
            }

            // "Force the value of child, with command as in this algorithm
            // and new value equal to propagated value."
            forceValue(child, command, propagatedValue);
        }
    }
}


//@}
///// Forcing the value of a node /////
//@{

function forceValue(node, command, newValue) {
    // "If node's parent is null, abort this algorithm."
    if (!node.parentNode) {
        return;
    }

    // "If new value is null, abort this algorithm."
    if (newValue === null) {
        return;
    }

    // "If node is an allowed child of "span":"
    if (isAllowedChild(node, "span")) {
        // "Reorder modifiable descendants of node's previousSibling."
        reorderModifiableDescendants(node.previousSibling, command, newValue);

        // "Reorder modifiable descendants of node's nextSibling."
        reorderModifiableDescendants(node.nextSibling, command, newValue);

        // "Wrap the one-node list consisting of node, with sibling criteria
        // returning true for a simple modifiable element whose specified
        // command value is equivalent to new value and whose effective command
        // value is loosely equivalent to new value and false otherwise, and
        // with new parent instructions returning null."
        wrap([node],
            function(node) {
                return isSimpleModifiableElement(node)
                    && areEquivalentValues(command, getSpecifiedCommandValue(node, command), newValue)
                    && areLooselyEquivalentValues(command, getEffectiveCommandValue(node, command), newValue);
            },
            function() { return null }
        );
    }

    // "If node is invisible, abort this algorithm."
    if (isInvisible(node)) {
        return;
    }

    // "If the effective command value of command is loosely equivalent to new
    // value on node, abort this algorithm."
    if (areLooselyEquivalentValues(command, getEffectiveCommandValue(node, command), newValue)) {
        return;
    }

    // "If node is not an allowed child of "span":"
    if (!isAllowedChild(node, "span")) {
        // "Let children be all children of node, omitting any that are
        // Elements whose specified command value for command is neither null
        // nor equivalent to new value."
        var children = [];
        for (var i = 0; i < node.childNodes.length; i++) {
            if (node.childNodes[i].nodeType == DOM.ELEMENT_NODE) {
                var specifiedValue = getSpecifiedCommandValue(node.childNodes[i], command);

                if (specifiedValue !== null
                && !areEquivalentValues(command, newValue, specifiedValue)) {
                    continue;
                }
            }
            children.push(node.childNodes[i]);
        }

        // "Force the value of each Node in children, with command and new
        // value as in this invocation of the algorithm."
        for (var i = 0; i < children.length; i++) {
            forceValue(children[i], command, newValue);
        }

        // "Abort this algorithm."
        return;
    }

    // "If the effective command value of command is loosely equivalent to new
    // value on node, abort this algorithm."
    if (areLooselyEquivalentValues(command, getEffectiveCommandValue(node, command), newValue)) {
        return;
    }

    // "Let new parent be null."
    var newParent = null;

    // "If the CSS styling flag is false:"
    if (!cssStylingFlag) {
        // "If command is "bold" and new value is "bold", let new parent be the
        // result of calling createElement("b") on the ownerDocument of node."
        if (command == "bold" && (newValue == "bold" || newValue == "700")) {
            newParent = createElement("b");
        }

        // "If command is "italic" and new value is "italic", let new parent be
        // the result of calling createElement("i") on the ownerDocument of
        // node."
        if (command == "italic" && newValue == "italic") {
            newParent = createElement("i");
        }

        // "If command is "strikethrough" and new value is "line-through", let
        // new parent be the result of calling createElement("s") on the
        // ownerDocument of node."
        if (command == "strikethrough" && newValue == "line-through") {
            newParent = createElement("s");
        }

        // "If command is "underline" and new value is "underline", let new
        // parent be the result of calling createElement("u") on the
        // ownerDocument of node."
        if (command == "underline" && newValue == "underline") {
            newParent = createElement("u");
        }

        // "If command is "foreColor", and new value is fully opaque with red,
        // green, and blue components in the range 0 to 255:"
        if (command == "forecolor" && parseSimpleColor(newValue)) {
            // "Let new parent be the result of calling createElement("font")
            // on the ownerDocument of node."
            newParent = createElement("font");

            // "Set the color attribute of new parent to the result of applying
            // the rules for serializing simple color values to new value
            // (interpreted as a simple color)."
            newParent.setAttribute("color", parseSimpleColor(newValue));
        }

        // "If command is "fontName", let new parent be the result of calling
        // createElement("font") on the ownerDocument of node, then set the
        // face attribute of new parent to new value."
        if (command == "fontname") {
            newParent = createElement("font");
            newParent.setAttribute("face", newValue);
        }
    }

    // "If command is "createLink" or "unlink":"
    if (command == "createlink" || command == "unlink") {
        // "Let new parent be the result of calling createElement("a") on the
        // ownerDocument of node."
        newParent = createElement("a");

        // "Set the href attribute of new parent to new value."
        newParent.setAttribute("href", newValue);

        // "Let ancestor be node's parent."
        var ancestor = node.parentNode;

        // "While ancestor is not null:"
        while (ancestor) {
            // "If ancestor is an a, set the tag name of ancestor to "span",
            // and let ancestor be the result."
            if (isHtmlElement(ancestor, "A")) {
                ancestor = setTagName(ancestor, "span");
            }

            // "Set ancestor to its parent."
            ancestor = ancestor.parentNode;
        }
    }

    // "If command is "fontSize"; and new value is one of "x-small", "small",
    // "medium", "large", "x-large", "xx-large", or "xxx-large"; and either the
    // CSS styling flag is false, or new value is "xxx-large": let new parent
    // be the result of calling createElement("font") on the ownerDocument of
    // node, then set the size attribute of new parent to the number from the
    // following table based on new value: [table omitted]"
    if (command == "fontsize"
    && ["x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large"].indexOf(newValue) != -1
    && (!cssStylingFlag || newValue == "xxx-large")) {
        newParent = createElement("font");
        newParent.setAttribute("size", cssSizeToLegacy(newValue));
    }

    // "If command is "subscript" or "superscript" and new value is
    // "subscript", let new parent be the result of calling
    // createElement("sub") on the ownerDocument of node."
    if ((command == "subscript" || command == "superscript")
    && newValue == "subscript") {
        newParent = createElement("sub");
    }

    // "If command is "subscript" or "superscript" and new value is
    // "superscript", let new parent be the result of calling
    // createElement("sup") on the ownerDocument of node."
    if ((command == "subscript" || command == "superscript")
    && newValue == "superscript") {
        newParent = createElement("sup");
    }

    // "If new parent is null, let new parent be the result of calling
    // createElement("span") on the ownerDocument of node."
    if (!newParent) {
        newParent = createElement("span");
    }

    // "Insert new parent in node's parent before node."
    node.parentNode.insertBefore(newParent, node);

    // "If the effective command value of command for new parent is not loosely
    // equivalent to new value, and the relevant CSS property for command is
    // not null, set that CSS property of new parent to new value (if the new
    // value would be valid)."
    var property = commands[command].relevantCssProperty;
    if (property !== null
    && !areLooselyEquivalentValues(command, getEffectiveCommandValue(newParent, command), newValue)) {
        newParent.style[property] = newValue;
    }

    // "If command is "strikethrough", and new value is "line-through", and the
    // effective command value of "strikethrough" for new parent is not
    // "line-through", set the "text-decoration" property of new parent to
    // "line-through"."
    if (command == "strikethrough"
    && newValue == "line-through"
    && getEffectiveCommandValue(newParent, "strikethrough") != "line-through") {
        newParent.style.textDecoration = "line-through";
    }

    // "If command is "underline", and new value is "underline", and the
    // effective command value of "underline" for new parent is not
    // "underline", set the "text-decoration" property of new parent to
    // "underline"."
    if (command == "underline"
    && newValue == "underline"
    && getEffectiveCommandValue(newParent, "underline") != "underline") {
        newParent.style.textDecoration = "underline";
    }

    // "Append node to new parent as its last child, preserving ranges."
    movePreservingRanges(node, newParent, newParent.childNodes.length);

    // "If node is an Element and the effective command value of command for
    // node is not loosely equivalent to new value:"
    if (node.nodeType == DOM.ELEMENT_NODE
    && !areEquivalentValues(command, getEffectiveCommandValue(node, command), newValue)) {
        // "Insert node into the parent of new parent before new parent,
        // preserving ranges."
        movePreservingRanges(node, newParent.parentNode, getNodeIndex(newParent));

        // "Remove new parent from its parent."
        newParent.parentNode.removeChild(newParent);

        // "Let children be all children of node, omitting any that are
        // Elements whose specified command value for command is neither null
        // nor equivalent to new value."
        var children = [];
        for (var i = 0; i < node.childNodes.length; i++) {
            if (node.childNodes[i].nodeType == DOM.ELEMENT_NODE) {
                var specifiedValue = getSpecifiedCommandValue(node.childNodes[i], command);

                if (specifiedValue !== null
                && !areEquivalentValues(command, newValue, specifiedValue)) {
                    continue;
                }
            }
            children.push(node.childNodes[i]);
        }

        // "Force the value of each Node in children, with command and new
        // value as in this invocation of the algorithm."
        for (var i = 0; i < children.length; i++) {
            forceValue(children[i], command, newValue);
        }
    }
}


//@}
///// Setting the selection's value /////
//@{

function setSelectionValue(command, newValue) {
    // "If there is no formattable node effectively contained in the active
    // range:"
    if (!getAllEffectivelyContainedNodes(getActiveRange())
    .some(isFormattableNode)) {
        // "If command has inline command activated values, set the state
        // override to true if new value is among them and false if it's not."
        if ("inlineCommandActivatedValues" in commands[command]) {
            setStateOverride(command, commands[command].inlineCommandActivatedValues
                .indexOf(newValue) != -1);
        }

        // "If command is "subscript", unset the state override for
        // "superscript"."
        if (command == "subscript") {
            unsetStateOverride("superscript");
        }

        // "If command is "superscript", unset the state override for
        // "subscript"."
        if (command == "superscript") {
            unsetStateOverride("subscript");
        }

        // "If new value is null, unset the value override (if any)."
        if (newValue === null) {
            unsetValueOverride(command);

        // "Otherwise, if command is "createLink" or it has a value specified,
        // set the value override to new value."
        } else if (command == "createlink" || "value" in commands[command]) {
            setValueOverride(command, newValue);
        }

        // "Abort these steps."
        return;
    }

    // "If the active range's start node is an editable Text node, and its
    // start offset is neither zero nor its start node's length, call
    // splitText() on the active range's start node, with argument equal to the
    // active range's start offset. Then set the active range's start node to
    // the result, and its start offset to zero."
    if (isEditable(getActiveRange().startContainer)
    && getActiveRange().startContainer.nodeType == DOM.TEXT_NODE
    && getActiveRange().startOffset != 0
    && getActiveRange().startOffset != getNodeLength(getActiveRange().startContainer)) {
        // Account for browsers not following range mutation rules
        var newActiveRange = createRange();
        var newNode;
        if (getActiveRange().startContainer == getActiveRange().endContainer) {
            var newEndOffset = getActiveRange().endOffset - getActiveRange().startOffset;
            newNode = getActiveRange().startContainer.splitText(getActiveRange().startOffset);
            newActiveRange.setEnd(newNode, newEndOffset);
            getActiveRange().setEnd(newNode, newEndOffset);
        } else {
            newNode = getActiveRange().startContainer.splitText(getActiveRange().startOffset);
        }
        newActiveRange.setStart(newNode, 0);
        getSelection().removeAllRanges();
        getSelection().addRange(newActiveRange);

        getActiveRange().setStart(newNode, 0);
    }

    // "If the active range's end node is an editable Text node, and its end
    // offset is neither zero nor its end node's length, call splitText() on
    // the active range's end node, with argument equal to the active range's
    // end offset."
    if (isEditable(getActiveRange().endContainer)
    && getActiveRange().endContainer.nodeType == DOM.TEXT_NODE
    && getActiveRange().endOffset != 0
    && getActiveRange().endOffset != getNodeLength(getActiveRange().endContainer)) {
        // IE seems to mutate the range incorrectly here, so we need correction
        // here as well.  The active range will be temporarily in orphaned
        // nodes, so calling getActiveRange() after splitText() but before
        // fixing the range will throw an exception.
        var activeRange = getActiveRange();
        var newStart = [activeRange.startContainer, activeRange.startOffset];
        var newEnd = [activeRange.endContainer, activeRange.endOffset];
        activeRange.endContainer.splitText(activeRange.endOffset);
        activeRange.setStart(newStart[0], newStart[1]);
        activeRange.setEnd(newEnd[0], newEnd[1]);

        getSelection().removeAllRanges();
        getSelection().addRange(activeRange);
    }

    // "Let element list be all editable Elements effectively contained in the
    // active range.
    //
    // "For each element in element list, clear the value of element."
    getAllEffectivelyContainedNodes(getActiveRange(), function(node) {
        return isEditable(node) && node.nodeType == DOM.ELEMENT_NODE;
    }).forEach(function(element) {
        clearValue(element, command);
    });

    // "Let node list be all editable nodes effectively contained in the active
    // range.
    //
    // "For each node in node list:"
    getAllEffectivelyContainedNodes(getActiveRange(), isEditable).forEach(function(node) {
        // "Push down values on node."
        pushDownValues(node, command, newValue);

        // "If node is an allowed child of span, force the value of node."
        if (isAllowedChild(node, "span")) {
            forceValue(node, command, newValue);
        }
    });
}


//@}
///// The backColor command /////
//@{
commands.backcolor = {
    // Copy-pasted, same as hiliteColor
    action: function(value) {
        // Action is further copy-pasted, same as foreColor

        // "If value is not a valid CSS color, prepend "#" to it."
        //
        // "If value is still not a valid CSS color, or if it is currentColor,
        // return false."
        //
        // Cheap hack for testing, no attempt to be comprehensive.
        if (/^([0-9a-fA-F]{3}){1,2}$/.test(value)) {
            value = "#" + value;
        }
        if (!/^(rgba?|hsla?)\(.*\)$/.test(value)
        && !parseSimpleColor(value)
        && value.toLowerCase() != "transparent") {
            return false;
        }

        // "Set the selection's value to value."
        setSelectionValue("backcolor", value);

        // "Return true."
        return true;
    }, standardInlineValueCommand: true, relevantCssProperty: "backgroundColor",
    equivalentValues: function(val1, val2) {
        // "Either both strings are valid CSS colors and have the same red,
        // green, blue, and alpha components, or neither string is a valid CSS
        // color."
        return normalizeColor(val1) === normalizeColor(val2);
    },
};

//@}
///// The bold command /////
//@{
commands.bold = {
    action: function() {
        // "If queryCommandState("bold") returns true, set the selection's
        // value to "normal". Otherwise set the selection's value to "bold".
        // Either way, return true."
        if (queryCommandState("bold")) {
            setSelectionValue("bold", "normal");
        } else {
            setSelectionValue("bold", "bold");
        }
        return true;
    }, inlineCommandActivatedValues: ["bold", "600", "700", "800", "900"],
    relevantCssProperty: "fontWeight",
    equivalentValues: function(val1, val2) {
        // "Either the two strings are equal, or one is "bold" and the other is
        // "700", or one is "normal" and the other is "400"."
        return val1 == val2
            || (val1 == "bold" && val2 == "700")
            || (val1 == "700" && val2 == "bold")
            || (val1 == "normal" && val2 == "400")
            || (val1 == "400" && val2 == "normal");
    },
};

//@}
///// The createLink command /////
//@{
commands.createlink = {
    action: function(value) {
        // "If value is the empty string, return false."
        if (value === "") {
            return false;
        }

        // "For each editable a element that has an href attribute and is an
        // ancestor of some node effectively contained in the active range, set
        // that a element's href attribute to value."
        //
        // TODO: We don't actually do this in tree order, not that it matters
        // unless you're spying with mutation events.
        getAllEffectivelyContainedNodes(getActiveRange()).forEach(function(node) {
            getAncestors(node).forEach(function(ancestor) {
                if (isEditable(ancestor)
                && isHtmlElement(ancestor, "a")
                && ancestor.hasAttribute("href")) {
                    ancestor.setAttribute("href", value);
                }
            });
        });

        // "Set the selection's value to value."
        setSelectionValue("createlink", value);

        // "Return true."
        return true;
    }
};

//@}
///// The fontName command /////
//@{
commands.fontname = {
    action: function(value) {
        // "Set the selection's value to value, then return true."
        setSelectionValue("fontname", value);
        return true;
    }, standardInlineValueCommand: true, relevantCssProperty: "fontFamily"
};

//@}
///// The fontSize command /////
//@{

// Helper function for fontSize's action plus queryOutputHelper.  It's just the
// middle of fontSize's action, ripped out into its own function.  Returns null
// if the size is invalid.
function normalizeFontSize(value) {
    // "Strip leading and trailing whitespace from value."
    //
    // Cheap hack, not following the actual algorithm.
    value = value.trim();

    // "If value is not a valid floating point number, and would not be a valid
    // floating point number if a single leading "+" character were stripped,
    // return false."
    if (!/^[-+]?[0-9]+(\.[0-9]+)?([eE][-+]?[0-9]+)?$/.test(value)) {
        return null;
    }

    var mode;

    // "If the first character of value is "+", delete the character and let
    // mode be "relative-plus"."
    if (value[0] == "+") {
        value = value.slice(1);
        mode = "relative-plus";
    // "Otherwise, if the first character of value is "-", delete the character
    // and let mode be "relative-minus"."
    } else if (value[0] == "-") {
        value = value.slice(1);
        mode = "relative-minus";
    // "Otherwise, let mode be "absolute"."
    } else {
        mode = "absolute";
    }

    // "Apply the rules for parsing non-negative integers to value, and let
    // number be the result."
    //
    // Another cheap hack.
    var num = parseInt(value);

    // "If mode is "relative-plus", add three to number."
    if (mode == "relative-plus") {
        num += 3;
    }

    // "If mode is "relative-minus", negate number, then add three to it."
    if (mode == "relative-minus") {
        num = 3 - num;
    }

    // "If number is less than one, let number equal 1."
    if (num < 1) {
        num = 1;
    }

    // "If number is greater than seven, let number equal 7."
    if (num > 7) {
        num = 7;
    }

    // "Set value to the string here corresponding to number:" [table omitted]
    value = {
        1: "x-small",
        2: "small",
        3: "medium",
        4: "large",
        5: "x-large",
        6: "xx-large",
        7: "xxx-large"
    }[num];

    return value;
}

commands.fontsize = {
    action: function(value) {
        value = normalizeFontSize(value);
        if (value === null) {
            return false;
        }

        // "Set the selection's value to value."
        setSelectionValue("fontsize", value);

        // "Return true."
        return true;
    }, indeterm: function() {
        // "True if among formattable nodes that are effectively contained in
        // the active range, there are two that have distinct effective command
        // values.  Otherwise false."
        return getAllEffectivelyContainedNodes(getActiveRange(), isFormattableNode)
        .map(function(node) {
            return getEffectiveCommandValue(node, "fontsize");
        }).filter(function(value, i, arr) {
            return arr.slice(0, i).indexOf(value) == -1;
        }).length >= 2;
    }, value: function() {
        // "If the active range is null, return the empty string."
        if (!getActiveRange()) {
            return "";
        }

        // "Let pixel size be the effective command value of the first
        // formattable node that is effectively contained in the active range,
        // or if there is no such node, the effective command value of the
        // active range's start node, in either case interpreted as a number of
        // pixels."
        var node = getAllEffectivelyContainedNodes(getActiveRange(), isFormattableNode)[0];
        if (node === undefined) {
            node = getActiveRange().startContainer;
        }
        var pixelSize = getEffectiveCommandValue(node, "fontsize");

        // "Return the legacy font size for pixel size."
        return getLegacyFontSize(pixelSize);
    }, relevantCssProperty: "fontSize"
};

function getLegacyFontSize(size) {
    if (getLegacyFontSize.resultCache === undefined) {
        getLegacyFontSize.resultCache = {};
    }

    if (getLegacyFontSize.resultCache[size] !== undefined) {
        return getLegacyFontSize.resultCache[size];
    }

    // For convenience in other places in my code, I handle all sizes, not just
    // pixel sizes as the spec says.  This means pixel sizes have to be passed
    // in suffixed with "px", not as plain numbers.
    if (normalizeFontSize(size) !== null) {
        return getLegacyFontSize.resultCache[size] = cssSizeToLegacy(normalizeFontSize(size));
    }

    if (["x-small", "x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large"].indexOf(size) == -1
    && !/^[0-9]+(\.[0-9]+)?(cm|mm|in|pt|pc|px)$/.test(size)) {
        // There is no sensible legacy size for things like "2em".
        return getLegacyFontSize.resultCache[size] = null;
    }

    var pixelSize = parseInt(LEGACY_FONT_PIXELS[size] ?? cssLengthInPixels(size));

    // "Let returned size be 1."
    var returnedSize = 1;

    // "While returned size is less than 7:"
    while (returnedSize < 7) {
        // "Let lower bound be the resolved value of "font-size" in pixels
        // of a font element whose size attribute is set to returned size."
        var lowerBound = parseInt(LEGACY_FONT_PIXELS[legacySizeToCss(returnedSize)]);

        // "Let upper bound be the resolved value of "font-size" in pixels
        // of a font element whose size attribute is set to one plus
        // returned size."
        var upperBound = parseInt(LEGACY_FONT_PIXELS[legacySizeToCss(1 + returnedSize)]);

        // "Let average be the average of upper bound and lower bound."
        var average = (upperBound + lowerBound)/2;

        // "If pixel size is less than average, return the one-element
        // string consisting of the digit returned size."
        if (pixelSize < average) {
            return getLegacyFontSize.resultCache[size] = String(returnedSize);
        }

        // "Add one to returned size."
        returnedSize++;
    }

    // "Return "7"."
    return getLegacyFontSize.resultCache[size] = "7";
}

//@}
///// The foreColor command /////
//@{
commands.forecolor = {
    action: function(value) {
        // Copy-pasted, same as backColor and hiliteColor

        // "If value is not a valid CSS color, prepend "#" to it."
        //
        // "If value is still not a valid CSS color, or if it is currentColor,
        // return false."
        //
        // Cheap hack for testing, no attempt to be comprehensive.
        if (/^([0-9a-fA-F]{3}){1,2}$/.test(value)) {
            value = "#" + value;
        }
        if (!/^(rgba?|hsla?)\(.*\)$/.test(value)
        && !parseSimpleColor(value)
        && value.toLowerCase() != "transparent") {
            return false;
        }

        // "Set the selection's value to value."
        setSelectionValue("forecolor", value);

        // "Return true."
        return true;
    }, standardInlineValueCommand: true, relevantCssProperty: "color",
    equivalentValues: function(val1, val2) {
        // "Either both strings are valid CSS colors and have the same red,
        // green, blue, and alpha components, or neither string is a valid CSS
        // color."
        return normalizeColor(val1) === normalizeColor(val2);
    },
};

//@}
///// The hiliteColor command /////
//@{
commands.hilitecolor = {
    // Copy-pasted, same as backColor
    action: function(value) {
        // Action is further copy-pasted, same as foreColor

        // "If value is not a valid CSS color, prepend "#" to it."
        //
        // "If value is still not a valid CSS color, or if it is currentColor,
        // return false."
        //
        // Cheap hack for testing, no attempt to be comprehensive.
        if (/^([0-9a-fA-F]{3}){1,2}$/.test(value)) {
            value = "#" + value;
        }
        if (!/^(rgba?|hsla?)\(.*\)$/.test(value)
        && !parseSimpleColor(value)
        && value.toLowerCase() != "transparent") {
            return false;
        }

        // "Set the selection's value to value."
        setSelectionValue("hilitecolor", value);

        // "Return true."
        return true;
    }, indeterm: function() {
        // "True if among editable Text nodes that are effectively contained in
        // the active range, there are two that have distinct effective command
        // values.  Otherwise false."
        return getAllEffectivelyContainedNodes(getActiveRange(), function(node) {
            return isEditable(node) && node.nodeType == DOM.TEXT_NODE;
        }).map(function(node) {
            return getEffectiveCommandValue(node, "hilitecolor");
        }).filter(function(value, i, arr) {
            return arr.slice(0, i).indexOf(value) == -1;
        }).length >= 2;
    }, standardInlineValueCommand: true, relevantCssProperty: "backgroundColor",
    equivalentValues: function(val1, val2) {
        // "Either both strings are valid CSS colors and have the same red,
        // green, blue, and alpha components, or neither string is a valid CSS
        // color."
        return normalizeColor(val1) === normalizeColor(val2);
    },
};

//@}
///// The italic command /////
//@{
commands.italic = {
    action: function() {
        // "If queryCommandState("italic") returns true, set the selection's
        // value to "normal". Otherwise set the selection's value to "italic".
        // Either way, return true."
        if (queryCommandState("italic")) {
            setSelectionValue("italic", "normal");
        } else {
            setSelectionValue("italic", "italic");
        }
        return true;
    }, inlineCommandActivatedValues: ["italic", "oblique"],
    relevantCssProperty: "fontStyle"
};

//@}
///// The removeFormat command /////
//@{
commands.removeformat = {
    action: function() {
        // "A removeFormat candidate is an editable HTML element with local
        // name "abbr", "acronym", "b", "bdi", "bdo", "big", "blink", "cite",
        // "code", "dfn", "em", "font", "i", "ins", "kbd", "mark", "nobr", "q",
        // "s", "samp", "small", "span", "strike", "strong", "sub", "sup",
        // "tt", "u", or "var"."
        function isRemoveFormatCandidate(node) {
            return isEditable(node)
                && isHtmlElement(node, ["abbr", "acronym", "b", "bdi", "bdo",
                "big", "blink", "cite", "code", "dfn", "em", "font", "i",
                "ins", "kbd", "mark", "nobr", "q", "s", "samp", "small",
                "span", "strike", "strong", "sub", "sup", "tt", "u", "var"]);
        }

        // "Let elements to remove be a list of every removeFormat candidate
        // effectively contained in the active range."
        var elementsToRemove = getAllEffectivelyContainedNodes(getActiveRange(), isRemoveFormatCandidate);

        // "For each element in elements to remove:"
        elementsToRemove.forEach(function(element) {
            // "While element has children, insert the first child of element
            // into the parent of element immediately before element,
            // preserving ranges."
            while (element.hasChildNodes()) {
                movePreservingRanges(element.firstChild, element.parentNode, getNodeIndex(element));
            }

            // "Remove element from its parent."
            element.parentNode.removeChild(element);
        });

        // "If the active range's start node is an editable Text node, and its
        // start offset is neither zero nor its start node's length, call
        // splitText() on the active range's start node, with argument equal to
        // the active range's start offset. Then set the active range's start
        // node to the result, and its start offset to zero."
        if (isEditable(getActiveRange().startContainer)
        && getActiveRange().startContainer.nodeType == DOM.TEXT_NODE
        && getActiveRange().startOffset != 0
        && getActiveRange().startOffset != getNodeLength(getActiveRange().startContainer)) {
            // Account for browsers not following range mutation rules
            if (getActiveRange().startContainer == getActiveRange().endContainer) {
                var newEnd = getActiveRange().endOffset - getActiveRange().startOffset;
                var newNode = getActiveRange().startContainer.splitText(getActiveRange().startOffset);
                getActiveRange().setStart(newNode, 0);
                getActiveRange().setEnd(newNode, newEnd);
            } else {
                getActiveRange().setStart(getActiveRange().startContainer.splitText(getActiveRange().startOffset), 0);
            }
        }

        // "If the active range's end node is an editable Text node, and its
        // end offset is neither zero nor its end node's length, call
        // splitText() on the active range's end node, with argument equal to
        // the active range's end offset."
        if (isEditable(getActiveRange().endContainer)
        && getActiveRange().endContainer.nodeType == DOM.TEXT_NODE
        && getActiveRange().endOffset != 0
        && getActiveRange().endOffset != getNodeLength(getActiveRange().endContainer)) {
            // IE seems to mutate the range incorrectly here, so we need
            // correction here as well.  Have to be careful to set the range to
            // something not including the text node so that getActiveRange()
            // doesn't throw an exception due to a temporarily detached
            // endpoint.
            getActiveRange().endContainer.splitText(getActiveRange().endOffset);
        }

        // "Let node list consist of all editable nodes effectively contained
        // in the active range."
        //
        // "For each node in node list, while node's parent is a removeFormat
        // candidate in the same editing host as node, split the parent of the
        // one-node list consisting of node."
        getAllEffectivelyContainedNodes(getActiveRange(), isEditable).forEach(function(node) {
            while (isRemoveFormatCandidate(node.parentNode)
            && inSameEditingHost(node.parentNode, node)) {
                splitParent([node]);
            }
        });

        // "For each of the entries in the following list, in the given order,
        // set the selection's value to null, with command as given."
        [
            "subscript",
            "bold",
            "fontname",
            "fontsize",
            "forecolor",
            "hilitecolor",
            "italic",
            "strikethrough",
            "underline",
        ].forEach(function(command) {
            setSelectionValue(command, null);
        });

        // "Return true."
        return true;
    }
};

//@}
///// The strikethrough command /////
//@{
commands.strikethrough = {
    action: function() {
        // "If queryCommandState("strikethrough") returns true, set the
        // selection's value to null. Otherwise set the selection's value to
        // "line-through".  Either way, return true."
        if (queryCommandState("strikethrough")) {
            setSelectionValue("strikethrough", null);
        } else {
            setSelectionValue("strikethrough", "line-through");
        }
        return true;
    }, inlineCommandActivatedValues: ["line-through"]
};

//@}
///// The subscript command /////
//@{
commands.subscript = {
    action: function() {
        // "Call queryCommandState("subscript"), and let state be the result."
        var state = queryCommandState("subscript");

        // "Set the selection's value to null."
        setSelectionValue("subscript", null);

        // "If state is false, set the selection's value to "subscript"."
        if (!state) {
            setSelectionValue("subscript", "subscript");
        }

        // "Return true."
        return true;
    }, indeterm: function() {
        // "True if either among formattable nodes that are effectively
        // contained in the active range, there is at least one with effective
        // command value "subscript" and at least one with some other effective
        // command value; or if there is some formattable node effectively
        // contained in the active range with effective command value "mixed".
        // Otherwise false."
        var nodes = getAllEffectivelyContainedNodes(getActiveRange(), isFormattableNode);
        return (nodes.some(function(node) { return getEffectiveCommandValue(node, "subscript") == "subscript" })
            && nodes.some(function(node) { return getEffectiveCommandValue(node, "subscript") != "subscript" }))
            || nodes.some(function(node) { return getEffectiveCommandValue(node, "subscript") == "mixed" });
    }, inlineCommandActivatedValues: ["subscript"],
};

//@}
///// The superscript command /////
//@{
commands.superscript = {
    action: function() {
        // "Call queryCommandState("superscript"), and let state be the
        // result."
        var state = queryCommandState("superscript");

        // "Set the selection's value to null."
        setSelectionValue("superscript", null);

        // "If state is false, set the selection's value to "superscript"."
        if (!state) {
            setSelectionValue("superscript", "superscript");
        }

        // "Return true."
        return true;
    }, indeterm: function() {
        // "True if either among formattable nodes that are effectively
        // contained in the active range, there is at least one with effective
        // command value "superscript" and at least one with some other
        // effective command value; or if there is some formattable node
        // effectively contained in the active range with effective command
        // value "mixed".  Otherwise false."
        var nodes = getAllEffectivelyContainedNodes(getActiveRange(), isFormattableNode);
        return (nodes.some(function(node) { return getEffectiveCommandValue(node, "superscript") == "superscript" })
            && nodes.some(function(node) { return getEffectiveCommandValue(node, "superscript") != "superscript" }))
            || nodes.some(function(node) { return getEffectiveCommandValue(node, "superscript") == "mixed" });
    }, inlineCommandActivatedValues: ["superscript"],
};

//@}
///// The underline command /////
//@{
commands.underline = {
    action: function() {
        // "If queryCommandState("underline") returns true, set the selection's
        // value to null. Otherwise set the selection's value to "underline".
        // Either way, return true."
        if (queryCommandState("underline")) {
            setSelectionValue("underline", null);
        } else {
            setSelectionValue("underline", "underline");
        }
        return true;
    }, inlineCommandActivatedValues: ["underline"]
};

//@}
///// The unlink command /////
//@{
commands.unlink = {
    action: function() {
        // "Let hyperlinks be a list of every a element that has an href
        // attribute and is contained in the active range or is an ancestor of
        // one of its boundary points."
        //
        // As usual, take care to ensure it's tree order.  The correctness of
        // the following is left as an exercise for the reader.
        var range = getActiveRange();
        var hyperlinks = [];
        for (
            var node = range.startContainer;
            node;
            node = node.parentNode
        ) {
            if (isHtmlElement(node, "A")
            && node.hasAttribute("href")) {
                hyperlinks.unshift(node);
            }
        }
        for (
            var node = range.startContainer;
            node != nextNodeDescendants(range.endContainer);
            node = nextNode(node)
        ) {
            if (isHtmlElement(node, "A")
            && node.hasAttribute("href")
            && (isContained(node, range)
            || isAncestor(node, range.endContainer)
            || node == range.endContainer)) {
                hyperlinks.push(node);
            }
        }

        // "Clear the value of each member of hyperlinks."
        for (var i = 0; i < hyperlinks.length; i++) {
            clearValue(hyperlinks[i], "unlink");
        }

        // "Return true."
        return true;
    }
};

//@}

/////////////////////////////////////
///// Block formatting commands /////
/////////////////////////////////////

///// Block formatting command definitions /////
//@{

// "An indentation element is either a blockquote, or a div that has a style
// attribute that sets "margin" or some subproperty of it."
function isIndentationElement(node) {
    if (!isHtmlElement(node)) {
        return false;
    }

    if (node.tagName == "BLOCKQUOTE") {
        return true;
    }

    if (node.tagName != "DIV") {
        return false;
    }

    for (var i = 0; i < node.style.length; i++) {
        // Approximate check
        if (/^(-[a-z]+-)?margin/.test(node.style[i])) {
            return true;
        }
    }

    return false;
}

// "A simple indentation element is an indentation element that has no
// attributes except possibly
//
//   * "a style attribute that sets no properties other than "margin",
//     "border", "padding", or subproperties of those; and/or
//   * "a dir attribute."
function isSimpleIndentationElement(node) {
    if (!isIndentationElement(node)) {
        return false;
    }

    for (var i = 0; i < attributesOf(node).length; i++) {
        if (!isHtmlNamespace(attributesOf(node)[i].namespaceURI)
        || ["style", "dir"].indexOf(attributesOf(node)[i].name) == -1) {
            return false;
        }
    }

    for (var i = 0; i < node.style.length; i++) {
        // This is approximate, but it works well enough for my purposes.
        if (!/^(-[a-z]+-)?(margin|border|padding)/.test(node.style[i])) {
            return false;
        }
    }

    return true;
}

// "A non-list single-line container is an HTML element with local name
// "address", "div", "h1", "h2", "h3", "h4", "h5", "h6", "listing", "p", "pre",
// or "xmp"."
function isNonListSingleLineContainer(node) {
    return isHtmlElement(node, ["address", "div", "h1", "h2", "h3", "h4", "h5",
        "h6", "listing", "p", "pre", "xmp"]);
}

// "A single-line container is either a non-list single-line container, or an
// HTML element with local name "li", "dt", or "dd"."
function isSingleLineContainer(node) {
    return isNonListSingleLineContainer(node)
        || isHtmlElement(node, ["li", "dt", "dd"]);
}

function getBlockNodeOf(node) {
    // "While node is an inline node, set node to its parent."
    while (isInlineNode(node)) {
        node = node.parentNode;
    }

    // "Return node."
    return node;
}

//@}
///// Assorted block formatting command algorithms /////
//@{

function fixDisallowedAncestors(node) {
    // "If node is not editable, abort these steps."
    if (!isEditable(node)) {
        return;
    }

    // "If node is not an allowed child of any of its ancestors in the same
    // editing host:"
    if (getAncestors(node).every(function(ancestor) {
        return !inSameEditingHost(node, ancestor)
            || !isAllowedChild(node, ancestor)
    })) {
        // "If node is a dd or dt, wrap the one-node list consisting of node,
        // with sibling criteria returning true for any dl with no attributes
        // and false otherwise, and new parent instructions returning the
        // result of calling createElement("dl") on the context object. Then
        // abort these steps."
        if (isHtmlElement(node, ["dd", "dt"])) {
            wrap([node],
                function(sibling) { return isHtmlElement(sibling, "dl") && !attributesOf(sibling).length },
                function() { return createElement("dl") });
            return;
        }

        // "If "p" is not an allowed child of the editing host of node, abort
        // these steps."
        if (!isAllowedChild("p", getEditingHostOf(node))) {
            return;
        }

        // "If node is not a prohibited paragraph child, abort these steps."
        if (!isProhibitedParagraphChild(node)) {
            return;
        }

        // "Set the tag name of node to the default single-line container name,
        // and let node be the result."
        node = setTagName(node, defaultSingleLineContainerName);

        // "Fix disallowed ancestors of node."
        fixDisallowedAncestors(node);

        // "Let children be node's children."
        var children = [].slice.call(node.childNodes);

        // "For each child in children, if child is a prohibited paragraph
        // child:"
        children.filter(isProhibitedParagraphChild)
        .forEach(function(child) {
            // "Record the values of the one-node list consisting of child, and
            // let values be the result."
            var values = recordValues([child]);

            // "Split the parent of the one-node list consisting of child."
            splitParent([child]);

            // "Restore the values from values."
            restoreValues(values);
        });

        // "Abort these steps."
        return;
    }

    // "Record the values of the one-node list consisting of node, and let
    // values be the result."
    var values = recordValues([node]);

    // "While node is not an allowed child of its parent, split the parent of
    // the one-node list consisting of node."
    while (!isAllowedChild(node, node.parentNode)) {
        splitParent([node]);
    }

    // "Restore the values from values."
    restoreValues(values);
}

function normalizeSublists(item) {
    // "If item is not an li or it is not editable or its parent is not
    // editable, abort these steps."
    if (!isHtmlElement(item, "LI")
    || !isEditable(item)
    || !isEditable(item.parentNode)) {
        return;
    }

    // "Let new item be null."
    var newItem = null;

    // "While item has an ol or ul child:"
    while ([].some.call(item.childNodes, function (node) { return isHtmlElement(node, ["OL", "UL"]) })) {
        // "Let child be the last child of item."
        var child = item.lastChild;

        // "If child is an ol or ul, or new item is null and child is a Text
        // node whose data consists of zero of more space characters:"
        if (isHtmlElement(child, ["OL", "UL"])
        || (!newItem && child.nodeType == DOM.TEXT_NODE && /^[ \t\n\f\r]*$/.test(child.data))) {
            // "Set new item to null."
            newItem = null;

            // "Insert child into the parent of item immediately following
            // item, preserving ranges."
            movePreservingRanges(child, item.parentNode, 1 + getNodeIndex(item));

        // "Otherwise:"
        } else {
            // "If new item is null, let new item be the result of calling
            // createElement("li") on the ownerDocument of item, then insert
            // new item into the parent of item immediately after item."
            if (!newItem) {
                newItem = createElement("li");
                item.parentNode.insertBefore(newItem, item.nextSibling);
            }

            // "Insert child into new item as its first child, preserving
            // ranges."
            movePreservingRanges(child, newItem, 0);
        }
    }
}

function getSelectionListState() {
    // "If the active range is null, return "none"."
    if (!getActiveRange()) {
        return "none";
    }

    // "Block-extend the active range, and let new range be the result."
    var newRange = blockExtend(getActiveRange());

    // "Let node list be a list of nodes, initially empty."
    //
    // "For each node contained in new range, append node to node list if the
    // last member of node list (if any) is not an ancestor of node; node is
    // editable; node is not an indentation element; and node is either an ol
    // or ul, or the child of an ol or ul, or an allowed child of "li"."
    var nodeList = getContainedNodes(newRange, function(node) {
        return isEditable(node)
            && !isIndentationElement(node)
            && (isHtmlElement(node, ["ol", "ul"])
            || isHtmlElement(node.parentNode, ["ol", "ul"])
            || isAllowedChild(node, "li"));
    });

    // "If node list is empty, return "none"."
    if (!nodeList.length) {
        return "none";
    }

    // "If every member of node list is either an ol or the child of an ol or
    // the child of an li child of an ol, and none is a ul or an ancestor of a
    // ul, return "ol"."
    if (nodeList.every(function(node) {
        return isHtmlElement(node, "ol")
            || isHtmlElement(node.parentNode, "ol")
            || (isHtmlElement(node.parentNode, "li") && isHtmlElement(node.parentNode.parentNode, "ol"));
    })
    && !nodeList.some(function(node) { return isHtmlElement(node, "ul") || ("querySelector" in node && node.querySelector("ul")) })) {
        return "ol";
    }

    // "If every member of node list is either a ul or the child of a ul or the
    // child of an li child of a ul, and none is an ol or an ancestor of an ol,
    // return "ul"."
    if (nodeList.every(function(node) {
        return isHtmlElement(node, "ul")
            || isHtmlElement(node.parentNode, "ul")
            || (isHtmlElement(node.parentNode, "li") && isHtmlElement(node.parentNode.parentNode, "ul"));
    })
    && !nodeList.some(function(node) { return isHtmlElement(node, "ol") || ("querySelector" in node && node.querySelector("ol")) })) {
        return "ul";
    }

    var hasOl = nodeList.some(function(node) {
        return isHtmlElement(node, "ol")
            || isHtmlElement(node.parentNode, "ol")
            || ("querySelector" in node && node.querySelector("ol"))
            || (isHtmlElement(node.parentNode, "li") && isHtmlElement(node.parentNode.parentNode, "ol"));
    });
    var hasUl = nodeList.some(function(node) {
        return isHtmlElement(node, "ul")
            || isHtmlElement(node.parentNode, "ul")
            || ("querySelector" in node && node.querySelector("ul"))
            || (isHtmlElement(node.parentNode, "li") && isHtmlElement(node.parentNode.parentNode, "ul"));
    });
    // "If some member of node list is either an ol or the child or ancestor of
    // an ol or the child of an li child of an ol, and some member of node list
    // is either a ul or the child or ancestor of a ul or the child of an li
    // child of a ul, return "mixed"."
    if (hasOl && hasUl) {
        return "mixed";
    }

    // "If some member of node list is either an ol or the child or ancestor of
    // an ol or the child of an li child of an ol, return "mixed ol"."
    if (hasOl) {
        return "mixed ol";
    }

    // "If some member of node list is either a ul or the child or ancestor of
    // a ul or the child of an li child of a ul, return "mixed ul"."
    if (hasUl) {
        return "mixed ul";
    }

    // "Return "none"."
    return "none";
}

function getAlignmentValue(node) {
    // "While node is neither null nor an Element, or it is an Element but its
    // "display" property has resolved value "inline" or "none", set node to
    // its parent."
    while ((node && node.nodeType != DOM.ELEMENT_NODE)
    || (node.nodeType == DOM.ELEMENT_NODE
    && ["inline", "none"].indexOf(getComputedStyle(node).display) != -1)) {
        node = node.parentNode;
    }

    // "If node is not an Element, return "left"."
    if (!node || node.nodeType != DOM.ELEMENT_NODE) {
        return "left";
    }

    var resolvedValue = getComputedStyle(node).textAlign
        // Hack around browser non-standardness
        .replace(/^-(moz|webkit)-/, "")
        .replace(/^auto$/, "start");

    // "If node's "text-align" property has resolved value "start", return
    // "left" if the directionality of node is "ltr", "right" if it is "rtl"."
    if (resolvedValue == "start") {
        return getDirectionality(node) == "ltr" ? "left" : "right";
    }

    // "If node's "text-align" property has resolved value "end", return
    // "right" if the directionality of node is "ltr", "left" if it is "rtl"."
    if (resolvedValue == "end") {
        return getDirectionality(node) == "ltr" ? "right" : "left";
    }

    // "If node's "text-align" property has resolved value "center", "justify",
    // "left", or "right", return that value."
    if (["center", "justify", "left", "right"].indexOf(resolvedValue) != -1) {
        return resolvedValue;
    }

    // "Return "left"."
    return "left";
}

function getNextEquivalentPoint(node, offset) {
    // "If node's length is zero, return null."
    if (getNodeLength(node) == 0) {
        return null;
    }

    // "If offset is node's length, and node's parent is not null, and node is
    // an inline node, return (node's parent, 1 + node's index)."
    if (offset == getNodeLength(node)
    && node.parentNode
    && isInlineNode(node)) {
        return [node.parentNode, 1 + getNodeIndex(node)];
    }

    // "If node has a child with index offset, and that child's length is not
    // zero, and that child is an inline node, return (that child, 0)."
    if (0 <= offset
    && offset < node.childNodes.length
    && getNodeLength(node.childNodes[offset]) != 0
    && isInlineNode(node.childNodes[offset])) {
        return [node.childNodes[offset], 0];
    }

    // "Return null."
    return null;
}

function getPreviousEquivalentPoint(node, offset) {
    // "If node's length is zero, return null."
    if (getNodeLength(node) == 0) {
        return null;
    }

    // "If offset is 0, and node's parent is not null, and node is an inline
    // node, return (node's parent, node's index)."
    if (offset == 0
    && node.parentNode
    && isInlineNode(node)) {
        return [node.parentNode, getNodeIndex(node)];
    }

    // "If node has a child with index offset − 1, and that child's length is
    // not zero, and that child is an inline node, return (that child, that
    // child's length)."
    if (0 <= offset - 1
    && offset - 1 < node.childNodes.length
    && getNodeLength(node.childNodes[offset - 1]) != 0
    && isInlineNode(node.childNodes[offset - 1])) {
        return [node.childNodes[offset - 1], getNodeLength(node.childNodes[offset - 1])];
    }

    // "Return null."
    return null;
}

function getFirstEquivalentPoint(node, offset) {
    // "While (node, offset)'s previous equivalent point is not null, set
    // (node, offset) to its previous equivalent point."
    var prev;
    while (prev = getPreviousEquivalentPoint(node, offset)) {
        node = prev[0];
        offset = prev[1];
    }

    // "Return (node, offset)."
    return [node, offset];
}

function getLastEquivalentPoint(node, offset) {
    // "While (node, offset)'s next equivalent point is not null, set (node,
    // offset) to its next equivalent point."
    var next;
    while (next = getNextEquivalentPoint(node, offset)) {
        node = next[0];
        offset = next[1];
    }

    // "Return (node, offset)."
    return [node, offset];
}

//@}
///// Block-extending a range /////
//@{

// "A boundary point (node, offset) is a block start point if either node's
// parent is null and offset is zero; or node has a child with index offset −
// 1, and that child is either a visible block node or a visible br."
function isBlockStartPoint(node, offset) {
    return (!node.parentNode && offset == 0)
        || (0 <= offset - 1
        && offset - 1 < node.childNodes.length
        && isVisible(node.childNodes[offset - 1])
        && (isBlockNode(node.childNodes[offset - 1])
        || isHtmlElement(node.childNodes[offset - 1], "br")));
}

// "A boundary point (node, offset) is a block end point if either node's
// parent is null and offset is node's length; or node has a child with index
// offset, and that child is a visible block node."
function isBlockEndPoint(node, offset) {
    return (!node.parentNode && offset == getNodeLength(node))
        || (offset < node.childNodes.length
        && isVisible(node.childNodes[offset])
        && isBlockNode(node.childNodes[offset]));
}

// "A boundary point is a block boundary point if it is either a block start
// point or a block end point."
function isBlockBoundaryPoint(node, offset) {
    return isBlockStartPoint(node, offset)
        || isBlockEndPoint(node, offset);
}

function blockExtend(range) {
    // "Let start node, start offset, end node, and end offset be the start
    // and end nodes and offsets of the range."
    var startNode = range.startContainer;
    var startOffset = range.startOffset;
    var endNode = range.endContainer;
    var endOffset = range.endOffset;

    // "If some ancestor container of start node is an li, set start offset to
    // the index of the last such li in tree order, and set start node to that
    // li's parent."
    var liAncestors = getAncestors(startNode).concat(startNode)
        .filter(function(ancestor) { return isHtmlElement(ancestor, "li") })
        .slice(-1);
    if (liAncestors.length) {
        startOffset = getNodeIndex(liAncestors[0]);
        startNode = liAncestors[0].parentNode;
    }

    // "If (start node, start offset) is not a block start point, repeat the
    // following steps:"
    if (!isBlockStartPoint(startNode, startOffset)) do {
        // "If start offset is zero, set it to start node's index, then set
        // start node to its parent."
        if (startOffset == 0) {
            startOffset = getNodeIndex(startNode);
            startNode = startNode.parentNode;

        // "Otherwise, subtract one from start offset."
        } else {
            startOffset--;
        }

        // "If (start node, start offset) is a block boundary point, break from
        // this loop."
    } while (!isBlockBoundaryPoint(startNode, startOffset));

    // "While start offset is zero and start node's parent is not null, set
    // start offset to start node's index, then set start node to its parent."
    while (startOffset == 0
    && startNode.parentNode) {
        startOffset = getNodeIndex(startNode);
        startNode = startNode.parentNode;
    }

    // "If some ancestor container of end node is an li, set end offset to one
    // plus the index of the last such li in tree order, and set end node to
    // that li's parent."
    var liAncestors = getAncestors(endNode).concat(endNode)
        .filter(function(ancestor) { return isHtmlElement(ancestor, "li") })
        .slice(-1);
    if (liAncestors.length) {
        endOffset = 1 + getNodeIndex(liAncestors[0]);
        endNode = liAncestors[0].parentNode;
    }

    // "If (end node, end offset) is not a block end point, repeat the
    // following steps:"
    if (!isBlockEndPoint(endNode, endOffset)) do {
        // "If end offset is end node's length, set it to one plus end node's
        // index, then set end node to its parent."
        if (endOffset == getNodeLength(endNode)) {
            endOffset = 1 + getNodeIndex(endNode);
            endNode = endNode.parentNode;

        // "Otherwise, add one to end offset.
        } else {
            endOffset++;
        }

        // "If (end node, end offset) is a block boundary point, break from
        // this loop."
    } while (!isBlockBoundaryPoint(endNode, endOffset));

    // "While end offset is end node's length and end node's parent is not
    // null, set end offset to one plus end node's index, then set end node to
    // its parent."
    while (endOffset == getNodeLength(endNode)
    && endNode.parentNode) {
        endOffset = 1 + getNodeIndex(endNode);
        endNode = endNode.parentNode;
    }

    // "Let new range be a new range whose start and end nodes and offsets
    // are start node, start offset, end node, and end offset."
    var newRange = createRange();
    newRange.setStart(startNode, startOffset);
    newRange.setEnd(endNode, endOffset);

    // "Return new range."
    return newRange;
}

function followsLineBreak(node) {
    // "Let offset be zero."
    var offset = 0;

    // "While (node, offset) is not a block boundary point:"
    while (!isBlockBoundaryPoint(node, offset)) {
        // "If node has a visible child with index offset minus one, return
        // false."
        if (0 <= offset - 1
        && offset - 1 < node.childNodes.length
        && isVisible(node.childNodes[offset - 1])) {
            return false;
        }

        // "If offset is zero or node has no children, set offset to node's
        // index, then set node to its parent."
        if (offset == 0
        || !node.hasChildNodes()) {
            offset = getNodeIndex(node);
            node = node.parentNode;

        // "Otherwise, set node to its child with index offset minus one, then
        // set offset to node's length."
        } else {
            node = node.childNodes[offset - 1];
            offset = getNodeLength(node);
        }
    }

    // "Return true."
    return true;
}

function precedesLineBreak(node) {
    // "Let offset be node's length."
    var offset = getNodeLength(node);

    // "While (node, offset) is not a block boundary point:"
    while (!isBlockBoundaryPoint(node, offset)) {
        // "If node has a visible child with index offset, return false."
        if (offset < node.childNodes.length
        && isVisible(node.childNodes[offset])) {
            return false;
        }

        // "If offset is node's length or node has no children, set offset to
        // one plus node's index, then set node to its parent."
        if (offset == getNodeLength(node)
        || !node.hasChildNodes()) {
            offset = 1 + getNodeIndex(node);
            node = node.parentNode;

        // "Otherwise, set node to its child with index offset and set offset
        // to zero."
        } else {
            node = node.childNodes[offset];
            offset = 0;
        }
    }

    // "Return true."
    return true;
}

//@}
///// Recording and restoring overrides /////
//@{

function recordCurrentOverrides() {
    // "Let overrides be a list of (string, string or boolean) ordered pairs,
    // initially empty."
    var overrides = [];

    // "If there is a value override for "createLink", add ("createLink", value
    // override for "createLink") to overrides."
    if (getValueOverride("createlink") !== undefined) {
        overrides.push(["createlink", getValueOverride("createlink")]);
    }

    // "For each command in the list "bold", "italic", "strikethrough",
    // "subscript", "superscript", "underline", in order: if there is a state
    // override for command, add (command, command's state override) to
    // overrides."
    ["bold", "italic", "strikethrough", "subscript", "superscript",
    "underline"].forEach(function(command) {
        if (getStateOverride(command) !== undefined) {
            overrides.push([command, getStateOverride(command)]);
        }
    });

    // "For each command in the list "fontName", "fontSize", "foreColor",
    // "hiliteColor", in order: if there is a value override for command, add
    // (command, command's value override) to overrides."
    ["fontname", "fontsize", "forecolor",
    "hilitecolor"].forEach(function(command) {
        if (getValueOverride(command) !== undefined) {
            overrides.push([command, getValueOverride(command)]);
        }
    });

    // "Return overrides."
    return overrides;
}

function recordCurrentStatesAndValues() {
    // "Let overrides be a list of (string, string or boolean) ordered pairs,
    // initially empty."
    var overrides = [];

    // "Let node be the first formattable node effectively contained in the
    // active range, or null if there is none."
    var node = getAllEffectivelyContainedNodes(getActiveRange())
        .filter(isFormattableNode)[0];

    // "If node is null, return overrides."
    if (!node) {
        return overrides;
    }

    // "Add ("createLink", node's effective command value for "createLink") to
    // overrides."
    overrides.push(["createlink", getEffectiveCommandValue(node, "createlink")]);

    // "For each command in the list "bold", "italic", "strikethrough",
    // "subscript", "superscript", "underline", in order: if node's effective
    // command value for command is one of its inline command activated values,
    // add (command, true) to overrides, and otherwise add (command, false) to
    // overrides."
    ["bold", "italic", "strikethrough", "subscript", "superscript",
    "underline"].forEach(function(command) {
        if (commands[command].inlineCommandActivatedValues
        .indexOf(getEffectiveCommandValue(node, command)) != -1) {
            overrides.push([command, true]);
        } else {
            overrides.push([command, false]);
        }
    });

    // "For each command in the list "fontName", "foreColor", "hiliteColor", in
    // order: add (command, command's value) to overrides."
    ["fontname", "fontsize", "forecolor", "hilitecolor"].forEach(function(command) {
        overrides.push([command, commands[command].value()]);
    });

    // "Add ("fontSize", node's effective command value for "fontSize") to
    // overrides."
    overrides.push(["fontsize", getEffectiveCommandValue(node, "fontsize")]);

    // "Return overrides."
    return overrides;
}

function restoreStatesAndValues(overrides) {
    // "Let node be the first formattable node effectively contained in the
    // active range, or null if there is none."
    var node = getAllEffectivelyContainedNodes(getActiveRange())
        .filter(isFormattableNode)[0];

    // "If node is not null, then for each (command, override) pair in
    // overrides, in order:"
    if (node) {
        for (var i = 0; i < overrides.length; i++) {
            var command = overrides[i][0];
            var override = overrides[i][1];

            // "If override is a boolean, and queryCommandState(command)
            // returns something different from override, take the action for
            // command, with value equal to the empty string."
            if (typeof override == "boolean"
            && queryCommandState(command) != override) {
                commands[command].action("");

            // "Otherwise, if override is a string, and command is neither
            // "createLink" nor "fontSize", and queryCommandValue(command)
            // returns something not equivalent to override, take the action
            // for command, with value equal to override."
            } else if (typeof override == "string"
            && command != "createlink"
            && command != "fontsize"
            && !areEquivalentValues(command, queryCommandValue(command), override)) {
                commands[command].action(override);

            // "Otherwise, if override is a string; and command is
            // "createLink"; and either there is a value override for
            // "createLink" that is not equal to override, or there is no value
            // override for "createLink" and node's effective command value for
            // "createLink" is not equal to override: take the action for
            // "createLink", with value equal to override."
            } else if (typeof override == "string"
            && command == "createlink"
            && (
                (
                    getValueOverride("createlink") !== undefined
                    && getValueOverride("createlink") !== override
                ) || (
                    getValueOverride("createlink") === undefined
                    && getEffectiveCommandValue(node, "createlink") !== override
                )
            )) {
                commands.createlink.action(override);

            // "Otherwise, if override is a string; and command is "fontSize";
            // and either there is a value override for "fontSize" that is not
            // equal to override, or there is no value override for "fontSize"
            // and node's effective command value for "fontSize" is not loosely
            // equivalent to override:"
            } else if (typeof override == "string"
            && command == "fontsize"
            && (
                (
                    getValueOverride("fontsize") !== undefined
                    && getValueOverride("fontsize") !== override
                ) || (
                    getValueOverride("fontsize") === undefined
                    && !areLooselyEquivalentValues(command, getEffectiveCommandValue(node, "fontsize"), override)
                )
            )) {
                // "Convert override to an integer number of pixels, and set
                // override to the legacy font size for the result."
                override = getLegacyFontSize(override);

                // "Take the action for "fontSize", with value equal to
                // override."
                commands.fontsize.action(override);

            // "Otherwise, continue this loop from the beginning."
            } else {
                continue;
            }

            // "Set node to the first formattable node effectively contained in
            // the active range, if there is one."
            node = getAllEffectivelyContainedNodes(getActiveRange())
                .filter(isFormattableNode)[0]
                || node;
        }

    // "Otherwise, for each (command, override) pair in overrides, in order:"
    } else {
        for (var i = 0; i < overrides.length; i++) {
            var command = overrides[i][0];
            var override = overrides[i][1];

            // "If override is a boolean, set the state override for command to
            // override."
            if (typeof override == "boolean") {
                setStateOverride(command, override);
            }

            // "If override is a string, set the value override for command to
            // override."
            if (typeof override == "string") {
                setValueOverride(command, override);
            }
        }
    }
}

//@}
///// Deleting the selection /////
//@{

// The flags argument is a dictionary that can have blockMerging,
// stripWrappers, and/or direction as keys.
function deleteSelection(flags) {
    if (flags === undefined) {
        flags = {};
    }

    var blockMerging = "blockMerging" in flags ? Boolean(flags.blockMerging) : true;
    var stripWrappers = "stripWrappers" in flags ? Boolean(flags.stripWrappers) : true;
    var direction = "direction" in flags ? flags.direction : "forward";

    // "If the active range is null, abort these steps and do nothing."
    if (!getActiveRange()) {
        return;
    }

    // "Canonicalize whitespace at the active range's start."
    canonicalizeWhitespace(getActiveRange().startContainer, getActiveRange().startOffset);

    // "Canonicalize whitespace at the active range's end."
    canonicalizeWhitespace(getActiveRange().endContainer, getActiveRange().endOffset);

    // "Let (start node, start offset) be the last equivalent point for the
    // active range's start."
    var start = getLastEquivalentPoint(getActiveRange().startContainer, getActiveRange().startOffset);
    var startNode = start[0];
    var startOffset = start[1];

    // "Let (end node, end offset) be the first equivalent point for the active
    // range's end."
    var end = getFirstEquivalentPoint(getActiveRange().endContainer, getActiveRange().endOffset);
    var endNode = end[0];
    var endOffset = end[1];

    // "If (end node, end offset) is not after (start node, start offset):"
    if (getPosition(endNode, endOffset, startNode, startOffset) !== "after") {
        // "If direction is "forward", call collapseToStart() on the context
        // object's Selection."
        //
        // Here and in a few other places, we check rangeCount to work around a
        // WebKit bug: it will sometimes incorrectly remove ranges from the
        // selection if nodes are removed, so collapseToStart() will throw.
        // This will break everything if we're using an actual selection, but
        // if getActiveRange() is really just returning globalRange and that's
        // all we care about, it will work fine.  I only add the extra check
        // for errors I actually hit in testing.
        if (direction == "forward") {
            if (getSelection().rangeCount) {
                getSelection().collapseToStart();
            }
            getActiveRange().collapse(true);

        // "Otherwise, call collapseToEnd() on the context object's Selection."
        } else {
            getSelection().collapseToEnd();
            getActiveRange().collapse(false);
        }

        // "Abort these steps."
        return;
    }

    // "If start node is a Text node and start offset is 0, set start offset to
    // the index of start node, then set start node to its parent."
    if (startNode.nodeType == DOM.TEXT_NODE
    && startOffset == 0) {
        startOffset = getNodeIndex(startNode);
        startNode = startNode.parentNode;
    }

    // "If end node is a Text node and end offset is its length, set end offset
    // to one plus the index of end node, then set end node to its parent."
    if (endNode.nodeType == DOM.TEXT_NODE
    && endOffset == getNodeLength(endNode)) {
        endOffset = 1 + getNodeIndex(endNode);
        endNode = endNode.parentNode;
    }

    // "Call collapse(start node, start offset) on the context object's
    // Selection."
    getSelection().collapse(startNode, startOffset);
    getActiveRange().setStart(startNode, startOffset);

    // "Call extend(end node, end offset) on the context object's Selection."
    getSelection().extend(endNode, endOffset);
    getActiveRange().setEnd(endNode, endOffset);

    // "Let start block be the active range's start node."
    var startBlock = getActiveRange().startContainer;

    // "While start block's parent is in the same editing host and start block
    // is an inline node, set start block to its parent."
    while (inSameEditingHost(startBlock, startBlock.parentNode)
    && isInlineNode(startBlock)) {
        startBlock = startBlock.parentNode;
    }

    // "If start block is neither a block node nor an editing host, or "span"
    // is not an allowed child of start block, or start block is a td or th,
    // set start block to null."
    if ((!isBlockNode(startBlock) && !isEditingHost(startBlock))
    || !isAllowedChild("span", startBlock)
    || isHtmlElement(startBlock, ["td", "th"])) {
        startBlock = null;
    }

    // "Let end block be the active range's end node."
    var endBlock = getActiveRange().endContainer;

    // "While end block's parent is in the same editing host and end block is
    // an inline node, set end block to its parent."
    while (inSameEditingHost(endBlock, endBlock.parentNode)
    && isInlineNode(endBlock)) {
        endBlock = endBlock.parentNode;
    }

    // "If end block is neither a block node nor an editing host, or "span" is
    // not an allowed child of end block, or end block is a td or th, set end
    // block to null."
    if ((!isBlockNode(endBlock) && !isEditingHost(endBlock))
    || !isAllowedChild("span", endBlock)
    || isHtmlElement(endBlock, ["td", "th"])) {
        endBlock = null;
    }

    // "Record current states and values, and let overrides be the result."
    var overrides = recordCurrentStatesAndValues();

    // "If start node and end node are the same, and start node is an editable
    // Text node:"
    if (startNode == endNode
    && isEditable(startNode)
    && startNode.nodeType == DOM.TEXT_NODE) {
        // "Call deleteData(start offset, end offset − start offset) on start
        // node."
        startNode.deleteData(startOffset, endOffset - startOffset);

        // "Canonicalize whitespace at (start node, start offset), with fix
        // collapsed space false."
        canonicalizeWhitespace(startNode, startOffset, false);

        // "If direction is "forward", call collapseToStart() on the context
        // object's Selection."
        if (direction == "forward") {
            if (getSelection().rangeCount) {
                getSelection().collapseToStart();
            }
            getActiveRange().collapse(true);

        // "Otherwise, call collapseToEnd() on the context object's Selection."
        } else {
            getSelection().collapseToEnd();
            getActiveRange().collapse(false);
        }

        // "Restore states and values from overrides."
        restoreStatesAndValues(overrides);

        // "Abort these steps."
        return;
    }

    // "If start node is an editable Text node, call deleteData() on it, with
    // start offset as the first argument and (length of start node − start
    // offset) as the second argument."
    if (isEditable(startNode)
    && startNode.nodeType == DOM.TEXT_NODE) {
        startNode.deleteData(startOffset, getNodeLength(startNode) - startOffset);
    }

    // "Let node list be a list of nodes, initially empty."
    //
    // "For each node contained in the active range, append node to node list
    // if the last member of node list (if any) is not an ancestor of node;
    // node is editable; and node is not a thead, tbody, tfoot, tr, th, or td."
    var nodeList = getContainedNodes(getActiveRange(),
        function(node) {
            return isEditable(node)
                && !isHtmlElement(node, ["thead", "tbody", "tfoot", "tr", "th", "td"]);
        }
    );

    // "For each node in node list:"
    for (var i = 0; i < nodeList.length; i++) {
        var node = nodeList[i];

        // "Let parent be the parent of node."
        var parent_ = node.parentNode;

        // "Remove node from parent."
        parent_.removeChild(node);

        // "If the block node of parent has no visible children, and parent is
        // editable or an editing host, call createElement("br") on the context
        // object and append the result as the last child of parent."
        if (![].some.call(getBlockNodeOf(parent_).childNodes, isVisible)
        && (isEditable(parent_) || isEditingHost(parent_))) {
            parent_.appendChild(createElement("br"));
        }

        // "If strip wrappers is true or parent is not an ancestor container of
        // start node, while parent is an editable inline node with length 0,
        // let grandparent be the parent of parent, then remove parent from
        // grandparent, then set parent to grandparent."
        if (stripWrappers
        || (!isAncestor(parent_, startNode) && parent_ != startNode)) {
            while (isEditable(parent_)
            && isInlineNode(parent_)
            && getNodeLength(parent_) == 0) {
                var grandparent = parent_.parentNode;
                grandparent.removeChild(parent_);
                parent_ = grandparent;
            }
        }
    }

    // "If end node is an editable Text node, call deleteData(0, end offset) on
    // it."
    if (isEditable(endNode)
    && endNode.nodeType == DOM.TEXT_NODE) {
        endNode.deleteData(0, endOffset);
    }

    // "Canonicalize whitespace at the active range's start, with fix collapsed
    // space false."
    canonicalizeWhitespace(getActiveRange().startContainer, getActiveRange().startOffset, false);

    // "Canonicalize whitespace at the active range's end, with fix collapsed
    // space false."
    canonicalizeWhitespace(getActiveRange().endContainer, getActiveRange().endOffset, false);

    // "If block merging is false, or start block or end block is null, or
    // start block is not in the same editing host as end block, or start block
    // and end block are the same:"
    if (!blockMerging
    || !startBlock
    || !endBlock
    || !inSameEditingHost(startBlock, endBlock)
    || startBlock == endBlock) {
        // "If direction is "forward", call collapseToStart() on the context
        // object's Selection."
        if (direction == "forward") {
            if (getSelection().rangeCount) {
                getSelection().collapseToStart();
            }
            getActiveRange().collapse(true);

        // "Otherwise, call collapseToEnd() on the context object's Selection."
        } else {
            if (getSelection().rangeCount) {
                getSelection().collapseToEnd();
            }
            getActiveRange().collapse(false);
        }

        // "Restore states and values from overrides."
        restoreStatesAndValues(overrides);

        // "Abort these steps."
        return;
    }

    // "If start block has one child, which is a collapsed block prop, remove
    // its child from it."
    if (startBlock.childNodes.filter(function(child) { return child.nodeType == DOM.ELEMENT_NODE }).length == 1
    && isCollapsedBlockProp(startBlock.firstChild)) {
        startBlock.removeChild(startBlock.firstChild);
    }

    // "If start block is an ancestor of end block:"
    if (isAncestor(startBlock, endBlock)) {
        // "Let reference node be end block."
        var referenceNode = endBlock;

        // "While reference node is not a child of start block, set reference
        // node to its parent."
        while (referenceNode.parentNode != startBlock) {
            referenceNode = referenceNode.parentNode;
        }

        // "Call collapse() on the context object's Selection, with first
        // argument start block and second argument the index of reference
        // node."
        getSelection().collapse(startBlock, getNodeIndex(referenceNode));
        getActiveRange().setStart(startBlock, getNodeIndex(referenceNode));
        getActiveRange().collapse(true);

        // "If end block has no children:"
        if (!endBlock.hasChildNodes()) {
            // "While end block is editable and is the only child of its parent
            // and is not a child of start block, let parent equal end block,
            // then remove end block from parent, then set end block to
            // parent."
            while (isEditable(endBlock)
            && endBlock.parentNode.childNodes.length == 1
            && endBlock.parentNode != startBlock) {
                var parent_ = endBlock;
                parent_.removeChild(endBlock);
                endBlock = parent_;
            }

            // "If end block is editable and is not an inline node, and its
            // previousSibling and nextSibling are both inline nodes, call
            // createElement("br") on the context object and insert it into end
            // block's parent immediately after end block."
            if (isEditable(endBlock)
            && !isInlineNode(endBlock)
            && isInlineNode(endBlock.previousSibling)
            && isInlineNode(endBlock.nextSibling)) {
                endBlock.parentNode.insertBefore(createElement("br"), endBlock.nextSibling);
            }

            // "If end block is editable, remove it from its parent."
            if (isEditable(endBlock)) {
                endBlock.parentNode.removeChild(endBlock);
            }

            // "Restore states and values from overrides."
            restoreStatesAndValues(overrides);

            // "Abort these steps."
            return;
        }

        // "If end block's firstChild is not an inline node, restore states and
        // values from overrides, then abort these steps."
        if (!isInlineNode(endBlock.firstChild)) {
            restoreStatesAndValues(overrides);
            return;
        }

        // "Let children be a list of nodes, initially empty."
        var children = [];

        // "Append the first child of end block to children."
        children.push(endBlock.firstChild);

        // "While children's last member is not a br, and children's last
        // member's nextSibling is an inline node, append children's last
        // member's nextSibling to children."
        while (!isHtmlElement(children[children.length - 1], "br")
        && isInlineNode(children[children.length - 1].nextSibling)) {
            children.push(children[children.length - 1].nextSibling);
        }

        // "Record the values of children, and let values be the result."
        var values = recordValues(children);

        // "While children's first member's parent is not start block, split
        // the parent of children."
        while (children[0].parentNode != startBlock) {
            splitParent(children);
        }

        // "If children's first member's previousSibling is an editable br,
        // remove that br from its parent."
        if (isEditable(children[0].previousSibling)
        && isHtmlElement(children[0].previousSibling, "br")) {
            children[0].parentNode.removeChild(children[0].previousSibling);
        }

    // "Otherwise, if start block is a descendant of end block:"
    } else if (isDescendant(startBlock, endBlock)) {
        // "Call collapse() on the context object's Selection, with first
        // argument start block and second argument start block's length."
        getSelection().collapse(startBlock, getNodeLength(startBlock));
        getActiveRange().setStart(startBlock, getNodeLength(startBlock));
        getActiveRange().collapse(true);

        // "Let reference node be start block."
        var referenceNode = startBlock;

        // "While reference node is not a child of end block, set reference
        // node to its parent."
        while (referenceNode.parentNode != endBlock) {
            referenceNode = referenceNode.parentNode;
        }

        // "If reference node's nextSibling is an inline node and start block's
        // lastChild is a br, remove start block's lastChild from it."
        if (isInlineNode(referenceNode.nextSibling)
        && isHtmlElement(startBlock.lastChild, "br")) {
            startBlock.removeChild(startBlock.lastChild);
        }

        // "Let nodes to move be a list of nodes, initially empty."
        var nodesToMove = [];

        // "If reference node's nextSibling is neither null nor a block node,
        // append it to nodes to move."
        if (referenceNode.nextSibling
        && !isBlockNode(referenceNode.nextSibling)) {
            nodesToMove.push(referenceNode.nextSibling);
        }

        // "While nodes to move is nonempty and its last member isn't a br and
        // its last member's nextSibling is neither null nor a block node,
        // append its last member's nextSibling to nodes to move."
        if (nodesToMove.length
        && !isHtmlElement(nodesToMove[nodesToMove.length - 1], "br")
        && nodesToMove[nodesToMove.length - 1].nextSibling
        && !isBlockNode(nodesToMove[nodesToMove.length - 1].nextSibling)) {
            nodesToMove.push(nodesToMove[nodesToMove.length - 1].nextSibling);
        }

        // "Record the values of nodes to move, and let values be the result."
        var values = recordValues(nodesToMove);

        // "For each node in nodes to move, append node as the last child of
        // start block, preserving ranges."
        nodesToMove.forEach(function(node) {
            movePreservingRanges(node, startBlock, -1);
        });

    // "Otherwise:"
    } else {
        // "Call collapse() on the context object's Selection, with first
        // argument start block and second argument start block's length."
        getSelection().collapse(startBlock, getNodeLength(startBlock));
        getActiveRange().setStart(startBlock, getNodeLength(startBlock));
        getActiveRange().collapse(true);

        // "If end block's firstChild is an inline node and start block's
        // lastChild is a br, remove start block's lastChild from it."
        if (isInlineNode(endBlock.firstChild)
        && isHtmlElement(startBlock.lastChild, "br")) {
            startBlock.removeChild(startBlock.lastChild);
        }

        // "Record the values of end block's children, and let values be the
        // result."
        var values = recordValues([].slice.call(endBlock.childNodes));

        // "While end block has children, append the first child of end block
        // to start block, preserving ranges."
        while (endBlock.hasChildNodes()) {
            movePreservingRanges(endBlock.firstChild, startBlock, -1);
        }

        // "While end block has no children, let parent be the parent of end
        // block, then remove end block from parent, then set end block to
        // parent."
        while (!endBlock.hasChildNodes()) {
            var parent_ = endBlock.parentNode;
            parent_.removeChild(endBlock);
            endBlock = parent_;
        }
    }

    // "Let ancestor be start block."
    var ancestor = startBlock;

    // "While ancestor has an inclusive ancestor ol in the same editing host
    // whose nextSibling is also an ol in the same editing host, or an
    // inclusive ancestor ul in the same editing host whose nextSibling is also
    // a ul in the same editing host:"
    while (getInclusiveAncestors(ancestor).some(function(node) {
        return inSameEditingHost(ancestor, node)
            && (
                (isHtmlElement(node, "ol") && isHtmlElement(node.nextSibling, "ol"))
                || (isHtmlElement(node, "ul") && isHtmlElement(node.nextSibling, "ul"))
            ) && inSameEditingHost(ancestor, node.nextSibling);
    })) {
        // "While ancestor and its nextSibling are not both ols in the same
        // editing host, and are also not both uls in the same editing host,
        // set ancestor to its parent."
        while (!(
            isHtmlElement(ancestor, "ol")
            && isHtmlElement(ancestor.nextSibling, "ol")
            && inSameEditingHost(ancestor, ancestor.nextSibling)
        ) && !(
            isHtmlElement(ancestor, "ul")
            && isHtmlElement(ancestor.nextSibling, "ul")
            && inSameEditingHost(ancestor, ancestor.nextSibling)
        )) {
            ancestor = ancestor.parentNode;
        }

        // "While ancestor's nextSibling has children, append ancestor's
        // nextSibling's firstChild as the last child of ancestor, preserving
        // ranges."
        while (ancestor.nextSibling.hasChildNodes()) {
            movePreservingRanges(ancestor.nextSibling.firstChild, ancestor, -1);
        }

        // "Remove ancestor's nextSibling from its parent."
        ancestor.parentNode.removeChild(ancestor.nextSibling);
    }

    // "Restore the values from values."
    restoreValues(values);

    // "If start block has no children, call createElement("br") on the context
    // object and append the result as the last child of start block."
    if (!startBlock.hasChildNodes()) {
        startBlock.appendChild(createElement("br"));
    }

    // "Remove extraneous line breaks at the end of start block."
    removeExtraneousLineBreaksAtTheEndOf(startBlock);

    // "Restore states and values from overrides."
    restoreStatesAndValues(overrides);
}


//@}
///// Splitting a node list's parent /////
//@{

function splitParent(nodeList) {
    // "Let original parent be the parent of the first member of node list."
    var originalParent = nodeList[0].parentNode;

    // "If original parent is not editable or its parent is null, do nothing
    // and abort these steps."
    if (!isEditable(originalParent)
    || !originalParent.parentNode) {
        return;
    }

    // "If the first child of original parent is in node list, remove
    // extraneous line breaks before original parent."
    if (nodeList.indexOf(originalParent.firstChild) != -1) {
        removeExtraneousLineBreaksBefore(originalParent);
    }

    // "If the first child of original parent is in node list, and original
    // parent follows a line break, set follows line break to true. Otherwise,
    // set follows line break to false."
    var followsLineBreak_ = nodeList.indexOf(originalParent.firstChild) != -1
        && followsLineBreak(originalParent);

    // "If the last child of original parent is in node list, and original
    // parent precedes a line break, set precedes line break to true.
    // Otherwise, set precedes line break to false."
    var precedesLineBreak_ = nodeList.indexOf(originalParent.lastChild) != -1
        && precedesLineBreak(originalParent);

    // "If the first child of original parent is not in node list, but its last
    // child is:"
    if (nodeList.indexOf(originalParent.firstChild) == -1
    && nodeList.indexOf(originalParent.lastChild) != -1) {
        // "For each node in node list, in reverse order, insert node into the
        // parent of original parent immediately after original parent,
        // preserving ranges."
        for (var i = nodeList.length - 1; i >= 0; i--) {
            movePreservingRanges(nodeList[i], originalParent.parentNode, 1 + getNodeIndex(originalParent));
        }

        // "If precedes line break is true, and the last member of node list
        // does not precede a line break, call createElement("br") on the
        // context object and insert the result immediately after the last
        // member of node list."
        if (precedesLineBreak_
        && !precedesLineBreak(nodeList[nodeList.length - 1])) {
            nodeList[nodeList.length - 1].parentNode.insertBefore(createElement("br"), nodeList[nodeList.length - 1].nextSibling);
        }

        // "Remove extraneous line breaks at the end of original parent."
        removeExtraneousLineBreaksAtTheEndOf(originalParent);

        // "Abort these steps."
        return;
    }

    // "If the first child of original parent is not in node list:"
    if (nodeList.indexOf(originalParent.firstChild) == -1) {
        // "Let cloned parent be the result of calling cloneNode(false) on
        // original parent."
        var clonedParent = originalParent.cloneNode(false);

        // "If original parent has an id attribute, unset it."
        originalParent.removeAttribute("id");

        // "Insert cloned parent into the parent of original parent immediately
        // before original parent."
        originalParent.parentNode.insertBefore(clonedParent, originalParent);

        // "While the previousSibling of the first member of node list is not
        // null, append the first child of original parent as the last child of
        // cloned parent, preserving ranges."
        while (nodeList[0].previousSibling) {
            movePreservingRanges(originalParent.firstChild, clonedParent, clonedParent.childNodes.length);
        }
    }

    // "For each node in node list, insert node into the parent of original
    // parent immediately before original parent, preserving ranges."
    for (var i = 0; i < nodeList.length; i++) {
        movePreservingRanges(nodeList[i], originalParent.parentNode, getNodeIndex(originalParent));
    }

    // "If follows line break is true, and the first member of node list does
    // not follow a line break, call createElement("br") on the context object
    // and insert the result immediately before the first member of node list."
    if (followsLineBreak_
    && !followsLineBreak(nodeList[0])) {
        nodeList[0].parentNode.insertBefore(createElement("br"), nodeList[0]);
    }

    // "If the last member of node list is an inline node other than a br, and
    // the first child of original parent is a br, and original parent is not
    // an inline node, remove the first child of original parent from original
    // parent."
    if (isInlineNode(nodeList[nodeList.length - 1])
    && !isHtmlElement(nodeList[nodeList.length - 1], "br")
    && isHtmlElement(originalParent.firstChild, "br")
    && !isInlineNode(originalParent)) {
        originalParent.removeChild(originalParent.firstChild);
    }

    // "If original parent has no children:"
    if (!originalParent.hasChildNodes()) {
        // "Remove original parent from its parent."
        originalParent.parentNode.removeChild(originalParent);

        // "If precedes line break is true, and the last member of node list
        // does not precede a line break, call createElement("br") on the
        // context object and insert the result immediately after the last
        // member of node list."
        if (precedesLineBreak_
        && !precedesLineBreak(nodeList[nodeList.length - 1])) {
            nodeList[nodeList.length - 1].parentNode.insertBefore(createElement("br"), nodeList[nodeList.length - 1].nextSibling);
        }

    // "Otherwise, remove extraneous line breaks before original parent."
    } else {
        removeExtraneousLineBreaksBefore(originalParent);
    }

    // "If node list's last member's nextSibling is null, but its parent is not
    // null, remove extraneous line breaks at the end of node list's last
    // member's parent."
    if (!nodeList[nodeList.length - 1].nextSibling
    && nodeList[nodeList.length - 1].parentNode) {
        removeExtraneousLineBreaksAtTheEndOf(nodeList[nodeList.length - 1].parentNode);
    }
}

// "To remove a node node while preserving its descendants, split the parent of
// node's children if it has any. If it has no children, instead remove it from
// its parent."
function removePreservingDescendants(node) {
    if (node.hasChildNodes()) {
        splitParent([].slice.call(node.childNodes));
    } else {
        node.parentNode.removeChild(node);
    }
}


//@}
///// Canonical space sequences /////
//@{

function canonicalSpaceSequence(n, nonBreakingStart, nonBreakingEnd) {
    // "If n is zero, return the empty string."
    if (n == 0) {
        return "";
    }

    // "If n is one and both non-breaking start and non-breaking end are false,
    // return a single space (U+0020)."
    if (n == 1 && !nonBreakingStart && !nonBreakingEnd) {
        return " ";
    }

    // "If n is one, return a single non-breaking space (U+00A0)."
    if (n == 1) {
        return "\xa0";
    }

    // "Let buffer be the empty string."
    var buffer = "";

    // "If non-breaking start is true, let repeated pair be U+00A0 U+0020.
    // Otherwise, let it be U+0020 U+00A0."
    var repeatedPair;
    if (nonBreakingStart) {
        repeatedPair = "\xa0 ";
    } else {
        repeatedPair = " \xa0";
    }

    // "While n is greater than three, append repeated pair to buffer and
    // subtract two from n."
    while (n > 3) {
        buffer += repeatedPair;
        n -= 2;
    }

    // "If n is three, append a three-element string to buffer depending on
    // non-breaking start and non-breaking end:"
    if (n == 3) {
        buffer +=
            !nonBreakingStart && !nonBreakingEnd ? " \xa0 "
            : nonBreakingStart && !nonBreakingEnd ? "\xa0\xa0 "
            : !nonBreakingStart && nonBreakingEnd ? " \xa0\xa0"
            : nonBreakingStart && nonBreakingEnd ? "\xa0 \xa0"
            : "impossible";

    // "Otherwise, append a two-element string to buffer depending on
    // non-breaking start and non-breaking end:"
    } else {
        buffer +=
            !nonBreakingStart && !nonBreakingEnd ? "\xa0 "
            : nonBreakingStart && !nonBreakingEnd ? "\xa0 "
            : !nonBreakingStart && nonBreakingEnd ? " \xa0"
            : nonBreakingStart && nonBreakingEnd ? "\xa0\xa0"
            : "impossible";
    }

    // "Return buffer."
    return buffer;
}

function canonicalizeWhitespace(node, offset, fixCollapsedSpace) {
    if (fixCollapsedSpace === undefined) {
        // "an optional boolean argument fix collapsed space that defaults to
        // true"
        fixCollapsedSpace = true;
    }

    // "If node is neither editable nor an editing host, abort these steps."
    if (!isEditable(node) && !isEditingHost(node)) {
        return;
    }

    // "Let start node equal node and let start offset equal offset."
    var startNode = node;
    var startOffset = offset;

    // "Repeat the following steps:"
    while (true) {
        // "If start node has a child in the same editing host with index start
        // offset minus one, set start node to that child, then set start
        // offset to start node's length."
        if (0 <= startOffset - 1
        && inSameEditingHost(startNode, startNode.childNodes[startOffset - 1])) {
            startNode = startNode.childNodes[startOffset - 1];
            startOffset = getNodeLength(startNode);

        // "Otherwise, if start offset is zero and start node does not follow a
        // line break and start node's parent is in the same editing host, set
        // start offset to start node's index, then set start node to its
        // parent."
        } else if (startOffset == 0
        && !followsLineBreak(startNode)
        && inSameEditingHost(startNode, startNode.parentNode)) {
            startOffset = getNodeIndex(startNode);
            startNode = startNode.parentNode;

        // "Otherwise, if start node is a Text node and its parent's resolved
        // value for "white-space" is neither "pre" nor "pre-wrap" and start
        // offset is not zero and the (start offset − 1)st element of start
        // node's data is a space (0x0020) or non-breaking space (0x00A0),
        // subtract one from start offset."
        } else if (startNode.nodeType == DOM.TEXT_NODE
        && ["pre", "pre-wrap"].indexOf(getComputedStyle(startNode.parentNode).whiteSpace) == -1
        && startOffset != 0
        && /[ \xa0]/.test(startNode.data[startOffset - 1])) {
            startOffset--;

        // "Otherwise, break from this loop."
        } else {
            break;
        }
    }

    // "Let end node equal start node and end offset equal start offset."
    var endNode = startNode;
    var endOffset = startOffset;

    // "Let length equal zero."
    var length = 0;

    // "Let collapse spaces be true if start offset is zero and start node
    // follows a line break, otherwise false."
    var collapseSpaces = startOffset == 0 && followsLineBreak(startNode);

    // "Repeat the following steps:"
    while (true) {
        // "If end node has a child in the same editing host with index end
        // offset, set end node to that child, then set end offset to zero."
        if (endOffset < endNode.childNodes.length
        && inSameEditingHost(endNode, endNode.childNodes[endOffset])) {
            endNode = endNode.childNodes[endOffset];
            endOffset = 0;

        // "Otherwise, if end offset is end node's length and end node does not
        // precede a line break and end node's parent is in the same editing
        // host, set end offset to one plus end node's index, then set end node
        // to its parent."
        } else if (endOffset == getNodeLength(endNode)
        && !precedesLineBreak(endNode)
        && inSameEditingHost(endNode, endNode.parentNode)) {
            endOffset = 1 + getNodeIndex(endNode);
            endNode = endNode.parentNode;

        // "Otherwise, if end node is a Text node and its parent's resolved
        // value for "white-space" is neither "pre" nor "pre-wrap" and end
        // offset is not end node's length and the end offsetth element of
        // end node's data is a space (0x0020) or non-breaking space (0x00A0):"
        } else if (endNode.nodeType == DOM.TEXT_NODE
        && ["pre", "pre-wrap"].indexOf(getComputedStyle(endNode.parentNode).whiteSpace) == -1
        && endOffset != getNodeLength(endNode)
        && /[ \xa0]/.test(endNode.data[endOffset])) {
            // "If fix collapsed space is true, and collapse spaces is true,
            // and the end offsetth code unit of end node's data is a space
            // (0x0020): call deleteData(end offset, 1) on end node, then
            // continue this loop from the beginning."
            if (fixCollapsedSpace
            && collapseSpaces
            && " " == endNode.data[endOffset]) {
                endNode.deleteData(endOffset, 1);
                continue;
            }

            // "Set collapse spaces to true if the end offsetth element of end
            // node's data is a space (0x0020), false otherwise."
            collapseSpaces = " " == endNode.data[endOffset];

            // "Add one to end offset."
            endOffset++;

            // "Add one to length."
            length++;

        // "Otherwise, break from this loop."
        } else {
            break;
        }
    }

    // "If fix collapsed space is true, then while (start node, start offset)
    // is before (end node, end offset):"
    if (fixCollapsedSpace) {
        while (getPosition(startNode, startOffset, endNode, endOffset) == "before") {
            // "If end node has a child in the same editing host with index end
            // offset − 1, set end node to that child, then set end offset to end
            // node's length."
            if (0 <= endOffset - 1
            && endOffset - 1 < endNode.childNodes.length
            && inSameEditingHost(endNode, endNode.childNodes[endOffset - 1])) {
                endNode = endNode.childNodes[endOffset - 1];
                endOffset = getNodeLength(endNode);

            // "Otherwise, if end offset is zero and end node's parent is in the
            // same editing host, set end offset to end node's index, then set end
            // node to its parent."
            } else if (endOffset == 0
            && inSameEditingHost(endNode, endNode.parentNode)) {
                endOffset = getNodeIndex(endNode);
                endNode = endNode.parentNode;

            // "Otherwise, if end node is a Text node and its parent's resolved
            // value for "white-space" is neither "pre" nor "pre-wrap" and end
            // offset is end node's length and the last code unit of end node's
            // data is a space (0x0020) and end node precedes a line break:"
            } else if (endNode.nodeType == DOM.TEXT_NODE
            && ["pre", "pre-wrap"].indexOf(getComputedStyle(endNode.parentNode).whiteSpace) == -1
            && endOffset == getNodeLength(endNode)
            && endNode.data[endNode.data.length - 1] == " "
            && precedesLineBreak(endNode)) {
                // "Subtract one from end offset."
                endOffset--;

                // "Subtract one from length."
                length--;

                // "Call deleteData(end offset, 1) on end node."
                endNode.deleteData(endOffset, 1);

            // "Otherwise, break from this loop."
            } else {
                break;
            }
        }
    }

    // "Let replacement whitespace be the canonical space sequence of length
    // length. non-breaking start is true if start offset is zero and start
    // node follows a line break, and false otherwise. non-breaking end is true
    // if end offset is end node's length and end node precedes a line break,
    // and false otherwise."
    var replacementWhitespace = canonicalSpaceSequence(length,
        startOffset == 0 && followsLineBreak(startNode),
        endOffset == getNodeLength(endNode) && precedesLineBreak(endNode));

    // "While (start node, start offset) is before (end node, end offset):"
    while (getPosition(startNode, startOffset, endNode, endOffset) == "before") {
        // "If start node has a child with index start offset, set start node
        // to that child, then set start offset to zero."
        if (startOffset < startNode.childNodes.length) {
            startNode = startNode.childNodes[startOffset];
            startOffset = 0;

        // "Otherwise, if start node is not a Text node or if start offset is
        // start node's length, set start offset to one plus start node's
        // index, then set start node to its parent."
        } else if (startNode.nodeType != DOM.TEXT_NODE
        || startOffset == getNodeLength(startNode)) {
            startOffset = 1 + getNodeIndex(startNode);
            startNode = startNode.parentNode;

        // "Otherwise:"
        } else {
            // "Remove the first element from replacement whitespace, and let
            // element be that element."
            var element = replacementWhitespace[0];
            replacementWhitespace = replacementWhitespace.slice(1);

            // "If element is not the same as the start offsetth element of
            // start node's data:"
            if (element != startNode.data[startOffset]) {
                // "Call insertData(start offset, element) on start node."
                startNode.insertData(startOffset, element);

                // "Call deleteData(start offset + 1, 1) on start node."
                startNode.deleteData(startOffset + 1, 1);
            }

            // "Add one to start offset."
            startOffset++;
        }
    }
}


//@}
///// Indenting and outdenting /////
//@{

function indentNodes(nodeList) {
    // "If node list is empty, do nothing and abort these steps."
    if (!nodeList.length) {
        return;
    }

    // "Let first node be the first member of node list."
    var firstNode = nodeList[0];

    // "If first node's parent is an ol or ul:"
    if (isHtmlElement(firstNode.parentNode, ["OL", "UL"])) {
        // "Let tag be the local name of the parent of first node."
        var tag = firstNode.parentNode.tagName;

        // "Wrap node list, with sibling criteria returning true for an HTML
        // element with local name tag and false otherwise, and new parent
        // instructions returning the result of calling createElement(tag) on
        // the ownerDocument of first node."
        wrap(nodeList,
            function(node) { return isHtmlElement(node, tag) },
            function() { return createElement(tag) });

        // "Abort these steps."
        return;
    }

    // "Wrap node list, with sibling criteria returning true for a simple
    // indentation element and false otherwise, and new parent instructions
    // returning the result of calling createElement("blockquote") on the
    // ownerDocument of first node. Let new parent be the result."
    var newParent = wrap(nodeList,
        function(node) { return isSimpleIndentationElement(node) },
        function() { return createElement("blockquote") });

    // "Fix disallowed ancestors of new parent."
    fixDisallowedAncestors(newParent);
}

function outdentNode(node) {
    // "If node is not editable, abort these steps."
    if (!isEditable(node)) {
        return;
    }

    // "If node is a simple indentation element, remove node, preserving its
    // descendants.  Then abort these steps."
    if (isSimpleIndentationElement(node)) {
        removePreservingDescendants(node);
        return;
    }

    // "If node is an indentation element:"
    if (isIndentationElement(node)) {
        // "Unset the dir attribute of node, if any."
        node.removeAttribute("dir");

        // "Unset the margin, padding, and border CSS properties of node."
        node.style.margin = "";
        node.style.padding = "";
        node.style.border = "";
        if (node.getAttribute("style") == ""
        // Crazy WebKit bug: https://bugs.webkit.org/show_bug.cgi?id=68551
        || node.getAttribute("style") == "border-width: initial; border-color: initial; ") {
            node.removeAttribute("style");
        }

        // "Set the tag name of node to "div"."
        setTagName(node, "div");

        // "Abort these steps."
        return;
    }

    // "Let current ancestor be node's parent."
    var currentAncestor = node.parentNode;

    // "Let ancestor list be a list of nodes, initially empty."
    var ancestorList = [];

    // "While current ancestor is an editable Element that is neither a simple
    // indentation element nor an ol nor a ul, append current ancestor to
    // ancestor list and then set current ancestor to its parent."
    while (isEditable(currentAncestor)
    && currentAncestor.nodeType == DOM.ELEMENT_NODE
    && !isSimpleIndentationElement(currentAncestor)
    && !isHtmlElement(currentAncestor, ["ol", "ul"])) {
        ancestorList.push(currentAncestor);
        currentAncestor = currentAncestor.parentNode;
    }

    // "If current ancestor is not an editable simple indentation element:"
    if (!isEditable(currentAncestor)
    || !isSimpleIndentationElement(currentAncestor)) {
        // "Let current ancestor be node's parent."
        currentAncestor = node.parentNode;

        // "Let ancestor list be the empty list."
        ancestorList = [];

        // "While current ancestor is an editable Element that is neither an
        // indentation element nor an ol nor a ul, append current ancestor to
        // ancestor list and then set current ancestor to its parent."
        while (isEditable(currentAncestor)
        && currentAncestor.nodeType == DOM.ELEMENT_NODE
        && !isIndentationElement(currentAncestor)
        && !isHtmlElement(currentAncestor, ["ol", "ul"])) {
            ancestorList.push(currentAncestor);
            currentAncestor = currentAncestor.parentNode;
        }
    }

    // "If node is an ol or ul and current ancestor is not an editable
    // indentation element:"
    if (isHtmlElement(node, ["OL", "UL"])
    && (!isEditable(currentAncestor)
    || !isIndentationElement(currentAncestor))) {
        // "Unset the reversed, start, and type attributes of node, if any are
        // set."
        node.removeAttribute("reversed");
        node.removeAttribute("start");
        node.removeAttribute("type");

        // "Let children be the children of node."
        var children = [].slice.call(node.childNodes);

        // "If node has attributes, and its parent is not an ol or ul, set the
        // tag name of node to "div"."
        if (attributesOf(node).length
        && !isHtmlElement(node.parentNode, ["OL", "UL"])) {
            setTagName(node, "div");

        // "Otherwise:"
        } else {
            // "Record the values of node's children, and let values be the
            // result."
            var values = recordValues([].slice.call(node.childNodes));

            // "Remove node, preserving its descendants."
            removePreservingDescendants(node);

            // "Restore the values from values."
            restoreValues(values);
        }

        // "Fix disallowed ancestors of each member of children."
        for (var i = 0; i < children.length; i++) {
            fixDisallowedAncestors(children[i]);
        }

        // "Abort these steps."
        return;
    }

    // "If current ancestor is not an editable indentation element, abort these
    // steps."
    if (!isEditable(currentAncestor)
    || !isIndentationElement(currentAncestor)) {
        return;
    }

    // "Append current ancestor to ancestor list."
    ancestorList.push(currentAncestor);

    // "Let original ancestor be current ancestor."
    var originalAncestor = currentAncestor;

    // "While ancestor list is not empty:"
    while (ancestorList.length) {
        // "Let current ancestor be the last member of ancestor list."
        //
        // "Remove the last member of ancestor list."
        currentAncestor = ancestorList.pop();

        // "Let target be the child of current ancestor that is equal to either
        // node or the last member of ancestor list."
        var target = node.parentNode == currentAncestor
            ? node
            : ancestorList[ancestorList.length - 1];

        // "If target is an inline node that is not a br, and its nextSibling
        // is a br, remove target's nextSibling from its parent."
        if (isInlineNode(target)
        && !isHtmlElement(target, "BR")
        && isHtmlElement(target.nextSibling, "BR")) {
            target.parentNode.removeChild(target.nextSibling);
        }

        // "Let preceding siblings be the preceding siblings of target, and let
        // following siblings be the following siblings of target."
        var precedingSiblings = [].slice.call(currentAncestor.childNodes, 0, getNodeIndex(target));
        var followingSiblings = [].slice.call(currentAncestor.childNodes, 1 + getNodeIndex(target));

        // "Indent preceding siblings."
        indentNodes(precedingSiblings);

        // "Indent following siblings."
        indentNodes(followingSiblings);
    }

    // "Outdent original ancestor."
    outdentNode(originalAncestor);
}


//@}
///// Toggling lists /////
//@{

function toggleLists(tagName) {
    // "Let mode be "disable" if the selection's list state is tag name, and
    // "enable" otherwise."
    var mode = getSelectionListState() == tagName ? "disable" : "enable";

    var range = getActiveRange();
    tagName = tagName.toUpperCase();

    // "Let other tag name be "ol" if tag name is "ul", and "ul" if tag name is
    // "ol"."
    var otherTagName = tagName == "OL" ? "UL" : "OL";

    // "Let items be a list of all lis that are ancestor containers of the
    // range's start and/or end node."
    //
    // It's annoying to get this in tree order using functional stuff without
    // doing getDescendants(document), which is slow, so I do it imperatively.
    var items = [];
    (function(){
        for (
            var ancestorContainer = range.endContainer;
            ancestorContainer != range.commonAncestorContainer;
            ancestorContainer = ancestorContainer.parentNode
        ) {
            if (isHtmlElement(ancestorContainer, "li")) {
                items.unshift(ancestorContainer);
            }
        }
        for (
            var ancestorContainer = range.startContainer;
            ancestorContainer;
            ancestorContainer = ancestorContainer.parentNode
        ) {
            if (isHtmlElement(ancestorContainer, "li")) {
                items.unshift(ancestorContainer);
            }
        }
    })();

    // "For each item in items, normalize sublists of item."
    items.forEach(normalizeSublists);

    // "Block-extend the range, and let new range be the result."
    var newRange = blockExtend(range);

    // "If mode is "enable", then let lists to convert consist of every
    // editable HTML element with local name other tag name that is contained
    // in new range, and for every list in lists to convert:"
    if (mode == "enable") {
        getAllContainedNodes(newRange, function(node) {
            return isEditable(node)
                && isHtmlElement(node, otherTagName);
        }).forEach(function(list) {
            // "If list's previousSibling or nextSibling is an editable HTML
            // element with local name tag name:"
            if ((isEditable(list.previousSibling) && isHtmlElement(list.previousSibling, tagName))
            || (isEditable(list.nextSibling) && isHtmlElement(list.nextSibling, tagName))) {
                // "Let children be list's children."
                var children = [].slice.call(list.childNodes);

                // "Record the values of children, and let values be the
                // result."
                var values = recordValues(children);

                // "Split the parent of children."
                splitParent(children);

                // "Wrap children, with sibling criteria returning true for an
                // HTML element with local name tag name and false otherwise."
                wrap(children, function(node) { return isHtmlElement(node, tagName) });

                // "Restore the values from values."
                restoreValues(values);

            // "Otherwise, set the tag name of list to tag name."
            } else {
                setTagName(list, tagName);
            }
        });
    }

    // "Let node list be a list of nodes, initially empty."
    //
    // "For each node node contained in new range, if node is editable; the
    // last member of node list (if any) is not an ancestor of node; node
    // is not an indentation element; and either node is an ol or ul, or its
    // parent is an ol or ul, or it is an allowed child of "li"; then append
    // node to node list."
    var nodeList = getContainedNodes(newRange, function(node) {
        return isEditable(node)
        && !isIndentationElement(node)
        && (isHtmlElement(node, ["OL", "UL"])
        || isHtmlElement(node.parentNode, ["OL", "UL"])
        || isAllowedChild(node, "li"));
    });

    // "If mode is "enable", remove from node list any ol or ul whose parent is
    // not also an ol or ul."
    if (mode == "enable") {
        nodeList = nodeList.filter(function(node) {
            return !isHtmlElement(node, ["ol", "ul"])
                || isHtmlElement(node.parentNode, ["ol", "ul"]);
        });
    }

    // "If mode is "disable", then while node list is not empty:"
    if (mode == "disable") {
        while (nodeList.length) {
            // "Let sublist be an empty list of nodes."
            var sublist = [];

            // "Remove the first member from node list and append it to
            // sublist."
            sublist.push(nodeList.shift());

            // "If the first member of sublist is an HTML element with local
            // name tag name, outdent it and continue this loop from the
            // beginning."
            if (isHtmlElement(sublist[0], tagName)) {
                outdentNode(sublist[0]);
                continue;
            }

            // "While node list is not empty, and the first member of node list
            // is the nextSibling of the last member of sublist and is not an
            // HTML element with local name tag name, remove the first member
            // from node list and append it to sublist."
            while (nodeList.length
            && nodeList[0] == sublist[sublist.length - 1].nextSibling
            && !isHtmlElement(nodeList[0], tagName)) {
                sublist.push(nodeList.shift());
            }

            // "Record the values of sublist, and let values be the result."
            var values = recordValues(sublist);

            // "Split the parent of sublist."
            splitParent(sublist);

            // "Fix disallowed ancestors of each member of sublist."
            for (var i = 0; i < sublist.length; i++) {
                fixDisallowedAncestors(sublist[i]);
            }

            // "Restore the values from values."
            restoreValues(values);
        }

    // "Otherwise, while node list is not empty:"
    } else {
        while (nodeList.length) {
            // "Let sublist be an empty list of nodes."
            var sublist = [];

            // "While either sublist is empty, or node list is not empty and
            // its first member is the nextSibling of sublist's last member:"
            while (!sublist.length
            || (nodeList.length
            && nodeList[0] == sublist[sublist.length - 1].nextSibling)) {
                // "If node list's first member is a p or div, set the tag name
                // of node list's first member to "li", and append the result
                // to sublist. Remove the first member from node list."
                if (isHtmlElement(nodeList[0], ["p", "div"])) {
                    sublist.push(setTagName(nodeList[0], "li"));
                    nodeList.shift();

                // "Otherwise, if the first member of node list is an li or ol
                // or ul, remove it from node list and append it to sublist."
                } else if (isHtmlElement(nodeList[0], ["li", "ol", "ul"])) {
                    sublist.push(nodeList.shift());

                // "Otherwise:"
                } else {
                    // "Let nodes to wrap be a list of nodes, initially empty."
                    var nodesToWrap = [];

                    // "While nodes to wrap is empty, or node list is not empty
                    // and its first member is the nextSibling of nodes to
                    // wrap's last member and the first member of node list is
                    // an inline node and the last member of nodes to wrap is
                    // an inline node other than a br, remove the first member
                    // from node list and append it to nodes to wrap."
                    while (!nodesToWrap.length
                    || (nodeList.length
                    && nodeList[0] == nodesToWrap[nodesToWrap.length - 1].nextSibling
                    && isInlineNode(nodeList[0])
                    && isInlineNode(nodesToWrap[nodesToWrap.length - 1])
                    && !isHtmlElement(nodesToWrap[nodesToWrap.length - 1], "br"))) {
                        nodesToWrap.push(nodeList.shift());
                    }

                    // "Wrap nodes to wrap, with new parent instructions
                    // returning the result of calling createElement("li") on
                    // the context object. Append the result to sublist."
                    sublist.push(wrap(nodesToWrap,
                        undefined,
                        function() { return createElement("li") }));
                }
            }

            // "If sublist's first member's parent is an HTML element with
            // local name tag name, or if every member of sublist is an ol or
            // ul, continue this loop from the beginning."
            if (isHtmlElement(sublist[0].parentNode, tagName)
            || sublist.every(function(node) { return isHtmlElement(node, ["ol", "ul"]) })) {
                continue;
            }

            // "If sublist's first member's parent is an HTML element with
            // local name other tag name:"
            if (isHtmlElement(sublist[0].parentNode, otherTagName)) {
                // "Record the values of sublist, and let values be the
                // result."
                var values = recordValues(sublist);

                // "Split the parent of sublist."
                splitParent(sublist);

                // "Wrap sublist, with sibling criteria returning true for an
                // HTML element with local name tag name and false otherwise,
                // and new parent instructions returning the result of calling
                // createElement(tag name) on the context object."
                wrap(sublist,
                    function(node) { return isHtmlElement(node, tagName) },
                    function() { return createElement(tagName) });

                // "Restore the values from values."
                restoreValues(values);

                // "Continue this loop from the beginning."
                continue;
            }

            // "Wrap sublist, with sibling criteria returning true for an HTML
            // element with local name tag name and false otherwise, and new
            // parent instructions being the following:"
            // . . .
            // "Fix disallowed ancestors of the previous step's result."
            fixDisallowedAncestors(wrap(sublist,
                function(node) { return isHtmlElement(node, tagName) },
                function() {
                    // "If sublist's first member's parent is not an editable
                    // simple indentation element, or sublist's first member's
                    // parent's previousSibling is not an editable HTML element
                    // with local name tag name, call createElement(tag name)
                    // on the context object and return the result."
                    if (!isEditable(sublist[0].parentNode)
                    || !isSimpleIndentationElement(sublist[0].parentNode)
                    || !isEditable(sublist[0].parentNode.previousSibling)
                    || !isHtmlElement(sublist[0].parentNode.previousSibling, tagName)) {
                        return createElement(tagName);
                    }

                    // "Let list be sublist's first member's parent's
                    // previousSibling."
                    var list = sublist[0].parentNode.previousSibling;

                    // "Normalize sublists of list's lastChild."
                    normalizeSublists(list.lastChild);

                    // "If list's lastChild is not an editable HTML element
                    // with local name tag name, call createElement(tag name)
                    // on the context object, and append the result as the last
                    // child of list."
                    if (!isEditable(list.lastChild)
                    || !isHtmlElement(list.lastChild, tagName)) {
                        list.appendChild(createElement(tagName));
                    }

                    // "Return the last child of list."
                    return list.lastChild;
                }
            ));
        }
    }
}


//@}
///// Justifying the selection /////
//@{

function justifySelection(alignment) {
    // "Block-extend the active range, and let new range be the result."
    var newRange = blockExtend(globalRange);

    // "Let element list be a list of all editable Elements contained in new
    // range that either has an attribute in the HTML namespace whose local
    // name is "align", or has a style attribute that sets "text-align", or is
    // a center."
    var elementList = getAllContainedNodes(newRange, function(node) {
        return node.nodeType == DOM.ELEMENT_NODE
            && isEditable(node)
            // Ignoring namespaces here
            && (
                node.hasAttribute("align")
                || node.style.textAlign != ""
                || isHtmlElement(node, "center")
            );
    });

    // "For each element in element list:"
    for (var i = 0; i < elementList.length; i++) {
        var element = elementList[i];

        // "If element has an attribute in the HTML namespace whose local name
        // is "align", remove that attribute."
        element.removeAttribute("align");

        // "Unset the CSS property "text-align" on element, if it's set by a
        // style attribute."
        element.style.textAlign = "";
        if (element.getAttribute("style") == "") {
            element.removeAttribute("style");
        }

        // "If element is a div or span or center with no attributes, remove
        // it, preserving its descendants."
        if (isHtmlElement(element, ["div", "span", "center"])
        && !attributesOf(element).length) {
            removePreservingDescendants(element);
        }

        // "If element is a center with one or more attributes, set the tag
        // name of element to "div"."
        if (isHtmlElement(element, "center")
        && attributesOf(element).length) {
            setTagName(element, "div");
        }
    }

    // "Block-extend the active range, and let new range be the result."
    newRange = blockExtend(globalRange);

    // "Let node list be a list of nodes, initially empty."
    var nodeList = [];

    // "For each node node contained in new range, append node to node list if
    // the last member of node list (if any) is not an ancestor of node; node
    // is editable; node is an allowed child of "div"; and node's alignment
    // value is not alignment."
    nodeList = getContainedNodes(newRange, function(node) {
        return isEditable(node)
            && isAllowedChild(node, "div")
            && getAlignmentValue(node) != alignment;
    });

    // "While node list is not empty:"
    while (nodeList.length) {
        // "Let sublist be a list of nodes, initially empty."
        var sublist = [];

        // "Remove the first member of node list and append it to sublist."
        sublist.push(nodeList.shift());

        // "While node list is not empty, and the first member of node list is
        // the nextSibling of the last member of sublist, remove the first
        // member of node list and append it to sublist."
        while (nodeList.length
        && nodeList[0] == sublist[sublist.length - 1].nextSibling) {
            sublist.push(nodeList.shift());
        }

        // "Wrap sublist. Sibling criteria returns true for any div that has
        // one or both of the following two attributes and no other attributes,
        // and false otherwise:"
        //
        //   * "An align attribute whose value is an ASCII case-insensitive
        //     match for alignment.
        //   * "A style attribute which sets exactly one CSS property
        //     (including unrecognized or invalid attributes), which is
        //     "text-align", which is set to alignment.
        //
        // "New parent instructions are to call createElement("div") on the
        // context object, then set its CSS property "text-align" to alignment
        // and return the result."
        wrap(sublist,
            function(node) {
                return isHtmlElement(node, "div")
                    && [].every.call(attributesOf(node), function(attr) {
                        return (attr.name == "align" && attr.value.toLowerCase() == alignment)
                            || (attr.name == "style" && node.style.length == 1 && node.style.textAlign == alignment);
                    });
            },
            function() {
                var newParent = createElement("div");
                newParent.setAttribute("style", "text-align: " + alignment);
                return newParent;
            }
        );
    }
}


//@}
///// Automatic linking /////
//@{
// "An autolinkable URL is a string of the following form:"
var autolinkableUrlRegexp =
    // "Either a string matching the scheme pattern from RFC 3986 section 3.1
    // followed by the literal string ://, or the literal string mailto:;
    // followed by"
    //
    // From the RFC: scheme      = ALPHA *( ALPHA / DIGIT / "+" / "-" / "." )
    "([a-zA-Z][a-zA-Z0-9+.-]*://|mailto:)"
    // "Zero or more characters other than space characters; followed by"
    + "[^ \t\n\f\r]*"
    // "A character that is not one of the ASCII characters !"'(),-.:;<>[]`{}."
    + "[^!\"'(),\\-.:;<>[\\]`{}]";

// "A valid e-mail address is a string that matches the ABNF production 1*(
// atext / "." ) "@" ldh-str *( "." ldh-str ) where atext is defined in RFC
// 5322 section 3.2.3, and ldh-str is defined in RFC 1034 section 3.5."
//
// atext: ALPHA / DIGIT / "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" /
// "/" / "=" / "?" / "^" / "_" / "`" / "{" / "|" / "}" / "~"
//
//<ldh-str> ::= <let-dig-hyp> | <let-dig-hyp> <ldh-str>
//<let-dig-hyp> ::= <let-dig> | "-"
//<let-dig> ::= <letter> | <digit>
var validEmailRegexp =
    "[a-zA-Z0-9!#$%&'*+\\-/=?^_`{|}~.]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*";

function autolink(node, endOffset) {
    // "While (node, end offset)'s previous equivalent point is not null, set
    // it to its previous equivalent point."
    while (getPreviousEquivalentPoint(node, endOffset)) {
        var prev = getPreviousEquivalentPoint(node, endOffset);
        node = prev[0];
        endOffset = prev[1];
    }

    // "If node is not a Text node, or has an a ancestor, do nothing and abort
    // these steps."
    if (node.nodeType != DOM.TEXT_NODE
    || getAncestors(node).some(function(ancestor) { return isHtmlElement(ancestor, "a") })) {
        return;
    }

    // "Let search be the largest substring of node's data whose end is end
    // offset and that contains no space characters."
    var search = /[^ \t\n\f\r]*$/.exec(node.substringData(0, endOffset))[0];

    // "If some substring of search is an autolinkable URL:"
    if (new RegExp(autolinkableUrlRegexp).test(search)) {
        // "While there is no substring of node's data ending at end offset
        // that is an autolinkable URL, decrement end offset."
        while (!(new RegExp(autolinkableUrlRegexp + "$").test(node.substringData(0, endOffset)))) {
            endOffset--;
        }

        // "Let start offset be the start index of the longest substring of
        // node's data that is an autolinkable URL ending at end offset."
        var startOffset = new RegExp(autolinkableUrlRegexp + "$").exec(node.substringData(0, endOffset)).index;

        // "Let href be the substring of node's data starting at start offset
        // and ending at end offset."
        var href = node.substringData(startOffset, endOffset - startOffset);

    // "Otherwise, if some substring of search is a valid e-mail address:"
    } else if (new RegExp(validEmailRegexp).test(search)) {
        // "While there is no substring of node's data ending at end offset
        // that is a valid e-mail address, decrement end offset."
        while (!(new RegExp(validEmailRegexp + "$").test(node.substringData(0, endOffset)))) {
            endOffset--;
        }

        // "Let start offset be the start index of the longest substring of
        // node's data that is a valid e-mail address ending at end offset."
        var startOffset = new RegExp(validEmailRegexp + "$").exec(node.substringData(0, endOffset)).index;

        // "Let href be "mailto:" concatenated with the substring of node's
        // data starting at start offset and ending at end offset."
        var href = "mailto:" + node.substringData(startOffset, endOffset - startOffset);

    // "Otherwise, do nothing and abort these steps."
    } else {
        return;
    }

    // "Let original range be the active range."
    var originalRange = getActiveRange();

    // "Create a new range with start (node, start offset) and end (node, end
    // offset), and set the context object's selection's range to it."
    var newRange = createRange();
    newRange.setStart(node, startOffset);
    newRange.setEnd(node, endOffset);
    getSelection().removeAllRanges();
    getSelection().addRange(newRange);
    globalRange = newRange;

    // "Take the action for "createLink", with value equal to href."
    commands.createlink.action(href);

    // "Set the context object's selection's range to original range."
    getSelection().removeAllRanges();
    getSelection().addRange(originalRange);
    globalRange = originalRange;
}
//@}
///// The delete command /////
//@{
commands["delete"] = {
    preservesOverrides: true,
    action: function() {
        // "If the active range is not collapsed, delete the selection and
        // return true."
        if (!getActiveRange().collapsed) {
            deleteSelection();
            return true;
        }

        // "Canonicalize whitespace at the active range's start."
        canonicalizeWhitespace(getActiveRange().startContainer, getActiveRange().startOffset);

        // "Let node and offset be the active range's start node and offset."
        var node = getActiveRange().startContainer;
        var offset = getActiveRange().startOffset;

        // "Repeat the following steps:"
        while (true) {
            // "If offset is zero and node's previousSibling is an editable
            // invisible node, remove node's previousSibling from its parent."
            if (offset == 0
            && isEditable(node.previousSibling)
            && isInvisible(node.previousSibling)) {
                node.parentNode.removeChild(node.previousSibling);

            // "Otherwise, if node has a child with index offset − 1 and that
            // child is an editable invisible node, remove that child from
            // node, then subtract one from offset."
            } else if (0 <= offset - 1
            && offset - 1 < node.childNodes.length
            && isEditable(node.childNodes[offset - 1])
            && isInvisible(node.childNodes[offset - 1])) {
                node.removeChild(node.childNodes[offset - 1]);
                offset--;

            // "Otherwise, if offset is zero and node is an inline node, or if
            // node is an invisible node, set offset to the index of node, then
            // set node to its parent."
            } else if ((offset == 0
            && isInlineNode(node))
            || isInvisible(node)) {
                offset = getNodeIndex(node);
                node = node.parentNode;

            // "Otherwise, if node has a child with index offset − 1 and that
            // child is an editable a, remove that child from node, preserving
            // its descendants. Then return true."
            } else if (0 <= offset - 1
            && offset - 1 < node.childNodes.length
            && isEditable(node.childNodes[offset - 1])
            && isHtmlElement(node.childNodes[offset - 1], "a")) {
                removePreservingDescendants(node.childNodes[offset - 1]);
                return true;

            // A non-editable element inside the editing host (an island) is
            // removed whole. The spec does not define this case.
            } else if (0 <= offset - 1
            && offset - 1 < node.childNodes.length
            && isEditable(node)
            && node.childNodes[offset - 1].nodeType == DOM.ELEMENT_NODE
            && !isEditable(node.childNodes[offset - 1])) {
                node.removeChild(node.childNodes[offset - 1]);
                getSelection().collapse(node, offset - 1);
                getActiveRange().setStart(node, offset - 1);
                getActiveRange().setEnd(node, offset - 1);
                return true;

            // "Otherwise, if node has a child with index offset − 1 and that
            // child is not a block node or a br or an img, set node to that
            // child, then set offset to the length of node."
            } else if (0 <= offset - 1
            && offset - 1 < node.childNodes.length
            && !isBlockNode(node.childNodes[offset - 1])
            && !isHtmlElement(node.childNodes[offset - 1], ["br", "img"])) {
                node = node.childNodes[offset - 1];
                offset = getNodeLength(node);

            // "Otherwise, break from this loop."
            } else {
                break;
            }
        }

        // "If node is a Text node and offset is not zero, or if node is a
        // block node that has a child with index offset − 1 and that child is
        // a br or hr or img:"
        if ((node.nodeType == DOM.TEXT_NODE
        && offset != 0)
        || (isBlockNode(node)
        && 0 <= offset - 1
        && offset - 1 < node.childNodes.length
        && isHtmlElement(node.childNodes[offset - 1], ["br", "hr", "img"]))) {
            // "Call collapse(node, offset) on the context object's Selection."
            getSelection().collapse(node, offset);
            getActiveRange().setEnd(node, offset);

            // "Call extend(node, offset − 1) on the context object's
            // Selection."
            getSelection().extend(node, offset - 1);
            getActiveRange().setStart(node, offset - 1);

            // "Delete the selection."
            deleteSelection();

            // "Return true."
            return true;
        }

        // "If node is an inline node, return true."
        if (isInlineNode(node)) {
            return true;
        }

        // "If node is an li or dt or dd and is the first child of its parent,
        // and offset is zero:"
        if (isHtmlElement(node, ["li", "dt", "dd"])
        && node == node.parentNode.firstChild
        && offset == 0) {
            // "Let items be a list of all lis that are ancestors of node."
            //
            // Remember, must be in tree order.
            var items = [];
            for (var ancestor = node.parentNode; ancestor; ancestor = ancestor.parentNode) {
                if (isHtmlElement(ancestor, "li")) {
                    items.unshift(ancestor);
                }
            }

            // "Normalize sublists of each item in items."
            for (var i = 0; i < items.length; i++) {
                normalizeSublists(items[i]);
            }

            // "Record the values of the one-node list consisting of node, and
            // let values be the result."
            var values = recordValues([node]);

            // "Split the parent of the one-node list consisting of node."
            splitParent([node]);

            // "Restore the values from values."
            restoreValues(values);

            // "If node is a dd or dt, and it is not an allowed child of any of
            // its ancestors in the same editing host, set the tag name of node
            // to the default single-line container name and let node be the
            // result."
            if (isHtmlElement(node, ["dd", "dt"])
            && getAncestors(node).every(function(ancestor) {
                return !inSameEditingHost(node, ancestor)
                    || !isAllowedChild(node, ancestor)
            })) {
                node = setTagName(node, defaultSingleLineContainerName);
            }

            // "Fix disallowed ancestors of node."
            fixDisallowedAncestors(node);

            // "Return true."
            return true;
        }

        // "Let start node equal node and let start offset equal offset."
        var startNode = node;
        var startOffset = offset;

        // "Repeat the following steps:"
        while (true) {
            // "If start offset is zero, set start offset to the index of start
            // node and then set start node to its parent."
            if (startOffset == 0) {
                startOffset = getNodeIndex(startNode);
                startNode = startNode.parentNode;

            // "Otherwise, if start node has an editable invisible child with
            // index start offset minus one, remove it from start node and
            // subtract one from start offset."
            } else if (0 <= startOffset - 1
            && startOffset - 1 < startNode.childNodes.length
            && isEditable(startNode.childNodes[startOffset - 1])
            && isInvisible(startNode.childNodes[startOffset - 1])) {
                startNode.removeChild(startNode.childNodes[startOffset - 1]);
                startOffset--;

            // "Otherwise, break from this loop."
            } else {
                break;
            }
        }

        // "If offset is zero, and node has an editable ancestor container in
        // the same editing host that's an indentation element:"
        if (offset == 0
        && getAncestors(node).concat(node).filter(function(ancestor) {
            return isEditable(ancestor)
                && inSameEditingHost(ancestor, node)
                && isIndentationElement(ancestor);
        }).length) {
            // "Block-extend the range whose start and end are both (node, 0),
            // and let new range be the result."
            var newRange = createRange();
            newRange.setStart(node, 0);
            newRange = blockExtend(newRange);

            // "Let node list be a list of nodes, initially empty."
            //
            // "For each node current node contained in new range, append
            // current node to node list if the last member of node list (if
            // any) is not an ancestor of current node, and current node is
            // editable but has no editable descendants."
            var nodeList = getContainedNodes(newRange, function(currentNode) {
                return isEditable(currentNode)
                    && !hasEditableDescendants(currentNode);
            });

            // "Outdent each node in node list."
            for (var i = 0; i < nodeList.length; i++) {
                outdentNode(nodeList[i]);
            }

            // "Return true."
            return true;
        }

        // "If the child of start node with index start offset is a table,
        // return true."
        if (isHtmlElement(startNode.childNodes[startOffset], "table")) {
            return true;
        }

        // "If start node has a child with index start offset − 1, and that
        // child is a table:"
        if (0 <= startOffset - 1
        && startOffset - 1 < startNode.childNodes.length
        && isHtmlElement(startNode.childNodes[startOffset - 1], "table")) {
            // "Call collapse(start node, start offset − 1) on the context
            // object's Selection."
            getSelection().collapse(startNode, startOffset - 1);
            getActiveRange().setStart(startNode, startOffset - 1);

            // "Call extend(start node, start offset) on the context object's
            // Selection."
            getSelection().extend(startNode, startOffset);
            getActiveRange().setEnd(startNode, startOffset);

            // "Return true."
            return true;
        }

        // "If offset is zero; and either the child of start node with index
        // start offset minus one is an hr, or the child is a br whose
        // previousSibling is either a br or not an inline node:"
        if (offset == 0
        && (isHtmlElement(startNode.childNodes[startOffset - 1], "hr")
            || (
                isHtmlElement(startNode.childNodes[startOffset - 1], "br")
                && (
                    isHtmlElement(startNode.childNodes[startOffset - 1].previousSibling, "br")
                    || !isInlineNode(startNode.childNodes[startOffset - 1].previousSibling)
                )
            )
        )) {
            // "Call collapse(start node, start offset − 1) on the context
            // object's Selection."
            getSelection().collapse(startNode, startOffset - 1);
            getActiveRange().setStart(startNode, startOffset - 1);

            // "Call extend(start node, start offset) on the context object's
            // Selection."
            getSelection().extend(startNode, startOffset);
            getActiveRange().setEnd(startNode, startOffset);

            // "Delete the selection."
            deleteSelection();

            // "Call collapse(node, offset) on the Selection."
            getSelection().collapse(node, offset);
            getActiveRange().setStart(node, offset);
            getActiveRange().collapse(true);

            // "Return true."
            return true;
        }

        // "If the child of start node with index start offset is an li or dt
        // or dd, and that child's firstChild is an inline node, and start
        // offset is not zero:"
        if (isHtmlElement(startNode.childNodes[startOffset], ["li", "dt", "dd"])
        && isInlineNode(startNode.childNodes[startOffset].firstChild)
        && startOffset != 0) {
            // "Let previous item be the child of start node with index start
            // offset minus one."
            var previousItem = startNode.childNodes[startOffset - 1];

            // "If previous item's lastChild is an inline node other than a br,
            // call createElement("br") on the context object and append the
            // result as the last child of previous item."
            if (isInlineNode(previousItem.lastChild)
            && !isHtmlElement(previousItem.lastChild, "br")) {
                previousItem.appendChild(createElement("br"));
            }

            // "If previous item's lastChild is an inline node, call
            // createElement("br") on the context object and append the result
            // as the last child of previous item."
            if (isInlineNode(previousItem.lastChild)) {
                previousItem.appendChild(createElement("br"));
            }
        }

        // "If start node's child with index start offset is an li or dt or dd,
        // and that child's previousSibling is also an li or dt or dd:"
        if (isHtmlElement(startNode.childNodes[startOffset], ["li", "dt", "dd"])
        && isHtmlElement(startNode.childNodes[startOffset].previousSibling, ["li", "dt", "dd"])) {
            // "Call cloneRange() on the active range, and let original range
            // be the result."
            //
            // We need to add it to extraRanges so it will actually get updated
            // when moving preserving ranges.
            var originalRange = getActiveRange().cloneRange();
            extraRanges.push(originalRange);

            // "Set start node to its child with index start offset − 1."
            startNode = startNode.childNodes[startOffset - 1];

            // "Set start offset to start node's length."
            startOffset = getNodeLength(startNode);

            // "Set node to start node's nextSibling."
            node = startNode.nextSibling;

            // "Call collapse(start node, start offset) on the context object's
            // Selection."
            getSelection().collapse(startNode, startOffset);
            getActiveRange().setStart(startNode, startOffset);

            // "Call extend(node, 0) on the context object's Selection."
            getSelection().extend(node, 0);
            getActiveRange().setEnd(node, 0);

            // "Delete the selection."
            deleteSelection();

            // "Call removeAllRanges() on the context object's Selection."
            getSelection().removeAllRanges();

            // "Call addRange(original range) on the context object's
            // Selection."
            getSelection().addRange(originalRange);
            getActiveRange().setStart(originalRange.startContainer, originalRange.startOffset);
            getActiveRange().setEnd(originalRange.endContainer, originalRange.endOffset);

            // "Return true."
            extraRanges.pop();
            return true;
        }

        // "While start node has a child with index start offset minus one:"
        while (0 <= startOffset - 1
        && startOffset - 1 < startNode.childNodes.length) {
            // "If start node's child with index start offset minus one is
            // editable and invisible, remove it from start node, then subtract
            // one from start offset."
            if (isEditable(startNode.childNodes[startOffset - 1])
            && isInvisible(startNode.childNodes[startOffset - 1])) {
                startNode.removeChild(startNode.childNodes[startOffset - 1]);
                startOffset--;

            // "Otherwise, set start node to its child with index start offset
            // minus one, then set start offset to the length of start node."
            } else {
                startNode = startNode.childNodes[startOffset - 1];
                startOffset = getNodeLength(startNode);
            }
        }

        // "Call collapse(start node, start offset) on the context object's
        // Selection."
        getSelection().collapse(startNode, startOffset);
        getActiveRange().setStart(startNode, startOffset);

        // "Call extend(node, offset) on the context object's Selection."
        getSelection().extend(node, offset);
        getActiveRange().setEnd(node, offset);

        // "Delete the selection, with direction "backward"."
        deleteSelection({direction: "backward"});

        // "Return true."
        return true;
    }
};

//@}
///// The formatBlock command /////
//@{
// "A formattable block name is "address", "dd", "div", "dt", "h1", "h2", "h3",
// "h4", "h5", "h6", "p", or "pre"."
var formattableBlockNames = ["address", "dd", "div", "dt", "h1", "h2", "h3",
    "h4", "h5", "h6", "p", "pre"];

commands.formatblock = {
    preservesOverrides: true,
    action: function(value) {
        // "If value begins with a "<" character and ends with a ">" character,
        // remove the first and last characters from it."
        if (/^<.*>$/.test(value)) {
            value = value.slice(1, -1);
        }

        // "Let value be converted to ASCII lowercase."
        value = value.toLowerCase();

        // "If value is not a formattable block name, return false."
        if (formattableBlockNames.indexOf(value) == -1) {
            return false;
        }

        // "Block-extend the active range, and let new range be the result."
        var newRange = blockExtend(getActiveRange());

        // "Let node list be an empty list of nodes."
        //
        // "For each node node contained in new range, append node to node list
        // if it is editable, the last member of original node list (if any) is
        // not an ancestor of node, node is either a non-list single-line
        // container or an allowed child of "p" or a dd or dt, and node is not
        // the ancestor of a prohibited paragraph child."
        var nodeList = getContainedNodes(newRange, function(node) {
            return isEditable(node)
                && (isNonListSingleLineContainer(node)
                || isAllowedChild(node, "p")
                || isHtmlElement(node, ["dd", "dt"]))
                && !getDescendants(node).some(isProhibitedParagraphChild);
        });

        // "Record the values of node list, and let values be the result."
        var values = recordValues(nodeList);

        // "For each node in node list, while node is the descendant of an
        // editable HTML element in the same editing host, whose local name is
        // a formattable block name, and which is not the ancestor of a
        // prohibited paragraph child, split the parent of the one-node list
        // consisting of node."
        for (var i = 0; i < nodeList.length; i++) {
            var node = nodeList[i];
            while (getAncestors(node).some(function(ancestor) {
                return isEditable(ancestor)
                    && inSameEditingHost(ancestor, node)
                    && isHtmlElement(ancestor, formattableBlockNames)
                    && !getDescendants(ancestor).some(isProhibitedParagraphChild);
            })) {
                splitParent([node]);
            }
        }

        // "Restore the values from values."
        restoreValues(values);

        // "While node list is not empty:"
        while (nodeList.length) {
            var sublist;

            // "If the first member of node list is a single-line
            // container:"
            if (isSingleLineContainer(nodeList[0])) {
                // "Let sublist be the children of the first member of node
                // list."
                sublist = [].slice.call(nodeList[0].childNodes);

                // "Record the values of sublist, and let values be the
                // result."
                var values = recordValues(sublist);

                // "Remove the first member of node list from its parent,
                // preserving its descendants."
                removePreservingDescendants(nodeList[0]);

                // "Restore the values from values."
                restoreValues(values);

                // "Remove the first member from node list."
                nodeList.shift();

            // "Otherwise:"
            } else {
                // "Let sublist be an empty list of nodes."
                sublist = [];

                // "Remove the first member of node list and append it to
                // sublist."
                sublist.push(nodeList.shift());

                // "While node list is not empty, and the first member of
                // node list is the nextSibling of the last member of
                // sublist, and the first member of node list is not a
                // single-line container, and the last member of sublist is
                // not a br, remove the first member of node list and
                // append it to sublist."
                while (nodeList.length
                && nodeList[0] == sublist[sublist.length - 1].nextSibling
                && !isSingleLineContainer(nodeList[0])
                && !isHtmlElement(sublist[sublist.length - 1], "BR")) {
                    sublist.push(nodeList.shift());
                }
            }

            // "Wrap sublist. If value is "div" or "p", sibling criteria
            // returns false; otherwise it returns true for an HTML element
            // with local name value and no attributes, and false otherwise.
            // New parent instructions return the result of running
            // createElement(value) on the context object. Then fix disallowed
            // ancestors of the result."
            fixDisallowedAncestors(wrap(sublist,
                ["div", "p"].indexOf(value) == - 1
                    ? function(node) { return isHtmlElement(node, value) && !attributesOf(node).length }
                    : function() { return false },
                function() { return createElement(value) }));
        }

        // "Return true."
        return true;
    }, indeterm: function() {
        // "If the active range is null, return false."
        if (!getActiveRange()) {
            return false;
        }

        // "Block-extend the active range, and let new range be the result."
        var newRange = blockExtend(getActiveRange());

        // "Let node list be all visible editable nodes that are contained in
        // new range and have no children."
        var nodeList = getAllContainedNodes(newRange, function(node) {
            return isVisible(node)
                && isEditable(node)
                && !node.hasChildNodes();
        });

        // "If node list is empty, return false."
        if (!nodeList.length) {
            return false;
        }

        // "Let type be null."
        var type = null;

        // "For each node in node list:"
        for (var i = 0; i < nodeList.length; i++) {
            var node = nodeList[i];

            // "While node's parent is editable and in the same editing host as
            // node, and node is not an HTML element whose local name is a
            // formattable block name, set node to its parent."
            while (isEditable(node.parentNode)
            && inSameEditingHost(node, node.parentNode)
            && !isHtmlElement(node, formattableBlockNames)) {
                node = node.parentNode;
            }

            // "Let current type be the empty string."
            var currentType = "";

            // "If node is an editable HTML element whose local name is a
            // formattable block name, and node is not the ancestor of a
            // prohibited paragraph child, set current type to node's local
            // name."
            if (isEditable(node)
            && isHtmlElement(node, formattableBlockNames)
            && !getDescendants(node).some(isProhibitedParagraphChild)) {
                currentType = node.tagName;
            }

            // "If type is null, set type to current type."
            if (type === null) {
                type = currentType;

            // "Otherwise, if type does not equal current type, return true."
            } else if (type != currentType) {
                return true;
            }
        }

        // "Return false."
        return false;
    }, value: function() {
        // "If the active range is null, return the empty string."
        if (!getActiveRange()) {
            return "";
        }

        // "Block-extend the active range, and let new range be the result."
        var newRange = blockExtend(getActiveRange());

        // "Let node be the first visible editable node that is contained in
        // new range and has no children. If there is no such node, return the
        // empty string."
        var nodes = getAllContainedNodes(newRange, function(node) {
            return isVisible(node)
                && isEditable(node)
                && !node.hasChildNodes();
        });
        if (!nodes.length) {
            return "";
        }
        var node = nodes[0];

        // "While node's parent is editable and in the same editing host as
        // node, and node is not an HTML element whose local name is a
        // formattable block name, set node to its parent."
        while (isEditable(node.parentNode)
        && inSameEditingHost(node, node.parentNode)
        && !isHtmlElement(node, formattableBlockNames)) {
            node = node.parentNode;
        }

        // "If node is an editable HTML element whose local name is a
        // formattable block name, and node is not the ancestor of a prohibited
        // paragraph child, return node's local name, converted to ASCII
        // lowercase."
        if (isEditable(node)
        && isHtmlElement(node, formattableBlockNames)
        && !getDescendants(node).some(isProhibitedParagraphChild)) {
            return node.tagName.toLowerCase();
        }

        // "Return the empty string."
        return "";
    }
};

//@}
///// The forwardDelete command /////
//@{
commands.forwarddelete = {
    preservesOverrides: true,
    action: function() {
        // "If the active range is not collapsed, delete the selection and
        // return true."
        if (!getActiveRange().collapsed) {
            deleteSelection();
            return true;
        }

        // "Canonicalize whitespace at the active range's start."
        canonicalizeWhitespace(getActiveRange().startContainer, getActiveRange().startOffset);

        // "Let node and offset be the active range's start node and offset."
        var node = getActiveRange().startContainer;
        var offset = getActiveRange().startOffset;

        // "Repeat the following steps:"
        while (true) {
            // "If offset is the length of node and node's nextSibling is an
            // editable invisible node, remove node's nextSibling from its
            // parent."
            if (offset == getNodeLength(node)
            && isEditable(node.nextSibling)
            && isInvisible(node.nextSibling)) {
                node.parentNode.removeChild(node.nextSibling);

            // "Otherwise, if node has a child with index offset and that child
            // is an editable invisible node, remove that child from node."
            } else if (offset < node.childNodes.length
            && isEditable(node.childNodes[offset])
            && isInvisible(node.childNodes[offset])) {
                node.removeChild(node.childNodes[offset]);

            // "Otherwise, if offset is the length of node and node is an
            // inline node, or if node is invisible, set offset to one plus the
            // index of node, then set node to its parent."
            } else if ((offset == getNodeLength(node)
            && isInlineNode(node))
            || isInvisible(node)) {
                offset = 1 + getNodeIndex(node);
                node = node.parentNode;

            // A non-editable element inside the editing host (an island) is
            // removed whole. The spec does not define this case.
            } else if (offset < node.childNodes.length
            && isEditable(node)
            && node.childNodes[offset].nodeType == DOM.ELEMENT_NODE
            && !isEditable(node.childNodes[offset])) {
                node.removeChild(node.childNodes[offset]);
                getSelection().collapse(node, offset);
                getActiveRange().setStart(node, offset);
                getActiveRange().setEnd(node, offset);
                return true;

            // "Otherwise, if node has a child with index offset and that child
            // is neither a block node nor a br nor an img nor a collapsed
            // block prop, set node to that child, then set offset to zero."
            } else if (offset < node.childNodes.length
            && !isBlockNode(node.childNodes[offset])
            && !isHtmlElement(node.childNodes[offset], ["br", "img"])
            && !isCollapsedBlockProp(node.childNodes[offset])) {
                node = node.childNodes[offset];
                offset = 0;

            // "Otherwise, break from this loop."
            } else {
                break;
            }
        }

        // "If node is a Text node and offset is not node's length:"
        if (node.nodeType == DOM.TEXT_NODE
        && offset != getNodeLength(node)) {
            // "Let end offset be offset plus one."
            var endOffset = offset + 1;

            // "While end offset is not node's length and the end offsetth
            // element of node's data has general category M when interpreted
            // as a Unicode code point, add one to end offset."
            //
            // TODO: Not even going to try handling anything beyond the most
            // basic combining marks, since I couldn't find a good list.  I
            // special-case a few Hebrew diacritics too to test basic coverage
            // of non-Latin stuff.
            while (endOffset != node.length
            && /^[\u0300-\u036f\u0591-\u05bd\u05c1\u05c2]$/.test(node.data[endOffset])) {
                endOffset++;
            }

            // "Call collapse(node, offset) on the context object's Selection."
            getSelection().collapse(node, offset);
            getActiveRange().setStart(node, offset);

            // "Call extend(node, end offset) on the context object's
            // Selection."
            getSelection().extend(node, endOffset);
            getActiveRange().setEnd(node, endOffset);

            // "Delete the selection."
            deleteSelection();

            // "Return true."
            return true;
        }

        // "If node is an inline node, return true."
        if (isInlineNode(node)) {
            return true;
        }

        // "If node has a child with index offset and that child is a br or hr
        // or img, but is not a collapsed block prop:"
        if (offset < node.childNodes.length
        && isHtmlElement(node.childNodes[offset], ["br", "hr", "img"])
        && !isCollapsedBlockProp(node.childNodes[offset])) {
            // "Call collapse(node, offset) on the context object's Selection."
            getSelection().collapse(node, offset);
            getActiveRange().setStart(node, offset);

            // "Call extend(node, offset + 1) on the context object's
            // Selection."
            getSelection().extend(node, offset + 1);
            getActiveRange().setEnd(node, offset + 1);

            // "Delete the selection."
            deleteSelection();

            // "Return true."
            return true;
        }

        // "Let end node equal node and let end offset equal offset."
        var endNode = node;
        var endOffset = offset;

        // "If end node has a child with index end offset, and that child is a
        // collapsed block prop, add one to end offset."
        if (endOffset < endNode.childNodes.length
        && isCollapsedBlockProp(endNode.childNodes[endOffset])) {
            endOffset++;
        }

        // "Repeat the following steps:"
        while (true) {
            // "If end offset is the length of end node, set end offset to one
            // plus the index of end node and then set end node to its parent."
            if (endOffset == getNodeLength(endNode)) {
                endOffset = 1 + getNodeIndex(endNode);
                endNode = endNode.parentNode;

            // "Otherwise, if end node has a an editable invisible child with
            // index end offset, remove it from end node."
            } else if (endOffset < endNode.childNodes.length
            && isEditable(endNode.childNodes[endOffset])
            && isInvisible(endNode.childNodes[endOffset])) {
                endNode.removeChild(endNode.childNodes[endOffset]);

            // "Otherwise, break from this loop."
            } else {
                break;
            }
        }

        // "If the child of end node with index end offset minus one is a
        // table, return true."
        if (isHtmlElement(endNode.childNodes[endOffset - 1], "table")) {
            return true;
        }

        // "If the child of end node with index end offset is a table:"
        if (isHtmlElement(endNode.childNodes[endOffset], "table")) {
            // "Call collapse(end node, end offset) on the context object's
            // Selection."
            getSelection().collapse(endNode, endOffset);
            getActiveRange().setStart(endNode, endOffset);

            // "Call extend(end node, end offset + 1) on the context object's
            // Selection."
            getSelection().extend(endNode, endOffset + 1);
            getActiveRange().setEnd(endNode, endOffset + 1);

            // "Return true."
            return true;
        }

        // "If offset is the length of node, and the child of end node with
        // index end offset is an hr or br:"
        if (offset == getNodeLength(node)
        && isHtmlElement(endNode.childNodes[endOffset], ["br", "hr"])) {
            // "Call collapse(end node, end offset) on the context object's
            // Selection."
            getSelection().collapse(endNode, endOffset);
            getActiveRange().setStart(endNode, endOffset);

            // "Call extend(end node, end offset + 1) on the context object's
            // Selection."
            getSelection().extend(endNode, endOffset + 1);
            getActiveRange().setEnd(endNode, endOffset + 1);

            // "Delete the selection."
            deleteSelection();

            // "Call collapse(node, offset) on the Selection."
            getSelection().collapse(node, offset);
            getActiveRange().setStart(node, offset);
            getActiveRange().collapse(true);

            // "Return true."
            return true;
        }

        // "While end node has a child with index end offset:"
        while (endOffset < endNode.childNodes.length) {
            // "If end node's child with index end offset is editable and
            // invisible, remove it from end node."
            if (isEditable(endNode.childNodes[endOffset])
            && isInvisible(endNode.childNodes[endOffset])) {
                endNode.removeChild(endNode.childNodes[endOffset]);

            // "Otherwise, set end node to its child with index end offset and
            // set end offset to zero."
            } else {
                endNode = endNode.childNodes[endOffset];
                endOffset = 0;
            }
        }

        // "Call collapse(node, offset) on the context object's Selection."
        getSelection().collapse(node, offset);
        getActiveRange().setStart(node, offset);

        // "Call extend(end node, end offset) on the context object's
        // Selection."
        getSelection().extend(endNode, endOffset);
        getActiveRange().setEnd(endNode, endOffset);

        // "Delete the selection."
        deleteSelection();

        // "Return true."
        return true;
    }
};

//@}
///// The indent command /////
//@{
commands.indent = {
    preservesOverrides: true,
    action: function() {
        // "Let items be a list of all lis that are ancestor containers of the
        // active range's start and/or end node."
        //
        // Has to be in tree order, remember!
        var items = [];
        for (var node = getActiveRange().endContainer; node != getActiveRange().commonAncestorContainer; node = node.parentNode) {
            if (isHtmlElement(node, "LI")) {
                items.unshift(node);
            }
        }
        for (var node = getActiveRange().startContainer; node != getActiveRange().commonAncestorContainer; node = node.parentNode) {
            if (isHtmlElement(node, "LI")) {
                items.unshift(node);
            }
        }
        for (var node = getActiveRange().commonAncestorContainer; node; node = node.parentNode) {
            if (isHtmlElement(node, "LI")) {
                items.unshift(node);
            }
        }

        // "For each item in items, normalize sublists of item."
        for (var i = 0; i < items.length; i++) {
            normalizeSublists(items[i]);
        }

        // "Block-extend the active range, and let new range be the result."
        var newRange = blockExtend(getActiveRange());

        // "Let node list be a list of nodes, initially empty."
        var nodeList = [];

        // "For each node node contained in new range, if node is editable and
        // is an allowed child of "div" or "ol" and if the last member of node
        // list (if any) is not an ancestor of node, append node to node list."
        nodeList = getContainedNodes(newRange, function(node) {
            return isEditable(node)
                && (isAllowedChild(node, "div")
                || isAllowedChild(node, "ol"));
        });

        // "If the first visible member of node list is an li whose parent is
        // an ol or ul:"
        if (isHtmlElement(nodeList.filter(isVisible)[0], "li")
        && isHtmlElement(nodeList.filter(isVisible)[0].parentNode, ["ol", "ul"])) {
            // "Let sibling be node list's first visible member's
            // previousSibling."
            var sibling = nodeList.filter(isVisible)[0].previousSibling;

            // "While sibling is invisible, set sibling to its
            // previousSibling."
            while (isInvisible(sibling)) {
                sibling = sibling.previousSibling;
            }

            // "If sibling is an li, normalize sublists of sibling."
            if (isHtmlElement(sibling, "li")) {
                normalizeSublists(sibling);
            }
        }

        // "While node list is not empty:"
        while (nodeList.length) {
            // "Let sublist be a list of nodes, initially empty."
            var sublist = [];

            // "Remove the first member of node list and append it to sublist."
            sublist.push(nodeList.shift());

            // "While the first member of node list is the nextSibling of the
            // last member of sublist, remove the first member of node list and
            // append it to sublist."
            while (nodeList.length
            && nodeList[0] == sublist[sublist.length - 1].nextSibling) {
                sublist.push(nodeList.shift());
            }

            // "Indent sublist."
            indentNodes(sublist);
        }

        // "Return true."
        return true;
    }
};

//@}
///// The insertHorizontalRule command /////
//@{
commands.inserthorizontalrule = {
    preservesOverrides: true,
    action: function() {
        // "Let start node, start offset, end node, and end offset be the
        // active range's start and end nodes and offsets."
        var startNode = getActiveRange().startContainer;
        var startOffset = getActiveRange().startOffset;
        var endNode = getActiveRange().endContainer;
        var endOffset = getActiveRange().endOffset;

        // "While start offset is 0 and start node's parent is not null, set
        // start offset to start node's index, then set start node to its
        // parent."
        while (startOffset == 0
        && startNode.parentNode) {
            startOffset = getNodeIndex(startNode);
            startNode = startNode.parentNode;
        }

        // "While end offset is end node's length, and end node's parent is not
        // null, set end offset to one plus end node's index, then set end node
        // to its parent."
        while (endOffset == getNodeLength(endNode)
        && endNode.parentNode) {
            endOffset = 1 + getNodeIndex(endNode);
            endNode = endNode.parentNode;
        }

        // "Call collapse(start node, start offset) on the context object's
        // Selection."
        getSelection().collapse(startNode, startOffset);
        getActiveRange().setStart(startNode, startOffset);

        // "Call extend(end node, end offset) on the context object's
        // Selection."
        getSelection().extend(endNode, endOffset);
        getActiveRange().setEnd(endNode, endOffset);

        // "Delete the selection, with block merging false."
        deleteSelection({blockMerging: false});

        // "If the active range's start node is neither editable nor an editing
        // host, return true."
        if (!isEditable(getActiveRange().startContainer)
        && !isEditingHost(getActiveRange().startContainer)) {
            return true;
        }

        // "If the active range's start node is a Text node and its start
        // offset is zero, call collapse() on the context object's Selection,
        // with first argument the active range's start node's parent and
        // second argument the active range's start node's index."
        if (getActiveRange().startContainer.nodeType == DOM.TEXT_NODE
        && getActiveRange().startOffset == 0) {
            var newNode = getActiveRange().startContainer.parentNode;
            var newOffset = getNodeIndex(getActiveRange().startContainer);
            getSelection().collapse(newNode, newOffset);
            getActiveRange().setStart(newNode, newOffset);
            getActiveRange().collapse(true);
        }

        // "If the active range's start node is a Text node and its start
        // offset is the length of its start node, call collapse() on the
        // context object's Selection, with first argument the active range's
        // start node's parent, and the second argument one plus the active
        // range's start node's index."
        if (getActiveRange().startContainer.nodeType == DOM.TEXT_NODE
        && getActiveRange().startOffset == getNodeLength(getActiveRange().startContainer)) {
            var newNode = getActiveRange().startContainer.parentNode;
            var newOffset = 1 + getNodeIndex(getActiveRange().startContainer);
            getSelection().collapse(newNode, newOffset);
            getActiveRange().setStart(newNode, newOffset);
            getActiveRange().collapse(true);
        }

        // "Let hr be the result of calling createElement("hr") on the
        // context object."
        var hr = createElement("hr");

        // "Run insertNode(hr) on the active range."
        getActiveRange().insertNode(hr);

        // "Fix disallowed ancestors of hr."
        fixDisallowedAncestors(hr);

        // "Run collapse() on the context object's Selection, with first
        // argument hr's parent and the second argument equal to one plus hr's
        // index."
        getSelection().collapse(hr.parentNode, 1 + getNodeIndex(hr));
        getActiveRange().setStart(hr.parentNode, 1 + getNodeIndex(hr));
        getActiveRange().collapse(true);

        // "Return true."
        return true;
    }
};

//@}
///// The insertHTML command /////
//@{
commands.inserthtml = {
    preservesOverrides: true,
    action: function(value) {
        // "Delete the selection."
        deleteSelection();

        // "If the active range's start node is neither editable nor an editing
        // host, return true."
        if (!isEditable(getActiveRange().startContainer)
        && !isEditingHost(getActiveRange().startContainer)) {
            return true;
        }

        // "Let frag be the result of calling createContextualFragment(value)
        // on the active range."
        var frag = getActiveRange().createContextualFragment(value);

        // "Let last child be the lastChild of frag."
        var lastChild = frag.lastChild;

        // "If last child is null, return true."
        if (!lastChild) {
            return true;
        }

        // "Let descendants be all descendants of frag."
        var descendants = getDescendants(frag);

        // "If the active range's start node is a block node:"
        if (isBlockNode(getActiveRange().startContainer)) {
            // "Let collapsed block props be all editable collapsed block prop
            // children of the active range's start node that have index
            // greater than or equal to the active range's start offset."
            //
            // "For each node in collapsed block props, remove node from its
            // parent."
            [].filter.call(getActiveRange().startContainer.childNodes, function(node) {
                return isEditable(node)
                    && isCollapsedBlockProp(node)
                    && getNodeIndex(node) >= getActiveRange().startOffset;
            }).forEach(function(node) {
                node.parentNode.removeChild(node);
            });
        }

        // "Call insertNode(frag) on the active range."
        getActiveRange().insertNode(frag);

        // "If the active range's start node is a block node with no visible
        // children, call createElement("br") on the context object and append
        // the result as the last child of the active range's start node."
        if (isBlockNode(getActiveRange().startContainer)
        && ![].some.call(getActiveRange().startContainer.childNodes, isVisible)) {
            getActiveRange().startContainer.appendChild(createElement("br"));
        }

        // "Call collapse() on the context object's Selection, with last
        // child's parent as the first argument and one plus its index as the
        // second."
        getActiveRange().setStart(lastChild.parentNode, 1 + getNodeIndex(lastChild));
        getActiveRange().setEnd(lastChild.parentNode, 1 + getNodeIndex(lastChild));

        // "Fix disallowed ancestors of each member of descendants."
        for (var i = 0; i < descendants.length; i++) {
            fixDisallowedAncestors(descendants[i]);
        }

        // "Return true."
        return true;
    }
};

//@}
///// The insertImage command /////
//@{
commands.insertimage = {
    preservesOverrides: true,
    action: function(value) {
        // "If value is the empty string, return false."
        if (value === "") {
            return false;
        }

        // "Delete the selection, with strip wrappers false."
        deleteSelection({stripWrappers: false});

        // "Let range be the active range."
        var range = getActiveRange();

        // "If the active range's start node is neither editable nor an editing
        // host, return true."
        if (!isEditable(getActiveRange().startContainer)
        && !isEditingHost(getActiveRange().startContainer)) {
            return true;
        }

        // "If range's start node is a block node whose sole child is a br, and
        // its start offset is 0, remove its start node's child from it."
        if (isBlockNode(range.startContainer)
        && range.startContainer.childNodes.length == 1
        && isHtmlElement(range.startContainer.firstChild, "br")
        && range.startOffset == 0) {
            range.startContainer.removeChild(range.startContainer.firstChild);
        }

        // "Let img be the result of calling createElement("img") on the
        // context object."
        var img = createElement("img");

        // "Run setAttribute("src", value) on img."
        img.setAttribute("src", value);

        // "Run insertNode(img) on the range."
        range.insertNode(img);

        // "Run collapse() on the Selection, with first argument equal to the
        // parent of img and the second argument equal to one plus the index of
        // img."
        //
        // Not everyone actually supports collapse(), so we do it manually
        // instead.  Also, we need to modify the actual range we're given as
        // well, for the sake of autoimplementation.html's range-filling-in.
        range.setStart(img.parentNode, 1 + getNodeIndex(img));
        range.setEnd(img.parentNode, 1 + getNodeIndex(img));
        getSelection().removeAllRanges();
        getSelection().addRange(range);

        // IE adds width and height attributes for some reason, so remove those
        // to actually do what the spec says.
        img.removeAttribute("width");
        img.removeAttribute("height");

        // "Return true."
        return true;
    }
};

//@}
///// The insertLineBreak command /////
//@{
commands.insertlinebreak = {
    preservesOverrides: true,
    action: function(value) {
        // "Delete the selection, with strip wrappers false."
        deleteSelection({stripWrappers: false});

        // "If the active range's start node is neither editable nor an editing
        // host, return true."
        if (!isEditable(getActiveRange().startContainer)
        && !isEditingHost(getActiveRange().startContainer)) {
            return true;
        }

        // "If the active range's start node is an Element, and "br" is not an
        // allowed child of it, return true."
        if (getActiveRange().startContainer.nodeType == DOM.ELEMENT_NODE
        && !isAllowedChild("br", getActiveRange().startContainer)) {
            return true;
        }

        // "If the active range's start node is not an Element, and "br" is not
        // an allowed child of the active range's start node's parent, return
        // true."
        if (getActiveRange().startContainer.nodeType != DOM.ELEMENT_NODE
        && !isAllowedChild("br", getActiveRange().startContainer.parentNode)) {
            return true;
        }

        // "If the active range's start node is a Text node and its start
        // offset is zero, call collapse() on the context object's Selection,
        // with first argument equal to the active range's start node's parent
        // and second argument equal to the active range's start node's index."
        if (getActiveRange().startContainer.nodeType == DOM.TEXT_NODE
        && getActiveRange().startOffset == 0) {
            var newNode = getActiveRange().startContainer.parentNode;
            var newOffset = getNodeIndex(getActiveRange().startContainer);
            getSelection().collapse(newNode, newOffset);
            getActiveRange().setStart(newNode, newOffset);
            getActiveRange().setEnd(newNode, newOffset);
        }

        // "If the active range's start node is a Text node and its start
        // offset is the length of its start node, call collapse() on the
        // context object's Selection, with first argument equal to the active
        // range's start node's parent and second argument equal to one plus
        // the active range's start node's index."
        if (getActiveRange().startContainer.nodeType == DOM.TEXT_NODE
        && getActiveRange().startOffset == getNodeLength(getActiveRange().startContainer)) {
            var newNode = getActiveRange().startContainer.parentNode;
            var newOffset = 1 + getNodeIndex(getActiveRange().startContainer);
            getSelection().collapse(newNode, newOffset);
            getActiveRange().setStart(newNode, newOffset);
            getActiveRange().setEnd(newNode, newOffset);
        }

        // "Let br be the result of calling createElement("br") on the context
        // object."
        var br = createElement("br");

        // "Call insertNode(br) on the active range."
        getActiveRange().insertNode(br);

        // "Call collapse() on the context object's Selection, with br's parent
        // as the first argument and one plus br's index as the second
        // argument."
        getSelection().collapse(br.parentNode, 1 + getNodeIndex(br));
        getActiveRange().setStart(br.parentNode, 1 + getNodeIndex(br));
        getActiveRange().setEnd(br.parentNode, 1 + getNodeIndex(br));

        // "If br is a collapsed line break, call createElement("br") on the
        // context object and let extra br be the result, then call
        // insertNode(extra br) on the active range."
        if (isCollapsedLineBreak(br)) {
            getActiveRange().insertNode(createElement("br"));

            // Compensate for nonstandard implementations of insertNode
            getSelection().collapse(br.parentNode, 1 + getNodeIndex(br));
            getActiveRange().setStart(br.parentNode, 1 + getNodeIndex(br));
            getActiveRange().setEnd(br.parentNode, 1 + getNodeIndex(br));
        }

        // "Return true."
        return true;
    }
};

//@}
///// The insertOrderedList command /////
//@{
commands.insertorderedlist = {
    preservesOverrides: true,
    // "Toggle lists with tag name "ol", then return true."
    action: function() { toggleLists("ol"); return true },
    // "True if the selection's list state is "mixed" or "mixed ol", false
    // otherwise."
    indeterm: function() { return /^mixed( ol)?$/.test(getSelectionListState()) },
    // "True if the selection's list state is "ol", false otherwise."
    state: function() { return getSelectionListState() == "ol" },
};

//@}
///// The insertParagraph command /////
//@{
commands.insertparagraph = {
    preservesOverrides: true,
    action: function() {
        // "Delete the selection."
        deleteSelection();

        // "If the active range's start node is neither editable nor an editing
        // host, return true."
        if (!isEditable(getActiveRange().startContainer)
        && !isEditingHost(getActiveRange().startContainer)) {
            return true;
        }

        // "Let node and offset be the active range's start node and offset."
        var node = getActiveRange().startContainer;
        var offset = getActiveRange().startOffset;

        // "If node is a Text node, and offset is neither 0 nor the length of
        // node, call splitText(offset) on node."
        if (node.nodeType == DOM.TEXT_NODE
        && offset != 0
        && offset != getNodeLength(node)) {
            node.splitText(offset);
        }

        // "If node is a Text node and offset is its length, set offset to one
        // plus the index of node, then set node to its parent."
        if (node.nodeType == DOM.TEXT_NODE
        && offset == getNodeLength(node)) {
            offset = 1 + getNodeIndex(node);
            node = node.parentNode;
        }

        // "If node is a Text or Comment node, set offset to the index of node,
        // then set node to its parent."
        if (node.nodeType == DOM.TEXT_NODE
        || node.nodeType == DOM.COMMENT_NODE) {
            offset = getNodeIndex(node);
            node = node.parentNode;
        }

        // "Call collapse(node, offset) on the context object's Selection."
        getSelection().collapse(node, offset);
        getActiveRange().setStart(node, offset);
        getActiveRange().setEnd(node, offset);

        // "Let container equal node."
        var container = node;

        // "While container is not a single-line container, and container's
        // parent is editable and in the same editing host as node, set
        // container to its parent."
        while (!isSingleLineContainer(container)
        && isEditable(container.parentNode)
        && inSameEditingHost(node, container.parentNode)) {
            container = container.parentNode;
        }

        // "If container is an editable single-line container in the same
        // editing host as node, and its local name is "p" or "div":"
        if (isEditable(container)
        && isSingleLineContainer(container)
        && inSameEditingHost(node, container.parentNode)
        && (container.tagName == "P" || container.tagName == "DIV")) {
            // "Let outer container equal container."
            var outerContainer = container;

            // "While outer container is not a dd or dt or li, and outer
            // container's parent is editable, set outer container to its
            // parent."
            while (!isHtmlElement(outerContainer, ["dd", "dt", "li"])
            && isEditable(outerContainer.parentNode)) {
                outerContainer = outerContainer.parentNode;
            }

            // "If outer container is a dd or dt or li, set container to outer
            // container."
            if (isHtmlElement(outerContainer, ["dd", "dt", "li"])) {
                container = outerContainer;
            }
        }

        // "If container is not editable or not in the same editing host as
        // node or is not a single-line container:"
        if (!isEditable(container)
        || !inSameEditingHost(container, node)
        || !isSingleLineContainer(container)) {
            // "Let tag be the default single-line container name."
            var tag = defaultSingleLineContainerName;

            // "Block-extend the active range, and let new range be the
            // result."
            var newRange = blockExtend(getActiveRange());

            // "Let node list be a list of nodes, initially empty."
            //
            // "Append to node list the first node in tree order that is
            // contained in new range and is an allowed child of "p", if any."
            var nodeList = getContainedNodes(newRange, function(node) { return isAllowedChild(node, "p") })
                .slice(0, 1);

            // "If node list is empty:"
            if (!nodeList.length) {
                // "If tag is not an allowed child of the active range's start
                // node, return true."
                if (!isAllowedChild(tag, getActiveRange().startContainer)) {
                    return true;
                }

                // "Set container to the result of calling createElement(tag)
                // on the context object."
                container = createElement(tag);

                // "Call insertNode(container) on the active range."
                getActiveRange().insertNode(container);

                // "Call createElement("br") on the context object, and append
                // the result as the last child of container."
                container.appendChild(createElement("br"));

                // "Call collapse(container, 0) on the context object's
                // Selection."
                getSelection().collapse(container, 0);
                getActiveRange().setStart(container, 0);
                getActiveRange().setEnd(container, 0);

                // "Return true."
                return true;
            }

            // "While the nextSibling of the last member of node list is not
            // null and is an allowed child of "p", append it to node list."
            while (nodeList[nodeList.length - 1].nextSibling
            && isAllowedChild(nodeList[nodeList.length - 1].nextSibling, "p")) {
                nodeList.push(nodeList[nodeList.length - 1].nextSibling);
            }

            // "Wrap node list, with sibling criteria returning false and new
            // parent instructions returning the result of calling
            // createElement(tag) on the context object. Set container to the
            // result."
            container = wrap(nodeList,
                function() { return false },
                function() { return createElement(tag) }
            );
        }

        // "If container's local name is "address", "listing", or "pre":"
        if (container.tagName == "ADDRESS"
        || container.tagName == "LISTING"
        || container.tagName == "PRE") {
            // "Let br be the result of calling createElement("br") on the
            // context object."
            var br = createElement("br");

            // "Call insertNode(br) on the active range."
            getActiveRange().insertNode(br);

            // "Call collapse(node, offset + 1) on the context object's
            // Selection."
            getSelection().collapse(node, offset + 1);
            getActiveRange().setStart(node, offset + 1);
            getActiveRange().setEnd(node, offset + 1);

            // "If br is the last descendant of container, let br be the result
            // of calling createElement("br") on the context object, then call
            // insertNode(br) on the active range."
            //
            // Work around browser bugs: some browsers select the
            // newly-inserted node, not per spec.
            if (!isDescendant(nextNode(br), container)) {
                getActiveRange().insertNode(createElement("br"));
                getSelection().collapse(node, offset + 1);
                getActiveRange().setEnd(node, offset + 1);
            }

            // "Return true."
            return true;
        }

        // "If container's local name is "li", "dt", or "dd"; and either it has
        // no children or it has a single child and that child is a br:"
        if (["LI", "DT", "DD"].indexOf(container.tagName) != -1
        && (!container.hasChildNodes()
        || (container.childNodes.length == 1
        && isHtmlElement(container.firstChild, "br")))) {
            // "Split the parent of the one-node list consisting of container."
            splitParent([container]);

            // "If container has no children, call createElement("br") on the
            // context object and append the result as the last child of
            // container."
            if (!container.hasChildNodes()) {
                container.appendChild(createElement("br"));
            }

            // "If container is a dd or dt, and it is not an allowed child of
            // any of its ancestors in the same editing host, set the tag name
            // of container to the default single-line container name and let
            // container be the result."
            if (isHtmlElement(container, ["dd", "dt"])
            && getAncestors(container).every(function(ancestor) {
                return !inSameEditingHost(container, ancestor)
                    || !isAllowedChild(container, ancestor)
            })) {
                container = setTagName(container, defaultSingleLineContainerName);
            }

            // "Fix disallowed ancestors of container."
            fixDisallowedAncestors(container);

            // "Return true."
            return true;
        }

        // "Let new line range be a new range whose start is the same as
        // the active range's, and whose end is (container, length of
        // container)."
        var splitNode = getActiveRange().startContainer;
        var splitOffset = getActiveRange().startOffset;
        var splitPoints = splitNode.nodeType == DOM.TEXT_NODE
            ? [[splitNode, splitOffset - 1], [splitNode, splitOffset]]
            : [[splitNode.childNodes[splitOffset - 1], -1], [splitNode.childNodes[splitOffset], 0]];
        var charAt = function(node, at) {
            if (at < 0 && node) {
                node = node.previousSibling;
                at += node && node.nodeType == DOM.TEXT_NODE ? node.length : 0;
            } else if (node && at >= node.length) {
                at -= node.length;
                node = node.nextSibling;
            }
            return node && node.nodeType == DOM.TEXT_NODE ? node.data[at] : undefined;
        };
        var shows = function(c) { return c !== undefined && !/[ \t\n\r\f]/.test(c); };
        splitPoints.forEach(function(point) {
            var node = point[0];
            if (!node || node.nodeType != DOM.TEXT_NODE || !isEditable(node)
            || ["pre", "pre-wrap"].indexOf(getComputedStyle(node.parentNode).whiteSpace) != -1) {
                return;
            }
            var at = point[1] < 0 ? node.length + point[1] : point[1];
            if (charAt(node, at) == " " && shows(charAt(node, at - 1)) && shows(charAt(node, at + 1))) {
                node.replaceData(at, 1, "\xa0");
            }
        });

        var newLineRange = createRange();
        newLineRange.setStart(getActiveRange().startContainer, getActiveRange().startOffset);
        newLineRange.setEnd(container, getNodeLength(container));

        // "While new line range's start offset is zero and its start node is
        // not a prohibited paragraph child, set its start to (parent of start
        // node, index of start node)."
        while (newLineRange.startOffset == 0
        && !isProhibitedParagraphChild(newLineRange.startContainer)) {
            newLineRange.setStart(newLineRange.startContainer.parentNode, getNodeIndex(newLineRange.startContainer));
        }

        // "While new line range's start offset is the length of its start node
        // and its start node is not a prohibited paragraph child, set its
        // start to (parent of start node, 1 + index of start node)."
        while (newLineRange.startOffset == getNodeLength(newLineRange.startContainer)
        && !isProhibitedParagraphChild(newLineRange.startContainer)) {
            newLineRange.setStart(newLineRange.startContainer.parentNode, 1 + getNodeIndex(newLineRange.startContainer));
        }

        // "Let end of line be true if new line range contains either nothing
        // or a single br, and false otherwise."
        var containedInNewLineRange = getContainedNodes(newLineRange);
        var endOfLine = !containedInNewLineRange.length
            || (containedInNewLineRange.length == 1
            && isHtmlElement(containedInNewLineRange[0], "br"));

        // "If the local name of container is "h1", "h2", "h3", "h4", "h5", or
        // "h6", and end of line is true, let new container name be the default
        // single-line container name."
        var newContainerName;
        if (/^H[1-6]$/.test(container.tagName)
        && endOfLine) {
            newContainerName = defaultSingleLineContainerName;

        // "Otherwise, if the local name of container is "dt" and end of line
        // is true, let new container name be "dd"."
        } else if (container.tagName == "DT"
        && endOfLine) {
            newContainerName = "dd";

        // "Otherwise, if the local name of container is "dd" and end of line
        // is true, let new container name be "dt"."
        } else if (container.tagName == "DD"
        && endOfLine) {
            newContainerName = "dt";

        // "Otherwise, let new container name be the local name of container."
        } else {
            newContainerName = container.tagName.toLowerCase();
        }

        // "Let new container be the result of calling createElement(new
        // container name) on the context object."
        var newContainer = createElement(newContainerName);

        // "Copy all attributes of container to new container."
        for (var i = 0; i < attributesOf(container).length; i++) {
            newContainer.setAttribute(attributesOf(container)[i].name, attributesOf(container)[i].value);
        }

        // "If new container has an id attribute, unset it."
        newContainer.removeAttribute("id");

        // "Insert new container into the parent of container immediately after
        // container."
        container.parentNode.insertBefore(newContainer, container.nextSibling);

        // "Let contained nodes be all nodes contained in new line range."
        var containedNodes = getAllContainedNodes(newLineRange);

        // "Let frag be the result of calling extractContents() on new line
        // range."
        var frag = newLineRange.extractContents();

        // "Unset the id attribute (if any) of each Element descendant of frag
        // that is not in contained nodes."
        var descendants = getDescendants(frag);
        for (var i = 0; i < descendants.length; i++) {
            if (descendants[i].nodeType == DOM.ELEMENT_NODE
            && containedNodes.indexOf(descendants[i]) == -1) {
                descendants[i].removeAttribute("id");
            }
        }

        // "Call appendChild(frag) on new container."
        newContainer.appendChild(frag);

        // "While container's lastChild is a prohibited paragraph child, set
        // container to its lastChild."
        while (isProhibitedParagraphChild(container.lastChild)) {
            container = container.lastChild;
        }

        // "While new container's lastChild is a prohibited paragraph child,
        // set new container to its lastChild."
        while (isProhibitedParagraphChild(newContainer.lastChild)) {
            newContainer = newContainer.lastChild;
        }

        // "If container has no visible children, call createElement("br") on
        // the context object, and append the result as the last child of
        // container."
        if (![].some.call(container.childNodes, isVisible)) {
            container.appendChild(createElement("br"));
        }

        // "If new container has no visible children, call createElement("br")
        // on the context object, and append the result as the last child of
        // new container."
        if (![].some.call(newContainer.childNodes, isVisible)) {
            newContainer.appendChild(createElement("br"));
        }

        // "Call collapse(new container, 0) on the context object's Selection."
        getSelection().collapse(newContainer, 0);
        getActiveRange().setStart(newContainer, 0);
        getActiveRange().setEnd(newContainer, 0);

        // "Return true."
        return true;
    }
};

//@}
///// The insertText command /////
//@{
commands.inserttext = {
    action: function(value) {
        // "Delete the selection, with strip wrappers false."
        deleteSelection({stripWrappers: false});

        // "If the active range's start node is neither editable nor an editing
        // host, return true."
        if (!isEditable(getActiveRange().startContainer)
        && !isEditingHost(getActiveRange().startContainer)) {
            return true;
        }

        // "If value's length is greater than one:"
        if (value.length > 1) {
            // "For each element el in value, take the action for the
            // insertText command, with value equal to el."
            for (var i = 0; i < value.length; i++) {
                commands.inserttext.action(value[i]);
            }

            // "Return true."
            return true;
        }

        // "If value is the empty string, return true."
        if (value == "") {
            return true;
        }

        // "If value is a newline (U+00A0), take the action for the
        // insertParagraph command and return true."
        if (value == "\n" && !literalLineFeeds) {
            commands.insertparagraph.action();
            return true;
        }

        // "Let node and offset be the active range's start node and offset."
        var node = getActiveRange().startContainer;
        var offset = getActiveRange().startOffset;

        // "If node has a child whose index is offset − 1, and that child is a
        // Text node, set node to that child, then set offset to node's
        // length."
        if (0 <= offset - 1
        && offset - 1 < node.childNodes.length
        && node.childNodes[offset - 1].nodeType == DOM.TEXT_NODE) {
            node = node.childNodes[offset - 1];
            offset = getNodeLength(node);
        }

        // "If node has a child whose index is offset, and that child is a Text
        // node, set node to that child, then set offset to zero."
        if (0 <= offset
        && offset < node.childNodes.length
        && node.childNodes[offset].nodeType == DOM.TEXT_NODE) {
            node = node.childNodes[offset];
            offset = 0;
        }

        // "Record current overrides, and let overrides be the result."
        var overrides = recordCurrentOverrides();

        // "Call collapse(node, offset) on the context object's Selection."
        getSelection().collapse(node, offset);
        getActiveRange().setStart(node, offset);
        getActiveRange().setEnd(node, offset);

        // "Canonicalize whitespace at (node, offset)."
        canonicalizeWhitespace(node, offset);

        // "Let (node, offset) be the active range's start."
        node = getActiveRange().startContainer;
        offset = getActiveRange().startOffset;

        // "If node is a Text node:"
        if (node.nodeType == DOM.TEXT_NODE) {
            // "Call insertData(offset, value) on node."
            node.insertData(offset, value);

            // "Call collapse(node, offset) on the context object's Selection."
            getSelection().collapse(node, offset);
            getActiveRange().setStart(node, offset);

            // "Call extend(node, offset + 1) on the context object's
            // Selection."
            //
            // Work around WebKit bug: the extend() can throw if the text we're
            // adding is trailing whitespace.
            try { getSelection().extend(node, offset + 1); } catch(e) {}
            getActiveRange().setEnd(node, offset + 1);

        // "Otherwise:"
        } else {
            // "If node has only one child, which is a collapsed line break,
            // remove its child from it."
            //
            // FIXME: IE incorrectly returns false here instead of true
            // sometimes?
            if (node.childNodes.length == 1
            && isCollapsedLineBreak(node.firstChild)) {
                node.removeChild(node.firstChild);
            }

            // "Let text be the result of calling createTextNode(value) on the
            // context object."
            var text = createText(value);

            // "Call insertNode(text) on the active range."
            getActiveRange().insertNode(text);

            // "Call collapse(text, 0) on the context object's Selection."
            getSelection().collapse(text, 0);
            getActiveRange().setStart(text, 0);

            // "Call extend(text, 1) on the context object's Selection."
            getSelection().extend(text, 1);
            getActiveRange().setEnd(text, 1);
        }

        // "Restore states and values from overrides."
        restoreStatesAndValues(overrides);

        // "Canonicalize whitespace at the active range's start, with fix
        // collapsed space false."
        canonicalizeWhitespace(getActiveRange().startContainer, getActiveRange().startOffset, false);

        // "Canonicalize whitespace at the active range's end, with fix
        // collapsed space false."
        canonicalizeWhitespace(getActiveRange().endContainer, getActiveRange().endOffset, false);

        // "If value is a space character, autolink the active range's start."
        if (/^[ \t\n\f\r]$/.test(value)) {
            autolink(getActiveRange().startContainer, getActiveRange().startOffset);
        }

        // "Call collapseToEnd() on the context object's Selection."
        //
        // Work around WebKit bug: sometimes it blows up the selection and
        // throws, which we don't want.
        try { getSelection().collapseToEnd(); } catch(e) {}
        getActiveRange().collapse(false);

        // "Return true."
        return true;
    }
};

//@}
///// The insertUnorderedList command /////
//@{
commands.insertunorderedlist = {
    preservesOverrides: true,
    // "Toggle lists with tag name "ul", then return true."
    action: function() { toggleLists("ul"); return true },
    // "True if the selection's list state is "mixed" or "mixed ul", false
    // otherwise."
    indeterm: function() { return /^mixed( ul)?$/.test(getSelectionListState()) },
    // "True if the selection's list state is "ul", false otherwise."
    state: function() { return getSelectionListState() == "ul" },
};

//@}
///// The justifyCenter command /////
//@{
commands.justifycenter = {
    preservesOverrides: true,
    // "Justify the selection with alignment "center", then return true."
    action: function() { justifySelection("center"); return true },
    indeterm: function() {
        // "Return false if the active range is null.  Otherwise, block-extend
        // the active range. Return true if among visible editable nodes that
        // are contained in the result and have no children, at least one has
        // alignment value "center" and at least one does not. Otherwise return
        // false."
        if (!getActiveRange()) {
            return false;
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        return nodes.some(function(node) { return getAlignmentValue(node) == "center" })
            && nodes.some(function(node) { return getAlignmentValue(node) != "center" });
    }, state: function() {
        // "Return false if the active range is null.  Otherwise, block-extend
        // the active range. Return true if there is at least one visible
        // editable node that is contained in the result and has no children,
        // and all such nodes have alignment value "center".  Otherwise return
        // false."
        if (!getActiveRange()) {
            return false;
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        return nodes.length
            && nodes.every(function(node) { return getAlignmentValue(node) == "center" });
    }, value: function() {
        // "Return the empty string if the active range is null.  Otherwise,
        // block-extend the active range, and return the alignment value of the
        // first visible editable node that is contained in the result and has
        // no children. If there is no such node, return "left"."
        if (!getActiveRange()) {
            return "";
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        if (nodes.length) {
            return getAlignmentValue(nodes[0]);
        } else {
            return "left";
        }
    },
};

//@}
///// The justifyFull command /////
//@{
commands.justifyfull = {
    preservesOverrides: true,
    // "Justify the selection with alignment "justify", then return true."
    action: function() { justifySelection("justify"); return true },
    indeterm: function() {
        // "Return false if the active range is null.  Otherwise, block-extend
        // the active range. Return true if among visible editable nodes that
        // are contained in the result and have no children, at least one has
        // alignment value "justify" and at least one does not. Otherwise
        // return false."
        if (!getActiveRange()) {
            return false;
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        return nodes.some(function(node) { return getAlignmentValue(node) == "justify" })
            && nodes.some(function(node) { return getAlignmentValue(node) != "justify" });
    }, state: function() {
        // "Return false if the active range is null.  Otherwise, block-extend
        // the active range. Return true if there is at least one visible
        // editable node that is contained in the result and has no children,
        // and all such nodes have alignment value "justify".  Otherwise return
        // false."
        if (!getActiveRange()) {
            return false;
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        return nodes.length
            && nodes.every(function(node) { return getAlignmentValue(node) == "justify" });
    }, value: function() {
        // "Return the empty string if the active range is null.  Otherwise,
        // block-extend the active range, and return the alignment value of the
        // first visible editable node that is contained in the result and has
        // no children. If there is no such node, return "left"."
        if (!getActiveRange()) {
            return "";
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        if (nodes.length) {
            return getAlignmentValue(nodes[0]);
        } else {
            return "left";
        }
    },
};

//@}
///// The justifyLeft command /////
//@{
commands.justifyleft = {
    preservesOverrides: true,
    // "Justify the selection with alignment "left", then return true."
    action: function() { justifySelection("left"); return true },
    indeterm: function() {
        // "Return false if the active range is null.  Otherwise, block-extend
        // the active range. Return true if among visible editable nodes that
        // are contained in the result and have no children, at least one has
        // alignment value "left" and at least one does not. Otherwise return
        // false."
        if (!getActiveRange()) {
            return false;
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        return nodes.some(function(node) { return getAlignmentValue(node) == "left" })
            && nodes.some(function(node) { return getAlignmentValue(node) != "left" });
    }, state: function() {
        // "Return false if the active range is null.  Otherwise, block-extend
        // the active range. Return true if there is at least one visible
        // editable node that is contained in the result and has no children,
        // and all such nodes have alignment value "left".  Otherwise return
        // false."
        if (!getActiveRange()) {
            return false;
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        return nodes.length
            && nodes.every(function(node) { return getAlignmentValue(node) == "left" });
    }, value: function() {
        // "Return the empty string if the active range is null.  Otherwise,
        // block-extend the active range, and return the alignment value of the
        // first visible editable node that is contained in the result and has
        // no children. If there is no such node, return "left"."
        if (!getActiveRange()) {
            return "";
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        if (nodes.length) {
            return getAlignmentValue(nodes[0]);
        } else {
            return "left";
        }
    },
};

//@}
///// The justifyRight command /////
//@{
commands.justifyright = {
    preservesOverrides: true,
    // "Justify the selection with alignment "right", then return true."
    action: function() { justifySelection("right"); return true },
    indeterm: function() {
        // "Return false if the active range is null.  Otherwise, block-extend
        // the active range. Return true if among visible editable nodes that
        // are contained in the result and have no children, at least one has
        // alignment value "right" and at least one does not. Otherwise return
        // false."
        if (!getActiveRange()) {
            return false;
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        return nodes.some(function(node) { return getAlignmentValue(node) == "right" })
            && nodes.some(function(node) { return getAlignmentValue(node) != "right" });
    }, state: function() {
        // "Return false if the active range is null.  Otherwise, block-extend
        // the active range. Return true if there is at least one visible
        // editable node that is contained in the result and has no children,
        // and all such nodes have alignment value "right".  Otherwise return
        // false."
        if (!getActiveRange()) {
            return false;
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        return nodes.length
            && nodes.every(function(node) { return getAlignmentValue(node) == "right" });
    }, value: function() {
        // "Return the empty string if the active range is null.  Otherwise,
        // block-extend the active range, and return the alignment value of the
        // first visible editable node that is contained in the result and has
        // no children. If there is no such node, return "left"."
        if (!getActiveRange()) {
            return "";
        }
        var nodes = getAllContainedNodes(blockExtend(getActiveRange()), function(node) {
            return isEditable(node) && isVisible(node) && !node.hasChildNodes();
        });
        if (nodes.length) {
            return getAlignmentValue(nodes[0]);
        } else {
            return "left";
        }
    },
};

//@}
///// The outdent command /////
//@{
commands.outdent = {
    preservesOverrides: true,
    action: function() {
        // "Let items be a list of all lis that are ancestor containers of the
        // range's start and/or end node."
        //
        // It's annoying to get this in tree order using functional stuff
        // without doing getDescendants(document), which is slow, so I do it
        // imperatively.
        var items = [];
        (function(){
            for (
                var ancestorContainer = getActiveRange().endContainer;
                ancestorContainer != getActiveRange().commonAncestorContainer;
                ancestorContainer = ancestorContainer.parentNode
            ) {
                if (isHtmlElement(ancestorContainer, "li")) {
                    items.unshift(ancestorContainer);
                }
            }
            for (
                var ancestorContainer = getActiveRange().startContainer;
                ancestorContainer;
                ancestorContainer = ancestorContainer.parentNode
            ) {
                if (isHtmlElement(ancestorContainer, "li")) {
                    items.unshift(ancestorContainer);
                }
            }
        })();

        // "For each item in items, normalize sublists of item."
        items.forEach(normalizeSublists);

        // "Block-extend the active range, and let new range be the result."
        var newRange = blockExtend(getActiveRange());

        // "Let node list be a list of nodes, initially empty."
        //
        // "For each node node contained in new range, append node to node list
        // if the last member of node list (if any) is not an ancestor of node;
        // node is editable; and either node has no editable descendants, or is
        // an ol or ul, or is an li whose parent is an ol or ul."
        var nodeList = getContainedNodes(newRange, function(node) {
            return isEditable(node)
                && (!getDescendants(node).some(isEditable)
                || isHtmlElement(node, ["ol", "ul"])
                || (isHtmlElement(node, "li") && isHtmlElement(node.parentNode, ["ol", "ul"])));
        });

        // "While node list is not empty:"
        while (nodeList.length) {
            // "While the first member of node list is an ol or ul or is not
            // the child of an ol or ul, outdent it and remove it from node
            // list."
            while (nodeList.length
            && (isHtmlElement(nodeList[0], ["OL", "UL"])
            || !isHtmlElement(nodeList[0].parentNode, ["OL", "UL"]))) {
                outdentNode(nodeList.shift());
            }

            // "If node list is empty, break from these substeps."
            if (!nodeList.length) {
                break;
            }

            // "Let sublist be a list of nodes, initially empty."
            var sublist = [];

            // "Remove the first member of node list and append it to sublist."
            sublist.push(nodeList.shift());

            // "While the first member of node list is the nextSibling of the
            // last member of sublist, and the first member of node list is not
            // an ol or ul, remove the first member of node list and append it
            // to sublist."
            while (nodeList.length
            && nodeList[0] == sublist[sublist.length - 1].nextSibling
            && !isHtmlElement(nodeList[0], ["OL", "UL"])) {
                sublist.push(nodeList.shift());
            }

            // "Record the values of sublist, and let values be the result."
            var values = recordValues(sublist);

            // "Split the parent of sublist, with new parent null."
            splitParent(sublist);

            // "Fix disallowed ancestors of each member of sublist."
            sublist.forEach(fixDisallowedAncestors);

            // "Restore the values from values."
            restoreValues(values);
        }

        // "Return true."
        return true;
    }
};

//@}

//////////////////////////////////
///// Miscellaneous commands /////
//////////////////////////////////

///// The defaultParagraphSeparator command /////
//@{
commands.defaultparagraphseparator = {
    action: function(value) {
        // "Let value be converted to ASCII lowercase. If value is then equal
        // to "p" or "div", set the context object's default single-line
        // container name to value and return true. Otherwise, return false."
        value = value.toLowerCase();
        if (value == "p" || value == "div") {
            defaultSingleLineContainerName = value;
            return true;
        }
        return false;
    }, value: function() {
        // "Return the context object's default single-line container name."
        return defaultSingleLineContainerName;
    },
};

//@}
///// The undo and redo commands /////
// The editing host's own history, kept by the edits made in it.
commands.undo = {
    action: function() {
        var host = affectedEditingHost() || editingHostOf(activeElement());
        if (host) {
            historyStep(host, false, false);
        }
        return true;
    }
};
commands.redo = {
    action: function() {
        var host = affectedEditingHost() || editingHostOf(activeElement());
        if (host) {
            historyStep(host, true, false);
        }
        return true;
    }
};

// "The copy, cut and paste commands": the user agent may do nothing and return false, as a
// script asking for the clipboard does here.
commands.copy = { action: function() { return false; } };
commands.cut = { action: function() { return false; } };
commands.paste = { action: function() { return false; } };

///// The selectAll command /////
//@{
commands.selectall = {
    // Note, this ignores the whole globalRange/getActiveRange() thing and
    // works with actual selections.  Not suitable for autoimplementation.html.
    action: function() {
        // "Let target be the body element of the context object."
        var target = documentBody();

        // "If target is null, let target be the context object's
        // documentElement."
        if (!target) {
            target = rootNode;
        }

        // "If target is null, call getSelection() on the context object, and
        // call removeAllRanges() on the result."
        if (!target) {
            getSelection().removeAllRanges();

        // "Otherwise, call getSelection() on the context object, and call
        // selectAllChildren(target) on the result."
        } else {
            getSelection().selectAllChildren(target);
        }

        // "Return true."
        return true;
    }
};

//@}
///// The styleWithCSS command /////
//@{
commands.stylewithcss = {
    action: function(value) {
        // "If value is an ASCII case-insensitive match for the string
        // "false", set the CSS styling flag to false. Otherwise, set the
        // CSS styling flag to true.  Either way, return true."
        cssStylingFlag = String(value).toLowerCase() != "false";
        return true;
    }, state: function() { return cssStylingFlag }
};

//@}
///// The useCSS command /////
//@{
commands.usecss = {
    action: function(value) {
        // "If value is an ASCII case-insensitive match for the string "false",
        // set the CSS styling flag to true. Otherwise, set the CSS styling
        // flag to false.  Either way, return true."
        cssStylingFlag = String(value).toLowerCase() == "false";
        return true;
    }
};
//@}

// Some final setup
//@{
(function() {
// Opera 11.50 doesn't implement Object.keys, so I have to make an explicit
// temporary, which means I need an extra closure to not leak the temporaries
// into the global namespace.  >:(
var commandNames = [];
for (var command in commands) {
    commandNames.push(command);
}
commandNames.forEach(function(command) {
    // "If a command does not have a relevant CSS property specified, it
    // defaults to null."
    if (!("relevantCssProperty" in commands[command])) {
        commands[command].relevantCssProperty = null;
    }

    // "If a command has inline command activated values defined but nothing
    // else defines when it is indeterminate, it is indeterminate if among
    // formattable nodes effectively contained in the active range, there is at
    // least one whose effective command value is one of the given values and
    // at least one whose effective command value is not one of the given
    // values."
    if ("inlineCommandActivatedValues" in commands[command]
    && !("indeterm" in commands[command])) {
        commands[command].indeterm = function() {
            if (!getActiveRange()) {
                return false;
            }

            var values = getAllEffectivelyContainedNodes(getActiveRange(), isFormattableNode)
                .map(function(node) { return getEffectiveCommandValue(node, command) });

            var matchingValues = values.filter(function(value) {
                return commands[command].inlineCommandActivatedValues.indexOf(value) != -1;
            });

            return matchingValues.length >= 1
                && values.length - matchingValues.length >= 1;
        };
    }

    // "If a command has inline command activated values defined, its state is
    // true if either no formattable node is effectively contained in the
    // active range, and the active range's start node's effective command
    // value is one of the given values; or if there is at least one
    // formattable node effectively contained in the active range, and all of
    // them have an effective command value equal to one of the given values."
    if ("inlineCommandActivatedValues" in commands[command]) {
        commands[command].state = function() {
            if (!getActiveRange()) {
                return false;
            }

            var nodes = getAllEffectivelyContainedNodes(getActiveRange(), isFormattableNode);

            if (nodes.length == 0) {
                return commands[command].inlineCommandActivatedValues
                    .indexOf(getEffectiveCommandValue(getActiveRange().startContainer, command)) != -1;
            } else {
                return nodes.every(function(node) {
                    return commands[command].inlineCommandActivatedValues
                        .indexOf(getEffectiveCommandValue(node, command)) != -1;
                });
            }
        };
    }

    // "If a command is a standard inline value command, it is indeterminate if
    // among formattable nodes that are effectively contained in the active
    // range, there are two that have distinct effective command values. Its
    // value is the effective command value of the first formattable node that
    // is effectively contained in the active range; or if there is no such
    // node, the effective command value of the active range's start node; or
    // if that is null, the empty string."
    if ("standardInlineValueCommand" in commands[command]) {
        commands[command].indeterm = function() {
            if (!getActiveRange()) {
                return false;
            }

            var values = getAllEffectivelyContainedNodes(getActiveRange())
                .filter(isFormattableNode)
                .map(function(node) { return getEffectiveCommandValue(node, command) });
            for (var i = 1; i < values.length; i++) {
                if (values[i] != values[i - 1]) {
                    return true;
                }
            }
            return false;
        };

        commands[command].value = function() {
            if (!getActiveRange()) {
                return "";
            }

            var refNode = getAllEffectivelyContainedNodes(getActiveRange(), isFormattableNode)[0];

            if (typeof refNode == "undefined") {
                refNode = getActiveRange().startContainer;
            }

            var ret = getEffectiveCommandValue(refNode, command);
            if (ret === null) {
                return "";
            }
            return ret;
        };
    }

    // "If a command preserves overrides, then before taking its action, the
    // user agent must record current overrides. After taking the action, if
    // the active range is collapsed, it must restore states and values from
    // the recorded list."
    if ("preservesOverrides" in commands[command]) {
        var oldAction = commands[command].action;

        commands[command].action = function(value) {
            var overrides = recordCurrentOverrides();
            var ret = oldAction(value);
            if (getActiveRange().collapsed) {
                restoreStatesAndValues(overrides);
            }
            return ret;
        };
    }
});
})();
//@}

// vim: foldmarker=@{,@} foldmethod=marker

// Copy, cut and paste as the Clipboard API and events spec has them, and beforeinput. A
// paste carries the clipboard's text, HTML and a PNG (bytes as a Latin-1 string). A copy or
// cut a listener prevented puts what it set on `clipboardData` on the clipboard; one it did
// not prevent lets the tree copy the selection.
function dispatchEditing(kind, target, first, second, third) {
  if (kind === BEFORE_INPUT && !(target instanceof Input) && editingHostOf(target) === target) return hostEdit(target, second ?? "", first ?? "");
  let event;
  if (kind === BEFORE_INPUT) {
    event = new InputEvent("beforeinput", { bubbles: true, cancelable: true, composed: true, inputType: second ?? "", data: first ?? "" });
  } else {
    const data = new DataTransfer();
    if (kind === PASTE) {
      if (first) data.setData("text/plain", first);
      if (second) data.setData("text/html", second);
      if (third) data.items.add(new FileClass([bytesOf(third)], "image.png", { type: "image/png" }));
      data._mode = "readonly";
    }
    event = new ClipboardEvent(TYPES[kind], { bubbles: true, cancelable: true, composed: true, clipboardData: data });
  }
  event.target = target;
  dispatchEvent(event);
  if (event.clipboardData) {
    if ((kind === COPY || kind === CUT) && event.defaultPrevented) writeClipboard(event.clipboardData);
    event.clipboardData._mode = "protected";
  }
  // The tree's `insertFromPaste` for an editing host follows with the text alone: its markup is here.
  if (kind === PASTE) {
    const host = event.defaultPrevented || target instanceof Input ? null : editingHostOf(target);
    lastPaste = host ? { host, data: event.clipboardData } : null;
  }
  return event.defaultPrevented;
}

const bytesOf = (text) => {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
};

// What a prevented copy or cut set, onto the system clipboard.
function writeClipboard(data) {
  const clipboard = globalThis.navigator?.clipboard;
  const entries = data._entries();
  if (!clipboard || entries.length === 0) return;
  const item = {};
  for (const [type, value] of entries) item[type] = value;
  const written = entries.length === 1 && entries[0][0] === "text/plain" || typeof globalThis.ClipboardItem !== "function"
    ? clipboard.writeText(item["text/plain"] ?? "")
    : clipboard.write([new globalThis.ClipboardItem(item)]);
  Promise.resolve(written).catch(reportError);
}

// The focused node, as far as focus and blur records tell (HTML elements that can take focus
// listen for both: see `createElement`).
let focusedNode = null;
// The node a blur record left, until the focus record that follows it.
let blurredNode = null;
let pendingFocusOut = null;

/** The focused node, or null. */
export function activeElement() {
  return focusedNode?.parentNode || focusedNode === rootNode ? focusedNode : null;
}

function focusEvent(type, target, relatedTarget) {
  const event = new Event(type, target);
  event.bubbles = true;
  event.relatedTarget = relatedTarget;
  dispatchEvent(event);
}

// `focusout` waits for the focus record that follows a blur, so its `relatedTarget` is where
// focus went, as on the web; with none, it goes out on its own.
function blurring(target) {
  if (focusedNode === target) focusedNode = null;
  blurredNode = target;
  pendingFocusOut = target;
  queueMicrotask(() => {
    if (pendingFocusOut !== target) return;
    pendingFocusOut = null;
    blurredNode = null;
    focusEvent("focusout", target, null);
  });
}

function focusing(target) {
  focusedNode = target;
  const left = pendingFocusOut;
  pendingFocusOut = null;
  if (left) focusEvent("focusout", left, target);
  else blurredNode = null;
  caretInto(target);
}

// An editing host that takes focus with the selection outside it gets a caret at its start,
// as a browser gives one, so the first edit has a place (a click places its own after).
function caretInto(target) {
  if (target instanceof Input || editingHostOf(target) !== target) return;
  const selection = getSelection();
  const range = selection.rangeCount ? selection.getRangeAt(0) : null;
  if (range && target.contains(range.startContainer) && target.contains(range.endContainer)) return;
  const [node, offset] = startIn(target);
  selection.collapse(node, offset);
}

// HTML defaults of a click: a checkbox or radio checks, a label passes the click on to its
// control, a summary opens its details, a submit button submits its form. True when one ran.
function activate(target) {
  for (let node = target; node; node = node.parentNode) {
    if (node._activate) return node._activate() !== false;
    if (node._href) return false;
  }
  return false;
}

// The default action of a click: the nearest link around the target opens.
function follow(target) {
  for (let node = target; node; node = node.parentNode) {
    if (node._href) {
      try {
        globalThis.open(node._href);
      } catch (error) {
        reportError(error);
      }
      return;
    }
  }
}

// The host calls this before it replaces the realm, on a reload: every node goes, so the
// next realm starts on an empty tree.
native.unload = function () {
  for (const observer of [...mutationObservers]) observer.disconnect();
  importedSheets.clear();
  styleElements.clear();
  appliedStyles = [];
  for (let i = 0; i < nodes.length; i++) { const node = nodes[i]; if (node && !node.parentNode && nodes[node.nodeId] !== undefined) node.destroy(); }
  rootNode = null;
};

// The host calls this after it handled an input: an exception a listener threw surfaces here.
native.takeError = function () {
  if (!pendingError) return;
  const { error } = pendingError;
  pendingError = null;
  throw error;
};

// The desktop around the window: files dragged in from other apps, notifications, the tray
// and global shortcuts. The host serves `__ui.shell` calls after the code that made them has
// run and answers through `__ui.shellAnswer`; desktop events arrive through `__ui.shellEvent`.

const shellCalls = new Map();
let nextShellCall = 0;

function shellCall(op, fields) {
  const call = ++nextShellCall;
  return new Promise((resolve) => {
    shellCalls.set(call, resolve);
    native.shell(call, op, fields.join("\x1f"));
  });
}

native.shellAnswer = function (call, value) {
  const resolve = shellCalls.get(call);
  if (!resolve) return;
  shellCalls.delete(call);
  resolve(value);
};

/** A file dragged in from the desktop, as the web's `File`, with its `path` on disk. */
export class DroppedFile {
  constructor(path) {
    this.path = path;
    this.name = path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1);
    this.type = "";
  }
}

// `File` where the runtime has one, else a `Blob` with a name.
const FileClass = globalThis.File ?? (globalThis.Blob ? class File extends globalThis.Blob {
  constructor(parts, name, options = {}) {
    super(parts, options);
    this.name = String(name);
    this.lastModified = options.lastModified ?? Date.now();
  }
} : null);

const normalFormat = (format) => {
  const lower = String(format).toLowerCase();
  return lower === "text" ? "text/plain" : lower === "url" ? "text/uri-list" : lower;
};

/** One entry of a `DataTransfer`, as the web's `DataTransferItem`. */
class DataTransferItem {
  #owner;
  #value;
  constructor(owner, kind, type, value) {
    this.#owner = owner;
    this.kind = kind;
    this.type = type;
    this.#value = value;
  }

  getAsString(callback) {
    if (this.kind !== "string" || typeof callback !== "function" || this.#owner._mode === "protected") return;
    const value = this.#value;
    queueMicrotask(() => callback(value));
  }

  getAsFile() {
    return this.kind === "file" && this.#owner._mode !== "protected" ? this.#value : null;
  }

  _value() {
    return this.#value;
  }
}

/** The entries of a `DataTransfer`, as the web's `DataTransferItemList`. */
class DataTransferItemList {
  #owner;
  #list = [];
  constructor(owner) {
    this.#owner = owner;
    return new Proxy(this, {
      get: (self, key) => {
        if (typeof key === "string" && /^\d+$/.test(key)) return self.length > Number(key) ? self.#list[Number(key)] : undefined;
        const value = Reflect.get(self, key, self);
        return typeof value === "function" ? value.bind(self) : value;
      },
    });
  }

  get length() {
    return this.#owner._mode === "protected" ? 0 : this.#list.length;
  }

  /** `add(data, type)` for a string, `add(file)` for a file. Read-only data throws. */
  add(data, type) {
    this.#owner._writable();
    if (typeof data === "string") {
      const format = normalFormat(type ?? "");
      if (this.#list.some((item) => item.kind === "string" && item.type === format)) {
        throw domError("NotSupportedError", "The data already holds an item of type " + format);
      }
      const item = new DataTransferItem(this.#owner, "string", format, data);
      this.#list.push(item);
      return item;
    }
    if (data && typeof data === "object") {
      const item = new DataTransferItem(this.#owner, "file", String(data.type ?? "").toLowerCase(), data);
      this.#list.push(item);
      return item;
    }
    throw new TypeError("DataTransferItemList.add takes a string and a type, or a File");
  }

  remove(index) {
    this.#owner._writable();
    if (index >= 0 && index < this.#list.length) this.#list.splice(index, 1);
  }

  clear() {
    this.#owner._writable();
    this.#list.length = 0;
  }

  [Symbol.iterator]() {
    return (this.#owner._mode === "protected" ? [] : this.#list)[Symbol.iterator]();
  }

  _all() {
    return this.#list;
  }
}

/**
 * What a copy, cut, paste or file drag carries, as the web's `DataTransfer`. `new
 * DataTransfer()` is empty and writable. A file drag lists the dragged `paths` in `files`;
 * its `types` is `["Files"]` while they are over the window.
 */
export class DataTransfer {
  #items;
  constructor(paths) {
    // "readwrite", "readonly" (paste, drop) or "protected" (after the event).
    this._mode = "readwrite";
    this._drag = Array.isArray(paths);
    paths ??= [];
    this.#items = new DataTransferItemList(this);
    for (const path of paths) this.#items.add(new DroppedFile(path));
    this.dropEffect = paths.length ? "copy" : "none";
    this.effectAllowed = paths.length ? "copy" : "uninitialized";
  }

  _writable() {
    if (this._mode !== "readwrite") throw domError("InvalidStateError", "The DataTransfer is read-only now");
  }

  get items() {
    return this.#items;
  }

  get types() {
    if (this._mode === "protected") return Object.freeze([]);
    const types = [];
    let files = false;
    for (const item of this.#items._all()) {
      if (item.kind === "string") types.push(item.type);
      else files = true;
    }
    if (files || this._drag) types.push("Files");
    return Object.freeze(types);
  }

  get files() {
    if (this._mode === "protected") return Object.freeze([]);
    return Object.freeze(this.#items._all().filter((item) => item.kind === "file").map((item) => item._value()));
  }

  getData(format) {
    if (this._mode === "protected") return "";
    const type = normalFormat(format);
    const item = this.#items._all().find((each) => each.kind === "string" && each.type === type);
    const value = item ? item._value() : "";
    return type === "text/uri-list" ? (value.split(/\r?\n/).find((line) => line && !line.startsWith("#")) ?? "") : value;
  }

  setData(format, data) {
    if (this._mode !== "readwrite") return;
    const type = normalFormat(format);
    const list = this.#items._all();
    const at = list.findIndex((each) => each.kind === "string" && each.type === type);
    if (at >= 0) list.splice(at, 1);
    this.#items.add(String(data), type);
  }

  clearData(format) {
    if (this._mode !== "readwrite") return;
    const list = this.#items._all();
    const type = format === undefined ? null : normalFormat(format);
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].kind === "string" && (type === null || list[i].type === type)) list.splice(i, 1);
    }
  }

  setDragImage() {}

  // The strings, and the PNG files, to put on the clipboard.
  _entries() {
    const entries = [];
    for (const item of this.#items._all()) {
      if (item.kind === "string") entries.push([item.type, item._value()]);
      else if (item.type === "image/png" && !entries.some(([type]) => type === "image/png")) entries.push(["image/png", item._value()]);
    }
    return entries;
  }
}

/** A copy, cut or paste, as the web's `ClipboardEvent`. */
export class ClipboardEvent extends Event {
  constructor(type, init = {}) {
    super(String(type), null);
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
    this.clipboardData = init.clipboardData ?? null;
  }
}

/** An edit about to happen (`beforeinput`), as the web's `InputEvent`. */
class InputEvent extends Event {
  constructor(type, init = {}) {
    super(String(type), null);
    this.bubbles = !!init.bubbles;
    this.cancelable = !!init.cancelable;
    this.composed = !!init.composed;
    this.inputType = init.inputType ?? "";
    this.data = init.data ?? null;
    this.dataTransfer = init.dataTransfer ?? null;
    this.isComposing = !!init.isComposing;
    this._targetRanges = init.targetRanges ? Array.from(init.targetRanges) : [];
  }

  /** The ranges the edit will change, as StaticRanges; empty on `input`. */
  getTargetRanges() {
    return [...this._targetRanges];
  }
}

globalThis.ClipboardEvent ??= ClipboardEvent;
globalThis.InputEvent ??= InputEvent;
globalThis.DataTransfer ??= DataTransfer;

let dragTarget = null;

function dragEvent(type, target, x, y, paths) {
  const event = new Event(type, target);
  event.clientX = event.x = x;
  event.clientY = event.y = y;
  event.dataTransfer = new DataTransfer(paths);
  dispatchEvent(event);
}

// As the web: `dragenter` on the node now under the files, `dragleave` on the one before,
// then `dragover` on the current one.
function dragTo(target, x, y) {
  if (target !== dragTarget) {
    const before = dragTarget;
    dragTarget = target;
    if (target) dragEvent("dragenter", target, x, y, []);
    if (before) dragEvent("dragleave", before, x, y, []);
  }
  if (target) dragEvent("dragover", target, x, y, []);
}

// Menu item callbacks by action id. Each menu (the tray's, the app's, a context menu) owns
// the ids it packed, and drops them when it is replaced or closes.
const menuActions = new Map();
const menuOwners = { tray: [], app: [], context: [] };
let nextMenuAction = 0;
let trayClick = null;
const shortcuts = new Map();
const shortcutIds = new Map();
let nextShortcut = 0;
const notifications = new Map();

native.shellEvent = function (kind, a, x, y, text) {
  if (kind <= 3) {
    const target = nodes[a] ?? rootNode;
    if (kind === 2) {
      const before = dragTarget;
      dragTarget = null;
      if (before) dragEvent("dragleave", before, x, y, []);
    } else if (kind === 3) {
      if (target !== dragTarget) dragTo(target, x, y);
      dragTarget = null;
      if (target) dragEvent("drop", target, x, y, text ? text.split("\n") : []);
    } else {
      dragTo(target, x, y);
    }
  } else if (kind === 4) {
    shortcuts.get(a)?.();
  } else if (kind === 5) {
    trayClick?.({ button: a });
  } else if (kind === 6) {
    const run = menuActions.get(a);
    if (menuOwners.context.includes(a)) closeContextMenu();
    run?.();
  } else if (kind === 7) {
    const notification = notifications.get(a);
    if (!notification) return;
    notifications.delete(a);
    notification._fire("click");
  } else if (kind === 8) {
    const resolve = dialogs.get(a);
    if (!resolve) return;
    dialogs.delete(a);
    resolve(text ? text.split("\n") : []);
  } else if (kind === 9) {
    closeContextMenu();
  } else if (kind === 10) {
    const fullScreen = a === 1;
    if (fullScreen === appWindow.fullScreen) return;
    appWindow.fullScreen = fullScreen;
    appWindow._fire("fullscreenchange", { fullScreen });
  } else if (kind === 11) {
    if (a === appWindow.zoomFactor) return;
    appWindow.zoomFactor = a;
    appWindow._fire("zoomchange", { zoomFactor: a });
  } else if (kind === WEB_VIEW_EVENT) {
    webViewEvent(a, x, text);
  }
};

// Notifications nobody clicked are forgotten after this many newer ones.
const NOTIFICATIONS_KEPT = 64;

/**
 * A desktop notification, as the web's: `new Notification(title, { body })`, with `onclick`
 * or a `click` listener. Permission is always granted.
 */
export class Notification {
  static permission = "granted";

  static requestPermission(callback) {
    callback?.("granted");
    return Promise.resolve("granted");
  }

  #listeners = new Map();

  constructor(title, options = {}) {
    this.title = String(title);
    this.body = String(options.body ?? "");
    this.tag = String(options.tag ?? "");
    this.data = options.data ?? null;
    this.onclick = this.onshow = this.onerror = this.onclose = null;
    shellCall(0, [this.title, this.body]).then((id) => {
      if (!id) return this._fire("error");
      notifications.set(id, this);
      if (notifications.size > NOTIFICATIONS_KEPT) notifications.delete(notifications.keys().next().value);
      this._fire("show");
    });
  }

  /** The system keeps the notification until the user dismisses it. */
  close() {}

  addEventListener(type, listener) {
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = []));
    if (!list.includes(listener)) list.push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.#listeners.get(type);
    const index = list ? list.indexOf(listener) : -1;
    if (index >= 0) list.splice(index, 1);
  }

  _fire(type) {
    const event = { type, target: this, currentTarget: this };
    const handler = this["on" + type];
    try {
      if (typeof handler === "function") handler.call(this, event);
      for (const listener of (this.#listeners.get(type) ?? []).slice()) listener.call(this, event);
    } catch (error) {
      reportError(error);
    }
  }
}

globalThis.Notification ??= Notification;
globalThis.AbstractRange ??= AbstractRange;
globalThis.StaticRange ??= StaticRange;
globalThis.Range ??= Range;
globalThis.DocumentFragment ??= DocumentFragment;

function hex(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i++) text += (bytes[i] < 16 ? "0" : "") + bytes[i].toString(16);
  return text;
}

// The roles the system implements, by `SystemItem` index; `about` and the others the
// platform has no counterpart for are left out there.
const SYSTEM_ROLES = {
  about: 0, services: 1, hide: 2, hideothers: 3, unhide: 4, quit: 5, close: 6, minimize: 7, zoom: 8,
  togglefullscreen: 9, front: 10, undo: 11, redo: 12, cut: 13, copy: 14, paste: 15, selectall: 16,
};

// Roles JavaScript does itself, with their usual labels and shortcuts.
const SCRIPT_ROLES = {
  resetzoom: { label: "Actual Size", accelerator: "Mod+0", click: () => appWindow.setZoomFactor(1) },
  zoomin: { label: "Zoom In", accelerator: "Mod+Plus", click: () => appWindow.setZoomFactor(zoomStep(1)) },
  zoomout: { label: "Zoom Out", accelerator: "Mod+-", click: () => appWindow.setZoomFactor(zoomStep(-1)) },
};

// Roles that stand for a whole menu, as Electron's.
const MENU_ROLES = {
  appmenu: () => [{ role: "about" }, { type: "separator" }, { role: "services" }, { type: "separator" }, { role: "hide" }, { role: "hideOthers" }, { role: "unhide" }, { type: "separator" }, { role: "quit" }],
  filemenu: () => [{ role: IS_MAC ? "close" : "quit" }],
  editmenu: () => [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }],
  viewmenu: () => [{ role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
  windowmenu: () => [{ role: "minimize" }, { role: "zoom" }, ...(IS_MAC ? [{ type: "separator" }, { role: "front" }] : [{ role: "close" }])],
};

const IS_MAC = /mac/i.test(globalThis.navigator?.platform ?? "") || globalThis.process?.platform === "darwin";

// A menu shortcut as the host reads it: "" for none, else the key (`c` and a character, `n`
// and a key name) and the modifier bits.
function packAccelerator(accelerator) {
  if (!accelerator) return ",0";
  const parts = String(accelerator).split("+").map((part) => part.trim());
  // "Mod+Plus" and "Mod++" both name the plus key.
  if (parts.at(-1) === "" && parts.at(-2) === "") parts.splice(-2, 2, "+");
  let bits = 0;
  let key = "";
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier !== undefined) bits |= modifier;
    else if (part) key = part;
  }
  const lower = key.toLowerCase();
  const named = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", esc: "Escape", escape: "Escape", return: "Enter", enter: "Enter", tab: "Tab", backspace: "Backspace", delete: "Delete", home: "Home", end: "End", pageup: "PageUp", pagedown: "PageDown" }[lower];
  if (named) return "n" + named + "," + bits;
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return "nF" + lower.slice(1) + "," + bits;
  if (lower === "plus") return "c+," + bits;
  if (lower === "space") return "c ," + bits;
  if ([...key].length === 1) return "c" + lower + "," + bits;
  return "," + bits;
}

// `items` as the host's menu lines, with their callbacks kept under `owner`.
function packMenu(items, lines, owner) {
  for (const item of items) {
    if (!item || item.visible === false) continue;
    const role = String(item.role ?? "").toLowerCase();
    if (item.type === "separator") lines.push("S");
    else if (MENU_ROLES[role] && !item.submenu) {
      lines.push("B" + String(item.label ?? role.replace(/menu$/, "").replace(/^./, (c) => c.toUpperCase())).replace(/\n/g, " "));
      packMenu(MENU_ROLES[role](), lines, owner);
      lines.push("E");
    } else if (item.submenu) {
      lines.push("B" + String(item.label ?? "").replace(/\n/g, " "));
      packMenu(item.submenu, lines, owner);
      lines.push("E");
    } else if (SYSTEM_ROLES[role] !== undefined && !item.click) {
      lines.push("R" + SYSTEM_ROLES[role]);
    } else {
      const known = SCRIPT_ROLES[role] ?? {};
      const action = ++nextMenuAction;
      const click = item.click ?? known.click;
      menuActions.set(action, typeof click === "function" ? () => click(item) : () => {});
      menuOwners[owner].push(action);
      const label = String(item.label ?? known.label ?? "").replace(/\n/g, " ");
      lines.push("A" + action + "," + (item.enabled === false ? 0 : 1) + "," + (item.checked ? 1 : 0) + "," + packAccelerator(item.accelerator ?? known.accelerator) + "," + label);
    }
  }
}

function dropMenu(owner) {
  for (const action of menuOwners[owner]) menuActions.delete(action);
  menuOwners[owner] = [];
}

/**
 * Shows an icon in the system tray (the macOS menu bar, the Windows notification area, a
 * StatusNotifierItem on Linux). `icon` is RGBA pixels, as an `ImageData`: `{ width, height,
 * data }`; macOS draws a `template` icon from its alpha in the menu bar's colours. `menu`
 * items are `{ label, click, enabled, checked }`, `{ type: "separator" }` or `{ label,
 * submenu }`. With no menu, `onClick({ button })` runs when the icon is clicked. Calling it
 * again replaces the tray. Resolves to whether the system shows it.
 */
export function setTray({ icon, tooltip = "", template = false, menu = [], onClick = null }) {
  if (!icon || !(icon.width > 0) || !(icon.height > 0) || icon.data?.length !== icon.width * icon.height * 4) {
    throw new TypeError("setTray needs an icon of RGBA pixels: { width, height, data }");
  }
  dropMenu("tray");
  trayClick = typeof onClick === "function" ? onClick : null;
  const lines = [];
  packMenu(menu, lines, "tray");
  const fields = [String(tooltip), icon.width, icon.height, template ? 1 : 0, hex(icon.data), lines.join("\n")];
  return shellCall(1, fields).then((shown) => shown === 1);
}

/** Takes the tray icon away. */
export function removeTray() {
  dropMenu("tray");
  trayClick = null;
  shellCall(2, []);
}

const MODIFIERS = { shift: 1, ctrl: 2, control: 2, alt: 4, option: 4, meta: 8, cmd: 8, command: 8, super: 8, mod: 16, cmdorctrl: 16, commandorcontrol: 16 };
const KEY_NAMES = {
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", esc: "Escape", return: "Enter",
  space: " ", plus: "Equal", "=": "Equal", "-": "Minus", ",": "Comma", ".": "Period", "/": "Slash",
  ";": "Semicolon", "'": "Quote", "[": "BracketLeft", "]": "BracketRight", "\\": "Backslash", "`": "Backquote",
};

// "Mod+Shift+K" as the UI Events `code` of the key and the modifier bits; `Mod` (also
// `CmdOrCtrl`) is Command on macOS and Control elsewhere.
function parseShortcut(accelerator) {
  const parts = String(accelerator).split("+").map((part) => part.trim()).filter(Boolean);
  let bits = 0;
  let code = "";
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier !== undefined) {
      bits |= modifier;
      continue;
    }
    const named = KEY_NAMES[part.toLowerCase()] ?? part;
    if (named === " ") code = "Space";
    else if (/^[a-z]$/i.test(named)) code = "Key" + named.toUpperCase();
    else if (/^[0-9]$/.test(named)) code = "Digit" + named;
    else code = named[0].toUpperCase() + named.slice(1);
  }
  if (!code) throw new TypeError("'" + accelerator + "' names no key");
  return { code, bits };
}

/**
 * Runs `callback` when the keys of `accelerator` are pressed, whichever app has focus:
 * `"Mod+Shift+K"`, where `Mod` is Command on macOS and Control elsewhere, and the key is a
 * letter, a digit, a UI Events `code` (`"F5"`, `"ArrowUp"`, `"Slash"`) or a name such as
 * `Space` or `Esc`. Registering it again replaces the callback. Resolves to whether the
 * system took it: another app may hold it, and Wayland has no global shortcuts.
 */
export function registerShortcut(accelerator, callback) {
  const { code, bits } = parseShortcut(accelerator);
  const key = code + "+" + bits;
  let id = shortcutIds.get(key);
  if (id === undefined) shortcutIds.set(key, (id = ++nextShortcut));
  shortcuts.set(id, callback);
  return shellCall(3, [id, code, bits]).then((held) => held === 1);
}

// Web views: a real browser page (WKWebView on macOS) shown over a node, which a person and
// an agent can both use. The views live on the platform thread; calls go through `__ui.shell`
// (ops 10 to 14) and their events come back through `__ui.shellEvent` kind 20, with the view,
// an event code and the fields separated by U+001F (ui-webview's wire.silk).

const WEB_VIEW_EVENT = 20;
const webViews = new Map();
let nextWebView = 0;
let nextWebRequest = 0;
const webRequests = new Map();
const dataClears = new Map();

const thousandths = (value) => String(Math.round(Number(value) * 1000));

function webRequest(resolve, reject) {
  const request = ++nextWebRequest;
  webRequests.set(request, { resolve, reject });
  return request;
}

function settleWebRequest(request, ok, value, error) {
  const waiting = webRequests.get(request);
  if (!waiting) return;
  webRequests.delete(request);
  if (ok) waiting.resolve(value);
  else waiting.reject(error instanceof Error ? error : new Error(String(error)));
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const BASE64_VALUES = new Uint8Array(128);
for (let i = 0; i < BASE64.length; i++) BASE64_VALUES[BASE64.charCodeAt(i)] = i;

function decodeBase64(text) {
  const clean = text.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let bits = 0;
  let count = 0;
  let at = 0;
  for (let i = 0; i < clean.length; i++) {
    bits = (bits << 6) | BASE64_VALUES[clean.charCodeAt(i)];
    count += 6;
    if (count >= 8) {
      count -= 8;
      out[at++] = (bits >> count) & 255;
    }
  }
  return out;
}

const CONSOLE_LEVELS = ["debug", "log", "info", "warning", "error"];

/** An event of a {@link WebView}: its `type` and the fields of what happened. */
export class WebViewEvent {
  constructor(type, fields) {
    this.type = type;
    Object.assign(this, fields);
  }
}

/**
 * A web view: a real browser page shown over a node. The page draws over the node's box
 * (a native view of the system's engine), follows it as layout moves it, and hides when the
 * node is not shown. Make one with {@link createWebView}.
 *
 * The view keeps the page's state as it reports it: `url`, `title`, `favicon`, `loading`,
 * `progress`, `canGoBack`, `canGoForward`, `focused`. Listen with `addEventListener(type,
 * listener)` for `loadstart`, `loadprogress`, `loadend` (`ok`, `error`, `errorCode`, a Chromium net error), `urlchange`,
 * `titlechange`, `faviconchange`, `historychange`, `navigationrequest` (answer it with
 * `answerNavigation`), `newwindow`, `focuschange`, `console` (`level`, `message`),
 * `unsupported` (`command`), `crashed` and `closed`.
 */
export class WebView {
  #listeners = new Map();
  #closed = false;

  constructor(node, options) {
    this.id = ++nextWebView;
    this.node = node;
    this.url = options.url ?? "";
    this.title = "";
    this.favicon = "";
    this.loading = false;
    this.progress = 0;
    this.canGoBack = false;
    this.canGoForward = false;
    this.focused = false;
    webViews.set(this.id, this);
    const flags = (options.inspectable === false ? 0 : 1) | (options.askBeforeNavigating ? 2 : 0) | (options.transparent ? 4 : 0);
    /** Resolves to whether the view opened: there are web views only in a desktop window. */
    this.opened = shellCall(40, [this.id, node.nodeId, this.url, options.profile ?? "", flags]).then((value) => {
      if (value !== 1) webViews.delete(this.id);
      return value === 1;
    });
  }

  addEventListener(type, listener) {
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = new Set()));
    list.add(listener);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  _fire(type, fields = {}) {
    const event = new WebViewEvent(type, fields);
    const handler = this["on" + type];
    if (typeof handler === "function") handler.call(this, event);
    for (const listener of this.#listeners.get(type) ?? []) listener.call(this, event);
  }

  #command(name, ...fields) {
    if (this.#closed) return;
    shellCall(42, [this.id, name, ...fields]);
  }

  #ask(name, ...fields) {
    if (this.#closed) return Promise.reject(new Error("the web view is closed"));
    return new Promise((resolve, reject) => {
      const request = webRequest(resolve, reject);
      this.#command(name, request, ...fields);
    });
  }

  navigate(url) { this.url = String(url); this.#command("navigate", this.url); }
  /** Shows `html` as if loaded from `baseUrl`. */
  loadHtml(html, baseUrl = "") { this.#command("loadHtml", baseUrl, html); }
  back() { this.#command("back"); }
  forward() { this.#command("forward"); }
  reload() { this.#command("reload"); }
  /** Reloads bypassing the cache. */
  hardReload() { this.#command("hardReload"); }
  stop() { this.#command("stop"); }
  /** Page zoom, 1 for 100%. */
  setZoom(factor) { this.#command("zoom", thousandths(factor)); }
  /** Gives the page keyboard focus. */
  focus() { this.#command("focus"); }
  /** Opens the engine's developer tools (Web Inspector on macOS). */
  openDevTools() { this.#command("devtools"); }
  setAudioMuted(muted) { this.#command("mute", muted ? 1 : 0); }
  /** The color scheme the page sees: `"system"`, `"light"` or `"dark"`. */
  setColorScheme(scheme) { this.#command("scheme", scheme === "light" || scheme === "dark" ? scheme : "system"); }
  /** Shows or hides the view; a hidden view keeps its page. */
  setShown(shown) { if (!this.#closed) shellCall(44, [this.id, shown ? 1 : 0]); }

  /** Runs `script` in the page; resolves to its value (a promise is awaited), JSON-cloned. */
  evaluate(script) {
    return this.#ask("evaluate", String(script)).then((json) => (json === "" ? undefined : JSON.parse(json)));
  }

  /** A text outline of what the page shows, with refs (`[ref=e12]`) on what an agent can act on. */
  snapshot() { return this.#ask("snapshot"); }

  /** The page's pixels: `{ width, height, data }`, RGBA rows top first, in device pixels. */
  screenshot() { return this.#ask("screenshot"); }

  /** Scrolls element `ref` (a snapshot ref) into view and clicks it with real input. */
  clickElement(ref) { return this.#ask("click", String(ref)); }

  /** Focuses element `ref`, selects its value and types `text` over it with real input. */
  fillElement(ref, text) { return this.#ask("fill", String(ref), String(text)); }

  /** A click at a point of the page's viewport, in CSS pixels. */
  clickAt(x, y, { button = 0, clickCount = 1, modifiers = 0 } = {}) {
    this.#command("clickAt", thousandths(x), thousandths(y), button, clickCount, modifiers);
  }

  movePointer(x, y, { modifiers = 0 } = {}) { this.#command("move", thousandths(x), thousandths(y), modifiers); }

  /** A wheel turn over a point, deltas in CSS pixels. */
  scroll(x, y, deltaX, deltaY, { modifiers = 0 } = {}) {
    this.#command("scroll", thousandths(x), thousandths(y), thousandths(deltaX), thousandths(deltaY), modifiers);
  }

  /** Types `text` into whatever has focus in the page. */
  typeText(text) { this.#command("type", String(text)); }

  /** Presses one key, by its DOM `key` value (`"Enter"`, `"a"`); modifiers shift 1, control 2, alt 4, meta 8. */
  pressKey(key, modifiers = 0) { this.#command("key", modifiers, String(key)); }

  /** Answers a `navigationrequest` event. */
  answerNavigation(request, allow) { this.#command("answer", request, allow ? 1 : 0); }

  /**
   * Finds `text` in the page (case insensitive) and highlights the next match, or the previous
   * one when `forward` is false; resolves to `{ matches, activeMatchOrdinal }`.
   */
  findInPage(text, { forward = true, newSession = false } = {}) {
    return this.#ask("find", forward ? 1 : 0, newSession ? 1 : 0, String(text));
  }

  stopFindInPage() { this.#command("stopFind"); }

  /** Closes the view; its page goes. */
  close() {
    if (this.#closed) return;
    this.#closed = true;
    shellCall(41, [this.id]);
  }
}

/**
 * Shows a web view over `node` (any node: the page covers its border box). Options: `url`,
 * `profile` (a name keeps cookies and storage between runs; empty forgets them),
 * `inspectable` (default true), `askBeforeNavigating`, `transparent`.
 */
export function createWebView(node, options = {}) {
  return new WebView(node, options);
}

/**
 * Clears what the pages of profile `profile` stored (an empty name: the views opened without
 * one): `cookies` (cookies and site storage) and `cache`.
 */
export function clearWebViewData({ profile = "", cookies = true, cache = true } = {}) {
  return new Promise((resolve) => {
    const request = ++nextWebRequest;
    dataClears.set(request, resolve);
    shellCall(43, [request, cookies ? 1 : 0, cache ? 1 : 0, profile]);
  });
}

function webViewEvent(id, code, text) {
  const parts = text === "" ? [] : text.split("\x1f");
  // The last field of each event may hold the separator itself.
  const rest = (from) => parts.slice(from).join("\x1f");
  if (code === 21) {
    const request = Number(parts[0]);
    const resolve = dataClears.get(request);
    dataClears.delete(request);
    resolve?.();
    return;
  }
  const view = webViews.get(id);
  if (!view) return;
  switch (code) {
    case 1: view._fire("created"); break;
    case 2:
      webViews.delete(id);
      view._fire("closed");
      break;
    case 3:
      view.loading = true;
      view._fire("loadstart", { url: rest(0) });
      break;
    case 4:
      view.progress = Number(parts[0]) / 1000;
      view._fire("loadprogress", { progress: view.progress });
      break;
    case 5:
      view.loading = false;
      view._fire("loadend", { ok: parts[0] === "1", errorCode: -Number(parts[1] ?? 0), url: parts[2] ?? "", error: rest(3) });
      break;
    case 6:
      view.url = rest(0);
      view._fire("urlchange", { url: view.url });
      break;
    case 7:
      view.title = rest(0);
      view._fire("titlechange", { title: view.title });
      break;
    case 8:
      view.canGoBack = parts[0] === "1";
      view.canGoForward = parts[1] === "1";
      view._fire("historychange", { canGoBack: view.canGoBack, canGoForward: view.canGoForward });
      break;
    case 9:
      view._fire("navigationrequest", { request: Number(parts[0]), userInitiated: parts[1] === "1", url: rest(2) });
      break;
    case 10: view._fire("newwindow", { url: rest(0) }); break;
    case 11:
      view.focused = parts[0] === "1";
      view._fire("focuschange", { focused: view.focused });
      break;
    case 12: settleWebRequest(Number(parts[0]), parts[1] === "1", rest(2), rest(2)); break;
    case 13: settleWebRequest(Number(parts[0]), true, rest(1)); break;
    case 14:
      settleWebRequest(Number(parts[0]), true, {
        width: Number(parts[1]),
        height: Number(parts[2]),
        data: decodeBase64(parts[3] ?? ""),
      });
      break;
    case 15: settleWebRequest(Number(parts[0]), parts[1] === "1", undefined, rest(2) || "the action failed"); break;
    case 16: view._fire("console", { level: CONSOLE_LEVELS[Number(parts[0])] ?? "log", message: rest(1) }); break;
    case 17: {
      const command = rest(1);
      if (Number(parts[0])) settleWebRequest(Number(parts[0]), false, undefined, command + " is not supported here");
      view._fire("unsupported", { command });
      break;
    }
    case 18: view._fire("crashed", { reason: rest(0) }); break;
    case 19:
      view.favicon = rest(0);
      view._fire("faviconchange", { url: view.favicon });
      break;
    case 20:
      settleWebRequest(Number(parts[0]), true, { matches: Number(parts[1]), activeMatchOrdinal: Number(parts[2]) });
      break;
  }
}

/** Stops the shortcut of `accelerator`. */
/** Ends the app with an exit code once the current turn finishes. */
export function quit(code = 0) {
  shellCall(45, [String(code)]);
}

export function unregisterShortcut(accelerator) {
  const { code, bits } = parseShortcut(accelerator);
  const id = shortcutIds.get(code + "+" + bits);
  if (id === undefined) return;
  shortcutIds.delete(code + "+" + bits);
  shortcuts.delete(id);
  shellCall(4, [id]);
}

// File dialogs waiting for `DialogClosed`, by dialog id.
const dialogs = new Map();

function extensionsOf(filters) {
  const all = [];
  for (const filter of filters ?? []) {
    for (const extension of filter.extensions ?? []) {
      if (extension === "*") return "";
      all.push(String(extension).replace(/^\./, ""));
    }
  }
  return all.join(",");
}

function dialog(op, fields) {
  return shellCall(op, fields).then((id) => (id ? new Promise((resolve) => dialogs.set(id, resolve)) : []));
}

/**
 * Opens the system's file dialog, as Electron's `dialog.showOpenDialog`: `properties` takes
 * `openFile`, `openDirectory` and `multiSelections`; `filters` are `{ name, extensions }`
 * without dots (`"*"` for every file). It attaches to the window as a sheet on macOS and never
 * blocks. Resolves to `{ canceled, filePaths }`.
 */
export function showOpenDialog(options = {}) {
  const properties = options.properties ?? ["openFile"];
  const directories = properties.includes("openDirectory");
  const files = properties.includes("openFile") || !directories;
  const flags = (files ? 1 : 0) | (directories ? 2 : 0) | (properties.includes("multiSelections") ? 4 : 0);
  return dialog(5, [String(options.title ?? ""), String(options.defaultPath ?? ""), flags, extensionsOf(options.filters)]).then(
    (filePaths) => ({ canceled: filePaths.length === 0, filePaths }),
  );
}

/**
 * Opens the system's save dialog, as Electron's `dialog.showSaveDialog`. `defaultPath` may
 * name a folder, a file, or both. Resolves to `{ canceled, filePath }`.
 */
export function showSaveDialog(options = {}) {
  const path = String(options.defaultPath ?? "");
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const looksLikeFolder = slash === path.length - 1 || !/\.[^./\\]+$/.test(path.slice(slash + 1));
  const directory = looksLikeFolder ? path : path.slice(0, Math.max(slash, 0));
  const name = looksLikeFolder ? "" : path.slice(slash + 1);
  return dialog(6, [String(options.title ?? ""), directory, name, extensionsOf(options.filters)]).then((paths) => ({
    canceled: paths.length === 0,
    filePath: paths[0] ?? "",
  }));
}

/**
 * Replaces the app's menu bar, as Electron's `Menu.setApplicationMenu(Menu.buildFromTemplate(t))`.
 * Items are `{ label, click, accelerator, enabled, checked, type, role, submenu, visible }`.
 * `accelerator` is `"Mod+Shift+K"` (`Mod`, `CmdOrCtrl`: Command on macOS, Control elsewhere).
 * The system roles (`about`, `quit`, `undo`, `copy`, `togglefullscreen`, `minimize`, `front`
 * and so on) are the system's own items; `zoomIn`, `zoomOut` and `resetZoom` zoom the page;
 * `appMenu`, `fileMenu`, `editMenu`, `viewMenu` and `windowMenu` are whole menus. On macOS
 * the first menu is the app menu. Edit shortcuts reach the focused node as keys first.
 */
export function setApplicationMenu(template) {
  dropMenu("app");
  const lines = [];
  packMenu(template ?? [], lines, "app");
  return shellCall(7, [lines.join("\n")]).then(() => undefined);
}

let contextMenuClosed = null;

function closeContextMenu() {
  dropMenu("context");
  const closed = contextMenuClosed;
  contextMenuClosed = null;
  closed?.();
}

/**
 * Opens a native context menu at `x`, `y` (CSS pixels in the window, a `MouseEvent`'s
 * `clientX`/`clientY`), as Electron's `menu.popup()`. Items are as `setApplicationMenu`'s.
 * Resolves when the menu closes, with or without a choice, to `true`; or at once to `false`
 * when the system draws no context menus (Linux, the browser) and the app should draw its own.
 */
export function showContextMenu(template, { x = 0, y = 0 } = {}) {
  closeContextMenu();
  const lines = [];
  packMenu(template ?? [], lines, "context");
  const zoom = appWindow.zoomFactor || 1;
  return shellCall(8, [x * zoom, y * zoom, lines.join("\n")]).then((shown) => {
    if (shown !== 1) {
      dropMenu("context");
      return false;
    }
    return new Promise((resolve) => (contextMenuClosed = () => resolve(true)));
  });
}

/** Puts `text` on the app's dock or taskbar icon (an unread count); `""` takes it off. */
export function setBadge(text) {
  return shellCall(9, [String(text ?? "")]).then((shown) => shown === 1);
}

/** Shows progress from 0 to 1 on the app's dock or taskbar icon; a negative number takes it off. */
export function setProgress(fraction) {
  return shellCall(10, [Number(fraction)]).then((shown) => shown === 1);
}

/** Opens `url` with the system's handler: a web page in the default browser, `mailto:` in the mail app. */
export function openExternal(url) {
  return shellCall(11, [String(url)]).then((opened) => opened === 1);
}

/** Shows the file or folder at `path` selected in Finder, Explorer or the file manager. */
export function showItemInFolder(path) {
  return shellCall(12, [String(path)]).then((shown) => shown === 1);
}

/**
 * Drags the files at `paths` out of the window, as Electron's `webContents.startDrag`, so
 * Finder, a mail draft or a terminal can take them. Call it from a `pointerdown` or
 * `pointermove` listener while the button is down. Resolves to whether the drag started
 * (macOS and Windows drag files out; Linux and the browser do not).
 */
export function startFileDrag(paths) {
  const list = (Array.isArray(paths) ? paths : [paths]).map(String).filter(Boolean);
  return shellCall(13, [list.join("\n")]).then((started) => started === 1);
}

const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];

function zoomStep(direction) {
  const now = appWindow.zoomFactor;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > now + 0.001) ?? now;
  return ZOOM_STEPS.findLast((step) => step < now - 0.001) ?? now;
}

/**
 * The window the app runs in. `fullScreen` and `zoomFactor` (the page zoom, as Electron's
 * `webFrame.getZoomFactor()`; Mod with `=`, `-` and `0` change it too) are current, and
 * `fullscreenchange` and `zoomchange` say when they change. The title bar is the app's
 * configuration: a transparent one, with the window controls placed in it, comes from
 * `TitleBar.transparent` in its `tasks.silk`.
 */
class AppWindow {
  fullScreen = false;
  zoomFactor = 1;
  #listeners = new Map();

  setFullScreen(on) {
    if (!!on !== this.fullScreen) shellCall(14, [0]);
  }

  toggleFullScreen() {
    shellCall(14, [0]);
  }

  minimize() {
    shellCall(14, [1]);
  }

  /** Shows the window and brings it to the front with keyboard focus. */
  focus() {
    shellCall(14, [2]);
  }

  show() {
    shellCall(14, [2]);
  }

  hide() {
    shellCall(14, [3]);
  }

  setTitle(title) {
    shellCall(14, [4, String(title)]);
  }

  /** Zooms the page, from 0.25 to 5. Resolves to the zoom now. */
  setZoomFactor(zoom) {
    return shellCall(15, [Math.min(5, Math.max(0.25, Number(zoom) || 1))]).then((now) => {
      if (now !== this.zoomFactor) {
        this.zoomFactor = now;
        this._fire("zoomchange", { zoomFactor: now });
      }
      return now;
    });
  }

  getZoomFactor() {
    return this.zoomFactor;
  }

  isFullScreen() {
    return this.fullScreen;
  }

  addEventListener(type, listener) {
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = []));
    if (!list.includes(listener)) list.push(listener);
  }

  removeEventListener(type, listener) {
    const list = this.#listeners.get(type);
    const index = list ? list.indexOf(listener) : -1;
    if (index >= 0) list.splice(index, 1);
  }

  _fire(type, detail) {
    const event = { type, target: this, ...detail };
    for (const listener of (this.#listeners.get(type) ?? []).slice()) {
      try {
        listener.call(this, event);
      } catch (error) {
        reportError(error);
      }
    }
  }
}

export const appWindow = new AppWindow();

/**
 * The app's memory in bytes, as the system shows it to users: `phys_footprint` on macOS
 * (Activity Monitor's "Memory"), `Pss` on Linux and `PrivateUsage` on Windows. `processes` is
 * how many processes `footprint` counts: the host is one. In the browser it is the wasm
 * tree's linear memory, without the page's JavaScript heap. `null` when there is no answer.
 */
export function memoryUsage() {
  const footprint = native.memoryUsage?.() ?? 0;
  return footprint > 0 ? { footprint, processes: 1 } : null;
}

// Selector queries run in the host on its tree (`__ui.query`); a host without one (the web
// canvas build) answers undefined, which reads as no match.
function queried(mode, node, selector) {
  const answer = native.query?.(mode, node.nodeId, String(selector));
  if (answer === -1) {
    const message = "'" + selector + "' is not a valid selector";
    throw typeof DOMException === "function" ? new DOMException(message, "SyntaxError") : new SyntaxError(message);
  }
  return answer;
}

// `getComputedStyle`: one native read per property, made when the property is read, so a
// declaration stays live and costs nothing for the properties nobody asks for.
const readComputed = native.computed ?? (() => undefined);
const computedId = Symbol("node");
// Property names by the name they were asked by, null for the declaration's own members.
const computedNames = new Map();
const lowerNames = new Map();
function computedName(key, target) {
  let name = computedNames.get(key);
  if (name === undefined) {
    name = key in target ? null : key === "cssFloat" ? "float"
      : key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/^(webkit|moz|ms)-/, "-$1-");
    computedNames.set(key, name);
  }
  return name;
}

class CSSStyleDeclaration {
  constructor(id) { Object.defineProperty(this, computedId, { value: id }); }
  getPropertyValue(name) {
    let lower = lowerNames.get(name);
    if (lower === undefined) {
      lower = String(name).toLowerCase();
      if (typeof name === "string") lowerNames.set(name, lower);
    }
    return readComputed(this[computedId], lower) ?? "";
  }
  getPropertyPriority() { return ""; }
  setProperty() { throw new TypeError("a computed style cannot be changed"); }
  removeProperty() { throw new TypeError("a computed style cannot be changed"); }
  get cssText() { return ""; }
  get length() { return 0; }
  item() { return ""; }
}

const computedTraps = {
  get(target, key, receiver) {
    if (typeof key === "string") {
      const name = computedName(key, target);
      if (name !== null) return readComputed(target[computedId], name) ?? "";
    }
    return Reflect.get(target, key, receiver);
  },
  set() { throw new TypeError("a computed style cannot be changed"); },
};

/**
 * The values the tree resolved for `node` (an @silkui/core node, or an element of a DOM layer
 * over one): typed and animated properties as they are now, box sizes, margins, padding and
 * border widths as laid out, the rest as cascaded with lengths in pixels. Each property read
 * is one call into the tree; it applies pending changes and lays out only when something
 * changed since the last layout. Shorthands, custom properties and pseudo-elements read "".
 */
export function getComputedStyle(node, pseudo) {
  const id = node?.nodeId ?? node?.node?.nodeId;
  if (typeof id !== "number") throw new TypeError("getComputedStyle takes a node");
  return new Proxy(new CSSStyleDeclaration(pseudo ? 0 : id), computedTraps);
}

globalThis.getComputedStyle ??= getComputedStyle;

// Layout reads. Each lays out first when something changed since the last frame (as a
// browser forces layout), leaves its numbers in the bridge and answers how many there are.
const geometry = native.geometry ?? (() => 0);
const ALIGNMENTS = { start: 0, center: 1, end: 2, nearest: 3 };
const BEHAVIORS = { auto: 0, instant: 1, smooth: 2 };

function alignment(value, fallback) {
  if (value === undefined) return fallback;
  const code = ALIGNMENTS[value];
  if (code === undefined) throw new TypeError("'" + value + "' is not a valid ScrollLogicalPosition");
  return code;
}

/** A read-only rectangle, as `DOMRect` on the web. */
export class DOMRect {
  constructor(x = 0, y = 0, width = 0, height = 0) {
    this.x = x;
    this.y = y;
    this.width = width;
    this.height = height;
  }
  get left() { return Math.min(this.x, this.x + this.width); }
  get top() { return Math.min(this.y, this.y + this.height); }
  get right() { return Math.max(this.x, this.x + this.width); }
  get bottom() { return Math.max(this.y, this.y + this.height); }
  toJSON() {
    const { x, y, width, height, top, right, bottom, left } = this;
    return { x, y, width, height, top, right, bottom, left };
  }
}

globalThis.DOMRect ??= DOMRect;

function metric(id, index) {
  if (!native.metrics?.(id)) return 0;
  return geometry(index);
}

function readRect(id) {
  if (!native.rect?.(id)) return new DOMRect();
  return new DOMRect(geometry(0), geometry(1), geometry(2), geometry(3));
}

function readRects(count) {
  const list = [];
  for (let i = 0; i < count; i++) list.push(new DOMRect(geometry(4 * i), geometry(4 * i + 1), geometry(4 * i + 2), geometry(4 * i + 3)));
  list.item = (index) => list[index] ?? null;
  return list;
}

// `scrollTo`, `scroll` and `scrollBy`: numbers, or `{ left, top, behavior }`. `by` is 4 for scrollBy.
function scrollNode(id, x, y, by) {
  let left, top, behavior = 0;
  if (x !== null && typeof x === "object") {
    left = x.left;
    top = x.top;
    if (x.behavior !== undefined) {
      behavior = BEHAVIORS[x.behavior];
      if (behavior === undefined) throw new TypeError("'" + x.behavior + "' is not a valid ScrollBehavior");
    }
  } else {
    left = x;
    top = y;
  }
  // As on the web, a non-finite coordinate counts as 0.
  const has = (left !== undefined ? 1 : 0) | (top !== undefined ? 2 : 0);
  const number = (value) => (Number.isFinite(+value) ? +value : 0);
  if (native.scroll) native.scroll(id, number(left), number(top), behavior, has | by);
  else if (!by) native.scrollTo(id, number(left), number(top));
}

// IntersectionObserver and ResizeObserver: the tree computes every observation after each
// layout and calls `__ui.observed(count)` with only the entries that changed.
const observersById = new Map();
let nextObserverId = 0;

function lengths(text, name) {
  const parts = String(text ?? "0px").trim().split(/\s+/);
  if (parts.length > 4) throw new SyntaxError("'" + text + "' is not a valid " + name);
  const values = [], percent = [];
  for (const part of parts) {
    const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|%)?$/.exec(part);
    if (!match || (match[2] === undefined && +match[1] !== 0)) throw new SyntaxError("'" + text + "' is not a valid " + name + ": use px or %");
    values.push(+match[1]);
    percent.push(match[2] === "%");
  }
  // top, right, bottom, left as in the margin shorthand.
  const pick = [[0, 0, 0, 0], [0, 1, 0, 1], [0, 1, 2, 1], [0, 1, 2, 3]][values.length - 1];
  const out = pick.map((i) => values[i]);
  let bits = 0;
  pick.forEach((i, side) => { if (percent[i]) bits |= 1 << side; });
  out.text = pick.map((i) => values[i] + (percent[i] ? "%" : "px")).join(" ");
  return { values: out, bits };
}

/** As `IntersectionObserverEntry` on the web. */
export class IntersectionObserverEntry {
  constructor(init) { Object.assign(this, init); }
}

/** As `IntersectionObserver` on the web, with `scrollMargin` from version 2. `root` is a node or null for the window. */
export class IntersectionObserver {
  #id = ++nextObserverId;
  #callback;
  #targets = new Map();
  #records = [];
  #margin;
  #scroll;

  constructor(callback, options = {}) {
    if (typeof callback !== "function") throw new TypeError("IntersectionObserver takes a callback");
    this.#callback = callback;
    const root = options.root ?? null;
    if (root !== null && typeof root.nodeId !== "number" && typeof root.node?.nodeId !== "number") throw new TypeError("root must be a node or null");
    this.root = root;
    this.#margin = lengths(options.rootMargin, "rootMargin");
    this.#scroll = lengths(options.scrollMargin, "scrollMargin");
    let list = options.threshold ?? 0;
    list = (Array.isArray(list) ? list : [list]).map(Number);
    for (const value of list) if (!(value >= 0 && value <= 1)) throw new RangeError("Threshold values must be numbers between 0 and 1");
    list.sort((a, b) => a - b);
    if (list.length === 0) list.push(0);
    Object.defineProperties(this, {
      rootMargin: { value: this.#margin.values.text, enumerable: true },
      scrollMargin: { value: this.#scroll.values.text, enumerable: true },
      thresholds: { value: Object.freeze(list), enumerable: true },
      delay: { value: 0, enumerable: true },
      trackVisibility: { value: false, enumerable: true },
    });
  }

  observe(target) {
    const id = target?.nodeId ?? target?.node?.nodeId;
    if (typeof id !== "number") throw new TypeError("observe takes a node");
    if (this.#targets.has(id)) return;
    if (this.#targets.size === 0) {
      const m = this.#margin.values, s = this.#scroll.values;
      const rootId = this.root ? (this.root.nodeId ?? this.root.node.nodeId) : 0;
      native.observer?.(this.#id, rootId, m[0], m[1], m[2], m[3], this.#margin.bits | (this.#scroll.bits << 4), s[0], s[1], s[2], s[3]);
      for (const value of this.thresholds) native.threshold?.(this.#id, value);
      observersById.set(this.#id, this);
    }
    this.#targets.set(id, target);
    native.observe?.(this.#id, id, 0);
  }

  unobserve(target) {
    const id = target?.nodeId ?? target?.node?.nodeId;
    if (!this.#targets.delete(id)) return;
    native.unobserve?.(this.#id, id);
    if (this.#targets.size === 0) observersById.delete(this.#id);
  }

  disconnect() {
    if (this.#targets.size === 0) return;
    this.#targets.clear();
    native.unobserve?.(this.#id, 0);
    observersById.delete(this.#id);
  }

  takeRecords() {
    const records = this.#records;
    this.#records = [];
    return records;
  }

  // The object `observe` was given: a Foldkit element is its entries' target, not its node.
  _target(id) { return this.#targets.get(id) ?? null; }

  _queue(entry) { this.#records.push(entry); }

  _deliver() {
    const records = this.takeRecords();
    if (records.length === 0) return;
    try { this.#callback.call(this, records, this); } catch (error) { reportError(error); }
  }
}

/** As `ResizeObserverEntry` on the web. */
export class ResizeObserverEntry {
  constructor(init) { Object.assign(this, init); }
}

const BOXES = { "content-box": 1, "border-box": 2, "device-pixel-content-box": 3 };

/** As `ResizeObserver` on the web: entries come after a layout that changed the observed box. */
export class ResizeObserver {
  #id = ++nextObserverId;
  #callback;
  #targets = new Map();
  #records = [];

  constructor(callback) {
    if (typeof callback !== "function") throw new TypeError("ResizeObserver takes a callback");
    this.#callback = callback;
  }

  observe(target, options) {
    const id = target?.nodeId ?? target?.node?.nodeId;
    if (typeof id !== "number") throw new TypeError("observe takes a node");
    const box = BOXES[options?.box ?? "content-box"];
    if (box === undefined) throw new TypeError("'" + options.box + "' is not a valid ResizeObserverBoxOptions");
    this.#targets.set(id, target);
    observersById.set(this.#id, this);
    native.observe?.(this.#id, id, box);
  }

  unobserve(target) {
    const id = target?.nodeId ?? target?.node?.nodeId;
    if (!this.#targets.delete(id)) return;
    native.unobserve?.(this.#id, id);
    if (this.#targets.size === 0) observersById.delete(this.#id);
  }

  disconnect() {
    if (this.#targets.size === 0) return;
    this.#targets.clear();
    native.unobserve?.(this.#id, 0);
    observersById.delete(this.#id);
  }

  // The object `observe` was given: a Foldkit element is its entries' target, not its node.
  _target(id) { return this.#targets.get(id) ?? null; }

  _queue(entry) { this.#records.push(entry); }

  _deliver() {
    const records = this.#records;
    this.#records = [];
    if (records.length === 0) return;
    try { this.#callback.call(this, records, this); } catch (error) { reportError(error); }
  }
}

const size = (inlineSize, blockSize) => Object.freeze([Object.freeze({ inlineSize, blockSize })]);

native.observed = function (count) {
  // Read every entry first: a callback's own layout reads reuse the numbers.
  const time = performance.now();
  const touched = [];
  let at = 0;
  for (let n = 0; n < count; n++) {
    const kind = geometry(at);
    const observer = observersById.get(geometry(at + 1));
    const target = observer?._target(geometry(at + 2)) ?? null;
    const read = (i) => geometry(at + i);
    if (kind === 1) {
      if (observer && target) {
        observer._queue(new IntersectionObserverEntry({
          time,
          target,
          isIntersecting: read(3) === 1,
          isVisible: false,
          intersectionRatio: read(4),
          boundingClientRect: new DOMRect(read(5), read(6), read(7), read(8)),
          intersectionRect: new DOMRect(read(9), read(10), read(11), read(12)),
          rootBounds: new DOMRect(read(13), read(14), read(15), read(16)),
        }));
      }
      at += 17;
    } else {
      if (observer && target) {
        observer._queue(new ResizeObserverEntry({
          target,
          contentRect: new DOMRect(read(3), read(4), read(5), read(6)),
          borderBoxSize: size(read(7), read(8)),
          contentBoxSize: size(read(9), read(10)),
          devicePixelContentBoxSize: size(read(11), read(12)),
        }));
      }
      at += 13;
    }
    if (observer && !touched.includes(observer)) touched.push(observer);
  }
  // ResizeObserver callbacks first, as browsers run them before intersection updates.
  for (const observer of touched) if (observer instanceof ResizeObserver) observer._deliver();
  for (const observer of touched) if (observer instanceof IntersectionObserver) observer._deliver();
};

globalThis.IntersectionObserver ??= IntersectionObserver;
globalThis.IntersectionObserverEntry ??= IntersectionObserverEntry;
globalThis.ResizeObserver ??= ResizeObserver;
globalThis.ResizeObserverEntry ??= ResizeObserverEntry;

/** The topmost node at window point `x`, `y`, or null. */
export function elementFromPoint(x, y) {
  return nodes[native.hit?.(Number(x), Number(y)) ?? 0] ?? null;
}

/** Every node at window point `x`, `y`, topmost first. */
export function elementsFromPoint(x, y) {
  const count = native.hits?.(Number(x), Number(y)) ?? 0;
  const list = [];
  for (let i = 0; i < count; i++) {
    const node = nodes[geometry(i)];
    if (node) list.push(node);
  }
  return list;
}

/** The text position at window point `x`, `y`: `{ offsetNode, offset, getClientRect() }` (UTF-16 offset), or null. */
export function caretPositionFromPoint(x, y) {
  if (!native.caret?.(Number(x), Number(y))) return null;
  const offsetNode = nodes[geometry(0)] ?? null;
  const offset = geometry(1);
  const rect = new DOMRect(geometry(2), geometry(3), geometry(4), geometry(5));
  return { offsetNode, offset, getClientRect: () => rect };
}

/**
 * The rectangles of the text from (`startNode`, `startOffset`) to (`endNode`, `endOffset`),
 * offsets in UTF-16 units as in a DOM `Range`: one per line piece, as `Range.getClientRects`.
 */
export function rangeClientRects(startNode, startOffset, endNode, endOffset) {
  return readRects(native.rangeRects?.(startNode.nodeId, startOffset, endNode.nodeId, endOffset) ?? 0);
}

/** The union of `rangeClientRects`, as `Range.getBoundingClientRect`. */
export function rangeBoundingClientRect(startNode, startOffset, endNode, endOffset) {
  const rects = rangeClientRects(startNode, startOffset, endNode, endOffset);
  if (rects.length === 0) return new DOMRect();
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.left);
    top = Math.min(top, rect.top);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  return new DOMRect(left, top, right - left, bottom - top);
}

/**
 * `CSS.supports(property, value)` and `CSS.supports(conditionText)`, answered by the same parser
 * and property catalog as the tree's `@supports`, so a check here and an `@supports` block in a
 * stylesheet always agree. Also installed as `globalThis.CSS.supports`.
 */
export function supports(conditionOrProperty, value) {
  if (!native.supports) return false;
  return arguments.length > 1 ? native.supports(String(conditionOrProperty), String(value)) : native.supports(String(conditionOrProperty));
}

/** `CSS.escape(text)`: `text` as a CSS identifier, escaped as the CSSOM spec does. */
export function cssEscape(value) {
  const text = String(value);
  let result = "";
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    const character = text[i];
    if (code === 0) result += "\uFFFD";
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f || (i === 0 && code >= 0x30 && code <= 0x39) || (i === 1 && code >= 0x30 && code <= 0x39 && text.charCodeAt(0) === 0x2d)) result += "\\" + code.toString(16) + " ";
    else if (i === 0 && text.length === 1 && code === 0x2d) result += "\\" + character;
    else if (code >= 0x80 || code === 0x2d || code === 0x5f || (code >= 0x30 && code <= 0x39) || (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) result += character;
    else result += "\\" + character;
  }
  return result;
}

const registeredProperties = new Set();
let registeredPropertiesCss = "";
let registeredPropertiesSheet = null;

/**
 * `CSS.registerProperty(definition)`: registers a custom property's syntax, inheritance and
 * initial value as an `@property` rule, as the CSS Properties and Values API specifies.
 */
export function registerProperty(definition) {
  if (!definition || typeof definition !== "object") {
    throw new TypeError("CSS.registerProperty requires a property definition object");
  }
  const name = String(definition.name ?? "");
  if (!/^--[\S]+$/.test(name)) {
    throw domError("SyntaxError", `invalid custom property name '${name}'`);
  }
  if (typeof definition.inherits !== "boolean") {
    throw new TypeError("CSS.registerProperty requires a boolean inherits descriptor");
  }
  const syntax = definition.syntax === undefined ? "*" : String(definition.syntax);
  const hasInitial = definition.initialValue !== undefined;
  if (syntax.trim() !== "*" && !hasInitial) {
    throw domError("SyntaxError", `CSS.registerProperty '${name}' requires initialValue for non-universal syntax`);
  }
  if (registeredProperties.has(name)) {
    throw domError("InvalidModificationError", `custom property '${name}' is already registered`);
  }
  registeredProperties.add(name);
  const initialPart = hasInitial ? ` initial-value: ${String(definition.initialValue)};` : "";
  registeredPropertiesCss += `@property ${name} { syntax: ${JSON.stringify(syntax)}; inherits: ${definition.inherits};${initialPart} }\n`;
  if (!native.compileStyleSheet) return;
  const bytes = native.compileStyleSheet(registeredPropertiesCss);
  if (!registeredPropertiesSheet) {
    registeredPropertiesSheet = new CSSStyleSheet();
    replaceSheet(registeredPropertiesSheet, bytes);
    if (rootNode) syncAdoptedSheets();
  } else {
    replaceSheet(registeredPropertiesSheet, bytes);
  }
}

if (typeof globalThis.CSS !== "object" || globalThis.CSS === null) globalThis.CSS = {};
globalThis.CSS.supports ??= supports;
globalThis.CSS.escape ??= cssEscape;
globalThis.CSS.registerProperty ??= registerProperty;

let frameStatsSince = 0;

/**
 * The frames the window put on screen since the last call (since the app started, the first
 * time). `frames` counts presents, which `requestAnimationFrame` cannot: a callback can run
 * for a frame the GPU never drew. `dropped` counts painted frames a newer one replaced before
 * the GPU took them; `p50` to `max` are milliseconds between presents. `null` where the host
 * has no window of its own (a browser build).
 */
export function frameStats() {
  if (!native.frameStats) return null;
  const now = performance.now();
  const seconds = (now - frameStatsSince) / 1000;
  frameStatsSince = now;
  const frames = native.frameStats(0);
  return {
    frames,
    fps: seconds > 0 ? frames / seconds : 0,
    dropped: native.frameStats(1),
    p50: native.frameStats(2),
    p95: native.frameStats(3),
    p99: native.frameStats(4),
    max: native.frameStats(5),
  };
}

// MutationObserver, as in the DOM Standard, for the tree's nodes: child lists, attributes and
// text. Records are queued as the mutations happen and delivered in one microtask.

class MutationRecord {
  constructor(type, target, fields) {
    this.type = type;
    this.target = target;
    this.addedNodes = fields.addedNodes ?? [];
    this.removedNodes = fields.removedNodes ?? [];
    this.previousSibling = fields.previousSibling ?? null;
    this.nextSibling = fields.nextSibling ?? null;
    this.attributeName = fields.attributeName ?? null;
    this.attributeNamespace = null;
    this.oldValue = fields.oldValue ?? null;
  }
}

let mutationsQueued = false;

function adjustMutationCounts(entry, delta) {
  if (entry.childList) {
    moChildListCount += delta;
    if (entry.subtree) moSubtreeChildList += delta;
  }
  if (entry.attributes) {
    moAttrCount += delta;
    if (entry.subtree) moSubtreeAttr += delta;
  }
  if (entry.characterData) {
    moCharDataCount += delta;
    if (entry.subtree) moSubtreeCharData += delta;
  }
}

function enqueueMutation(observer, options, type, target, fields, oldValueOption) {
  const record = new MutationRecord(type, target, fields);
  if (oldValueOption && !options[oldValueOption]) record.oldValue = null;
  observer._records.push(record);
  pendingMutationObservers.add(observer);
  if (!mutationsQueued) {
    mutationsQueued = true;
    queueMicrotask(deliverMutations);
  }
}

function matchMutationObservers(target, wants, filterName, walkAncestors) {
  let firstObserver = null;
  let firstOptions = null;
  let matched = null;
  for (let node = target; node; node = walkAncestors ? observedParent(node) : null) {
    const regs = node._mutationTargets;
    if (regs) {
      const isTarget = node === target;
      for (const [observer, found] of regs) {
        if ((!isTarget && !found.subtree) || !found[wants]) continue;
        if (filterName !== undefined && found.attributeFilter && !found.attributeFilter.includes(filterName)) continue;
        if (matched) {
          if (!matched.has(observer)) matched.set(observer, found);
        } else if (firstObserver === null) {
          firstObserver = observer;
          firstOptions = found;
        } else if (firstObserver !== observer) {
          matched = new Map();
          matched.set(firstObserver, firstOptions);
          matched.set(observer, found);
        }
      }
    }
  }
  return matched ?? (firstObserver ? [firstObserver, firstOptions] : null);
}

function dispatchMatched(matches, type, target, fields, oldValueOption) {
  if (Array.isArray(matches)) {
    enqueueMutation(matches[0], matches[1], type, target, fields, oldValueOption);
  } else {
    for (const [observer, options] of matches) {
      enqueueMutation(observer, options, type, target, fields, oldValueOption);
    }
  }
}

// The document sits above the root, as in event paths, so observing it with `subtree` sees the tree.
function observedParent(node) {
  return node.parentNode ?? (node === rootNode && outerTargets.length ? outerTargets[0] : null);
}

function deliverMutations() {
  mutationsQueued = false;
  const pending = Array.from(pendingMutationObservers);
  pendingMutationObservers.clear();
  if (pending.length > 1) pending.sort((a, b) => a._order - b._order);
  for (const observer of pending) {
    const records = observer.takeRecords();
    if (records.length === 0) continue;
    try {
      observer._callback.call(observer, records, observer);
    } catch (error) {
      reportError(error);
    }
  }
}

function childListRecord(parent, added, removed, previousSibling, nextSibling) {
  const matches = matchMutationObservers(parent, "childList", undefined, moSubtreeChildList > 0);
  if (!matches) return;
  dispatchMatched(matches, "childList", parent, {
    addedNodes: added ? [added] : [],
    removedNodes: removed ? [removed] : [],
    previousSibling: previousSibling ?? null,
    nextSibling: nextSibling ?? null,
  });
}

function attributeRecord(node, name, text) {
  const matches = matchMutationObservers(node, "attributes", name, moSubtreeAttr > 0);
  if (!matches) return;
  const old = node.getAttribute(name);
  if (old === text) return;
  dispatchMatched(matches, "attributes", node, { attributeName: name, oldValue: old }, "attributeOldValue");
}

function characterDataRecord(node, old) {
  const matches = matchMutationObservers(node, "characterData", undefined, moSubtreeCharData > 0);
  if (!matches) return;
  dispatchMatched(matches, "characterData", node, { oldValue: old }, "characterDataOldValue");
}

export class MutationObserver {
  constructor(callback) {
    if (typeof callback !== "function") throw new TypeError("MutationObserver needs a function");
    this._callback = callback;
    this._targets = new Map();
    this._records = [];
    this._order = 0;
  }

  observe(target, options = {}) {
    if (!(target instanceof Node) && !(outerTargets.length && target === outerTargets[0])) return;
    const attributes = options.attributes ?? (options.attributeOldValue !== undefined || options.attributeFilter !== undefined);
    const characterData = options.characterData ?? options.characterDataOldValue !== undefined;
    if (!options.childList && !attributes && !characterData) {
      throw new TypeError("MutationObserver.observe needs childList, attributes or characterData");
    }
    const prev = this._targets.get(target);
    if (prev) adjustMutationCounts(prev, -1);
    const entry = {
      childList: !!options.childList,
      attributes: !!attributes,
      characterData: !!characterData,
      subtree: !!options.subtree,
      attributeOldValue: !!options.attributeOldValue,
      characterDataOldValue: !!options.characterDataOldValue,
      attributeFilter: options.attributeFilter ? Array.from(options.attributeFilter, String) : null,
    };
    this._targets.set(target, entry);
    adjustMutationCounts(entry, 1);
    let regs = target._mutationTargets;
    if (!regs) target._mutationTargets = regs = new Map();
    regs.set(this, entry);
    if (!mutationObservers.has(this)) {
      this._order = ++mutationObserverOrder;
      mutationObservers.add(this);
    }
  }

  disconnect() {
    for (const [target, entry] of this._targets) {
      adjustMutationCounts(entry, -1);
      const regs = target._mutationTargets;
      if (regs) {
        regs.delete(this);
        if (regs.size === 0) target._mutationTargets = null;
      }
    }
    this._targets.clear();
    this._records = [];
    pendingMutationObservers.delete(this);
    mutationObservers.delete(this);
  }

  takeRecords() {
    const records = this._records;
    this._records = [];
    return records;
  }
}
