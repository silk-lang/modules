/** A constructed stylesheet. Text loading requires runtime stylesheet compilation in the host. */
export class CSSStyleSheet {
  static fromCompiled(bytes: Uint8Array | ArrayBuffer | string): CSSStyleSheet;
  replaceCompiled(bytes: Uint8Array | ArrayBuffer | string): void;
  replaceSync(text: string): void;
  replace(text: string): Promise<CSSStyleSheet>;
}
/** Used by build tools to replace or remove a compiled CSS import without restarting the app. */
export function updateStyleSheet(id: string, compiled: Uint8Array | ArrayBuffer | string | null): void;

import type * as CSS from "csstype";

/** The node kinds of the tree. `richinput` is an `input` with marks and atoms. */
export type NodeKind = "box" | "text" | "input" | "richinput" | "image" | "canvas" | "svg";

/** The looks a state lays over the base look: `:hover`, `:active`, `:focus`, `:focus-visible`, `@starting-style`. */
export type LookState = "base" | "hover" | "active" | "focus" | "focusVisible" | "starting";

/**
 * Style properties by their camel case names. Numbers are CSS pixels except for unitless
 * properties (`opacity`, `flexGrow`, `zIndex`, `fontWeight`, `lineHeight` and the like).
 * `null`, `undefined` and `""` take a property out.
 */
export type Style = {
  [K in keyof CSS.Properties<string | number>]?: CSS.Properties<string | number>[K] | null;
};

/** The declarations of one look of a node. */
export interface Look {
  /** Sets properties over the ones the look has. */
  set(properties: Style): void;
  /** Replaces the whole look. */
  replace(properties: Style): void;
  /** A property as the tree got it, in CSS text (`"120px"`). */
  get(name: keyof Style): string | undefined;
  /** CSSOM's: by CSS name (`background-color`) or custom property (`--accent`). */
  setProperty(name: string, value: string | null, priority?: string): void;
  getPropertyValue(name: string): string;
  removeProperty(name: string): string;
  getPropertyPriority(name: string): string;
  readonly cssText: string;
}

export type Listener<E extends Event = Event> = ((this: Node, event: E) => void) | { handleEvent(event: E): void };
/** What `signal` needs from an `AbortSignal`. */
export interface ListenerSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
}
export type ListenerOptions = boolean | { capture?: boolean; once?: boolean; signal?: ListenerSignal };

/** Live tokens in a node's class attribute. */
export class ClassList implements Iterable<string> {
  constructor(node: Node);
  value: string;
  readonly length: number;
  item(index: number): string | null;
  contains(token: string): boolean;
  add(...tokens: string[]): void;
  remove(...tokens: string[]): void;
  toggle(token: string, force?: boolean): boolean;
  replace(oldToken: string, newToken: string): boolean;
  values(): IterableIterator<string>;
  keys(): IterableIterator<number>;
  entries(): IterableIterator<[number, string]>;
  forEach(callback: (value: string, index: number, list: ClassList) => void, thisArg?: unknown): void;
  [Symbol.iterator](): IterableIterator<string>;
  toString(): string;
}

export interface VirtualListOptions {
  count: number;
  estimatedRowHeight: number;
  overscan?: number;
  gap?: number;
  revision?: number;
}

/** A node of the tree. Make one with `createBox`, `createText`, `createInput` or `createNode`. */
export class Node {
  constructor(kind: NodeKind);
  /** Stable protocol identifier, independent of the CSS id attribute. */
  readonly nodeId: number;
  id: string;
  className: string;
  adoptedStyleSheets: CSSStyleSheet[];
  readonly classList: ClassList;
  /** The `data-*` attributes by camelCase name, as `HTMLElement.dataset`. */
  readonly dataset: Record<string, string | undefined>;
  readonly kind: NodeKind;
  readonly parentNode: Node | null;
  readonly childNodes: readonly Node[];
  readonly firstChild: Node | null;
  readonly lastChild: Node | null;
  readonly nextSibling: Node | null;
  readonly previousSibling: Node | null;
  /** 1 for an element, 3 for text, 11 for a document fragment, as in the DOM. */
  readonly nodeType: 1 | 3 | 11;
  /** Whether the node is in the mounted tree. */
  readonly isConnected: boolean;
  hasChildNodes(): boolean;
  /** A copy with the same looks and attributes, and with `deep` copies of the children. */
  cloneNode(deep?: boolean): this;
  /** Joins adjacent text children and drops empty ones, in the whole subtree. */
  normalize(): void;
  /** Whether `other` is this node or inside it. */
  contains(other: Node | null): boolean;
  /** Puts `node` where `child` is and detaches `child`. */
  replaceChild<T extends Node>(node: Node, child: T): T;
  /** Inserts `child` before `before`, or last without it. A child already in the tree moves. */
  insertBefore<T extends Node>(child: T, before?: Node | null): T;
  appendChild<T extends Node>(child: T): T;
  /** Appends nodes, and strings as text nodes. */
  append(...children: (Node | string)[]): void;
  /** Detaches `child` and its subtree. It keeps its state and can be inserted again. */
  removeChild<T extends Node>(child: T): T;
  remove(): void;
  /** Detaches and frees this node and its subtree. They cannot be used again. */
  destroy(): void;
  /** The base look: `node.style.set({ width: 120 })` sets properties, `node.style = { ... }` replaces it. */
  get style(): Look;
  set style(properties: Style);
  /** The look the tree lays over the base in `state`. */
  look(state: LookState): Look;
  /**
   * Sets a tree attribute (`tabIndex`, `disabled`, `label`, `testId`, `placeholder`, `href`,
   * `cursor`, `multiline`, `readOnly`, `inert`, `focusTrap`, `transition`), `id`, `role`, or
   * an ARIA attribute spelled `aria-checked` or `ariaChecked`, or a `data-*` attribute.
   * `null` and `undefined` remove an attribute.
   */
  setAttribute(name: string, value: unknown): void;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  removeAttribute(name: string): void;
  set tabIndex(value: number);
  set disabled(value: boolean);
  focus(): void;
  /** As DOM `setPointerCapture`: throws `NotFoundError` for a pointer that is not down. */
  setPointerCapture(pointerId: number): void;
  releasePointerCapture(pointerId: number): void;
  hasPointerCapture(pointerId: number): boolean;
  scrollTo(x: number, y: number): void;
  scrollTo(options: ScrollToOptions): void;
  scroll(x: number, y: number): void;
  scroll(options: ScrollToOptions): void;
  scrollBy(x: number, y: number): void;
  scrollBy(options: ScrollToOptions): void;
  /** `true` or nothing aligns to the start, `false` to the end. */
  scrollIntoView(options?: boolean | ScrollIntoViewOptions): void;
  scrollIntoViewIfNeeded(center?: boolean): void;
  /** Layout reads: each lays out first when something changed, as a browser does. */
  getBoundingClientRect(): DOMRect;
  getClientRects(): DOMRect[] & { item(index: number): DOMRect | null };
  readonly clientLeft: number;
  readonly clientTop: number;
  readonly clientWidth: number;
  readonly clientHeight: number;
  readonly scrollWidth: number;
  readonly scrollHeight: number;
  scrollLeft: number;
  scrollTop: number;
  readonly offsetParent: Node | null;
  readonly offsetLeft: number;
  readonly offsetTop: number;
  readonly offsetWidth: number;
  readonly offsetHeight: number;
  /** Whether this node matches CSS `selector`, by the stylesheet matcher. Throws a SyntaxError for an invalid selector. */
  matches(selector: string): boolean;
  webkitMatchesSelector(selector: string): boolean;
  /** This node or its nearest ancestor that matches `selector`. */
  closest(selector: string): Node | null;
  /** The first descendant, in tree order, that matches `selector`. */
  querySelector(selector: string): Node | null;
  /** Every descendant that matches `selector`, in tree order (a static list). */
  querySelectorAll(selector: string): Node[];
  setVirtualList(options: VirtualListOptions, onRange: (indices: number[]) => void): void;
  setVirtualList(options: null): void;
  bindVirtualRows(indices: readonly number[]): void;
  addEventListener<K extends keyof EventMap>(type: K, listener: Listener<EventMap[K]>, options?: ListenerOptions): void;
  /** The app's own event types, sent with `dispatchEvent`. */
  addEventListener(type: string, listener: (event: globalThis.Event) => void, options?: ListenerOptions): void;
  removeEventListener<K extends keyof EventMap>(type: K, listener: Listener<EventMap[K]>, options?: ListenerOptions): void;
  removeEventListener(type: string, listener: (event: globalThis.Event) => void, options?: ListenerOptions): void;
  /** Sends `event` through the tree from this node, as on the web. False when a listener prevented the default. */
  dispatchEvent(event: globalThis.Event): boolean;
}

