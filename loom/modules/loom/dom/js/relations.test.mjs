import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./silk-ui-dom.js', import.meta.url), 'utf8');
const { Page } = await import(`data:text/javascript;base64,${Buffer.from(source + '\nexport { Page };').toString('base64')}`);

function node() {
  const attributes = new Map();
  return {
    get id() { return attributes.get('id') ?? ''; },
    set id(value) { attributes.set('id', value); },
    setAttribute(name, value) { attributes.set(name, value); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
  };
}

function attribute(page, code, name, value) {
  const words = code === 19 ? [value] : value === null ? [name] : [name, value];
  const bytes = [code, value === null ? 0 : 1];
  page.attribute(1, { u8: () => bytes.shift(), text: () => words.shift() });
}

test('literal relation writes and removals supersede stored numeric references', () => {
  for (const name of ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-activedescendant']) {
    const nodes = [null, node(), node(), node()];
    nodes[2].id = 'title';
    nodes[3].id = '2';
    const page = Object.assign(Object.create(Page.prototype), {
      nodes: { get: id => nodes[id], values: nodes },
      meta: { get: () => ({}) }, relations: new Map(), relating: false,
    });
    attribute(page, 20, name, '2');
    page.relate();
    assert.equal(nodes[1].getAttribute(name), 'title');
    attribute(page, 22, name, '2');
    nodes[2].id = 'renamed';
    page.relate();
    assert.equal(nodes[1].getAttribute(name), '2');
    attribute(page, 20, name, '2');
    page.relate();
    assert.equal(nodes[1].getAttribute(name), 'renamed');
    attribute(page, 22, name, null);
    page.relate();
    assert.equal(nodes[1].getAttribute(name), null);
  }
});
