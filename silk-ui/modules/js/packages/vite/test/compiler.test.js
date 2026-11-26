import assert from 'node:assert/strict';
import test from 'node:test';
import { compileStylesheet } from '../src/compiler.js';
import { reportDropped } from '../src/report.js';

test('compiles layers, variables, conditions, and modern colors using the shipped wasm', () => {
  const source = '@layer theme, utilities; @layer theme { :root { --gap: 4px } } @layer utilities { .card:hover { padding: calc(var(--gap) * 2); color: color-mix(in oklch, red 30%, blue) } } @media (min-width: 10px) { .card { display: flex } }';
  const { bytes, diagnostics } = compileStylesheet(source, { strict: true });
  assert.equal(new TextDecoder().decode(bytes.slice(0, 8)), 'SILKCSS\0');
  assert.equal(new DataView(bytes.buffer).getUint32(8, true), 9);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(compileStylesheet(source).bytes, bytes);
  assert.equal(new TextDecoder().decode(bytes).includes(source), false);
});

test('reports aggregated dropped features and strict mode rejects them', () => {
  const css = '.a { made-up-property: 1 } .b { made-up-property: 2 }';
  const result = compileStylesheet(css);
  assert.deepEqual(result.diagnostics, [{ kind: 'property', feature: 'made-up-property', count: 2 }]);
  assert.throws(() => compileStylesheet(css, { strict: true }), error => error.diagnostics[0].count === 2);
  assert.deepEqual(compileStylesheet('.valid { width: 3px }', { strict: true }).diagnostics, []);
});

test('results keep their bytes after subsequent compilations and memory growth', () => {
  const first = compileStylesheet('.a { color: red }').bytes;
  const saved = first.slice();
  const css = Array.from({ length: 500 }, (_, i) => `.rule-${i} { width: ${i}px; }`).join('\n');
  assert.ok(compileStylesheet(css).bytes.length > first.length);
  assert.deepEqual(first, saved);
});


test('ships generated pseudo programs and diagnoses unsupported content', () => {
  const source = `.card { &::before { content: ""; } &::after { content: attr(data-label, "fallback"); color: red; } }`;
  const { bytes, diagnostics } = compileStylesheet(source, { strict: true });
  assert.equal(new DataView(bytes.buffer).getUint32(8, true), 9);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(compileStylesheet(source).bytes, bytes);
  assert.deepEqual(compileStylesheet('.card::before { content: counter(item); }', { strict: true }).diagnostics, []);
  const unsupported = '.card::before { content: url(icon.png); }';
  assert.deepEqual(compileStylesheet(unsupported).diagnostics, [{ kind: 'feature', feature: 'content', count: 1 }]);
  assert.throws(() => compileStylesheet(unsupported, { strict: true }));
  const suffix = '.card::before:hover { color: red }';
  assert.deepEqual(compileStylesheet(suffix).diagnostics, [{ kind: 'feature', feature: 'pseudo-element state', count: 1 }]);
  assert.throws(() => compileStylesheet(suffix, { strict: true }));
});

test('ships container units and serialized condition programs', () => {
  const declarations = '.card { container: card / inline-size; width: 10cqw; height: 20cqh; padding: 1cqi 2cqb; margin: 1cqmin 2cqmax; }';
  assert.deepEqual(compileStylesheet(declarations, { strict: true }).diagnostics, []);
  const source = `${declarations} @container card (width > calc(10em + 1px)) and ((height > 20px) or unknown(value)) { .child { width: 50cqw } }`;
  const { bytes, diagnostics } = compileStylesheet(source, { strict: true });
  assert.equal(new DataView(bytes.buffer).getUint32(8, true), 9);
  assert.deepEqual(compileStylesheet(source).bytes, bytes);
  assert.deepEqual(diagnostics, []);
});


test('compiles tree part targets and reports unavailable pseudo-elements', () => {
  const css = '.list::marker{color:green}.input::placeholder{color:red}.input::selection{color:white;background-color:blue}.scroll::-webkit-scrollbar{width:8px}.scroll::-webkit-scrollbar-thumb{background-color:gray}.scroll::-webkit-scrollbar-track{background-color:white}';
  assert.deepEqual(compileStylesheet(css, { strict: true }).diagnostics, []);
  const unsupported = '.input::file-selector-button{color:red}.modal::backdrop{color:blue}';
  assert.deepEqual(compileStylesheet(unsupported).diagnostics, [
    { kind: 'feature', feature: 'file-selector-button', count: 1 },
    { kind: 'feature', feature: 'backdrop', count: 1 },
  ]);
  assert.throws(() => compileStylesheet(unsupported, { strict: true }));
});


