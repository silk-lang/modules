// Prints one JSON line per case: what a runtime's zlib decodes, how it fails, and (as base64)
// what it compresses, for tests/compression-differential.mjs to compare with Node's.
const zlib = require('zlib');
const out = [];
const text = Buffer.from('The quick brown fox jumps over the lazy dog. '.repeat(200) + 'tail');
const random = Buffer.alloc(70000); let seed = 7; for (let i = 0; i < random.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; random[i] = seed >>> 24; }
const inputs = { empty: Buffer.alloc(0), small: Buffer.from('hello'), text, random };
function record(name, fn) {
  try { const r = fn(); out.push({ name, ...r }); }
  catch (e) { out.push({ name, error: { code: e.code, errno: e.errno, message: e.message } }); }
}
const hash = b => require('crypto').createHash('sha256').update(b).digest('hex').slice(0, 16);
const pairs = [['deflateSync', 'inflateSync'], ['gzipSync', 'gunzipSync'], ['deflateRawSync', 'inflateRawSync'],
  ['brotliCompressSync', 'brotliDecompressSync'], ['zstdCompressSync', 'zstdDecompressSync']];
for (const [c, d] of pairs) for (const [label, input] of Object.entries(inputs)) {
  record(`${c} ${label}`, () => { const z = zlib[c](input); return { compressed: z.toString('base64'), back: hash(zlib[d](z)) }; });
}
for (const level of [0, 1, 6, 9]) for (const strategy of [0, 1, 2, 3, 4])
  record(`deflate level ${level} strategy ${strategy}`, () => { const z = zlib.deflateSync(text, { level, strategy }); return { compressed: z.toString('base64'), back: hash(zlib.inflateSync(z)) }; });
for (const windowBits of [9, 12, 15]) for (const memLevel of [1, 8, 9])
  record(`deflate window ${windowBits} mem ${memLevel}`, () => { const z = zlib.deflateSync(random, { windowBits, memLevel }); return { compressed: z.toString('base64'), back: hash(zlib.inflateSync(z)) }; });
record('unzip gzip', () => ({ back: hash(zlib.unzipSync(zlib.gzipSync(text))) }));
record('unzip zlib', () => ({ back: hash(zlib.unzipSync(zlib.deflateSync(text))) }));
record('gunzip two members', () => ({ back: hash(zlib.gunzipSync(Buffer.concat([zlib.gzipSync(text), zlib.gzipSync(inputs.small)]))) }));
record('gunzip trailing zeros', () => ({ back: hash(zlib.gunzipSync(Buffer.concat([zlib.gzipSync(text), Buffer.alloc(10)]))) }));
record('gunzip trailing garbage', () => ({ back: hash(zlib.gunzipSync(Buffer.concat([zlib.gzipSync(text), Buffer.from('garbage')]))) }));
record('inflate trailing data', () => ({ back: hash(zlib.inflateSync(Buffer.concat([zlib.deflateSync(text), Buffer.from('xyz')]))) }));
record('inflate garbage', () => ({ back: hash(zlib.inflateSync(Buffer.from('this is not deflate'))) }));
record('gunzip garbage', () => ({ back: hash(zlib.gunzipSync(Buffer.from('this is not gzip at all'))) }));
record('inflateRaw garbage', () => ({ back: hash(zlib.inflateRawSync(Buffer.from([0xff, 0xff, 0xff, 0xff]))) }));
record('inflate truncated', () => ({ back: hash(zlib.inflateSync(zlib.deflateSync(text).subarray(0, 50))) }));
record('gunzip truncated', () => ({ back: hash(zlib.gunzipSync(zlib.gzipSync(text).subarray(0, 50))) }));
record('gunzip bad crc', () => { const z = zlib.gzipSync(text); z[z.length - 6] ^= 1; return { back: hash(zlib.gunzipSync(z)) }; });
record('inflate bad adler', () => { const z = zlib.deflateSync(text); z[z.length - 1] ^= 1; return { back: hash(zlib.inflateSync(z)) }; });
const dictionary = Buffer.from('fox jumps over the lazy dog quick brown');
record('deflate dictionary', () => { const z = zlib.deflateSync(text, { dictionary }); return { compressed: z.toString('base64'), back: hash(zlib.inflateSync(z, { dictionary })) }; });
record('deflateRaw dictionary', () => { const z = zlib.deflateRawSync(text, { dictionary }); return { compressed: z.toString('base64'), back: hash(zlib.inflateRawSync(z, { dictionary })) }; });
record('inflate missing dictionary', () => ({ back: hash(zlib.inflateSync(zlib.deflateSync(text, { dictionary }))) }));
record('inflate wrong dictionary', () => ({ back: hash(zlib.inflateSync(zlib.deflateSync(text, { dictionary }), { dictionary: Buffer.from('other') })) }));
for (const quality of [0, 5, 11]) record(`brotli quality ${quality}`, () => { const z = zlib.brotliCompressSync(text, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: quality } }); return { compressed: z.toString('base64'), back: hash(zlib.brotliDecompressSync(z)) }; });
record('brotli garbage', () => ({ back: hash(zlib.brotliDecompressSync(Buffer.from('not brotli data here at all, sorry'))) }));
record('brotli truncated', () => ({ back: hash(zlib.brotliDecompressSync(zlib.brotliCompressSync(random).subarray(0, 100))) }));
for (const level of [1, 3, 19]) record(`zstd level ${level}`, () => { const z = zlib.zstdCompressSync(text, { params: { [zlib.constants.ZSTD_c_compressionLevel]: level } }); return { compressed: z.toString('base64'), back: hash(zlib.zstdDecompressSync(z)) }; });
record('zstd checksum', () => { const z = zlib.zstdCompressSync(text, { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }); return { compressed: z.toString('base64'), back: hash(zlib.zstdDecompressSync(z)) }; });
record('zstd pledged', () => { const z = zlib.zstdCompressSync(text, { pledgedSrcSize: text.length }); return { compressed: z.toString('base64'), back: hash(zlib.zstdDecompressSync(z)) }; });
record('zstd pledged wrong', () => ({ compressed: zlib.zstdCompressSync(text, { pledgedSrcSize: 5 }).toString('base64') }));
record('zstd garbage', () => ({ back: hash(zlib.zstdDecompressSync(Buffer.from('not zstd data at all'))) }));
record('zstd two frames', () => ({ back: hash(zlib.zstdDecompressSync(Buffer.concat([zlib.zstdCompressSync(text), zlib.zstdCompressSync(inputs.small)]))) }));
record('zstd truncated', () => ({ back: hash(zlib.zstdDecompressSync(zlib.zstdCompressSync(random).subarray(0, 100))) }));
record('crc32', () => ({ value: zlib.crc32(text) + ':' + zlib.crc32('abc', 7) }));
record('versions', () => ({ value: typeof process.versions.zlib + typeof process.versions.brotli + typeof process.versions.zstd }));

