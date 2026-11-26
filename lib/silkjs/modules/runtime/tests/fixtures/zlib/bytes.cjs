'use strict';
// The compressed bytes of node:zlib over a matrix of options, inputs, chunk sizes, flushes,
// parameter changes and resets: one line per case with a digest of the bytes and of the lengths
// of the chunks a stream emitted. The bytes must be Node 24's, whose zlib is Chromium's: a case
// of tests/compat.mjs, which compares the lines with the reference Node's.
const zlib = require('node:zlib');
const { generator, input, digest, drive } = require('./common.cjs');
const C = zlib.constants;

async function collect() {
  const lines = [];
  const add = (name, bytes, chunks) => {
    lines.push(`${name} ${bytes.length} ${digest(bytes)}${chunks ? ' ' + digest(Buffer.from(chunks.map((c) => c.length).join(','))) : ''}`);
  };
  const inputs = {
    text: input('text', 200000), json: input('json', 150000), random: input('random', 70000),
    runs: input('runs', 100000), mixed: input('mixed', 300000), binary: input('binary', 180000),
    empty: Buffer.alloc(0), one: Buffer.from('a'), three: Buffer.from('abc'), short: Buffer.from('hello hello hello'),
  };
  const formats = { deflate: zlib.deflateSync, raw: zlib.deflateRawSync, gzip: zlib.gzipSync };
  const streams = { deflate: zlib.createDeflate, raw: zlib.createDeflateRaw, gzip: zlib.createGzip };

  // One call, every level.
  for (const [kind, bytes] of Object.entries(inputs)) for (const [format, encode] of Object.entries(formats)) for (let level = -1; level <= 9; level++) {
    add(`sync ${format} level=${level} ${kind}`, encode(bytes, { level }));
  }
  // Strategies.
  for (const kind of ['text', 'runs', 'binary', 'random']) for (const [format, encode] of Object.entries(formats)) for (const level of [1, 6, 9]) for (let strategy = 1; strategy <= 4; strategy++) {
    add(`sync ${format} level=${level} strategy=${strategy} ${kind}`, encode(inputs[kind], { level, strategy }));
  }
  // Window and memory.
  for (const kind of ['mixed', 'json']) for (const [format, encode] of Object.entries(formats)) for (const windowBits of [8, 9, 11, 13, 15]) for (const memLevel of [1, 4, 8, 9]) for (const level of [1, 6]) {
    if (windowBits === 8 && format !== 'deflate') continue;
    add(`sync ${format} level=${level} windowBits=${windowBits} memLevel=${memLevel} ${kind}`, encode(inputs[kind], { level, windowBits, memLevel }));
  }
  // Preset dictionaries, shorter and longer than the window.
  for (const [name, dictionary] of [['small', input('text', 900, 7)], ['large', input('json', 50000, 9)]]) for (const format of ['deflate', 'raw']) for (const level of [0, 1, 6, 9]) for (const windowBits of [10, 15]) {
    add(`sync ${format} level=${level} windowBits=${windowBits} dictionary=${name}`, formats[format](inputs.json, { level, windowBits, dictionary }));
  }
  // The output chunk size: stored blocks of level 0 take their lengths from it.
  for (const [format, encode] of Object.entries(formats)) for (const level of [0, 1, 6]) for (const chunkSize of [64, 100, 1000, 4096, 70000]) for (const kind of ['text', 'random', 'short']) {
    add(`sync ${format} level=${level} chunkSize=${chunkSize} ${kind}`, encode(inputs[kind], { level, chunkSize }));
  }
  // finishFlush other than Z_FINISH: a stream with no end.
  for (const finishFlush of [C.Z_SYNC_FLUSH, C.Z_FULL_FLUSH, C.Z_PARTIAL_FLUSH, C.Z_BLOCK]) for (const level of [0, 6]) {
    add(`sync raw level=${level} finishFlush=${finishFlush}`, zlib.deflateRawSync(inputs.text, { level, finishFlush }));
  }

  // Streams: writes of many sizes with flushes between them.
  const random = generator(20261115);
  for (let n = 0; n < 160; n++) {
    const format = ['deflate', 'raw', 'gzip'][random.below(3)];
    const level = random.below(11) - 1, strategy = random.below(3) ? 0 : random.below(5);
    const memLevel = random.below(3) ? 8 : 1 + random.below(9), windowBits = random.below(3) ? 15 : 9 + random.below(7);
    const chunkSize = [64, 77, 256, 1024, 16384, 16384, 65536][random.below(7)];
    const kind = ['text', 'json', 'random', 'runs', 'mixed', 'binary'][random.below(6)];
    const source = inputs[kind].subarray(0, random.below(4) ? random.below(60000) : inputs[kind].length);
    const parts = [];
    let at = 0;
    while (at < source.length) {
      const size = Math.min(source.length - at, [1, 3, 100, 1000, 5000, 40000][random.below(6)] + random.below(50));
      parts.push(source.subarray(at, at + size));
      at += size;
      if (random.below(4) === 0) parts.push({ flush: [C.Z_SYNC_FLUSH, C.Z_FULL_FLUSH, C.Z_PARTIAL_FLUSH, C.Z_BLOCK, C.Z_NO_FLUSH][random.below(5)] });
      if (random.below(9) === 0) parts.push({ params: [random.below(10), random.below(2) ? strategy : random.below(5)] });
    }
    const options = { level, strategy, memLevel, windowBits, chunkSize };
    if (format !== 'gzip' && random.below(6) === 0) options.dictionary = input('text', 1 + random.below(3000), n);
    const { chunks, error } = await drive(streams[format](options), parts);
    if (error) throw error;
    add(`stream ${n} ${format} ${JSON.stringify({ level, strategy, memLevel, windowBits, chunkSize, kind, size: source.length, dictionary: options.dictionary ? options.dictionary.length : 0 })}`, Buffer.concat(chunks), chunks);
  }
  // Every change of level and strategy, after data.
  for (const [from, to] of [[6, 0], [0, 6], [0, 1], [1, 9], [9, 1], [3, 4], [4, 5], [6, 6], [0, 0], [9, 0]]) for (const [strategyFrom, strategyTo] of [[0, 0], [0, 3], [3, 0], [2, 1], [1, 4]]) {
    const stream = zlib.createDeflateRaw({ level: from, strategy: strategyFrom });
    const { chunks, error } = await drive(stream, [inputs.mixed.subarray(0, 90000), { params: [to, strategyTo] }, inputs.mixed.subarray(90000, 200000), { flush: C.Z_SYNC_FLUSH }, { params: [from, strategyFrom] }, inputs.text.subarray(0, 50000)]);
    if (error) throw error;
    add(`params ${from},${strategyFrom} -> ${to},${strategyTo}`, Buffer.concat(chunks), chunks);
  }
  // A reset starts a new stream in the same handle; what the window held before can show.
  for (const format of ['deflate', 'raw', 'gzip']) for (const level of [0, 1, 6, 9]) {
    const stream = streams[format]({ level });
    const { chunks, error } = await drive(stream, [inputs.binary, { flush: C.Z_FULL_FLUSH }, { reset: true }, inputs.short, { flush: C.Z_SYNC_FLUSH }, { reset: true }, inputs.text.subarray(0, 300)]);
    if (error) throw error;
    add(`reset ${format} level=${level}`, Buffer.concat(chunks), chunks);
  }
  // Checksums.
  for (const [kind, bytes] of Object.entries(inputs)) lines.push(`crc32 ${kind} ${zlib.crc32(bytes)} ${zlib.crc32(bytes, 0x12345678)}`);
  return lines;
}

module.exports = { collect };
if (require.main === module) collect().then((lines) => console.log(lines.join('\n')));
