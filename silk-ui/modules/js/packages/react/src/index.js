// @silkui/react: a React renderer for the Silk UI tree.
//
// Host elements are the tree's node kinds: <box>, <input>, <image> (or <img>), <canvas>, and
// inline <svg> with its elements (<path>, <circle>, <g> and the rest), drawn as one node.
// Strings in children become text nodes. Props:
//
// - `style`, and `hoverStyle`, `activeStyle`, `focusStyle`, `focusVisibleStyle` for the
//   looks the tree lays over it in those states. `startingStyle` is what transitions start
//   from when the node first shows, as CSS `@starting-style`.
// - `onClick`, `onPointerDown`, `onKeyDown`, `onInput` and so on for every event of the
//   tree, with a `Capture` suffix for the capture phase. Listeners receive the @silkui/core
//   event, which has the DOM members.
// - `value` on <input>: a controlled value, as in React DOM.
// - `src` on <image>: an address, `data:` URLs included, as `<img src>`. An SVG draws with
//   the node's `color` as `currentColor`. Inside <svg>, props are SVG attributes in React
//   DOM's spellings.
// - Everything else is a tree attribute: `tabIndex`, `testId`, `label`, `disabled`,
//   `placeholder` and so on, and `role` and `aria-*` as in React DOM.
import Reconciler from "react-reconciler";
import {
  ConcurrentRoot,
  ContinuousEventPriority,
  DefaultEventPriority,
  DiscreteEventPriority,
} from "react-reconciler/constants.js";
import { createContext, createElement, useLayoutEffect, useRef, useState } from "react";
import { ButtonElement, ButtonInput, CheckInput, ColorInput, FileInput, HiddenInput, Input, OptionElement, RangeInput, RichInput, SelectElement, SvgElement, SvgText, createElement as createHtmlElement, createNode, createSvgElement, createText, flushSvg, mount, root as mountedRoot } from "@silkui/core";

const LOOKS = { style: "base", hoverStyle: "hover", activeStyle: "active", focusStyle: "focus", focusVisibleStyle: "focusVisible", startingStyle: "starting" };
const CONTINUOUS = new Set(["pointermove", "pointerenter", "pointerleave", "wheel", "scroll", "layout", "dragover"]);
const SKIP = new Set(["children", "key", "ref", "value", "defaultValue", "document", "defaultDocument", "marks", "atoms"]);
// Element types that are the tree's own node kinds; every other type is an HTML element.
const TREE_TYPES = new Set(["box", "text", "richinput", "image", "svg"]);
// Props of HTML elements React DOM handles itself, not attributes.
const HTML_SKIP = new Set(["children", "key", "ref", "value", "defaultValue", "checked", "defaultChecked", "dangerouslySetInnerHTML", "autoFocus", "suppressHydrationWarning", "suppressContentEditableWarning"]);
// Tree attributes an HTML element takes as they are spelled (see @silkui/core `setAttribute`).
const TREE_ATTRIBUTES = new Set(["tabIndex", "testId", "focusTrap", "multiline", "expanded", "indeterminate", "transition", "cursor", "label"]);
// React DOM prop names whose attribute is not the name in lower case.
const ATTRIBUTE_NAMES = { className: "class", htmlFor: "for", acceptCharset: "accept-charset", httpEquiv: "http-equiv" };
// HTML attributes that are present or absent: `true` sets them, `false` takes them out.
const BOOLEAN_ATTRIBUTES = new Set([
  "allowfullscreen", "async", "autoplay", "checked", "controls", "default", "defer", "disabled", "formnovalidate",
  "hidden", "inert", "itemscope", "loop", "multiple", "muted", "nomodule", "novalidate", "open", "playsinline",
  "readonly", "required", "reversed", "selected",
]);
// React DOM event names whose DOM event is another type.
const HTML_EVENTS = { focus: "focusin", blur: "focusout", doubleclick: "click", contextmenu: "pointerdown" };

let updatePriority = 0;
let eventPriority = 0;
let currentEvent = null;

// Listeners per node: one registered function per event and phase, which calls whatever
// the latest props hold.
const bindings = new WeakMap();

function eventOf(name) {
  if (name.length < 3 || name[0] !== "o" || name[1] !== "n" || name[2] < "A" || name[2] > "Z") return null;
  const capture = name.endsWith("Capture");
  const type = (capture ? name.slice(2, -7) : name.slice(2)).toLowerCase();
  return { type, capture };
}