/** `<style>` (from `createElement("style")`): its text is a stylesheet while it is in the document. */
export class StyleElement extends Node {
  /** The element's stylesheet while it is in the document, else null. */
  readonly sheet: CSSStyleSheet | null;
}

/** A text leaf. It takes its look from its parent. */
export class Text extends Node {
  constructor(data?: string);
  data: string;
  nodeValue: string;
  textContent: string;
  /** In UTF-16 code units. */
  readonly length: number;
  substringData(offset: number, count: number): string;
  appendData(data: string): void;
  insertData(offset: number, data: string): void;
  deleteData(offset: number, count: number): void;
  replaceData(offset: number, count: number, data: string): void;
  /** Splits at `offset`: this keeps the text before it, and a new next sibling the rest. */
  splitText(offset: number): Text;
}

/** Nodes held together outside the tree. Inserting it inserts its children and empties it. */
export class DocumentFragment extends Node {
  constructor();
}

export function createDocumentFragment(): DocumentFragment;

/** Two boundary points: a node and an offset (a child index, or UTF-16 units in text). */
export abstract class AbstractRange {
  readonly startContainer: Node;
  readonly startOffset: number;
  readonly endContainer: Node;
  readonly endOffset: number;
  readonly collapsed: boolean;
}

export interface StaticRangeInit {
  startContainer: Node;
  startOffset: number;
  endContainer: Node;
  endOffset: number;
}

/** A range that does not follow changes to the tree. */
export class StaticRange extends AbstractRange {
  constructor(init: StaticRangeInit);
}

/** A live range over the app's nodes, as the DOM Standard defines it. */
export class Range extends AbstractRange {
  static readonly START_TO_START: 0;
  static readonly START_TO_END: 1;
  static readonly END_TO_END: 2;
  static readonly END_TO_START: 3;
  readonly START_TO_START: 0;
  readonly START_TO_END: 1;
  readonly END_TO_END: 2;
  readonly END_TO_START: 3;
  /** Collapsed at the start of the mounted root. */
  constructor();
  readonly commonAncestorContainer: Node;
  setStart(node: Node, offset: number): void;
  setEnd(node: Node, offset: number): void;
  setStartBefore(node: Node): void;
  setStartAfter(node: Node): void;
  setEndBefore(node: Node): void;
  setEndAfter(node: Node): void;
  collapse(toStart?: boolean): void;
  selectNode(node: Node): void;
  selectNodeContents(node: Node): void;
  compareBoundaryPoints(how: 0 | 1 | 2 | 3, sourceRange: Range): -1 | 0 | 1;
  comparePoint(node: Node, offset: number): -1 | 0 | 1;
  isPointInRange(node: Node, offset: number): boolean;
  intersectsNode(node: Node): boolean;
  cloneRange(): Range;
  detach(): void;
  deleteContents(): void;
  extractContents(): DocumentFragment;
  cloneContents(): DocumentFragment;
  insertNode(node: Node): void;
  surroundContents(newParent: Node): void;
  toString(): string;
  getClientRects(): DOMRect[];
  getBoundingClientRect(): DOMRect;
}

/** A new live range, collapsed at the start of the root. */
export function createRange(): Range;

/**
 * The document's selection, which the tree keeps (presses, drags, keys) and scripts can read
 * and change. Its ranges are live, in tree order: one, or one per piece seen when the
 * selection crosses children that layout reorders.
 */
