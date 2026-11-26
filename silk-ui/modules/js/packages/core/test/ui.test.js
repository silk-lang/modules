import assert from "node:assert/strict";
import { test } from "node:test";
import { installMock } from "./mock.js";

const mock = installMock();
const { createBox, createText, createInput, createImage, createSvgElement, flushSvg, createRichInput, createNode, OBJECT, mount, nodeById, setErrorHandler, parseMarkdown, defineKeyframes, announce, Notification, setTray, registerShortcut, setApplicationMenu, showOpenDialog, showSaveDialog, showContextMenu, appWindow, createWebView, clearWebViewData } = await import("../src/index.js");

test("nodes queue their mutations", () => {
  mock.take();
  const label = createText("hi");
  const box = createBox({ width: 10, opacity: 0.5, backgroundColor: "red", gridColumn: 2, columnCount: 2 }, label);
  mount(box);
  assert.deepEqual(mock.take(), [
    ["create", label.nodeId, 1],
    ["setText", label.nodeId, "hi"],
    ["create", box.nodeId, 0],
    ["style", box.nodeId, "width:10px;opacity:0.5;background-color:red;grid-column:2;column-count:2;", 0],
    ["append", box.nodeId, label.nodeId],
    ["root", box.nodeId],
  ]);
  assert.equal(label.parentNode, box);
  assert.equal(nodeById(box.nodeId), box);
});

test("class aliases distinguish absent and empty alongside other attributes", () => {
  const box = createBox();
  mock.take();
  box.setAttribute("className", "");
  assert.equal(box.hasAttribute("class"), true);
  box.setAttribute("data-mode", "on");
  box.setAttribute("class", 42);
  assert.equal(box.getAttribute("className"), "42");
  box.removeAttribute("className");
  assert.equal(box.className, "");
  assert.equal(box.hasAttribute("class"), false);
  assert.equal(box.getAttribute("data-mode"), "on");
  assert.deepEqual(mock.take(), [
    ["attribute", box.nodeId, "class", ""], ["attribute", box.nodeId, "data-mode", "on"],
    ["attribute", box.nodeId, "class", "42"], ["attribute", box.nodeId, "class", null],
  ]);
});

test("a style sends what changed, and removal restarts the look", () => {
  const box = createBox({ width: 10, height: 20 });
  mock.take();
  box.style.set({ width: 10, height: 30 });
  assert.deepEqual(mock.take(), [["style", box.nodeId, "height:30px;", 0]]);
  box.style.set({ width: null });
  assert.deepEqual(mock.take(), [["clearStyle", box.nodeId, 0], ["style", box.nodeId, "height:30px;", 0]]);
  box.look("hover").set({ color: "blue" });
  assert.deepEqual(mock.take(), [["style", box.nodeId, "color:blue;", 1]]);
});

test("moving a child keeps one parent", () => {
  const a = createBox();
  const b = createBox();
  const child = createBox();
  a.append(child);
  b.insertBefore(child, null);
  assert.deepEqual(a.childNodes, []);
  assert.deepEqual(b.childNodes, [child]);
  assert.throws(() => child.append(b), /own subtree/);
  child.remove();
  assert.equal(child.parentNode, null);
});

test("events run capture, target and bubble phases", () => {
  const root = createBox();
  const middle = createBox();
  const leaf = createBox();
  root.append(middle);
  middle.append(leaf);
  const log = [];
  root.addEventListener("click", (event) => log.push("root capture " + event.eventPhase), true);
  middle.addEventListener("click", (event) => log.push("middle " + event.eventPhase));
  leaf.addEventListener("click", (event) => log.push("leaf " + event.eventPhase + " " + event.clientX));
  root.addEventListener("click", (event) => log.push("root " + event.eventPhase));
  assert.equal(mock.click(leaf.nodeId, 7), false);
  assert.deepEqual(log, ["root capture 1", "leaf 2 7", "middle 3", "root 3"]);

  log.length = 0;
  middle.addEventListener("click", (event) => event.stopPropagation());
  mock.click(leaf.nodeId);
  assert.deepEqual(log, ["root capture 1", "leaf 2 0", "middle 3"]);
});

test("window.event is the event being dispatched", () => {
  const root = createBox();
  const leaf = createBox();
  root.append(leaf);
  const seen = [];
  leaf.addEventListener("click", (event) => seen.push(globalThis.event === event));
  root.addEventListener("click", (event) => seen.push(globalThis.event === event));
  mock.click(leaf.nodeId);
  assert.deepEqual(seen, [true, true]);
  assert.equal(globalThis.event, undefined);
});

test("listen flags follow the listeners", () => {
  const box = createBox();
  mock.take();
  const listener = () => {};
  box.addEventListener("click", listener);
  box.addEventListener("keydown", listener, { once: true });
  box.removeEventListener("click", listener);
  assert.deepEqual(mock.take(), [["listen", box.nodeId, 4], ["listen", box.nodeId, 4 | 128], ["listen", box.nodeId, 128]]);
  box.addEventListener("ping", listener);
  assert.deepEqual(mock.take(), []);
});

test("a host keydown answers getModifierState from its modifier keys", () => {
  const box = createBox();
  const seen = [];
  box.addEventListener("keydown", (event) => seen.push(["Shift", "Control", "Alt", "Meta", "CapsLock"].map((key) => event.getModifierState(key))));
  // Shift (1) and Meta (8) down.
  mock.native.dispatch(7, box.nodeId, 0, 0, 9, 0, 0, "Enter", "Enter");
  assert.deepEqual(seen, [[true, false, false, true, false]]);
});

test("the app's own events go through the tree as on the web", () => {
  const outer = createBox();
  const inner = createBox();
  outer.append(inner);
  const log = [];
  outer.addEventListener("ping", (event) => log.push("outer capture " + event.eventPhase + " " + (event.target === inner)), true);
  inner.addEventListener("ping", (event) => log.push("inner " + event.detail));
  outer.addEventListener("ping", (event) => {
    log.push("outer " + event.eventPhase + " " + (event.currentTarget === outer));
    event.preventDefault();
  });
  assert.equal(inner.dispatchEvent(new CustomEvent("ping", { detail: 3, bubbles: true, cancelable: true })), false);
  assert.deepEqual(log, ["outer capture 1 true", "inner 3", "outer 3 true"]);

  log.length = 0;
  inner.addEventListener("ping", (event) => event.stopImmediatePropagation(), true);
  assert.equal(inner.dispatchEvent(new CustomEvent("ping", { detail: 4, bubbles: true })), true);
  assert.deepEqual(log, ["outer capture 1 true"]);

  log.length = 0;
  outer.dispatchEvent(new Event("ping"));
  assert.deepEqual(log, ["outer capture 2 false", "outer 2 true"]);
});

test("close and navigate requests are events that bubble, and load and error share a bit", () => {
  const pane = createBox();
  const inside = createBox();
  pane.append(inside);
  mock.calls.length = 0;
  const seen = [];
  pane.addEventListener("closerequest", (event) => seen.push(event.type));
  const [call, node, flags] = mock.calls.at(-1);
  assert.deepEqual([call, node, flags], ["listen", pane.nodeId, 1 << 18], "the requests listen with bit 18");
  pane.addEventListener("navigate", (event) => {
    seen.push(`${event.type} ${event.navigationType} ${event.direction}`);
    event.preventDefault();
  });
  assert.equal(mock.native.dispatch(38, inside.nodeId, 0, 0, 0, 0, 0), false);
  assert.equal(mock.native.dispatch(39, inside.nodeId, 0, 0, 0, 0, 0), true);
  assert.equal(mock.native.dispatch(39, inside.nodeId, 1, 0, 0, 0, 0), true);
  assert.deepEqual(seen, ["closerequest", "navigate traverse back", "navigate traverse forward"]);

  const image = createBox();
  mock.calls.length = 0;
  image.addEventListener("error", () => {});
  assert.deepEqual(mock.calls.at(-1), ["listen", image.nodeId, 1 << 17], "error listens with the bit of load");
});

