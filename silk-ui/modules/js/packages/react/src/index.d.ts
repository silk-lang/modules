import type { ReactNode } from "react";
import type { Node, WebView as CoreWebView, WebViewEvent } from "@silkui/core";

export interface Root {
  /** Renders `element`; the commit is done when it returns, so a window's first frame has it. */
  render(element: ReactNode): void;
  /** Unmounts what the root rendered. */
  unmount(): void;
}

/**
 * A React root in `container`, a @silkui/core node. Without one it renders into the root of
 * the window's tree, mounting a new box when there is none.
 */
export function createRoot(container?: Node): Root;

/** Runs `callback` and commits the updates it made before returning. */
export function flushSync<T>(callback: () => T): T;

/** The props of {@link WebView}; the rest go to its box. */
export interface WebViewProps {
  /** The page; changing it navigates. */
  src?: string;
  /** Fixed for the view's life: a name keeps cookies and storage between runs. */
  profile?: string;
  inspectable?: boolean;
  askBeforeNavigating?: boolean;
  transparent?: boolean;
  /** Page zoom, 1 for 100%. */
  zoom?: number;
  colorScheme?: "system" | "light" | "dark";
  muted?: boolean;
  /** A hidden view keeps its page. */
  shown?: boolean;
  ref?: import("react").Ref<CoreWebView | null>;
  onLoadStart?: (event: WebViewEvent) => void;
  onLoadProgress?: (event: WebViewEvent) => void;
  onLoadEnd?: (event: WebViewEvent) => void;
  onUrlChange?: (event: WebViewEvent) => void;
  onTitleChange?: (event: WebViewEvent) => void;
  onFaviconChange?: (event: WebViewEvent) => void;
  onHistoryChange?: (event: WebViewEvent) => void;
  onNavigationRequest?: (event: WebViewEvent) => void;
  onNewWindow?: (event: WebViewEvent) => void;
  onFocusChange?: (event: WebViewEvent) => void;
  onConsole?: (event: WebViewEvent) => void;
  onUnsupported?: (event: WebViewEvent) => void;
  onCrashed?: (event: WebViewEvent) => void;
  onClosed?: (event: WebViewEvent) => void;
  [prop: string]: unknown;
}

/** A box with a real browser page over it (see @silkui/core `createWebView`). */
export function WebView(props: WebViewProps): import("react").ReactElement;
/** Renders `children` into `container`, a @silkui/core node elsewhere in the tree. */
export function createPortal(children: ReactNode, container: Node, key?: string | null): ReactNode;

export { createElement } from "react";
export function VirtualList<T>(props: {
  items: readonly T[];
  itemKey: (item: T, index: number) => string | number;
  children: (item: T, index: number) => ReactNode;
  style?: import("@silkui/core").Style;
  rowHeight?: number | ((item: T, index: number) => number | "auto");
  estimatedRowHeight?: number;
  overscan?: number;
  gap?: number;
  revision?: number;
}): import("react").ReactElement;