export class Selection {
  private constructor();
  readonly anchorNode: Node | null;
  readonly anchorOffset: number;
  readonly focusNode: Node | null;
  readonly focusOffset: number;
  readonly isCollapsed: boolean;
  readonly rangeCount: number;
  readonly type: "None" | "Caret" | "Range";
  readonly direction: "forward" | "backward" | "none";
  getRangeAt(index: number): Range;
  addRange(range: Range): void;
  removeRange(range: Range): void;
  removeAllRanges(): void;
  empty(): void;
  collapse(node: Node | null, offset?: number): void;
  setPosition(node: Node | null, offset?: number): void;
  collapseToStart(): void;
  collapseToEnd(): void;
  extend(node: Node, offset?: number): void;
  setBaseAndExtent(anchorNode: Node, anchorOffset: number, focusNode: Node, focusOffset: number): void;
  selectAllChildren(node: Node): void;
  deleteFromDocument(): void;
  containsNode(node: Node, allowPartialContainment?: boolean): boolean;
  getComposedRanges(): StaticRange[];
  /** The selected text as copying gives it. */
  toString(): string;
}

/** The document's selection. Also installed as `globalThis.getSelection`. */
export function getSelection(): Selection;

/**
 * An editable text field. `value` follows what the user types. Selection offsets are UTF-16
 * string indices, as on the web.
 */
export class Input extends Node {
  constructor();
  /** Setting a different value puts the caret at its end. */
  value: string;
  selectionStart: number;
  selectionEnd: number;
  selectionDirection: "forward" | "backward" | "none";
  /** Selects `start` to `end`; with `direction` "backward" the caret sits at `start`. */
  setSelectionRange(start: number, end: number, direction?: "forward" | "backward" | "none"): void;
  /** Selects the whole value. */
  select(): void;
  /** Replaces the selection with `replacement`. */
  setRangeText(replacement: string): void;
  /** Replaces `start` to `end` with `replacement` and places the selection by `selectionMode`. */
  setRangeText(
    replacement: string,
    start: number,
    end: number,
    selectionMode?: "select" | "start" | "end" | "preserve",
  ): void;
}

/** An inline atom of a rich input: a mention or a chip. */
export interface RichAtom {
  kind: string;
  label: string;
  data: string;
}

/** A styled run of a rich input's text. */
export interface RichMarks {
  start: number;
  end: number;
  marks: readonly string[];
}

/**
 * A rich input's content. Each atom sits in `text` as one `OBJECT` character; `atoms` lists
 * them in text order. Offsets are string indices.
 */
export interface RichDocument {
  text: string;
  marks: readonly RichMarks[];
  atoms: readonly RichAtom[];
}

/** Where an atom sits in a rich input's text: U+FFFC OBJECT REPLACEMENT CHARACTER. */
export const OBJECT: string;

/** A rich text field: marks and inline atoms over the text the user edits. */
export class RichInput extends Input {
  /** The marks text typed at the caret gets, as of the last change. */
  readonly activeMarks: readonly string[];
  /** Replacing it moves the caret to the end and forgets the undo history. */
  get document(): RichDocument;
  set document(document: Partial<RichDocument>);
  /** What text with mark `name` looks like. */
  defineMark(name: string, style: Style): void;
  /** What atoms of `kind` look like: the inline block holding the label. */
  defineAtom(kind: string, style: Style): void;
  /** Turns mark `name` on or off over the selection, or for the text typed next. */
  format(name: string, on?: boolean): void;
  toggleMark(name: string): void;
  /** Replaces the text from `start` to `end` with `atom`. */
  insertAtom(start: number, end: number, atom: RichAtom): void;
}

/**
 * An image, as an `<img>`: `src` is a `data:` URL, a file or `http(s):` address. An SVG
 * file draws as an inline `<svg>` does. It hears `load` and `error`.
 */
export class Image extends Node {
  constructor(src?: string);
  src: string;
}

/**
 * A canvas the application draws with WebGPU or Canvas 2D, as a `<canvas>`: `width` and
 * `height` are the drawing's size in pixels, `getContext("webgpu")` gives its
 * `GPUCanvasContext` (the types of `@webgpu/types` describe it) and `getContext("2d")` its
 * `CanvasRenderingContext2D`.
 */
export class Canvas extends Node {
  constructor();
  width: number;
  height: number;
  getContext(kind: "webgpu"): unknown | null;
  getContext(kind: "2d", options?: { alpha?: boolean }): unknown | null;
  getContext(kind: string): unknown | null;
}

/** Text inside an `<svg>`. */
export class SvgText {
  constructor(data?: string);
  data: string;
  textContent: string;
  readonly parentNode: SvgElement | Svg | null;
  remove(): void;
  destroy(): void;
}

/**
 * An element inside an `<svg>` (`path`, `g`, `circle`...): markup its root draws, no node.
 * Once the root has drawn, a change to its elements updates them one at a time.
 */
export class SvgElement {
  constructor(tag: string);
  readonly localName: string;
  readonly tagName: string;
  readonly namespaceURI: string;
  readonly parentNode: SvgElement | Svg | null;
  readonly childNodes: (SvgElement | SvgText | Text)[];
  textContent: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
  /** SVG's names, or React's spellings (`strokeWidth`, `xlinkHref`). */
  setAttribute(name: string, value: unknown): void;
  removeAttribute(name: string): void;
  setAttributeNS(namespace: string | null, name: string, value: unknown): void;
  getAttributeNS(namespace: string | null, name: string): string | null;
  removeAttributeNS(namespace: string | null, name: string): void;
  /** The `style` attribute as declarations: `element.style.display = "none"`. */
  readonly style: Record<string, string>;
  /**
   * Hears pointer events (`click`, `pointerdown`, `pointerenter`...) on its shapes, as on the
   * web; its `<svg>` turns live so the tree can tell which shape is under the pointer.
   */
  addEventListener<K extends keyof EventMap>(type: K, listener: Listener<EventMap[K]>, options?: ListenerOptions): void;
  addEventListener(type: string, listener: (event: globalThis.Event) => void, options?: ListenerOptions): void;
  removeEventListener<K extends keyof EventMap>(type: K, listener: Listener<EventMap[K]>, options?: ListenerOptions): void;
  removeEventListener(type: string, listener: (event: globalThis.Event) => void, options?: ListenerOptions): void;
  dispatchEvent(event: globalThis.Event): boolean;
  /** The box of its geometry in its own user space: a shape's fill, a group's children. */
  getBBox(): { x: number; y: number; width: number; height: number };
  /** The length of a shape's outline in user units. */
  getTotalLength(): number;
  /** The point `distance` along a shape's outline, clamped to its ends. */
  getPointAtLength(distance: number): { x: number; y: number };
  insertBefore<T extends SvgElement | SvgText | Text>(child: T, before?: SvgElement | SvgText | Text | null): T;
  appendChild<T extends SvgElement | SvgText | Text>(child: T): T;
  append(...children: (SvgElement | SvgText | Text | string)[]): void;
  removeChild<T extends SvgElement | SvgText | Text>(child: T): T;
  remove(): void;
  destroy(): void;
}

