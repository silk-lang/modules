// Integer operations with a constant operand in optimized code: bitwise and, or and xor,
// shifts by counts of 0, 1, 14, 28, 31, 32 and 33 (JavaScript takes them modulo 32), an
// unsigned shift by 0 of a negative value (a double), multiplication by constants that
// overflow, and a product that is -0. The am3 loop of the V8 benchmark Crypto is the model.
function am3(x, w, xs, n) {
  var xl = x & 0x3fff, xh = x >> 14, c = 0, i = 0, j = 0;
  while (--n >= 0) {
    var l = xs[i] & 0x3fff;
    var h = xs[i++] >> 14;
    var m = xh * l + h * xl;
    l = xl * l + ((m & 0x3fff) << 14) + w[j] + c;
    c = (l >> 28) + (m >> 14) + xh * h;
    w[j++] = l & 0xfffffff;
  }
  return c;
}
function shifts(v) {
  return [v << 0, v << 1, v >> 14, v >>> 28, v >> 31, v << 32, v >>> 33, v ^ 0x5555, v | 0x100, v & -2].join(',');
}
function unsigned(v) { return v >>> 0; }
function times(v) { return [v * 3, v * 65536, v * 1, v * 0x7fffffff].join(','); }
function zero(v) { var p = v * 0; return Object.is(p, -0) ? 'n0' : p; }
var xs = [], w = [];
for (var k = 0; k < 40; k++) { xs.push((k * 2654435761) & 0xfffffff); w.push((k * 40503) & 0xfffffff); }
var out = [];
var total = 0;
for (var r = 0; r < 400; r++) {
  total = (total + am3((r * 7919) & 0xfffffff, w, xs, 40)) | 0;
  if (r % 50 == 0) out.push(shifts(r - 200), unsigned(r - 200), times(r * 1000003 - 7), zero(r - 200));
}
out.push(total, w.slice(0, 5).join(','), shifts(-1), shifts(0x7fffffff), unsigned(-1), times(-0x40000000), zero(0), zero(-0.0 + 0));
print(out.join(' | '));
