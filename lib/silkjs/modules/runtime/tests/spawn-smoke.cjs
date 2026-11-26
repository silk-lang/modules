'use strict';
// child_process.spawn, against Node. On macOS the runtime starts children with posix_spawn, as
// libuv 1.51 does there (ext/uv_spawn_darwin.silk), and forks only for a user or group change; on
// Linux it forks (ext/uv_loop.silk). Either way the child must see what a libuv child sees: only
// its stdio slots as descriptors, every signal at its default disposition and none blocked, the
// working directory, a new session when detached, the program found in the PATH of its own
// environment, and the same errors for a missing program, a program it may not run, or a bad cwd.
//
// Each scenario runs in a child process, once with this runtime and once with NODE_REFERENCE when
// it is set, and prints its observations as JSON; the two must be equal. Without NODE_REFERENCE
// only the built-in expectations are checked.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const darwin = process.platform === 'darwin';
const SH = '/bin/sh';

// The end of a child: its exit, what it wrote, or the error of the spawn.
function run(file, args, options = {}, feed) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(file, args, options); }
    catch (error) { resolve({ thrown: error.code }); return; }
    const out = [], err = [];
    child.stdout?.on('data', chunk => out.push(chunk));
    child.stderr?.on('data', chunk => err.push(chunk));
    if (feed !== undefined) child.stdin.end(feed);
    let failed = null;
    child.on('error', error => {
      failed = { code: error.code, errno: error.errno, syscall: error.syscall, path: error.path, spawnargs: error.spawnargs };
    });
    child.on('close', (code, signal) => {
      if (failed) { resolve({ error: failed, pid: child.pid === undefined ? 'none' : 'some' }); return; }
      resolve({ code, signal, stdout: Buffer.concat(out).toString(), stderr: Buffer.concat(err).toString() });
    });
  });
}
const lines = text => text.split('\n').filter(Boolean);
const pipes = { stdio: ['ignore', 'pipe', 'pipe'] };
// The descriptors a child has, without the one `ls` opens to list them.
const LIST_FDS = 'for f in /dev/fd/*; do n=${f##*/}; [ -e "$f" ] && echo $n; done';

