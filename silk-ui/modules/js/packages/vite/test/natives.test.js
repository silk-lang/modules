import assert from "node:assert/strict";
import test from "node:test";
import { declarations, describeFunction, jsModule, nativeId, packageFields, silkGlue } from "../src/natives.js";

// What `silk doc` gives for a function: the item, then its parameters.
function fn(module, signature, params = [], doc = "") {
  const name = /fn ([A-Za-z_][A-Za-z0-9_]*)/.exec(signature)[1];
  const item = { kind: "Function", name, visibility: "Public", signature, source: { start: 0 }, documentation: doc ? { markdown: doc } : undefined };
  const parameters = params.map((p) => ({ kind: "Parameter", name: p.split(":")[0], signature: p, source: { start: 0 } }));
  return describeFunction(module, item, parameters);
}

const module = {
  module: "math",
  file: "/app/silk/math.silk",
  functions: [
    fn("math", "pub fn add(a: f64, b: f64) -> f64", ["a: f64", "b: f64"], "Adds."),
    fn("math", "pub fn fib(n: u32) -> u64", ["n: u32"]),
    fn("math", "pub effect fn greet(name: string) -> String ! OutOfMemoryError ? &mut Allocator", ["name: string"]),
    fn("math", "pub effect fn divide(a: i32, b: i32) -> i32 ! DivisionByZero", ["a: i32", "b: i32"]),
    fn("math", "pub fn first<T>(items: &[T]) -> T", ["items: &[T]"]),
    fn("math", "pub effect fn read(path: string) -> String ! FileError ? &mut FileSystem", ["path: string"]),
  ],
};

test("ids are the hash the bridge test dispatches on", () => {
  // modules/js/tests/src/tests.silk answers these ids.
  assert.equal(nativeId("math.add"), 299831157);
  assert.equal(nativeId("math.twice"), 393056494);
});

test("Silk types cross as numbers, bigints, booleans and strings; others are left out with a reason", () => {
  const [add, fib, greet, divide, first, read] = module.functions;
  assert.deepEqual(add.params.map((p) => [p.ts, p.kind]), [["number", "n"], ["number", "n"]]);
  assert.deepEqual([fib.returns.ts, greet.returns.ts, greet.params[0].ts], ["bigint", "string", "string"]);
  assert.equal(divide.fails, "DivisionByZero");
  assert.match(first.unsupported, /not a plain function/);
  assert.match(read.unsupported, /&mut FileSystem/);
});

test("the dispatcher converts arguments, checks integer ranges and imports only what it uses", () => {
  const glue = silkGlue({ modules: [module] });
  assert.match(glue, /import project\.math as m0/);
  assert.match(glue, /if id == 299831157 \{/);
  assert.match(glue, /f64\.checkedToI32\(number\(args, 0\)\)/);
  assert.match(glue, /reply\.\* = run fromUnsigned\(value\)/);
  assert.match(glue, /run failed\("math\.divide", "DivisionByZero", move error\)/);
  assert.doesNotMatch(glue, /m0\.first|m0\.read/);
  assert.doesNotMatch(glue, /\bflag\b|\bsigned\b|silk\.num\.u8/);
  assert.match(glue, /import silk\.num\.i32/);
});

test("the module calls the host, turns bigints into text and back, and rethrows failures as Error", async () => {
  const calls = [];
  globalThis.__ui = {
    native(id, ...args) {
      calls.push([id, ...args]);
      if (id === nativeId("math.divide")) throw Object.assign(new Error("math.divide failed: DivisionByZero"), { name: "InternalError" });
      if (id === nativeId("math.fib")) return "2880067194370816120";
      return 42;
    },
  };
  try {
    const url = `data:text/javascript,${encodeURIComponent(jsModule(module))}`;
    const math = await import(url);
    assert.equal(math.add(40, 2), 42);
    assert.equal(math.fib(90), 2880067194370816120n);
    assert.throws(() => math.divide(1, 0), (error) => error.constructor === Error && /DivisionByZero/.test(error.message));
    assert.equal(await math.add.async(1, 2), 42);
    assert.equal("first" in math, false);
    assert.deepEqual(calls[0], [nativeId("math.add"), 40, 2]);
  } finally {
    delete globalThis.__ui;
  }
});

test("declarations type each function and its async form", () => {
  const text = declarations(module);
  assert.match(text, /export declare const fib: \(\(n: number\) => bigint\) & \{\n.*\n  async\(n: number\): Promise<bigint>;/);
  assert.match(text, /\/\*\*\n \* Adds\.\n \*\//);
  assert.match(text, /\/\/ first: `pub fn first<T>/);
});

test("package fields come from the [package] table only", () => {
  const fields = packageFields('[package]\nname = "a"\nkind = "library"\nsource = "silk"\nexports = ["math", "text"]\n\n[profiles.tasks]\nmain = "tasks.silk"\nexports = ["no"]\n');
  assert.deepEqual(fields, { kind: "library", source: "silk", exports: ["math", "text"] });
});
