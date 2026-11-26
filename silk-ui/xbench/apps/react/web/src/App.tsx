// The xbench scenes in React (SCENES.md). One scene per build: VITE_XB_SCENE names it
// (feed, wall, stream, churn, canvas, chat, input; a count after a dash changes the size: feed-3000).
import { memo, useEffect, useRef, useState } from "react";
import { flushSync } from "@silkui/react";
import corpus from "../../../../content/corpus.txt?raw";
import { parse, spans, type Block, type Item, type Span } from "./corpus";
import { run, type Step } from "./driver";
import { pictures } from "./pictures";
import { stage } from "./stage";
import { Chat } from "./Chat";
import { Input } from "./Input";

const asked = (import.meta.env.VITE_XB_SCENE as string | undefined) ?? "feed";
const [scene, sized] = asked.split("-");
// VITE_XB_CONTENT_VISIBILITY=1: items get `content-visibility: auto` (style/bench.css).
const FEED = import.meta.env.VITE_XB_CONTENT_VISIBILITY ? "feed lazy" : "feed";
const DEFAULTS: Record<string, number> = { feed: 1000, wall: 0, stream: 300, churn: 1000, canvas: 200, chat: 1000 };
const SIZE = sized ? Number(sized) : DEFAULTS[scene];

type Scroller = { scrollTop: number };
/** The largest scrollTop of a container (Silk nodes have scrollTopMax; DOM elements do not). */
const maxScroll = (node: any): number => node.scrollTopMax ?? node.scrollHeight - node.clientHeight;

function Inline({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) => (s.mark ? <box key={i} className={s.mark}>{s.text}</box> : s.text))}
    </>
  );
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "p":
    case "q":
    case "h":
      return <box className={block.kind}><Inline spans={block.spans} /></box>;
    case "ul":
      return (
        <box className="ul">
          {block.items.map((item, i) => (
            <box key={i} className="li"><box className="dot" /><box className="lt"><Inline spans={item} /></box></box>
          ))}
        </box>
      );
    case "pre":
      return <box className="pre">{block.lines.map((line, i) => <box key={i} className="cl">{line}</box>)}</box>;
    case "table":
      return (
        <box className={block.head.length === 3 ? "t3" : "t4"}>
          {block.head.map((cell, i) => <box key={"h" + i} className="th">{cell}</box>)}
          {block.rows.flatMap((row, r) => row.map((cell, i) => <box key={r + "-" + i} className="td">{cell}</box>))}
        </box>
      );
    case "img":
      return (
        <box className="fig">
          <img className="img" src={pictures[block.picture]} style={{ width: block.width, height: block.height }} />
          <box className="cap">{block.caption}</box>
        </box>
      );
  }
}

const ItemView = memo(function ItemView({ item, version }: { item: Item; version?: number }) {
  return (
    <box className="item">
      <box className="head">
        <box className={"avatar c" + item.color}>{item.initials}</box>
        <box className="who"><box className="name">{item.author}</box><box className="time">{item.time}</box></box>
        <box className="tags">{item.tags.map((t) => <box key={t} className="tag">{t}</box>)}</box>
      </box>
      {item.blocks.map((block, i) => <BlockView key={i} block={block} />)}
      <box className="foot">
        <box className="act">{"Reply " + item.replies}</box>
        <box className="act">{"Like " + item.likes}</box>
        <box className="act">Share</box>
      </box>
    </box>
  );
});

function Frame({ title, scroller, children }: { title: string; scroller: React.RefObject<Scroller | null>; children: React.ReactNode }) {
  return (
    <box className="app">
      <box className="bar">{title}</box>
      <box className="scroll" ref={scroller}>{children}</box>
    </box>
  );
}

function Feed() {
  const [items] = useState(() => parse(corpus, 0, SIZE));
  const scroller = useRef<Scroller>(null);
  useEffect(() => {
    const el = () => scroller.current!;
    let top = 0;
    let swept = false;
    const steps: Step[] = [
      { idle: "loaded", ms: 3000 },
      { mark: "loaded" },
      { driver: "scroll", frames: 600, frame: () => { top += 24; el().scrollTop = top; } },
      {
        driver: "sweep",
        frame: () => {
          if (swept) return false;
          top += 720;
          if (top >= maxScroll(el())) { top = 0; swept = true; }
          el().scrollTop = top;
        },
      },
      { idle: "swept", ms: 3000 },
      { mark: "swept" },
    ];
    run(steps);
  }, []);
  return <Frame title={`xbench feed-${SIZE}`} scroller={scroller}><box className={FEED}>{items.map((item) => <ItemView key={item.id} item={item} />)}</box></Frame>;
}

const COLUMNS = 16;
const ROWS = 34;
const CELLS = COLUMNS * ROWS;
const NOTES = 24;
const startValue = (i: number) => (i * 7919) % 10000;

const Cell = memo(function Cell({ index, value }: { index: number; value: number }) {
  return (
    <box className={"cell cl" + (value % 8)}>
      <box className="cn">{"cell " + index}</box>
      <box className="cv">{String(value)}</box>
    </box>
  );
});

