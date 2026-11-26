// Field stores that turn between adding their property and finding it in the object:
// baseline code notes such a site (baseline_env.noteTurn), the optimizer stores there the
// general way from its first compile, and a function with one is called, not inlined.

function Big() { this.array = []; }
// On a fresh object each store adds; on a used one each finds its property.
function setBoth(r, n) { r.t = n; r.s = n >> 1; return r; }
function copy(from, r) { r.t = from.t; r.s = from.s; }
// The other order of the two adds, a shape of its own.
function setBack(r, n) { r.s = -n; r.t = n + 1; return r; }
// Callers that would take the bodies above in place.
function viaCopy(from, r) { copy(from, r); return r.t * 3 + r.s; }
function viaBoth(n, fresh, used) { var r = (n & 1) ? fresh : used; setBoth(r, n); return r.t - r.s; }
// A store in a loop next to element reads: the loop keeps its proofs when the site is one kind.
function fill(r, a, n) { var s = 0; for (var i = 0; i < n; i++) { r.last = a[i]; s = (s + a[i]) | 0; } return s + r.last; }

var spare = setBoth(new Big(), 7);
var from = setBoth(new Big(), 40);
var numbers = [];
for (var i = 0; i < 24; i++) numbers[i] = i * 5 - 9;
var sum = 0;
function round(r) {
  // Fresh and used objects in turn, then runs of each.
  var fresh = new Big();
  var a = (r & 1) ? fresh : spare;
  setBoth(a, r);
  sum = (sum + a.t + a.s) | 0;
  var b = (r % 3 == 0) ? new Big() : spare;
  copy(from, b);
  sum = (sum + b.t + b.s) | 0;
  var c = (r % 5 < 2) ? new Big() : spare;
  setBack(c, r);
  sum = (sum + c.t + c.s) | 0;
  sum = (sum + viaCopy(from, (r & 2) ? new Big() : spare)) | 0;
  sum = (sum + viaBoth(r, new Big(), spare)) | 0;
  sum = (sum + fill((r % 7 == 0) ? new Big() : spare, numbers, 8 + (r & 7))) | 0;
}
for (var r = 0; r < 400; r++) round(r);
print(sum, Object.keys(spare).join(), spare.t, spare.s, spare.last);
print(Object.keys(setBoth(new Big(), 3)).join(), Object.keys(setBack(new Big(), 3)).join(), Object.keys(setBack(setBoth(new Big(), 1), 9)).join());

// Objects that take the store another way: a setter, a property that is not writable, an
// object that may not grow, a prototype's property, a number, a string.
var seen = [];
var withSetter = { set t(v) { seen.push("t" + v); }, get t() { return "g"; }, s: 0 };
setBoth(withSetter, 12); copy(from, withSetter); setBack(withSetter, 5);
print(seen.join(), withSetter.t, withSetter.s);
var fixed = Object.defineProperty({ s: 1 }, "t", { value: "fixed", writable: false, enumerable: true });
setBoth(fixed, 6); copy(from, fixed);
print(fixed.t, fixed.s);
var sealed = Object.preventExtensions({ t: 1 });
setBoth(sealed, 9); setBack(sealed, 2);
print(sealed.t, sealed.s, Object.keys(sealed).join());
var frozen = Object.freeze({ t: 1, s: 2 });
setBoth(frozen, 9);
print(frozen.t, frozen.s);
function Proto() {}
Proto.prototype.t = "proto";
Proto.prototype.s = "proto";
var under = new Proto();
setBoth(under, 4);
print(under.t, under.s, Object.keys(under).join(), Proto.prototype.t);
Object.defineProperty(Proto.prototype, "t", { set: function (v) { seen.push("p" + v); }, get: function () { return "pg"; }, configurable: true });
var under2 = new Proto();
setBoth(under2, 8); copy(from, under2); viaCopy(from, under2);
print(under2.t, under2.s, Object.keys(under2).join(), seen.join());
print(setBoth(5, 1), setBoth("text", 2), viaBoth(3, new Big(), spare), viaCopy(from, new Big()));
function strict(r) { "use strict"; try { r.t = 1; return "stored"; } catch (e) { return e.name; } }
for (var k = 0; k < 60; k++) { strict((k & 1) ? new Big() : spare); }
print(strict(frozen), strict(sealed), strict(fixed), strict(new Big()), strict(spare), strict(withSetter), seen.length);
