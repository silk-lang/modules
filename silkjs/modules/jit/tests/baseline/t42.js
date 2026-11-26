// A loop keeps the shapes its turns agree on: its poll changes none. Each case warms a loop
// up with an object of one shape and then changes the shape, the prototype or a watched
// method in the middle of a run of the loop.
function P(n) { this.a = n; this.b = 1; this.at = -1; }
P.prototype.touch = function (i) { if (i == this.at) this.extra = i; this.b = i & 3; };
P.prototype.read = function () { return this.a + this.b; };
var out = [];
function run(make, loop, change, rounds) {
  var total = 0;
  for (var r = 0; r < rounds; r++) total += loop(make(), 40, -1);
  for (var r = 0; r < 6; r++) { var o = make(); change(o); total += loop(o, 40, 17 + r); total += loop(o, 40, -1); }
  return total;
}
function plain() { return new P(3); }

// A property added, a property deleted, both by the loop's own code.
function grow(o, n, at) { var s = 0; for (var i = 0; i < n; i++) { if (i == at) o.c = 5; s += o.a + o.b; o.b = i & 3; } return s + (o.c | 0); }
function shrink(o, n, at) { var s = 0; for (var i = 0; i < n; i++) { if (i == at) delete o.a; s += (o.a | 0) + o.b; o.b = i & 1; } return s; }
out.push(run(plain, grow, function () {}, 300));
out.push(run(plain, shrink, function () {}, 300));

// A method the loop has inlined adds the property; an inner loop reads between the turns.
function inlined(o, n, at) { o.at = at; var s = 0; for (var i = 0; i < n; i++) { o.touch(i); s += o.read(); } return s + (o.extra | 0); }
function nested(o, n, at) { o.at = at; var s = 0; for (var i = 0; i < n; i++) { for (var j = 0; j < 3; j++) s += o.a + o.b + j; o.touch(i); } return s + (o.extra | 0); }
out.push(run(plain, inlined, function () {}, 300));
out.push(run(plain, nested, function () {}, 300));
print(out.join(" ")); out = [];

// The prototype changes in a turn; a getter takes the property's place; the object arrives
// with another shape altogether.
function Other() {} Other.prototype.touch = function (i) { this.b = 7; }; Other.prototype.read = function () { return 1000; };
function reproto(o, n, at) { var s = 0; for (var i = 0; i < n; i++) { if (i == at) Object.setPrototypeOf(o, Other.prototype); o.touch(i); s += o.read() + o.a; } return s; }
function getter(o, n, at) { var s = 0; for (var i = 0; i < n; i++) { if (i == at) Object.defineProperty(o, "a", { get: function () { return 50; } }); s += o.a + o.b; o.b = i & 3; } return s; }
out.push(run(plain, reproto, function () {}, 300));
out.push(run(plain, getter, function () {}, 300));
out.push(run(plain, grow, function (o) { o.early = 1; }, 300));
out.push(run(plain, inlined, function (o) { delete o.b; o.b = 2; }, 300));
print(out.join(" ")); out = [];

// A loop stores to a prototype every turn. In one turn it calls what makes another function
// hot, whose code takes the prototype's method for known; the stores after that turn have
// to be seen by that code.
function Q(n) { this.n = n; }
var m1 = function () { return this.n + 1; };
var m2 = function () { return this.n * 100; };
Q.prototype.m = m1; Q.prototype.hits = 0;
function callM(o, n) { var s = 0; for (var i = 0; i < n; i++) s += o.m(); return s; }
function heat(o) { var s = 0; for (var r = 0; r < 120; r++) s += callM(o, 10); return s; }
function bump(p, o, n, at) {
  var s = 0;
  for (var i = 0; i < n; i++) {
    p.hits = p.hits + 1;
    if (i == at) s += heat(o);
    if (i > at && at >= 0) p.m = (i & 4) ? m1 : m2;
    s += callM(o, 2);
  }
  return s;
}
var q = new Q(2), bumped = 0;
for (var r = 0; r < 300; r++) bumped += bump(Q.prototype, q, 30, -1);
bumped += bump(Q.prototype, q, 30, 11);
for (var r = 0; r < 300; r++) bumped += bump(Q.prototype, q, 30, 5);
print(bumped, Q.prototype.hits, q.m === undefined, Q.prototype.m === m1);

// The same with the stores in the loop that calls the method itself.
function R(n) { this.n = n; }
R.prototype.m = m1; R.prototype.k = 0;
function both(p, o, n, flip) {
  var s = 0;
  for (var i = 0; i < n; i++) { p.k = p.k + 1; s += o.m(); if (flip && (i & 7) == 7) p.m = p.m === m1 ? m2 : m1; }
  return s;
}
var rr = new R(3), bt = 0;
for (var r = 0; r < 400; r++) bt += both(R.prototype, rr, 25, false);
for (var r = 0; r < 400; r++) bt += both(R.prototype, rr, 25, r % 50 == 49);
print(bt, R.prototype.k, R.prototype.m === m1);
