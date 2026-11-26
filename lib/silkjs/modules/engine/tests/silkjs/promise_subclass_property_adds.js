// SilkJS regression test for put_field adding properties in place on promise
// instances (Promise subclass constructors like postgres.js's Query):
// setters and read-only properties on the prototype chain, non-extensible
// promises, key order. Expected values from Node.
var out = [];
class Q extends Promise {
  static get [Symbol.species]() { return Promise; }
  constructor(a) { var r; super(function (x) { r = x; }); this.a = a; this.b = 2; this.c = 'c'; r(a); }
}
var q1 = new Q(1), q2 = new Q(2);
out.push(Object.keys(q1).join(' '), q1.a + q2.a, q2.c, Object.getOwnPropertyDescriptor(q1, 'b').writable);
Object.defineProperty(Q.prototype, 'b', { set: function (v) { out.push('setter ' + v); }, configurable: true });
var q3 = new Q(3); out.push(Object.keys(q3).join(' '), Object.prototype.hasOwnProperty.call(q3, 'b'));
delete Q.prototype.b;
Object.defineProperty(Promise.prototype, 'c', { value: 'ro', writable: false, configurable: true });
try { new Q(4); } catch (e) { out.push(e.constructor.name); }
try { (function () { 'use strict'; var p = Promise.resolve(1); p.c = 5; })(); } catch (e) { out.push(e.constructor.name); }
delete Promise.prototype.c;
var q5 = new Q(5); Object.preventExtensions(q5);
try { (function () { 'use strict'; q5.z = 1; })(); } catch (e) { out.push(e.constructor.name); }
var plain = Promise.resolve(7); plain.x = 1; plain.y = 2; out.push(Object.keys(plain).join(' '));
var q6 = new Q(6); q6.then(function (v) { out.push('then ' + v); var got = out.join('|');
  var expected = 'a b c|3|c|true|setter 2|a c|false|TypeError|TypeError|TypeError|x y|then 6';
  console.log(got === expected ? 'PASS promise subclass property adds' : 'FAIL ' + got);
  if (got !== expected) throw new Error('promise property add regressions'); });