/**
 * An inline `<svg>`: one node drawing the markup its `SvgElement` children make, at its CSS
 * size (else its `width` and `height`, else a square of the font size), with its `color` as
 * `currentColor`. Class, look, events and ARIA are the node's; `viewBox`, `fill`, `width`
 * and the rest are markup. After its first draw, changes go to the tree element by element
 * and only the shapes that changed redraw, so scripts can animate it (lottie-web and the like).
 */
export class Svg extends Node {
  constructor();
  readonly outerHTML: string;
  setAttributeNS(namespace: string | null, name: string, value: unknown): void;
  getAttributeNS(namespace: string | null, name: string): string | null;
  /** The box of what it draws, in its user space (inside `viewBox`). */
  getBBox(): { x: number; y: number; width: number; height: number };
  textContent: string;
}

/** An event of the tree, with the members of the DOM event it corresponds to. */
export class Event {
  constructor(type: keyof EventMap, target: Node);
  readonly type: keyof EventMap;
  readonly target: Node;
  readonly currentTarget: Node | null;
  /** 0 none, 1 capturing, 2 at the target, 3 bubbling. */
  readonly eventPhase: 0 | 1 | 2 | 3;
  readonly bubbles: boolean;
  readonly cancelable: boolean;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  /** The nodes the event passes, target first. */
  composedPath(): Node[];
}

export interface ModifierEvent extends Event {
  readonly shiftKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
}

export interface PointerEvent extends ModifierEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly x: number;
  readonly y: number;
  /** 1 for the mouse, 2 and up for touches. */
  readonly pointerId: number;
  readonly pointerType: "mouse" | "pen" | "touch";
  readonly isPrimary: boolean;
  /** -1 for `pointermove`, as on the web. */
  readonly button: number;
  readonly buttons: number;
  /** 0.5 while a button is down, 0 otherwise: no host reports pressure yet. */
  readonly pressure: number;
  readonly tangentialPressure: number;
  readonly tiltX: number;
  readonly tiltY: number;
  readonly twist: number;
  readonly altitudeAngle: number;
  readonly azimuthAngle: number;
  readonly width: number;
  readonly height: number;
  /** The event itself for `pointermove` (each host move is its own event), empty otherwise. */
  getCoalescedEvents(): PointerEvent[];
  getPredictedEvents(): PointerEvent[];
}

/** `pointerdown`, `pointerup` and `click`. */
export interface PointerButtonEvent extends PointerEvent {
  readonly button: number;
  /** The click count: 2 for a double click. */
  readonly detail: number;
}

/** A compatibility mouse event, after the pointer event of a mouse, or before a tap's click. */
export interface MouseEvent extends ModifierEvent {
  readonly clientX: number;
  readonly clientY: number;
  readonly x: number;
  readonly y: number;
  readonly button: number;
  readonly buttons: number;
  readonly detail: number;
}

/** One finger, as DOM `Touch`. No host reports contact size or force yet. */
export interface Touch {
  readonly identifier: number;
  /** The node the finger went down on, for as long as it stays down. */
  readonly target: Node;
  readonly clientX: number;
  readonly clientY: number;
  readonly pageX: number;
  readonly pageY: number;
  readonly screenX: number;
  readonly screenY: number;
  readonly radiusX: number;
  readonly radiusY: number;
  readonly rotationAngle: number;
  readonly force: number;
}

export interface TouchList extends ReadonlyArray<Touch> {
  item(index: number): Touch | null;
}

/**
 * As DOM `TouchEvent`, after the finger's pointer event. Preventing `touchstart` or a
 * `touchmove` before the tree pans keeps the gesture: no pan and no click.
 */
export interface TouchEvent extends ModifierEvent {
  readonly touches: TouchList;
  readonly targetTouches: TouchList;
  readonly changedTouches: TouchList;
}

export interface WheelEvent extends PointerEvent {
  readonly deltaX: number;
  readonly deltaY: number;
  readonly deltaZ: number;
  readonly deltaMode: number;
}

export interface KeyboardEvent extends ModifierEvent {
  readonly key: string;
  readonly code: string;
  readonly repeat: boolean;
}

/** An input or selection event's target: the field itself, or a field inside a node that listens. */
type FieldOf<T extends Node> = T extends Input ? T : Input;

export interface InputEvent<T extends Node = Input> extends Event {
  readonly target: FieldOf<T>;
  readonly value: string;
  readonly inputType: string;
  /** On a rich input: its document after the change. */
  readonly document: FieldOf<T> extends RichInput ? RichDocument : RichDocument | undefined;
}

export interface SelectionEvent<T extends Node = Input> extends Event {
  readonly target: FieldOf<T>;
  readonly selectionStart: number;
  readonly selectionEnd: number;
}

/**
 * A request to go back or forward (`navigate`), raised after Alt+Left, Cmd+[ or a mouse back
 * button that nothing prevented. It bubbles from the focused node; the listener that acts
 * stops it.
 */
export interface NavigateEvent extends Event {
  readonly navigationType: "traverse";
  readonly direction: "back" | "forward";
}

