// Phase 11 regression test:
// 1. Own-scope optimized functions (in-frame scope, promoted heap scope via OP_fclosure8
//    STEP_QUICK, inline Op.PutScope / OUT_PUT_LAST heap displacement, deopt/throw unwind)
// 2. Frame-mode >8-argument calls and >8-element OP_array_from literals (splay / earley-boyer)
// 3. Inline frame-mode lazy arguments reads (arguments.length, arguments[i], get_loc_length8/el8)

// --- 1a. In-frame own scope with known nested helper + heap slot displacement ---
function scopedInFrame(n, seed) {
  let acc = seed;
  let obj = { v: 1 };
  let helper = function(k) {
    acc += k + obj.v;
    if ((k & 3) === 0) obj = { v: (k & 7) + 1 };
    return acc;
  };
  let total = 0;
  for (let i = 0; i < n; i++) {
    total += helper(i);
  }
  return total + obj.v;
}
let r1 = 0;
for (let i = 0; i < 80; i++) r1 += scopedInFrame(12, i & 7);

// --- 1b. Promoted heap scope via escaping closure (OP_fclosure8 STEP_QUICK + SERVICE_SCOPE) ---
function makeCounter(start, tag) {
  let count = start;
  let label = { name: tag };
  let inc = function(step) {
    count += step;
    label = { name: label.name + ":" + step };
    return count + label.name.length;
  };
  count += 1;
  if ((start & 1) === 0) {
    // Also mutate after closure creation so promoted heap scope is used by writeScope.
    count += 2;
  }
  return inc;
}
let fns = [];
let r2 = 0;
for (let i = 0; i < 80; i++) {
  let fn = makeCounter(i, "t" + (i & 3));
  r2 += fn(1) + fn(2);
  if (i === 5 || i === 75) fns.push(fn);
}
r2 += fns[0](3) + fns[1](4);

// --- 1c. Own-scope deopt and exception unwind ---
function scopedDeoptThrow(n, failAt, obj) {
  let s = 0;
  let box = { x: 10 };
  let add = function(k) {
    s += k + box.x;
  };
  for (let i = 0; i < n; i++) {
    add(i);
    if (i === failAt) throw new Error("boom:" + s);
    s += obj.val;
  }
  return s;
}
let r3 = 0;
for (let i = 0; i < 80; i++) {
  let arg = (i === 60) ? { extra: 1, val: 5 } : { val: 2 }; // shape change triggers deopt
  try {
    r3 += scopedDeoptThrow(6, (i === 70) ? 3 : -1, arg);
  } catch (e) {
    r3 += e.message.length;
  }
}

// --- 1d. Scoped caller calling outer-scope helper (OP_get_var_ref hop >= 1) ---
function makeOuter() {
  let scale = function(a, b) { return a * 3 + b; };
  return function innerScoped(n, x) {
    let acc = x;
    let bump = function(d) { acc += d; };
    for (let i = 0; i < n; i++) {
      bump(scale(i, 2));
    }
    return acc;
  };
}
let outerRunner = makeOuter();
let r4 = 0;
for (let i = 0; i < 80; i++) r4 += outerRunner(8, i);

// --- 2. >8-argument calls (MAX_ARGUMENTS = 24 in frame mode) and >8-element array literal ---
function wideCall12(a) {
  return sum12(a, a + 1, a + 2, a + 3, a + 4, a + 5, a + 6, a + 7, a + 8, a + 9, a + 10, a + 11);
}
function wideArray12(a) {
  let arr12 = [a, a + 1, a + 2, a + 3, a + 4, a + 5, a + 6, a + 7, a + 8, a + 9, a + 10, a + 11];
  return arr12[0] + arr12[11];
}
function sum12(a0, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
  return a0 + a1 + a2 + a3 + a4 + a5 + a6 + a7 + a8 + a9 + a10 + a11;
}
let r5 = 0;
for (let i = 0; i < 80; i++) r5 += wideCall12(i) + wideArray12(i);

// --- 3. Lazy arguments reads (get_loc_length8/get_loc_el8 + arguments.length/arguments[i]) ---
function scListLike() {
  let a = arguments;
  let res = null;
  for (let i = a.length - 1; i >= 0; i--) {
    res = { car: a[i], cdr: res };
  }
  return res;
}
function lazyReadEdge() {
  let n = arguments.length;
  let sum = n;
  for (let i = 0; i < n; i++) {
    let v = arguments[i];
    sum += (typeof v === "number") ? v : v.length;
  }
  if (n === 2) {
    // Out-of-bounds read exercises deopt/exit fallback cleanly.
    let oob = arguments[n];
    if (oob !== undefined) sum += 1000;
    let neg = arguments[-1];
    if (neg !== undefined) sum += 2000;
  }
  return sum;
}
let r6 = 0;
for (let i = 0; i < 80; i++) {
  let list = scListLike(i, "x" + (i & 3), { k: i }, i + 1, i + 2);
  let cur = list;
  let len = 0;
  while (cur !== null) { len++; cur = cur.cdr; }
  r6 += len + list.car;
  r6 += lazyReadEdge();
  r6 += lazyReadEdge(1, "ab", 3, "cde", 5, 6, 7, 8, 9, 10);
  if (i === 50 || i === 75) r6 += lazyReadEdge(10, "hi");
}

print(r1, r2, r3, r4, r5, r6);
