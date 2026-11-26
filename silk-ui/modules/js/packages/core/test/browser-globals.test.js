import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installMock } from "./mock.js";

const mock = installMock();
globalThis.__silkStorageDir = mkdtempSync(join(tmpdir(), "silkui-storage-"));
await import("../src/globals.js");
const core = await import("../src/index.js");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the document is html > body at the tree's root, under document and window for events", () => {
  assert.equal(core.root(), document.documentElement);
  assert.equal(document.body.parentNode, document.documentElement);
  assert.equal(document.body.ownerDocument, document);
  assert.ok(document.body instanceof HTMLElement);
  assert.ok(document.body instanceof Element);
  assert.ok(!(document.createTextNode("x") instanceof HTMLElement));
  assert.ok(document.createTextNode("x") instanceof Text);
  const button = document.createElement("div");
  document.body.appendChild(button);
  assert.equal(button.parentElement, document.body);
  assert.ok(button.isConnected);
  mock.take();
  const seen = [];
  document.addEventListener("click", (event) => seen.push(["document", event.target === button, event.eventPhase]));
  window.addEventListener("click", (event) => seen.push(["window", event.currentTarget === window]), true);
  button.addEventListener("click", () => seen.push(["button"]));
  // The root listens so that the tree sends clicks anywhere in it.
  assert.ok(mock.take().some((call) => call[0] === "listen" && call[1] === document.documentElement.nodeId));
  mock.click(button.nodeId);
  assert.deepEqual(seen, [["window", true], ["button"], ["document", true, 3]]);
});

test("a scroll event passes the listeners above its target in the capture phase only", () => {
  const scroller = document.createElement("div");
  const holder = document.createElement("div");
  holder.appendChild(scroller);
  document.body.appendChild(holder);
  const seen = [];
  const note = (name) => (event) => seen.push(name + ":" + event.eventPhase);
  window.addEventListener("scroll", note("window capture"), true);
  window.addEventListener("scroll", note("window"));
  document.addEventListener("scroll", note("document capture"), true);
  document.addEventListener("scroll", note("document"));
  holder.addEventListener("scroll", note("holder capture"), true);
  holder.addEventListener("scroll", note("holder"));
  scroller.addEventListener("scroll", note("target"));
  mock.native.dispatch(12, scroller.nodeId, 0, 30, 0, 0, 0, undefined, undefined);
  assert.deepEqual(seen, ["window capture:1", "document capture:1", "holder capture:1", "target:2"]);

  // `load` stops at the document: the window is not on its path (DOM, get the parent).
  const loads = [];
  window.addEventListener("load", () => loads.push("window"), true);
  document.addEventListener("load", () => loads.push("document"), true);
  mock.native.dispatch(17, scroller.nodeId, 0, 0, 0, 0, 0, undefined, undefined);
  assert.deepEqual(loads, ["document"]);
  holder.remove();
});

test("selectionchange reaches document listeners", () => {
  const box = document.createElement("div");
  document.body.appendChild(box);
  let heard = 0;
  const listener = () => heard++;
  document.addEventListener("selectionchange", listener);
  mock.native.dispatch(27, box.nodeId, 0, 0, 0, 0, 0);
  document.removeEventListener("selectionchange", listener);
  assert.equal(heard, 1);
});

test("style takes CSSOM's setProperty for custom properties and CSS names", () => {
  mock.take();
  const root = document.documentElement;
  root.style.setProperty("--accent", "red");
  root.style.setProperty("background-color", "blue");
  assert.equal(root.style.getPropertyValue("--accent"), "red");
  assert.equal(root.style.getPropertyValue("background-color"), "blue");
  assert.equal(root.style.removeProperty("--accent"), "red");
  assert.equal(root.style.getPropertyValue("--accent"), "");
  assert.ok(mock.take().some((call) => call[0] === "style" && /--accent:red;/.test(call[2])));
  root.classList.add("dark");
  assert.equal(root.className, "dark");
});

