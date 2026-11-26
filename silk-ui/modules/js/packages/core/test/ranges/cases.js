// Range cases run both in Chromium and on @silkui/core, after the WPT dom/ranges tests: the
// same tree, the same ranges and operations, and every answer serialized for comparison.
// `env` makes nodes: { element(), text(data), mount(node), range(), fragment() }, and
// `reset()` and `pause()` run between cases.
// Only elements and text: the tree has no comments, processing instructions or doctypes.

export function build(env) {
  const root = env.element();
  const p0 = env.element();
  p0.appendChild(env.text("Äb̈c"));
  const span = env.element();
  span.appendChild(env.text("xyz"));
  p0.appendChild(span);
  p0.appendChild(env.text("tail"));
  const p1 = env.element();
  const p2 = env.element();
  p2.appendChild(env.text("Qrstuvwx"));
  const p3 = env.element();
  const em = env.element();
  em.appendChild(env.text("deep"));
  p3.appendChild(em);
  p3.appendChild(env.text(""));
  p3.appendChild(env.text("end"));
  root.appendChild(p0);
  root.appendChild(p1);
  root.appendChild(p2);
  root.appendChild(env.text("between"));
  root.appendChild(p3);
  env.mount(root);
  const detached = env.element();
  detached.appendChild(env.text("Detached"));
  return { root, detached };
}

// Every node, in tree order, then the detached ones.
function nodes(tree) {
  const out = [];
  const walk = (node) => {
    out.push(node);
    for (const child of node.childNodes) walk(child);
  };
  walk(tree.root);
  walk(tree.detached);
  return out;
}

function length(node) {
  return node.nodeType === 3 ? node.data.length : node.childNodes.length;
}

// Boundary points: every offset of elements, and 0, 1, the middle and the end of text.
function points(tree) {
  const out = [];
  for (const node of nodes(tree)) {
    const n = length(node);
    const offsets = node.nodeType === 3 ? [...new Set([0, Math.min(1, n), n >> 1, n])] : [...Array(n + 1).keys()];
    for (const offset of offsets) out.push([node, offset]);
  }
  return out;
}

function path(tree, node) {
  if (node === null || node === undefined) return null;
  const steps = [];
  for (let at = node; at; at = at.parentNode) {
    if (at === tree.root) return "r" + steps.reverse().join("");
    if (at === tree.detached) return "d" + steps.reverse().join("");
    if (!at.parentNode) return "x" + steps.reverse().join("") + (at.nodeType === 3 ? ":" + JSON.stringify(at.data) : "");
    steps.push("/" + Array.prototype.indexOf.call(at.parentNode.childNodes, at));
  }
  return "?";
}

function shape(node) {
  if (node.nodeType === 3) return JSON.stringify(node.data);
  return (node.nodeType === 11 ? "F" : "E") + "(" + Array.from(node.childNodes, shape).join(",") + ")";
}

function bounds(tree, range) {
  return [path(tree, range.startContainer), range.startOffset, path(tree, range.endContainer), range.endOffset];
}

function attempt(run) {
  try {
    return run();
  } catch (error) {
    return "!" + error.name;
  }
}

// Ranges from pairs of points, a deterministic sample of them.
function rangePairs(count) {
  const pairs = [];
  for (let i = 0; i < count; i++) for (let j = 0; j < count; j++) if ((i * 7 + j * 13) % 9 === 0 || i === j) pairs.push([i, j]);
  return pairs;
}

function makeRange(env, tree, start, end) {
  const all = points(tree);
  const range = env.range();
  range.setStart(all[start][0], all[start][1]);
  range.setEnd(all[end][0], all[end][1]);
  return range;
}

const MUTATIONS = [
  ["appendChild root", (t, env) => t.root.appendChild(env.text("new"))],
  ["insertBefore root[1]", (t, env) => t.root.insertBefore(env.element(), t.root.childNodes[1])],
  ["insertBefore root[0]", (t, env) => t.root.insertBefore(env.text("first"), t.root.childNodes[0])],
  ["move p2 into p1", (t) => t.root.childNodes[1].appendChild(t.root.childNodes[2])],
  ["move p0 to the end", (t) => t.root.appendChild(t.root.childNodes[0])],
  ["insertBefore self", (t) => t.root.insertBefore(t.root.childNodes[2], t.root.childNodes[2])],
  ["remove p0", (t) => t.root.removeChild(t.root.childNodes[0])],
  ["remove span", (t) => t.root.childNodes[0].removeChild(t.root.childNodes[0].childNodes[1])],
  ["remove between", (t) => t.root.removeChild(t.root.childNodes[3])],
  ["replaceChild p2", (t, env) => t.root.replaceChild(env.element(), t.root.childNodes[2])],
  ["replaceChild p1 by p3", (t) => t.root.replaceChild(t.root.childNodes[4], t.root.childNodes[1])],
  ["fragment insert", (t, env) => {
    const f = env.fragment();
    f.appendChild(env.text("f1"));
    f.appendChild(env.element());
    t.root.insertBefore(f, t.root.childNodes[2]);
  }],
  ["data set", (t) => (t.root.childNodes[2].firstChild.data = "Q")],
  ["data same", (t) => (t.root.childNodes[2].firstChild.data = "Qrstuvwx")],
  ["appendData", (t) => t.root.childNodes[2].firstChild.appendData("yz")],
  ["insertData 3", (t) => t.root.childNodes[2].firstChild.insertData(3, "--")],
  ["deleteData 2,3", (t) => t.root.childNodes[2].firstChild.deleteData(2, 3)],
  ["replaceData 1,4", (t) => t.root.childNodes[2].firstChild.replaceData(1, 4, "ab")],
  ["replaceData past end", (t) => t.root.childNodes[2].firstChild.replaceData(6, 99, "!")],
  ["splitText 3", (t) => t.root.childNodes[2].firstChild.splitText(3)],
  ["splitText 0", (t) => t.root.childNodes[3].splitText(0)],
  ["splitText end", (t) => t.root.childNodes[0].firstChild.splitText(5)],
  ["splitText detached", (t) => t.detached.firstChild.splitText(4)],
  ["normalize", (t) => {
    t.root.childNodes[2].firstChild.splitText(4);
    t.root.childNodes[2].firstChild.splitText(2);
    t.root.normalize();
  }],
  ["normalize p3", (t) => t.root.childNodes[4].normalize()],
];

