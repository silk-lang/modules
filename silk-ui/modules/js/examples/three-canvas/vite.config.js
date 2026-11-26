import { defineConfig } from "vite";
import silk from "@silkui/vite";

// `npm run build` writes dist/app.js, which runs in a window:
//   silk run --manifest-path modules/js/demo/silk.toml -- modules/js/examples/three-canvas/dist/app.js
export default defineConfig({
  // three.js looks for requestAnimationFrame on `self`, which a browser has and a ui-js realm
  // does not: the realm's own global object stands in.
  define: { self: "globalThis" },
  // three.js names browser APIs on paths this page never takes (image loaders, the DOM).
  plugins: [silk({ entry: "src/main.js", apis: "off" })],
});
