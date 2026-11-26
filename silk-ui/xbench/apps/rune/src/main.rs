//! The xbench scenes (SCENES.md) as a Rune app.
//!
//!   xbench-rune <scene>          feed, wall, stream, churn (feed-3000 ...)
//!
//! XB_SUITE=cpu: no window and no GPU. A `rune::Runtime` is driven directly, as Rune's own tests
//! and tooling drive it: the view, the commit into retained nodes, Taffy layout, Parley shaping
//! and the paint pass that turns what is visible into GPU instances (glyph masks rasterized on
//! the CPU); frames back to back on a clock that moves 1/120 s a frame, as Silk UI's windowless
//! bench does. Otherwise a window (`rune::App`), frames at the display's pace.
//!
//! Protocol lines (PROTOCOL.md) go to standard output.

mod view;

use std::sync::Arc;
use std::time::Duration;

use rune::text::TextSystem;
use rune::{AppSpec, Env, Image, ImageCache, Runtime, Tx};
use xbench_scenes::{span, Phase, HEIGHT, INTER_BOLD, INTER_ITALIC, INTER_REGULAR, MONO, PICTURES, Scene, WIDTH};

pub struct State {
    pub scene: Scene,
    pub view_h: f32,
    pub content_h: f32,
    pub pictures: Vec<Image>,
    cache: Option<ImageCache>,
    polls: u32,
}

const FONTS: &[&[u8]] = &[INTER_REGULAR, INTER_BOLD, INTER_ITALIC, MONO];
const FAMILIES: (&str, &str) = ("Inter", "JetBrains Mono");

fn init() -> State {
    let _s = Phase::new("main", "start", "parse corpus, set up scene");
    State { scene: Scene::new(&xbench_scenes::scene_arg()), view_h: 0.0, content_h: 0.0, pictures: Vec::new(), cache: None, polls: 0 }
}

fn load_pictures(s: &mut State, waker: rune::Waker) {
    let _s = Phase::new("main", "paint", "decode pictures");
    let cache = s.cache.insert(ImageCache::new(waker));
    s.pictures = PICTURES.iter().map(|bytes| cache.load(&bytes[..])).collect();
}

impl State {
    fn max_scroll(&self) -> f32 { (self.content_h - self.view_h).max(0.0) }
}

/// One frame of the script, applied through `tx`. True when the model changed.
fn step(s: &mut State, now_ms: f64, windowless: bool, tx: &mut Tx) -> bool {
    let max = s.max_scroll();
    let frame = s.scene.frame(now_ms, max, windowless);
    if s.scene.pinned() && !s.scene.painted() {
        tx.scroll_to_bottom_instant("scroller");
    }
    if let Some(y) = frame.scroll_to {
        if y >= xbench_scenes::END { tx.scroll_to_bottom_instant("scroller") } else { tx.scroll_to_instant("scroller", 0.0, y) }
    }
    frame.changed
}

fn windowless() {
    let mut state = init();
    load_pictures(&mut state, Arc::new(|| {}));
    let text = span("main", "fonts", "load fonts", || TextSystem::new(FONTS, FAMILIES));
    let mut rt = span("main", "start", "runtime setup", || Runtime::with_text(state, view::view, (WIDTH, HEIGHT), Env::new(true, 2.0), text));
    const DT: f64 = 1.0 / 120.0;
    let mut frame: u64 = 0;
    let mut more = true;
    while !rt.state.scene.done() {
        let now = frame as f64 * DT * 1000.0;
        let changed = rt.update_if(|s, tx| step(s, now, true, tx));
        // As Rune's window host does: a frame only when state changed, the script asks for
        // frames, or motion is still running. Idle steps draw nothing.
        if frame < 3 || changed || more || rt.state.scene.wants_frames() {
            let label = format!("frame {}: commit, layout, paint", frame + 1);
            let _s = (!rt.state.scene.painted() && frame < 8).then(|| Phase::new("main", "layout", &label));
            more = rt.frame(if frame == 0 { 0.0 } else { DT });
        }
        frame += 1;
        if frame > 2_000_000 { break; }
    }
}

fn poll(s: &mut State, seconds: f64, tx: &mut Tx) -> bool {
    s.polls += 1;
    // The second frame: the first one is on screen (Rune passes on no presentation).
    if s.polls == 3 { s.scene.first_paint(seconds * 1000.0); }
    let changed = step(s, seconds * 1000.0, false, tx);
    if s.scene.done() {
        tx.quit();
    } else if s.scene.wants_frames() {
        tx.wake_after(Duration::ZERO);
    } else if let Some(due) = s.scene.deadline() {
        tx.wake_at(due / 1000.0);
    }
    changed
}

fn main() {
    if xbench_scenes::windowless() {
        windowless();
        return;
    }
    let mut spec = AppSpec::new("xbench", (WIDTH, HEIGHT), init, view::view);
    spec.fonts = FONTS;
    spec.families = FAMILIES;
    spec.setup = Some(load_pictures);
    spec.poll = Some(poll);
    rune::App::new(spec).run();
}