// React DOM's synthetic event members, on the @silkui/core event itself.
function synthetic(event) {
  if (event.nativeEvent !== undefined) return;
  event.nativeEvent = event;
  event.persist = persist;
  event.isDefaultPrevented = isDefaultPrevented;
  event.isPropagationStopped = isPropagationStopped;
}
function persist() {}
function isDefaultPrevented() {
  return this.defaultPrevented;
}
function isPropagationStopped() {
  return !!this._stopped || this.cancelBubble === true;
}

// Which events of `type` reach a React DOM handler: a double click is a click's second, a
// context menu a secondary button press.
const FILTERS = {
  onDoubleClick: (event) => event.detail === 2,
  onDoubleClickCapture: (event) => event.detail === 2,
  onContextMenu: (event) => event.button === 2,
  onContextMenuCapture: (event) => event.button === 2,
};

function listen(node, name, type, capture, props) {
  let bound = bindings.get(node);
  if (!bound) bindings.set(node, (bound = { props, names: new Set() }));
  if (bound.names.has(name)) return;
  bound.names.add(name);
  const filter = node._tag === undefined ? undefined : FILTERS[name];
  node.addEventListener(
    type,
    (event) => {
      if (filter && !filter(event)) return;
      const handler = bound.props[name];
      if (node._tag !== undefined) synthetic(event);
      const previous = eventPriority;
      const previousEvent = currentEvent;
      eventPriority = CONTINUOUS.has(type) ? ContinuousEventPriority : DiscreteEventPriority;
      currentEvent = event;
      try {
        if (typeof handler === "function") handler(event);
      } finally {
        eventPriority = previous;
        currentEvent = previousEvent;
      }
      // Updates from a discrete event commit before the host applies the mutations.
      if (!CONTINUOUS.has(type)) reconciler.flushSyncWork();
      // An HTML field's `onChange` may run after this listener: it is put back once every
      // listener ran.
      if (node._tag !== undefined) {
        if (type === "input" || type === "change") restoreLater(node);
      } else if (type === "input") restoreControlled(node);
    },
    capture,
  );
}

// A controlled input shows its `value` prop: what the user typed stays only when the
// listener put it into state.
const restoring = new Set();
function restoreLater(node) {
  if (restoring.has(node)) return;
  restoring.add(node);
  queueMicrotask(() => {
    restoring.delete(node);
    restoreControlled(node);
  });
}

function applySelectValue(node, value) {
  if (Array.isArray(value)) {
    const set = new Set(value.map(String));
    for (const opt of node.options) opt.selected = set.has(opt.value);
  } else if (value !== undefined && value !== null) {
    node.value = String(value);
  }
}

function restoreControlled(node) {
  const props = bindings.get(node)?.props;
  if (!props) return;
  if (node instanceof CheckInput) {
    if (props.checked !== undefined && !!props.checked !== node.checked) node.checked = props.checked;
    return;
  }
  if (node instanceof RangeInput || node instanceof ColorInput) {
    if (props.value !== undefined && String(props.value) !== node.value) node.value = props.value;
    return;
  }
  if (node instanceof SelectElement) {
    if (props.value !== undefined) applySelectValue(node, props.value);
    return;
  }
  if (node instanceof RichInput) {
    if (props.document !== undefined && !sameDocument(props.document, node.document)) node.document = props.document;
  } else if (props.value !== undefined && String(props.value) !== node.value) node.value = props.value;
}

function sameDocument(a, b) {
  if (a === b) return true;
  if (String(a?.text ?? "") !== b.text) return false;
  const marks = a?.marks ?? [];
  const atoms = a?.atoms ?? [];
  if (marks.length !== b.marks.length || atoms.length !== b.atoms.length) return false;
  for (let i = 0; i < marks.length; i++) {
    const x = marks[i];
    const y = b.marks[i];
    if (x.start !== y.start || x.end !== y.end || x.marks.length !== y.marks.length) return false;
    for (let j = 0; j < x.marks.length; j++) if (x.marks[j] !== y.marks[j]) return false;
  }
  for (let i = 0; i < atoms.length; i++) {
    const x = atoms[i];
    const y = b.atoms[i];
    if (x.kind !== y.kind || String(x.label ?? "") !== y.label || String(x.data ?? "") !== y.data) return false;
  }
  return true;
}

// `marks` and `atoms` map a mark name or atom kind to its style; a changed entry is
// defined again.
function defineLooks(previous, next, define) {
  if (!next || previous === next) return;
  for (const name of Object.keys(next)) {
    if (!previous || previous[name] !== next[name]) define(name, next[name]);
  }
}