test("dataset maps camelCase names to data-* attributes", () => {
  const root = document.documentElement;
  root.dataset.themeId = "dusk";
  assert.equal(root.getAttribute("data-theme-id"), "dusk");
  assert.equal(root.dataset.themeId, "dusk");
  assert.ok("themeId" in root.dataset);
  assert.deepEqual(Object.keys(root.dataset), ["themeId"]);
  assert.deepEqual({ ...root.dataset }, { themeId: "dusk" });
  delete root.dataset.themeId;
  assert.equal(root.hasAttribute("data-theme-id"), false);
  assert.equal(root.dataset.themeId, undefined);
  const tab = document.createElement("div");
  tab.setAttribute("data-preview-tab", "3");
  assert.equal(tab.dataset.previewTab, "3");
  assert.equal(document.body.dataset, document.body.dataset);
});

test("elements take the DOM's positional edits, text and reflected attributes", () => {
  const list = document.createElement("div");
  const middle = document.createElement("span");
  list.append(middle);
  middle.before("a");
  middle.after(document.createElement("i"), "z");
  list.prepend("start");
  assert.equal(list.textContent, "startaz");
  middle.replaceWith("m");
  assert.equal(list.textContent, "startamz");
  list.insertAdjacentHTML("beforeend", "<b>end</b>");
  assert.equal(list.lastChild.textContent, "end");
  list.textContent = "only";
  assert.equal(list.childNodes.length, 1);
  assert.equal(list.toggleAttribute("open"), true);
  list.hidden = true;
  assert.ok(list.hasAttribute("hidden"));
  list.title = "tip";
  assert.equal(list.getAttribute("title"), "tip");
  document.body.prepend(list);
  assert.equal(document.body.firstChild, list);
  assert.equal(document.body.compareDocumentPosition(list) & 16, 16);
  list.remove();
});

test("custom elements are nodes of their tag with the class's prototype and callbacks", async () => {
  const seen = [];
  class Panel extends HTMLElement {
    static observedAttributes = ["size"];
    connectedCallback() { seen.push("connected"); }
    attributeChangedCallback(name, _old, value) { seen.push(name + "=" + value); }
    get label() { return "panel " + this.localName; }
  }
  customElements.define("x-panel", Panel);
  const panel = document.createElement("x-panel");
  assert.ok(panel instanceof Panel && panel instanceof HTMLElement);
  assert.equal(panel.label, "panel x-panel");
  const shadow = panel.attachShadow({ mode: "open" });
  assert.equal(panel.shadowRoot, shadow);
  document.body.append(panel);
  panel.setAttribute("size", "2");
  await tick();
  assert.deepEqual(seen, ["connected", "size=2"]);
  assert.equal(customElements.get("x-panel"), Panel);
  panel.remove();
});

test("MutationObserver records child lists, attributes and text", async () => {
  const box = document.createElement("div");
  document.body.appendChild(box);
  const records = [];
  const observer = new MutationObserver((list) => records.push(...list));
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, characterData: true });
  const text = document.createTextNode("a");
  box.appendChild(text);
  box.setAttribute("data-x", "1");
  box.setAttribute("data-x", "2");
  text.data = "b";
  box.removeChild(text);
  await Promise.resolve();
  assert.deepEqual(records.map((record) => record.type), ["childList", "attributes", "attributes", "characterData", "childList"]);
  assert.equal(records[0].addedNodes[0], text);
  assert.equal(records[2].oldValue, "1");
  assert.equal(records[3].oldValue, null);
  assert.equal(records[4].removedNodes[0], text);
  observer.disconnect();
  box.setAttribute("data-x", "3");
  await Promise.resolve();
  assert.equal(records.length, 5);
});

test("MutationObserver on the document or <html> with subtree sees changes anywhere in it", async () => {
  for (const target of [document, document.documentElement]) {
    const records = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
    const box = document.createElement("div");
    document.body.appendChild(box);
    const text = document.createTextNode("a");
    box.appendChild(text);
    box.setAttribute("data-y", "1");
    text.data = "b";
    box.remove();
    await Promise.resolve();
    assert.deepEqual(records.map((record) => record.type), ["childList", "childList", "attributes", "characterData", "childList"]);
    assert.equal(records[0].target, document.body);
    observer.disconnect();
  }
});

