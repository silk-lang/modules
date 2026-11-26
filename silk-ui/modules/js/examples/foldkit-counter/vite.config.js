import { defineConfig } from "vite";
import silk from "@silkui/vite";
import { provided, pageGlobals } from "@silkui/foldkit/apis";

// `npm run build` writes dist/app.js, which runs in a window and on web-canvas alike. `npm run
// watch` rebuilds the bundle on every change and reloads the application in the host that
// SILK_UI_HOST names.
const host = process.env.SILK_UI_HOST;

export default defineConfig({
  // In a page, the browser's own document would win over the one @silkui/foldkit makes.
  define: pageGlobals,
  plugins: [
    silk({
      entry: "src/entry.ts",
      // The document and the DOM classes are there at run time.
      allow: provided,
      host: host ? { command: host, cwd: new URL("../../../..", import.meta.url).pathname } : undefined,
    }),
  ],
});
