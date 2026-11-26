import assert from "node:assert/strict";
import { test } from "node:test";
import { installMock } from "./mock.js";

const mock = installMock();
// The tree's selection as the host keeps it: [anchorId, anchorOffset, focusId, focusOffset]
// and the stretches, each [startId, startOffset, endId, endOffset].
const tree = { ends: null, stretches: [], text: "" };
let numbers = [];
const native = mock.native;
native.geometry = (index) => numbers[index] ?? 0;
native.selection = () => {
  mock.calls.push(["selection"]);
  if (!tree.ends) return (numbers = [], 0);
  numbers = [...tree.ends, ...tree.stretches.flat()];
  return tree.stretches.length;
};
native.setSelection = (anchor, anchorOffset, focus, focusOffset) => {
  mock.calls.push(["setSelection", anchor, anchorOffset, focus, focusOffset]);
  if (anchor === 0) {
    tree.ends = null;
    tree.stretches = [];
  } else {
    tree.ends = [anchor, anchorOffset, focus, focusOffset];
    tree.stretches = [tree.ends];
  }
  return 1;
};
native.selectionText = () => tree.text;
const { createBox, createText, mount, getSelection, Selection, Range } = await import("../src/index.js");

const LISTEN_SELECTION_CHANGE = 1 << 27;

// A root holding a paragraph box with "Hello world" and a second box with "Second".
function page() {
  const hello = createText("Hello world");
  const second = createText("Second");
  const a = createBox({}, hello);
  const b = createBox({}, second);
  const root = mount(createBox({}, a, b));
  tree.ends = null;
  tree.stretches = [];
  mock.take();
  return { root, a, b, hello, second };
}

const writes = () => mock.take().filter((call) => call[0] === "setSelection");

test("getSelection reads what the tree selected and keeps its range while it stays", () => {
  const { hello, second } = page();
  const selection = getSelection();
  assert.equal(selection, globalThis.getSelection(), "one selection, also a global");
  assert.throws(() => new Selection(), TypeError);
  assert.equal(selection.type, "None");
  assert.equal(selection.rangeCount, 0);
  assert.equal(selection.anchorNode, null);
  assert.throws(() => selection.getRangeAt(0), { name: "IndexSizeError" });

  tree.ends = [hello.nodeId, 1, hello.nodeId, 4];
  tree.stretches = [[hello.nodeId, 1, hello.nodeId, 4]];
  tree.text = "ell";
  assert.equal(selection.type, "Range");
  assert.equal(selection.anchorNode, hello);
  assert.equal(selection.focusOffset, 4);
  assert.equal(selection.direction, "forward");
  const range = selection.getRangeAt(0);
  assert.ok(range instanceof Range);
  assert.deepEqual([range.startContainer, range.startOffset, range.endContainer, range.endOffset], [hello, 1, hello, 4]);
  assert.equal(selection.getRangeAt(0), range, "the same range while the tree keeps the selection");
  assert.equal(selection.toString(), "ell");

  // The user drags backward to the other paragraph.
  tree.ends = [hello.nodeId, 4, second.nodeId, 2];
  tree.stretches = [[hello.nodeId, 4, second.nodeId, 2]];
  assert.notEqual(selection.getRangeAt(0), range, "a new selection is a new range");
  tree.ends = [second.nodeId, 2, hello.nodeId, 4];
  tree.stretches = [[hello.nodeId, 4, second.nodeId, 2]];
  assert.equal(selection.direction, "backward");
  assert.equal(selection.anchorNode, second);
  assert.equal(selection.isCollapsed, false);

  // Across reordered layout the tree has two stretches: two ranges.
  tree.stretches = [[second.nodeId, 0, second.nodeId, 2], [hello.nodeId, 4, hello.nodeId, 11]];
  assert.equal(selection.rangeCount, 2);
  assert.equal(selection.getRangeAt(1).endOffset, 11);
  assert.deepEqual(writes(), [], "reading never writes");
});

