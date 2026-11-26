'use strict';
// fs.watch on directories, against Node. On macOS directory watches are FSEvents (libuv's
// src/unix/fsevents.c, here ext/uv_fsevents.silk): names relative to the watched directory,
// UV_FS_EVENT_RECURSIVE, the watched directory's own name when it is renamed or removed, one
// stream for many watched paths, and no events after close. On Linux the same scenarios run on
// inotify (and Node's JavaScript recursive watcher), so the fixture checks the shared contract there.
//
// Each scenario runs in a child process, once with this runtime and once with NODE_REFERENCE when
// it is set, and prints what its watchers saw as JSON. The names each watcher reports must be the
// same under both; event types can differ with FSEvents' coalescing, so a difference there is
// printed as a note. Without NODE_REFERENCE only the built-in expectations are checked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const darwin = process.platform === 'darwin';
// FSEvents delivers 50 ms after the first event of a burst (libuv's latency) plus scheduling.
const SETTLE = darwin ? 500 : 200;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function watch(dir, options = {}) {
  const record = { events: [], errors: [], closed: false, afterClose: 0 };
  record.watcher = fs.watch(dir, options, (type, name) => {
    if (record.closed) record.afterClose++;
    else record.events.push([type, name === null ? null : String(name)]);
  });
  record.watcher.on('error', error => record.errors.push(error.code || String(error)));
  return record;
}
// Watch, let events from the setup drain, then forget them.
async function started(dir, options) {
  const record = watch(dir, options);
  await sleep(SETTLE);
  record.events.length = 0;
  return record;
}
function close(record) { record.watcher.close(); record.closed = true; }
function summary(record) {
  const names = [...new Set(record.events.map(([, name]) => name))].map(String).sort();
  const types = {};
  for (const [type, name] of record.events) (types[String(name)] ||= new Set()).add(type);
  for (const name of Object.keys(types)) types[name] = [...types[name]].sort();
  return { names, types, errors: record.errors, afterClose: record.afterClose };
}
function fresh(root, name) { const dir = path.join(root, name); fs.mkdirSync(dir, { recursive: true }); return dir; }

