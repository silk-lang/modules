// Chromium's answers for the text selection tests (modules/tree/tests/src/text_selection.silk):
// replays each gesture in Chromium and prints the selection's ends and text, one JSON line per
// case, as kept in selection.jsonl. The tests expect the same texts and the same ends (tree node
// ids for the page's elements). Run: node modules/tree/tests/chrome/selection.js [name regex]
const { chromium } = require('playwright');

const base = `<style>body{margin:20px;font:16px/24px sans-serif;width:600px}p{margin:0 0 12px}</style>`;
// Point helpers evaluated in the page: [selector, charIndex, dx, dy] or [selector, 'left'|'right'|'below'|'above'|'center', dx, dy]
const cases = [
  { name: 'drag within paragraph', html: `<p id=a>Hello brave new world</p>`, g: [['down', '#a', 1], ['move', '#a', 13], ['up']] },
  { name: 'drag across paragraphs', html: `<p id=a>First paragraph here</p><p id=b>Second paragraph here</p>`, g: [['down', '#a', 6], ['move', '#b', 6], ['up']] },
  { name: 'start left of text in body margin', html: `<p id=a>First paragraph here</p><p id=b>Second paragraph here</p>`, g: [['down', '#a', 'left', -10, 0], ['move', '#b', 6], ['up']] },
  { name: 'start right of short line', html: `<p id=a>Short</p><p id=b>Second paragraph here</p>`, g: [['down', '#a', 'rightOfText', 40, 0], ['move', '#b', 6], ['up']] },
  { name: 'drag into gap between paragraphs', html: `<p id=a>First paragraph here</p><p id=b style="margin-top:40px">Second paragraph here</p>`, g: [['down', '#a', 2], ['move', '#b', 'above', 0, -20], ['up']] },
  { name: 'drag below all content', html: `<p id=a>First paragraph here</p><p id=b>Second paragraph here</p>`, g: [['down', '#a', 2], ['move', '#b', 'below', 0, 100], ['up']] },
  { name: 'drag above all content', html: `<p id=a>First paragraph here</p><p id=b>Second paragraph here</p>`, g: [['down', '#b', 6], ['move', '#a', 'above', 0, -15], ['up']] },
  { name: 'multicol col1 to col2', html: `<div style="columns:2;column-gap:40px"><p id=a>Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu</p><p id=b>Nu xi omicron pi rho sigma tau upsilon phi chi psi omega</p></div>`, g: [['down', '#a', 6], ['move', '#b', 10], ['up']] },
  { name: 'multicol point in col2 top while anchor in col1', html: `<div id=m style="columns:2;column-gap:40px"><p id=a>Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu</p><p id=b>Nu xi omicron pi rho sigma tau upsilon phi chi psi omega</p></div>`, g: [['down', '#a', 0], ['move', '#m', 'xy', 320, 2], ['up']] },
  { name: 'flex row-reverse drag left to right', html: `<div style="display:flex;flex-direction:row-reverse;justify-content:flex-end;gap:30px"><span id=a>One one</span><span id=b>Two two</span><span id=c>Three three</span></div>`, g: [['down', '#c', 1], ['move', '#a', 5], ['up']] },
  { name: 'flex order drag visual left to right', html: `<div style="display:flex;gap:30px"><span id=a style="order:3">One one</span><span id=b style="order:1">Two two</span><span id=c style="order:2">Three three</span></div>`, g: [['down', '#b', 1], ['move', '#c', 5], ['up']] },
  { name: 'flex gap between items', html: `<div id=f style="display:flex;gap:60px"><span id=a>One one</span><span id=b>Two two</span></div>`, g: [['down', '#a', 1], ['move', '#a', 'rightOfText', 30, 0], ['up']] },
  { name: 'grid placed out of order', html: `<div style="display:grid;grid-template-columns:200px 200px"><div id=a style="grid-column:2;grid-row:1">Cell A text</div><div id=b style="grid-column:1;grid-row:1">Cell B text</div><div id=c>Cell C text</div></div>`, g: [['down', '#b', 1], ['move', '#a', 6], ['up']] },
  { name: 'grid empty cell drag', html: `<div id=g style="display:grid;grid-template-columns:200px 200px;grid-auto-rows:60px"><div id=a>Cell A</div><div></div><div></div><div id=d>Cell D</div></div>`, g: [['down', '#a', 1], ['move', '#g', 'xy', 300, 20], ['up']] },
  { name: 'absolute box earlier in DOM, drag onto it', html: `<div style="position:relative;height:200px"><div id=abs style="position:absolute;top:120px;left:0">Positioned box text</div><p id=a>First paragraph here</p><p id=b>Second paragraph here</p></div>`, g: [['down', '#a', 2], ['move', '#abs', 10], ['up']] },
  { name: 'absolute box later in DOM, drag past it', html: `<div style="position:relative;height:200px"><p id=a>First paragraph here</p><p id=b>Second paragraph here</p><div id=abs style="position:absolute;top:0;left:400px">Positioned</div></div>`, g: [['down', '#a', 2], ['move', '#b', 6], ['up']] },
  { name: 'transformed box', html: `<p id=a>Before text</p><div id=t style="transform:translate(200px,-30px)">Moved text here</div><p id=b>After text</p>`, g: [['down', '#a', 1], ['move', '#t', 5], ['up']] },
  { name: 'user-select none inside, drag across', html: `<p id=a>Start <span id=n style="user-select:none">SKIP</span> end text</p>`, g: [['down', '#a', 1], ['move', '#a', 'rightOfText', -5, 0], ['up']] },
  { name: 'drag ending inside user-select none', html: `<p id=a>Start <span id=n style="user-select:none">SKIPPED PART</span> end text</p>`, g: [['down', '#a', 1], ['move', '#n', 5], ['up']] },
  { name: 'drag starting on user-select none', html: `<p id=a><span id=n style="user-select:none">Label:</span> value text here</p>`, g: [['down', '#n', 2], ['move', '#a', 'rightOfText', -5, 0], ['up']] },
  { name: 'user-select all click', html: `<p id=a>Code <span id=c style="user-select:all">npm install silk</span> done</p>`, g: [['click', '#c', 5]] },
  { name: 'user-select all drag partially', html: `<p id=a>Code <span id=c style="user-select:all">npm install silk</span> done</p>`, g: [['down', '#a', 1], ['move', '#c', 5], ['up']] },
  { name: 'double click word', html: `<p id=a>Hello brave new world.</p>`, g: [['dbl', '#a', 8]] },
  { name: 'double click on space', html: `<p id=a>Hello brave  new world.</p>`, g: [['dbl', '#a', 12]] },
  { name: 'double click then drag', html: `<p id=a>Hello brave new world and more words</p>`, g: [['down2', '#a', 8], ['move', '#a', 17], ['up']] },
  { name: 'double click then drag backward', html: `<p id=a>Hello brave new world and more words</p>`, g: [['down2', '#a', 17], ['move', '#a', 2], ['up']] },
  { name: 'triple click', html: `<p id=a>Hello brave <b>new</b> world.</p><p id=b>Next one</p>`, g: [['triple', '#a', 8]] },
  { name: 'triple click then drag', html: `<p id=a>Hello brave new world.</p><p id=b>Next one</p><p id=c>Third</p>`, g: [['down3', '#a', 8], ['move', '#b', 2], ['up']] },
  { name: 'shift click extend after drag', html: `<p id=a>Hello brave new world and more words</p>`, g: [['down', '#a', 10], ['move', '#a', 15], ['up'], ['shiftclick', '#a', 3]] },
  { name: 'shift click extend after click', html: `<p id=a>Hello brave new world and more words</p>`, g: [['click', '#a', 10], ['shiftclick', '#a', 20]] },
  { name: 'shift arrow extend', html: `<p id=a>Hello brave new world and more words</p><p>Second line</p>`, g: [['down', '#a', 6], ['move', '#a', 11], ['up'], ['key', 'Shift+ArrowRight'], ['key', 'Shift+ArrowRight'], ['key', 'Shift+Control+ArrowRight'], ['key', 'Shift+ArrowDown']] },
  { name: 'select all', html: `<p id=a>Hello</p><p>World</p><input value=x>`, g: [['click', '#a', 1], ['key', 'Control+a']] },
  { name: 'bidi drag', html: `<p id=a dir=ltr>abc אבגד def</p>`, g: [['down', '#a', 2], ['move', '#a', 6], ['up']] },
  { name: 'inline-block image drag', html: `<p id=a>Before <span id=img style="display:inline-block;width:40px;height:20px;background:red"></span> after</p>`, g: [['down', '#a', 1], ['move', '#a', 'rightOfText', -2, 0], ['up']] },
  { name: 'drag into input does not enter', html: `<p id=a>Before input</p><input id=i value="inside value"><p id=b>After</p>`, g: [['down', '#a', 1], ['move', '#i', 'center', 0, 0], ['up']] },
  { name: 'click empty space clears', html: `<p id=a>Hello world</p><div style="height:100px"></div>`, g: [['down', '#a', 1], ['move', '#a', 8], ['up'], ['clickxy', 300, 100]] },
  { name: 'table cells drag', html: `<table><tr><td id=a>One</td><td id=b>Two</td></tr><tr><td id=c>Three</td><td id=d>Four</td></tr></table>`, g: [['down', '#a', 1], ['move', '#d', 2], ['up']] },
  { name: 'line wrap point right of first line', html: `<p id=a style="width:150px">Some words that wrap onto more lines here</p>`, g: [['down', '#a', 0], ['move', '#a', 'xy', 300, 4], ['up']] },
  { name: 'point left of second line', html: `<p id=a style="width:150px;margin-left:100px">Some words that wrap onto more lines here</p>`, g: [['down', '#a', 'xy', 140, 10], ['move', '#a', 'xy', -50, 30], ['up']] },
  { name: 'drag over float', html: `<div style="width:300px"><div id=fl style="float:right;width:100px">Float text inside</div><p id=a>Main text flowing beside the float box and more</p></div>`, g: [['down', '#a', 1], ['move', '#fl', 4], ['up']] },
  { name: 'nested scroller drag', html: `<p id=a>Outside text</p><div id=s style="height:48px;overflow:auto"><p>Line one</p><p>Line two</p><p>Line three</p><p id=z>Line four</p></div><p id=b>After</p>`, g: [['down', '#a', 1], ['move', '#b', 2], ['up']] },
  { name: 'toString serialization', html: `<h1 id=a>Title</h1><p>Para <b>bold</b> <span style="user-select:none">hidden</span> text</p><ul><li>One</li><li>Two</li></ul><table><tr><td>A</td><td>B</td></tr></table><p id=b style="display:none">Gone</p><p id=c>End</p>`, g: [['down', '#a', 0], ['move', '#c', 'rightOfText', -1, 0], ['up']] },

  { name: 'drag starting in button', html: `<p id=a>Before</p><button id=btn>Button label</button><p id=b>After text</p>`, g: [['down', '#btn', 2], ['move', '#b', 5], ['up']] },
  { name: 'drag across button from outside', html: `<p id=a>Before</p><button id=btn>Button label</button><p id=b>After text</p>`, g: [['down', '#a', 1], ['move', '#b', 5], ['up']] },
  { name: 'drag starting in link', html: `<p id=a>Go <a id=l href="#x">link text</a> after</p>`, g: [['down', '#l', 2], ['move', '#a', 'rightOfText', -2, 0], ['up']] },
  { name: 'drag starting in div with click handler', html: `<div id=c onclick="1" style="cursor:pointer">Clickable row text</div><p id=b>After</p>`, g: [['down', '#c', 2], ['move', '#c', 12], ['up']] },
  { name: 'triple click in div of spans', html: `<div id=a><span>One</span> <span>two</span><div>Inner block</div>tail</div>`, g: [['triple', '#a', 1]] },
  { name: 'double click punctuation', html: `<p id=a>foo.bar_baz-qux, 3.14 e-mail@x.com</p>`, g: [['dbl', '#a', 5]] },
  { name: 'double click number', html: `<p id=a>foo.bar_baz-qux, 3.14 e-mail@x.com</p>`, g: [['dbl', '#a', 18]] },
];

