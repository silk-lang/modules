import assert from "node:assert/strict";
import { test } from "node:test";
import { installMock } from "../../core/test/mock.js";

const mock = installMock();
const core = await import("@silkui/core");
await import("../../core/src/globals.js");
const { createElement: h, useState } = await import("react");
const { createRoot } = await import("../src/index.js");

const {
  createBox,
  createElement,
  Input,
  CheckInput,
  RangeInput,
  ColorInput,
  FileInput,
  ButtonInput,
  HiddenInput,
  FormElement,
  SelectElement,
  OptionElement,
  OptGroupElement,
  ButtonElement,
  FieldSetElement,
  LabelElement,
  ProgressElement,
  MeterElement,
  OutputElement,
  ValidityState,
} = core;

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function keyDown(node, key, modifiers = 0) {
  mock.native.dispatch(7, node.nodeId, 0, 0, modifiers, 0, 0, key, key);
}

function focusNode(node) {
  mock.native.dispatch(9, node.nodeId, 0, 0, 0, 0, 0);
}

function blurNode(node) {
  mock.native.dispatch(10, node.nodeId, 0, 0, 0, 0, 0);
}

test("HTML form controls have spec-faithful classes, instanceof, and global constructors", () => {
  const form = document.createElement("form");
  const input = document.createElement("input");
  const textarea = document.createElement("textarea");
  const select = document.createElement("select");
  const option = new Option("Label", "val", true, true);
  const optgroup = document.createElement("optgroup");
  const button = document.createElement("button");
  const fieldset = document.createElement("fieldset");
  const label = document.createElement("label");
  const progress = document.createElement("progress");
  const meter = document.createElement("meter");
  const output = document.createElement("output");

  assert.ok(form instanceof FormElement && form instanceof HTMLFormElement);
  assert.ok(input instanceof Input && input instanceof HTMLInputElement);
  assert.ok(textarea instanceof Input && textarea instanceof HTMLTextAreaElement);
  assert.ok(select instanceof SelectElement && select instanceof HTMLSelectElement);
  assert.ok(option instanceof OptionElement && option instanceof HTMLOptionElement);
  assert.ok(optgroup instanceof OptGroupElement && optgroup instanceof HTMLOptGroupElement);
  assert.ok(button instanceof ButtonElement && button instanceof HTMLButtonElement);
  assert.ok(fieldset instanceof FieldSetElement && fieldset instanceof HTMLFieldSetElement);
  assert.ok(label instanceof LabelElement && label instanceof HTMLLabelElement);
  assert.ok(progress instanceof ProgressElement && progress instanceof HTMLProgressElement);
  assert.ok(meter instanceof MeterElement && meter instanceof HTMLMeterElement);
  assert.ok(output instanceof OutputElement && output instanceof HTMLOutputElement);
  assert.ok(input.validity instanceof ValidityState);
  assert.equal(option.text, "Label");
  assert.equal(option.value, "val");
  assert.equal(option.defaultSelected, true);
  assert.equal(option.selected, true);
});

