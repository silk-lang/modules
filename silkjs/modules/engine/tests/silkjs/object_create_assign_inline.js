// Object.create(p) and Object.assign(target, source) answered without a
// native frame, checked against the cases that must take the full call.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function show(o) { return JSON.stringify(o) + "/" + Object.keys(o).join(","); }

var proto = { hello() { return 1; } };
for (var round = 0; round < 3; round++) {
  for (var i = 0; i < 300; i++) {
    var o = Object.assign(Object.create(proto), { a: i, b: 2 });
    if (o.a !== i || o.b !== 2 || o.hello() !== 1 || Object.getPrototypeOf(o) !== proto) { check(show(o), "", "create+assign " + i); break; }
  }
  var n = Object.create(null);
  check(Object.getPrototypeOf(n), null, "null prototype");
  check(Object.keys(Object.assign(n, { x: 1 })).join(","), "x", "assign into null-prototype object");
  var threw = false; try { Object.create(1); } catch (e) { threw = e instanceof TypeError; }
  check(threw, true, "number prototype throws");
  threw = false; try { Object.create(undefined); } catch (e) { threw = e instanceof TypeError; }
  check(threw, true, "undefined prototype throws");
  check(Object.create(proto, { z: { value: 3, enumerable: true } }).z, 3, "create with properties");
  var t = { a: 1 };
  check(Object.assign(t, { b: 2, a: 3 }), t, "assign returns target");
  check(show(t), '{"a":3,"b":2}/a,b', "assign into non-empty target");
  check(show(Object.assign({}, "ab")), '{"0":"a","1":"b"}/0,1', "string source");
  check(show(Object.assign({}, null)), "{}/", "null source");
  check(typeof Object.assign(1, { a: 1 }), "object", "primitive target boxes");
  var arr = Object.assign([1, 2], { 0: 9 });
  check(arr.join(","), "9,2", "array target");
  check(show(Object.assign({}, [7, 8])), '{"0":7,"1":8}/0,1', "array source");
  var same = { q: 1 };
  check(show(Object.assign(same, same)), '{"q":1}/q', "same object");
}

// A setter on the target's prototype chain sees the store.
var seen = [];
var watched = { set a(v) { seen.push(v); } };
for (var i = 0; i < 50; i++) Object.assign(Object.create(watched), { a: i });
check(seen.length, 50, "setter on prototype runs");
check(Object.keys(Object.assign(Object.create(watched), { a: 1, b: 2 })).join(","), "b", "setter keeps key off target");
// A setter or read-only property added to the chain after warm-up.
var late = {}, lateSeen = [];
for (var i = 0; i < 50; i++) Object.assign(Object.create(late), { a: i, zz: i });
Object.defineProperty(late, "a", { set: function (v) { lateSeen.push(v); }, configurable: true });
check(Object.keys(Object.assign(Object.create(late), { a: 7, zz: 1 })).join(","), "zz", "setter added to prototype");
delete late.a;
check(Object.keys(Object.assign(Object.create(late), { a: 8, zz: 1 })).join(","), "a,zz", "setter removed");
Object.defineProperty(Object.prototype, "zz", { set: function (v) { lateSeen.push("zz" + v); }, configurable: true });
check(Object.keys(Object.assign(Object.create(late), { a: 9, zz: 2 })).join(","), "a", "setter on Object.prototype");
delete Object.prototype.zz;
Object.defineProperty(late, "zz", { value: 0, writable: false, configurable: true });
threw = false; try { Object.assign(Object.create(late), { a: 1, zz: 3 }); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "read-only added to prototype");
delete late.zz;
check(Object.keys(Object.assign(Object.create(late), { a: 1, zz: 4 })).join(","), "a,zz", "chain clean again");
check(lateSeen.join(","), "7,zz2", "late setters ran");
// A getter on the source runs.
var calls = 0;
var getterSource = { get g() { calls++; return 5; } };
for (var i = 0; i < 20; i++) check(Object.assign({}, getterSource).g, 5, "getter value");
check(calls, 20, "getter runs");
// Non-enumerable and symbol keys.
var hidden = Object.defineProperty({ v: 1 }, "h", { value: 2, enumerable: false });
var sym = Symbol("s"); hidden[sym] = 3;
var copied = Object.assign({}, hidden);
check(Object.keys(copied).join(",") + ":" + copied[sym] + ":" + copied.h, "v:3:undefined", "enumerable own keys only");
// Frozen and non-extensible targets throw.
var frozen = Object.freeze({ a: 1 });
var threw = false; try { Object.assign(frozen, { a: 2 }); } catch (e) { threw = e instanceof TypeError; }
check(threw && frozen.a === 1, true, "frozen target throws");
var sealed = Object.preventExtensions({});
threw = false; try { Object.assign(sealed, { b: 1 }); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "non-extensible target throws");
// A read-only property on the prototype blocks the store.
var readOnly = Object.defineProperty({}, "r", { value: 1, writable: false });
threw = false; try { Object.assign(Object.create(readOnly), { r: 2 }); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "read-only prototype property throws");
// Proxy target and source.
var log = [];
var px = new Proxy({}, { set(t, k, v) { log.push("set " + String(k)); t[k] = v; return true; } });
Object.assign(px, { a: 1 });
var ps = new Proxy({ b: 2 }, { ownKeys(t) { log.push("keys"); return Reflect.ownKeys(t); } });
Object.assign({}, ps);
check(log.join(","), "set a,keys", "proxies");
// An object used as a prototype as the target.
var base = {};
var child = Object.create(base);
Object.assign(base, { m: 4 });
check(child.m, 4, "prototype target");
// Calls through call and apply, and a non-method call.
var create = Object.create, assign = Object.assign;
check(Object.getPrototypeOf(create(proto)), proto, "detached create");
check(show(assign({}, { k: 1 })), '{"k":1}/k', "detached assign");
check(Object.create.call(null, proto).hello(), 1, "create via call");
check(show(Object.assign.apply(null, [{}, { j: 2 }])), '{"j":2}/j', "assign via apply");
// Three arguments take the full call.
check(show(Object.assign({}, { a: 1 }, { b: 2 })), '{"a":1,"b":2}/a,b', "two sources");
// Results stay alive across collections.
var kept = [];
for (var i = 0; i < 200; i++) { kept.push(Object.assign(Object.create(proto), { i: i })); if (typeof gc === "function" && i % 50 === 0) gc(); }
check(kept[199].i + kept[0].i, 199, "kept results");

if (failures) throw new Error(failures + " create/assign checks failed");
say("ok");
