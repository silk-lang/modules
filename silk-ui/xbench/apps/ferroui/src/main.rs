//! The xbench scenes (SCENES.md) in FerroUI, a Rust port of Avalonia, on its declarative layer
//! (`ferroui-view`): a root component that runs again when the scene changes, and one keyed,
//! memoized component per item (React's `memo(ItemView)`) and per wall cell (`memo(Cell)`). The
//! reconciler patches what changed into the controls.
//!
//!   xbench-ferroui <scene>          feed, wall, stream, churn (feed-3000 ...)
//!
//! XB_SUITE=cpu: FerroUI's headless platform (no window, no display), drawing with Skia into an
//! offscreen raster framebuffer (FerroUI's headless drawing stub measures text with a stub font,
//! so the real font manager and renderer are used). Frames back to back on a clock that moves
//! 1/120 s a frame. Otherwise a window on the platform, frames at the display's pace.

use std::cell::RefCell;
use std::rc::Rc;

use ferroui_base::layout::{HorizontalAlignment, Orientation, VerticalAlignment};
use ferroui_base::media::fonts::EmbeddedFontCollection;
use ferroui_base::media::imaging::Bitmap;
use ferroui_base::media::{Brush, FontFamily, IBrush, IImage, FontStyle, FontWeight, TextWrapping};
use ferroui_base::platform::register_assets;
use ferroui_base::threading::Dispatcher;
use ferroui_base::utilities::UriRef;
use ferroui_base::{Ref, Vector};
use ferroui_controls::documents::Run;
use ferroui_desktop::AppBuilderDesktopExtensions;
use ferroui_controls::{AppBuilder, Application, ScrollViewer, TextBlock, Window};
use ferroui_headless::{FerroHeadlessPlatform, FerroHeadlessPlatformExtensions, FerroHeadlessPlatformOptions};
use ferroui_skia::SkiaApplicationExtensions;
use ferroui_themes_fluent::FluentTheme;
use ferroui_view::prelude::*;
use xbench_scenes::{span, Block, END, HEIGHT, INTER_BOLD, INTER_ITALIC, INTER_REGULAR, Item, Kind, MONO, Mark, PICTURES, Scene, Span, WIDTH, colors as c};

const SANS: &str = "fonts:XBench#Inter";
const MONO_FAMILY: &str = "fonts:XBench#JetBrains Mono";

thread_local! {
    static SCENE: RefCell<Option<Scene>> = const { RefCell::new(None) };
    static PICTURE_BITMAPS: RefCell<Vec<Rc<dyn IImage>>> = const { RefCell::new(Vec::new()) };
}

thread_local! {
    static BRUSHES: RefCell<std::collections::HashMap<u32, Rc<dyn IBrush>>> = RefCell::new(std::collections::HashMap::new());
}

/// One shared brush per colour (an application's brush resources), as a setter's value.
fn brush(v: u32) -> Rc<dyn IBrush> {
    BRUSHES.with(|b| b.borrow_mut().entry(v).or_insert_with(|| Brush::parse(&format!("#{v:06x}")).expect("a colour")).clone())
}

fn hex(v: u32) -> Option<Rc<dyn IBrush>> { Some(brush(v)) }

fn family(name: &str) -> FontFamily { FontFamily::parse(name).expect("family") }

fn with_scene<R>(f: impl FnOnce(&Scene) -> R) -> R { SCENE.with(|s| f(s.borrow().as_ref().expect("scene"))) }

