// A method read from a watched prototype is known to compiled code without the read. Every
// way the method can stop being that function has to be seen: each case warms a call site
// up, changes what the site should call, and runs it again.
function warm(make, change, rounds) {
  var objects = make();
  // A driver of its own for each case: its call sites see one shape and one function each,
  // so both methods are known. `m` is read before its argument is worked out, `z` right
  // before its call.
  var drive = eval("(function (objects, n) { var s = 0; for (var i = 0; i < n; i++) { var o = objects[i % objects.length]; s += o.m(i & 7) + o.z(); } return s; })");
  var total = 0;
  for (var r = 0; r < rounds; r++) total += drive(objects, 30);
  var caught = 0;
  change(objects);
  for (var r = 0; r < rounds; r++) { try { total += drive(objects, 30); } catch (e) { caught += e instanceof TypeError ? 1 : 100; } }
  return total + ":" + caught;
}
function fresh() {
  function K(n) { this.n = n; this.calls = 0; }
  K.prototype.m = function (x) { this.calls++; return this.n + x; };
  K.prototype.z = function () { return this.n * 2; };
  K.prototype.other = 5;
  return K;
}
function two(K) { return [new K(1), new K(2)]; }
var second = function (x) { return (x | 0) * 100 + this.n; };
var out = [];

// Assignment, definition, a getter, deletion with and without a method further up.
var K1 = fresh(); out.push(warm(function () { return two(K1); }, function () { K1.prototype.m = second; }, 300));
var K2 = fresh(); out.push(warm(function () { return two(K2); }, function () { Object.defineProperty(K2.prototype, "m", { value: second }); }, 300));
var K3 = fresh(); out.push(warm(function () { return two(K3); }, function () { Object.defineProperty(K3.prototype, "m", { get: function () { return second; } }); }, 300));
var K4 = fresh(); out.push(warm(function () { return two(K4); }, function () { delete K4.prototype.m; }, 20));
var K5 = fresh(); Object.prototype.m5 = 0;
function Base5() {} Base5.prototype.m = function (x) { return -x; };
Object.setPrototypeOf(K5.prototype, Base5.prototype);
out.push(warm(function () { return two(K5); }, function () { delete K5.prototype.m; }, 300));
delete Object.prototype.m5;
print(out.join(" ")); out = [];

// Object.assign, Reflect.set, a store through a function that stored there before, a swap.
var K6 = fresh(); out.push(warm(function () { return two(K6); }, function () { Object.assign(K6.prototype, { m: second }); }, 300));
var K7 = fresh(); out.push(warm(function () { return two(K7); }, function () { Reflect.set(K7.prototype, "m", second); }, 300));
function setM(p, f) { p.m = f; }
var K8 = fresh(); var first8 = K8.prototype.m;
for (var i = 0; i < 50; i++) setM(K8.prototype, first8);
out.push(warm(function () { return two(K8); }, function () { setM(K8.prototype, second); }, 300));
var K9 = fresh(); var L9 = fresh(); L9.prototype.m = second;
out.push(warm(function () { return two(K9); }, function () { var t = K9.prototype.m; K9.prototype.m = L9.prototype.m; L9.prototype.m = t; }, 300));
out.push(new L9(4).m(2));
print(out.join(" ")); out = [];

// The receiver changes instead: an own method, another prototype, a prototype in between.
var K10 = fresh(); out.push(warm(function () { return two(K10); }, function (o) { o[0].m = second; }, 300));
var K11 = fresh(); var L11 = fresh(); L11.prototype.m = second;
out.push(warm(function () { return two(K11); }, function (o) { Object.setPrototypeOf(o[1], L11.prototype); }, 300));
var K12 = fresh();
out.push(warm(function () { return two(K12); }, function (o) { var mid = Object.create(K12.prototype); mid.m = second; Object.setPrototypeOf(o[0], mid); }, 300));
print(out.join(" ")); out = [];