test("MutationObserver handles re-observe, attributeFilter, multi-target dedup, and delivery order", async () => {
  const parent = document.createElement("div");
  const child = document.createElement("div");
  parent.appendChild(child);
  document.body.appendChild(parent);

  const order = [];
  const first = new MutationObserver((list) => order.push(["first", list.length, list[0].attributeName, list[0].oldValue]));
  const second = new MutationObserver((list) => order.push(["second", list.length, list[0].attributeName, list[0].oldValue]));

  // Observe both parent (subtree) and child directly with the same observer: one record per mutation.
  first.observe(parent, { attributes: true, subtree: true, attributeFilter: ["data-a"] });
  first.observe(child, { attributes: true, attributeOldValue: true, attributeFilter: ["data-a"] });
  second.observe(parent, { attributes: true, subtree: true, attributeFilter: ["data-a", "data-b"] });

  child.setAttribute("data-a", "1");
  child.setAttribute("data-b", "2");
  await Promise.resolve();
  assert.deepEqual(order, [
    ["first", 1, "data-a", null],
    ["second", 2, "data-a", null],
  ]);

  // Re-observing replaces options cleanly without leaking counts.
  order.length = 0;
  first.observe(child, { attributes: true, attributeOldValue: true, attributeFilter: ["data-b"] });
  child.setAttribute("data-b", "3");
  await Promise.resolve();
  assert.deepEqual(order, [
    ["first", 1, "data-b", "2"],
    ["second", 1, "data-b", null],
  ]);

  first.disconnect();
  second.disconnect();
  parent.remove();
});

test("a deep clone keeps each element's tag and hands the tree only attributes it knows", () => {
  const panel = document.createElement("div");
  const make = (tag, type) => {
    const element = document.createElement(tag);
    if (type) element.setAttribute("type", type);
    element.setAttribute("tabindex", "0");
    element.setAttribute("data-slot", tag);
    element.setAttribute("aria-label", tag);
    panel.appendChild(element);
    return element;
  };
  for (const tag of ["button", "input", "textarea", "img", "canvas", "svg"]) make(tag);
  make("input", "checkbox");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("tabindex", "-1");
  path.setAttribute("data-icon", "x");
  panel.lastChild.previousSibling.appendChild(path);
  mock.take();
  const copy = panel.cloneNode(true);
  const handed = mock.take().filter((call) => call[0] === "attribute").map((call) => call[2]);
  assert.ok(!handed.includes("tabindex"), "the tree's attribute is tabIndex");
  assert.deepEqual(copy.childNodes.map((node) => node.localName), panel.childNodes.map((node) => node.localName));
  for (const [index, node] of copy.childNodes.entries()) {
    assert.equal(node.getAttribute("tabindex"), "0");
    assert.equal(node.getAttribute("data-slot"), panel.childNodes[index].localName);
    assert.equal(node.getAttribute("aria-label"), panel.childNodes[index].localName);
    assert.equal(node.constructor, panel.childNodes[index].constructor);
  }
  assert.equal(copy.lastChild.getAttribute("type"), "checkbox");
  assert.equal(copy.childNodes[5].firstChild.getAttribute("data-icon"), "x");
});

test("host events are instances of the global Event, and only of their own subclasses", () => {
  const image = document.createElement("img");
  const load = new core.Event("load", image);
  assert.ok(load instanceof Event);
  assert.ok(load instanceof window.Event);
  assert.ok(!(load instanceof ProgressEvent));
  assert.ok(!(load instanceof MouseEvent));
  assert.ok(new core.Event("click", image) instanceof MouseEvent);
  assert.ok(new Event("x") instanceof Event);
});

test("history and location keep entries and send popstate and hashchange", async () => {
  assert.equal(location.href, "http://localhost/");
  const events = [];
  const onPop = (event) => events.push(["popstate", event.state, location.hash]);
  const onHash = (event) => events.push(["hashchange", event.newURL]);
  window.addEventListener("popstate", onPop);
  window.addEventListener("hashchange", onHash);
  history.pushState({ a: 1 }, "", "#/one");
  history.pushState({ a: 2 }, "", "#/two");
  assert.equal(location.hash, "#/two");
  assert.equal(history.length, 3);
  history.back();
  await tick();
  assert.equal(location.hash, "#/one");
  assert.deepEqual(events.shift(), ["popstate", { a: 1 }, "#/one"]);
  assert.deepEqual(events.shift(), ["hashchange", "http://localhost/#/one"]);
  location.hash = "#/three";
  await tick();
  assert.deepEqual(events.shift(), ["hashchange", "http://localhost/#/three"]);
  assert.equal(history.length, 3);
  assert.throws(() => history.pushState(null, "", "https://example.com/"));
  window.removeEventListener("popstate", onPop);
  window.removeEventListener("hashchange", onHash);
});