const scenarios = {
  // Created, modified, renamed and deleted children; nothing from a subdirectory.
  async children(root) {
    const dir = fresh(root, 'watched');
    fs.writeFileSync(path.join(dir, 'pre'), 'x');
    fs.mkdirSync(path.join(dir, 'sub'));
    const record = await started(dir);
    fs.writeFileSync(path.join(dir, 'a'), 'a'); await sleep(SETTLE);
    fs.appendFileSync(path.join(dir, 'pre'), 'more'); await sleep(SETTLE);
    fs.renameSync(path.join(dir, 'a'), path.join(dir, 'b')); await sleep(SETTLE);
    fs.unlinkSync(path.join(dir, 'b')); await sleep(SETTLE);
    fs.mkdirSync(path.join(dir, 'made')); await sleep(SETTLE);
    fs.writeFileSync(path.join(dir, 'sub', 'nested'), 'n'); await sleep(SETTLE);
    close(record);
    return { watched: summary(record) };
  },
  // The same with { recursive: true }: nested names are relative paths.
  async recursive(root) {
    const dir = fresh(root, 'tree');
    fs.mkdirSync(path.join(dir, 'sub', 'deeper'), { recursive: true });
    const record = await started(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'top'), 't'); await sleep(SETTLE);
    fs.writeFileSync(path.join(dir, 'sub', 'nested'), 'n'); await sleep(SETTLE);
    fs.writeFileSync(path.join(dir, 'sub', 'deeper', 'leaf'), 'l'); await sleep(SETTLE);
    fs.renameSync(path.join(dir, 'sub', 'nested'), path.join(dir, 'sub', 'moved')); await sleep(SETTLE);
    close(record);
    return { tree: summary(record) };
  },
  // A directory reached through a symbolic link: names are still relative to it.
  async symlink(root) {
    const dir = fresh(root, 'target');
    const link = path.join(root, 'link');
    fs.symlinkSync(dir, link);
    const record = await started(link);
    fs.writeFileSync(path.join(dir, 'through'), 'x'); await sleep(SETTLE);
    close(record);
    return { link: summary(record) };
  },
  // The watched directory renamed, then another removed: each reports its own name.
  async self(root) {
    const renamed = fresh(root, 'renamed-dir');
    const removed = fresh(root, 'removed-dir');
    const first = await started(renamed);
    const second = await started(removed);
    fs.renameSync(renamed, path.join(root, 'renamed-dir-2')); await sleep(SETTLE);
    fs.rmdirSync(removed); await sleep(SETTLE);
    close(first); close(second);
    return { renamed: summary(first), removed: summary(second) };
  },
  // Many directories at once (one FSEvents stream for all): each watcher sees only its own file.
  async many(root) {
    const records = [];
    for (let i = 0; i < 24; i++) records.push(watch(fresh(root, `d${i}`)));
    await sleep(SETTLE);
    for (const record of records) record.events.length = 0;
    for (let i = 0; i < 24; i++) fs.writeFileSync(path.join(root, `d${i}`, `f${i}`), String(i));
    await sleep(SETTLE * 2);
    const result = {};
    records.forEach((record, i) => { close(record); result[`d${i}`] = summary(record); });
    return result;
  },
  // Two watchers of one directory; closing one keeps the other working.
  async twice(root) {
    const dir = fresh(root, 'shared');
    const first = await started(dir);
    const second = await started(dir);
    first.events.length = 0;
    fs.writeFileSync(path.join(dir, 'both'), 'b'); await sleep(SETTLE);
    close(first); await sleep(SETTLE);
    fs.writeFileSync(path.join(dir, 'second-only'), 's'); await sleep(SETTLE);
    close(second);
    return { first: summary(first), second: summary(second) };
  },
  // Close while a burst is being delivered: no callback after close, and the stream still serves
  // a watcher started afterwards.
  async inflight(root) {
    const dir = fresh(root, 'burst');
    const record = await started(dir);
    for (let i = 0; i < 200; i++) fs.writeFileSync(path.join(dir, `f${i}`), 'x');
    await sleep(darwin ? 60 : 1);
    close(record);
    await sleep(SETTLE);
    const later = fresh(root, 'later');
    const next = await started(later);
    fs.writeFileSync(path.join(later, 'after'), 'a'); await sleep(SETTLE);
    close(next);
    return { closedAfterBurst: { afterClose: record.afterClose, errors: record.errors }, later: summary(next) };
  },
};

// What every runtime must show, whatever the platform: a list of failed expectations.
function expect(name, result) {
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(`${name}: ${message}`); };
  const has = (summary, entry) => check(summary.names.includes(entry), `${entry} not reported (${JSON.stringify(summary.names)})`);
  const typed = (summary, entry, type) => check((summary.types[entry] || []).includes(type), `${entry} not reported as ${type} (${summary.types[entry]})`);
  for (const [key, value] of Object.entries(result)) {
    if (value.errors) check(value.errors.length === 0, `${key}: watcher errors ${value.errors}`);
    if (value.afterClose !== undefined) check(value.afterClose === 0, `${key}: ${value.afterClose} events after close`);
  }
  if (name === 'children') {
    const s = result.watched;
    for (const entry of ['a', 'b', 'pre', 'made']) has(s, entry);
    check(s.names.every(n => !n.includes('/')), `nested name in ${JSON.stringify(s.names)}`);
    check(!s.names.includes('nested'), 'event from a subdirectory');
    typed(s, 'pre', 'change'); typed(s, 'b', 'rename'); typed(s, 'made', 'rename');
  }
  if (name === 'recursive') {
    for (const entry of ['top', path.join('sub', 'nested'), path.join('sub', 'deeper', 'leaf'), path.join('sub', 'moved')]) has(result.tree, entry);
  }
  if (name === 'symlink') has(result.link, 'through');
  if (name === 'self') {
    has(result.renamed, 'renamed-dir'); typed(result.renamed, 'renamed-dir', 'rename');
    has(result.removed, 'removed-dir'); typed(result.removed, 'removed-dir', 'rename');
  }
  if (name === 'many') {
    for (let i = 0; i < 24; i++) check(JSON.stringify(result[`d${i}`].names) === JSON.stringify([`f${i}`]), `d${i} saw ${JSON.stringify(result[`d${i}`].names)}`);
  }
  if (name === 'twice') {
    has(result.first, 'both'); has(result.second, 'both'); has(result.second, 'second-only');
    check(!result.first.names.includes('second-only'), 'the closed watcher saw a later event');
  }
  if (name === 'inflight') check(JSON.stringify(result.later.names) === '["after"]', `watcher started after a close saw ${JSON.stringify(result.later.names)}`);
  return failures;
}

