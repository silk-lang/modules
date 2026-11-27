// for-in loops over objects of one shape reuse the parked iterator's key table
// and read keys from the shape's enumeration cache; each case checks the keys
// against what the loop must visit.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function keysOf(o) { var out = []; for (var k in o) out.push(k); return out.join(","); }

var objs = [];
for (var i = 0; i < 20; i++) objs.push({ id: i, name: "n" + i, w: i * 3 });
for (var round = 0; round < 3; round++) {
  for (var i = 0; i < 200; i++) {
    var got = keysOf(objs[i % 20]);
    if (got !== "id,name,w") { check(got, "id,name,w", "same shape " + i); break; }
  }
  // Breaking out early, then a full loop.
  for (var k in objs[0]) { if (k === "name") break; }
  check(keysOf(objs[1]), "id,name,w", "after break");
  // Nested loops over one shape.
  var pairs = [];
  for (var a in objs[2]) for (var b in objs[3]) pairs.push(a + b);
  check(pairs.length + ":" + pairs[0] + ":" + pairs[8], "9:idid:ww", "nested");
  // Keys deleted or added during the loop.
  var d = { id: 1, name: 2, w: 3 };
  var seen = [];
  for (var k in d) { seen.push(k); if (k === "id") delete d.name; }
  check(seen.join(","), "id,w", "delete during loop");
  check(keysOf(objs[4]), "id,name,w", "after delete loop");
  var e = { id: 1, name: 2, w: 3 };
  seen = [];
  for (var k in e) { seen.push(k); if (k === "id") e.extra = 1; }
  check(seen.join(","), "id,name,w", "add during loop");
  check(keysOf(e), "id,name,w,extra", "added key");
  // A shape change between loops.
  var f = { id: 1, name: 2, w: 3 };
  keysOf(f);
  f.more = 4;
  check(keysOf(f), "id,name,w,more", "grown object");
  Object.defineProperty(f, "id", { enumerable: false });
  check(keysOf(f), "name,w,more", "hidden key");
  check(keysOf(objs[5]), "id,name,w", "plain again");
  // An enumerable property on the prototype chain shows up.
  Object.prototype.inherited = 1;
  check(keysOf(objs[6]), "id,name,w,inherited", "inherited key");
  delete Object.prototype.inherited;
  check(keysOf(objs[7]), "id,name,w", "inherited removed");
  var proto = { p: 1 };
  var child = Object.create(proto);
  child.id = 1; child.name = 2; child.w = 3;
  check(keysOf(child), "id,name,w,p", "own prototype");
  // A generator suspended inside a loop keeps its iterator.
  function* gen(o) { for (var k in o) yield k; }
  var g = gen(objs[8]);
  var first = g.next().value;
  check(keysOf(objs[9]), "id,name,w", "loop while suspended");
  check(first + "," + g.next().value + "," + g.next().value + "," + g.next().done, "id,name,w,true", "suspended loop");
  // Arrays, strings and other shapes between same-shape loops.
  check(keysOf([7, 8]), "0,1", "array");
  check(keysOf("ab"), "0,1", "string");
  check(keysOf({ x: 1 }), "x", "other shape");
  check(keysOf(objs[10]), "id,name,w", "back to the shape");
  // The loop's object is kept alive by the loop, not by the table.
  var made = [];
  for (var i = 0; i < 50; i++) { var o = { id: i, name: i, w: i }; for (var k in o) made.push(k); }
  check(made.length, 150, "fresh objects");
  if (typeof gc === "function") gc();
  check(keysOf(objs[11]), "id,name,w", "after collection");
}
if (failures) throw new Error(failures + " for-in checks failed");
say("ok");
