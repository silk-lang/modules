import type { Attribute } from "foldkit/html";
import type { Node as TreeNode } from "@silkui/core";

/**
 * The page's document: `<html><body><div id="root">`, filling the window, with every element
 * a tree node. Importing the package also installs it as the global `document`.
 */
export declare const document: Document;

/** A style object, as `h.Style` takes it. */
export type Style = Readonly<Record<string, string>>;

/** The style laid over the element while the pointer is on it, as `:hover`. */
export declare const HoverStyle: (style: Style) => Attribute<never>;
/** While it is pressed, as `:active`. */
export declare const ActiveStyle: (style: Style) => Attribute<never>;
/** While it has the focus, as `:focus`. */
export declare const FocusStyle: (style: Style) => Attribute<never>;
/** While it has the focus from the keyboard, as `:focus-visible`. */
export declare const FocusVisibleStyle: (style: Style) => Attribute<never>;
/** What its transitions start from when it first shows, as `@starting-style`. */
export declare const StartingStyle: (style: Style) => Attribute<never>;
export declare const VirtualList: (options: import("@silkui/core").VirtualListOptions, onRange: (indices: number[]) => void) => Attribute<never>;
export declare const VirtualRows: (indices: readonly number[]) => Attribute<never>;

declare global {
  interface Node {
    /** The @silkui/core node behind this element or text. */
    readonly node: TreeNode;
  }
}
