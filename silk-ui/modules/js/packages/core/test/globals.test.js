import { test } from "node:test";
import assert from "node:assert/strict";
import { installMock } from "./mock.js";

const mock = installMock();
await import("../src/globals.js");
const { flushSvg } = await import("../src/index.js");

test("the globals give browser libraries a document that builds live svg", () => {
  assert.equal(globalThis.window, globalThis);
  assert.equal(document.readyState, "complete");
  assert.equal(typeof navigator.userAgent, "string");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 10 10");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttributeNS(null, "d", "M0 0h10v10z");
  svg.appendChild(path);
  document.createElement("div").appendChild(svg);
  flushSvg();
  assert.equal(mock.take().filter((call) => call[0] === "defineIcon").length, 1);
  path.style.display = "none";
  flushSvg();
  const calls = mock.take().filter((call) => call[0].startsWith("svg"));
  assert.deepEqual(calls.at(-1), ["svgAttribute", svg.nodeId, 1, "style", "display: none;"]);
  assert.equal(document.createElement("canvas").getContext("2d").fillRect(0, 0, 1, 1), undefined, "a canvas probe does not throw");
});
