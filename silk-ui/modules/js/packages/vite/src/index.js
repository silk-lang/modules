// Vite plugin for ui-js applications.
//
// A ui-js host evaluates one ES module, so the plugin configures a library build with a
// single output file. After each successful build it writes `<bundle>.stamp`; a host
// started with --watch reloads the application when that file changes. With `host` set
// and `vite build --watch`, the plugin starts the host after the first build.
//
// Under `vite` (the dev server) the host runs the application's modules as Vite serves
// them, and an edit replaces only the modules it touches: see dev.js. The plugin knows no
// UI framework: `@silkui/react/vite` adds React's JSX, its reconciler fix and Fast Refresh.
import { spawn } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { missingApis, ownerOf, report } from "./apis.js";

// The modules of `@silkui/core/globals`, and the globals it defines.
const CORE_GLOBALS = /[\\/](?:(?:@silkui[\\/]core|packages[\\/]core)[\\/]src[\\/](?:globals|storage|location|indexeddb|worker|base|fetch|image-bitmap|url)|@silkui_core_globals)\.js$/;
// Workers up to this size (characters) go into the bundle as data: addresses.
const INLINE_WORKER_LIMIT = 256 * 1024;
const PROVIDED_BY_GLOBALS = ["document", "window", "navigator", "location", "history", "navigation", "EventSource", "SharedWorker", "createImageBitmap", "ImageBitmap", "MutationObserver", "matchMedia", "Image", "HTMLElement", "localStorage", "sessionStorage", "indexedDB", "URL", "URLSearchParams"];
import { devPlugins } from "./dev.js";
import { resolveOptions } from "./resolve.js";
import { compileStylesheet } from "./compiler.js";
import { stylesheetDevPlugin } from "./stylesheets.js";
import { reportDropped, standardize } from "./report.js";
import { fontAssetResolver } from "./font-assets.js";
import { NATIVES_DIR, jsModule, moduleOf, projectRoot, readDescription } from "./natives.js";

// The HTML elements' default user-agent stylesheet (`@silkui/core/html.css`), loaded before
// app CSS when `options.html` is true.
const HTML_SHEET = "virtual:silk-core-html-sheet";
const HTML_SHEET_ID = "\0" + HTML_SHEET;
const htmlSheetPlugin = {
  name: "silk:html-sheet",
  enforce: "pre",
  api: { silkPreload: [HTML_SHEET] },
  resolveId(id) {
    if (id === HTML_SHEET) return HTML_SHEET_ID;
  },
  load(id) {
    if (id === HTML_SHEET_ID) return 'import "@silkui/core/html.css";';
  },
  transform(code, id) {
    if (this.environment?.mode === "dev" || !this.getModuleInfo(id)?.isEntry) return;
    return { code: 'import "@silkui/core/html.css";\n' + code, map: null };
  },
};

/**
 * @param {object} [options]
 * @param {string} [options.entry] Entry module, relative to the Vite root. Default `src/main.jsx`.
 * @param {string} [options.fileName] Name of the bundle in `build.outDir`. Default `app.js`.
 * @param {{ command: string, args?: readonly string[], cwd?: string }} [options.host] Host binary to
 *   start. In watch mode it is given `--watch <bundle>` after `args`, under the dev
 *   server `--dev <port>`.
 * @param {number} [options.port] Port the dev server listens on for the host. Default: any
 *   free one.
 * @param {"warn" | "error" | "off"} [options.apis] What to do when the application or one
 *   of its libraries uses a web or Node API a ui-js runtime does not have. Default `warn`.
 * @param {string[]} [options.allow] Such APIs the application provides itself.
 * @param {boolean} [options.node] The host runs the full SilkJS runtime (ui-js-node): Node
 *   builtins stay `node:` imports instead of empty stubs, and the API report leaves out
 *   what that runtime has.
 * @param {boolean} [options.html] Inject `@silkui/core/html.css` (the HTML user-agent default
 *   stylesheet) before the application's own CSS, for DOM frameworks used directly with
 *   `@silkui/core/globals`. Default false.
 */
