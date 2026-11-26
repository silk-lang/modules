// DOM Range against Chromium: test/ranges/cases.js runs the same trees, ranges and
// operations here and in Chromium (test/ranges/chromium.mjs writes the answers), after the
// WPT dom/ranges tests, and every answer must match.
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { installMock } from "./mock.js";

const mock = installMock();
// Weak targets go only in a full collection: without one, thousands of finished ranges
// would stay live and every mutation would walk them.
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc");
const core = await import("../src/index.js");
const { run } = await import("./ranges/cases.js");

test("ranges answer as Chromium does", async () => {
  const expected = JSON.parse(gunzipSync(readFileSync(new URL("./ranges/chromium.json.gz", import.meta.url))));
  const env = {
    element: () => core.createBox(),
    text: (data) => core.createText(data),
    fragment: () => core.createDocumentFragment(),
    range: () => core.createRange(),
    mount: (node) => core.mount(node),
    reset: () => mock.take(),
    pause: () => new Promise((resolve) => setImmediate(() => { collect(); resolve(); })),
  };
  const actual = await run(env);
  const differences = [];
  for (const key of Object.keys(expected)) {
    const want = expected[key];
    const got = actual[key];
    if (JSON.stringify(want) === JSON.stringify(got)) continue;
    if (want && typeof want === "object" && !Array.isArray(want)) {
      for (const field of Object.keys(want)) {
        if (JSON.stringify(want[field]) !== JSON.stringify(got?.[field])) {
          differences.push(key + " " + field + ": chromium " + JSON.stringify(want[field]) + " silk " + JSON.stringify(got?.[field]));
        }
      }
    } else {
      differences.push(key + ": chromium " + JSON.stringify(want).slice(0, 300) + " silk " + JSON.stringify(got).slice(0, 300));
    }
  }
  assert.equal(differences.length, 0, differences.length + " differences, first ones:\n" + differences.slice(0, 15).join("\n"));
});

test("StaticRange keeps what it is given", () => {
  const box = core.createBox(null, core.createText("abc"));
  const range = new core.StaticRange({ startContainer: box.firstChild, startOffset: 5, endContainer: box, endOffset: 0 });
  assert.deepEqual([range.startContainer, range.startOffset, range.endContainer, range.endOffset, range.collapsed], [box.firstChild, 5, box, 0, false]);
  assert.throws(() => new core.StaticRange({ startContainer: box, startOffset: 0, endContainer: box }), TypeError);
  assert.throws(() => new core.AbstractRange(), TypeError);
  assert.equal(new core.Range().START_TO_END, 1);
});