test("preventDefault reaches the host for cancelable events only", () => {
  const box = createBox();
  box.addEventListener("pointerdown", (event) => event.preventDefault());
  box.addEventListener("focus", (event) => event.preventDefault());
  assert.equal(mock.native.dispatch(0, box.nodeId, 0, 0, 0, 0, 1), true);
  assert.equal(mock.native.dispatch(9, box.nodeId, 0, 0, 0, 0, 0), false);
});

test("copy, cut, paste and beforeinput follow the Clipboard API and events", async () => {
  const box = createBox();
  const field = createInput();
  box.append(field);
  mock.take();
  const onCopy = (event) => {
    event.clipboardData.setData("text/plain", "mine");
    event.clipboardData.setData("text", "mine too");
    event.clipboardData.setData("text/html", "<b>mine</b>");
    event.preventDefault();
  };
  box.addEventListener("copy", onCopy);
  box.addEventListener("cut", () => {});
  assert.deepEqual(mock.take(), [["listen", box.nodeId, 2 ** 31]]);
  field.addEventListener("beforeinput", (event) => seen.push(event));
  const [[call, node, flags]] = mock.take();
  assert.deepEqual([call, node, (flags & 2 ** 31) >>> 0], ["listen", field.nodeId, 2 ** 31], "beforeinput shares bit 31, beside what the input keeps");
  box.removeEventListener("copy", onCopy);
  assert.deepEqual(mock.take(), [], "cut still listens on the shared bit");
  box.addEventListener("copy", onCopy);

  const written = [];
  const clipboard = { writeText: async (text) => written.push(["text", text]), write: async (items) => written.push(["items", items[0]]) };
  const before = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { clipboard }, configurable: true });
  globalThis.ClipboardItem = class ClipboardItem {
    constructor(items) {
      this.items = items;
    }
  };
  const seen = [];
  try {
    // A prevented copy writes what the listener set; the tree copies nothing.
    let kept;
    box.addEventListener("copy", (event) => (kept = event), { once: true });
    assert.equal(mock.native.dispatch(34, field.nodeId, 0, 0, 0, 0, 0), true);
    assert.ok(kept instanceof globalThis.ClipboardEvent && kept.bubbles && kept.cancelable && kept.composed);
    assert.deepEqual(written.length, 1);
    assert.equal(kept.clipboardData.getData("text/plain"), "", "the data is protected after the event");
    assert.deepEqual(kept.clipboardData.types, []);

    // A cut no one prevents leaves the default to the tree.
    assert.equal(mock.native.dispatch(35, field.nodeId, 0, 0, 0, 0, 0), false);
    assert.equal(written.length, 1);

    // A paste carries the clipboard, read-only.
    let pasted;
    box.addEventListener("paste", (event) => {
      pasted = { types: event.clipboardData.types, text: event.clipboardData.getData("Text"), html: event.clipboardData.getData("text/html"), file: event.clipboardData.files[0] };
      assert.throws(() => event.clipboardData.items.add("x", "text/plain"), { name: "InvalidStateError" });
      event.clipboardData.setData("text/plain", "ignored");
      event.preventDefault();
    }, { once: true });
    assert.equal(mock.native.dispatch(36, field.nodeId, 0, 0, 0, 0, 0, "plain", "<i>x</i>", "\x89PNG"), true);
    assert.deepEqual(pasted.types, ["text/plain", "text/html", "Files"]);
    assert.equal(pasted.text, "plain");
    assert.equal(pasted.html, "<i>x</i>");
    assert.equal(pasted.file.type, "image/png");
    assert.deepEqual([...new Uint8Array(await pasted.file.arrayBuffer())], [0x89, 0x50, 0x4e, 0x47]);

    // beforeinput says what the edit inserts, and preventing it cancels the edit.
    field.addEventListener("beforeinput", (event) => event.preventDefault(), { once: true });
    assert.equal(mock.native.dispatch(37, field.nodeId, 0, 0, 0, 0, 0, "plain", "insertFromPaste"), true);
    const event = seen.at(-1);
    assert.equal(event.inputType, "insertFromPaste");
    assert.equal(event.data, "plain");
    assert.deepEqual(event.getTargetRanges(), []);
  } finally {
    if (before) Object.defineProperty(globalThis, "navigator", before);
    else delete globalThis.navigator;
    delete globalThis.ClipboardItem;
  }
  const [kind, item] = written[0];
  assert.equal(kind, "items");
  assert.deepEqual(item.items, { "text/plain": "mine too", "text/html": "<b>mine</b>" });
});

test("DataTransfer stores strings and files as the web's does", () => {
  const data = new globalThis.DataTransfer();
  data.setData("Text", "a");
  data.setData("text/plain", "b");
  data.setData("URL", "# comment\nhttps://example.com\nhttps://two");
  assert.deepEqual(data.types, ["text/plain", "text/uri-list"]);
  assert.equal(data.getData("text"), "b");
  assert.equal(data.getData("url"), "https://example.com");
  assert.equal(data.items.length, 2);
  assert.equal(data.items[0].kind, "string");
  assert.throws(() => data.items.add("c", "text/plain"), { name: "NotSupportedError" });
  data.clearData("text/plain");
  assert.deepEqual(data.types, ["text/uri-list"]);
  data.clearData();
  assert.equal(data.items.length, 0);
});

test("pointer events carry the pointer, its buttons and the spec defaults", () => {
  const box = createBox();
  const seen = [];
  for (const type of ["pointerdown", "pointermove", "pointerup", "pointerover", "pointerout"]) {
    box.addEventListener(type, (event) => seen.push([event.type, event.pointerId, event.pointerType, event.isPrimary, event.buttons, event.button, event.pressure, event.width, event.getCoalescedEvents().length]));
  }
  // A touch: pointer 2, type touch (2 << 4), primary (64).
  const touch = 2 * 256 + 2 * 16 + 64;
  mock.native.dispatch(28, box.nodeId, 5, 5, touch, 0, 0);
  mock.native.dispatch(0, box.nodeId, 5, 5, touch, 0, 1);
  mock.native.dispatch(3, box.nodeId, 6, 5, touch, 0, 0);
  mock.native.dispatch(1, box.nodeId, 6, 5, touch, 0, 0);
  // The mouse, with shift held: pointer 1, primary.
  mock.native.dispatch(29, box.nodeId, 6, 5, 256 + 64 + 1, 0, 0);
  assert.deepEqual(seen, [
    ["pointerover", 2, "touch", true, 0, 0, 0, 1, 0],
    ["pointerdown", 2, "touch", true, 1, 0, 0.5, 1, 0],
    ["pointermove", 2, "touch", true, 1, -1, 0.5, 1, 1],
    ["pointerup", 2, "touch", true, 0, 0, 0, 1, 0],
    ["pointerout", 1, "mouse", true, 0, 0, 0, 1, 0],
  ]);
});

test("pointer capture follows the pointer that is down", () => {
  const box = createBox();
  box.addEventListener("pointerdown", (event) => box.setPointerCapture(event.pointerId));
  mock.take();
  assert.throws(() => box.setPointerCapture(9), { name: "NotFoundError" });
  const mouse = 256 + 64;
  mock.native.dispatch(0, box.nodeId, 0, 0, mouse, 0, 1);
  assert.deepEqual(mock.take().filter((call) => call[0] === "capture"), [["capture", box.nodeId]]);
  assert.equal(box.hasPointerCapture(1), true);
  box.releasePointerCapture(1);
  assert.deepEqual(mock.take().filter((call) => call[0] === "capture"), [["capture", 0]]);
  assert.equal(box.hasPointerCapture(1), false);
  mock.native.dispatch(1, box.nodeId, 0, 0, mouse, 0, 0);
  // A finger that is not primary keeps its records where it went down; the tree is not asked.
  const second = 3 * 256 + 2 * 16;
  mock.native.dispatch(0, box.nodeId, 0, 0, second, 0, 1);
  assert.deepEqual(mock.take().filter((call) => call[0] === "capture"), []);
  assert.equal(box.hasPointerCapture(3), true);
  mock.native.dispatch(14, box.nodeId, 0, 0, second, 0, 0);
  assert.equal(box.hasPointerCapture(3), false);
});

