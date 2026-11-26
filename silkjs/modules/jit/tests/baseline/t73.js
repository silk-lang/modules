// Regression tests for:
// 1. Int32 zero-product arithmetic in baseline must not mark sites as float64 double sites,
//    while true -0.0 products still produce -0.0.
// 2. Inlined Op.NewObject non-deopting slow path when spare/recyclable cells are exhausted
//    (live-retained objects and cyclic graphs, at both depth 0 and inside inlined callees).

function mulLoop(arr, x) {
  var xl = x & 0x3fff;
  var xh = x >> 14;
  var c = 0;
  for (var i = 0; i < arr.length; i++) {
    var l = arr[i] & 0x3fff;
    var h = arr[i] >> 14;
    var m = xh * l + h * xl;
    c = (c + m + xh * h) | 0;
  }
  return c;
}

function negZeroMul(a, b) {
  return a * b;
}

var data = [];
for (var i = 0; i < 64; i++) data.push((i % 3 === 0) ? 0 : (i * 12345) & 0xfffffff);
var sum = 0;
for (var r = 0; r < 200; r++) {
  sum = (sum + mulLoop(data, (r % 5 === 0) ? 0 : (r * 77 + 1))) | 0;
}

var nz = 0;
for (var r = 0; r < 100; r++) {
  var v = negZeroMul(r === 90 ? -1 : 1, 0);
  if (1 / v === -Infinity) nz++;
}

function Node(a, b, c) {
  this.a = a;
  this.b = b;
  this.c = c;
}

function Pair(car, cdr) {
  this.car = car;
  this.cdr = cdr;
}

function OptNode(x, y) {
  this.x = x || 0;
  this.y = y || 0;
}

function makeInlined(a, b, c) {
  return new Node(a, b, c);
}

function buildLive() {
  var live = [];
  for (var i = 0; i < 400; i++) {
    var n = makeInlined(i, i + 1, null);
    var p = new Pair(n, i);
    var o = new OptNode(i % 2 === 0 ? 0 : i, i + 2);
    // Reference cycle so refcounting leaves objects alive until GC.
    n.c = p;
    live.push(p);
    live.push(o);
  }
  var acc = 0;
  for (var j = 0; j < live.length; j += 2) {
    acc += live[j].car.a + live[j].cdr + live[j + 1].x + live[j + 1].y;
  }
  return acc;
}

var total = 0;
for (var k = 0; k < 40; k++) {
  total += buildLive();
}

print(sum, nz, total);
