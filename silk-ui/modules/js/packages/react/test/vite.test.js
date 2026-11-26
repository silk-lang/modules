import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import react from "../src/vite.js";

const sources = fileURLToPath(new URL("../src", import.meta.url));

// An app that points `@silkui/react` at another copy of its sources, as the README's local
// config does: `react-dom` has to come from that copy too, or two renderers load.
test("react-dom resolves beside an aliased @silkui/react", async () => {
  const dir = mkdtempSync(join(tmpdir(), "silk-react-dom-"));
  const copy = join(dir, "copy");
  cpSync(sources, copy, { recursive: true });
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/main.js"), 'import { createRoot } from "react-dom/client";\nimport { createRoot as own } from "@silkui/react";\nglobalThis.same = createRoot === own;\n');
  const loaded = [];
  await build({
    root: dir,
    configFile: false,
    logLevel: "silent",
    resolve: { alias: [{ find: /^@silkui\/react$/, replacement: join(copy, "index.js") }] },
    plugins: [react({ refresh: false }), { name: "record", load(id) { loaded.push(id); } }],
    build: {
      write: false,
      lib: { entry: join(dir, "src/main.js"), formats: ["es"], fileName: "app", cssFileName: "app" },
      rolldownOptions: { external: [/^@silkui\/core/, /^react($|\/)/, /^react-reconciler/, /^scheduler/] },
    },
  });
  const renderers = loaded.filter((id) => /[/\\]index\.js$/.test(id) && (id.startsWith(copy) || id.startsWith(sources)));
  assert.deepEqual(renderers, [join(copy, "index.js")]);
  assert.ok(loaded.includes(join(copy, "dom.js")));
});

// An installed `@silkui/react` is pre-bundled by the dev server: `react-dom` must name the
// pre-bundled dom, not a dom.js beside the bundle, which does not exist.
test("react-dom from an installed @silkui/react shares the dev server's pre-bundle", async () => {
  const dir = mkdtempSync(join(tmpdir(), "silk-react-deps-"));
  const installed = join(dir, "node_modules/@silkui/react");
  cpSync(sources, join(installed, "src"), { recursive: true });
  cpSync(fileURLToPath(new URL("../package.json", import.meta.url)), join(installed, "package.json"));
  mkdirSync(join(dir, "src"));
  writeFileSync(join(dir, "src/main.js"), 'import { createRoot } from "react-dom/client";\nimport { createRoot as own } from "@silkui/react";\nglobalThis.same = createRoot === own;\n');
  const server = await createServer({
    root: dir,
    configFile: false,
    logLevel: "silent",
    plugins: [react({ refresh: false })],
    optimizeDeps: {
      include: ["@silkui/react", "@silkui/react/dom"],
      noDiscovery: true,
      rolldownOptions: { external: [/^@silkui\/core/, /^react($|\/)/, /^react-reconciler/, /^scheduler/] },
    },
    server: { middlewareMode: true, ws: false },
  });
  try {
    const { code } = await server.transformRequest("/src/main.js");
    const dom = code.match(/import \{ createRoot \} from "([^"?]+)/)[1];
    assert.equal(dom, "/node_modules/.vite/deps/@silkui_react_dom.js");
    const bundle = await server.transformRequest(dom);
    const main = await server.transformRequest("/node_modules/.vite/deps/@silkui_react.js");
    const chunk = (text) => text.match(/from "(\/node_modules\/\.vite\/deps\/src-[^"?]+)/)[1];
    assert.equal(chunk(bundle.code), chunk(main.code), "one renderer copy");
  } finally {
    await server.close();
  }
});
