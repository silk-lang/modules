import { Mount, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Slider, Switch, ToggleGroup } from "@effect/ui-kit";
import { Effect, Schema, Stream } from "effect";

const Palette = Schema.Literals(["effect", "emerald", "rose"]);
type Palette = typeof Palette.Type;

const PALETTES: Record<
  Palette,
  { readonly lines: readonly [string, string, string]; readonly glow: string }
> = {
  effect: {
    lines: ["#8f96ff", "#5c5cf6", "#38bdf8"],
    glow: "rgba(92, 92, 246, 0.28)",
  },
  emerald: {
    lines: ["#4ade80", "#22c55e", "#38bdf8"],
    glow: "rgba(34, 197, 94, 0.26)",
  },
  rose: {
    lines: ["#fda4af", "#fb7185", "#f59e0b"],
    glow: "rgba(251, 113, 133, 0.26)",
  },
};

const WaveParams = Schema.Struct({
  frequency: Schema.Number,
  amplitude: Schema.Number,
  palette: Palette,
  running: Schema.Boolean,
});
type WaveParams = typeof WaveParams.Type;

const DrawWaves = Mount.make(
  "DrawWaves",
  { args: WaveParams },
  (node: HTMLCanvasElement, initial, changes) =>
    Effect.gen(function* () {
      let params: WaveParams = initial;
      yield* Effect.forkScoped(
        Stream.runForEach(changes, (next) =>
          Effect.sync(() => {
            params = next;
          }),
        ),
      );

      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const width = 460;
          const height = 166;
          node.width = width;
          node.height = height;
          const ctx = node.getContext("2d") as CanvasRenderingContext2D | null;
          let rafId = 0;
          let phase = 0;
          let last = performance.now();
          let dirty = true;
          let prevKey = "";

          const frame = (now: number) => {
            const dt = Math.min((now - last) / 1000, 0.05);
            last = now;
            const key = `${params.frequency}|${params.amplitude}|${params.palette}|${params.running}`;
            if (key !== prevKey) {
              prevKey = key;
              dirty = true;
            }
            if (params.running) {
              phase += dt * (1.35 + params.frequency * 0.28);
              dirty = true;
            }

            if (ctx && dirty) {
              dirty = false;
              ctx.fillStyle = "#09090d";
              ctx.fillRect(0, 0, width, height);

              const theme = PALETTES[params.palette];

              // Architectural hairline grid (single path pass)
              ctx.strokeStyle = "rgba(255, 255, 255, 0.055)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              for (let x = 57.5; x < width; x += 57.5) {
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
              }
              ctx.moveTo(0, height / 4);
              ctx.lineTo(width, height / 4);
              ctx.moveTo(0, (height * 3) / 4);
              ctx.lineTo(width, (height * 3) / 4);
              ctx.stroke();

              // Center horizon line
              ctx.strokeStyle = "rgba(255, 255, 255, 0.11)";
              ctx.beginPath();
              ctx.moveTo(0, height / 2);
              ctx.lineTo(width, height / 2);
              ctx.stroke();

              const freq = 0.012 + params.frequency * 0.0052;
              const amp = 12 + params.amplitude * 0.56;

              // Three harmonic ribbons (primary ribbon gets luminous halo + crisp core)
              for (let layer = 2; layer >= 0; layer--) {
                const offset = layer * 1.15;
                const scale = 1 - layer * 0.2;
                ctx.beginPath();
                for (let x = 0; x <= width; x += 10) {
                  const envelope = Math.sin((x / width) * Math.PI);
                  const y =
                    height / 2 +
                    Math.sin(x * freq + phase * (1 + layer * 0.24) + offset) *
                      amp *
                      scale *
                      envelope +
                    Math.cos(x * freq * 1.85 - phase * 0.72) *
                      amp *
                      0.22 *
                      scale *
                      envelope;
                  if (x === 0) ctx.moveTo(x, y);
                  else ctx.lineTo(x, y);
                }

                if (layer === 0) {
                  ctx.strokeStyle = theme.glow;
                  ctx.lineWidth = 9;
                  ctx.stroke();
                }

                ctx.strokeStyle = theme.lines[layer];
                ctx.lineWidth = layer === 0 ? 2.4 : 1.4;
                ctx.stroke();
              }

              // 7 luminous harmonic nodes (fast square-core + halo rects: zero arc tessellation overhead)
              for (let i = 1; i <= 7; i++) {
                const x = (width / 8) * i;
                const envelope = Math.sin((x / width) * Math.PI);
                const y =
                  height / 2 +
                  Math.sin(x * freq + phase) * amp * envelope +
                  Math.cos(x * freq * 1.85 - phase * 0.72) * amp * 0.22 * envelope;

                ctx.fillStyle = theme.glow;
                ctx.fillRect(x - 6, y - 6, 12, 12);
                ctx.fillStyle = theme.lines[0];
                ctx.fillRect(x - 2.5, y - 2.5, 5, 5);
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(x - 1, y - 1, 2, 2);
              }
            }

            rafId = requestAnimationFrame(frame);
          };

          rafId = requestAnimationFrame(frame);
          return () => cancelAnimationFrame(rafId);
        }),
        (stop) => Effect.sync(stop),
      );

      return yield* Effect.never;
    }),
);