test("touch events carry their touch lists and report their own prevention", () => {
  const outer = createBox();
  const inner = createBox();
  outer.appendChild(inner);
  const seen = [];
  for (const type of ["touchstart", "touchmove", "touchend"]) {
    outer.addEventListener(type, (event) => {
      seen.push([event.type, event.cancelable, event.changedTouches[0].identifier, event.touches.length, event.targetTouches.length, event.changedTouches.item(0).target === inner]);
      if (event.type === "touchstart") event.preventDefault();
    });
  }
  const flags = mock.take().filter((call) => call[0] === "listen" && call[1] === outer.nodeId);
  assert.deepEqual(flags.at(-1), ["listen", outer.nodeId, 1 << 30]);
  const first = 2 * 256 + 2 * 16 + 64;
  const second = 3 * 256 + 2 * 16;
  // A prevented pointerdown of a finger does not reach the tree; its touchstart does.
  outer.addEventListener("pointerdown", (event) => event.preventDefault());
  assert.equal(mock.native.dispatch(0, inner.nodeId, 5, 5, first, 0, 1), false);
  assert.equal(mock.native.dispatch(30, inner.nodeId, 5, 5, first, 1, 0), true);
  assert.equal(mock.native.dispatch(30, outer.nodeId, 9, 5, second, 1, 0), true);
  // Once the tree pans, touchmove cannot be prevented; it still goes to the first node.
  mock.native.dispatch(31, inner.nodeId, 5, 30, first, 0, 0);
  mock.native.dispatch(32, outer.nodeId, 9, 5, second, 1, 0);
  mock.native.dispatch(32, inner.nodeId, 5, 30, first, 0, 0);
  assert.deepEqual(seen, [
    ["touchstart", true, 2, 1, 1, true],
    ["touchstart", true, 3, 2, 1, false],
    ["touchmove", false, 2, 2, 1, true],
    ["touchend", true, 3, 1, 0, false],
    ["touchend", false, 2, 0, 0, true],
  ]);
});

test("mouse events follow pointer events, and a tap's come before its click", () => {
  const box = createBox();
  const log = [];
  for (const type of ["pointerdown", "mousedown", "mousemove", "mouseup", "mouseover", "click"]) {
    box.addEventListener(type, (event) => log.push(type));
  }
  const mouse = 256 + 64;
  mock.native.dispatch(28, box.nodeId, 0, 0, mouse, 0, 0);
  mock.native.dispatch(0, box.nodeId, 0, 0, mouse, 0, 1);
  mock.native.dispatch(1, box.nodeId, 0, 0, mouse, 0, 0);
  mock.native.dispatch(2, box.nodeId, 0, 0, mouse, 0, 1);
  assert.deepEqual(log, ["mouseover", "pointerdown", "mousedown", "mouseup", "click"]);
  log.length = 0;
  // A prevented pointerdown mutes the mouse events up to the release.
  const prevent = (event) => event.preventDefault();
  box.addEventListener("pointerdown", prevent);
  mock.native.dispatch(0, box.nodeId, 0, 0, mouse, 0, 1);
  mock.native.dispatch(3, box.nodeId, 1, 0, mouse, 0, 0);
  mock.native.dispatch(1, box.nodeId, 1, 0, mouse, 0, 0);
  mock.native.dispatch(3, box.nodeId, 2, 0, mouse, 0, 0);
  assert.deepEqual(log, ["pointerdown", "mousemove"]);
  box.removeEventListener("pointerdown", prevent);
  log.length = 0;
  const finger = 2 * 256 + 2 * 16 + 64;
  mock.native.dispatch(0, box.nodeId, 0, 0, finger, 0, 1);
  mock.native.dispatch(1, box.nodeId, 0, 0, finger, 0, 0);
  mock.native.dispatch(2, box.nodeId, 0, 0, finger, 0, 1);
  assert.deepEqual(log, ["pointerdown", "mousemove", "mousedown", "mouseup", "click"]);
  log.length = 0;
  box.addEventListener("pointerdown", prevent);
  const next = 3 * 256 + 2 * 16 + 64;
  mock.native.dispatch(0, box.nodeId, 0, 0, next, 0, 1);
  mock.native.dispatch(1, box.nodeId, 0, 0, next, 0, 0);
  mock.native.dispatch(2, box.nodeId, 0, 0, next, 0, 1);
  assert.deepEqual(log, ["pointerdown", "click"]);
});

test("a prevented mousedown prevents the press's default, as a terminal keeps focus with it", () => {
  const box = createBox();
  const mouse = 256 + 64;
  assert.equal(mock.native.dispatch(0, box.nodeId, 0, 0, mouse, 0, 1), false);
  mock.native.dispatch(1, box.nodeId, 0, 0, mouse, 0, 0);
  box.addEventListener("mousedown", (event) => event.preventDefault());
  assert.equal(mock.native.dispatch(0, box.nodeId, 0, 0, mouse, 0, 1), true);
  mock.native.dispatch(1, box.nodeId, 0, 0, mouse, 0, 0);
});

test("transition events bubble with their property and elapsed time", () => {
  const outer = createBox();
  const inner = createBox();
  outer.append(inner);
  mock.take();
  let seen;
  outer.addEventListener("transitionend", (event) => (seen = [event.propertyName, event.elapsedTime, event.pseudoElement, event.target]));
  assert.deepEqual(mock.take(), [["listen", outer.nodeId, 1 << 21]]);
  mock.native.dispatch(21, inner.nodeId, 0.25, 0, 0, 0, 0, "opacity", "::before");
  assert.deepEqual(seen, ["opacity", 0.25, "::before", inner]);
});

test("an input follows what the user types", () => {
  const input = createInput();
  let seen;
  input.addEventListener("input", (event) => (seen = event.value + "/" + event.inputType));
  mock.input(input.nodeId, "abc");
  assert.equal(seen, "abc/insertText");
  assert.equal(input.value, "abc");
});

test("a listener that throws does not stop the dispatch", () => {
  const box = createBox();
  const log = [];
  box.addEventListener("click", () => {
    throw new Error("boom");
  });
  box.addEventListener("click", () => log.push("second"));
  mock.click(box.nodeId);
  assert.deepEqual(log, ["second"]);
  assert.throws(() => mock.native.takeError(), /boom/);
  mock.native.takeError();

  const errors = [];
  setErrorHandler((error) => errors.push(error.message));
  mock.click(box.nodeId);
  assert.deepEqual(errors, ["boom"]);
  setErrorHandler(null);
});

test("unload destroys every node, for a reload", () => {
  const box = createBox({}, createText("bye"));
  mount(box);
  mock.take();
  mock.native.unload();
  const destroyed = mock.take().filter((call) => call[0] === "destroy").map((call) => call[1]);
  assert.ok(destroyed.includes(box.nodeId));
  assert.equal(nodeById(box.nodeId), null);
});

test("removing a listener from a destroyed node sends nothing", () => {
  const child = createBox();
  const box = createBox({}, child);
  const listener = () => {};
  child.addEventListener("click", listener);
  box.destroy();
  mock.take();
  child.removeEventListener("click", listener);
  assert.deepEqual(mock.take().filter((call) => call[0] === "listen"), []);
});

