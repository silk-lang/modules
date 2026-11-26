// Captured variables up the scope chain, lengths of every kind of value, try and finally.
(function () {
  let outer = 1;
  const fixed = 10;
  function level1(n) {
    let mid = n;
    function level2(k) {
      let low = k;
      function level3() { return outer + fixed + mid + low + late3; }
      let late3 = 5;
      return level3;
    }
    return level2;
  }
  function tdz() { function peek() { return hidden; } try { return peek(); } catch (e) { return e.name; } finally { outer++; } let hidden = 1; }
  var s = 0;
  for (var i = 0; i < 200; i++) { s += level1(i)(i & 3)(); outer = i & 7; }
  print("captured", s, tdz(), outer);

  function len(v) { return v.length; }
  function lenLocal(a, b) { var x = a; var y = b; return x.length + y.length + a.length + b.length; }
  var counted = { get length() { hits++; return 3; } };
  var hits = 0;
  var bytes = new Uint8Array(12), floats = new Float64Array(5);
  var sub = Object.create(bytes);
  var own = new Uint16Array(4); Object.defineProperty(own, "length", { value: 99 });
  var like = { length: 7 }, inherit = Object.create({ length: 8 });
  var rope = "ab"; for (var r = 0; r < 4; r++) rope = rope + rope + "c";
  function args() { return arguments.length + len(arguments); }
  var t = 0;
  for (var j = 0; j < 150; j++) {
    t += len(bytes) + len(floats) + len(own) + len(like) + len(inherit) + len(counted) + len("four") + len(rope) + len([1, 2, 3]) + len(len) + args(1, 2, 3);
    t += lenLocal(bytes, "xy") + lenLocal(like, [j]) + lenLocal(counted, floats);
    if (len({}) !== undefined || len(5) !== undefined) t += 1e6;
    try { t += len(sub); } catch (e) { t += 1000; }
    try { len(undefined); t += 1e6; } catch (e) { t += e instanceof TypeError ? 1 : 1e6; }
    try { len(null); t += 1e6; } catch (e) { t += 1; }
  }
  print("lengths", t, hits);

  var log = [];
  function fin(n) {
    try { if (n === 0) return "zero"; if (n === 1) throw new Error("one"); log.push("body" + n); }
    catch (e) { return "caught " + e.message; }
    finally { log.push("fin" + n); }
    return "end";
  }
  function nested(n) {
    var out = "";
    for (var i = 0; i < 4; i++) {
      try {
        try { if (i === n) continue; if (i === n + 1) break; out += "a" + i; }
        finally { out += "f" + i; }
      } finally { out += "g" + i; }
    }
    return out;
  }
  function override(n) { try { return "try" + n; } finally { if (n & 1) return "finally" + n; } }
  function rethrow(n) { try { try { throw new Error("in" + n); } finally { log.push("r" + n); } } catch (e) { return e.message; } }
  function throwsInFinally(n) { try { try { return n; } finally { if (n === 2) throw new Error("fin threw"); } } catch (e) { return e.message; } }
  function value(n) { var v = 0; try { v = n * 2; return v; } finally { v = 100; } }
  var u = [];
  for (var k = 0; k < 120; k++) {
    var m = k % 4;
    u.push(fin(m), nested(m), override(m), rethrow(m), throwsInFinally(m), value(m));
    if (k === 7) print("early", u.join("|"));
  }
  print("finally", u.length, u.slice(-12).join("|"), log.length, log.slice(-6).join(","));
})();
