// The core DOM with a mock tree, set up for the WPT editing cases: the tree's selection, the
// computed style of the HTML rendering rules (style.js), and the selectors run.js asks for.
import { installMock } from "../mock.js";
import { computed } from "./style.js";

export async function editingEnv() {
  const mock = installMock();
  let ends = null;
  let numbers = [];
  mock.native.geometry = (index) => numbers[index] ?? 0;
  mock.native.selection = () => {
    if (!ends) return (numbers = [], 0);
    numbers = [...ends, ...ends];
    return 1;
  };
  mock.native.setSelection = (anchor, anchorOffset, focus, focusOffset) => {
    ends = anchor === 0 ? null : [anchor, anchorOffset, focus, focusOffset];
    return 1;
  };
  let core;
  mock.native.computed = (id, name) => computed(core.nodeById(id), name);
  mock.native.query = (mode, id, selector) => {
    const match = /^\[([\w-]+)\]$/.exec(selector);
    if (!match) return mode === 3 ? "" : 0;
    const found = [];
    const walk = (node) => {
      for (const child of node.childNodes ?? []) {
        if (child.nodeType === 1 && child.hasAttribute(match[1])) found.push(child.nodeId);
        walk(child);
      }
    };
    walk(core.nodeById(id));
    return mode === 3 ? found.join(",") : found[0] ?? 0;
  };
  core = await import("../../src/index.js");
  await import("../../src/globals.js");
  const container = document.createElement("div");
  document.body.appendChild(container);
  core.mount(document.documentElement);
  return { document, getSelection: core.getSelection, container };
}
