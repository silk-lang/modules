// Calls that an inlined method makes itself: the callee's frame hangs under the method's
// activation, which error stacks name; a throw unwinds through it; natives and callees
// that are no functions take the same path.
function sumTo(n) { var s = 0; for (var i = 0; i < n; i++) s += i; return s; }
function Acc(step) { this.step = step; this.total = 0; this.calls = 0; }
// One level: a store, a call of a function with a loop, a store of what it answers.
Acc.prototype.add = function (n) {
  this.calls++;
  var got = sumTo(n) + this.step;
  this.total = this.total + got;
  return got;
};
function run1(acc, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += acc.add(i & 7);
  return s;
}
var acc = new Acc(2);
var one = 0;
for (var r = 0; r < 300; r++) one += run1(acc, 16);
print(one, acc.total, acc.calls);

// Two levels, and a method call with a receiver: the innermost calls a method that loops.
function Bag() { this.items = [1, 2, 3]; this.reads = 0; }
Bag.prototype.count = function (extra) {
  var n = 0;
  for (var i = 0; i < this.items.length; i++) n += this.items[i];
  this.reads++;
  return n + extra;
};
function Inner(bag) { this.bag = bag; this.seen = 0; }
Inner.prototype.look = function (k) { this.seen++; return this.bag.count(k) * 2; };
function Outer(inner) { this.inner = inner; this.asked = 0; }
Outer.prototype.ask = function (k) { this.asked++; return this.inner.look(k + 1) + 1; };
function run2(outer, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += outer.ask(i);
  return s;
}
var outer = new Outer(new Inner(new Bag()));
var two = 0;
for (var r = 0; r < 300; r++) two += run2(outer, 10);
outer.inner.bag.items.push(4);
for (var r = 0; r < 50; r++) two += run2(outer, 10);
print(two, outer.asked, outer.inner.seen, outer.inner.bag.reads);

// The callee throws, or only reads its stack: the inlined method's frame is in both, and
// the caller's handler takes the throw.
function fail(k) { for (var i = 0; i < 1; i++) { if (k > 2) throw new Error("k" + k); } return new Error("s").stack; }
function Risk() { this.tries = 0; this.last = ""; }
Risk.prototype.attempt = function (k) {
  this.tries++;
  var stack = fail(k);
  this.last = stack;
  return stack.split("\n").length;
};
function run3(risk, k) {
  try { return risk.attempt(k); } catch (e) { return -e.stack.split("\n").length; }
}
var risk = new Risk();
var three = 0;
for (var r = 0; r < 2000; r++) three += run3(risk, r & 1);
print(three, risk.tries);
print(risk.last);
var thrown = "";
function run3b(risk, k) { try { return risk.attempt(k); } catch (e) { thrown = e.stack; return 0; } }
for (var r = 0; r < 2000; r++) run3b(risk, r % 500 == 499 ? 3 : 0);
print(thrown);

// A native callee, and a callee that stops being a function.
function Clamp(lo) { this.lo = lo; this.n = 0; this.fn = Math.abs; }
Clamp.prototype.fit = function (x) {
  this.n++;
  var m = Math.max(x, this.lo);
  return m + this.fn(-x);
};
function run4(c, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += c.fit(i - 3);
  return s;
}
var clamp = new Clamp(1);
var four = 0;
for (var r = 0; r < 300; r++) four += run4(clamp, 8);
clamp.fn = function (x) { for (var i = 0; i < 1; i++) x += 1; return x; };
for (var r = 0; r < 300; r++) four += run4(clamp, 8);
clamp.fn = 5;
try { run4(clamp, 8); } catch (e) { four += e instanceof TypeError ? 1000000 : 0; }
print(four, clamp.n);

// Recursion through an inlined method runs out of stack and unwinds.
function Deep() { this.d = 0; this.max = 0; }
Deep.prototype.down = function (n) {
  this.d++;
  if (this.d > this.max) this.max = this.d;
  var r = descend(this, n - 1);
  this.d--;
  return r + 1;
};
function descend(deep, n) {
  for (var i = 0; i < 1; i++) { if (n <= 0) return 0; }
  return deep.down(n);
}
var deep = new Deep();
var five = 0;
for (var r = 0; r < 200; r++) five += descend(deep, 20);
var over = 0;
try { descend(deep, 10000000); } catch (e) { over = e instanceof RangeError ? 1 : 2; }
deep.d = 0;
five += descend(deep, 30);
print(five, deep.max > 20, over, deep.d);
