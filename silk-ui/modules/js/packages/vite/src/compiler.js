import { readFileSync } from 'node:fs';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const kinds = ['at-rule', 'selector', 'property', 'value', 'feature', 'animation'];
let compiler;

export function compileStylesheet(css, { strict = false, resolveUrl } = {}) {
  if (resolveUrl !== undefined && typeof resolveUrl !== 'function') throw new TypeError('resolveUrl must be a function');
  compiler ??= createCompiler();
  return compiler(css, strict, resolveUrl);
}

function createCompiler() {
  let input, result, diagnostics, instance, resolver, replacement, resolutionError;
  let busy = false;
  const module = new WebAssembly.Module(readFileSync(new URL('./compiler.wasm', import.meta.url)));
  instance = new WebAssembly.Instance(module, {
    stylesheet: {
      input_length: () => input.length,
      input_read: (pointer, length) => new Uint8Array(instance.exports.memory.buffer, pointer, length).set(input),
      font_url_length: (pointer, length) => {
        if (!resolver || resolutionError) return 0;
        const original = decoder.decode(new Uint8Array(instance.exports.memory.buffer, pointer, length));
        try {
          const resolved = resolver(original);
          if (typeof resolved !== 'string') throw new TypeError('resolveUrl must return a string');
          if (resolved === original) return 0;
          replacement = encoder.encode(resolved);
          return replacement.length + 1;
        } catch (error) { resolutionError = { error }; return 0; }
      },
      font_url_read: (pointer, length) => new Uint8Array(instance.exports.memory.buffer, pointer, length).set(replacement),
      output: (pointer, length) => { result = new Uint8Array(instance.exports.memory.buffer, pointer, length).slice(); },
      diagnostic: (kind, pointer, length, count) => {
        diagnostics.push({ kind: kinds[kind], feature: decoder.decode(new Uint8Array(instance.exports.memory.buffer, pointer, length)), count });
      },
    },
  });
  return (css, strict, resolveUrl) => {
    if (busy) throw new Error('Stylesheet compilation cannot run inside resolveUrl');
    input = encoder.encode(css);
    if (input.length > 64 * 1024 * 1024) throw new RangeError('Stylesheet exceeds the 64 MiB compiler input limit');
    result = null;
    diagnostics = [];
    resolver = resolveUrl;
    resolutionError = null;
    busy = true;
    try {
      const status = instance.exports.compile_stylesheet(strict ? 1 : 0);
      if (resolutionError) throw resolutionError.error;
      if (status !== 0 || !result) {
        const error = new Error(status === 1 ? 'Stylesheet contains unsupported CSS in strict mode' : 'Stylesheet compilation failed');
        error.diagnostics = diagnostics;
        throw error;
      }
      return { bytes: result, diagnostics };
    } finally {
      busy = false;
      input = resolver = replacement = resolutionError = null;
    }
  };
}