test("form association, elements collection, RadioNodeList, requestSubmit, and reset", () => {
  const host = createBox();
  document.body.appendChild(host);
  try {
    const form = createElement("form");
    form.id = "signup";
    const name = createElement("input", { type: "text" });
    name.setAttribute("name", "user");
    name.setAttribute("value", "Ada");
    name.required = true;

    const r1 = createElement("input", { type: "radio" });
    r1.setAttribute("name", "plan");
    r1.setAttribute("value", "free");
    r1.setAttribute("checked", "");

    const r2 = createElement("input", { type: "radio" });
    r2.setAttribute("name", "plan");
    r2.setAttribute("value", "pro");

    const outside = createElement("input", { type: "text" });
    outside.setAttribute("name", "coupon");
    outside.setAttribute("form", "signup");
    outside.setAttribute("value", "WELCOME");

    const submitBtn = createElement("button");
    submitBtn.setAttribute("name", "go");
    submitBtn.setAttribute("value", "yes");

    form.append(name, r1, r2, submitBtn);
    host.append(form, outside);

    assert.equal(name.form, form);
    assert.equal(outside.form, form);
    assert.equal(submitBtn.type, "submit");
    assert.equal(form.elements.length, 5);
    assert.equal(form.elements.namedItem("user"), name);
    assert.equal(form.elements.user, name);
    assert.equal(form.elements.namedItem("coupon"), outside);

    const planList = form.elements.namedItem("plan");
    assert.equal(planList.length, 2);
    assert.equal(planList.value, "free");
    planList.value = "pro";
    assert.equal(r1.checked, false);
    assert.equal(r2.checked, true);

    // Invalid blocks requestSubmit and fires non-bubbling cancelable `invalid` event
    name.value = "";
    const events = [];
    name.addEventListener("invalid", (e) => {
      events.push(`invalid:${e.bubbles}:${e.cancelable}`);
    });
    form.addEventListener("submit", (e) => {
      events.push(`submit:${e.submitter === submitBtn}`);
      e.preventDefault();
    });
    form.requestSubmit(submitBtn);
    assert.deepEqual(events, ["invalid:false:true"]);

    // Valid submits with submitter
    name.value = "Grace";
    form.requestSubmit(submitBtn);
    assert.deepEqual(events, ["invalid:false:true", "submit:true"]);

    // Invalid submitter throws
    const otherBtn = createElement("button");
    otherBtn.type = "button";
    form.appendChild(otherBtn);
    assert.throws(() => form.requestSubmit(otherBtn), TypeError);
    const foreignBtn = createElement("button");
    host.appendChild(foreignBtn);
    assert.throws(() => form.requestSubmit(foreignBtn), { name: "NotFoundError" });

    // Reset restores defaultValue and defaultChecked
    let resetFired = false;
    form.addEventListener("reset", () => { resetFired = true; });
    form.reset();
    assert.equal(resetFired, true);
    assert.equal(name.value, "Ada");
    assert.equal(r1.checked, true);
    assert.equal(r2.checked, false);
  } finally {
    host.remove();
  }
});