test("a font family list is defined once and named by number", () => {
  mock.take();
  const a = createBox({ fontFamily: "monospace" });
  const b = createBox({ fontFamily: "monospace" });
  const calls = mock.take();
  const defined = calls.filter((call) => call[0] === "fontFamily");
  assert.equal(defined.length, 1);
  assert.equal(defined[0][2], "monospace");
  const id = defined[0][1];
  assert.deepEqual(calls.filter((call) => call[0] === "style"), [
    ["style", a.nodeId, "font-family:" + id + ";", 0],
    ["style", b.nodeId, "font-family:" + id + ";", 0],
  ]);
});

test("keyframes are defined frame by frame, with CSS selectors", () => {
  mock.take();
  defineKeyframes("pulse", { "0%, 100%": { opacity: 1 }, "50%": { opacity: 0.5, width: 10 } });
  assert.deepEqual(mock.take(), [
    ["keyframe", 0, "opacity:1;"],
    ["keyframe", 1, "opacity:1;"],
    ["keyframe", 0.5, "opacity:0.5;width:10px;"],
    ["keyframes", "pulse"],
  ]);
  defineKeyframes("pulse", null);
  assert.deepEqual(mock.take(), [["keyframes", "pulse"]]);
});

test("identical svg markup shares one resource, released when no svg shows it", () => {
  mock.take();
  const svgOf = (d) => {
    const svg = createNode("svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    const path = createSvgElement("path");
    path.setAttribute("d", d);
    svg.appendChild(path);
    return [svg, path];
  };
  const [a, pathA] = svgOf("M20 6 9 17l-5-5");
  const [b] = svgOf("M20 6 9 17l-5-5");
  flushSvg();
  let calls = mock.take();
  const defined = calls.filter((call) => call[0] === "defineIcon");
  assert.equal(defined.length, 1);
  const id = defined[0][1];
  assert.deepEqual(calls.filter((call) => call[0] === "source"), [["source", a.nodeId, id], ["source", b.nodeId, id]]);
  pathA.setAttribute("d", "M18 6 6 18");
  flushSvg();
  calls = mock.take();
  assert.equal(calls.filter((call) => call[0] === "release").length, 0, "b still shows the check");
  b.destroy();
  a.destroy();
  calls = mock.take();
  assert.equal(calls.filter((call) => call[0] === "release").length, 1, "a went live when it changed, so only b held the markup");
  assert.throws(() => createNode("icon"), /no node kind 'icon'/);
});

test("a use of a sprite's symbol draws it: the symbol goes into the markup", () => {
  mock.take();
  const sprite = createBox();
  sprite.innerHTML = '<svg width="0" height="0"><symbol id="sprite-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol></svg>';
  mount(sprite);
  const icon = createNode("svg");
  icon.innerHTML = '<use href="#sprite-check"/>';
  flushSvg();
  const defined = mock.take().filter((call) => call[0] === "defineIcon").map((call) => call[2]);
  const used = defined.find((markup) => markup.includes("<use"));
  assert.ok(used.includes('<defs><symbol id="sprite-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></symbol></defs></svg>'), used);
  assert.ok(!defined.find((markup) => markup.includes('width="0"')).includes("<defs>"), "the sprite names its own ids");
});

test("an image src loads its address once while some node shows it", () => {
  mock.take();
  const png = "data:image/png;base64,iVBORw0KGgo=";
  const a = createImage(png);
  const b = createNode("img");
  b.setAttribute("src", png);
  b.setAttribute("alt", "Logo");
  let calls = mock.take();
  const loads = calls.filter((call) => call[0] === "load");
  assert.equal(loads.length, 1);
  assert.deepEqual(loads[0].slice(2), [png, false]);
  assert.deepEqual(calls.filter((call) => call[0] === "source").map((call) => call[2]), [loads[0][1], loads[0][1]]);
  assert.ok(calls.some((call) => call[0] === "attribute" && call[2] === "label" && call[3] === "Logo"));
  a.destroy();
  b.src = "";
  assert.equal(mock.take().filter((call) => call[0] === "release").length, 1);
});

test("svg markup built from elements draws once as one node, then changes go live per element", async () => {
  mock.take();
  const svg = createNode("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("strokeWidth", 2);
  svg.setAttribute("className", "size-4");
  const path = createSvgElement("path");
  path.setAttribute("d", 'M5 12h14"');
  svg.appendChild(path);
  const title = createSvgElement("title");
  title.append("A < B");
  svg.appendChild(title);
  await Promise.resolve();
  let calls = mock.take();
  const markup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke-width="2"><path d="M5 12h14&quot;"/><title>A &lt; B</title></svg>';
  assert.deepEqual(calls.filter((call) => call[0] === "defineIcon").map((call) => call[2]), [markup]);
  assert.ok(calls.some((call) => call[0] === "attribute" && call[2] === "class" && call[3] === "size-4"), "class is the node's");
  assert.equal(svg.outerHTML, markup);
  path.setAttribute("fill", "currentColor");
  flushSvg();
  calls = mock.take();
  assert.equal(calls.filter((call) => call[0] === "defineIcon").length, 0, "a change after the first draw goes live");
  const id = svg.nodeId;
  assert.deepEqual(calls.filter((call) => call[0].startsWith("svg")), [
    ["svgAttribute", id, 0, "viewBox", "0 0 24 24"],
    ["svgAttribute", id, 0, "stroke-width", "2"],
    ["svgInsert", id, 1, "path", 0, -1],
    ["svgAttribute", id, 1, "d", 'M5 12h14"'],
    ["svgAttribute", id, 1, "fill", "currentColor"],
    ["svgInsert", id, 2, "title", 0, -1],
  ]);
  path.setAttribute("fill", "red");
  title.firstChild.data = "B";
  assert.deepEqual(mock.take(), [["svgAttribute", id, 1, "fill", "red"]], "one write, and title text stays quiet");
  path.destroy();
  title.remove();
  assert.deepEqual(mock.take().filter((call) => call[0].startsWith("svg")), [["svgRemove", id, 1], ["svgRemove", id, 2]]);
  const circle = createSvgElement("circle");
  circle.setAttribute("r", 4);
  svg.appendChild(circle);
  assert.deepEqual(mock.take().filter((call) => call[0].startsWith("svg")), [["svgInsert", id, 2, "circle", 0, -1], ["svgAttribute", id, 2, "r", "4"]], "numbers are reused");
  const text = createSvgElement("text");
  svg.appendChild(text);
  calls = mock.take();
  assert.deepEqual(calls.filter((call) => call[0].startsWith("svg")), [["svgRemove", id, 0]], "content the live svg cannot draw goes back to markup");
  flushSvg();
  assert.equal(mock.take().filter((call) => call[0] === "defineIcon").length, 1);
  assert.ok(svg.outerHTML.endsWith('stroke-width="2"><circle r="4"/><text/></svg>'), svg.outerHTML);
  svg.destroy();
});

test("a deep clone copies classes and an inline svg with its markup", () => {
  const box = createBox();
  box.setAttribute("class", "menu");
  const svg = createNode("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "size-4");
  const group = createSvgElement("g");
  group.setAttribute("fill", "red");
  const title = createSvgElement("title");
  title.append("Logo");
  group.appendChild(title);
  svg.appendChild(group);
  box.appendChild(svg);
  const copy = createBox();
  for (const child of Array.from(box.childNodes)) copy.appendChild(child.cloneNode(true));
  flushSvg();
  assert.equal(copy.firstChild.outerHTML, svg.outerHTML);
  assert.equal(box.cloneNode().className, "menu");
  assert.equal(copy.firstChild.className, svg.className);
  assert.ok(svg.className.includes("size-4"), svg.className);
  assert.notEqual(copy.firstChild.firstChild, group);
  assert.equal(group.cloneNode().childNodes.length, 0, "a shallow clone has no children");
  box.destroy();
  copy.destroy();
});

test("a click inside a link opens its address unless a listener prevents it", () => {
  const opened = [];
  globalThis.open = (url) => opened.push(url);
  const link = createBox();
  const inside = createBox();
  link.append(inside);
  mock.take();
  link.setAttribute("href", "https://example.com/");
  assert.deepEqual(mock.take(), [["listen", link.nodeId, 4], ["attribute", link.nodeId, "href", "https://example.com/"]]);
  mock.click(inside.nodeId);
  assert.deepEqual(opened, ["https://example.com/"]);

  const stop = (event) => event.preventDefault();
  link.addEventListener("click", stop);
  mock.click(inside.nodeId);
  assert.equal(opened.length, 1);
  link.removeEventListener("click", stop);
  assert.deepEqual(mock.take(), [], "the link still wants clicks");

  link.setAttribute("href", "");
  assert.deepEqual(mock.take(), [["listen", link.nodeId, 0], ["attribute", link.nodeId, "href", ""]]);
  delete globalThis.open;
});

test("role and literal ARIA values reach the native attribute pipeline", () => {
  const box = createBox();
  mock.take();
  box.setAttribute("role", "button");
  box.setAttribute("aria-label", "Save");
  box.setAttribute("ariaExpanded", true);
  box.setAttribute("aria-checked", "mixed");
  box.setAttribute("aria-selected", "true");
  box.setAttribute("ariaLevel", 2);
  box.setAttribute("aria-live", "polite");
  assert.deepEqual(mock.take(), [
    ["attribute", box.nodeId, "role", "button"],
    ["attribute", box.nodeId, "aria-label", "Save"],
    ["attribute", box.nodeId, "aria-expanded", "true"],
    ["attribute", box.nodeId, "aria-checked", "mixed"],
    ["attribute", box.nodeId, "aria-selected", "true"],
    ["attribute", box.nodeId, "aria-level", "2"],
    ["attribute", box.nodeId, "aria-live", "polite"],
  ]);
});

test("ARIA range values retain literal spelling and absent bounds", () => {
  const box = createBox();
  mock.take();
  box.setAttribute("aria-valuenow", "2.00");
  box.setAttribute("ariaValueMax", 50);
  box.setAttribute("aria-valuemin", "-2.50e1");
  box.removeAttribute("aria-valuenow");
  assert.equal(box.getAttribute("aria-valuemin"), "-2.50e1");
  assert.equal(box.getAttribute("aria-valuemax"), "50");
  assert.equal(box.getAttribute("aria-valuenow"), null);
  assert.deepEqual(mock.take(), [
    ["attribute", box.nodeId, "aria-valuenow", "2.00"],
    ["attribute", box.nodeId, "aria-valuemax", "50"],
    ["attribute", box.nodeId, "aria-valuemin", "-2.50e1"],
    ["attribute", box.nodeId, "aria-valuenow", null],
  ]);
});

test("ARIA relations retain literal IDs while targets change", () => {
  const field = createBox();
  const title = createBox();
  const hint = createBox();
  mock.take();
  field.setAttribute("aria-labelledby", "title missing");
  title.setAttribute("id", "title");
  field.setAttribute("ariaDescribedBy", "hint");
  hint.setAttribute("id", "hint");
  hint.setAttribute("id", "");
  title.destroy();
  field.setAttribute("aria-labelledby", null);
  assert.deepEqual(mock.take(), [
    ["attribute", field.nodeId, "aria-labelledby", "title missing"],
    ["attribute", title.nodeId, "id", "title"],
    ["attribute", field.nodeId, "aria-describedby", "hint"],
    ["attribute", hint.nodeId, "id", "hint"],
    ["attribute", hint.nodeId, "id", ""],
    ["destroy", title.nodeId],
    ["attribute", field.nodeId, "aria-labelledby", null],
  ]);
});

test("unknown roles warn once while arbitrary ARIA names remain available to selectors", () => {
  const box = createBox();
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    mock.take();
    box.setAttribute("role", "unknown");
    box.setAttribute("role", "unknown");
    box.setAttribute("aria-braillelabel", "x");
    assert.deepEqual(mock.take(), [
      ["attribute", box.nodeId, "role", "unknown"],
      ["attribute", box.nodeId, "role", "unknown"],
      ["attribute", box.nodeId, "aria-braillelabel", "x"],
    ]);
    assert.deepEqual(warnings, ["the tree has no role 'unknown': it is ignored"]);
  } finally {
    console.warn = warn;
  }
});

test("parseMarkdown turns GFM on unless told otherwise", () => {
  mock.take();
  assert.deepEqual(parseMarkdown("# hi"), { type: "root", children: [] });
  parseMarkdown("x", { gfm: false, footnotes: true });
  parseMarkdown("x", { tables: false, alerts: true });
  assert.deepEqual(mock.take().map((call) => call[2]), [15, 16, 78]);
});

test("a rich input sends its document with UTF-8 offsets and names its marks", () => {
  const input = createRichInput();
  assert.equal(createNode("richinput").kind, "input");
  mock.take();
  input.defineMark("bold", { fontWeight: 700 });
  input.defineMark("code", { fontFamily: "monospace", backgroundColor: "#eee" });
  input.defineAtom("mention", { paddingLeft: 4, borderRadius: 4 });
  const text = "héllo " + OBJECT + " x";
  input.document = { text, marks: [{ start: 0, end: 5, marks: ["bold", "code"] }], atoms: [{ kind: "mention", label: "@ada", data: "u1" }] };
  const calls = mock.take();
  assert.deepEqual(calls[0], ["mark", input.nodeId, 0, "font-weight:700;"]);
  assert.equal(calls[1][2], 1);
  assert.deepEqual(calls[2], ["atomStyle", input.nodeId, 0, "padding-left:4px;border-radius:4px;"]);
  assert.deepEqual(calls[3], ["richText", input.nodeId, text, "0,6,3;", "0\0@ada\0u1\0"]);
  assert.equal(input.value, text);

  // An input record from the tree comes back in string indices and mark names.
  const marks = "0,6,1;";
  const atoms = "0\0@ada\0u1\0";
  const after = text + "!";
  let seen = null;
  input.addEventListener("input", (event) => (seen = event));
  globalThis.__ui.dispatch(11, input.nodeId, 13, 13, 0, 1, 0, after, "insertText", marks, atoms);
  assert.equal(seen.inputType, "insertText");
  assert.deepEqual(input.document, { text: after, marks: [{ start: 0, end: 5, marks: ["bold"] }], atoms: [{ kind: "mention", label: "@ada", data: "u1" }] });
  assert.deepEqual(input.activeMarks, ["bold"]);
  assert.equal(input.selectionStart, 10);

  mock.take();
  input.toggleMark("bold");
  input.insertAtom(8, 10, { kind: "mention", label: "@bo", data: "u2" });
  input.setSelectionRange(1, 2);
  assert.deepEqual(mock.take(), [
    ["format", input.nodeId, 0, false],
    ["insertAtom", input.nodeId, 11, 13, "0\0@bo\0u2\0"],
    ["select", input.nodeId, 1, 3],
  ]);
});

test("selectionchange moves the caret of an input and names a rich input's typing marks", () => {
  const input = createRichInput();
  input.defineMark("bold", { fontWeight: 700 });
  input.document = { text: "é" + OBJECT + "x", marks: [], atoms: [{ kind: "mention", label: "@a", data: "" }] };
  mock.take();
  let seen = null;
  input.addEventListener("selectionchange", (event) => (seen = event));
  assert.deepEqual(mock.take(), [], "an input hears selection changes from the start");
  // Bytes 5 and 6 are the end of the object character and of "x".
  globalThis.__ui.dispatch(27, input.nodeId, 5, 6, 0, 1, 0);
  assert.equal(seen.type, "selectionchange");
  assert.equal(seen.selectionStart, 2);
  assert.equal(input.selectionEnd, 3);
  assert.deepEqual(input.activeMarks, ["bold"]);
});

test("announce speaks through a hidden live region made before its text", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const app = mount(createBox());
  mock.take();
  announce("Saved");
  const made = mock.take();
  const region = app.childNodes.at(-1);
  assert.ok(made.some((call) => call[0] === "attribute" && call[1] === region.nodeId && call[2] === "aria-live" && call[3] === "polite"));
  assert.ok(made.some((call) => call[0] === "append" && call[1] === app.nodeId && call[2] === region.nodeId));
  assert.equal(region.childNodes.length, 0, "the text waits, so the region exists before it changes");
  t.mock.timers.tick(100);
  assert.equal(region.childNodes[0].data, "Saved");
  announce("Saved");
  t.mock.timers.tick(100);
  assert.equal(region.childNodes.length, 1, "a repeat replaces the node, so it is a change too");
  assert.equal(app.childNodes.at(-1), region, "one region per politeness");
  announce("Failed", { politeness: "assertive" });
  assert.notEqual(app.childNodes.at(-1), region);
  t.mock.timers.tick(7100);
  assert.equal(region.childNodes.length, 0, "messages go after a while");
});

test("CSS identity is independent from protocol identity", () => {
  const box = createBox();
  const number = box.nodeId;
  box.id = "save";
  assert.equal(box.getAttribute("id"), "save");
  assert.equal(box.nodeId, number);
  assert.equal(nodeById(number), box);
  assert.throws(() => { box.nodeId = 1000; }, TypeError);
  box.className = "button\tprimary button";
  const list = box.classList;
  assert.equal(list.length, 2);
  assert.deepEqual([...list], ["button", "primary"]);
  list.add("wide", "primary");
  assert.equal(box.className, "button primary wide");
  assert.equal(list.toggle("wide", false), false);
  assert.equal(list.toggle("active"), true);
  assert.equal(list.replace("button", "primary"), true);
  assert.equal(list.replace("absent", "other"), false);
  assert.deepEqual([...list], ["primary", "active"]);
  const before = box.className;
  assert.throws(() => list.add("valid", "two words"), { name: "InvalidCharacterError" });
  assert.throws(() => list.remove(""), { name: "SyntaxError" });
  assert.equal(box.className, before);
  box.setAttribute("className", "new");
  assert.deepEqual([...list], ["new"]);
  box.removeAttribute("class");
  box.removeAttribute("id");
  assert.equal(box.classList, list);
  assert.equal(list.length, 0);
  assert.equal(box.id, "");
  assert.equal(box.hasAttribute("class"), false);
  assert.equal(box.hasAttribute("id"), false);
  assert.equal(box.nodeId, number);
});

test("named attributes preserve false, empty, replacement and absence", () => {
  const box = createBox();
  mock.take();
  box.setAttribute("data-state", false);
  box.setAttribute("data-empty", "");
  box.setAttribute("ariaExpanded", false);
  assert.equal(box.getAttribute("data-state"), "false");
  assert.equal(box.getAttribute("data-empty"), "");
  assert.equal(box.getAttribute("aria-expanded"), "false");
  box.setAttribute("data-state", "open");
  box.removeAttribute("data-empty");
  box.removeAttribute("aria-expanded");
  assert.equal(box.getAttribute("data-state"), "open");
  assert.equal(box.getAttribute("data-empty"), null);
  assert.equal(box.getAttribute("ariaExpanded"), null);
  assert.deepEqual(mock.take(), [
    ["attribute", box.nodeId, "data-state", "false"],
    ["attribute", box.nodeId, "data-empty", ""],
    ["attribute", box.nodeId, "aria-expanded", "false"],
    ["attribute", box.nodeId, "data-state", "open"],
    ["attribute", box.nodeId, "data-empty", null],
    ["attribute", box.nodeId, "aria-expanded", null],
  ]);
});


test("custom properties preserve case and unitless numeric tokens", () => {
  mock.take();
  const box = createBox({ "--Scale": 2, "--Gap": "8px", width: "calc(var(--Gap) * var(--Scale))" });
  assert.deepEqual(mock.take(), [
    ["create", box.nodeId, 0],
    ["style", box.nodeId, "--Scale:2;--Gap:8px;width:calc(var(--Gap) * var(--Scale));", 0],
  ]);
  box.style.set({ "--Scale": null });
  assert.deepEqual(mock.take(), [
    ["clearStyle", box.nodeId, 0],
    ["style", box.nodeId, "--Gap:8px;width:calc(var(--Gap) * var(--Scale));", 0],
  ]);
});

test("files dragged over the window enter, leave and drop as on the web", () => {
  const outer = createBox();
  const a = createBox();
  const b = createBox();
  outer.append(a, b);
  mount(outer);
  const seen = [];
  for (const type of ["dragenter", "dragover", "dragleave", "drop"]) {
    outer.addEventListener(type, (event) => seen.push([type, event.target === a ? "a" : event.target === b ? "b" : "outer", event.dataTransfer.files.map((file) => file.name)]));
  }
  mock.take();
  mock.native.shellEvent(0, a.nodeId, 1, 2, "/tmp/x.txt");
  mock.native.shellEvent(1, b.nodeId, 3, 4, "");
  mock.native.shellEvent(3, b.nodeId, 3, 4, "/tmp/x.txt\n/home/me/y.png");
  assert.deepEqual(seen, [
    ["dragenter", "a", []],
    ["dragover", "a", []],
    ["dragenter", "b", []],
    ["dragleave", "a", []],
    ["dragover", "b", []],
    ["drop", "b", ["x.txt", "y.png"]],
  ]);
  // Drag listeners need no listen flags: the host sends every drag.
  assert.deepEqual(mock.take(), []);
  seen.length = 0;
  mock.native.shellEvent(0, a.nodeId, 1, 2, "");
  mock.native.shellEvent(2, 0, 0, 0, "");
  assert.deepEqual(seen.map(([type, target]) => type + " " + target), ["dragenter a", "dragover a", "dragleave a"]);
});

test("notifications, the tray and global shortcuts go to the host and come back", async () => {
  mock.take();
  let clicked = 0;
  const notification = new Notification("Built", { body: "In 2 s" });
  notification.onclick = () => clicked++;
  const [[, call, op, text]] = mock.take();
  assert.equal(op, 0);
  assert.deepEqual(text.split("\x1f"), ["Built", "In 2 s"]);
  mock.native.shellAnswer(call, 7);
  await Promise.resolve();
  mock.native.shellEvent(7, 7, 0, 0, "");
  mock.native.shellEvent(7, 7, 0, 0, "");
  assert.equal(clicked, 1);

  let quit = 0;
  const shown = setTray({ icon: { width: 1, height: 1, data: [255, 0, 16, 255] }, tooltip: "App", menu: [{ label: "Quit, now", click: () => quit++ }, { type: "separator" }, { label: "More", submenu: [{ label: "Off", enabled: false }] }] });
  const [[, trayCall, trayOp, packed]] = mock.take();
  assert.equal(trayOp, 1);
  assert.deepEqual(packed.split("\x1f"), ["App", "1", "1", "0", "ff0010ff", "A1,1,0,,0,Quit, now\nS\nBMore\nA2,0,0,,0,Off\nE"]);
  mock.native.shellAnswer(trayCall, 1);
  assert.equal(await shown, true);
  mock.native.shellEvent(6, 1, 0, 0, "");
  assert.equal(quit, 1);

  let pressed = 0;
  const held = registerShortcut("Mod+Shift+k", () => pressed++);
  const [[, keyCall, keyOp, keys]] = mock.take();
  assert.equal(keyOp, 3);
  assert.deepEqual(keys.split("\x1f"), ["1", "KeyK", "17"]);
  mock.native.shellAnswer(keyCall, 0);
  assert.equal(await held, false);
  mock.native.shellEvent(4, 1, 0, 0, "");
  assert.equal(pressed, 1);
});

test("web views go to the host as text and their events come back", async () => {
  const box = createBox();
  mock.take();
  const view = createWebView(box, { url: "https://silk.test/", profile: "work" });
  const [[, openCall, openOp, opened]] = mock.take();
  assert.equal(openOp, 40);
  assert.deepEqual(opened.split("\x1f"), [String(view.id), String(box.nodeId), "https://silk.test/", "work", "1"]);
  mock.native.shellAnswer(openCall, 1);
  assert.equal(await view.opened, true);

  const titles = [];
  view.addEventListener("titlechange", (event) => titles.push(event.title));
  mock.native.shellEvent(20, view.id, 7, 0, "A\x1fB");
  mock.native.shellEvent(20, view.id, 8, 0, "1\x1f0");
  assert.deepEqual(titles, ["A\x1fB"]);
  assert.equal(view.canGoBack, true);
  assert.equal(view.canGoForward, false);

  view.setZoom(1.25);
  const [[, , zoomOp, zoom]] = mock.take();
  assert.equal(zoomOp, 42);
  assert.deepEqual(zoom.split("\x1f"), [String(view.id), "zoom", "1250"]);

  const value = view.evaluate("1 + 1");
  const [[, , , evaluated]] = mock.take();
  const request = evaluated.split("\x1f")[2];
  mock.native.shellEvent(20, view.id, 12, 0, request + "\x1f1\x1f{\"sum\":2}");
  assert.deepEqual(await value, { sum: 2 });

  const found = view.findInPage("needle", { newSession: true });
  const findRequest = mock.take()[0][3].split("\x1f")[2];
  mock.native.shellEvent(20, view.id, 20, 0, findRequest + "\x1f3\x1f1");
  assert.deepEqual(await found, { matches: 3, activeMatchOrdinal: 1 });

  const failed = view.clickElement("e9");
  const clickRequest = mock.take()[0][3].split("\x1f")[2];
  mock.native.shellEvent(20, view.id, 15, 0, clickRequest + "\x1f0\x1fno such ref");
  await assert.rejects(failed, /no such ref/);

  const cleared = clearWebViewData({ profile: "work", cache: false });
  const [[, , clearOp, clear]] = mock.take();
  assert.equal(clearOp, 43);
  const [clearRequest] = clear.split("\x1f");
  mock.native.shellEvent(20, 0, 21, 0, clearRequest);
  await cleared;
});

test("menus, dialogs and the window go to the host and come back", async () => {
  mock.take();
  let saved = 0;
  setApplicationMenu([
    { role: "appMenu" },
    { label: "File", submenu: [{ label: "Save", accelerator: "CmdOrCtrl+Shift+S", click: () => saved++ }, { label: "Go", accelerator: "F5" }] },
    { role: "viewMenu" },
  ]);
  const [[, , menuOp, menu]] = mock.take();
  assert.equal(menuOp, 7);
  const lines = menu.split("\n");
  assert.deepEqual(lines.slice(0, 3), ["BApp", "R0", "S"], "roles are the system's items");
  const save = lines.find((line) => line.endsWith(",Save"));
  assert.match(save, /^A\d+,1,0,cs,17,Save$/, "a character key with Mod and Shift");
  assert.ok(lines.some((line) => /^A\d+,1,0,nF5,0,Go$/.test(line)), "a named key");
  assert.ok(lines.some((line) => /^A\d+,1,0,c\+,16,Zoom In$/.test(line)), "zoom roles are JavaScript's");
  mock.native.shellEvent(6, Number(save.slice(1, save.indexOf(","))), 0, 0, "");
  assert.equal(saved, 1);

  const picked = showOpenDialog({ properties: ["openDirectory", "multiSelections"], filters: [{ name: "Images", extensions: ["png", ".jpg"] }] });
  const [[, openCall, openOp, openFields]] = mock.take();
  assert.equal(openOp, 5);
  assert.deepEqual(openFields.split("\x1f"), ["", "", "6", "png,jpg"]);
  mock.native.shellAnswer(openCall, 3);
  await Promise.resolve();
  mock.native.shellEvent(8, 3, 0, 0, "/a\n/b c");
  assert.deepEqual(await picked, { canceled: false, filePaths: ["/a", "/b c"] });

  const named = showSaveDialog({ defaultPath: "/tmp/out/report.md" });
  const [[, saveCall, , saveFields]] = mock.take();
  assert.deepEqual(saveFields.split("\x1f"), ["", "/tmp/out", "report.md", ""]);
  mock.native.shellAnswer(saveCall, 4);
  await Promise.resolve();
  mock.native.shellEvent(8, 4, 0, 0, "");
  assert.deepEqual(await named, { canceled: true, filePath: "" });

  let copied = 0;
  const closed = showContextMenu([{ label: "Copy", click: () => copied++ }], { x: 10, y: 20 });
  const [[, menuCall, contextOp, contextFields]] = mock.take();
  assert.equal(contextOp, 8);
  const [x, y, item] = contextFields.split("\x1f");
  assert.deepEqual([x, y], ["10", "20"]);
  mock.native.shellAnswer(menuCall, 1);
  await Promise.resolve();
  mock.native.shellEvent(6, Number(item.slice(1, item.indexOf(","))), 0, 0, "");
  assert.equal(await closed, true);
  assert.equal(copied, 1);

  const changes = [];
  appWindow.addEventListener("fullscreenchange", (event) => changes.push(event.fullScreen));
  appWindow.setFullScreen(false);
  assert.deepEqual(mock.take(), [], "already windowed");
  appWindow.setFullScreen(true);
  assert.deepEqual(mock.take().map((call) => [call[2], call[3]]), [[14, "0"]]);
  mock.native.shellEvent(10, 1, 0, 0, "");
  mock.native.shellEvent(11, 1.25, 0, 0, "");
  assert.deepEqual([changes, appWindow.isFullScreen(), appWindow.getZoomFactor()], [[true], true, 1.25]);
});

test("input selection offsets are UTF-16 indices, as in Chrome", () => {
  const input = createInput();
  const listened = mock.take().find((call) => call[0] === "listen" && call[1] === input.nodeId);
  assert.ok(listened && (listened[2] & (1 << 11)) && (listened[2] & (1 << 27)), "it keeps value and selection current");

  // a, 4-byte emoji (2 units), é (2 bytes), 漢字 (3 bytes each), b.
  const value = "a\u{1F600}\u00e9\u6f22\u5b57b";
  input.value = value;
  assert.deepEqual([input.selectionStart, input.selectionEnd], [7, 7], "a new value puts the caret at its end");
  mock.take();

  input.setSelectionRange(1, 4, "backward");
  assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [1, 4, "backward"]);
  assert.deepEqual(mock.take(), [["select", input.nodeId, 7, 1]], "anchor at the end, in bytes");

  // The rest of these follow what Chrome answered for the same calls.
  input.setSelectionRange(5, 2);
  assert.deepEqual([input.selectionStart, input.selectionEnd, input.selectionDirection], [2, 2, "forward"]);
  input.setSelectionRange(0, 99);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 7]);
  input.selectionStart = 3;
  assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 7]);
  input.selectionEnd = 1;
  assert.deepEqual([input.selectionStart, input.selectionEnd], [1, 1]);

  input.setSelectionRange(1, 3);
  input.setRangeText("XY");
  assert.deepEqual([input.value, input.selectionStart, input.selectionEnd], ["aXY\u00e9\u6f22\u5b57b", 1, 3]);
  input.value = "hello world";
  input.setSelectionRange(2, 4);
  input.setRangeText("ZZZ", 6, 11, "select");
  assert.deepEqual([input.value, input.selectionStart, input.selectionEnd], ["hello ZZZ", 6, 9]);
  input.setRangeText("Q", 0, 1, "start");
  assert.deepEqual([input.value, input.selectionStart, input.selectionEnd], ["Qello ZZZ", 0, 0]);
  input.setRangeText("W", 0, 1, "end");
  assert.deepEqual([input.value, input.selectionStart, input.selectionEnd], ["Wello ZZZ", 1, 1]);
  input.setSelectionRange(3, 8);
  input.setRangeText("", 0, 5);
  assert.deepEqual([input.value, input.selectionStart, input.selectionEnd], [" ZZZ", 0, 3]);
  input.select();
  assert.deepEqual([input.selectionStart, input.selectionEnd], [0, 4]);
  assert.throws(() => input.setRangeText("x", 3, 1), (error) => error.name === "IndexSizeError");

  // The tree reports bytes: the caret after the emoji and the combining mark.
  input.value = "a\u{1F600}e\u0301\u6f22";
  globalThis.__ui.dispatch(27, input.nodeId, 5, 8, 0, 0, 0);
  assert.deepEqual([input.selectionStart, input.selectionEnd], [3, 5]);
  const heard = [];
  input.addEventListener("input", (event) => heard.push([event.inputType, event.data, event.isComposing]));
  globalThis.__ui.dispatch(11, input.nodeId, 14, 14, 0, 0, 0, input.value + "\u5b57", "insertText");
  assert.deepEqual([input.value.length, input.selectionStart], [7, 7]);
  globalThis.__ui.dispatch(11, input.nodeId, 11, 11, 0, 0, 0, "a\u{1F600}e\u0301\u5b57", "deleteContentBackward");
  globalThis.__ui.dispatch(11, input.nodeId, 4, 4, 0, 0, 0, "a\u{1F600}xye\u0301\u5b57", "insertText");
  assert.deepEqual(heard, [["insertText", "\u5b57", false], ["deleteContentBackward", null, false], ["insertText", "xy", false]]);
});