test("navigation follows the session history and navigates it", async () => {
  const changes = [];
  const onChange = (event) => changes.push([event.navigationType, navigation.currentEntry.url]);
  navigation.addEventListener("currententrychange", onChange);
  const start = navigation.entries().length;
  history.pushState(null, "", "/settings");
  assert.equal(navigation.canGoBack, true);
  assert.equal(navigation.canGoForward, false);
  assert.equal(navigation.currentEntry.url, "http://localhost/settings");
  assert.equal(navigation.entries().length, start + 1);
  const { finished } = navigation.navigate("/threads/1", { state: { open: true } });
  assert.equal((await finished).getState().open, true);
  assert.equal(location.pathname, "/threads/1");
  navigation.back();
  assert.equal(location.pathname, "/settings");
  assert.equal(navigation.canGoForward, true);
  const cancel = (event) => event.preventDefault();
  navigation.addEventListener("navigate", cancel);
  await assert.rejects(navigation.navigate("/nowhere").finished);
  navigation.removeEventListener("navigate", cancel);
  assert.equal(location.pathname, "/settings");
  assert.deepEqual(changes, [["push", "http://localhost/settings"], ["push", "http://localhost/threads/1"], ["traverse", "http://localhost/settings"]]);
  navigation.removeEventListener("currententrychange", onChange);
  await tick();
});

test("head is in the document, CSS.escape escapes and HTML tags are upper case", () => {
  assert.equal(document.documentElement.firstChild, document.head);
  assert.equal(document.head.parentNode, document.documentElement);
  assert.equal(CSS.escape("1a b"), "\\31 a\\ b");
  assert.equal(document.createElement("button").tagName, "BUTTON");
  assert.equal(document.createElementNS("http://www.w3.org/2000/svg", "svg").tagName, "svg");
});

test("fetch resolves against location and serves the app's own files", async () => {
  const dir = mkdtempSync(join(tmpdir(), "silkui-app-"));
  writeFileSync(join(dir, "pty.wasm"), new Uint8Array([0, 97, 115, 109]));
  globalThis.__silkAppBase = pathToFileURL(dir + "/").href;
  try {
    const response = await fetch("/pty.wasm");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/wasm");
    assert.equal(response.url, "http://localhost/pty.wasm");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 97, 115, 109]);
    assert.equal((await fetch("missing.js")).status, 404);
  } finally {
    delete globalThis.__silkAppBase;
  }
});

