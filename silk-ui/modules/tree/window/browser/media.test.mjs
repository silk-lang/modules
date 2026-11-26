import assert from 'node:assert/strict';
import test from 'node:test';
import { MediaPreferences } from './media.mjs';

test('browser media inputs wake the host and release every listener on close', () => {
  const queries = new Map();
  let changes = 0;
  const media = new MediaPreferences(() => changes++, query => {
    const listeners = new Set();
    const value = { matches: /^(\(hover: hover\)|\(pointer: fine\)|\(any-pointer: fine\)|\(any-hover: hover\))$/.test(query),
      addEventListener(type, fn) { assert.equal(type, 'change'); listeners.add(fn); },
      removeEventListener(type, fn) { assert.equal(type, 'change'); listeners.delete(fn); },
      change(matches) { this.matches = matches; for (const fn of listeners) fn(); },
    };
    queries.set(query, value);
    return value;
  });
  assert.equal(media.bits, 212);
  queries.get('(prefers-color-scheme: dark)').change(true);
  queries.get('(prefers-reduced-motion: reduce)').change(true);
  queries.get('(any-pointer: coarse)').change(true);
  assert.equal(media.bits, 247);
  assert.equal(changes, 3);
  queries.get('(forced-colors: active)').change(true);
  assert.equal(media.bits, 503);
  assert.equal(changes, 4);
  media.close();
  for (const query of queries.values()) query.change(false);
  assert.equal(changes, 4);
});