export default function silk(options = {}) {
  // silkui's tasks start Vite with the host they built in SILKUI_HOST.
  if (options.host === undefined && process.env.SILKUI_HOST) options = { ...options, host: { command: process.env.SILKUI_HOST } };
  const entry = options.entry ?? "src/main.jsx";
  const fileName = options.fileName ?? "app.js";
  const node = options.node === true;
  let bundle = "";
  let watching = false;
  let child = null;
  let stylesheetPath = "";
  let emittedStylesheet = false;
  let stylesheetConfig;

  function startHost() {
    const { command, args = [], cwd } = options.host;
    child = spawn(command, [...args, "--watch", bundle], { cwd, stdio: "inherit" });
    child.on("error", (error) => {
      console.error(`[silk] could not start ${command}: ${error.message}`);
    });
    // Closing the window ends the dev session.
    child.on("exit", (code) => process.exit(code ?? 0));
    process.on("exit", () => child.kill());
  }

  const buildPlugin = {
    name: "silk",
    apply: "build",

    config(_user, { mode }) {
      const config = {
        resolve: resolveOptions,
        // Libraries read it to pick their development or production build.
        define: { "process.env.NODE_ENV": JSON.stringify(mode === "development" ? "development" : "production") },
        build: {
          target: "es2022",
          minify: mode !== "development",
          cssCodeSplit: false,
          lib: { entry, formats: ["es"], fileName: () => fileName, cssFileName: "app" },
          rolldownOptions: { output: { codeSplitting: false } },
        },
      };
      return config;
    },

    configResolved(config) {
      bundle = resolve(config.root, config.build.outDir, fileName);
      watching = config.build.watch != null;
    },

    // Runs only after a build that wrote its files, so a failed build keeps the old app.
    writeBundle() {
      writeFileSync(`${bundle}.stamp`, `${Date.now()}\n`);
      if (watching && options.host && child === null) startHost();
    },
  };
  // `new Worker(new URL("./x.js", import.meta.url))`: Vite bundles the worker as a file of
  // its own, which a Silk UI app carrying its bundle in memory does not have beside it. A
  // small worker's code goes into the bundle as a `data:` address instead; a large one stays a
  // file, addressed from the bundle's own location, and must ship beside it.
  const workerPlugin = {
    name: "silk:workers",
    apply: "build",
    enforce: "post",
    generateBundle: {
      order: "post",
      handler(_options, output) {
        const app = output[fileName];
        if (!app || app.type !== "chunk") return;
        for (const item of Object.values(output)) {
          if (item === app || !/\.[cm]?js$/.test(item.fileName)) continue;
          const code = item.type === "chunk" ? item.code : typeof item.source === "string" ? item.source : new TextDecoder().decode(item.source);
          const quoted = new RegExp(`(["'\`])[^"'\`]*?${escapeRegExp(item.fileName)}\\1`, "g");
          if (!quoted.test(app.code)) continue;
          // A large worker stays a file beside the bundle, which the host reads only when it
          // starts the worker: inlined, every start of the app would read it too.
          if (code.length > INLINE_WORKER_LIMIT) {
            app.code = app.code.replace(quoted, () => JSON.stringify("./" + item.fileName));
            continue;
          }
          app.code = app.code.replace(quoted, () => JSON.stringify("data:text/javascript," + encodeURIComponent(code)));
          delete output[item.fileName];
        }
      },
    },
  };
  const apis = options.apis ?? "warn";
  const allow = new Set(options.allow ?? []);
  let root = "";
  let serving = false;
  /** name → { area, owners } */
  const uses = new Map();
  let browserGlobals = false;
  const apiPlugin = {
    name: "silk:apis",
    enforce: "post",

    configResolved(config) {
      root = config.root;
      serving = config.command === "serve";
    },

    buildStart() {
      uses.clear();
      browserGlobals = false;
    },

    // After the other transforms, so what is scanned is JavaScript.
    transform(code, id) {
      if (apis === "off" || id.startsWith("\0")) return;
      if (serving && this.environment.name !== "silk") return;
      if (!/\.[cm]?[jt]sx?$/.test(id.split("?")[0])) return;
      let ast;
      try {
        ast = this.parse(code);
      } catch {
        return;
      }
      // `@silkui/core/globals` provides the browser globals, and its own modules test for what
      // they use. The dev server reports as it serves, so an import of it counts at once.
      if (CORE_GLOBALS.test(id.split("?")[0])) {
        browserGlobals ||= /globals\.js$/.test(id.split("?")[0]);
        return;
      }
      browserGlobals ||= ast.body.some((item) => item.type === "ImportDeclaration" && item.source.value === "@silkui/core/globals");
      const owner = ownerOf(id, root);
      for (const { name, area } of missingApis(ast)) {
        if (allow.has(name) || (node && !NOT_IN_NODE.has(area))) continue;
        if (serving && browserGlobals && PROVIDED_BY_GLOBALS.includes(name)) continue;
        let use = uses.get(name);
        if (!use) uses.set(name, (use = { area, owners: new Set() }));
        if (use.owners.has(owner)) continue;
        use.owners.add(owner);
        // The dev server has no end to report at: say it when the module is first served.
        if (serving) this.warn(`${name} (${area}) is not in a ui-js runtime, and ${owner} uses it`);
      }
    },

    buildEnd(error) {
      if (browserGlobals) for (const name of PROVIDED_BY_GLOBALS) uses.delete(name);
      // Its Worker runs on the full runtime's worker threads.
      if (browserGlobals && node) uses.delete("Worker");
      if (error || serving || uses.size === 0) return;
      if (apis === "error") this.error(report(uses));
      this.warn(report(uses));
    },
  };

  const cssPlugin = {
    name: "silk:stylesheets",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      stylesheetPath = resolve(config.root, config.build.outDir, "app.sheet");
      stylesheetConfig = config;
    },
    generateBundle: {
      order: "post",
      handler(_options, output) {
        const sheets = Object.values(output).filter(item => item.type === "asset" && item.fileName.endsWith(".css"));
        emittedStylesheet = sheets.length !== 0;
        if (!sheets.length) return;
        const css = sheets.map(sheet => typeof sheet.source === "string" ? sheet.source : new TextDecoder().decode(sheet.source)).join("\n");
        let compiled;
        try { compiled = compileStylesheet(standardize(css), { strict: options.strictStylesheets === true, resolveUrl: fontAssetResolver(stylesheetConfig, sheets, output) }); }
        catch (error) {
          const dropped = error.diagnostics?.map(item => `${item.kind}: ${item.feature} (${item.count})`).join("\n");
          this.error(error.message + (dropped ? `\n${dropped}` : ""));
        }
        reportDropped(message => this.warn(message), compiled.diagnostics);
        for (const sheet of sheets) {
          delete output[sheet.fileName];
          delete output[sheet.fileName + ".map"];
        }
        this.emitFile({ type: "asset", fileName: "app.sheet", source: compiled.bytes });
      },
    },
    writeBundle() {
      if (!emittedStylesheet) rmSync(stylesheetPath, { force: true });
    },
  };
  const plugins = [buildPlugin, workerPlugin, silkImports, apiPlugin, cssPlugin, stylesheetDevPlugin({ strict: options.strictStylesheets === true })];
  if (options.html === true) plugins.unshift(htmlSheetPlugin);
  if (node) plugins.push(builtinsPlugin);
  return [...plugins, ...devPlugins({ entry, port: options.port ?? 0, host: options.host })];
}

