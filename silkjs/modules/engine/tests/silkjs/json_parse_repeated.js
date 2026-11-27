// JSON.parse run many times on the same and on related texts: later parses take
// memoized key adds and the runtime's identifier cache.
var failures = 0;
function check(got, want, label) { if (got !== want) { failures++; print("FAIL", label, got, want); } }

var text = JSON.stringify({ a: [1, 2, 3], b: { c: "d", e: [true, null, 1.5] }, s: "hello" });
for (var round = 0; round < 20; round++) {
  var v = JSON.parse(text);
  check(JSON.stringify(v), text, "roundtrip " + round);
  check(Object.keys(v).join(","), "a,b,s", "keys " + round);
  check(v.b.e[1], null, "null " + round);
  check(v.b.e[0], true, "true " + round);
  check(v.a.length, 3, "array " + round);
  // Objects of one layout stay independent.
  v.b.c = round;
  check(JSON.parse(text).b.c, "d", "fresh " + round);
}

// Duplicate keys: the last value wins, in the first key's place.
for (var r = 0; r < 5; r++) {
  var d = JSON.parse('{"x":1,"y":2,"x":3}');
  check(Object.keys(d).join(","), "x,y", "duplicate order");
  check(d.x, 3, "duplicate value");
  var e = JSON.parse('{"x":1,"y":2}');
  check(e.x, 1, "after duplicate");
}

// Same keys in another order, and a key added to a known layout.
for (var r = 0; r < 5; r++) {
  check(Object.keys(JSON.parse('{"b":1,"a":2}')).join(","), "b,a", "other order");
  check(Object.keys(JSON.parse('{"a":1,"b":2,"c":3}')).join(","), "a,b,c", "longer");
  check(Object.keys(JSON.parse('{"a":1}')).join(","), "a", "shorter");
}

// Non-ASCII text takes the UTF-8 copy.
for (var r = 0; r < 3; r++) {
  var u = JSON.parse('{"café":"crème","k":["ü", "中"]}');
  check(u["café"], "crème", "latin1 key");
  check(u.k[0], "ü", "latin1 element");
  check(u.k[1], "中", "wide element");
}

// Errors right after a primitive, in objects and arrays.
var bad = ['{"a":1 "b":2}', '[1 2]', '["x" "y"]', '{"a":"s",}', '[true,]', '{"a":null x}', '[1,"two",'];
for (var r = 0; r < 3; r++) {
  for (var i = 0; i < bad.length; i++) {
    var threw = false;
    try { JSON.parse(bad[i]); } catch (err) { threw = err instanceof SyntaxError; }
    check(threw, true, "syntax error " + bad[i]);
  }
}

// Reviver sees every primitive.
var seen = [];
JSON.parse('{"p":[1,"q",false],"r":null}', function (k, v) { if (typeof v !== "object" || v === null) seen.push(k + "=" + v); return v; });
check(seen.join(";"), "0=1;1=q;2=false;r=null", "reviver");

if (failures) throw new Error(failures + " JSON checks failed");
