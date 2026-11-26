import { readFileSync, writeFileSync } from 'node:fs';
import { compileStylesheet } from '../../js/packages/vite/src/compiler.js';

for (const name of ['rows', 'registered', 'siblings']) {
  const input = new URL(`../fixtures/${name}.css`, import.meta.url);
  const output = new URL(`../fixtures/${name}.sheet`, import.meta.url);
  const { bytes, diagnostics } = compileStylesheet(readFileSync(input, 'utf8'));
  writeFileSync(output, bytes);
  for (const { kind, feature, count } of diagnostics) console.warn(`${kind}: ${feature} (${count})`);
  console.log(`Wrote ${name}.sheet: ${bytes.length} compiled bytes`);
}
