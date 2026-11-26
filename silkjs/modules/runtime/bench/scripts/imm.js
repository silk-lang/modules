let n = 0; const t0 = performance.now();
function f() { n++; const t = performance.now(); if (t - t0 < 1000) setImmediate(f); else console.log(`setImmediate ${Math.round(n / ((t - t0) / 1000))} turns/s`); }
setImmediate(f);
