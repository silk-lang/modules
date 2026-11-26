// Adds that join strings, at sites that also add numbers, doubles, objects with valueOf
// and toString, and that throw: baseline code notes a site where it joined a string, and
// the optimizer joins there from its first compile, stepping the other cases.
function plus(a, b) { return a + b; }
function label(k, n) { var s = 'k'; s = s + k; return s + n; }
function sum(list) { var t = 0; for (var i = 0; i < list.length; i++) t = t + list[i]; return t; }
var calls = 0;
var tricky = { valueOf: function () { calls++; return 5; }, toString: function () { return 'T'; } };
var thrower = { valueOf: function () { throw new TypeError('no'); } };
var inputs = [[1, 2], ['a', 'b'], [1.5, 2], ['x', 3], [4, 'y'], [tricky, 1], [tricky, 'z'], [2147483647, 1]];
function turn(n) {
  var t = '';
  for (var i = 0; i < inputs.length; i++) {
    var p = inputs[(i + n) % inputs.length];
    t = String(plus(p[0], p[1])).length + label(i & 3, n & 7).length + t.length > 50 ? '' : t + plus(p[0], p[1]);
  }
  return t.length + sum([n, 1, 2.5, 'q']).length + sum([n, 2, 3]);
}
function phase(change, rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  change();
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  return total + ' ' + calls;
}
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { inputs[3] = [thrower, 1]; }, 300));
out.push(phase(function () { inputs[3] = [null, undefined]; inputs[5] = [true, 'x']; }, 300));
out.push(phase(function () { String.prototype.toString = function () { return 'S'; }; }, 300));
print(out.join(" | "));
