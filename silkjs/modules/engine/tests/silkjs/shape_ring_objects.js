// Short-lived objects whose shapes outlive them in the retired-shape ring: the
// next object of the same layout reuses the shape, and layouts past the ring's
// size cycle through it.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }
function keys(o) { return Object.keys(o).join(","); }

var base = [];
for (var i = 0; i < 50; i++) base.push({ id: i, name: "n" + i, w: i * 3 });

for (var round = 0; round < 3; round++) {
  // Spread plus a field, and a literal plus an added field, in a loop.
  var total = 0;
  for (var i = 0; i < 2000; i++) {
    var o = { ...base[i % 50], extra: i };
    total += o.extra + o.w;
    var p = { x: i, y: 2 };
    p.z = i;
    total += p.z;
  }
  check(total, 2 * (1999 * 2000 / 2) + 40 * 3 * (49 * 50 / 2), "loop totals " + round);
  var last = { ...base[3], extra: 7 };
  check(keys(last), "id,name,w,extra", "spread keys");
  check(last.name, "n3", "spread value");

  // More layouts than the ring holds, each built, used and dropped.
  var sum = 0;
  for (var k = 0; k < 600; k++) {
    var q = {};
    q["k" + k] = k;
    q.tail = 1;
    sum += q["k" + k] + q.tail;
  }
  check(sum, 599 * 600 / 2 + 600, "many layouts");
  // The same layouts again: the shapes found again hold the right keys.
  for (var k = 0; k < 600; k += 37) {
    var r = {};
    r["k" + k] = -k;
    r.tail = 2;
    check(keys(r), "k" + k + ",tail", "layout again " + k);
    check(r["k" + k], -k, "value again " + k);
  }

  // Objects with their own prototypes, dropped and made again.
  for (var j = 0; j < 300; j++) {
    var proto = { greet: function () { return this.who; }, tag: j };
    var made = Object.create(proto);
    made.who = "w" + j;
    if (made.greet() !== "w" + j || made.tag !== j) { check(made.greet(), "w" + j, "prototype " + j); break; }
  }
  var shared = { kind: "shared" };
  for (var j = 0; j < 300; j++) {
    var child = Object.create(shared);
    child.n = j;
    if (child.kind !== "shared") { check(child.kind, "shared", "shared prototype"); break; }
  }
  check(Object.getPrototypeOf(Object.create(shared)), shared, "prototype kept");

  // Deletes and reconfigured properties leave the ring's shapes alone.
  for (var j = 0; j < 100; j++) {
    var d = { a: 1, b: 2, c: 3 };
    delete d.b;
    d.e = j;
    if (keys(d) !== "a,c,e") { check(keys(d), "a,c,e", "after delete"); break; }
    var f = { a: 1 };
    Object.defineProperty(f, "a", { enumerable: false });
    f.g = 2;
    if (keys(f) !== "g") { check(keys(f), "g", "after reconfigure"); break; }
  }

  // Frozen and sealed objects of a ring shape's layout.
  var fr = Object.freeze({ x: 1, y: 2, z: 3 });
  var plain = { x: 4, y: 5 };
  plain.z = 6;
  check(Object.isFrozen(fr) && !Object.isFrozen(plain), true, "frozen kept apart");
  plain.x = 9;
  check(plain.x, 9, "plain stays writable");
}

if (typeof gc === "function") gc();
var after = { ...base[1], extra: 1 };
check(keys(after) + "/" + after.extra, "id,name,w,extra/1", "after collection");

if (failures) throw new Error(failures + " shape ring checks failed");
say("ok");
