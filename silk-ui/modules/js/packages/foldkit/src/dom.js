// The part of the DOM that Foldkit uses, over the nodes of @silkui/core.
//
// Foldkit has no renderer interface: its Snabbdom patches through `document` and the
// members of `Element`. Here an element, a text or a comment is a thin object over one
// @silkui/core node (`element.node`): the tree's structure and event flow are the node's, and
// this file adds what the DOM has on top (attributes, reflected properties, text content,
// selectors). It installs `document`, `window` and the classes Foldkit tests with
// `instanceof`, where the realm does not have them.
import {
  Event, SvgElement as SvgMarkup, caretPositionFromPoint, createNode, createSvgElement, createText, elementFromPoint, elementsFromPoint,
  getComputedStyle, mount,
} from "@silkui/core";

const HTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";

// Tags that are not a box. Every other tag is one, as a <div> is.
const KINDS = { input: "input", textarea: "input", img: "image", image: "image", canvas: "canvas", richinput: "richinput" };

const FOCUSABLE = new Set(["button", "a", "input", "textarea"]);

// What a tag means without any attribute, as HTML gives it: [role, aria-level].
const ROLES = {
  button: ["button"], a: ["link"], p: ["paragraph"], ul: ["list"], ol: ["list"], li: ["listitem"], dialog: ["dialog"],
  h1: ["heading", 1], h2: ["heading", 2], h3: ["heading", 3], h4: ["heading", 4], h5: ["heading", 5], h6: ["heading", 6],
};

// DOM events the tree has under another name.
const EVENTS = { mousedown: "pointerdown", mouseup: "pointerup", mousemove: "pointermove", mouseenter: "pointerenter", mouseleave: "pointerleave", dblclick: "click" };

// HTML attributes by the tree attribute they set. Booleans are true when present.
const BOOLEANS = { disabled: "disabled", readonly: "readOnly", inert: "inert", checked: "checked", selected: "selected", multiline: "multiline", focustrap: "focusTrap" };
const TEXTS = { placeholder: "placeholder", href: "href", alt: "label", label: "label", "data-testid": "testId", testid: "testId", cursor: "cursor", transition: "transition" };

// Properties Foldkit writes on an element, by the attribute each reflects.
const REFLECTED = {
  id: "id", className: "class", title: "title", lang: "lang", dir: "dir", name: "name", type: "type", htmlFor: "for",
  placeholder: "placeholder", href: "href", alt: "alt", src: "src", target: "target", rel: "rel", role: "role",
  disabled: "disabled", readOnly: "readonly", inert: "inert", checked: "checked", selected: "selected", hidden: "hidden",
  autofocus: "autofocus", required: "required", draggable: "draggable", testId: "testid", label: "label",
  multiline: "multiline", focusTrap: "focustrap", cursor: "cursor", transition: "transition",
};
const BOOLEAN_PROPERTIES = new Set(["disabled", "readOnly", "inert", "checked", "selected", "hidden", "autofocus", "required", "multiline", "focusTrap"]);

const LOOKS = { hoverStyle: "hover", activeStyle: "active", focusStyle: "focus", focusVisibleStyle: "focusVisible", startingStyle: "starting" };

const warned = new Set();

function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn("@silkui/foldkit: " + message);
}


// A node taken out of the tree and not put back by the end of the task is freed, as the DOM
// frees an element nothing holds. A container Foldkit takes out for the life of a program is
// kept: it goes back in when the program is disposed.
const detached = new Set();

function sweep() {
  for (const node of detached) if (!node.parentNode && !node._dom._kept) node.destroy();
  detached.clear();
}

const dom = (node) => node?._dom ?? null;

/** What elements, text and comments share. `node` is the @silkui/core node behind it. */
class DomNode {
  constructor(node) {
    this.node = node;
    node._dom = this;
  }

  get ownerDocument() {
    return document;
  }

  get parentNode() {
    return dom(this.node.parentNode);
  }

  get parentElement() {
    return this.parentNode;
  }

  get nextSibling() {
    return dom(this.node.nextSibling);
  }

