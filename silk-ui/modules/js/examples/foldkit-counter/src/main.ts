import { Effect, Queue, Schema, Stream } from 'effect'
import { Command, Mount, Runtime, Update } from 'foldkit'
import { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { HoverStyle } from '@silkui/foldkit'

// The page's motion and its two looks are the React starter's own files: the same code
// draws every frame under both frameworks.
import { SIZE, startMotion } from '../../react-counter/src/motion.js'
import { links, mono, rgb, sans, themes } from '../../react-counter/src/theme.js'

// MODEL

export const Model = Schema.Struct({
  clicks: Schema.Number,
  streak: Schema.Number,
  theme: Schema.Literals(['dark', 'light']),
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedPage: { x: Schema.Number, y: Schema.Number },
  ClickedThemeSwitch: {},
  ClickedLink: {},
  CountedStreak: { streak: Schema.Number },
  CompletedThemeMotion: {},
})
export type Message = typeof Message.Type

// MOTION

// What moves between clicks never reaches the Model: motion.js draws it every frame on the
// nodes of the view. The Mount below starts it on the page element and reports clicks;
// Commands tell it about a click and a theme change.
type Motion = ReturnType<typeof startMotion>
let motion: Motion | undefined

const part = (page: Element, name: string) =>
  page.querySelector(`[data-part="${name}"]`)!.node

const StartMotion = Mount.defineStream('StartMotion', {
  args: { initialTheme: Model.fields.theme, initialClicks: Schema.Number },
  messages: [Message.ClickedPage],
  execute: ({ element, initialTheme, initialClicks }) =>
    Stream.callback<typeof Message.ClickedPage.Type>(queue =>
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            const names = ['field', 'effects', 'glow', 'pointerRing', 'previous', 'ghostRed', 'ghostCyan', 'main', 'streakBar']
            const nodes = Object.fromEntries(names.map(name => [name, part(element, name)]))
            const started = startMotion(nodes, themes[initialTheme], initialClicks)
            motion = started
            const page = element as HTMLElement
            page.addEventListener('click', event =>
              Queue.offerUnsafe(queue, Message.ClickedPage({ x: event.clientX, y: event.clientY })),
            )
            page.addEventListener('pointermove', event => started.pointer(event.clientX, event.clientY))
            // The tree's own event: the page's size, without a layout read.
            page.node.addEventListener('layout', (event: { bounds: { width: number; height: number } }) =>
              started.resize(event.bounds.width, event.bounds.height),
            )
            return started
          }),
          started =>
            Effect.sync(() => {
              started.stop()
              motion = undefined
            }),
        )
        return yield* Effect.never
      }),
    ),
})

const PulseMotion = Command.define('PulseMotion', {
  args: { x: Schema.Number, y: Schema.Number, clicks: Schema.Number },
  messages: [Message.CountedStreak],
  execute: ({ x, y, clicks }) =>
    Effect.sync(() => Message.CountedStreak({ streak: motion?.click(x, y, clicks) ?? 0 })),
})

const ThemeMotion = Command.define('ThemeMotion', {
  args: { theme: Model.fields.theme },
  messages: [Message.CompletedThemeMotion],
  execute: ({ theme }) =>
    Effect.sync(() => {
      motion?.setTheme(themes[theme])
      return Message.CompletedThemeMotion()
    }),
})

// UPDATE

export const update = (model: Model, message: Message) =>
  Message.match<Update.Return<Model, Message>>(message, {
    ClickedPage: ({ x, y }) => ({
      model: { ...model, clicks: model.clicks + 1 },
      commands: [PulseMotion({ x, y, clicks: model.clicks + 1 })],
    }),
    CountedStreak: ({ streak }) => ({ model: { ...model, streak } }),
    ClickedThemeSwitch: () => {
      const theme = model.theme === 'dark' ? 'light' : 'dark'
      return { model: { ...model, theme }, commands: [ThemeMotion({ theme })] }
    },
    ClickedLink: () => ({ model }),
    CompletedThemeMotion: () => ({ model }),
  })

// INIT

export const init: Runtime.ApplicationInit<Model, Message> = () => ({
  model: { clicks: 0, streak: 0, theme: 'dark' },
})

// VIEW

const px = (value: number) => `${value}px`
const row = { display: 'flex', flexDirection: 'row', alignItems: 'center' }
const column = { display: 'flex', flexDirection: 'column' }
const layer = { position: 'absolute', inset: '0', pointerEvents: 'none' }
const digit = {
  position: 'absolute',
  left: '0',
  right: '0',
  top: '0',
  textAlign: 'center',
  fontSize: px(SIZE),
  fontWeight: '700',
  lineHeight: '1',
  letterSpacing: '-12px',
}

