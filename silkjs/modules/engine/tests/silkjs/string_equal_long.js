// === on two distinct one-byte strings compares several words a turn; each case
// puts the one differing byte at every position of strings around the turn sizes.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function fresh(text) { return (text + "!").slice(0, -1); }

var lengths = [1, 7, 8, 9, 15, 16, 31, 32, 33, 40, 63, 64, 65, 95, 96, 97, 200, 257];
for (var li = 0; li < lengths.length; li++) {
  var n = lengths[li];
  var base = "";
  for (var i = 0; i < n; i++) base += String.fromCharCode(97 + (i * 7) % 26);
  var a = fresh(base), b = fresh(base);
  check(a === b, true, "equal " + n);
  check(a !== b, false, "not unequal " + n);
  for (var at = 0; at < n; at++) {
    var changed = base.slice(0, at) + (base[at] === "z" ? "y" : "z") + base.slice(at + 1);
    if (a === changed) { failures++; say("FAIL", "differs at", at, "of", n); }
    // A high Latin-1 byte at the same place.
    var high = base.slice(0, at) + "é" + base.slice(at + 1);
    if (a === high) { failures++; say("FAIL", "high byte at", at, "of", n); }
  }
  check(a === fresh(base + "a"), false, "longer " + n);
  check(a === base.slice(1), false, "shorter " + n);
}
// One-byte against two-byte text of the same units.
var narrow = fresh("x".repeat(100));
var wide = ("x".repeat(100) + "一").slice(0, 100);
check(narrow === wide, true, "narrow and wide");
check(narrow === fresh("x".repeat(99) + "一"), false, "wide differs");
// Switch case labels and Map keys use the same comparison.
var key = fresh("k".repeat(70));
var m = new Map([[fresh("k".repeat(70)), 1]]);
check(m.get(key), 1, "map key");
switch (key) { case fresh("k".repeat(70)): break; default: failures++; say("FAIL", "switch"); }

if (failures) throw new Error(failures + " string equality checks failed");
say("ok");
