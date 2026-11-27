// A bound function whose target is a leaf (a small function that only
// computes) runs the leaf on the bound arguments followed by the call's,
// without an inline frame. Each case checks argument order, this, results
// that are heap values, a leaf that needs its slow path part way, and
// chains of bound functions.
"use strict";
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function collect() { if (typeof gc === "function") gc(); else if (typeof std === "object" && std.gc) std.gc(); }

function sum3(a, b, c) { return a * 100 + b * 10 + c; }
function self() { return this; }
function pick(a, b) { return b; }
function field(o) { return o.k; }
function add(a, b) { return a + b; }
var obj = { k: "key" };
for (var round = 0; round < 3; round++) {
  var b12 = sum3.bind(null, 1, 2);
  var s = 0;
  for (var i = 0; i < 2000; i++) s += b12(i % 10);
  check(s, 2000 * 120 + 200 * 45, "bound arguments first");
  var b1 = sum3.bind(null, 7);
  check(b1(8, 9), 789, "one bound argument");
  check(String(b1(8)), "NaN", "missing argument is undefined");
  var bt = self.bind(obj);
  for (var i = 0; i < 100; i++) check(bt(), obj, "bound this");
  var bu = self.bind(undefined);
  check(bu(), undefined, "bound undefined this, strict");
  // A heap result borrowed from a bound argument must stay alive.
  var keep = pick.bind(null, 0, { v: 1 });
  var got = [];
  for (var i = 0; i < 100; i++) got.push(keep());
  keep = null;
  collect();
  check(got[99].v + got[0].v, 2, "bound heap argument result");
  var bf = field.bind(null);
  for (var i = 0; i < 100; i++) check(bf(obj), "key", "field read");
  // A string result builds a new string.
  var cat = add.bind(null, "x");
  for (var i = 0; i < 100; i++) check(cat(i), "x" + i, "string add");
  // Part way through the leaf needs its slow path (a getter, a proxy).
  var getter = { get k() { return "got"; } };
  check(bf(getter), "got", "getter slow path");
  check(bf(new Proxy({ k: "px" }, {})), "px", "proxy slow path");
  check(bf(obj), "key", "fast again");
  // Chains of bound functions.
  var c2 = sum3.bind(null, 1).bind(null, 2);
  for (var i = 0; i < 100; i++) check(c2(3), 123, "bound chain");
  var c3 = sum3.bind(null).bind(null, 4).bind(null, 5, 6);
  check(c3(), 456, "bound chain of three");
  var thrown = false;
  try { bf(null); } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "throw from leaf");
  // call through Function.prototype.call bound (uncurryThis).
  var callField = Function.prototype.call.bind(field);
  check(callField(null, obj), "key", "uncurryThis");
}
collect();
if (failures) throw new Error(failures + " bound leaf checks failed");
say("ok");
