// Zstandard through node:zlib: one case per process, so that the peak RSS is the case's own.
//
//   <runtime> zstd.cjs <case> <corpus-dir> [seconds]
//   <runtime> zstd.cjs list
//
// A case is `<operation>:<input>[:<level>]`:
//   c:<input>:<level>     zstdCompressSync at the level (also negative ones)
//   d:<input>:<level>     zstdDecompressSync of the frame made at the level
//   cs:<input>:<level>    createZstdCompress fed 1 KiB chunks
//   ds:<input>:<level>    createZstdDecompress fed 1 KiB chunks
//   ca:<input>:<level>    zstdCompress (thread pool), 4 at a time
//   da:<input>:<level>    zstdDecompress (thread pool), 4 at a time
//   http:<input>:<level>  a server answers with Content-Encoding: zstd, compressing each response;
//                         the client decodes it (ZSTD_FETCH=1: fetch() does)
// Inputs are <corpus-dir>/{text,json,random,binary}.bin. It prints one JSON line: the case, the
// megabytes of uncompressed data per second (median and best of the timed runs), the compressed
// size, and the peak RSS in MiB.
'use strict';
const zlib = require('node:zlib');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, Writable, pipeline } = require('node:stream');

const INPUTS = ['text', 'json', 'random', 'binary'];
const LEVELS = [-5, 1, 3, 9, 19];

function cases() {
  const out = [];
  for (const input of INPUTS) {
    for (const level of LEVELS) out.push(`c:${input}:${level}`);
    for (const level of [1, 3, 19]) out.push(`d:${input}:${level}`);
    out.push(`cs:${input}:3`, `ds:${input}:3`);
  }
  out.push('ca:text:3', 'da:text:3', 'ca:binary:1', 'da:binary:1', 'http:json:3', 'http:text:3');
  return out;
}

// ZSTD_CHUNK sets the chunkSize of the one-shot calls: the runtime's binding costs about 2 ms per
// output chunk (ZSTD_NOTES.md), which hides the codec at the default 16 KiB.
const CHUNK = process.env.ZSTD_CHUNK ? { chunkSize: Number(process.env.ZSTD_CHUNK) } : {};

function params(level) {
  return { params: { [zlib.constants.ZSTD_c_compressionLevel]: level }, ...CHUNK };
}

function chunked(buffer, size) {
  let at = 0;
  return new Readable({
    read() {
      if (at >= buffer.length) { this.push(null); return; }
      this.push(buffer.subarray(at, Math.min(buffer.length, at + size)));
      at += size;
    },
  });
}

function through(source, transform) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const sink = new Writable({ write(chunk, _encoding, done) { total += chunk.length; done(); } });
    pipeline(source, transform, sink, (error) => (error ? reject(error) : resolve(total)));
  });
}

async function http(data, level, seconds) {
  const http = require('node:http');
  const server = http.createServer((_request, response) => {
    const body = zlib.zstdCompressSync(data, params(level));
    response.writeHead(200, { 'content-encoding': 'zstd', 'content-length': body.length, 'content-type': 'application/octet-stream' });
    response.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const samples = [];
  const deadline = Date.now() + seconds * 1000;
  let compressed = 0;
  // With ZSTD_FETCH=1 the client is fetch(), which decodes the body itself; otherwise http.get
  // piped through createZstdDecompress, which builds without fetch's decoding have too.
  const viaFetch = process.env.ZSTD_FETCH === '1';
  const get = () => new Promise((resolve, reject) => {
    http.get(url, (response) => {
      compressed = Number(response.headers['content-length']);
      const chunks = [];
      const decoder = zlib.createZstdDecompress();
      decoder.on('data', (chunk) => chunks.push(chunk));
      decoder.on('end', () => resolve(Buffer.concat(chunks)));
      decoder.on('error', reject);
      response.pipe(decoder);
    }).on('error', reject);
  });
  while (Date.now() < deadline || samples.length < 3) {
    const start = process.hrtime.bigint();
    let body;
    if (viaFetch) {
      const response = await fetch(url);
      body = Buffer.from(await response.arrayBuffer());
      compressed = Number(response.headers.get('content-length'));
    } else {
      body = await get();
    }
    samples.push(Number(process.hrtime.bigint() - start) / 1e6);
    if (!body.equals(data)) throw new Error('the decoded response is not the body');
  }
  server.close();
  return { samples, compressed };
}

async function main() {
  const [name, corpus, secondsText] = process.argv.slice(2);
  if (name === 'list') { console.log(cases().join('\n')); return; }
  const seconds = Number(secondsText || 2);
  const [operation, input, levelText] = name.split(':');
  const level = Number(levelText || 3);
  // The whole binary corpus is 32 MiB; a slice keeps level 19 and the streams within seconds.
  let data = fs.readFileSync(path.join(corpus, `${input}.bin`));
  const limit = (operation === 'c' && level >= 19) || operation === 'cs' || operation === 'ds' || operation === 'http' ? 4 << 20 : 16 << 20;
  if (data.length > limit) data = data.subarray(0, limit);
  let samples = [];
  let compressed = 0;
  if (operation === 'http') {
    ({ samples, compressed } = await http(data.subarray(0, 1 << 20), level, seconds));
    data = data.subarray(0, 1 << 20);
  } else {
    const frame = zlib.zstdCompressSync(data, params(level));
    compressed = frame.length;
    const run = {
      c: () => zlib.zstdCompressSync(data, params(level)).length,
      d: () => zlib.zstdDecompressSync(frame, CHUNK).length,
      cs: () => through(chunked(data, 1024), zlib.createZstdCompress(params(level))),
      ds: () => through(chunked(frame, 1024), zlib.createZstdDecompress(CHUNK)),
      ca: () => Promise.all([0, 1, 2, 3].map(() => new Promise((resolve, reject) => zlib.zstdCompress(data, params(level), (error, out) => (error ? reject(error) : resolve(out.length)))))).then((sizes) => sizes[0]),
      da: () => Promise.all([0, 1, 2, 3].map(() => new Promise((resolve, reject) => zlib.zstdDecompress(frame, CHUNK, (error, out) => (error ? reject(error) : resolve(out.length)))))).then((sizes) => sizes[0]),
    }[operation];
    if (!run) throw new Error(`unknown case ${name}`);
    // A stream does not know the size of its input, so its frame is not the one-shot frame;
    // every run of a case must give the same size.
    let expected = operation[0] === 'c' ? (operation === 'c' ? compressed : 0) : data.length;
    const deadline = Date.now() + seconds * 1000;
    while (Date.now() < deadline || samples.length < 3) {
      const start = process.hrtime.bigint();
      const size = await run();
      samples.push(Number(process.hrtime.bigint() - start) / 1e6);
      if (expected === 0) { expected = size; compressed = size; }
      if (size !== expected) throw new Error(`${name}: got ${size} bytes, expected ${expected}`);
      if (samples.length >= 200) break;
    }
  }
  samples.sort((a, b) => a - b);
  const jobs = operation === 'ca' || operation === 'da' ? 4 : 1;
  const megabytes = (data.length * jobs) / 1e6;
  const median = samples[samples.length >> 1];
  console.log(JSON.stringify({
    case: name,
    bytes: data.length,
    compressed,
    runs: samples.length,
    medianMBps: +(megabytes / (median / 1000)).toFixed(1),
    bestMBps: +(megabytes / (samples[0] / 1000)).toFixed(1),
    peakRssMiB: +(process.resourceUsage().maxRSS / 1024).toFixed(1),
  }));
}

main().catch((error) => { console.error(error); process.exit(1); });
