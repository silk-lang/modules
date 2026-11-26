import { UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Switch, Tabs } from "@effect/ui-kit";
import { Schema } from "effect";
import { CounterCard } from "./CounterCard.ts";
import { MemoryBadge } from "./MemoryBadge.ts";
import { QueryExplorerCard } from "./QueryExplorerCard.ts";
import { StudioMessage, StudioProvider } from "./StudioProvider.ts";
import { TelemetryView } from "./TelemetryView.ts";
import { UiKitGallery } from "./UiKitGallery.ts";
import { WaveSynthCard } from "./WaveSynthCard.ts";

const ShellMessage = UiSchema.TaggedEnum({
  SelectedTab: { value: Schema.String },
  ToggledTheme: {},
});

const StudioShell = Html.component({
  name: "StudioShell",
  model: Schema.Struct({
    tab: Schema.String,
  }),
  message: ShellMessage,
  reads: { studio: StudioProvider },
}).make({
  init: () => ({ tab: "studio" }),
  update: {
    SelectedTab: ($, { value }) =>
      $.evolve({ tab: value }).send(StudioProvider, StudioMessage.BumpInteractions()),
    ToggledTheme: ($) => $.send(StudioProvider, StudioMessage.ToggleTheme()),
  },
  view: (h, model) => {
    const isLight = h.reads.studio.theme === "light";

    return Tabs(h, {
      props: {
        value: model.tab,
        tabs: [
          { value: "studio" },
          { value: "uikit" },
          { value: "log" },
        ],
      },
      onEmit: {
        Selected: ({ value }) => ShellMessage.SelectedTab({ value }),
      },
      view: (tabs) =>
        tabs.root(
          h.div.class("studio-shell", isLight ? "theme-light" : ""),
        ).children(
          // 56px translucent macOS titlebar header
          h.header.class("studio-header").children(
            // Real Effect stacked-layers logo mark
            h.div.class("flex items-center gap-2.5").children(
              h.el("svg")
                .attr("width", "24")
                .attr("height", "24")
                .attr("viewBox", "0 0 180 180")
                .attr("fill", "none")
                .children(
                  h.el("rect")
                    .attr("width", "180")
                    .attr("height", "180")
                    .attr("rx", "42")
                    .attr("fill", isLight ? "#18181b" : "#5c5cf6"),
                  h.el("path")
                    .attr("fill-rule", "evenodd")
                    .attr("clip-rule", "evenodd")
                    .attr(
                      "d",
                      "M159.997 61.2667C160.058 63.2159 159.249 64.9497 157.408 65.9741L139.241 76.0758L155.742 85.3565C157.604 86.4034 158.595 88.3813 158.44 90.3561C158.584 92.3912 157.804 94.2215 155.922 95.2819L93.4411 130.239C92.1387 130.972 90.6802 131.293 89.3417 130.925C88.7428 130.761 88.2007 130.56 87.6313 130.239L25.258 95.1599C23.396 94.113 22.4059 92.1321 22.5612 90.1573C22.4172 88.1222 23.1962 86.295 25.0785 85.2345L41.7611 75.8528L23.7754 65.8506C21.7513 64.5 20.9421 62.5 21.0032 61.0362C20.9421 59.087 21.7513 57.3531 23.5921 56.3288L87.3847 20.8554C88.7 20.1 90.3 19.9 91.6583 20.1455C92.3 20.3 92.9 20.65 93.4343 20.9789L157.225 56.4523C159.1 57.5 160.02 59.4 159.997 61.2667ZM37.8397 90.1603L90.5 120.386L143.16 90.3561L128.595 81.9958L93.3958 101.384C92.0633 102.125 91.0792 102.542 89.6313 102.252C89.0038 102.15 88.1871 101.707 87.6042 101.384L52.4787 81.812L37.8397 90.1603Z",
                    )
                    .attr("fill", "#ffffff"),
                  h.el("path")
                    .attr(
                      "d",
                      "M25.5536 118.558C26.9879 116.145 30.1597 115.33 32.6385 116.708L90.5 149.546L148.532 116.826C151.011 115.446 154.503 116.421 155.617 118.676C156.67 121.434 156.177 124.188 153.691 125.57L93.3958 159.019C92.138 159.719 90.9246 160.238 89.6313 159.887C88.8 159.65 88.0 159.25 87.6042 159.019L27.4819 125.454C24.9933 124.07 24.1162 120.984 25.5536 118.558Z",
                    )
                    .attr("fill", "#ffffff"),
                ),
              h.span.class("text-sm font-semibold tracking-tight").children("Effect UI"),
              h.span
                .class("studio-mono text-[11px]")
                .attr("style", "color: var(--fg-subtle)")
                .children("× Silk UI"),
            ),

            // Center segmented pill tabs
            tabs.list(h.div.class("studio-pill-group")).children(
              tabs.tab({ element: h.button.class("studio-tab"), value: "studio" }).children("Studio"),
              tabs.tab({ element: h.button.class("studio-tab"), value: "uikit" }).children("UI Kit"),
              tabs.tab({ element: h.button.class("studio-tab"), value: "log" }).children("Log"),
            ),

            // Right: Live macOS memory + fps pill & Theme switch
            h.div.class("flex items-center gap-3").children(
              MemoryBadge(h, {}),
              Switch(h, {
                props: { checked: isLight },
                onToggle: () => ShellMessage.ToggledTheme(),
                view: (sw) =>
                  sw.root(h.button.class("studio-switch")).children(
                    sw.thumb(h.span.class("studio-switch-thumb")),
                  ),
              }),
            ),
          ),

          // Main canvas
          h.main.class("flex-1 overflow-auto px-6 py-5").children(
            tabs.panel({ element: h.div.class("flex flex-col gap-4"), value: "studio" })?.children(
              // Minimal editorial hero strip
              h.div.class("flex items-center justify-between px-1").children(
                h.h1
                  .class("text-2xl font-bold m-0 whitespace-nowrap")
                  .attr("style", "letter-spacing: -0.03em")
                  .children(
                    "Effect UI, ",
                    h.span
                      .attr("style", "color: var(--accent-bright)")
                      .children("native."),
                  ),
                h.div.class("flex items-center gap-2").children(
                  h.span
                    .class("studio-chip")
                    .attr("style", "background-color: var(--surface-2); border: 1px solid var(--border); color: var(--fg-muted)")
                    .children("WebGPU · SilkJS · Tailwind v4"),
                  h.span
                    .class("studio-chip")
                    .attr("style", "background-color: var(--accent-soft); border: 1px solid var(--accent-border); color: var(--accent-bright)")
                    .children(`${h.reads.studio.interactions} events`),
                ),
              ),
              h.div.class("grid grid-cols-2 gap-4").children(
                CounterCard(h, {}),
                WaveSynthCard(h, {}),
              ),
              QueryExplorerCard(h, {}),
            ),
            tabs.panel({ element: h.div, value: "uikit" })?.children(
              UiKitGallery(h, {}),
            ),
            tabs.panel({ element: h.div, value: "log" })?.children(
              TelemetryView(h, {}),
            ),
          ),
        ),
    });
  },
});

export const App = Html.component({
  name: "App",
  model: Schema.Null,
  message: Schema.Never,
}).make({
  init: () => null,
  update: ($) => $.model,
  view: (h) =>
    StudioProvider(h, {
      view: () => StudioShell(h, {}),
    }),
});
