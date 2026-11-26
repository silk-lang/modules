// Integration test: the real dev task, generated DOM host, and Chromium.
// Requires `silk` and `chromium` on PATH. Run separately from other fixture builds.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const fixture = fileURLToPath(new URL('../examples/loom/', import.meta.url));
const modulePath = resolve(fileURLToPath(new URL('..', import.meta.url)));
const temporary = await mkdtemp(join(tmpdir(), 'silkui-styles-'));
let app, browser, ws;
let buildLog = '';

function outputUntil(child, pattern, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('Timed out waiting for ' + pattern)), timeout);
    let output = '';
    const data = chunk => {
      output = (output + String(chunk)).slice(-65536);
      const match = output.match(pattern);
      if (match) finish(null, match[1]);
    };
    const ended = code => finish(new Error('Process ended before it was ready: ' + code));
    function finish(error, value) {
      clearTimeout(timer);
      child.stdout?.off('data', data);
      child.stderr?.off('data', data);
      child.off('exit', ended);
      child.off('error', finish);
      error ? reject(error) : resolve(value);
    }
    child.stdout?.on('data', data);
    child.stderr?.on('data', data);
    child.once('exit', ended);
    child.once('error', finish);
  });
}

async function stop(child, group = false) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const ended = new Promise(resolve => child.once('exit', resolve));
  if (group) process.kill(-child.pid, 'SIGTERM');
  else child.kill('SIGTERM');
  await ended;
}

