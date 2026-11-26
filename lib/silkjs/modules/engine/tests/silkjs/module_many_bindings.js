// flags: --std
// One scope-hoisted module with more top-level bindings than var-ref operands
// reach (32767), as a big app's bundle has: the bindings the module's own code
// names come first, the rest only its functions capture, by a wider index.
// A module whose own code names too many fails with an error naming it.
import * as std from "std";
import * as os from "os";

function assert(actual, expected, message) {
  if (actual !== expected)
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
}

function write(name, text) {
  const f = std.open(name, "w");
  f.puts(text);
  f.close();
}

// 70000 vars that only lazy init functions assign, function declarations and
// initialized vars the module's own code stores, and globals both name.
function bundle(count) {
  const lines = [];
  const names = [];
  for (let i = 0; i < count; i++) names.push(`v${i}`);
  lines.push(`var ${names.join(", ")};`);
  for (let i = 0; i < 2000; i++) lines.push(`function f${i}() { return v${count - 1 - i}; }`);
  for (let i = 0; i < 2000; i++) lines.push(`var d${i} = ${i};`);
  // A name declared again keeps its first binding.
  lines.push(`var d7;`, `var d8 = 80;`);
  for (let c = 0; c < count; c += 500) {
    const body = [];
    for (let i = c; i < Math.min(count, c + 500); i++) body.push(`v${i} = ${i};`);
    lines.push(`var init${c} = () => { ${body.join(" ")} return Math.max(${c}, 0); };`);
  }
  for (let c = 0; c < count; c += 500) lines.push(`init${c}();`);
  lines.push(`export function read(i) { return [${names.filter((_, i) => i % 997 == 0).join(", ")}][i]; }`);
  lines.push(`export const last = v${count - 1}, first = f0(), direct = d1999, globals = typeof Object.keys, again = [d7, d8];`);
  lines.push(`export function bump() { v${count - 1} += 1; return v${count - 1}; }`);
  return lines.join("\n");
}

const big = "module_many_bindings.big.tmp.mjs";
write(big, bundle(70000));
try {
  const m = await import("./" + big);
  assert(m.last, 69999, "last binding, set by a lazy init function");
  assert(m.first, 69999, "function declaration reading a high binding");
  assert(m.direct, 1999, "initialized var stored by the module itself");
  assert(m.globals, "function", "global named by the module's own code");
  assert(m.again.join(), "7,80", "a var declared again");
  assert(m.read(70), 70 * 997, "high binding read by an exported function");
  assert(m.bump(), 70000, "high binding written by an exported function");
} finally {
  os.remove(big);
}

// The module's own code names 40000 of its bindings.
const own = "module_many_bindings.own.tmp.mjs";
const stores = [];
for (let i = 0; i < 40000; i++) stores.push(`var w${i} = ${i};`);
write(own, stores.join("\n"));
try {
  let message = "";
  try { await import("./" + own); } catch (e) { message = String(e); }
  assert(message.startsWith("InternalError: too many closure variables: module"), true, `own names error (${message})`);
  assert(message.includes(own) && message.includes("40000") && message.includes("at most 32767"), true, `own names error detail (${message})`);
} finally {
  os.remove(own);
}
