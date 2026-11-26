import assert from 'node:assert/strict';
import { test, afterEach } from 'node:test';
import { installMock } from './mock.js';
const mock = installMock();
const { CSSStyleSheet, createBox, createElement, createText, mount, updateStyleSheet } = await import('../src/index.js');
const record = mock.native.styleSheet;
mock.native.styleSheet = (operation, id, bytes) => {
  if (operation !== 3 && bytes === 'invalid') throw new TypeError('invalid compiled stylesheet');
  record(operation, id, bytes);
};
mock.native.compileStyleSheet = text => text === 'broken' ? 'invalid' : Buffer.from(text).toString('base64');
afterEach(() => { mock.native.unload(); mock.take(); });
const operations = () => mock.take().filter(call => call[0] === 'styleSheet');

test('adopts before mount, replaces shared sheets and preserves duplicate positions', () => {
  const first = CSSStyleSheet.fromCompiled('first');
  const second = CSSStyleSheet.fromCompiled('second');
  const root = createBox();
  root.adoptedStyleSheets = [first, second, first];
  operations();
  mount(root);
  const adopted = operations();
  assert.deepEqual(adopted.map(call => [call[1], call[3]]), [[1, 'first'], [1, 'second'], [1, 'first']]);
  first.replaceCompiled(new Uint8Array([0, 255, 32]));
  const changed = operations();
  assert.deepEqual(changed.map(call => call.slice(1)), [[0, 0, 'AP8g'], [2, adopted[0][2], 'AP8g'], [2, adopted[2][2], 'AP8g']]);
});

test('observable adoption arrays validate mutations before changing the active list', () => {
  const first = CSSStyleSheet.fromCompiled('first');
  const second = CSSStyleSheet.fromCompiled('second');
  const root = mount(createBox());
  root.adoptedStyleSheets.push(first, second);
  operations();
  const array = root.adoptedStyleSheets;
  assert.throws(() => array.push({}), TypeError);
  assert.throws(() => { array[0] = null; }, TypeError);
  assert.throws(() => Object.defineProperty(array, '0', { value: {} }), TypeError);
  assert.throws(() => { delete array[0]; }, TypeError);
  assert.throws(() => { array.length = 4; }, TypeError);
  assert.deepEqual([...array], [first, second]);
  assert.deepEqual(operations(), []);
  array.reverse();
  assert.deepEqual([...array], [second, first]);
  assert.deepEqual(operations().filter(call => call[1] === 1).map(call => call[3]), ['second', 'first']);
  array.splice(1, 1);
  assert.deepEqual([...root.adoptedStyleSheets], [second]);
  root.adoptedStyleSheets = [];
  assert.equal(array.length, 0);
});

test('empty adopted sheets activate on replacement and failures retain previous bytes', async () => {
  const sheet = new CSSStyleSheet();
  const root = mount(createBox());
  root.adoptedStyleSheets = [sheet];
  assert.deepEqual(operations(), []);
  sheet.replaceSync('red');
  assert.deepEqual(operations().map(call => call[1]), [0, 1]);
  assert.throws(() => sheet.replaceSync('broken'), TypeError);
  assert.deepEqual(operations(), []);
  const promise = sheet.replace('blue');
  assert.throws(() => sheet.replaceSync('green'), { name: 'NotAllowedError' });
  await assert.rejects(sheet.replace('green'), { name: 'NotAllowedError' });
  assert.equal(await promise, sheet);
  assert.deepEqual(operations().map(call => call[1]), [0, 2]);
});

test('CSS imports keep their order on replacement, precede constructed sheets and clean up', () => {
  updateStyleSheet('/a.css', 'first');
  updateStyleSheet('/b.css', 'second');
  const root = createBox();
  root.adoptedStyleSheets = [CSSStyleSheet.fromCompiled('third')];
  operations();
  mount(root);
  assert.deepEqual(operations().map(call => call[3]), ['first', 'second', 'third']);
  updateStyleSheet('/a.css', 'changed');
  assert.deepEqual(operations().map(call => [call[1], call[3]]), [[0, 'changed'], [2, 'changed']]);
  updateStyleSheet('/a.css', null);
  assert.deepEqual(operations().filter(call => call[1] === 1).map(call => call[3]), ['second', 'third']);
  root.destroy();
  assert.equal(operations().filter(call => call[1] === 3).length, 2);
});

test('style elements apply their text in tree order while in the document', async () => {
  const root = createBox();
  root.adoptedStyleSheets = [CSSStyleSheet.fromCompiled('adopted')];
  mount(root);
  operations();
  const first = createElement('style');
  first.appendChild(createText('.a{}'));
  const second = createElement('style');
  second.appendChild(createText('.b{}'));
  root.appendChild(second);
  root.insertBefore(first, second);
  assert.equal(first.sheet, null);
  await Promise.resolve();
  const decoded = () => operations().filter(call => call[1] === 1).map(call => call[3] === 'adopted' ? 'adopted' : Buffer.from(call[3], 'base64').toString());
  assert.deepEqual(decoded(), ['.a{}', '.b{}', 'adopted']);
  assert.ok(first.sheet instanceof CSSStyleSheet);
  first.firstChild.data = '.c{}';
  await Promise.resolve();
  assert.deepEqual(operations().map(call => [call[1], Buffer.from(call[3], 'base64').toString()]), [[0, '.c{}'], [2, '.c{}']]);
  second.remove();
  await Promise.resolve();
  assert.deepEqual(decoded(), ['.c{}', 'adopted']);
  assert.equal(second.sheet, null);
});
