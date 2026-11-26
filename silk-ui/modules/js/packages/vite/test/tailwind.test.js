import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build, createServer } from 'vite';
import tailwind from '@tailwindcss/vite';
import silk from '../src/index.js';
import { fakeHost } from './host.js';

test('Tailwind compiles for release and scans source changes without reloading the app', async () => {
  const root = mkdtempSync(fileURLToPath(new URL('.tailwind-', import.meta.url)));
  let server, host;
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src/main.js'), `import './app.css';
import { createBox, createText, mount } from '@silkui/core';
mount(createBox({ className: 'p-4 flex' }, createText('counter=7')));`);
    writeFileSync(join(root, 'src/app.css'), '@import "tailwindcss" source(none);\n@source "../classes.html";');
    const classes = join(root, 'classes.html');
    writeFileSync(classes, '<div class="p-4 flex hover:bg-red-500"></div>');
    await build({ root, configFile: false, logLevel: 'silent', plugins: [tailwind(), silk({ entry: 'src/main.js' })] });
    const bytes = readFileSync(join(root, 'dist/app.sheet'));
    assert.equal(bytes.subarray(0, 8).toString(), 'SILKCSS\0');
    assert.ok(bytes.includes(Buffer.from('p-4')));
    assert.equal(existsSync(join(root, 'dist/app.css')), false);
    assert.doesNotMatch(readFileSync(join(root, 'dist/app.js'), 'utf8'), /document\.createElement|@layer|@theme|--spacing:/);
    server = await createServer({ root, configFile: false, logLevel: 'silent', cacheDir: join(root, '.vite'),
      server: { middlewareMode: true, ws: false }, plugins: [tailwind(), silk({ entry: 'src/main.js' })] });
    host = fakeHost(server.config.plugins.find(plugin => plugin.name === 'silk:dev').api.listener().address().port);
    const sheets = () => host.calls.filter(call => call[0] === 'styleSheet' && (call[1] === 1 || call[1] === 2));
    async function until(check) {
      for (let i = 0; i < 400; i++) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.fail(`Tailwind update timed out: ${host.logs.join('\n')}`);
    }
    await until(() => sheets().length === 1 && host.texts().includes('counter=7'));
    assert.ok(Buffer.from(sheets()[0][3], 'base64').includes(Buffer.from('p-4')));
    writeFileSync(classes, '<div class="p-8 flex hover:bg-red-500"></div>');
    await until(() => sheets().length > 1 && Buffer.from(sheets().at(-1)[3], 'base64').includes(Buffer.from('p-8')));
    assert.equal(sheets().at(-1)[1], 2);
    assert.equal(host.calls.filter(call => call[0] === 'root').length, 1);
    assert.equal(host.calls.filter(call => call[0] === 'destroy' || call[0] === 'devReload').length, 0);
    assert.deepEqual(host.texts(), ['counter=7']);
  } finally {
    host?.close(); await server?.close(); rmSync(root, { recursive: true, force: true });
  }
});
