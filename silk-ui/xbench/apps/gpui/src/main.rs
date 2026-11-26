//! The xbench scenes (SCENES.md) in GPUI, Zed's UI framework.
//!
//!   xbench-gpui <scene>          feed, wall, stream, churn (feed-3000 ...)
//!
//! XB_SUITE=cpu: no window and no GPU. GPUI's `HeadlessAppContext` runs a real `App` and
//! `Window` (element tree, styles, Taffy layout, prepaint, paint into a scene) on its test
//! platform, with the platform's real text system (CoreText on macOS, cosmic-text on Linux).
//! Frames run back to back on a clock that moves 1/120 s a frame, as Silk UI's windowless bench
//! does. Otherwise a window on the platform, frames at the display's pace.
//!
//! GPUI is immediate mode: every frame builds the whole element tree and lays it out again. It
//! has no memo for a subtree of one view, so nothing here is memoized (LOG.md).

use std::borrow::Cow;
use std::ops::Range;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::{
    AnyElement, App, AppContext as _, Bounds, Context, FontStyle, FontWeight, HeadlessAppContext, Hsla, Image, ImageFormat,
    IntoElement, ParentElement, Pixels, Render, ScrollHandle, SharedString, StyledText, TextRun, Window, WindowBounds,
    WindowOptions, div, font, img, point, prelude::*, px, relative, rgb, size,
};
use xbench_scenes::{span, span_begin, span_end, Block, END, HEIGHT, INTER_BOLD, INTER_ITALIC, INTER_REGULAR, Item, Kind, MONO, Mark, PICTURES, Scene, Span, WIDTH, colors as c};

const SANS: &str = "Inter";
const MONO_FAMILY: &str = "JetBrains Mono";

fn color(hex: u32) -> Hsla { rgb(hex).into() }

struct Bench {
    scene: Scene,
    scroll: ScrollHandle,
    pictures: Vec<Arc<Image>>,
    windowless: bool,
    start: Instant,
    frames: u32,
    timer: Option<gpui::Task<()>>,
    renders: u32,
}

/// Inline text with its marks, as one text with runs.
fn inline(spans: &[Span], color_hex: u32, italic: bool) -> StyledText {
    let mut content = String::new();
    let mut runs = Vec::new();
    for s in spans {
        if s.text.is_empty() { continue; }
        content.push_str(&s.text);
        let mut f = font(if s.mark == Mark::Code { MONO_FAMILY } else { SANS });
        if s.mark == Mark::Bold { f.weight = FontWeight::BOLD; }
        if s.mark == Mark::Italic || italic { f.style = FontStyle::Italic; }
        runs.push(TextRun {
            len: s.text.len(),
            font: f,
            color: color(if s.mark == Mark::Link { c::LINK } else { color_hex }),
            background_color: (s.mark == Mark::Code).then(|| color(c::TAG_BG)),
            underline: None,
            strikethrough: None,
        });
    }
    StyledText::new(content).with_runs(runs)
}

fn label(text: impl Into<SharedString>) -> gpui::Div { div().child(text.into()) }

fn block(b: &Block, pictures: &[Arc<Image>]) -> AnyElement {
    match b {
        Block::P(spans) => div().line_height(px(21.)).child(inline(spans, c::TEXT, false)).into_any_element(),
        Block::Q(spans) => div().pl(px(12.)).border_l(px(3.)).border_color(color(c::QUOTE_LINE)).line_height(px(21.))
            .child(inline(spans, c::QUOTE, true)).into_any_element(),
        Block::H(text) => label(text.clone()).text_size(px(17.)).line_height(px(24.)).font_weight(FontWeight::BOLD).into_any_element(),
        Block::Ul(items) => div().flex().flex_col().gap(px(4.)).pl(px(4.)).children(items.iter().map(|spans| {
            div().flex().flex_row().gap(px(8.))
                .child(div().flex_shrink_0().size(px(6.)).mt(px(8.)).rounded(px(3.)).bg(color(c::MUTED)))
                .child(div().flex_grow(1.).flex_basis(px(0.)).min_w_0().child(inline(spans, c::TEXT, false)))
        })).into_any_element(),
        Block::Pre(lines) => div().flex().flex_col().px(px(12.)).py(px(10.)).bg(color(c::PRE_BG)).border_1().border_color(color(c::LINE))
            .rounded(px(6.)).font_family(MONO_FAMILY).text_size(px(12.5)).line_height(px(18.)).text_color(color(c::PRE))
            .children(lines.iter().map(|l| label(l.clone()).whitespace_nowrap())).into_any_element(),
        Block::Table { head, rows } => {
            // `grid-template-columns: 2fr 1fr ...`: GPUI's grid has equal columns only, so each
            // row is a flex row of cells at those fractions of the width.
            let total = (head.len() + 1) as f32;
            let row = |cells: &Vec<String>, header: bool| {
                div().flex().flex_row().children(cells.iter().enumerate().map(|(i, v)| {
                    let cell = label(v.clone()).w(relative(if i == 0 { 2.0 } else { 1.0 } / total)).px(px(8.)).py(px(4.))
                        .border_b_1().border_color(color(c::LINE)).overflow_hidden();
                    if header { cell.bg(color(c::TH)).font_weight(FontWeight::BOLD) } else { cell }
                }))
            };
            div().flex().flex_col().border_1().border_color(color(c::LINE)).rounded(px(6.)).text_size(px(13.)).line_height(px(18.))
                .child(row(head, true)).children(rows.iter().map(|r| row(r, false))).into_any_element()
        }
        Block::Img { picture, width, height, caption } => div().flex().flex_col().gap(px(6.)).items_start()
            .child(img(pictures[*picture % 4].clone()).w(px(*width)).h(px(*height)).rounded(px(8.)))
            .child(label(caption.clone()).text_size(px(12.)).line_height(px(16.)).text_color(color(c::MUTED)))
            .into_any_element(),
    }
}

