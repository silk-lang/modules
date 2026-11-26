import { Subscription, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Button } from "@effect/ui-kit";
import { Effect, Queue, Schema, Stream } from "effect";
import { telemetry } from "./telemetry.ts";

const TelemetryMessage = UiSchema.TaggedEnum({
  Refreshed: {},
  SetFilter: { filter: Schema.String },
  Cleared: {},
});

export const TelemetryView = Html.component({
  name: "TelemetryView",
  model: Schema.Struct({
    version: Schema.Number,
    filter: Schema.String,
  }),
  message: TelemetryMessage,
}).make({
  init: () => ({ version: 0, filter: "" }),
  update: {
    Refreshed: ($) => $.evolve({ version: (v) => v + 1 }),
    SetFilter: ($, { filter }) => $.evolve({ filter }),
    Cleared: ($) => {
      telemetry.clear();
      return $.evolve({ version: (v) => v + 1 });
    },
  },
  subscriptions: () => [
    Subscription.make(
      "telemetry-stream",
      Stream.callback<typeof TelemetryMessage.Type>((queue) =>
        Effect.acquireRelease(
          Effect.sync(() =>
            telemetry.subscribe(() => Queue.offerUnsafe(queue, TelemetryMessage.Refreshed())),
          ),
          (unsub) => Effect.sync(unsub),
        ),
      ),
    ),
  ],
  view: (h, model) => {
    const all = telemetry.getEvents();
    const needle = model.filter.trim().toLowerCase();
    const visible = needle
      ? all.filter(
          (e) =>
            e.path.toLowerCase().includes(needle) ||
            e.detail.toLowerCase().includes(needle) ||
            e.tag.toLowerCase().includes(needle),
        )
      : all;

    return h.section.class("studio-card p-5 flex flex-col gap-3.5").children(
      h.div.class("flex items-center justify-between gap-3").children(
        h.div.class("flex items-center gap-2").children(
          h.h2.class("text-sm font-semibold m-0").children("MessageLog"),
          h.span
            .class("studio-mono text-[11px]")
            .attr("style", "color: var(--fg-subtle)")
            .children("Live Effect UI stream"),
        ),
        h.div.class("flex items-center gap-2").children(
          h.span
            .class("studio-mono text-xs px-2.5 py-1 rounded-full")
            .attr("style", "background-color: var(--accent-soft); color: var(--accent)")
            .children(`${telemetry.getTotalMessages()} updates recorded`),
          Button(h, { onPress: TelemetryMessage.Cleared() })
            .class("studio-btn text-xs")
            .children("Clear"),
        ),
      ),
      h.input
        .class("studio-input")
        .attr("placeholder", "Filter log by component path, message tag, or kind…")
        .value(model.filter)
        .on("input", ({ value }) => TelemetryMessage.SetFilter({ filter: value })),
      h.div
        .class("flex flex-col gap-1.5 overflow-auto")
        .attr("style", "max-height: 440px")
        .children(
          ...(visible.length === 0
            ? [
                h.div
                  .class("text-xs text-center py-8 studio-mono")
                  .attr("style", "color: var(--fg-subtle)")
                  .children("No messages yet — interact with components in Playground or UI Kit."),
              ]
            : visible.map((entry) =>
                h.div
                  .key(String(entry.seq))
                  .class("flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-xs")
                  .attr(
                    "style",
                    "background-color: var(--surface-2); border: 1px solid var(--border)",
                  )
                  .children(
                    h.div.class("flex items-center gap-2.5").children(
                      h.span
                        .class("studio-mono text-[10px] px-2 py-0.5 rounded-md font-semibold")
                        .attr(
                          "style",
                          entry.tag === "Update"
                            ? "background-color: var(--accent-soft); color: var(--accent)"
                            : entry.tag === "Query"
                              ? "background-color: var(--cyan-soft); color: var(--cyan)"
                              : entry.tag === "Command"
                                ? "background-color: var(--amber-soft); color: var(--amber)"
                                : "background-color: var(--emerald-soft); color: var(--emerald)",
                        )
                        .children(entry.tag),
                      h.span.class("studio-mono font-medium").children(entry.detail),
                      h.span
                        .class("studio-mono")
                        .attr("style", "color: var(--fg-muted)")
                        .children(entry.path),
                    ),
                    h.div
                      .class("flex items-center gap-3 studio-mono text-[11px]")
                      .attr("style", "color: var(--fg-subtle)")
                      .children(
                        h.span.children(entry.trigger),
                        h.span.children(`#${entry.seq}`),
                        h.span.children(entry.time),
                      ),
                  ),
              )),
        ),
    );
  },
});