test('ships typed font faces with their display periods', () => {
  const css = `@layer fonts { @media (width > 300px) { @font-face { font-family: "Brand Face"; src: local("Brand Full"), url("fonts/brand.woff2") format("woff2"); font-weight: 100 900; font-width: 75% 125%; font-style: oblique -10deg 20deg; unicode-range: U+0-FF, U+4??; font-display: swap; } } }`;
  const { bytes, diagnostics } = compileStylesheet(css, { strict: true });
  assert.equal(new DataView(bytes.buffer).getUint32(8, true), 9);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(compileStylesheet(css).bytes, bytes);
  assert.equal(new TextDecoder().decode(bytes).includes(css), false);
  assert.deepEqual(compileStylesheet('@font-face{font-family:Brand;src:url(font.ttf);font-display:block}', { strict: true }).diagnostics, []);
});


test('resolves typed font URLs without rewriting local names or unrelated values', () => {
  const css = '@font-face{font-family:Brand;src:local("Full Name"),url("../fonts/a b.ttf") format("truetype"),url("https://cdn.example/b.woff2")}';
  const seen = [];
  const resolveUrl = url => { seen.push(url); return new URL(url, 'https://app.example/styles/main.css').href; };
  const result = compileStylesheet(css, { strict: true, resolveUrl });
  assert.deepEqual(seen, ['../fonts/a b.ttf', 'https://cdn.example/b.woff2']);
  const bytes = Buffer.from(result.bytes);
  assert.ok(bytes.includes(Buffer.from('https://app.example/fonts/a%20b.ttf')));
  assert.ok(bytes.includes(Buffer.from('https://cdn.example/b.woff2')));
  assert.ok(bytes.includes(Buffer.from('Full Name')));
  const failure = new Error('asset missing');
  assert.throws(() => compileStylesheet(css, { resolveUrl() { throw failure; } }), error => error === failure);
  assert.throws(() => compileStylesheet(css, { resolveUrl() { return Promise.resolve('bad'); } }), /must return a string/);
  assert.throws(() => compileStylesheet(css, { resolveUrl() { return compileStylesheet(css); } }), /cannot run inside resolveUrl/);
  assert.deepEqual(compileStylesheet(css, { strict: true }).diagnostics, [], 'resolver failures leave the compiler usable');
});

test('prefixed aliases compile as their standard property and vendor noise stays quiet', async () => {
  const { reportDropped, standardize } = await import('../src/report.js');
  const css = '.a{-webkit-backdrop-filter:blur(4px)} .b { -webkit-mask-image: url(a.png); -webkit-text-decoration: inherit }';
  assert.deepEqual(compileStylesheet(standardize(css), { strict: true }).diagnostics, []);
  const noisy = '*, ::backdrop, ::file-selector-button { margin: 0 } ::-webkit-inner-spin-button { height: auto } :-moz-focusring { outline: auto } .c { -webkit-tap-highlight-color: red; made-up-property: 1 }';
  const lines = [];
  reportDropped(line => lines.push(line), compileStylesheet(standardize(noisy)).diagnostics);
  assert.deepEqual(lines, ['skipped 1 CSS feature Silk UI does not draw yet: made-up-property. SILKUI_CSS_REPORT=all lists everything dropped.']);
});

test('warns about keyframes that set a property Silk UI does not animate, without failing strict mode', () => {
  const css = '@keyframes pan { from { background-position: 0 0 } to { background-position: 100% 0; opacity: 0 } } @keyframes hue { to { filter: hue-rotate(360deg); opacity: 0 } }';
  const result = compileStylesheet(css, { strict: true });
  assert.deepEqual(result.diagnostics, [{ kind: 'animation', feature: 'pan: background-position', count: 1 }]);
  const warnings = [];
  reportDropped(message => warnings.push(message), result.diagnostics);
  assert.deepEqual(warnings, ['@keyframes pan sets background-position, which Silk UI does not animate: it keeps its base value']);
});
