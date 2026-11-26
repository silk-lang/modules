// The input scene (SCENES.md): T3 Code's chat view, its real markup (content/t3-page.json) under
// its real stylesheet (style/t3.css, T3's Tailwind build), and the inputs a person makes there,
// one a frame: typing in the composer, clicking sidebar threads, collapsing the sidebar and
// opening a menu. Each input is a React state change flushed in the frame, so a frame's cost is
// what the input costs: React, style, layout and paint.
import { useEffect, useState } from "react";
import { flushSync } from "@silkui/react";
// content/t3-page.json in the input build, an empty page in the others (vite.config.js).
import page from "xb-page.json";
import { run, type Step } from "./driver";

type Node = string | [string, Record<string, string>, ...Node[]];
type State = { text: string; active: number; collapsed: boolean; menu: boolean; shown: boolean };

// HTML attribute names that React spells otherwise.
const RENAMED: Record<string, string> = {
  class: "className", for: "htmlFor", tabindex: "tabIndex", contenteditable: "contentEditable",
  spellcheck: "spellCheck", autocomplete: "autoComplete", readonly: "readOnly", value: "defaultValue",
  checked: "defaultChecked", autocapitalize: "autoCapitalize", autocorrect: "autoCorrect",
};
const BOOLEAN = new Set(["disabled", "readOnly", "defaultChecked", "hidden", "autoFocus"]);

/** The elements the inputs change, found once: rows by data-thread-item, and so on. */
const targets = { rows: [] as Node[], wrapper: null as Node | null, menu: null as Node | null, editor: null as Node | null };
(function find(node: Node) {
  if (typeof node === "string") return;
  const attrs = node[1];
  if (attrs["data-thread-item"] !== undefined) targets.rows.push(node);
  if (attrs["data-slot"] === "sidebar-wrapper") targets.wrapper = node;
  if (attrs["aria-haspopup"] !== undefined && !targets.menu) targets.menu = node;
  if ((attrs.class ?? "").includes("ProseMirror") && !targets.editor) targets.editor = node;
  for (let i = 2; i < node.length; i++) find(node[i] as Node);
})(page as Node);

function props(node: [string, Record<string, string>, ...Node[]], key: number, state: State) {
  const out: Record<string, unknown> = { key };
  for (const [name, value] of Object.entries(node[1])) {
    const react = RENAMED[name] ?? name;
    out[react] = BOOLEAN.has(react) ? true : value;
  }
  if (out.contentEditable !== undefined) out.suppressContentEditableWarning = true;
  const row = targets.rows.indexOf(node);
  if (row >= 0) out["data-active"] = row === state.active ? "true" : "false";
  if (node === targets.wrapper) out["data-sidebar-state"] = state.collapsed ? "collapsed" : "expanded";
  if (node === targets.menu) {
    out["aria-expanded"] = state.menu ? "true" : "false";
    out["data-popup-open"] = state.menu ? "" : undefined;
  }
  return out;
}

/** Subtrees with no target in them, rendered once: React skips an element it has seen, as it
 * skips a memoized component, so a frame reconciles only the path to what changed. */
const holds = new Set<Node>();
(function mark(node: Node): boolean {
  if (typeof node === "string") return false;
  let found = targets.rows.includes(node) || node === targets.wrapper || node === targets.menu || node === targets.editor;
  for (let i = 2; i < node.length; i++) if (mark(node[i] as Node)) found = true;
  if (found) holds.add(node);
  return found;
})(page as Node);
const fixed = new Map<Node, any>();

function render(node: Node, key: number, state: State): any {
  if (typeof node === "string") return node;
  if (!holds.has(node)) {
    let element = fixed.get(node);
    if (!element) fixed.set(node, (element = build(node, key, state)));
    return element;
  }
  return build(node, key, state);
}

function build(node: [string, Record<string, string>, ...Node[]], key: number, state: State): any {
  const Tag = node[0] as any;
  const children = node === targets.editor && state.text ? [state.text] : node.slice(2).map((child, i) => render(child as Node, i, state));
  return <Tag {...props(node, key, state)}>{children.length ? children : undefined}</Tag>;
}

export function Input() {
  const [state, setState] = useState<State>({ text: "", active: 0, collapsed: false, menu: false, shown: true });
  useEffect(() => {
    const change = (next: (old: State) => State) => flushSync(() => setState(next));
    const typed = "the quick brown fox jumps over the lazy dog and keeps typing ";
    const steps: Step[] = [
      { idle: "loaded", ms: 3000 },
      { mark: "loaded" },
      { driver: "type", frames: 120, frame: (f) => change((s) => ({ ...s, text: typed.repeat(3).slice(0, f + 1) })) },
      { driver: "select", frames: 60, frame: (f) => change((s) => ({ ...s, active: (f + 1) % Math.max(1, targets.rows.length) })) },
      { driver: "collapse", frames: 60, frame: (f) => change((s) => ({ ...s, collapsed: f % 2 === 0 })) },
      { driver: "menu", frames: 60, frame: (f) => change((s) => ({ ...s, menu: f % 2 === 0 })) },
      // The whole page leaves and a new copy of it mounts in one frame, as a thread switch does.
      { driver: "mount", frames: 30, frame: () => { change((s) => ({ ...s, shown: false })); change((s) => ({ ...s, shown: true })); } },
      { idle: "rest", ms: 3000 },
      { mark: "rest" },
    ];
    if (!targets.editor || targets.rows.length < 2 || !targets.wrapper || !targets.menu) {
      console.log("xbench input: the page lacks a target");
    }
    run(steps);
  }, []);
  return state.shown ? render(page as Node, 0, state) : null;
}
