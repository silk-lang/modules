// A proxy's get and set skip the target descriptor read when an ordinary target
// cannot hold the property fixed, and read the trap straight from an ordinary
// handler's own data property. Every invariant still binds.
let failures = 0;
function check(got, want, label) { if (got !== want) { failures++; console.log("FAIL", label, got, want); } }
function throwsType(f, label) { try { f(); failures++; console.log("FAIL no throw", label); } catch (e) { if (!(e instanceof TypeError)) { failures++; console.log("FAIL kind", label, e); } } }

// Plain reads and writes through traps, in a loop so the site caches settle.
var target = { a: 1, b: 2 };
var p = new Proxy(target, { get(t, k) { return t[k]; }, set(t, k, v) { t[k] = v; return true; } });
var s = 0;
for (var i = 0; i < 200; i++) { s += p.a; p.b = i; s += p.b; s += p.missing === undefined ? 1 : 0; }
check(s, 200 + 199 * 200 / 2 + 200, "plain get and set");
check(new Proxy({}, { get() { return 7; } }).anything, 7, "absent property, trap answers");
check(new Proxy({ x: 1 }, { get() { return 7; } }).x, 7, "configurable property, trap may lie");

// get: a non-configurable, non-writable data property binds the answer.
var fixed = {};
Object.defineProperty(fixed, "x", { value: 1, writable: false, configurable: false });
throwsType(() => new Proxy(fixed, { get() { return 2; } }).x, "fixed data, different value");
check(new Proxy(fixed, { get() { return 1; } }).x, 1, "fixed data, same value");
var nan = {};
Object.defineProperty(nan, "x", { value: NaN });
check(Number.isNaN(new Proxy(nan, { get() { return NaN; } }).x), true, "fixed NaN is the same value");
Object.defineProperty(nan, "z", { value: 0 });
throwsType(() => new Proxy(nan, { get() { return -0; } }).z, "fixed +0 against -0");
var writable = {};
Object.defineProperty(writable, "x", { value: 1, writable: true, configurable: false });
check(new Proxy(writable, { get() { return 2; } }).x, 2, "non-configurable but writable");

// get: a non-configurable accessor without a getter only allows undefined.
var noGetter = {};
Object.defineProperty(noGetter, "x", { set(v) {}, configurable: false });
throwsType(() => new Proxy(noGetter, { get() { return 2; } }).x, "accessor without getter");
check(new Proxy(noGetter, { get() { return undefined; } }).x, undefined, "accessor without getter, undefined");
var withGetter = {};
Object.defineProperty(withGetter, "x", { get() { return 1; }, configurable: false });
check(new Proxy(withGetter, { get() { return 2; } }).x, 2, "accessor with getter");

// set: the same two invariants after an accepted trap.
throwsType(() => { "use strict"; new Proxy(fixed, { set() { return true; } }).x = 2; }, "set fixed data, different value");
new Proxy(fixed, { set() { return true; } }).x = 1;
var noSetter = {};
Object.defineProperty(noSetter, "x", { get() { return 1; }, configurable: false });
throwsType(() => { new Proxy(noSetter, { set() { return true; } }).x = 2; }, "set accessor without setter");
new Proxy({ x: 1 }, { set() { return true; } }).x = 2;
new Proxy({}, { set() { return true; } }).x = 2;
check(Reflect.set(new Proxy({}, { set() { return false; } }), "x", 1), false, "refused set");

// The property becomes fixed while the same site keeps reading.
var live = { x: 1 };
var liveProxy = new Proxy(live, { get() { return 5; } });
function read(o) { return o.x; }
for (var i = 0; i < 50; i++) check(read(liveProxy), 5, "before freezing");
Object.freeze(live);
throwsType(() => read(liveProxy), "after freezing");
// The trap itself fixes the property before answering.
var late = { x: 1 };
throwsType(() => new Proxy(late, { get(t) { Object.defineProperty(t, "x", { value: 1, writable: false, configurable: false }); return 2; } }).x, "fixed during the trap");