const scenarios = {
  async exitCodes() {
    const result = {};
    for (const code of [0, 1, 42, 255]) result[code] = await run(SH, ['-c', `exit ${code}`]);
    result.killedSelf = await run(SH, ['-c', 'kill -9 $$']);
    result.terminatedSelf = await run(SH, ['-c', 'kill -TERM $$']);
    return result;
  },
  async stdio(root) {
    const file = path.join(root, 'inherited');
    const fd = fs.openSync(file, 'w');
    const inherited = await run(SH, ['-c', 'echo to-file; echo err-to-file >&2'], { stdio: ['ignore', fd, fd] });
    fs.closeSync(fd);
    return {
      inherited: { ...inherited, file: fs.readFileSync(file, 'utf8') },
      // An ignored stdin reads end of file; ignored stdout and stderr go nowhere.
      ignoredStdin: await run(SH, ['-c', 'read line; echo "read=$? [$line]"'], pipes),
      ignoredOutput: await run(SH, ['-c', 'echo lost; echo lost >&2; exit 7'], { stdio: 'ignore' }),
      piped: await run('cat', [], { stdio: ['pipe', 'pipe', 'pipe'] }, 'through the pipe\n'),
      both: await run(SH, ['-c', 'echo out; echo err >&2'], pipes),
    };
  },
  // Only the stdio slots reach the child: 0-2, and 3 and 4 when passed, including a parent
  // descriptor lower than its slot (slot 3 given the parent's stdin).
  async descriptors(root) {
    const extra = fs.openSync(path.join(root, 'extra'), 'w');
    const result = {
      three: await run(SH, ['-c', LIST_FDS], pipes),
      withExtra: await run(SH, ['-c', LIST_FDS], { stdio: ['ignore', 'pipe', 'pipe', extra, 'pipe'] }),
      lowIntoHigh: await run(SH, ['-c', LIST_FDS], { stdio: ['ignore', 'pipe', 'pipe', 0] }),
      // stdout given to slot 2 and the pipe to slot 1: the low descriptor moves first.
      swapped: await run(SH, ['-c', 'echo to-slot-1; echo to-slot-2 >&2'], { stdio: ['ignore', 'pipe', extra] }),
    };
    fs.closeSync(extra);
    result.swapped.file = fs.readFileSync(path.join(root, 'extra'), 'utf8');
    for (const key of ['three', 'withExtra', 'lowIntoHigh']) result[key].stdout = lines(result[key].stdout).map(Number).sort((a, b) => a - b);
    return result;
  },
  async cwd(root) {
    const dir = path.join(root, 'work dir');
    fs.mkdirSync(dir);
    return {
      inside: await run(SH, ['-c', 'pwd -P'], { ...pipes, cwd: dir }),
      relativeProgram: await run('./tool.sh', [], { ...pipes, cwd: (fs.writeFileSync(path.join(dir, 'tool.sh'), '#!/bin/sh\necho tool in "$(pwd -P)"\n', { mode: 0o755 }), dir) }),
      missingDir: await run(SH, ['-c', 'true'], { ...pipes, cwd: path.join(root, 'no-such-dir') }),
      missingDirAndProgram: await run('no-such-program-silk', [], { ...pipes, cwd: path.join(root, 'no-such-dir') }),
      notADir: await run(SH, ['-c', 'true'], { ...pipes, cwd: (fs.writeFileSync(path.join(root, 'plain'), ''), path.join(root, 'plain')) }),
    };
  },
  // The program is found in the PATH of the child's environment, not the parent's.
  async pathSearch(root) {
    const first = path.join(root, 'first'), second = path.join(root, 'second'), work = path.join(root, 'work');
    for (const dir of [first, second, work]) fs.mkdirSync(dir);
    fs.writeFileSync(path.join(first, 'silk-tool'), '#!/bin/sh\necho first\n', { mode: 0o644 });
    fs.writeFileSync(path.join(second, 'silk-tool'), '#!/bin/sh\necho second\n', { mode: 0o755 });
    fs.writeFileSync(path.join(first, 'only-denied'), '#!/bin/sh\necho denied\n', { mode: 0o644 });
    fs.writeFileSync(path.join(work, 'here-tool'), '#!/bin/sh\necho here\n', { mode: 0o755 });
    fs.writeFileSync(path.join(root, 'no-exec'), '#!/bin/sh\necho no\n', { mode: 0o644 });
    const env = dirs => ({ ...pipes, env: { PATH: dirs.join(':'), SILK_SMOKE: '1' } });
    return {
      // A file it may not run in the first entry is skipped for a runnable one later.
      skipsDenied: await run('silk-tool', [], env([path.join(root, 'none'), first, second])),
      onlyDenied: await run('only-denied', [], env([first])),
      notFound: await run('silk-tool', [], env([path.join(root, 'none')])),
      // An empty entry stands for the working directory.
      emptyEntry: await run('here-tool', [], { ...env(['', path.join(root, 'none')]), cwd: work }),
      // No PATH at all: /usr/bin:/bin.
      defaultPath: await run('sh', ['-c', 'echo "$SILK_SMOKE"'], { ...pipes, env: { SILK_SMOKE: 'default' } }),
      environment: await run(SH, ['-c', 'echo "$SILK_SMOKE:${HOME-unset}"'], env(['/usr/bin', '/bin'])),
      absoluteDenied: await run(path.join(root, 'no-exec'), [], pipes),
      absoluteMissing: await run(path.join(root, 'none', 'tool'), [], pipes),
      directory: await run(root, [], pipes),
      tooLong: await run('x'.repeat(300), [], env(['/usr/bin'])),
    };
  },
  async missing() {
    return {
      byName: await run('no-such-program-silk', ['a', 'b'], pipes),
      absolute: await run('/no/such/program', [], pipes),
    };
  },
  // Dispositions and the mask: the parent handles or ignores these, the child must not.
  async signals() {
    const handled = () => {};
    process.on('SIGUSR1', handled); process.on('SIGINT', handled); process.on('SIGHUP', handled);
    const result = {};
    for (const name of ['USR1', 'INT', 'HUP', 'PIPE', 'TERM', 'USR2', 'ALRM', 'CHLD']) {
      // CHLD's default is to ignore: the shell lives on; for the others it dies of the signal.
      result[name] = await run(SH, ['-c', `kill -${name} $$; echo survived`], pipes);
    }
    process.off('SIGUSR1', handled); process.off('SIGINT', handled); process.off('SIGHUP', handled);
    return result;
  },
  async kill() {
    const result = {};
    for (const signal of ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGUSR2']) {
      const child = spawn(SH, ['-c', 'exec sleep 30'], { stdio: 'ignore' });
      const ended = new Promise(resolve => child.on('exit', (code, sig) => resolve({ code, signal: sig })));
      await new Promise(resolve => setTimeout(resolve, 100));
      result[signal] = { sent: child.kill(signal), ...(await ended), killed: child.killed };
    }
    const done = spawn(SH, ['-c', 'exit 0'], { stdio: 'ignore' });
    await new Promise(resolve => done.on('exit', resolve));
    result.afterExit = { sent: done.kill('SIGTERM') };
    return result;
  },
  // A program whose loop ends while unreferenced children run leaves them running, and its
  // teardown takes their exit watches off the loop: with a stdin pipe (as a desktop app's server)
  // and without.
  async endWithChildren() {
    const script = "const { spawn } = require('node:child_process');" +
      "spawn('/bin/sh', ['-c', 'sleep 2'], { stdio: ['pipe', 'ignore', 'ignore'] }).unref();" +
      "spawn('/bin/sh', ['-c', 'sleep 2'], { stdio: 'ignore' }).unref();" +
      "process.exitCode = 3;";
    return { exited: await run(process.execPath, ['-e', script], pipes) };
  },
  // A detached child leads a new session; an attached one shares the parent's.
  async sessions() {
    const python = ['/usr/bin/python3', '/usr/local/bin/python3', '/opt/homebrew/bin/python3'].find(p => fs.existsSync(p));
    if (!python) return { skipped: 'no python3 to read the session' };
    const script = 'import os; p=os.getpid(); print(os.getsid(0)==p, os.getpgid(0)==p)';
    return {
      detached: await run(python, ['-c', script], { ...pipes, detached: true }),
      attached: await run(python, ['-c', script], pipes),
    };
  },
};

