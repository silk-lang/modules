// xbench in Electron: loads the React DOM build of one scene (../react/web/dist-web/<scene>) in a
// 1040 x 720 window and passes the page's "XB ..." console lines to standard output, where the
// runner reads them (PROTOCOL.md).
//
//   XB_SCENE=feed        which build to load (feed, wall, stream, churn, feed-3000, ...)
//   XB_UNCAPPED=1        frames as fast as they can be made, no vsync, no background throttling
//   XB_WINDOWLESS=1      offscreen rendering, no window on screen (the cpu suite)
//   XB_SHOT=<file.png>   writes what the window shows at first paint (for parity checks)
const { app, BrowserWindow } = require("electron");
const { writeFileSync, writeSync } = require("node:fs");
const path = require("node:path");

const scene = process.env.XB_SCENE || "feed";
const uncapped = !!process.env.XB_UNCAPPED;
const windowless = !!process.env.XB_WINDOWLESS;

// Never throttled, whichever mode: a covered or offscreen window keeps its frames.
for (const name of ["disable-renderer-backgrounding", "disable-backgrounding-occluded-windows", "disable-background-timer-throttling"]) {
  app.commandLine.appendSwitch(name);
}
app.commandLine.appendSwitch("disable-features", "CalculateNativeWinOcclusion");
if (uncapped) {
  app.commandLine.appendSwitch("disable-frame-rate-limit");
  app.commandLine.appendSwitch("disable-gpu-vsync");
}

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1040,
    height: 720,
    useContentSize: true,
    resizable: false,
    title: "xbench",
    backgroundColor: "#0f1115",
    autoHideMenuBar: true,
    show: !windowless,
    ...(process.platform === "darwin" ? { titleBarStyle: "hidden", trafficLightPosition: { x: 14, y: 12 } } : {}),
    webPreferences: { contextIsolation: true, sandbox: true, offscreen: windowless, backgroundThrottling: false },
  });
  if (windowless) window.webContents.setFrameRate(uncapped ? 240 : 120);
  window.webContents.on("console-message", (event) => {
    const message = event.message ?? "";
    if (message.startsWith("XB ")) {
      writeSync(1, message + "\n");
      if (message === "XB first-paint" && process.env.XB_SHOT) {
        window.webContents.capturePage().then((image) => writeFileSync(process.env.XB_SHOT, image.toPNG()));
      }
      if (message === "XB done") setTimeout(() => app.exit(0), 50);
    } else {
      writeSync(2, message + "\n");
    }
  });
  window.loadFile(path.join(__dirname, "..", "react", "web", "dist-web", scene, "index.html"));
});
