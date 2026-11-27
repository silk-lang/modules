// Numbers a call passes into an inlined body: arithmetic on two of them is done when the
// code is compiled, unless it would leave (an overflow, a -0 product), and a counted loop
// that starts and ends at such numbers is tested in front against them. Loops of one turn,
// of none, past the end of their Arrays and below their start; loops inside loops that
// poll for them.
function am(a, i, w, j, c, n) {
  while (--n >= 0) {
    var v = a[i++] * 3 + w[j] + c;
    c = v >> 8;
    w[j++] = v & 255;
  }
  return c;
}
function once(a, w, i) { return am(a, i, w, 2 * i, 0, 1); }
function none(a, w, i) { return am(a, i, w, i, 7, 0); }
function twice(a, w, i) { return am(a, i, w, i + 1, 1, 2); }
function fixed(a, w) { return am(a, 0, w, 0, 0, 4) + am(a, 1, w, 3, 2, 1) + am(a, 2, w, 2, 0, 3); }
function square(a, w, t) {
  var c = 0;
  for (var i = 0; i < t - 1; ++i) {
    c += am(a, i, w, 2 * i, 0, 1);
    c += am(a, i + 1, w, 2 * i + 1, c & 3, t - i - 1);
  }
  return c;
}
function add(x, y) { return x + y; }
function sub(x, y) { return x - y; }
function mul(x, y) { return x * y; }
function consts() {
  var r = [add(2147483647, 1), add(2147483646, 1), sub(-2147483648, 1), sub(-2147483647, 1), mul(65536, 65536), mul(46341, 46341), mul(46340, 46340)];
  r.push(1 / mul(0, -5), 1 / mul(-3, 0), 1 / mul(0, 5), 1 / mul(0, 0), mul(-1, -2147483648), mul(-1, 2147483647), add(-2147483648, -1), sub(0, -2147483648));
  return r.join(" ");
}
function zeros(x) { return add(x, 0) + sub(x, 0) + add(0, x) + mul(x, 1) + mul(1, x) + sub(0, x); }
function head(a) { var s = 0; for (var i = 0; i < 1; i++) s += a[i]; return s; }
function firstFour(a) { var s = 0; for (var i = 0; i < 4; i++) s += a[i] | 0; return s; }
function lastDown(a) { var s = ""; for (var i = 3; i >= 0; i--) s += a[i]; return s; }
function below(a) { var s = ""; for (var i = 1; i >= -2; i--) s += a[i] + ","; return s; }
function fillFixed(a) { for (var i = 5; i >= 2; --i) a[i] = i; return a; }
function nested(a, n) {
  var s = 0;
  for (var k = 0; k < n; k++) { for (var i = 0; i < 3; i++) s += a[i]; for (var j = 2; j >= 0; j--) s -= a[j] >> 1; }
  return s;
}
function grid(rows) { var s = 0; for (var r = 0; r < rows.length; r++) { var row = rows[r]; for (var c = 0; c < row.length; c++) s += row[c]; } return s; }
var out = [];
var rows = [[1, 2, 3], [4, 5], [], [6, 7, 8, 9], [1.5, 2], ["a"], [10]];
for (var turn = 0; turn < 200; turn++) {
  var a = [200, 100, 50, 25, 12, 6, 3], w = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6];
  var r = [once(a, w, 1), once(a, w, 6), none(a, w, 3), none(a, w, 99), twice(a, w, 2), fixed(a, w), square(a, w, 7), w.join("")];
  var short = [5, 6], shortW = [1, 2, 3];
  r.push(once(short, shortW, 1), once(short, shortW, 2), twice(short, shortW, 1), fixed(short, shortW), square(short, shortW, 4), shortW.join(), short.join());
  r.push(consts(), zeros(turn), zeros(-0.5), zeros("s"));
  r.push(head([4]), head([]), head([1.5, 2]), head("x"), firstFour([1, 2, 3, 4, 5]), firstFour([1, 2]), firstFour([]), firstFour({ 0: 3, 3: 4 }));
  r.push(lastDown([1, 2, 3, 4]), lastDown([1, 2]), lastDown([]), below([7, 8, 9]), below([]), fillFixed([]).join(), fillFixed([1, 2, 3, 4, 5, 6, 7]).join(), fillFixed([1]).length);
  r.push(nested([8, 9, 10], 5), nested([8, 9], 3), nested([], 2), nested([1, 2, 3, 4], 0), grid(rows), grid([]), grid([[]]), grid([[1], "ab"]));
  if (turn == 199) out = r;
}
print(out.join("\n"));
