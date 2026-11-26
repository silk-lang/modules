import type { Plugin } from "vite";

export interface ReactOptions {
  /** React Fast Refresh under the dev server. Default true. */
  refresh?: boolean;
}

/** The React side of a ui-js build, used beside `@silkui/vite`'s `silk()`. */
export default function react(options?: ReactOptions): Plugin[];
