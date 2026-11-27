// Field reads whose holder is the prototype's prototype (constraint classes over a base
// class): the middle prototype's version proves it lacks the name. Each phase warms the
// reads up, then changes the chain in the middle of a run: the middle prototype gains the
// method, the holder's method is replaced, the middle prototype's own prototype changes,
// and a receiver's own property shadows the method.
function Base(k) { this.k = k; }
Base.prototype.weight = function () { return this.k + 1; };
Base.prototype.scale = 3;
function Mid(k) { Base.call(this, k); this.m = 1; }
Mid.prototype = Object.create(Base.prototype);
function A(k) { Mid.call(this, k); this.a = 2; }
A.prototype = Object.create(Mid.prototype);
function B(k) { Mid.call(this, k); this.b = 3; this.c = 4; }
B.prototype = Object.create(Mid.prototype);
function C(k) { Base.call(this, k); this.c = 5; }
C.prototype = Object.create(Base.prototype);
var items = [];
for (var i = 0; i < 12; i++) items.push(i % 3 == 0 ? new A(i) : (i % 3 == 1 ? new B(i) : new C(i)));
function turn(n) {
  var s = 0;
  for (var i = 0; i < items.length; i++) { var it = items[i]; s += it.weight() * it.scale + n; }
  return s;
}
function phase(change, rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) total = (total * 7 + turn(n & 7)) % 1000003;
  change();
  for (var n = 0; n < rounds; n++) total = (total * 7 + turn(n & 7)) % 1000003;
  return total;
}
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { A.prototype.weight = function () { return 100; }; }, 300));
out.push(phase(function () { Mid.prototype.weight = function () { return this.k * 2; }; }, 300));
out.push(phase(function () { Base.prototype.weight = function () { return -1; }; Base.prototype.scale = 5; }, 300));
out.push(phase(function () { Mid.prototype.scale = 7; }, 300));
out.push(phase(function () { var other = { weight: function () { return 9; }, scale: 2 }; Object.setPrototypeOf(Mid.prototype, other); }, 300));
out.push(phase(function () { items[4].weight = function () { return 1000; }; items[5].scale = 11; }, 300));
print(out.join(" "));
