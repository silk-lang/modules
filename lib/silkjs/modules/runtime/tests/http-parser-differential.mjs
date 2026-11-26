// The HTTP/1 parser differential: node tests/http-parser-differential.mjs <runtime> <reference>.
// Runs tests/http-parser-cases.cjs under both runtimes: every event the parser reports (begin,
// head, header batches, body chunks, message complete, the bytes each execute consumed) and every
// error's code, reason and byte count must be the same. The reference is a runtime with llhttp
// (the executable); the runtime under test is one with another Http implementation (SilkHttp,
// cli/src/main_silk.silk). Both share the JavaScript above the parser, so a difference is the
// parser's.
import { spawnSync } from 'node:child_process';
const [runtime, reference] = process.argv.slice(2);
const cases = new URL('./http-parser-cases.cjs', import.meta.url).pathname;
const env = { ...process.env }; delete env.NODE_OPTIONS;
const run = bin => Object.fromEntries(spawnSync(bin, [cases], { env, encoding: 'utf8', maxBuffer: 1 << 26 }).stdout.trim().split('\n').filter(Boolean).map(l => { const v = JSON.parse(l); return [v.name, v]; }));
const expected = run(reference), got = run(runtime);
let failed = 0;
for (const [name, value] of Object.entries(expected)) {
  const a = JSON.stringify(value.events), b = JSON.stringify(got[name]?.events);
  if (a !== b) { failed++; console.log(`FAIL ${name}\n  expected ${a.slice(0, 600)}\n  got      ${String(b).slice(0, 600)}`); }
}
console.log(`${Object.keys(expected).length - failed} same, ${failed} different`);
if (failed || Object.keys(expected).length === 0) process.exit(1);
