// ProseMirror, as a browser page sets it up: an EditorView on a contenteditable div in
// `document.body`, with the basic schema, the base keymap and history. The editor reads
// typing back from the DOM through a MutationObserver and handles Enter and Backspace at a
// paragraph's edge itself.
import "@silkui/core/globals";
import { EditorState } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { DOMParser } from "prosemirror-model";
import { schema } from "prosemirror-schema-basic";
import { keymap } from "prosemirror-keymap";
import { baseKeymap } from "prosemirror-commands";
import { history, undo, redo } from "prosemirror-history";

const style = document.createElement("style");
style.textContent = ".ProseMirror { white-space: pre-wrap; word-wrap: break-word; outline: none; padding: 8px; font-size: 16px; line-height: 24px; } .ProseMirror p { margin: 0 0 8px; }";
document.head.appendChild(style);

const start = document.createElement("div");
start.innerHTML = "<p>Hello world</p><p>Second paragraph</p>";

const place = document.createElement("div");
place.style.width = "600px";
document.body.appendChild(place);

const view = new EditorView(place, {
  state: EditorState.create({
    doc: DOMParser.fromSchema(schema).parse(start),
    plugins: [history(), keymap({ "Mod-z": undo, "Mod-y": redo, "Shift-Mod-z": redo }), keymap(baseKeymap)],
  }),
});

globalThis.editor = view;
globalThis.paragraphs = () => {
  const out = [];
  view.state.doc.forEach((node) => out.push(node.textContent));
  return out.join(" / ");
};
