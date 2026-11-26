// The browser globals a DOM app reaches for, over the Silk UI tree: `document` with an `<html>`
// root and a `<body>`, `window` as the global object, element classes for `instanceof`,
// `location` and `history`, `localStorage`, `sessionStorage`, `indexedDB`, `Worker` and the
// observers. Import it before anything else; globals the realm already has stay as they are.
import {
  DocumentFragment as CoreFragment,
  DOMRect,
  IntersectionObserver,
  MutationObserver,
  Node as CoreNode,
  Range,
  ResizeObserver,
  Selection,
  StaticRange,
  Svg,
  SvgElement,
  SvgText,
  Text as CoreText,
  Input,
  CheckInput,
  RangeInput,
  ColorInput,
  FileInput,
  ButtonInput,
  HiddenInput,
  FormElement,
  SelectElement,
  OptionElement,
  OptGroupElement,
  ButtonElement,
  FieldSetElement,
  LabelElement,
  ProgressElement,
  MeterElement,
  OutputElement,
  ValidityState,
  isControlDisabled,
  Image as CoreImage,
  Canvas,
  caretPositionFromPoint,
  createDocumentFragment,
  createNode,
  createRange,
  createSvgElement,
  createText,
  cssEscape,
  elementFromPoint,
  elementsFromPoint,
  getComputedStyle,
  getSelection,
  mount,
  root,
  setOuterTargets,
  supports,
} from "./index.js";
import * as core from "./index.js";
import { Storage, localStorageArea, sessionStorageArea } from "./storage.js";
import { History, Location, Navigation, NavigateEvent, NavigationCurrentEntryChangeEvent, NavigationHistoryEntry, PopStateEvent, HashChangeEvent } from "./location.js";
import { indexedDBModule } from "./indexeddb.js";
import { WorkerClass, SharedWorkerClass } from "./worker.js";
import { windowFetch, eventSourceClass } from "./fetch.js";
import { ImageBitmap, createImageBitmap } from "./image-bitmap.js";
import { URL as AppURL, URLSearchParams as AppURLSearchParams } from "./url.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const KIND_OF_TAG = { span: "box", img: "image", input: "input", textarea: "input", svg: "svg" };

// A `<canvas>` made here draws nothing: libraries such as lottie-web make one at load to probe.
const metrics = { width: 0, actualBoundingBoxLeft: 0, actualBoundingBoxRight: 0, actualBoundingBoxAscent: 0, actualBoundingBoxDescent: 0, fontBoundingBoxAscent: 0, fontBoundingBoxDescent: 0 };
const pixels = (width = 1, height = 1) => ({ width, height, data: new Uint8ClampedArray(Math.max(0, width * height * 4)) });
const inert = new Proxy({
  measureText: () => ({ ...metrics }),
  getImageData: (_x, _y, width, height) => pixels(width, height),
  createImageData: (width, height) => pixels(width, height),
  getLineDash: () => [],
  isPointInPath: () => false,
  isPointInStroke: () => false,
}, { get: (target, name) => (name in target ? target[name] : () => {}), set: (target, name, value) => { target[name] = value; return true; } });

// What a tag becomes: `@silkui/core`'s own `createElement` when it has one (HTML tags as
// nodes), else a box, an input, an image or an svg.
function createElement(tag) {
  tag = String(tag).toLowerCase();
  const Custom = customTags.get(tag);
  if (Custom) return new Custom();
  const html = exported("createElement");
  if (typeof html === "function") {
    const node = html(tag);
    // A 2d context the host cannot draw draws nothing, rather than failing a library's probe.
    if (tag === "canvas" && typeof node.getContext === "function") {
      const context = node.getContext;
      node.getContext = function (type, ...rest) {
        return context.call(this, type, ...rest) ?? (type === "2d" ? inert : null);
      };
    }
    return node;
  }
  if (tag === "canvas") return { localName: tag, width: 300, height: 150, style: {}, getContext: () => inert };
  const node = createNode(KIND_OF_TAG[tag] ?? "box");
  if (!("localName" in node)) Object.defineProperty(node, "localName", { value: tag, configurable: true });
  return node;
}

const global = globalThis;
// Custom element classes by tag, and tags by class (see `customElements` below).
const customTags = new Map();
const customClasses = new Map();
const customWaits = new Map();
// An export `@silkui/core` may have, read by name so a build without it does not warn.
const exported = (name) => core[name];

// An event target outside the tree (the document and the window). The dispatcher runs its
// listeners after the root's as `_run`, and `dispatchEvent` sends an event to it alone.
class OuterTarget {
  #listeners = new Map();

  addEventListener(type, listener, options) {
    if (listener == null || options?.signal?.aborted) return;
    const capture = options === true || !!options?.capture;
    let list = this.#listeners.get(type);
    if (!list) this.#listeners.set(type, (list = []));
    if (list.some((entry) => entry.listener === listener && entry.capture === capture)) return;
    list.push({ listener, capture, once: !!options?.once });
    if (list.length === 1) this._listening(type, true);
    options?.signal?.addEventListener("abort", () => this.removeEventListener(type, listener, capture), { once: true });
  }

  removeEventListener(type, listener, options) {
    const list = this.#listeners.get(type);
    if (!list) return;
    const capture = options === true || !!options?.capture;
    const index = list.findIndex((entry) => entry.listener === listener && entry.capture === capture);
    if (index < 0) return;
    list.splice(index, 1);
    if (list.length === 0) this._listening(type, false);
  }

  _listening(type, on) {
    relay(type, on);
  }

  _has(type) {
    return (this.#listeners.get(type)?.length ?? 0) > 0;
  }

  _run(event, capture) {
    const list = this.#listeners.get(event.type);
    if (!list) return;
    for (const entry of list.slice()) {
      if (event._immediate) return;
      if (entry.capture !== capture) continue;
      if (entry.once) this.removeEventListener(event.type, entry.listener, entry.capture);
      try {
        if (typeof entry.listener === "function") entry.listener.call(this === windowTarget ? global : this, event);
        else entry.listener.handleEvent(event);
      } catch (error) {
        global.reportError?.(error);
      }
    }
    // `onresize`, `onkeydown` and the rest, as handler properties.
    const handler = (this === windowTarget ? global : this)["on" + event.type];
    if (!capture && typeof handler === "function" && !event._immediate) {
      try {
        handler.call(this === windowTarget ? global : this, event);
      } catch (error) {
        global.reportError?.(error);
      }
    }
  }

  // An event for this target alone, as `window.dispatchEvent(new Event("storage"))`.
  dispatchEvent(event) {
    if (typeof event?.type !== "string") throw new TypeError("dispatchEvent takes an Event");
    const self = this === windowTarget ? global : this;
    let stopped = false;
    const set = (name, value) => {
      try {
        if (Object.getOwnPropertyDescriptor(event, name)?.writable !== false) event[name] = value;
      } catch {}
      if (event[name] !== value) Object.defineProperty(event, name, { value, writable: true, configurable: true });
    };
    if (!("_immediate" in event)) {
      const stopNow = event.stopImmediatePropagation;
      Object.defineProperty(event, "_immediate", { get: () => stopped, configurable: true });
      Object.defineProperty(event, "stopImmediatePropagation", { value() { stopped = true; stopNow?.call(event); }, configurable: true });
    }
    set("target", self);
    set("currentTarget", self);
    set("eventPhase", 2);
    this._run(event, true);
    this._run(event, false);
    set("currentTarget", null);
    set("eventPhase", 0);
    return !event.defaultPrevented;
  }
}

// A document or window listener for a tree event needs the tree to send that event: the root
// listens for it with a listener that does nothing.
const relayed = new Map();
const nothing = () => {};
function relay(type, on) {
  if (type === "resize") return watchSize(on);
  const count = (relayed.get(type) ?? 0) + (on ? 1 : -1);
  relayed.set(type, count);
  if (on && count === 1) documentElement.addEventListener(type, nothing);
  if (!on && count === 0) documentElement.removeEventListener(type, nothing);
}

const windowTarget = new OuterTarget();

// `<html>` is the tree's root, the size of the window; `<body>` fills it, as a page's does
// with `height: 100%`. `<head>` comes first and shows nothing, as a page's.
const documentElement = createElement("html");
documentElement.style.set({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 });
const head = createElement("head");
head.style.set({ display: "none" });
const body = createElement("body");
documentElement.appendChild(head);
documentElement.appendChild(body);

// Text a `<title>` would hold. The window's title is the host's.
let title = "";

class Document extends OuterTarget {
  get documentElement() { return documentElement; }
  get head() { return head; }
  get body() { return body; }
  get defaultView() { return global; }
  get ownerDocument() { return null; }
  get nodeType() { return 9; }
  get nodeName() { return "#document"; }
  get readyState() { return "complete"; }
  get visibilityState() { return "visible"; }
  get hidden() { return false; }
  get compatMode() { return "CSS1Compat"; }
  get characterSet() { return "UTF-8"; }
  get contentType() { return "text/html"; }
  get location() { return location; }
  get URL() { return location.href; }
  get documentURI() { return location.href; }
  get baseURI() { return location.href; }
  get referrer() { return ""; }
  get cookie() { return ""; }
  set cookie(_) {}
  get title() { return title; }
  set title(value) { title = String(value); }
  get dir() { return documentElement.getAttribute("dir") ?? ""; }
  set dir(value) { documentElement.setAttribute("dir", value); }
  get scrollingElement() { return documentElement; }
  get fullscreenElement() { return null; }
  get pointerLockElement() { return null; }
  get childNodes() { return [documentElement]; }
  get firstChild() { return documentElement; }
  get lastChild() { return documentElement; }
  get children() { return [documentElement]; }
  get firstElementChild() { return documentElement; }
  get isConnected() { return true; }