const WaveMessage = UiSchema.TaggedEnum({
  SetFrequency: { value: Schema.Number },
  SetAmplitude: { value: Schema.Number },
  SetPalette: { palette: Palette },
  SetRunning: { running: Schema.Boolean },
});

const singleValue = (v: number | readonly number[]): number =>
  typeof v === "number" ? v : (v[0] ?? 0);

export const WaveSynthCard = Html.component({
  name: "WaveSynthCard",
  model: WaveParams,
  message: WaveMessage,
}).make({
  init: () => ({
    frequency: 4.5,
    amplitude: 72,
    palette: "effect",
    running: true,
  }),
  update: {
    SetFrequency: ($, { value }) => $.evolve({ frequency: value }),
    SetAmplitude: ($, { value }) => $.evolve({ amplitude: value }),
    SetPalette: ($, { palette }) => $.evolve({ palette }),
    SetRunning: ($, { running }) => $.evolve({ running }),
  },
  view: (h, model) =>
    h.section.class("studio-card p-5 flex flex-col gap-3.5").children(
      h.div.class("flex items-center justify-between gap-2").children(
        h.div.class("flex items-center gap-2").children(
          h.h2.class("text-sm font-semibold m-0").children("Signal"),
          h.span
            .class("studio-mono text-[11px]")
            .attr("style", "color: var(--fg-subtle)")
            .children("Mount · Canvas 2D"),
        ),
        h.div.class("flex items-center gap-2").children(
          ToggleGroup(h, {
            props: {
              value: [model.palette],
              items: [{ value: "effect" }, { value: "emerald" }, { value: "rose" }],
            },
            onEmit: {
              Toggled: ({ value }) => {
                const next = value[0];
                if (next === "effect" || next === "emerald" || next === "rose") {
                  return WaveMessage.SetPalette({ palette: next });
                }
                return undefined;
              },
            },
            view: (tg) =>
              tg.root(h.div.class("flex items-center gap-1")).children(
                ...([
                  ["effect", "#8f96ff"],
                  ["emerald", "#22c55e"],
                  ["rose", "#fb7185"],
                ] as const).map(([value, dot]) =>
                  tg.item({
                    element: h.button.class(
                      "studio-btn py-1 px-2",
                      model.palette === value ? "studio-btn-active" : "",
                    ),
                    value,
                  }).children(
                    h.span
                      .class("inline-block w-2.5 h-2.5 rounded-full")
                      .attr("style", `background-color: ${dot}`),
                  ),
                ),
              ),
          }),
          Switch(h, {
            props: { checked: model.running },
            onToggle: ({ checked }) => WaveMessage.SetRunning({ running: checked }),
            view: (sw) =>
              sw.root(h.button.class("studio-switch")).children(
                sw.thumb(h.span.class("studio-switch-thumb")),
              ),
          }),
        ),
      ),
      h.canvas
        .class("w-full rounded-xl")
        .attr(
          "style",
          "height: 166px; border: 1px solid var(--border); display: block",
        )
        .onMount(
          DrawWaves({
            frequency: model.frequency,
            amplitude: model.amplitude,
            palette: model.palette,
            running: model.running,
          }),
        ),
      h.div.class("grid grid-cols-2 gap-4").children(
        Slider(h, {
          key: "freq",
          props: { value: model.frequency, min: 1, max: 10, step: 0.5 },
          onEmit: {
            Moved: ({ value }) => WaveMessage.SetFrequency({ value: singleValue(value) }),
            Committed: ({ value }) => WaveMessage.SetFrequency({ value: singleValue(value) }),
          },
          view: (sl) =>
            sl.root(h.div.class("flex flex-col gap-1")).children(
              h.div.class("flex items-center justify-between text-xs").children(
                h.span.attr("style", "color: var(--fg-muted)").children("Freq"),
                sl.value(h.output.class("studio-mono")).children(`${model.frequency.toFixed(1)} Hz`),
              ),
              sl.control(h.div.class("studio-slider-control")).children(
                sl.track(h.div.class("studio-slider-track")).children(
                  sl.indicator(h.div.class("studio-slider-indicator")),
                  sl.thumb({
                    element: h.div.class("studio-slider-thumb"),
                    input: h.input.attr("style", "display: none"),
                  }),
                ),
              ),
            ),
        }),
        Slider(h, {
          key: "amp",
          props: { value: model.amplitude, min: 10, max: 100, step: 1 },
          onEmit: {
            Moved: ({ value }) => WaveMessage.SetAmplitude({ value: singleValue(value) }),
            Committed: ({ value }) => WaveMessage.SetAmplitude({ value: singleValue(value) }),
          },
          view: (sl) =>
            sl.root(h.div.class("flex flex-col gap-1")).children(
              h.div.class("flex items-center justify-between text-xs").children(
                h.span.attr("style", "color: var(--fg-muted)").children("Amp"),
                sl.value(h.output.class("studio-mono")).children(`${Math.round(model.amplitude)}%`),
              ),
              sl.control(h.div.class("studio-slider-control")).children(
                sl.track(h.div.class("studio-slider-track")).children(
                  sl.indicator(h.div.class("studio-slider-indicator")),
                  sl.thumb({
                    element: h.div.class("studio-slider-thumb"),
                    input: h.input.attr("style", "display: none"),
                  }),
                ),
              ),
            ),
        }),
      ),
    ),
});
