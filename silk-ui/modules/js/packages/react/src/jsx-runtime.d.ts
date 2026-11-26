// JSX for the tree's node kinds. With `"jsxImportSource": "@silkui/react"`, TypeScript
// checks <box>, <input>, <richinput>, <image>, <canvas> and inline <svg> against
// these props.
import type { Key, Ref, ReactNode, JSX as ReactJSX } from "react";
import type * as Silk from "@silkui/core";

export { Fragment, jsx, jsxs } from "react/jsx-runtime";
export { jsxDEV } from "react/jsx-dev-runtime";

type SilkTags = "input" | "image" | "img" | "canvas" | "svg" | "path" | "circle" | "ellipse" | "line" | "polyline" | "polygon" | "rect" | "g" | "defs" | "use" | "symbol" | "title" | "desc" | "text" | "tspan" | "textPath" | "linearGradient" | "radialGradient" | "stop" | "pattern" | "clipPath" | "mask" | "marker" | "filter" | "feGaussianBlur" | "feOffset" | "feBlend" | "feColorMatrix" | "feComposite" | "feFlood" | "feMerge" | "feMergeNode" | "feDropShadow" | "animate" | "animateTransform" | "animateMotion" | "set" | "foreignObject";

/** Handlers by prop name; each also takes a `Capture` suffix for the capture phase. */
interface Handlers<T extends Silk.Node> {
  onPointerDown: Silk.PointerButtonEvent;
  onPointerUp: Silk.PointerButtonEvent;
  onClick: Silk.PointerButtonEvent;
  onPointerMove: Silk.PointerEvent;
  onPointerEnter: Silk.PointerEvent;
  onPointerLeave: Silk.PointerEvent;
  onPointerCancel: Silk.PointerEvent;
  onPointerOver: Silk.PointerEvent;
  onPointerOut: Silk.PointerEvent;
  onTouchStart: Silk.TouchEvent;
  onTouchMove: Silk.TouchEvent;
  onTouchEnd: Silk.TouchEvent;
  onTouchCancel: Silk.TouchEvent;
  onMouseDown: Silk.MouseEvent;
  onMouseUp: Silk.MouseEvent;
  onMouseMove: Silk.MouseEvent;
  onMouseOver: Silk.MouseEvent;
  onMouseOut: Silk.MouseEvent;
  onMouseEnter: Silk.MouseEvent;
  onMouseLeave: Silk.MouseEvent;
  onWheel: Silk.WheelEvent;
  onKeyDown: Silk.KeyboardEvent;
  onKeyUp: Silk.KeyboardEvent;
  onFocus: Silk.Event;
  onBlur: Silk.Event;
  onInput: Silk.InputEvent<T>;
  onSelectionChange: Silk.SelectionEvent<T>;
  onCopy: Silk.ClipboardEvent;
  onCut: Silk.ClipboardEvent;
  onPaste: Silk.ClipboardEvent;
  onBeforeInput: Silk.BeforeInputEvent<T>;
  onScroll: Silk.ScrollEvent;
  onLayout: Silk.LayoutEvent;
  onGotPointerCapture: Silk.Event;
  onLostPointerCapture: Silk.Event;
  onLoad: Silk.Event;
  onError: Silk.Event;
  onTransitionRun: Silk.TransitionEvent;
  onTransitionStart: Silk.TransitionEvent;
  onTransitionEnd: Silk.TransitionEvent;
  onTransitionCancel: Silk.TransitionEvent;
  onAnimationStart: Silk.AnimationEvent;
  onAnimationIteration: Silk.AnimationEvent;
  onAnimationEnd: Silk.AnimationEvent;
  onAnimationCancel: Silk.AnimationEvent;
}

type EventProps<T extends Silk.Node> = { [K in keyof Handlers<T>]?: ((event: Handlers<T>[K]) => void) | undefined } & {
  [K in keyof Handlers<T> as `${K}Capture`]?: ((event: Handlers<T>[K]) => void) | undefined;
};

type AriaProps = { [name: `aria-${string}`]: string | number | boolean | undefined };

export type SilkProps<T extends Silk.Node = Silk.Node> = EventProps<T> & AriaProps & { [name: `data-${string}`]: string | number | boolean | undefined } & BaseProps<T>;

