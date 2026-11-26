import { defineConfig } from "vite";
import silk from "@silkui/vite";

// `npm run build` writes dist/app.js, which runs in a window and on web-canvas alike.
export default defineConfig({
  plugins: [silk({ entry: "src/main.js" })],
});
