# Scenes

Four scenes, one window of 1040 x 720 CSS px, the same content in every app. The content is
`content/corpus.txt` (3,000 items, made by `content/gen.py` with a fixed seed): each item is an
author header (avatar, name, time, tags), then a mix of blocks, then a footer of three buttons.
The blocks are paragraphs with inline marks (bold, italic, code, link), headings, bullet lists,
code blocks, tables of 3 or 4 columns, quotes, and pictures with captions (four PNGs at twice
their CSS size). The style is `style/bench.css`: plain CSS, no hover, no transitions, no shadows.

Every scene is a script of steps (apps/react/web/src/App.tsx is the reference; the Silk and Rust
apps follow it step for step):

- **idle N**: no input, no frames requested, for N ms. The runner reads CPU use over it.
- **mark NAME**: the app holds still for 400 ms; the runner stops the process tree and reads its
  memory.
- **driver NAME**: one change per frame for a number of frames (or until the driver is done).
  The runner reads wall time and CPU time over it; the app reports its frame intervals.

| Scene | What is on screen | Script | What it is for |
| --- | --- | --- | --- |
| `feed` (feed-1000) | 1,000 items in one scroller, about 61,000 nodes, a screen of them visible | idle 3 s, mark `loaded`, `scroll` (600 frames of 24 px), `sweep` (720 px a frame to the end, then back to the top), idle 3 s, mark `swept` | Many elements, few visible. Cold layout of a long document, scrolling cost with a mostly offscreen tree, memory after every part has been on screen once (glyphs, pictures, paint caches): `swept` minus `loaded` |
| `wall` | 544 cells of a 16-column grid plus 24 notes, everything visible at once | idle 3 s, mark `loaded`, `update` (600 frames, 32 cells change text and colour each frame), `pan` (600 frames, 1 px a frame down 300 px and back), mark `end` | Many elements, all visible. Per-frame cost when the visible content itself changes, and when the whole screen moves |
| `stream` (stream-300) | 300 items, then a reply that grows | idle 3 s, mark `loaded`, `stream` (900 frames: 3 words a frame, a new paragraph every 60 words, a new item every 240, pinned to the end), idle 3 s, mark `streamed` | Growth: text appended at the end of a long document, re-laid out and scrolled to every frame (the chat case) |
| `churn` (churn-1000) | an empty feed, then 1,000 items added 25 a frame, then cleared; three times, with other items each time | idle 1 s, mark `base`; three times: `grow-k` (40 frames), idle 1 s, mark `full-k`, `clear-k` (1 frame), idle 1.5 s, mark `empty-k` | Memory growth and eviction: `full-k` against `base`, `empty-k` against `base` (what is not given back), and whether `empty-3` creeps above `empty-1` (a leak) |

## The canvas scene

A fifth scene, for the two apps that have WebGPU in a canvas (Electron and Silk UI + React), in
the gpu suite only:

| Scene | What is on screen | Script | What it is for |
| --- | --- | --- | --- |
| `canvas` (canvas-200) | a canvas of 1,440 x 540 pixels shown at 720 x 270 CSS px, pinned over a feed of 200 items | idle 3 s, mark `loaded`, `draw` (600 frames: the canvas is drawn again, nothing else changes), `draw-scroll` (600 frames: the canvas is drawn and the feed scrolls 24 px), idle 3 s, mark `end` | What a WebGPU canvas costs beside an interface: the way its frames reach the window, and whether a canvas that draws every frame slows the interface's own frames |

The drawing is 20,000 squares on orbits in one instanced draw (`apps/react/web/src/stage.ts`).
Every position comes from the instance index and a time uniform, so a frame uploads 16 bytes:
the scene measures the GPU and the canvas's way to the screen, not JavaScript.

## The chat scene

A sixth scene, for the two React apps (Electron and Silk UI + React), in either suite:

