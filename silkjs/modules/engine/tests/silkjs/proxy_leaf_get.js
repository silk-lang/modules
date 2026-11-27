// A proxy `get` trap small enough to run frameless (a leaf) answers property
// reads directly; each case checks it sees the same arguments, receiver and
// this as a full call, and that every other shape still takes the full path.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

for (var round = 0; round < 3; round++) {
  var target = { a: 1, b: "two", c: { d: 4 } };
  var p = new Proxy(target, { get(t, k) { return t[k]; } });
  check(p.a, 1, "number"); check(p.b, "two", "string"); check(p.c.d, 4, "object"); check(p.zz, undefined, "absent");
  var sum = 0; for (var i = 0; i < 500; i++) sum += p.a;
  check(sum, 500, "loop");
  var seen = null;
  var p2 = new Proxy(target, { get(t, k, r) { return r === p2 && t === target ? k : 0; } });
  check(p2.a, "a", "receiver and target"); check(p2.foo, "foo", "key");
  var h = { get(t, k) { return this === h; } };
  check(new Proxy({}, h).q, true, "this is the handler");
  // Fixed target properties: the result must match, or the read throws.
  var frozen = Object.freeze({ x: 1 });
  var thrown = false;
  try { new Proxy(frozen, { get(t, k) { return 2; } }).x; } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "invariant check");
  check(new Proxy(frozen, { get(t, k) { return t[k]; } }).x, 1, "invariant kept");
  // Integer keys arrive as strings.
  var p5 = new Proxy({ 1: "one" }, { get(t, k) { return typeof k + k; } });
  check(p5[1], "string1", "integer key"); check(p5.x, "stringx", "named key");
  // Revoked proxies throw.
  var r = Proxy.revocable({}, { get(t, k) { return 1; } });
  check(r.proxy.a, 1, "before revoke"); r.revoke();
  thrown = false; try { r.proxy.a; } catch (e) { thrown = e instanceof TypeError; } check(thrown, true, "revoked");
  // Arrow traps, inherited traps, no trap, a trap that changes.
  check(new Proxy({}, { get: (t, k) => k.length }).abcd, 4, "arrow trap");
  check(new Proxy({ v: 5 }, Object.create({ get(t, k) { return t[k] * 2; } })).v, 10, "inherited trap");
  check(new Proxy({ n: 3 }, {}).n, 3, "no trap");
  var handler = { get(t, k) { return 1; } };
  var p9 = new Proxy({}, handler);
  check(p9.k, 1, "first trap"); handler.get = function (t, k) { return 2; }; check(p9.k, 2, "replaced trap");
  delete handler.get; check(p9.k, undefined, "deleted trap");
  // A trap that is not a leaf (it loops) and one that throws.
  check(new Proxy({}, { get(t, k) { var s = 0; for (var j = 0; j < 3; j++) s += j; return s; } }).z, 3, "non-leaf trap");
  thrown = false; try { new Proxy({}, { get(t, k) { return t.missing.deep; } }).z; } catch (e) { thrown = e instanceof TypeError; }
  check(thrown, true, "throwing trap");
  // A proxy in the prototype chain.
  var child = Object.create(new Proxy({ inherited: 7 }, { get(t, k, r) { return t[k]; } }));
  check(child.inherited, 7, "proxy prototype");
}
if (failures) throw new Error(failures + " proxy leaf get checks failed");
say("ok");
