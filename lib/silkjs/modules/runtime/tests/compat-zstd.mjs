// Differential cases for Zstandard through node:zlib. compat.mjs registers them: each prints
// digests of what the runtime produced, and the same program runs on the reference Node.
//
// The compressed bytes themselves are compared (as SHA-1 digests), not only round trips: users
// hash and store compressed output, so a level must give the bytes libzstd 1.5.7 gives.

const common = String.raw`'use strict';
const zlib = require('node:zlib');
const crypto = require('node:crypto');
const C = zlib.constants;
// Deterministic inputs: words with a skewed distribution, records, noise, and runs.
function rng(seed) { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; }
function words(size, seed) {
  const r = rng(seed), list = [];
  for (let i = 0; i < 300; i++) { let w = ''; for (let k = 2 + Math.floor(r() * 9); k > 0; k--) w += String.fromCharCode(97 + Math.floor(r() * r() * 26)); list.push(w); }
  let out = '';
  while (out.length < size) { out += list[Math.floor(r() * r() * 300)] + (r() < 0.1 ? '.\n' : ' '); }
  return Buffer.from(out.slice(0, size));
}
function records(size, seed) {
  const r = rng(seed); let out = '';
  for (let i = 0; out.length < size; i++) out += JSON.stringify({ id: i, key: Math.floor(r() * 1e9).toString(36), on: r() < 0.5, score: Math.round(r() * 1e5) / 100, tags: ['a', 'bb', 'ccc'].slice(0, Math.floor(r() * 4)) }) + '\n';
  return Buffer.from(out.slice(0, size));
}
function noise(size, seed) { const r = rng(seed), b = Buffer.alloc(size); for (let i = 0; i < size; i++) b[i] = Math.floor(r() * 256); return b; }
function mixed(size, seed) {
  const parts = []; let left = size, k = 0; const r = rng(seed);
  while (left > 0) { const n = Math.min(left, 1000 + Math.floor(r() * 40000)); parts.push([words, records, noise, (s) => Buffer.alloc(s, 97 + k)][k % 4](n, seed + k)); left -= n; k++; }
  return Buffer.concat(parts);
}
const sha = (b) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 16);
const P = (level, more) => ({ params: { [C.ZSTD_c_compressionLevel]: level, ...(more || {}) } });
function attempt(f) { try { const v = f(); return Buffer.isBuffer(v) ? [v.length, sha(v)] : v; } catch (e) { return ['throws', e.name, e.code, e.message]; } }
function collect(stream, chunks, mode) {
  return new Promise((resolve) => {
    const out = [];
    stream.on('data', (d) => out.push(d));
    stream.on('error', (e) => resolve(['error', e.code, e.errno, e.message, out.reduce((n, d) => n + d.length, 0)]));
    stream.on('end', () => { const b = Buffer.concat(out); resolve([b.length, sha(b)]); });
    let i = 0;
    (function next() {
      for (; i < chunks.length; i++) {
        const chunk = chunks[i];
        if (chunk === 'flush') { i++; stream.flush(next); return; }
        if (mode === 'serial') { i++; stream.write(chunk, next); return; }
        if (!stream.write(chunk)) { i++; stream.once('drain', next); return; }
      }
      stream.end();
    })();
  });
}
function split(buffer, size) { const out = []; for (let at = 0; at < buffer.length; at += size) out.push(buffer.subarray(at, at + size)); return out; }
module.exports = { zlib, C, words, records, noise, mixed, sha, P, attempt, collect, split, rng };
`;

const levels = String.raw`const { zlib, C, words, records, noise, mixed, sha, P, attempt } = require('./zstd-common.cjs');
const inputs = { empty: Buffer.alloc(0), one: Buffer.from('x'), tiny: Buffer.from('hello hello hello hello'), w300: words(300, 1), w5k: words(5000, 2),
  r20k: records(20000, 3), w70k: words(70000, 4), n9k: noise(9000, 5), run: Buffer.alloc(150000, 97), block: words(131072, 6), block1: words(131073, 7),
  m300k: mixed(300000, 8), r600k: records(600000, 9), w1m: words(1100000, 10) };
const out = {};
for (const [name, data] of Object.entries(inputs)) {
  const all = data.length <= 131073 ? [-131072, -1000, -50, -7, -5, -3, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22] : [LEVELS];
  out[name] = all.map((level) => {
    const frame = attempt(() => zlib.zstdCompressSync(data, P(level)));
    return [level, frame];
  });
}
console.log(JSON.stringify(out));
`;