function expect(name, r) {
  const failures = [];
  const check = (ok, message) => { if (!ok) failures.push(`${name}: ${message}`); };
  const exited = (value, code, label) => check(value.code === code && value.signal === null, `${label}: exit ${value.code} ${value.signal} ${JSON.stringify(value.error || '')}`);
  // Node emits 'error' for ENOENT, EACCES and a few more, and throws from spawn() for the rest.
  const errored = (value, code, label) => check((value.error && value.error.code === code) || value.thrown === code, `${label}: expected ${code}, got ${JSON.stringify(value)}`);
  if (name === 'exitCodes') {
    for (const code of [0, 1, 42, 255]) exited(r[code], code, `exit ${code}`);
    check(r.killedSelf.signal === 'SIGKILL', `kill -9: ${r.killedSelf.signal}`);
    check(r.terminatedSelf.signal === 'SIGTERM', `kill -TERM: ${r.terminatedSelf.signal}`);
  }
  if (name === 'stdio') {
    check(r.inherited.file === 'to-file\nerr-to-file\n', `inherited descriptor got ${JSON.stringify(r.inherited.file)}`);
    check(r.ignoredStdin.stdout === 'read=1 []\n', `ignored stdin: ${JSON.stringify(r.ignoredStdin.stdout)}`);
    exited(r.ignoredOutput, 7, 'ignored output');
    check(r.piped.stdout === 'through the pipe\n', `pipe: ${JSON.stringify(r.piped.stdout)}`);
    check(r.both.stdout === 'out\n' && r.both.stderr === 'err\n', `both: ${JSON.stringify(r.both)}`);
  }
  if (name === 'descriptors') {
    check(JSON.stringify(r.three.stdout) === '[0,1,2]', `three slots: ${JSON.stringify(r.three.stdout)}`);
    check(JSON.stringify(r.withExtra.stdout) === '[0,1,2,3,4]', `five slots: ${JSON.stringify(r.withExtra.stdout)}`);
    check(JSON.stringify(r.lowIntoHigh.stdout) === '[0,1,2,3]', `slot 3 from descriptor 0: ${JSON.stringify(r.lowIntoHigh.stdout)}`);
    check(r.swapped.stdout === 'to-slot-1\n' && r.swapped.file === 'to-slot-2\n', `swapped: ${JSON.stringify(r.swapped)}`);
  }
  if (name === 'cwd') {
    check(r.inside.stdout.trim().endsWith('work dir'), `cwd: ${JSON.stringify(r.inside)}`);
    check(r.relativeProgram.stdout.startsWith('tool in ') && r.relativeProgram.stdout.trim().endsWith('work dir'), `relative program: ${JSON.stringify(r.relativeProgram)}`);
    errored(r.missingDir, 'ENOENT', 'missing cwd');
    errored(r.missingDirAndProgram, 'ENOENT', 'missing cwd and program');
    errored(r.notADir, 'ENOTDIR', 'cwd is a file');
  }
  if (name === 'pathSearch') {
    check(r.skipsDenied.stdout === 'second\n', `skips a file it may not run: ${JSON.stringify(r.skipsDenied)}`);
    errored(r.onlyDenied, 'EACCES', 'only a file it may not run');
    errored(r.notFound, 'ENOENT', 'not in PATH');
    check(r.emptyEntry.stdout === 'here\n', `empty PATH entry: ${JSON.stringify(r.emptyEntry)}`);
    check(r.defaultPath.stdout === 'default\n', `default PATH: ${JSON.stringify(r.defaultPath)}`);
    check(r.environment.stdout === '1:unset\n', `environment: ${JSON.stringify(r.environment)}`);
    errored(r.absoluteDenied, 'EACCES', 'absolute, not executable');
    errored(r.absoluteMissing, 'ENOENT', 'absolute, missing');
    errored(r.directory, 'EACCES', 'a directory');
    errored(r.tooLong, 'ENAMETOOLONG', 'a name longer than NAME_MAX');
  }
  if (name === 'missing') {
    errored(r.byName, 'ENOENT', 'by name');
    if (r.byName.error) {
      check(r.byName.error.syscall === 'spawn no-such-program-silk' && r.byName.error.path === 'no-such-program-silk', `error fields: ${JSON.stringify(r.byName.error)}`);
      check(JSON.stringify(r.byName.error.spawnargs) === '["a","b"]', `spawnargs: ${JSON.stringify(r.byName.error.spawnargs)}`);
    }
    errored(r.absolute, 'ENOENT', 'absolute');
  }
  if (name === 'signals') {
    for (const signal of ['USR1', 'INT', 'HUP', 'PIPE', 'TERM', 'USR2', 'ALRM']) check(r[signal].signal === `SIG${signal}` && r[signal].stdout === '', `SIG${signal} in the child: ${JSON.stringify(r[signal])}`);
    check(r.CHLD.code === 0 && r.CHLD.stdout === 'survived\n', `SIGCHLD in the child: ${JSON.stringify(r.CHLD)}`);
  }
  if (name === 'kill') {
    for (const signal of ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGUSR2']) check(r[signal].sent === true && r[signal].signal === signal && r[signal].code === null && r[signal].killed === true, `${signal}: ${JSON.stringify(r[signal])}`);
    check(r.afterExit.sent === false, `kill after exit: ${JSON.stringify(r.afterExit)}`);
  }
  if (name === 'endWithChildren') exited(r.exited, 3, 'end with running children');
  if (name === 'sessions' && !r.skipped) {
    check(r.detached.stdout === 'True True\n', `detached: ${JSON.stringify(r.detached)}`);
    check(r.attached.stdout === 'False False\n', `attached: ${JSON.stringify(r.attached)}`);
  }
  return failures;
}

async function runScenario(name) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'silk-spawn-')));
  try { return await scenarios[name](root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function inChild(executable, name) {
  // The scenario's own stdin is a pipe it never reads; slot 3 of `lowIntoHigh` inherits it.
  const result = spawnSync(executable, [__filename, '--scenario', name], { encoding: 'utf8', timeout: 120000, input: '' });
  if (result.error) throw new Error(`${name} under ${executable}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${name} under ${executable} exited ${result.status} ${result.signal || ''}\n${result.stdout}${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}
// Paths inside the scenario's temporary directory differ between runs.
function normalize(value) { return JSON.parse(JSON.stringify(value).replace(/silk-spawn-[A-Za-z0-9]+/g, 'silk-spawn-X')); }

async function main() {
  const at = process.argv.indexOf('--scenario');
  if (at !== -1) {
    process.stdout.write(JSON.stringify(await runScenario(process.argv[at + 1])) + '\n');
    return;
  }
  const reference = process.env.NODE_REFERENCE;
  const notes = [], failures = [];
  for (const name of Object.keys(scenarios)) {
    const ours = normalize(inChild(process.execPath, name));
    const missed = expect(name, ours);
    if (reference) {
      const node = normalize(inChild(reference, name));
      const nodeMissed = new Set(expect(name, node).map(m => m.split(':').slice(0, 2).join(':')));
      for (const failure of missed) (nodeMissed.has(failure.split(':').slice(0, 2).join(':')) ? notes : failures).push(failure);
      for (const key of Object.keys(node)) {
        try { assert.deepEqual(ours[key], node[key]); }
        catch { failures.push(`${name}.${key}: ours ${JSON.stringify(ours[key])}, Node ${JSON.stringify(node[key])}`); }
      }
    } else failures.push(...missed);
  }
  for (const note of notes) console.log(`note (Node too): ${note}`);
  for (const failure of failures) console.log(`FAIL ${failure}`);
  if (failures.length) {
    console.log(`spawn smoke FAILED on ${process.platform}: ${failures.length} failures`);
    process.exitCode = 1;
    return;
  }
  console.log(`spawn smoke passed on ${process.platform} (${darwin ? 'posix_spawn' : 'fork and exec'}): ${Object.keys(scenarios).length} scenarios` +
    (reference ? `, equal to Node${notes.length ? `, ${notes.length} notes` : ''}` : ', NODE_REFERENCE unset: not compared with Node'));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
