import { UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Schema } from "effect";

export const StudioMessage = UiSchema.TaggedEnum({
  SetTheme: { theme: Schema.Literals(["dark", "light"]) },
  ToggleTheme: {},
  BumpInteractions: {},
});

export const StudioProvider = Html.component({
  name: "StudioProvider",
  model: Schema.Struct({
    theme: Schema.Literals(["dark", "light"]),
    interactions: Schema.Number,
  }),
  message: StudioMessage,
  shares: {
    value: ({ model }) => ({
      theme: model.theme,
      interactions: model.interactions,
    }),
    receives: ["SetTheme", "ToggleTheme", "BumpInteractions"],
  },
}).make({
  init: () => ({ theme: "dark", interactions: 0 }),
  update: {
    SetTheme: ($, { theme }) => $.evolve({ theme }),
    ToggleTheme: ($) =>
      $.evolve({
        theme: (t) => (t === "dark" ? "light" : "dark"),
        interactions: (n) => n + 1,
      }),
    BumpInteractions: ($) => $.evolve({ interactions: (n) => n + 1 }),
  },
});