const roundTrips = String.raw`const { zlib, C, words, records, noise, mixed, sha, P, rng } = require('./zstd-common.cjs');
// Fuzzed round trips: random inputs, levels and chunk sizes; the decoded bytes must be the input.
const r = rng(SEED); const failures = []; let frames = 0;
for (let i = 0; i < 60; i++) {
  const size = Math.floor(r() * r() * 400000);
  const data = [words, records, noise, mixed][Math.floor(r() * 4)](size, i + 100);
  const level = Math.floor(r() * 30) - 7;
  const chunkSize = [64, 1000, 16384, 70000][Math.floor(r() * 4)];
  const frame = zlib.zstdCompressSync(data, { ...P(level, r() < 0.3 ? { [C.ZSTD_c_checksumFlag]: 1 } : {}), chunkSize });
  const back = zlib.zstdDecompressSync(frame, { chunkSize: [64, 4096, 16384][Math.floor(r() * 3)] });
  frames++;
  if (!back.equals(data)) failures.push([i, size, level]);
}
console.log(JSON.stringify([frames, failures]));
`;

const parameters = String.raw`const { zlib, C, words, mixed, sha, P, attempt } = require('./zstd-common.cjs');
const data = mixed(260000, 21);
const small = words(9000, 22);
const out = [];
// Every compression parameter Node exposes, at and just past its bounds, and a value inside.
const bounds = { ZSTD_c_compressionLevel: [-131072, 22], ZSTD_c_windowLog: [10, 31], ZSTD_c_hashLog: [6, 30], ZSTD_c_chainLog: [6, 30], ZSTD_c_searchLog: [1, 30],
  ZSTD_c_minMatch: [3, 7], ZSTD_c_targetLength: [0, 131072], ZSTD_c_strategy: [1, 9], ZSTD_c_enableLongDistanceMatching: [0, 2], ZSTD_c_ldmHashLog: [6, 30],
  ZSTD_c_ldmMinMatch: [4, 4096], ZSTD_c_ldmBucketSizeLog: [1, 8], ZSTD_c_ldmHashRateLog: [0, 25], ZSTD_c_contentSizeFlag: [0, 1], ZSTD_c_checksumFlag: [0, 1],
  ZSTD_c_dictIDFlag: [0, 1], ZSTD_c_nbWorkers: [0, 256], ZSTD_c_jobSize: [0, 1073741824], ZSTD_c_overlapLog: [0, 9] };
for (const [name, [low, high]] of Object.entries(bounds)) {
  for (const value of [low - 1, low, high, high + 1]) {
    // Only whether the value is accepted: compressing 9 KB with a 2 GiB window is not the point.
    out.push([name, value, attempt(() => { const z = new zlib.ZstdCompress({ params: { [C[name]]: value } }); z.close(); return 'accepted'; })]);
  }
}
out.push(['unknown parameter', attempt(() => zlib.zstdCompressSync(small, { params: { 9999: 1 } }))]);
out.push(['non-numeric', attempt(() => zlib.zstdCompressSync(small, { params: { [C.ZSTD_c_windowLog]: 'x' } }))]);
// Explicit parameters over a level.
const sets = [
  { [C.ZSTD_c_windowLog]: 10 }, { [C.ZSTD_c_windowLog]: 14 }, { [C.ZSTD_c_windowLog]: 17 }, { [C.ZSTD_c_windowLog]: 23 },
  { [C.ZSTD_c_hashLog]: 6 }, { [C.ZSTD_c_hashLog]: 20, [C.ZSTD_c_chainLog]: 6 }, { [C.ZSTD_c_chainLog]: 22 }, { [C.ZSTD_c_searchLog]: 1 }, { [C.ZSTD_c_searchLog]: 7 },
  { [C.ZSTD_c_minMatch]: 3 }, { [C.ZSTD_c_minMatch]: 4 }, { [C.ZSTD_c_minMatch]: 5 }, { [C.ZSTD_c_minMatch]: 6 }, { [C.ZSTD_c_minMatch]: 7 },
  { [C.ZSTD_c_targetLength]: 0 }, { [C.ZSTD_c_targetLength]: 8 }, { [C.ZSTD_c_targetLength]: 999 },
  { [C.ZSTD_c_checksumFlag]: 1 }, { [C.ZSTD_c_contentSizeFlag]: 0 }, { [C.ZSTD_c_checksumFlag]: 1, [C.ZSTD_c_contentSizeFlag]: 0 }, { [C.ZSTD_c_dictIDFlag]: 0 },
];
for (const level of [1, 3, 6, 12, 17]) for (const set of sets) out.push([level, Object.entries(set).join(';'), attempt(() => zlib.zstdCompressSync(data, P(level, set)))]);
for (let strategy = 1; strategy <= 9; strategy++) {
  out.push(['strategy', strategy, attempt(() => zlib.zstdCompressSync(data, P(3, { [C.ZSTD_c_strategy]: strategy })))]);
  out.push(['strategy+w16', strategy, attempt(() => zlib.zstdCompressSync(data, P(3, { [C.ZSTD_c_strategy]: strategy, [C.ZSTD_c_windowLog]: 16, [C.ZSTD_c_minMatch]: 3 })))]);
}
// chunkSize changes how the output is collected, not the bytes.
for (const chunkSize of [64, 1000, 16384, 1 << 20]) out.push(['chunkSize', chunkSize, attempt(() => zlib.zstdCompressSync(data, { ...P(5), chunkSize }))]);
// pledgedSrcSize: right, wrong, and with the size flag off.
out.push(['pledged right', attempt(() => zlib.zstdCompressSync(small, { ...P(3), pledgedSrcSize: small.length }))]);
out.push(['pledged wrong', attempt(() => zlib.zstdCompressSync(small, { ...P(3), pledgedSrcSize: small.length + 1 }))]);
out.push(['pledged short', attempt(() => zlib.zstdCompressSync(small, { ...P(3), pledgedSrcSize: 10 }))]);
out.push(['pledged no flag', attempt(() => zlib.zstdCompressSync(small, { ...P(3, { [C.ZSTD_c_contentSizeFlag]: 0 }), pledgedSrcSize: small.length }))]);
out.push(['maxOutputLength', attempt(() => zlib.zstdDecompressSync(zlib.zstdCompressSync(data), { maxOutputLength: 1000 }))]);
out.push(['info', attempt(() => { const r = zlib.zstdCompressSync(small, { info: true }); return [Object.keys(r).sort(), r.buffer.length, sha(r.buffer), r.engine.constructor.name, r.engine.bytesWritten]; })]);
console.log(JSON.stringify(out));
`;

