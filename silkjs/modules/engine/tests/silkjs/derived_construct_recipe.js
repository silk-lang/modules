// Derived class constructors of the form `super(...); this.f = ...` built
// without a frame from their own recipe joined with the parent's, checked
// against what the frame path gives in cases the join must decline or follow.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function show(o) { return JSON.stringify(o) + "/" + Object.keys(o).join(","); }

class Pt { constructor(x, y) { this.x = x; this.y = y; } }
class Pt3 extends Pt { constructor(x, y, z) { super(x, y); this.z = z; } }
class Swap extends Pt { constructor(a, b) { super(b, a); this.sum = 1; this.flag = !a; } }
class Few extends Pt { constructor(a) { super(a); this.k = 5; } }
class Opt { constructor(x) { this.x = x ? x : 0; this.y = !x; } }
class OptChild extends Opt { constructor(x, w) { super(x); this.w = w; } }
class Again extends Pt { constructor(x) { super(x, 2); this.x = 9; } }
function Plain(a) { this.a = a; }
class FromPlain extends Plain { constructor(a, b) { super(a); this.b = b; } }
class Deep extends Pt3 { constructor(x) { super(x, x, x); this.d = 4; } }

for (var round = 0; round < 3; round++) {
  for (var i = 0; i < 300; i++) {
    var p = new Pt3(i, "s" + i, { n: i });
    if (p.x !== i || p.y !== "s" + i || p.z.n !== i || Object.getPrototypeOf(p) !== Pt3.prototype) { check(show(p), "", "Pt3 " + i); break; }
  }
  check(show(new Pt3(1, 2, 3)), '{"x":1,"y":2,"z":3}/x,y,z', "Pt3 keys");
  check(show(new Pt3(7)), '{"x":7}/x,y,z', "Pt3 missing arguments");
  check(new Pt3(1, 2, 3, 4).z, 3, "Pt3 extra argument");
  check(show(new Swap(0, 8)), '{"x":8,"y":0,"sum":1,"flag":true}/x,y,sum,flag', "Swap");
  check(Object.keys(new Few(3)).join(","), "x,y,k", "Few keys");
  check(new Few(3).y, undefined, "Few undefined argument");
  check(show(new OptChild(0, "w")), '{"x":0,"y":true,"w":"w"}/x,y,w', "OptChild falsy");
  check(show(new OptChild(5, 1)), '{"x":5,"y":false,"w":1}/x,y,w', "OptChild truthy");
  check(show(new Again(1)), '{"x":9,"y":2}/x,y', "store again");
  check(show(new FromPlain(1, 2)), '{"a":1,"b":2}/a,b', "plain parent");
  check(show(new Deep(6)), '{"x":6,"y":6,"z":6,"d":4}/x,y,z,d', "two levels");
  check(new Deep(1) instanceof Pt3 && new Deep(1) instanceof Pt, true, "two levels chain");
}

// One derived body under several parents (a class factory).
function mixin(Base) { return class extends Base { constructor(a, b) { super(a, b); this.m = a; } }; }
class P1 { constructor(a, b) { this.p = a; this.q = b; } }
class P2 { constructor(a, b) { this.q = b; this.r = 1; this.s = a; } }
var M1 = mixin(P1), M2 = mixin(P2);
for (var i = 0; i < 200; i++) {
  var one = new M1(i, 2), two = new M2(i, 3);
  if (show(one) !== JSON.stringify({ p: i, q: 2, m: i }) + "/p,q,m") { check(show(one), "", "mixin P1 " + i); break; }
  if (show(two) !== JSON.stringify({ q: 3, r: 1, s: i, m: i }) + "/q,r,s,m") { check(show(two), "", "mixin P2 " + i); break; }
}
// Many factory classes, made and dropped.
for (var i = 0; i < 100; i++) {
  var Base = class { constructor(a) { this.base = a; } };
  var Made = mixin(Base);
  var made = new Made(i, 0);
  if (made.base !== i || made.m !== i) { check(show(made), "", "factory " + i); break; }
  if (typeof gc === "function" && i % 25 === 0) gc();
}

