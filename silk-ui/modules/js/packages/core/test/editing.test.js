import assert from "node:assert/strict";
import { test } from "node:test";
import { installMock } from "./mock.js";
import { computed } from "./wpt-editing/style.js";

const mock = installMock();
// The tree's document selection, as selection.test.js keeps it.
const tree = { ends: null };
let numbers = [];
const native = mock.native;
native.geometry = (index) => numbers[index] ?? 0;
native.selection = () => {
  if (!tree.ends) return (numbers = [], 0);
  numbers = [...tree.ends, ...tree.ends];
  return 1;
};
native.setSelection = (anchor, anchorOffset, focus, focusOffset) => {
  tree.ends = anchor === 0 ? null : [anchor, anchorOffset, focus, focusOffset];
  return 1;
};
// Computed style as the HTML rendering rules give it: the editing algorithms ask for display,
// white-space and the like, which the tree answers in Silk UI.
let core;
native.computed = (id, name) => computed(core.nodeById(id), name);
core = await import("../src/index.js");
const { createElement, createText, mount, getSelection, LineBreak } = core;

const BEFORE_INPUT = 37;
const FOCUS = 9;
const LISTEN_BEFORE_INPUT = 2 ** 31;

// The tree asking host `node` for edit `inputType` with `data`; returns whether it was prevented.
const edit = (node, inputType, data = "") => native.dispatch(BEFORE_INPUT, node.nodeId, 0, 0, 0, 0, 0, data, inputType);

function element(tag, ...children) {
  const node = createElement(tag);
  for (const child of children) node.appendChild(typeof child === "string" ? createText(child) : child);
  return node;
}

// An editor: a host holding paragraphs, mounted, with what its events reported.
function editor(...paragraphs) {
  const host = element("div", ...paragraphs.map((text) => (text === null ? element("p", new LineBreak()) : element("p", text))));
  host.setAttribute("contenteditable", "true");
  mount(element("div", host));
  const heard = [];
  for (const type of ["beforeinput", "input", "compositionstart", "compositionupdate", "compositionend"]) {
    host.addEventListener(type, (event) => heard.push(type + ":" + (event.inputType ?? event.data)));
  }
  mock.take();
  return { host, heard };
}

// The host's content as markup, with `|` at the caret.
function markup(node) {
  const selection = getSelection();
  const caret = selection.rangeCount ? [selection.focusNode, selection.focusOffset] : [];
  const walk = (at) => {
    if (at.nodeType === 3) {
      return at === caret[0] ? at.data.slice(0, caret[1]) + "|" + at.data.slice(caret[1]) : at.data;
    }
    let out = "";
    at.childNodes.forEach((child, index) => {
      if (at === caret[0] && index === caret[1]) out += "|";
      out += walk(child);
    });
    if (at === caret[0] && caret[1] === at.childNodes.length) out += "|";
    return at === node ? out : "<" + at.localName + ">" + out + (at.localName === "br" ? "" : "</" + at.localName + ">");
  };
  return walk(node);
}

test("contenteditable makes an editing host that takes focus and hears edits", () => {
  const host = createElement("div");
  const inner = createElement("span");
  host.appendChild(inner);
  assert.equal(host.contentEditable, "inherit");
  assert.equal(inner.isContentEditable, false);
  host.contentEditable = "true";
  const calls = mock.take();
  assert.ok(calls.some((call) => call[0] === "attribute" && call[1] === host.nodeId && call[2] === "tabIndex" && call[3] === 0), "a host is a tab stop");
  assert.ok(calls.some((call) => call[0] === "listen" && call[1] === host.nodeId && (call[2] & LISTEN_BEFORE_INPUT) !== 0), "a host hears beforeinput");
  assert.equal(host.contentEditable, "true");
  assert.equal(inner.isContentEditable, true);
  inner.contentEditable = "false";
  assert.equal(inner.isContentEditable, false);
  assert.throws(() => { host.contentEditable = "yes"; }, { name: "SyntaxError" });
  host.contentEditable = "inherit";
  assert.equal(host.hasAttribute("contenteditable"), false);
});

