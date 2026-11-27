// truthiness of every kind, string lengths, Int and double mixes
function truth(v) { if (v) return 'T'; return 'F'; }
function keep(v) { return v || 'alt'; }
function both(a, b) { return (a && b) ? 1 : 0; }
function loop(v) { var n = 0; while (v) { n++; if (n > 2) v = v.slice ? v.slice(1) : 0; } return n; }
function len(s) { return s.length; }
function lenLocal(s) { var t = s; var n = t.length; return n + t.length + ('x' + s).length; }
function lenArg(a, b) { return a.length + b.length; }
function mix(a, b) { return [a + b, a - b, a * b, a / b, a < b, a <= b, a > b, a >= b, b + a, b - a, b * a].join(','); }
function acc(n) { var s = 2147483000; for (var i = 0; i < n; i++) s += i * 100; return s; }
function half(n) { var s = 0.5; for (var i = 0; i < n; i++) { s = s + i; s = i + s; s = s - 1; s = s * 2; if (s > 1e6) s = 1.5; if (i < s) s -= 0.25; } return s; }
var rope = 'abc' + String(Math.random()).slice(0, 0) + 'def';
var values = [0, 1, -1, '', 'a', null, undefined, {}, [], true, false, 0.0, -0.0, 0.5, NaN, rope, 'ab' + 'cd', function () {}, 1e300, Symbol.iterator, 10n, 0n];
var out = [];
for (var r = 0; r < 30; r++) {
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    out.push(truth(v), typeof keep(v), both(v, 1), both(1, v));
  }
  out.push(loop('abcdef'), loop(''), loop(0), len('hello' + r), len(rope), len([1, 2, 3]), len({ length: 'q' }), lenLocal('xy' + r), lenArg('abc', [1, 2]), lenArg(rope, 'z'),
    mix(r, 2.5), mix(1.5, r), mix(0.1, 0.2), mix(r, r + 1), mix(2147483647, 0.5), mix(-0.0, 0), mix(NaN, 1), mix(1e308, 10), acc(r * 50), half(r * 7));
}
print(out.join(' '));
