#!/usr/bin/env node
// silkui runs this before it bundles and builds an app: it describes the Silk functions the
// project exports to JavaScript and writes `.silk/natives/` under the project root:
// natives.json (what `.silk` imports become), natives.silk (the host's dispatcher) and
// types/<source>.d.silk.ts (declarations for a tsconfig `rootDirs` without the content mapper).
import { resolve } from "node:path";
import { leftOut, writeNatives } from "../src/natives.js";

try {
  const description = await writeNatives(resolve(process.argv[2] ?? "."));
  for (const line of leftOut(description)) console.warn(`silkui: ${line}`);
} catch (error) {
  console.error(`silkui: ${error.message}`);
  process.exit(1);
}
