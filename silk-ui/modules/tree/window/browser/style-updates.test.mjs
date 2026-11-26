import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StyleUpdates } from './style-updates.mjs';

function fixture() {
  const state = { version: '0', bytes: new Uint8Array([1, 2, 3]), status: 200, calls: [] };
  const updates = new StyleUpdates('/styles.update', {
    interval: 0,
    fetch: async (url, options) => {
      state.calls.push(url);
      assert.equal(options.cache, 'no-store');
      return url === '/__silkui/styles' ? new Response(state.version)
        : new Response(state.bytes, { status: state.status });
    },
  });
  return { state, updates };
}

test('only changed versions fetch bytes, consumed once into wasm memory', async () => {
  const { state, updates } = fixture();
  await updates.poll();
  assert.equal(updates.length, 3);
  await updates.poll();
  assert.equal(state.calls.filter(url => url.startsWith('/styles.update')).length, 1);
  const memory = new WebAssembly.Memory({ initial: 1 });
  assert.equal(updates.read(memory, 12, 2), -1);
  assert.equal(updates.length, 3);
  assert.equal(updates.read(memory, 12, 3), 3);
  assert.deepEqual([...new Uint8Array(memory.buffer, 12, 3)], [1, 2, 3]);
  assert.equal(updates.length, 0);
  assert.equal(updates.read(memory, 12, 3), -1);
  updates.close();
});

test('failed fetch retains pending bytes and retries the same version', async () => {
  const { state, updates } = fixture();
  await updates.poll();
  state.version = '1'; state.status = 500;
  await updates.poll();
  assert.equal(updates.version, '0');
  assert.deepEqual([...updates.pending], [1, 2, 3]);
  state.status = 200; state.bytes = new Uint8Array([4, 5]);
  await updates.poll();
  assert.equal(updates.version, '1');
  assert.deepEqual([...updates.pending], [4, 5]);
  updates.close();
});

test('overlapping polls serialize and closing discards an in-flight response', async () => {
  let release;
  let calls = 0;
  const updates = new StyleUpdates('/styles.update', { interval: 0, fetch: () => {
    calls++;
    return new Promise(resolve => { release = resolve; });
  } });
  const pending = updates.poll();
  await updates.poll();
  assert.equal(calls, 1);
  updates.close();
  release(new Response('0', { status: 503 }));
  await pending;
  await updates.poll();
  assert.equal(calls, 1);
  assert.equal(updates.length, 0);
});

test('rejects oversized declared or streamed responses and recovers', async () => {
  let mode = 'declared';
  let cancelled = false;
  const updates = new StyleUpdates('/styles.update', { interval: 0, fetch: async url => {
    if (url === '/__silkui/styles') return new Response('1');
    if (mode === 'declared') return new Response('x', { headers: { 'content-length': String(64 * 1024 * 1024 + 1) } });
    if (mode === 'streamed') return new Response(new ReadableStream({
      pull(controller) { controller.enqueue(new Uint8Array(1024 * 1024)); },
      cancel() { cancelled = true; },
    }));
    return new Response(new Uint8Array([9]));
  } });
  await updates.poll();
  assert.equal(updates.version, null);
  mode = 'streamed'; await updates.poll();
  assert.equal(updates.version, null);
  assert.equal(cancelled, true);
  mode = 'valid'; await updates.poll();
  assert.equal(updates.version, '1');
  assert.equal(updates.length, 1);
  updates.close();
});
