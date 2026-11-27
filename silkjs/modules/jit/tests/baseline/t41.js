// A call site that calls one method per class knows the callee from the receiver's shape
// while each class's prototype is watched. Each case warms such a site up over four
// classes, changes what one of the receivers should call, and runs it again.
function classes() {
  function A(n) { this.n = n; } A.prototype.run = function (s) { return this.n + s.k; };
  function B(n) { this.n = n; } B.prototype.run = function (s) { return this.n - s.k; };
  function C(n) { this.n = n; this.c = 1; } C.prototype.run = function (s) { s.t++; return this.n * 2 + s.k + this.c; };
  function D(n) { this.d = 7; this.n = n; } D.prototype.run = function (s) { return (this.n ^ s.k) + this.d; };
  return [A, B, C, D];
}
function receivers(K) { return [new K[0](1), new K[1](2), new K[2](3), new K[3](4), new K[0](5), new K[2](6)]; }
function warm(change, rounds) {
  var K = classes();
  var list = receivers(K);
  // A driver of its own for each case: its site sees these four shapes alone. The argument
  // is at hand, so nothing stands between the method's read and its call.
  var state = { k: 0, t: 0 };
  var drive = eval("(function (list, n, state) { var s = 0; for (var i = 0; i < n; i++) { var o = list[i % list.length]; state.k = i & 15; s += o.run(state); } return s; })");
  var total = 0;
  for (var r = 0; r < rounds; r++) total += drive(list, 36, state);
  var caught = 0;
  change(K, list);
  for (var r = 0; r < rounds; r++) { try { total += drive(list, 36, state); } catch (e) { caught += e instanceof TypeError ? 1 : 100; } }
  return total + ":" + caught + ":" + state.t;
}
var other = function (s) { return 1000 + s.k + this.n; };
var out = [];

// Nothing changes; then one class's method: assigned, defined, deleted, a getter.
out.push(warm(function () {}, 300));
out.push(warm(function (K) { K[1].prototype.run = other; }, 300));
out.push(warm(function (K) { Object.defineProperty(K[3].prototype, "run", { value: other }); }, 300));
out.push(warm(function (K) { delete K[0].prototype.run; }, 20));
out.push(warm(function (K) { Object.defineProperty(K[2].prototype, "run", { get: function () { return other; } }); }, 300));
print(out.join(" ")); out = [];

// Two classes swap methods; every class gets the same one; a write that leaves them alone.
out.push(warm(function (K) { var t = K[0].prototype.run; K[0].prototype.run = K[1].prototype.run; K[1].prototype.run = t; }, 300));
out.push(warm(function (K) { for (var i = 0; i < 4; i++) K[i].prototype.run = other; }, 300));
out.push(warm(function (K) { K[2].prototype.extra = 1; K[1].prototype.run = K[1].prototype.run; }, 300));
print(out.join(" ")); out = [];

// The receivers change: an own method, another class's prototype, a prototype in between,
// a new property (another shape, the same method).
out.push(warm(function (K, list) { list[0].run = other; }, 300));
out.push(warm(function (K, list) { Object.setPrototypeOf(list[1], K[0].prototype); }, 300));
out.push(warm(function (K, list) { var mid = Object.create(K[3].prototype); mid.run = other; Object.setPrototypeOf(list[3], mid); }, 300));
out.push(warm(function (K, list) { list[2].later = 9; list[4].later = 9; }, 300));
print(out.join(" ")); out = [];

// Receivers the site never saw: a fifth class, an Array and a Proxy with a class's prototype,
// something that has no such method.
out.push(warm(function (K, list) { function E(n) { this.n = n; } E.prototype.run = function (s) { return -s.k - this.n; }; list.push(new E(8)); }, 300));
out.push(warm(function (K, list) { var odd = []; Object.setPrototypeOf(odd, K[0].prototype); odd.n = 9; list.push(odd); }, 300));
out.push(warm(function (K, list) { list.push(new Proxy(new K[1](10), { get: function (t, k, rcv) { return k === "run" ? other : Reflect.get(t, k, rcv); } })); }, 300));
out.push(warm(function (K, list) { list.push({ n: 1 }); }, 20));
print(out.join(" ")); out = [];

// A method replaces its class's method, and later another class's, while the loop runs.
function self() {
  var K = classes();
  var list = receivers(K);
  var left = 4000;
  K[1].prototype.run = function (x) {
    left--;
    if (left == 2000) K[1].prototype.run = function (y) { if (--left == 0) K[2].prototype.run = other; return this.n - y.k - 1; };
    return this.n - x.k;
  };
  var drive = eval("(function (list, n, state) { var s = 0; for (var i = 0; i < n; i++) { var o = list[i % list.length]; state.k = i & 15; s += o.run(state); } return s; })");
  var total = 0;
  var state = { k: 0, t: 0 };
  for (var r = 0; r < 900; r++) total += drive(list, 36, state);
  return total + ":" + left + ":" + state.t;
}
print(self());

// A task loop in the manner of the site this was built for: the method's result is the
// next receiver, stored in a field of the caller's object.
function Sched() { this.current = null; this.steps = 0; }
function T1(next) { this.next = next; this.v = 1; } T1.prototype.run = function (s) { s.steps += this.v; return this.next; };
function T2(next) { this.next = next; this.v = 2; } T2.prototype.run = function (s) { s.steps += this.v; return this.next; };
function T3(next) { this.next = next; this.v = 3; } T3.prototype.run = function (s) { s.steps -= 1; return this.next; };
Sched.prototype.go = function (first) {
  this.current = first;
  while (this.current != null) this.current = this.current.run(this);
};
function chain(n) { var t = null; for (var i = 0; i < n; i++) t = i % 3 == 0 ? new T1(t) : i % 3 == 1 ? new T2(t) : new T3(t); return t; }
var sched = new Sched();
for (var r = 0; r < 300; r++) sched.go(chain(30));
T2.prototype.run = function (s) { s.steps += 100; return this.next; };
for (var r = 0; r < 300; r++) sched.go(chain(30));
print(sched.steps);
