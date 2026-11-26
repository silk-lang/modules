// Silk functions a Silk UI app exports to its JavaScript: `import { add } from "../silk/math.silk"`.
//
// The project's Silk package is a library; the modules in its `exports` are what JavaScript can
// import. `silk doc` gives their public functions, and one description of them feeds three
// outputs: the Silk dispatcher silkui compiles into the native host (`silkGlue`), the JavaScript
// module a `.silk` import becomes (`jsModule`), and its TypeScript declarations (`declarations`,
// also what the content mapper in mapper.js answers). The code runs natively in the host: a call
// is `__ui.native(id, ...args)`, which the bridge hands to the dispatcher.
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

/** Where silkui writes the description and the dispatcher, under the project root. */
export const NATIVES_DIR = ".silk/natives";

// Integers up to 32 bits (and the pointer-sized ones) are numbers; 64-bit ones are bigints, as
// in the TypeScript spike. A number that does not fit the parameter's type is a TypeError.
const NUMBERS = new Set(["i8", "i16", "i32", "u8", "u16", "u32", "isize", "usize", "f32", "f64"]);
const BIGINTS = new Set(["i64", "u64"]);

/** How one Silk type crosses into JavaScript, or undefined when it cannot yet. */
export function crossing(silkType) {
  const type = silkType.trim();
  if (NUMBERS.has(type)) return { silk: type, ts: "number", kind: "n" };
  if (BIGINTS.has(type)) return { silk: type, ts: "bigint", kind: "s" };
  if (type === "bool") return { silk: type, ts: "boolean", kind: "b" };
  if (type === "string" || type === "string<'static>") return { silk: type, ts: "string", kind: "s" };
  if (type === "String") return { silk: type, ts: "string", kind: "s" };
  if (type === "" || type === "()") return { silk: "()", ts: "void", kind: "" };
  return undefined;
}

/** The id JavaScript calls `module.name` by. The dispatcher compares the same numbers. */
export function nativeId(qualified) {
  let hash = 0;
  for (const byte of new TextEncoder().encode(qualified)) hash = (hash * 31 + byte) % 2147483629;
  return hash;
}

/** `pub [effect] fn name(params) [-> T] [! E] [? R]`, or null for anything else. */
export function parseSignature(signature) {
  const match = /^pub (effect )?fn ([A-Za-z_][A-Za-z0-9_]*)\((.*)\)\s*(?:->\s*([^!?]+?))?\s*(?:!\s*([^?]+?))?\s*(?:\?\s*(.+))?$/s.exec(signature.trim());
  if (!match) return null;
  const [, effect, name, params, returns = "()", fails = "", requires = ""] = match;
  return { effect: effect !== undefined, name, params, returns: returns.trim(), fails: fails.trim(), requires: requires.trim() };
}

/** One public function of a module as JavaScript sees it, with `unsupported` saying why not. */
export function describeFunction(module, item, parameters) {
  const parsed = parseSignature(item.signature);
  const fn = { name: item.name, id: nativeId(`${module}.${item.name}`), doc: item.documentation?.markdown ?? "", signature: item.signature, at: item.source?.start ?? 0 };
  if (!parsed) return { ...fn, unsupported: `\`${item.signature}\` is not a plain function (generic, or a method)` };
  const params = parameters.map((parameter) => {
    const at = parameter.signature.indexOf(":");
    return { name: parameter.name, at: parameter.source?.start ?? 0, silk: parameter.signature.slice(at + 1).trim(), ...crossing(parameter.signature.slice(at + 1)) };
  });
  const returns = crossing(parsed.returns);
  const bad = [...params.filter((p) => !p.ts).map((p) => p.silk), ...(returns ? [] : [parsed.returns])];
  if (bad.length) return { ...fn, unsupported: `${bad.map((t) => `\`${t}\``).join(", ")} cannot cross into JavaScript yet` };
  const requires = parsed.requires.split("|").map((r) => r.trim()).filter(Boolean);
  const other = requires.filter((r) => r !== "&mut Allocator");
  if (other.length) return { ...fn, unsupported: `it needs ${other.map((r) => `\`${r}\``).join(", ")}; the host provides only \`&mut Allocator\`` };
  return {
    ...fn,
    effect: parsed.effect,
    fails: parsed.fails,
    params: params.map(({ name, at, silk, ts, kind }) => ({ name, at, silk, ts, kind })),
    returns: { silk: returns.silk === "()" ? "()" : parsed.returns, ts: returns.ts },
  };
}