const streams = String.raw`const { zlib, C, words, records, mixed, sha, P, collect, split } = require('./zstd-common.cjs');
(async () => {
  const data = mixed(700000, 31);
  const small = records(30000, 32);
  const out = [];
  const make = (level, more, options) => zlib.createZstdCompress({ ...P(level, more), ...(options || {}) });
  // The same input in different pieces; flushes in the middle; the stream's own options.
  for (const level of [1, 3, 7, 19]) {
    for (const size of [1, 100, 1024, 16384, 65536, 131072, 200000, data.length]) {
      if (size === 1 && level !== 3) continue;
      const input = size === 1 ? small.subarray(0, 3000) : data;
      out.push(['pieces', level, size, await collect(make(level), split(input, size))]);
    }
    out.push(['serial', level, await collect(make(level), split(data, 50000), 'serial')]);
    const withFlush = []; split(data, 90000).forEach((piece, i) => { withFlush.push(piece); if (i % 2 === 0) withFlush.push('flush'); });
    out.push(['flushes', level, await collect(make(level), withFlush)]);
    out.push(['flush option', level, await collect(make(level, {}, { flush: C.ZSTD_e_flush }), split(data, 70000), 'serial')]);
    out.push(['small window', level, await collect(make(level, { [C.ZSTD_c_windowLog]: 12 }), split(data, 30000))]);
    out.push(['checksum', level, await collect(make(level, { [C.ZSTD_c_checksumFlag]: 1 }), split(data, 100000))]);
    out.push(['pledged', level, await collect(make(level, {}, { pledgedSrcSize: data.length }), split(data, 100000))]);
    out.push(['pledged wrong', level, await collect(make(level, {}, { pledgedSrcSize: data.length - 1 }), split(data, 100000))]);
    out.push(['chunkSize', level, await collect(make(level, {}, { chunkSize: 100 }), split(small, 7000))]);
  }
  out.push(['empty', await collect(make(3), [])]);
  out.push(['empty write', await collect(make(3), [Buffer.alloc(0)])]);
  out.push(['one byte', await collect(make(3), [Buffer.from('z')])]);
  // Decompression in pieces, of frames made in pieces.
  const frame = zlib.zstdCompressSync(data, P(5, { [C.ZSTD_c_checksumFlag]: 1 }));
  for (const size of [1, 7, 1000, 16384, 100000, frame.length]) {
    if (size === 1 && frame.length > 50000) { out.push(['decode pieces', 1, await collect(zlib.createZstdDecompress(), split(zlib.zstdCompressSync(small), 1))]); continue; }
    out.push(['decode pieces', size, await collect(zlib.createZstdDecompress(), split(frame, size))]);
  }
  out.push(['decode chunkSize', await collect(zlib.createZstdDecompress({ chunkSize: 64 }), split(zlib.zstdCompressSync(small), 5000))]);
  out.push(['decode two frames', await collect(zlib.createZstdDecompress(), split(Buffer.concat([frame, zlib.zstdCompressSync(small)]), 30000))]);
  // The promise and callback forms.
  const util = require('node:util');
  const compressed = await util.promisify(zlib.zstdCompress)(data, P(4));
  out.push(['async', compressed.length, sha(compressed), sha(await util.promisify(zlib.zstdDecompress)(compressed))]);
  const many = await Promise.all([1, 2, 3, 4, 5, 6].map((level) => util.promisify(zlib.zstdCompress)(small, P(level))));
  out.push(['async many', many.map((b) => [b.length, sha(b)])]);
  console.log(JSON.stringify(out));
})();
`;

