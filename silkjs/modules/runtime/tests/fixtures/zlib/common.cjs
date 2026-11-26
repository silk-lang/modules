'use strict';
// Shared by the zlib fixtures: a fixed generator, the inputs, and collecting a stream.
const crypto = require('node:crypto');

function generator(seed) {
  let state = seed >>> 0 || 1;
  const next = () => {
    state ^= state << 13; state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5; state >>>= 0;
    return state;
  };
  next.below = (n) => (n > 0 ? next() % n : 0);
  return next;
}

const WORDS = ('the of and to in is that for it as was with be by on not this are or from at which but have an had they you were ' +
  'stream window buffer deflate block compress level memory function return const value object string number length index error').split(' ');

// kinds: text, json, random, runs, mixed, binary (small values with long repeats)
function input(kind, size, seed = 1) {
  const random = generator(seed * 2654435761 + kind.length);
  const out = Buffer.alloc(size);
  let at = 0;
  while (at < size) {
    const which = kind === 'mixed' ? ['text', 'json', 'random', 'runs', 'binary'][random.below(5)] : kind;
    const end = Math.min(size, at + (kind === 'mixed' ? 1 + random.below(6000) : size));
    if (which === 'text') {
      while (at < end) { const word = WORDS[random.below(WORDS.length)] + (random.below(12) ? ' ' : '.\n'); at += out.write(word, at, Math.min(word.length, end - at), 'latin1'); }
    } else if (which === 'json') {
      while (at < end) { const row = `{"id":${random.below(100000)},"name":"user${random.below(500)}","ok":${random.below(2) ? 'true' : 'false'},"tags":["a","b"]},`; at += out.write(row, at, Math.min(row.length, end - at), 'latin1'); }
    } else if (which === 'random') {
      while (at < end) out[at++] = random() & 255;
    } else if (which === 'runs') {
      while (at < end) { const byte = random() & 255, run = Math.min(end - at, 1 + random.below(random.below(4) ? 12 : 900)); out.fill(byte, at, at + run); at += run; }
    } else {
      while (at < end) {
        if (at > 16 && random.below(3)) { const back = 1 + random.below(Math.min(at, 40000)), run = Math.min(end - at, 3 + random.below(300)); for (let i = 0; i < run; i++) out[at + i] = out[at + i - back]; at += run; }
        else out[at++] = random() & 15;
      }
    }
  }
  return out;
}

function digest(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 24); }

// Writes `parts` (buffers, or {flush}, {params: [level, strategy]}, {reset: true}) to a zlib
// stream in order and resolves with the chunks it emitted.
function drive(stream, parts) {
  return new Promise((resolve) => {
    const chunks = [];
    let failure = null;
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', (error) => { failure = error; resolve({ chunks, error }); });
    stream.on('end', () => { if (!failure) resolve({ chunks, error: null }); });
    let index = 0;
    const step = () => {
      if (failure) return;
      if (index === parts.length) { stream.end(); return; }
      const part = parts[index++];
      // Each write is done before the next part starts, so the calls into zlib do not depend on timing.
      if (Buffer.isBuffer(part)) stream.write(part, () => setImmediate(step));
      else if (part.flush !== undefined) stream.flush(part.flush, step);
      else if (part.params) stream.params(part.params[0], part.params[1], step);
      else if (part.reset) { stream.reset(); setImmediate(step); }
      else step();
    };
    step();
  });
}

function describe(error) { return error ? [error.code, error.errno, error.message] : null; }

module.exports = { generator, input, digest, drive, describe };
