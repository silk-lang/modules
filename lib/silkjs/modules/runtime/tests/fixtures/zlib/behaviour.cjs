'use strict';
// What node:zlib does, apart from the compressed bytes: round trips over the options, what each
// damaged stream reports, bytesWritten, flushes, parameter changes, resets, dictionaries, gzip
// members, limits. Prints lines that are the same under Node 24 (tests/compat.mjs compares).
const zlib = require('node:zlib');
const { generator, input, digest, drive, describe } = require('./common.cjs');
const streams = require('./streams.json');
const C = zlib.constants;
const out = [];
const say = (name, value) => out.push(name + ' ' + JSON.stringify(value));
const attempt = (action) => { try { const value = action(); return Buffer.isBuffer(value) ? [value.length, digest(value)] : value; } catch (error) { return describe(error); } };
const bytes = (name) => Buffer.from(streams[name], 'base64');
const plain = bytes('plain');

async function main() {
  // Round trips: every format, level and strategy, and windows and memory levels.
  const pairs = [['deflate', zlib.deflateSync, zlib.inflateSync], ['raw', zlib.deflateRawSync, zlib.inflateRawSync], ['gzip', zlib.gzipSync, zlib.gunzipSync]];
  const samples = [input('text', 70000), input('mixed', 120000), input('random', 5000), Buffer.alloc(0), Buffer.from('a')];
  let ok = 0, total = 0;
  for (const [, encode, decode] of pairs) for (let level = -1; level <= 9; level++) for (let strategy = 0; strategy <= 4; strategy++) for (const sample of samples) {
    total++; if (decode(encode(sample, { level, strategy })).equals(sample)) ok++;
  }
  for (const [format, encode, decode] of pairs) for (const windowBits of [8, 9, 12, 15]) for (const memLevel of [1, 9]) {
    if (windowBits === 8 && format !== 'deflate') continue;
    total++; const packed = encode(samples[1], { windowBits, memLevel });
    if (decode(packed, { windowBits: Math.max(9, windowBits) }).equals(samples[1]) && zlib.unzipSync(format === 'raw' ? zlib.gzipSync(samples[1]) : packed).equals(samples[1])) ok++;
  }
  say('roundtrips', [ok, total]);

  // The fixed streams decode, by every reader that should take them.
  for (const [name, decode] of [['gzip', zlib.gunzipSync], ['gzip', zlib.unzipSync], ['zlib', zlib.inflateSync], ['zlib', zlib.unzipSync], ['raw', zlib.inflateRawSync], ['stored', zlib.inflateRawSync], ['fixed', zlib.inflateRawSync]]) {
    say(`decode ${name} ${decode.name}`, attempt(() => decode(bytes(name))));
  }
  // And what the wrong reader, a wrong window or a wrong dictionary says.
  for (const [name, decode, options] of [
    ['gzip', zlib.inflateSync], ['gzip', zlib.inflateRawSync], ['zlib', zlib.gunzipSync], ['zlib', zlib.inflateRawSync], ['raw', zlib.inflateSync], ['raw', zlib.gunzipSync], ['raw', zlib.unzipSync],
    ['window15', zlib.inflateSync, { windowBits: 9 }], ['window15', zlib.inflateSync, { windowBits: 15 }], ['window15', zlib.inflateSync, { windowBits: 0 }], ['window9', zlib.inflateSync, { windowBits: 9 }], ['window9', zlib.inflateSync, { windowBits: 8 }], ['window9', zlib.inflateSync, { windowBits: 0 }],
    ['zlibDictionary', zlib.inflateSync], ['zlibDictionary', zlib.inflateSync, { dictionary: bytes('dictionary') }], ['zlibDictionary', zlib.inflateSync, { dictionary: Buffer.from('another') }], ['zlibDictionary', zlib.unzipSync, { dictionary: bytes('dictionary') }],
    ['rawDictionary', zlib.inflateRawSync], ['rawDictionary', zlib.inflateRawSync, { dictionary: bytes('dictionary') }], ['zlib', zlib.inflateSync, { dictionary: bytes('dictionary') }], ['gzip', zlib.gunzipSync, { dictionary: bytes('dictionary') }],
  ]) say(`open ${name} ${decode.name} ${JSON.stringify(options ? Object.keys(options).map((k) => k === 'dictionary' ? k + options[k].length : k + options[k]) : [])}`, attempt(() => decode(bytes(name), options)));

  // Every single damaged byte of the first 48 and the last 12, and cuts at every length.
  for (const name of ['gzip', 'zlib', 'raw', 'stored', 'fixed']) {
    const decode = name === 'gzip' ? zlib.gunzipSync : name === 'zlib' ? zlib.inflateSync : zlib.inflateRawSync;
    const good = bytes(name), results = {};
    const tally = (value) => { const key = JSON.stringify(value); results[key] = (results[key] || 0) + 1; };
    const positions = [];
    for (let i = 0; i < Math.min(48, good.length); i++) positions.push(i);
    for (let i = Math.max(48, good.length - 12); i < good.length; i++) positions.push(i);
    for (const at of positions) for (const mask of [1, 0x10, 0x80, 0xff]) { const bad = Buffer.from(good); bad[at] ^= mask; tally(attempt(() => decode(bad))); }
    say(`damaged ${name}`, results);
    const cuts = {};
    for (let length = 0; length < good.length; length += length < 40 ? 1 : 37) { const key = JSON.stringify(attempt(() => decode(good.subarray(0, length)))); cuts[key] = (cuts[key] || 0) + 1; }
    say(`cut ${name}`, cuts);
    say(`cut ${name} finishFlush=sync`, [0, 1, 2, 5, 18, 100, good.length - 1].map((length) => attempt(() => decode(good.subarray(0, length), { finishFlush: C.Z_SYNC_FLUSH }))));
  }
  // Hand-made streams for each cause that zlib names.
  const cases = {
    'block type 3': '07', 'stored lengths': '0000001234', 'stored cut': '01050000ff61', 'too many symbols': 'fdffff', 'code lengths set': '05c0ffffffffffff',
    'no codes': '0500000000000000', 'fixed bad length code': '63f8ff', 'distance too far': '4b04fa0000', 'bad distance code': '73f47f00', 'empty': '', 'zero': '00',
    'zlib bad check': '7800', 'zlib method': '7701', 'zlib window': '8859', 'zlib data check': '789c4b4c4a0600024d012600', 'zlib one byte': '78',
    'gzip magic': '1f8c0800000000000003', 'gzip method': '1f8b0700000000000003', 'gzip flags': '1f8b08e0000000000003', 'gzip header crc': '1f8b0802000000000003ffff4b4c4a0600c241243503000000',
    'gzip name': '1f8b08080000000000036e616d65004b4c4a0600c241243503000000', 'gzip crc': '1f8b08000000000000034b4c4a0600c241243603000000', 'gzip length': '1f8b08000000000000034b4c4a0600c241243504000000',
  };
  for (const [name, hex] of Object.entries(cases)) {
    const data = Buffer.from(hex, 'hex');
    say(`cause ${name}`, [attempt(() => zlib.inflateRawSync(data)), attempt(() => zlib.inflateSync(data)), attempt(() => zlib.gunzipSync(data)), attempt(() => zlib.unzipSync(data))]);
  }

  // gzip members, and bytes after the end.
  const member = bytes('gzip');
  for (const [name, data] of [['two members', Buffer.concat([member, member])], ['zero padding', Buffer.concat([member, Buffer.alloc(9)])], ['junk', Buffer.concat([member, Buffer.from('junk after')])],
    ['member then junk', Buffer.concat([member, member, Buffer.from([7, 7])])], ['member cut', Buffer.concat([member, member.subarray(0, 30)])], ['zlib then junk', Buffer.concat([bytes('zlib'), Buffer.from('junk')])], ['raw then junk', Buffer.concat([bytes('raw'), Buffer.from('junk')])]]) {
    const decode = name.startsWith('zlib') ? zlib.inflateSync : name.startsWith('raw') ? zlib.inflateRawSync : zlib.gunzipSync;
    say(`after ${name}`, [attempt(() => decode(data)), attempt(() => zlib.unzipSync(data)), attempt(() => decode(data, { info: true }).engine.bytesWritten)]);
  }

  // Limits and info.
  say('maxOutputLength', [attempt(() => zlib.gunzipSync(member, { maxOutputLength: 100 })), attempt(() => zlib.gunzipSync(member, { maxOutputLength: plain.length })), attempt(() => zlib.gzipSync(plain, { maxOutputLength: 20 }))]);
  { const { buffer, engine } = zlib.inflateSync(bytes('zlib'), { info: true }); say('info', [buffer.length, engine.bytesWritten, engine.constructor.name]); }
  say('bad options', [[{ level: 10 }], [{ level: -2 }], [{ windowBits: 7 }], [{ windowBits: 16 }], [{ memLevel: 0 }], [{ memLevel: 10 }], [{ strategy: 5 }], [{ chunkSize: 63 }], [{ flush: 6 }], [{ finishFlush: -1 }], [{ dictionary: 'text' }]].map(([options]) => attempt(() => zlib.deflateSync(plain, options)) && attempt(() => zlib.deflateSync(plain, options)).slice(0, 1)));
  say('raw window 8', [attempt(() => zlib.deflateRawSync(plain, { windowBits: 8 }).length > 0), attempt(() => zlib.inflateRawSync(zlib.deflateRawSync(plain, { windowBits: 8 }), { windowBits: 8 }).equals(plain)), attempt(() => zlib.gzipSync(plain, { windowBits: 8 }).length > 0)]);

  // Streams: chunks in, flushes, bytesWritten at each step, and the decoded output.
  for (const [name, make, unmake] of [['deflate', zlib.createDeflate, zlib.createInflate], ['raw', zlib.createDeflateRaw, zlib.createInflateRaw], ['gzip', zlib.createGzip, zlib.createGunzip]]) {
    const source = input('mixed', 150000, 5), seen = [];
    const stream = make({ level: 5, chunkSize: 512 });
    const parts = [source.subarray(0, 10), { flush: C.Z_SYNC_FLUSH }, source.subarray(10, 40000), { flush: C.Z_FULL_FLUSH }, { flush: C.Z_FULL_FLUSH }, source.subarray(40000, 40001), { flush: C.Z_PARTIAL_FLUSH }, { params: [9, C.Z_FILTERED] }, source.subarray(40001, 90000), { flush: C.Z_BLOCK }, { params: [0, C.Z_DEFAULT_STRATEGY] }, source.subarray(90000, 120000), { params: [1, C.Z_RLE] }, source.subarray(120000)];
    const { chunks, error } = await drive(stream, parts.map((part) => part));
    seen.push(stream.bytesWritten, describe(error));
    const packed = Buffer.concat(chunks);
    // Decode it in pieces of many sizes, with every flush mode.
    for (const flush of [C.Z_NO_FLUSH, C.Z_SYNC_FLUSH, C.Z_BLOCK]) for (const size of [1, 7, 1000, 65536]) {
      const reader = unmake({ flush, chunkSize: flush === C.Z_BLOCK ? 4096 : 64 * (1 + size % 5) });
      const pieces = []; for (let at = 0; at < packed.length; at += size * (size === 1 ? 997 : 1)) pieces.push(packed.subarray(at, Math.min(packed.length, at + size * (size === 1 ? 997 : 1))));
      const result = await drive(reader, size === 1 ? [packed.subarray(0, 1), packed.subarray(1, 2), packed.subarray(2, 3), ...pieces.map((p, i) => i ? p : p.subarray(3))] : pieces);
      seen.push([Buffer.concat(result.chunks).equals(source), reader.bytesWritten === packed.length, describe(result.error)]);
    }
    say(`stream ${name}`, seen);
  }
  // A reset between streams, and a decoder reused after a reset.
  {
    const stream = zlib.createDeflate();
    const { chunks } = await drive(stream, [plain, { flush: C.Z_FULL_FLUSH }, { reset: true }, plain.subarray(0, 100)]);
    const all = Buffer.concat(chunks);
    say('reset', [attempt(() => zlib.inflateSync(all).length), attempt(() => zlib.inflateSync(all, { finishFlush: C.Z_SYNC_FLUSH }).length)]);
  }
  // Errors of a stream: what was emitted before, the error, and that nothing follows.
  for (const name of ['gzip', 'zlib', 'raw']) {
    const make = name === 'gzip' ? zlib.createGunzip : name === 'zlib' ? zlib.createInflate : zlib.createInflateRaw;
    const good = bytes(name), seen = [];
    for (const [at, mask] of [[0, 0xff], [1, 1], [12, 0x40], [good.length >> 1, 0xff], [good.length - 5, 1], [good.length - 1, 0x80]]) {
      const bad = Buffer.from(good); bad[at] ^= mask;
      const reader = make({ chunkSize: 64 });
      const result = await drive(reader, [bad.subarray(0, 5), bad.subarray(5, 300), bad.subarray(300)]);
      seen.push([Buffer.concat(result.chunks).length, describe(result.error), reader.destroyed]);
    }
    const reader = make();
    const cut = await drive(reader, [good.subarray(0, good.length - 3)]);
    seen.push([Buffer.concat(cut.chunks).length, describe(cut.error)]);
    say(`stream errors ${name}`, seen);
  }
  // Callback API on the thread pool, many at once.
  await new Promise((resolve) => {
    let pending = 0; const seen = [];
    for (let i = 0; i < 24; i++) {
      pending++;
      const source = input(['text', 'json', 'runs'][i % 3], 20000 + i * 1000, i);
      zlib.gzip(source, { level: i % 10 }, (error, packed) => {
        zlib.unzip(packed, (error2, back) => { seen[i] = [describe(error), describe(error2), back && back.equals(source)]; if (--pending === 0) { say('async', seen.every((x) => x[0] === null && x[1] === null && x[2])); resolve(); } });
      });
    }
  });
  await new Promise((resolve) => zlib.inflate(Buffer.from('7800', 'hex'), (error) => { say('async error', describe(error)); resolve(); }));
  say('crc32', [zlib.crc32(''), zlib.crc32('hello'), zlib.crc32(plain), zlib.crc32(plain, 123), zlib.crc32(Buffer.alloc(100000, 7))]);
  console.log(out.join('\n'));
}
main();
