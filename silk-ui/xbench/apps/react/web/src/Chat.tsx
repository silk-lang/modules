// The chat scene (SCENES.md): a chatbot's transcript in one scroller, every message kept in the
// tree. The messages come from a seeded generator (generated words, no real conversation): even
// ones are the person's, a few sentences; odd ones are the assistant's, paragraphs with tables,
// lists, code and pictures. The style is style/chat.css.
import { memo, useEffect, useRef, useState } from "react";
import { flushSync } from "@silkui/react";
import { run, type Step } from "./driver";
import { pictures } from "./pictures";

const words = (
  "the of and to in is that for it as with was on be by at this have from or one had not but what all were " +
  "when we there can an your which their said if do will each about how up out them then she many some so " +
  "these would other into has more her two like him see time could no make than first been its who now people " +
  "my made over did down only way find use may water long little very after words called just where most know " +
  "get through back much before go good new write our used me man too any day same right look think also around " +
  "another came come work three word must because does part even place well such here take why things help put " +
  "years different away again off went old number great tell men say small every found still between name should " +
  "home big give air line set own under read last never us left end along while might next sound below saw " +
  "something thought both few those always looked show large often together asked house world going want school " +
  "important until form food keep children feet land side without boy once animals life enough took sometimes " +
  "four head above kind began almost live page got earth need far hand high year mother light parts country " +
  "father let night following picture being study second eyes soon times story boys since white days ever paper " +
  "hard near sentence better best across during today others however sure means knew try told young miles sun " +
  "ways thing whole hear example heard several change answer room sea against top turned learn point city play " +
  "toward five using himself usually renderer layout cascade selector gradient texture buffer shader pipeline " +
  "frame budget latency throughput allocation footprint benchmark transcript paragraph virtualized compositor"
).split(" ");

type Random = () => number;

function random(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (next: Random, low: number, high: number) => low + Math.floor(next() * (high - low + 1));
const word = (next: Random) => words[Math.floor(next() * words.length)];

function phrase(next: Random, low: number, high: number): string {
  const count = between(next, low, high);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(word(next));
  return out.join(" ");
}

function sentence(next: Random): string {
  const text = phrase(next, 7, 22);
  return text[0].toUpperCase() + text.slice(1) + (next() < 0.15 ? "?" : ".");
}

function paragraph(next: Random, low: number, high: number): string {
  const count = between(next, low, high);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) out.push(sentence(next));
  return out.join(" ");
}

type Block =
  | { kind: "text"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "code"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "image"; src: string; caption: string };

type Message = { id: number; mine: boolean; name: string; time: string; blocks: Block[] };

const stamp = (index: number) => `${String(9 + (Math.floor(index / 12) % 12)).padStart(2, "0")}:${String((index * 5) % 60).padStart(2, "0")}`;

/** Message `index` of the transcript: the same one in every run and every app. */
function makeMessage(index: number): Message {
  const next = random(index * 7919 + 13);
  if (index % 2 === 0) {
    return { id: index, mine: true, name: "You", time: stamp(index), blocks: [{ kind: "text", text: paragraph(next, 1, 3) }] };
  }
  const turn = (index - 1) / 2;
  const blocks: Block[] = [{ kind: "text", text: paragraph(next, 3, 5) }];
  if (turn % 3 === 0) {
    const head = ["Metric", "Before", "After", "Change"];
    const rows: string[][] = [];
    const count = 5 + (turn % 4);
    for (let row = 0; row < count; row += 1) {
      const before = between(next, 20, 900);
      const after = between(next, 20, 900);
      rows.push([phrase(next, 1, 3), `${before} ms`, `${after} ms`, `${(((after - before) / before) * 100).toFixed(1)}%`]);
    }
    blocks.push({ kind: "heading", text: phrase(next, 3, 6) }, { kind: "table", head, rows });
  }
  if (turn % 4 === 1) blocks.push({ kind: "image", src: pictures[turn % pictures.length], caption: sentence(next) });
  if (turn % 3 === 1) {
    const items: string[] = [];
    const count = between(next, 4, 6);
    for (let item = 0; item < count; item += 1) items.push(sentence(next));
    blocks.push({ kind: "list", items });
  }
  if (turn % 5 === 2) {
    const lines: string[] = [];
    const count = 8 + (turn % 6);
    for (let line = 0; line < count; line += 1) {
      lines.push(`${"  ".repeat(line % 3)}${line % 4 === 0 ? "const" : "let"} ${word(next)}_${line} = ${word(next)}(${word(next)}, ${between(next, 0, 255)});`);
    }
    blocks.push({ kind: "code", lines });
  }
  blocks.push({ kind: "text", text: paragraph(next, 4, 7) }, { kind: "text", text: paragraph(next, 2, 4) });
  return { id: index, mine: false, name: "Assistant", time: stamp(index), blocks };
}

