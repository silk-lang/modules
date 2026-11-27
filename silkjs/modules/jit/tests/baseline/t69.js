// Inlined bodies that write their parameters (put_arg, set_arg, step_arg8): a loop that
// counts its parameters down and reads past the end of its array (an exit inside the
// inlined loop, with the bodies' frames), a write followed by a guard that fails (a field of
// a value that is not an object), set_arg chains, a double written to a parameter, a body
// that writes a parameter the call passed no argument for, and bodies inlined in bodies.
function walk(a, i, n) {
  var s = 0;
  while (n-- > 0) { s = (s + (a[i++] | 0)) | 0; }
  return s + i * 1000 + n;
}
function after(o, k) { k++; k = k * 2; return o.v + k; }
function chain(a, b) { a = b = a + b; return a - b + a; }
function half(x) { x /= 2; return x + 0.25; }
function missing(a, b) { b = 3; return a + b; }
function outer(a, i, n) { i += 1; return this.walk(a, i, n) + this.walk(a, i - 1, n + 1); }
function Lib() {}
Lib.prototype.walk = walk; Lib.prototype.after = after; Lib.prototype.chain = chain;
Lib.prototype.half = half; Lib.prototype.missing = missing; Lib.prototype.outer = outer;
var lib = new Lib();
var arr = [3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5, 8, 9, 7];
var objs = [{ v: 1 }, { v: 2 }, 7, { v: 'x' }, 'str'];
function caller(r) {
  var t = lib.walk(arr, r % 5, (r % 7) + 3) + lib.chain(r, r & 3) + lib.missing(r) + lib.outer(arr, r % 4, r % 6);
  t += lib.half(r) * 4;
  var u = lib.after(objs[r % 5], r);
  return (t + (typeof u === 'number' ? (u === u ? u : -1) : u.length)) | 0;
}
function phase(rounds, from) {
  var total = 0;
  for (var r = from; r < from + rounds; r++) total = (total * 7 + caller(r)) % 1000003;
  return total;
}
var out = [];
out.push(phase(600, 0));
arr.length = 9;
out.push(phase(600, 3));
arr.push(4.5, 'y');
out.push(phase(600, 5));
out.push(walk([1, 2, 3], 1, 6), walk('abc', 0, 3), lib.outer([5, 6], 0, 1), chain(2.5, 1), half(7), missing(1, 2));
print(out.join(' | '));