/** `[package]` fields of a silk.toml that matter here: kind, source and exports. */
export function packageFields(toml) {
  const section = /^\[package\]\s*$([\s\S]*?)(?=^\[|(?![\s\S]))/m.exec(toml)?.[1] ?? "";
  const string = (key) => new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m").exec(section)?.[1];
  const list = /^exports\s*=\s*\[([^\]]*)\]/m.exec(section)?.[1] ?? "";
  return { kind: string("kind") ?? "executable", source: string("source") ?? "src", exports: [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]) };
}

/** The nearest directory at or above `from` with a silk.toml, or null. */
export function projectRoot(from) {
  let dir = resolve(from);
  while (true) {
    if (existsSync(join(dir, "silk.toml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Runs `silk doc` on the project at `root`: the parsed JSON. */
export async function silkDoc(root, silk = process.env.SILK ?? "silk") {
  const scratch = await mkdtemp(join(tmpdir(), "silkui-natives-"));
  try {
    const output = join(scratch, "doc.json");
    try {
      await run(silk, ["doc", "--manifest-path", join(root, "silk.toml"), "--output", output], { cwd: root });
    } catch (error) {
      if (error.code === "ENOENT") throw new Error(`cannot run \`${silk}\`: put silk on PATH or set SILK to its path`);
      throw new Error(`silk doc failed in ${root}:\n${error.stderr || error.stdout || error.message}`);
    }
    return JSON.parse(await readFile(output, "utf8"));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

/**
 * The exported modules of the project at `root` and their functions. `doc` is `silk doc`'s
 * JSON; without it this runs `silk doc`. A project without `exports` has none.
 */
export async function describeProject(root, doc) {
  const fields = packageFields(readFileSync(join(root, "silk.toml"), "utf8"));
  const description = { version: 1, root, library: fields.kind === "library", modules: [] };
  if (fields.exports.length === 0) return description;
  doc ??= await silkDoc(root);
  for (const module of doc.modules) {
    if (!fields.exports.includes(module.name)) continue;
    const items = module.items ?? [];
    const functions = [];
    items.forEach((item, index) => {
      if (item.kind !== "Function" || item.visibility !== "Public" || item.parent !== undefined) return;
      const parameters = items.filter((p) => p.kind === "Parameter" && p.parent === index);
      functions.push(describeFunction(module.name, item, parameters));
    });
    description.modules.push({ module: module.name, file: module.sourcePath, functions });
  }
  return description;
}

/** The module of `description` whose source is `file`. */
export function moduleOf(description, file) {
  const wanted = resolve(file);
  return description.modules.find((m) => resolve(m.file) === wanted);
}

// --- Silk: the dispatcher in the host ---

function argument(param, at, signature) {
  const value = `args, ${at}`;
  switch (param.silk) {
    case "f64": return { let: `let a${at} = number(${value})` };
    case "f32": return { let: `let a${at} = f64.toF32(number(${value}))` };
    case "bool": return { let: `let a${at} = flag(${value})` };
    case "i64": return { let: `let a${at} = signed(${value})` };
    case "u64": return { let: `let a${at} = unsigned(${value})` };
    case "String": return { let: `let a${at} = run String.copy(text(${value}))`, pass: `move a${at}` };
    case "string":
    case "string<'static>": return { let: `let a${at} = text(${value})` };
    default: {
      const to = param.silk[0].toUpperCase() + param.silk.slice(1);
      return {
        let: `let a${at} = match f64.checkedTo${to}(number(${value})) {\n        Option.Some { value } => value\n        Option.None => {\n          reply.* = run wrongArguments(${JSON.stringify(signature)})\n          return ()\n        }\n      }`,
      };
    }
  }
}

function replyOf(silkType) {
  switch (silkType) {
    case "()": return null;
    case "f64": return "Reply.Number { value: value }";
    case "bool": return "Reply.Flag { value: value }";
    case "i64": return "run fromSigned(value)";
    case "u64": return "run fromUnsigned(value)";
    case "String": return "Reply.Text { value: move value }";
    case "string":
    case "string<'static>": return "run copied(value)";
    default: return `Reply.Number { value: ${silkType}.toF64(value) }`;
  }
}

/** `add(a: number, b: number)`, as a TypeError names what a function takes. */
function jsSignature(fn) {
  return `${fn.name}(${fn.params.map((p) => `${p.name}: ${p.ts}`).join(", ")})`;
}

/** The host's `src/natives.silk`: an `Exports` dispatcher over every supported function. */
export function silkGlue(description) {
  const modules = description.modules.filter((m) => m.functions.some((fn) => !fn.unsupported));
  const nums = new Set(["f64"]);
  const lines = [];
  modules.forEach((module, index) => {
    for (const fn of module.functions) {
      if (fn.unsupported) continue;
      const signature = jsSignature(fn);
      const call = `m${index}.${fn.name}`;
      lines.push(`    if id == ${fn.id} {`);
      lines.push(`      if !accepts(args, ${JSON.stringify(fn.params.map((p) => p.kind).join(""))}) {`);
      lines.push(`        reply.* = run wrongArguments(${JSON.stringify(signature)})`);
      lines.push(`        return ()`);
      lines.push(`      }`);
      const passed = fn.params.map((param, at) => {
        const { let: binding, pass } = argument(param, at, signature);
        if (NUMBERS.has(param.silk)) nums.add(param.silk);
        lines.push(`      ${binding}`);
        return pass ?? `a${at}`;
      });
      const invoke = `${call}(${passed.join(", ")})`;
      const answer = replyOf(fn.returns.silk);
      if (NUMBERS.has(fn.returns.silk)) nums.add(fn.returns.silk);
      const bound = answer ? "let value = " : "";
      if (fn.fails) {
        lines.push(`      let ran = run Effect.result(${invoke})`);
        lines.push(`      ${answer ? "let value = " : ""}match move ran {`);
        lines.push(`        Result.Success { value } => ${answer ? "move value" : "{ drop value }"}`);
        lines.push(`        Result.Failure { error } => {`);
        lines.push(`          reply.* = run failed(${JSON.stringify(`${module.module}.${fn.name}`)}, ${JSON.stringify(fn.fails)}, move error)`);
        lines.push(`          return ()`);
        lines.push(`        }`);
        lines.push(`      }`);
      } else {
        lines.push(`      ${bound}${fn.effect ? "run " : ""}${invoke}`);
      }
      if (answer) lines.push(`      reply.* = ${answer}`);
      lines.push(`      return ()`);
      lines.push(`    }`);
    }
  });
  const body = lines.join("\n");
  const helpers = ["Natives", "Reply", "Exports", "Arg", "serve", "accepts", "number", "flag", "text", "signed", "unsigned", "fromSigned", "fromUnsigned", "wrongArguments", "failed", "copied"];
  const always = new Set(["Natives", "Reply", "Exports", "Arg", "serve"]);
  const used = (text, name) => always.has(name) || new RegExp(`(^|[^A-Za-z0-9_.])${name.replace(".", "\\.")}`).test(text);
  return [
    "//! Generated by silkui: do not edit. `silk task` writes it again on every build.",
    "//! The Silk functions the app's JavaScript imports, for `__ui.native`.",
    ...modules.map((m, index) => `import project.${m.module} as m${index}`),
    `import silkui_window.natives { ${helpers.filter((name) => name.length && used(body, name)).join(", ")} }`,
    "import silk.mem.allocator { Allocator, OutOfMemoryError }",
    ...(used(body, "Effect") ? ["import silk.core.effect { Effect }"] : []),
    ...(used(body, "Option") ? ["import silk.core.option { Option }"] : []),
    ...(used(body, "Result") ? ["import silk.core.result { Result }"] : []),
    "import silk.text.string { String }",
    ...[...nums].sort().filter((n) => used(body, `${n}.`)).map((n) => `import silk.num.${n}`),
    "",
    "struct Exported {}",
    "",
    "impl Exports for Exported {",
    "  effect fn dispatch(self: &Self, id: u32, args: &[Arg], reply: &mut Reply) -> () ! OutOfMemoryError ? &mut Allocator {",
    ...lines,
    "    reply.* = Reply.TypeError { message: run String.copy(\"this build of the app does not have that Silk function: rebuild it (restart `silk task dev`)\") }",
    "  }",
    "}",
    "",
    "export \"C\" fn exported(raw: ?*mut u8) -> () as \"silkui_app_natives\" {",
    "  unsafe serve<Exported>(&Exported {}, raw)",
    "}",
    "",
    "/// The dispatcher, for `Settings.natives`.",
    "pub fn all() -> Natives {",
    "  return unsafe Natives.fromCallback(exported)",
    "}",
    "",
  ].join("\n");
}

/** Whether `description` exports any function the host can call. */
export function hasFunctions(description) {
  return description.modules.some((m) => m.functions.some((fn) => !fn.unsupported));
}

// --- JavaScript: what a `.silk` import becomes ---

function jsArgument(param) {
  if (param.silk === "i64") return `BigInt.asIntN(64, BigInt(${param.name})).toString()`;
  if (param.silk === "u64") return `BigInt.asUintN(64, BigInt(${param.name})).toString()`;
  return param.name;
}

/** The ES module for `module`: one function per supported export, each with an `async` form. */
export function jsModule(module) {
  const out = [
    "// Generated by @silkui/vite from a Silk module: the functions run natively in the host.",
    "const ui = globalThis.__ui;",
    "function call(id, args, fails) {",
    "  if (!ui?.native) throw new Error(\"Silk functions run only in a Silk UI host\");",
    "  if (!fails) return ui.native(id, ...args);",
    "  try {",
    "    return ui.native(id, ...args);",
    "  } catch (error) {",
    "    if (error?.name === \"InternalError\") throw new Error(error.message);",
    "    throw error;",
    "  }",
    "}",
    "function later(id, args, fails) {",
    "  if (ui?.nativeStart) return ui.nativeStart(id, ...args);",
    "  return new Promise((resolve) => resolve(call(id, args, fails)));",
    "}",
  ];
  for (const fn of module.functions) {
    if (fn.unsupported) {
      out.push(`// ${fn.name}: ${fn.unsupported}`);
      continue;
    }
    const names = fn.params.map((p) => p.name).join(", ");
    const args = `[${fn.params.map(jsArgument).join(", ")}]`;
    const big = fn.returns.silk === "i64" || fn.returns.silk === "u64";
    const fails = fn.fails ? "true" : "false";
    if (fn.doc) out.push(jsDoc(fn.doc));
    out.push(`export function ${fn.name}(${names}) {`);
    out.push(`  return ${big ? `BigInt(call(${fn.id}, ${args}, ${fails}))` : `call(${fn.id}, ${args}, ${fails})`};`);
    out.push("}");
    out.push(`${fn.name}.async = (${names}) => later(${fn.id}, ${args}, ${fails})${big ? ".then(BigInt)" : ""};`);
  }
  return `${out.join("\n")}\n`;
}

function jsDoc(markdown) {
  return `/**\n${markdown.split("\n").map((line) => ` * ${line.replaceAll("*/", "*\\/")}`).join("\n")}\n */`;
}

/** The TypeScript declarations of `module`: `native.d.silk.ts` beside the source. */
export function declarations(module) {
  const out = ["// Generated by @silkui/vite from a Silk module. TypeScript finds it with `allowArbitraryExtensions`."];
  for (const fn of module.functions) {
    if (fn.unsupported) {
      out.push(`// ${fn.name}: ${fn.unsupported}`);
      continue;
    }
    const params = fn.params.map((p) => `${p.name}: ${p.ts}`).join(", ");
    if (fn.doc) out.push(jsDoc(fn.doc));
    out.push(`export declare const ${fn.name}: ((${params}) => ${fn.returns.ts}) & {`);
    out.push(`  /** Runs on a background thread. */`);
    out.push(`  async(${params}): Promise<${fn.returns.ts}>;`);
    out.push("};");
  }
  if (!module.functions.some((fn) => !fn.unsupported)) out.push("export {};");
  return `${out.join("\n")}\n`;
}

/** The description silkui wrote for the project at `root`, or null before the first build. */
export function readDescription(root) {
  const path = join(root, NATIVES_DIR, "natives.json");
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}

/**
 * Describes the Silk functions the project at `root` exports and writes `NATIVES_DIR`:
 * natives.json, natives.silk (the host's dispatcher) and types/<source>.d.silk.ts. Returns the
 * description.
 */
export async function writeNatives(root) {
  const description = await describeProject(root);
  const out = join(root, NATIVES_DIR);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "natives.json"), `${JSON.stringify(description, null, 2)}\n`);
  if (hasFunctions(description)) {
    if (!description.library) throw new Error("silk.toml exports modules to JavaScript, so the package must be a library: set `kind = \"library\"` and give the tasks their own profile (`[profiles.tasks] main = \"tasks.silk\"`)");
    writeFileSync(join(out, "natives.silk"), silkGlue(description));
  }
  for (const module of description.modules) {
    const types = join(out, "types", `${relative(root, module.file).replace(/\.silk$/, "")}.d.silk.ts`);
    mkdirSync(dirname(types), { recursive: true });
    writeFileSync(types, declarations(module));
  }
  return description;
}

/** Why each function of `description` that JavaScript cannot call is left out. */
export function leftOut(description) {
  return description.modules.flatMap((module) =>
    module.functions.filter((fn) => fn.unsupported).map((fn) => `${module.module}.${fn.name} is not available to JavaScript: ${fn.unsupported}`),
  );
}
