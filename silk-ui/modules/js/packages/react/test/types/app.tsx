// Compiled by types.test.js: what an application writes against the packages' types.
import { useRef, useState } from "react";
import { createBox, createImage, mount, parseMarkdown, OBJECT, type Input, type RichDocument, type Style } from "@silkui/core";
import { createRoot, flushSync } from "@silkui/react";

const card: Style = { display: "flex", padding: 8, gridTemplateColumns: "1fr 2fr", opacity: 0.5, color: null };
const box = createBox(card, "text", createImage("data:image/svg+xml,%3Csvg/%3E", { width: 16 }));
box.style.set({ width: 120 });
box.style = { height: 40 };
box.addEventListener("keydown", (event) => event.key.toUpperCase());
box.addEventListener("click", (event) => event.clientX + event.detail, { once: true });
mount(box);

const tree = parseMarkdown("# hi", { footnotes: true });
tree.children.length;

function App() {
  const input = useRef<Input>(null);
  const [document, setDocument] = useState<RichDocument>({ text: `a${OBJECT}`, marks: [], atoms: [{ kind: "mention", label: "x", data: "" }] });
  return (
    <box
      style={{ flexDirection: "column", gap: 4 }}
      hoverStyle={{ backgroundColor: "#eee" }}
      role="list"
      aria-label="Rows"
      onClick={(event) => event.preventDefault()}
      onKeyDownCapture={(event) => event.shiftKey}
      onLayout={(event) => event.bounds.width}
    >
      <input ref={input} value="x" placeholder="Type" onInput={(event) => event.target.value} />
      {/* @ts-expect-error: a plain input's event may have no document */}
      <input onInput={(event) => setDocument(event.document)} />
      <richinput document={document} marks={{ bold: { fontWeight: 700 } }} onInput={(event) => setDocument(event.document)} onSelectionChange={(event) => event.target.document.text} />
      {/* @ts-expect-error: there is no icon element, inline svg is the way */}
      <icon />
      <image />
      <img src="data:image/png;base64,AAAA" alt="Dot" onLoad={(event) => event.type} />
      <img src="data:image/svg+xml,%3Csvg/%3E" style={{ width: 16 }} />
      <svg viewBox="0 0 24 24" width={24} className="size-4" onClick={(event) => event.clientX}>
        <path d="M5 12h14" strokeWidth={2} strokeLinecap="round" />
        <g fill="currentColor"><circle cx={12} cy={12} r={3} /></g>
      </svg>
      {/* @ts-expect-error: the tree has no such style property */}
      <box style={{ notAProperty: 1 }} />
      {/* @ts-expect-error: a key event has no clientX */}
      <box onKeyDown={(event) => event.clientX} />
      {/* @ts-expect-error: no such element */}
      <notanelement />
    </box>
  );
}

createRoot().render(<App />);
flushSync(() => 1).toFixed();
