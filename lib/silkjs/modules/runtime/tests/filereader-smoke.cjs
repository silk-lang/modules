'use strict';

// FileReader and ProgressEvent (ext/web/filereader.js): run with the runtime. The W3C cases
// are WPT's FileAPI/reading-data-section, which this passes in full; these are the runtime's
// own seams: a file-backed blob, a file that changes under a read, and the globals' shape.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function read(blob, method, ...args) {
  return new Promise(resolve => {
    const reader = new FileReader();
    const events = [];
    for (const type of ['loadstart', 'progress', 'load', 'abort', 'error', 'loadend']) {
      reader.addEventListener(type, event => {
        assert.ok(event instanceof ProgressEvent);
        events.push(type + (type === 'progress' || type === 'load' ? ':' + event.loaded + '/' + event.total : ''));
        if (type === 'loadend') resolve({ reader, events });
      });
    }
    reader[method](blob, ...args);
    assert.equal(reader.readyState, FileReader.LOADING);
  });
}

(async () => {
  assert.equal(typeof FileReader, 'function');
  assert.ok(!Object.keys(globalThis).includes('FileReader'), 'an interface global is not enumerable');
  assert.equal(Object.prototype.toString.call(new FileReader()), '[object FileReader]');
  const progress = new ProgressEvent('progress', { lengthComputable: true, loaded: 2, total: 4 });
  assert.deepEqual([progress.type, progress.lengthComputable, progress.loaded, progress.total, progress.bubbles], ['progress', true, 2, 4, false]);

  const text = await read(new Blob(['héllo']), 'readAsText');
  assert.equal(text.reader.result, 'héllo');
  assert.deepEqual(text.events, ['loadstart', 'progress:6/6', 'load:6/6', 'loadend']);
  const latin = await read(new Blob([new Uint8Array([0xe9])]), 'readAsText', 'latin1');
  assert.equal(latin.reader.result, 'é');
  const url = await read(new Blob(['hi']), 'readAsDataURL');
  assert.equal(url.reader.result, 'data:application/octet-stream;base64,aGk=');

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'silkjs-filereader-'));
  const file = path.join(directory, 'a.txt');
  fs.writeFileSync(file, 'x'.repeat(200000));
  const backed = await fs.openAsBlob(file, { type: 'text/plain' });
  const whole = await read(backed, 'readAsArrayBuffer');
  assert.equal(whole.reader.result.byteLength, 200000);
  assert.deepEqual([whole.events[0], whole.events.at(-2), whole.events.at(-1)], ['loadstart', 'load:200000/200000', 'loadend']);
  fs.writeFileSync(file, 'changed');
  const changed = await read(backed, 'readAsText');
  assert.equal(changed.reader.result, null);
  assert.equal(changed.reader.error.name, 'NotReadableError');
  assert.deepEqual(changed.events, ['loadstart', 'error', 'loadend']);
  fs.rmSync(directory, { recursive: true });

  const reader = new FileReader();
  reader.readAsText(new Blob(['a']));
  assert.throws(() => reader.readAsText(new Blob(['b'])), { name: 'InvalidStateError' });
  reader.abort();
  assert.equal(reader.readyState, FileReader.DONE);
  assert.throws(() => reader.readAsText('not a blob'), TypeError);
  console.log('filereader smoke: ok');
})().catch(error => { console.error(error); process.exit(1); });
