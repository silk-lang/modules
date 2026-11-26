import assert from "node:assert/strict";
import { after, test } from "node:test";
import { installMock } from "./mock.js";

const ui = installMock();
globalThis.requestAnimationFrame ??= (fn) => setTimeout(() => fn(performance.now()), 0);
globalThis.cancelAnimationFrame ??= (id) => clearTimeout(id);
// Provide a minimal selector query implementation on the mock so getElementById,
// querySelector, closest, and matches work across Effect UI & @effect/ui-kit tests.
const { nodeById } = await import("../src/index.js");

function matchSimple(node, selector) {
  if (!node || node.nodeType !== 1) return false;
  selector = selector.trim();
  if (selector === "*") return true;
  if (selector === ":disabled") return node.hasAttribute("disabled");
  if (selector === ":focus-visible" || selector === ":focus") return false;
  if (selector === ":popover-open") return Boolean(node._popoverOpen);
  if (selector === ":modal") return Boolean(node._modal);
  const parts = selector.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return parts.some((p) => matchSimple(node, p));
  const tokens = selector.match(/#[-\w]+|\.[-\w]+|\[[^\]]+\]|^[a-zA-Z][\w-]*/g);
  if (!tokens || tokens.join("") !== selector) return false;
  for (const token of tokens) {
    if (token.startsWith("#")) {
      if (node.id !== token.slice(1)) return false;
    } else if (token.startsWith(".")) {
      if (!node.classList?.contains(token.slice(1))) return false;
    } else if (token.startsWith("[")) {
      const m = token.match(/^\[\s*([\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\s*\]$/);
      if (!m) return false;
      const [, attr, dq, sq, bare] = m;
      const val = dq ?? sq ?? bare;
      if (val === undefined) {
        if (!node.hasAttribute(attr)) return false;
      } else if (node.getAttribute(attr) !== val) {
        return false;
      }
    } else {
      if (node.localName !== token.toLowerCase()) return false;
    }
  }
  return true;
}

ui.native.query = (mode, nodeId, selector) => {
  const start = nodeById(nodeId);
  if (!start) return mode === 3 ? "" : 0;
  if (mode === 0) return matchSimple(start, selector) ? 1 : 0;
  if (mode === 1) {
    for (let n = start; n; n = n.parentNode) if (matchSimple(n, selector)) return n.nodeId;
    return 0;
  }
  const found = [];
  const walk = (parent) => {
    for (const child of parent.childNodes ?? []) {
      if (child.nodeType === 1) {
        if (matchSimple(child, selector)) {
          found.push(child.nodeId);
          if (mode === 2) return true;
        }
        if (walk(child)) return true;
      }
    }
    return false;
  };
  walk(start);
  return mode === 2 ? (found[0] ?? 0) : found.join(",");
};

await import("../src/globals.js");
const { Command, Component, Query, Subscription, UiSchema } = await import("@effect/ui");
const { BrowserHost, Html } = await import("@effect/ui/html");
const { Button, Dialog, Switch, Tabs } = await import("@effect/ui-kit");
const { Effect, Fiber, Layer, Schema, Stream } = await import("effect");
const { AsyncResult } = await import("effect/reactivity");

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

function makeHost(id) {
  const el = document.createElement("div");
  el.id = id;
  document.body.appendChild(el);
  return el;
}

function mountApp(component, host) {
  return Effect.runFork(Layer.launch(BrowserHost.mount(component, {}, host)));
}

after(() => setImmediate(() => process.exit()));

test("Effect UI counter mounts directly on @silkui/core/globals, handles clicks and async commands", async () => {
  const host = makeHost("test-counter");
  const Msg = UiSchema.TaggedEnum({
    ClickedAdd: { amount: Schema.Number },
    ClickedDelayedReset: {},
    CompletedReset: {},
  });

  const DelayReset = Command.make("DelayReset", { args: {} }, () =>
    Effect.sleep("15 millis").pipe(Effect.as(Msg.CompletedReset())),
  );

  const Counter = Html.component({
    name: "Counter",
    model: Schema.Struct({ count: Schema.Number }),
    message: Msg,
  }).make({
    init: () => ({ count: 0 }),
    update: {
      ClickedAdd: ($, { amount }) => $.evolve({ count: (c) => c + amount }),
      ClickedDelayedReset: ($) => $.run(DelayReset.make({})),
      CompletedReset: ($) => $.evolve({ count: 0 }),
    },
    view: (h, model) =>
      h.div.id("counter-box").children(
        h.output.id("counter-value").children(String(model.count)),
        Button(h, { onPress: Msg.ClickedAdd({ amount: 1 }) }).id("btn-inc").children("+1"),
        Button(h, {
          props: { disabled: h.isRunning(DelayReset), focusableWhenDisabled: true },
          onPress: Msg.ClickedDelayedReset(),
        })
          .id("btn-reset")
          .children(h.isRunning(DelayReset) ? "Resetting" : "Reset"),
      ),
  });

  const fiber = mountApp(Counter, host);
  await tick(30);

  const valueEl = document.getElementById("counter-value");
  const incBtn = document.getElementById("btn-inc");
  const resetBtn = document.getElementById("btn-reset");
  assert.ok(valueEl && incBtn && resetBtn);
  assert.equal(valueEl.textContent, "0");

  ui.click(incBtn.nodeId);
  await tick(20);
  assert.equal(valueEl.textContent, "1");

  ui.click(incBtn.nodeId);
  await tick(20);
  assert.equal(valueEl.textContent, "2");

  ui.click(resetBtn.nodeId);
  await tick(5);
  assert.equal(resetBtn.textContent, "Resetting");

  await tick(40);
  assert.equal(valueEl.textContent, "0");
  assert.equal(resetBtn.textContent, "Reset");

  await Effect.runPromise(Fiber.interrupt(fiber));
  host.remove();
});

test("Effect UI providers share state across nested components and handle $.send", async () => {
  const host = makeHost("test-provider");
  const ThemeMsg = UiSchema.TaggedEnum({ Toggled: {} });
  const ThemeProvider = Html.component({
    name: "ThemeProvider",
    model: Schema.Struct({ dark: Schema.Boolean }),
    message: ThemeMsg,
    shares: {
      value: ({ model }) => ({ dark: model.dark }),
      receives: ["Toggled"],
    },
  }).make({
    init: () => ({ dark: true }),
    update: {
      Toggled: ($) => $.evolve({ dark: (d) => !d }),
    },
  });

  const Badge = Html.component({
    name: "Badge",
    model: Schema.Null,
    message: Schema.Never,
    reads: { theme: ThemeProvider },
  }).make({
    init: () => null,
    update: ($) => $.model,
    view: (h) => h.span.id("theme-badge").children(h.reads.theme.dark ? "dark" : "light"),
  });

  const ToggleMsg = UiSchema.TaggedEnum({ Pressed: {} });
  const ToggleBtn = Html.component({
    name: "ToggleBtn",
    model: Schema.Null,
    message: ToggleMsg,
  }).make({
    init: () => null,
    update: {
      Pressed: ($) => $.send(ThemeProvider, ThemeMsg.Toggled()),
    },
    view: (h) => h.button.id("theme-toggle").on("click", ToggleMsg.Pressed()).children("Toggle"),
  });

  const App = Html.component({
    name: "ThemeApp",
    model: Schema.Null,
    message: Schema.Never,
  }).make({
    init: () => null,
    update: ($) => $.model,
    view: (h) =>
      ThemeProvider(h, {
        view: () => h.div.children(Badge(h, {}), ToggleBtn(h, {})),
      }),
  });

  const fiber = mountApp(App, host);
  await tick(30);

  assert.equal(document.getElementById("theme-badge").textContent, "dark");
  ui.click(document.getElementById("theme-toggle").nodeId);
  await tick(25);
  assert.equal(document.getElementById("theme-badge").textContent, "light");

  await Effect.runPromise(Fiber.interrupt(fiber));
  host.remove();
});

test("Effect UI controlled inputs, inline SVG, and CSSOM style indexing work on @silkui/core/globals", async () => {
  const host = makeHost("test-controls");
  const Msg = UiSchema.TaggedEnum({ Typed: { value: Schema.String } });

  const FormDemo = Html.component({
    name: "FormDemo",
    model: Schema.Struct({ draft: Schema.String }),
    message: Msg,
  }).make({
    init: () => ({ draft: "" }),
    update: {
      Typed: ($, { value }) => $.evolve({ draft: value.toUpperCase() }),
    },
    view: (h, model) =>
      h.div.children(
        h.input
          .id("draft-input")
          .value(model.draft)
          .on("input", ({ value }) => Msg.Typed({ value })),
        h.div.id("styled-box").attr("style", model.draft ? "color: red; opacity: 1" : "color: blue"),
        h.el("svg").attr("id", "icon-svg").attr("viewBox", "0 0 24 24").children(
          h.el("path").attr("d", model.draft ? "M4 12h16" : "M12 4v16"),
        ),
      ),
  });

  const fiber = mountApp(FormDemo, host);
  await tick(30);

  const input = document.getElementById("draft-input");
  const box = document.getElementById("styled-box");
  const svg = document.getElementById("icon-svg");

  box.style.setProperty("margin-top", "8px");
  assert.ok(box.style.length >= 2);
  assert.equal(typeof box.style[0], "string");

  ui.input(input.nodeId, "silk");
  await tick(30);
  assert.equal(input.value, "SILK");
  assert.equal(box.style.getPropertyValue("margin-top"), "8px");
  assert.ok(svg.outerHTML.includes('d="M4 12h16"'), svg.outerHTML);

  await Effect.runPromise(Fiber.interrupt(fiber));
  host.remove();
});

test("Effect UI queries fetch, cache, and render via AsyncResult.match", async () => {
  const host = makeHost("test-query");
  class GreetingQuery extends Query.Service()("GreetingQuery", {
    args: { name: Schema.String },
    success: Schema.String,
    error: Schema.Never,
    staleTime: "1 minute",
  }) {
    static readonly = this.toLayer(Effect.succeed(({ name }) => Effect.succeed(`Hello, ${name}!`)));
  }

  const Greeter = Html.component({
    name: "Greeter",
    model: Schema.Null,
    message: Schema.Never,
    queries: {
      greeting: {
        query: GreetingQuery,
        args: () => ({ name: "Silk UI" }),
      },
    },
  })
    .make({
      init: () => null,
      update: ($) => $.model,
      view: (h) =>
        h.p.id("query-out").children(
          AsyncResult.match(h.queries.greeting, {
            onInitial: () => "Loading",
            onFailure: () => "Error",
            onSuccess: ({ value }) => value,
          }),
        ),
    })
    .pipe(Component.provide(GreetingQuery.readonly));

  const fiber = mountApp(Greeter, host);
  await tick(40);
  assert.equal(document.getElementById("query-out").textContent, "Hello, Silk UI!");

  await Effect.runPromise(Fiber.interrupt(fiber));
  host.remove();
});

test("@effect/ui-kit Switch, Tabs, and Dialog open/close directly on @silkui/core/globals", async () => {
  const host = makeHost("test-uikit");
  const Msg = UiSchema.TaggedEnum({
    ChangedSwitch: { checked: Schema.Boolean },
    ChangedTab: { value: Schema.String },
    ChangedDialog: { open: Schema.Boolean },
  });

  const KitDemo = Html.component({
    name: "KitDemo",
    model: Schema.Struct({
      enabled: Schema.Boolean,
      tab: Schema.String,
      dialogOpen: Schema.Boolean,
    }),
    message: Msg,
  }).make({
    init: () => ({ enabled: false, tab: "one", dialogOpen: false }),
    update: {
      ChangedSwitch: ($, { checked }) => $.evolve({ enabled: checked }),
      ChangedTab: ($, { value }) => $.evolve({ tab: value }),
      ChangedDialog: ($, { open }) => $.evolve({ dialogOpen: open }),
    },
    view: (h, model) =>
      h.div.children(
        Switch(h, {
          props: { checked: model.enabled },
          onToggle: ({ checked }) => Msg.ChangedSwitch({ checked }),
          view: (sw) =>
            sw.root(h.button).id("kit-switch").children(sw.thumb(h.span).children(sw.checked ? "ON" : "OFF")),
        }),
        Tabs(h, {
          props: { value: model.tab, tabs: [{ value: "one" }, { value: "two" }] },
          onEmit: { Selected: ({ value }) => Msg.ChangedTab({ value }) },
          view: (tabs) =>
            tabs.root(h.div).children(
              tabs.list(h.div).children(
                tabs.tab({ element: h.button, value: "one" }).id("tab-one").children("One"),
                tabs.tab({ element: h.button, value: "two" }).id("tab-two").children("Two"),
              ),
              tabs.panel({ element: h.div, value: "one" })?.id("panel-one").children("Panel 1"),
              tabs.panel({ element: h.div, value: "two" })?.id("panel-two").children("Panel 2"),
            ),
        }),
        Dialog(h, {
          props: { open: model.dialogOpen },
          onEmit: {
            RequestedOpen: () => Msg.ChangedDialog({ open: true }),
            RequestedClose: () => Msg.ChangedDialog({ open: false }),
            Settled: () => undefined,
          },
          view: (dialog) =>
            h.div.children(
              dialog.trigger(h.button).id("dialog-open-btn").children("Open"),
              dialog.portal(h.dialog)?.id("dialog-portal").children(
                dialog.viewport(h.div).children(
                  dialog.popup(h.div).children(
                    dialog.title(h.h2).children("Modal Title"),
                    dialog.close(h.button).id("dialog-close-btn").children("Close"),
                  ),
                ),
              ),
            ),
        }),
      ),
  });

  const fiber = mountApp(KitDemo, host);
  await tick(40);

  const sw = document.getElementById("kit-switch");
  assert.equal(sw.getAttribute("aria-checked"), "false");
  ui.click(sw.nodeId);
  await tick(30);
  assert.equal(sw.getAttribute("aria-checked"), "true");

  assert.ok(document.getElementById("panel-one"));
  assert.equal(document.getElementById("panel-two"), null);
  ui.click(document.getElementById("tab-two").nodeId);
  await tick(30);
  assert.ok(document.getElementById("panel-two"));
  assert.equal(document.getElementById("panel-two").textContent, "Panel 2");

  assert.equal(document.getElementById("dialog-portal"), null);
  ui.click(document.getElementById("dialog-open-btn").nodeId);
  await tick(40);
  const portal = document.getElementById("dialog-portal");
  assert.ok(portal, "dialog portal should mount when opened");
  assert.equal(portal.matches(":popover-open"), true, "dialog portal should match :popover-open");

  ui.click(document.getElementById("dialog-close-btn").nodeId);
  await tick(40);
  assert.equal(document.getElementById("dialog-portal"), null, "dialog portal should unmount on close");

  await Effect.runPromise(Fiber.interrupt(fiber));
  host.remove();
});

test("Effect UI subscriptions emit values into component update", async () => {
  const host = makeHost("test-sub");
  const Msg = UiSchema.TaggedEnum({ Ticked: {} });
  const Ticker = Html.component({
    name: "Ticker",
    model: Schema.Struct({ ticks: Schema.Number }),
    message: Msg,
  }).make({
    init: () => ({ ticks: 0 }),
    update: {
      Ticked: ($) => $.evolve({ ticks: (n) => n + 1 }),
    },
    subscriptions: () => [
      Subscription.make("fast-tick", Stream.tick("10 millis").pipe(Stream.map(() => Msg.Ticked()))),
    ],
    view: (h, model) => h.span.id("tick-count").children(String(model.ticks)),
  });

  const fiber = mountApp(Ticker, host);
  await tick(55);
  const count = Number(document.getElementById("tick-count").textContent);
  assert.ok(count >= 2, `expected at least 2 ticks, got ${count}`);

  await Effect.runPromise(Fiber.interrupt(fiber));
  host.remove();
});
