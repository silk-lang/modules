'use strict';
// Fuzzed node:zlib, with a fixed seed: round trips through random options, chunk sizes and
// flushes, and randomly damaged copies of the fixed streams. Prints what each reported, which
// is the same under Node 24 (tests/compat.mjs compares). The compressed bytes are not printed:
// Node's zlib writes others.
const zlib = require('node:zlib');
const { generator, input, digest, drive, describe } = require('./common.cjs');
const streams = require('./streams.json');
const C = zlib.constants;
const seed = Number(process.argv[2] || 7);
const random = generator(seed);
// The compressed length differs between zlib builds, so what depends on it draws from generators
// of its own, and the damage does not depend on the round trips before it.
const pieceRandom = generator(seed + 1000003);
const damageRandom = generator(seed + 2000003);
const out = [];

async function main() {
  // Round trips.
  const makers = { deflate: [zlib.createDeflate, zlib.createInflate, zlib.inflateSync], raw: [zlib.createDeflateRaw, zlib.createInflateRaw, zlib.inflateRawSync], gzip: [zlib.createGzip, zlib.createGunzip, zlib.gunzipSync] };
  let ok = 0;
  const count = 60;
  for (let n = 0; n < count; n++) {
    const format = ['deflate', 'raw', 'gzip'][random.below(3)];
    const options = { level: random.below(11) - 1, strategy: random.below(3) ? 0 : random.below(5), memLevel: 1 + random.below(9), windowBits: 9 + random.below(7), chunkSize: [64, 100, 1024, 16384][random.below(4)] };
    if (format !== 'gzip' && random.below(4) === 0) options.dictionary = input('text', 1 + random.below(40000), n);
    const source = input(['text', 'json', 'random', 'runs', 'mixed', 'binary'][random.below(6)], random.below(5) ? random.below(30000) : random.below(250000), n);
    const parts = [];
    for (let at = 0; at < source.length;) {
      const size = Math.min(source.length - at, 1 + random.below([4, 500, 20000, 100000][random.below(4)]));
      parts.push(source.subarray(at, at + size)); at += size;
      if (random.below(5) === 0) parts.push({ flush: [C.Z_NO_FLUSH, C.Z_PARTIAL_FLUSH, C.Z_SYNC_FLUSH, C.Z_FULL_FLUSH, C.Z_BLOCK][random.below(5)] });
      if (random.below(12) === 0) parts.push({ params: [random.below(10), random.below(5)] });
    }
    const [make, unmake, decodeSync] = makers[format];
    const packed = await drive(make(options), parts);
    if (packed.error) { out.push(`roundtrip ${n} ${JSON.stringify(describe(packed.error))}`); continue; }
    const all = Buffer.concat(packed.chunks);
    const readOptions = { windowBits: random.below(2) ? 15 : options.windowBits, chunkSize: [64, 333, 16384][random.below(3)], dictionary: options.dictionary };
    const pieces = [];
    for (let at = 0; at < all.length;) { const size = Math.min(all.length - at, 1 + pieceRandom.below([3, 300, 70000][pieceRandom.below(3)])); pieces.push(all.subarray(at, at + size)); at += size; }
    const back = await drive(unmake(readOptions), pieces);
    const whole = decodeSync(all, readOptions);
    if (!back.error && Buffer.concat(back.chunks).equals(source) && whole.equals(source)) ok++;
    else out.push(`roundtrip ${n} differs ${JSON.stringify([options.level, options.strategy, format, describe(back.error)])}`);
  }
  out.push(`roundtrips ${ok} of ${count}`);

  // Damaged streams: one line per stream with how often each outcome came.
  for (const [name, decode, options] of [['gzip', zlib.gunzipSync], ['zlib', zlib.inflateSync], ['raw', zlib.inflateRawSync], ['zlib', zlib.unzipSync], ['gzip', zlib.unzipSync], ['window15', zlib.inflateSync], ['window9', zlib.inflateSync, { windowBits: 9 }],
    ['zlibDictionary', zlib.inflateSync, { dictionary: Buffer.from(streams.dictionary, 'base64') }], ['rawDictionary', zlib.inflateRawSync, { dictionary: Buffer.from(streams.dictionary, 'base64') }], ['stored', zlib.inflateRawSync], ['fixed', zlib.inflateRawSync]]) {
    const good = Buffer.from(streams[name], 'base64'), tally = {};
    let digests = '';
    for (let n = 0; n < 400; n++) {
      let bad = Buffer.from(good);
      const kind = damageRandom.below(6);
      if (kind === 0) bad[damageRandom.below(bad.length)] ^= 1 << damageRandom.below(8);
      else if (kind === 1) { for (let k = 1 + damageRandom.below(4); k > 0; k--) bad[damageRandom.below(bad.length)] = damageRandom() & 255; }
      else if (kind === 2) bad = bad.subarray(0, damageRandom.below(bad.length));
      else if (kind === 3) { const at = damageRandom.below(bad.length); bad = Buffer.concat([bad.subarray(0, at), Buffer.from([damageRandom() & 255]), bad.subarray(at)]); }
      else if (kind === 4) { const at = damageRandom.below(bad.length); bad = Buffer.concat([bad.subarray(0, at), bad.subarray(at + 1 + damageRandom.below(3))]); }
      else bad[Math.min(bad.length - 1, damageRandom.below(24))] ^= 1 << damageRandom.below(8);
      let outcome;
      try { const value = decode(bad, options); outcome = 'decoded'; digests = digest(Buffer.from(digests + digest(value))); }
      catch (error) { outcome = `${error.code}: ${error.message}`; }
      tally[outcome] = (tally[outcome] || 0) + 1;
    }
    out.push(`damaged ${name} ${decode.name} ${JSON.stringify(Object.entries(tally).sort())} ${digests}`);
  }
  console.log(out.join('\n'));
}
main();