test("setRangeText on a rich input keeps marks and atoms outside the range", () => {
  const input = createRichInput();
  input.defineMark("bold", { fontWeight: 700 });
  input.document = { text: "hi " + OBJECT + " there", marks: [{ start: 4, end: 10, marks: ["bold"] }], atoms: [{ kind: "mention", label: "@a", data: "" }] };
  input.setRangeText("hello", 0, 2, "end");
  assert.deepEqual(input.document, {
    text: "hello " + OBJECT + " there",
    marks: [{ start: 7, end: 13, marks: ["bold"] }],
    atoms: [{ kind: "mention", label: "@a", data: "" }],
  });
  assert.deepEqual([input.selectionStart, input.selectionEnd], [5, 5]);
  input.setRangeText("x" + OBJECT, 5, 8, "select");
  assert.deepEqual(input.document, { text: "hellox\ufffdthere", marks: [{ start: 7, end: 12, marks: ["bold"] }], atoms: [] });
  assert.deepEqual([input.selectionStart, input.selectionEnd], [5, 7]);
});

test("listeners on svg elements make the svg live and hear the shape under the pointer", () => {
  mock.take();
  const svg = createNode("svg");
  const group = createSvgElement("g");
  const a = createSvgElement("rect");
  const b = createSvgElement("rect");
  group.appendChild(a);
  svg.append(group, b);
  const heard = [];
  const log = (name) => (event) => heard.push(name + ":" + event.type + "@" + (event.target.localName ?? "?") + (event.target === a ? "a" : event.target === b ? "b" : ""));
  group.addEventListener("pointerenter", log("g"));
  group.addEventListener("pointerleave", log("g"));
  b.addEventListener("click", log("b"));
  svg.addEventListener("click", log("svg"));
  flushSvg();
  const calls = mock.take();
  assert.equal(calls.filter((call) => call[0] === "defineIcon").length, 0, "listeners draw it live from the start");
  const listen = calls.filter((call) => call[0] === "listen" && call[1] === svg.nodeId).at(-1);
  for (const kind of [2, 3, 4, 5, 28, 29]) assert.ok(listen[2] & (1 << kind), "listens for kind " + kind);
  const at = (element) => element._n * 4294967296 + 256 + 64;
  mock.native.dispatch(28, svg.nodeId, 5, 5, at(a), 0, 0);
  mock.native.dispatch(4, svg.nodeId, 5, 5, at(a), 0, 0);
  mock.native.dispatch(3, svg.nodeId, 50, 5, at(b), 0, 0);
  mock.native.dispatch(2, svg.nodeId, 50, 5, at(b), 0, 1);
  mock.native.dispatch(2, svg.nodeId, 90, 90, 256 + 64, 0, 1);
  assert.deepEqual(heard, ["g:pointerenter@g", "g:pointerleave@g", "b:click@rectb", "svg:click@rectb", "svg:click@svg"]);
  svg.destroy();
});

