// A terminal's hidden textarea, as ghostty-web keeps one: focused by script, invisible and
// 1px square, it encodes the keys it handles on keydown and reads typed text from `input`,
// emptying itself after each. It reads the event's `data`, so the input record has to carry it.
import { activeElement, createElement, mount } from "@silkui/core";

const check = (label, got, want) => {
  if (got !== want) throw new Error(label + ": got '" + got + "', want '" + want + "'");
};

const root = createElement("div");
root.style.set({ width: "400px", height: "300px", position: "relative" });
// The terminal's mount, focusable by script, as T3 Code's drawer makes it.
root.setAttribute("tabindex", "-1");
const canvas = createElement("canvas");
canvas.style.cssText = "display:block;width:400px;height:300px";
root.appendChild(canvas);
const input = createElement("textarea");
input.style.cssText = "position:absolute;left:4px;top:4px;width:1px;height:1px;opacity:0;padding:0;border:0;resize:none;pointer-events:none;";
root.appendChild(input);
mount(root);
input.focus();
// A press on the terminal focuses its textarea, and its prevented mousedown keeps focus there.
canvas.addEventListener("pointerdown", () => input.focus());
canvas.addEventListener("mousedown", (event) => {
  event.preventDefault();
  input.focus();
});

const sent = [];
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    sent.push("\r");
  }
});
input.addEventListener("input", (event) => {
  if (event.data) sent.push(event.data);
  input.value = "";
});

globalThis.afterPress = () => check("a press on the canvas keeps the textarea focused", activeElement() === input, true);

globalThis.afterTyping = () => {
  check("typed text and Enter reach the terminal", JSON.stringify(sent), JSON.stringify(["\r", "echo hi"]));
  check("the textarea empties after each", input.value, "");
  globalThis.terminalChecked = true;
};