/// A text block with its inline marks as runs.
fn inline(spans: &[Span], size: f64, line: f64, color: u32, italic: bool) -> Element {
    let spans: Vec<Span> = spans.to_vec();
    text_block()
        .text_wrapping(TextWrapping::Wrap)
        .font_size(size)
        .line_height(line)
        .foreground(hex(color))
        .font_style(if italic { FontStyle::Italic } else { FontStyle::Normal })
        .with(move |tb: &Ref<TextBlock>| {
            let inlines = ferroui_controls::documents::InlineCollection::new();
            for s in &spans {
                let run = Run::with_text(Some(&s.text));
                match s.mark {
                    Mark::None => {}
                    Mark::Bold => run.set_font_weight(FontWeight::Bold),
                    Mark::Italic => run.set_font_style(FontStyle::Italic),
                    Mark::Code => {
                        run.set_font_family(FontFamily::parse(MONO_FAMILY).expect("family"));
                        run.set_font_size(12.5);
                        run.set_background(Some(brush(c::TAG_BG)));
                    }
                    Mark::Link => run.set_foreground(Some(brush(c::LINK))),
                }
                inlines.add(run);
            }
            tb.set_inlines(Some(inlines));
        })
        .into()
}

fn label(text: &str, size: f64, line: f64, weight: FontWeight, color: u32) -> Element {
    text_block().text(text.to_string()).font_size(size).line_height(line).font_weight(weight).foreground(hex(color)).into()
}

fn block(b: &Block) -> Element {
    match b {
        Block::P(spans) => inline(spans, 14.0, 21.0, c::TEXT, false),
        Block::Q(spans) => border().border_brush(hex(c::QUOTE_LINE)).border_thickness((3.0, 0.0, 0.0, 0.0)).padding((12.0, 0.0, 0.0, 0.0))
            .child(inline(spans, 14.0, 21.0, c::QUOTE, true)).into(),
        Block::H(text) => text_block().text(text.clone()).font_size(17.0).line_height(24.0).font_weight(FontWeight::Bold)
            .text_wrapping(TextWrapping::Wrap).foreground(hex(c::TEXT)).into(),
        Block::Ul(items) => stack_panel().spacing(4.0).margin((4.0, 0.0, 0.0, 0.0)).children(items.iter().map(|spans| -> Element {
            grid().column_definitions("Auto,*")
                .child(border().width(6.0).height(6.0).corner_radius(3.0).background(hex(c::MUTED)).margin((0.0, 8.0, 8.0, 0.0))
                    .vertical_alignment(VerticalAlignment::Top))
                .child(border().grid_column(1).child(inline(spans, 14.0, 20.0, c::TEXT, false)))
                .into()
        }).collect::<Vec<_>>()).into(),
        Block::Pre(lines) => border().background(hex(c::PRE_BG)).border_brush(hex(c::LINE)).border_thickness(1.0).corner_radius(6.0)
            .padding((12.0, 10.0))
            .child(stack_panel().children(lines.iter().map(|l| -> Element {
                text_block().text(l.clone()).font_family(family(MONO_FAMILY)).font_size(12.5).line_height(18.0).foreground(hex(c::PRE)).into()
            }).collect::<Vec<_>>()))
            .into(),
        Block::Table { head, rows } => {
            let columns = if head.len() == 3 { "2*,*,*" } else { "2*,*,*,*" };
            let rows_def = vec!["Auto"; rows.len() + 1].join(",");
            let mut cells: Vec<Element> = Vec::new();
            for (r, row) in std::iter::once(head).chain(rows.iter()).enumerate() {
                for (i, v) in row.iter().enumerate() {
                    let header = r == 0;
                    let mut cell = border().grid_row(r as i32).grid_column(i as i32).padding((8.0, 4.0))
                        .border_brush(hex(c::LINE)).border_thickness((0.0, 0.0, 0.0, 1.0));
                    if header { cell = cell.background(hex(c::TH)); }
                    cells.push(cell.child(text_block().text(v.clone()).font_size(13.0).line_height(18.0)
                        .font_weight(if header { FontWeight::Bold } else { FontWeight::Normal }).foreground(hex(c::TEXT))).into());
                }
            }
            border().border_brush(hex(c::LINE)).border_thickness(1.0).corner_radius(6.0)
                .child(grid().column_definitions(columns).row_definitions(rows_def.as_str()).children(cells)).into()
        }
        Block::Img { picture, width, height, caption } => {
            let bitmap = PICTURE_BITMAPS.with(|p| p.borrow()[*picture % 4].clone());
            stack_panel().spacing(6.0).horizontal_alignment(HorizontalAlignment::Left)
                .child(border().width(*width as f64).height(*height as f64).corner_radius(8.0).clip_to_bounds(true)
                    .child(image().source(Some(bitmap)).width(*width as f64).height(*height as f64)))
                .child(text_block().text(caption.clone()).font_size(12.0).line_height(16.0).text_wrapping(TextWrapping::Wrap).foreground(hex(c::MUTED)))
                .into()
        }
    }
}

