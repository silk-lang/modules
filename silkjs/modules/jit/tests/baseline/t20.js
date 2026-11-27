// Entering a running loop: each function here is called once or a few times and loops long.
function sum(n) { var s = 0; for (var i = 0; i < n; i++) { s = (s + i * 3) | 0; } return s; }
print("sum", sum(300000));
function nested(n, m) { var t = 0; for (var i = 0; i < n; i++) { for (var j = 0; j < m; j++) { t += (i ^ j) & 7; } } return t; }
print("nested", nested(600, 600));
function writes(a, b) { for (var i = 0; i < 200000; i++) { a = a + 1; if (b === undefined) b = 5; b = b + 2; } return a + ":" + b; }
print("writes", writes(1), writes(1, 2), writes(1, 2, 3));
function fewer(a, b, c) { var k = 0; for (var i = 0; i < 150000; i++) { if (c === undefined) k++; if (b === undefined) k += 2; } return k + String(a); }
print("fewer", fewer("x"), fewer("y", 1), fewer("z", 1, 2));
var outer = 7;
function reads(n) { var s = 0; for (var i = 0; i < n; i++) { s += outer; } outer = s & 15; return s; }
print("reads", reads(120000), outer);
var o = { k: 3, m: function (n) { var s = 0; for (var i = 0; i < n; i++) { s += this.k; } return s; } };
print("method", o.m(130000));
function catches(n) {
  var s = 0;
  try { for (var i = 0; i < n; i++) { s += i & 3; if (i === n - 5) throw new Error("inside " + s); } }
  catch (e) { return "caught " + e.message; }
  return "none";
}
print(catches(140000));
function escapes(n) { var s = 0; for (var i = 0; i < n; i++) { s += i & 3; if (i === n - 5) throw new Error("out " + s); } return s; }
try { escapes(140000); print("no throw"); } catch (e) { print("escaped", e.message); }
function wraps(n) { try { return escapes(n); } catch (e) { return "wrapped " + e.message; } finally { outer++; } }
print(wraps(90000), outer);
function over(a) { var s = 0; for (var x of a) { s += x; } return s; }
var big = []; for (var q = 0; q < 90000; q++) big.push(q & 31);
print("for-of", over(big));
function keys(obj, n) { var c = 0; for (var r = 0; r < n; r++) { for (var k in obj) { c += k.length; } } return c; }
print("for-in", keys({ a: 1, bb: 2, ccc: 3 }, 30000));
function early(n) { for (var i = 0; ; i++) { if (i === n) return i * 2; if (i > n) break; } return -1; }
print("early", early(100000));
function nothing(n) { var a = []; for (var i = 0; i < n; i++) { if ((i & 4095) === 0) a.push(i); } outer = a.length; }
print("nothing", nothing(100000), outer);
function uses() { var s = 0; for (var i = 0; i < 100000; i++) { s += arguments.length; } return s; }
print("arguments", uses(1, 2, 3));
function rests(...r) { var s = 0; for (var i = 0; i < 100000; i++) { s += r.length; } return s; }
print("rest", rests(1, 2));
function Made(n) { this.s = 0; for (var i = 0; i < n; i++) { this.s += 2; } }
print("construct", new Made(100000).s);
function* gen(n) { var s = 0; for (var i = 0; i < n; i++) { s += i & 1; } yield s; }
print("generator", gen(100000).next().value);
print("callback", [100000, 50000].map(function (n) { var s = 0; for (var i = 0; i < n; i++) { s += i % 3; } return s; }).join());
function local(n) {
  function inner(m) { var s = 0; for (var i = 0; i < m; i++) { s += (i * 5) & 9; } return s; }
  return inner(n) + inner(n >> 1);
}
print("local", local(100000));
function calls(n) { var s = 0; for (var i = 0; i < n; i++) { s += sum(3) + Math.max(i & 3, 1); } return s; }
print("calls", calls(100000));
function strings(n) { var t = ""; for (var i = 0; i < n; i++) { if ((i & 8191) === 0) t += String.fromCharCode(65 + (i >> 13)); } return t; }
print("strings", strings(100000));
function deep(n) { if (n === 0) { var s = 0; for (var i = 0; i < 100000; i++) s += i & 1; return s; } return deep(n - 1) + 1; }
print("deep", deep(50));
var top = 0; for (var z = 0; z < 100000; z++) { top += z & 5; }
print("top", top);
function sw(n) { var s = 0; var i = 0; while (true) { switch (i & 3) { case 0: s += 1; break; case 1: s += 2; break; default: s += 3; } if (++i >= n) break; } return s; }
print("switch", sw(100000));
function dw(n) { var i = 0, s = 0; do { s += i; i++; } while (i < n); return s; }
print("do-while", dw(100000));
function fl(n) { var x = 0.5; for (var i = 0; i < n; i++) { x = x * 1.0000001 + 0.25; } return x.toFixed(3); }
print("float", fl(100000));
function lbl(n) { var c = 0; outer1: for (var i = 0; i < n; i++) { for (var j = 0; j < 3; j++) { if (j === 2) continue outer1; c++; } } return c; }
print("label", lbl(100000));
function fin(n) { var s = 0; try { for (var i = 0; i < n; i++) { s++; } return s; } finally { outer = -1; } }
print("finally", fin(100000), outer);
