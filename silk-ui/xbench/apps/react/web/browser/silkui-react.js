// @silkui/react's entry points, on React DOM.
import { createRoot as domRoot } from "react-dom/client";
export { flushSync } from "react-dom";
export function createRoot() {
  return domRoot(document.getElementById("root"));
}