test("svg elements measure their markup for getBBox and path lengths", () => {
  mock.take();
  const group = createSvgElement("g");
  group.setAttribute("transform", "scale(2)");
  const path = createSvgElement("path");
  path.setAttribute("d", "M60 60h30v30h-30z");
  group.appendChild(path);
  assert.deepEqual({ ...group.getBBox() }, { x: 1, y: 2, width: 3, height: 4 });
  assert.equal(path.getTotalLength(), 120);
  assert.deepEqual(path.getPointAtLength(45), { x: 90, y: 75 });
  assert.deepEqual(mock.take().map((call) => call.slice(1)), [
    [0, "0\x1fg\x1ftransform\x1fscale(2)\x1e1\x1fpath\x1fd\x1fM60 60h30v30h-30z", 0],
    [1, "0\x1fpath\x1fd\x1fM60 60h30v30h-30z", 0],
    [2, "0\x1fpath\x1fd\x1fM60 60h30v30h-30z", 45],
  ]);
});

test("an empty node shares no list with another, and its looks read back as CSS", () => {
  const a = createBox();
  const b = createBox();
  assert.deepEqual(a.childNodes, []);
  assert.equal(a.firstChild, null);
  assert.equal(a.hasChildNodes(), false);
  const child = createText("x");
  assert.equal(child.kind, "text");
  assert.equal(child.cloneNode().kind, "text");
  assert.equal(a.kind, "box");
  a.appendChild(child);
  assert.deepEqual(a.childNodes, [child]);
  assert.deepEqual(b.childNodes, []);
  assert.equal(child.parentNode, a);
  a.removeChild(child);
  assert.deepEqual(a.childNodes, []);
  b.insertBefore(child);
  assert.equal(b.firstChild, child);
  a.style.set({ width: 12, fontWeight: 600, color: "red" });
  assert.equal(a.style.get("width"), "12px");
  assert.equal(a.style.get("fontWeight"), "600");
  assert.equal(a.style.cssText, "width: 12px; font-weight: 600; color: red;");
  mock.take();
  a.style.set({ width: 12 });
  assert.deepEqual(mock.take(), []);
  a.look("hover").set({ opacity: 0.5 });
  a.setAttribute("data-x", "1");
  let heard = 0;
  a.addEventListener("click", () => heard++);
  const copy = a.cloneNode(true);
  assert.equal(copy.look("hover").get("opacity"), "0.5");
  assert.equal(copy.getAttribute("data-x"), "1");
  assert.equal(copy.style.cssText, a.style.cssText);
  b.destroy();
  assert.deepEqual(b.childNodes, []);
  assert.equal(child.parentNode, null);
  assert.equal(heard, 0);
});

test("an svg clones deeply with its markup attributes, elements and text", () => {
  const svg = createNode("svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("className", "size-4");
  const path = createSvgElement("path");
  path.setAttribute("d", "M5 12h14");
  svg.appendChild(path);
  const title = createSvgElement("title");
  title.append("Model");
  svg.appendChild(title);
  const copy = svg.cloneNode(true);
  assert.notEqual(copy, svg);
  assert.equal(copy.outerHTML, svg.outerHTML);
  assert.equal(copy.getAttribute("className"), svg.getAttribute("className"));
  assert.equal(copy.getAttribute("viewBox"), "0 0 24 24");
  assert.notEqual(copy.firstChild, path);
  assert.equal(svg.cloneNode(false).childNodes.length, 0);
});
