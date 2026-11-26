import { createText, mount } from "@silkui/core";
import { readFileSync } from "node:fs";
import { load } from "./library.js";

// Feature detection is not a use.
const storage = typeof localStorage === "undefined" ? null : localStorage;
mount(createText(String(storage) + load() + typeof readFileSync));
