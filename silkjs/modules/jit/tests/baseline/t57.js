// Element reads and stores by an Int index that miss the fast case after the code has
// run: past the end (an append, undefined), holes, a string's characters, a plain object
// with index keys, a typed array, an index getter on the prototype. The sites leave once,
// and are compiled again to step what the helper declines.
function readAll(a, n) {
  var t = 0;
  for (var i = 0; i < n; i++) { var v = a[i]; t = (t * 3 + (typeof v === 'number' ? v : (v === undefined ? 7 : String(v).length))) % 100003; }
  return t;
}
function fill(a, n) { for (var i = 0; i < n; i++) a[i] = i * 2; return a.length | 0; }
function pick(a, i) { return a[i]; }
var arrays = [[1, 2, 3, 4], 'hello', { 0: 5, 1: 6, length: 2 }, new Int8Array([9, 8, 7]), [1, , 3]];
function turn(n) {
  var t = 0;
  for (var k = 0; k < arrays.length; k++) {
    var a = arrays[k];
    t += readAll(a, 3 + (n & 3));
    t += typeof pick(a, n & 7) === 'undefined' ? 1 : 2;
  }
  var b = [];
  t += fill(b, 4 + (n & 3)) + fill({}, 3) + fill(new Uint16Array(5), 6);
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
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { arrays[0] = [1, 2]; }, 300));
out.push(phase(function () { Object.defineProperty(Array.prototype, 5, { get: function () { return 55; }, configurable: true }); }, 300));
out.push(phase(function () { delete Array.prototype[5]; arrays[4] = new Array(6); }, 300));
out.push(phase(function () { var hits = 0; Object.defineProperty(Object.prototype, 2, { set: function () { hits++; }, get: function () { return hits; }, configurable: true }); }, 300));
print(out.join(" "));
