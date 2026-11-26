//! style/bench.css, translated to Rune's builders (LOG.md lists what differs).

use rune::{Color, Cx, El, Family, Image, ScrollSpec, Span as RSpan, TextStyle, col, el, memo, rich, row, spacer, text};
use xbench_scenes::{Block, Item, Kind, Mark, Span, colors as c};

use crate::State;

pub fn rgb(hex: u32) -> Color {
    rune::color::hex(&format!("#{hex:06x}")).expect("a colour")
}

const fn sans(size: f32, weight: f32, line: f32) -> TextStyle { TextStyle::new(size, weight).lh(line) }
const fn mono(size: f32, line: f32) -> TextStyle { TextStyle::new(size, 400.0).family(Family::Mono).lh(line) }

/// Inline text and its marks, as one text with styled byte ranges.
fn inline(spans: &[Span], style: TextStyle, color: Color, italic: bool) -> El {
    let mut content = String::new();
    let mut ranges = Vec::new();
    for s in spans {
        let start = content.len();
        content.push_str(&s.text);
        let end = content.len();
        let range = match s.mark {
            Mark::None => None,
            Mark::Bold => Some(RSpan::new(start, end).weight(700.0)),
            Mark::Italic => Some(RSpan::new(start, end).italic()),
            Mark::Code => Some(RSpan::new(start, end).mono().size(12.5).bg(rgb(c::TAG_BG), 4.0)),
            Mark::Link => Some(RSpan::new(start, end).color(rgb(c::LINK))),
        };
        match (range, italic) {
            (Some(r), true) => ranges.push(r.italic()),
            (Some(r), false) => ranges.push(r),
            (None, true) => ranges.push(RSpan::new(start, end).italic()),
            (None, false) => {}
        }
    }
    rich(content, ranges).font(style).color(color)
}

fn label(content: &str, style: TextStyle, color: Color) -> El {
    text(content).font(style).color(color)
}

fn block(b: &Block, pictures: &[Image]) -> El {
    let ink = rgb(c::TEXT);
    match b {
        Block::P(spans) => inline(spans, sans(14.0, 400.0, 21.0), ink, false),
        Block::Q(spans) => inline(spans, sans(14.0, 400.0, 21.0), rgb(c::QUOTE), true)
            .pl(12.0).border_sides([0.0, 0.0, 0.0, 3.0], rgb(c::QUOTE_LINE)).border_layout(),
        Block::H(content) => label(content, sans(17.0, 700.0, 24.0), ink).wrap(),
        Block::Ul(items) => col().gap(4.0).pl(4.0).children(items.iter().map(|spans| {
            row().gap(8.0)
                .child(el().size(6.0, 6.0).mt(8.0).radius(3.0).fill(rgb(c::MUTED)))
                .child(inline(spans, sans(14.0, 400.0, 20.0), ink, false).grow(1.0).min_w(0.0))
        })),
        Block::Pre(lines) => col().px(12.0).py(10.0).fill(rgb(c::PRE_BG)).border(1.0, rgb(c::LINE)).radius(6.0).border_layout()
            .children(lines.iter().map(|l| label(l, mono(12.5, 18.0), rgb(c::PRE)))),
        Block::Table { head, rows } => {
            // `grid-template-columns: 2fr 1fr 1fr [1fr]`: a wrapping row of cells at those
            // fractions of the width (Rune's grid has equal columns only).
            let n = head.len();
            let total = (n + 1) as f32;
            let cell = |content: &str, column: usize, header: bool| {
                let style = sans(13.0, if header { 700.0 } else { 400.0 }, 18.0);
                let e = label(content, style, ink).truncate().px(8.0).py(4.0)
                    .border_sides([0.0, 0.0, 1.0, 0.0], rgb(c::LINE)).border_layout()
                    .w_frac(if column == 0 { 2.0 / total } else { 1.0 / total } - 1e-6);
                if header { e.fill(rgb(c::TH)) } else { e }
            };
            let cells = head.iter().enumerate().map(|(i, h)| cell(h, i, true))
                .chain(rows.iter().flat_map(|r| r.iter().enumerate().map(|(i, v)| cell(v, i, false))).collect::<Vec<_>>());
            row().flex_wrap().border(1.0, rgb(c::LINE)).radius(6.0).border_layout().children(cells.collect::<Vec<_>>())
        }
        Block::Img { picture, width, height, caption } => col().gap(6.0).items_start()
            .child(el().size(*width, *height).radius(8.0).pixels(pictures[*picture % 4].pixels()))
            .child(label(caption, sans(12.0, 400.0, 16.0), rgb(c::MUTED)).wrap()),
    }
}

