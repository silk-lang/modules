import "../../../../style/bench.css";
// The chat scene's stylesheet, chat.css, in the chat build only (vite.config.js): bench.css again otherwise.
import "xb-scene.css";
import { createRoot } from "@silkui/react";
import { App } from "./App";

createRoot().render(<App />);
