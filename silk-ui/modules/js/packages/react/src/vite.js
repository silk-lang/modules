// The React side of a ui-js Vite build, beside `@silkui/vite`: JSX through this package,
// the reconciler speed fix, and React Fast Refresh under the dev server.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { transformWithOxc } from "vite";
import { reconcilerPlugin } from "./reconciler.js";

const require = createRequire(import.meta.url);
const IMPORT_SOURCE = "@silkui/react";
const REFRESH = "virtual:silk-refresh";
const REFRESH_ID = "\0" + REFRESH;
// The HTML elements' default stylesheet (html.css), first of the app's stylesheets.
const HTML_CSS = fileURLToPath(new URL("./html.css", import.meta.url));
const HTML_SHEET = "virtual:silk-html-sheet";
const HTML_SHEET_ID = "\0" + HTML_SHEET;
const DOM = fileURLToPath(new URL("./dom.js", import.meta.url));

/** react-refresh's runtime as an ES module that hooks itself up when it loads. */
function refreshModule() {
  // The package exports only `runtime`, which picks this file when NODE_ENV says so.
  const file = join(dirname(require.resolve("react-refresh/runtime")), "cjs/react-refresh-runtime.development.js");
  const source = readFileSync(file, "utf8")
    .replaceAll("process.env.NODE_ENV", JSON.stringify("development"));
  return `const exports = {};
${source}
exports.injectIntoGlobalHook(globalThis);
globalThis.$RefreshReg$ = () => {};
globalThis.$RefreshSig$ = () => (type) => type;

let scheduled = false;
/** Asks React to re-render with the components registered since the last time. */
export function enqueue() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(() => {
    scheduled = false;
    exports.performReactRefresh();
  }, 16);
}

/** Whether a module with these exports can be replaced alone: all of them are components. */
export function isBoundary(module) {
  let any = false;
  for (const key in module) {
    if (key === "__esModule") continue;
    any = true;
    if (!exports.isLikelyComponentType(module[key])) return false;
  }
  return any;
}

export const register = exports.register;
export const createSignatureFunctionForTransform = exports.createSignatureFunctionForTransform;
`;
}

const refreshPlugin = {
  name: "silk:react-refresh",
  apply: "serve",
  enforce: "pre",
  // @silkui/vite runs these modules before the entry, so React finds the hook when it loads.
  api: { silkPreload: [REFRESH] },

  resolveId(id) {
    if (id === REFRESH) return REFRESH_ID;
  },

  load(id) {
    if (id === REFRESH_ID) return refreshModule();
  },

  // JSX with the Fast Refresh registrations, which Vite leaves out for environments
  // that are not browsers. A module whose exports are all components accepts its own
  // updates; any other one passes the update on to its importers.
  async transform(code, id) {
    if (this.environment.name !== "silk") return;
    const [file] = id.split("?");
    if (!/\.[jt]sx$/.test(file) || file.includes("/node_modules/")) return;
    const result = await transformWithOxc(code, file, {
      jsx: { runtime: "automatic", importSource: IMPORT_SOURCE, development: false, refresh: true },
    });
    if (!result.code.includes("$RefreshReg$(")) return { code: result.code, map: result.map };
    const name = JSON.stringify(file);
    return {
      code: `import * as __silkRefresh from ${JSON.stringify(REFRESH)};
const __silkReg = globalThis.$RefreshReg$, __silkSig = globalThis.$RefreshSig$;
globalThis.$RefreshReg$ = (type, id) => __silkRefresh.register(type, ${name} + " " + id);
globalThis.$RefreshSig$ = __silkRefresh.createSignatureFunctionForTransform;
${result.code}
globalThis.$RefreshReg$ = __silkReg;
globalThis.$RefreshSig$ = __silkSig;
if (import.meta.hot) {
  import.meta.hot.accept((next) => {
    // No module when the update failed to load, such as after a syntax error: Vite has
    // printed the error, and the running app is left alone until the next edit.
    if (!next) return;
    if (__silkRefresh.isBoundary(next)) __silkRefresh.enqueue();
    else import.meta.hot.invalidate();
  });
}
`,
      map: null,
    };
  },
};

// Under the dev server the sheet loads before the entry, so it is installed first; a build
// imports it at the top of the entry, which puts its CSS before the app's.
const htmlSheetPlugin = {
  name: "silk:html-sheet",
  enforce: "pre",
  api: { silkPreload: [HTML_SHEET] },
  resolveId(id) {
    if (id === HTML_SHEET) return HTML_SHEET_ID;
  },
  load(id) {
    if (id === HTML_SHEET_ID) return `import ${JSON.stringify(HTML_CSS)};`;
  },
  transform(code, id) {
    if (this.environment?.mode === "dev" || !this.getModuleInfo(id)?.isEntry) return;
    return { code: `import ${JSON.stringify(HTML_CSS)};\n${code}`, map: null };
  },
};

// `react-dom` is `@silkui/react/dom`, so the dev server pre-bundles it with the renderer. An
// app that points `@silkui/react` at other sources (an alias) gets the dom.js beside them,
// so it loads one copy of the renderer, not two.
const domPlugin = {
  name: "silk:react-dom",
  enforce: "pre",
  async resolveId(id, importer, options) {
    if (id !== "react-dom" && id !== "react-dom/client") return;
    options = { ...options, skipSelf: true };
    const main = await this.resolve(IMPORT_SOURCE, importer, options);
    if (!main || main.external) return DOM;
    const path = main.id.split("?")[0];
    if (/[/\\]node_modules[/\\]/.test(path)) return this.resolve(IMPORT_SOURCE + "/dom", importer, options);
    return join(dirname(path), "dom.js");
  },
};

/**
 * @param {object} [options]
 * @param {boolean} [options.refresh] React Fast Refresh under the dev server. Default true.
 * @param {boolean} [options.html] HTML elements' default stylesheet, and `react-dom` pointed at
 *   this renderer, for apps written for React DOM. Default true.
 */
export default function react(options = {}) {
  const config = {
    name: "silk:react",
    config: () => ({
      oxc: { jsx: { runtime: "automatic", importSource: IMPORT_SOURCE } },
    }),
    // The dev server pre-bundles dependencies before the plugins see them: patch React's
    // reconciler there too.
    configEnvironment(name) {
      if (name === "silk") return { optimizeDeps: { rolldownOptions: { plugins: [reconcilerPlugin()] } } };
    },
  };
  const plugins = [config, reconcilerPlugin()];
  if (options.html !== false) plugins.push(domPlugin, htmlSheetPlugin);
  if (options.refresh ?? true) plugins.push(refreshPlugin);
  return plugins;
}
