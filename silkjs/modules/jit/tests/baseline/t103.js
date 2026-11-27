// Literals made by compiled code take their cell straight from the spare ones, and the cells
// compiled code dropped are freed before a literal takes one. Object literals of every size
// around the two cell sizes (none, two, eight, more), array literals of one to seventeen
// elements holding objects and strings, and literals made right after trees of objects were
// dropped, with some of a dropped tree's nodes kept: a kept node must still read as it was
// written while fresh literals land on the cells of the nodes around it.
function o0() { return {}; }
function o1(a) { return { a: a }; }
function o2(a, b) { return { a: a, b: b }; }
function o3(a, b) { return { a: a, b: b, c: a }; }
function o8(a, b) { return { a: a, b: b, c: a, d: b, e: a, f: b, g: a, h: b }; }
function o9(a, b) { return { a: a, b: b, c: a, d: b, e: a, f: b, g: a, h: b, i: a }; }
function o12(a, b) { return { a: a, b: b, c: a, d: b, e: a, f: b, g: a, h: b, i: a, j: b, k: a, l: b }; }
function a1(x) { return [x]; }
function a2(x, y) { return [x, y]; }
function a3(x, y) { return [x, y, x]; }
function a7(x, y) { return [x, y, x, y, x, y, x]; }
function a8(x, y) { return [x, y, x, y, x, y, x, y]; }
function a9(x, y) { return [x, y, x, y, x, y, x, y, x]; }
function a15(x, y) { return [x, y, x, y, x, y, x, y, x, y, x, y, x, y, x]; }
function a16(x, y) { return [x, y, x, y, x, y, x, y, x, y, x, y, x, y, x, y]; }
function a17(x, y) { return [x, y, x, y, x, y, x, y, x, y, x, y, x, y, x, y, x]; }
function node(key, left, right) { return { key: key, left: left, right: right, payload: [key, 'k' + key] }; }
function tree(depth, key) {
  if (depth == 0) return node(key, null, null);
  return node(key, tree(depth - 1, key * 2), tree(depth - 1, key * 2 + 1));
}
function pick(t, path, steps) {
  for (var i = 0; i < steps; i++) t = (path >> i) & 1 ? t.right : t.left;
  return t;
}
function sumObject(o) {
  var t = 0, n = 0;
  for (var k in o) { var v = o[k]; t += typeof v == 'number' ? v : v.key; n++; }
  return t * 31 + n;
}
function sumArray(a) {
  var t = a.length;
  for (var i = 0; i < a.length; i++) { var v = a[i]; t = t * 3 + (typeof v == 'string' ? v.length : v.key); }
  return t % 1000003;
}
function shapes(i, held) {
  var t = sumObject(o0()) + sumObject(o1(i)) + sumObject(o2(i, held)) + sumObject(o3(held, i));
  t += sumObject(o8(i, held)) + sumObject(o9(held, i)) + sumObject(o12(i, held));
  var s = 's' + i;
  t += sumArray(a1(held)) + sumArray(a2(held, s)) + sumArray(a3(s, held)) + sumArray(a7(held, s));
  t += sumArray(a8(s, held)) + sumArray(a9(held, s)) + sumArray(a15(s, held)) + sumArray(a16(held, s));
  t += sumArray(a17(s, held));
  return t % 1000003;
}
function round(n) {
  var root = tree(6, 1);
  var path = n * 7 & 63;
  var kept = pick(root, path, 4);
  var leaf = pick(kept, path >> 4, 2);
  root = null;
  var t = 0;
  for (var i = 0; i < 40; i++) t = (t * 5 + shapes(i + n, kept)) % 1000003;
  t += kept.key * 3 + leaf.key + leaf.payload[0] + leaf.payload[1].length + kept.left.payload[1].length;
  var again = tree(5, n + 1);
  t += pick(again, path, 5).key + kept.right.right.key;
  return t % 1000003;
}
var total = 0;
for (var n = 0; n < 120; n++) total = (total * 7 + round(n)) % 1000003;
print(total);
// Literals whose properties the engine defines one at a time, after the same drops.
var proto = { key: 1000 };
function odd(i, o) { return [{ __proto__: proto, v: i }, { get key() { return i; } }, { ...o, z: i }, [i, ...[o, o]]]; }
var more = 0;
for (var n = 0; n < 80; n++) {
  var dropped = tree(4, n);
  var keep = dropped.left.right;
  dropped = null;
  var l = odd(n, keep);
  more = (more * 7 + l[0].key + l[0].v + l[1].key + l[2].key + l[2].z + l[3].length + l[3][2].payload[0]) % 1000003;
}
print(more);
