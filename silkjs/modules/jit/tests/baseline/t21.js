// Checked scope slots, symbol keys and nullish branches: what Node's own modules are made of.
(function () {
  function early() { return late; }
  try { early(); print("no throw"); } catch (e) { print("early read", e.name, e.message); }
  function earlyWrite() { late = 4; }
  try { earlyWrite(); print("no throw"); } catch (e) { print("early write", e.name, e.message); }
  let late = 1;
  const kState = Symbol("state");
  const kCount = Symbol("count");
  const kMissing = Symbol("missing");
  const kGetter = Symbol("getter");
  const kMethod = Symbol("method");
  let total = 0;
  function read() { return late + total; }
  function write(v) { total = total + v; late = v; return total; }
  function Box(n) { this[kState] = { n: n }; this[kCount] = 0; }
  Box.prototype[kMethod] = function (d) { return this[kState].n + d; };
  Object.defineProperty(Box.prototype, kGetter, { get: function () { total++; return this[kCount] * 2; } });
  Box.prototype.bump = function () { this[kCount]++; this[kCount] += 2; return this[kCount]; };
  Box.prototype.state = function () { return this[kState]; };
  Box.prototype.missing = function () { return this[kMissing]; };
  Box.prototype.getter = function () { return this[kGetter]; };
  Box.prototype.call = function (d) { return this[kMethod](d); };
  Box.prototype.swap = function (v) { var old = this[kState]; this[kState] = v; return old; };
  Box.prototype.add = function (k, v) { this[k] = v; return this[k]; };
  function either(a, b) { return a ?? b; }
  function chain(o) { return o?.x?.y; }
  function assign(o) { o.v ??= 7; return o.v; }
  function key(o, k) { return o[k]; }
  function setKey(o, k, v) { o[k] = v; return o[k]; }
  var s = 0;
  var text = [];
  var frozen = Object.freeze({ [kState]: 1 });
  var proxy = new Proxy({}, { get: function (t, k) { return typeof k === "symbol" ? "trapped" : 1; }, set: function (t, k, v) { total += 100; return true; } });
  for (var i = 0; i < 300; i++) {
    var b = new Box(i);
    s += read() + write(i & 3) + b.bump() + b.state().n + b.call(2) + b.getter();
    if (b.missing() !== undefined) s += 1000000;
    var old = b.swap({ n: -i });
    s += old.n + b.state().n + b.add(Symbol.iterator, i) + b.add(kMissing, 1) + b.missing();
    s += either(null, 1) + either(undefined, 2) + either(0, 3) + either(i, 4) + either("", 5).length;
    s += (chain(null) === undefined ? 1 : 0) + (chain({}) === undefined ? 2 : 0) + chain({ x: { y: 4 } }) + assign({}) + assign({ v: 1 });
    s += key(b, kCount) + key([5, 6], 1) + key("abc", 1).length + key({ a: 3 }, "a") + setKey(b, kCount, i) + setKey({}, "q", 2) + setKey([1], 0, 3);
    if (key(proxy, kState) !== "trapped") s += 1000000;
    setKey(proxy, kState, 1);
    try { "use strict"; setKey(frozen, kState, 2); } catch (e) { s += 5; }
    s += key(frozen, kState);
    if ((i & 63) === 0) text.push(s);
  }
  print("sum", s, total, late, text.join(","));
  // A `let` in a loop body starts each turn uninitialized, and is read before it is set.
  function turns(n) {
    var out = 0;
    for (var i = 0; i < n; i++) {
      let seen;
      if (i & 1) seen = i;
      out += seen === undefined ? 1 : seen;
      let fresh = out & 7;
      out += fresh;
    }
    return out;
  }
  print("turns", turns(500));
  // Stores under names: header tables are filled this way.
  function fill(names, values) { var o = {}; for (var i = 0; i < names.length; i++) { o[names[i]] = values[i]; } return o; }
  function put(o, k, v) { o[k] = v; }
  var names = ["host", "content-length", "12", "x", "__proto__", "length", "constructor", "0x1", ""];
  var acc = 0;
  var fixedLength = [1, 2, 3];
  var sealed = Object.seal({ host: 1 });
  var setterHits = 0;
  var withSetter = Object.create({ set host(v) { setterHits += v; } });
  for (var h = 0; h < 200; h++) {
    var table = fill(names, [h, h + 1, h + 2, h + 3, { inherited: h }, h + 5, h + 6, h + 7, h + 8]);
    acc += table.host + table["content-length"] + table[12] + table.x + table.inherited + table.length + table.constructor + table["0x1"] + table[""];
    acc += Object.keys(table).length;
    put(table, "host", "again"); put(table, "new" + (h & 3), h);
    acc += table.host.length + table["new" + (h & 3)];
    put(fixedLength, "length", 2 + (h & 1)); acc += fixedLength.length;
    put(sealed, "host", h); put(sealed, "other", h); acc += sealed.host + (sealed.other === undefined ? 1 : 0);
    put(withSetter, "host", 2); acc += Object.keys(withSetter).length;
    put("text", "host", 1); put(7, "host", 1);
  }
  print("names", acc, setterHits);
  function local(n) {
    var r = 0;
    for (var i = 0; i < n; i++) {
      try { if (i === n - 1) r += dead; let dead = 2; r += dead; } catch (e) { r = e.name + " " + r; }
    }
    return r;
  }
  print("local", local(400));
})();
