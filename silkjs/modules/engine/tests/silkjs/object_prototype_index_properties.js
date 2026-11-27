// An integer-keyed property on Object.prototype is on every Array's prototype
// chain: a store past the end of an Array must find its setter (or its
// read-only data property) there, as it would on Array.prototype. Results are
// kept in strings, since Arrays themselves misbehave while the property is there.
var failures = 0;
function check(got, want, label) { if (got !== want) { failures++; print("FAIL", label, got, want); } }
var calls = "";
function five() { return [1, 2, 3, 4, 5]; }

function withSetter(run) {
  calls = "";
  Object.defineProperty(Object.prototype, 3, { set: function (v) { calls += "set" + v + ";"; }, get: function () { return "got"; }, configurable: true });
  var out;
  try { out = run(); } finally { delete Object.prototype[3]; }
  return out + "|" + calls;
}
function withReadOnly(run) {
  Object.defineProperty(Object.prototype, 2, { value: "ro", writable: false, configurable: true });
  var out;
  try { out = run(); } catch (e) { out = "threw " + (e instanceof TypeError); } finally { delete Object.prototype[2]; }
  return out;
}
function own(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

for (var round = 0; round < 4; round++) {
  // Stores that go through [[Set]] find the setter.
  check(withSetter(function () { var a = [1, 2, 3]; a[3] = 4; return a.length + "," + a[3] + "," + own(a, 3); }), "3,got,false|set4;", "indexed store past the end");
  check(withSetter(function () { var a = [1, 2, 3]; a.push(9); return a.length + "," + a[3] + "," + own(a, 3); }), "4,got,false|set9;", "push");
  check(withSetter(function () { var a = [1, 2, 3]; a.push(7, 8, 9); return a.length + "," + a[3] + "," + a[4] + "," + a[5]; }), "6,got,8,9|set7;", "push of three");
  check(withSetter(function () { var a = [1, 2, 3]; a.unshift(0); return a.length + "," + a[0] + "," + a[3] + "," + own(a, 3); }), "4,0,got,false|set3;", "unshift");
  check(withSetter(function () { var a = [1, 2, 3]; a.splice(1, 0, "x"); return a.length + "," + a[1] + "," + a[3] + "," + own(a, 3); }), "4,x,got,false|set3;", "splice that grows");
  check(withSetter(function () { var a = [1, 2, 3]; for (var i = 3; i < 6; i++) a[i] = i; return a.length + "," + own(a, 3) + "," + a[4] + "," + a[5]; }), "6,false,4,5|set3;", "stores in a loop");
  check(withSetter(function () { var a = new Array(5); a.fill(1); return a.length + "," + own(a, 3) + "," + a[4]; }), "5,false,1|set1;", "fill");
  check(withSetter(function () { var o = {}; o[3] = 1; return own(o, 3) + "," + o[3]; }), "false,got|set1;", "store on a plain object");
  check(withSetter(function () { var o = Object.assign({}, { 3: 5 }); return own(o, 3) + ""; }), "false|set5;", "Object.assign");
  check(withSetter(function () { function f() { arguments[3] = 1; return arguments.length + "," + own(arguments, 3); } return f(1, 2, 3); }), "3,false|set1;", "store on arguments");
  check(withSetter(function () { var a = [1, 2, 3]; return a[3] + "," + a[4] + "," + (3 in a); }), "got,undefined,true|", "read past the end");
  check(withSetter(function () { var a = [1, 2, , 4, 5]; a.length = 3; return a[3] + "," + a.indexOf("got") + "," + a.includes("got"); }), "got,-1,false|", "read of a removed element");

  // Definitions do not consult the prototype chain.
  check(withSetter(function () { var a = five().map(function (x) { return x * 2; }); return a.length + "," + a[3] + "," + own(a, 3); }), "5,8,true|", "map");
  check(withSetter(function () { var a = five().filter(function () { return true; }); return a.length + "," + a[3]; }), "5,4|", "filter");
  check(withSetter(function () { var a = Array.from(five()); return a.length + "," + a[3]; }), "5,4|", "Array.from");
  check(withSetter(function () { var a = five().slice(); return a.length + "," + a[3]; }), "5,4|", "slice");
  check(withSetter(function () { var a = [1, 2, 3].concat([4, 5]); return a.length + "," + a[3]; }), "5,4|", "concat");
  check(withSetter(function () { var b = five(); var a = [...b]; return a.length + "," + a[3]; }), "5,4|", "spread");
  check(withSetter(function () { var a = [1, 2, 3, 4, 5]; return a.length + "," + a[3]; }), "5,4|", "literal");
  check(withSetter(function () { var a = JSON.parse("[1,2,3,4,5]"); return a.length + "," + a[3]; }), "5,4|", "JSON.parse");
  check(withSetter(function () { var a = "a,b,c,d,e".split(","); return a.length + "," + a[3]; }), "5,d|", "split");
  check(withSetter(function () { var a = Array.of(1, 2, 3, 4, 5); return a.length + "," + a[3]; }), "5,4|", "Array.of");
  check(withSetter(function () { var o = { 3: 1 }; return own(o, 3) + "," + o[3]; }), "true,1|", "object literal");
  check(withSetter(function () { var o = { ...{ 3: 1 } }; return own(o, 3) + "," + o[3]; }), "true,1|", "object spread");

  // A read-only data property stops the store: silently in sloppy code, with
  // a TypeError where the store must succeed.
  check(withReadOnly(function () { var a = [1, 2]; a[2] = 7; return a.length + "," + a[2] + "," + own(a, 2); }), "2,ro,false", "store over a read-only property");
  check(withReadOnly(function () { "use strict"; var a = [1, 2]; a[2] = 7; return "stored"; }), "threw true", "strict store over a read-only property");
  check(withReadOnly(function () { var a = [1, 2]; a.push(7); return "pushed"; }), "threw true", "push over a read-only property");
  check(withReadOnly(function () { var a = [1, 2, 3].map(function (x) { return x + 1; }); return a.length + "," + a[2]; }), "3,4", "map over a read-only property");

  // A plain data property changes nothing for stores.
  Object.prototype[4] = "data";
  var p = [1, 2, 3];
  check(p[4] + "," + p.length, "data,3", "read of a data property");
  p[3] = 1; p[4] = 2;
  check(p.length + "," + p[4] + "," + own(p, 4), "5,2,true", "store over a data property");
  delete Object.prototype[4];

  // Once the property is gone, Arrays behave as before.
  var q = [1, 2, 3]; q[3] = 4; q.push(5);
  check(q.length + "," + q[3] + "," + q[4] + "," + own(q, 3), "5,4,5,true", "after the property is deleted");
}

// The property arrives while a loop is already storing.
var grown = [];
calls = "";
for (var i = 0; i < 2000; i++) {
  if (i === 1500) Object.defineProperty(Object.prototype, 1700, { set: function (v) { calls += "late" + v + ";"; }, configurable: true });
  grown[i] = i;
}
delete Object.prototype[1700];
check(grown.length + "," + own(grown, 1700) + "," + grown[1699] + "," + grown[1701] + "|" + calls, "2000,false,1699,1701|late1700;", "a setter added while a loop stores");

// A plain data property first, by each way of adding one, then made a setter:
// the first add is what ends the fast stores, since the redefinition adds nothing.
function later(index, add) {
  add(index);
  calls = "";
  Object.defineProperty(Object.prototype, index, { set: function (v) { calls += "redefined" + v + ";"; }, configurable: true });
  var a = []; for (var i = 0; i <= index; i++) a[i] = i;
  var b = []; for (var j = 0; j <= index; j++) b.push(j);
  delete Object.prototype[index];
  return a.length + "," + own(a, index) + "," + b.length + "," + own(b, index) + "|" + calls;
}
function wanted(index) { return index + ",false," + (index + 1) + ",false|redefined" + index + ";redefined" + index + ";"; }
check(later(6, function (k) { Object.prototype[k] = 1; }), wanted(6), "keyed store, then a setter");
check(later(7, function (k) { Object.assign(Object.prototype, { 7: 1 }); }), wanted(7), "Object.assign, then a setter");
check(later(8, function (k) { Reflect.defineProperty(Object.prototype, k, { value: 1, writable: true, configurable: true }); }), wanted(8), "Reflect.defineProperty, then a setter");
check(later(9, function (k) { Object.defineProperties(Object.prototype, { 9: { value: 1, writable: true, configurable: true } }); }), wanted(9), "Object.defineProperties, then a setter");
check(later(10, function (k) { Reflect.set(Object.prototype, k, 1); }), wanted(10), "Reflect.set, then a setter");
check(later(11, function (k) { Object.prototype["11"] = 1; }), wanted(11), "string key, then a setter");

// Array.prototype's own index properties keep working the same way.
calls = "";
Object.defineProperty(Array.prototype, 2, { set: function (v) { calls += "array" + v + ";"; }, configurable: true });
var under = [1, 2]; under[2] = 3; under.push(4);
delete Array.prototype[2];
check(under.length + "," + own(under, 2) + "|" + calls, "3,false|array3;array4;", "a setter on Array.prototype");

// Object.prototype's own prototype cannot change, so nothing else can get
// under an Array that way.
var refused = false;
try { Object.setPrototypeOf(Object.prototype, { 12: 1 }); } catch (e) { refused = e instanceof TypeError; }
check(refused, true, "Object.prototype keeps its prototype");

if (failures) throw new Error(failures + " Object.prototype index property checks failed");