interface BaseProps<T extends Silk.Node> {
  key?: Key | null | undefined;
  ref?: Ref<T> | undefined;
  children?: ReactNode | undefined;
  style?: Silk.Style | undefined;
  hoverStyle?: Silk.Style | undefined;
  activeStyle?: Silk.Style | undefined;
  focusStyle?: Silk.Style | undefined;
  focusVisibleStyle?: Silk.Style | undefined;
  /** What transitions start from when the node first shows, as `@starting-style`. */
  startingStyle?: Silk.Style | undefined;
  id?: string | undefined;
  className?: string | undefined;
  role?: string | undefined;
  tabIndex?: number | undefined;
  testId?: string | undefined;
  label?: string | undefined;
  disabled?: boolean | undefined;
  inert?: boolean | undefined;
  focusTrap?: boolean | undefined;
  /** CSS cursor keyword. */
  cursor?: string | undefined;
  /** Makes the node a link: an unprevented click on it or inside it opens the address. */
  href?: string | undefined;
}

export type InputProps = SilkProps<Silk.Input> & {
  /** Controlled, as in React DOM. */
  value?: string | undefined;
  defaultValue?: string | undefined;
  placeholder?: string | undefined;
  multiline?: boolean | undefined;
  readOnly?: boolean | undefined;
};

export type RichInputProps = SilkProps<Silk.RichInput> & {
  /** Controlled, as `value` on <input>. */
  document?: Partial<Silk.RichDocument> | undefined;
  defaultDocument?: Partial<Silk.RichDocument> | undefined;
  /** What text with each mark looks like. */
  marks?: Record<string, Silk.Style> | undefined;
  /** What atoms of each kind look like. */
  atoms?: Record<string, Silk.Style> | undefined;
  placeholder?: string | undefined;
  multiline?: boolean | undefined;
  readOnly?: boolean | undefined;
};

export type ImageProps = SilkProps<Silk.Image> & {
  /** The address: a `data:` URL (base64 or percent-encoded), a file or `http(s):`. */
  src?: string | undefined;
  /** The text a screen reader reads for it. */
  alt?: string | undefined;
};

/** SVG attributes, in React DOM's spellings (`strokeWidth`, `fillRule`, `xlinkHref`). */
type SvgAttributes = { [name: string]: string | number | boolean | undefined | null | object };

/** The root `<svg>`: a node, with SVG attributes as its markup. */
export type SvgProps = SilkProps<Silk.Svg> & SvgAttributes;

/** An element inside an `<svg>`: markup alone, so it takes no handlers, look or ref. */
export type SvgElementProps = SvgAttributes & {
  key?: Key | null | undefined;
  ref?: Ref<Silk.SvgElement> | undefined;
  children?: ReactNode | undefined;
};

export namespace JSX {
  type ElementType = ReactJSX.ElementType;
  interface Element extends ReactJSX.Element {}
  interface ElementClass extends ReactJSX.ElementClass {}
  interface ElementAttributesProperty extends ReactJSX.ElementAttributesProperty {}
  interface ElementChildrenAttribute extends ReactJSX.ElementChildrenAttribute {}
  type LibraryManagedAttributes<C, P> = ReactJSX.LibraryManagedAttributes<C, P>;
  interface IntrinsicAttributes extends ReactJSX.IntrinsicAttributes {}
  interface IntrinsicClassAttributes<T> extends ReactJSX.IntrinsicClassAttributes<T> {}
  // HTML elements take React DOM's props (see the package README for what they do here).
  interface IntrinsicElements extends Omit<ReactJSX.IntrinsicElements, SilkTags> {
    box: SilkProps;
    input: InputProps;
    richinput: RichInputProps;
    image: ImageProps;
    img: ImageProps;
    canvas: SilkProps;
    svg: SvgProps;
    path: SvgElementProps;
    circle: SvgElementProps;
    ellipse: SvgElementProps;
    line: SvgElementProps;
    polyline: SvgElementProps;
    polygon: SvgElementProps;
    rect: SvgElementProps;
    g: SvgElementProps;
    defs: SvgElementProps;
    use: SvgElementProps;
    symbol: SvgElementProps;
    title: SvgElementProps;
    desc: SvgElementProps;
    text: SvgElementProps;
    tspan: SvgElementProps;
    textPath: SvgElementProps;
    linearGradient: SvgElementProps;
    radialGradient: SvgElementProps;
    stop: SvgElementProps;
    pattern: SvgElementProps;
    clipPath: SvgElementProps;
    mask: SvgElementProps;
    marker: SvgElementProps;
    filter: SvgElementProps;
    feGaussianBlur: SvgElementProps;
    feOffset: SvgElementProps;
    feBlend: SvgElementProps;
    feColorMatrix: SvgElementProps;
    feComposite: SvgElementProps;
    feFlood: SvgElementProps;
    feMerge: SvgElementProps;
    feMergeNode: SvgElementProps;
    feDropShadow: SvgElementProps;
    animate: SvgElementProps;
    animateTransform: SvgElementProps;
    animateMotion: SvgElementProps;
    set: SvgElementProps;
    foreignObject: SvgElementProps;
  }
}
