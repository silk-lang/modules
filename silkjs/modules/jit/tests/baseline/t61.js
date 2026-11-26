// Method reads on strings, numbers and booleans (get_field2 of a primitive) in optimized
// code: from the class prototype of the realm. Each phase warms the reads up, then replaces a
// method on String.prototype, puts a getter there, adds one to Number.prototype and
// Boolean.prototype, shadows one on Object.prototype, and reads a string's length.
function words(s, n) {
  var t = s.slice(0, 3).length + s.indexOf('b') + s.charCodeAt(n % s.length);
  t += (n * 1.5).toFixed(1).length + (n | 0).toString(16).length;
  t += (n & 1 ? true : false).toString().length;
  return t + s.length;
}
var texts = ['abcdef', 'xbyz', 'bbbbbbbbbbbb', 'q'];
function turn(n) {
  var t = 0;
  for (var i = 0; i < texts.length; i++) t += words(texts[(i + n) & 3], n + i);
  return t;
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
  return total;
}
var keep = String.prototype.slice;
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { String.prototype.slice = function (a, b) { return 'zz'; }; }, 300));
out.push(phase(function () { Object.defineProperty(String.prototype, 'slice', { get: function () { return keep; }, configurable: true }); }, 300));
out.push(phase(function () { Number.prototype.toFixed = function () { return 'n'; }; Boolean.prototype.toString = function () { return 'bb'; }; }, 300));
out.push(phase(function () { delete String.prototype.indexOf; Object.prototype.indexOf = function () { return 40; }; }, 300));
out.push(phase(function () { texts[1] = 42; }, 300));
print(out.join(" "));
