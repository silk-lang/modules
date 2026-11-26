// Builds dist/bundle.js, the production bundle the benchmark runs: React, react-reconciler
// and the application, minified as a Silk UI production build is. The bundle is committed,
// so running the benchmark needs neither npm nor Node.
import { build } from "esbuild";

await build({
  entryPoints: ["src/main.jsx"],
  outfile: "dist/bundle.js",
  bundle: true,
  format: "iife",
  target: "es2022",
  minify: true,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  logLevel: "info",
});
