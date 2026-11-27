// Arithmetic that keeps leaving compiled code: first integers, then doubles, then strings and
// objects with valueOf, at the same sites, while the function is compiled again each time.
var out = [];
function note(x) { out.push(String(x)); }
function grow(a, b, n) {
  var s = a;
  for (var i = 0; i < n; i++) { s = s + b; s = b + s; }
  return s;
}
function mixed(list) {
  var t = 0;
  for (var i = 0; i < list.length; i++) { var x = list[i]; t = t + x; t = t - 1; t = t * 1; }
  return t;
}
var calls = 0;
var counted = { valueOf: function () { calls++; return 3; } };
for (var round = 0; round < 6; round++) {
  for (var r = 0; r < 120; r++) {
    note.r = grow(round > 1 ? "x" : 1, round > 2 ? "y" : 2, 5);
    note.s = mixed(round > 3 ? [1, 2.5, counted, "4", 5] : [1, 2, 3, 4, 5]);
  }
  note(round + ":" + note.r + ":" + note.s + ":" + calls);
}
// The fused forms: loc op loc, top op loc, top op arg.
function fused(a, b) {
  var x = a, y = b, z = 0;
  for (var i = 0; i < 4; i++) { z = x + y; z = z + x; z = z * a; z = b - z; }
  return z;
}
for (var r = 0; r < 300; r++) note.f = fused(r % 50 < 25 ? r : "s" + r, r % 3 ? 2 : counted);
note(note.f + ":" + calls);
for (var r = 0; r < 300; r++) note.f = fused(r, 2);
note(note.f);
// Throwing inside a stepped addition.
var bad = { valueOf: function () { throw new TypeError("no number"); } };
function adds(a, b) { var s = 0; for (var i = 0; i < 3; i++) s = s + a + b; return s; }
for (var r = 0; r < 200; r++) adds(r, "q");
try { adds(bad, 1); } catch (e) { note(e.message); }
note(adds(1, 2) + ":" + adds("a", 2) + ":" + adds(Symbol.iterator === undefined ? 1 : 2, 3n === 3n ? 4 : 5));
try { adds(1n, 2); } catch (e) { note(e.constructor.name); }
(typeof print === "function" ? print : console.log)(out.join("\n"));
