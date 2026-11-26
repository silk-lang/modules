// The TypeScript plugin for `.silk` imports: a TypeScript 7.1 content mapper. TypeScript sends
// each .silk file it meets; this answers with declarations for the functions the project
// exports to JavaScript, mapped back to the Silk source, so hover shows the Silk doc comment and
// go to definition lands in the .silk file. Silk errors in the file show as TypeScript errors.
// A project opts in from tsconfig.json:
//   "contentMappers": [{ "package": "@silkui/vite", "extensions": [".silk"] }]
// The editor sees the saved files: `silk doc` reads the package from disk.
import { execFile } from "node:child_process";
import { join, relative } from "node:path";
import { promisify } from "node:util";
import { MappedCodeBuilder, SpanMapFeature, runContentMapper } from "ts-content-mapper";
import { describeProject, moduleOf, projectRoot, silkDoc } from "./natives.js";

const run = promisify(execFile);
const silk = process.env.SILK ?? "silk";
const navigation = SpanMapFeature.Hover | SpanMapFeature.Definition | SpanMapFeature.References |
  SpanMapFeature.DocumentHighlights | SpanMapFeature.Rename | SpanMapFeature.DocumentSymbols;
const typeFeatures = SpanMapFeature.Hover | SpanMapFeature.Definition;

function comment(markdown) {
  return `/**\n${markdown.split("\n").map((line) => ` * ${line.replaceAll("*/", "*\\/")}`).join("\n")}\n */\n`;
}

/** `silk check --json` errors in `file`, at byte offsets. */
async function errors(root, file) {
  let output;
  try {
    output = await run(silk, ["check", "--json", "--quiet", "--manifest-path", join(root, "silk.toml")], { cwd: root });
  } catch (error) {
    output = error;
  }
  const found = [];
  for (const line of `${output.stdout ?? ""}\n${output.stderr ?? ""}`.split("\n")) {
    if (!line.startsWith("{")) continue;
    const entry = JSON.parse(line);
    if (entry.path === file && entry.severity === "error") found.push(entry);
  }
  return found;
}

runContentMapper({
  diagnosticSource: "silk",
  async transform(params, context) {
    const content = params.content;
    const bytes = Buffer.from(content, "utf8");
    const toIndex = (offset) => bytes.subarray(0, offset).toString("utf8").length;
    const position = context.positionEncoding === "utf-8" ? (index) => Buffer.byteLength(content.slice(0, index), "utf8") : (index) => index;
    const code = new MappedCodeBuilder(content, { positionEncoding: context.positionEncoding });
    code.append("// TypeScript view of a Silk module: its functions run natively in the Silk UI host\n");
    const root = projectRoot(join(params.fileName, ".."));
    const [doc, found] = root ? await Promise.all([silkDoc(root).catch(() => null), errors(root, params.fileName)]) : [null, []];
    const module = doc && moduleOf(await describeProject(root, doc), params.fileName);
    if (!root) code.append("// not in a Silk package: there is no silk.toml above this file\n");
    else if (doc && !module) code.append(`// ${relative(root, params.fileName)} is not exported to JavaScript: add its module to exports in silk.toml\n`);
    for (const fn of module?.functions ?? []) {
      if (fn.unsupported) {
        code.append(`// ${fn.name}: ${fn.unsupported}\n`);
        continue;
      }
      const start = toIndex(fn.at);
      const nameAt = content.indexOf(fn.name, content.indexOf("fn", start) + 2);
      const params = fn.params.map((p) => `${p.name}: ${p.ts}`).join(", ");
      if (fn.doc) code.append(comment(fn.doc));
      code.append("export declare const ");
      code.appendVerbatim(nameAt, nameAt + fn.name.length, navigation);
      code.append(": ((");
      fn.params.forEach((param, index) => {
        if (index > 0) code.append(", ");
        const at = toIndex(param.at);
        const typeAt = content.indexOf(param.silk, at + param.name.length);
        code.appendVerbatim(at, at + param.name.length, navigation);
        code.append(": ");
        if (typeAt >= 0) code.appendAtom(param.ts, typeAt, typeAt + param.silk.length, typeFeatures);
        else code.append(param.ts);
      });
      code.append(`) => ${fn.returns.ts}) & {\n  /** Runs on a background thread. */\n  async(${params}): Promise<${fn.returns.ts}>;\n};\n`);
    }
    if (!module?.functions.some((fn) => !fn.unsupported)) code.append("export {};\n");
    const output = code.build(".ts");
    return {
      ...output,
      diagnostics: found.map((entry) => {
        const start = toIndex(entry.start);
        const end = toIndex(entry.end);
        return { messageText: `${entry.code}: ${entry.message}`, start: position(start), length: Math.max(position(end) - position(start), 0), code: Number(String(entry.code).replace(/\D/g, "")) || 1 };
      }),
    };
  },
});