pub fn item(i: &Item, pictures: &[Image]) -> El {
    let muted = rgb(c::MUTED);
    let head = row().items_center().gap(10.0)
        .child(el().size(32.0, 32.0).radius(16.0).fill(rgb(c::AVATARS[i.color])).center()
            .child(label(&i.initials, sans(12.0, 700.0, 16.0), rgb(c::BG))))
        .child(col().child(label(&i.author, sans(14.0, 700.0, 20.0), rgb(c::TEXT))).child(label(&i.time, sans(12.0, 400.0, 16.0), muted)))
        .child(spacer())
        .child(row().gap(6.0).children(i.tags.iter().map(|t| {
            label(t, sans(11.0, 400.0, 14.0), rgb(c::TAG)).px(8.0).py(2.0).radius(9.0).fill(rgb(c::TAG_BG))
        })));
    let act = |s: String| label(&s, sans(12.0, 400.0, 16.0), muted).px(10.0).py(3.0).radius(6.0).fill(rgb(c::ACT_BG));
    let foot = row().gap(8.0).child(act(format!("Reply {}", i.replies))).child(act(format!("Like {}", i.likes))).child(act("Share".into()));
    col().gap(10.0).px(16.0).py(14.0).fill(rgb(c::ITEM)).border(1.0, rgb(c::LINE)).radius(10.0).border_layout()
        .child(head)
        .children(i.blocks.iter().map(|b| block(b, pictures)))
        .child(foot)
}

fn cell(index: usize, value: u32) -> El {
    col().h(34.0).px(4.0).py(2.0).radius(3.0).fill(rgb(c::CELLS[(value % 8) as usize]))
        .child(label(&format!("cell {index}"), sans(9.0, 400.0, 12.0), rgb(c::MUTED)).truncate())
        .child(label(&value.to_string(), sans(12.0, 700.0, 16.0), rgb(c::TEXT)))
}

static VIEWS: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

pub fn view(s: &State, cx: &mut Cx<State>) -> El {
    let n = VIEWS.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
    if s.scene.painted() || n > 8 { return build(s, cx); }
    let label = format!("view {n}: build elements");
    xbench_scenes::span("main", "js", &label, || build(s, cx))
}

fn build(s: &State, _: &mut Cx<State>) -> El {
    let m = &s.scene.model;
    let content = if m.kind == Kind::Wall {
        row().gap(8.0).padding(8.0)
            .child(col().w(680.0).equal_columns(16).gap(2.0)
                .children(m.cells.iter().enumerate().map(|(i, &v)| memo(format!("c{i}"), v, || cell(i, v)))))
            .child(col().gap(6.0).grow(1.0).min_w(0.0)
                .children(m.notes.iter().map(|spans| inline(spans, sans(10.0, 400.0, 13.0), rgb(c::NOTES), false))))
    } else {
        col().key("content").gap(12.0).px(24.0).py(16.0)
            .on_layout_tx(|s: &mut State, r: [f32; 4], tx| { s.content_h = r[3]; tx.live_only(); })
            .children(m.items.iter().zip(&m.versions).map(|(i, &v)| memo(format!("i{}", i.id), v, || item(i, &s.pictures))))
    };
    col().w_full().h_full().fill(rgb(c::BG))
        .child(row().h(40.0).items_center().pl(84.0).pr(16.0)
            .border_sides([0.0, 0.0, 1.0, 0.0], rgb(c::LINE)).border_layout()
            .child(label(&m.title, sans(13.0, 700.0, 20.0), rgb(c::BAR_TEXT))))
        .child(col().key("scroller").grow(1.0).min_h(0.0).scroll(ScrollSpec { stick_bottom: false })
            .on_layout_tx(|s: &mut State, r: [f32; 4], tx| { s.view_h = r[3]; tx.live_only(); })
            .child(content))
}