function diffStyle(look, previous, next) {
  if (previous === next) return;
  // A new node takes its style as it is.
  if (!previous) {
    if (next) look.set(next);
    return;
  }
  const changes = {};
  let any = false;
  if (previous) {
    for (const name of Object.keys(previous)) {
      if (!next || !(name in next)) {
        changes[name] = null;
        any = true;
      }
    }
  }
  if (next) {
    for (const name of Object.keys(next)) {
      if (!previous || previous[name] !== next[name]) {
        changes[name] = next[name];
        any = true;
      }
    }
  }
  if (any) look.set(changes);
}

function removeMissingProps(node, previous, next) {
  for (const name of Object.keys(previous)) {
    if (name in next || SKIP.has(name)) continue;
    if (name in LOOKS) diffStyle(node.look(LOOKS[name]), previous[name], null);
    else if (!eventOf(name)) {
      if (name === "id" || name === "className" || name.startsWith("data-") || name.startsWith("aria-")) node.removeAttribute(name);
      else node.setAttribute(name, name === "tabIndex" ? -2147483648 : typeof previous[name] === "boolean" ? false : "");
    }
  }
}

// The attribute an HTML element's prop `name` sets, or null for a tree attribute.
function attributeName(name) {
  if (TREE_ATTRIBUTES.has(name)) return null;
  const mapped = ATTRIBUTE_NAMES[name];
  if (mapped) return mapped;
  if (name.startsWith("data-") || name.startsWith("aria-")) return name;
  return name.toLowerCase();
}

function setHtmlAttribute(node, name, value) {
  const attribute = attributeName(name);
  if (attribute === null) {
    node.setAttribute(name, value);
    return;
  }
  if (value === null || value === undefined || typeof value === "function" || typeof value === "symbol") {
    node.setAttribute(attribute, null);
  } else if (BOOLEAN_ATTRIBUTES.has(attribute)) {
    node.setAttribute(attribute, value ? "" : null);
  } else if (typeof value === "boolean" && !attribute.startsWith("data-") && !attribute.startsWith("aria-")) {
    // React DOM leaves booleans out of other attributes, except enumerated ones.
    node.setAttribute(attribute, attribute === "draggable" || attribute === "spellcheck" || attribute === "contenteditable" ? String(value) : null);
  } else if (typeof value === "object") {
    node.setAttribute(attribute, null);
  } else {
    node.setAttribute(attribute, value);
  }
}

function htmlEventType(node, type) {
  if (type === "change") {
    if (node instanceof Input || node instanceof RangeInput || node instanceof ColorInput) return "input";
    return "change";
  }
  return HTML_EVENTS[type] ?? type;
}

