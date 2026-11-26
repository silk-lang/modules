// A run-time string keeps one hash that Map/Set keys and property (atom) lookups
// share. Each side once wrote its own form there and trusted the other's: after
// Set.has(key), o[key] missed, and after a property miss, Map.get(key) missed.
let failures = 0;
function check(got, want, label) { if (got !== want) { failures++; console.log("FAIL", label, got, want); } }

const key = JSON.parse('"flex"');
new Set(["flex"]).has(key);
check(({ flex: 1 })[key], 1, "property read after Set.has");

const names = ["flex", "grid", "block", "inline", "node:module", "node:fs", "registerHooks", "a", "ab", "abc",
  "width", "height", "color", "background", "position", "display", "children", "value", "café", "πr²",
  "a rather long property name that is not stored inline in its cell"];
function fresh(name, how) {
  switch (how) {
    case 0: return JSON.parse(JSON.stringify(name));
    case 1: return (" " + name).slice(1);
    case 2: return ("x" + name + "y").substring(1, name.length + 1);
    case 3: return name.slice(0, 1) + name.slice(1);
    case 4: return `${name.slice(0, name.length - 1)}${name.slice(name.length - 1)}`;
    case 5: return (name + " ").trim();
    case 6: return String({ toString() { return name.slice(0); } });
    case 7: return name.toUpperCase().toLowerCase() === name ? name.toUpperCase().toLowerCase() : name.split("").join("");
    default: return name.split("").reverse().reverse().join("");
  }
}
class Holder {}
for (const name of names) {
  const literal = {}; literal[name] = 1;
  const wide = { a0: 0, a1: 0, a2: 0, a3: 0, a4: 0, a5: 0, a6: 0, a7: 0, a8: 0 }; wide[name] = 1;
  const instance = new Holder(); instance[name] = 1;
  const child = Object.create(literal);
  const map = new Map([[name, 1]]), set = new Set([name]);
  for (let how = 0; how < 9; how++) {
    // Collection first, then properties.
    for (let probe = 0; probe < 4; probe++) {
      const k = fresh(name, how);
      check(k === name, true, "fresh string equals its literal");
      if (probe === 0) check(set.has(k), true, "Set.has");
      if (probe === 1) check(new Set().has(k), false, "Set.has miss");
      if (probe === 2) check(map.get(k), 1, "Map.get");
      if (probe === 3) new Set().add(k);
      check(literal[k], 1, "read " + name + " after collection use " + how + "/" + probe);
      check(k in wide, true, "in after collection use");
      check(Object.hasOwn(instance, k), true, "hasOwn after collection use");
      check(child[k], 1, "prototype read after collection use");
      const written = {}; written[k] = 2;
      check(written[name], 2, "write after collection use");
      check(Object.keys(written).length, 1, "write makes one property");
      check(map.get(k), 1, "Map.get after properties");
      check(set.has(k), true, "Set.has after properties");
    }
    // Properties first (a miss and a hit), then collections.
    for (let probe = 0; probe < 3; probe++) {
      const k = fresh(name, how);
      if (probe === 0) check(({})[k], undefined, "property miss");
      if (probe === 1) check(literal[k], 1, "property hit");
      if (probe === 2) check(k in {}, false, "in miss");
      check(map.get(k), 1, "Map.get " + name + " after property use " + how + "/" + probe);
      check(set.has(k), true, "Set.has after property use");
      const m = new Map(); m.set(k, 3);
      check(m.get(name), 3, "Map.set after property use");
      check(m.get(fresh(name, (how + 1) % 9)), 3, "Map.get by another fresh string");
      check(literal[k], 1, "property read after both");
    }
  }
  // A name no object has: the lookup finds no atom, and the Map must still agree.
  const absent = fresh(name, 1) + "\u0001";
  const grown = fresh(name + "\u0001", 0);
  check(({})[absent], undefined, "absent property");
  const m = new Map([[grown, 4]]);
  check(m.get(absent), 4, "Map.get after an absent property");
  check(({})[grown], undefined, "absent property after Map.set");
  check(m.get(fresh(name + "\u0001", 3)), 4, "Map.get by a third string");
}

// A string appended to in place after a lookup must not keep its old hash.
function grows() {
  let s = "";
  const o = { abcdefghijklmnopqrstuvwxyz: 1 }, m = new Map([["abcdefghijklmnopqrstuvwxyz", 1]]);
  for (const c of "abcdefghijklmnopqrstuvwxyz") {
    s += c;
    check(o[s], s.length === 26 ? 1 : undefined, "property by a growing string");
    check(m.get(s), s.length === 26 ? 1 : undefined, "Map.get by a growing string");
  }
}
for (let i = 0; i < 3; i++) grows();

console.log(failures == 0 ? "PASS string kept hash" : "FAIL string kept hash " + failures);
if (failures != 0) throw new Error("string kept hash regressions");