/** An edit about to change an input (`beforeinput`), as the web's `InputEvent`. Preventing it cancels the edit. */
export interface BeforeInputEvent<T extends Node = Input> extends Event {
  readonly target: FieldOf<T>;
  readonly inputType: string;
  /** The text the edit inserts. */
  readonly data: string | null;
  readonly dataTransfer: DataTransfer | null;
  readonly isComposing: boolean;
  getTargetRanges(): never[];
}

export interface ScrollEvent extends Event {
  readonly scrollLeft: number;
  readonly scrollTop: number;
}

/** Where layout put the node, in window pixels. */
export interface LayoutEvent extends Event {
  readonly bounds: { x: number; y: number; width: number; height: number };
}

export interface TransitionEvent extends Event {
  readonly propertyName: string;
  readonly elapsedTime: number;
  readonly pseudoElement: string;
}

export interface AnimationEvent extends Event {
  readonly animationName: string;
  readonly elapsedTime: number;
  readonly pseudoElement: string;
}

/** The events of the tree by type. */
export interface EventMap {
  pointerdown: PointerButtonEvent;
  pointerup: PointerButtonEvent;
  click: PointerButtonEvent;
  pointermove: PointerEvent;
  pointerenter: PointerEvent;
  pointerleave: PointerEvent;
  pointercancel: PointerEvent;
  pointerover: PointerEvent;
  pointerout: PointerEvent;
  touchstart: TouchEvent;
  touchmove: TouchEvent;
  touchend: TouchEvent;
  touchcancel: TouchEvent;
  mousedown: MouseEvent;
  mouseup: MouseEvent;
  mousemove: MouseEvent;
  mouseover: MouseEvent;
  mouseout: MouseEvent;
  mouseenter: MouseEvent;
  mouseleave: MouseEvent;
  wheel: WheelEvent;
  keydown: KeyboardEvent;
  keyup: KeyboardEvent;
  focus: Event;
  blur: Event;
  input: InputEvent;
  selectionchange: SelectionEvent;
  copy: ClipboardEvent;
  cut: ClipboardEvent;
  paste: ClipboardEvent;
  beforeinput: BeforeInputEvent;
  /** A request to close what is on top, raised after an Escape that nothing prevented. */
  closerequest: Event;
  navigate: NavigateEvent;
  scroll: ScrollEvent;
  layout: LayoutEvent;
  gotpointercapture: Event;
  lostpointercapture: Event;
  load: Event;
  error: Event;
  transitionrun: TransitionEvent;
  transitionstart: TransitionEvent;
  transitionend: TransitionEvent;
  transitioncancel: TransitionEvent;
  animationstart: AnimationEvent;
  animationiteration: AnimationEvent;
  animationend: AnimationEvent;
  animationcancel: AnimationEvent;
  dragenter: DragEvent;
  dragover: DragEvent;
  dragleave: DragEvent;
  drop: DragEvent;
}

export function createNode(kind: "text"): Text;
export function createNode(kind: "input"): Input;
export function createNode(kind: "richinput"): RichInput;
export function createNode(kind: "image" | "img"): Image;
export function createNode(kind: "canvas"): Canvas;
export function createNode(kind: "svg"): Svg;
export function createNode(kind: NodeKind): Node;

/** A box with `style` as its base look and `children` appended. */
export function createBox(style?: Style | null, ...children: (Node | string)[]): Node;
export function createText(data?: string): Text;
export function createInput(style?: Style | null): Input;
export function createRichInput(style?: Style | null): RichInput;
/** An image showing `src`, with `style` as its base look. */
export function createImage(src: string, style?: Style | null): Image;
/** `document.createElementNS` in the SVG namespace: an `Svg` for `svg`, else an `SvgElement`. */
export function createSvgElement(tag: "svg"): Svg;
export function createSvgElement(tag: string): SvgElement;
/** Draws the `<svg>`s that changed now, rather than before the host applies the batch. */
export function flushSvg(): void;

/**
 * Defines `@keyframes name`: `{ from: { opacity: 0 }, "50%": { ... }, to: { ... } }`.
 * Defining a name again replaces its rule.
 */
export function defineKeyframes(name: string, frames: Record<string, Style>): void;

/** Makes `node` the root of the window's tree. */
export function mount<T extends Node>(node: T): T;
export function root(): Node | null;

/** Has screen readers say `message` without showing it. */
export function announce(message: string, options?: { politeness?: "polite" | "assertive" }): void;

/** The node with tree id `id`, for hosts and tools. */
export function nodeById(id: number): Node | null;

/** Runs `event` through the tree as the DOM does. Returns false when a listener prevented the default. */
export function dispatchEvent(event: Event): boolean;

export interface MarkdownOptions {
  /** GitHub's tables, strikethrough, task lists and autolinks. Default true. */
  gfm?: boolean;
  tables?: boolean;
  strikethrough?: boolean;
  taskLists?: boolean;
  autolinkLiterals?: boolean;
  footnotes?: boolean;
  frontmatter?: boolean;
  /** `> [!NOTE]` blocks, as nodes of type `alert` with a `kind`. */
  alerts?: boolean;
}

/**
 * The syntax tree of Markdown `text` in the shape of mdast, without positions. Install
 * `@types/mdast` for its node types.
 */
export function parseMarkdown(text: string, options?: MarkdownOptions): import("mdast").Root;

/** What happens to an exception a listener throws. Without a handler, the host reports it. */
export function setErrorHandler(handler: ((error: unknown) => void) | null): void;

/** A file dragged in from the desktop, as the web's `File`, with its `path` on disk. */
export class DroppedFile {
  readonly name: string;
  readonly path: string;
  readonly type: string;
}

/** A file in a `DataTransfer` that is no file on disk, such as a pasted image: the runtime's `File`. */
export interface DataFile {
  readonly name: string;
  readonly type: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
}

/** One entry of a `DataTransfer`. */
export interface DataTransferItem {
  readonly kind: "string" | "file";
  readonly type: string;
  getAsString(callback: (value: string) => void): void;
  getAsFile(): DataFile | DroppedFile | null;
}

