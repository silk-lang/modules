// React's JSX runtime with `<box>` as a plain div: no hooks, no observers, nothing a DOM app
// would not have. src/ compiles against it unchanged.
import { Fragment, jsx as reactJsx, jsxs as reactJsxs } from "react/jsx-runtime";

const host = (type) => (type === "box" ? "div" : type);
export { Fragment };
export const jsx = (type, props, key) => reactJsx(host(type), props, key);
export const jsxs = (type, props, key) => reactJsxs(host(type), props, key);
export const jsxDEV = (type, props, key) => reactJsx(host(type), props, key);
