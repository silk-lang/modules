import type { Plugin } from "vite";

export interface SilkOptions {
  /** Entry module, relative to the Vite root. Default `src/main.jsx`. */
  entry?: string;
  /** Name of the bundle in `build.outDir`. Default `app.js`. */
  fileName?: string;
  /** Host binary to start: given `--watch <bundle>` in watch mode, `--dev <port>` under the dev server. */
  host?: { command: string; args?: readonly string[]; cwd?: string };
  /** Port the dev server listens on for the host. Default: any free one. */
  port?: number;
  /** What to do when the build uses a web or Node API the runtime does not have. Default `warn`. */
  apis?: "warn" | "error" | "off";
  /** Such APIs the application provides itself. */
  allow?: readonly string[];
  /**
   * The host runs the full SilkJS runtime (ui-js-node): Node builtins stay `node:` imports,
   * and `apis` reports only what that runtime lacks.
   */
  node?: boolean;
  /** Fail the stylesheet build when the CSS compiler drops an unsupported feature. */
  strictStylesheets?: boolean;
  /**
   * Inject `@silkui/core/html.css` (the HTML user-agent default stylesheet) before the app's
   * own CSS, for DOM frameworks used directly with `@silkui/core/globals`. Default false.
   */
  html?: boolean;
}

export default function silk(options?: SilkOptions): Plugin[];
