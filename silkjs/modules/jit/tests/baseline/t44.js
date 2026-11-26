// Methods found one, two and three prototypes above the receiver are known to compiled
// code while every object from the receiver's prototype to the holder is watched. Each
// case warms a call site up over such classes, changes what a receiver should call at
// some level of the chain, and runs it again.
function classes() {
  function Base(n) { this.n = n; }
  Base.prototype.run = function (s) { return this.n + s.k; };
  Base.prototype.twice = function (s) { return this.run(s) * 2; };
  function Mid(n) { Base.call(this, n); } Mid.prototype = Object.create(Base.prototype);
  Mid.prototype.tag = function () { return 1; };
  function Leaf(n) { Mid.call(this, n); } Leaf.prototype = Object.create(Mid.prototype);
  function Low(n) { Leaf.call(this, n); this.low = 3; } Low.prototype = Object.create(Leaf.prototype);
  function Side(n) { Mid.call(this, n); this.side = 5; } Side.prototype = Object.create(Mid.prototype);
  Side.prototype.run = function (s) { return this.n - s.k + (this.side | 0); };
  return { Base: Base, Mid: Mid, Leaf: Leaf, Low: Low, Side: Side };
}
function receivers(K) { return [new K.Base(1), new K.Mid(2), new K.Leaf(3), new K.Low(4), new K.Side(5), new K.Leaf(6), new K.Low(7)]; }
function warm(change, rounds) {
  var K = classes();
  var list = receivers(K);
  var state = { k: 0, t: 0 };
  var drive = eval("(function (list, n, state) { var s = 0; for (var i = 0; i < n; i++) { var o = list[i % list.length]; state.k = i & 15; s += o.run(state) + o.twice(state); } return s; })");
  var total = 0;
  for (var r = 0; r < rounds; r++) total += drive(list, 35, state);
  var caught = 0;
  change(K, list);
  for (var r = 0; r < rounds; r++) { try { total += drive(list, 35, state); } catch (e) { caught += e instanceof TypeError ? 1 : 100; } }
  return total + ":" + caught;
}
var other = function (s) { return 1000 + s.k + this.n; };
var out = [];

// Nothing changes; then the holder's method: assigned, defined, deleted, a getter.
out.push(warm(function () {}, 300));
out.push(warm(function (K) { K.Base.prototype.run = other; }, 300));
out.push(warm(function (K) { Object.defineProperty(K.Base.prototype, "run", { value: other }); }, 300));
out.push(warm(function (K) { delete K.Base.prototype.run; }, 20));
out.push(warm(function (K) { Object.defineProperty(K.Base.prototype, "twice", { get: function () { return other; } }); }, 300));
print(out.join(" ")); out = [];

// A prototype between the receiver and the holder gets the method: one level up, two
// levels up, the receiver's own prototype; then loses it again.
out.push(warm(function (K) { K.Mid.prototype.run = other; }, 300));
out.push(warm(function (K) { K.Leaf.prototype.run = other; }, 300));
out.push(warm(function (K) { K.Low.prototype.twice = other; }, 300));
out.push(warm(function (K) { K.Leaf.prototype.run = other; delete K.Leaf.prototype.run; }, 300));
out.push(warm(function (K) { Object.defineProperty(K.Mid.prototype, "run", { get: function () { return other; } }); }, 300));
out.push(warm(function (K) { K.Mid.prototype.unrelated = 1; K.Leaf.prototype.more = 2; }, 300));
print(out.join(" ")); out = [];

// The chain itself changes: a prototype in between is replaced, a level is cut out, a new
// level is put in, the receiver gets another prototype or an own method.
out.push(warm(function (K) { var p = Object.create(K.Base.prototype); p.run = other; Object.setPrototypeOf(K.Leaf.prototype, p); }, 300));
out.push(warm(function (K) { Object.setPrototypeOf(K.Low.prototype, K.Side.prototype); }, 300));
out.push(warm(function (K) { Object.setPrototypeOf(K.Mid.prototype, { run: other, twice: other }); }, 300));
out.push(warm(function (K) { Object.setPrototypeOf(K.Mid.prototype, null); }, 20));
out.push(warm(function (K, list) { Object.setPrototypeOf(list[3], K.Side.prototype); }, 300));
out.push(warm(function (K, list) { list[2].run = other; list[6].twice = other; }, 300));
out.push(warm(function (K, list) { list[3].later = 1; list[5].later = 2; }, 300));
print(out.join(" ")); out = [];

