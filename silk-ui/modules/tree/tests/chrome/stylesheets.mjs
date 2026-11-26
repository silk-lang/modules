// Local Chromium comparison, intentionally outside CI. Requires Node 22+, Silk and Chromium.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const tool = join(root, 'modules/tree/tools/stylesheet-parity');
const cases = JSON.parse(await readFile(join(tool, 'cases.json'), 'utf8'));
const fixtures = ['plain', 'tailwind-small', 'tailwind-app'];
const baseline = await readFile(join(tool, 'baseline.css'), 'utf8');
const sheets = Object.fromEntries(await Promise.all(fixtures.map(async name => [name,
  baseline + '\n' + await readFile(join(root, `modules/tree/tests/fixtures/stylesheets/${name}.css`), 'utf8')])));
if (!process.env.PARITY_BINARY) {
  execFileSync(process.env.SILK ?? 'silk', ['build', '--manifest-path', join(tool, 'silk.toml')], {
    cwd: root, stdio: ['ignore', 'inherit', 'inherit'],
  });
}
const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
const targets = await readdir(join(root, 'build'));
const target = targets.find(name => name.startsWith(arch) && name.includes(
  process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'windows' : 'linux'));
const binary = process.env.PARITY_BINARY ?? join(root, 'build', target, 'dev',
  'ui-stylesheet-parity' + (process.platform === 'win32' ? '.exe' : ''));
const native = JSON.parse(execFileSync(binary, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
assert.equal(native.cases.length, cases.length);
assert.deepEqual(native.diagnostics, JSON.parse(await readFile(join(tool, 'diagnostics.json'), 'utf8')), 'Unexpected stylesheet diagnostics');
const temporary = await mkdtemp(join(tmpdir(), 'silkui-css-parity-'));
let browser, ws;

function ready(child) {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('Chromium startup timed out: ' + output)), 15000);
    const data = chunk => {
      output = (output + chunk).slice(-65536);
      const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) finish(null, match[1]);
    };
    const ended = code => finish(new Error('Chromium exited: ' + code + '\n' + output));
    function finish(error, value) {
      clearTimeout(timer);
      child.stderr.off('data', data);
      child.off('exit', ended);
      child.off('error', finish);
      error ? reject(error) : resolve(value);
    }
    child.stderr.on('data', data);
    child.once('exit', ended);
    child.once('error', finish);
  });
}

function setup(row, css) {
  document.documentElement.id = 'root';
  document.documentElement.className = row.root ?? '';
  if (document.head.querySelector('style')?.textContent !== css) {
    document.head.replaceChildren(Object.assign(document.createElement('style'), { textContent: css }));
  }
  document.body.id = 'body';
  const parent = Object.assign(document.createElement('div'), { id: 'parent', className: row.parent ?? '' });
  const lead = Object.assign(document.createElement('input'), {
    id: 'lead', type: 'checkbox', className: row.lead ?? '', checked: row.checked ?? false,
  });
  const subject = Object.assign(document.createElement(row.tag ?? 'div'), {
    id: 'subject', className: row.classes, disabled: row.disabled ?? false,
  });
  subject.dataset.state = row.open ? 'open' : 'closed';
  for (const id of ['one', 'two', 'three']) {
    const child = Object.assign(document.createElement('div'), { id, className: 'probe' });
    if (id === 'one' && row.childOpen) child.dataset.state = 'open';
    subject.append(child);
  }
  parent.append(lead, subject);
  document.body.replaceChildren(parent);
}

function measure() {
  const subject = document.getElementById('subject');
  const style = getComputedStyle(subject);
  const values = {};
  for (const key of ['display', 'flex-direction', 'flex-wrap']) values[key] = style.getPropertyValue(key);
  for (const key of ['font-size', 'font-weight', 'line-height', 'letter-spacing', 'opacity', 'outline-width', 'outline-offset', 'flex-grow', 'flex-shrink']) {
    const value = style.getPropertyValue(key);
    values[key] = value === 'normal' ? (key === 'line-height' ? parseFloat(style.fontSize) : 0) : parseFloat(value);
  }
  for (const key of ['padding', 'margin', 'border']) {
    values[key] = ['top', 'right', 'bottom', 'left'].map(side => parseFloat(
      style.getPropertyValue(`${key}-${side}${key === 'border' ? '-width' : ''}`)));
  }
  values.radius = ['top-left', 'top-right', 'bottom-right', 'bottom-left'].map(corner => parseFloat(style.getPropertyValue(`border-${corner}-radius`)));
  values.gap = ['row-gap', 'column-gap'].map(key => parseFloat(style.getPropertyValue(key)) || 0);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  for (const key of ['color', 'background-color', 'border-color']) {
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = style.getPropertyValue(key);
    context.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = context.getImageData(0, 0, 1, 1).data;
    values[key] = [r * a / 65025, g * a / 65025, b * a / 65025, a / 255];
  }
  const rects = ['subject', 'one', 'two', 'three'].map(id => {
    const box = document.getElementById(id).getBoundingClientRect();
    return [box.x, box.y, box.width, box.height];
  });
  return { values, rects };
}

