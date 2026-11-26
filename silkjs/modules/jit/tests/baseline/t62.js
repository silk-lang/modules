// String literals in optimized code, its own and inlined: as values, keys, results that
// outlive the call, operands of concatenation and comparison, with many uses of each, and
// in a function that is compiled again after it leaves. The atoms' strings must keep their
// counts: a literal stored in many objects, dropped and pushed again.
function kind(n) { return n & 1 ? 'odd' : 'even'; }
function label(n) { return 'item-' + kind(n); }
function tag(o, n) { o.kind = kind(n); o['k' + (n & 3)] = 'v'; return o.kind === 'odd' ? 1 : 2; }
var keep = [];
function turn(n) {
  var t = 0;
  for (var i = 0; i < 8; i++) {
    var o = {};
    t += tag(o, n + i) + label(i).length + (kind(i) == 'even' ? 3 : 4);
    if ((n + i) % 7 == 0) keep.push(o.kind);
    if (keep.length > 50) keep.length = 0;
    t += ('x' + 'y').length + ('' + kind(i)).length;
  }
  return t + (n & 15 ? 0 : (typeof n === 'number' ? 'number'.length : 0));
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
  return total + ' ' + keep.join('').length;
}
var out = [];
out.push(phase(function () {}, 400));
out.push(phase(function () { kind = function (n) { return n & 2 ? 'two' : 'none'; }; }, 400));
out.push(phase(function () { String.prototype.toString = function () { return 'S'; }; keep.length = 0; }, 400));
out.push(phase(function () { label = function (n) { return n; }; }, 400));
print(out.join(" | "));
