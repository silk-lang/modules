// Multi-hop property-chain method inlining with `new` and `throw` inside inlined bodies,
// plus Class.create() forwarding, prototype mutation invalidation, and Function.prototype.apply
// mutation invalidation.
var Class = {
  create: function() {
    return function() {
      this.initialize.apply(this, arguments);
    };
  }
};
var NS = { Sub: {} };
NS.Sub.Pair = Class.create();
NS.Sub.Pair.prototype = {
  initialize: function(x, y) {
    this.x = (x ? x : 0);
    this.y = (y ? y : 0);
  },
  add: function(a, b) {
    if (!a || !b) throw "missing";
    return new NS.Sub.Pair(a.x + b.x, a.y + b.y);
  }
};
NS.Sub.Holder = Class.create();
NS.Sub.Holder.prototype = {
  initialize: function(v) {
    this.inner = new NS.Sub.Pair(v, v + 1);
  }
};
function step(a, b) {
  return NS.Sub.Pair.prototype.add(a, b);
}
function runTest() {
  var p = new NS.Sub.Pair(0.5, 1.5);
  var q = new NS.Sub.Pair(1.25, -0.25);
  var acc = 0;
  for (var i = 0; i < 80; i++) {
    var r = step(p, q);
    var h = new NS.Sub.Holder(i * 0.5);
    acc += r.x + r.y + h.inner.x + h.inner.y;
  }
  var caught = "";
  try {
    step(p, null);
  } catch (e) {
    caught = String(e);
  }
  // Mutate initialize on prototype after warming up CONSTRUCT_FAST.
  NS.Sub.Pair.prototype.initialize = function(x, y) {
    this.x = x * 10;
    this.y = y * 10;
  };
  var mutated = new NS.Sub.Pair(2, 3);
  // Mutate Function.prototype.apply temporarily.
  var origApply = Function.prototype.apply;
  var applyCalls = 0;
  Function.prototype.apply = function(self, args) {
    applyCalls++;
    return origApply.call(this, self, args);
  };
  var viaCustomApply = new NS.Sub.Pair(4, 5);
  Function.prototype.apply = origApply;
  return [Math.round(acc * 100), caught, mutated.x, mutated.y, viaCustomApply.x, applyCalls].join("|");
}
print(runTest());
