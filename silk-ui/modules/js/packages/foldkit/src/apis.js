// The web globals `@silkui/foldkit` provides in a realm that lacks them, for the `allow`
// option of `@silkui/vite`: its report then lists only what is really missing.
export const provided = [
  "document", "window", "self", "navigator", "location", "history", "sessionStorage", "matchMedia", "getComputedStyle",
  "addEventListener", "removeEventListener", "dispatchEvent", "Node", "Element", "HTMLElement", "HTMLInputElement",
  "HTMLTextAreaElement", "Text", "Comment", "Event", "CustomEvent", "MutationObserver", "CSSStyleDeclaration",
];

// For `define` in a Vite config: the DOM names Foldkit reaches for, as the objects
// `@silkui/foldkit` makes. In a window they are the globals already; in a page the browser's
// own would win, so a bundle that runs on web-canvas too needs them renamed.
export const pageGlobals = Object.fromEntries(
  ["document", "Node", "Element", "HTMLElement", "SVGElement", "HTMLInputElement", "HTMLTextAreaElement", "Text", "Comment",
    "MutationObserver", "getComputedStyle",
    "HTMLCanvasElement", "HTMLSelectElement", "HTMLDialogElement", "HTMLOutputElement", "DocumentFragment"]
    .map((name) => [name, `globalThis.__silkuiDom.${name}`]),
);
