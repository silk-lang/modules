// Computed style for the editing cases without a native tree: the HTML Standard's rendering
// rules (user agent sheet and presentational hints) and the style attribute, cascaded and
// inherited for the properties the editing algorithms read, serialized as CSSOM does.

const NAMED = Object.fromEntries(("aliceblue f0f8ff antiquewhite faebd7 aqua 00ffff aquamarine 7fffd4 azure f0ffff beige f5f5dc bisque ffe4c4 black 000000 blanchedalmond ffebcd blue 0000ff blueviolet 8a2be2 brown a52a2a burlywood deb887 cadetblue 5f9ea0 chartreuse 7fff00 chocolate d2691e coral ff7f50 cornflowerblue 6495ed cornsilk fff8dc crimson dc143c cyan 00ffff darkblue 00008b darkcyan 008b8b darkgoldenrod b8860b darkgray a9a9a9 darkgreen 006400 darkgrey a9a9a9 darkkhaki bdb76b darkmagenta 8b008b darkolivegreen 556b2f darkorange ff8c00 darkorchid 9932cc darkred 8b0000 darksalmon e9967a darkseagreen 8fbc8f darkslateblue 483d8b darkslategray 2f4f4f darkslategrey 2f4f4f darkturquoise 00ced1 darkviolet 9400d3 deeppink ff1493 deepskyblue 00bfff dimgray 696969 dimgrey 696969 dodgerblue 1e90ff firebrick b22222 floralwhite fffaf0 forestgreen 228b22 fuchsia ff00ff gainsboro dcdcdc ghostwhite f8f8ff gold ffd700 goldenrod daa520 gray 808080 green 008000 greenyellow adff2f grey 808080 honeydew f0fff0 hotpink ff69b4 indianred cd5c5c indigo 4b0082 ivory fffff0 khaki f0e68c lavender e6e6fa lavenderblush fff0f5 lawngreen 7cfc00 lemonchiffon fffacd lightblue add8e6 lightcoral f08080 lightcyan e0ffff lightgoldenrodyellow fafad2 lightgray d3d3d3 lightgreen 90ee90 lightgrey d3d3d3 lightpink ffb6c1 lightsalmon ffa07a lightseagreen 20b2aa lightskyblue 87cefa lightslategray 778899 lightslategrey 778899 lightsteelblue b0c4de lightyellow ffffe0 lime 00ff00 limegreen 32cd32 linen faf0e6 magenta ff00ff maroon 800000 mediumaquamarine 66cdaa mediumblue 0000cd mediumorchid ba55d3 mediumpurple 9370db mediumseagreen 3cb371 mediumslateblue 7b68ee mediumspringgreen 00fa9a mediumturquoise 48d1cc mediumvioletred c71585 midnightblue 191970 mintcream f5fffa mistyrose ffe4e1 moccasin ffe4b5 navajowhite ffdead navy 000080 oldlace fdf5e6 olive 808000 olivedrab 6b8e23 orange ffa500 orangered ff4500 orchid da70d6 palegoldenrod eee8aa palegreen 98fb98 paleturquoise afeeee palevioletred db7093 papayawhip ffefd5 peachpuff ffdab9 peru cd853f pink ffc0cb plum dda0dd powderblue b0e0e6 purple 800080 rebeccapurple 663399 red ff0000 rosybrown bc8f8f royalblue 4169e1 saddlebrown 8b4513 salmon fa8072 sandybrown f4a460 seagreen 2e8b57 seashell fff5ee sienna a0522d silver c0c0c0 skyblue 87ceeb slateblue 6a5acd slategray 708090 slategrey 708090 snow fffafa springgreen 00ff7f steelblue 4682b4 tan d2b48c teal 008080 thistle d8bfd8 tomato ff6347 turquoise 40e0d0 violet ee82ee wheat f5deb3 white ffffff whitesmoke f5f5f5 yellow ffff00 yellowgreen 9acd32")
  .split(" ").reduce((pairs, word, index, words) => (index % 2 ? pairs : [...pairs, [word, words[index + 1]]]), []));

const hex = (h) => [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));

/** A CSS color as CSSOM serializes a computed one, or null when it is not one. */
export function color(value) {
  const text = String(value).trim().toLowerCase();
  if (text === "transparent") return "rgba(0, 0, 0, 0)";
  if (text in NAMED) return "rgb(" + hex(NAMED[text]).join(", ") + ")";
  let match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(text);
  if (match) {
    const h = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
    return "rgb(" + hex(h).join(", ") + ")";
  }
  match = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(text);
  if (match) {
    const [r, g, b] = match.slice(1, 4).map((n) => Math.min(255, Number(n)));
    const a = match[4] === undefined ? 1 : Number(match[4]);
    return a === 1 ? "rgb(" + r + ", " + g + ", " + b + ")" : "rgba(" + r + ", " + g + ", " + b + ", " + a + ")";
  }
  return null;
}

