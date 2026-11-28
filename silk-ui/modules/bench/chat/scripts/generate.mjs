// Writes the fixtures of the chat bench (../fixtures):
//   chat.tree   the node tree of xbench's chat scene (silk-ui/xbench/apps/react/web/src/Chat.tsx,
//               `<Chat count={1000} lazy={false}>`), one node per line, in document order:
//                 B<className>  opens a box        I<className>  an <img> (a leaf box)
//                 T<text>       a text node child  E             closes the open box
//   chat.sheet  xbench/style/bench.css + xbench/style/chat.css compiled with the @silkui/vite
//               compiler, without the @font-face rules: the bench adds the four font files to
//               the tree's font collection instead (see src/main.silk).
//
//   node silk-ui/modules/bench/chat/scripts/generate.mjs [count]
//
// The generator below is Chat.tsx's, copied verbatim minus the TypeScript types and React, so
// the words, numbers and structure are byte for byte the scene's. Keep it in sync with Chat.tsx.
import { readFileSync, writeFileSync } from 'node:fs';
import { compileStylesheet } from '../../../js/packages/vite/src/compiler.js';

const COUNT = Number(process.argv[2] ?? 1000);
const xbench = new URL('../../../../xbench/', import.meta.url);

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

function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const between = (next, low, high) => low + Math.floor(next() * (high - low + 1));
const word = (next) => words[Math.floor(next() * words.length)];

function phrase(next, low, high) {
  const count = between(next, low, high);
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(word(next));
  return out.join(" ");
}

function sentence(next) {
  const text = phrase(next, 7, 22);
  return text[0].toUpperCase() + text.slice(1) + (next() < 0.15 ? "?" : ".");
}

function paragraph(next, low, high) {
  const count = between(next, low, high);
  const out = [];
  for (let i = 0; i < count; i += 1) out.push(sentence(next));
  return out.join(" ");
}

// Only the picture's index matters here: the bench draws no pixels.
const pictures = [0, 1, 2, 3];

const stamp = (index) => `${String(9 + (Math.floor(index / 12) % 12)).padStart(2, "0")}:${String((index * 5) % 60).padStart(2, "0")}`;

function makeMessage(index) {
  const next = random(index * 7919 + 13);
  if (index % 2 === 0) {
    return { id: index, mine: true, name: "You", time: stamp(index), blocks: [{ kind: "text", text: paragraph(next, 1, 3) }] };
  }
  const turn = (index - 1) / 2;
  const blocks = [{ kind: "text", text: paragraph(next, 3, 5) }];
  if (turn % 3 === 0) {
    const head = ["Metric", "Before", "After", "Change"];
    const rows = [];
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
    const items = [];
    const count = between(next, 4, 6);
    for (let item = 0; item < count; item += 1) items.push(sentence(next));
    blocks.push({ kind: "list", items });
  }
  if (turn % 5 === 2) {
    const lines = [];
    const count = 8 + (turn % 6);
    for (let line = 0; line < count; line += 1) {
      lines.push(`${"  ".repeat(line % 3)}${line % 4 === 0 ? "const" : "let"} ${word(next)}_${line} = ${word(next)}(${word(next)}, ${between(next, 0, 255)});`);
    }
    blocks.push({ kind: "code", lines });
  }
  blocks.push({ kind: "text", text: paragraph(next, 4, 7) }, { kind: "text", text: paragraph(next, 2, 4) });
  return { id: index, mine: false, name: "Assistant", time: stamp(index), blocks };
}

function makeMessages(count, first = 0) {
  const out = [];
  for (let index = 0; index < count; index += 1) out.push(makeMessage(first + index));
  return out;
}

// The JSX of Chat.tsx (BlockView, MessageView, Chat) as lines of the tree file.
const out = [];
let boxes = 0, texts = 0, images = 0;
const open = (className) => { boxes += 1; out.push('B' + className); };
const close = () => out.push('E');
const text = (value) => {
  if (/[\n\r]/.test(value)) throw new Error('a text with a line break');
  texts += 1;
  out.push('T' + value);
};
const box = (className, value) => { open(className); text(value); close(); };

function blockView(block) {
  switch (block.kind) {
    case "text": return box("msg-text", block.text);
    case "heading": return box("msg-heading", block.text);
    case "list":
      open("msg-list");
      block.items.forEach((item, index) => { open("msg-li"); box("msg-n", `${index + 1}.`); box("msg-lt", item); close(); });
      return close();
    case "code":
      open("msg-code");
      block.lines.forEach((line) => box("msg-cl", line));
      return close();
    case "table":
      open("msg-table");
      block.head.forEach((cell) => box("msg-th", cell));
      block.rows.forEach((row, at) => row.forEach((cell, column) =>
        box("msg-td" + (column === 0 ? " first" : "") + (at % 2 === 1 ? " odd" : ""), cell)));
      return close();
    case "image":
      open("msg-fig");
      images += 1;
      out.push('Imsg-img');
      box("msg-cap", block.caption);
      return close();
  }
}

function messageView(message) {
  open(message.mine ? "msg mine" : "msg");
  box("msg-avatar", message.mine ? "Y" : "A");
  open("msg-main");
  open("msg-head");
  box("msg-name", message.name);
  box("msg-time", message.time);
  close();
  message.blocks.forEach(blockView);
  close();
  close();
}

// createRoot() mounts a new box as the root of the window's tree; <Chat> renders into it.
open("");
open("app chat");
box("bar", `xbench chat-${COUNT}`);
open("chat-body");
open("chat-scroll");
open("chat-log");
makeMessages(COUNT).forEach(messageView);
close(); close(); close(); close(); close();

const fixtures = new URL('../fixtures/', import.meta.url);
writeFileSync(new URL('chat.tree', fixtures), out.join('\n') + '\n');
console.log(`Wrote chat.tree: ${COUNT} messages, ${boxes + images + texts} nodes (${boxes} boxes, ${images} images, ${texts} text nodes)`);

// The stylesheet: bench.css then chat.css, as the chat build loads them, @font-face rules left out.
const css = ['style/bench.css', 'style/chat.css']
  .map((name) => readFileSync(new URL(name, xbench), 'utf8'))
  .join('\n')
  .replace(/@font-face\s*\{[^}]*\}/g, '');
const { bytes, diagnostics } = compileStylesheet(css);
writeFileSync(new URL('chat.sheet', fixtures), bytes);
for (const { kind, feature, count } of diagnostics) console.warn(`${kind}: ${feature} (${count})`);
console.log(`Wrote chat.sheet: ${bytes.length} compiled bytes`);
