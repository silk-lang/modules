import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The scenes on Silk UI: @silkui/vite compiles the CSS into a sheet and the bundle into app.js.
// SILK_PACKAGES is the packages directory of the Silk UI checkout under test
// (<silkui>/modules/js/packages); the plugins come from there too.
const packages = process.env.SILK_PACKAGES;
if (!packages) throw new Error("set SILK_PACKAGES to <silkui>/modules/js/packages");
// The packages are copied into node_modules/@silkui by build-silk.sh, so their imports
// (vite, react-reconciler) resolve to this app's.
const { default: silk } = await import("@silkui/vite");
const { default: react } = await import("@silkui/react/vite");
// `xb-scene.css` (src/main.tsx) is style/chat.css in the chat build, style/t3.css in the input build and bench.css, imported
// already, in every other one: their CSS stays what it was.
const sceneCss = fileURLToPath(new URL(`../../../style/${{ chat: "chat", input: "t3" }[(process.env.VITE_XB_SCENE ?? "feed").split("-")[0]] ?? "bench"}.css`, import.meta.url));

const pageJson = fileURLToPath(new URL(`../../../content/${(process.env.VITE_XB_SCENE ?? "feed").split("-")[0] === "input" ? "t3-page" : "no-page"}.json`, import.meta.url));

export default defineConfig({
  plugins: [silk({ entry: "src/main.tsx" }), react()],
  resolve: {
    alias: [
      { find: /^xb-scene\.css$/, replacement: sceneCss },
      // The input scene's page, in the input build only: other bundles stay as they were.
      { find: /^xb-page\.json$/, replacement: pageJson },
    ],
    dedupe: ["react", "react-reconciler", "scheduler"],
  },
  build: {
    outDir: fileURLToPath(new URL(`dist-silk/${process.env.VITE_XB_SCENE ?? "feed"}`, import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 8000,
  },
});
