// Guards inside inlined methods that fail after the method had an effect: the call cannot
// be made again, so the rest of the method runs in a frame of its own, from the state the
// optimized code had, and the caller goes on after the call.
function Cell(v) { this.v = v; this.hits = 0; }
function Wide(v) { this.pad = 0; this.hits = 0; this.v = v; }
function Box(cell) { this.cell = cell; this.count = 0; this.last = null; }
// One level: a store, then a read of another object whose shape changes late.
Box.prototype.take = function (extra) {
  this.count++;
  var c = this.cell;
  c.hits = c.hits + 1;
  return c.v + extra;
};
function drive(box, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += box.take(i & 3);
  return s;
}
var box = new Box(new Cell(7));
var sum = 0;
for (var r = 0; r < 300; r++) sum += drive(box, 20);
box.cell = new Wide(9);
for (var r = 0; r < 300; r++) sum += drive(box, 20);
print(sum, box.count, box.cell.hits);

// Two levels: the outer method counts, the inner one stores and then reads through a
// receiver whose shape changes; the outer goes on with what the inner returns.
function Leaf(w) { this.w = w; this.n = 0; }
function Odd(w) { this.q = 1; this.n = 0; this.w = w; }
function Mid(leaf) { this.leaf = leaf; this.calls = 0; }
Mid.prototype.weigh = function (k) {
  this.calls++;
  var leaf = this.leaf;
  leaf.n = leaf.n + k;
  return leaf.w * 2;
};
function Top(mid) { this.mid = mid; this.steps = 0; this.acc = 0; }
Top.prototype.step = function (k, unused) {
  this.steps++;
  var w = this.mid.weigh(k) + 1;
  this.acc = this.acc + w;
  return w;
};
function climb(top, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += top.step(i);
  return s;
}
var top = new Top(new Mid(new Leaf(5)));
var up = 0;
for (var r = 0; r < 300; r++) up += climb(top, 10);
top.mid.leaf = new Odd(6);
for (var r = 0; r < 300; r++) up += climb(top, 10);
top.mid = { leaf: new Leaf(1), calls: 0, weigh: Mid.prototype.weigh };
for (var r = 0; r < 100; r++) up += climb(top, 10);
print(up, top.steps, top.acc, top.mid.calls, top.mid.leaf.n);

// The rest of the method throws: the caller's handler sees it, the frames are all named.
function Gate(inner) { this.inner = inner; this.opened = 0; }
Gate.prototype.open = function () {
  this.opened++;
  return this.inner.value.length;
};
function pass(gate) {
  try { return gate.open(); } catch (e) { return -(e instanceof TypeError ? 1 : 2) - e.stack.split("\n").length * 10; }
}
var gate = new Gate({ value: "abc" });
var got = 0;
for (var r = 0; r < 2000; r++) got += pass(gate);
gate.inner = { other: 1, value: undefined };
for (var r = 0; r < 5; r++) got += pass(gate);
gate.inner = { value: "four" };
for (var r = 0; r < 100; r++) got += pass(gate);
print(got, gate.opened);

// Arithmetic that leaves int32 after a store, with locals and operands live in the method.
function Tally() { this.n = 0; this.total = 0; }
Tally.prototype.add = function (a, b) {
  this.n++;
  var twice = a + a;
  var both = twice + b;
  this.total = both;
  return both - 1;
};
function tally(t, a, b, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s = (s + t.add(a + i, b)) % 1000003;
  return s;
}
var t = new Tally();
var kept = 0;
for (var r = 0; r < 300; r++) kept += tally(t, r, 3, 10);
kept += tally(t, 1073741820, 5, 10);
kept += tally(t, 1.5, 2, 10);
for (var r = 0; r < 100; r++) kept += tally(t, r, 3, 10);
print(kept, t.n, t.total);

// Fewer and more arguments than the method declares.
function Pair() { this.sets = 0; this.a = 0; }
Pair.prototype.set = function (a, b) {
  this.sets++;
  this.a = a;
  if (b === undefined) return a.x;
  return a.x + b;
};
function pairs(p, o, n) {
  var s = 0;
  for (var i = 0; i < n; i++) { s += p.set(o); s += p.set(o, 2, i); }
  return s;
}
var p = new Pair();
var q = 0;
for (var r = 0; r < 300; r++) q += pairs(p, { x: 1 }, 5);
for (var r = 0; r < 300; r++) q += pairs(p, { y: 0, x: 2 }, 5);
print(q, p.sets);
