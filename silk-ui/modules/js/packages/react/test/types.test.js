import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);

test("the packages' types check an application that uses them", () => {
  const tsc = require.resolve("typescript/bin/tsc");
  const project = fileURLToPath(new URL("./types", import.meta.url));
  const result = spawnSync(process.execPath, [tsc, "-p", project], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