function Wall() {
  const [values, setValues] = useState(() => Array.from({ length: CELLS }, (_, i) => startValue(i)));
  const [notes] = useState(() =>
    parse(corpus, 0, NOTES).map((item) => item.blocks.find((b) => b.kind === "p") as { spans: Span[] }),
  );
  const scroller = useRef<Scroller>(null);
  useEffect(() => {
    const steps: Step[] = [
      { idle: "loaded", ms: 3000 },
      { mark: "loaded" },
      {
        driver: "update",
        frames: 600,
        frame: (f) =>
          flushSync(() =>
            setValues((old) => {
              const next = old.slice();
              for (let k = 0; k < 32; k++) {
                const i = ((f * 32 + k) * 37) % CELLS;
                next[i] = (f * 31 + k * 7 + i) % 10000;
              }
              return next;
            }),
          ),
      },
      { driver: "pan", frames: 600, frame: (f) => { scroller.current!.scrollTop = f < 300 ? f + 1 : 599 - f; } },
      { mark: "end" },
    ];
    run(steps);
  }, []);
  return (
    <Frame title="xbench wall" scroller={scroller}>
      <box className="wall">
        <box className="cells">{values.map((v, i) => <Cell key={i} index={i} value={v} />)}</box>
        <box className="notes">{notes.map((n, i) => <box key={i} className="note"><Inline spans={n.spans} /></box>)}</box>
      </box>
    </Frame>
  );
}

/** The words the stream writes: the paragraphs of the items after the transcript, in order. */
function streamWords(): string[] {
  const words: string[] = [];
  for (const item of parse(corpus, SIZE, 200)) {
    for (const b of item.blocks) if (b.kind === "p") for (const s of b.spans) words.push(...s.text.split(" ").filter(Boolean));
  }
  return words;
}

function Stream() {
  const [items, setItems] = useState(() => parse(corpus, 0, SIZE));
  const scroller = useRef<Scroller>(null);
  useEffect(() => {
    const words = streamWords();
    const authors = parse(corpus, SIZE, 50);
    let next = 0;
    let written = 0;
    let made = 0;
    let paragraph = "";
    const pin = () => { scroller.current!.scrollTop = 1e9; };
    pin();
    const frame = () => {
      flushSync(() =>
        setItems((old) => {
          const out = old.slice();
          if (written % 240 === 0) {
            const a = authors[made % authors.length];
            out.push({ ...a, id: 100000 + made, blocks: [] });
            made += 1;
          }
          const last = { ...out[out.length - 1] };
          const blocks = last.blocks.slice();
          if (written % 60 === 0) { paragraph = ""; blocks.push({ kind: "p", spans: [] }); }
          for (let k = 0; k < 3; k++) { paragraph += (paragraph ? " " : "") + words[next % words.length]; next += 1; }
          written += 3;
          blocks[blocks.length - 1] = { kind: "p", spans: spans(paragraph) };
          last.blocks = blocks;
          out[out.length - 1] = last;
          return out;
        }),
      );
      pin();
    };
    run([
      { idle: "loaded", ms: 3000 },
      { mark: "loaded" },
      { driver: "stream", frames: 900, frame },
      { idle: "streamed", ms: 3000 },
      { mark: "streamed" },
    ]);
  }, []);
  return <Frame title={`xbench stream-${SIZE}`} scroller={scroller}><box className={FEED}>{items.map((item) => <ItemView key={item.id} item={item} />)}</box></Frame>;
}

function Churn() {
  const [items, setItems] = useState<Item[]>([]);
  const scroller = useRef<Scroller>(null);
  useEffect(() => {
    const steps: Step[] = [{ idle: "base", ms: 1000 }, { mark: "base" }];
    for (let cycle = 0; cycle < 3; cycle++) {
      const source = parse(corpus, cycle * 1000, SIZE);
      steps.push(
        { driver: "grow-" + (cycle + 1), frames: Math.ceil(SIZE / 25), frame: (f) => flushSync(() => setItems(source.slice(0, (f + 1) * 25))) },
        { idle: "full-" + (cycle + 1), ms: 1000 },
        { mark: "full-" + (cycle + 1) },
        { driver: "clear-" + (cycle + 1), frames: 1, frame: () => flushSync(() => setItems([])) },
        { idle: "empty-" + (cycle + 1), ms: 1500 },
        { mark: "empty-" + (cycle + 1) },
      );
    }
    run(steps);
  }, []);
  return <Frame title={`xbench churn-${SIZE}`} scroller={scroller}><box className={FEED}>{items.map((item) => <ItemView key={item.id} item={item} />)}</box></Frame>;
}

/** A WebGPU canvas that draws every frame, pinned over a feed (SCENES.md). */
function Canvas() {
  const [items] = useState(() => parse(corpus, 0, SIZE));
  const scroller = useRef<Scroller>(null);
  const canvas = useRef<any>(null);
  useEffect(() => {
    stage(canvas.current).then((draw) => {
      let f = 0;
      let top = 0;
      draw(f++);
      const steps: Step[] = [
        { idle: "loaded", ms: 3000 },
        { mark: "loaded" },
        { driver: "draw", frames: 600, frame: () => { draw(f++); } },
        { driver: "draw-scroll", frames: 600, frame: () => { draw(f++); top += 24; scroller.current!.scrollTop = top; } },
        { idle: "end", ms: 3000 },
        { mark: "end" },
      ];
      run(steps);
    });
  }, []);
  return (
    <box className="app">
      <box className="bar">{`xbench canvas-${SIZE}`}</box>
      <canvas className="stage" ref={canvas} width={1440} height={540} />
      <box className="scroll" ref={scroller}><box className={FEED}>{items.map((item) => <ItemView key={item.id} item={item} />)}</box></box>
    </box>
  );
}

export function App() {
  if (scene === "input") return <Input />;
  if (scene === "chat") return <Chat count={SIZE} lazy={!!import.meta.env.VITE_XB_CONTENT_VISIBILITY} />;
  if (scene === "canvas") return <Canvas />;
  if (scene === "wall") return <Wall />;
  if (scene === "stream") return <Stream />;
  if (scene === "churn") return <Churn />;
  return <Feed />;
}
