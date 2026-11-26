import { defineConfig } from "vite";
import tailwind from "@tailwindcss/vite";
import silk from "@silkui/vite";

const host = process.env.SILK_UI_HOST;

export default defineConfig({
  plugins: [
    tailwind(),
    silk({
      entry: "src/entry.ts",
      html: true,
      host: host ? { command: host, cwd: new URL("../../../..", import.meta.url).pathname } : undefined,
    }),
  ],
});
