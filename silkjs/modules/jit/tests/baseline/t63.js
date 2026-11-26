// Concatenation into a local (`s += x`): string literals added to a local that holds a
// string or a number, locals that change from numbers to strings, operands whose toString
// or valueOf runs or throws, and a local that is a string on some turns only.
function line(n) {
  var s = '';
  for (var i = 0; i < 6; i++) {
    s += '[';
    s += i;
    if ((n + i) & 1) s += ':odd';
    else s += ':even';
    s += ']';
  }
  return s;
}
function mixed(n) {
  var t = n & 3;
  t += 'x';
  var u = n;
  if (n % 5 == 0) u += '!';
  else u += 2;
  return t + u;
}
var thrown = { toString: function () { throw new TypeError('no'); } };
var counted = { n: 0, valueOf: function () { this.n++; return 7; } };
function objects(n, o) {
  var s = 'o';
  s += o;
  var k = n;
  k += o;
  return s + k;
}
function phase(rounds, o) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = line(n).length + mixed(n).length + objects(n, o).length; } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + r) % 1000003;
  }
  return total;
}
var out = [];
out.push(phase(300, 5));
out.push(phase(300, 'str'));
out.push(phase(300, counted) + ' ' + counted.n);
out.push(phase(300, thrown));
out.push(line(3) + ' ' + mixed(10) + ' ' + mixed(11) + ' ' + objects(4, counted));
print(out.join(' | '));
