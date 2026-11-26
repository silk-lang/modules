import assert from "node:assert/strict";
import test from "node:test";
import { TextEncoder as Encoder, TextDecoder as Decoder } from "../src/dev-encoding.js";

test("dev UTF-8 encoding agrees with the host, including partial destinations and lone surrogates", () => {
  for (const text of ["", "ASCII\0", "é漢😀", "\ud800", "a\udfffz", "\ud800\ud800\udc00", "\ufeffstart"]) {
    const expected = new TextEncoder().encode(text);
    assert.deepEqual(new Encoder().encode(text), expected);
    for (let size = 0; size <= expected.length + 2; size++) {
      const actual = new Uint8Array(size).fill(42), oracle = new Uint8Array(size).fill(42);
      assert.deepEqual(new Encoder().encodeInto(text, actual), new TextEncoder().encodeInto(text, oracle));
      assert.deepEqual(actual, oracle);
    }
  }
});

test("dev UTF-8 decoding agrees with the host on invalid bytes, streaming and BOM options", () => {
  const fixtures = [[], [0xef, 0xbb, 0xbf, 65], [65, 0xef, 0xbb, 0xbf], [0xf0, 0x9f, 0x98, 0x80],
    [0xc0, 0x80], [0xe0, 0x80, 0x80], [0xed, 0xa0, 0x80], [0xf4, 0x90, 0x80, 0x80],
    [0xe2, 65, 0x80], [0xf0, 0x9f], [0xff, 0xfe, 65]];
  let seed = 12345;
  for (let index = 0; index < 200; index++) {
    fixtures.push(Array.from({ length: 12 }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; }));
  }
  const outcome = (decoder, bytes, split) => {
    try { return { text: decoder.decode(bytes.subarray(0, split), { stream: true }) + decoder.decode(bytes.subarray(split)) }; }
    catch (error) { return { error: error.name }; }
  };
  for (const fixture of fixtures) {
    const bytes = Uint8Array.from(fixture);
    for (const fatal of [false, true]) for (const ignoreBOM of [false, true]) {
      const options = { fatal, ignoreBOM };
      for (let split = 0; split <= bytes.length; split++) {
        assert.deepEqual(outcome(new Decoder("utf-8", options), bytes, split), outcome(new TextDecoder("utf-8", options), bytes, split), JSON.stringify({ fixture, split, options }));
      }
    }
  }
});

test("dev decoder respects view bounds, resets between messages and rejects unsupported encodings", () => {
  const bytes = new Uint8Array([88, 0xc3, 0xa9, 89]);
  const decoder = new Decoder();
  assert.equal(decoder.decode(new DataView(bytes.buffer, 1, 2)), "é");
  assert.equal(decoder.decode(new Uint8Array([0xef, 0xbb, 0xbf, 65])), "A");
  assert.equal(decoder.decode(new Uint8Array([0xef, 0xbb, 0xbf, 66])), "B");
  assert.equal(decoder.decode(new Uint8Array([0xe2]), { stream: true }), "");
  assert.equal(decoder.decode(), "�");
  assert.equal(decoder.encoding, "utf-8");
  assert.equal(new Decoder(" UTF8 ", { fatal: true, ignoreBOM: true }).fatal, true);
  assert.equal(new Decoder("UTF-8", { ignoreBOM: true }).ignoreBOM, true);
  assert.equal(new Decoder("unicode11utf8", null).decode(bytes.subarray(1, 3), null), "é");
  assert.throws(() => new Decoder("windows-1252"), RangeError);
  assert.throws(() => decoder.decode([65]), TypeError);
});