const decoding = String.raw`const { zlib, C, words, records, noise, mixed, sha, P, attempt, collect, split, rng } = require('./zstd-common.cjs');
(async () => {
  const out = [];
  const data = mixed(200000, 41);
  const frame = zlib.zstdCompressSync(data, P(3, { [C.ZSTD_c_checksumFlag]: 1 }));
  const plain = zlib.zstdCompressSync(words(40000, 42), P(19));
  const skippable = (n, k) => { const b = Buffer.alloc(8 + n, 0x5a); b.writeUInt32LE(0x184D2A50 + k, 0); b.writeUInt32LE(n, 4); return b; };
  const both = async (label, bytes, options) => {
    out.push([label, 'sync', attempt(() => zlib.zstdDecompressSync(bytes, options))]);
    out.push([label, 'stream', await collect(zlib.createZstdDecompress(options), split(bytes, 10000))]);
  };
  await both('frame', frame);
  await both('two frames', Buffer.concat([frame, plain]));
  await both('skippable first', Buffer.concat([skippable(11, 0), frame]));
  await both('skippable between', Buffer.concat([plain, skippable(70000, 9), frame, skippable(0, 15)]));
  await both('skippable only', skippable(20, 3));
  await both('empty input', Buffer.alloc(0));
  await both('trailing garbage', Buffer.concat([plain, Buffer.from('garbage after the frame')]));
  await both('trailing zeros', Buffer.concat([plain, Buffer.alloc(9)]));
  await both('truncated', frame.subarray(0, frame.length - 1));
  await both('truncated header', frame.subarray(0, 3));
  await both('truncated block', frame.subarray(0, 5000));
  await both('bad magic', Buffer.concat([Buffer.from([1, 2, 3, 4]), frame.subarray(4)]));
  await both('not zstd', Buffer.from('this is not a zstandard frame at all'));
  await both('bad checksum', Buffer.concat([frame.subarray(0, frame.length - 1), Buffer.from([frame[frame.length - 1] ^ 1])]));
  // Mutations of single bytes: the error, or the bytes, must be the same.
  const r = rng(43);
  for (let i = 0; i < 80; i++) {
    const base = i % 2 ? frame : plain; const mutated = Buffer.from(base);
    const at = i < 20 ? Math.floor(r() * 24) : Math.floor(r() * mutated.length);
    mutated[at] ^= 1 << Math.floor(r() * 8);
    out.push(['mutation', i, at, attempt(() => zlib.zstdDecompressSync(mutated))]);
  }
  for (let i = 0; i < 20; i++) out.push(['cut', i, attempt(() => zlib.zstdDecompressSync(frame.subarray(0, Math.floor(r() * frame.length))))]);
  // The window limit.
  const wide = zlib.zstdCompressSync(data, P(3, { [C.ZSTD_c_windowLog]: 29, [C.ZSTD_c_contentSizeFlag]: 0 }));
  for (const limit of [9, 10, 27, 28, 29, 31, 32]) out.push(['windowLogMax', limit, attempt(() => zlib.zstdDecompressSync(wide, { params: { [C.ZSTD_d_windowLogMax]: limit } }))]);
  out.push(['window default', attempt(() => zlib.zstdDecompressSync(wide))]);
  out.push(['unknown d param', attempt(() => zlib.zstdDecompressSync(frame, { params: { 9999: 1 } }))]);
  out.push(['maxOutputLength', attempt(() => zlib.zstdDecompressSync(frame, { maxOutputLength: 199999 }))]);
  out.push(['maxOutputLength exact', attempt(() => zlib.zstdDecompressSync(frame, { maxOutputLength: 200000 }))]);
  console.log(JSON.stringify(out));
})();
`;

