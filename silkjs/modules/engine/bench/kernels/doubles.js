// A floating-point loop.
var UNITS = 100000 * 100;
function poly(n) { var s = 0.5; for (var i = 0; i < n; i++) s = s * 0.999 + i * 0.25; return s; }
function kernel() { var t = 0; for (var k = 0; k < 100000; k++) t = t + poly(100); return Math.round(t); }