// Streams: chunked writes, flushes, params, reset, and the async path.
function stream(name, make, chunks, finish) {
  return new Promise(resolve => {
    const s = make(); const parts = []; const flushes = [];
    s.on('data', d => parts.push(d)); s.on('error', e => { out.push({ name, error: { code: e.code, errno: e.errno, message: e.message } }); resolve(); });
    s.on('end', () => { const all = Buffer.concat(parts); out.push({ name, ...finish(all, flushes) }); resolve(); });
    (async () => { for (const c of chunks) { if (c === 'flush') { await new Promise(r => s.flush(zlib.constants.Z_SYNC_FLUSH, r)); flushes.push(Buffer.concat(parts).length > 0); } else if (c === 'params') { await new Promise(r => s.params(9, 1, r)); } else s.write(c); } s.end(); })();
  });
}
const pieces = [text.subarray(0, 1000), 'flush', text.subarray(1000, 5000), 'params', text.subarray(5000)];
(async () => {
  await stream('deflate stream', () => zlib.createDeflate(), pieces, (all, flushes) => ({ back: hash(zlib.inflateSync(all)), flushes }));
  await stream('gzip stream', () => zlib.createGzip(), pieces, (all, flushes) => ({ back: hash(zlib.gunzipSync(all)), flushes }));
  const z = zlib.gzipSync(text);
  await stream('gunzip byte by byte', () => zlib.createGunzip(), Array.from(z.subarray(0, 300), b => Buffer.from([b])).concat([z.subarray(300)]), all => ({ back: hash(all) }));
  const u = zlib.deflateSync(text);
  await stream('unzip byte by byte', () => zlib.createUnzip(), Array.from(u.subarray(0, 5), b => Buffer.from([b])).concat([u.subarray(5)]), all => ({ back: hash(all) }));
  await stream('brotli stream', () => zlib.createBrotliCompress(), [text.subarray(0, 3000), text.subarray(3000)], all => ({ back: hash(zlib.brotliDecompressSync(all)) }));
  await stream('zstd stream', () => zlib.createZstdCompress(), [text.subarray(0, 3000), text.subarray(3000)], all => ({ back: hash(zlib.zstdDecompressSync(all)) }));
  await stream('inflate stream garbage', () => zlib.createInflate(), [Buffer.from('garbage data')], all => ({ back: hash(all) }));
  await new Promise(r => zlib.gzip(random, (e, z) => zlib.gunzip(z, (e2, b) => { out.push({ name: 'async gzip', back: hash(b), error: e || e2 ? String(e || e2) : undefined }); r(); })));
  await new Promise(r => zlib.brotliCompress(text, (e, z) => zlib.brotliDecompress(z, (e2, b) => { out.push({ name: 'async brotli', back: hash(b) }); r(); })));
  const reset = zlib.createDeflate(); reset.reset(); reset.end(text); out.push({ name: 'reset', back: hash(zlib.inflateSync(Buffer.concat(await reset.toArray()))) });
  const web = await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  out.push({ name: 'CompressionStream gzip', back: hash(zlib.gunzipSync(Buffer.from(web))) });
  const plain = await new Response(new Blob([zlib.deflateRawSync(text)]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
  out.push({ name: 'DecompressionStream deflate-raw', back: hash(Buffer.from(plain)) });
  for (const line of out) console.log(JSON.stringify(line));
})();