fn item(i: &Item, pictures: &[Arc<Image>]) -> AnyElement {
    let act = |s: String| label(s).px(px(10.)).py(px(3.)).rounded(px(6.)).bg(color(c::ACT_BG)).text_color(color(c::MUTED))
        .text_size(px(12.)).line_height(px(16.));
    div().flex().flex_col().gap(px(10.)).px(px(16.)).py(px(14.)).bg(color(c::ITEM)).border_1().border_color(color(c::LINE)).rounded(px(10.))
        .child(div().flex().flex_row().items_center().gap(px(10.))
            .child(div().flex().items_center().justify_center().size(px(32.)).flex_shrink_0().rounded(px(16.)).bg(color(c::AVATARS[i.color]))
                .text_size(px(12.)).font_weight(FontWeight::BOLD).text_color(color(c::BG)).child(i.initials.clone()))
            .child(div().flex().flex_col()
                .child(label(i.author.clone()).font_weight(FontWeight::BOLD))
                .child(label(i.time.clone()).text_size(px(12.)).line_height(px(16.)).text_color(color(c::MUTED))))
            .child(div().flex().flex_row().gap(px(6.)).ml_auto().children(i.tags.iter().map(|t| {
                label(t.clone()).px(px(8.)).py(px(2.)).rounded(px(9.)).bg(color(c::TAG_BG)).text_color(color(c::TAG))
                    .text_size(px(11.)).line_height(px(14.))
            }))))
        .children(i.blocks.iter().map(|b| block(b, pictures)))
        .child(div().flex().flex_row().gap(px(8.))
            .child(act(format!("Reply {}", i.replies))).child(act(format!("Like {}", i.likes))).child(act("Share".into())))
        .into_any_element()
}

impl Render for Bench {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.renders += 1;
        // The first frames as start-up phases (XB_TRACE): build the elements here, then GPUI lays
        // them out, prepaints and paints. A canvas as the last child marks the ends of those.
        let traced = !self.scene.painted() && self.renders <= 8;
        let n = self.renders;
        if traced { span_begin("main", "js", &format!("frame {n}: build elements")); }
        if !self.windowless {
            self.frames += 1;
            // The second frame: the first one is on screen.
            if self.frames == 3 { self.scene.first_paint(self.start.elapsed().as_secs_f64() * 1000.0); }
            let now = self.start.elapsed().as_secs_f64() * 1000.0;
            self.step(now);
            if self.scene.done() {
                cx.quit();
            } else if self.scene.wants_frames() {
                window.request_animation_frame();
            } else if let Some(due) = self.scene.deadline() {
                let wait = Duration::from_secs_f64(((due - now) / 1000.0).max(0.0));
                self.timer = Some(cx.spawn(async move |this, cx| {
                    cx.background_executor().timer(wait).await;
                    let _ = this.update(cx, |_, cx| cx.notify());
                }));
            }
        }
        let m = &self.scene.model;
        let content = if m.kind == Kind::Wall {
            div().flex().flex_row().gap(px(8.)).p(px(8.))
                .child(div().grid().grid_cols(16).gap(px(2.)).w(px(680.)).flex_shrink_0().children(m.cells.iter().enumerate().map(|(i, &v)| {
                    div().flex().flex_col().h(px(34.)).px(px(4.)).py(px(2.)).rounded(px(3.)).bg(color(c::CELLS[(v % 8) as usize]))
                        .child(label(format!("cell {i}")).text_size(px(9.)).line_height(px(12.)).text_color(color(c::MUTED)).whitespace_nowrap().overflow_hidden())
                        .child(label(v.to_string()).text_size(px(12.)).line_height(px(16.)).font_weight(FontWeight::BOLD))
                })))
                .child(div().flex().flex_col().gap(px(6.)).flex_grow(1.).flex_basis(px(0.)).min_w_0().text_size(px(10.)).line_height(px(13.))
                    .children(m.notes.iter().map(|spans| div().child(inline(spans, c::NOTES, false)))))
                .into_any_element()
        } else {
            div().flex().flex_col().gap(px(12.)).px(px(24.)).py(px(16.))
                .children(m.items.iter().map(|i| item(i, &self.pictures)))
                .into_any_element()
        };
        let root = div().flex().flex_col().size_full().bg(color(c::BG)).text_color(color(c::TEXT)).font_family(SANS).text_size(px(14.)).line_height(px(20.))
            .child(div().flex().flex_row().items_center().h(px(40.)).flex_shrink_0().pl(px(84.)).pr(px(16.)).border_b_1().border_color(color(c::LINE))
                .text_size(px(13.)).font_weight(FontWeight::BOLD).text_color(color(c::BAR_TEXT)).child(m.title.clone()))
            .child(div().id("scroller").flex_grow(1.).min_h_0().overflow_y_scroll().overflow_x_hidden().track_scroll(&self.scroll).child(content));
        if !traced { return root; }
        span_end("main", "js", &format!("frame {n}: build elements"));
        span_begin("main", "layout", &format!("frame {n}: layout, prepaint"));
        root.child(gpui::canvas(
            move |_, _, _| {
                span_end("main", "layout", &format!("frame {n}: layout, prepaint"));
                span_begin("main", "paint", &format!("frame {n}: paint"));
            },
            move |_, _, _, _| span_end("main", "paint", &format!("frame {n}: paint")),
        ).absolute().size_0())
    }
}

