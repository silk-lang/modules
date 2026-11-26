#!/usr/bin/env python3
"""Writes the benchmark corpus every implementation reads: content/corpus.txt and the four
pictures in assets/images/. Deterministic; the outputs are committed, so implementations never
port a generator (run it again only to change the corpus, and record that in LOG.md).

The corpus is a list of feed items in a line format any language parses in a few lines:

    #<id>|<author>|<time>|<tag,tag>|<replies>,<likes>   starts an item
    P <inline text>          paragraph; inline marks: *bold*, _italic_, `code`, [link]
    H <text>                 heading
    L <inline text>          list item (consecutive L lines are one list)
    C <text>                 code line (consecutive C lines are one block; text is verbatim)
    T <cell>|<cell>|...      table row (consecutive T lines are one table; the first is the head)
    I <n> <w> <h> <caption>  picture n (0-3) shown at w x h CSS px
    Q <inline text>          quote

Marks never nest and never span lines. Words are ASCII; captions and cells have no marks.
"""
import os, random, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
ITEMS = 3000

WORDS = (
    "the of and to in is that for it as with was on be by at this have from or one had not but what all were "
    "when we there can an your which their said if do will each about how up out them then she many some so "
    "these would other into has more her two like him see time could no make than first been its who now people "
    "my made over did down only way find use may water long little very after words called just where most know "
    "get through back much before go good new write our used me man too any day same right look think also around "
    "another came come work three word must because does part even place well such here take why things help put "
    "years different away again off went old number great tell men say small every found still between name should "
    "home big give air line set own under read last never us left end along while might next sound below saw "
    "something thought both few those always looked show large often together asked house world going want school "
    "important until form food keep children feet land side without once life enough took sometimes four head "
    "above kind began almost live page got earth need far hand high year light parts country let night following "
    "picture being study second soon times story since white days ever paper hard near sentence better best "
    "across during today others however sure means knew try told young sun ways thing whole hear example heard "
    "several change answer room against top turned learn point city play toward five using usually renderer "
    "layout cascade selector gradient texture buffer shader pipeline frame budget latency throughput allocation "
    "footprint benchmark paragraph compositor glyph atlas kerning baseline viewport scrollbar"
).split()
AUTHORS = ["Ada Okafor", "Bruno Lima", "Chen Wei", "Dana Kovacs", "Elif Demir", "Farah Haddad", "Goran Petrovic",
           "Hana Sato", "Ines Moreau", "Jonas Berg", "Kemi Adeyemi", "Luis Ortega", "Maya Patel", "Nils Jansen",
           "Olga Ivanova", "Pedro Santos"]
TAGS = ["layout", "text", "gpu", "memory", "react", "native", "perf", "design", "bug", "release", "docs", "infra"]
CODE = ["fn layout(tree: &mut Tree, root: NodeId) -> Size {", "    let style = tree.style(root);",
        "    for child in tree.children(root) {", "        total += measure(child, available);", "    }",
        "    return Size { width: w, height: total };", "}", "const frame = performance.now() - start;",
        "if (budget < frame) dropped += 1;", "let glyphs = shaper.shape(&run, font, size);",
        "atlas.insert(key, bitmap).unwrap_or(slot);", "for (const node of nodes) node.dirty = false;",
        "  return cache.get(key) ?? compute(key);", "match event { Scroll(d) => offset += d, _ => {} }"]
PICTURES = [(360, 200), (240, 240), (480, 180), (300, 220)]


def phrase(r, low, high):
    return " ".join(r.choice(WORDS) for _ in range(r.randint(low, high)))


def marked(r, low, high):
    """A run of sentences with a few inline marks."""
    out = []
    for _ in range(r.randint(low, high)):
        words = [r.choice(WORDS) for _ in range(r.randint(6, 18))]
        words[0] = words[0].capitalize()
        if r.random() < 0.45:
            i = r.randrange(len(words) - 1)
            n = r.randint(1, 3)
            kind = r.choice("*_`[")
            close = {"*": "*", "_": "_", "`": "`", "[": "]"}[kind]
            span = " ".join(words[i:i + n])
            words[i:i + n] = [kind + span + close]
        out.append(" ".join(words) + ("?" if r.random() < 0.12 else "."))
    return " ".join(out)


def item(r, n):
    author = AUTHORS[r.randrange(len(AUTHORS))]
    tags = ",".join(r.sample(TAGS, r.randint(1, 3)))
    hh, mm = divmod((n * 7) % 1440, 60)
    lines = [f"#{n}|{author}|{hh:02d}:{mm:02d}|{tags}|{r.randint(0, 40)},{r.randint(0, 300)}"]
    kinds = ["P"] + r.choices("PPPHLCTIQ", k=r.randint(1, 5))
    for k in kinds:
        if k == "P":
            lines.append("P " + marked(r, 1, 6))
        elif k == "H":
            lines.append("H " + phrase(r, 2, 6).capitalize())
        elif k == "L":
            for _ in range(r.randint(2, 5)):
                lines.append("L " + marked(r, 1, 1))
        elif k == "C":
            start = r.randrange(len(CODE))
            for i in range(r.randint(3, 9)):
                lines.append("C " + CODE[(start + i) % len(CODE)])
        elif k == "T":
            cols = r.randint(3, 4)
            lines.append("T " + "|".join(w.capitalize() for w in r.sample(WORDS, cols)))
            for _ in range(r.randint(2, 6)):
                lines.append("T " + "|".join(f"{r.randint(1, 9999)}" if c else phrase(r, 1, 2) for c in range(cols)))
        elif k == "I":
            p = r.randrange(4)
            w, h = PICTURES[p]
            lines.append(f"I {p} {w} {h} " + phrase(r, 3, 8).capitalize())
        elif k == "Q":
            lines.append("Q " + marked(r, 1, 2))
    return lines


def png(path, w, h, seed):
    """A smooth two-colour picture with a few discs: decodes like a photo-sized PNG."""
    r = random.Random(seed)
    c0 = [r.randint(30, 200) for _ in range(3)]
    c1 = [r.randint(30, 200) for _ in range(3)]
    discs = [(r.randint(0, w), r.randint(0, h), r.randint(20, 70), [r.randint(80, 255) for _ in range(3)]) for _ in range(5)]
    rows = bytearray()
    for y in range(h):
        rows.append(0)
        for x in range(w):
            t = (x / w + y / h) / 2
            px = [int(a + (b - a) * t) for a, b in zip(c0, c1)]
            for cx, cy, cr, col in discs:
                if (x - cx) ** 2 + (y - cy) ** 2 < cr * cr:
                    px = [(p + q) // 2 for p, q in zip(px, col)]
            rows += bytes(px)
    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                + chunk(b"IDAT", zlib.compress(bytes(rows), 9)) + chunk(b"IEND", b""))


def main():
    r = random.Random(20261119)
    out = []
    for n in range(ITEMS):
        out += item(r, n)
    with open(os.path.join(HERE, "corpus.txt"), "w") as f:
        f.write("\n".join(out) + "\n")
    os.makedirs(os.path.join(ROOT, "assets", "images"), exist_ok=True)
    for i, (w, h) in enumerate(PICTURES):
        # Pictures are stored at twice their CSS size, as on a 2x display.
        png(os.path.join(ROOT, "assets", "images", f"picture-{i}.png"), w * 2, h * 2, 100 + i)


if __name__ == "__main__":
    main()