test("scripts change the selection and the tree hears it before the next read", async () => {
  const { a, hello, second } = page();
  const selection = getSelection();
  selection.setBaseAndExtent(second, 3, hello, 2);
  assert.equal(selection.direction, "backward");
  assert.deepEqual(writes(), [["setSelection", second.nodeId, 3, hello.nodeId, 2]], "a read tells the tree first");
  selection.collapse(hello, 5);
  await Promise.resolve();
  assert.deepEqual(writes(), [["setSelection", hello.nodeId, 5, hello.nodeId, 5]], "otherwise a microtask tells it");
  assert.equal(selection.type, "Caret");
  selection.extend(second, 1);
  assert.equal(selection.toString(), tree.text);
  assert.deepEqual(writes()[0], ["setSelection", hello.nodeId, 5, second.nodeId, 1]);
  selection.selectAllChildren(a);
  assert.deepEqual([selection.anchorNode, selection.anchorOffset, selection.focusNode, selection.focusOffset], [a, 0, a, 1]);
  assert.throws(() => selection.collapse(hello, 40), { name: "IndexSizeError" });
  selection.removeAllRanges();
  assert.equal(selection.rangeCount, 0);
  assert.deepEqual(writes().at(-1), ["setSelection", 0, 0, 0, 0]);
  assert.throws(() => selection.extend(hello, 1), { name: "InvalidStateError" });
  assert.throws(() => selection.collapseToStart(), { name: "InvalidStateError" });
  selection.collapse(createText("detached"), 0);
  assert.equal(selection.rangeCount, 0, "a node outside the document is not selected");
});

test("an added range is the selection's own, and follows mutations", () => {
  const { root, b, hello, second } = page();
  const selection = getSelection();
  const range = new Range();
  range.setStart(root, 1);
  range.setEnd(second, 3);
  selection.addRange(range);
  assert.equal(selection.getRangeAt(0), range);
  assert.deepEqual(writes(), [["setSelection", root.nodeId, 1, second.nodeId, 3]]);
  const other = new Range();
  selection.addRange(other);
  assert.equal(selection.getRangeAt(0), range, "a second addRange does nothing");

  range.setEnd(second, 6);
  assert.equal(selection.focusOffset, 6, "changing the range changes the selection");
  assert.deepEqual(writes(), [["setSelection", root.nodeId, 1, second.nodeId, 6]]);

  root.insertBefore(createBox(), root.firstChild);
  assert.equal(range.startOffset, 2);
  assert.equal(selection.anchorOffset, 2, "an insertion before the anchor moves it");
  assert.deepEqual(writes(), [["setSelection", root.nodeId, 2, second.nodeId, 6]]);

  assert.equal(selection.containsNode(b), false, "b is only partly selected");
  assert.equal(selection.containsNode(b, true), true);
  assert.equal(selection.containsNode(hello), false);
  assert.throws(() => selection.removeRange(other), { name: "NotFoundError" });
  selection.removeRange(range);
  assert.equal(selection.rangeCount, 0);
  range.setStart(second, 0);
  assert.equal(selection.rangeCount, 0, "a removed range no longer moves the selection");
});

test("selectstart and selectionchange reach listeners, and a prevented selectstart selects nothing", () => {
  const { root, a, hello } = page();
  mock.take();
  const seen = [];
  a.addEventListener("selectstart", (event) => {
    seen.push([event.type, event.target, event.bubbles, event.cancelable]);
    event.preventDefault();
  });
  assert.deepEqual(mock.take().filter((call) => call[0] === "listen"), [["listen", a.nodeId, LISTEN_SELECTION_CHANGE]], "selectstart listens through selection change records");
  root.addEventListener("selectionchange", (event) => seen.push([event.type, event.target, event.bubbles]));

  tree.ends = [hello.nodeId, 1, hello.nodeId, 1];
  tree.stretches = [tree.ends];
  globalThis.__ui.dispatch(27, hello.nodeId, 1, 0, 0, 0, 0);
  assert.deepEqual(seen.shift(), ["selectstart", hello, true, true]);
  assert.deepEqual(writes().at(-1), ["setSelection", 0, 0, 0, 0], "preventing selectstart clears the selection the press began");
  globalThis.__ui.dispatch(27, root.nodeId, 0, 0, 0, 0, 0);
  assert.deepEqual(seen.shift(), ["selectionchange", root, false]);
  assert.equal(seen.length, 0);
});
