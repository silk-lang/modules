// Inlined callees tested by the closure itself: the same function under another closure is
// another callee, and a body reads its variables through the closure it was called as.
function make(k) { return function (x) { return x * 2 + k + bias; }; }
var bias = 1;
function Box(v) { this.v = v; this.n = 0; }
Box.prototype.get = make(10);
Box.prototype.bump = function () { this.n++; return this.get(this.v); };
function sum(box, n) { var s = 0; for (var i = 0; i < n; i++) s += box.bump(); return s; }
var box = new Box(3);
var a = 0;
for (var r = 0; r < 400; r++) a += sum(box, 10);
bias = 5;
for (var r = 0; r < 100; r++) a += sum(box, 10);
// The method becomes another closure of the same function: other captured values.
Box.prototype.get = make(1000);
for (var r = 0; r < 400; r++) a += sum(box, 10);
// And one object has its own.
var own = new Box(4);
own.get = make(-7);
for (var r = 0; r < 400; r++) a += sum(r & 1 ? own : box, 10);
print(a, box.n, own.n);

// Two kinds whose method is one function under two closures, and a third kind with another
// function: the chain tests the function for the first two and the closure for the third.
function Kind(k) { this.k = k; this.calls = 0; }
function A(k) { Kind.call(this, k); }
function B(k) { Kind.call(this, k); }
function C(k) { Kind.call(this, k); }
A.prototype.run = make(1);
B.prototype.run = make(2);
C.prototype.run = function (x) { this.calls++; return x - this.k - bias; };
function Holder(kind) { this.kind = kind; this.count = 0; }
Holder.prototype.go = function (x) { this.count++; return this.kind.run(x); };
function drive(holders, n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += holders[i % holders.length].go(i & 7);
  return s;
}
var holders = [new Holder(new A(1)), new Holder(new B(2)), new Holder(new C(3))];
var b = 0;
for (var r = 0; r < 400; r++) b += drive(holders, 12);
C.prototype.run = make(3);
for (var r = 0; r < 400; r++) b += drive(holders, 12);
bias = -2;
A.prototype.run = function (x) { return 0 - x; };
for (var r = 0; r < 400; r++) b += drive(holders, 12);
print(b, holders[0].count, holders[2].kind.calls);

// A closure made on every call is never the one the site saw first.
function each(list, f) { var s = 0; for (var i = 0; i < list.length; i++) s += f(list[i]); return s; }
function Scaler(k) { this.k = k; }
Scaler.prototype.scale = function (list) { var k = this.k; return each(list, function (x) { return x * k; }); };
var scaler = new Scaler(3);
var c = 0;
var list = [1, 2, 3, 4];
for (var r = 0; r < 600; r++) { scaler.k = r & 3; c += scaler.scale(list); }
print(c);

// A body reads its closure's variables from their cells: a write through another closure of
// the same cell, a write by the body itself and a global assigned between calls all show.
function counter() {
  var n = 0;
  return { inc: function (by) { n += by; return n; }, get: function (x) { return n * 2 + x + bias; }, bump: function () { n = n + 1; return n + n; } };
}
var shared = counter();
function Reader() { this.reads = 0; }
Reader.prototype.read = shared.get;
Reader.prototype.bump = shared.bump;
Reader.prototype.both = function (x) { this.reads++; return this.read(x) + this.bump(); };
function readAll(reader, n) { var s = 0; for (var i = 0; i < n; i++) s += reader.both(i & 3); return s; }
var reader = new Reader();
var d = 0;
for (var r = 0; r < 500; r++) { d += readAll(reader, 8); if ((r & 7) == 0) shared.inc(r); if ((r & 63) == 0) bias = r >> 6; }
print(d, reader.reads, shared.inc(0), bias);

// A binding still in its dead zone when the body is compiled, read after it is set.
function Probe() { this.n = 0; }
Probe.prototype.peek = function () { this.n++; return this.n < 900 ? 1 : late; };
function probeAll(p, n) { var s = 0; for (var i = 0; i < n; i++) s += p.peek(); return s; }
var probe = new Probe();
var e = 0;
for (var r = 0; r < 80; r++) e += probeAll(probe, 10);
let late = 7;
for (var r = 0; r < 80; r++) e += probeAll(probe, 10);
print(e, probe.n);