test("a br is a line-breaking text node to the tree and an empty element to scripts", () => {
  const br = createElement("br");
  assert.ok(br instanceof LineBreak);
  assert.equal(br.nodeType, 1);
  assert.equal(br.tagName, "BR");
  assert.equal(br.childNodes.length, 0);
  br.className = "ProseMirror-trailingBreak";
  assert.equal(br.getAttribute("class"), "ProseMirror-trailingBreak");
  assert.ok(mock.take().some((call) => call[0] === "setText" && call[1] === br.nodeId && call[2] === " "));
  // The tree's points in a br read as points in its parent.
  const p = element("p", "a", br);
  mount(element("div", p));
  tree.ends = [br.nodeId, 1, br.nodeId, 1];
  assert.equal(getSelection().focusNode, p);
  assert.equal(getSelection().focusOffset, 2);
});

test("typing inserts text at the caret and fires beforeinput then input", () => {
  const { host, heard } = editor("Hello world");
  const text = host.firstChild.firstChild;
  getSelection().collapse(text, 5);
  edit(host, "insertText", ",");
  assert.equal(markup(host), "<p>Hello,| world</p>");
  assert.deepEqual(heard, ["beforeinput:insertText", "input:insertText"]);
  getSelection().setBaseAndExtent(text, 0, text, 6);
  edit(host, "insertText", "Bye");
  assert.equal(markup(host), "<p>Bye| world</p>");
});

test("a host focused with no selection inside takes typing at its start", () => {
  const { host, heard } = editor("Hello");
  tree.ends = null;
  native.dispatch(FOCUS, host.nodeId, 0, 0, 0, 0, 0);
  edit(host, "insertText", "> ");
  assert.equal(markup(host), "<p>> |Hello</p>");
  assert.deepEqual(heard, ["beforeinput:insertText", "input:insertText"]);
});

test("a prevented beforeinput changes nothing", () => {
  const { host, heard } = editor("Hello");
  host.addEventListener("beforeinput", (event) => event.preventDefault());
  getSelection().collapse(host.firstChild.firstChild, 5);
  assert.equal(edit(host, "insertText", "!"), true);
  assert.equal(markup(host), "<p>Hello|</p>");
  assert.deepEqual(heard, ["beforeinput:insertText"]);
});


const PASTE = 36;
const textOf = (node) => (node.nodeType === 3 ? node.data : node.childNodes.map(textOf).join(""));
const NBSP = " ";
const { execCommand, queryCommandState, queryCommandValue, queryCommandEnabled, queryCommandSupported, queryCommandIndeterm } = await import("../src/index.js");

// A range as Chromium's probes print it: "text":offset for text, the tag for elements.
const ends = (range) => {
  const name = (node) => (node.nodeType === 3 ? JSON.stringify(node.data) : node.localName.toUpperCase());
  return name(range.startContainer) + ":" + range.startOffset + "-" + name(range.endContainer) + ":" + range.endOffset;
};

// The target ranges each beforeinput on `host` had, by input type.
function targets(host) {
  const seen = [];
  host.addEventListener("beforeinput", (event) => seen.push(event.inputType + " " + event.getTargetRanges().map(ends).join(",")));
  return seen;
}

function plainEditor(text) {
  const host = element("div", text);
  host.setAttribute("contenteditable", "plaintext-only");
  // Line feeds show where white-space keeps them; elsewhere a line break is a <br>.
  host.setAttribute("style", "white-space: pre-wrap");
  mount(element("div", host));
  mock.take();
  return host;
}

