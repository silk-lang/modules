// Stores that drop the last reference to what they displace, with and without a live
// borrow of the displaced value.
function Node(v) { this.v = v; this.next = null; this.payload = { v: v }; }
function swap(n, i) { n.payload = { v: i }; return n.payload.v; }
function keep(n, i) { var old = n.payload; n.payload = { v: i }; return old.v + n.payload.v; }
function chain(n, i) { var p = n.payload; n.payload = null; var r = p.v; n.payload = { v: i + r }; return n.payload.v; }
var n = new Node(1);
var s = 0;
for (var i = 0; i < 3000; i++) { s += swap(n, i); s += keep(n, i); s += chain(n, i) & 1023; }
print(s, n.payload.v);
// A loop whose object changes shape on the way.
function Counter() { this.count = 0; }
function run(c, times) { for (var i = 0; i < times; i++) { c.count = c.count + i; if (i == 700) c.extra = i; } return c.count; }
var total = 0;
for (var j = 0; j < 30; j++) total += run(new Counter(), 1000);
print(total);
// A getter appears where a data field was read.
function area(r) { return r.w * r.h; }
var rect = { w: 3, h: 4 };
var sum = 0;
for (var i = 0; i < 500; i++) sum += area(rect);
var lazy = { get w() { return 5; }, h: 6 };
for (var i = 0; i < 500; i++) sum += area(lazy);
var proto = Object.create({ w: 7, h: 8 });
for (var i = 0; i < 500; i++) sum += area(proto);
print(sum);
