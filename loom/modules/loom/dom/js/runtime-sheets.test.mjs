import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeSheets } from './silk-ui-dom.js';

function documentStub() {
  const nodes = [];
  return {
    nodes,
    head: { append(node) { node.remove(); nodes.push(node); } },
    createElement(tag) { return { tagName: tag.toUpperCase(), dataset: {}, textContent: '',
      remove() { const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1); },
      before(node) { node.remove(); const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 0, node); },
      replaceWith(node) { node.remove(); const i = nodes.indexOf(this); if (i >= 0) nodes.splice(i, 1, node); },
    }; },
  };
}

test('runtime links preserve request order and keep active sheets after failure', async () => {
  const document = documentStub();
  const sheets = new RuntimeSheets(document, async url => url);
  const first = sheets.load(1, '/first.css', true);
  const second = sheets.load(2, '/second.css', true);
  await Promise.resolve();
  const firstLink = document.nodes.find(n => n.href === '/first.css');
  const secondLink = document.nodes.find(n => n.href === '/second.css');
  assert.equal(firstLink.media, 'not all');
  secondLink.onload();
  await second;
  firstLink.onload();
  await first;
  assert.deepEqual(document.nodes.map(n => n.href), ['/first.css', '/second.css']);
  const stale = sheets.load(2, '/stale.css', true);
  await Promise.resolve();
  const staleLink = document.nodes.find(n => n.href === '/stale.css');
  await sheets.load(2, 'newest {}', false);
  await stale;
  assert.equal(staleLink.onload, null);
  assert.equal(document.nodes.includes(staleLink), false);
  assert.equal(document.nodes[1].textContent, 'newest {}');
  const failed = sheets.load(2, '/failed.css', true);
  await Promise.resolve();
  document.nodes.find(n => n.href === '/failed.css').onerror();
  await failed;
  assert.equal(sheets.entries.get(2).state, 'failed');
  assert.equal(document.nodes[1].textContent, 'newest {}');
  sheets.reorder([2, 1]);
  assert.equal(document.nodes[0].textContent, 'newest {}');
  sheets.reorder([1, 1]);
  assert.equal(document.nodes[0].textContent, 'newest {}');
  sheets.close();
  assert.equal(document.nodes.length, 0);
});
