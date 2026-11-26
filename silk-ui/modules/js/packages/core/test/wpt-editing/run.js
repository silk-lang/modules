// The WPT editing conformance cases (wpt/editing/data, converted to cases.json.gz) run on the
// core DOM as wpt/editing/include/tests.js runs them: a contenteditable div gets the case's
// markup, the brackets become the selection, the commands run through document.execCommand,
// and the host's innerHTML and the queryCommand* answers must match. `node run.js [file]
// [--show]` prints the results.
import { readFileSync } from "node:fs";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { gunzipSync } from "node:zlib";

// A full collection now and then: ranges are held weakly, and a WeakRef keeps its range until
// one runs, while every mutation walks the live ranges.
setFlagsFromString("--expose-gc");
const collect = runInNewContext("gc");

export function loadCases() {
  return JSON.parse(gunzipSync(readFileSync(new URL("./cases.json.gz", import.meta.url))));
}

const nextNode = (node) => {
  if (node.firstChild) return node.firstChild;
  for (let at = node; at; at = at.parentNode) if (at.nextSibling) return at.nextSibling;
  return null;
};

const indexOf = (node) => Array.prototype.indexOf.call(node.parentNode.childNodes, node);

// wpt/editing/include/tests.js setupDiv: markup in, the selection's points out.
function setupDiv(node, html) {
  node.innerHTML = html;
  let startNode, startOffset, endNode, endOffset;
  const start = node.querySelector("[data-start]");
  if (start) {
    startNode = start;
    startOffset = Number(start.getAttribute("data-start"));
    start.removeAttribute("data-start");
  }
  const end = node.querySelector("[data-end]");
  if (end) {
    endNode = end;
    endOffset = Number(end.getAttribute("data-end"));
    end.removeAttribute("data-end");
  }
  let cur = node;
  while (cur && (cur === node || node.contains(cur))) {
    if (cur.nodeType !== 3) {
      cur = nextNode(cur);
      continue;
    }
    const startIdx = cur.data.replace(/\]/g, "").indexOf("[");
    const endIdx = cur.data.replace(/\[/g, "").indexOf("]");
    cur.data = cur.data.replace(/[[\]]/g, "");
    if (startIdx !== -1) [startNode, startOffset] = [cur, startIdx];
    if (endIdx !== -1) [endNode, endOffset] = [cur, endIdx];
    const elStartIdx = cur.data.replace(/\}/g, "").indexOf("{");
    const elEndIdx = cur.data.replace(/\{/g, "").indexOf("}");
    if (elStartIdx === 0) [startNode, startOffset] = [cur.parentNode, indexOf(cur)];
    else if (elStartIdx !== -1) [startNode, startOffset] = [cur.parentNode, indexOf(cur) + 1];
    if (elEndIdx === 0) [endNode, endOffset] = [cur.parentNode, indexOf(cur)];
    else if (elEndIdx !== -1) [endNode, endOffset] = [cur.parentNode, indexOf(cur) + 1];
    cur.data = cur.data.replace(/[{}]/g, "");
    if (!cur.data.length) {
      const old = cur;
      cur = nextNode(cur);
      old.parentNode.removeChild(old);
    } else {
      cur = nextNode(cur);
    }
  }
  return [startNode, startOffset, endNode, endOffset];
}

// wpt/editing/include/tests.js normalizeSerializedStyle.
function normalizeStyle(wrapper) {
  for (const node of wrapper.querySelectorAll("[style]")) {
    node.setAttribute("style", node.getAttribute("style")
      .replace(/; ?$/, "")
      .replace(/: /g, ":")
      .replace(/transparent/g, "rgba(0, 0, 0, 0)")
      .replace(/rgba\([0-9]+, [0-9]+, [0-9]+, 0\)/g, "rgba(0, 0, 0, 0)"));
  }
}

const QUERIES = ["queryCommandIndeterm", "queryCommandState", "queryCommandValue"];

function query(document, command) {
  return QUERIES.map((name) => {
    try { return document[name](command); } catch (error) { return error?.name === "InvalidAccessError" ? null : "threw " + error; }
  });
}

/** Runs one case; returns the differences from what it expects, empty when it passes. */
export function runCase(env, testCase) {
  const { document, getSelection } = env;
  const [html, commands, expected, returns, queries] = testCase;
  const container = env.container;
  // As tests.js runConformanceTest: the host, then a paragraph outside it.
  container.innerHTML = "<div contenteditable></div><p>test";
  const host = container.firstChild;
  const differences = [];
  try {
    const points = setupDiv(host, html);
    const range = document.createRange();
    range.setStart(points[0], points[1]);
    range.setEnd(points[2], points[3]);
    if (range.collapsed) range.setEnd(points[0], points[1]);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
    const before = {};
    for (const command in queries) before[command] = query(document, command);
    commands.forEach(([command, value], index) => {
      let got;
      try { got = document.execCommand(command, false, value); } catch (error) { got = "threw " + (error?.stack ?? error); }
      if (got !== returns[index]) differences.push("execCommand(" + command + ") returned " + got);
    });
    normalizeStyle(host);
    const want = (Array.isArray(expected) ? expected : [expected]).map((markup) => markup.replace(/[[\]{}]/g, ""));
    if (!want.includes(host.innerHTML)) differences.push("innerHTML " + JSON.stringify(host.innerHTML) + " want " + JSON.stringify(want[0]));
    for (const command in queries) {
      const got = [...before[command], ...query(document, command)];
      const wanted = queries[command];
      for (let i = 0; i < 6; i++) {
        let a = got[i];
        const b = wanted[i];
        if (a !== b) differences.push(QUERIES[i % 3] + "(" + command + ") " + (i < 3 ? "before" : "after") + " " + JSON.stringify(a) + " want " + JSON.stringify(b));
      }
    }
  } catch (error) {
    differences.push("setup threw " + (error?.stack ?? error));
  }
  // Document-wide settings carry on to the next case, as in WPT.
  return differences;
}

export async function runAll(env, only) {
  const cases = loadCases();
  const results = {};
  for (const [file, list] of Object.entries(cases)) {
    if (only && !only.includes(file)) continue;
    // Each file starts as a page loads, with the CSS styling flag off: the expected results
    // (and the first case's queries) assume it, whatever the run pages' old hack sets.
    try { env.document.execCommand("styleWithCSS", false, "false"); } catch {}
    try { env.document.execCommand("defaultParagraphSeparator", false, "div"); } catch {}
    results[file] = [];
    for (const testCase of list) {
      results[file].push({ testCase, differences: runCase(env, testCase) });
      // A WeakRef holds its range at least until the job ends.
      if (results[file].length % 50 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
        collect();
      }
    }
  }
  return results;
}