// Receivers the site never saw: a deeper class, a class under another holder, a Proxy in
// the chain, an object without the method.
out.push(warm(function (K, list) { function Deep(n) { K.Low.call(this, n); } Deep.prototype = Object.create(K.Low.prototype); list.push(new Deep(8)); }, 300));
out.push(warm(function (K, list) { function Far(n) { this.n = n; } Far.prototype = Object.create({ run: other, twice: other }); list.push(new Far(9)); }, 300));
out.push(warm(function (K, list) { var o = new K.Leaf(10); Object.setPrototypeOf(o, new Proxy(K.Leaf.prototype, { get: function (t, k, rcv) { return k === "run" ? other : Reflect.get(t, k, rcv); } })); list.push(o); }, 300));
out.push(warm(function (K, list) { list.push(Object.create(null)); }, 20));
print(out.join(" ")); out = [];

// A method changes the chain above itself while the loop runs, then puts it back.
function self() {
  var K = classes();
  var list = receivers(K);
  var left = 6000, first = K.Base.prototype.run;
  K.Base.prototype.tag = function () { return 2; };
  K.Base.prototype.run = function (s) {
    left--;
    if (left == 4000) K.Leaf.prototype.run = other;
    if (left == 2000) delete K.Leaf.prototype.run;
    if (left == 1000) K.Base.prototype.run = first;
    return this.n + s.k + this.tag();
  };
  var drive = eval("(function (list, n, state) { var s = 0; for (var i = 0; i < n; i++) { var o = list[i % list.length]; state.k = i & 15; s += o.run(state) + o.twice(state); } return s; })");
  var total = 0, state = { k: 0, t: 0 };
  for (var r = 0; r < 600; r++) total += drive(list, 35, state);
  return total + ":" + left;
}
print(self());

// Constraints in the manner of the benchmark this was built for: a plan runs each one's
// method, which the classes take from one or two levels up; objects of the classes die
// in cycles between collections.
function Constraint(s) { this.strength = s; this.owner = null; }
Constraint.prototype.execute = function () { return this.strength; };
Constraint.prototype.isInput = function () { return false; };
function Unary(v, s) { Constraint.call(this, s); this.out = v; this.owner = this; }
Unary.prototype = Object.create(Constraint.prototype);
Unary.prototype.output = function () { return this.out; };
function Stay(v, s) { Unary.call(this, v, s); } Stay.prototype = Object.create(Unary.prototype);
function Edit(v, s) { Unary.call(this, v, s); } Edit.prototype = Object.create(Unary.prototype);
Edit.prototype.isInput = function () { return true; };
function Binary(a, b, s) { Constraint.call(this, s); this.a = a; this.b = b; this.owner = this; }
Binary.prototype = Object.create(Constraint.prototype);
Binary.prototype.output = function () { return this.b; };
function Eq(a, b, s) { Binary.call(this, a, b, s); } Eq.prototype = Object.create(Binary.prototype);
Eq.prototype.execute = function () { this.b.value = this.a.value; return 0; };
function plan(n) { var v = []; var x = { value: n }, y = { value: 0 }; for (var i = 0; i < n; i++) v.push(i % 4 == 0 ? new Stay(x, i) : i % 4 == 1 ? new Edit(y, i) : i % 4 == 2 ? new Eq(x, y, i) : new Binary(x, y, i)); return v; }
function execute(v) { var s = 0; for (var i = 0; i < v.length; i++) { var c = v[i]; s += c.execute() + (c.isInput() ? 1 : 0) + c.output().value; } return s; }
var sum = 0;
for (var r = 0; r < 3000; r++) sum += execute(plan(r % 9 + 4));
print(sum);