try {
  browser = spawn(process.env.CHROMIUM ?? 'chromium', [
    '--no-sandbox', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
    '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0',
    '--user-data-dir=' + join(temporary, 'browser'), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await ready(browser);
  const pages = await (await fetch(endpoint.replace('ws:', 'http:').replace(/\/devtools\/.*/, '/json'))).json();
  ws = new WebSocket(pages.find(page => page.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  ws.onmessage = event => {
    const reply = JSON.parse(event.data);
    const request = pending.get(reply.id);
    if (!request) return;
    pending.delete(reply.id);
    clearTimeout(request.timer);
    reply.error ? request.reject(new Error(JSON.stringify(reply.error))) : request.resolve(reply.result);
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(method + ' timed out')); }, 15000);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const reply = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
    return reply.result.value;
  };
  await call('Page.enable');
  await call('DOM.enable');
  await call('CSS.enable');
  // about:blank is quirks mode; force a standards-mode document before every measurement.
  const { frameTree } = await call('Page.getFrameTree');
  await call('Page.setDocumentContent', { frameId: frameTree.frame.id, html: '<!doctype html><html><head></head><body></body></html>' });
  await call('Emulation.setEmulatedMedia', { features: [
    { name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' },
  ] });
  assert.equal(await evaluate('matchMedia("(hover: hover)").matches'), true, 'Desktop Chromium must support hover');
  const failures = [];
  const near = (a, b, tolerance) => Array.isArray(a)
    ? Array.isArray(b) && a.length === b.length && a.every((item, i) => near(item, b[i], tolerance))
    : typeof a === 'number' ? Number.isFinite(b) && Math.abs(a - b) <= tolerance : a === b;
  for (const [index, row] of cases.entries()) {
    await call('Emulation.setDeviceMetricsOverride', { width: row.width ?? 640, height: 600, deviceScaleFactor: 1, mobile: false });
    await evaluate(`(${setup})(${JSON.stringify(row)},${JSON.stringify(sheets[row.fixture])})`);
    const { root: dom } = await call('DOM.getDocument');
    for (const [selector, active] of [['#subject', row.hover], ['#parent', row.parentHover]]) {
      const { nodeId } = await call('DOM.querySelector', { nodeId: dom.nodeId, selector });
      await call('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [...(active ? ['hover'] : []), ...(selector === '#subject' && row.focus ? ['focus', 'focus-visible'] : [])] });
    }
    const actual = await evaluate(`(${measure})()`);
    const expected = native.cases[index];
    for (const [key, value] of Object.entries(expected.values)) {
      // CSSOM layout is quantized to 1/64 px; canvas colors are quantized to 8-bit sRGB.
      const tolerance = key.includes('color') ? 2 / 255 : 0.02;
      if (!near(value, actual.values[key], tolerance)) failures.push({ ...row, property: key, native: value, chrome: actual.values[key] });
    }
    if (!near(expected.rects, actual.rects, 0.05)) failures.push({ ...row, property: 'rects', native: expected.rects, chrome: actual.rects });
  }
  const result = { chromium: await call('Browser.getVersion'), cases: cases.length, diagnostics: native.diagnostics, failures };
  if (process.env.PARITY_REPORT) await writeFile(process.env.PARITY_REPORT, JSON.stringify(result, null, 2) + '\n');
  for (const failure of failures.slice(0, 30)) console.error(JSON.stringify(failure));
  console.log(`${cases.length} stylesheet cases, ${failures.length} differences; diagnostic feature counts: ${native.diagnostics.map(items => items.length).join(', ')}`);
  assert.equal(failures.length, 0, 'Chromium stylesheet comparison failed');
} finally {
  ws?.close();
  if (browser && browser.exitCode === null && browser.signalCode === null) {
    const stopped = new Promise(resolve => browser.once('exit', resolve));
    browser.kill('SIGTERM');
    await stopped;
  }
  await rm(temporary, { recursive: true, force: true });
}
