// Loops inside inlined methods: the loop's poll and every guard in such a body leave with
// the body's frame, in whatever turn of the loop they fail.
function Link(v) { this.v = v; this.link = null; }
// A list walked to its end, as a queue's append is.
Link.prototype.addTo = function (queue) {
  this.link = null;
  if (queue == null) return this;
  var peek, next = queue;
  while ((peek = next.link) != null) next = peek;
  next.link = this;
  return queue;
};
function build(n) {
  var q = null;
  for (var i = 0; i < n; i++) q = new Link(i).addTo(q);
  var s = 0;
  for (var p = q; p != null; p = p.link) s = s * 3 + p.v & 0xffff;
  return s;
}
var one = 0;
for (var r = 0; r < 400; r++) one += build(r & 15);
print(one);

// A guard that fails in a late turn, after stores in earlier ones: an element's shape
// changes part way through the array.
function Item(w) { this.w = w; this.seen = 0; }
function Other(w) { this.pad = 1; this.seen = 0; this.w = w; }
function Shelf(items) { this.items = items; this.total = 0; this.walks = 0; }
Shelf.prototype.weigh = function (scale) {
  this.walks++;
  var t = 0;
  for (var i = 0; i < this.items.length; i++) {
    var it = this.items[i];
    it.seen = it.seen + 1;
    t += it.w * scale;
  }
  this.total = t;
  return t;
};
function weighAll(shelf, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += shelf.weigh(i & 3);
  return s;
}
var shelf = new Shelf([new Item(1), new Item(2), new Item(3), new Item(4)]);
var two = 0;
for (var r = 0; r < 300; r++) two += weighAll(shelf, 8);
shelf.items[2] = new Other(30);
for (var r = 0; r < 300; r++) two += weighAll(shelf, 8);
shelf.items.push(new Item(0.5));
for (var r = 0; r < 100; r++) two += weighAll(shelf, 8);
print(two, shelf.total, shelf.walks, shelf.items[0].seen, shelf.items[2].seen, shelf.items[4].seen);

// A loop whose turns call: a function with a loop of its own, and a method that is inlined
// in turn and loops.
function tri(n) { var s = 0; for (var i = 0; i <= n; i++) s += i; return s; }
function Row(n) { this.n = n; this.sums = 0; }
Row.prototype.sum = function () {
  var s = 0;
  for (var i = 0; i < this.n; i++) s += i;
  this.sums++;
  return s;
};
function Grid(rows) { this.rows = rows; this.passes = 0; }
Grid.prototype.all = function (k) {
  this.passes++;
  var s = 0;
  for (var i = 0; i < this.rows.length; i++) s += this.rows[i].sum() + tri(k);
  return s;
};
function sweep(grid, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += grid.all(i & 3);
  return s;
}
var grid = new Grid([new Row(3), new Row(5), new Row(2)]);
var three = 0;
for (var r = 0; r < 300; r++) three += sweep(grid, 6);
print(three, grid.passes, grid.rows[1].sums);

// A throw from a turn of the loop: the caller's handler takes it, the stack names the method.
function check(v, limit) { for (var i = 0; i < 1; i++) { if (v > limit) throw new Error("over " + v); } return v; }
function Batch(values) { this.values = values; this.done = 0; this.runs = 0; }
Batch.prototype.run = function (limit) {
  this.runs++;
  var s = 0;
  for (var i = 0; i < this.values.length; i++) { s += check(this.values[i], limit); this.done++; }
  return s;
};
var caught = "";
function tryBatch(batch, limit) {
  try { return batch.run(limit); } catch (e) { caught = e.stack; return -1; }
}
var batch = new Batch([1, 2, 3, 4, 5]);
var four = 0;
for (var r = 0; r < 2000; r++) four += tryBatch(batch, r % 400 == 399 ? 3 : 9);
print(four, batch.done, batch.runs);
print(caught);

// Numbers that leave int32 in a late turn, and a loop long enough for its poll to fall due.
function Counter() { this.n = 0; this.last = 0; }
Counter.prototype.grow = function (start, turns) {
  this.n++;
  var x = start;
  for (var i = 0; i < turns; i++) x = x + x - (x >> 1);
  this.last = x;
  return x;
};
function growAll(c, start, turns, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += c.grow(start + i, turns) % 1000;
  return s;
}
var counter = new Counter();
var five = 0;
for (var r = 0; r < 300; r++) five += growAll(counter, r, 5, 10);
five += growAll(counter, 3, 60, 10);
five += growAll(counter, 1.25, 4, 10);
for (var r = 0; r < 50; r++) five += growAll(counter, 1, 40000, 2) & 7;
print(five, counter.n, counter.last);
