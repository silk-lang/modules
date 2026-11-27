// Instructions without templates: the engine runs them one at a time.
function Pt(x, y) { this.x = x; this.y = y; }
var K = {
  obj: function (a, b) { var o = { p: a, q: b }; return o.p + o.q; },
  arr: function (a, b) { var v = [a, b, a + b]; return v[2] + v.length; },
  ty: function (a) { return typeof a === "number" ? 1 : 2; },
  ins: function (a) { return a instanceof Pt ? 3 : 4; },
  sh: function (a, b) { return ((a << 3) >> 1) + (a >>> 2) + (-b) + (~a); },
  inn: function (o) { return "x" in o ? 5 : 6; },
  forin: function (o) { var n = 0; for (var k in o) { n = n + k.length; } return n; },
  clo: function (a) { var f = function () { return 7; }; return f() + a; },
  thr: function (a) { try { if (a % 7 == 3) { throw a; } return 1; } catch (e) { return e; } },
  thr2: function (a) { if (a % 50 == 49) { null.x; } return a; },
  del: function (a) { var o = { z: a, w: 2 }; delete o.z; return o.z === undefined ? 8 : 9; },
  str: function (a) { return ("n" + a).length; },
  args: function () { return arguments.length + arguments[1]; },
  sw: function (a) { switch (a % 4) { case 0: return 10; case 1: return 11; default: return 12; } },
  post: function (a) { var i = a; var j = i++; var k = i--; return i + j + k; },
  cond: function (a, b) { var t = a > b ? a : b; t += a; t -= b; t *= 2; return t; },
  run: function (i, p) {
    var s = 0;
    s = s + this.obj(i, 2) + this.arr(i, 3) + this.ty(i) + this.ty("s") + this.ins(p) + this.ins(i);
    s = s + this.sh(i, 5) + this.inn(p) + this.forin(p) + this.clo(i) + this.thr(i);
    try { s = s + this.thr2(i); } catch (e) { s = s + 1000; }
    s = s + this.del(i) + this.str(i) + this.args(i, 4, 5) + this.sw(i) + this.post(i) + this.cond(i, 9);
    return s | 0;
  }
};
var total = 0;
var p = new Pt(1, 2);
for (var i = 0; i < 3000; i++) { total = (total + K.run(i, p)) | 0; }
print(total);