  get previousSibling() {
    return dom(this.node.previousSibling);
  }

  get isConnected() {
    return documentElement !== null && documentElement.node.contains(this.node);
  }

  get nodeValue() {
    return null;
  }

  contains(other) {
    return other instanceof DomNode && this.node.contains(other.node);
  }

  remove() {
    this.parentNode?.removeChild(this);
  }
}

class Text extends DomNode {
  get nodeType() {
    return 3;
  }

  get nodeName() {
    return "#text";
  }

  get data() {
    return this.node.data;
  }

  set data(value) {
    this.node.data = value;
  }

  get textContent() {
    return this.node.data;
  }

  set textContent(value) {
    this.node.data = value ?? "";
  }

  get nodeValue() {
    return this.node.data;
  }
}

// The tree has no comments: one is an empty text leaf, which holds a place and shows nothing.
class Comment extends DomNode {
  #data;

  constructor(node, data) {
    super(node);
    this.#data = data;
  }

  get nodeType() {
    return 8;
  }

  get nodeName() {
    return "#comment";
  }

  get textContent() {
    return this.#data;
  }

  set textContent(value) {
    this.#data = String(value ?? "");
  }
}

function camel(name) {
  return name.includes("-") ? name.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) : name;
}

/** One look of an element with the methods of `CSSStyleDeclaration`. */
class CSSStyleDeclaration {
  #look;

  constructor(look) {
    this.#look = look;
  }

  setProperty(name, value) {
    this.#look.set({ [camel(name)]: value });
  }

  removeProperty(name) {
    this.#look.set({ [camel(name)]: null });
  }

  getPropertyValue(name) {
    return this.#look.get(camel(name)) ?? "";
  }

  get cssText() {
    return this.#look.cssText;
  }

  set cssText(text) {
    this.#look.replace({});
    for (const declaration of String(text ?? "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon > 0) this.setProperty(declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim());
    }
  }
}

function attributeChanged(element, name, value) {
  const node = element.node;
  const present = value !== null;
  if (name === "id") {
    node.setAttribute("id", value);
  } else if (name === "role") {
    node.setAttribute("role", present ? value : ROLES[element.localName]?.[0] ?? "");
  } else if (name.startsWith("aria-") || name.startsWith("data-") || name === "class" || name === "lang" || name === "dir") {
    node.setAttribute(name, value);
    if (name === "data-testid") node.setAttribute("testId", present ? value : "");
  } else if (name === "tabindex") {
    node.setAttribute("tabIndex", present ? Number(value) : FOCUSABLE.has(element.localName) ? 0 : -2147483648);
  } else if (name in BOOLEANS) {
    node.setAttribute(BOOLEANS[name], present);
  } else if (name in TEXTS) {
    node.setAttribute(TEXTS[name], present ? value : "");
  } else if (name === "hidden") {
    node.style.set({ display: present ? "none" : null });
  } else if (name === "style") {
    element.style.cssText = value;
  } else if (name === "value" && element instanceof HTMLInputElement) {
    element.value = value ?? "";
  } else if (name === "src") {
    node.setAttribute("src", value ?? "");
  }
}

// One compound selector: a tag, #id, .class and [attribute] or [attribute="value"] parts.
function compound(text) {
  const tests = [];
  const pattern = /([#.]?)([\w-]+)|\[\s*([\w:-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\s*\]|(\*)/gy;
  let at = 0;
  for (let part; at < text.length && (part = pattern.exec(text)); at = pattern.lastIndex) {
    const [, mark, word, attribute, double, single, bare] = part;
    if (attribute) {
      const value = double ?? single ?? bare;
      tests.push((element) => (value === undefined ? element.hasAttribute(attribute) : element.getAttribute(attribute) === value));
    } else if (mark === "#") tests.push((element) => element.id === word);
    else if (mark === ".") tests.push((element) => element.classList.contains(word));
    else if (word) tests.push((element) => element.localName === word.toLowerCase());
  }
  return at === text.length && text.length > 0 ? (element) => tests.every((test) => test(element)) : null;
}

const SELECTORS = new Map();

// Selector lists of compounds joined by descendant spaces: what Foldkit's focus commands
// and scans use. Null for anything else.
function matcher(selector) {
  let match = SELECTORS.get(selector);
  if (match !== undefined) return match;
  const alternatives = [];
  for (const alternative of selector.split(",")) {
    const steps = alternative.trim().split(/\s+(?![^[]*\])/).map(compound);
    if (steps.includes(null)) {
      warnOnce("the selector '" + selector + "' is not supported: it matches nothing");
      alternatives.length = 0;
      break;
    }
    alternatives.push((element) => {
      let step = steps.length - 1;
      if (!steps[step](element)) return false;
      for (let up = element.parentNode; step > 0 && up; up = up.parentNode) if (steps[step - 1](up)) step--;
      return step === 0;
    });
  }
  match = alternatives.length ? (element) => alternatives.some((test) => test(element)) : null;
  SELECTORS.set(selector, match);
  return match;
}

function search(from, selector, all) {
  const match = matcher(selector);
  const found = [];
  if (!match) return all ? found : null;
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.kind === "text") continue;
      if (match(child._dom)) {
        found.push(child._dom);
        if (!all) return true;
      }
      if (walk(child)) return true;
    }
    return false;
  };
  walk(from.node);
  return all ? found : found[0] ?? null;
}

