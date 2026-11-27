// A forwarding constructor (`function () { this.initialize.apply(this, arguments) }`)
// builds from its recorded plan once a construct checked it. Each case changes
// one thing the plan depends on mid-loop and checks the next constructs see it:
// the forwarded method replaced on the prototype, apply replaced or shadowed,
// the target function gaining a property, and the prototype gaining one.
"use strict";
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

function makeClass() {
  var C = function () { this.initialize.apply(this, arguments); };
  C.prototype = { initialize: function (x, y) { this.x = x; this.y = y; } };
  return C;
}

for (var round = 0; round < 3; round++) {
  var V = makeClass();
  var sum = 0;
  for (var i = 0; i < 200; i++) {
    if (i === 100) V.prototype.initialize = function (x, y) { this.x = x * 10; this.y = y; };
    var v = new V(i, 1);
    sum += v.x + v.y;
  }
  check(sum, (99 * 100 / 2) + 10 * (100 + 199) * 100 / 2 + 200, "initialize replaced on the prototype");

  // The target gains an own apply: the construct must call it.
  var W = makeClass();
  var calls = 0;
  for (var i = 0; i < 200; i++) {
    if (i === 100) {
      var original = Function.prototype.apply;
      W.prototype.initialize.apply = function (self, args) { calls++; return original.call(this, self, args); };
    }
    var w = new W(i, 2);
    check(w.x, i, "own apply keeps the arguments");
  }
  check(calls, 100, "own apply on the target is called");

  // Function.prototype.apply itself replaced, then restored.
  var Z = makeClass();
  var saved = Function.prototype.apply;
  var seen = 0;
  for (var i = 0; i < 200; i++) {
    if (i === 100) Function.prototype.apply = function (self, args) { seen++; return saved.call(this, self, args); };
    if (i === 150) Function.prototype.apply = saved;
    var z = new Z(i, 3);
    check(z.y, 3, "constructs while apply is replaced");
  }
  Function.prototype.apply = saved;
  check(seen, 50, "a replaced Function.prototype.apply is called");

  // The prototype gains a property while the method stays: plans still hold.
  var P = makeClass();
  var total = 0;
  for (var i = 0; i < 200; i++) {
    if (i === 100) P.prototype.extra = 7;
    var p = new P(i, 4);
    total += p.x + (p.extra || 0);
  }
  check(total, 199 * 200 / 2 + 7 * 100, "prototype gains a property");

  // A getter takes the method's place.
  var G = makeClass();
  var hits = 0;
  for (var i = 0; i < 200; i++) {
    if (i === 100) Object.defineProperty(G.prototype, "initialize", { get: function () { hits++; return function (x) { this.x = -x; }; } });
    var g = new G(i, 5);
    check(g.x, i < 100 ? i : -i, "getter for the method");
  }
  check(hits, 100, "getter is read on each construct");
}
if (failures) throw new Error(failures + " forward construct checks failed");
say("ok");