try {
  await mkdir(join(temporary, 'silk'));
  await mkdir(join(temporary, 'styles'));
  await mkdir(join(temporary, 'fonts'));
  const font = join(temporary, 'fonts/brand.ttf');
  const monoFont = new URL('../../assets/assets/fonts/GeistMono.subset.ttf', import.meta.url);
  const sansFont = new URL('../../assets/assets/fonts/NotoSans-Regular.subset.ttf', import.meta.url);
  await copyFile(monoFont, font);
  await copyFile(join(fixture, 'silk/app.silk'), join(temporary, 'silk/app.silk'));
  await copyFile(join(fixture, 'styles/app.css'), join(temporary, 'styles/app.css'));
  const theme = join(temporary, 'silk/theme.css');
  const original = (await readFile(join(fixture, 'styles/theme.css'), 'utf8')) + '\n@font-face{font-family:Bundled;src:url("../fonts/brand.ttf");font-display:swap}.font-probe{display:inline-block;font:16px Bundled}';
  await writeFile(theme, original);
  // A configured CSS file under silk/ must not also trigger a program rebuild.
  const tasks = (await readFile(join(fixture, 'silk/tasks.silk'), 'utf8')).replace('styles/theme.css', 'silk/theme.css');
  await writeFile(join(temporary, 'silk/tasks.silk'), tasks);
  const manifest = (await readFile(join(fixture, 'silk.toml'), 'utf8')).replace('path = "../.."', 'path = ' + JSON.stringify(modulePath));
  await writeFile(join(temporary, 'silk.toml'), manifest);
  app = spawn(process.env.SILK ?? 'silk', ['task', 'dev', '--target', 'web-dom'], {
    cwd: temporary, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [app.stdout, app.stderr]) stream.on('data', data => { buildLog += data; });
  const pageURL = await outputUntil(app, /serving the page on (http:\/\/127\.0\.0\.1:\d+\/)/, 120000);
  browser = spawn(process.env.CHROMIUM ?? 'chromium', [
    '--headless', '--no-sandbox', '--disable-gpu', '--no-first-run',
    '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0',
    '--user-data-dir=' + join(temporary, 'browser'), 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  const endpoint = await outputUntil(browser, /DevTools listening on (ws:\/\/[^\s]+)/, 15000);
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
    reply.error ? request.reject(reply.error) : request.resolve(reply.result);
  };
  function send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('CDP timeout: ' + method)); }, 15000);
      pending.set(id, { resolve, reject, timer });
      ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async function evaluate(expression) {
    const answer = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    assert.equal(answer.exceptionDetails, undefined, JSON.stringify(answer.exceptionDetails));
    return answer.result.value;
  }
  await send('Page.enable');
  await send('Page.navigate', { url: pageURL });
  await evaluate(`(async () => {
    for (let i = 0; i < 100 && !document.querySelector('.count'); i++) await new Promise(r => setTimeout(r, 50));
    window.styleTestToken = 'survived';
    const plus = Array.from(document.querySelectorAll('.counter-button')).find(x => x.textContent === '+');
    plus.click(); plus.click();
  })()`);
  const origin = await evaluate('performance.timeOrigin');
  const fontWidth = await evaluate(`(async()=>{
    const probe=document.createElement('span');probe.className='font-probe';probe.textContent='iiiiiiii';document.body.append(probe);
    await document.fonts.load('16px Bundled','iiiiiiii');return probe.getBoundingClientRect().width;
  })()`);
  assert.ok(fontWidth > 70 && fontWidth < 80, 'the generated DOM sheet loads its bundled font');
  await copyFile(sansFont, font);
  const fontUpdate = await evaluate(`(async()=>{
    for(let i=0;i<100;i++){
      await document.fonts.load('16px Bundled','iiiiiiii');
      const width=document.querySelector('.font-probe').getBoundingClientRect().width;
      if(width > 30 && width < 40) return {width,origin:performance.timeOrigin,token:window.styleTestToken,count:document.querySelector('.count').textContent};
      await new Promise(r=>setTimeout(r,50));
    }
    throw new Error('font-only stylesheet update timed out');
  })()`);
  assert.equal(fontUpdate.origin,origin);
  assert.equal(fontUpdate.token,'survived');
  assert.equal(fontUpdate.count,'2');
  async function waitForColor(color) {
    return evaluate(`(async () => {
      for (let i = 0; i < 100; i++) {
        const count = document.querySelector('.count');
        if (count && getComputedStyle(count).color === ${JSON.stringify(color)}) return {
          count: count.textContent, token: window.styleTestToken, origin: performance.timeOrigin,
          sheets: Array.from(document.querySelectorAll('link[data-silkui-sheet]'), link => new URL(link.href).pathname)
        };
        await new Promise(r => setTimeout(r, 50));
      }
      throw new Error('CSS replacement timed out');
    })()`);
  }
  await writeFile(theme, original.replace('#164e63', '#166534'));
  const expected = { count: '2', token: 'survived', origin, sheets: ['/style-0.css', '/style-1.css'] };
  assert.deepEqual(await waitForColor('rgb(22, 101, 52)'), expected);
  await unlink(theme);
  await evaluate('new Promise(r => setTimeout(r, 900))');
  assert.deepEqual(await waitForColor('rgb(22, 101, 52)'), expected);
  await writeFile(theme, original);
  assert.deepEqual(await waitForColor('rgb(22, 78, 99)'), expected);
  assert.doesNotMatch(buildLog, /silk\/ changed: rebuilding/);
  // A subsequent source rebuild must carry the current CSS, not the initial host copy.
  await writeFile(theme, original.replace('#164e63', '#166534'));
  assert.deepEqual(await waitForColor('rgb(22, 101, 52)'), expected);
  const appSource = join(temporary, 'silk/app.silk');
  await writeFile(appSource, (await readFile(appSource, 'utf8')) + '\n// Rebuild after CSS hot replacement.\n');
  await evaluate(`(async () => {
    for (let i = 0; i < 200; i++) {
      if (performance.timeOrigin !== ${origin}) return;
      await new Promise(r => setTimeout(r, 50));
    }
  })()` ).catch(() => {}); // Navigation destroys the old execution context.
  let rebuilt;
  for (let i = 0; i < 100; i++) {
    try {
      rebuilt = await evaluate("({origin:performance.timeOrigin,count:document.querySelector('.count')?.textContent,color:document.querySelector('.count')?getComputedStyle(document.querySelector('.count')).color:''})");
      if (rebuilt.origin !== origin && rebuilt.count === '0') break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.notEqual(rebuilt?.origin, origin);
  assert.equal(rebuilt?.count, '0');
  assert.equal(rebuilt?.color, 'rgb(22, 101, 52)');
  console.log('PASS: bundled fonts load and hot-update; CSS replacement preserves state and order, recovers from missing files, and survives source rebuilds');
} catch (error) {
  console.error(buildLog);
  throw error;
} finally {
  ws?.close();
  await stop(browser);
  await stop(app, true);
  await rm(temporary, { recursive: true, force: true });
}