test("EventSource reads a server-sent event stream", async () => {
  const { createServer } = await import("node:http");
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/event-stream" });
    response.write(": hello\n\nid: 7\ndata: one\ndata: two\n\nevent: tick\ndata: 3\n\n");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const source = new EventSource("http://127.0.0.1:" + server.address().port + "/events");
  const message = new Promise((resolve) => { source.onmessage = (event) => resolve([event.data, event.lastEventId]); });
  const tick = new Promise((resolve) => source.addEventListener("tick", (event) => resolve(event.data)));
  assert.deepEqual(await message, ["one\ntwo", "7"]);
  assert.equal(await tick, "3");
  assert.equal(source.readyState, EventSource.OPEN);
  source.close();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

test("navigator.mediaDevices has no devices", async () => {
  assert.deepEqual(await navigator.mediaDevices.enumerateDevices(), []);
  await assert.rejects(navigator.mediaDevices.getUserMedia({ audio: true }), { name: "NotFoundError" });
});

test("localStorage keeps items in a file, sessionStorage in memory", async () => {
  localStorage.setItem("theme", "dark");
  localStorage.count = 2;
  assert.equal(localStorage.getItem("count"), "2");
  assert.equal(localStorage.length, 2);
  assert.deepEqual(Object.keys(localStorage).sort(), ["count", "theme"]);
  await tick();
  const { readFileSync } = await import("node:fs");
  assert.deepEqual(JSON.parse(readFileSync(join(globalThis.__silkStorageDir, "localStorage.json"), "utf8")), { theme: "dark", count: "2" });
  sessionStorage.setItem("a", "b");
  assert.equal(sessionStorage.getItem("a"), "b");
  assert.equal(sessionStorage.getItem("missing"), null);
  assert.ok(localStorage instanceof Storage);
});

const request = (value) => new Promise((resolve, reject) => {
  value.onsuccess = () => resolve(value.result);
  value.onerror = () => reject(value.error);
});

test("indexedDB opens, upgrades, stores, indexes, walks cursors and aborts", async () => {
  const open = indexedDB.open("app", 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore("plain");
    db.createObjectStore("queries").createIndex("updated", ["environmentId", "updatedAt"]);
  };
  const db = await request(open);
  assert.deepEqual([...db.objectStoreNames], ["plain", "queries"]);
  const write = db.transaction(["plain", "queries"], "readwrite");
  write.objectStore("plain").put({ n: 1 }, "a");
  write.objectStore("plain").put({ n: 2 }, "b");
  const queries = write.objectStore("queries");
  queries.put({ environmentId: "e1", updatedAt: 3 }, "e1:x");
  queries.put({ environmentId: "e1", updatedAt: 1 }, "e1:y");
  queries.put({ environmentId: "e2", updatedAt: 2 }, "e2:z");
  await new Promise((resolve) => (write.oncomplete = resolve));

  const read = db.transaction("plain");
  assert.deepEqual(await request(read.objectStore("plain").get("b")), { n: 2 });
  assert.deepEqual(await request(read.objectStore("plain").getAll()), [{ n: 1 }, { n: 2 }]);

  const walk = db.transaction("queries", "readwrite");
  const keys = [];
  const cursorRequest = walk.objectStore("queries").index("updated").openKeyCursor(IDBKeyRange.bound(["e1"], ["e1", []]), "prev");
  cursorRequest.onsuccess = () => {
    const cursor = cursorRequest.result;
    if (!cursor) return;
    keys.push(cursor.primaryKey);
    if (cursor.primaryKey === "e1:y") walk.objectStore("queries").delete(cursor.primaryKey);
    cursor.continue();
  };
  await new Promise((resolve) => (walk.oncomplete = resolve));
  assert.deepEqual(keys, ["e1:x", "e1:y"]);
  assert.deepEqual(await request(db.transaction("queries").objectStore("queries").getAllKeys()), ["e1:x", "e2:z"]);

  const aborted = db.transaction("plain", "readwrite");
  aborted.objectStore("plain").put({ n: 9 }, "a");
  aborted.abort();
  await new Promise((resolve) => (aborted.onabort = resolve));
  assert.deepEqual(await request(db.transaction("plain").objectStore("plain").get("a")), { n: 1 });
  assert.equal(indexedDB.cmp([1, "a"], [1, "b"]), -1);
});

test("a SharedWorker is one worker for its script, with a port per client", async () => {
  const dir = mkdtempSync(join(tmpdir(), "silkui-shared-"));
  const file = join(dir, "count.js");
  writeFileSync(file, "let clients = 0; onconnect = (event) => { const port = event.ports[0]; clients++; port.postMessage(clients); };");
  const url = pathToFileURL(file).href;
  const first = new SharedWorker(url);
  const second = new SharedWorker(url);
  const answer = (worker) => new Promise((resolve) => worker.port.once("message", resolve));
  const counts = await Promise.all([answer(first), answer(second)]);
  assert.deepEqual(counts.sort(), [1, 2]);
  first.port.close();
  second.port.close();
});

test("a Worker runs a module on its own thread and answers messages", async () => {
  const directory = mkdtempSync(join(tmpdir(), "silkui-worker-"));
  const file = join(directory, "echo.js");
  writeFileSync(file, "self.onmessage = (event) => postMessage(event.data * 2);");
  const worker = new Worker(pathToFileURL(file), { type: "module" });
  const answer = new Promise((resolve) => (worker.onmessage = (event) => resolve(event.data)));
  worker.postMessage(21);
  assert.equal(await answer, 42);
  worker.terminate();
});

test("the window's size is the root's", () => {
  assert.equal(typeof innerWidth, "number");
  assert.equal(typeof matchMedia, "undefined" === typeof matchMedia ? "undefined" : "function");
  assert.equal(document.activeElement, document.body);
  assert.equal(document.getElementById("nothing"), null);
});

test("createImageBitmap decodes a Blob on the host and crops, resizes and flips pixels", async () => {
  // A stand-in decoder: a 2 by 1 picture, red then half transparent green.
  mock.native.imageDecode = (bytes) => (bytes[0] === 0x89 ? 2 : 0);
  mock.native.geometry = (at) => [2, 1][at];
  mock.native.imageTake = (into) => into.set([255, 0, 0, 255, 0, 255, 0, 128]);
  const bitmap = await createImageBitmap(new Blob([new Uint8Array([0x89, 0x50])], { type: "image/png" }));
  assert.ok(bitmap instanceof ImageBitmap);
  assert.deepEqual([bitmap.width, bitmap.height], [2, 1]);
  assert.deepEqual([...bitmap._pixels.data], [255, 0, 0, 255, 0, 255, 0, 128]);
  await assert.rejects(createImageBitmap(new Blob(["<svg/>"])), { name: "InvalidStateError" });

  const image = { width: 2, height: 2, data: new Uint8ClampedArray([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 255, 4, 4, 4, 255]) };
  const copied = await createImageBitmap(image);
  image.data[0] = 9;
  assert.equal(copied._pixels.data[0], 1);
  const cropped = await createImageBitmap(image, 1, -1, 2, 2);
  assert.deepEqual([...cropped._pixels.data], [0, 0, 0, 0, 0, 0, 0, 0, 2, 2, 2, 255, 0, 0, 0, 0]);
  const flipped = await createImageBitmap(copied, { imageOrientation: "flipY" });
  assert.deepEqual([...flipped._pixels.data.slice(0, 4)], [3, 3, 3, 255]);
  const shrunk = await createImageBitmap(copied, { resizeWidth: 1, resizeHeight: 1, resizeQuality: "high" });
  assert.deepEqual([...shrunk._pixels.data], [3, 3, 3, 255]);
  const grown = await createImageBitmap(copied, { resizeWidth: 4, resizeQuality: "pixelated" });
  assert.deepEqual([grown.width, grown.height], [4, 4]);
  assert.deepEqual([...grown._pixels.data.slice(0, 8)], [1, 1, 1, 255, 1, 1, 1, 255]);

  copied.close();
  assert.equal(copied.width, 0);
  await assert.rejects(createImageBitmap(copied), { name: "InvalidStateError" });
  assert.throws(() => new ImageBitmap(), TypeError);
});

test("the host's events answer instanceof for their browser classes", () => {
  const field = document.createElement("textarea");
  document.body.appendChild(field);
  const seen = [];
  for (const type of ["keydown", "pointerdown", "mousedown", "input", "focus"]) {
    field.addEventListener(type, (event) => seen.push([
      type,
      event instanceof KeyboardEvent,
      event instanceof MouseEvent,
      event instanceof PointerEvent,
      event instanceof InputEvent,
      event instanceof FocusEvent,
      event instanceof UIEvent,
    ]));
  }
  mock.native.dispatch(7, field.nodeId, 0, 0, 0, 0, 0, "a", "KeyA");
  mock.native.dispatch(0, field.nodeId, 0, 0, 256 + 64, 0, 1);
  mock.native.dispatch(1, field.nodeId, 0, 0, 256 + 64, 0, 0);
  mock.input(field.nodeId, "a");
  mock.native.dispatch(9, field.nodeId, 0, 0, 0, 0, 0);
  assert.deepEqual(seen, [
    ["keydown", true, false, false, false, false, true],
    ["pointerdown", false, true, true, false, false, true],
    ["mousedown", false, true, false, false, false, true],
    ["input", false, false, false, true, false, true],
    ["focus", false, false, false, false, true, true],
  ]);
  assert.ok(new KeyboardEvent("keydown") instanceof KeyboardEvent, "made events still answer");
  assert.ok(!(new Event("keydown") instanceof KeyboardEvent));
  field.remove();
});

test("form elements answer instanceof, and tabIndex and disabled reflect their attributes", () => {
  const fieldset = document.createElement("fieldset");
  for (const [tag, name] of [["fieldset", "HTMLFieldSetElement"], ["meter", "HTMLMeterElement"], ["output", "HTMLOutputElement"], ["progress", "HTMLProgressElement"], ["h2", "HTMLHeadingElement"]]) {
    assert.ok(document.createElement(tag) instanceof globalThis[name], tag);
  }
  assert.ok(!(document.createElement("div") instanceof HTMLFieldSetElement));
  assert.equal(Node.ELEMENT_NODE, 1);
  assert.equal(Node.TEXT_NODE, 3);
  assert.equal(Element.ELEMENT_NODE, 1);
  assert.equal(document.createTextNode("x").nodeType, Node.TEXT_NODE);
  assert.equal(fieldset.TEXT_NODE, 3);
  assert.equal(DocumentFragment.DOCUMENT_FRAGMENT_NODE, 11);
  assert.equal(fieldset.disabled, false);
  fieldset.disabled = true;
  assert.equal(fieldset.getAttribute("disabled"), "");
  assert.equal(fieldset.disabled, true);
  const item = document.createElement("div");
  assert.equal(item.tabIndex, -1);
  assert.equal(document.createElement("button").tabIndex, 0);
  item.tabIndex = 0;
  assert.equal(item.getAttribute("tabindex"), "0");
  item.tabIndex = -1;
  assert.ok(item.hasAttribute("tabindex"));
  assert.equal(item.tabIndex, -1);
  const prop = document.createElement("div");
  prop.setAttribute("tabIndex", 0);
  assert.ok(prop.hasAttribute("tabindex"), "React's tabIndex prop is the tabindex attribute");
  prop.removeAttribute("tabIndex");
  assert.ok(!prop.hasAttribute("tabindex"));
});

test("WheelEvent defines DOM_DELTA constants and host wheel events carry deltaMode 0", () => {
  assert.equal(WheelEvent.DOM_DELTA_PIXEL, 0);
  assert.equal(WheelEvent.DOM_DELTA_LINE, 1);
  assert.equal(WheelEvent.DOM_DELTA_PAGE, 2);
  assert.equal(WheelEvent.prototype.DOM_DELTA_PIXEL, 0);
  assert.equal(WheelEvent.prototype.DOM_DELTA_LINE, 1);
  assert.equal(WheelEvent.prototype.DOM_DELTA_PAGE, 2);

  const box = document.createElement("div");
  document.body.appendChild(box);
  let received = null;
  box.addEventListener("wheel", (event) => {
    received = event;
  });
  mock.native.dispatch(6, box.nodeId, 12, 34, 0, -5, 18);
  assert.ok(received instanceof WheelEvent);
  assert.equal(received.deltaX, -5);
  assert.equal(received.deltaY, 18);
  assert.equal(received.deltaZ, 0);
  assert.equal(received.deltaMode, WheelEvent.DOM_DELTA_PIXEL);
  assert.notEqual(received.deltaMode, WheelEvent.DOM_DELTA_LINE);
  assert.notEqual(received.deltaMode, WheelEvent.DOM_DELTA_PAGE);
  box.remove();
});

test("style indexed access, dialog methods, and popover :popover-open / ToggleEvent work", async () => {
  const box = document.createElement("div");
  box.style.setProperty("color", "red");
  box.style.setProperty("margin-top", "4px");
  assert.equal(box.style.length, 2);
  assert.equal(box.style[0], "color");
  assert.equal(box.style[1], "margin-top");
  assert.equal(box.style[2], undefined);

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.style.setProperty("fill", "blue");
  assert.equal(path.style.length, 1);
  assert.equal(path.style[0], "fill");
  assert.equal(path.style.getPropertyPriority("fill"), "");

  const dialog = document.createElement("dialog");
  document.body.appendChild(dialog);
  let closedCount = 0;
  dialog.addEventListener("close", () => closedCount++);
  assert.equal(dialog.open, false);
  assert.equal(dialog.matches(":modal"), false);
  dialog.showModal();
  assert.equal(dialog.open, true);
  assert.equal(dialog.matches(":modal"), true);
  dialog.close("confirmed");
  assert.equal(dialog.open, false);
  assert.equal(dialog.matches(":modal"), false);
  assert.equal(dialog.returnValue, "confirmed");
  await Promise.resolve();
  assert.equal(closedCount, 1);

  const toggles = [];
  dialog.setAttribute("popover", "manual");
  dialog.addEventListener("toggle", (event) => toggles.push([event.oldState, event.newState]));
  assert.equal(dialog.matches(":popover-open"), false);
  dialog.showPopover();
  assert.equal(dialog.matches(":popover-open"), true);
  dialog.hidePopover();
  assert.equal(dialog.matches(":popover-open"), false);
  assert.deepEqual(toggles, [["closed", "open"], ["open", "closed"]]);
  dialog.remove();
});