const dictionaries = String.raw`const { zlib, C, words, records, mixed, sha, P, attempt, collect, split } = require('./zstd-common.cjs');
(async () => {
  const out = [];
  const corpus = records(400000, 51);
  const raw = corpus.subarray(1000, 21000);            // a raw content dictionary
  const trained = Buffer.from(TRAINED, 'base64');      // a dictionary with entropy tables and an id
  const inputs = { small: corpus.subarray(100000, 103000), medium: corpus.subarray(200000, 290000), large: corpus.subarray(0, 380000), other: words(50000, 52), empty: Buffer.alloc(0) };
  for (const [dname, dictionary] of [['raw', raw], ['trained', trained]]) {
    for (const [name, data] of Object.entries(inputs)) {
      for (const level of [-3, 1, 3, 5, 9, 13, 16, 19]) {
        const frame = attempt(() => zlib.zstdCompressSync(data, { ...P(level), dictionary }));
        out.push([dname, name, level, frame]);
      }
      const frame = zlib.zstdCompressSync(data, { ...P(3), dictionary });
      out.push([dname, name, 'decode', attempt(() => zlib.zstdDecompressSync(frame, { dictionary }))]);
      out.push([dname, name, 'decode without', attempt(() => zlib.zstdDecompressSync(frame))]);
      out.push([dname, name, 'decode wrong', attempt(() => zlib.zstdDecompressSync(frame, { dictionary: dname === 'raw' ? trained : raw }))]);
      out.push([dname, name, 'no id', attempt(() => zlib.zstdCompressSync(data, { ...P(3, { [C.ZSTD_c_dictIDFlag]: 0 }), dictionary }))]);
      out.push([dname, name, 'stream', await collect(zlib.createZstdCompress({ ...P(3), dictionary }), split(data, 20000))]);
      out.push([dname, name, 'stream decode', await collect(zlib.createZstdDecompress({ dictionary }), split(frame, 3000))]);
    }
  }
  const broken = Buffer.from(trained); broken[12] ^= 0xff; broken[40] ^= 0x55;
  out.push(['broken dictionary compress', attempt(() => zlib.zstdCompressSync(inputs.small, { ...P(3), dictionary: broken }))]);
  out.push(['broken dictionary decompress', attempt(() => zlib.zstdDecompressSync(zlib.zstdCompressSync(inputs.small, { dictionary: trained }), { dictionary: broken }))]);
  out.push(['short dictionary', attempt(() => zlib.zstdCompressSync(inputs.small, { ...P(3), dictionary: trained.subarray(0, 8) }))]);
  out.push(['dictionary type', attempt(() => zlib.zstdCompressSync(inputs.small, { dictionary: 'text' }))]);
  console.log(JSON.stringify(out));
})();
`;

