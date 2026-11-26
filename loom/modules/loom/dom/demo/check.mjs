// Drives the built page (`build.sh`) in Chromium: only nearby rows are in the document, a
// distant scroll shows the right rows, a focused row stays while it scrolls away and when an
// item is added above it, and the scroll extent stays close to what the rows add up to.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)("playwright");

const dist = new URL("./dist/", import.meta.url).pathname;
const types = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
const server = createServer(async (request, response) => {
  const path = join(dist, request.url === "/" ? "index.html" : request.url.slice(1));
  try {
    const body = await readFile(path);
    response.writeHead(200, { "content-type": types[extname(path)] ?? "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(0);
const port = server.address().port;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
await page.goto(`http://localhost:${port}/`);

const state = () =>
  page.evaluate(() => {
    const list = document.querySelector('[role="list"]');
    const rows = [...list.children].filter((node) => node.getAttribute("role") === "listitem");
    const first = rows.find((row) => row.getBoundingClientRect().bottom > list.getBoundingClientRect().top);
    return {
      rows: rows.length,
      positions: rows.map((row) => Number(row.getAttribute("aria-posinset"))),
      firstVisible: first ? Number(first.getAttribute("aria-posinset")) : 0,
      setSize: Number(rows[0]?.getAttribute("aria-setsize")),
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      focused: document.activeElement?.closest('[role="listitem"]')?.getAttribute("aria-posinset") ?? null,
      focusedText: document.activeElement?.textContent ?? null,
      // The largest stretch of the viewport no mounted row covers.
      hole: (() => {
        const box = list.getBoundingClientRect();
        let y = box.top, hole = 0;
        for (const row of rows) {
          const r = row.getBoundingClientRect();
          if (r.bottom <= box.top || r.top >= box.bottom) continue;
          hole = Math.max(hole, r.top - y);
          y = Math.max(y, r.bottom);
        }
        return Math.max(hole, box.bottom - y);
      })(),
    };
  });
const settle = () => page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(done)))));
const scroll = (top) => page.evaluate((top) => { document.querySelector('[role="list"]').scrollTop = top; }, top);
const check = (ok, what, detail) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}${ok ? "" : `: ${JSON.stringify(detail)}`}`);
  if (!ok) process.exitCode = 1;
};

await page.waitForSelector('[role="listitem"]');
await settle();
let now = await state();
check(now.rows > 5 && now.rows < 40, "only rows near the viewport are in the document", now);
check(now.setSize === 100000 && now.positions[0] === 1, "rows carry their position and the list size", now);
check(now.scrollHeight > 100000 * 40, "the scroll extent covers every item", now);

await scroll(2_000_000);
await settle();
await settle();
now = await state();
const far = now.firstVisible;
check(now.rows < 40 && far > 20000, "a distant scroll mounts the rows there", now);
check(now.hole < 8, "and they cover the viewport", now);
await page.screenshot({ path: new URL("./dist/far.png", import.meta.url).pathname });
check(now.positions.every((value, i) => i === 0 || value > now.positions[i - 1]), "rows are in order", now);

// Scrolling up through rows measured for the first time: no jumps, no blank stretches.
let last = now.firstVisible, steady = true, covered = true;
for (let step = 0; step < 30; step++) {
  await page.evaluate(() => { document.querySelector('[role="list"]').scrollTop -= 150; });
  await settle();
  const at = await state();
  if (at.firstVisible > last || last - at.firstVisible > 6) steady = false;
  if (at.hole >= 8) covered = false;
  last = at.firstVisible;
}
check(steady, "scrolling up moves a few rows at a time", { from: far, to: last });
check(covered, "and never shows a blank stretch", null);

await page.locator('[role="listitem"] [role="button"]').nth(3).focus();
await settle();
const focused = (await state()).focused;
await scroll(500_000);
await settle();
await settle();
now = await state();
check(now.focused === focused && now.positions.includes(Number(focused)), "the focused row stays while it scrolls away", { focused, now });

// A click that does not take focus, as from a toolbar that keeps it where it is.
await page.evaluate(() => [...document.querySelectorAll('[role="button"]')].find((node) => node.textContent === "Add one at the top").dispatchEvent(new MouseEvent("click", { bubbles: true })));
await settle();
now = await state();
check(now.focused === String(Number(focused) + 1), "the focused row keeps focus when an item is added above it", { focused, now });
await scroll(0);
await settle();
await settle();
now = await state();
check(now.setSize === 100001 && now.firstVisible === 1, "back at the top after an insert", now);

// Arrow keys a few rows down: each step lands on the next row's button.
const before = await state();
await page.locator('[role="listitem"] [role="button"]').first().focus();
for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
await settle();
now = await state();
check(Number(now.focused) === 4, "Tab moves through rows in order", { before, now });

check(errors.length === 0, "no page errors", errors);
await browser.close();
server.close();
