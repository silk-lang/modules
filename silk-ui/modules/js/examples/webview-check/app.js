// A window check for web views: opens a page over a box, drives it the way t3code's browser
// panel and its agent do, prints "webview check: passed" and quits with 0, or 1 on a failure.
import { createBox, createText, createWebView, clearWebViewData, mount, quit } from "@silkui/core";

const icon = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
const page = `<!doctype html><title>Guest book</title><link rel="icon" href="${icon}">
<h1>Guest book</h1>
<input id="name" aria-label="Name">
<button onclick="document.title = 'Signed ' + document.getElementById('name').value">Sign</button>
<p>apple banana apple cherry apple</p>`;

const host = createBox({ flexGrow: 1, backgroundColor: "white" });
mount(
  createBox(
    { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, display: "flex", flexDirection: "column" },
    createBox({ height: 56, paddingLeft: 80, justifyContent: "center" }, createText("webview check")),
    host,
  ),
);

function step(name) {
  console.log(`webview check: ${name}`);
}

function until(view, type, test = () => true) {
  return new Promise((resolve) => {
    const listener = (event) => {
      if (!test(event)) return;
      view.removeEventListener(type, listener);
      resolve(event);
    };
    view.addEventListener(type, listener);
  });
}

function expect(ok, what) {
  if (!ok) throw new Error(what);
}

async function run() {
  const view = createWebView(host);
  expect(await view.opened, "the view did not open");
  step("opened");
  const titled = until(view, "titlechange", () => view.title === "Guest book");
  view.loadHtml(page, "https://example.test/");
  await titled;
  step("loaded");

  expect((await view.evaluate("1 + 2")) === 3, "evaluate");
  const snapshot = await view.snapshot();
  const ref = /textbox[^\n]*\[ref=(e\d+)\]/.exec(snapshot)?.[1];
  expect(ref !== undefined, `no textbox in the snapshot:\n${snapshot}`);
  step("snapshot");

  await view.fillElement(ref, "Julia");
  const button = /button[^\n]*\[ref=(e\d+)\]/.exec(await view.snapshot())?.[1];
  const signed = until(view, "titlechange", () => view.title === "Signed Julia");
  await view.clickElement(button);
  await signed;
  step("fill and click");

  const found = await view.findInPage("apple", { newSession: true });
  expect(found.matches === 3, `find counted ${found.matches}`);
  view.stopFindInPage();
  step("find");

  view.setZoom(1.5);
  view.setColorScheme("dark");
  view.setAudioMuted(true);
  const shot = await view.screenshot();
  expect(shot.width > 0 && shot.height > 0, "empty screenshot");
  step("screenshot");

  if (view.favicon !== icon) await until(view, "faviconchange", () => view.favicon === icon);
  step("favicon");

  const failed = until(view, "loadend", (event) => !event.ok);
  view.navigate("https://silk-webview-check.invalid/");
  const failure = await failed;
  expect(failure.errorCode < 0, `a failed load has net error ${failure.errorCode}`);
  step(`failed load (${failure.errorCode}: ${failure.error})`);

  await clearWebViewData({});
  step("cleared data");
  view.close();
}

setTimeout(() => {
  console.error("webview check: timed out");
  quit(1);
}, 60000);

run().then(
  () => {
    console.log("webview check: passed");
    quit(0);
  },
  (error) => {
    console.error(`webview check: failed: ${error?.message ?? error}`);
    quit(1);
  },
);
