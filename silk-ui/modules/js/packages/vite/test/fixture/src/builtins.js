import * as fs from "node:fs";
import { join } from "path";

console.log(typeof fs.readFileSync, join("a", "b"));
