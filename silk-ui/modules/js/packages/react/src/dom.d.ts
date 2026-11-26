// `react-dom` and `react-dom/client` on this renderer (see dom.js).
import type { ReactNode } from "react";
import type { Node } from "@silkui/core";
import type { Root } from "./index.js";

export { createPortal, createRoot, flushSync } from "./index.js";
export const version: string;
export function hydrateRoot(container: Node | undefined, element: ReactNode, options?: unknown): Root;
export function unstable_batchedUpdates<A, R>(callback: (argument: A) => R, argument: A): R;
export function preconnect(href: string, options?: unknown): void;
export function prefetchDNS(href: string): void;
export function preinit(href: string, options?: unknown): void;
export function preinitModule(href: string, options?: unknown): void;
export function preload(href: string, options?: unknown): void;
export function preloadModule(href: string, options?: unknown): void;
export function requestFormReset(form: unknown): void;
export function useFormStatus(): { pending: boolean; data: null; method: null; action: null };
declare const dom: {
  createPortal: typeof import("./index.js").createPortal;
  createRoot: typeof import("./index.js").createRoot;
  flushSync: typeof import("./index.js").flushSync;
};
export default dom;
