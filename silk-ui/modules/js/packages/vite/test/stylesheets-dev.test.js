import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createServer } from 'vite';
import silk from '../src/index.js';
import { fakeHost } from './host.js';

async function until(what, host, check) {
  for (let i = 0; i < 400; i++) {
    if (check()) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`timed out waiting for ${what}\n${host.logs.join('\n')}\nCalls: ${JSON.stringify(host.calls)}`);
}

test('CSS imports compile after processing and hot updates preserve the mounted application', async () => {
  const root = mkdtempSync(fileURLToPath(new URL('.styles-', import.meta.url)));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/main.js'), `import './app.css';
import { createBox, createText, mount } from '@silkui/core';
const count = 7; mount(createBox({}, createText('counter=' + count)));`);
  writeFileSync(join(root, 'src/app.css'), '@import "./theme.css"; .count { width: 12px; }');
  const theme = join(root, 'src/theme.css');
  writeFileSync(theme, '.count { color: red; }');
  const server = await createServer({ root, configFile: false, logLevel: 'silent', cacheDir: join(root, '.vite'),
    server: { middlewareMode: true, ws: false }, plugins: [silk({ entry: 'src/main.js', strictStylesheets: true })] });
  let host;
  try {
    const listener = server.config.plugins.find(plugin => plugin.name === 'silk:dev').api.listener();
    host = fakeHost(listener.address().port);
    const sheets = () => host.calls.filter(call => call[0] === 'styleSheet' && (call[1] === 1 || call[1] === 2));
    await until('initial adoption', host, () => sheets().length === 1 && host.texts().includes('counter=7'));
    const original = sheets()[0][3];
    assert.equal(Buffer.from(original, 'base64').subarray(0, 8).toString(), 'SILKCSS\0');
    writeFileSync(theme, '.count { color: blue; }');
    await until('CSS dependency update', host, () => sheets().length === 2);
    assert.equal(sheets()[1][1], 2);
    assert.notEqual(sheets()[1][3], original);
    await new Promise(resolve => setTimeout(resolve, 200));
    writeFileSync(theme, '.count { unknown-property: 1; }');
    await until('compiler diagnostic', host, () => host.logs.some(line => line.includes('unsupported CSS')));
    assert.equal(sheets().length, 2);
    await new Promise(resolve => setTimeout(resolve, 200));
    writeFileSync(theme, '.count { color: green; }');
    await until('recovery', host, () => sheets().length === 3);
    assert.equal(host.calls.filter(call => call[0] === 'root').length, 1);
    assert.equal(host.calls.filter(call => call[0] === 'destroy' || call[0] === 'devReload').length, 0);
    assert.deepEqual(host.texts(), ['counter=7']);
  } finally {
    host?.close(); await server.close(); rmSync(root, { recursive: true, force: true });
  }
});


test('native stylesheet font URLs point to the live Vite asset server through CSS HMR', async () => {
  const root = mkdtempSync(fileURLToPath(new URL('.fonts-', import.meta.url)));
  const font = readFileSync(new URL('../../../../assets/assets/fonts/GeistMono.subset.ttf', import.meta.url));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/main.js'), `import './app.css';
import { createBox, createText, mount } from '@silkui/core';
mount(createBox({}, createText('font counter=7')));`);
  writeFileSync(join(root, 'src/brand.ttf'), font);
  writeFileSync(join(root, 'src/other.ttf'), font);
  const css = join(root, 'src/app.css');
  writeFileSync(css, '@font-face{font-family:Brand;src:url("./brand.ttf");font-display:swap}');
  const server = await createServer({ root, configFile: false, logLevel: 'silent', cacheDir: join(root, '.vite'),
    server: { host: '127.0.0.1', port: 0 }, plugins: [silk({ entry: 'src/main.js', strictStylesheets: true })] });
  let host;
  try {
    await server.listen();
    host = fakeHost(server.config.plugins.find(plugin => plugin.name === 'silk:dev').api.listener().address().port);
    const sheets = () => host.calls.filter(call => call[0] === 'styleSheet' && (call[1] === 1 || call[1] === 2));
    await until('font sheet adoption', host, () => sheets().length === 1 && host.texts().includes('font counter=7'));
    const fontUrl = new URL('/src/brand.ttf', server.resolvedUrls.local[0]).href;
    assert.ok(Buffer.from(sheets()[0][3], 'base64').includes(Buffer.from(fontUrl)));
    const response = await fetch(fontUrl);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), font);
    writeFileSync(css, '@font-face{font-family:Brand;src:url("./other.ttf");font-display:swap}');
    await until('font source replacement', host, () => sheets().length === 2);
    const otherUrl = new URL('/src/other.ttf', server.resolvedUrls.local[0]).href;
    assert.ok(Buffer.from(sheets()[1][3], 'base64').includes(Buffer.from(otherUrl)));
    const previous = sheets()[1][3];
    writeFileSync(join(root, 'src/other.ttf'), readFileSync(new URL('../../../../assets/assets/fonts/NotoSans-Regular.subset.ttf', import.meta.url)));
    await until('font file update', host, () => sheets().length === 3);
    assert.notEqual(sheets()[2][3], previous, 'font-only edits change the URL so native font caches reload it');
    assert.equal(host.calls.filter(call => call[0] === 'root').length, 1);
    assert.equal(host.calls.filter(call => call[0] === 'destroy' || call[0] === 'devReload').length, 0);
  } finally { host?.close(); await server.close(); rmSync(root, { recursive: true, force: true }); }
});