test("beforeinput carries the ranges the edit changes", () => {
  const { host } = editor("Hello brave world", "a\u{1F44D}\u{1F3FD}b");
  const seen = targets(host);
  const text = host.firstChild.firstChild;
  getSelection().collapse(text, 5);
  edit(host, "insertText", "!");
  getSelection().collapse(text, 6);
  edit(host, "deleteContentBackward");
  getSelection().collapse(text, 0);
  edit(host, "deleteContentForward");
  getSelection().collapse(text, 10);
  edit(host, "deleteWordBackward");
  const emoji = host.lastChild.firstChild;
  getSelection().collapse(emoji, 5);
  edit(host, "deleteContentBackward");
  getSelection().collapse(emoji, 0);
  edit(host, "deleteContentBackward");
  assert.deepEqual(seen, [
    'insertText "Hello brave world":5-"Hello brave world":5',
    'deleteContentBackward "Hello! brave world":5-"Hello! brave world":6',
    'deleteContentForward "Hello brave world":0-"Hello brave world":1',
    'deleteWordBackward "ello brave world":5-"ello brave world":10',
    'deleteContentBackward "a\u{1F44D}\u{1F3FD}b":1-"a\u{1F44D}\u{1F3FD}b":5',
    'deleteContentBackward "ello' + NBSP + ' world":11-"ab":0',
  ]);
  assert.equal(markup(host), "<p>ello" + NBSP + " world|ab</p>", "a word deleted between spaces keeps both showing");
});

test("an edit that changes nothing fires beforeinput and no input", () => {
  const { host, heard } = editor("Hello");
  getSelection().collapse(host.firstChild.firstChild, 0);
  edit(host, "deleteWordBackward");
  assert.deepEqual(heard, ["beforeinput:deleteWordBackward"]);
  assert.equal(markup(host), "<p>|Hello</p>");
});

test("typing in an empty paragraph takes the place of its placeholder br", () => {
  const { host } = editor(null);
  getSelection().collapse(host.firstChild, 0);
  edit(host, "insertText", "a");
  assert.equal(markup(host), "<p>a|</p>");
});

test("Backspace and Delete remove a character, a word, and join paragraphs", () => {
  const { host } = editor("Hello brave", "world");
  const first = host.firstChild.firstChild;
  getSelection().collapse(first, 5);
  edit(host, "deleteContentBackward");
  assert.equal(markup(host), "<p>Hell| brave</p><p>world</p>");
  edit(host, "deleteContentForward");
  assert.equal(markup(host), "<p>Hell|brave</p><p>world</p>");
  getSelection().collapse(first, first.length);
  edit(host, "deleteWordBackward");
  assert.equal(markup(host), "<p>|<br></p><p>world</p>", "an emptied paragraph keeps its line");
  getSelection().collapse(host.lastChild.firstChild, 0);
  edit(host, "deleteContentBackward");
  assert.equal(markup(host), "<p>|world</p>");
  assert.equal(host.childNodes.length, 1);
});

test("Backspace at the start of a paragraph after an empty one removes the empty one", () => {
  const { host } = editor(null, "text");
  getSelection().collapse(host.lastChild.firstChild, 0);
  edit(host, "deleteContentBackward");
  assert.equal(markup(host), "<p>|text</p>");
});

test("a contenteditable=false island and an image delete whole", () => {
  const { host } = editor();
  host.appendChild(element("p", "ab", element("span", "X Y"), "cd"));
  const island = host.firstChild.childNodes[1];
  island.setAttribute("contenteditable", "false");
  const seen = targets(host);
  getSelection().collapse(host.firstChild.lastChild, 0);
  edit(host, "deleteContentBackward");
  assert.equal(markup(host), "<p>ab|cd</p>");
  host.firstChild.insertBefore(element("img"), host.firstChild.lastChild);
  getSelection().collapse(host.firstChild.firstChild, 2);
  edit(host, "deleteContentForward");
  assert.equal(markup(host), "<p>ab|cd</p>");
  assert.deepEqual(seen, ['deleteContentBackward P:1-"cd":0', 'deleteContentForward "ab":2-P:2']);
});

