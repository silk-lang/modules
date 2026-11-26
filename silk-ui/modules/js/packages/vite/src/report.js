// Prefixed properties whose standard form the stylesheet compiler reads; a prefixed one alone
// (no standard declaration beside it) would otherwise be dropped.
const prefixed = /(^|[;{\s])-webkit-(backdrop-filter|mask-image|text-decoration)(\s*:)/g;

/** `css` with `-webkit-backdrop-filter`, `-webkit-mask-image` and `-webkit-text-decoration` spelled the standard way. */
export function standardize(css) {
  return css.replace(prefixed, "$1$2$3");
}

// Other engines' prefixed properties and selectors, as resets such as Tailwind's preflight write them.
const vendor = /^:{0,2}-(webkit|moz|ms|o)-/;
// Pseudo-elements of things Silk UI does not have: the top layer and file inputs.
const absent = new Set(["backdrop", "file-selector-button"]);

function quiet(diagnostic) {
  return vendor.test(diagnostic.feature) || (diagnostic.kind === "feature" && absent.has(diagnostic.feature));
}

/**
 * Reports what the stylesheet compiler dropped through `warn`: one line naming the features Silk UI
 * does not draw yet, leaving out other engines' prefixes and pseudo-elements of things it has no
 * equivalent of. `SILKUI_CSS_REPORT=all` writes every dropped feature on its own line instead.
 */
export function reportDropped(warn, diagnostics) {
  // `@keyframes` that set a property Silk UI does not animate: the property keeps its base value.
  for (const item of diagnostics) {
    if (item.kind !== "animation") continue;
    const [name, property] = item.feature.split(": ");
    warn(`@keyframes ${name} sets ${property}, which Silk UI does not animate: it keeps its base value`);
  }
  diagnostics = diagnostics.filter(item => item.kind !== "animation");
  if (process.env.SILKUI_CSS_REPORT === "all") {
    for (const item of diagnostics) warn(`dropped ${item.count} ${item.kind} occurrence(s): ${item.feature}`);
    return;
  }
  const shown = diagnostics.filter(item => !quiet(item));
  if (!shown.length) return;
  const names = shown.map(item => item.count > 1 ? `${item.feature} (${item.count})` : item.feature).join(", ");
  const what = shown.length === 1 ? "1 CSS feature" : `${shown.length} CSS features`;
  warn(`skipped ${what} Silk UI does not draw yet: ${names}. SILKUI_CSS_REPORT=all lists everything dropped.`);
}
