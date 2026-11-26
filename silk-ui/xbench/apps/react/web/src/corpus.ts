// The corpus (content/corpus.txt, format in content/gen.py), parsed into items.

export type Span = { mark: "" | "b" | "i" | "k" | "a"; text: string };
export type Block =
  | { kind: "p" | "q" | "h"; spans: Span[] }
  | { kind: "ul"; items: Span[][] }
  | { kind: "pre"; lines: string[] }
  | { kind: "table"; head: string[]; rows: string[][] }
  | { kind: "img"; picture: number; width: number; height: number; caption: string };
export type Item = {
  id: number;
  author: string;
  initials: string;
  color: number;
  time: string;
  tags: string[];
  replies: number;
  likes: number;
  blocks: Block[];
};

const MARKS: Record<string, [Span["mark"], string]> = { "*": ["b", "*"], _: ["i", "_"], "`": ["k", "`"], "[": ["a", "]"] };

/** Splits inline text at its marks: `*bold*`, `_italic_`, `` `code` ``, `[link]`. */
export function spans(text: string): Span[] {
  const out: Span[] = [];
  let plain = "";
  let at = 0;
  while (at < text.length) {
    const open = MARKS[text[at]];
    const close = open ? text.indexOf(open[1], at + 1) : -1;
    if (open && close > at + 1) {
      if (plain) out.push({ mark: "", text: plain });
      plain = "";
      out.push({ mark: open[0], text: text.slice(at + 1, close) });
      at = close + 1;
    } else {
      plain += text[at];
      at += 1;
    }
  }
  if (plain) out.push({ mark: "", text: plain });
  return out;
}

function hash(text: string): number {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) >>> 0;
  return h;
}

/** The first `count` items of the corpus, from item `first` on. */
export function parse(source: string, first: number, count: number): Item[] {
  const items: Item[] = [];
  let item: Item | null = null;
  let last = "";
  let at = 0;
  while (at < source.length) {
    let end = source.indexOf("\n", at);
    if (end < 0) end = source.length;
    const line = source.slice(at, end);
    at = end + 1;
    if (line.length === 0) continue;
    const kind = line[0];
    if (kind === "#") {
      const [id, author, time, tags, counts] = line.slice(1).split("|");
      const n = Number(id);
      if (n >= first + count) break;
      if (n < first) { item = null; continue; }
      const [replies, likes] = counts.split(",").map(Number);
      const words = author.split(" ");
      item = {
        id: n,
        author,
        initials: words[0][0] + words[words.length - 1][0],
        color: hash(author) % 8,
        time,
        tags: tags.split(","),
        replies,
        likes,
        blocks: [],
      };
      items.push(item);
      last = "";
      continue;
    }
    if (!item) continue;
    const rest = line.slice(2);
    const blocks = item.blocks;
    const tail = blocks[blocks.length - 1];
    if (kind === "P" || kind === "Q" || kind === "H") {
      blocks.push({ kind: kind === "P" ? "p" : kind === "Q" ? "q" : "h", spans: kind === "H" ? [{ mark: "", text: rest }] : spans(rest) });
    } else if (kind === "L") {
      if (last === "L" && tail.kind === "ul") tail.items.push(spans(rest));
      else blocks.push({ kind: "ul", items: [spans(rest)] });
    } else if (kind === "C") {
      if (last === "C" && tail.kind === "pre") tail.lines.push(rest);
      else blocks.push({ kind: "pre", lines: [rest] });
    } else if (kind === "T") {
      const cells = rest.split("|");
      if (last === "T" && tail.kind === "table") tail.rows.push(cells);
      else blocks.push({ kind: "table", head: cells, rows: [] });
    } else if (kind === "I") {
      const [p, w, h, ...caption] = rest.split(" ");
      blocks.push({ kind: "img", picture: Number(p), width: Number(w), height: Number(h), caption: caption.join(" ") });
    }
    last = kind;
  }
  return items;
}
