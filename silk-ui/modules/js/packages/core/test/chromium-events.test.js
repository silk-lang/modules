// Real Chromium vs Silk UI event parity test.
// Runs the exact same standard DOM fixture (modules/js/tests/fixtures/chromium-events.js)
// and exact same keyboard & pointer inputs in BOTH:
//   1. Real headless Google Chrome via CDP (--headless=new), AND
//   2. Real native Silk UI (JsHost + @silkui/core + @silkui/core/globals + UiTree)
// and asserts that every emitted event, modal state, checkbox state, and click count match 1:1.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const silkUiRoot = resolve(here, "../../../../..");
const workspaceRoot = resolve(silkUiRoot, "..");
const fixturePath = resolve(silkUiRoot, "modules/js/tests/fixtures/chromium-events.js");

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) ?? null;
}

function findSilkCli() {
  const probe = spawnSync("silk", ["--version"], { encoding: "utf8" });
  return probe.status === 0 ? "silk" : null;
}

async function launchChrome(executable) {
  const proc = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-extensions",
      "--force-device-scale-factor=1",
      "--hide-scrollbars",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const wsUrl = await new Promise((resolveUrl, rejectUrl) => {
    let stderr = "";
    const timer = setTimeout(() => rejectUrl(new Error("Timed out waiting for Chrome DevTools URL:\n" + stderr)), 15000);
    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      const m = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) {
        clearTimeout(timer);
        resolveUrl(m[1]);
      }
    });
    proc.once("exit", (code) => {
      clearTimeout(timer);
      rejectUrl(new Error(`Chrome exited early (${code}):\n${stderr}`));
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, { once: true });
    ws.addEventListener("error", rej, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject: err } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) err(new Error(msg.error.message));
      else ok(msg.result);
    }
  });

  function send(method, params = {}, sessionId) {
    const id = nextId++;
    const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
    return new Promise((ok, err) => {
      pending.set(id, { resolve: ok, reject: err });
      ws.send(JSON.stringify(payload));
    });
  }

  return {
    send,
    async close() {
      try { ws.close(); } catch {}
      try { proc.kill("SIGTERM"); } catch {}
      await new Promise((r) => proc.once("exit", r));
    },
  };
}

async function runInChromium(executable) {
  const fixture = readFileSync(fixturePath, "utf8");
  const browser = await launchChrome(executable);
  try {
    const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    await browser.send("Emulation.setDeviceMetricsOverride", {
      width: 400,
      height: 300,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId);

    const evalJs = async (expression) => {
      const res = await browser.send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      }, sessionId);
      if (res.exceptionDetails) {
        throw new Error(res.exceptionDetails.text + " " + JSON.stringify(res.exceptionDetails.exception));
      }
      return res.result?.value;
    };

    await evalJs("document.open(); document.write('<!doctype html><html><head></head><body></body></html>'); document.close();");
    await evalJs(fixture);

    const pressKey = async (key, code, vk) => {
      const textFields =
        key === "Enter"
          ? { text: "\r", unmodifiedText: "\r" }
          : key.length === 1
            ? { text: key, unmodifiedText: key }
            : {};
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyDown",
        key,
        code,
        windowsVirtualKeyCode: vk,
        ...textFields,
      }, sessionId);
      await browser.send("Input.dispatchKeyEvent", {
        type: "keyUp",
        key,
        code,
        windowsVirtualKeyCode: vk,
      }, sessionId);
    };

    // 1. Enter on button
    await evalJs("document.getElementById('btn-enter').focus()");
    await pressKey("Enter", "Enter", 13);

    // 2. Space on button
    await evalJs("document.getElementById('btn-space').focus()");
    await pressKey(" ", "Space", 32);

    // 3. Space prevented on keydown
    await evalJs("document.getElementById('btn-prevent').focus()");
    await pressKey(" ", "Space", 32);

    // 4. Space on checkbox
    await evalJs("document.getElementById('chk').focus()");
    await pressKey(" ", "Space", 32);

    // 5. Enter on modal trigger -> opens modal once and stays open
    await evalJs("document.getElementById('open-modal').focus()");
    await pressKey("Enter", "Enter", 13);

    // 6. Enter on close button -> closes modal
    await pressKey("Enter", "Enter", 13);

    // 7. Space on modal trigger -> opens modal on keyup and stays open
    await pressKey(" ", "Space", 32);

    // 8. Pointer click on close button center
    const [cx, cy] = await evalJs("globalThis.__closeModalCenter()");
    await browser.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: cx, y: cy, button: "none", buttons: 0 }, sessionId);
    await browser.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cx, y: cy, button: "left", buttons: 1, clickCount: 1 }, sessionId);
    await browser.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cx, y: cy, button: "left", buttons: 0, clickCount: 1 }, sessionId);

    return await evalJs("globalThis.__parityState()");
  } finally {
    await browser.close();
  }
}

test("Silk UI native JsHost + UiTree emits the exact same keyboard, checkbox, and modal events as real Chromium", async (t) => {
  const chrome = findChrome();
  if (!chrome) {
    t.skip("Chrome/Chromium binary not installed");
    return;
  }
  const silk = findSilkCli();
  if (!silk) {
    t.skip("silk CLI not on PATH");
    return;
  }

  const chromeState = await runInChromium(chrome);

  const env = { ...process.env };
  if (!env.SILK_CLANG && existsSync("/opt/homebrew/opt/llvm@22/bin/clang")) {
    env.SILK_CLANG = "/opt/homebrew/opt/llvm@22/bin/clang";
  }
  if (existsSync("/opt/homebrew/opt/lld@22/bin") && !(env.PATH ?? "").includes("/opt/homebrew/opt/lld@22/bin")) {
    env.PATH = `/opt/homebrew/opt/lld@22/bin:${env.PATH ?? ""}`;
  }
  const silkRun = spawnSync(
    silk,
    ["test", "--package", "ui-js-tests", "--filter", "keyboardEventsMatchChromium", "--no-cache"],
    {
      cwd: silkUiRoot,
      env,
      encoding: "utf8",
    },
  );
  assert.equal(
    silkRun.status,
    0,
    `Silk UI test runner failed:\nSTDOUT:\n${silkRun.stdout}\nSTDERR:\n${silkRun.stderr}`,
  );
  const combined = `${silkRun.stdout}\n${silkRun.stderr}`;
  const match = combined.match(/PARITY_RESULT:(\{[^\n]+\})/);
  assert.ok(match, `Missing PARITY_RESULT from Silk UI output:\n${combined}`);
  const silkState = JSON.parse(match[1]);

  assert.deepEqual(silkState.events, chromeState.events, "Emitted DOM event sequence must match Chromium 1:1");
  assert.deepEqual(silkState, chromeState, "Final interactive state (clicks, modalOpen, checked, activeId) must match Chromium 1:1");
});
