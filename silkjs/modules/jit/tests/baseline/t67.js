// Element accesses in loops whose Array checks move in front of the loop (check.array):
// reads and stores of two arrays and of one array twice, stores of objects, reads past the
// end and stores that append (which leave the loop's code), and the same loops given typed
// arrays, strings, arguments, a frozen array, a holey array and an array with a getter, at
// first and after the code was made for arrays.
function mix(a, b, n) {
  var c = 0;
  for (var i = 0; i < n; i++) {
    var x = a[i] & 0x3fff;
    var y = b[i] >> 3;
    c = (c + x * 3 + y) | 0;
    b[i] = (x + y + c) & 0xffff;
  }
  return c;
}
function reads(a, n) {
  var s = 0;
  for (var i = 0; i < n; i++) { var v = a[i]; s = (s + (v === undefined ? 7 : v | 0)) | 0; }
  return s;
}
function fill(a, n, v) {
  for (var i = 0; i < n; i++) a[i] = v;
  return a.length;
}
function sumOf(list) {
  var s = 0;
  for (var i = 0; i < list.length; i++) s = (s + list[i]) | 0;
  return s;
}
function ints(n, k) { var a = []; for (var i = 0; i < n; i++) a.push((i * k + 3) & 1023); return a; }
var out = [];
var total = 0;
for (var r = 0; r < 300; r++) {
  var a = ints(40, r), b = ints(40, r + 1);
  total = (total + mix(a, b, 40) + reads(a, 40) + b[r % 40]) | 0;
  var same = ints(30, r);
  total = (total + mix(same, same, 30)) | 0;
}
out.push(total);
// Past the end: reads give undefined, stores append.
total = 0;
for (var r = 0; r < 200; r++) {
  var a = ints(20, r);
  total = (total + reads(a, 25) + fill(a, 24, r) + a[23]) | 0;
}
out.push(total);
// Objects into an array of numbers and back.
var objs = [];
for (var r = 0; r < 100; r++) {
  var a = ints(10, r);
  fill(a, 10, { r: r });
  objs.push(a[9].r);
  fill(a, 10, r);
}
out.push(objs.join(','));
// Other receivers once the code was made for arrays.
var typed = new Int32Array(40), floats = new Float64Array(40);
for (var i = 0; i < 40; i++) { typed[i] = i * 5; floats[i] = i / 2; }
out.push(mix(typed, ints(40, 2), 40), mix(ints(40, 3), typed, 40), typed[7]);
out.push(reads(floats, 40), reads('abcdefghij', 12), reads(typed, 44));
out.push((function () { return reads(arguments, 5); })(1, 2, 3));
var frozen = Object.freeze(ints(10, 4));
try { 'use strict'; fill(frozen, 10, 9); } catch (e) { out.push(e instanceof TypeError ? 'TypeError' : 'other'); }
out.push(frozen[3], reads(frozen, 10));
var holey = ints(10, 5); holey[20] = 1;
out.push(reads(holey, 25), fill(holey, 22, 2), holey[21]);
var getter = ints(10, 6);
Object.defineProperty(getter, 4, { get: function () { return 99; } });
out.push(reads(getter, 10));
Array.prototype[12] = 5;
out.push(reads(ints(10, 7), 14));
delete Array.prototype[12];
// An element that is no Int (a double, a string, an object) in a loop made for Ints, and an
// object stored over a number.
var odd = ints(40, 9); odd[5] = 2.5; odd[17] = 'q'; odd[30] = { v: 1 };
out.push(mix(odd, ints(40, 1), 40), reads(odd, 40));
var held = ints(40, 3);
for (var r = 0; r < 50; r++) { held[r % 40] = { r: r }; out.length < 40 && r % 25 == 0 && out.push(mix(ints(40, r), ints(40, r + 1), 40)); }
out.push(held[7].r);
// The loops on arrays again.
total = 0;
for (var r = 0; r < 200; r++) {
  var a = ints(40, r), b = ints(40, r + 2);
  total = (total + mix(a, b, 40) + reads(b, 40) + sumOf(a)) | 0;
}
out.push(total);
print(out.join(' | '));
