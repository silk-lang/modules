// Fused arithmetic, steps, element and length reads from slots, arguments, constants.
var G = 0;
function mk() { var s = 3; return { g: function (a) { return s + a; }, st: function (a) { s = a; var t = (s = a + 1); return t; } }; }
var M = mk();
var K = {
  ll: function (a, b) { var x = a, y = b; var p = x + y; var q = x - y; var r = x * y; return p + q + r; },
  tl: function (a, b) { var y = b; return ((a + 1) + y) + ((a + 2) - y) + ((a + 3) * y); },
  ta: function (a, b) { return ((a + 1) + b) + ((a + 2) - b) + ((a + 3) * b); },
  fl: function (a, b) { var x = a * 0.5, y = b * 0.25; return x + y + (x - y) + (x * y) + (x / y) + (a / b) + (a % b); },
  cmp: function (a, b) { var x = a * 0.5, y = b * 0.5; var n = 0; if (x < y) n += 1; if (x <= y) n += 2; if (x > y) n += 4; if (x >= y) n += 8; if (a < y) n += 16; return n; },
  stl: function (n) { var i = 0, s = 0; while (i < n) { s += i; i++; } var j = n; while (j > 0) { j--; s += j; } var k = 5; var u = k++ + ++k + k-- + --k; return s + u; },
  sta: function (a, n) { var s = 0; a++; s += a; a--; s += a; ++a; s += a; --a; s += a; n += 2; s += n; return s; },
  sh: function (a, b) { return (a << b) + (a >> b) + (a >>> b) + (a << 3) + (a | 8) + (-a) + (~a) + (+a) + ((-1) >>> b) + (a >>> 0); },
  un: function (a) { var z = 0; return (-z === 0 ? 1 : 2) + (-a) + (~(a * 0.5)) + (+("5")) + (-(a * 0.5)); },
  el: function (v, i) { var w = v, j = i; return w[j] + v[j] + w[i] + v[i] + w.length + v.length; },
  elx: function (v, i) { var w = v, j = i; return String(w[j]) + String(v[i + 100]) + w.length; },
  pa: function (a, b) { a = b + 1; b = a + a; var c = (a = b); return a + b + c; },
  cst: function (a) { return a * 1.5 + 2.25 + "x".length + 1e10; },
  se: function (a) { var n = 0; if (a === 0) n += 1; if (a !== 1) n += 2; if (a * 0.5 === 1) n += 4; if ("0" === 0) n += 8; if (a * 0.5 !== 2) n += 16; return n; },
  und: function (a) { var u; var n = 0; if (u === undefined) n += 1; if (a === undefined) n += 2; if (a === null) n += 4; if (null === null) n += 8; return n; },
  sc: function (a) { return M.g(a) + M.st(a) + M.g(1); },
  gv: function (a) { G = G + a; G = (G | 0) % 1000; return G; },
  big: function (a) { var x = 2147483647, y = -2147483648; var p = x + a; var q = y - a; var r = x * (a + 2); var z = a * 0; return p + q + r + (1 / z > 0 ? 1 : 2) + ((-a) * 0 === 0 ? 3 : 4); },
  strs: function (a, b) { var x = "s" + a, y = b; return (x + y) + (x - y) + (y + x); },
  run: function (i, v) {
    var s = 0;
    s += this.ll(i, 7) + this.ll(i * 0.5, 3) + this.tl(i, 3) + this.tl(i, 0.5) + this.ta(i, 5) + this.ta(i, 1.5);
    s += this.fl(i, 4) + this.fl(i + 1, i + 2) + this.cmp(i, 50) + this.cmp(i, i) + this.cmp(i, 0 / 0);
    s += this.stl(i % 20) + this.sta(i, 3) + this.sta(i + 0.5, 1) + this.sh(i, 3) + this.sh(-i, 31) + this.sh(i, 0) + this.un(i);
    s += this.el(v, i % 8) + this.elx(v, i % 9).length + this.pa(i, 2) + this.cst(i) + this.se(i % 3) + this.und(i % 2 ? undefined : null);
    s += this.sc(i) + this.gv(i) + this.big(i % 5) + this.strs(i, 3).length;
    return s;
  }
};
var total = 0;
var v = [1, 2, 3, 4, 5, 6, 7, 8];
for (var i = 0; i < 3000; i++) { total = total + K.run(i, v); if (total > 1e15) total = total % 1000003; }
print(total);
print(K.sh(5, 2), K.un(4), K.big(3), K.fl(3, 0), K.cmp(1, 2), K.se(0), K.und(null), K.strs(1, 2));
var K2 = {
  al: function (a, b) { var s = 0; s += a; s += b; s += 0.5; var t = "q"; t += a; return s + t.length; },
  e3: function (v, i) { v[i] += 2; v[i] *= 1; var o = { p: 1 }; o.p += i; return v[i] + o.p; },
  ins: function (v, i) { var x = v[i] = i + 1; var o = {}; var y = o.q = x; return x + y; },
  pm: function (v, i) { return v[i]++ + ++v[i] + v[i]-- + --v[i]; },
  run: function (i, v) { return this.al(i, 2) + this.al(0.5, i) + this.e3(v, i % 8) + this.ins(v, i % 8) + this.pm(v, i % 8); }
};
var t2 = 0;
for (var i = 0; i < 3000; i++) { t2 = t2 + K2.run(i, v); }
print(t2, v.join(","));