// An HTML element's props, as React DOM applies them.
function applyHtmlProps(node, previous, next) {
  const names = Object.keys(next);
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    const value = next[name];
    if (previous[name] === value) continue;
    if (name === "dangerouslySetInnerHTML") {
      const html = value?.__html;
      if (html !== previous[name]?.__html) node.innerHTML = html ?? "";
      continue;
    }
    if (HTML_SKIP.has(name)) continue;
    if (name in LOOKS) {
      diffStyle(node.look(LOOKS[name]), previous[name], value);
      continue;
    }
    const event = eventOf(name);
    if (event) {
      if (typeof value === "function") listen(node, name, htmlEventType(node, event.type), event.capture, next);
      continue;
    }
    setHtmlAttribute(node, name, value);
  }
  if (previous !== EMPTY) {
    for (const name of Object.keys(previous)) {
      if (name in next || HTML_SKIP.has(name) || eventOf(name)) continue;
      if (name in LOOKS) diffStyle(node.look(LOOKS[name]), previous[name], null);
      else if (TREE_ATTRIBUTES.has(name)) node.setAttribute(name, name === "tabIndex" ? -2147483648 : typeof previous[name] === "boolean" ? false : "");
      else setHtmlAttribute(node, name, null);
    }
    if ("dangerouslySetInnerHTML" in previous && !("dangerouslySetInnerHTML" in next)) node.innerHTML = "";
  }
  if (node instanceof CheckInput) {
    if (next.checked !== undefined) {
      node.checked = next.checked;
      listen(node, "onChange", "change", false, next);
    } else if (previous === EMPTY && next.defaultChecked !== undefined) node.checked = next.defaultChecked;
    if (next.value !== undefined) node.value = String(next.value);
  } else if (node instanceof RangeInput) {
    if (next.min !== undefined) node.min = next.min;
    if (next.max !== undefined) node.max = next.max;
    if (next.step !== undefined) node.step = next.step;
    const value = next.value;
    if (value !== undefined && value !== null) {
      if (String(value) !== node.value) node.value = value;
      listen(node, "onChange", "input", false, next);
    } else if (previous === EMPTY && next.defaultValue !== undefined) {
      node.value = next.defaultValue;
    }
  } else if (node instanceof ColorInput) {
    const value = next.value;
    if (value !== undefined && value !== null) {
      if (String(value).toLowerCase() !== node.value) node.value = value;
      listen(node, "onChange", "input", false, next);
    } else if (previous === EMPTY && next.defaultValue !== undefined) {
      node.value = next.defaultValue;
    }
  } else if (node instanceof HiddenInput || node instanceof ButtonInput) {
    if (next.value !== undefined && next.value !== null) node.value = String(next.value);
    else if (previous === EMPTY && next.defaultValue !== undefined) node.value = String(next.defaultValue);
  } else if (node instanceof SelectElement) {
    if (next.value !== undefined) {
      applySelectValue(node, next.value);
      listen(node, "onChange", "change", false, next);
    } else if (previous === EMPTY && next.defaultValue !== undefined) {
      applySelectValue(node, next.defaultValue);
    }
  } else if (node instanceof Input) {
    const value = next.value;
    if (value !== undefined && value !== null) {
      if (String(value) !== node.value) node.value = value;
      listen(node, "onChange", "input", false, next);
    } else if (previous === EMPTY) {
      const initial = next.defaultValue ?? (node.localName === "textarea" && typeof next.children === "string" ? next.children : undefined);
      if (initial !== undefined) node.value = initial;
    }
  } else if (next.value !== undefined && next.value !== previous.value) {
    setHtmlAttribute(node, "value", next.value);
  }
  if (previous !== EMPTY) {
    const bound = bindings.get(node);
    if (bound) bound.props = next;
  }
}

function applyProps(node, previous, next) {
  if (node._tag !== undefined) return applyHtmlProps(node, previous, next);
  const names = Object.keys(next);
  for (let index = 0; index < names.length; index++) {
    const name = names[index];
    const value = next[name];
    if (name === "children" || previous[name] === value) continue;
    if (name === "className") {
      node.setAttribute(name, value);
      continue;
    }
    if (SKIP.has(name)) continue;
    if (name in LOOKS) {
      diffStyle(node.look(LOOKS[name]), previous[name], value);
      continue;
    }
    const event = eventOf(name);
    if (event) {
      if (typeof value === "function") listen(node, name, event.type, event.capture, next);
      continue;
    }
    node.setAttribute(name, value);
  }
  if (previous !== EMPTY) removeMissingProps(node, previous, next);
  if (node instanceof RichInput) {
    defineLooks(previous.marks, next.marks, (name, style) => node.defineMark(name, style));
    defineLooks(previous.atoms, next.atoms, (kind, style) => node.defineAtom(kind, style));
    if (next.document !== undefined) {
      if (!sameDocument(next.document, node.document)) node.document = next.document;
      listen(node, "onInput", "input", false, next);
    } else if (previous === EMPTY && next.defaultDocument !== undefined) {
      node.document = next.defaultDocument;
    }
  } else if (node.kind === "input") {
    if (next.value !== undefined) {
      if (String(next.value) !== node.value) node.value = next.value;
      // Typing reaches the tree first, so a controlled input needs the input event to put
      // its value back when the application does not accept the change.
      listen(node, "onInput", "input", false, next);
    } else if (previous === EMPTY && next.defaultValue !== undefined) {
      node.value = next.defaultValue;
    }
  }
  if (previous !== EMPTY) {
    const bound = bindings.get(node);
    if (bound) bound.props = next;
  }
}

const EMPTY = {};

// React DOM hoists a `<style href precedence>` into the head and keeps one per href for good,
// so a component that renders one (Base UI's ScrollArea) adds no sheet when it mounts again
// and removes none when it unmounts. Each instance here is an empty text node in its place.
const hoistedStyles = new Map();
const hoistedOrder = [];
const styleMarks = new WeakSet();

function hoistable(type, props, context) {
  return type === "style" && context !== SVG && typeof props.href === "string" && props.href !== ""
    && props.precedence != null && globalThis.document?.head != null;
}

