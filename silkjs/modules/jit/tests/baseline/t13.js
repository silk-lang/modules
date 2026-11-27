function F() {
  var k = 3, n = 0;
  var helper = function (a) { n = n + 1; return a + k; };
  var twice = function (a) { return helper(a) + helper(a + 1); };
  var looped = function (a) { var s = 0; for (var i = 0; i < a; i++) s += twice(i) + k; return s; };
  return { g: function (x) { return helper(x) + twice(x + 1) + looped(5); }, count: function () { return n; } };
}
var o = F(), s = 0;
for (var i = 0; i < 300; i++) s += o.g(i);
print(s, o.count());