class ClassList {
  #element;

  constructor(element) {
    this.#element = element;
  }

  #names() {
    return (this.#element.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
  }

  contains(name) {
    return this.#names().includes(name);
  }

  add(...names) {
    this.#element.setAttribute("class", [...new Set([...this.#names(), ...names])].join(" "));
  }

  remove(...names) {
    this.#element.setAttribute("class", this.#names().filter((name) => !names.includes(name)).join(" "));
  }

  toggle(name, force) {
    const on = force ?? !this.contains(name);
    if (on) this.add(name);
    else this.remove(name);
    return on;
  }
}

// What a DOM event has and the tree's does not name. The target becomes the element.
function adapt(event) {
  if (event._adapted) return;
  event._adapted = true;
  event.target = dom(event.target) ?? event.target;
  event.relatedTarget = null;
  event.isComposing = false;
  event.pointerType = "mouse";
  event.pointerId = 1;
  event.screenX = event.clientX;
  event.screenY = event.clientY;
  event.timeStamp = performance.now();
}

class Element extends DomNode {
  #tag;
  #attributes = null;
  #listeners = null;
  #style = null;
  #looks = null;

  constructor(node, tag) {
    super(node);
    this.#tag = tag;
  }

  set virtualList(config) {
    if (!config) this.node.setVirtualList(null);
    else this.node.setVirtualList(config.options, config.onRange);
  }

  set virtualRows(indices) {
    if (indices) queueMicrotask(() => {
      if (this.node.parentNode) this.node.bindVirtualRows(indices);
    });
  }

  get nodeType() {
    return 1;
  }

  get namespaceURI() {
    return HTML;
  }

  get localName() {
    return this.#tag;
  }

  get tagName() {
    return this.#tag.toUpperCase();
  }

  get nodeName() {
    return this.tagName;
  }

  get childNodes() {
    return this.node.childNodes.map(dom);
  }

  get children() {
    return this.node.childNodes.filter((child) => child.kind !== "text").map(dom);
  }

  get firstChild() {
    return dom(this.node.firstChild);
  }

  get lastChild() {
    return dom(this.node.lastChild);
  }

  get textContent() {
    let text = "";
    for (const child of this.node.childNodes) text += child._dom.textContent;
    return text;
  }

  set textContent(value) {
    for (const child of this.node.childNodes.slice()) child.destroy();
    if (value !== null && value !== undefined && value !== "") this.appendChild(document.createTextNode(value));
  }

  get innerText() {
    return this.textContent;
  }

  insertBefore(child, before = null) {
    this.node.insertBefore(child.node, before?.node ?? null);
    return child;
  }

  appendChild(child) {
    this.node.insertBefore(child.node, null);
    return child;
  }

  append(...children) {
    for (const child of children) this.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }

