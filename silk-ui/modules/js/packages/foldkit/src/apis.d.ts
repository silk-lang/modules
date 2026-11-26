/**
 * The web globals `@silkui/foldkit` provides in a realm that lacks them. Pass them as the
 * `allow` option of `@silkui/vite`'s `silk()`, so its missing API report lists only what is
 * really missing.
 */
export declare const provided: readonly string[];

/**
 * For `define` in a Vite config: each DOM name Foldkit reaches for, mapped to the object
 * `@silkui/foldkit` makes. A bundle that also runs on the web canvas needs it, since a
 * page's own `document` would win there.
 */
export declare const pageGlobals: Readonly<Record<string, string>>;
