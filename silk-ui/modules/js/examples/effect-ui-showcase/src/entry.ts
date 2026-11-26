import "@silkui/core/globals";
import "./app.css";
import { BrowserHost } from "@effect/ui/html";
import { Effect, Layer } from "effect";
import { App } from "./App.ts";
import { TelemetryLayer } from "./telemetry.ts";

const root = document.createElement("div");
root.id = "root";
document.body.appendChild(root);

Effect.runFork(
  Layer.launch(
    BrowserHost.mount(App, {}, root).pipe(Layer.provide(TelemetryLayer)),
  ),
);

requestAnimationFrame(() =>
  requestAnimationFrame(() => console.log("effect-ui showcase: first frame")),
);
