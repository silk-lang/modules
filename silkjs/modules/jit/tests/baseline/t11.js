function risky(n) { if (n % 7 == 3) throw new RangeError('r' + n); return n * 2; }
function guarded(n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    try { s += risky(i); } catch (e) { s -= e.message.length; }
  }
  return s;
}
function nested(n) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    try {
      try { s += risky(i); if (i % 5 == 0) throw 'five'; }
      catch (e) { if (typeof e == 'string') throw e + '!'; s -= 1; }
    } catch (f) { s += f.length; } finally { s += 1; }
  }
  return s;
}
function kinds(a, b) { var s = 0; if (a === b) s += 1; if (a !== b) s += 2; if (a == b) s += 4; if (a != b) s += 8; return s + (a === b ? 16 : 32); }
function mixed() {
  var vals = [1, 1.5, 'a', 'ab', 'a' + 'b', null, undefined, true, false, 0, -0, NaN, {}, [], 2n, 2];
  var s = 0;
  for (var i = 0; i < vals.length; i++) for (var j = 0; j < vals.length; j++) s = (s * 31 + kinds(vals[i], vals[j])) % 1000003;
  return s;
}
function thrower(n) { for (var i = 0; i < n; i++) { if (i == n - 1) throw new Error('end ' + i); } }
function sw(x) { switch (x) { case 'a': return 1; case 'b': return 2; case 3: return 3; default: return 0; } }
var total = 0;
for (var k = 0; k < 60; k++) {
  total += guarded(50) + nested(40) + mixed();
  try { thrower(k + 1); } catch (e) { total += e.message.length; }
  total += sw('a') + sw('b') + sw(3) + sw({}) + sw('a' + 'b'.slice(1));
}
print(total);
