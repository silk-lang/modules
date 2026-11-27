// Summing an array of small integers.
var UNITS = 20000 * 1000;
var data = []; for (var i = 0; i < 1000; i++) data.push(i % 97);
function total(a) { var s = 0; for (var i = 0; i < a.length; i++) s = s + a[i]; return s; }
function kernel() { var t = 0; for (var k = 0; k < 20000; k++) t = (t + total(data)) % 1000000007; return t; }