export interface DataTransferItemList extends Iterable<DataTransferItem> {
  readonly length: number;
  readonly [index: number]: DataTransferItem;
  add(data: string, type: string): DataTransferItem;
  add(file: DataFile | DroppedFile): DataTransferItem;
  remove(index: number): void;
  clear(): void;
}

/**
 * What a copy, cut, paste or file drag carries, as the web's. `new DataTransfer()` is empty
 * and writable; a paste's is read-only, and after its event none can be read.
 */
export class DataTransfer {
  constructor();
  readonly files: readonly (DataFile | DroppedFile)[];
  readonly items: DataTransferItemList;
  readonly types: readonly string[];
  dropEffect: string;
  effectAllowed: string;
  getData(format: string): string;
  setData(format: string, data: string): void;
  clearData(format?: string): void;
  setDragImage(image: unknown, x: number, y: number): void;
}

/**
 * A copy, cut or paste at the focused node, as the web's. A `copy` or `cut` listener that sets
 * data on `clipboardData` and prevents the default puts that data on the clipboard; a `paste`
 * listener reads what it holds (`text/plain`, `text/html`, a pasted PNG in `files`), and
 * preventing it keeps the paste out of the input.
 */
export class ClipboardEvent extends Event {
  constructor(type: string, init?: { bubbles?: boolean; cancelable?: boolean; composed?: boolean; clipboardData?: DataTransfer | null });
  readonly clipboardData: DataTransfer | null;
}

/** Files dragged from another app over the window (`dragenter`, `dragover`, `dragleave`, `drop`). */
export interface DragEvent extends Event {
  clientX: number;
  clientY: number;
  x: number;
  y: number;
  dataTransfer: DataTransfer;
}

export interface NotificationOptions {
  body?: string;
  tag?: string;
  data?: unknown;
}

/** A desktop notification, as the web's. Permission is always granted. */
export class Notification {
  static readonly permission: "granted";
  static requestPermission(callback?: (permission: "granted") => void): Promise<"granted">;
  constructor(title: string, options?: NotificationOptions);
  readonly title: string;
  readonly body: string;
  readonly tag: string;
  readonly data: unknown;
  onclick: ((event: { type: "click"; target: Notification }) => void) | null;
  onshow: ((event: { type: "show"; target: Notification }) => void) | null;
  onerror: ((event: { type: "error"; target: Notification }) => void) | null;
  onclose: ((event: { type: "close"; target: Notification }) => void) | null;
  close(): void;
  addEventListener(type: "click" | "show" | "error" | "close", listener: (event: { type: string; target: Notification }) => void): void;
  removeEventListener(type: "click" | "show" | "error" | "close", listener: (event: { type: string; target: Notification }) => void): void;
}

export type TrayMenuItem =
  | { label: string; click?: () => void; enabled?: boolean; checked?: boolean }
  | { type: "separator" }
  | { label: string; submenu: TrayMenuItem[] };

export interface TrayOptions {
  /** RGBA pixels, as an `ImageData`. 32 by 32 looks right everywhere. */
  icon: { width: number; height: number; data: ArrayLike<number> };
  tooltip?: string;
  /** macOS draws the icon from its alpha, in the menu bar's colours. */
  template?: boolean;
  menu?: TrayMenuItem[];
  /** Runs on a click when there is no menu. `button` is `MouseEvent.button`'s. */
  onClick?: (event: { button: number }) => void;
}

/** Shows an icon in the system tray; calling it again replaces it. Resolves to whether it shows. */
export function setTray(options: TrayOptions): Promise<boolean>;
export function removeTray(): void;

/**
 * Runs `callback` when `accelerator` (`"Mod+Shift+K"`; `Mod` is Command on macOS, Control
 * elsewhere) is pressed, whichever app has focus. Resolves to whether the system took it.
 */
export function registerShortcut(accelerator: string, callback: () => void): Promise<boolean>;

/** An event of a {@link WebView}; its other members depend on `type`. */
export class WebViewEvent {
  readonly type: string;
  readonly url?: string;
  readonly title?: string;
  readonly ok?: boolean;
  readonly error?: string;
  readonly progress?: number;
  readonly canGoBack?: boolean;
  readonly canGoForward?: boolean;
  readonly request?: number;
  readonly userInitiated?: boolean;
  readonly focused?: boolean;
  readonly level?: "debug" | "log" | "info" | "warning" | "error";
  readonly message?: string;
  readonly command?: string;
  readonly reason?: string;
}

export interface WebViewOptions {
  url?: string;
  /** A name keeps cookies and storage between runs; empty forgets them when the view closes. */
  profile?: string;
  /** Lets Web Inspector attach (default true). */
  inspectable?: boolean;
  /** Every main frame navigation waits for `answerNavigation`. */
  askBeforeNavigating?: boolean;
  /** The node's background shows until the page paints. */
  transparent?: boolean;
}

export interface WebViewScreenshot {
  width: number;
  height: number;
  /** RGBA, rows top first, device pixels. */
  data: Uint8Array;
}

/** A real browser page shown over a node (WKWebView on macOS). */
export class WebView {
  readonly id: number;
  readonly node: Node;
  readonly opened: Promise<boolean>;
  url: string;
  title: string;
  favicon: string;
  loading: boolean;
  progress: number;
  canGoBack: boolean;
  canGoForward: boolean;
  focused: boolean;
  addEventListener(type: string, listener: (event: WebViewEvent) => void): void;
  removeEventListener(type: string, listener: (event: WebViewEvent) => void): void;
  navigate(url: string): void;
  loadHtml(html: string, baseUrl?: string): void;
  back(): void;
  forward(): void;
  reload(): void;
  hardReload(): void;
  stop(): void;
  setZoom(factor: number): void;
  focus(): void;
  openDevTools(): void;
  setAudioMuted(muted: boolean): void;
  setColorScheme(scheme: "system" | "light" | "dark"): void;
  setShown(shown: boolean): void;
  evaluate(script: string): Promise<unknown>;
  snapshot(): Promise<string>;
  screenshot(): Promise<WebViewScreenshot>;
  clickElement(ref: string): Promise<void>;
  fillElement(ref: string, text: string): Promise<void>;
  clickAt(x: number, y: number, options?: { button?: number; clickCount?: number; modifiers?: number }): void;
  movePointer(x: number, y: number, options?: { modifiers?: number }): void;
  scroll(x: number, y: number, deltaX: number, deltaY: number, options?: { modifiers?: number }): void;
  typeText(text: string): void;
  pressKey(key: string, modifiers?: number): void;
  answerNavigation(request: number, allow: boolean): void;
  findInPage(text: string, options?: { forward?: boolean; newSession?: boolean }): Promise<{ matches: number; activeMatchOrdinal: number }>;
  stopFindInPage(): void;
  close(): void;
}

