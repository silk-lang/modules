import { document, HoverStyle } from "@silkui/foldkit";
import { pageGlobals, provided } from "@silkui/foldkit/apis";
import type { Attribute } from "foldkit/html";
import type { Node as TreeNode } from "@silkui/core";
import silk from "@silkui/vite";

const root = document.getElementById("root");
const tree: TreeNode | undefined = root?.node;
const hover: Attribute<never> = HoverStyle({ color: "rgb(0, 120, 230)" });
const allow: readonly string[] = provided;
const define: Readonly<Record<string, string>> = pageGlobals;
const plugins = silk({ entry: "src/entry.ts", allow: provided });

// @ts-expect-error the style values are CSS text
HoverStyle({ opacity: 1 });

export { tree, hover, allow, define, plugins };
