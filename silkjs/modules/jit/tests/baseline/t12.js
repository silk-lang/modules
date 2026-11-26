function Point(x, y) { this.x = x; this.y = y; }
function Other() {}
function Sub() {} Sub.prototype = Object.create(Point.prototype);
function lit(i) { var o = { a: i, b: i + 1, c: 'k' + i }; return o.a + o.b + o.c.length; }
function nestedLit(i) { var o = { p: { q: i }, r: [i, i + 1, { s: i * 2 }] }; return o.p.q + o.r[0] + o.r[1] + o.r[2].s + o.r.length; }
function arr(i) { var a = [i, i * 2, 'x', null, 1.5]; return a.length + a[0] + a[1] + a[4]; }
function empty() { var a = []; a.push(1); var o = {}; o.z = a; return o.z.length; }
function cat(a, b) { return a + b; }
function grow(n) { var s = ''; for (var i = 0; i < n; i++) { s += i; s += ','; s = s + 'x' + i; } return s.length; }
function catArg(s, n) { for (var i = 0; i < n; i++) s += 'ab'; return s; }
function catMixed(i) { var a = 'n' + i; var b = i + 'n'; var c = 1.5 + 'f'; var d = 'f' + 2.25; var e = 'u' + undefined + null + true; var f = 'o' + {} + [1, 2]; return a + b + c + d + e + f; }
function inst(v) { var s = 0; if (v instanceof Point) s += 1; if (v instanceof Other) s += 2; if (v instanceof Object) s += 4; if (v instanceof Array) s += 8; if (v instanceof Function) s += 16; return s; }
function badInst(v) { try { return v instanceof 5; } catch (e) { return e instanceof TypeError ? 'T' : 'x'; } }
function ty(v) { var s = 0; if (typeof v === 'undefined') s += 1; if (typeof v === 'function') s += 2; if (typeof v === 'object') s += 4; if (typeof v === 'number') s += 8; if (typeof v === 'string') s += 16; if (typeof v == 'boolean') s += 32; if (typeof v !== 'symbol') s += 64; if (typeof v != 'bigint') s += 128; return s; }
function getter(i) { var o = { get g() { return i; }, [ 'k' + (i & 1) ]: i, 3: i, 'quoted': 1, __proto__: Point.prototype }; return o.g + (o instanceof Point ? 1 : 0) + o[3] + (o.k0 | 0) + (o.k1 | 0); }
function poly(i) { var o = i & 1 ? { a: 1, b: 2 } : { b: 2, a: 1, c: 3 }; var t = { a: o, v: i & 2 ? 1 : 'str', w: i & 4 ? 2.5 : null }; return t.a.a + t.a.b + (t.v === 1 ? 5 : 7) + (t.w === null ? 1 : 2); }
function symProto() { var C = function () {}; Object.defineProperty(C, Symbol.hasInstance, { value: function (v) { return v === 7; } }); return (7 instanceof C ? 1 : 0) + (8 instanceof C ? 2 : 0); }
var vals = [new Point(1, 2), new Other(), new Sub(), {}, [], function () {}, 1, 1.5, 'a', null, undefined, true, Symbol('q'), 2n, Object.create(null), new Proxy({}, {}), new Proxy(function () {}, {})];
var total = 0, text = '';
for (var k = 0; k < 80; k++) {
  total += lit(k) + nestedLit(k) + arr(k) + empty() + grow(20) + poly(k) + getter(k) + symProto();
  text = cat('a', 'b') + cat('a', k) + cat(k, 'a') + cat(1.5, 'z') + cat('z', 2.5) + cat(k, k) + cat(1.5, k) + cat('q', null) + cat(undefined, 'q') + cat({}, 'o') + cat([1], [2]) + cat('s', Symbol.iterator.description);
  total += text.length + catArg('s', k).length + catMixed(k).length;
  for (var j = 0; j < vals.length; j++) total = (total * 31 + inst(vals[j]) + ty(vals[j])) % 1000003;
  total += badInst(vals[k % vals.length]).length;
}
try { cat('s', Symbol()); } catch (e) { text += e.constructor.name; }
try { cat(1n, 1); } catch (e) { text += e.constructor.name; }
print(total, text);
