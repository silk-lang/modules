function cmp(a, b) { var r = 0; if (a == b) r += 1; if (a != b) r += 2; if (a === b) r += 4; if (a !== b) r += 8; if (a < b) r += 16; if (a <= b) r += 32; if (a > b) r += 64; if (a >= b) r += 128; return r; }
var vals = [0, 1, -1, 2147483647, -2147483648, 1.5, "1", "a", null, undefined, true, false, {}, [], NaN];
var o = {};
vals.push(o); vals.push(o);
var total = 0;
for (var k = 0; k < 30; k++) for (var i = 0; i < vals.length; i++) for (var j = 0; j < vals.length; j++) total = (total * 31 + cmp(vals[i], vals[j])) | 0;
print(total);
function nul(a) { var r = 0; if (a == null) r += 1; if (a != null) r += 2; if (a === null) r += 4; if (a === undefined) r += 8; while (a != null && r < 100) { r += 7; } return r; }
var t2 = 0;
for (var k = 0; k < 30; k++) for (var i = 0; i < vals.length; i++) t2 = (t2 * 31 + nul(vals[i])) | 0;
print(t2);
function loops(n) { var s = 0, i = 0; while (i < n) { if (i == 3) { i++; continue; } s += i; i++; } do { s--; } while (s > n * 2); for (var j = n; j >= 0; j--) if (j != 2) s += j; return s; }
var t3 = 0;
for (var k = 0; k < 200; k++) t3 += loops(k % 17);
print(t3);
function T(v) { this.v = v; }
T.prototype.get = function () { var self = this; return self.v; };
T.prototype.same = function (x) { if (this == x) return 1; return 0; };
var a = new T(5), b = new T(6), t4 = 0;
for (var k = 0; k < 300; k++) t4 += a.get() + a.same(k & 1 ? a : b) + b.same(null);
print(t4);
function strictThis() { "use strict"; var t = this; return t === undefined ? 1 : 2; }
function sloppyThis() { var t = this; return t === undefined ? 1 : 2; }
var t5 = 0;
for (var k = 0; k < 100; k++) t5 += strictThis() + sloppyThis() * 10 + strictThis.call(5) * 100;
print(t5);
function many() { var x = { n: 1 }; for (var i = 0; i < 50; i++) { var y = { n: i, p: x }; x = y; } return x.p.p.n; }
var t6 = 0;
for (var k = 0; k < 200; k++) t6 += many();
print(t6);