test("a selection across paragraphs deletes into one, and typing replaces it", () => {
  const { host } = editor("abc", "def");
  getSelection().setBaseAndExtent(host.firstChild.firstChild, 1, host.lastChild.firstChild, 2);
  edit(host, "deleteContentBackward");
  assert.equal(markup(host), "<p>a|f</p>");
  const other = editor("ab", "cd");
  getSelection().selectAllChildren(other.host);
  edit(other.host, "insertText", "x");
  // The Editing spec's delete removes every paragraph the selection holds whole.
  assert.equal(markup(other.host), "x|");
});

test("Enter splits the paragraph and Shift+Enter breaks the line", () => {
  const { host } = editor("Hello world");
  getSelection().collapse(host.firstChild.firstChild, 5);
  edit(host, "insertParagraph");
  assert.equal(markup(host), "<p>Hello</p><p>|" + NBSP + "world</p>", "a space that starts the new paragraph still shows");
  getSelection().collapse(host.lastChild.firstChild, 6);
  edit(host, "insertParagraph");
  assert.equal(markup(host), "<p>Hello</p><p>" + NBSP + "world</p><p>|<br></p>");
  getSelection().collapse(host.firstChild.firstChild, 2);
  edit(host, "insertLineBreak");
  assert.equal(markup(host), "<p>He<br>|llo</p><p>" + NBSP + "world</p><p><br></p>");
});

test("Enter makes paragraphs: divs in a bare host, out of an empty list item, after a heading", () => {
  const bare = editor();
  bare.host.appendChild(createText("Hello"));
  getSelection().collapse(bare.host.firstChild, 2);
  edit(bare.host, "insertParagraph");
  assert.equal(markup(bare.host), "<div>He</div><div>|llo</div>");

  const empty = editor();
  getSelection().collapse(empty.host, 0);
  edit(empty.host, "insertParagraph");
  edit(empty.host, "insertParagraph");
  // The first Enter wraps the empty host's line in a paragraph, as the Editing spec does when
  // the line holds nothing.
  assert.equal(markup(empty.host), "<div><br></div><div>|<br></div>");

  const list = editor();
  list.host.appendChild(element("ul", element("li", "ab"), element("li", new LineBreak())));
  getSelection().collapse(list.host.firstChild.lastChild, 0);
  edit(list.host, "insertParagraph");
  assert.equal(markup(list.host), "<ul><li>ab</li></ul><div>|<br></div>");

  const heading = editor();
  heading.host.appendChild(element("h1", "Hello"));
  getSelection().collapse(heading.host.firstChild.firstChild, 5);
  edit(heading.host, "insertParagraph");
  assert.equal(markup(heading.host), "<h1>Hello</h1><div>|<br></div>");
  getSelection().collapse(heading.host.firstChild.firstChild, 2);
  edit(heading.host, "insertParagraph");
  assert.equal(markup(heading.host), "<h1>He</h1><h1>|llo</h1><div><br></div>");

  const bold = editor();
  bold.host.appendChild(element("p", element("b", "Hello")));
  getSelection().collapse(bold.host.firstChild.firstChild.firstChild, 2);
  edit(bold.host, "insertParagraph");
  assert.equal(markup(bold.host), "<p><b>He</b></p><p>|<b>llo</b></p>");

  const pre = editor();
  pre.host.appendChild(element("pre", "Hello"));
  getSelection().collapse(pre.host.firstChild.firstChild, 2);
  edit(pre.host, "insertParagraph");
  assert.equal(markup(pre.host), "<pre>He<br>|llo</pre>");
});

test("spaces typed where white-space collapses show, as no-break spaces at the edges and between", () => {
  const { host } = editor("ab");
  const text = host.firstChild.firstChild;
  getSelection().collapse(text, 2);
  edit(host, "insertText", " ");
  assert.equal(text.data, "ab" + NBSP, "a space that ends the paragraph");
  edit(host, "insertText", " ");
  edit(host, "insertText", "c");
  assert.equal(text.data, "ab" + NBSP + " c", "two spaces between words");
  edit(host, "insertText", " ");
  edit(host, "insertText", "d");
  assert.equal(text.data, "ab" + NBSP + " c d", "one space between words is a space");
  getSelection().collapse(text, 0);
  edit(host, "insertText", " ");
  assert.equal(text.data, NBSP + "ab" + NBSP + " c d", "a space that starts the paragraph");
});