// A setter on the prototype chain sees the store.
var seen = [];
class Watched { constructor(v) { this.v = v; } }
class WatchedChild extends Watched { constructor(v) { super(v); this.w = v; } }
for (var i = 0; i < 50; i++) new WatchedChild(i);
Object.defineProperty(Watched.prototype, "w", { set: function (x) { seen.push(x); }, configurable: true });
var watched = new WatchedChild(42);
check(seen.join(","), "42", "setter runs");
check(Object.keys(watched).join(","), "v", "setter keeps own keys");
delete Watched.prototype.w;
Object.defineProperty(WatchedChild.prototype, "v", { set: function (x) { seen.push("v" + x); }, configurable: true });
var watched2 = new WatchedChild(5);
check(seen.join(","), "42,v5", "setter on the derived prototype");
check(Object.keys(watched2).join(","), "w", "setter on the derived prototype keys");
delete WatchedChild.prototype.v;
check(Object.keys(new WatchedChild(1)).join(","), "v,w", "setters removed");

// Changing the parent after warm-up.
class Old { constructor(a) { this.old = a; } }
class New { constructor(a) { this.fresh = a; this.two = 2; } }
class Moving extends Old { constructor(a) { super(a); this.own = 1; } }
for (var i = 0; i < 100; i++) new Moving(i);
check(show(new Moving(3)), '{"old":3,"own":1}/old,own', "before parent change");
Object.setPrototypeOf(Moving, New);
check(show(new Moving(4)), '{"fresh":4,"two":2,"own":1}/fresh,two,own', "after parent change");
Object.setPrototypeOf(Moving, function () { this.called = true; });
check(show(new Moving(5)), '{"called":true,"own":1}/called,own', "function parent");
Object.setPrototypeOf(Moving, Math.max);
var threw = false; try { new Moving(1); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "non-constructor parent throws");
Object.setPrototypeOf(Moving, Old);
check(show(new Moving(6)), '{"old":6,"own":1}/old,own', "parent back");

// Another new.target, fields, private names and early this keep the frame path.
class Other { }
Other.prototype.tag = "other";
var r = Reflect.construct(Pt3, [1, 2, 3], Other);
check(Object.getPrototypeOf(r) === Other.prototype && r.z === 3 && r.x === 1, true, "Reflect.construct new.target");
class WithField extends Pt { f = 10; constructor(x) { super(x, 1); this.g = 2; } }
class ParentField { pf = "pf"; constructor(a) { this.a = a; } }
class ChildOfField extends ParentField { constructor(a) { super(a); this.b = 1; } }
class Private extends Pt { #h = 1; constructor(x) { super(x, 0); this.q = 3; } get h() { return this.#h; } }
class Early extends Pt { constructor(x) { try { this.e = 1; } catch (e) { } super(x, 1); this.z = 3; } }
for (var i = 0; i < 3; i++) {
  check(show(new WithField(1)), '{"x":1,"y":1,"f":10,"g":2}/x,y,f,g', "derived field");
  check(show(new ChildOfField(1)), '{"pf":"pf","a":1,"b":1}/pf,a,b', "parent field");
  check(new Private(1).h + new Private(2).q, 4, "private field");
  check(show(new Early(1)), '{"x":1,"y":1,"z":3}/x,y,z', "this before super");
}
class TooMany extends Pt { constructor(a, b, c, d, e) { super(e, d); this.c = c; } }
check(show(new TooMany(1, 2, 3, 4, 5)), '{"x":5,"y":4,"c":3}/x,y,c', "five arguments");
class Self extends Pt { constructor(x) { super(x, 1); this.me = x; } }
var s = new Self(1);
check(s.me === 1 && s.x === 1, true, "self");
class Bad extends Pt { constructor(x) { super(x, 1); super(x, 2); } }
threw = false; try { new Bad(1); } catch (e) { threw = e instanceof ReferenceError; }
check(threw, true, "second super throws");
class Frozen extends Pt { constructor(x) { super(x, 1); this.z = 3; } }
Object.preventExtensions(Frozen.prototype);
check(show(new Frozen(2)), '{"x":2,"y":1,"z":3}/x,y,z', "non-extensible prototype");

if (failures) throw new Error(failures + " derived construct checks failed");
say("ok");
