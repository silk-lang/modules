// Jobs and promise records whose cells are reused after they die: settlement
// values, reaction order, rejections and thenables stay right across reuse.
var failures = 0;
var say = typeof print === "function" ? print : console.log;
function check(got, want, label) { if (got !== want) { failures++; say("FAIL", label, got, want); } }

var order = [];
async function counter(n) {
  var s = 0;
  for (var i = 0; i < n; i++) s += await Promise.resolve(i);
  for (var j = 0; j < n; j++) s += await j;
  return s;
}
async function thrower(i) { await null; if (i % 3 === 0) throw new Error("e" + i); return i; }
async function run() {
  check(await counter(500), 2 * (499 * 500 / 2), "await loop");
  var caught = 0, kept = 0;
  for (var i = 0; i < 300; i++) {
    try { kept += await thrower(i); } catch (e) { if (e.message === "e" + i) caught++; }
  }
  check(caught, 100, "rejections caught");
  check(kept, (299 * 300 / 2) - 3 * (99 * 100 / 2), "fulfilled kept");
  // Reactions queued by many short-lived promises keep FIFO order.
  var seen = [];
  var all = [];
  for (var k = 0; k < 100; k++) all.push(Promise.resolve(k).then(function (v) { seen.push(v); return v * 2; }));
  var doubled = await Promise.all(all);
  check(seen.join(","), Array.from({ length: 100 }, function (_, x) { return x; }).join(","), "reaction order");
  check(doubled[99], 198, "all result");
  // Thenables and chains that outlive their sources.
  var chain = Promise.resolve(0);
  for (var c = 0; c < 200; c++) chain = chain.then(function (v) { return { then: function (r) { r(v + 1); } }; });
  check(await chain, 200, "thenable chain");
  var settled = await Promise.allSettled([Promise.reject(1), Promise.resolve(2), 3]);
  check(settled.map(function (x) { return x.status; }).join(","), "rejected,fulfilled,fulfilled", "allSettled");
  // Interleaved tasks.
  async function tick(tag, n) { for (var t = 0; t < n; t++) { order.push(tag + t); await undefined; } }
  await Promise.all([tick("a", 3), tick("b", 3)]);
  check(order.join(","), "a0,b0,a1,b1,a2,b2", "interleave");
}
run().then(function () {
  if (typeof gc === "function") gc();
  return counter(3);
}).then(function (v) {
  check(v, 6, "after collection");
  if (failures) throw new Error(failures + " promise reuse checks failed");
  say("ok");
});
