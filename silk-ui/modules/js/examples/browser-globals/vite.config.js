import { defineConfig } from "vite";
import silk from "@silkui/vite";
import react from "@silkui/react/vite";

// `npm run build` writes dist/app.js, which the embedded engine tests run.
export default defineConfig({
  plugins: [silk({ entry: "src/main.jsx" }), react()],
});