  /** The focused node, else `<body>`, as `document.activeElement` is. */
  get activeElement() {
    const focused = exported("activeElement");
    return (typeof focused === "function" ? focused() : documentElement.querySelector(":focus")) ?? body;
  }

  hasFocus() { return true; }
  createElement(tag) { return createElement(tag); }
  createElementNS(namespace, tag) {
    return namespace === SVG_NAMESPACE ? createSvgElement(tag) : createElement(tag);
  }
  createTextNode(data) { return createText(data); }
  // A comment holds nothing a tree can show: an empty text node stands in for one.
  createComment() { return createText(""); }
  createDocumentFragment() { return createDocumentFragment(); }
  createRange() { return createRange(); }
  createEvent() { return new global.Event(""); }
  createTreeWalker(rootNode, whatToShow = 0xffffffff, filter = null) { return new TreeWalker(rootNode, whatToShow, filter); }
  getSelection() { return getSelection(); }
  getElementById(id) {
    if (!id) return null;
    return documentElement.querySelector("#" + cssEscape(String(id)));
  }
  querySelector(selector) {
    return documentElement.matches(selector) ? documentElement : documentElement.querySelector(selector);
  }
  querySelectorAll(selector) {
    const found = documentElement.querySelectorAll(selector);
    return documentElement.matches(selector) ? [documentElement, ...found] : found;
  }
  getElementsByTagName(tag) {
    return tag === "*" ? documentElement.querySelectorAll("*") : this.querySelectorAll(String(tag));
  }
  getElementsByClassName(names) {
    const selector = String(names).trim().split(/\s+/).filter(Boolean).map((name) => "." + cssEscape(name)).join("");
    return selector ? documentElement.querySelectorAll(selector) : [];
  }
  getElementsByName(name) {
    return documentElement.querySelectorAll(`[name="${String(name).replace(/["\\]/g, "\\$&")}"]`);
  }
  contains(node) { return node === this || documentElement.contains(node); }
  elementFromPoint(x, y) { return elementFromPoint(x, y); }
  elementsFromPoint(x, y) { return elementsFromPoint(x, y); }
  caretPositionFromPoint(x, y) { return caretPositionFromPoint(x, y); }
  caretRangeFromPoint(x, y) {
    const position = caretPositionFromPoint(x, y);
    if (!position) return null;
    const range = createRange();
    range.setStart(position.offsetNode, position.offset);
    return range;
  }
  get styleSheets() { return []; }
  get adoptedStyleSheets() { return documentElement.adoptedStyleSheets ?? []; }
  set adoptedStyleSheets(sheets) { documentElement.adoptedStyleSheets = sheets; }
  get currentScript() { return null; }
  get implementation() { return implementation; }
  importNode(node, deep) { return node.cloneNode(deep); }
  adoptNode(node) { node.remove?.(); return node; }
  exitFullscreen() { return Promise.resolve(); }
  exitPointerLock() {}
  execCommand(command, showUI, value) {
    const run = exported("execCommand");
    return typeof run === "function" ? run(command, showUI, value) : false;
  }
  queryCommandSupported(command) { return !!exported("queryCommandSupported")?.(command); }
  queryCommandEnabled(command) { return !!exported("queryCommandEnabled")?.(command); }
  queryCommandState(command) { return !!exported("queryCommandState")?.(command); }
  queryCommandIndeterm(command) { return !!exported("queryCommandIndeterm")?.(command); }
  queryCommandValue(command) { return exported("queryCommandValue")?.(command) ?? ""; }
  // The fonts the app's style sheets load are the host's, ready before the first frame.
  get fonts() { return fonts; }
}

const implementation = {
  hasFeature: () => true,
  createHTMLDocument: () => documentTarget,
  createDocument: () => documentTarget,
};

const fonts = Object.assign(new OuterTarget(), {
  status: "loaded",
  ready: Promise.resolve(),
  check: () => true,
  load: () => Promise.resolve([]),
  add() {},
  delete: () => false,
  clear() {},
  forEach() {},
  [Symbol.iterator]: function* () {},
});
fonts.ready = Promise.resolve(fonts);
fonts._listening = () => {};


// `document.createTreeWalker`, over the nodes' child lists.
class TreeWalker {
  constructor(rootNode, whatToShow, filter) {
    this.root = rootNode;
    this.whatToShow = whatToShow;
    this.filter = filter;
    this.currentNode = rootNode;
  }
  #accepts(node) {
    const bit = 1 << ((node.nodeType ?? 1) - 1);
    if (!(this.whatToShow & bit)) return false;
    if (!this.filter) return true;
    const answer = typeof this.filter === "function" ? this.filter(node) : this.filter.acceptNode(node);
    return answer === 1;
  }
  nextNode() {
    let node = this.currentNode;
    for (;;) {
      if (node.childNodes?.length) node = node.childNodes[0];
      else {
        while (node && node !== this.root && !node.nextSibling) node = node.parentNode;
        if (!node || node === this.root) return null;
        node = node.nextSibling;
      }
      if (this.#accepts(node)) return (this.currentNode = node);
    }
  }
  parentNode() {
    for (let node = this.currentNode; node && node !== this.root; ) {
      node = node.parentNode;
      if (node && this.#accepts(node)) return (this.currentNode = node);
    }
    return null;
  }
  firstChild() {
    const node = this.currentNode.childNodes?.find((child) => this.#accepts(child));
    return node ? (this.currentNode = node) : null;
  }
  nextSibling() {
    for (let node = this.currentNode.nextSibling; node; node = node.nextSibling) if (this.#accepts(node)) return (this.currentNode = node);
    return null;
  }
  previousSibling() {
    for (let node = this.currentNode.previousSibling; node; node = node.previousSibling) if (this.#accepts(node)) return (this.currentNode = node);
    return null;
  }
}

const documentTarget = new Document();
const location = new Location(global.__silkLocation ?? "http://localhost/", documentTarget);
const history = new History(location, windowTarget);

// The window's size is the root's, read after any pending layout. A `resize` listener gets the
// root's size changes through a ResizeObserver.
let sizeWatcher = null;
let sizeListeners = 0;
function watchSize(on) {
  sizeListeners += on ? 1 : -1;
  if (on && !sizeWatcher) {
    let first = true;
    sizeWatcher = new ResizeObserver(() => {
      // A ResizeObserver reports the size it starts at; a window has not resized then.
      if (first) { first = false; return; }
      windowTarget.dispatchEvent(new global.Event("resize"));
    });
    sizeWatcher.observe(documentElement);
  } else if (!on && sizeListeners === 0 && sizeWatcher) {
    sizeWatcher.disconnect();
    sizeWatcher = null;
  }
}

// Every element and text node belongs to the one document.
for (const prototype of [CoreNode.prototype, SvgElement.prototype, SvgText.prototype]) {
  if (!("ownerDocument" in prototype)) Object.defineProperty(prototype, "ownerDocument", { get: () => documentTarget, configurable: true });
  if (!("getRootNode" in prototype)) {
    Object.defineProperty(prototype, "getRootNode", {
      value() {
        let node = this;
        while (node.parentNode) node = node.parentNode;
        return node === documentElement ? documentTarget : node;
      },
      writable: true,
      configurable: true,
    });
  }
}
// `parentElement`, `children` and the element siblings, which DOM libraries walk by.
const isElement = (node) => node != null && node.nodeType === 1;
const elementProperties = {
  parentElement: { get() { const parent = this.parentNode; return isElement(parent) ? parent : null; } },
  children: { get() { return (this.childNodes ?? []).filter(isElement); } },
  childElementCount: { get() { return (this.childNodes ?? []).filter(isElement).length; } },
  firstElementChild: { get() { return (this.childNodes ?? []).find(isElement) ?? null; } },
  lastElementChild: { get() { return (this.childNodes ?? []).findLast(isElement) ?? null; } },
  nextElementSibling: { get() { let node = this.nextSibling; while (node && !isElement(node)) node = node.nextSibling; return node ?? null; } },
  previousElementSibling: { get() { let node = this.previousSibling; while (node && !isElement(node)) node = node.previousSibling; return node ?? null; } },
};
for (const [name, descriptor] of Object.entries(elementProperties)) {
  if (!(name in CoreNode.prototype)) Object.defineProperty(CoreNode.prototype, name, { ...descriptor, configurable: true });
}
// The document is above `<html>`: `parentNode` stays null for the tree, but walks that ask for
// the owner's node find it.
if (!("blur" in CoreNode.prototype)) {
  Object.defineProperty(CoreNode.prototype, "blur", {
    value() { if (documentTarget.activeElement === this) documentElement.focus(); },
    writable: true,
    configurable: true,
  });
}

// The rest of the element surface DOM libraries call: tree edits by position, reflected
// attributes, comparisons and the calls a tree answers trivially.
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml";
// Nodes for `append`-style calls: strings become text, fragments give their children.
function nodesOf(items) {
  const nodes = [];
  for (const item of items) {
    if (item == null || typeof item !== "object") nodes.push(createText(String(item)));
    else if (item.nodeType === 11) nodes.push(...item.childNodes);
    else nodes.push(item);
  }
  return nodes;
}
const reflect = (name) => ({
  get() { return this.getAttribute(name) ?? ""; },
  set(value) { this.setAttribute(name, String(value)); },
});
const flag = (name) => ({
  get() { return this.hasAttribute(name); },
  set(value) { if (value) this.setAttribute(name, ""); else this.removeAttribute(name); },
});
const treeMethods = {
  before(...items) {
    const parent = this.parentNode;
    if (parent) for (const node of nodesOf(items)) parent.insertBefore(node, this);
  },
  after(...items) {
    const parent = this.parentNode;
    if (!parent) return;
    const next = this.nextSibling;
    for (const node of nodesOf(items)) parent.insertBefore(node, next);
  },
  replaceWith(...items) {
    const parent = this.parentNode;
    if (!parent) return;
    const nodes = nodesOf(items).filter((node) => node !== this);
    const next = this.nextSibling;
    this.remove();
    for (const node of nodes) parent.insertBefore(node, next && next.parentNode === parent ? next : null);
  },
  compareDocumentPosition(other) {
    if (other === this) return 0;
    const chain = (node) => { const list = []; for (; node; node = node.parentNode) list.unshift(node); return list; };
    const mine = chain(this);
    const theirs = chain(other);
    if (mine[0] !== theirs[0]) return 1 | 32 | (mine[0] === documentElement ? 4 : 2);
    let depth = 0;
    while (mine[depth] === theirs[depth]) depth++;
    if (depth === mine.length) return 16 | 4;
    if (depth === theirs.length) return 8 | 2;
    const siblings = mine[depth - 1].childNodes;
    return siblings.indexOf(theirs[depth]) > siblings.indexOf(mine[depth]) ? 4 : 2;
  },
  isSameNode(other) { return other === this; },
  isEqualNode(other) {
    if (!other || other.nodeType !== this.nodeType) return false;
    if (this.nodeType === 3) return other.data === this.data;
    return other.outerHTML === this.outerHTML;
  },
  lookupNamespaceURI() { return null; },
};
for (const prototype of [CoreNode.prototype, SvgElement.prototype, SvgText.prototype]) {
  for (const [name, value] of Object.entries(treeMethods)) {
    if (!(name in prototype)) Object.defineProperty(prototype, name, { value, writable: true, configurable: true });
  }
}
const elementMethods = {
  prepend(...items) {
    const first = this.firstChild ?? this.childNodes?.[0] ?? null;
    for (const node of nodesOf(items)) this.insertBefore(node, first);
  },
  replaceChildren(...items) {
    const nodes = nodesOf(items);
    for (const child of [...this.childNodes]) if (!nodes.includes(child)) child.remove();
    for (const node of nodes) this.appendChild(node);
  },
  toggleAttribute(name, force) {
    const on = force === undefined ? !this.hasAttribute(name) : Boolean(force);
    if (on) { if (!this.hasAttribute(name)) this.setAttribute(name, ""); } else if (this.hasAttribute(name)) this.removeAttribute(name);
    return on;
  },
  hasAttributes() { return this.getAttributeNames().length > 0; },
  getAttributeNS(_namespace, name) { return this.getAttribute(name); },
  setAttributeNS(_namespace, name, value) { this.setAttribute(String(name).replace(/^[^:]*:/, (prefix) => prefix === "xlink:" ? prefix : ""), value); },
  removeAttributeNS(_namespace, name) { this.removeAttribute(name); },
  hasAttributeNS(_namespace, name) { return this.hasAttribute(name); },
  getElementsByTagName(tag) { return this.querySelectorAll(tag === "*" ? "*" : String(tag)); },
  getElementsByClassName(names) {
    const selector = String(names).trim().split(/\s+/).filter(Boolean).map((name) => "." + cssEscape(name)).join("");
    return selector ? this.querySelectorAll(selector) : [];
  },
  insertAdjacentElement(where, node) {
    switch (String(where).toLowerCase()) {
      case "beforebegin": this.before(node); break;
      case "afterbegin": this.prepend(node); break;
      case "beforeend": this.append(node); break;
      case "afterend": this.after(node); break;
      default: throw new SyntaxError("insertAdjacent takes beforebegin, afterbegin, beforeend or afterend, not " + where);
    }
    return node;
  },
  insertAdjacentText(where, text) { this.insertAdjacentElement(where, createText(String(text))); },
  insertAdjacentHTML(where, html) {
    const holder = createElement("div");
    holder.innerHTML = String(html);
    const fragment = createDocumentFragment();
    for (const child of [...holder.childNodes]) fragment.appendChild(child);
    this.insertAdjacentElement(where, fragment);
  },
  click() {
    if (isControlDisabled(this)) return;
    const MouseEventClass = global.MouseEvent ?? global.Event;
    const event = new MouseEventClass("click", { bubbles: true, cancelable: true, composed: true });
    this.dispatchEvent(event);
    if (!event.defaultPrevented && typeof this._activate === "function") this._activate();
  },
  // Animations run to their end at once: the end state is the app's style, so nothing waits.
  animate(_keyframes, options) {
    const animation = new FinishedAnimation(this, options);
    queueMicrotask(() => animation._end());
    return animation;
  },
  getAnimations() { return []; },
  // A shadow root is a part of the element's own tree here: what goes in it shows inside.
  attachShadow() {
    if (this._shadowRoot) throw domError("NotSupportedError", "the element already has a shadow root");
    const shadow = createElement("div");
    shadow.style.set?.({ display: "contents" });
    Object.defineProperty(shadow, "host", { value: this, configurable: true });
    Object.defineProperty(this, "_shadowRoot", { value: shadow, configurable: true });
    this.prepend(shadow);
    return shadow;
  },
  showPopover() {
    if (this._popoverOpen) return;
    this._popoverOpen = true;
    this.hidden = false;
    const Toggle = global.ToggleEvent ?? global.Event;
    this.dispatchEvent(new Toggle("toggle", { bubbles: false, oldState: "closed", newState: "open" }));
  },
  hidePopover() {
    if (!this._popoverOpen) return;
    this._popoverOpen = false;
    this.hidden = true;
    const Toggle = global.ToggleEvent ?? global.Event;
    this.dispatchEvent(new Toggle("toggle", { bubbles: false, oldState: "open", newState: "closed" }));
  },
  togglePopover(force) {
    const show = force === undefined ? !this._popoverOpen : Boolean(force);
    if (show) this.showPopover();
    else this.hidePopover();
    return Boolean(this._popoverOpen);
  },
  show() {
    this._modal = false;
    this.open = true;
  },
  showModal() {
    this._modal = true;
    this.open = true;
  },
  close(returnValue) {
    if (!this.open) return;
    if (returnValue !== undefined) this.returnValue = String(returnValue);
    this._modal = false;
    this.open = false;
    queueMicrotask(() => this.dispatchEvent(new global.Event("close", { bubbles: false })));
  },
  checkVisibility() { return this.isConnected && this.getClientRects?.().length !== 0; },
  requestFullscreen() { return Promise.reject(domError("NotSupportedError", "a Silk UI element cannot go full screen")); },
  requestPointerLock() { return Promise.resolve(); },
};
const elementProperties2 = {
  textContent: {
    get() { let text = ""; for (const child of this.childNodes ?? []) if (child.nodeType !== 8) text += child.textContent ?? ""; return text; },
    set(value) { for (const child of [...(this.childNodes ?? [])]) child.remove(); const text = value == null ? "" : String(value); if (text) this.appendChild(createText(text)); },
  },
  innerText: {
    get() { return this.textContent; },
    set(value) { this.textContent = value; },
  },
  outerText: {
    get() { return this.textContent; },
  },
  nodeValue: { get() { return null; }, set() {} },
  namespaceURI: { get() { return this instanceof SvgElement || this instanceof Svg ? SVG_NAMESPACE : HTML_NAMESPACE; } },
  prefix: { get() { return null; } },
  attributes: {
    get() {
      const list = this.getAttributeNames().map((name) => ({ name, localName: name, value: this.getAttribute(name), namespaceURI: null, prefix: null, specified: true }));
      return Object.assign(list, {
        getNamedItem: (name) => list.find((item) => item.name === name) ?? null,
        item: (index) => list[index] ?? null,
      });
    },
  },
  shadowRoot: { get() { return this._shadowRoot ?? null; } },
  assignedSlot: { get() { return null; } },
  hidden: flag("hidden"),
  inert: flag("inert"),
  autofocus: flag("autofocus"),
  open: flag("open"),
  returnValue: {
    get() { return this._returnValue ?? ""; },
    set(value) { this._returnValue = String(value); },
  },
  title: reflect("title"),
  dir: reflect("dir"),
  lang: reflect("lang"),
  slot: reflect("slot"),
  accessKey: reflect("accesskey"),
  draggable: { get() { return this.getAttribute("draggable") === "true"; }, set(value) { this.setAttribute("draggable", String(Boolean(value))); } },
  spellcheck: { get() { return this.getAttribute("spellcheck") !== "false"; }, set(value) { this.setAttribute("spellcheck", String(Boolean(value))); } },
  translate: { get() { return this.getAttribute("translate") !== "no"; }, set(value) { this.setAttribute("translate", value ? "yes" : "no"); } },
  popover: { get() { return this.getAttribute("popover"); }, set(value) { if (value == null) this.removeAttribute("popover"); else this.setAttribute("popover", String(value)); } },
  part: { get() { return this.classList; } },
};
for (const prototype of [CoreNode.prototype, SvgElement.prototype]) {
  for (const [name, value] of Object.entries(elementMethods)) {
    if (!(name in prototype)) Object.defineProperty(prototype, name, { value, writable: true, configurable: true });
  }
  for (const [name, descriptor] of Object.entries(elementProperties2)) {
    // A read-only one a node sets for itself (as an svg its namespaceURI) becomes its own.
    const set = descriptor.set ?? function (value) { Object.defineProperty(this, name, { value, writable: true, configurable: true }); };
    if (!(name in prototype)) Object.defineProperty(prototype, name, { ...descriptor, set, configurable: true });
  }
}
// Text has its own text; what it lacks of an element's character-data surface.
for (const [name, descriptor] of Object.entries({
  wholeText: { get() { return this.data ?? this.textContent ?? ""; } },
})) {
  if (!(name in CoreText.prototype)) Object.defineProperty(CoreText.prototype, name, { ...descriptor, configurable: true });
}

class FinishedAnimation extends OuterTarget {
  constructor(effectTarget, options) {
    super();
    this.effect = { target: effectTarget, getTiming: () => ({ ...(typeof options === "number" ? { duration: options } : options) }) };
    this.id = typeof options === "object" && options?.id ? String(options.id) : "";
    this.playState = "running";
    this.currentTime = 0;
    this.startTime = 0;
    this.playbackRate = 1;
    this.pending = false;
    this.onfinish = null;
    this.oncancel = null;
    this.finished = new Promise((resolve) => { this._resolve = resolve; });
    this.ready = Promise.resolve(this);
  }
  _end() {
    if (this.playState !== "running") return;
    this.playState = "finished";
    this._resolve(this);
    const event = new global.Event("finish");
    this.onfinish?.(event);
    this.dispatchEvent(event);
  }
  finish() { this._end(); }
  cancel() {
    if (this.playState === "idle") return;
    this.playState = "idle";
    const event = new global.Event("cancel");
    this.oncancel?.(event);
    this.dispatchEvent(event);
  }
  play() {}
  pause() {}
  reverse() {}
  persist() {}
  commitStyles() {}
  updatePlaybackRate(rate) { this.playbackRate = rate; }
}

function domError(name, message) {
  return global.DOMException ? new global.DOMException(message, name) : Object.assign(new Error(message), { name });
}

// Classes for `instanceof`, by what a node is. Their prototypes are the nodes', so a library
// that adds to `HTMLElement.prototype` adds to every node.
// Node.ELEMENT_NODE and the rest, on every node interface and on nodes themselves.
const NODE_TYPES = {
  ELEMENT_NODE: 1, ATTRIBUTE_NODE: 2, TEXT_NODE: 3, CDATA_SECTION_NODE: 4, PROCESSING_INSTRUCTION_NODE: 7,
  COMMENT_NODE: 8, DOCUMENT_NODE: 9, DOCUMENT_TYPE_NODE: 10, DOCUMENT_FRAGMENT_NODE: 11,
};
function defineNodeTypes(target) {
  for (const [key, value] of Object.entries(NODE_TYPES)) if (!Object.hasOwn(target, key)) Object.defineProperty(target, key, { value });
}

function nodeClass(name, prototype, test) {
  const Class = function () { throw new TypeError("Illegal constructor: make a " + name + " with document.createElement"); };
  defineNodeTypes(Class);
  defineNodeTypes(prototype);
  Object.defineProperty(Class, "name", { value: name });
  Object.defineProperty(Class, "prototype", { value: prototype, writable: false });
  Object.defineProperty(Class, Symbol.hasInstance, { value: (value) => value != null && typeof value === "object" && test(value) });
  return Class;
}
// Custom elements: `class X extends HTMLElement` makes a node of the tag it is defined as,
// with X's prototype. Connection and observed attributes reach its callbacks through a
// MutationObserver on the document, so they come a microtask after the change.
let customWatcher = null;
function customElementBase(Base) {
  const HTMLElement = function HTMLElement() {
    const tag = new.target && customClasses.get(new.target);
    if (!tag) return Base();
    const node = createElement("div");
    Object.defineProperty(node, "localName", { value: tag, configurable: true });
    Object.defineProperty(node, "tagName", { value: tag.toUpperCase(), configurable: true });
    Object.setPrototypeOf(node, new.target.prototype);
    watchCustom(node, new.target);
    return node;
  };
  Object.defineProperty(HTMLElement, "prototype", { value: CoreNode.prototype, writable: false });
  Object.defineProperty(HTMLElement, Symbol.hasInstance, { value: (value) => Base[Symbol.hasInstance](value) });
  return HTMLElement;
}
function watchCustom(node, Class) {
  customWatcher ??= new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        const node = record.target;
        node.attributeChangedCallback?.(record.attributeName, record.oldValue, node.getAttribute(record.attributeName));
        continue;
      }
      for (const added of record.addedNodes) forCustom(added, (node) => node.isConnected && connect(node, true));
      for (const removed of record.removedNodes) forCustom(removed, (node) => !node.isConnected && connect(node, false));
    }
  });
  customWatcher.observe(documentElement, { childList: true, subtree: true });
  const observed = Class.observedAttributes;
  if (Array.isArray(observed) && observed.length && typeof node.attributeChangedCallback === "function") {
    customWatcher.observe(node, { attributes: true, attributeOldValue: true, attributeFilter: observed.map(String) });
  }
}
const connected = new WeakSet();
function connect(node, on) {
  if (on === connected.has(node)) return;
  if (on) { connected.add(node); node.connectedCallback?.(); } else { connected.delete(node); node.disconnectedCallback?.(); }
}
function forCustom(node, run) {
  if (node == null || node.nodeType !== 1) return;
  if (customClasses.has(node.constructor)) run(node);
  for (const child of node.childNodes ?? []) forCustom(child, run);
}
const customElements = {
  define(name, Class, _options) {
    name = String(name);
    if (!/^[a-z][a-z0-9._]*-[a-z0-9._-]*$/.test(name)) throw domError("SyntaxError", "'" + name + "' is not a valid custom element name");
    if (customTags.has(name)) throw domError("NotSupportedError", "'" + name + "' is already defined");
    customTags.set(name, Class);
    customClasses.set(Class, name);
    customWaits.get(name)?.resolve(Class);
  },
  get: (name) => customTags.get(String(name)),
  getName: (Class) => customClasses.get(Class) ?? null,
  whenDefined(name) {
    name = String(name);
    if (customTags.has(name)) return Promise.resolve(customTags.get(name));
    let wait = customWaits.get(name);
    if (!wait) {
      let resolve;
      const promise = new Promise((done) => { resolve = done; });
      customWaits.set(name, wait = { promise, resolve });
    }
    return wait.promise;
  },
  upgrade() {},
};

const isSvg = (value) => value instanceof Svg || value instanceof SvgElement;
const isTreeElement = (value) => value instanceof CoreNode && value.nodeType === 1;
const isHtml = (value) => isTreeElement(value) && !(value instanceof Svg);
const tagIs = (...tags) => (value) => isHtml(value) && tags.includes(value.localName);
const classes = {
  EventTarget: null,
  Node: nodeClass("Node", CoreNode.prototype, (value) => value instanceof CoreNode || value instanceof SvgElement || value instanceof SvgText || value === documentTarget),
  Element: nodeClass("Element", CoreNode.prototype, (value) => isTreeElement(value) || value instanceof SvgElement),
  HTMLElement: customElementBase(nodeClass("HTMLElement", CoreNode.prototype, isHtml)),
  SVGElement: nodeClass("SVGElement", SvgElement.prototype, isSvg),
  SVGSVGElement: nodeClass("SVGSVGElement", Svg.prototype, (value) => value instanceof Svg),
  CharacterData: nodeClass("CharacterData", CoreText.prototype, (value) => value instanceof CoreText || value instanceof SvgText),
  Text: nodeClass("Text", CoreText.prototype, (value) => value instanceof CoreText || value instanceof SvgText),
  Comment: nodeClass("Comment", CoreText.prototype, () => false),
  Document: nodeClass("Document", Document.prototype, (value) => value === documentTarget),
  HTMLDocument: nodeClass("HTMLDocument", Document.prototype, (value) => value === documentTarget),
  DocumentFragment: CoreFragment,
  ShadowRoot: nodeClass("ShadowRoot", CoreFragment.prototype, () => false),
  HTMLInputElement: nodeClass("HTMLInputElement", Input.prototype, (value) => (value instanceof Input && value.localName !== "textarea") || value instanceof CheckInput || value instanceof RangeInput || value instanceof ColorInput || value instanceof FileInput || value instanceof ButtonInput || value instanceof HiddenInput),
  HTMLTextAreaElement: nodeClass("HTMLTextAreaElement", Input.prototype, (value) => value instanceof Input && value.localName === "textarea"),
  HTMLImageElement: nodeClass("HTMLImageElement", CoreImage.prototype, (value) => value instanceof CoreImage),
  HTMLCanvasElement: nodeClass("HTMLCanvasElement", Canvas.prototype, (value) => value instanceof Canvas),
  HTMLDivElement: nodeClass("HTMLDivElement", CoreNode.prototype, tagIs("div")),
  HTMLSpanElement: nodeClass("HTMLSpanElement", CoreNode.prototype, tagIs("span")),
  HTMLButtonElement: nodeClass("HTMLButtonElement", ButtonElement.prototype, (value) => value instanceof ButtonElement || tagIs("button")(value)),
  HTMLAnchorElement: nodeClass("HTMLAnchorElement", CoreNode.prototype, tagIs("a")),
  HTMLLabelElement: nodeClass("HTMLLabelElement", LabelElement.prototype, (value) => value instanceof LabelElement || tagIs("label")(value)),
  HTMLFormElement: nodeClass("HTMLFormElement", FormElement.prototype, (value) => value instanceof FormElement || tagIs("form")(value)),
  HTMLSelectElement: nodeClass("HTMLSelectElement", SelectElement.prototype, (value) => value instanceof SelectElement || tagIs("select")(value)),
  HTMLOptionElement: nodeClass("HTMLOptionElement", OptionElement.prototype, (value) => value instanceof OptionElement || tagIs("option")(value)),
  HTMLOptGroupElement: nodeClass("HTMLOptGroupElement", OptGroupElement.prototype, (value) => value instanceof OptGroupElement || tagIs("optgroup")(value)),
  HTMLFieldSetElement: nodeClass("HTMLFieldSetElement", FieldSetElement.prototype, (value) => value instanceof FieldSetElement || tagIs("fieldset")(value)),
  HTMLProgressElement: nodeClass("HTMLProgressElement", ProgressElement.prototype, (value) => value instanceof ProgressElement || tagIs("progress")(value)),
  HTMLMeterElement: nodeClass("HTMLMeterElement", MeterElement.prototype, (value) => value instanceof MeterElement || tagIs("meter")(value)),
  HTMLOutputElement: nodeClass("HTMLOutputElement", OutputElement.prototype, (value) => value instanceof OutputElement || tagIs("output")(value)),
  HTMLIFrameElement: nodeClass("HTMLIFrameElement", CoreNode.prototype, tagIs("iframe")),
  HTMLVideoElement: nodeClass("HTMLVideoElement", CoreNode.prototype, tagIs("video")),
  HTMLMediaElement: nodeClass("HTMLMediaElement", CoreNode.prototype, tagIs("video", "audio")),
  HTMLBodyElement: nodeClass("HTMLBodyElement", CoreNode.prototype, (value) => value === body),
  HTMLHtmlElement: nodeClass("HTMLHtmlElement", CoreNode.prototype, (value) => value === documentElement),
  HTMLHeadElement: nodeClass("HTMLHeadElement", CoreNode.prototype, (value) => value === head),
  HTMLTemplateElement: nodeClass("HTMLTemplateElement", CoreNode.prototype, tagIs("template")),
  HTMLStyleElement: nodeClass("HTMLStyleElement", CoreNode.prototype, tagIs("style")),
  HTMLDetailsElement: nodeClass("HTMLDetailsElement", CoreNode.prototype, tagIs("details")),
  HTMLDialogElement: nodeClass("HTMLDialogElement", CoreNode.prototype, tagIs("dialog")),
};
// The other HTML interfaces, by the tags they cover, for `instanceof` tests.
for (const [name, tags] of Object.entries({
  HTMLLegendElement: ["legend"], HTMLDataListElement: ["datalist"],
  HTMLParagraphElement: ["p"], HTMLHeadingElement: ["h1", "h2", "h3", "h4", "h5", "h6"], HTMLPreElement: ["pre", "listing", "xmp"],
  HTMLQuoteElement: ["blockquote", "q"], HTMLHRElement: ["hr"], HTMLUListElement: ["ul"], HTMLOListElement: ["ol"],
  HTMLLIElement: ["li"], HTMLDListElement: ["dl"], HTMLMenuElement: ["menu"], HTMLTableElement: ["table"],
  HTMLTableCaptionElement: ["caption"], HTMLTableSectionElement: ["thead", "tbody", "tfoot"], HTMLTableRowElement: ["tr"],
  HTMLTableCellElement: ["td", "th"], HTMLTableColElement: ["col", "colgroup"], HTMLAudioElement: ["audio"],
  HTMLSourceElement: ["source"], HTMLTrackElement: ["track"], HTMLPictureElement: ["picture"], HTMLMapElement: ["map"],
  HTMLAreaElement: ["area"], HTMLEmbedElement: ["embed"], HTMLObjectElement: ["object"], HTMLTimeElement: ["time"],
  HTMLDataElement: ["data"], HTMLModElement: ["ins", "del"], HTMLSlotElement: ["slot"], HTMLScriptElement: ["script"],
  HTMLLinkElement: ["link"], HTMLMetaElement: ["meta"], HTMLTitleElement: ["title"], HTMLBaseElement: ["base"],
})) classes[name] = nodeClass(name, CoreNode.prototype, tagIs(...tags));
for (const target of [CoreFragment, SvgText.prototype]) defineNodeTypes(target);
for (const [name, value] of Object.entries(classes)) {
  if (value && global[name] === undefined) define(name, value);
}

function define(name, value) {
  Object.defineProperty(global, name, { value, writable: true, configurable: true });
}

// `new Image()`, an `<img>` to load.
if (global.Image === undefined) {
  define("Image", function Image(width, height) {
    const image = createElement("img");
    if (width !== undefined) image.style.set({ width });
    if (height !== undefined) image.style.set({ height });
    return image;
  });
}

if (global.Option === undefined) {
  define("Option", function Option(text, value, defaultSelected, selected) {
    return new OptionElement(text, value, defaultSelected, selected);
  });
}
if (global.ValidityState === undefined) define("ValidityState", ValidityState);

for (const [name, value] of Object.entries({ URL: AppURL, URLSearchParams: AppURLSearchParams })) {
  if (global[name] === undefined) define(name, value);
}
for (const [name, value] of Object.entries({
  Range, StaticRange, Selection, DOMRect, ResizeObserver, IntersectionObserver, MutationObserver, getComputedStyle,
  Storage, PopStateEvent, HashChangeEvent, NodeFilter: { FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3, SHOW_ALL: 0xffffffff, SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
})) {
  if (global[name] === undefined) define(name, value);
}
// The UI event classes, for events an app makes and dispatches (`el.dispatchEvent(new
// KeyboardEvent("keydown", { key }))`) and for `instanceof` tests.
const BaseEvent = global.Event;
const uiEventFields = { view: null, detail: 0, which: 0 };
const modifierFields = { altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };
const mouseFields = { ...modifierFields, screenX: 0, screenY: 0, clientX: 0, clientY: 0, pageX: 0, pageY: 0, offsetX: 0, offsetY: 0, movementX: 0, movementY: 0, x: 0, y: 0, button: 0, buttons: 0, relatedTarget: null };
function eventClass(name, Parent, fields) {
  const Class = class extends Parent {
    constructor(type, init = {}) {
      super(type, init);
      for (const [field, fallback] of Object.entries(fields)) {
        if (!Object.prototype.hasOwnProperty.call(this, field)) Object.defineProperty(this, field, { value: init?.[field] ?? fallback, enumerable: true, configurable: true });
      }
    }
  };
  Object.defineProperty(Class, "name", { value: name });
  return Class;
}
const UIEvent = global.UIEvent ?? eventClass("UIEvent", BaseEvent, uiEventFields);
const MouseEvent = global.MouseEvent ?? eventClass("MouseEvent", UIEvent, mouseFields);
if (!MouseEvent.prototype.getModifierState) MouseEvent.prototype.getModifierState = function (key) { return Boolean(this[{ Alt: "altKey", Control: "ctrlKey", Meta: "metaKey", Shift: "shiftKey" }[key]]); };
const KeyboardEvent = global.KeyboardEvent ?? eventClass("KeyboardEvent", UIEvent, { ...modifierFields, key: "", code: "", location: 0, repeat: false, isComposing: false, charCode: 0, keyCode: 0 });
if (!KeyboardEvent.prototype.getModifierState) KeyboardEvent.prototype.getModifierState = MouseEvent.prototype.getModifierState;
const WheelEvent = global.WheelEvent ?? eventClass("WheelEvent", MouseEvent, { deltaX: 0, deltaY: 0, deltaZ: 0, deltaMode: 0 });
for (const [name, value] of [["DOM_DELTA_PIXEL", 0], ["DOM_DELTA_LINE", 1], ["DOM_DELTA_PAGE", 2]]) {
  if (WheelEvent[name] === undefined) Object.defineProperty(WheelEvent, name, { value, enumerable: true });
  if (WheelEvent.prototype[name] === undefined) Object.defineProperty(WheelEvent.prototype, name, { value, enumerable: true });
}
const eventClasses = {
  UIEvent,
  MouseEvent,
  KeyboardEvent,
  FocusEvent: global.FocusEvent ?? eventClass("FocusEvent", UIEvent, { relatedTarget: null }),
  PointerEvent: global.PointerEvent ?? eventClass("PointerEvent", MouseEvent, { pointerId: 0, width: 1, height: 1, pressure: 0, tangentialPressure: 0, tiltX: 0, tiltY: 0, twist: 0, pointerType: "mouse", isPrimary: true }),
  WheelEvent,
  DragEvent: global.DragEvent ?? eventClass("DragEvent", MouseEvent, { dataTransfer: null }),
  InputEvent: global.InputEvent ?? eventClass("InputEvent", UIEvent, { data: null, inputType: "", isComposing: false, dataTransfer: null }),
  TouchEvent: global.TouchEvent ?? eventClass("TouchEvent", UIEvent, { ...modifierFields, touches: [], targetTouches: [], changedTouches: [] }),
  AnimationEvent: global.AnimationEvent ?? eventClass("AnimationEvent", BaseEvent, { animationName: "", elapsedTime: 0, pseudoElement: "" }),
  TransitionEvent: global.TransitionEvent ?? eventClass("TransitionEvent", BaseEvent, { propertyName: "", elapsedTime: 0, pseudoElement: "" }),
  ErrorEvent: global.ErrorEvent ?? eventClass("ErrorEvent", BaseEvent, { message: "", filename: "", lineno: 0, colno: 0, error: null }),
  ProgressEvent: global.ProgressEvent ?? eventClass("ProgressEvent", BaseEvent, { lengthComputable: false, loaded: 0, total: 0 }),
  StorageEvent: global.StorageEvent ?? eventClass("StorageEvent", BaseEvent, { key: null, oldValue: null, newValue: null, url: "", storageArea: null }),
  PageTransitionEvent: global.PageTransitionEvent ?? eventClass("PageTransitionEvent", BaseEvent, { persisted: false }),
  SubmitEvent: global.SubmitEvent ?? eventClass("SubmitEvent", BaseEvent, { submitter: null }),
  FormDataEvent: global.FormDataEvent ?? eventClass("FormDataEvent", BaseEvent, { formData: null }),
  ToggleEvent: global.ToggleEvent ?? eventClass("ToggleEvent", BaseEvent, { oldState: "", newState: "" }),
  CustomEvent: global.CustomEvent ?? eventClass("CustomEvent", BaseEvent, { detail: null }),
};
// The host's events are the runtime's own `Event`s; each answers `instanceof` for the classes
// a browser gives its type.
const POINTER_TYPES = ["pointerdown", "pointerup", "pointermove", "pointerover", "pointerout", "pointerenter", "pointerleave", "pointercancel", "gotpointercapture", "lostpointercapture", "click", "auxclick", "contextmenu"];
const MOUSE_TYPES = [...POINTER_TYPES, "mousedown", "mouseup", "mousemove", "mouseover", "mouseout", "mouseenter", "mouseleave", "dblclick", "wheel", "dragstart", "drag", "dragenter", "dragover", "dragleave", "drop", "dragend"];
const HOST_TYPES = {
  KeyboardEvent: ["keydown", "keyup"],
  MouseEvent: MOUSE_TYPES,
  PointerEvent: POINTER_TYPES,
  WheelEvent: ["wheel"],
  DragEvent: ["dragstart", "drag", "dragenter", "dragover", "dragleave", "drop", "dragend"],
  FocusEvent: ["focus", "blur", "focusin", "focusout"],
  InputEvent: ["input", "beforeinput"],
  TouchEvent: ["touchstart", "touchmove", "touchend", "touchcancel"],
  AnimationEvent: ["animationstart", "animationiteration", "animationend", "animationcancel"],
  TransitionEvent: ["transitionrun", "transitionstart", "transitionend", "transitioncancel"],
  SubmitEvent: ["submit"],
  FormDataEvent: ["formdata"],
};
HOST_TYPES.UIEvent = [...MOUSE_TYPES, "keydown", "keyup", "focus", "blur", "focusin", "focusout", "input", "beforeinput", "touchstart", "touchmove", "touchend", "touchcancel"];
for (const [name, types] of Object.entries(HOST_TYPES)) {
  const Class = eventClasses[name];
  const hosted = new Set(types);
  const own = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(Class, Symbol.hasInstance, {
    value(value) {
      return own.call(this, value) || (value instanceof core.Event && hosted.has(value.type));
    },
    configurable: true,
  });
}
// Every host event is an `Event`, as a page's `load` on an `<img>` is. Subclasses that have no
// rule of their own above inherit this one, so it answers only for `Event` itself.
if (typeof BaseEvent === "function") {
  const own = Function.prototype[Symbol.hasInstance];
  Object.defineProperty(BaseEvent, Symbol.hasInstance, {
    value(value) {
      return own.call(this, value) || (this === BaseEvent && value instanceof core.Event);
    },
    configurable: true,
  });
}
for (const [name, value] of Object.entries(eventClasses)) if (global[name] === undefined) define(name, value);

// Markup to nodes and back: an HTML or SVG string becomes a document whose root is the parsed
// element, as `DOMParser` gives.
class DOMParser {
  parseFromString(markup, type = "text/html") {
    const holder = createElement("div");
    holder.innerHTML = String(markup).replace(/^\s*<\?xml[^>]*\?>/, "").replace(/<!DOCTYPE[^>]*>/i, "");
    const html = !/xml|svg/.test(String(type));
    const rootElement = html ? holder : holder.firstElementChild ?? holder;
    return {
      documentElement: rootElement,
      body: html ? holder : null,
      head: null,
      querySelector: (selector) => holder.querySelector(selector),
      querySelectorAll: (selector) => holder.querySelectorAll(selector),
      getElementsByTagName: (tag) => holder.querySelectorAll(tag),
      getElementById: (id) => holder.querySelector("#" + cssEscape(String(id))),
      createElement: (tag) => createElement(tag),
      importNode: (node, deep) => node.cloneNode(deep),
    };
  }
}
class XMLSerializer {
  serializeToString(node) {
    return node?.outerHTML ?? node?.documentElement?.outerHTML ?? node?.textContent ?? "";
  }
}
// `FileReader` over the runtime's `Blob`.
class FileReader extends OuterTarget {
  static EMPTY = 0;
  static LOADING = 1;
  static DONE = 2;
  readyState = 0;
  result = null;
  error = null;
  onload = null;
  onloadend = null;
  onerror = null;
  onloadstart = null;
  onprogress = null;
  onabort = null;
  #read(blob, as) {
    this.readyState = 1;
    this.#fire("loadstart");
    Promise.resolve()
      .then(async () => {
        if (as === "text") return blob.text();
        const buffer = await blob.arrayBuffer();
        if (as === "buffer") return buffer;
        if (as === "binary") return String.fromCharCode(...new Uint8Array(buffer));
        let binary = "";
        for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
        return "data:" + (blob.type || "application/octet-stream") + ";base64," + btoa(binary);
      })
      .then(
        (result) => { this.result = result; this.readyState = 2; this.#fire("load"); this.#fire("loadend"); },
        (error) => { this.error = error; this.readyState = 2; this.#fire("error"); this.#fire("loadend"); },
      );
  }
  #fire(type) {
    const event = new global.Event(type);
    this["on" + type]?.call(this, event);
    this.dispatchEvent(event);
  }
  readAsText(blob) { this.#read(blob, "text"); }
  readAsArrayBuffer(blob) { this.#read(blob, "buffer"); }
  readAsDataURL(blob) { this.#read(blob, "data"); }
  readAsBinaryString(blob) { this.#read(blob, "binary"); }
  abort() { this.readyState = 2; this.#fire("abort"); }
}
for (const [name, value] of Object.entries({ customElements, DOMParser, XMLSerializer, FileReader, CSSStyleSheet: core.CSSStyleSheet })) {
  if (value && global[name] === undefined) define(name, value);
}
global.isSecureContext ??= true;
if (global.origin === undefined) Object.defineProperty(global, "origin", { get: () => location.origin, configurable: true });
if (global.CSS === undefined) define("CSS", { supports: (...args) => supports(...args), escape: (value) => cssEscape(String(value)) });
global.getSelection ??= getSelection;
global.DOMRectReadOnly ??= DOMRect;

// The window: the global object, its events, its size and where it is.
global.window ??= global;
global.self ??= global;
define("document", documentTarget);
define("location", location);
define("history", history);
if (global.navigation === undefined) define("navigation", new Navigation(history, location));
for (const [name, value] of Object.entries({ Navigation, NavigateEvent, NavigationCurrentEntryChangeEvent, NavigationHistoryEntry })) {
  if (global[name] === undefined) define(name, value);
}
global.top ??= global;
global.parent ??= global;
global.frames ??= global;
global.opener ??= null;
global.frameElement ??= null;
global.name ??= "";
global.closed ??= false;
define("addEventListener", (type, listener, options) => windowTarget.addEventListener(type, listener, options));
define("removeEventListener", (type, listener, options) => windowTarget.removeEventListener(type, listener, options));
define("dispatchEvent", (event) => windowTarget.dispatchEvent(event));
for (const [name, read] of Object.entries({
  innerWidth: () => documentElement.clientWidth,
  innerHeight: () => documentElement.clientHeight,
  outerWidth: () => documentElement.clientWidth,
  outerHeight: () => documentElement.clientHeight,
})) {
  Object.defineProperty(global, name, { get: read, set: (value) => define(name, value), configurable: true });
}
for (const name of ["scrollX", "scrollY", "pageXOffset", "pageYOffset", "screenX", "screenY", "screenLeft", "screenTop"]) global[name] ??= 0;
global.scrollTo ??= () => {};
global.scrollBy ??= () => {};
global.scroll ??= () => {};
global.focus ??= () => {};
global.blur ??= () => {};
global.matchMedia ??= (query) => ({
  media: String(query),
  matches: false,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
});
global.print ??= () => {};
global.alert ??= (message) => console.warn("alert:", message);
global.confirm ??= () => false;
global.prompt ??= () => null;
global.getSelection ??= getSelection;
if (global.screen === undefined) {
  define("screen", {
    get width() { return documentElement.clientWidth; },
    get height() { return documentElement.clientHeight; },
    get availWidth() { return documentElement.clientWidth; },
    get availHeight() { return documentElement.clientHeight; },
    colorDepth: 24,
    pixelDepth: 24,
    orientation: { type: "landscape-primary", angle: 0, addEventListener() {}, removeEventListener() {} },
  });
}
global.visualViewport ??= {
  get width() { return documentElement.clientWidth; },
  get height() { return documentElement.clientHeight; },
  offsetLeft: 0,
  offsetTop: 0,
  pageLeft: 0,
  pageTop: 0,
  scale: 1,
  addEventListener() {},
  removeEventListener() {},
};

// The engine runtime reports rejections nothing handled to the window target it made; they
// go to this one now.
const native = global.__ui;
if (native && "rejected" in native && typeof global.PromiseRejectionEvent === "function") {
  native.rejected = (promise, reason) =>
    !windowTarget.dispatchEvent(new global.PromiseRejectionEvent("unhandledrejection", { promise, reason, cancelable: true }));
}

// Storage: `localStorage` lasts (a file, on the full runtime), `sessionStorage` lasts as long
// as the window. Both are made on first use.
lazy("localStorage", () => { define("Storage", Storage); return localStorageArea(); });
lazy("sessionStorage", () => sessionStorageArea());
lazy("indexedDB", () => idb().indexedDB);
for (const name of ["IDBFactory", "IDBDatabase", "IDBTransaction", "IDBObjectStore", "IDBIndex", "IDBRequest", "IDBOpenDBRequest", "IDBKeyRange", "IDBCursor", "IDBCursorWithValue", "IDBVersionChangeEvent"]) {
  lazy(name, () => idb()[name]);
}
let idbModule = null;
function idb() {
  return (idbModule ??= indexedDBModule());
}
function lazy(name, make) {
  if (name in global) {
    try { if (global[name] !== undefined) return; } catch {}
  }
  Object.defineProperty(global, name, {
    get: () => {
      const value = make();
      define(name, value);
      return value;
    },
    set: (value) => define(name, value),
    configurable: true,
  });
}

if (global.Worker === undefined && WorkerClass) define("Worker", WorkerClass);
if (global.SharedWorker === undefined && SharedWorkerClass) define("SharedWorker", SharedWorkerClass);

// `fetch("/x.wasm")` as a page's: relative to `location`, the window's own origin served from
// the app's files.
if (typeof global.fetch === "function") {
  const fetch = windowFetch(global.fetch, location);
  define("fetch", fetch);
  if (global.EventSource === undefined) define("EventSource", eventSourceClass(fetch, location, OuterTarget));
}

if (global.ImageBitmap === undefined) define("ImageBitmap", ImageBitmap);
if (global.createImageBitmap === undefined) define("createImageBitmap", createImageBitmap);

// `navigator` as a browser's on this machine.
if (typeof global.navigator !== "object" || global.navigator === null) global.navigator = {};
const platform = global.process?.platform;
const navigatorFields = {
  userAgent: platform === "darwin"
    ? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) SilkUI"
    : platform === "win32"
      ? "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SilkUI"
      : platform === "linux" ? "Mozilla/5.0 (X11; Linux x86_64) SilkUI" : "SilkUI",
  platform: platform === "darwin" ? "MacIntel" : platform === "win32" ? "Win32" : platform === "linux" ? "Linux x86_64" : "",
  language: languageOf(),
  languages: [languageOf()],
  onLine: true,
  cookieEnabled: false,
  maxTouchPoints: 0,
  vendor: "",
  doNotTrack: null,
  webdriver: false,
};
for (const [name, value] of Object.entries(navigatorFields)) {
  if (global.navigator[name] === undefined || (name === "userAgent" && global.navigator.userAgent === "SilkUI")) {
    Object.defineProperty(global.navigator, name, { value, enumerable: true, configurable: true });
  }
}
// A window with no cameras, microphones or screens to capture: no devices, and asking for one
// fails as a browser's does when there is none.
if (global.navigator.mediaDevices === undefined) {
  const mediaDevices = new OuterTarget();
  const none = (what) => () => Promise.reject(domError("NotFoundError", "a Silk UI window has no " + what));
  Object.assign(mediaDevices, {
    ondevicechange: null,
    enumerateDevices: () => Promise.resolve([]),
    getUserMedia: none("camera or microphone"),
    getDisplayMedia: none("screen capture"),
    getSupportedConstraints: () => ({}),
  });
  Object.defineProperty(global.navigator, "mediaDevices", { value: mediaDevices, enumerable: true, configurable: true });
}
global.navigator.hardwareConcurrency ??= 4;
global.navigator.sendBeacon ??= () => false;
global.navigator.vibrate ??= () => false;

function languageOf() {
  const env = global.process?.env;
  const fromEnv = env?.LC_ALL || env?.LC_MESSAGES || env?.LANG;
  if (fromEnv && fromEnv !== "C" && fromEnv !== "POSIX") return fromEnv.split(".")[0].replace("_", "-");
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || "en-US";
  } catch {
    return "en-US";
  }
}

// `<html>` becomes the tree's root, under the document and the window.
if (!root()) mount(documentElement);
// The dispatcher runs the window's listeners on the global object, its `currentTarget`.
Object.defineProperty(global, "_run", { value: (event, capture) => windowTarget._run(event, capture), configurable: true });
setOuterTargets(documentTarget, global);
