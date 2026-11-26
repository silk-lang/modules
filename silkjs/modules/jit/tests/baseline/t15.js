function lens(s, a) { var n = 0; n += s.length; var t = s + 'x'; n += t.length; n += a.length; var r = s + s + s + s + s + s + s + s; n += (r + r).length; return n + len2(s, a) ; }
function len2(s, a) { return s.length * 2 + a.length + [s, a, 1].length + (s.length > 2 ? s.length : 0); }
function odd(v) { var n = 0; try { n += v.length | 0; } catch (e) { n += 1000; } return n; }
function meth(s, i) { return s.charCodeAt(i % s.length) + s.indexOf('b') + s.substring(1, 3).length + s.toUpperCase().length + (5).toString().length + (i + 0.5).toFixed(1).length + true.toString().length + i.toString().length; }
function trunc(x, y) { return ((x * y) | 0) + ((x / 3) | 0) + ((y * 1e9) | 0) + ((0 / 0) | 0) + ((-x) | 0) + ((x * 1e300 * 1e300) | 0) + ((-0.5) | 0) + ((2147483647.5) | 0) + ((-2147483648.5) | 0) + ((4294967296.75 + x) | 0) + (('7' + x) | 0) + ((x + 0.75) | 6) + (null | 0) + (undefined | 3); }
String.prototype.extra = function () { return this.length + 1; };
function custom(s) { return s.extra() + s.constructor.name.length; }
var total = 0, vals = ['abc', 'abcdefgh', '', [1, 2, 3], { length: 7 }, 5, null, undefined, function (a, b) {}, new String('boxed'), 'éñ' + 'x'];
for (var i = 0; i < 300; i++) {
  total += lens('ab' + i, [i, i]) + meth('xbz' + i, i) + trunc(i + 0.25, 1.5) + trunc(i, 3) + custom('q' + i);
  for (var j = 0; j < vals.length; j++) total += odd(vals[j]);
}
print(total);