// The method without arguments, whose callee test follows its read at once: assignment,
// deletion, a getter, an own method, another prototype, and one that goes while the loop runs.
var Z1 = fresh(); out.push(warm(function () { return two(Z1); }, function () { Z1.prototype.z = second; }, 300));
var Z2 = fresh(); out.push(warm(function () { return two(Z2); }, function () { delete Z2.prototype.z; }, 20));
var Z3 = fresh(); out.push(warm(function () { return two(Z3); }, function () { Object.defineProperty(Z3.prototype, "z", { get: function () { return second; } }); }, 300));
var Z4 = fresh(); out.push(warm(function () { return two(Z4); }, function (o) { o[1].z = second; }, 300));
var Z5 = fresh(); var Y5 = fresh(); Y5.prototype.z = second;
out.push(warm(function () { return two(Z5); }, function (o) { Object.setPrototypeOf(o[0], Y5.prototype); }, 300));
var Z6 = fresh(); var left6 = 5000;
Z6.prototype.z = function () { if (--left6 == 0) Z6.prototype.z = second; return this.n * 2; };
out.push(warm(function () { return two(Z6); }, function () {}, 300));
var Z7 = fresh(); var left7 = 5000;
Z7.prototype.m = function (x) { if (--left7 == 0) Z7.prototype.z = second; return this.n + x; };
out.push(warm(function () { return two(Z7); }, function () {}, 300));
print(out.join(" ")); out = [];

// Writes to the prototype that leave the method alone: another slot, a new property, the
// same function again.
var K13 = fresh(); out.push(warm(function () { return two(K13); }, function () { K13.prototype.other = 6; }, 300));
var K14 = fresh(); out.push(warm(function () { return two(K14); }, function () { K14.prototype.added = 1; }, 300));
var K15 = fresh(); out.push(warm(function () { return two(K15); }, function () { K15.prototype.m = K15.prototype.m; }, 300));
print(out.join(" ")); out = [];

// The method replaces itself while its caller's loop runs, then the replacement does.
function Self(n) { this.n = n; this.at = 0; }
Self.prototype.m = function (x) {
  this.at++;
  if (this.at == 4000) Self.prototype.m = function (y) { if (++this.at == 6000) Self.prototype.m = second; return y - 1; };
  return x + 1;
};
function selfLoop(o, n) { var s = 0; for (var i = 0; i < n; i++) s += o.m(i & 3); return s; }
var self = new Self(7); var st = 0;
for (var r = 0; r < 400; r++) st += selfLoop(self, 25);
print(st, self.at);

// Two prototypes with the same names share a shape until one is watched: replacing the
// method of one leaves the other's.
function A(n) { this.n = n; } A.prototype.m = function (x) { return this.n + x; }; A.prototype.other = 1;
function B(n) { this.n = n; } B.prototype.m = function (x) { return this.n - x; }; B.prototype.other = 1;
function callA(o, n) { var s = 0; for (var i = 0; i < n; i++) s += o.m(i & 7); return s; }
function callB(o, n) { var s = 0; for (var i = 0; i < n; i++) s += o.m(i & 7); return s; }
var a = new A(3), b = new B(3), ab = 0;
for (var r = 0; r < 300; r++) ab += callA(a, 20) + callB(b, 20);
B.prototype.m = second;
for (var r = 0; r < 300; r++) ab += callA(a, 20) * 2 + callB(b, 20);
A.prototype.other = 2;
for (var r = 0; r < 300; r++) ab += callA(a, 20) * 3 + callB(b, 20);
print(ab, a.other, b.other);

// A class, with a field that counts on the prototype, and receivers that are not plain.
class Counter {
  constructor(n) { this.n = n; }
  m(x) { Counter.prototype.hits = Counter.prototype.hits + 1; return this.n ^ x; }
}
Counter.prototype.hits = 0;
function count(list, n) { var s = 0; for (var i = 0; i < n; i++) s += list[i % list.length].m(i & 15); return s; }
var counters = [new Counter(1), new Counter(2), new Counter(3)], ct = 0;
for (var r = 0; r < 300; r++) ct += count(counters, 21);
var odd = []; Object.setPrototypeOf(odd, Counter.prototype); odd.n = 8;
var proxied = new Proxy(new Counter(9), { get: function (t, k, rcv) { return k === "m" ? second : Reflect.get(t, k, rcv); } });
counters.push(odd); counters.push(proxied);
for (var r = 0; r < 300; r++) ct += count(counters, 25);
print(ct, Counter.prototype.hits);