export async function run(env) {
  const results = {};
  const tree = build(env);
  const all = points(tree);
  const everyNode = nodes(tree);
  const pairs = rangePairs(all.length);

  for (const [i, j] of pairs) {
    const key = i + "-" + j;
    const fresh = () => {
      env.reset();
      const t = build(env);
      return { t, range: makeRange(env, t, i, j) };
    };
    const { t, range } = fresh();
    const pts = points(t);
    const out = {};
    out.bounds = bounds(t, range);
    out.collapsed = range.collapsed;
    out.common = path(t, range.commonAncestorContainer);
    out.text = range.toString();
    out.compare = pts.filter((_, k) => k % 5 === 0).map(([node, offset]) => attempt(() => range.comparePoint(node, offset)));
    out.inRange = pts.filter((_, k) => k % 5 === 1).map(([node, offset]) => attempt(() => range.isPointInRange(node, offset)));
    out.intersects = nodes(t).map((node) => attempt(() => range.intersectsNode(node)));
    const other = makeRange(env, t, (i * 3 + 5) % all.length, (j * 5 + 2) % all.length);
    out.boundary = [0, 1, 2, 3, 4].map((how) => attempt(() => range.compareBoundaryPoints(how, other)));
    out.clone = attempt(() => shape(range.cloneContents()));
    for (const [name, op] of [
      ["extract", (r, t2) => shape(r.extractContents())],
      ["delete", (r) => r.deleteContents()],
      ["insertText", (r, t2, e) => r.insertNode(e.text("INS"))],
      ["insertElement", (r, t2, e) => r.insertNode(e.element())],
      ["insertFragment", (r, t2, e) => {
        const f = e.fragment();
        f.appendChild(e.text("a"));
        f.appendChild(e.text("b"));
        r.insertNode(f);
      }],
      ["surround", (r, t2, e) => {
        const wrap = e.element();
        wrap.appendChild(e.text("old"));
        r.surroundContents(wrap);
      }],
    ]) {
      const { t: t2, range: r } = fresh();
      const value = attempt(() => op(r, t2, env));
      out[name] = [value === undefined ? null : value, shape(t2.root), shape(t2.detached), bounds(t2, r)];
    }
    for (const [name, mutate] of MUTATIONS) {
      const { t: t2, range: r } = fresh();
      const value = attempt(() => mutate(t2, env));
      out["m:" + name] = [typeof value === "string" && value[0] === "!" ? value : null, bounds(t2, r)];
    }
    results[key] = out;
    // Ranges are held weakly, and a weak target stays alive until the task ends.
    await env.pause();
  }

  // Setting boundaries: errors and the other end moving.
  env.reset();
  const t = build(env);
  const pts = points(t);
  const sets = [];
  for (let k = 0; k < pts.length; k += 3) {
    const range = env.range();
    range.selectNodeContents(t.root.childNodes[2]);
    const [node, offset] = pts[k];
    sets.push([attempt(() => range.setStart(node, offset)), bounds(t, range)]);
    sets.push([attempt(() => range.setEnd(node, offset + 1)), bounds(t, range)]);
    // The mounted root has a parent in a browser (its body) and none here.
    if (node !== t.root) {
      sets.push([attempt(() => range.setStartAfter(node)), bounds(t, range)]);
      sets.push([attempt(() => range.setEndBefore(node)), bounds(t, range)]);
      sets.push([attempt(() => range.selectNode(node)), bounds(t, range)]);
    }
    sets.push([attempt(() => range.collapse(k % 2 === 0)), bounds(t, range)]);
  }
  results.sets = sets;
  results.nodeCount = everyNode.length;
  results.pairs = pairs.length;
  return results;
}
