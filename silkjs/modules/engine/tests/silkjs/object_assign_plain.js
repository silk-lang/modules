// Object.assign between ordinary objects walks the source's shape without a names
// list when every [[Set]] only writes a data slot. Whatever needs the generic
// [[Set]] (setters, read-only names, frozen targets) still gets it, in key order.
let failures = 0;
function check(got, want, label) { if (got !== want) { failures++; console.log("FAIL", label, got, want); } }
function keys(o) { return Reflect.ownKeys(o).map(String).join(); }
function throwsType(f, label) { try { f(); failures++; console.log("FAIL no throw", label); } catch (e) { if (!(e instanceof TypeError)) { failures++; console.log("FAIL kind", label, e); } } }

// The benchmark shape: a fresh object with another prototype.
var proto = { hello() { return 1; } };
var total = 0;
for (var i = 0; i < 300; i++) { var o = Object.assign(Object.create(proto), { a: i, b: 2 }); total += o.a + o.b + o.hello(); }
check(total, 299 * 300 / 2 + 900, "create and assign");
check(keys(Object.assign(Object.create(proto), { a: 1, b: 2 })), "a,b", "added in order");
check(Object.getPrototypeOf(Object.assign(Object.create(proto), { a: 1 })), proto, "prototype kept");

// Existing properties are replaced in place, new ones are added after them.
var t = { b: 0, x: 9 };
Object.assign(t, { a: 1, b: 2, c: 3 });
check(keys(t), "b,x,a,c", "existing keys keep their place");
check(t.a + t.b * 10 + t.c * 100 + t.x * 1000, 9321, "values");
var d = Object.getOwnPropertyDescriptor(t, "a");
check(d.writable && d.enumerable && d.configurable, true, "added property is plain");

// Key kinds: integer keys, strings and symbols enumerate in their own order.
var sym1 = Symbol("one"), sym2 = Symbol("two");
var mixed = { z: 1 }; mixed[sym1] = 2; mixed[10] = 3; mixed.a = 4; mixed[2] = 5; mixed[sym2] = 6;
check(keys(Object.assign({}, mixed)), "2,10,z,a,Symbol(one),Symbol(two)", "mixed key order, empty target");
check(keys(Object.assign(Object.create(proto), mixed)), "2,10,z,a,Symbol(one),Symbol(two)", "mixed key order, other prototype");
var order = [];
var watched = Object.create({ set z(v) { order.push("z"); }, set a(v) { order.push("a"); }, set 2(v) { order.push("2"); }, set 10(v) { order.push("10"); } });
Object.defineProperty(Object.getPrototypeOf(watched), sym1, { set(v) { order.push("sym1"); } });
Object.assign(watched, mixed);
check(order.join(), "2,10,z,a,sym1", "setters run in key order");
check(keys(watched), "Symbol(two)", "only the name without a setter was added");

// Non-enumerable and deleted source properties.
var hidden = { a: 1, b: 2, c: 3 };
Object.defineProperty(hidden, "b", { enumerable: false });
delete hidden.a;
check(keys(Object.assign(Object.create(proto), hidden)), "c", "non-enumerable and deleted are skipped");
var many = {}; for (var i = 0; i < 40; i++) many["k" + i] = i;
for (var i = 0; i < 40; i += 3) delete many["k" + i];
var copyMany = Object.assign(Object.create(proto), many);
check(Object.keys(copyMany).length, 26, "large source with deletions");
check(copyMany.k38, 38, "large source value");

// Source accessors run, once each, in order, and may change the source.
var log = [];
var withGetter = { a: 1, get b() { log.push("b"); delete this.c; return 2; }, c: 3, d: 4 };
var got = Object.assign(Object.create(proto), withGetter);
check(log.join(), "b", "getter ran once");
check(keys(got), "a,b,d", "property deleted by a getter is skipped");

