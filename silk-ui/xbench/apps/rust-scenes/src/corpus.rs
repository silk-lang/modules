//! The corpus (content/corpus.txt, format in content/gen.py), parsed as apps/react/web/src/corpus.ts does.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Mark { None, Bold, Italic, Code, Link }

#[derive(Clone, Debug)]
pub struct Span { pub mark: Mark, pub text: String }

#[derive(Clone, Debug)]
pub enum Block {
    P(Vec<Span>),
    Q(Vec<Span>),
    /// A heading: plain text.
    H(String),
    Ul(Vec<Vec<Span>>),
    Pre(Vec<String>),
    Table { head: Vec<String>, rows: Vec<Vec<String>> },
    Img { picture: usize, width: f32, height: f32, caption: String },
}

#[derive(Clone, Debug)]
pub struct Item {
    pub id: usize,
    pub author: String,
    pub initials: String,
    pub color: usize,
    pub time: String,
    pub tags: Vec<String>,
    pub replies: u32,
    pub likes: u32,
    pub blocks: Vec<Block>,
}

fn mark_of(c: u8) -> Option<(Mark, u8)> {
    match c {
        b'*' => Some((Mark::Bold, b'*')),
        b'_' => Some((Mark::Italic, b'_')),
        b'`' => Some((Mark::Code, b'`')),
        b'[' => Some((Mark::Link, b']')),
        _ => None,
    }
}

/// Splits inline text at its marks: `*bold*`, `_italic_`, `` `code` ``, `[link]`.
pub fn spans(text: &str) -> Vec<Span> {
    let bytes = text.as_bytes();
    let mut out = Vec::new();
    let mut plain = 0;
    let mut at = 0;
    while at < bytes.len() {
        if let Some((mark, close)) = mark_of(bytes[at]) {
            if let Some(off) = bytes[at + 1..].iter().position(|&b| b == close) {
                let end = at + 1 + off;
                if end > at + 1 {
                    if at > plain { out.push(Span { mark: Mark::None, text: text[plain..at].to_string() }); }
                    out.push(Span { mark, text: text[at + 1..end].to_string() });
                    at = end + 1;
                    plain = at;
                    continue;
                }
            }
        }
        at += 1;
    }
    if bytes.len() > plain { out.push(Span { mark: Mark::None, text: text[plain..].to_string() }); }
    out
}

fn hash(text: &str) -> u32 {
    // JavaScript's charCodeAt: UTF-16 code units (the corpus is ASCII).
    text.encode_utf16().fold(0u32, |h, c| h.wrapping_mul(31).wrapping_add(c as u32))
}

/// The first `count` items of the corpus, from item `first` on.
pub fn parse(source: &str, first: usize, count: usize) -> Vec<Item> {
    let mut items: Vec<Item> = Vec::new();
    let mut current = false;
    let mut last = 0u8;
    for line in source.split('\n') {
        if line.is_empty() { continue; }
        let kind = line.as_bytes()[0];
        if kind == b'#' {
            let fields: Vec<&str> = line[1..].split('|').collect();
            let n: usize = fields[0].parse().unwrap_or(0);
            if n >= first + count { break; }
            if n < first { current = false; continue; }
            let mut counts = fields[4].split(',').map(|c| c.parse().unwrap_or(0));
            let author = fields[1].to_string();
            let words: Vec<&str> = author.split(' ').collect();
            let initials = format!("{}{}", &words[0][..1], &words[words.len() - 1][..1]);
            items.push(Item {
                id: n, color: (hash(&author) % 8) as usize, initials, author, time: fields[2].to_string(),
                tags: fields[3].split(',').map(String::from).collect(),
                replies: counts.next().unwrap_or(0), likes: counts.next().unwrap_or(0), blocks: Vec::new(),
            });
            current = true;
            last = 0;
            continue;
        }
        if !current { continue; }
        let rest = if line.len() > 2 { &line[2..] } else { "" };
        let blocks = &mut items.last_mut().unwrap().blocks;
        match kind {
            b'P' => blocks.push(Block::P(spans(rest))),
            b'Q' => blocks.push(Block::Q(spans(rest))),
            b'H' => blocks.push(Block::H(rest.to_string())),
            b'L' => match (last, blocks.last_mut()) {
                (b'L', Some(Block::Ul(list))) => list.push(spans(rest)),
                _ => blocks.push(Block::Ul(vec![spans(rest)])),
            },
            b'C' => match (last, blocks.last_mut()) {
                (b'C', Some(Block::Pre(lines))) => lines.push(rest.to_string()),
                _ => blocks.push(Block::Pre(vec![rest.to_string()])),
            },
            b'T' => {
                let cells: Vec<String> = rest.split('|').map(String::from).collect();
                match (last, blocks.last_mut()) {
                    (b'T', Some(Block::Table { rows, .. })) => rows.push(cells),
                    _ => blocks.push(Block::Table { head: cells, rows: Vec::new() }),
                }
            }
            b'I' => {
                let mut parts = rest.splitn(4, ' ');
                let p = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0);
                let w = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
                let h = parts.next().and_then(|v| v.parse().ok()).unwrap_or(0.0);
                blocks.push(Block::Img { picture: p, width: w, height: h, caption: parts.next().unwrap_or("").to_string() });
            }
            _ => {}
        }
        last = kind;
    }
    items
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses() {
        let items = super::parse(crate::CORPUS, 0, 1000);
        assert_eq!(items.len(), 1000);
        assert_eq!(items[0].id, 0);
    }
}
