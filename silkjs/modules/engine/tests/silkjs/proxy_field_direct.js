// Property reads on a proxy from get_field, get_loc_field8 and get_arg_field8 go
// straight to the proxy's get: traps, forwarding, revocation, invariants, keys.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function throwsType(f) { try { f(); return false; } catch (e) { return e instanceof TypeError; } }

var seen = [];
var target = { a: 1, b: 2, get g() { return this === proxy ? "receiver" : "other"; } };
var handler = { get(t, k, r) { seen.push(typeof k + ":" + String(k) + ":" + (r === proxy)); return k === "b" ? t[k] * 10 : Reflect.get(t, k, r); } };
var proxy = new Proxy(target, handler);

function viaArg(p) { return p.a + p.b; }
function viaLocal() { var p = proxy; var s = 0; for (var i = 0; i < 3; i++) s += p.a; return s; }
for (var round = 0; round < 3; round++) {
  seen.length = 0;
  check(proxy.a, 1, "field a");
  check(proxy.b, 20, "trap result");
  check(proxy.g, "receiver", "getter gets proxy receiver");
  check(proxy.missing, undefined, "missing");
  check(seen.join(" "), "string:a:true string:b:true string:g:true string:missing:true", "trap arguments");
  check(viaArg(proxy), 21, "arg field");
  check(viaLocal(), 3, "local field");

  // No get trap: the target answers, getters see the proxy.
  var plain = new Proxy(target, {});
  check(plain.a, 1, "forwarded");
  check(plain.g, "other", "forwarded getter receiver");
  check(viaArg(plain), 3, "forwarded arg");

  // A proxy of a proxy.
  var outer = new Proxy(proxy, {});
  check(outer.b, 20, "nested");

  // Revoked.
  var r = Proxy.revocable({ a: 1 }, {});
  check(r.proxy.a, 1, "before revoke");
  r.revoke();
  check(throwsType(function () { return r.proxy.a; }), true, "revoked throws");
  check(throwsType(function () { return viaArg(r.proxy); }), true, "revoked arg throws");

  // Invariant: a non-configurable, non-writable data property must report its value.
  var fixed = Object.defineProperty({}, "k", { value: 5, writable: false, configurable: false });
  var liar = new Proxy(fixed, { get() { return 6; } });
  check(throwsType(function () { return liar.k; }), true, "invariant");
  var honest = new Proxy(fixed, { get() { return 5; } });
  check(honest.k, 5, "invariant kept");

  // A trap that throws, and one that replaces the variable holding the proxy.
  var thrower = new Proxy({}, { get() { throw new RangeError("trap"); } });
  var threw = false;
  try { thrower.x; } catch (e) { threw = e instanceof RangeError; }
  check(threw, true, "trap throws");
  var holder = new Proxy({ v: 1 }, { get(t, k) { holder = null; return t[k]; } });
  check((function () { var h = holder; return h.v; })(), 1, "trap clears the holder");
  holder = new Proxy({ v: 2 }, { get(t, k) { holder = null; return t[k]; } });
  check(holder.v, 2, "trap clears the global");

  // Keys: the trap can keep the key it is given.
  var kept = [];
  var keeper = new Proxy({}, { get(t, k) { kept.push(k); return k.length; } });
  check(keeper.someLongPropertyName, 20, "key length");
  check(kept[kept.length - 1], "someLongPropertyName", "kept key");
  check(keeper[Symbol.iterator], undefined, "symbol key");
  check(keeper[7], 1, "index key");
  check(kept[kept.length - 1], "7", "index key is a string");
}
if (failures) throw new Error(failures + " proxy checks failed");
