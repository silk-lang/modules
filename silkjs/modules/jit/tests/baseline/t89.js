// Local functions that are only ever called (the engine keeps their bytecode in the scope,
// with no closure) inlined into one another where the call passes literal numbers: the body
// reads its scope (the caller's chain), calls its siblings from there, and leaves for the
// interpreter in the middle. The scope is on the heap when a closure captured it and in
// its frame when none did; both must give what the interpreter gives.

function Field(width, height) {
  var rowSize = width + 2;
  var size = (width + 2) * (height + 2);
  var rounds = 3;
  var calls = 0;
  function edge(b, x) {
    calls++;
    for (var i = 1; i <= width; i++) {
      x[i] = b === 1 ? -x[i + rowSize] : x[i + rowSize];
      x[i + (height + 1) * rowSize] = b === 2 ? -x[i + height * rowSize] : x[i + height * rowSize];
    }
  }
  function solve(b, x, x0, a, c) {
    if (a === 0 && c === 1) {
      for (var j = 1; j <= height; j++) {
        var row = j * rowSize;
        for (var i = 1; i <= width; i++) { ++row; x[row] = x0[row]; }
      }
      edge(b, x);
      return 0;
    }
    var invC = 1 / c;
    for (var k = 0; k < rounds; k++) {
      for (var j = 1; j <= height; j++) {
        var last = (j - 1) * rowSize, cur = j * rowSize, next = (j + 1) * rowSize;
        var lastX = x[cur];
        ++cur;
        for (var i = 1; i <= width; i++) lastX = x[cur] = (x0[cur] + a * (lastX + x[++cur] + x[++last] + x[++next])) * invC;
      }
      edge(b, x);
    }
    return k;
  }
  function scale(x, by, plus) {
    var s = 0;
    for (var i = 0; i < size; i++) { x[i] = x[i] * by + plus; s += x[i]; }
    return s;
  }
  function step(x, x0) {
    var n = solve(0, x, x0, 1, 4);
    n += solve(1, x0, x, 0, 1);
    return n + scale(x, 0.5, 0.125) + scale(x0, 0.5, 2);
  }
  function fresh(seed) {
    var x = [];
    for (var i = 0; i < size; i++) x[i] = ((i * seed) % 7) * 0.25;
    return x;
  }
  this.step = function (x, x0) { return step(x, x0); };
  this.fresh = fresh;
  this.calls = function () { return calls; };
  this.setRounds = function (n) { rounds = n; };
}

// The same shape with nothing capturing the scope: it stays in the frame of `inFrame`.
function inFrame(width, x, x0, turns) {
  var total = 0;
  var bias = 0.5;
  function fold(a, c, from) {
    var s = 0;
    for (var i = from; i < width; i++) s += (x0[i] + a * x[i]) * c + bias;
    return s + tail(2, from);
  }
  function tail(k, from) {
    return x[from] * k + bias;
  }
  for (var t = 0; t < turns; t++) total += fold(1, 4, t % 3) + fold(0, 1, 1);
  return total;
}

// A closure that is inlined calls a local function of its own with literals: the local
// function's scope is not on the chain of the code that inlined the closure.
function Counter(start) {
  var held = start;
  function bump(by, times) {
    for (var i = 0; i < times; i++) held += by;
    return held;
  }
  this.twice = function () { return bump(2, 3) + bump(1, 1); };
}
function drive(counter, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += counter.twice();
  return s;
}

// A body that throws, and one whose callee throws: the error passes the inlined frames.
function Thrower(limit) {
  var seen = 0;
  function check(v, top) {
    seen++;
    if (v > top) throw new RangeError("over " + top + " after " + seen);
    return v;
  }
  function both(v, top) {
    return check(v, 100) + check(v * 2, top);
  }
  this.run = function (v) { return both(v, 50) + check(v, limit); };
}

var field = new Field(12, 9);
var x = field.fresh(3), x0 = field.fresh(5);
var total = 0;
for (var k = 0; k < 120; k++) total += field.step(x, x0);
print(total, field.calls());
// The loop bound the body reads from its scope changes under it.
field.setRounds(5);
for (var k = 0; k < 40; k++) total += field.step(x, x0);
print(total, field.calls());
// What the inlined loop was compiled for stops holding: a string, an object with valueOf
// and null among the numbers.
x0[30] = "7";
total += field.step(x, x0);
x[41] = { valueOf: function () { return 3; } };
total += field.step(x, x0);
x0[55] = null;
print(String(field.step(x, x0)), field.calls());
for (var k = 0; k < 60; k++) field.step(field.fresh(k + 2), field.fresh(k + 9));
print(field.calls());

var y = [], y0 = [];
for (var i = 0; i < 40; i++) { y[i] = i * 0.5; y0[i] = 40 - i; }
print(inFrame(40, y, y0, 150));
y[7] = "3";
print(inFrame(40, y, y0, 150));
print(inFrame(40, y0, y, 3));

var counter = new Counter(1);
print(drive(counter, 200), drive(counter, 1));

var thrower = new Thrower(1000);
var caught = 0, sum = 0;
for (var k = 0; k < 200; k++) {
  try { sum += thrower.run(k % 40); } catch (e) { caught++; if (caught === 1) print(e.name, e.message); }
}
print(sum, caught);
