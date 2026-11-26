'use strict';

// FileReader and ProgressEvent, as the W3C File API defines them (https://w3c.github.io/FileAPI/#APIASynch).
// Node has neither; a read pulls the blob's stream and fires its events from tasks, so a
// handler that starts another read or aborts sees the states the specification describes.
const { Event, EventTarget, DOMException } = require('internal/path_events/event_target');
const { defineEventHandler } = require('internal/event_target');
const { isBlob } = require('internal/web/blob');

class ProgressEvent extends Event {
  #lengthComputable;
  #loaded;
  #total;
  constructor(type, init = undefined) {
    if (arguments.length === 0) throw new TypeError('The "type" argument must be specified');
    super(type, init);
    const options = init ?? {};
    this.#lengthComputable = Boolean(options.lengthComputable);
    this.#loaded = unsignedLongLong(options.loaded);
    this.#total = unsignedLongLong(options.total);
  }
  get lengthComputable() { return this.#lengthComputable; }
  get loaded() { return this.#loaded; }
  get total() { return this.#total; }
}
Object.defineProperty(ProgressEvent.prototype, Symbol.toStringTag, { value: 'ProgressEvent', configurable: true });
for (const name of ['lengthComputable', 'loaded', 'total']) {
  Object.defineProperty(ProgressEvent.prototype, name, { enumerable: true });
}

function unsignedLongLong(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return 0;
  const integer = Math.trunc(number) % 2 ** 64;
  return integer < 0 ? integer + 2 ** 64 : integer;
}

const EMPTY = 0;
const LOADING = 1;
const DONE = 2;

// The tasks of a read are queued on the event loop's macrotask queue, as the specification's
// "queue a task" is; a later read or abort makes the earlier read's tasks do nothing.
const queueTask = callback => (typeof setImmediate === 'function' ? setImmediate(callback) : setTimeout(callback, 0));

class FileReader extends EventTarget {
  #state = EMPTY;
  #result = null;
  #error = null;
  // Incremented by every read and abort: a task of a read that is no longer current returns.
  #generation = 0;
  #reader = null;

  constructor() {
    super();
  }

  get readyState() { return this.#state; }
  get result() { return this.#result; }
  get error() { return this.#error; }

  readAsArrayBuffer(blob) { this.#read(blob, 'ArrayBuffer', arguments.length); }
  readAsBinaryString(blob) { this.#read(blob, 'BinaryString', arguments.length); }
  readAsText(blob, encoding = undefined) { this.#read(blob, 'Text', arguments.length, encoding === undefined ? undefined : String(encoding)); }
  readAsDataURL(blob) { this.#read(blob, 'DataURL', arguments.length); }

  abort() {
    if (this.#state === EMPTY || this.#state === DONE) {
      this.#result = null;
      return;
    }
    this.#state = DONE;
    this.#result = null;
    this.#generation++;
    this.#cancel();
    this.#fire('abort');
    if (this.#state !== LOADING) this.#fire('loadend');
  }

  #cancel() {
    const reader = this.#reader;
    this.#reader = null;
    if (reader) reader.cancel().catch(() => {});
  }

  #fire(type, loaded = 0, total = 0) {
    this.dispatchEvent(new ProgressEvent(type, { lengthComputable: total > 0, loaded, total }));
  }

  #read(blob, format, count, encoding) {
    if (count === 0) throw new TypeError(`Failed to execute 'readAs${format}' on 'FileReader': 1 argument required, but only 0 present.`);
    if (!isBlob(blob)) throw new TypeError(`Failed to execute 'readAs${format}' on 'FileReader': parameter 1 is not of type 'Blob'.`);
    if (this.#state === LOADING) throw new DOMException('The object is already busy reading Blobs.', 'InvalidStateError');
    this.#state = LOADING;
    this.#result = null;
    this.#error = null;
    const generation = ++this.#generation;
    const current = () => generation === this.#generation;
    const total = blob.size;
    const type = blob.type;
    const reader = blob.stream().getReader();
    this.#reader = reader;
    const chunks = [];
    let loaded = 0;
    let lastProgress = -Infinity;
    // Events wait in order: loadstart, then progress, then load or error.
    const tasks = [];
    let running = false;
    const queue = task => {
      tasks.push(task);
      if (running) return;
      running = true;
      const next = () => {
        const run = tasks.shift();
        if (current()) run();
        if (tasks.length) queueTask(next);
        else running = false;
      };
      queueTask(next);
    };
    queue(() => this.#fire('loadstart', 0, total));
    const step = () => {
      reader.read().then(({ done, value }) => {
        if (!current()) return;
        if (done) {
          queue(() => {
            this.#reader = null;
            this.#state = DONE;
            let result;
            try { result = packageData(chunks, loaded, format, type, encoding); }
            catch (error) { result = error; }
            if (result instanceof Error) return this.#failed(result, loaded, total);
            this.#result = result;
            this.#fire('load', loaded, total);
            this.#end(loaded, total);
          });
          return;
        }
        chunks.push(value);
        loaded += value.byteLength;
        const at = loaded;
        // At most one progress event every 50 ms, as the specification allows.
        const now = performance.now();
        if (now - lastProgress >= 50) {
          lastProgress = now;
          queue(() => this.#fire('progress', at, total));
        }
        step();
      }, error => {
        if (!current()) return;
        queue(() => {
          this.#reader = null;
          this.#state = DONE;
          this.#failed(error, loaded, total);
        });
      });
    };
    step();
  }

  #failed(error, loaded, total) {
    this.#result = null;
    this.#error = error instanceof DOMException ? error : new DOMException(error?.message ?? 'The blob could not be read', 'NotReadableError');
    this.#fire('error', loaded, total);
    this.#end(loaded, total);
  }

  // loadend follows load or error unless a handler started another read. A browser runs the
  // microtasks that handlers queued before it dispatches loadend; with no microtask checkpoint
  // between two dispatches here, loadend waits for the next task instead.
  #end(loaded, total) {
    if (this.#state === LOADING) return;
    const generation = this.#generation;
    queueTask(() => { if (generation === this.#generation) this.#fire('loadend', loaded, total); });
  }
}

for (const [name, value] of [['EMPTY', EMPTY], ['LOADING', LOADING], ['DONE', DONE]]) {
  Object.defineProperty(FileReader, name, { value, enumerable: true });
  Object.defineProperty(FileReader.prototype, name, { value, enumerable: true });
}
for (const name of ['readyState', 'result', 'error', 'readAsArrayBuffer', 'readAsBinaryString', 'readAsText', 'readAsDataURL', 'abort']) {
  Object.defineProperty(FileReader.prototype, name, { enumerable: true });
}
for (const name of ['loadstart', 'progress', 'load', 'abort', 'error', 'loadend']) {
  defineEventHandler(FileReader.prototype, name);
}
Object.defineProperty(FileReader.prototype, Symbol.toStringTag, { value: 'FileReader', configurable: true });

function bytesOf(chunks, length) {
  if (chunks.length === 1 && chunks[0].byteLength === length) return chunks[0];
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function packageData(chunks, length, format, type, encoding) {
  const bytes = bytesOf(chunks, length);
  switch (format) {
    case 'ArrayBuffer':
      return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes.buffer : bytes.slice().buffer;
    case 'BinaryString': {
      let text = '';
      for (let at = 0; at < bytes.length; at += 8192) text += String.fromCharCode.apply(null, bytes.subarray(at, at + 8192));
      return text;
    }
    case 'DataURL':
      return 'data:' + (type || 'application/octet-stream') + ';base64,' + Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
    case 'Text':
      return decodeText(bytes, type, encoding);
  }
}

// The specification's text decoding: the encoding argument if it names one, else the blob
// type's charset parameter, else UTF-8; a byte order mark overrides all three.
function decodeText(bytes, type, label) {
  let encoding = label === undefined ? undefined : encodingFor(label);
  if (!encoding) {
    const charset = /;\s*charset\s*=\s*("?)([^";\s]+)\1/i.exec(type)?.[2];
    if (charset) encoding = encodingFor(charset);
  }
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8';
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
  else if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
  return new TextDecoder(encoding || 'utf-8').decode(bytes);
}

function encodingFor(label) {
  try { return new TextDecoder(label).encoding; } catch { return undefined; }
}

module.exports = { FileReader, ProgressEvent };