function makeMessages(count: number, first = 0): Message[] {
  const out: Message[] = [];
  for (let index = 0; index < count; index += 1) out.push(makeMessage(first + index));
  return out;
}

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "text":
      return <box className="msg-text">{block.text}</box>;
    case "heading":
      return <box className="msg-heading">{block.text}</box>;
    case "list":
      return (
        <box className="msg-list">
          {block.items.map((item, index) => (
            <box key={index} className="msg-li"><box className="msg-n">{`${index + 1}.`}</box><box className="msg-lt">{item}</box></box>
          ))}
        </box>
      );
    case "code":
      return <box className="msg-code">{block.lines.map((line, index) => <box key={index} className="msg-cl">{line}</box>)}</box>;
    case "table":
      return (
        <box className="msg-table">
          {block.head.map((cell) => <box key={cell} className="msg-th">{cell}</box>)}
          {block.rows.flatMap((row, at) =>
            row.map((cell, column) => (
              <box key={`${at}-${column}`} className={"msg-td" + (column === 0 ? " first" : "") + (at % 2 === 1 ? " odd" : "")}>{cell}</box>
            )),
          )}
        </box>
      );
    case "image":
      return (
        <box className="msg-fig">
          <img className="msg-img" src={block.src} />
          <box className="msg-cap">{block.caption}</box>
        </box>
      );
  }
}

const MessageView = memo(function MessageView({ message }: { message: Message }) {
  return (
    <box className={message.mine ? "msg mine" : "msg"}>
      <box className="msg-avatar">{message.mine ? "Y" : "A"}</box>
      <box className="msg-main">
        <box className="msg-head">
          <box className="msg-name">{message.name}</box>
          <box className="msg-time">{message.time}</box>
        </box>
        {message.blocks.map((block, index) => <BlockView key={index} block={block} />)}
      </box>
    </box>
  );
});

type Scroller = { scrollTop: number };
const maxScroll = (node: any): number => node.scrollTopMax ?? node.scrollHeight - node.clientHeight;

/** `count` messages; the script scrolls, sweeps, then appends a message every 10 frames. */
export function Chat({ count, lazy }: { count: number; lazy: boolean }) {
  const [messages, setMessages] = useState(() => makeMessages(count));
  const scroller = useRef<Scroller>(null);
  useEffect(() => {
    const el = () => scroller.current!;
    let top = 0;
    let swept = false;
    let added = 0;
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
      {
        driver: "append",
        frames: 300,
        frame: (f) => {
          if (f % 10 === 0) {
            const message = makeMessage(count + added);
            added += 1;
            flushSync(() => setMessages((old) => [...old, message]));
          }
          el().scrollTop = 1e9;
        },
      },
      { idle: "rest", ms: 3000 },
      { mark: "rest" },
    ];
    run(steps);
  }, []);
  return (
    <box className="app chat">
      <box className="bar">{`xbench chat-${count}`}</box>
      <box className="chat-body">
        <box className="chat-scroll" ref={scroller}>
          <box className={lazy ? "chat-log lazy" : "chat-log"}>{messages.map((message) => <MessageView key={message.id} message={message} />)}</box>
        </box>
      </box>
    </box>
  );
}
