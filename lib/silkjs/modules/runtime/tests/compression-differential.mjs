// The compression differential: node tests/compression-differential.mjs <runtime>. Runs
// tests/compression-cases.cjs under Node (24 or later, for zstd) and the runtime: what each
// decodes, its flushes and its errors must be Node's, and whatever the runtime compresses must
// decode under Node to what Node's own output decodes to. Compressed bytes may differ (SilkCompression,
// cli/src/main_silk.silk, is not zlib), and so may the number of a brotli format error,
// which depends on where the decoder notices it: its code family and message must still match.
import { spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
const [runtime] = process.argv.slice(2);
const cases = new URL('./compression-cases.cjs', import.meta.url).pathname;
const env = { ...process.env }; delete env.NODE_OPTIONS;
const run = bin => Object.fromEntries(spawnSync(bin, [cases], { env, encoding: 'utf8', maxBuffer: 1 << 28 }).stdout.trim().split('\n').filter(Boolean).map(l => { const v = JSON.parse(l); return [v.name, v]; }));
const node = run(process.execPath), them = run(runtime);
const decoders = { deflateRaw: zlib.inflateRawSync, deflate: zlib.inflateSync, gzip: zlib.gunzipSync, brotli: zlib.brotliDecompressSync, zstd: zlib.zstdDecompressSync };
let failed = 0;
for (const [name, expected] of Object.entries(node)) {
  const got = them[name];
  const problems = [];
  if (!got) problems.push('missing');
  else {
    const brotliFormat = e => e && e.code?.startsWith('ERR__ERROR_FORMAT_') ? { family: 'ERR__ERROR_FORMAT_', message: e.message } : e;
    if (JSON.stringify(brotliFormat(expected.error)) !== JSON.stringify(brotliFormat(got.error))) problems.push(`error ${JSON.stringify(got.error)} vs node ${JSON.stringify(expected.error)}`);
    for (const key of ['back', 'value', 'flushes']) if (JSON.stringify(expected[key]) !== JSON.stringify(got[key])) problems.push(`${key} ${JSON.stringify(got[key])} vs node ${JSON.stringify(expected[key])}`);
    if (got.compressed && expected.compressed && got.compressed !== expected.compressed) {
      const kind = Object.keys(decoders).find(k => name.toLowerCase().startsWith(k.toLowerCase()));
      try {
        const a = decoders[kind](Buffer.from(got.compressed, 'base64'), name.includes('dictionary') ? { dictionary: Buffer.from('fox jumps over the lazy dog quick brown') } : {});
        const b = decoders[kind](Buffer.from(expected.compressed, 'base64'), name.includes('dictionary') ? { dictionary: Buffer.from('fox jumps over the lazy dog quick brown') } : {});
        if (!a.equals(b)) problems.push('compressed output decodes differently under node');
      } catch (e) { problems.push('node cannot decode its output: ' + e.message); }
    }
  }
  if (problems.length) { failed++; console.log(`FAIL ${name}: ${problems.join('; ')}`); }
}
console.log(`${Object.keys(node).length - failed} same, ${failed} different`);
if (failed || Object.keys(node).length === 0) process.exit(1);