test("a plain-text host takes line breaks as line feeds and pastes as text", () => {
  const host = plainEditor("Hello");
  const heard = [];
  for (const type of ["beforeinput", "input"]) host.addEventListener(type, (event) => heard.push(type + ":" + event.inputType + ":" + JSON.stringify(event.data) + ":" + !!event.dataTransfer));
  getSelection().collapse(host.firstChild, 2);
  edit(host, "insertLineBreak");
  assert.equal(textOf(host), "He\nllo");
  getSelection().collapse(host.firstChild, host.firstChild.length);
  edit(host, "insertLineBreak");
  assert.equal(textOf(host), "He\nllo\n\n", "a line feed that ends the text gets a line of its own");
  native.dispatch(PASTE, host.nodeId, 0, 0, 0, 0, 0, "X\nY", "<b>X</b><p>Y</p>");
  edit(host, "insertFromPaste", "X\nY");
  assert.equal(host.childNodes.length, 1);
  assert.ok(textOf(host).includes("X\nY"));
  assert.deepEqual(heard.slice(-2), ['beforeinput:insertFromPaste:"X\\nY":false', 'input:insertFromPaste:"X\\nY":false']);
  edit(host, "formatBold");
  assert.equal(host.childNodes.length, 1, "a plain host takes no formatting");
});

test("a paste in a rich host carries the clipboard in dataTransfer and inserts its markup, cleaned", () => {
  const { host } = editor("ab");
  const seen = [];
  host.addEventListener("beforeinput", (event) => seen.push([event.data, event.dataTransfer?.getData("text/html")]));
  getSelection().collapse(host.firstChild.firstChild, 1);
  const html = "<html><body><!--StartFragment--><b style=\"color:red\" onclick=\"x()\">X</b><script>bad()</script><p class=\"c\">Y</p><!--EndFragment--></body></html>";
  native.dispatch(PASTE, host.nodeId, 0, 0, 0, 0, 0, "X\nY", html);
  edit(host, "insertFromPaste", "X\nY");
  assert.deepEqual(seen, [[null, html]]);
  assert.equal(markup(host), "<p>a<b>X</b></p><p>Y</p>|<p>b</p>");
  const bold = host.firstChild.childNodes[1];
  assert.equal(bold.getAttribute("style"), "color:red");
  assert.equal(bold.hasAttribute("onclick"), false);

  const text = editor("ab");
  getSelection().collapse(text.host.firstChild.firstChild, 1);
  edit(text.host, "insertFromPaste", "x\ny\n\nz");
  assert.equal(markup(text.host), "<p>ax</p><p>y</p><p><br></p><p>z|b</p>", "lines of text become paragraphs");
});

test("a cut deletes the selection", () => {
  const { host } = editor("abcd");
  getSelection().setBaseAndExtent(host.firstChild.firstChild, 1, host.firstChild.firstChild, 3);
  edit(host, "deleteByCut");
  assert.equal(markup(host), "<p>a|d</p>");
});

test("composition text replaces itself until it is committed, with the UI Events order", () => {
  const { host, heard } = editor("ab");
  const seen = targets(host);
  getSelection().collapse(host.firstChild.firstChild, 1);
  edit(host, "insertCompositionText", "k");
  assert.equal(markup(host), "<p>ak|b</p>");
  edit(host, "insertCompositionText", "ka");
  assert.equal(markup(host), "<p>aka|b</p>");
  edit(host, "insertText", "か");
  assert.equal(markup(host), "<p>aか|b</p>");
  assert.deepEqual(heard, [
    "compositionstart:", "beforeinput:insertCompositionText", "compositionupdate:k", "input:insertCompositionText",
    "beforeinput:insertCompositionText", "compositionupdate:ka", "input:insertCompositionText",
    "beforeinput:insertCompositionText", "compositionupdate:か", "input:insertCompositionText", "compositionend:か",
  ]);
  assert.deepEqual(seen, [
    'insertCompositionText "ab":1-"ab":1', 'insertCompositionText "akb":1-"akb":2', 'insertCompositionText "akab":1-"akab":3',
  ]);
  heard.length = 0;
  edit(host, "insertCompositionText", "x");
  edit(host, "insertCompositionText", "");
  assert.equal(markup(host), "<p>aか|b</p>", "an empty composition removes what it showed");
  assert.deepEqual(heard.slice(-4), ["beforeinput:insertCompositionText", "compositionupdate:", "input:insertCompositionText", "compositionend:"]);
});

