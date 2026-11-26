import { defineConfig } from "vite";
import silk from "@silkui/vite";

// `npm run build` writes dist/app.js, which the embedded engine tests run.
export default defineConfig({
  plugins: [silk({ entry: "src/main.js" })],
});