/** Shows a web view over `node`; the page covers its border box and follows it. */
export function createWebView(node: Node, options?: WebViewOptions): WebView;

/** Clears what the pages of a profile stored: cookies and site storage, the cache, or both. */
export function clearWebViewData(options?: { profile?: string; cookies?: boolean; cache?: boolean }): Promise<void>;

export function quit(code?: number): void;
export function unregisterShortcut(accelerator: string): void;

/** An item of `setApplicationMenu` or `showContextMenu`, as Electron's menu templates. */
export interface MenuItem {
  label?: string;
  click?: (item: MenuItem) => void;
  /** `"Mod+Shift+K"`, `"CmdOrCtrl+O"`, `"F5"`: `Mod` is Command on macOS, Control elsewhere. */
  accelerator?: string;
  enabled?: boolean;
  checked?: boolean;
  visible?: boolean;
  type?: "normal" | "separator" | "checkbox" | "radio" | "submenu";
  /**
   * The system's own items (`about`, `services`, `hide`, `hideOthers`, `unhide`, `quit`,
   * `close`, `minimize`, `zoom`, `togglefullscreen`, `front`, `undo`, `redo`, `cut`, `copy`,
   * `paste`, `selectAll`), the page zoom (`zoomIn`, `zoomOut`, `resetZoom`), or a whole menu
   * (`appMenu`, `fileMenu`, `editMenu`, `viewMenu`, `windowMenu`).
   */
  role?: string;
  submenu?: MenuItem[];
}

/** Replaces the app's menu bar. On macOS the first menu is the app menu. */
export function setApplicationMenu(template: MenuItem[]): Promise<void>;

/**
 * Opens a native context menu at `x`, `y` (CSS pixels in the window). Resolves to `true` when
 * it closes, or at once to `false` where the system has none and the app draws its own.
 */
export function showContextMenu(template: MenuItem[], position?: { x?: number; y?: number }): Promise<boolean>;

export interface FileFilter {
  name?: string;
  /** Without dots; `"*"` for every file. */
  extensions: string[];
}

export interface OpenDialogOptions {
  title?: string;
  defaultPath?: string;
  filters?: FileFilter[];
  properties?: Array<"openFile" | "openDirectory" | "multiSelections" | "createDirectory" | "showHiddenFiles">;
}

export interface SaveDialogOptions {
  title?: string;
  /** A folder, a file name, or a path to a file. */
  defaultPath?: string;
  filters?: FileFilter[];
}

export function showOpenDialog(options?: OpenDialogOptions): Promise<{ canceled: boolean; filePaths: string[] }>;
export function showSaveDialog(options?: SaveDialogOptions): Promise<{ canceled: boolean; filePath: string }>;

/** Puts `text` on the dock or taskbar icon; `""` takes it off. Resolves to whether it shows. */
export function setBadge(text: string): Promise<boolean>;
/** Progress from 0 to 1 on the dock or taskbar icon; negative takes it off. */
export function setProgress(fraction: number): Promise<boolean>;
/** Opens `url` with the system's handler (the default browser for a web page). */
export function openExternal(url: string): Promise<boolean>;
/** Shows the file or folder at `path` selected in Finder, Explorer or the file manager. */
export function showItemInFolder(path: string): Promise<boolean>;
/**
 * Drags the files at `paths` out to other apps; call it from `pointerdown` or `pointermove`
 * while the button is down. Resolves to whether it started (macOS and Windows).
 */
export function startFileDrag(paths: string | string[]): Promise<boolean>;

/** The window the app runs in. */
export interface AppWindow {
  readonly fullScreen: boolean;
  /** The page zoom, 1 at 100%. */
  readonly zoomFactor: number;
  setFullScreen(on: boolean): void;
  toggleFullScreen(): void;
  isFullScreen(): boolean;
  minimize(): void;
  /** Shows the window and brings it to the front with keyboard focus. */
  focus(): void;
  show(): void;
  hide(): void;
  setTitle(title: string): void;
  /** From 0.25 to 5; resolves to the zoom now. */
  setZoomFactor(zoom: number): Promise<number>;
  getZoomFactor(): number;
  addEventListener(type: "fullscreenchange", listener: (event: { type: "fullscreenchange"; fullScreen: boolean }) => void): void;
  addEventListener(type: "zoomchange", listener: (event: { type: "zoomchange"; zoomFactor: number }) => void): void;
  removeEventListener(type: "fullscreenchange" | "zoomchange", listener: (event: never) => void): void;
}

export const appWindow: AppWindow;

/** The app's memory: `footprint` in bytes over `processes` processes. */
export interface MemoryUsage {
  footprint: number;
  processes: number;
}

/**
 * The app's memory as the system shows it to users (macOS `phys_footprint`, Linux `Pss`,
 * Windows `PrivateUsage`). In the browser, the wasm tree's linear memory only. Cheap enough
 * to call every second; `null` when the host cannot say.
 */
export function memoryUsage(): MemoryUsage | null;

/**
 * The values the tree resolved for `node`, read one property at a time: typed and animated
 * properties as they are now, box sizes, margins, padding and border widths as laid out, the
 * rest as cascaded with lengths in pixels. Shorthands, custom properties and pseudo-elements
 * read "". Also installed as `globalThis.getComputedStyle`.
 */
export function getComputedStyle(node: Node | { node: Node }, pseudo?: string | null): ComputedStyle;