test("undo and redo step back through edits, typing in a row as one step", () => {
  const { host, heard } = editor("abcd");
  const text = host.firstChild.firstChild;
  edit(host, "historyUndo");
  assert.deepEqual(heard, [], "nothing to undo fires nothing");
  getSelection().collapse(text, 2);
  edit(host, "insertText", "x");
  edit(host, "insertParagraph");
  edit(host, "insertText", "y");
  assert.equal(markup(host), "<p>abx</p><p>y|cd</p>");
  getSelection().collapse(host.lastChild.lastChild, 3);
  edit(host, "deleteContentBackward");
  edit(host, "deleteContentBackward");
  assert.equal(markup(host), "<p>abx</p><p>y|</p>");
  heard.length = 0;
  edit(host, "historyUndo");
  assert.equal(markup(host), "<p>abx</p><p>ycd|</p>", "the deletes in a row undo together, back to where they started");
  assert.deepEqual(heard, ["beforeinput:historyUndo", "input:historyUndo"]);
  edit(host, "historyUndo");
  assert.equal(markup(host), "<p>ab|cd</p>", "the typing and its Enter undo together");
  edit(host, "historyRedo");
  assert.equal(markup(host), "<p>abx</p><p>y|cd</p>");
  edit(host, "historyUndo");
  getSelection().collapse(host.firstChild.firstChild, 4);
  edit(host, "insertText", "q");
  heard.length = 0;
  edit(host, "historyRedo");
  assert.deepEqual(heard, [], "a new edit drops what could be redone");
  assert.equal(textOf(host), "abcdq");

  host.addEventListener("beforeinput", (event) => event.inputType === "historyUndo" && event.preventDefault());
  assert.equal(edit(host, "historyUndo"), true);
  assert.equal(textOf(host), "abcdq", "a prevented undo changes nothing");
});

test("a moved caret starts a new undo step", () => {
  const { host } = editor("abcd");
  getSelection().collapse(host.firstChild.firstChild, 2);
  edit(host, "insertText", "x");
  getSelection().collapse(host.firstChild.firstChild, 4);
  edit(host, "insertText", "y");
  edit(host, "historyUndo");
  assert.equal(markup(host), "<p>abxc|d</p>");
  edit(host, "historyUndo");
  assert.equal(markup(host), "<p>ab|cd</p>");
});

test("formatting keys bold, italicize and underline a selection, and toggle back", () => {
  const { host, heard } = editor("Hello");
  const text = host.firstChild.firstChild;
  getSelection().setBaseAndExtent(text, 1, text, 3);
  edit(host, "formatBold");
  assert.equal(markup(host), "<p>H<b>el|</b>lo</p>");
  assert.equal(ends(getSelection().getRangeAt(0)), '"el":0-"el":2');
  assert.deepEqual(heard.slice(-2), ["beforeinput:formatBold", "input:formatBold"]);
  edit(host, "formatItalic");
  edit(host, "formatUnderline");
  // The Editing spec wraps the selected element whole in each new style.
  assert.equal(markup(host), "<p>H<u><i><b>el|</b></i></u>lo</p>");
  edit(host, "formatBold");
  assert.equal(markup(host), "<p>H<u><i>el|</i></u>lo</p>");
  edit(host, "historyUndo");
  assert.equal(markup(host), "<p>H<u><i><b>el|</b></i></u>lo</p>");

  const partial = editor();
  partial.host.appendChild(element("p", element("b", "abcd")));
  const inner = partial.host.firstChild.firstChild.firstChild;
  getSelection().setBaseAndExtent(inner, 1, inner, 3);
  edit(partial.host, "formatBold");
  assert.equal(markup(partial.host), "<p><b>a</b>bc|<b>d</b></p>", "unbolding part of a bold run splits it");
});

