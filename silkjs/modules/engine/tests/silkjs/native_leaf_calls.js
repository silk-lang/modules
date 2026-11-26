// Native code that calls a small JS function (a sort comparator, a callback, a
// conversion method, a proxy trap) runs it without an entry frame when the
// function is a leaf. Whatever a leaf run declines still takes the full call.
let failures = 0;
function check(got, want, label) { if (got !== want) { failures++; console.log("FAIL", label, got, want); } }

// Sort comparators: field reads, closures, this-free arrows, methods.
var objs = []; for (var i = 0; i < 200; i++) objs.push({ w: (i * 7919) % 101, id: i });
var sorted = objs.slice().sort((a, b) => a.w - b.w);
var ok = true; for (var i = 1; i < sorted.length; i++) if (sorted[i - 1].w > sorted[i].w || (sorted[i - 1].w === sorted[i].w && sorted[i - 1].id > sorted[i].id)) ok = false;
check(ok, true, "sort by field, stable");
var direction = -1;
check(objs.slice().sort((a, b) => direction * (a.w - b.w))[0].w, 100, "comparator reads a captured variable");
var calls = 0;
objs.slice().sort((a, b) => { calls = calls + 1; return a.id - b.id; });
check(calls > 0, true, "comparator writes a captured variable");
var mixed = [3, "10", 2, undefined, 1.5, , 7];
check(mixed.slice().sort((a, b) => a - b).join(), "1.5,2,3,7,10,,", "comparator over mixed values");
check([3, 1, 2].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).join(), "1,2,3", "comparator with branches");
check([3, 1, 2].sort((a, b) => ({ valueOf() { return a - b; } })).join(), "1,2,3", "comparator result converted by valueOf");
check(["b", "a", "c"].sort((a, b) => a.length - b.length).join(), "b,a,c", "comparator returning ties");
var threw = false;
try { [1, 2, 3].sort((a, b) => a.missing.field - b); } catch (e) { threw = e instanceof TypeError; }
check(threw, true, "comparator that throws");
var sawThis = [];
[2, 1].sort(function (a, b) { sawThis.push(this); return a - b; });
check(sawThis[0], globalThis, "sloppy comparator sees the global this");
var strictThis = [];
[2, 1].sort(function (a, b) { "use strict"; strictThis.push(this); return a - b; });
check(strictThis[0], undefined, "strict comparator sees undefined");
var typed = new Float64Array([3, 1, 2]);
check(typed.sort((a, b) => b - a).join(), "3,2,1", "typed array comparator");

// Conversions that call small methods.
var money = { cents: 250, valueOf() { return this.cents; }, toString() { return "$" + this.cents / 100; } };
var total = 0; for (var i = 0; i < 300; i++) total += money * 2;
check(total, 150000, "valueOf");
check(`${money}` + String(money), "$2.5$2.5", "toString");
check(money + 1, 251, "valueOf under addition");
var prim = { [Symbol.toPrimitive](hint) { return hint === "number" ? 7 : "seven"; } };
check(+prim + `${prim}`, "7seven", "Symbol.toPrimitive with its hint");
var bad = { valueOf() { return {}; }, toString() { return "fallback"; } };
check(bad + "", "fallback", "valueOf returning an object falls through to toString");
check(JSON.stringify({ a: { toJSON() { return 5; } } }), '{"a":5}', "toJSON");
check(JSON.stringify({ a: { v: 2, toJSON(key) { return key + this.v; } } }), '{"a":"a2"}', "toJSON with key and this");

// Callbacks from native iteration and friends.
check(Array.from({ length: 4 }, (_, k) => k * 2).join(), "0,2,4,6", "Array.from mapper");
var m = new Map([[1, 2], [3, 4]]); var acc = 0;
m.forEach((v, k) => { acc = acc + v * k; });
check(acc, 14, "Map.forEach callback writing a captured variable");
check("a-b-c".replace(/-/g, (s) => "+"), "a+b+c", "replace callback");
check("abc".replace(/b/, (s, at) => at), "a1c", "replace callback arguments");
check([1, 2, 3].reduce((a, b) => a + b, 0), 6, "reduce");
check(JSON.parse("[1,2,3]", (k, v) => v).length, 3, "reviver");
var holder = { n: 1, bump() { this.n = this.n + 1; return this.n; } };
check(Reflect.apply(holder.bump, holder, []), 2, "Reflect.apply of a storing method");
check(holder.n, 2, "store kept");
check(Function.prototype.call.call(function (x) { return x + 1; }, null, 4), 5, "call through call");
var settled = [];
Promise.resolve(3).then((v) => v + 1).then((v) => { settled.push(v); });

// Getters, setters and traps reached through the generic paths.
var acc2 = { _v: 1, get v() { return this._v; }, set v(x) { this._v = x; } };
check(Reflect.get(acc2, "v"), 1, "getter through Reflect.get");
Reflect.set(acc2, "v", 9);
check(acc2._v, 9, "setter through Reflect.set");
var counter = { hits: 0 };
var watched = new Proxy({ a: 1 }, { get(t, k) { counter.hits = counter.hits + 1; return 42; }, has(t, k) { return true; } });
check(watched.a + watched.b, 84, "leaf trap");
check(counter.hits, 2, "leaf trap stores");
check("zzz" in watched, true, "has trap");

// A function that stops being a leaf mid-run: stores are taken back and redone once.
var log = [];
var flaky = { n: 0, step(x) { this.n = this.n + 1; if (x > 2) { log.push(x); } return this.n; } };
var seen = [1, 2, 3, 4].map(flaky.step, flaky);
check(seen.join() + ":" + flaky.n + ":" + log.join(), "1,2,3,4:4:3,4", "declined run does not double its stores");
var flakySort = { n: 0 };
[5, 1, 4].sort((a, b) => { flakySort.n = flakySort.n + 1; if (a > 4) { String(a); } return a - b; });
check(flakySort.n >= 2, true, "comparator with a non-leaf arm");

// Fewer arguments than parameters, more arguments than parameters, defaults.
check([[1, 2]].map(([a, b]) => a + b)[0], 3, "destructuring parameter");
check([3, 1].sort((a, b, c) => (c === undefined ? a - b : 0)).join(), "1,3", "missing parameter is undefined");
check([1, 2].map((x) => x * 2, 99, 98).join(), "2,4", "extra arguments ignored");
check([1].map((x, i, arr, extra = 5) => x + extra)[0], 6, "default parameter");

// Errors thrown below a native callback keep their frames.
function thrower(a, b) { return a.x.y - b; }
var stack = "";
try { [1, 2].sort(thrower); } catch (e) { stack = e.stack; }
check(/thrower/.test(stack), true, "comparator frame in the stack");
check(settled.length, 0, "promise callbacks wait for the job queue");
Promise.resolve().then(() => 0).then(() => 0).then(() => 0).then(() => { check(settled[0], 4, "promise then callbacks"); if (failures) throw new Error(failures + " failures"); });

if (failures) throw new Error(failures + " failures");
