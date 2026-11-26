// Lengths in optimized code of what is not an Array or a string: typed arrays, `arguments`,
// plain objects whose length is a number, a string or an object (read and dropped at once,
// and kept), and a length getter that counts its runs and may throw.
var typed = new Uint8Array(5), floats = new Float64Array(3);
var plain = { length: 4 }, text = { length: 'abc' }, boxed = { length: { n: 2 } };
var runs = 0;
var getter = { get length() { runs++; if (runs % 997 == 0) throw new TypeError('no'); return runs & 7; } };
function args() { return arguments; }
var argsOf = args(1, 2, 3);
var kept = [];
function measure(a, b) {
  var t = 0;
  for (var i = 0; i < 4; i++) {
    if (a.length == 0) t++;
    t += b.length == 'abc' ? 10 : 0;
    var n = a.length;
    if (typeof n === 'number') t += n;
    else if (typeof n === 'string') t += n.length;
    else { t += n.n; if (i == 0 && kept.length < 40) kept.push(n); }
  }
  return t;
}
var pick = [[1, 2], typed, floats, plain, text, boxed, argsOf, 'four', getter];
function phase(rounds, shift) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = measure(pick[(n + shift) % pick.length], pick[(n * 3 + shift) % pick.length]); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + r) % 1000003;
  }
  return total;
}
var out = [];
out.push(phase(400, 0));
out.push(phase(400, 4));
text.length = 'abcd';
boxed.length = { n: 5 };
out.push(phase(400, 1));
out.push(runs + ' ' + kept.length + ' ' + kept[0].n + ' ' + kept[kept.length - 1].n);
print(out.join(' | '));
