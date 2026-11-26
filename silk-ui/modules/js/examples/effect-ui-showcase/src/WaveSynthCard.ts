import { Mount, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Slider, Switch, ToggleGroup } from "@effect/ui-kit";
import { Effect, Schema, Stream } from "effect";

const Palette = Schema.Literals(["cyan", "emerald", "amber"]);
type Palette = typeof Palette.Type;

const PALETTES: Record<
  Palette,
  { readonly lines: readonly [string, string, string]; readonly glow: string }
> = {
  cyan: {
    lines: ["#7dd3fc", "#38bdf8", "#0ea5e9"],
    glow: "rgba(56, 189, 248, 0.28)",
  },
  emerald: {
    lines: ["#86efac", "#22c55e", "#2dd4bf"],
    glow: "rgba(34, 197, 94, 0.26)",
  },
  amber: {
    lines: ["#fde68a", "#f59e0b", "#fb923c"],
    glow: "rgba(245, 158, 11, 0.26)",
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

              // Three smooth harmonic ribbons (2px sample step + round joins/caps)
              ctx.lineJoin = "round";
              ctx.lineCap = "round";
              for (let layer = 2; layer >= 0; layer--) {
                const offset = layer * 1.15;
                const scale = 1 - layer * 0.2;
                ctx.beginPath();
                for (let x = 0; x <= width; x += 2) {
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

              // 7 smooth circular glowing harmonic nodes (batched in 3 passes)
              const nodeCoords: number[] = [];
              for (let i = 1; i <= 7; i++) {
                const x = (width / 8) * i;
                const envelope = Math.sin((x / width) * Math.PI);
                const y =
                  height / 2 +
                  Math.sin(x * freq + phase) * amp * envelope +
                  Math.cos(x * freq * 1.85 - phase * 0.72) * amp * 0.22 * envelope;
                nodeCoords.push(x, y);
              }

              ctx.fillStyle = theme.glow;
              ctx.beginPath();
              for (let i = 0; i < nodeCoords.length; i += 2) {
                const x = nodeCoords[i];
                const y = nodeCoords[i + 1];
                ctx.moveTo(x + 6.5, y);
                ctx.arc(x, y, 6.5, 0, Math.PI * 2);
              }
              ctx.fill();

              ctx.fillStyle = theme.lines[0];
              ctx.beginPath();
              for (let i = 0; i < nodeCoords.length; i += 2) {
                const x = nodeCoords[i];
                const y = nodeCoords[i + 1];
                ctx.moveTo(x + 3, y);
                ctx.arc(x, y, 3, 0, Math.PI * 2);
              }
              ctx.fill();

              ctx.fillStyle = "#ffffff";
              ctx.beginPath();
              for (let i = 0; i < nodeCoords.length; i += 2) {
                const x = nodeCoords[i];
                const y = nodeCoords[i + 1];
                ctx.moveTo(x + 1.2, y);
                ctx.arc(x, y, 1.2, 0, Math.PI * 2);
              }
              ctx.fill();
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
    palette: "cyan",
    running: true,
  }),
  update: {
    SetFrequency: ($, { value }) => $.evolve({ frequency: value }),
    SetAmplitude: ($, { value }) => $.evolve({ amplitude: value }),
    SetPalette: ($, { palette }) => $.evolve({ palette }),
    SetRunning: ($, { running }) => $.evolve({ running }),
  },
  view: (h, model) =>
    h.section
      .class("studio-card p-5 flex flex-col gap-3.5")
      .attr("role", "region")
      .attr("aria-label", "Signal synthesizer")
      .children(
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
                items: [{ value: "cyan" }, { value: "emerald" }, { value: "amber" }],
              },
              onEmit: {
                Toggled: ({ value }) => {
                  const next = value[0];
                  if (next === "cyan" || next === "emerald" || next === "amber") {
                    return WaveMessage.SetPalette({ palette: next });
                  }
                  return undefined;
                },
              },
              view: (tg) =>
                tg.root(
                  h.div
                    .class("flex items-center gap-1")
                    .attr("aria-label", "Wave color palette"),
                ).children(
                  ...([
                    ["cyan", "#38bdf8", "Cyan wave palette"],
                    ["emerald", "#22c55e", "Emerald wave palette"],
                    ["amber", "#f59e0b", "Amber wave palette"],
                  ] as const).map(([value, dot, label]) =>
                    tg.item({
                      element: h.button
                        .class(
                          "studio-btn py-1 px-2",
                          model.palette === value ? "studio-btn-active" : "",
                        )
                        .attr("aria-label", label),
                      value,
                    }).children(
                      h.span
                        .class("inline-block w-2.5 h-2.5 rounded-full")
                        .attr("aria-hidden", "true")
                        .attr("style", `background-color: ${dot}`),
                    ),
                  ),
                ),
            }),
            Switch(h, {
              props: { checked: model.running },
              onToggle: ({ checked }) => WaveMessage.SetRunning({ running: checked }),
              view: (sw) =>
                sw.root(
                  h.button
                    .class("studio-switch")
                    .attr("aria-label", "Animate wave signal"),
                ).children(
                  sw.thumb(h.span.class("studio-switch-thumb")),
                ),
            }),
          ),
        ),
        h.canvas
          .class("w-full rounded-xl")
          .attr("role", "img")
          .attr(
            "aria-label",
            `Animated harmonic wave at ${model.frequency.toFixed(1)} hertz and ${Math.round(model.amplitude)} percent amplitude, ${model.palette} palette, ${model.running ? "running" : "paused"}`,
          )
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
              sl.root(
                h.div
                  .class("flex flex-col gap-1")
                  .attr("aria-label", "Wave frequency"),
              ).children(
                h.div.class("flex items-center justify-between text-xs").children(
                  h.span.attr("style", "color: var(--fg-muted)").children("Freq"),
                  sl.value(
                    h.output
                      .class("studio-mono")
                      .attr("aria-live", "off")
                      .attr("aria-label", "Wave frequency value"),
                  ).children(`${model.frequency.toFixed(1)} Hz`),
                ),
                sl.control(h.div.class("studio-slider-control")).children(
                  sl.track(h.div.class("studio-slider-track")).children(
                    sl.indicator(h.div.class("studio-slider-indicator")),
                    sl.thumb({
                      element: h.div.class("studio-slider-thumb"),
                      input: h.input
                        .attr("role", "slider")
                        .attr("aria-label", "Wave frequency in hertz")
                        .attr("aria-valuemin", "1")
                        .attr("aria-valuemax", "10")
                        .attr("aria-valuetext", `${model.frequency.toFixed(1)} Hz`)
                        .attr("style", "opacity: 0; pointer-events: none; width: 1px; height: 1px"),
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
              sl.root(
                h.div
                  .class("flex flex-col gap-1")
                  .attr("aria-label", "Wave amplitude"),
              ).children(
                h.div.class("flex items-center justify-between text-xs").children(
                  h.span.attr("style", "color: var(--fg-muted)").children("Amp"),
                  sl.value(
                    h.output
                      .class("studio-mono")
                      .attr("aria-live", "off")
                      .attr("aria-label", "Wave amplitude value"),
                  ).children(`${Math.round(model.amplitude)}%`),
                ),
                sl.control(h.div.class("studio-slider-control")).children(
                  sl.track(h.div.class("studio-slider-track")).children(
                    sl.indicator(h.div.class("studio-slider-indicator")),
                    sl.thumb({
                      element: h.div.class("studio-slider-thumb"),
                      input: h.input
                        .attr("role", "slider")
                        .attr("aria-label", "Wave amplitude percentage")
                        .attr("aria-valuemin", "10")
                        .attr("aria-valuemax", "100")
                        .attr("aria-valuetext", `${Math.round(model.amplitude)}%`)
                        .attr("style", "opacity: 0; pointer-events: none; width: 1px; height: 1px"),
                    }),
                  ),
                ),
              ),
          }),
        ),
      ),
});