const workers = String.raw`const { zlib, C, words, records, mixed, sha, P, attempt, collect, split } = require('./zstd-common.cjs');
(async () => {
  const out = [];
  const data = Buffer.concat([mixed(900000, 61), records(500000, 62), mixed(900000, 61), words(700000, 63)]);
  // Worker-based compression: the reference's multithreaded output does not depend on timing.
  for (const level of [1, 3, 9]) {
    for (const set of [{ [C.ZSTD_c_nbWorkers]: 1 }, { [C.ZSTD_c_nbWorkers]: 2 }, { [C.ZSTD_c_nbWorkers]: 4, [C.ZSTD_c_jobSize]: 1 << 20 }, { [C.ZSTD_c_nbWorkers]: 2, [C.ZSTD_c_jobSize]: 1 << 20, [C.ZSTD_c_overlapLog]: 3 },
      { [C.ZSTD_c_nbWorkers]: 2, [C.ZSTD_c_jobSize]: 1 << 20, [C.ZSTD_c_overlapLog]: 9, [C.ZSTD_c_checksumFlag]: 1 }]) {
      const label = Object.entries(set).join(';');
      out.push(['workers', level, label, attempt(() => zlib.zstdCompressSync(data, P(level, set)))]);
      // Node's stream stops asking while the workers still hold output (ZSTD_compressStream2
      // returns before they finish), so it loses the frame's end or all of it, depending on
      // timing. The runtime must give the whole frame; its bytes are compared with libzstd by
      // modules/zstd/tests/compress_diff.py, not here.
      if (process.versions.silkjs) {
        const chunks = [];
        await new Promise((resolve, reject) => { const z = zlib.createZstdCompress(P(level, set)); z.on('data', (d) => chunks.push(d)); z.on('end', resolve); z.on('error', reject); for (const piece of split(data, 300000)) z.write(piece); z.end(); });
        out.push(['workers stream', level, label, zlib.zstdDecompressSync(Buffer.concat(chunks)).equals(data) ? 'complete' : 'incomplete']);
      } else {
        out.push(['workers stream', level, label, 'complete']);
      }
    }
    out.push(['workers small', level, attempt(() => zlib.zstdCompressSync(data.subarray(0, 100000), P(level, { [C.ZSTD_c_nbWorkers]: 2 })))]);
  }
  // Long-distance matching.
  for (const level of [1, 3, 7, 16]) {
    for (const set of [{ [C.ZSTD_c_enableLongDistanceMatching]: 1 }, { [C.ZSTD_c_enableLongDistanceMatching]: 1, [C.ZSTD_c_windowLog]: 22 },
      { [C.ZSTD_c_enableLongDistanceMatching]: 1, [C.ZSTD_c_ldmHashLog]: 12, [C.ZSTD_c_ldmMinMatch]: 32, [C.ZSTD_c_ldmBucketSizeLog]: 2, [C.ZSTD_c_ldmHashRateLog]: 3 }, { [C.ZSTD_c_enableLongDistanceMatching]: 2 }]) {
      const label = Object.entries(set).join(';');
      out.push(['ldm', level, label, attempt(() => zlib.zstdCompressSync(data, P(level, set)))]);
    }
    out.push(['ldm stream', level, await collect(zlib.createZstdCompress(P(level, { [C.ZSTD_c_enableLongDistanceMatching]: 1 })), split(data, 250000))]);
  }
  out.push(['ldm+workers', attempt(() => zlib.zstdCompressSync(data, P(3, { [C.ZSTD_c_enableLongDistanceMatching]: 1, [C.ZSTD_c_nbWorkers]: 2, [C.ZSTD_c_jobSize]: 1 << 20 })))]);
  console.log(JSON.stringify(out));
})();
`;

