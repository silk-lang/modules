// Bun's bench/sqlite queries with a plain timing loop. node:sqlite, or bun:sqlite under Bun.
const isBun = typeof Bun !== "undefined" && !process.env.NODE_SQLITE;
const { Database } = isBun ? await import("bun:sqlite") : { Database: (await import("node:sqlite")).DatabaseSync };
// Run from Bun's bench/sqlite folder, which holds the database (bench.py and mem.py do).
const db = new Database("./src/northwind.sqlite");
const mem = new Database(":memory:");
function time(name, fn, minMs = 1500) {
  for (let i = 0; i < 3; i++) fn();
  let n = 0, t0 = performance.now(), t;
  do { fn(); n++; t = performance.now(); } while (t - t0 < minMs);
  console.log(`${name}\t${((t - t0) / n).toFixed(3)} ms`);
}
for (const table of ["Order", "Product", "OrderDetail"]) {
  const s = db.prepare(`SELECT * FROM "${table}"`);
  time(`SELECT * FROM "${table}"`, () => s.all());
}
for (const n of [1000, 2000, 4000, 8000]) {
  const sql = "select 1;".repeat(n);
  time(`db.exec(sql): ${n} statements`, () => mem.exec(sql), 800);
}
