// Constructors that keep their arguments (the engine moves them into the object), with
// objects in cycles, and method lookups at sites that see one, several and many shapes.
function Node(owner, next, n) { this.owner = owner; this.next = next; this.n = n; }
function List() { this.head = null; this.count = 0; }
List.prototype.add = function (n) { this.head = new Node(this, this.head, n); this.count++; return this; };
List.prototype.sum = function () { var s = 0; for (var p = this.head; p; p = p.next) s += p.n + (p.owner === this ? 1 : 0); return s; };
function build(k) { var l = new List(); l.add(k).add(k + 1).add(k + 2); return l.sum() + l.count; }
var a = 0;
for (var i = 0; i < 3000; i++) a += build(i & 15);
print(a);
// A constructor that throws after it was given an object, and one that takes mixed values.
function Picky(o, i) { this.o = o; if (i % 40 === 39) throw new Error("picky"); this.i = i; }
function Mixed(a, b, c, d) { this.a = a; this.b = b; this.c = c; this.d = d; }
function pick(o, i) { try { return new Picky(o, i).i; } catch (e) { return -1; } }
function mix(o, i) { var m = new Mixed(o, i, "s" + (i & 3), i * 0.5); return m.a === o ? m.b + m.c.length + m.d : -1; }
var shared = { tag: 1 };
var b = 0;
for (var i = 0; i < 3000; i++) b += pick(shared, i) + mix(shared, i) + mix({ t: i }, i);
print(b, shared.tag);
// One call site, four receiver shapes, each with its own method.
function A() { this.x = 1; } A.prototype.run = function (k) { return this.x + k; };
function B() { this.x = 2; this.y = 3; } B.prototype.run = function (k) { return this.x * this.y + k; };
function C() { this.z = 5; } C.prototype.run = function (k) { return this.z - k; };
function D() { this.w = 7; this.x = 1; this.y = 2; } D.prototype.run = function (k) { return this.w + this.x + this.y + k; };
var four = [new A(), new B(), new C(), new D()];
function runOne(t, k) { return t.run(k); }
var c = 0;
for (var i = 0; i < 4000; i++) c += runOne(four[i & 3], i & 7);
print(c);
// The same site with more shapes than it keeps, an own function, a primitive and an array.
function E() { this.q = 1; } E.prototype.run = function (k) { return 100 + k; };
var own = { run: function (k) { return 200 + k; } };
var many = [new A(), new B(), new C(), new D(), new E(), own];
for (var i = 0; i < 3000; i++) c += runOne(many[i % 6], i & 3);
function size(v) { return v.slice(1).length; }
for (var i = 0; i < 3000; i++) c += size(i & 1 ? [1, 2, 3] : "abcd");
print(c);
// A prototype that changes while the code that read from it runs.
function F() { this.v = 4; } F.prototype.get = function () { return this.v; };
function getIt(o) { return o.get(); }
var f = new F();
var d = 0;
for (var i = 0; i < 3000; i++) {
  d += getIt(f);
  if (i === 1500) F.prototype.extra = 1;
  if (i === 2000) F.prototype.get = function () { return this.v + 1; };
  if (i === 2500) f.get = function () { return 9; };
}
print(d);