fn item_body(i: &Item) -> Element {
    let act = |s: String| -> Element {
        border().background(hex(c::ACT_BG)).corner_radius(6.0).padding((10.0, 3.0))
            .child(label(&s, 12.0, 16.0, FontWeight::Normal, c::MUTED)).into()
    };
    let head = grid().column_definitions("Auto,*,Auto")
        .child(border().width(32.0).height(32.0).corner_radius(16.0).background(hex(c::AVATARS[i.color])).vertical_alignment(VerticalAlignment::Center)
            .child(text_block().text(i.initials.clone()).font_size(12.0).font_weight(FontWeight::Bold).foreground(hex(c::BG))
                .horizontal_alignment(HorizontalAlignment::Center).vertical_alignment(VerticalAlignment::Center)))
        .child(stack_panel().grid_column(1).margin((10.0, 0.0, 10.0, 0.0)).vertical_alignment(VerticalAlignment::Center)
            .child(label(&i.author, 14.0, 20.0, FontWeight::Bold, c::TEXT))
            .child(label(&i.time, 12.0, 16.0, FontWeight::Normal, c::MUTED)))
        .child(stack_panel().grid_column(2).orientation(Orientation::Horizontal).spacing(6.0).vertical_alignment(VerticalAlignment::Center)
            .children(i.tags.iter().map(|t| -> Element {
                border().background(hex(c::TAG_BG)).corner_radius(9.0).padding((8.0, 2.0))
                    .child(label(t, 11.0, 14.0, FontWeight::Normal, c::TAG)).into()
            }).collect::<Vec<_>>()));
    let foot = stack_panel().orientation(Orientation::Horizontal).spacing(8.0)
        .child(act(format!("Reply {}", i.replies))).child(act(format!("Like {}", i.likes))).child(act("Share".into()));
    border().background(hex(c::ITEM)).border_brush(hex(c::LINE)).border_thickness(1.0).corner_radius(10.0).padding((16.0, 14.0))
        .child(stack_panel().spacing(10.0)
            .child(head)
            .children(i.blocks.iter().map(block).collect::<Vec<_>>())
            .child(foot))
        .into()
}

/// One item of the feed: runs again only when its id or version changes.
#[component(rerender)]
fn ItemView(at: usize, id: usize, version: u64) -> Element {
    let _ = (id, version);
    let item = with_scene(|s| s.model.items[at].clone());
    item_body(&item)
}

/// One cell of the wall: runs again only when its value changes.
#[component(rerender)]
fn Cell(index: usize, value: u32) -> Element {
    border().height(34.0).margin(1.0).padding((4.0, 2.0)).corner_radius(3.0).background(hex(c::CELLS[(value % 8) as usize]))
        .child(stack_panel()
            .child(text_block().text(format!("cell {index}")).font_size(9.0).line_height(12.0).foreground(hex(c::MUTED)))
            .child(label(&value.to_string(), 12.0, 16.0, FontWeight::Bold, c::TEXT)))
        .into()
}

