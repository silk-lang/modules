// Stores that give an Array an element it did not have: fills from the top down (the first
// store leaves a gap under it), appends that grow the Array, and what such a store must
// not do past the Array itself (setters and elements up the prototype chain, frozen and
// sealed Arrays, a read-only length, keys that are no element index, things that are no
// Array). Each function runs hot enough for every tier.
function down(r, n, v) { for (var i = n - 1; i >= 0; --i) r[i] = v + i; return r; }
function shift(a, t, n, r) {
  var i;
  for (i = t - 1; i >= 0; --i) r[i + n] = a[i];
  for (i = n - 1; i >= 0; --i) r[i] = 0;
  return r;
}
function append(r, n, v) { for (var i = 0; i < n; i++) r[r.length] = v; return r; }
function every(r, from, to, step, v) { for (var i = from; i < to; i += step) r[i] = v; return r; }
function at(r, k, v) { r[k] = v; return r; }
function strictAt(r, k, v) { "use strict"; try { r[k] = v; return "stored"; } catch (e) { return e.name; } }
function show(a) {
  var keys = Object.keys(a);
  return a.length + ":" + Array.prototype.join.call(a, ",") + (keys.length > 12 ? " keys " + keys.length : " [" + keys.join(" ") + "]");
}
var out = [];
function note(s) { out.push(s); }
var held = { name: "held" }, text = "tx";
for (var turn = 0; turn < 150; turn++) {
  var last = turn == 149;
  // Fresh and short Arrays, numbers, doubles, strings and objects.
  var a = down([], 9, turn), b = down([1, 2], 7, 0.5), c = down([], 6, text), d = down(new Array(4), 8, 1);
  var e = shift([3, 4, 5, 6, 7], 5, 3, []), f = shift([held, held, text + turn], 3, 4, [9]);
  var g = append([], 40, held), h = append(new Array(3), 5, turn), k = every([], 0, 30, 3, 7), l = every([1, 2, 3], 5, 9, 1, 1.25);
  if (last) { note(show(a)); note(show(b)); note(show(c)); note(show(d)); note(show(e)); note(show(f)); note(g.length + " " + (g[39] === held)); note(show(h)); note(show(k)); note(show(l)); }
  // An Array made fast again by the fill takes pushes and pops as any other.
  a.push(1, 2); b.pop(); e.unshift(8); k[1] = 1; k[2] = 2;
  if (last) { note(show(a)); note(show(b)); note(show(e)); note(show(k)); }
  // Over an element that is there: a slow Array's own, an accessor, a hole.
  var slow = []; slow[5] = 1; at(slow, 5, 2); at(slow, 3, 4); at(slow, 9, text);
  var acc = [1, 2, 3], seen = 0;
  Object.defineProperty(acc, 6, { set: function (v) { seen += v; }, get: function () { return seen; }, configurable: true });
  at(acc, 6, 5); at(acc, 4, 4); at(acc, 8, 8);
  var holes = [1, , 3, , 5]; at(holes, 1, 2); at(holes, 3, 4); at(holes, 7, 8);
  if (last) { note(show(slow)); note(show(acc) + " " + seen); note(show(holes)); }
  // Frozen, sealed, not extensible, a read-only length.
  var frozen = Object.freeze([1, 2]), sealed = Object.seal([1, 2]), closed = Object.preventExtensions([1, 2]);
  var fixed = [1, 2, 3]; Object.defineProperty(fixed, "length", { writable: false });
  var roomy = []; roomy.length = 6; Object.defineProperty(roomy, "length", { writable: false });
  at(frozen, 2, 1); at(frozen, 5, 1); at(sealed, 2, 1); at(sealed, 1, 9); at(closed, 4, 1); at(fixed, 3, 1); at(fixed, 7, 1); at(roomy, 4, 1); at(roomy, 6, 1); at(roomy, 2, held);
  var r1 = strictAt(frozen, 3, 1) + strictAt(sealed, 3, 1) + strictAt(closed, 2, 1) + strictAt(fixed, 3, 1) + strictAt(roomy, 5, 1) + strictAt(roomy, 9, 1) + strictAt(null, 1, 1) + strictAt(undefined, 2, 2);
  if (last) { note(show(frozen)); note(show(sealed)); note(show(closed)); note(show(fixed)); note(show(roomy)); note(r1); }
  // Keys that are no element index, and the largest ones.
  var odd = []; at(odd, "3", 1); at(odd, 1.5, 2); at(odd, -1, 3); at(odd, "x", 4); at(odd, 6.0, 5); at(odd, -0, 6); at(odd, "07", 7); at(odd, true, 8); at(odd, null, 9);
  var far = []; at(far, 2147483646, 1); at(far, 2147483647, 2); at(far, 4294967294, 3); at(far, 4294967295, 4); at(far, 4294967296, 5); at(far, 100000, 6);
  if (last) { note(show(odd)); note(far.length + " " + Object.keys(far).join(" ")); }
  // Things that are no Array.
  var typed = new Int32Array(4), bytes = new Uint8Array(2), plain = { length: 2 }, fn = function () {};
  at(typed, 3, 7); at(typed, 4, 8); at(typed, 9, 9); at(bytes, 2, 1); at(plain, 5, 1); at(plain, 0, held); at(fn, 2, 3); at("abc", 5, 1); at(7, 1, 1);
  var args = (function () { return arguments; })(1, 2); at(args, 4, 5); at(args, 0, 6); at(args, 2, 7);
  if (last) { note(typed.join() + " " + bytes.join() + " " + Object.keys(plain).join() + " " + fn[2] + " " + show(args)); }
}
// Up the prototype chain: a subclass, setters and elements under the index, a proxy.
class Row extends Array {}
var seenBy = "";
function probe(make, label) {
  var r = make(); down(r, 5, 1); at(r, 8, 8); append(r, 2, 2);
  note(label + " " + show(r) + " " + seenBy);
  seenBy = "";
}
function plainArray() { return [1]; }
function row() { return new Row(); }
function nullProto() { var a = [1]; Object.setPrototypeOf(a, null); return a; }
function viaObject() { var a = []; Object.setPrototypeOf(a, { 3: "from proto" }); return a; }
function viaProxy() {
  var a = [];
  Object.setPrototypeOf(a, new Proxy(Array.prototype, { set: function (t, k, v, r) { seenBy += "|" + "proxy " + String(k); return Reflect.set(t, k, v, r); } }));
  return a;
}
function deep() { var a = [], p = Array.prototype; for (var i = 0; i < 12; i++) p = Object.create(p); Object.setPrototypeOf(a, p); return a; }
function under(proto) { return function () { var a = []; Object.setPrototypeOf(a, proto); return a; }; }
var slowProto = [];
Object.defineProperty(slowProto, 2, { set: function (v) { seenBy += "|slow 2=" + v; }, configurable: true });
var makers = [plainArray, row, nullProto, viaObject, viaProxy, deep, under([7, 7, 7]), under(Object.freeze([7, 7, 7, 7, 7, 7, 7, 7, 7, 7])), under(new Int8Array(3)),
  under(new String("abcd")), under((function () { return arguments; })(1, 2, 3)), under(slowProto), under(Object.freeze({ 1: 1, 9: 9 }))];
