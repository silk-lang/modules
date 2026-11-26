import assert from "node:assert/strict";
import test from "node:test";
import { frames } from "../src/dev.js";

test("long messages are split at character boundaries", () => {
  const text = "é".repeat(200 * 1024);
  const lines = frames("m", text);
  assert.equal(lines.length, 2);
  assert.ok(lines[0].startsWith("m+") && lines[1].startsWith("m."));
  assert.equal(lines.map((line) => line.slice(2, -1)).join(""), text);
});