/// The page: a bar and the scroller with the scene's content. Runs again on every tick.
#[component(rerender)]
fn Page(tick: Signal<u64>, scroller: NodeRef<ScrollViewer>) -> Element {
    let _ = tick.get();
    let (kind, title, count) = with_scene(|s| (s.model.kind, s.model.title.clone(), s.model.items.len()));
    let content: Element = if kind == Kind::Wall {
        let (cells, notes) = with_scene(|s| (s.model.cells.clone(), s.model.notes.clone()));
        grid().column_definitions("680,*").margin(8.0)
            .child(uniform_grid().columns(16).children(cells.iter().enumerate().map(|(i, &v)| -> Element {
                cell().key(i).index(i).value(v).into_element()
            }).collect::<Vec<_>>()))
            .child(stack_panel().grid_column(1).spacing(6.0).margin((8.0, 0.0, 0.0, 0.0))
                .children(notes.iter().map(|n| inline(n, 10.0, 13.0, c::NOTES, false)).collect::<Vec<_>>()))
            .into()
    } else {
        let keys: Vec<(usize, u64)> = with_scene(|s| s.model.items.iter().zip(&s.model.versions).map(|(i, &v)| (i.id, v)).collect());
        stack_panel().spacing(12.0).margin((24.0, 16.0))
            .children((0..count).map(|at| -> Element {
                let (id, version) = keys[at];
                item_view().key(id).at(at).id(id).version(version).into_element()
            }).collect::<Vec<_>>())
            .into()
    };
    grid().row_definitions("40,*").background(hex(c::BG))
        .child(border().border_brush(hex(c::LINE)).border_thickness((0.0, 0.0, 0.0, 1.0)).padding((84.0, 0.0, 16.0, 0.0))
            .child(text_block().text(title).font_size(13.0).font_weight(FontWeight::Bold).foreground(hex(c::BAR_TEXT))
                .vertical_alignment(VerticalAlignment::Center)))
        .child(scroll_viewer().grid_row(1).node_ref(scroller).horizontal_scroll_bar_visibility(ferroui_controls::primitives::ScrollBarVisibility::Disabled)
            .child(content))
        .into()
}


fn fonts_and_pictures(builder: AppBuilder) -> AppBuilder {
    register_assets("XBench", &[
        ("/Assets/Inter-Regular.ttf", INTER_REGULAR),
        ("/Assets/Inter-Bold.ttf", INTER_BOLD),
        ("/Assets/Inter-Italic.ttf", INTER_ITALIC),
        ("/Assets/JetBrainsMono-Regular.ttf", MONO),
    ]);
    builder.configure_fonts(|fm| {
        fm.add_font_collection(Rc::new(EmbeddedFontCollection::new(
            UriRef::parse_absolute("fonts:XBench").expect("key"),
            UriRef::parse_absolute("ferres://XBench/Assets").expect("source"),
        )));
    })
}

fn load_pictures() {
    PICTURE_BITMAPS.with(|p| {
        *p.borrow_mut() = PICTURES.iter().map(|bytes| Rc::new(Bitmap::from_stream(&mut &bytes[..]).expect("png")) as Rc<dyn IImage>).collect();
    });
}

struct Driver {
    tick: Signal<u64>,
    scroller: NodeRef<ScrollViewer>,
    n: u64,
}

impl Driver {
    fn max_scroll(&self) -> f32 {
        self.scroller.get().map(|s| (s.extent().height - s.viewport().height).max(0.0) as f32).unwrap_or(0.0)
    }

    /// One frame of the script at `now_ms`.
    fn step(&mut self, now_ms: f64, windowless: bool) {
        let max = self.max_scroll();
        if std::env::var_os("XB_DEBUG").is_some() { eprintln!("max_scroll {max}"); }
        let frame = SCENE.with(|s| s.borrow_mut().as_mut().unwrap().frame(now_ms, max, windowless));
        if frame.changed {
            self.n += 1;
            self.tick.set(self.n);
        }
        let pin = with_scene(|s| s.pinned());
        if let Some(y) = frame.scroll_to.or(pin.then_some(END)) {
            if let Some(s) = self.scroller.get() {
                let max = self.max_scroll();
                let y = if y >= END { max } else { y.min(max) };
                s.set_offset(Vector::new(0.0, y as f64));
            }
        }
    }
}

fn root(tick: Signal<u64>, scroller: NodeRef<ScrollViewer>) -> Element {
    window().title("xbench").width(WIDTH as f64).height(HEIGHT as f64).can_resize(false)
        .font_family(family(SANS)).child(page().tick(tick).scroller(scroller))
        .into()
}

