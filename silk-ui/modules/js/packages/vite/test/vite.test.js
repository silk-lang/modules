import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import silk from "../src/index.js";

const root = fileURLToPath(new URL("./fixture", import.meta.url));

async function bundle(mode, entry = "src/main.js", options = {}) {
  const outDir = mkdtempSync(join(tmpdir(), "silk-vite-"));
  await build({
    root,
    mode,
    configFile: false,
    logLevel: "silent",
    plugins: [silk({ entry, ...options })],
    build: { outDir },
  });
  return outDir;
}

test("builds one ES module and stamps it", async () => {
  const outDir = await bundle("production");
  const code = readFileSync(join(outDir, "app.js"), "utf8");
  assert.match(code, /mode production/);
  assert.doesNotMatch(code, /from\s*["']@silkui\/core["']/, "the library is bundled");
  assert.match(readFileSync(join(outDir, "app.js.stamp"), "utf8"), /^\d+\n$/);
});

test("bundles a worker into the app as a data: address", async () => {
  const outDir = await bundle("production", "src/worker.js", { node: true });
  const code = readFileSync(join(outDir, "app.js"), "utf8");
  const address = /"(data:text\/javascript,[^"]+)"/.exec(code)?.[1];
  assert.ok(address, "the worker's code is in the bundle");
  assert.match(decodeURIComponent(address), /postMessage/);
  assert.ok(!existsSync(join(outDir, "assets")), "no worker file beside the bundle");
});

test("development mode defines NODE_ENV for development builds", async () => {
  const outDir = await bundle("development");
  assert.ok(existsSync(join(outDir, "app.js.stamp")));
  assert.match(readFileSync(join(outDir, "app.js"), "utf8"), /mode development/);
});

test("takes a package's portable build, not its browser or Node one", async () => {
  // A ui-js realm has neither a DOM nor Node APIs: `browser` builds reach for `document`.
  const outDir = await bundle("production", "src/conditional.js");
  assert.match(readFileSync(join(outDir, "app.js"), "utf8"), /portable build/);
});

test("keeps Node builtins as imports for a host on the SilkJS runtime", async () => {
  const outDir = await bundle("production", "src/builtins.js", { node: true });
  const code = readFileSync(join(outDir, "app.js"), "utf8");
  assert.match(code, /from\s*["']node:fs["']/);
  assert.match(code, /from\s*["']node:path["']/);
  assert.doesNotMatch(code, /__vite-browser-external/);
});


test("compiles processed CSS chunks into app.sheet without DOM injection", async () => {
  const root = mkdtempSync(join(tmpdir(), "silk-css-build-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/main.js"), 'import "./app.css"; console.log("styled");');
    writeFileSync(join(root, "src/app.css"), '.test { width: 12px; color: red; }');
    await build({ root, configFile: false, logLevel: "silent", plugins: [silk({ entry: "src/main.js", strictStylesheets: true })] });
    const bytes = readFileSync(join(root, "dist/app.sheet"));
    assert.equal(bytes.subarray(0, 8).toString(), 'SILKCSS\0');
    assert.equal(existsSync(join(root, "dist/app.css")), false);
    const code = readFileSync(join(root, "dist/app.js"), 'utf8');
    assert.doesNotMatch(code, /document|createElement|width: 12px|color: red/);
    writeFileSync(join(root, "src/main.js"), 'console.log("without styles");');
    await build({ root, configFile: false, logLevel: "silent", plugins: [silk({ entry: "src/main.js" })], build: { emptyOutDir: false } });
    assert.equal(existsSync(join(root, "dist/app.sheet")), false, "removing the last CSS import removes stale compiled assets");
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("bundles local font files into the compiled production sheet", async () => {
  const root = mkdtempSync(join(tmpdir(), "silk-font-build-"));
  const font = readFileSync(new URL('../../../../assets/assets/fonts/GeistMono.subset.ttf', import.meta.url));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/main.js"), 'import "./app.css"; console.log("font app");');
    writeFileSync(join(root, "src/brand.ttf"), font);
    writeFileSync(join(root, "src/app.css"), '@font-face{font-family:Brand;src:url("./brand.ttf") format("truetype");font-display:swap}.title{font-family:Brand}');
    await build({ root, configFile: false, logLevel: "silent", plugins: [silk({ entry: "src/main.js", strictStylesheets: true })] });
    const bytes = readFileSync(join(root, "dist/app.sheet"));
    assert.ok(bytes.includes(Buffer.from(font.toString('base64'))), 'Vite library assets remain embedded after CSS compilation');
    assert.equal(existsSync(join(root, 'dist/app.css')), false);
    assert.doesNotMatch(readFileSync(join(root, 'dist/app.js'), 'utf8'), /@font-face|document/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});


test("embeds public and emitted fonts with relative bases and nested CSS assets", async () => {
  const root = mkdtempSync(join(tmpdir(), "silk-public-font-build-"));
  const font = readFileSync(new URL('../../../../assets/assets/fonts/GeistMono.subset.ttf', import.meta.url));
  const publicFont = readFileSync(new URL('../../../../assets/assets/fonts/NotoSans-Regular.subset.ttf', import.meta.url));
  try {
    mkdirSync(join(root, 'src'));
    mkdirSync(join(root, 'public/fonts'), { recursive: true });
    writeFileSync(join(root, 'src/main.js'), 'import "./app.css";');
    writeFileSync(join(root, 'src/brand.ttf'), font);
    writeFileSync(join(root, 'public/fonts/public.ttf'), publicFont);
    writeFileSync(join(root, 'src/app.css'), '@font-face{font-family:Emitted;src:url("./brand.ttf?no-inline")}@font-face{font-family:Public;src:url("/fonts/public.ttf")}');
    await build({ root, base: './', configFile: false, logLevel: 'silent', plugins: [silk({ entry: 'src/main.js', strictStylesheets: true })],
      build: { rolldownOptions: { output: { assetFileNames: 'assets/[name]-[hash][extname]' } } } });
    const bytes = readFileSync(join(root, 'dist/app.sheet'));
    assert.ok(bytes.includes(Buffer.from(font.toString('base64'))));
    assert.ok(bytes.includes(Buffer.from(publicFont.toString('base64'))), 'public font bytes are carried by the sheet');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
