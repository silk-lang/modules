// The dispatch loop answers `key in object` itself for ordinary objects and
// arrays; everything else takes the full operator. Each case checks the
// answer against the full path: own, inherited, absent, integer and symbol
// keys, arrays, proxies, a non-object right side, and getters left unrun.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
var sym = Symbol("s");
var base = { inherited: 1 };
var o = Object.create(base); o.own = 2; o[sym] = 3; o[5] = 4;
var ran = 0;
Object.defineProperty(o, "g", { get() { ran++; return 1; }, enumerable: true });
var arr = [1, , 3];
var traps = 0;
var p = new Proxy({ x: 1 }, { has(t, k) { traps++; return k in t; } });
for (var round = 0; round < 3; round++) {
  var n = 0;
  for (var i = 0; i < 300; i++) { if ("own" in o) n++; if ("inherited" in o) n++; if ("nope" in o) n--; }
  check(n, 600, "loop");
  check(sym in o, true, "symbol key");
  check(5 in o, true, "integer key");
  check("5" in o, true, "integer string key");
  check(6 in o, false, "absent integer");
  check("g" in o, true, "getter present");
  check(ran, 0, "getter not run");
  check("toString" in o, true, "Object.prototype method");
  check(0 in arr, true, "array element");
  check(1 in arr, false, "array hole");
  check("length" in arr, true, "array length");
  check(3 in arr, false, "past array end");
  check(-1 in arr, false, "negative index");
  check("push" in arr, true, "array method");
  traps = 0;
  check("x" in p, true, "proxy has");
  check("y" in p, false, "proxy has absent");
  check(traps, 2, "proxy trap runs");
  var thrown = false;
  try { "a" in "str"; } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "string right side throws");
  thrown = false;
  try { "a" in null; } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "null right side throws");
  var key = { toString() { return "own"; } };
  check(key in o, true, "object key converts");
  check(("o" + "wn") in o, true, "built string key");
  check(("zz" + round) in o, false, "unknown built string key");
}
if (failures) throw new Error(failures + " in checks failed");
say("ok");
