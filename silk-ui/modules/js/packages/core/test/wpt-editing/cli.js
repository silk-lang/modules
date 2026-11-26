// node test/wpt-editing/cli.js [file,...] [--show[=N]] [--grep=text] [--known]:
// runs the WPT editing cases and prints how many pass per file, with --show the first
// failures, and with --known writes known-failures.json from this run.
import { writeFileSync } from "node:fs";
import { editingEnv } from "./env.js";
import { runAll } from "./run.js";

const args = process.argv.slice(2);
const only = args.find((a) => !a.startsWith("--"))?.split(",");
const showArg = args.find((a) => a.startsWith("--show"));
const show = showArg ? Number(showArg.split("=")[1] ?? 10) : 0;
const grep = args.find((a) => a.startsWith("--grep="))?.slice(7);

const results = await runAll(await editingEnv(), only);
let pass = 0;
let total = 0;
const failures = [];
const known = {};
for (const [file, list] of Object.entries(results)) {
  const passed = list.filter((r) => r.differences.length === 0).length;
  pass += passed;
  total += list.length;
  console.log(file.padEnd(36), String(passed).padStart(4), "/", list.length);
  list.forEach((r, index) => {
    if (!r.differences.length) return;
    (known[file] ??= []).push(index);
    if (!grep || JSON.stringify(r).includes(grep)) failures.push([file, r]);
  });
}
console.log("total".padEnd(36), String(pass).padStart(4), "/", total);
for (const [file, r] of failures.slice(0, show)) {
  console.log("\n" + file, JSON.stringify(r.testCase[0]), JSON.stringify(r.testCase[1]));
  for (const d of r.differences.slice(0, 6)) console.log("  " + d.slice(0, 2000));
}
if (args.includes("--known") && !only) {
  writeFileSync(new URL("./known-failures.json", import.meta.url), JSON.stringify(known) + "\n");
}
