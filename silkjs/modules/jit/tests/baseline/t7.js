// DeltaBlue-era templates: keep branches, insert2, lnot, mul/div/mod, get_length, atoms, constructors
function Point(x, y) { this.x = x; this.y = y; }
function Boxed(v) { var o = { v: 0 }; o.v = v; return o; }
function Thrower(n) { this.n = n; if (n % 97 == 96) throw new Error("ctor " + n); }
function orOf(a, b) { return a || b; }
function andOf(a, b) { return a && b; }
function notOf(a) { return !a; }
function mul(a, b) { return a * b; }
function div(a, b) { return a / b; }
function mod(a, b) { return a % b; }
function add(a, b) { return a + b; }
function sub(a, b) { return a - b; }
function lt(a, b) { return a < b; }
function lte(a, b) { if (a <= b) return 1; return 0; }
function gt(a, b) { if (a > b) return 1; return 0; }
function len(a) { return a.length; }
function name(i) { if (i & 1) return "odd"; return "even"; }
function chain(o, v) { var r = o.p = v; return r; }
function setArg(v) { var o = { f: 1, g: 2 }; o.g = v; return o; }
function make(i) { return new Point(i, i + 1); }
function makeBoxed(i) { return new Boxed(i); }
function makeThrower(i) { try { return new Thrower(i).n; } catch (e) { return -1; } }
function makeBad(f) { try { return new f(1); } catch (e) { return e instanceof TypeError ? "type" : "other"; } }
function argsLen() { return arguments.length; }
var vals = [0, 1, -1, 2, 0.5, -0.5, NaN, "", "a", null, undefined, true, false, {}, [], 2147483647, -2147483648, 65536, 1e300];
function show(v) { if (typeof v == "number") { if (v != v) return "NaN"; if (v == 0 && 1 / v < 0) return "-0"; } if (v && typeof v == "object") return "obj"; return String(v); }
var out = [];
var sum = 0;
for (var round = 0; round < 400; round++) {
  for (var i = 0; i < vals.length; i++) {
    var a = vals[i], b = vals[(i * 7 + round) % vals.length];
    var isNum = typeof a == "number" && typeof b == "number";
    var r = [show(orOf(a, b)), show(andOf(a, b)), show(notOf(a))];
    if (isNum) r.push(show(mul(a, b)), show(div(a, b)), show(mod(a, b)), show(add(a, b)), show(sub(a, b)), show(lt(a, b)), lte(a, b), gt(a, b));
    if (round < 2 || round == 399) out.push(r.join(","));
    sum = (sum + r.join(",").length) | 0;
  }
  var arr = [1, 2, 3]; if (round & 1) arr.push(4);
  sum += len(arr) + len("hello") + argsLen(1, 2, round) + name(round).length;
  var o = {p: 0}; sum += chain(o, round) + o.p;
  var s = setArg(round); sum += s.g + s.f;
  var p = make(round); sum += p.x + p.y;
  sum += makeBoxed(round).v;
  sum += makeThrower(round);
  if (round % 50 == 0) out.push(makeBad(notOf), makeBad(Math.max), makeBad(undefined));
  sum = sum | 0;
}
console.log(out.join("\n"));
console.log(sum);