// The HTML Standard's legacy font color parse, for <font color>.
function legacyColor(value) {
  const text = String(value).trim();
  if (!text || text.toLowerCase() === "transparent") return null;
  const named = color(text);
  if (named && !text.startsWith("rgb")) return named;
  let digits = text.replace(/^#/, "").replace(/[^0-9a-fA-F]/g, "0");
  while (digits.length === 0 || digits.length % 3) digits += "0";
  const length = digits.length / 3;
  let parts = [0, 1, 2].map((i) => digits.slice(i * length, (i + 1) * length));
  if (length > 8) parts = parts.map((p) => p.slice(length - 8));
  while (parts[0].length > 2 && parts.every((p) => p[0] === "0")) parts = parts.map((p) => p.slice(1));
  parts = parts.map((p) => p.slice(0, 2).padEnd(2, "0"));
  return "rgb(" + parts.map((p) => parseInt(p, 16)).join(", ") + ")";
}

// The HTML Standard's rendering section: these are blocks, and the rest (unknown elements
// too) inline.
const BLOCK = new Set("html body address blockquote center dialog div figure figcaption footer form header hr legend listing main p plaintext pre search xmp article aside h1 h2 h3 h4 h5 h6 hgroup nav section dir dd dl dt menu ol ul details summary fieldset optgroup frameset frame".split(" "));
const NONE = new Set("head script style template title meta link datalist noscript".split(" "));
const INLINE_BLOCK = new Set("button select textarea input img svg canvas iframe video audio meter progress".split(" "));
const LEGACY_SIZES = ["x-small", "small", "medium", "large", "x-large", "xx-large", "xxx-large"];
const KEYWORD_PX = { "xx-small": 9, "x-small": 10, small: 13, medium: 16, large: 18, "x-large": 24, "xx-large": 32, "xxx-large": 48 };

// The user agent sheet and presentational hints of `element` for property `name`.
function uaValue(element, name) {
  const tag = element.localName;
  switch (name) {
    case "display":
      if (NONE.has(tag) || element.hasAttribute("hidden")) return "none";
      if (tag === "li") return "list-item";
      if (tag === "table") return "table";
      if (tag === "tr") return "table-row";
      if (tag === "td" || tag === "th") return "table-cell";
      if (tag === "tbody") return "table-row-group";
      if (tag === "thead") return "table-header-group";
      if (tag === "tfoot") return "table-footer-group";
      if (tag === "caption") return "table-caption";
      if (tag === "col") return "table-column";
      if (tag === "colgroup") return "table-column-group";
      if (tag === "img") return "inline";
      if (INLINE_BLOCK.has(tag)) return "inline-block";
      return BLOCK.has(tag) ? "block" : "inline";
    case "font-weight":
      if (/^(h[1-6]|b|strong|th)$/.test(tag)) return "bolder";
      return null;
    case "font-style":
      return /^(i|em|cite|var|dfn|address)$/.test(tag) ? "italic" : null;
    case "white-space":
      if (tag === "pre" || tag === "listing" || tag === "xmp" || tag === "plaintext" || tag === "textarea") return tag === "textarea" ? "pre-wrap" : "pre";
      if (tag === "nobr") return "nowrap";
      if ((tag === "td" || tag === "th") && element.hasAttribute("nowrap")) return "nowrap";
      return null;
    case "text-decoration":
      if (tag === "u" || tag === "ins") return "underline";
      if (tag === "s" || tag === "strike" || tag === "del") return "line-through";
      if (tag === "a" && element.hasAttribute("href")) return "underline";
      return null;
    case "vertical-align":
      if (tag === "sub") return "sub";
      if (tag === "sup") return "super";
      if (tag === "td" || tag === "th") return "middle";
      return null;
    case "color":
      if (tag === "font" && element.hasAttribute("color")) return legacyColor(element.getAttribute("color"));
      if (tag === "a" && element.hasAttribute("href")) return "rgb(0, 0, 238)";
      return null;
    case "background-color":
      if (element.hasAttribute("bgcolor")) return legacyColor(element.getAttribute("bgcolor"));
      if (tag === "mark") return "rgb(255, 255, 0)";
      return null;
    case "font-family":
      if (tag === "font" && element.hasAttribute("face")) return element.getAttribute("face");
      if (/^(code|kbd|samp|pre|tt|listing|xmp|plaintext)$/.test(tag)) return "monospace";
      return null;
    case "font-size": {
      if (tag === "font" && element.hasAttribute("size")) {
        const match = /^\s*([+-]?)(\d+)/.exec(element.getAttribute("size"));
        if (!match) return null;
        let size = Number(match[2]);
        if (match[1] === "+") size = 3 + size;
        if (match[1] === "-") size = 3 - size;
        return LEGACY_SIZES[Math.max(1, Math.min(7, size)) - 1];
      }
      if (tag === "small" || tag === "sub" || tag === "sup") return "smaller";
      if (tag === "big") return "larger";
      const heading = { h1: "2em", h2: "1.5em", h3: "1.17em", h5: "0.83em", h6: "0.67em" }[tag];
      return heading ?? null;
    }
    case "text-align": {
      if (tag === "center") return "center";
      if ((tag === "th")) return "center";
      const align = element.getAttribute("align")?.toLowerCase();
      if (align && /^(div|p|h[1-6]|caption|thead|tbody|tfoot|tr|td|th)$/.test(tag) && /^(left|right|center|justify)$/.test(align)) {
        return align === "center" && tag !== "td" && tag !== "th" ? "center" : align;
      }
      return null;
    }
  }
  return null;
}

const INHERITED = new Set(["color", "font-family", "font-size", "font-style", "font-weight", "white-space", "text-align", "visibility"]);
const INITIAL = {
  display: "inline", "font-weight": "400", "font-style": "normal", "white-space": "normal",
  "text-decoration": "none", "vertical-align": "baseline", color: "rgb(0, 0, 0)",
  "background-color": "rgba(0, 0, 0, 0)", "font-family": "serif", "font-size": "16px",
  "text-align": "start", visibility: "visible",
};

function declared(element, name) {
  const style = element.getAttribute?.("style");
  if (!style) return null;
  let found = null;
  for (const part of style.split(";")) {
    const at = part.indexOf(":");
    if (at < 0) continue;
    const property = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim().replace(/\s*!important$/, "");
    if (property === name) found = value;
    if (name === "text-decoration" && property === "text-decoration-line") found = value;
    if (name === "white-space" && property === "white-space-collapse") found = value === "preserve" ? "pre-wrap" : found;
    if (name === "background-color" && property === "background") found = value;
    if (name.startsWith("font-") && property === "font") {
      const words = value.split(/\s+/);
      if (name === "font-weight") found = words.find((w) => /^(bold|bolder|lighter|normal|\d00)$/.test(w)) ?? "normal";
      if (name === "font-style") found = words.find((w) => /^(italic|oblique|normal)$/.test(w)) ?? "normal";
    }
  }
  return found;
}

function weight(value, parent) {
  if (value === "normal") return 400;
  if (value === "bold") return 700;
  if (value === "bolder") return parent < 350 ? 400 : parent < 550 ? 700 : 900;
  if (value === "lighter") return parent < 550 ? 100 : parent < 750 ? 400 : 700;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function size(value, parent) {
  if (value in KEYWORD_PX) return KEYWORD_PX[value];
  if (value === "smaller") return parent / 1.2;
  if (value === "larger") return parent * 1.2;
  let match = /^([\d.]+)px$/.exec(value);
  if (match) return Number(match[1]);
  match = /^([\d.]+)(em|%)$/.exec(value);
  if (match) return Number(match[1]) * parent / (match[2] === "%" ? 100 : 1);
  match = /^([\d.]+)pt$/.exec(value);
  if (match) return Number(match[1]) * 4 / 3;
  return null;
}

const px = (n) => (Math.round(n * 1000) / 1000) + "px";

/** The computed value of `name` on `element` as CSSOM serializes it. */
export function computed(element, name) {
  if (!element || element.nodeType !== 1) return INITIAL[name];
  const parent = element.parentNode?.nodeType === 1 ? element.parentNode : null;
  const inherited = () => (parent ? computed(parent, name) : INITIAL[name]);
  let value = declared(element, name) ?? uaValue(element, name);
  if (value === "inherit") value = inherited();
  if (value === "initial") value = INITIAL[name];
  if (value === null || value === undefined) return INHERITED.has(name) ? inherited() : INITIAL[name];
  switch (name) {
    case "font-weight": return String(weight(value, Number(inherited())) ?? inherited());
    case "font-size": return px(size(value, parseFloat(inherited())) ?? parseFloat(inherited()));
    case "color": case "background-color": {
      if (value === "currentcolor") return computed(element, "color");
      return color(value) ?? (name === "color" ? inherited() : INITIAL[name]);
    }
    case "text-decoration": return value.split(/\s+/).find((w) => /^(underline|line-through|overline|none)$/.test(w)) ?? "none";
    case "font-family": return value.replace(/\s*,\s*/g, ", ");
  }
  return value;
}