test("constraint validation covers email, url, pattern, number, date/time, stepUp/stepDown, custom validity, and fieldset disabled", () => {
  const host = createBox();
  document.body.appendChild(host);
  try {
    const email = createElement("input", { type: "email" });
    email.required = true;
    assert.equal(email.validity.valueMissing, true);
    assert.equal(email.validity.valid, false);
    email.value = "not-an-email";
    assert.equal(email.validity.typeMismatch, true);
    email.value = "ada@example.com";
    assert.equal(email.validity.valid, true);
    email.multiple = true;
    email.value = "ada@example.com, grace@example.org";
    assert.equal(email.validity.valid, true);

    const url = createElement("input", { type: "url" });
    url.value = "not a url";
    assert.equal(url.validity.typeMismatch, true);
    url.value = "https://example.com/path";
    assert.equal(url.validity.valid, true);

    const pat = createElement("input", { type: "text" });
    pat.pattern = "[A-Z]{3}";
    pat.value = "ab";
    assert.equal(pat.validity.patternMismatch, true);
    pat.value = "XYZ";
    assert.equal(pat.validity.valid, true);

    const num = createElement("input", { type: "number" });
    num.min = "0";
    num.max = "10";
    num.step = "2";
    num.value = "3";
    assert.equal(num.validity.stepMismatch, true);
    num.stepUp(1);
    assert.equal(num.value, "4");
    assert.equal(num.valueAsNumber, 4);
    assert.equal(num.validity.valid, true);
    num.valueAsNumber = 12;
    assert.equal(num.validity.rangeOverflow, true);
    num.valueAsNumber = -2;
    assert.equal(num.validity.rangeUnderflow, true);

    // Date, time, month, week valueAsNumber & valueAsDate
    const dateInput = createElement("input", { type: "date" });
    dateInput.valueAsDate = new Date(Date.UTC(2026, 4, 15));
    assert.equal(dateInput.value, "2026-05-15");
    assert.equal(dateInput.valueAsDate.getUTCFullYear(), 2026);
    dateInput.stepUp(2);
    assert.equal(dateInput.value, "2026-05-17");

    const timeInput = createElement("input", { type: "time" });
    timeInput.value = "09:30";
    assert.equal(timeInput.valueAsNumber, (9 * 60 + 30) * 60 * 1000);
    timeInput.stepUp(1);
    assert.equal(timeInput.value, "09:31");

    const monthInput = createElement("input", { type: "month" });
    monthInput.value = "2026-01";
    monthInput.stepUp(2);
    assert.equal(monthInput.value, "2026-03");

    // Custom validity
    pat.setCustomValidity("Taken!");
    assert.equal(pat.validity.customError, true);
    assert.equal(pat.validity.valid, false);
    assert.equal(pat.validationMessage, "Taken!");
    pat.setCustomValidity("");
    assert.equal(pat.validity.valid, true);

    // Fieldset disabled exempts first legend child (WHATWG §4.10.18.5)
    const fs = createElement("fieldset");
    fs.disabled = true;
    const legend1 = createElement("legend");
    const inLegend1 = createElement("input", { type: "text" });
    inLegend1.required = true;
    legend1.appendChild(inLegend1);
    const legend2 = createElement("legend");
    const inLegend2 = createElement("input", { type: "text" });
    inLegend2.required = true;
    legend2.appendChild(inLegend2);
    const bodyInput = createElement("input", { type: "text" });
    bodyInput.required = true;
    fs.append(legend1, legend2, bodyInput);
    host.appendChild(fs);

    assert.equal(inLegend1.willValidate, true, "first legend descendant is NOT disabled by fieldset");
    assert.equal(inLegend2.willValidate, false, "second legend descendant IS disabled by fieldset");
    assert.equal(bodyInput.willValidate, false, "fieldset body descendant IS disabled by fieldset");

    // Change fires on blur only when value changed since focus
    const textField = createElement("input", { type: "text" });
    host.appendChild(textField);
    let changes = 0;
    textField.addEventListener("change", () => { changes++; });
    focusNode(textField);
    blurNode(textField);
    assert.equal(changes, 0);
    focusNode(textField);
    mock.input(textField.nodeId, "hello");
    blurNode(textField);
    assert.equal(changes, 1);
  } finally {
    host.remove();
  }
});

test("select, option, optgroup, placeholder required validation, keyboard nav, and React controlled select", async () => {
  const host = createBox();
  document.body.appendChild(host);
  try {
    const select = createElement("select");
    select.required = true;
    const placeholder = new Option("Choose...", "");
    const optA = new Option("Alpha", "a");
    const group = createElement("optgroup");
    group.label = "More";
    const optB = new Option("Beta", "b");
    const optC = new Option("Gamma", "c");
    optC.disabled = true;
    group.append(optB, optC);
    select.append(placeholder, optA, group);
    host.appendChild(select);

    assert.equal(select.type, "select-one");
    assert.equal(select.options.length, 4);
    assert.equal(select.selectedIndex, 0);
    assert.equal(select.value, "");
    assert.equal(select.validity.valueMissing, true, "placeholder label option triggers valueMissing");

    // ArrowDown skips to Alpha and fires input + change
    const log = [];
    select.addEventListener("input", () => log.push("i:" + select.value));
    select.addEventListener("change", () => log.push("c:" + select.value));
    keyDown(select, "ArrowDown");
    assert.equal(select.value, "a");
    assert.equal(select.validity.valid, true);
    assert.deepEqual(log, ["i:a", "c:a"]);

    // Typeahead selects Beta
    keyDown(select, "b");
    assert.equal(select.value, "b");

    // ArrowDown skips disabled Gamma
    keyDown(select, "ArrowDown");
    assert.equal(select.value, "b");

    // Multiple select
    select.multiple = true;
    assert.equal(select.type, "select-multiple");
    optA.selected = true;
    optB.selected = true;
    assert.deepEqual(select.selectedOptions.map((o) => o.value), ["a", "b"]);

    // React controlled <select>
    let reactSelect;
    const seen = [];
    function Picker() {
      const [val, setVal] = useState("two");
      return h(
        "select",
        { ref: (n) => (reactSelect = n), value: val, onChange: (e) => { seen.push(e.target.value); setVal(e.target.value); } },
        h("option", { value: "one" }, "One"),
        h("option", { value: "two" }, "Two"),
        h("option", { value: "three" }, "Three"),
      );
    }
    const rHost = createBox();
    host.appendChild(rHost);
    createRoot(rHost).render(h(Picker));
    assert.equal(reactSelect.value, "two", "finalizeInitialChildren applies initial controlled value after options mount");
    keyDown(reactSelect, "ArrowDown");
    await tick();
    assert.equal(reactSelect.value, "three");
    assert.deepEqual(seen, ["three"]);
  } finally {
    host.remove();
  }
});