impl Bench {
    fn new(windowless: bool) -> Bench {
        let scene = span("main", "start", "parse corpus, set up scene", || Scene::new(&xbench_scenes::scene_arg()));
        let pictures = PICTURES.iter().map(|b| Arc::new(Image::from_bytes(ImageFormat::Png, b.to_vec()))).collect();
        Bench {
            scene, scroll: ScrollHandle::new(), pictures, windowless,
            start: Instant::now(), frames: 0, timer: None, renders: 0,
        }
    }

    fn max_scroll(&self) -> f32 { f32::from(self.scroll.max_offset().y).max(0.0) }

    /// One frame of the script; scrolls the scroller where it asks.
    fn step(&mut self, now_ms: f64) -> bool {
        let max = self.max_scroll();
        let frame = self.scene.frame(now_ms, max, self.windowless);
        let changed = frame.changed || frame.scroll_to.is_some();
        let pin = self.scene.pinned() && !self.scene.painted();
        if let Some(y) = frame.scroll_to.or(pin.then_some(END)) {
            let y = if y >= END { self.max_scroll() } else { y.min(self.max_scroll()) };
            self.scroll.set_offset(point(px(0.), px(-y)));
        }
        changed
    }
}

fn add_fonts(cx: &mut App) {
    cx.text_system()
        .add_fonts(vec![Cow::Borrowed(INTER_REGULAR), Cow::Borrowed(INTER_BOLD), Cow::Borrowed(INTER_ITALIC), Cow::Borrowed(MONO)])
        .expect("fonts");
}

fn windowless() {
    let text_system = span("main", "start", "platform text system", || gpui_platform::current_platform(true).text_system());
    let mut cx = span("main", "start", "app context", || HeadlessAppContext::with_platform(text_system, Arc::new(()), || Ok(None)));
    span("main", "fonts", "load fonts", || cx.update(add_fonts));
    let handle = span("main", "start", "open window", || {
        cx.open_window(size(px(WIDTH), px(HEIGHT)), |_, cx| cx.new(|_| Bench::new(true))).expect("open_window")
    });
    const DT: f64 = 1000.0 / 120.0;
    let mut frame: u64 = 1;
    loop {
        let now = frame as f64 * DT;
        let done = handle
            .update(&mut cx, |bench, _, cx| {
                // A frame is drawn at the end of an update that notifies. Like the retained apps,
                // draw only when something changed or the scene asks for frames (not in idles).
                if bench.step(now) || bench.scene.wants_frames() || frame <= 3 {
                    cx.notify();
                }
                bench.scene.done()
            })
            .expect("update");
        cx.run_until_parked();
        if done { break; }
        frame += 1;
    }
    std::process::exit(0);
}

fn main() {
    if xbench_scenes::windowless() {
        windowless();
        return;
    }
    let app = span("main", "start", "platform, application", gpui_platform::application);
    app.run(|cx: &mut App| {
        span("main", "fonts", "load fonts", || add_fonts(cx));
        let bounds = Bounds::centered(None, size(px(WIDTH), px(HEIGHT)), cx);
        cx.open_window(
            WindowOptions { window_bounds: Some(WindowBounds::Windowed(bounds)), is_resizable: false, ..Default::default() },
            |_, cx| cx.new(|_| Bench::new(false)),
        )
        .expect("open_window");
        cx.activate(true);
    });
}

#[allow(dead_code)]
fn unused(_: Range<usize>, _: Pixels) {}