fn windowless() {
    span("main", "start", "platform, Skia, fonts setup", || {
        fonts_and_pictures(AppBuilder::configure::<Application>().use_skia().use_headless(FerroHeadlessPlatformOptions {
            use_headless_drawing: false,
            ..FerroHeadlessPlatformOptions::default()
        }))
        .setup_without_starting()
    });
    span("main", "style", "Fluent theme", || Application::current().expect("app").styles().add(FluentTheme::new().as_style()));
    span("main", "paint", "decode pictures", load_pictures);
    let tick = signal(0u64);
    let scroller = NodeRef::<ScrollViewer>::new();
    let window: Ref<Window> = span("main", "js", "build components", || mount_window(|| root(tick, scroller)));
    span("main", "layout", "show: style, measure, arrange", || {
        window.show();
        Dispatcher::ui_thread().run_jobs(None);
    });
    let mut driver = Driver { tick, scroller, n: 0 };
    let mut frame: u64 = 1;
    loop {
        let now = frame as f64 * 1000.0 / 120.0;
        let traced = frame <= 8 && !with_scene(|s| s.painted());
        let mut script = || {
            driver.step(now, true);
            Dispatcher::ui_thread().run_jobs(None);
        };
        if traced { span("main", "layout", &format!("frame {frame}: script, rerender, layout"), script) } else { script() }
        let render = || {
            FerroHeadlessPlatform::force_render_timer_tick(1);
            Dispatcher::ui_thread().run_jobs(None);
        };
        if traced { span("main", "paint", &format!("frame {frame}: render, Skia raster"), render) } else { render() }
        if with_scene(|s| s.done()) { break; }
        frame += 1;
    }
    std::process::exit(0);
}

fn windowed() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    xbench_scenes::span_begin("main", "start", "platform setup");
    fonts_and_pictures(AppBuilder::configure::<Application>().use_platform_detect()).start(
        |app, _| {
            xbench_scenes::span_end("main", "start", "platform setup");
            span("main", "style", "Fluent theme", || app.styles().add(FluentTheme::new().as_style()));
            span("main", "paint", "decode pictures", load_pictures);
            let tick = signal(0u64);
            let scroller = NodeRef::<ScrollViewer>::new();
            let window: Ref<Window> = span("main", "js", "build components", || mount_window(|| root(tick, scroller)));
            let driver = Rc::new(RefCell::new(Driver { tick, scroller, n: 0 }));
            let start = std::time::Instant::now();
            fn next(window: Ref<Window>, driver: Rc<RefCell<Driver>>, start: std::time::Instant, frames: u32) {
                let w = window.clone();
                window.request_animation_frame(move |_| {
                    let now = start.elapsed().as_secs_f64() * 1000.0;
                    if frames == 2 { SCENE.with(|s| s.borrow_mut().as_mut().unwrap().first_paint(now)); }
                    driver.borrow_mut().step(now, false);
                    let (done, wants, due) = with_scene(|s| (s.done(), s.wants_frames(), s.deadline()));
                    if done {
                        w.close();
                    } else if wants {
                        next(w, driver, start, frames + 1);
                    } else if let Some(due) = due {
                        let wait = std::time::Duration::from_secs_f64(((due - now) / 1000.0).max(0.0));
                        let (w2, d2) = (w.clone(), driver.clone());
                        let _ = ferroui_base::threading::DispatcherTimer::run_once(
                            move || next(w2.clone(), d2.clone(), start, frames + 1),
                            wait,
                            ferroui_base::threading::DispatcherPriority::NORMAL,
                        );
                    }
                });
            }
            next(window.clone(), driver, start, 0);
            app.run_window(window);
        },
        &args,
    );
}

fn main() {
    span("main", "start", "parse corpus, set up scene", || SCENE.with(|s| *s.borrow_mut() = Some(Scene::new(&xbench_scenes::scene_arg()))));
    if xbench_scenes::windowless() { windowless() } else { windowed() }
}
