import { UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import {
  Accordion,
  AccordionItem,
  Checkbox,
  Dialog,
  Meter,
  Progress,
  RadioGroup,
  Slider,
  Switch,
} from "@effect/ui-kit";
import { Schema } from "effect";
import { StudioMessage, StudioProvider } from "./StudioProvider.ts";

const GalleryMessage = UiSchema.TaggedEnum({
  SetBackend: { value: Schema.String },
  SetProgress: { value: Schema.Number },
  SetCheckedGpu: { checked: Schema.Boolean },
  SetCheckedHmr: { checked: Schema.Boolean },
  SetCheckedA11y: { checked: Schema.Boolean },
  SetAccordion: { value: Schema.Array(Schema.String) },
  SetDialogOpen: { open: Schema.Boolean },
});

const singleValue = (v: number | readonly number[]): number =>
  typeof v === "number" ? v : (v[0] ?? 0);

const FAQ = [
  {
    id: "how",
    title: "Native Silk UI Tree",
    body: "Unmodified @effect/ui + @effect/ui-kit rendered straight to WebGPU — no Electron, no Chromium.",
  },
  {
    id: "css",
    title: "Compiled Tailwind CSS v4",
    body: "Backdrop blur, gradients, shadows, keyframes, and custom properties compiled ahead of time to app.sheet.",
  },
  {
    id: "mem",
    title: "Single-Process Footprint",
    body: "Live macOS phys_footprint in the header via @silkui/core memoryUsage().",
  },
] as const;

export const UiKitGallery = Html.component({
  name: "UiKitGallery",
  model: Schema.Struct({
    backend: Schema.String,
    progress: Schema.Number,
    gpu: Schema.Boolean,
    hmr: Schema.Boolean,
    a11y: Schema.Boolean,
    accordion: Schema.Array(Schema.String),
    dialogOpen: Schema.Boolean,
  }),
  message: GalleryMessage,
  reads: { studio: StudioProvider },
}).make({
  init: () => ({
    backend: "webgpu",
    progress: 74,
    gpu: true,
    hmr: true,
    a11y: true,
    accordion: ["how"],
    dialogOpen: false,
  }),
  update: {
    SetBackend: ($, { value }) =>
      $.evolve({ backend: value }).send(StudioProvider, StudioMessage.BumpInteractions()),
    SetProgress: ($, { value }) => $.evolve({ progress: value }),
    SetCheckedGpu: ($, { checked }) =>
      $.evolve({ gpu: checked }).send(StudioProvider, StudioMessage.BumpInteractions()),
    SetCheckedHmr: ($, { checked }) =>
      $.evolve({ hmr: checked }).send(StudioProvider, StudioMessage.BumpInteractions()),
    SetCheckedA11y: ($, { checked }) =>
      $.evolve({ a11y: checked }).send(StudioProvider, StudioMessage.BumpInteractions()),
    SetAccordion: ($, { value }) => $.evolve({ accordion: value }),
    SetDialogOpen: ($, { open }) =>
      $.evolve({ dialogOpen: open }).send(StudioProvider, StudioMessage.BumpInteractions()),
  },
  view: (h, model) =>
    h.div.class("grid grid-cols-2 gap-4").children(
      // Card 1: RadioGroup + Checkboxes
      h.section.class("studio-card p-5 flex flex-col gap-4").children(
        h.div.class("flex items-center justify-between").children(
          h.h2.class("text-sm font-semibold m-0").children("Selection"),
          h.span
            .class("studio-mono text-[11px]")
            .attr("style", "color: var(--fg-subtle)")
            .children("RadioGroup · Checkbox · Switch"),
        ),
        RadioGroup(h, {
          props: {
            value: model.backend,
            items: [{ value: "webgpu" }, { value: "metal" }, { value: "canvas2d" }],
          },
          onEmit: {
            Picked: ({ value }) => GalleryMessage.SetBackend({ value }),
          },
          view: (rg) =>
            rg.root(h.div.class("flex items-center gap-2")).children(
              ...([
                ["webgpu", "WebGPU"],
                ["metal", "Metal"],
                ["canvas2d", "Canvas 2D"],
              ] as const).map(([value, label]) =>
                rg.radio({ element: h.button.class("studio-radio flex-1 justify-center"), value }).children(
                  h.span
                    .class("inline-block w-2 h-2 rounded-full")
                    .attr(
                      "style",
                      model.backend === value
                        ? "background-color: var(--accent-bright); box-shadow: 0 0 8px var(--accent-glow)"
                        : "background-color: var(--border-strong)",
                    ),
                  label,
                ),
              ),
            ),
        }),
        h.div.class("flex flex-col gap-2.5").children(
          ...[
            {
              key: "gpu",
              checked: model.gpu,
              label: "GPU retained tree",
              onToggle: (checked: boolean) => GalleryMessage.SetCheckedGpu({ checked }),
            },
            {
              key: "hmr",
              checked: model.hmr,
              label: "Compiled CSS HMR",
              onToggle: (checked: boolean) => GalleryMessage.SetCheckedHmr({ checked }),
            },
            {
              key: "a11y",
              checked: model.a11y,
              label: "Native AccessKit tree",
              onToggle: (checked: boolean) => GalleryMessage.SetCheckedA11y({ checked }),
            },
          ].map((item) =>
            h.div.key(item.key).class("flex items-center gap-2.5").children(
              Checkbox(h, {
                key: item.key,
                props: { checked: item.checked },
                onEmit: { Toggled: ({ checked }) => item.onToggle(checked) },
                view: (cb) =>
                  cb.root(h.button.class("studio-checkbox")).children(
                    cb.indicator(h.span.class("inline-flex items-center justify-center")).children(
                      cb.checked &&
                        h.el("svg")
                          .attr("width", "12")
                          .attr("height", "12")
                          .attr("viewBox", "0 0 14 14")
                          .attr("fill", "none")
                          .children(
                            h.el("path")
                              .attr("d", "M3 7.2L5.8 10L11 4.2")
                              .attr("stroke", "#ffffff")
                              .attr("stroke-width", "2")
                              .attr("stroke-linecap", "round")
                              .attr("stroke-linejoin", "round"),
                          ),
                    ),
                  ),
              }),
              h.span.class("text-xs").children(item.label),
            ),
          ),
        ),
        h.div
          .class("flex items-center justify-between pt-3 mt-auto")
          .attr("style", "border-top: 1px solid var(--border)")
          .children(
            h.span
              .class("studio-mono text-xs")
              .attr("style", "color: var(--fg-muted)")
              .children(`Theme · ${h.reads.studio.theme}`),
            Switch(h, {
              props: { checked: h.reads.studio.theme === "light" },
              onToggle: () => undefined,
              view: (sw) =>
                sw.root(h.button.class("studio-switch")).attr("disabled", "").children(
                  sw.thumb(h.span.class("studio-switch-thumb")),
                ),
            }),
          ),
      ),

      // Card 2: Slider + Progress + Meter + Dialog
      h.section.class("studio-card p-5 flex flex-col gap-4").children(
        h.div.class("flex items-center justify-between").children(
          h.h2.class("text-sm font-semibold m-0").children("Meters & Dialog"),
          h.span
            .class("studio-chip")
            .attr("style", "background-color: var(--accent-soft); color: var(--accent-bright)")
            .children(`${Math.round(model.progress)}%`),
        ),
        Slider(h, {
          key: "budget",
          props: { value: model.progress, min: 0, max: 100, step: 1 },
          onEmit: {
            Moved: ({ value }) => GalleryMessage.SetProgress({ value: singleValue(value) }),
            Committed: ({ value }) => GalleryMessage.SetProgress({ value: singleValue(value) }),
          },
          view: (sl) =>
            sl.root(h.div.class("flex flex-col gap-1")).children(
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
        Progress(h, {
          props: { value: model.progress, min: 0, max: 100 },
          view: (pr) =>
            pr.root(h.div.class("flex flex-col gap-1.5")).children(
              h.div.class("flex items-center justify-between text-xs").children(
                pr.label(h.span).attr("style", "color: var(--fg-muted)").children("Progress"),
                pr.value(h.span.class("studio-mono")).children(`${Math.round(pr.percentage ?? 0)}%`),
              ),
              pr.track(h.div.class("w-full h-2 rounded-full overflow-hidden"))
                .attr("style", "background-color: var(--surface-2); border: 1px solid var(--border)")
                .children(
                  pr.indicator(h.div.class("studio-progress-fill")).attr(
                    "style",
                    `width: ${pr.percentage ?? 0}%`,
                  ),
                ),
            ),
        }),
        Meter(h, {
          props: { value: model.progress, min: 0, max: 100 },
          view: (mt) =>
            mt.root(h.div.class("flex flex-col gap-1.5")).children(
              h.div.class("flex items-center justify-between text-xs").children(
                mt.label(h.span).attr("style", "color: var(--fg-muted)").children("Headroom"),
                mt.value(h.span.class("studio-mono")).children(
                  model.progress > 85 ? "Peak" : model.progress > 45 ? "Optimal" : "Idle",
                ),
              ),
              mt.track(h.div.class("w-full h-2 rounded-full overflow-hidden"))
                .attr("style", "background-color: var(--surface-2); border: 1px solid var(--border)")
                .children(
                  mt.indicator(h.div.class("h-full rounded-full")).attr(
                    "style",
                    `width: ${mt.percentage}%; background-color: ${
                      model.progress > 85
                        ? "var(--rose)"
                        : model.progress > 45
                          ? "var(--emerald)"
                          : "var(--amber)"
                    }`,
                  ),
                ),
            ),
        }),
        Dialog(h, {
          props: { open: model.dialogOpen },
          onEmit: {
            RequestedOpen: () => GalleryMessage.SetDialogOpen({ open: true }),
            RequestedClose: () => GalleryMessage.SetDialogOpen({ open: false }),
            Settled: () => undefined,
          },
          view: (dialog) =>
            h.div.class("pt-1 mt-auto").children(
              dialog.trigger(h.button.class("studio-btn studio-btn-primary w-full")).children(
                "Open Frosted Dialog",
              ),
              dialog.portal(h.dialog)?.children(
                dialog.backdrop(h.div.class("studio-dialog-backdrop")),
                dialog.viewport(h.div.class("studio-dialog-viewport")).children(
                  dialog.popup(h.div.class("studio-dialog-popup flex flex-col gap-3.5")).children(
                    h.div.class("flex items-center justify-between").children(
                      dialog.title(h.h3.class("text-base font-semibold m-0")).children(
                        "@effect/ui-kit Dialog",
                      ),
                      h.span
                        .class("studio-chip")
                        .attr("style", "background-color: var(--accent-soft); color: var(--accent-bright)")
                        .children("blur(10px)"),
                    ),
                    dialog.description(h.p.class("text-xs m-0"))
                      .attr("style", "color: var(--fg-muted); line-height: 1.55")
                      .children(
                        "Native Silk UI backdrop-filter blur, focus trap, and Escape dismissal — zero browser chrome.",
                      ),
                    h.div
                      .class("p-3 rounded-xl studio-mono text-xs flex items-center justify-between")
                      .attr("style", "background-color: var(--surface-2); border: 1px solid var(--border)")
                      .children(
                        h.span.children(`backend: ${model.backend}`),
                        h.span.attr("style", "color: var(--accent-bright)").children(`${Math.round(model.progress)}%`),
                      ),
                    h.div.class("flex items-center justify-end gap-2").children(
                      dialog.close(h.button.class("studio-btn studio-btn-primary")).children("Done"),
                    ),
                  ),
                ),
              ),
            ),
        }),
      ),

      // Card 3: Accordion
      h.section.class("studio-card p-5 col-span-2 flex flex-col gap-3").children(
        h.div.class("flex items-center justify-between").children(
          h.h2.class("text-sm font-semibold m-0").children("Accordion"),
          h.span
            .class("studio-mono text-[11px]")
            .attr("style", "color: var(--fg-subtle)")
            .children("@effect/ui-kit"),
        ),
        Accordion(h, {
          props: { value: model.accordion, multiple: true },
          onEmit: {
            Toggled: ({ value }) => GalleryMessage.SetAccordion({ value }),
          },
          view: (acc) =>
            acc.root(h.div.class("flex flex-col gap-2")).children(
              ...FAQ.map((item) =>
                AccordionItem(h, {
                  key: item.id,
                  props: { value: item.id },
                  onEmit: {
                    Toggled: () => undefined,
                    Settled: () => undefined,
                  },
                  view: (ai) =>
                    ai.root(h.div.class("flex flex-col gap-1")).children(
                      ai.header(h.h3.class("m-0")).children(
                        ai.trigger(h.button.class("studio-accordion-trigger")).children(
                          h.span.children(item.title),
                          h.span
                            .class("studio-mono text-xs")
                            .attr("style", "color: var(--accent-bright)")
                            .children(ai.open ? "−" : "+"),
                        ),
                      ),
                      ai.panel(h.div.class("px-3.5 py-2 text-xs"))?.attr(
                        "style",
                        "color: var(--fg-muted); line-height: 1.5",
                      ).children(item.body),
                    ),
                }),
              ),
            ),
        }),
      ),
    ),
});