var names = ["array", "row", "null", "object", "proxy", "deep", "fast", "frozen", "typed", "string", "arguments", "slow", "frozen object"];
function round(label) { for (var i = 0; i < makers.length; i++) probe(makers[i], label + " " + names[i]); }
for (var warm = 0; warm < 120; warm++) { round("warm"); out.length = out.length - makers.length; }
round("clean");
Object.defineProperty(Row.prototype, 3, { set: function (v) { seenBy += "|" + "row 3=" + v; }, configurable: true });
round("row setter");
delete Row.prototype[3];
Object.defineProperty(Array.prototype, 2, { set: function (v) { seenBy += "|" + "array 2=" + v; }, get: function () { return "g"; }, configurable: true });
round("array setter");
delete Array.prototype[2];
Array.prototype[4] = "inherited";
round("array element");
delete Array.prototype[4];
Object.defineProperty(Array.prototype, 8, { value: "fixed", writable: false, configurable: true });
round("array read-only");
delete Array.prototype[8];
round("clean again");
Object.defineProperty(Object.prototype, 6, { set: function (v) { seenBy += "|" + "object 6=" + v; }, configurable: true });
var gap = []; at(gap, 9, 1); at(gap, 6, 2); at(gap, 5, 3);
note("object setter " + show(gap) + " " + seenBy); seenBy = "";
delete Object.prototype[6];
// The value's count: an object stored many times over is still itself once the Arrays go.
var keep = { n: 0 };
for (var q = 0; q < 300; q++) { var tmp = down([], 12, 0); shift([keep, keep, keep], 3, 5, tmp); append(tmp, 3, keep); keep.n += tmp.length; tmp = null; }
note(keep.n + " " + JSON.stringify(keep));
print(out.join("\n"));
