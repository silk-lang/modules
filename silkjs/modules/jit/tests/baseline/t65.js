// Method reads on primitives in optimized code: string, number and boolean receivers of
// prototype methods, sites that see a primitive and an object, a site whose string turns
// into a String object, and prototype methods replaced, deleted and made getters while the
// code runs.
function words(s, n) {
  var t = s.toLowerCase().length + s.charCodeAt(0) + s.indexOf('b');
  t += (n + 0.5).toFixed(1).length + n.toString(16).length;
  t += (n & 1 ? true : false).toString().length;
  return t;
}
function either(v) { return v.valueOf() === 'x' ? 1 : v.toString().length; }
var box = { toString: function () { return 'boxed'; }, valueOf: function () { return 'x'; } };
function phase(rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try {
      r = words(n & 2 ? 'AbcB' : 'xYzb', n) + either(n % 3 == 0 ? box : (n % 3 == 1 ? 'ab' : n));
      if (n % 97 == 0) r += either(new String('ss'));
    } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + r) % 1000003;
  }
  return total;
}
var out = [];
out.push(phase(600));
String.prototype.charCodeAt = function () { return 5; };
out.push(phase(300));
delete String.prototype.indexOf;
out.push(phase(300));
Object.defineProperty(Number.prototype, 'toFixed', { get: function () { return function () { return 'f'; }; }, configurable: true });
out.push(phase(300));
Boolean.prototype.toString = function () { throw new TypeError('no'); };
out.push(phase(300));
print(out.join(' | '));
