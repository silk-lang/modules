// Regression tests for HTTP Phase 2:
// 1. OP_typeof fast path (Op.Typeof / jitTypeofStr) across all JS value kinds,
//    unboxed int32/float64/bool operands, inlined helpers, and Proxy deopt/fallback.
// 2. OP_to_object fast path (Op.CheckTag(-1)) for objects, inlined helpers,
//    primitive boxing fallback, and null/undefined TypeError throws.

function getType(v) {
  return typeof v;
}

function getTypeUnboxed(n, f, b) {
  var t1 = typeof (n + 1);
  var t2 = typeof (f + 0.5);
  var t3 = typeof (!b);
  return t1 + ":" + t2 + ":" + t3;
}

function tinyTypeHelper(x) {
  return typeof x;
}

function inlineTypeCaller(x) {
  return tinyTypeHelper(x);
}

function getTypeWithPrefix(prefix, v) {
  // Keeps extra values live on the operand stack across OP_typeof to verify deopt state.
  return prefix + ":" + (typeof v);
}

function extractPair(o) {
  var { a, b } = o;
  return a + b;
}

function tinyExtract(o) {
  var { a } = o;
  return a;
}

function inlineExtractCaller(o) {
  return tinyExtract(o) + 1;
}

function extractLen(v) {
  var { length } = v;
  return length;
}

function sumKeys(o) {
  var n = 0;
  for (var k in o) {
    n += k.length;
  }
  return n;
}

// 1. Warm up OP_typeof across all non-Proxy JS value kinds.
var sym = Symbol("k");
var fn = function() { return 1; };
var obj = { a: 10, b: 20 };
var arr = [1, 2, 3];
var samples = [
  42,
  -0.0,
  3.14,
  NaN,
  true,
  false,
  "",
  "hello",
  undefined,
  null,
  obj,
  arr,
  fn,
  Math.sin,
  sym,
  123n,
  0n
];

var typeCounts = {};
var unboxedOk = 0;
var inlineTypeOk = 0;
var prefixOk = 0;

for (var i = 0; i < 3000; i++) {
  var v = samples[i % samples.length];
  var t = getType(v);
  typeCounts[t] = (typeCounts[t] || 0) + 1;
  if (getTypeUnboxed(i, i * 0.25, (i & 1) === 0) === "number:number:boolean") {
    unboxedOk++;
  }
  if (inlineTypeCaller(v) === t) {
    inlineTypeOk++;
  }
  if (getTypeWithPrefix("p", v) === "p:" + t) {
    prefixOk++;
  }
}

print("types:",
  typeCounts["number"],
  typeCounts["boolean"],
  typeCounts["string"],
  typeCounts["undefined"],
  typeCounts["object"],
  typeCounts["function"],
  typeCounts["symbol"],
  typeCounts["bigint"]);
print("unboxed:", unboxedOk, "inlineType:", inlineTypeOk, "prefix:", prefixOk);

// Verify Proxy triggers clean deopt/fallback both for object target and callable target.
var objProxy = new Proxy({ a: 1 }, {});
var fnProxy = new Proxy(function() { return 2; }, {});
var proxyResults = [
  getType(objProxy),
  getType(fnProxy),
  inlineTypeCaller(objProxy),
  inlineTypeCaller(fnProxy),
  getTypeWithPrefix("px", objProxy),
  getTypeWithPrefix("pf", fnProxy)
];
// Re-run after Proxy deopt to test widened fallback and non-Proxy values afterward.
for (var j = 0; j < 1000; j++) {
  proxyResults.push(getType((j & 1) === 0 ? objProxy : fnProxy));
}
print("proxy:",
  proxyResults[0], proxyResults[1],
  proxyResults[2], proxyResults[3],
  proxyResults[4], proxyResults[5],
  proxyResults[proxyResults.length - 2], proxyResults[proxyResults.length - 1],
  getType(42), getType("ok"), getType(null), getType(undefined));

// 2. Warm up OP_to_object fast path on objects.
var pairSum = 0;
var inlineExtSum = 0;
var lenSum = 0;
var keySum = 0;

for (var m = 0; m < 3000; m++) {
  var o = { a: m & 7, b: (m & 3) + 1 };
  pairSum += extractPair(o);
  inlineExtSum += inlineExtractCaller(o);
  lenSum += extractLen(arr);
  keySum += sumKeys(o);
}
print("toObjFast:", pairSum, inlineExtSum, lenSum, keySum);

// Trigger OP_to_object primitive boxing fallback after optimization.
var primLens = [
  extractLen("hello"),
  extractLen("ab"),
  extractLen(arr),
  extractLen("")
];
// Re-run hot with mixed strings and arrays after widening.
var mixedLenSum = 0;
for (var p = 0; p < 1000; p++) {
  mixedLenSum += extractLen((p & 1) === 0 ? "abcd" : arr);
}
print("toObjPrim:", primLens.join(","), mixedLenSum);

// Trigger OP_to_object TypeError on null and undefined (both before and after widening).
var errMask = 0;
try { extractPair(null); } catch (e) { if (e instanceof TypeError) errMask |= 1; }
try { extractPair(undefined); } catch (e) { if (e instanceof TypeError) errMask |= 2; }
try { extractPair(null); } catch (e) { if (e instanceof TypeError) errMask |= 4; }
try { inlineExtractCaller(null); } catch (e) { if (e instanceof TypeError) errMask |= 8; }
try { inlineExtractCaller(undefined); } catch (e) { if (e instanceof TypeError) errMask |= 16; }
try { extractLen(null); } catch (e) { if (e instanceof TypeError) errMask |= 32; }
try { extractLen(undefined); } catch (e) { if (e instanceof TypeError) errMask |= 64; }
// Verify objects still work cleanly after null/undefined errors.
var afterErr = extractPair({ a: 100, b: 23 }) + inlineExtractCaller({ a: 40 });
print("toObjErr:", errMask, afterErr);