test("a formatting key at a caret formats what is typed next there", () => {
  const { host, heard } = editor("abcd");
  getSelection().collapse(host.firstChild.firstChild, 2);
  edit(host, "formatBold");
  assert.deepEqual(heard, ["beforeinput:formatBold"], "nothing changes yet");
  edit(host, "insertText", "x");
  assert.equal(markup(host), "<p>ab<b>x|</b>cd</p>");

  const inside = editor();
  inside.host.appendChild(element("p", element("b", "abcd")));
  getSelection().collapse(inside.host.firstChild.firstChild.firstChild, 2);
  edit(inside.host, "formatBold");
  edit(inside.host, "insertText", "x");
  assert.equal(markup(inside.host), "<p><b>ab</b>x|<b>cd</b></p>");

  const moved = editor("abcd");
  getSelection().collapse(moved.host.firstChild.firstChild, 2);
  edit(moved.host, "formatBold");
  getSelection().collapse(moved.host.firstChild.firstChild, 3);
  edit(moved.host, "insertText", "x");
  assert.equal(markup(moved.host), "<p>abcx|d</p>", "moving the caret forgets it");
});

test("execCommand fires beforeinput and input with the Editing spec's input types", () => {
  const { host, heard } = editor("abcd");
  const text = host.firstChild.firstChild;
  getSelection().setBaseAndExtent(text, 1, text, 3);
  assert.equal(execCommand("bold"), true);
  assert.equal(queryCommandState("bold"), true);
  // The spec gives bold no value: Chromium's "true" is its own.
  assert.equal(queryCommandValue("bold"), "");
  assert.equal(markup(host), "<p>a<b>bc|</b>d</p>");
  execCommand("bold");
  assert.equal(queryCommandState("bold"), false);
  execCommand("strikeThrough");
  execCommand("subscript");
  // The Editing spec strikes through with <s>, and nests each new style around the old.
  assert.equal(markup(host), "<p>a<sub><s>bc|</s></sub>d</p>");
  execCommand("removeFormat");
  assert.equal(markup(host), "<p>abc|d</p>");
  assert.deepEqual(heard, ["formatBold", "formatBold", "formatStrikeThrough", "formatSubscript", "formatRemove"].flatMap((type) => ["beforeinput:" + type, "input:" + type]));
  heard.length = 0;
  getSelection().collapse(host.firstChild.lastChild, 1);
  execCommand("insertText", false, "x\ny");
  assert.equal(markup(host), "<p>abcd</p><p>y|</p>".replace("abcd", "abcdx"));
  execCommand("delete");
  execCommand("insertLineBreak");
  assert.deepEqual(heard, ["insertText", "deleteContentBackward", "insertLineBreak"].flatMap((type) => ["beforeinput:" + type, "input:" + type]));
  execCommand("undo");
  execCommand("undo");
  execCommand("undo");
  assert.equal(markup(host), "<p>abcd|</p>", "execCommand undoes its own edits");
});

test("execCommand links, unlinks, formats blocks and inserts markup", () => {
  const { host } = editor("abcd", "ef");
  const text = host.firstChild.firstChild;
  getSelection().setBaseAndExtent(text, 1, text, 3);
  execCommand("createLink", false, "https://x.y/");
  assert.equal(host.firstChild.childNodes[1].localName, "a");
  assert.equal(host.firstChild.childNodes[1].getAttribute("href"), "https://x.y/");
  execCommand("unlink");
  assert.ok(host.firstChild.childNodes.every((child) => child.localName !== "a"));
  getSelection().collapse(host.firstChild.firstChild, 1);
  assert.equal(execCommand("formatBlock", false, "<h1>"), true);
  assert.equal(host.firstChild.localName, "h1");
  assert.equal(queryCommandValue("formatBlock"), "h1");
  const inserting = editor("abcd");
  getSelection().collapse(inserting.host.firstChild.firstChild, 2);
  execCommand("insertHTML", false, "<p>X</p><p>Y</p>");
  assert.equal(markup(inserting.host), "<p>ab</p><p>X</p><p>Y</p>|<p>cd</p>");
  execCommand("insertHTML", false, "<i>q</i>");
  assert.equal(markup(inserting.host), "<p>ab</p><p>X</p><p>Y</p><i>q</i>|<p>cd</p>");
});

