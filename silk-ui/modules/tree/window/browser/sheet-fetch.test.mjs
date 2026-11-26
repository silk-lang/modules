import test from 'node:test';
import assert from 'node:assert/strict';
import { SheetFetch } from './sheet-fetch.mjs';
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

test('sheet fetch copies bytes once available and releases completed requests', async () => {
  let wakes = 0;
  const source = new SheetFetch(() => wakes++, async () => new Response('a { width: 8px }'));
  const id = source.start('/theme.css');
  assert.equal(source.length(id), -2);
  await flush();
  assert.equal(source.length(id), 16);
  const memory = new WebAssembly.Memory({ initial: 1 });
  assert.equal(source.read(id, memory, 4, 15), -1);
  assert.equal(source.read(id, memory, 4, 16), 16);
  assert.equal(new TextDecoder().decode(new Uint8Array(memory.buffer, 4, 16)), 'a { width: 8px }');
  assert.equal(wakes, 1);
  source.forget(id);
  assert.equal(source.length(id), -1);
  source.close();
  assert.equal(source.start('/later.css'), 0);
});

test('sheet fetch rejects HTTP errors and oversized responses', async () => {
  for (const response of [new Response('missing', { status: 404 }), new Response('', { headers: { 'content-length': String(64 * 1024 * 1024 + 1) } })]) {
    const source = new SheetFetch(() => {}, async () => response);
    const id = source.start('/theme.css');
    await flush();
    assert.equal(source.length(id), -1);
    source.close();
  }
});

test('cancelled requests never publish a late response or wake the host', async () => {
  let resolve;
  let signal;
  let wakes = 0;
  const source = new SheetFetch(() => wakes++, (_url, options) => {
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  });
  const id = source.start('/theme.css');
  source.forget(id);
  assert.equal(signal.aborted, true);
  resolve(new Response('a {}'));
  await flush();
  assert.equal(source.length(id), -1);
  assert.equal(wakes, 0);
});