// `import { add } from "../silk/math.silk"`: the module becomes calls into the host, which has
// the project's exported Silk functions compiled in. silkui describes them into .silk/natives/
// before it runs Vite (see natives.js).
const silkImports = {
  name: "silk:imports",
  enforce: "pre",
  load(id) {
    const file = id.split("?")[0];
    if (!file.endsWith(".silk") || id.startsWith("\0")) return;
    const root = projectRoot(dirname(file));
    if (!root) this.error(`${file} is not in a Silk package: there is no silk.toml above it`);
    const description = readDescription(root);
    if (!description) this.error(`the Silk functions of ${root} are not described yet: build or run the app with \`silk task\`, which writes ${NATIVES_DIR}/`);
    const module = moduleOf(description, file);
    if (!module) this.error(`${relative(root, file)} is not exported to JavaScript: add its module to \`exports\` in silk.toml`);
    this.addWatchFile(join(root, NATIVES_DIR, "natives.json"));
    return { code: jsModule(module), map: null };
  },
  // The dev server rebuilds the host and starts it again (see dev.js): nothing to replace in place.
  hotUpdate({ file }) {
    if (file.endsWith(".silk") || file.includes(`${NATIVES_DIR}/`)) return [];
  },
};

/** The areas of `MISSING` the SilkJS runtime does not have either. */
const NOT_IN_NODE = new Set(["dom", "storage", "workers"]);

const BUILTINS = new Set(builtinModules);

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `node:<name>` when `id` names a Node builtin, with or without the prefix. */
function builtinOf(id) {
  if (id.startsWith("node:")) return id;
  return BUILTINS.has(id) ? `node:${id}` : null;
}

// Before Vite's resolver, which turns builtins into empty browser stubs: the runtime has them.
const builtinsPlugin = {
  name: "silk:node-builtins",
  enforce: "pre",
  resolveId(id) {
    const builtin = builtinOf(id);
    if (builtin) return { id: builtin, external: true };
  },
};