  removeChild(child) {
    this.node.removeChild(child.node);
    if (detached.size === 0) queueMicrotask(sweep);
    detached.add(child.node);
    return child;
  }

  replaceChild(child, old) {
    this.insertBefore(child, old);
    this.removeChild(old);
    return old;
  }

  replaceChildren(...children) {
    for (const child of this.childNodes) this.removeChild(child);
    this.append(...children);
  }

  get style() {
    return (this.#style ??= new CSSStyleDeclaration(this.node.style));
  }

  getAttribute(name) {
    return this.#attributes?.get(name) ?? null;
  }

  hasAttribute(name) {
    return this.#attributes?.has(name) ?? false;
  }

  setAttribute(name, value) {
    name = String(name).toLowerCase();
    value = String(value);
    this.#attributes ??= new Map();
    if (this.#attributes.get(name) === value) return;
    this.#attributes.set(name, value);
    attributeChanged(this, name, value);
  }

  removeAttribute(name) {
    name = String(name).toLowerCase();
    if (this.#attributes?.delete(name)) attributeChanged(this, name, null);
  }

  setAttributeNS(_namespace, name, value) {
    this.setAttribute(name, value);
  }

  removeAttributeNS(_namespace, name) {
    this.removeAttribute(name);
  }

  get classList() {
    return new ClassList(this);
  }

  get tabIndex() {
    const value = this.getAttribute("tabindex");
    return value === null ? (FOCUSABLE.has(this.#tag) ? 0 : -1) : Number(value);
  }

  set tabIndex(value) {
    this.setAttribute("tabindex", value);
  }

  querySelector(selector) {
    return search(this, selector, false);
  }

  querySelectorAll(selector) {
    return search(this, selector, true);
  }

  matches(selector) {
    return matcher(selector)?.(this) ?? false;
  }

  closest(selector) {
    const match = matcher(selector);
    for (let element = this; match && element; element = element.parentNode) if (match(element)) return element;
    return null;
  }

  focus() {
    this.node.focus();
  }

  blur() {}

  scrollTo(x, y) { this.node.scrollTo(x, y); }
  scroll(x, y) { this.node.scroll(x, y); }
  scrollBy(x, y) { this.node.scrollBy(x, y); }
  scrollIntoView(options) { this.node.scrollIntoView(options); }
  scrollIntoViewIfNeeded(center) { this.node.scrollIntoViewIfNeeded(center); }
  getBoundingClientRect() { return this.node.getBoundingClientRect(); }
  getClientRects() { return this.node.getClientRects(); }
  get clientLeft() { return this.node.clientLeft; }
  get clientTop() { return this.node.clientTop; }
  get clientWidth() { return this.node.clientWidth; }
  get clientHeight() { return this.node.clientHeight; }
  get scrollWidth() { return this.node.scrollWidth; }
  get scrollHeight() { return this.node.scrollHeight; }
  get scrollLeft() { return this.node.scrollLeft; }
  set scrollLeft(value) { this.node.scrollLeft = value; }
  get scrollTop() { return this.node.scrollTop; }
  set scrollTop(value) { this.node.scrollTop = value; }
  get offsetParent() { return dom(this.node.offsetParent); }
  get offsetLeft() { return this.node.offsetLeft; }
  get offsetTop() { return this.node.offsetTop; }
  get offsetWidth() { return this.node.offsetWidth; }
  get offsetHeight() { return this.node.offsetHeight; }

  /** The style the tree lays over the element in `state`, set from an object as `Style` takes. */
  _look(state, next) {
    const previous = (this.#looks ??= {})[state];
    this.#looks[state] = next;
    const look = this.node.look(state);
    const changes = {};
    for (const name of Object.keys(previous ?? {})) if (!next || !(name in next)) changes[camel(name)] = null;
    for (const name of Object.keys(next ?? {})) changes[camel(name)] = next[name];
    look.set(changes);
  }

  addEventListener(type, listener, options) {
    const name = EVENTS[type] ?? type;
    const capture = options === true || !!options?.capture;
    const key = type + (capture ? "!" : "");
    const table = (this.#listeners ??= new Map()).get(key) ?? this.#listeners.set(key, new Map()).get(key);
    if (table.has(listener)) return;
    const run = (event) => {
      if (type === "dblclick" && event.detail !== 2) return;
      adapt(event);
      // The listener sees the name it asked for: Snabbdom finds its handler by `event.type`.
      event.type = type;
      event.currentTarget = this;
      try {
        if (typeof listener === "function") listener.call(this, event);
        else listener.handleEvent(event);
      } finally {
        event.type = name;
      }
    };
    try {
      this.node.addEventListener(name, run, options);
    } catch (error) {
      if (!(error instanceof TypeError)) throw error;
      warnOnce("the tree has no '" + type + "' event: its listeners never run");
      return;
    }
    table.set(listener, run);
  }

  removeEventListener(type, listener, options) {
    const capture = options === true || !!options?.capture;
    const table = this.#listeners?.get(type + (capture ? "!" : ""));
    const run = table?.get(listener);
    if (!run) return;
    table.delete(listener);
    this.node.removeEventListener(EVENTS[type] ?? type, run, options);
  }
}

class HTMLElement extends Element {}

class HTMLInputElement extends HTMLElement {
  get value() {
    return this.node.value;
  }

  set value(value) {
    if (String(value) !== this.node.value) this.node.value = value;
  }

  get selectionStart() {
    return this.node.selectionStart;
  }

  set selectionStart(value) {
    this.node.selectionStart = value;
  }

  get selectionEnd() {
    return this.node.selectionEnd;
  }

  set selectionEnd(value) {
    this.node.selectionEnd = value;
  }

  get selectionDirection() {
    return this.node.selectionDirection;
  }

  set selectionDirection(value) {
    this.node.selectionDirection = value;
  }

  setSelectionRange(start, end, direction) {
    this.node.setSelectionRange(start, end, direction);
  }

  setRangeText(...args) {
    this.node.setRangeText(...args);
  }

  select() {
    this.node.select();
  }
}

/** The `style` attribute of an element inside an `<svg>`, as a look: it is markup too. */
class SvgLook {
  #element;
  #values = {};

  constructor(element) {
    this.#element = element;
  }

  set(properties) {
    for (const name of Object.keys(properties)) {
      const value = properties[name];
      if (value === null || value === undefined || value === "") delete this.#values[name];
      else this.#values[name] = value;
    }
    this.#element.setAttribute("style", this.#values);
  }

  replace(properties) {
    this.#values = {};
    this.set(properties);
  }

  get(name) {
    return this.#values[name];
  }

  get cssText() {
    return this.#element.getAttribute("style") ?? "";
  }
}

/**
 * An element of the SVG namespace. The root `<svg>` is one tree node; the elements inside are
 * markup it draws (`SvgElement` of @silkui/core). Attributes keep their case, as SVG's do.
 */
class SVGElement extends Element {
  #style = null;

  get namespaceURI() {
    return SVG;
  }

  get tagName() {
    return this.localName;
  }

  getAttribute(name) {
    return this.node.getAttribute(String(name));
  }

  hasAttribute(name) {
    return this.node.getAttribute(String(name)) !== null;
  }

  setAttribute(name, value) {
    name = String(name);
    if (name === "style" && !(this.node instanceof SvgMarkup)) this.style.cssText = value;
    else this.node.setAttribute(name, String(value));
  }

  removeAttribute(name) {
    this.node.removeAttribute(String(name));
  }

  get style() {
    if (!(this.node instanceof SvgMarkup)) return super.style;
    return (this.#style ??= new CSSStyleDeclaration(new SvgLook(this.node)));
  }
}

for (const [property, attribute] of Object.entries(REFLECTED)) {
  const boolean = BOOLEAN_PROPERTIES.has(property);
  Object.defineProperty(Element.prototype, property, {
    configurable: true,
    get() {
      const value = this.getAttribute(attribute);
      return boolean ? value !== null : value ?? "";
    },
    set(value) {
      if (boolean ? !value : value === null || value === undefined) this.removeAttribute(attribute);
      else this.setAttribute(attribute, boolean ? "" : value);
    },
  });
}

// The state looks of the tree, which CSS reaches with pseudo-classes: an element takes them
// as properties holding style objects.
for (const [property, state] of Object.entries(LOOKS)) {
  Object.defineProperty(Element.prototype, property, {
    configurable: true,
    set(style) {
      this._look(state, style);
    },
  });
}

let documentElement = null;
let head = null;
let body = null;
let title = "";

function kept(element) {
  element._kept = true;
  return element;
}

// The page every Foldkit program starts from: <html><body><div id="root"></div></body></html>,
// filling the window.
function page() {
  if (documentElement) return;
  documentElement = kept(document.createElement("html"));
  head = kept(document.createElement("head"));
  body = kept(document.createElement("body"));
  const fill = { width: "100%", height: "100%" };
  documentElement.node.style.set(fill);
  body.node.style.set(fill);
  const root = kept(document.createElement("div"));
  root.id = "root";
  body.appendChild(root);
  documentElement.appendChild(body);
  mount(documentElement.node);
}

export const document = {
  nodeType: 9,
  readyState: "complete",
  visibilityState: "visible",
  hidden: false,

  get documentElement() {
    page();
    return documentElement;
  },

  get body() {
    page();
    return body;
  },

  get head() {
    page();
    return head;
  },

  get activeElement() {
    return this.body;
  },

  get defaultView() {
    return globalThis;
  },

  get title() {
    return title;
  },

  set title(value) {
    title = String(value);
  },

  elementFromPoint(x, y) {
    return dom(elementFromPoint(x, y));
  },

  elementsFromPoint(x, y) {
    return elementsFromPoint(x, y).map(dom).filter(Boolean);
  },

  caretPositionFromPoint(x, y) {
    const position = caretPositionFromPoint(x, y);
    return position && { ...position, offsetNode: dom(position.offsetNode) };
  },

  createElement(name) {
    const tag = String(name).toLowerCase();
    if (tag === "svg") return this.createElementNS(SVG, "svg");
    const kind = KINDS[tag] ?? "box";
    const node = createNode(kind);
    node.setAttribute("element", tag);
    const [role, level] = ROLES[tag] ?? [];
    if (role) node.setAttribute("role", role);
    if (level) node.setAttribute("aria-level", String(level));
    if (tag === "button" || tag === "a") node.setAttribute("tabIndex", 0);
    if (tag === "textarea") node.setAttribute("multiline", true);
    if (kind === "input" || kind === "richinput") return new HTMLInputElement(node, tag);
    return new HTMLElement(node, tag);
  },

  createElementNS(namespace, name) {
    if (namespace !== SVG) return this.createElement(name);
    const element = new SVGElement(createSvgElement(String(name)), String(name));
    if (name === "svg") element.node.setAttribute("element", "svg");
    return element;
  },

  createTextNode(data) {
    return new Text(createText(String(data)));
  },

  createComment(data = "") {
    return new Comment(createText(""), String(data));
  },

  createDocumentFragment() {
    throw new Error("@silkui/foldkit: document fragments are not supported");
  },

  getElementById(id) {
    return this.documentElement.querySelector('[id="' + id + '"]');
  },

  querySelector(selector) {
    return this.documentElement.matches(selector) ? documentElement : documentElement.querySelector(selector);
  },

  querySelectorAll(selector) {
    return this.documentElement.querySelectorAll(selector);
  },

  contains(node) {
    return this.documentElement.contains(node);
  },

  addEventListener(type, listener, options) {
    this.documentElement.addEventListener(type, listener, options);
  },

  removeEventListener(type, listener, options) {
    this.documentElement.removeEventListener(type, listener, options);
  },
};

// The window's own events (popstate and the ones a program dispatches itself).
const listeners = new Map();

const windowMembers = {
  addEventListener(type, listener) {
    let list = listeners.get(type);
    if (!list) listeners.set(type, (list = []));
    if (!list.includes(listener)) list.push(listener);
  },

  removeEventListener(type, listener) {
    const list = listeners.get(type);
    const index = list ? list.indexOf(listener) : -1;
    if (index >= 0) list.splice(index, 1);
  },

  dispatchEvent(event) {
    for (const listener of (listeners.get(event.type) ?? []).slice()) {
      if (typeof listener === "function") listener.call(globalThis, event);
      else listener.handleEvent(event);
    }
    return !event.defaultPrevented;
  },

  matchMedia(query) {
    return { media: query, matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} };
  },

  getComputedStyle(element, pseudo) {
    return getComputedStyle(element, pseudo);
  },

  MutationObserver: class MutationObserver {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  },

  CustomEvent: class CustomEvent extends Event {
    constructor(type, options) {
      super(type, null);
      this.detail = options?.detail ?? null;
    }
  },
};

// An address for programs that route: it starts at the root and moves with `history`, in
// memory, since a window has no address bar.
function addresses() {
  const entries = [{ href: "http://localhost/", state: null }];
  let at = 0;
  const location = {
    get href() {
      return entries[at].href;
    },
    set href(value) {
      history.pushState(null, "", value);
      popped();
    },
    reload() {},
    toString() {
      return entries[at].href;
    },
  };
  for (const part of ["protocol", "host", "hostname", "port", "pathname", "search", "hash", "origin"]) {
    Object.defineProperty(location, part, { get: () => new URL(entries[at].href)[part] });
  }
  const popped = () => globalThis.dispatchEvent(Object.assign(new Event("popstate", null), { state: entries[at].state }));
  const history = {
    get length() {
      return entries.length;
    },
    get state() {
      return entries[at].state;
    },
    pushState(state, _unused, url) {
      entries.length = ++at;
      entries.push({ href: new URL(url ?? "", entries[at - 1].href).href, state });
    },
    replaceState(state, _unused, url) {
      entries[at] = { href: new URL(url ?? "", entries[at].href).href, state };
    },
    go(delta = 0) {
      const next = at + delta;
      if (delta === 0 || next < 0 || next >= entries.length) return;
      at = next;
      queueMicrotask(popped);
    },
    back() {
      this.go(-1);
    },
    forward() {
      this.go(1);
    },
  };
  return { location, history };
}

function storage() {
  const items = new Map();
  return {
    getItem: (key) => items.get(String(key)) ?? null,
    setItem: (key, value) => void items.set(String(key), String(value)),
    removeItem: (key) => void items.delete(String(key)),
    clear: () => items.clear(),
  };
}

function provide(name, value) {
  if (globalThis[name] === undefined) globalThis[name] = value;
}

provide("window", globalThis);
provide("self", globalThis);
provide("top", globalThis);
provide("document", document);
for (const name of Object.keys(windowMembers)) provide(name, windowMembers[name]);
for (const [name, value] of Object.entries({ Node: DomNode, Element, HTMLElement, SVGElement, HTMLInputElement, HTMLTextAreaElement: HTMLInputElement, Text, Comment, CSSStyleDeclaration, Event })) {
  provide(name, value);
}
// Elements the tree does not have: nothing is an instance of them.
const absent = {};
for (const name of ["HTMLCanvasElement", "HTMLSelectElement", "HTMLDialogElement", "HTMLOutputElement", "DocumentFragment"]) {
  absent[name] = class {};
  provide(name, absent[name]);
}
// In a page (web-canvas) the browser's own document and DOM classes are there, and the page
// cannot replace them: a build for both targets renames Foldkit's references to these
// (`pageGlobals` in apis.js), which are the same objects in a window.
globalThis.__silkuiDom = {
  document, Node: DomNode, Element, HTMLElement, SVGElement, HTMLInputElement, HTMLTextAreaElement: HTMLInputElement, Text, Comment,
  MutationObserver: windowMembers.MutationObserver, getComputedStyle: windowMembers.getComputedStyle, ...absent,
};
provide("navigator", { userAgent: "SilkUI" });
provide("sessionStorage", storage());
if (typeof URL === "function" && globalThis.location === undefined) {
  const { location, history } = addresses();
  globalThis.location = location;
  globalThis.history = history;
}