// The counter is the page: click anywhere.
export const view = (model: Model, h: HtmlBuilder<Message>): Document => {
  const { clicks, streak } = model
  const theme = themes[model.theme]
  const ink = rgb(theme.ink)
  const words =
    clicks === 0
      ? 'CLICK ANYWHERE'
      : (clicks === 1 ? 'CLICKED' : `CLICKED ${clicks} TIMES`) + (streak > 2 ? `  ×${streak}` : '')
  const Part = (name: string) => h.DataAttribute('part', name)

  return {
    title: 'Silk UI',
    body: h.div(
      [
        h.DataAttribute('testid', 'counter'),
        h.OnMount(StartMotion({ initialTheme: model.theme, initialClicks: clicks })),
        h.Style({
          position: 'absolute',
          inset: '0',
          overflow: 'hidden',
          cursor: 'pointer',
          fontFamily: sans,
          backgroundColor: theme.page,
          color: ink,
        }),
      ],
      [
        h.div([Part('field'), h.Style(layer)], []),
        h.div(
          [Part('effects'), h.Style(layer)],
          [
            h.div([Part('glow'), h.Style({ position: 'absolute', width: '2px', height: '2px', borderRadius: '1px' })], []),
            h.div(
              [
                Part('pointerRing'),
                h.Style({ position: 'absolute', width: '28px', height: '28px', borderRadius: '14px', borderWidth: '1.5px', borderStyle: 'solid' }),
              ],
              [],
            ),
          ],
        ),
        h.div(
          [h.Style({ ...column, position: 'absolute', inset: '0' })],
          [
            titleBar(h, theme),
            h.div(
              [h.Style({ ...column, alignItems: 'center', justifyContent: 'center', flexGrow: '1', pointerEvents: 'none' })],
              [
                h.div(
                  [h.Style({ position: 'relative', alignSelf: 'stretch', height: px(SIZE) })],
                  [
                    h.div([Part('previous'), h.Style({ ...digit, color: ink, opacity: '0' })], [String(Math.max(0, clicks - 1))]),
                    h.div([Part('ghostRed'), h.Style({ ...digit, color: 'rgb(255, 40, 90)', opacity: '0' })], [String(clicks)]),
                    h.div([Part('ghostCyan'), h.Style({ ...digit, color: 'rgb(40, 220, 255)', opacity: '0' })], [String(clicks)]),
                    h.div([Part('main'), h.Style(digit)], [String(clicks)]),
                  ],
                ),
              ],
            ),
            h.div(
              [h.Style(column)],
              [
                h.div(
                  [h.Style({ ...row, justifyContent: 'space-between', padding: '0 28px 18px', fontSize: '13px' })],
                  [
                    h.div([h.Style({ fontFamily: mono, fontSize: '12px', letterSpacing: '2px', color: theme.muted })], [words]),
                    h.div(
                      [h.Style({ ...row, gap: '22px' })],
                      [...links.map(link => linkView(h, theme, link)), themeSwitch(h, model.theme, theme)],
                    ),
                  ],
                ),
                h.div(
                  [h.Style({ height: '2px', backgroundColor: theme.track })],
                  [h.div([Part('streakBar'), h.Style({ height: '2px', width: '0' })], [])],
                ),
              ],
            ),
          ],
        ),
      ],
    ),
  }
}

type Theme = (typeof themes)[keyof typeof themes]

// The bar at the top is the window's title bar where the system lets the page draw it (on
// macOS the window controls sit at its left), so nothing in it takes clicks.
const titleBar = (h: HtmlBuilder<Message>, theme: Theme): Html =>
  h.div(
    [h.Style({ ...row, position: 'relative', justifyContent: 'center', height: '56px', flexShrink: '0' })],
    [
      h.div(
        [h.Style({ ...row, gap: '10px', fontWeight: '600', fontSize: '15px' })],
        [h.div([h.Style({ width: '10px', height: '10px', borderRadius: '5px', backgroundColor: rgb(theme.ink) })], []), 'Silk UI'],
      ),
      h.div(
        [h.Style({ ...row, gap: '8px', position: 'absolute', right: '28px', top: '0', bottom: '0', fontFamily: mono, fontSize: '12px', color: theme.faint })],
        ['edit', h.div([h.Style({ color: rgb(theme.ink) })], ['src/main.ts']), 'to make it yours'],
      ),
    ],
  )

// A click on a link opens it and does not count.
const linkView = (h: HtmlBuilder<Message>, theme: Theme, link: { title: string; href: string }): Html =>
  h.a(
    [
      h.Href(link.href),
      h.OnClick(Message.ClickedLink(), { propagation: 'Stop' }),
      h.Style({ whiteSpace: 'nowrap', cursor: 'pointer', color: theme.muted }),
      HoverStyle({ color: rgb(theme.ink) }),
    ],
    [`${link.title} ↗`],
  )

const themeSwitch = (h: HtmlBuilder<Message>, name: Model['theme'], theme: Theme): Html =>
  h.button(
    [
      h.DataAttribute('testid', 'theme'),
      h.OnClick(Message.ClickedThemeSwitch(), { propagation: 'Stop' }),
      h.Style({
        padding: '3px 10px',
        borderRadius: '999px',
        borderWidth: '1px',
        borderStyle: 'solid',
        borderColor: theme.track,
        cursor: 'pointer',
        color: theme.muted,
        fontFamily: mono,
        fontSize: '11px',
      }),
      HoverStyle({ borderColor: theme.faint, color: rgb(theme.ink) }),
    ],
    [name === 'dark' ? 'LIGHT' : 'DARK'],
  )
