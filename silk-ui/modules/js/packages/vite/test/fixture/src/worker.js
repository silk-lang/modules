const worker = new Worker(new URL("./echo.worker.js", import.meta.url), { type: "module" });
worker.postMessage(21);
