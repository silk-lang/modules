import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { createServer } from "vite";
import silk from "../src/index.js";
import { fakeHost } from "./host.js";

test("Effect's dev barrel initializes in a realm without browser encoding globals", async () => {
  const root = mkdtempSync(fileURLToPath(new URL(".effect-", import.meta.url)));
  mkdirSync(join(root, "src"));
  writeFileSync(join(root, "src/main.js"), `import { Schema } from 'effect';
__ui.setText(1, Schema.decodeUnknownSync(Schema.String)('loaded'), 0);
__ui.setText(2, new TextDecoder().decode(new TextEncoder().encode('é😀')), 0);`);
  const server = await createServer({
    root, configFile: false, logLevel: "silent", cacheDir: join(root, ".vite"),
    server: { middlewareMode: true, ws: false },
    environments: { silk: { optimizeDeps: { noDiscovery: true, include: ["effect"] } } },
    plugins: [silk({ entry: "src/main.js" })],
  });
  let host;
  try {
    host = fakeHost(server.config.plugins.find(plugin => plugin.name === "silk:dev").api.listener().address().port);
    for (let index = 0; index < 600 && !host.texts().includes("é😀"); index++) await new Promise(resolve => setTimeout(resolve, 50));
    assert.deepEqual(host.texts(), ["loaded", "é😀"], host.logs.join("\n"));
  } finally {
    host?.close();
    await server.close();
    rmSync(root, { recursive: true, force: true });
  }
});