const helpers = `
window.__pt = (sel, where, dx, dy) => {
  const el = document.querySelector(sel);
  const r = el.getBoundingClientRect();
  dx = dx || 0; dy = dy || 0;
  if (typeof where === 'number') {
    // middle of the left half of character where (text in document order)
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let n, left = where;
    while ((n = walker.nextNode())) { if (left < n.data.length) break; left -= n.data.length; }
    const range = document.createRange(); range.setStart(n, left); range.setEnd(n, left + 1);
    const cr = range.getClientRects()[0];
    return [cr.left + Math.min(2, cr.width / 4) + dx, cr.top + cr.height / 2 + dy];
  }
  if (where === 'left') return [r.left + dx, r.top + r.height / 2 + dy];
  if (where === 'right') return [r.right + dx, r.top + r.height / 2 + dy];
  if (where === 'rightOfText') { const range = document.createRange(); range.selectNodeContents(el); const rs = range.getClientRects(); const last = rs[rs.length - 1]; return [last.right + dx, last.top + last.height / 2 + dy]; }
  if (where === 'below') return [r.left + 10 + dx, r.bottom + dy];
  if (where === 'above') return [r.left + 10 + dx, r.top + dy];
  if (where === 'center') return [r.left + r.width / 2 + dx, r.top + r.height / 2 + dy];
  if (where === 'xy') return [r.left + dx, r.top + dy];
};
window.__desc = () => {
  const s = getSelection();
  const name = (n) => { if (!n) return 'null'; if (n.nodeType === 3) { const p = n.parentElement; return (p.id ? '#' + p.id : p.tagName.toLowerCase()) + ':"' + n.data.slice(0, 12) + '"'; } return n.id ? '#' + n.id : (n.tagName ? n.tagName.toLowerCase() : n.nodeName); };
  return { type: s.type, anchor: name(s.anchorNode) + '@' + s.anchorOffset, focus: name(s.focusNode) + '@' + s.focusOffset, text: s.toString(), active: document.activeElement && document.activeElement.tagName };
};`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const out = [];
  for (const c of (process.argv[2] ? cases.filter(c=>c.name.match(process.argv[2])) : cases)) {
    await page.setContent(base + c.html);
    await page.addScriptTag({ content: helpers });
    const pt = async (step) => page.evaluate(([s, w, dx, dy]) => window.__pt(s, w, dx, dy), [step[1], step[2], step[3], step[4]]);
    let shot = null;
    for (const step of c.g) {
      const k = step[0];
      if (k === 'down' || k === 'down2' || k === 'down3') {
        const [x, y] = await pt(step);
        await page.mouse.move(x, y);
        if (k === 'down2') { await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 }); await page.mouse.down({ clickCount: 2 }); }
        else if (k === 'down3') { await page.mouse.down({ clickCount: 1 }); await page.mouse.up({ clickCount: 1 }); await page.mouse.down({ clickCount: 2 }); await page.mouse.up({ clickCount: 2 }); await page.mouse.down({ clickCount: 3 }); }
        else await page.mouse.down();
      } else if (k === 'move') {
        const [x, y] = await pt(step);
        await page.mouse.move(x, y, { steps: 8 });
      } else if (k === 'up') await page.mouse.up();
      else if (k === 'click') { const [x, y] = await pt(step); await page.mouse.click(x, y); }
      else if (k === 'dbl') { const [x, y] = await pt(step); await page.mouse.dblclick(x, y); }
      else if (k === 'triple') { const [x, y] = await pt(step); await page.mouse.click(x, y, { clickCount: 3 }); }
      else if (k === 'shiftclick') { const [x, y] = await pt(step); await page.keyboard.down('Shift'); await page.mouse.click(x, y); await page.keyboard.up('Shift'); }
      else if (k === 'clickxy') { await page.mouse.click(step[1], step[2]); }
      else if (k === 'key') await page.keyboard.press(step[1]);
    }
    const d = await page.evaluate(() => window.__desc());
    out.push({ name: c.name, ...d });
    console.log(JSON.stringify({ name: c.name, ...d }));
  }
  await browser.close();
})();