// A dictionary trained by `zstd --train --maxdict=2048` on 4 KB pieces of the `records` input
// above (seed 51): it has the magic number, an identifier and entropy tables.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));

export function register(file, cases, directory) {
  const trained = readFileSync(join(here, 'fixtures', 'zstd', 'records.dict')).toString('base64');
  file('zstd-common.cjs', common);
  // The optimal parser at level 22 takes seconds on these inputs.
  const add = (name, source) => { file(name + '.cjs', source); cases.push({ name, args: [join(directory, name + '.cjs')], timeout: 300000 }); };
  add('zstd-levels-small', levels.replace('[LEVELS]', '[1]'));
  add('zstd-levels-fast', levels.replace('data.length <= 131073', 'false').replace('[LEVELS]', '[-131072, -5, -1, 1, 2, 3, 4]'));
  add('zstd-levels-lazy', levels.replace('data.length <= 131073', 'false').replace('[LEVELS]', '[5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]'));
  add('zstd-levels-optimal', levels.replace('data.length <= 131073', 'false').replace('[LEVELS]', '[16, 17, 18, 19, 20, 21, 22]').replace(', w1m: words(1100000, 10)', ''));
  add('zstd-round-trips-a', roundTrips.replace('SEED', '71'));
  add('zstd-round-trips-b', roundTrips.replace('SEED', '72'));
  add('zstd-parameters', parameters);
  add('zstd-streams', streams);
  add('zstd-decoding', decoding);
  add('zstd-dictionaries', dictionaries.replace('TRAINED', JSON.stringify(trained)));
  add('zstd-workers-ldm', workers);
  add('zstd-fetch-content-encoding', String.raw`const http = require('node:http'), zlib = require('node:zlib'), crypto = require('node:crypto');
const { records } = require('./zstd-common.cjs');
const body = records(300000, 81);
const encode = { zstd: (b) => zlib.zstdCompressSync(b), 'zstd-chunked': (b) => zlib.zstdCompressSync(b), 'gzip, zstd': (b) => zlib.zstdCompressSync(zlib.gzipSync(b)), broken: (b) => zlib.zstdCompressSync(b).subarray(0, 2000) };
const server = http.createServer((request, response) => {
  const name = decodeURIComponent(request.url.slice(1));
  const encoded = encode[name](body);
  const header = name === 'zstd-chunked' || name === 'broken' ? 'zstd' : name;
  response.writeHead(200, { 'content-encoding': header, ...(name === 'zstd-chunked' ? {} : { 'content-length': encoded.length }), 'x-accept': String(request.headers['accept-encoding']) });
  if (name === 'zstd-chunked') { for (let at = 0; at < encoded.length; at += 777) response.write(encoded.subarray(at, at + 777)); response.end(); } else response.end(encoded);
});
server.listen(0, '127.0.0.1', async () => {
  const out = [];
  for (const name of Object.keys(encode)) {
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/' + encodeURIComponent(name));
      const bytes = Buffer.from(await response.arrayBuffer());
      out.push([name, response.headers.get('x-accept'), bytes.length, crypto.createHash('sha1').update(bytes).digest('hex').slice(0, 16)]);
    } catch (error) { out.push([name, 'error', error.name, error.cause && error.cause.code]); }
  }
  console.log(JSON.stringify(out));
  server.close();
});
`);
}
