// Object.assign(Object.create(p), literal) finds the literal's shape under p
// through a memo. Each case checks the result's prototype and own properties:
// alternating prototypes with one literal shape, prototypes that die and are
// replaced by new ones (possibly at the same address), a prototype changed after
// use, and literals that differ only in key order or count.
"use strict";
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }
var J = JSON.stringify;

for (var round = 0; round < 3; round++) {
  var p1 = { k: 1 }, p2 = { k: 2 };
  var t = 0;
  for (var i = 0; i < 400; i++) {
    var p = i & 1 ? p1 : p2;
    var o = Object.assign(Object.create(p), { a: i, b: 2 });
    if (Object.getPrototypeOf(o) !== p) { failures++; say("FAIL prototype", i); break; }
    t += o.a + o.b + o.k;
  }
  check(t, 399 * 400 / 2 + 800 + 200 + 400, "alternating prototypes");
  // Prototypes that die: fresh ones each turn, collected between.
  var sum = 0;
  for (var i = 0; i < 200; i++) {
    var fresh = { k: i };
    var o = Object.assign(Object.create(fresh), { a: 1, b: 2 });
    sum += o.k + o.a;
    if (Object.getPrototypeOf(o) !== fresh) { failures++; say("FAIL fresh prototype", i); break; }
    if (i % 50 === 0) collect();
  }
  check(sum, 199 * 200 / 2 + 200, "fresh prototypes");
  // Key order and count are part of the shape.
  var x = Object.assign(Object.create(p1), { b: 2, a: 1 });
  check(J(Object.keys(x)), "[\"b\",\"a\"]", "key order");
  var y = Object.assign(Object.create(p1), { a: 1 });
  check(J(Object.keys(y)), "[\"a\"]", "fewer keys");
  var z = Object.assign(Object.create(p1), { a: 1, b: 2, c: 3 });
  check(J(Object.keys(z)), "[\"a\",\"b\",\"c\"]", "more keys");
  // A prototype that gains a property after use.
  var q = { k: 5 };
  var before = Object.assign(Object.create(q), { a: 1, b: 2 });
  q.extra = 9;
  var after = Object.assign(Object.create(q), { a: 3, b: 4 });
  check(after.extra + after.a + before.extra, 21, "prototype changed after use");
  // A prototype whose own prototype is null.
  var bare = Object.create(null);
  var w = Object.assign(Object.create(bare), { a: 1, b: 2 });
  check(Object.getPrototypeOf(w), bare, "null-rooted prototype");
  check(w.a + w.b, 3, "null-rooted values");
  // Setting the prototype of a result does not affect later ones.
  var moved = Object.assign(Object.create(p1), { a: 1, b: 2 });
  Object.setPrototypeOf(moved, p2);
  var next = Object.assign(Object.create(p1), { a: 1, b: 2 });
  check(Object.getPrototypeOf(next), p1, "after setPrototypeOf");
  check(moved.k, 2, "moved prototype");
  collect();
}
if (failures) throw new Error(failures + " assign/create memo checks failed");
say("ok");