var hides = { a: 1, get b() { Object.defineProperty(this, "c", { enumerable: false }); return 2; }, c: 3, d: 4 };
check(keys(Object.assign({}, hides)), "a,b,d", "property hidden by a getter is skipped");
var spreadSource = { a: 1, get b() { delete this.c; return 2; }, c: 3, d: 4 };
check(keys({ ...spreadSource }), "a,b,d", "spread skips a property a getter deleted");
var restSource = { a: 1, get b() { delete this.c; return 2; }, c: 3, d: 4 };
var { a: restA, ...restOthers } = restSource;
check(keys(restOthers), "b,d", "rest skips a property a getter deleted");
var inheritedSource = Object.create({ c: "inherited" }, { a: { value: 1, enumerable: true, configurable: true }, b: { get() { delete this.c; return 2; }, enumerable: true, configurable: true }, c: { value: 3, enumerable: true, configurable: true } });
check(keys(Object.assign({}, inheritedSource)), "a,b", "a deleted name is not read from the prototype");
var drained = { a: 1, b: 2, c: 3 };
var draining = Object.assign(Object.create({ set a(v) { delete drained.b; } }), drained);
check(keys(draining), "c", "a target setter deletes a later source key");
var arraySource = [1, 2, 3];
var arrayDrain = Object.assign(Object.create({ set 0(v) { arraySource.length = 2; } }), arraySource);
check(keys(arrayDrain), "1", "a target setter shortens an array source");
var readded = { a: 1, get b() { delete this.c; this.c = 9; return 2; }, c: 3 };
check(Object.assign({}, readded).c, 9, "a key deleted and added again is copied");

// Targets that refuse or redirect: read-only names, setters, frozen, sealed.
var readOnly = {}; Object.defineProperty(readOnly, "b", { value: 0, writable: false, enumerable: true, configurable: true });
throwsType(() => Object.assign(readOnly, { a: 1, b: 2, c: 3 }), "read-only own property");
check(keys(readOnly) + ":" + readOnly.a + readOnly.b, "b,a:10", "keys before the failure were assigned");
var inheritedReadOnly = Object.create(Object.freeze({ b: 0 }));
throwsType(() => Object.assign(inheritedReadOnly, { a: 1, b: 2 }), "read-only inherited property");
check(keys(inheritedReadOnly), "a", "assigned up to the inherited read-only name");
var setterSeen = [];
var withSetter = { set b(v) { setterSeen.push(v); } };
Object.assign(withSetter, { a: 1, b: 2 });
check(setterSeen.join() + ":" + keys(withSetter), "2:b,a", "own setter");
throwsType(() => Object.assign(Object.freeze({ a: 0 }), { a: 1 }), "frozen target");
throwsType(() => Object.assign(Object.preventExtensions({}), { a: 1 }), "non-extensible target");
var sealed = Object.seal({ a: 0 });
check(Object.assign(sealed, { a: 5 }).a, 5, "sealed target, existing name");
throwsType(() => Object.assign(sealed, { q: 5 }), "sealed target, new name");

// A target that is a prototype: objects that inherit from it see the new names.
function Base() {}
var child = new Base();
function readNew(o) { return o.fresh; }
for (var i = 0; i < 20; i++) check(readNew(child), undefined, "before the prototype gains the name");
Object.assign(Base.prototype, { fresh: 7 });
check(readNew(child), 7, "after the prototype gains the name");

// Same object, class instances, several sources, primitives, arrays.
var self = { a: 1 }; check(Object.assign(self, self), self, "source is the target");
class Point { constructor() { this.x = 1; } get twice() { return this.x * 2; } set twice(v) { this.x = v / 2; } }
var point = Object.assign(new Point(), { y: 2, twice: 10 });
check(point.x + ":" + point.y + ":" + keys(point), "5:2:x,y", "class instance with an inherited setter");
check(keys(Object.assign({}, { a: 1 }, { b: 2 }, null, { a: 3 }, undefined, "xy")), "0,1,a,b", "several sources");
check(Object.assign([1, 2], { 0: 9, length: 1 }).length, 1, "array target");
check(keys(Object.assign({}, [7, 8])), "0,1", "array source");
check(Object.assign(function () {}, { a: 1 }).a, 1, "function target");
var holder = { inner: { v: 1 } };
var shared = Object.assign(Object.create(proto), holder);
holder.inner.v = 2; holder.inner = null;
check(shared.inner.v, 2, "object values are shared and kept alive");
var replaced = { a: { old: true } };
Object.assign(replaced, { a: 1 });
check(replaced.a, 1, "an object value is replaced");

if (failures) throw new Error(failures + " failures");