// Exotic targets: array length and elements, strings, typed arrays, functions.
throwsType(() => new Proxy(Object.freeze([1, 2]), { get() { return 9; } })[0], "frozen array element");
throwsType(() => new Proxy(Object.freeze([1, 2]), { get() { return 9; } }).length, "frozen array length");
check(new Proxy([1, 2], { get() { return 9; } }).length, 9, "writable array length");
check(new Proxy([1, 2], { get() { return 9; } })[0], 9, "array element");
throwsType(() => new Proxy(new String("ab"), { get() { return "z"; } })[0], "string object character");
throwsType(() => new Proxy(new String("ab"), { get() { return 5; } }).length, "string object length");
check(new Proxy(new Uint8Array(2), { get() { return 9; } })[0], 9, "typed array element");
function fn() {}
check(new Proxy(fn, { get() { return 9; } }).prototype, 9, "function prototype is writable");
throwsType(() => new Proxy(class {}, { get() { return 9; } }).prototype, "class prototype is fixed");
check(new Proxy(fn, { get() { return 9; } }).name, 9, "function name is configurable");
check(new Proxy(function () { "use strict"; return arguments; }(), { get() { return 9; } }).callee, 9, "strict arguments callee has a getter");

// A proxy as target: its own getOwnPropertyDescriptor trap is still consulted.
var seen = [];
var inner = new Proxy({ x: 1 }, { getOwnPropertyDescriptor(t, k) { seen.push(String(k)); return Reflect.getOwnPropertyDescriptor(t, k); }, get(t, k) { return t[k]; } });
check(new Proxy(inner, { get() { return 3; } }).x, 3, "proxy target");
check(seen.join(), "x", "inner descriptor trap ran once");

// Handlers: inherited traps, accessor traps, class instances, proxies, bad traps.
class Handler { get(t, k) { return "class:" + String(k); } }
check(new Proxy({}, new Handler()).q, "class:q", "trap on the handler's prototype");
var counted = 0;
var accessorHandler = { get get() { counted++; return (t, k) => "getter:" + k; } };
check(new Proxy({}, accessorHandler).q, "getter:q", "trap behind an accessor");
check(counted, 1, "trap accessor read once per get");
var handlerLog = [];
var metaHandler = new Proxy({}, { get(t, k) { handlerLog.push(String(k)); return k === "get" ? () => "meta" : undefined; } });
check(new Proxy({}, metaHandler).q, "meta", "handler is a proxy");
check(handlerLog.join(), "get", "handler proxy asked for the trap");
check(new Proxy({ q: 4 }, { get: undefined }).q, 4, "undefined trap falls through");
check(new Proxy({ q: 4 }, { get: null }).q, 4, "null trap falls through");
throwsType(() => new Proxy({}, { get: 1 }).q, "trap is not callable");
var arrayHandler = []; arrayHandler.get = () => "array";
check(new Proxy({}, arrayHandler).q, "array", "array as handler");
var swapped = { get() { return "first"; } };
var swappedProxy = new Proxy({}, swapped);
check(swappedProxy.q, "first", "trap before replacement");
swapped.get = () => "second";
check(swappedProxy.q, "second", "trap after replacement");
delete swapped.get;
check(swappedProxy.q, undefined, "trap deleted");
var thisSeen;
var thisHandler = { get() { thisSeen = this; return 1; } };
new Proxy({}, thisHandler).q;
check(thisSeen, thisHandler, "trap receives the handler as this");
var receiverSeen;
var receiverProxy = new Proxy({}, { get(t, k, r) { receiverSeen = r; return 1; } });
Object.create(receiverProxy).q;
check(receiverSeen !== receiverProxy, true, "receiver is the inheriting object");

// Revoked proxies and symbols.
var revocable = Proxy.revocable({}, { get() { return 1; } });
check(revocable.proxy.q, 1, "before revoke");
revocable.revoke();
throwsType(() => revocable.proxy.q, "revoked get");
throwsType(() => { revocable.proxy.q = 1; }, "revoked set");
var sym = Symbol("s");
var symTarget = {};
Object.defineProperty(symTarget, sym, { value: 1 });
throwsType(() => new Proxy(symTarget, { get() { return 2; } })[sym], "fixed symbol property");
check(new Proxy({}, { get(t, k) { return typeof k; } })[sym], "symbol", "symbol key reaches the trap");
// The global object and var bindings as target.
var globalVar = 1;
check(typeof new Proxy(globalThis, { get() { return 9; } }).globalVar, "number", "global target answers");

if (failures) throw new Error(failures + " failures");
