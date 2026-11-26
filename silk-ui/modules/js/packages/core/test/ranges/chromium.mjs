// Writes chromium.json.gz: what Chromium answers for cases.js. Needs Playwright's Chromium:
// NODE_PATH=$(npm root -g) node chromium.mjs
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const { chromium } = createRequire(import.meta.url)("playwright");
const source = readFileSync(new URL("./cases.js", import.meta.url), "utf8").replace(/^export /gm, "");
const browser = await chromium.launch();
const page = await browser.newPage();
const results = await page.evaluate(async (code) => {
  const run = new Function(code + "\nreturn run;")();
  const env = {
    element: () => document.createElement("div"),
    text: (data) => document.createTextNode(data),
    fragment: () => document.createDocumentFragment(),
    range: () => document.createRange(),
    mount: (node) => document.body.appendChild(node),
    reset: () => document.body.replaceChildren(),
    pause: () => Promise.resolve(),
  };
  return await run(env);
}, source);
await browser.close();
writeFileSync(new URL("./chromium.json.gz", import.meta.url), gzipSync(JSON.stringify(results)));
console.log(Object.keys(results).length, "entries");
