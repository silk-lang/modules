// Development dependencies (including Effect's barrel exports) instantiate encoders
// before production tree shaking can remove them. Never substitute a no-op decoder.
import { TextEncoder, TextDecoder } from "./dev-encoding.js";
globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;

// The runner builds file URLs for import.meta: this covers `new URL("file://…").href`.
globalThis.URL ??= class URL {
  constructor(text) {
    this.href = encodeURI(String(text));
  }
  toString() {
    return this.href;
  }
};
