// contenteditable through the bridge: a press focuses the host and leaves a caret, typed and
// composed text, Backspace and Enter change the host's nodes, and arrows move the caret. The
// host runs this, lays out a frame, presses in the first paragraph, then sends keys and text
// with checks between them.
import { createElement, createText, execCommand, getSelection, mount } from "@silkui/core";

const check = (label, got, want) => {
  if (got !== want) throw new Error(label + ": got '" + got + "', want '" + want + "'");
};

function paragraph(text) {
  const p = createElement("p");
  p.appendChild(createText(text));
  return p;
}

const host = createElement("div");
host.style.set({ fontSize: "16px", lineHeight: "24px" });
host.contentEditable = "true";
host.appendChild(paragraph("Hello"));
host.appendChild(paragraph("world"));
const root = createElement("div");
root.style.set({ width: "400px", height: "300px" });
root.appendChild(host);
mount(root);

const heard = [];
host.addEventListener("input", (event) => heard.push(event.inputType));
host.addEventListener("focus", () => heard.push("focus"));

// The host's paragraphs as text, `|` at the caret.
function shown() {
  const selection = getSelection();
  return [...host.childNodes].map((p) => [...p.childNodes].map((child) => {
    if (child.nodeType !== 3) return "<" + child.localName + ">";
    return child === selection.focusNode ? child.data.slice(0, selection.focusOffset) + "|" + child.data.slice(selection.focusOffset) : child.data;
  }).join("")).join(" / ");
}

globalThis.afterPress = () => {
  check("the press focused the host", heard[0], "focus");
  check("the caret is where the press was", getSelection().isCollapsed, true);
  check("in the first paragraph", getSelection().focusNode, host.firstChild.firstChild);
  getSelection().collapse(host.firstChild.firstChild, 5);
};

globalThis.afterTyping = () => check("typing goes in at the caret", shown(), "Hello!| / world");
globalThis.afterPreedit = () => check("a composition shows", shown() + " " + heard.join(","), "Hello!ka| / world focus,insertText,insertCompositionText");
globalThis.afterComposing = () => check("a composition shows, then commits", shown(), "Hello!か| / world");
globalThis.afterBackspace = () => check("Backspace deletes before the caret", shown(), "Hello!| / world");
globalThis.afterEnter = () => {
  check("Enter splits the paragraph", shown(), "Hello! / <br> / world");
  check("the caret starts the new paragraph", getSelection().focusNode === host.childNodes[1] && getSelection().focusOffset, 0);
  check("each edit fired input", heard.slice(1).join(","), "insertText,insertCompositionText,insertCompositionText,deleteContentBackward,insertParagraph");
};
globalThis.afterArrow = () => {
  check("Down moves the caret into the next paragraph", getSelection().focusNode, host.lastChild.firstChild);
  // Spaces stay plain where white-space keeps them and become no-break spaces where it collapses.
  for (const [whiteSpace, want] of [["pre-wrap", "a  "], ["normal", "a \u00a0"]]) {
    const field = createElement("div");
    field.contentEditable = "true";
    field.style.set({ whiteSpace });
    field.appendChild(createText("a"));
    root.appendChild(field);
    getSelection().collapse(field.firstChild, 1);
    execCommand("insertText", false, "  ");
    check("two spaces typed under white-space: " + whiteSpace, field.firstChild.data, want);
  }
  globalThis.editingChecked = true;
};
