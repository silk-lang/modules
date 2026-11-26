// The document selection through the bridge: scripts select and read on the tree, a drag the
// tree handled reads back, and selectstart and selectionchange reach listeners. The host runs
// this, lays out a frame, drags across the text, then runs `selectionAfterDrag`, presses again
// and runs `selectionAfterPreventedPress`.
import { createBox, createText, getSelection, mount } from "@silkui/core";

const check = (label, got, want) => {
  if (got !== want) throw new Error(label + ": got '" + got + "', want '" + want + "'");
};

const hello = createText("Hello brave world");
const second = createText("Second");
const paragraph = createBox({ fontSize: "16px", lineHeight: "24px" }, hello);
const root = createBox({ width: "400px", height: "300px" }, paragraph, createBox({ marginTop: "12px" }, second));
mount(root);

const heard = [];
root.addEventListener("selectionchange", () => heard.push("selectionchange"));
let preventStart = false;
paragraph.addEventListener("selectstart", (event) => {
  heard.push("selectstart " + (event.target === hello));
  if (preventStart) event.preventDefault();
});

const selection = getSelection();
check("nothing selected at first", selection.type, "None");
selection.setBaseAndExtent(hello, 6, hello, 11);
check("a script selects on the tree", selection.toString(), "brave");
selection.extend(second, 3);
check("copy text crosses blocks", selection.toString(), "brave world\nSec");
check("one range", selection.rangeCount, 1);
check("its end", selection.getRangeAt(0).endContainer, second);
selection.removeAllRanges();
check("cleared", selection.toString(), "");

globalThis.selectionAfterDrag = () => {
  check("the drag's anchor", selection.anchorNode, hello);
  check("the drag started at the text's start", selection.anchorOffset, 0);
  check("the drag's focus", selection.focusNode, hello);
  check("right of the line is its end", selection.focusOffset, 17);
  check("what the drag selected", selection.toString(), "Hello brave world");
  check("selectstart came from the text pressed", heard.includes("selectstart true"), true);
  check("selectionchange came too", heard.includes("selectionchange"), true);
  heard.length = 0;
  preventStart = true;
};

globalThis.selectionAfterPreventedPress = () => {
  check("selectstart again", heard[0], "selectstart true");
  check("a prevented selectstart selects nothing", selection.type, "None");
  globalThis.selectionChecked = true;
};
