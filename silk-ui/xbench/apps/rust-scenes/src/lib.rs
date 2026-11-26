//! The xbench scenes (SCENES.md) for the Rust apps: the corpus parsed as apps/react/web/src/corpus.ts
//! parses it, the scenes' state and what each frame does to it (App.tsx), the scripts, and the
//! protocol lines (PROTOCOL.md). An app keeps a [`Scene`], calls [`Scene::frame`] once a frame
//! with the frame's time, renders `scene.model`, and applies the scroll offset the frame asks for.

pub mod corpus;
pub use corpus::{Block, Item, Mark, Span};

use std::io::Write;

/// The corpus, the pictures and the fonts, embedded: every app reads the same bytes.
pub const CORPUS: &str = include_str!("../../../content/corpus.txt");
pub const PICTURES: [&[u8]; 4] = [
    include_bytes!("../../../assets/images/picture-0.png"),
    include_bytes!("../../../assets/images/picture-1.png"),
    include_bytes!("../../../assets/images/picture-2.png"),
    include_bytes!("../../../assets/images/picture-3.png"),
];
pub const INTER_REGULAR: &[u8] = include_bytes!("../../../assets/fonts/Inter-Regular.ttf");
pub const INTER_BOLD: &[u8] = include_bytes!("../../../assets/fonts/Inter-Bold.ttf");
pub const INTER_ITALIC: &[u8] = include_bytes!("../../../assets/fonts/Inter-Italic.ttf");
pub const MONO: &[u8] = include_bytes!("../../../assets/fonts/JetBrainsMono-Regular.ttf");

pub const WIDTH: f32 = 1040.0;
pub const HEIGHT: f32 = 720.0;
pub const CELLS: usize = 544;
pub const COLUMNS: usize = 16;
pub const NOTES: usize = 24;

/// Writes one protocol line on standard output, flushed.
pub fn say(line: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "XB {line}");
    let _ = out.flush();
}

/// Timeline runs (XB_TRACE): the start and end of a phase of start-up on one thread (lane), of
/// one kind (start, fonts, js, style, layout, paint, gpu, present, wait), for TIMELINE.md.
/// The runner stamps each line as it arrives.
pub fn span_begin(lane: &str, kind: &str, label: &str) {
    if tracing() { say(&format!("span begin {lane} {kind} {label}")); }
}

pub fn span_end(lane: &str, kind: &str, label: &str) {
    if tracing() { say(&format!("span end {lane} {kind} {label}")); }
}

/// A span that ends when dropped.
pub struct Phase { lane: &'static str, kind: &'static str, label: String }

impl Phase {
    pub fn new(lane: &'static str, kind: &'static str, label: &str) -> Phase {
        span_begin(lane, kind, label);
        Phase { lane, kind, label: label.to_string() }
    }
}

impl Drop for Phase {
    fn drop(&mut self) { span_end(self.lane, self.kind, &self.label); }
}

/// Runs `f` as one span.
pub fn span<R>(lane: &str, kind: &str, label: &str, f: impl FnOnce() -> R) -> R {
    span_begin(lane, kind, label);
    let r = f();
    span_end(lane, kind, label);
    r
}

