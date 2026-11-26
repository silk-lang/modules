import { Command, Subscription, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Button } from "@effect/ui-kit";
import { Effect, Schema, Stream } from "effect";
import { StudioMessage, StudioProvider } from "./StudioProvider.ts";

const CounterMessage = UiSchema.TaggedEnum({
  ClickedAdd: { amount: Schema.Number },
  ClickedResetAfterDelay: {},
  CompletedDelayReset: {},
  ClickedToggleAutoCount: {},
  Ticked: {},
});

const DelayReset = Command.make("DelayReset", { args: {} }, () =>
  Effect.sleep("1 second").pipe(Effect.as(CounterMessage.CompletedDelayReset())),
);

export const CounterCard = Html.component({
  name: "CounterCard",
  model: Schema.Struct({
    count: Schema.Number,
    isAutoCounting: Schema.Boolean,
  }),
  message: CounterMessage,
}).make({
  init: () => ({ count: 42, isAutoCounting: false }),
  update: {
    ClickedAdd: ($, { amount }) =>
      $.evolve({ count: (c) => c + amount }).send(
        StudioProvider,
        StudioMessage.BumpInteractions(),
      ),
    ClickedResetAfterDelay: ($) =>
      $.run(DelayReset.make({})).send(
        StudioProvider,
        StudioMessage.BumpInteractions(),
      ),
    CompletedDelayReset: ($) => $.evolve({ count: 0 }),
    ClickedToggleAutoCount: ($) =>
      $.evolve({ isAutoCounting: (on) => !on }).send(
        StudioProvider,
        StudioMessage.BumpInteractions(),
      ),
    Ticked: ($) => $.evolve({ count: (c) => c + 1 }),
  },
  subscriptions: ({ model }) => [
    model.isAutoCounting &&
      Subscription.make(
        "auto-tick",
        Stream.tick("1 second").pipe(
          Stream.drop(1),
          Stream.map(() => CounterMessage.Ticked()),
        ),
      ),
  ],
  view: (h, model) => {
    const resetting = h.isRunning(DelayReset);
    const badgeText = resetting
      ? "Command · 1s"
      : model.isAutoCounting
        ? "Stream.tick"
        : "Elm Component";

    return h.section.class("studio-card p-5 flex flex-col gap-4").children(
      h.div.class("flex items-center justify-between gap-2").children(
        h.div.class("flex items-center gap-2").children(
          h.h2.class("text-sm font-semibold m-0").children("Counter"),
          h.span
            .class("studio-mono text-[11px]")
            .attr("style", "color: var(--fg-subtle)")
            .children("Command + Stream"),
        ),
        h.span
          .class("studio-chip")
          .attr(
            "style",
            resetting
              ? "background-color: var(--amber-soft); color: var(--amber)"
              : model.isAutoCounting
                ? "background-color: var(--emerald-soft); color: var(--emerald)"
                : "background-color: var(--accent-soft); color: var(--accent-bright)",
          )
          .children(
            model.isAutoCounting && !resetting && h.span.class("studio-beacon"),
            badgeText,
          ),
      ),
      h.div.class("studio-counter-stage").children(
        h.div.class(
          "studio-counter-glow",
          resetting
            ? "studio-counter-glow-reset"
            : model.isAutoCounting
              ? "studio-counter-glow-live"
              : "",
        ),
        h.output.class("studio-counter-num").children(String(model.count)),
      ),
      h.div.class("grid grid-cols-3 gap-2").children(
        Button(h, { onPress: CounterMessage.ClickedAdd({ amount: -1 }) })
          .class("studio-btn studio-mono")
          .children("−1"),
        Button(h, { onPress: CounterMessage.ClickedAdd({ amount: 1 }) })
          .class("studio-btn studio-btn-primary studio-mono")
          .children("+1"),
        Button(h, { onPress: CounterMessage.ClickedAdd({ amount: 5 }) })
          .class("studio-btn studio-mono")
          .children("+5"),
      ),
      h.div.class("grid grid-cols-2 gap-2").children(
        Button(h, {
          props: { disabled: resetting, focusableWhenDisabled: true },
          onPress: CounterMessage.ClickedResetAfterDelay(),
        })
          .class("studio-btn")
          .children(resetting ? "Resetting…" : "Reset in 1s"),
        Button(h, { onPress: CounterMessage.ClickedToggleAutoCount() })
          .class(
            "studio-btn",
            model.isAutoCounting ? "studio-btn-emerald" : "",
          )
          .children(model.isAutoCounting ? "Stop Stream" : "Auto-count"),
      ),
    );
  },
});