/**
 * `CSS.supports`, answered as the tree's `@supports` answers. Also installed as
 * `globalThis.CSS.supports`.
 */
export function supports(property: string, value: string): boolean;
export function supports(conditionText: string): boolean;

/** What `getComputedStyle` returns: read-only, live, a value per camelCase property name. */
export type ComputedStyle = {
  getPropertyValue(name: string): string;
  getPropertyPriority(name: string): string;
  item(index: number): string;
  readonly cssText: string;
  readonly length: number;
} & { readonly [property: string]: string };

/** What the window put on screen over a stretch of time; see `frameStats`. */
export interface FrameStats {
  /** Frames presented. */
  frames: number;
  /** `frames` per second over the stretch. */
  fps: number;
  /** Painted frames a newer frame replaced before the GPU drew them. */
  dropped: number;
  /** Milliseconds between presents: median, 95th and 99th percentile, longest. */
  p50: number;
  p95: number;
  p99: number;
  max: number;
}

/**
 * The frames the window presented since the last call (since the app started, the first
 * time), which `requestAnimationFrame` cannot count. Cheap enough to call every second;
 * `null` in a browser build.
 */
export function frameStats(): FrameStats | null;

export type ScrollBehavior = "auto" | "instant" | "smooth";
export type ScrollLogicalPosition = "start" | "center" | "end" | "nearest";

export interface ScrollToOptions {
  left?: number;
  top?: number;
  /** `auto` follows the node's `scroll-behavior`. */
  behavior?: ScrollBehavior;
}

export interface ScrollIntoViewOptions {
  block?: ScrollLogicalPosition;
  inline?: ScrollLogicalPosition;
  behavior?: ScrollBehavior;
}

/** As `DOMRect` on the web. Also installed as `globalThis.DOMRect` when there is none. */
export class DOMRect {
  constructor(x?: number, y?: number, width?: number, height?: number);
  x: number;
  y: number;
  width: number;
  height: number;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  toJSON(): { x: number; y: number; width: number; height: number; top: number; right: number; bottom: number; left: number };
}

/** The topmost node at window point `x`, `y`. */
export function elementFromPoint(x: number, y: number): Node | null;
/** Every node at window point `x`, `y`, topmost first. */
export function elementsFromPoint(x: number, y: number): Node[];
/** The text position at window point `x`, `y`, the offset in UTF-16 units. */
export function caretPositionFromPoint(x: number, y: number): { offsetNode: Node | null; offset: number; getClientRect(): DOMRect } | null;
/** `Range.getClientRects` for the text from (`startNode`, `startOffset`) to (`endNode`, `endOffset`), offsets in UTF-16 units. */
export function rangeClientRects(startNode: Node, startOffset: number, endNode: Node, endOffset: number): DOMRect[];
/** `Range.getBoundingClientRect` for the same range. */
export function rangeBoundingClientRect(startNode: Node, startOffset: number, endNode: Node, endOffset: number): DOMRect;

type Observable = Node | { node: Node };

export interface IntersectionObserverInit {
  /** A node, or null for the window. */
  root?: Observable | null;
  rootMargin?: string;
  scrollMargin?: string;
  threshold?: number | number[];
}

export class IntersectionObserverEntry {
  readonly time: number;
  readonly target: Observable;
  readonly isIntersecting: boolean;
  readonly isVisible: boolean;
  readonly intersectionRatio: number;
  readonly boundingClientRect: DOMRect;
  readonly intersectionRect: DOMRect;
  readonly rootBounds: DOMRect | null;
}

/** As on the web. Entries come after a layout or scroll in which a target crossed a threshold. Also installed as `globalThis.IntersectionObserver`. */
export class IntersectionObserver {
  constructor(callback: (entries: IntersectionObserverEntry[], observer: IntersectionObserver) => void, options?: IntersectionObserverInit);
  readonly root: Observable | null;
  readonly rootMargin: string;
  readonly scrollMargin: string;
  readonly thresholds: readonly number[];
  observe(target: Observable): void;
  unobserve(target: Observable): void;
  disconnect(): void;
  takeRecords(): IntersectionObserverEntry[];
}

export interface ResizeObserverSize {
  readonly inlineSize: number;
  readonly blockSize: number;
}

export class ResizeObserverEntry {
  readonly target: Observable;
  readonly contentRect: DOMRect;
  readonly borderBoxSize: readonly ResizeObserverSize[];
  readonly contentBoxSize: readonly ResizeObserverSize[];
  readonly devicePixelContentBoxSize: readonly ResizeObserverSize[];
}

/** As on the web. Entries come after a layout that changed an observed box. Also installed as `globalThis.ResizeObserver`. */
export class ResizeObserver {
  constructor(callback: (entries: ResizeObserverEntry[], observer: ResizeObserver) => void);
  observe(target: Observable, options?: { box?: "content-box" | "border-box" | "device-pixel-content-box" }): void;
  unobserve(target: Observable): void;
  disconnect(): void;
}

/** Has events that reach the root go on to `targets` (outermost last), each with `_run(event, capture)`, as `@silkui/core/globals` does for `document` and `window`. */
export function setOuterTargets(...targets: { _run(event: Event, capture: boolean): void }[]): void;

export interface MutationObserverInit {
  childList?: boolean;
  attributes?: boolean;
  characterData?: boolean;
  subtree?: boolean;
  attributeOldValue?: boolean;
  characterDataOldValue?: boolean;
  attributeFilter?: string[];
}

export interface MutationRecord {
  readonly type: "childList" | "attributes" | "characterData";
  readonly target: Node;
  readonly addedNodes: Node[];
  readonly removedNodes: Node[];
  readonly previousSibling: Node | null;
  readonly nextSibling: Node | null;
  readonly attributeName: string | null;
  readonly attributeNamespace: null;
  readonly oldValue: string | null;
}

/** As in the DOM, for the tree's nodes. Records come in one microtask after the mutations. */
export class MutationObserver {
  constructor(callback: (records: MutationRecord[], observer: MutationObserver) => void);
  observe(target: Node, options?: MutationObserverInit): void;
  disconnect(): void;
  takeRecords(): MutationRecord[];
}
