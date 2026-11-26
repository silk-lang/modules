// Property adds in optimized code: constructors and plain functions adding fields along
// memoized transitions, and everything that must take the general way instead: a setter or
// a read-only property appearing on the prototype chain, a frozen or non-extensible
// receiver, a receiver that is some shape's prototype, slots that are full, a receiver of
// another class, and a value that is the store's only reference.
function Point(x, y) { this.x = x; this.y = y; this.z = x + y; }
function Many(v) { this.a = v; this.b = v + 1; this.c = v + 2; this.d = v + 3; this.e = v + 4; this.f = v + 5; this.g = v + 6; this.h = v + 7; this.i = v + 8; }
function Holder(v) { this.obj = { v: v }; this.list = [v, v]; this.text = "t" + v; }
function addTo(o, v) { o.extra = v; return o; }
function sum(o) { var s = 0; for (var k in o) { var x = o[k]; if (typeof x === "number") s += x; } return s; }
var total = 0;
for (var i = 0; i < 3000; i++) {
  var p = new Point(i, 2);
  var m = new Many(i);
  var h = new Holder(i);
  total += p.z + sum(m) + h.obj.v + h.list.length + h.text.length;
  total += addTo({ q: 1 }, i).extra;
  total += addTo(new Point(1, i), 3).extra;
}
print(total);
// A setter on the prototype chain, added while the code runs: the adds must call it.
var calls = 0;
function Base(v) { this.v = v; }
function Child(v) { Base.call(this, v); this.w = v * 2; }
Child.prototype = Object.create(Base.prototype);
var acc = 0;
for (var i = 0; i < 2000; i++) {
  if (i == 700) Object.defineProperty(Base.prototype, "w", { set: function (x) { calls++; this._w = x; }, get: function () { return this._w; }, configurable: true });
  if (i == 1400) delete Base.prototype.w;
  if (i == 1600) Object.defineProperty(Object.prototype, "w", { value: 9, writable: false, configurable: true });
  var c = new Child(i);
  acc += c.w + (c.hasOwnProperty("w") ? 1 : 0);
}
delete Object.prototype.w;
print(acc, calls);
// Receivers that do not add in place.
function tag(o, v) { o.tag = v; return o.tag; }
var kinds = 0;
for (var i = 0; i < 2000; i++) {
  var plain = { n: i };
  if (i % 5 == 1) Object.preventExtensions(plain);
  if (i % 5 == 2) Object.freeze(plain);
  if (i % 5 == 3) Object.create(plain);
  var r = tag(plain, i);
  kinds += (r === undefined ? 1 : r === i ? 2 : 3);
  if (i % 7 == 0) kinds += tag([i], 1) + tag(function () {}, 2) + (tag(new Map(), 3) || 0);
}
print(kinds);
// A shape some object has for its prototype: the add bumps the prototype epoch.
function Proto() { this.k = 1; }
var protoSeen = 0;
for (var i = 0; i < 1500; i++) {
  var base = new Proto();
  var child = Object.create(base);
  base.late = i;
  protoSeen += child.late + child.k;
}
print(protoSeen);
// Full slots: objects that grow past their room, one field at a time.
function grow(o, n) { for (var j = 0; j < n; j++) o["f" + (j % 12)] = j; return o; }
function Grows(v) { this.a = v; this.b = v; this.c = v; this.d = v; this.e = v; this.f = v; this.g = v; this.h = v; this.i = v; this.j = v; this.k = v; this.l = v; this.m = v; this.n = v; this.o = v; this.p = v; this.q = v; this.r = v; this.s = v; this.t = v; }
var g = 0;
for (var i = 0; i < 1000; i++) { g += Object.keys(grow({}, i % 20)).length + new Grows(i).t; }
print(g);
// The stored value's last reference is the slot's.
function Box(v) { this.v = { inner: v }; this.w = [v]; }
var b = 0;
for (var i = 0; i < 3000; i++) { var x = new Box(i); b += x.v.inner + x.w[0]; }
print(b);
