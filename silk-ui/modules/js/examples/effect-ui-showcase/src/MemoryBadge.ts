import { Subscription, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { memoryUsage } from "@silkui/core";
import { Effect, Queue, Schema, Stream } from "effect";

const MemoryMessage = UiSchema.TaggedEnum({
  Sampled: {
    mb: Schema.NullOr(Schema.Number),
    fps: Schema.Number,
  },
});

function readMb(): number | null {
  try {
    const usage = memoryUsage();
    if (!usage || usage.footprint <= 0) return null;
    return Math.round((usage.footprint / (1024 * 1024)) * 10) / 10;
  } catch {
    return null;
  }
}

export const MemoryBadge = Html.component({
  name: "MemoryBadge",
  model: Schema.Struct({
    mb: Schema.NullOr(Schema.Number),
    fps: Schema.Number,
  }),
  message: MemoryMessage,
}).make({
  init: () => ({ mb: readMb(), fps: 60 }),
  update: {
    Sampled: ($, { mb, fps }) => $.evolve({ mb, fps }),
  },
  subscriptions: () => [
    Subscription.make(
      "runtime-metrics",
      Stream.callback<typeof MemoryMessage.Type>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() => {
            let frames = 0;
            let last = performance.now();
            let currentFps = 60;
            let rafId = 0;

            const loop = (now: number) => {
              frames++;
              if (now - last >= 500) {
                currentFps = Math.min(120, Math.round((frames * 1000) / (now - last)));
                frames = 0;
                last = now;
              }
              rafId = requestAnimationFrame(loop);
            };
            rafId = requestAnimationFrame(loop);

            const timer = setInterval(() => {
              Queue.offerUnsafe(
                queue,
                MemoryMessage.Sampled({ mb: readMb(), fps: currentFps }),
              );
            }, 900);

            // Immediate first sample
            Queue.offerUnsafe(queue, MemoryMessage.Sampled({ mb: readMb(), fps: 60 }));

            return () => {
              cancelAnimationFrame(rafId);
              clearInterval(timer);
            };
          }),
          (stop) => Effect.sync(stop),
        ),
      ),
    ),
  ],
  view: (h, model) => {
    const memText = model.mb !== null ? `${model.mb.toFixed(1)}\u00a0MB` : "native";
    const fpsText = `${model.fps}\u00a0fps`;
    const ariaLabel =
      model.mb !== null
        ? `Memory usage ${model.mb.toFixed(1)} megabytes, frame rate ${model.fps} frames per second`
        : `Native runtime, frame rate ${model.fps} frames per second`;

    return h.div
      .class("studio-mem-pill")
      .attr("role", "group")
      .attr("aria-live", "off")
      .attr("aria-label", ariaLabel)
      .children(
        h.span.class("studio-beacon shrink-0").attr("aria-hidden", "true"),
        h.span.class("whitespace-nowrap shrink-0").children(memText),
        h.span
          .class("whitespace-nowrap shrink-0")
          .attr("aria-hidden", "true")
          .attr("style", "color: var(--fg-subtle)")
          .children("·"),
        h.span
          .class("whitespace-nowrap shrink-0")
          .attr("style", "color: var(--fg-muted)")
          .children(fpsText),
      );
  },
});
