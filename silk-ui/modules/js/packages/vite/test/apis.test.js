import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import silk from "../src/index.js";
import { ownerOf } from "../src/apis.js";

const root = fileURLToPath(new URL("./api-fixture", import.meta.url));

async function run(options) {
  const warnings = [];
  const logger = {
    info() {},
    warn: (message) => warnings.push(message),
    warnOnce: (message) => warnings.push(message),
    error: (message) => warnings.push(message),
    clearScreen() {},
    hasErrorLogged: () => false,
    hasWarned: false,
  };
  await build({
    root,
    configFile: false,
    customLogger: logger,
    plugins: [silk({ entry: "src/main.js", ...options })],
    build: { outDir: mkdtempSync(join(tmpdir(), "silk-apis-")) },
  });
  return warnings.join("\n");
}

test("the build reports the missing APIs and who uses them", async () => {
  const text = await run({});
  assert.match(text, /fetch \(network\): src\/library\.js/);
  assert.doesNotMatch(text, /AbortController/, "the realm's prelude has it");
  assert.match(text, /node:fs \(node\): src\/main\.js/);
  assert.doesNotMatch(text, /localStorage/, "a typeof test is not a use");
  assert.doesNotMatch(text, /Blob/, "a local of that name is not the global");
  assert.doesNotMatch(text, /process/, "process.env is replaced by the build");
});

test("allow silences a name, off silences the report, error fails the build", async () => {
  assert.doesNotMatch(await run({ allow: ["fetch"] }), /fetch \(network\)/);
  assert.doesNotMatch(await run({ apis: "off" }), /ui-js runtime/);
  await assert.rejects(run({ apis: "error" }), /fetch \(network\)/);
});

test("a module belongs to its package, or to the project by path", () => {
  assert.equal(ownerOf("/app/node_modules/@scope/pkg/dist/index.js", "/app"), "@scope/pkg");
  assert.equal(ownerOf("/app/node_modules/a/node_modules/b/index.js?v=1", "/app"), "b");
  assert.equal(ownerOf("/app/src/main.js", "/app"), "src/main.js");
});

// The dev server reports as it serves: an app that imports `@silkui/core/globals` hears
// nothing about the globals it defines, from its own modules or the pre-bundled globals.
test("the dev server leaves out what @silkui/core/globals provides", async () => {
  const dir = mkdtempSync(join(fileURLToPath(new URL(".", import.meta.url)), ".apis-dev-"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/main.js"), 'import "@silkui/core/globals";\nimport "./view.js";\ndocument.title = String(new URL("a:b"));\n');
  writeFileSync(join(dir, "src/view.js"), "export const seen = new MutationObserver(() => fetch(window.location.href));\n");
  const warnings = [];
  const server = await createServer({
    root: dir,
    configFile: false,
    cacheDir: join(dir, ".vite"),
    customLogger: { info() {}, warn: (message) => warnings.push(message), warnOnce: (message) => warnings.push(message), error() {}, clearScreen() {}, hasErrorLogged: () => false, hasWarned: false },
    server: { middlewareMode: true, ws: false },
    plugins: [silk({ entry: "src/main.js" })],
  });
  try {
    const silkEnv = server.environments.silk;
    await silkEnv.transformRequest("/src/main.js");
    await silkEnv.transformRequest("/src/view.js");
  } finally {
    await server.close();
    rmSync(dir, { recursive: true, force: true });
  }
  const text = warnings.join("\n");
  assert.match(text, /fetch \(network\)/);
  assert.doesNotMatch(text, /document|window|MutationObserver|URL/);
});
