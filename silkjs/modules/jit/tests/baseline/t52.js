// A function's own methods called through a variable (`Strength.stronger(a, b)`), and one
// that calls another on `this`: inlined against the closure the variable's object holds.
// Each phase warms the calls up, then in the middle of a run replaces a method, deletes
// one, makes one a getter, sets the variable to another object, and calls on a `this` of
// another kind.
function Strength(v) { this.v = v; }
Strength.stronger = function (a, b) { return a.v < b.v; };
Strength.weaker = function (a, b) { return a.v > b.v; };
Strength.weakestOf = function (a, b) { return this.weaker(a, b) ? a : b; };
Strength.strongest = function (a, b) { return this.stronger(a, b) ? a : b; };
var S = [new Strength(0), new Strength(3), new Strength(5), new Strength(2)];
function turn(n) {
  var t = 0;
  for (var i = 0; i < S.length; i++) {
    var a = S[i], b = S[(i + n) % S.length];
    t += (Strength.stronger(a, b) ? 1 : 2) + Strength.weakestOf(a, b).v * 3 + Strength.strongest(a, b).v;
  }
  return t;
}
function phase(change, rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n & 3); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + r) % 1000003;
  }
  change();
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n & 3); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + r) % 1000003;
  }
  return total;
}
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { Strength.stronger = function (a, b) { return a.v <= b.v; }; }, 300));
out.push(phase(function () { Strength.weaker = function (a, b) { return a.v >= b.v + 1; }; }, 300));
out.push(phase(function () { Object.defineProperty(Strength, "weaker", { get: function () { return function (a, b) { return true; }; }, configurable: true }); }, 300));
out.push(phase(function () { var keep = Strength; Strength = { stronger: function () { return false; }, weakestOf: keep.weakestOf, strongest: keep.strongest, weaker: function () { return false; } }; }, 300));
out.push(phase(function () { delete Strength.stronger; }, 300));
print(out.join(" "));
