// Object and array literals, `__proto__` in a literal and rest parameters in functions the
// optimizer compiles: the engine makes them on the operand cells. Each phase warms them up,
// then changes what they meet: an accessor on Object.prototype under a literal's key (a
// literal defines, never sets), a prototype that is a primitive or null, values that are
// objects, many rest arguments, and a literal with a computed and a spread part.
var proto = { kind: 'p' };
function point(x, y) { return { x: x, y: y, sum: x + y, tag: 'pt' }; }
function withProto(p, v) { return { __proto__: p, v: v }; }
function list(a, b, c) { return [a, b, c, a]; }
function tail(first, ...rest) { return rest.length + (rest[0] | 0) + first; }
function mixed(k, o) { return { [k]: 1, ...o, z: k }; }
var setterHits = 0;
function turn(n) {
  var t = 0;
  for (var i = 0; i < 6; i++) {
    var p = point(i, n & 7);
    t += p.sum + p.x + (p.tag === 'pt' ? 1 : 2);
    var w = withProto(i & 1 ? proto : null, i);
    t += w.v + (w.kind === 'p' ? 3 : 0) + (Object.getPrototypeOf(w) === null ? 5 : 0);
    var l = list(i, p, 'x');
    t += l.length + (l[1] === p ? 1 : 0) + l[3];
    t += tail(i, n, 2, 3) + tail(i);
    var m = mixed('k' + (i & 3), p);
    t += m['k' + (i & 3)] + m.x + m.z.length;
  }
  return t;
}
function phase(change, rounds) {
  var total = 0;
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  change();
  for (var n = 0; n < rounds; n++) {
    var r;
    try { r = turn(n); } catch (e) { r = e instanceof TypeError ? 77 : 99; }
    total = (total * 7 + (r | 0)) % 1000003;
  }
  return total + ' ' + setterHits;
}
var out = [];
out.push(phase(function () {}, 300));
out.push(phase(function () { Object.defineProperty(Object.prototype, 'sum', { set: function (v) { setterHits++; }, get: function () { return -1; }, configurable: true }); }, 300));
out.push(phase(function () { proto = 7; }, 300));
out.push(phase(function () { proto = { kind: 'p', get v() { return 100; } }; }, 300));
out.push(phase(function () { var big = []; for (var j = 0; j < 40; j++) big.push(j); tail = function (first, ...rest) { return rest.length + first; }; turn(1); }, 300));
out.push(phase(function () { delete Object.prototype.sum; Object.prototype.tag = 'other'; }, 300));
print(out.join(" | "));