test("execCommand and queryCommand* answer for the selection's host", () => {
  const plain = createElement("div");
  plain.appendChild(createText("abcd"));
  mount(element("div", plain));
  getSelection().collapse(plain.firstChild, 1);
  assert.equal(execCommand("insertText", false, "y"), false, "outside an editing host nothing runs");
  assert.equal(queryCommandEnabled("bold"), false);
  assert.equal(queryCommandSupported("bold"), true);
  assert.equal(queryCommandSupported("frobnicate"), false);
  assert.equal(queryCommandSupported("copy"), true);
  assert.equal(execCommand("frobnicate"), false);
  const host = plainEditor("abcd");
  getSelection().setBaseAndExtent(host.firstChild, 1, host.firstChild, 3);
  assert.equal(queryCommandEnabled("bold"), false, "a plain host takes no formatting");
  assert.equal(execCommand("bold"), false);
  assert.equal(execCommand("insertHTML", false, "<b>q</b>"), false, "nor markup");
  assert.equal(execCommand("insertText", false, "q"), true);
  assert.equal(textOf(host), "aqd");
  const { host: rich } = editor();
  rich.appendChild(element("p", element("b", "ab"), "cd"));
  getSelection().setBaseAndExtent(rich.firstChild.firstChild.firstChild, 1, rich.firstChild.lastChild, 1);
  assert.equal(queryCommandIndeterm("bold"), true, "part of the selection is bold");
  assert.equal(queryCommandState("bold"), false);
});

test("Selection.modify moves and extends by characters, words, paragraphs and the whole host", () => {
  const { host } = editor("Hello world", "two");
  const selection = getSelection();
  const first = host.firstChild.firstChild;
  selection.collapse(first, 0);
  selection.modify("move", "forward", "word");
  assert.equal(ends(selection.getRangeAt(0)), '"Hello world":5-"Hello world":5');
  selection.modify("extend", "forward", "character");
  assert.equal(ends(selection.getRangeAt(0)), '"Hello world":5-"Hello world":6');
  selection.modify("move", "forward", "lineboundary");
  assert.equal(ends(selection.getRangeAt(0)), '"Hello world":11-"Hello world":11');
  selection.modify("move", "forward", "character");
  assert.equal(ends(selection.getRangeAt(0)), '"two":0-"two":0', "past a paragraph's end is the next one's start");
  selection.modify("extend", "backward", "documentboundary");
  assert.deepEqual([selection.anchorNode.data, selection.anchorOffset, selection.focusNode.data, selection.focusOffset], ["two", 0, "Hello world", 0]);
  assert.equal(selection.direction, "backward");
  selection.collapse(host.lastChild.firstChild, 0);
  selection.modify("move", "sideways", "character");
  selection.modify("jump", "forward", "character");
  assert.equal(ends(selection.getRangeAt(0)), '"two":0-"two":0', "unknown values do nothing");
});

test("an editing host is focusable with tabIndex -1, as HTML gives it", () => {
  const host = createElement("div");
  host.contentEditable = "true";
  assert.equal(host.tabIndex, -1);
  for (const [value, expected] of [["TRUE", "true"], ["PlainText-Only", "plaintext-only"], ["yes", "inherit"], ["inherit", "inherit"]]) {
    host.setAttribute("contenteditable", value);
    assert.equal(host.contentEditable, expected);
  }
});