test("checkbox indeterminate, radio groups + arrows, color, file, progress, meter, output, label, and parseHTML", () => {
  const host = createBox();
  document.body.appendChild(host);
  try {
    // Checkbox indeterminate clears on click
    const cb = createElement("input", { type: "checkbox" });
    cb.indeterminate = true;
    assert.equal(cb.indeterminate, true);
    mock.click(cb.nodeId);
    assert.equal(cb.indeterminate, false);
    assert.equal(cb.checked, true);

    // Color normalizes to lowercase 7-char hex
    const color = createElement("input", { type: "color" });
    assert.ok(color instanceof ColorInput);
    assert.equal(color.value, "#000000");
    color.value = "#FF00AA";
    assert.equal(color.value, "#ff00aa");
    color.value = "not-a-color";
    assert.equal(color.value, "#000000");

    // File input fakepath + required + clearing
    const file = createElement("input", { type: "file" });
    assert.ok(file instanceof FileInput);
    file.required = true;
    assert.equal(file.validity.valueMissing, true);
    file.files = [{ name: "report.pdf", size: 12 }];
    assert.equal(file.value, "C:\\fakepath\\report.pdf");
    assert.equal(file.validity.valid, true);
    assert.throws(() => { file.value = "secret.txt"; }, { name: "InvalidStateError" });
    file.value = "";
    assert.equal(file.files.length, 0);

    // Progress & Meter
    const progress = createElement("progress");
    assert.equal(progress.position, -1);
    progress.max = 200;
    progress.value = 50;
    assert.equal(progress.position, 0.25);

    const meter = createElement("meter");
    meter.min = 0;
    meter.max = 100;
    meter.low = 30;
    meter.high = 70;
    meter.optimum = 80;
    meter.value = 20;
    assert.equal(meter.value, 20);
    assert.equal(meter.optimum, 80);

    // Output resets to defaultValue
    const form = createElement("form");
    const output = createElement("output");
    output.defaultValue = "0";
    output.value = "42";
    assert.equal(output.value, "42");
    form.appendChild(output);
    host.appendChild(form);
    form.reset();
    assert.equal(output.value, "0");

    // Label for & labels list
    const inp = createElement("input", { type: "text" });
    inp.id = "username";
    const lbl = createElement("label");
    lbl.htmlFor = "username";
    host.append(lbl, inp);
    assert.equal(lbl.control, inp);
    assert.deepEqual(inp.labels, [lbl]);

    // parseHTML preserves textarea defaultValue and input value attribute for form.reset()
    const wrapper = createElement("div");
    wrapper.innerHTML = '<form><textarea name="bio">Initial bio</textarea><input name="city" value="SP"></form>';
    const parsedForm = wrapper.firstChild;
    const parsedTa = parsedForm.elements.namedItem("bio");
    const parsedCity = parsedForm.elements.namedItem("city");
    assert.equal(parsedTa.value, "Initial bio");
    assert.equal(parsedTa.defaultValue, "Initial bio");
    assert.equal(parsedCity.value, "SP");
    assert.equal(parsedCity.defaultValue, "SP");
    parsedTa.value = "Edited";
    parsedCity.value = "RJ";
    parsedForm.reset();
    assert.equal(parsedTa.value, "Initial bio");
    assert.equal(parsedCity.value, "SP");
  } finally {
    host.remove();
  }
});