function styleText(children) {
  if (children == null || typeof children === "boolean") return "";
  return Array.isArray(children) ? children.map(styleText).join("") : String(children);
}

function hoistStyle(props) {
  if (!hoistedStyles.has(props.href)) {
    const element = createHtmlElement("style", EMPTY);
    element.setAttribute("href", props.href);
    element.setAttribute("precedence", String(props.precedence));
    element.appendChild(createText(styleText(props.children)));
    // Precedences keep the order they first appeared in; a style goes after its own.
    const precedence = String(props.precedence);
    if (!hoistedOrder.includes(precedence)) hoistedOrder.push(precedence);
    const rank = hoistedOrder.indexOf(precedence);
    const later = [...hoistedStyles.values()].find((other) => hoistedOrder.indexOf(other.getAttribute("precedence")) > rank);
    const head = globalThis.document.head;
    if (later) head.insertBefore(element, later);
    else head.appendChild(element);
    hoistedStyles.set(props.href, element);
  }
  const mark = createText("");
  styleMarks.add(mark);
  return mark;
}

// The host context inside an <svg>: its elements are markup, not nodes.
const SVG = { svg: true };

// Props of an element inside an <svg>: SVG attributes. Events reach the <svg> itself.
function applySvgProps(element, previous, next) {
  for (const name of Object.keys(next)) {
    const value = next[name];
    if (name === "children" || name === "key" || name === "ref" || previous[name] === value) continue;
    if (eventOf(name)) {
      if (typeof value === "function") element.addEventListener(eventOf(name).type);
      continue;
    }
    element.setAttribute(name, value);
  }
  for (const name of Object.keys(previous)) {
    if (!(name in next) && name !== "children" && name !== "key" && name !== "ref" && !eventOf(name)) element.removeAttribute(name);
  }
}

const hostConfig = {
  rendererPackageName: "@silkui/react",
  rendererVersion: "0.1.0",
  extraDevToolsConfig: null,
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  supportsResources: false,
  supportsSingletons: false,
  supportsTestSelectors: false,
  supportsMicrotasks: true,
  isPrimaryRenderer: true,
  warnsIfNotActing: false,
  noTimeout: -1,

  getRootHostContext: () => EMPTY,
  getChildHostContext: (context, type) => (type === "svg" ? SVG : context === SVG && type === "foreignObject" ? EMPTY : context),
  getPublicInstance: (instance) => instance,
  prepareForCommit: () => null,
  // The <svg>s this commit changed are drawn before the host applies it.
  resetAfterCommit: () => flushSvg(),
  preparePortalMount() {},
  // A textarea's children are its first value, and markup set as HTML has no React children.
  shouldSetTextContent: (type, props) => type === "textarea" || props.dangerouslySetInnerHTML != null
    || (type === "style" && typeof props.href === "string" && props.href !== "" && props.precedence != null && globalThis.document?.head != null),
  createInstance(type, props, _root, context) {
    if (hoistable(type, props, context)) return hoistStyle(props);
    if (context === SVG && type !== "svg") {
      const element = createSvgElement(type);
      applySvgProps(element, EMPTY, props);
      return element;
    }
    const node = TREE_TYPES.has(type) ? createNode(type) : createHtmlElement(type, props);
    applyProps(node, EMPTY, props);
    return node;
  },
  createTextInstance: (text, _root, context) => (context === SVG ? new SvgText(text) : createText(text)),
  appendInitialChild: (parent, child) => parent.appendChild(child),
  // `autoFocus` focuses the element once it is in the tree; `<select>` applies its initial value once `<option>` children are mounted.
  finalizeInitialChildren(node, _type, props) {
    if (node instanceof SelectElement) {
      if (props.value !== undefined) applySelectValue(node, props.value);
      else if (props.defaultValue !== undefined) applySelectValue(node, props.defaultValue);
    }
    return props.autoFocus === true;
  },
  commitMount(node) {
    node.focus?.();
  },
  commitUpdate(node, type, previous, next) {
    if (styleMarks.has(node)) return;
    if (node instanceof SvgElement) applySvgProps(node, previous, next);
    else applyProps(node, previous, next);
  },
  commitTextUpdate(node, previous, next) {
    node.data = next;
  },
  resetTextContent() {},
  appendChild: (parent, child) => parent.appendChild(child),
  appendChildToContainer: (container, child) => container.appendChild(child),
  insertBefore: (parent, child, before) => parent.insertBefore(child, before),
  insertInContainerBefore: (container, child, before) => container.insertBefore(child, before),
  // React is done with a removed subtree, so its nodes are freed.
  removeChild: (parent, child) => child.destroy(),
  removeChildFromContainer: (container, child) => child.destroy(),
  clearContainer(container) {
    for (const child of container.childNodes.slice()) child.destroy();
  },
  hideInstance: (node) => (node instanceof SvgElement ? node.setAttribute("display", "none") : node.style.set({ display: "none" })),
  unhideInstance: (node, props) => (node instanceof SvgElement ? node.setAttribute("display", props.display ?? null) : node.style.set({ display: props.style?.display ?? null })),
  hideTextInstance: (node) => (node.data = ""),
  unhideTextInstance: (node, text) => (node.data = text),
  detachDeletedInstance() {},

  scheduleTimeout: (callback, delay) => setTimeout(callback, delay),
  cancelTimeout: (id) => clearTimeout(id),
  scheduleMicrotask: (callback) => queueMicrotask(callback),

  setCurrentUpdatePriority(priority) {
    updatePriority = priority;
  },
  getCurrentUpdatePriority: () => updatePriority,
  resolveUpdatePriority: () => updatePriority || eventPriority || DefaultEventPriority,
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => currentEvent?.type ?? null,
  resolveEventTimeStamp: () => -1.1,
  requestPostPaintCallback() {},

  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit() {},
  suspendInstance() {},
  suspendOnActiveViewTransition() {},
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  NotPendingTransition: null,
  HostTransitionContext: createContext(null),
  resetFormInstance() {},

  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  bindToConsole: (method, args) => console[method].bind(console, ...args),
};