async function runScenario(name) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'silk-fswatch-')));
  try { return await scenarios[name](root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

function inChild(executable, name) {
  const run = spawnSync(executable, [__filename, '--scenario', name], { encoding: 'utf8', timeout: 120000 });
  if (run.error) throw new Error(`${name} under ${executable}: ${run.error.message}`);
  if (run.status !== 0) throw new Error(`${name} under ${executable} exited ${run.status} ${run.signal || ''}\n${run.stdout}${run.stderr}`);
  return JSON.parse(run.stdout.trim().split('\n').pop());
}

// Names must agree; types are compared and reported.
function compare(name, ours, node, notes) {
  for (const key of Object.keys(node)) {
    const a = ours[key], b = node[key];
    if (b && b.names) {
      assert.deepEqual(a.names, b.names, `${name}.${key}: names differ from Node (ours ${JSON.stringify(a.names)}, Node ${JSON.stringify(b.names)})`);
      for (const entry of b.names) {
        if (JSON.stringify(a.types[entry]) !== JSON.stringify(b.types[entry])) notes.push(`${name}.${key}.${entry}: event types ours ${a.types[entry]}, Node ${b.types[entry]}`);
      }
    } else assert.deepEqual(a, b, `${name}.${key}: differs from Node`);
  }
}

async function main() {
  const at = process.argv.indexOf('--scenario');
  if (at !== -1) {
    const result = await runScenario(process.argv[at + 1]);
    process.stdout.write(JSON.stringify(result) + '\n');
    return;
  }
  const reference = process.env.NODE_REFERENCE;
  const notes = [];
  const failures = [];
  for (const name of Object.keys(scenarios)) {
    const ours = inChild(process.execPath, name);
    const missed = expect(name, ours);
    if (reference) {
      const node = inChild(reference, name);
      // An expectation Node does not meet either is the platform's behavior, not a failure.
      const nodeMissed = new Set(expect(name, node).map(m => m.replace(/ \(.*\)$/, '')));
      for (const failure of missed) (nodeMissed.has(failure.replace(/ \(.*\)$/, '')) ? notes : failures).push(failure);
      try { compare(name, ours, node, notes); } catch (error) { failures.push(error.message); }
    } else failures.push(...missed);
  }
  for (const note of notes) console.log(`note: ${note}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  if (failures.length) {
    console.log(`fs.watch directory smoke FAILED on ${process.platform}: ${failures.length} failures`);
    process.exitCode = 1;
    return;
  }
  console.log(`fs.watch directory smoke passed on ${process.platform} (${darwin ? 'FSEvents' : 'inotify'}): ${Object.keys(scenarios).length} scenarios` +
    (reference ? `, compared with Node${notes.length ? `, ${notes.length} notes` : ''}` : ', NODE_REFERENCE unset: not compared with Node'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
