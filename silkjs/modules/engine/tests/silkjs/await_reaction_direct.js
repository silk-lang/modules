// An await's reaction job resumes the async function directly: ordering against
// other jobs, rejections, thrown errors and values that are not promises.
var log = [];
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

async function counter(name, n) {
  var total = 0;
  for (var i = 0; i < n; i++) { total += await i; log.push(name + i); }
  return total;
}
async function rejects() {
  try { await Promise.reject(new TypeError("no")); return "missed"; }
  catch (e) { log.push("caught " + (e instanceof TypeError)); return "caught"; }
}
async function throwsAfter() {
  await null;
  throw new RangeError("late");
}
async function thenable() {
  return await { then: function (resolve) { log.push("then called"); resolve(7); } };
}
async function resolved() {
  var p = Promise.resolve(3);
  var a = await p;
  var b = await p;
  return a + b;
}

var results = [];
var all = [];
all.push(counter("a", 3).then(function (v) { results.push("a=" + v); }));
Promise.resolve().then(function () { log.push("then1"); }).then(function () { log.push("then2"); });
all.push(counter("b", 2).then(function (v) { results.push("b=" + v); }));
all.push(rejects().then(function (v) { results.push(v); }));
all.push(throwsAfter().catch(function (e) { results.push("late " + (e instanceof RangeError)); }));
all.push(thenable().then(function (v) { results.push("thenable=" + v); }));
all.push(resolved().then(function (v) { results.push("resolved=" + v); }));

// Many awaits in one function and across functions.
async function deep(n) { var s = 0; for (var i = 0; i < n; i++) s += await Promise.resolve(i); return s; }
var deepDone = false;
all.push(Promise.all([deep(500), deep(300)]).then(function (v) { check(v[0], 124750, "deep 500"); check(v[1], 44850, "deep 300"); deepDone = true; }));

Promise.all(all).then(function () {
  check(log.join(","), "a0,then1,b0,caught true,then called,a1,then2,b1,a2", "order");
  check(results.join(","), "caught,late true,b=1,thenable=7,resolved=6,a=3", "results");
  check(deepDone, true, "deep done");
  if (failures) throw new Error(failures + " await checks failed");
});
