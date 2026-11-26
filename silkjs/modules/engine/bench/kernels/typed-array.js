// A multiply-add over typed arrays.
var UNITS = 10000 * 1000;
var a = new Float64Array(1000), b = new Float64Array(1000), c = new Float64Array(1000);
for (var i = 0; i < 1000; i++) { a[i] = i * 0.5; b[i] = (i % 7) * 0.25; }
function fma(n) { for (var i = 0; i < n; i++) c[i] = a[i] * b[i] + c[i] * 0.5; return c[n - 1]; }
function kernel() { var t = 0; for (var k = 0; k < 10000; k++) t = t + fma(1000); return Math.round(t); }
