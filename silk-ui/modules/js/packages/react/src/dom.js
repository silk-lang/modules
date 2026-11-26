// `react-dom` and `react-dom/client` for apps and libraries written for React DOM: the
// `@silkui/react/vite` plugin points both at this module. Roots, portals and flushSync are
// this renderer's; the rest of React DOM's API is what a host without a browser DOM can do.
import { createPortal, createRoot, flushSync } from "./index.js";

export { createPortal, createRoot, flushSync };

export const version = "19.3.0-silkui";

/** React 18's batching call: updates batch on their own, so it only runs `callback`. */
export function unstable_batchedUpdates(callback, argument) {
  return callback(argument);
}

/** No server markup to hydrate here: the root renders `element` from scratch. */
export function hydrateRoot(container, element, options) {
  const root = createRoot(container, options);
  root.render(element);
  return root;
}

// Resource hints a document would act on. The host loads what the app asks for when it asks.
export function preconnect() {}
export function prefetchDNS() {}
export function preinit() {}
export function preinitModule() {}
export function preload() {}
export function preloadModule() {}

export function requestFormReset() {}

const IDLE_FORM = Object.freeze({ pending: false, data: null, method: null, action: null });
/** No form actions run through the host, so a form is never pending. */
export function useFormStatus() {
  return IDLE_FORM;
}

export default {
  createPortal,
  createRoot,
  flushSync,
  hydrateRoot,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preload,
  preloadModule,
  requestFormReset,
  unstable_batchedUpdates,
  useFormStatus,
  version,
};
