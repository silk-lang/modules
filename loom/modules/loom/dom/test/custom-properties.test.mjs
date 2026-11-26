import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const source = await readFile(new URL('../js/silk-ui-dom.js', import.meta.url), 'utf8');
const { Page } = await import('data:text/javascript;base64,' + Buffer.from(source + '\nexport { Page };').toString('base64'));

function mutation(name, value, state = 0, important = false) {
  const head = Buffer.alloc(6);
  head[0] = 37;
  head.writeUInt32LE(1, 1);
  head[5] = state;
  const chunks = [head];
  function text(value) {
    const bytes = Buffer.from(value), size = Buffer.alloc(4);
    size.writeUInt32LE(bytes.length);
    chunks.push(size, bytes);
  }
  text(name);
  chunks.push(Buffer.from([value === null ? 0 : 1]));
  if (value !== null) text(value);
  chunks.push(Buffer.from([important ? 1 : 0]));
  return Buffer.concat(chunks);
}

test('custom property wire operations preserve case, priority, empty values and removal', () => {
  const values = new Map();
  const style = { setProperty: (name, value, priority) => values.set(name, [value, priority]), removeProperty: name => values.delete(name) };
  const page = { destroyed: [], styleOf: () => style, place() {} };
  function apply(name, value, state, important) {
    const bytes = mutation(name, value, state, important);
    page.exports = { memory: { buffer: bytes.buffer } };
    Page.prototype.apply.call(page, bytes.byteOffset, bytes.length);
  }
  apply('--Gap', '8px', 0, true);
  assert.deepEqual(values.get('--Gap'), ['8px', 'important']);
  apply('--Gap', '', 0, false);
  assert.deepEqual(values.get('--Gap'), [' ', '']);
  apply('--Scale', '2', 1, false);
  assert.deepEqual(values.get('--Scale'), ['2', 'important']);
  apply('--Gap', null, 0, false);
  assert.equal(values.has('--Gap'), false);
  apply('width', '99px', 0, false);
  assert.equal(values.has('width'), false);
});
