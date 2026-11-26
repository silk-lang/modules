'use strict';
// node:zlib throughput and peak memory: deflate and inflate, gzip and raw, levels 1, 6 and 9,
// one-shot and streaming in small chunks, on text, JSON, random bytes and a large binary; and
// crc32. One line of JSON per case. tools/zlib_bench.py runs it for two builds in turns.
//
//   silkjs bench/scripts/zlib.cjs [--only <regexp>] [--min-ms 150] [--binary <file>]
const zlib = require('node:zlib');
const fs = require('node:fs');

const args = process.argv.slice(2);
function option(name, fallback) {
  const at = args.indexOf(name);
  return at < 0 ? fallback : args[at + 1];
}
const only = new RegExp(option('--only', ''));
const minimum = Number(option('--min-ms', '150'));
const binaryPath = option('--binary', process.execPath);
const SIZE = 4 << 20;

// A fixed generator, so every build compresses the same bytes.
let seed = 0x2545f491;
function random() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed;
}
function text() {
  const words = ('the of and to in is that for it as was with be by on not he this are or his from at which but have an had they you were ' +
    'their one all we can her has there been if more when will would who so no stream window buffer deflate block compress level memory ' +
    'function return const value object string number length index error callback promise module export import async await').split(' ');
  const parts = [];
  let length = 0;
  while (length < SIZE) {
    let sentence = '';
    const count = 4 + random() % 14;
    for (let i = 0; i < count; i++) sentence += (i ? ' ' : '') + words[random() % words.length];
    sentence = sentence[0].toUpperCase() + sentence.slice(1) + (random() % 9 ? '. ' : '.\n\n');
    parts.push(sentence);
    length += sentence.length;
  }
  return Buffer.from(parts.join('')).subarray(0, SIZE);
}
function json() {
  const rows = [];
  let length = 0;
  while (length < SIZE) {
    const row = JSON.stringify({
      id: rows.length, uuid: (random().toString(16) + random().toString(16)).padStart(16, '0'),
      name: 'user' + random() % 5000, active: random() % 3 !== 0, score: random() % 100000 / 100,
      tags: ['alpha', 'beta', 'gamma', 'delta'].slice(0, 1 + random() % 4),
      address: { city: ['Lisbon', 'Porto', 'Braga', 'Faro'][random() % 4], zip: String(1000 + random() % 9000) },
    });
    rows.push(row);
    length += row.length + 1;
  }
  return Buffer.from('[' + rows.join(',') + ']').subarray(0, SIZE);
}
function noise() {
  const bytes = Buffer.alloc(SIZE);
  for (let i = 0; i < SIZE; i += 4) bytes.writeUInt32LE(random(), i);
  return bytes;
}
function binary() {
  // An executable: code, tables and strings. 16 MiB from 1 MiB in.
  const fd = fs.openSync(binaryPath, 'r');
  const bytes = Buffer.alloc(16 << 20);
  const read = fs.readSync(fd, bytes, 0, bytes.length, 1 << 20);
  fs.closeSync(fd);
  return bytes.subarray(0, read);
}
const inputs = { text, json, random: noise, binary };

const results = [];
function report(name, bytes, runs, elapsed, extra) {
  const line = { name, mbps: +(bytes * runs / 1048576 / (elapsed / 1000)).toFixed(2), runs, ...extra };
  results.push(line);
  console.log(JSON.stringify(line));
}
function now() { return Number(process.hrtime.bigint()) / 1e6; }

function oneShot(name, bytes, work) {
  work(); // warm up
  let runs = 0;
  const start = now();
  let elapsed = 0;
  do { work(); runs++; elapsed = now() - start; } while (elapsed < minimum);
  report(name, bytes, runs, elapsed);
}

function streamOnce(make, input, chunk) {
  return new Promise((resolve, reject) => {
    const stream = make();
    let total = 0;
    stream.on('data', (part) => { total += part.length; });
    stream.on('error', reject);
    stream.on('end', () => resolve(total));
    let at = 0;
    function write() {
      while (at < input.length) {
        const end = Math.min(at + chunk, input.length);
        const more = stream.write(input.subarray(at, end));
        at = end;
        if (!more) { stream.once('drain', write); return; }
      }
      stream.end();
    }
    write();
  });
}
async function streamed(name, bytes, make, input, chunk) {
  await streamOnce(make, input, chunk);
  let runs = 0;
  const start = now();
  let elapsed = 0;
  do { await streamOnce(make, input, chunk); runs++; elapsed = now() - start; } while (elapsed < minimum);
  report(name, bytes, runs, elapsed);
}

(async () => {
  const formats = {
    gzip: [zlib.gzipSync, zlib.gunzipSync, zlib.createGzip, zlib.createGunzip],
    raw: [zlib.deflateRawSync, zlib.inflateRawSync, zlib.createDeflateRaw, zlib.createInflateRaw],
  };
  for (const kind of Object.keys(inputs)) {
    if (!only.test(kind) && !only.test('crc32')) {
      let wanted = false;
      for (const format of Object.keys(formats)) for (const level of [1, 6, 9]) for (const op of ['deflate', 'inflate']) for (const mode of ['oneshot', 'stream']) wanted ||= only.test(`${op}-${format}-${level}-${kind}-${mode}`);
      if (!wanted) continue;
    }
    const input = inputs[kind]();
    for (const format of Object.keys(formats)) {
      const [deflateSync, inflateSync, createDeflate, createInflate] = formats[format];
      for (const level of [1, 6, 9]) {
        const base = `${format}-${level}-${kind}`;
        const packed = deflateSync(input, { level });
        if (only.test(`deflate-${base}-oneshot`)) oneShot(`deflate-${base}-oneshot`, input.length, () => deflateSync(input, { level }));
        if (only.test(`inflate-${base}-oneshot`)) oneShot(`inflate-${base}-oneshot`, input.length, () => inflateSync(packed));
        // Streams in 1 KiB writes: the chunk sizes of a proxy or a line-oriented producer.
        if (only.test(`deflate-${base}-stream`)) await streamed(`deflate-${base}-stream`, input.length, () => createDeflate({ level }), input, 1024);
        if (only.test(`inflate-${base}-stream`)) await streamed(`inflate-${base}-stream`, input.length, () => createInflate(), packed, 1024);
      }
    }
    if (only.test(`crc32-${kind}`)) oneShot(`crc32-${kind}`, input.length, () => zlib.crc32(input));
  }
  const usage = process.resourceUsage();
  console.log(JSON.stringify({ name: 'process', maxRssMb: +(usage.maxRSS / 1024).toFixed(1), cases: results.length }));
})().catch((error) => { console.error(error); process.exit(1); });
