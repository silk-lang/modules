// === and !== of every pair of kinds, as values and as branch tests.
(function () {
  function same(a, b) { return a === b; }
  function differ(a, b) { return a !== b; }
  function branch(a, b) { if (a === b) return 1; if (a !== b) return 2; return 3; }
  function isUndefined(x) { return x === undefined ? 1 : 0; }
  function notNull(x) { return x !== null ? 1 : 0; }
  function self(x) { return x === x; }
  function fresh() { return {} === {} ? 1 : ({} !== {} ? 2 : 3); }
  function dup() { var t; return (t = { a: 1 }) === t ? 1 : 0; }
  var o = {};
  var s = Symbol("s");
  var rope = "ab";
  for (var r = 0; r < 3; r++) rope = rope + rope;
  var flat = "abababababababab";
  var values = [undefined, null, true, false, 0, -0, 1, 1.5, NaN, "", "a", "a" + "", rope, flat, ["x"].join(""), s, Symbol("s"), Symbol.iterator, o, {}, [], same, 0n, 1n, 1n,
    12345678901234567890n, 12345678901234567890n, new String("a"), new Proxy({}, {})];
  var bits = [];
  var count = 0;
  for (var i = 0; i < 60; i++) {
    var row = "";
    for (var a = 0; a < values.length; a++) {
      for (var b = 0; b < values.length; b++) {
        var x = values[a], y = values[b];
        var e = same(x, y);
        if (e === differ(x, y)) count += 100000;
        if (branch(x, y) !== (e ? 1 : 2)) count += 1000000;
        if (e) count++;
        if (i === 59) row += e ? "1" : "0";
      }
      count += isUndefined(values[a]) + notNull(values[a]) + (self(values[a]) ? 1 : 0);
    }
    count += fresh() + dup();
    // Operands whose only counts are the stack's.
    count += same({}, {}) ? 10 : 0;
    count += same("k" + i, "k" + i) ? 1 : 0;
    count += differ(Symbol(), Symbol()) ? 1 : 0;
    count += same([i], undefined) ? 10 : 0;
    count += differ({ i: i }, null) ? 1 : 0;
    if (i === 59) bits.push(row);
  }
  print(count, bits.join(""));
})();
