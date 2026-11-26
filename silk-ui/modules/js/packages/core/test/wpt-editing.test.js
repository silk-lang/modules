import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { editingEnv } from "./wpt-editing/env.js";
import { runAll } from "./wpt-editing/run.js";

// The WPT editing conformance cases (wpt/editing/data) on the core DOM. Most pass; the known
// failures are where WPT expects what browsers do and the Editing spec says otherwise, and the
// gaps still open. A case that passed must keep passing; one that starts to pass is reported
// so the list can shrink (`node test/wpt-editing/cli.js --known`).
test("the WPT editing cases pass, but for the known failures", async () => {
  const known = JSON.parse(readFileSync(new URL("./wpt-editing/known-failures.json", import.meta.url), "utf8"));
  const results = await runAll(await editingEnv());
  const broke = [];
  const fixed = [];
  for (const [file, list] of Object.entries(results)) {
    const expected = new Set(known[file] ?? []);
    list.forEach((r, index) => {
      const failed = r.differences.length > 0;
      if (failed && !expected.has(index)) broke.push(file + " " + JSON.stringify(r.testCase[0]) + " " + JSON.stringify(r.testCase[1]) + "\n    " + r.differences.join("\n    "));
      if (!failed && expected.has(index)) fixed.push(file + " #" + index);
    });
  }
  if (fixed.length) console.log("WPT editing cases that pass now (update known-failures.json):", fixed.join(", "));
  assert.deepEqual(broke, []);
});