pub fn tracing() -> bool {
    static ON: std::sync::OnceLock<bool> = std::sync::OnceLock::new();
    *ON.get_or_init(|| std::env::var_os("XB_TRACE").is_some())
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind { Feed, Wall, Stream, Churn }

/// The scene's data, as App.tsx's components hold it in state.
pub struct Model {
    pub kind: Kind,
    pub size: usize,
    pub title: String,
    /// feed, stream: the items shown; churn: the items now in the feed.
    pub items: Vec<Item>,
    /// A counter per item, bumped when the item changes (the stream's last item): a memo key.
    pub versions: Vec<u64>,
    /// wall: each cell's value; and the notes beside the grid.
    pub cells: Vec<u32>,
    pub notes: Vec<Vec<Span>>,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Op { Idle(u32), Mark, Drive(u32) }

#[derive(Clone, Debug)]
struct Step { op: Op, name: String }

fn idle(name: &str, ms: u32) -> Step { Step { op: Op::Idle(ms), name: name.into() } }
fn mark(name: &str) -> Step { Step { op: Op::Mark, name: name.into() } }
fn drive(name: &str, frames: u32) -> Step { Step { op: Op::Drive(frames), name: name.into() } }

/// What a frame asks of the app.
#[derive(Default, Debug)]
pub struct Frame {
    /// The model changed: render again.
    pub changed: bool,
    /// Scroll the scroller to this offset (CSS px; past the end means the end).
    pub scroll_to: Option<f32>,
}

/// A scene and its script.
pub struct Scene {
    pub model: Model,
    steps: Vec<Step>,
    at: usize,
    step_frame: u32,
    step_start: f64,
    frames: u32,
    last: f64,
    times: Vec<f64>,
    painted: bool,
    done: bool,
    top: f32,
    swept: bool,
    // stream
    words: Vec<String>,
    authors: Vec<Item>,
    next_word: usize,
    written: usize,
    made: usize,
    paragraph: String,
}

pub const END: f32 = 1e9;

impl Scene {
    /// `name`: feed, wall, stream, churn, with an optional size after a dash (feed-3000).
    pub fn new(name: &str) -> Scene {
        let (base, size) = match name.split_once('-') {
            Some((b, s)) => (b, s.parse::<usize>().ok()),
            None => (name, None),
        };
        let kind = match base { "wall" => Kind::Wall, "stream" => Kind::Stream, "churn" => Kind::Churn, _ => Kind::Feed };
        let size = size.unwrap_or(match kind { Kind::Feed => 1000, Kind::Stream => 300, Kind::Churn => 1000, Kind::Wall => 0 });
        let title = if kind == Kind::Wall { "xbench wall".to_string() } else { format!("xbench {base}-{size}") };
        let mut model = Model { kind, size, title, items: Vec::new(), versions: Vec::new(), cells: Vec::new(), notes: Vec::new() };
        let mut scene_words = Vec::new();
        let mut authors = Vec::new();
        let steps = match kind {
            Kind::Feed => {
                model.items = corpus::parse(CORPUS, 0, size);
                vec![idle("loaded", 3000), mark("loaded"), drive("scroll", 600), drive("sweep", 0), idle("swept", 3000), mark("swept")]
            }
            Kind::Wall => {
                model.cells = (0..CELLS as u32).map(|i| (i * 7919) % 10000).collect();
                // The first paragraph of each of the first 24 items.
                model.notes = corpus::parse(CORPUS, 0, NOTES).into_iter()
                    .filter_map(|item| item.blocks.into_iter().find_map(|b| if let Block::P(s) = b { Some(s) } else { None }))
                    .collect();
                vec![idle("loaded", 3000), mark("loaded"), drive("update", 600), drive("pan", 600), mark("end")]
            }
            Kind::Stream => {
                model.items = corpus::parse(CORPUS, 0, size);
                for item in corpus::parse(CORPUS, size, 200) {
                    for b in item.blocks {
                        if let Block::P(spans) = b {
                            for s in spans { scene_words.extend(s.text.split(' ').filter(|w| !w.is_empty()).map(String::from)); }
                        }
                    }
                }
                authors = corpus::parse(CORPUS, size, 50);
                vec![idle("loaded", 3000), mark("loaded"), drive("stream", 900), idle("streamed", 3000), mark("streamed")]
            }
            Kind::Churn => {
                let grow = size.div_ceil(25) as u32;
                let mut steps = vec![idle("base", 1000), mark("base")];
                for c in 1..=3 {
                    steps.extend([drive(&format!("grow-{c}"), grow), idle(&format!("full-{c}"), 1000), mark(&format!("full-{c}")),
                        drive(&format!("clear-{c}"), 1), idle(&format!("empty-{c}"), 1500), mark(&format!("empty-{c}"))]);
                }
                steps
            }
        };
        model.versions = vec![0; model.items.len()];
        Scene {
            model, steps, at: 0, step_frame: 0, step_start: 0.0, frames: 0, last: -1.0, times: Vec::new(), painted: false, done: false,
            top: 0.0, swept: false, words: scene_words, authors, next_word: 0, written: 0, made: 0, paragraph: String::new(),
        }
    }

    /// Whether the stream scene pins its scroller to the end from the start.
    pub fn pinned(&self) -> bool { self.model.kind == Kind::Stream }

    pub fn done(&self) -> bool { self.done }
    pub fn painted(&self) -> bool { self.painted }

    /// Says first-paint, when the app knows its first frame is on screen (a window), or after
    /// its second frame (windowless: the first one's layout and paint are done).
    pub fn first_paint(&mut self, now_ms: f64) {
        if !self.painted {
            self.painted = true;
            self.step_start = now_ms;
            say("first-paint");
        }
    }

    /// Whether the script wants a frame now; when it does not, [`Scene::deadline`] says when.
    pub fn wants_frames(&self) -> bool {
        if self.done { return false; }
        if !self.painted { return true; }
        match self.steps.get(self.at) { Some(s) => matches!(s.op, Op::Drive(_)) || self.step_frame == 0, None => true }
    }

    /// Milliseconds (on the frame clock) when the current idle or mark ends.
    pub fn deadline(&self) -> Option<f64> {
        match self.steps.get(self.at)?.op {
            Op::Idle(ms) => Some(self.step_start + ms as f64),
            Op::Mark => Some(self.step_start + 400.0),
            Op::Drive(_) => None,
        }
    }

    fn next(&mut self, now: f64) {
        self.at += 1;
        self.step_frame = 0;
        self.step_start = now;
    }

    /// One frame at `now_ms`. `max_scroll` is the scroller's scroll range now (for the sweep).
    /// `windowless`: first-paint comes after the second frame.
    pub fn frame(&mut self, now_ms: f64, max_scroll: f32, windowless: bool) -> Frame {
        let mut out = Frame::default();
        if self.done || now_ms == self.last { return out; }
        self.last = now_ms;
        self.frames += 1;
        if !self.painted {
            if windowless && self.frames >= 2 { self.first_paint(now_ms); }
            return out;
        }
        let Some(step) = self.steps.get(self.at).cloned() else {
            say("done");
            self.done = true;
            return out;
        };
        match step.op {
            Op::Idle(ms) => {
                if self.step_frame == 0 {
                    say(&format!("idle-begin {}", step.name));
                    self.step_start = now_ms;
                    self.step_frame = 1;
                } else if now_ms - self.step_start >= ms as f64 - 0.5 {
                    say(&format!("idle-end {}", step.name));
                    self.next(now_ms);
                }
            }
            Op::Mark => {
                if self.step_frame == 0 {
                    say(&format!("mark {}", step.name));
                    self.step_start = now_ms;
                    self.step_frame = 1;
                } else if now_ms - self.step_start >= 399.5 {
                    self.next(now_ms);
                }
            }
            Op::Drive(frames) => {
                if self.step_frame == 0 {
                    say(&format!("begin {}", step.name));
                    self.times.clear();
                    self.step_frame = 1;
                    return out;
                }
                self.times.push(now_ms);
                let f = self.step_frame - 1;
                let more = if frames != 0 && f >= frames { false } else { self.drive(&step.name, f, max_scroll, &mut out) };
                if !more {
                    say(&format!("end {} {f}", step.name));
                    let gaps: Vec<String> = self.times.windows(2).map(|w| format!("{:.3}", w[1] - w[0])).collect();
                    say(&format!("frames {} {}", step.name, gaps.join(",")));
                    self.next(now_ms);
                } else {
                    self.step_frame += 1;
                }
            }
        }
        out
    }

    fn drive(&mut self, name: &str, f: u32, max_scroll: f32, out: &mut Frame) -> bool {
        let m = &mut self.model;
        match name {
            "scroll" => {
                self.top += 24.0;
                out.scroll_to = Some(self.top);
            }
            "sweep" => {
                if self.swept { return false; }
                self.top += 720.0;
                if self.top >= max_scroll {
                    self.top = 0.0;
                    self.swept = true;
                }
                out.scroll_to = Some(self.top);
            }
            "update" => {
                for k in 0..32u32 {
                    let i = ((f * 32 + k) * 37) % CELLS as u32;
                    m.cells[i as usize] = (f * 31 + k * 7 + i) % 10000;
                }
                out.changed = true;
            }
            "pan" => {
                out.scroll_to = Some(if f < 300 { (f + 1) as f32 } else { (599 - f) as f32 });
            }
            "stream" => {
                if self.written % 240 == 0 {
                    let mut a = self.authors[self.made % self.authors.len()].clone();
                    a.id = 100000 + self.made;
                    a.blocks.clear();
                    m.items.push(a);
                    m.versions.push(0);
                    self.made += 1;
                }
                let last = m.items.len() - 1;
                if self.written % 60 == 0 {
                    self.paragraph.clear();
                    m.items[last].blocks.push(Block::P(Vec::new()));
                }
                for _ in 0..3 {
                    if !self.paragraph.is_empty() { self.paragraph.push(' '); }
                    self.paragraph.push_str(&self.words[self.next_word % self.words.len()]);
                    self.next_word += 1;
                }
                self.written += 3;
                let blocks = &mut m.items[last].blocks;
                let end = blocks.len() - 1;
                blocks[end] = Block::P(corpus::spans(&self.paragraph));
                m.versions[last] += 1;
                out.changed = true;
                out.scroll_to = Some(END);
            }
            _ if name.starts_with("grow-") => {
                let cycle: usize = name[5..].parse().unwrap_or(1) - 1;
                let have = m.items.len();
                let want = ((f as usize + 1) * 25).min(m.size);
                m.items.extend(corpus::parse(CORPUS, cycle * 1000 + have, want - have));
                m.versions.resize(m.items.len(), 0);
                out.changed = true;
            }
            _ if name.starts_with("clear-") => {
                m.items.clear();
                m.versions.clear();
                out.changed = true;
            }
            _ => {}
        }
        true
    }
}

/// The scene named on the command line (first argument), feed by default.
pub fn scene_arg() -> String {
    std::env::args().nth(1).filter(|a| !a.starts_with('-')).unwrap_or_else(|| "feed".into())
}

/// XB_SUITE: "cpu" (windowless) or "gpu" (a window).
pub fn windowless() -> bool {
    std::env::var("XB_SUITE").map(|s| s == "cpu").unwrap_or(false)
}

pub fn uncapped() -> bool { std::env::var_os("XB_UNCAPPED").is_some() }

/// The hex colours of bench.css, as 0xRRGGBB.
pub mod colors {
    pub const BG: u32 = 0x0f1115;
    pub const TEXT: u32 = 0xe6e8ee;
    pub const BAR_TEXT: u32 = 0xa9b0c2;
    pub const LINE: u32 = 0x262b36;
    pub const ITEM: u32 = 0x171a21;
    pub const AVATARS: [u32; 8] = [0x7aa2ff, 0xff9e64, 0x9ece6a, 0xbb9af7, 0xf7768e, 0xe0af68, 0x7dcfff, 0x73daca];
    pub const MUTED: u32 = 0x8b93a7;
    pub const TAG_BG: u32 = 0x232836;
    pub const TAG: u32 = 0xa9b4ff;
    pub const LINK: u32 = 0x7aa2ff;
    pub const PRE_BG: u32 = 0x0b0d11;
    pub const PRE: u32 = 0xc0caf5;
    pub const TH: u32 = 0x1d212b;
    pub const QUOTE_LINE: u32 = 0x3b4252;
    pub const QUOTE: u32 = 0xc0c6d4;
    pub const ACT_BG: u32 = 0x1d212b;
    pub const CELLS: [u32; 8] = [0x1b2333, 0x1f2a3d, 0x243247, 0x2a3a52, 0x33304a, 0x3d2f45, 0x462e3c, 0x4f2d33];
    pub const NOTES: u32 = 0xc0c6d4;
}