| Scene | What is on screen | Script | What it is for |
| --- | --- | --- | --- |
| `chat` (chat-1000) | a chatbot's transcript of 1,000 messages in one rounded scroller: short messages from the person, long replies with paragraphs, tables, numbered lists, code and pictures | idle 3 s, mark `loaded`, `scroll` (600 frames of 24 px), `sweep` (720 px a frame to the end, then back to the top), idle 3 s, mark `swept`, `append` (300 frames: a new message every 10 frames, pinned to the end), idle 3 s, mark `rest` | A real page's markup and styling rather than the corpus feed: the Silk UI CSS demo's chat page (alpha colours, a gradient, a grid table, truncated cells), its cost when most of it is off screen, and memory once nothing runs: `rest` is a true rest, with no animation frames and no timers before it |

The messages come from a seeded generator in `apps/react/web/src/Chat.tsx` (generated words, the
same in every app and every run); the pictures are the corpus's four PNGs. The style is
`style/chat.css`, plain CSS like bench.css, which only the chat build loads. A size after the
dash sets the message count: `chat-200`, `chat-3000`.

## The input scene

A seventh scene, for the two React apps, in either suite. It measures what one input costs on a
real app's page, the case where Silk UI was slow while scrolling was fine:

| Scene | What is on screen | Script | What it is for |
| --- | --- | --- | --- |
| `input` | T3 Code's chat view: its sidebar of projects and threads, the timeline header, the composer and its menus, 470 elements with their real classes and attributes | idle 3 s, mark `loaded`, `type` (120 frames: one more letter in the composer each frame), `select` (60 frames: another sidebar thread becomes `data-active`), `collapse` (60 frames: the sidebar wrapper's `data-sidebar-state` flips), `menu` (60 frames: a menu button's `aria-expanded` and `data-popup-open` flip), idle 3 s, mark `rest` | Restyle and relayout after one change under a large utility stylesheet: about 5,000 Tailwind rules with `group-*`, `has-*`, `data-*`, `:focus-within` and `:is()`/`:where()` variants, where every rule a change can reach must be found and only the elements it reaches restyled |

The page is `content/t3-page.json`, written by `tools/t3-page.py` from the T3 page fixture of
Silk UI's restyle bench (`modules/tree/tools/restyle-bench/fixtures/t3-page.tree`): a snapshot of
T3 Code's chat view as its Silk UI port rendered it, inline styles moved into `#xb-inline-N`
rules and icons kept as empty `svg` elements. `html` and `body` become divs that keep their
attributes. The style is `style/t3.css`: T3 Code's Tailwind build of `apps/web` (MIT licensed),
then those inline rules. Each input is a React state change flushed in its frame
(`apps/react/web/src/Input.tsx`), so a frame's CPU time is the input's cost from React to paint.
It goes through React, not the platform's event dispatch, the same way in both apps.

For the engine alone, without React or JS, Silk UI's restyle bench runs the same page and inputs
and counts the nodes each input restyles (`modules/tree/tools/restyle-bench`).

A size after a dash changes the item count: `feed-3000`, `stream-1000`, `churn-2000`.

Idle memory is the mark after each idle (`loaded`, `swept`, `streamed`, `base`, `empty-k`, `rest`).

## Nothing is virtualized

Every app keeps every item in its tree. A list that only builds the visible rows would win every
scene, and that is a property of the app, not of the framework. The scenes ask what a framework
costs when the app does not do that work.

## Offscreen release switch

With the switch on, every item of `feed`, `stream` and `churn` gets `content-visibility: auto;
contain-intrinsic-size: auto 400px` (`.lazy > .item` in style/bench.css), and every message of
`chat` gets `content-visibility: auto; contain-intrinsic-size: auto 120px` (`.lazy > .msg` in
style/chat.css): items far from the viewport skip their contents and keep their size. The app still holds every item; the
framework decides what to lay out. The switch is `XB_CONTENT_VISIBILITY=1` at run time for
silk-direct, and `VITE_XB_CONTENT_VISIBILITY=1` at build time for the React builds (silk-react,
Electron). Off is the default, and results with it on are labelled so (`--label`).

## Parity

The Silk apps report the tree's node and fragment counts (`silk_first_frame` in the results); on
`feed` React, Loom and direct all have 61,176 nodes and 67,425 to 67,456 fragments. The Rust apps
build the same structure in their own elements (LOG.md lists where they cannot). For checking by eye, Electron writes a
screenshot at first paint with `XB_SHOT=<png>`.
