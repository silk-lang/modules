// Comparing ropes (strings built by concatenation) with each other and with flat
// strings: equality, ordering, wide leaves and leaf boundaries that do not line up.
const r = [];
function rope(parts) { let s = ''; for (const p of parts) s += p; return s; }
const chunk = 'the quick brown fox jumps over the lazy dog, ';
const partsA = [], partsB = [];
for (let i = 0; i < 400; i++) partsA.push(chunk + i);
for (let i = 0; i < 400; i++) { const t = chunk + i; partsB.push(t.slice(0, 7), t.slice(7)); }
const a = rope(partsA), b = rope(partsB), flat = partsA.join('');
r.push(a === b, a === flat, b === flat, a == b, a !== b, a < b, a > b, a <= b);
r.push(a + 'x' === b + 'x', a + 'x' === b + 'y', a + 'x' < b + 'y', a + 'y' > b + 'x');
r.push((a + 'x').length === (b + 'y').length);
// A difference in the middle, on and off a word boundary.
const c = rope(partsA.map((p, i) => (i === 200 ? p.replace('quick', 'quicK') : p)));
r.push(a === c, a < c, a > c, c < a, [a, c, b].sort()[0] === c);
// A prefix.
const shorter = rope(partsA.slice(0, 399));
r.push(shorter === a, shorter < a, a < shorter, shorter + partsA[399] === a);
// Wide leaves, alone and mixed with Latin-1 ones.
const w1 = rope(partsA.map((p, i) => (i % 50 === 0 ? p + '中文' : p)));
const w2 = rope(partsB.map((p, i) => (i % 100 === 1 ? p + '中文' : p)));
r.push(w1 === w2, w1 < w2, w1 + 'é' === w2 + 'é', w1 + '中' < w2 + '丮', w1 === a);
// Empty leaves and short ropes.
r.push(rope(['', 'a', '', 'b']) === 'ab', rope(['a', 'b']) < rope(['a', '', 'c']), rope(['ab']) > rope(['a', 'a']));
// As Map keys and in switch.
const map = new Map([[a, 1]]);
r.push(map.get(b), map.has(c));
switch (b) { case c: r.push('c'); break; case a: r.push('a'); break; default: r.push('none'); }
const got = r.join('|');
const expected = 'true|true|true|true|false|false|false|true|true|false|true|true|true|false|false|true|true|true|'
  + 'false|true|false|true|true|false|true|true|false|true|true|true|1|false|a';
console.log(got === expected ? 'PASS rope compare' : 'FAIL ' + got);
if (got !== expected) throw new Error('rope comparison regressions');
