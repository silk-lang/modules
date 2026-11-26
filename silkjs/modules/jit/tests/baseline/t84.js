// Phase 10 regression test:
// 1. Inline non-numeric Op.ConstVal (push_const8 and push_const >= 256)
//    - single-block borrowed string/regexp constants (zero retain/release)
//    - escaping/returned/stored owned string constants (proper retain/release)
//    - loop-carried and branch-joined string constants
// 2. Polymorphic field-read recompile warmup convergence across multiple shapes

// --- 1a. Single-block borrowed + escaping owned string constants ---
function constStrings(i, mode) {
  let s = "hello-phase10";
  let t = "world-const";
  let hit = s.indexOf("phase") + t.length;
  if (mode === 0) return s;          // escaping owned constant
  if (mode === 1) return t + ":" + i; // borrowed concat
  let out = "branch-" + (i & 3);
  if ((i & 1) === 0) {
    out = "even-constant-value";     // branch-joined owned constant
  } else {
    out = "odd-constant-value";
  }
  return out + "/" + hit;
}

let saved = [];
let r1 = 0;
for (let i = 0; i < 400; i++) {
  let m = i % 3;
  let v = constStrings(i, m);
  r1 += v.length;
  if (i === 50 || i === 51 || i === 52 || i === 399) saved.push(v);
}

// --- 1b. Constant strings in loops and stored into objects/arrays ---
function constInLoop(n) {
  let arr = [];
  let obj = {};
  for (let i = 0; i < n; i++) {
    let tag = (i & 1) ? "alpha-const" : "beta-const";
    arr.push(tag);
    obj.last = tag;
  }
  return arr.length + obj.last.length + (arr[0] === "beta-const" ? 1 : 0) + (arr[1] === "alpha-const" ? 2 : 0);
}
let r2 = 0;
for (let i = 0; i < 60; i++) r2 += constInLoop(16);

// --- 1c. RegExp / string match hot loop (regexp benchmark pattern) ---
function matchHot(str, n) {
  let re = /ab+c/g;
  let count = 0;
  for (let i = 0; i < n; i++) {
    let m = str.match(re);
    if (m) count += m.length;
    if (str.indexOf("abbc") >= 0) count += 1;
    if (str.indexOf("missing-needle") >= 0) count += 100;
  }
  return count;
}
let r3 = 0;
for (let i = 0; i < 80; i++) {
  r3 += matchHot("xxabc yyabbc zzabbbc", 5);
}

// --- 1d. Large constant pool (index >= 256 -> OP_push_const) ---
let wideCode = "function widePool(k) {\n  let s = 0;\n";
for (let i = 0; i < 270; i++) {
  wideCode += "  if (k === " + i + ") return \"str_const_" + i + "\";\n";
}
wideCode += "  return \"fallback_const\";\n}\nwidePool;\n";
let wideFn = eval(wideCode);
let r4 = 0;
for (let i = 0; i < 300; i++) {
  let idx = (i * 17) % 275;
  r4 += wideFn(idx).length;
}

// --- 2. Polymorphic field-read convergence across shapes ---
function polySum(a, b, c) {
  let acc = 0;
  acc += a.x + a.y;
  acc += b.x + b.y;
  acc += c.x + c.y;
  if (a.z) acc += a.z;
  if (b.z) acc += b.z;
  if (c.z) acc += c.z;
  return acc;
}
let shapes = [
  { x: 1, y: 2 },
  { y: 3, x: 4, z: 5 },
  { a: 0, x: 6, y: 7, z: 8 },
  { b: 1, c: 2, x: 9, y: 10 },
  { x: 11, extra: 1, y: 12, z: 13 }
];
let r5 = 0;
for (let i = 0; i < 500; i++) {
  // Phase in new shapes gradually to exercise polymorphic guard learning + recompile warmup
  let limit = i < 60 ? 1 : (i < 120 ? 2 : (i < 180 ? 3 : (i < 240 ? 4 : 5)));
  let s0 = shapes[i % limit];
  let s1 = shapes[(i + 1) % limit];
  let s2 = shapes[(i + 2) % limit];
  r5 += polySum(s0, s1, s2);
}

print(r1, saved.join("|"), r2, r3, r4, r5);
