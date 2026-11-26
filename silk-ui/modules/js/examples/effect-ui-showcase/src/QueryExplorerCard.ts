import { Component, Query, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

const Item = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  tag: Schema.Literals(["@effect/ui", "@effect/ui-kit", "@silkui/core"]),
  note: Schema.String,
});

const ITEMS: readonly (typeof Item.Type)[] = [
  {
    id: "components",
    title: "Elm Components",
    tag: "@effect/ui",
    note: "Isolated Model, update & view",
  },
  {
    id: "providers",
    title: "Providers & Queries",
    tag: "@effect/ui",
    note: "shares / reads / Query cache",
  },
  {
    id: "uikit",
    title: "41 Headless Primitives",
    tag: "@effect/ui-kit",
    note: "Tabs, Slider, Dialog, Switch",
  },
  {
    id: "gpu",
    title: "WebGPU + Compiled CSS",
    tag: "@silkui/core",
    note: "Native window · zero Chromium",
  },
];

let fetchCount = 0;

class SearchCatalog extends Query.Service<SearchCatalog>()("SearchCatalog", {
  args: { q: Schema.String },
  success: Schema.Struct({
    items: Schema.Array(Item),
    fetchId: Schema.Number,
  }),
  error: Schema.Never,
  staleTime: "2 minutes",
}) {
  static readonly layer = this.toLayer(
    Effect.succeed(({ q }) =>
      Effect.sleep(q.trim() ? "90 millis" : "10 millis").pipe(
        Effect.map(() => {
          const needle = q.trim().toLowerCase();
          const items = needle
            ? ITEMS.filter(
                (i) =>
                  i.title.toLowerCase().includes(needle) ||
                  i.tag.toLowerCase().includes(needle) ||
                  i.note.toLowerCase().includes(needle),
              )
            : ITEMS;
          return { items, fetchId: ++fetchCount };
        }),
      ),
    ),
  );
}

const ExplorerMessage = UiSchema.TaggedEnum({
  Typed: { q: Schema.String },
  Picked: { q: Schema.String },
});

export const QueryExplorerCard = Html.component({
  name: "QueryExplorerCard",
  model: Schema.Struct({ q: Schema.String }),
  message: ExplorerMessage,
  queries: {
    results: {
      query: SearchCatalog,
      args: ({ model }) => ({ q: model.q }),
      debounce: "120 millis",
    },
  },
})
  .make({
    init: () => ({ q: "" }),
    update: {
      Typed: ($, { q }) => $.evolve({ q }),
      Picked: ($, { q }) => $.evolve({ q }),
    },
    view: (h, model) =>
      h.section.class("studio-card p-4 flex flex-col gap-3").children(
        h.div.class("flex items-center gap-2.5").children(
          h.input
            .class("studio-input flex-1")
            .attr("placeholder", "Filter stack… (debounced 120ms)")
            .value(model.q)
            .on("input", ({ value }) => ExplorerMessage.Typed({ q: value })),
          h.div.class("flex items-center gap-1.5 shrink-0").children(
            ...([
              ["", "All"],
              ["@effect/ui", "Effect UI"],
              ["@silkui/core", "Silk UI"],
            ] as const).map(([q, label]) =>
              h.button
                .key(q || "all")
                .class(
                  "studio-btn py-1.5 px-2.5 text-xs",
                  model.q === q ? "studio-btn-active" : "",
                )
                .on("click", ExplorerMessage.Picked({ q }))
                .children(label),
            ),
          ),
          AsyncResult.match(h.queries.results, {
            onInitial: () =>
              h.span
                .class("studio-chip")
                .attr("style", "background-color: var(--amber-soft); color: var(--amber)")
                .children("Fetching…"),
            onFailure: () =>
              h.span
                .class("studio-chip")
                .attr("style", "background-color: var(--rose-soft); color: var(--rose)")
                .children("Error"),
            onSuccess: ({ value, waiting }) =>
              h.span
                .class("studio-chip")
                .attr(
                  "style",
                  waiting
                    ? "background-color: var(--amber-soft); color: var(--amber)"
                    : "background-color: var(--emerald-soft); color: var(--emerald)",
                )
                .children(waiting ? "Syncing" : `Cache #${value.fetchId}`),
          }),
        ),
        AsyncResult.match(h.queries.results, {
          onInitial: () => h.div.class("h-14"),
          onFailure: () => h.div,
          onSuccess: ({ value }) =>
            h.div.class("grid grid-cols-4 gap-2.5").children(
              ...value.items.map((item) =>
                h.div
                  .key(item.id)
                  .class("p-3 rounded-xl flex flex-col gap-1")
                  .attr(
                    "style",
                    "background-color: var(--surface-2); border: 1px solid var(--border)",
                  )
                  .children(
                    h.span
                      .class("studio-mono text-[10px]")
                      .attr(
                        "style",
                        item.tag === "@silkui/core"
                          ? "color: var(--cyan)"
                          : "color: var(--accent-bright)",
                      )
                      .children(item.tag),
                    h.span.class("text-xs font-semibold").children(item.title),
                    h.span
                      .class("text-[11px]")
                      .attr("style", "color: var(--fg-muted)")
                      .children(item.note),
                  ),
              ),
            ),
        }),
      ),
  })
  .pipe(Component.provide(SearchCatalog.layer));
