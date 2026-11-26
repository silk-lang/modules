// The crypto differential: node tests/crypto-differential.mjs <runtime>. Runs
// tests/crypto-cases.cjs under Node and the runtime: every digest, MAC, derived key, ciphertext,
// tag, cipher description and error (code and message) must be Node's. For SilkCrypto
// (cli/src/main_silk.silk), crypto over silk.crypto.
import { spawnSync } from 'node:child_process';
const [runtime] = process.argv.slice(2);
const cases = new URL('./crypto-cases.cjs', import.meta.url).pathname;
const env = { ...process.env }; delete env.NODE_OPTIONS;
const run = bin => {
  const ran = spawnSync(bin, [cases], { env, encoding: 'utf8', maxBuffer: 1 << 28 });
  // A runtime that dies prints no case at all, so say how it ended.
  if (ran.status !== 0) console.log(`${bin} ended with status ${ran.status}, signal ${ran.signal}\n${ran.stderr.slice(-4000)}`);
  return Object.fromEntries(ran.stdout.trim().split('\n').filter(Boolean).map(l => { const v = JSON.parse(l); return [v.name, v]; }));
};
const node = run(process.execPath), them = run(runtime);
let failed = 0;
for (const [name, expected] of Object.entries(node)) {
  const a = JSON.stringify(expected), b = JSON.stringify(them[name]);
  if (a !== b) { failed++; console.log(`FAIL ${name}\n  node ${a.slice(0, 300)}\n  got  ${String(b).slice(0, 300)}`); }
}
console.log(`${Object.keys(node).length - failed} same, ${failed} different`);
if (failed || Object.keys(node).length === 0) process.exit(1);