const reconciler = Reconciler(hostConfig);
// Fast Refresh and devtools find the renderer through the global hook, when one is there.
reconciler.injectIntoDevTools?.();

function report(kind) {
  return (error, info) => {
    console.error(kind + ":", error, info?.componentStack ?? "");
  };
}

/**
 * A React root in `container`, a @silkui/core node. Without one, a new box is mounted as the
 * root of the window's tree.
 */
export function createRoot(container) {
  const host = container ?? mountedRoot() ?? mount(createNode("box"));
  const fiberRoot = reconciler.createContainer(
    host,
    ConcurrentRoot,
    null,
    false,
    null,
    "",
    report("Uncaught error"),
    report("Error caught by a boundary"),
    report("Recoverable error"),
    () => {},
  );
  return {
    // Rendering commits before it returns, so the first frame of a window has the content.
    render(element) {
      reconciler.updateContainerSync(element, fiberRoot, null, null);
      reconciler.flushSyncWork();
    },
    unmount() {
      reconciler.updateContainerSync(null, fiberRoot, null, null);
      reconciler.flushSyncWork();
    },
  };
}

/** Runs `callback` and commits the updates it made before returning. */
export function flushSync(callback) {
  return reconciler.flushSyncFromReconciler(callback);
}

export { WebView } from "./webview.js";
/** Renders `children` into `container`, a @silkui/core node outside this part of the tree. */
export function createPortal(children, container, key = null) {
  return reconciler.createPortal(children, container, null, key == null ? null : String(key));
}

// The automatic JSX runtime takes `createElement` from the import source for an element with
// both spread props and a key.
export { createElement } from "react";
/** A bounded scroll box whose mounted rows are requested by the retained tree. */
export function VirtualList({ items, itemKey, children, style, rowHeight, estimatedRowHeight, overscan, gap, revision }) {
  const port = useRef(null);
  const [indices, setIndices] = useState([]);
  const count = items.length;
  const estimate = estimatedRowHeight ?? (typeof rowHeight === "number" ? rowHeight : 48);
  useLayoutEffect(() => {
    port.current.setVirtualList({ count, estimatedRowHeight: estimate, overscan, gap, revision },
      wanted => flushSync(() => setIndices(wanted)));
  }, [count, estimate, overscan, gap, revision]);
  const mounted = indices.filter(i => i < count);
  useLayoutEffect(() => { port.current.bindVirtualRows(mounted); });
  return createElement("box", { ref: port, role: "list",
    style: { ...style, display: "flex", flexDirection: "column", overflowY: "auto" } },
    mounted.map(i => {
      const item = items[i];
      const height = typeof rowHeight === "function" ? rowHeight(item, i) : rowHeight;
      return createElement("box", { key: itemKey(item, i), role: "listitem",
        "aria-posinset": i + 1, "aria-setsize": count, style: { height, flexShrink: 0 } }, children(item, i));
    }));
}
