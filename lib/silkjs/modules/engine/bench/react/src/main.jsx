// The bundle's entry. It defines `globalThis.reactBench`, which the drivers (the engine's
// benchmark program and run-node.mjs) call; evaluating the bundle renders nothing.
import "./timers.js";
import { controls, makeMessage, Transcript } from "./app.jsx";
import { highlight, renderMarkdown } from "./extras.js";
import { counts, createRoot } from "./host.js";

const roots = [];

globalThis.reactBench = {
  /** Renders and commits a transcript of `messages` messages; returns the host nodes created. */
  mount(messages) {
    const initial = [];
    for (let id = 0; id < messages; id++) initial.push(makeMessage(id));
    const before = counts.elements + counts.texts;
    const root = createRoot();
    root.render(<Transcript initial={initial} />);
    roots.push(root);
    return counts.elements + counts.texts - before;
  },
  /** One streamed chunk: a setState on the list that changes its last message, committed. */
  tick(chunk) {
    const root = roots[roots.length - 1];
    root.sync(() => controls.append(chunk));
  },
  /** Unmounts every root, so that what the transcripts held can be collected. */
  unmount() {
    for (const root of roots) root.render(null);
    roots.length = 0;
  },
  /** The libraries that only ride along at first render; calling them checks they work. */
  extras: { highlight, renderMarkdown },
  counts,
};
