'use strict';

const host = require('internal/host');
// Without the network (Network.empty) there are no socket or terminal streams: a descriptor is a
// terminal or not, as the engine's os module says, and every output is written synchronously, as a
// file's is; standard input is read as a file when there is a file system.
const network = host.hasService('Network');
const { native, error: nativeError } = network ? require('internal/net/transport') : {
  native(operation, [fd]) { return host.rawOS.isatty(fd) ? 5 : 6; },
  error(code, syscall) { return Object.assign(new Error(`${syscall} ${code}`), { errno: code, syscall }); },
};

function socket(fd, reading) {
  const owned = native('duplicateFd', [fd]);
  if (owned < 0) throw nativeError(owned, 'dup');
  let stream;
  try { stream = new (require('net').Socket)({ fd: owned, readable: reading, writable: !reading, manualStart: true }); }
  catch (error) { require('fs').closeSync(owned); throw error; }
  stream.fd = fd;
  stream._type = 'pipe';
  return stream;
}

const kRelease = Symbol('kRelease');
// Node's is_main_thread.js addCleanup: a startup snapshot keeps no stream of the
// process that built it (their handles belong to that process); the next use
// builds them again.
function addCleanup(fn) {
  if (host.startupSnapshot.isBuildingSnapshotBuffer[0])
    require('internal/v8/startup_snapshot').namespace.addSerializeCallback(fn);
}

function output(fd) {
  const kind = native('guessHandleType', [fd]);
  let stream;
  if (kind === 5 && network) {
    stream = new (require('tty').WriteStream)(fd);
    stream._type = 'tty';
  } else if ((kind === 1 || kind === 2) && network) {
    stream = socket(fd, false);
    if (process.platform === 'win32') {
      const status = stream._handle.setBlocking(true);
      if (status < 0) { stream.destroy(); throw nativeError(status, 'setBlocking'); }
    }
  } else if (kind === 6 || !network) {
    // Regular files (and character devices such as /dev/null) use synchronous
    // writes on all platforms.
    const { writeAll } = require('internal/tty/write');
    stream = new (require('internal/streams/writable'))({
      autoDestroy: false,
      emitClose: false,
      write(chunk, encoding, callback) {
        let failure;
        try { writeAll(fd, chunk); } catch (error) { failure = error; }
        callback(failure);
      }
    });
    // As Node's SyncWriteStream, which marks itself not readable.
    stream.readable = false;
    stream._type = 'fs';
    if (kind === 5) stream.isTTY = true;
  } else {
    // createWritableStdioStream's dummy black-hole output for a descriptor that is
    // none of these (closed, or a UDP socket).
    stream = new (require('internal/streams/writable'))({ write(buf, enc, cb) { cb(); } });
  }
  stream.fd = fd;
  stream._isStdio = true;
  // Standard output streams survive destroy(), as in Node. The process owns
  // its descriptors; native teardown closes only our duplicated transport fds.
  const destroy = stream._destroy;
  stream[kRelease] = () => { stream._destroy = destroy; stream.destroy(); };
  stream._destroy = function(error, callback) {
    callback(error);
    this._undestroy();
    if (!this._writableState.emitClose) process.nextTick(() => this.emit('close'));
  };
  stream.destroySoon = stream.destroy;
  return stream;
}

function input() {
  const kind = native('guessHandleType', [0]);
  let stream;
  if (kind === 5 && network) {
    stream = new (require('tty').ReadStream)(0);
    stream._type = 'tty';
  } else if ((kind === 1 || kind === 2) && network) {
    stream = socket(0, true);
  } else if (kind === 6 || (!network && host.hasService('Files'))) {
    stream = require('fs').createReadStream(undefined, { fd: 0, autoClose: false });
    stream._type = 'fs';
    // Even an explicit close() must not transfer ownership of process fd 0.
    const destroy = stream._destroy;
    stream._destroy = function(error, callback) { this.autoClose = false; destroy.call(this, error, callback); };
  } else {
    // getStdin's dummy contentless input.
    stream = new (require('internal/streams/readable'))({ read() {} });
    stream.push(null);
  }
  stream.fd = 0;
  stream._isStdio = true;
  if (stream._writableState) stream._writableState.ended = true;
  // As Node's getStdin: don't start reading until the user asks, and stop reading once
  // the stream pauses (one tick later), so that the process can exit.
  if (stream._handle?.readStop) {
    stream._handle.reading = false;
    stream._readableState.reading = false;
    stream._handle.readStop();
    stream.on('pause', () => process.nextTick(onpause));
  }
  function onpause() {
    if (!stream._handle) return;
    if (stream._handle.reading && !stream.readableFlowing) {
      stream._readableState.reading = false;
      stream._handle.reading = false;
      stream._handle.readStop();
    }
  }
  return stream;
}

// Set by install: writes console text to fd 1 or 2 with no stream, or declines.
let direct;

function install(process) {
  let stdin, stdout, stderr;
  const kinds = [];
  const nonblocking = [];
  // console prints through this while a standard stream is untouched: nobody
  // has read process.stdout (or stderr) or redefined it, so there is no stream
  // whose write, listeners or pending data the text could bypass. Files and
  // POSIX terminals take synchronous writes, as their streams do. A pipe or a
  // local socket takes what it has room for at once, as its stream's transport
  // would write it (and like that transport, this makes the descriptor
  // nonblocking); what it has no room for is returned, for the stream to write.
  // What a descriptor is belongs to the process: a start from a heap image asks again.
  host.onHydrate(() => { kinds.length = 0; nonblocking.length = 0; });
  direct = (fd, text) => {
    const name = fd === 1 ? 'stdout' : 'stderr';
    if (fd === 1 ? stdout : stderr) return false;
    const descriptor = Object.getOwnPropertyDescriptor(process, name);
    if (!descriptor || descriptor.get !== getters[name] || process.platform === 'win32') return false;
    const kind = kinds[fd] ??= native('guessHandleType', [fd]);
    if (kind === 5 || kind === 6) return host.writeText(fd, text) !== false;
    if (kind !== 2) return false;
    if (!nonblocking[fd]) {
      if (native('setDescriptorBlocking', [fd, 0]) < 0) return false;
      nonblocking[fd] = true;
    }
    return host.writeText(fd, text);
  };
  const getters = {
    stdout() {
      if (!stdout) {
        stdout = output(1);
        const refresh = () => stdout._refreshSize();
        if (stdout.isTTY) process.on('SIGWINCH', refresh);
        addCleanup(() => { stdout[kRelease](); process.removeListener('SIGWINCH', refresh); stdout = undefined; });
      }
      return stdout;
    },
    stderr() {
      if (!stderr) {
        stderr = output(2);
        const refresh = () => stderr._refreshSize();
        if (stderr.isTTY) process.on('SIGWINCH', refresh);
        addCleanup(() => { stderr[kRelease](); process.removeListener('SIGWINCH', refresh); stderr = undefined; });
      }
      return stderr;
    },
  };
  // In particular, do not inspect/open fd 0 here: the CLI may still need to
  // synchronously consume piped program source before application execution.
  Object.defineProperties(process, {
    stdin: {
      configurable: true, enumerable: true,
      get() {
        if (!stdin) {
          stdin = input();
          addCleanup(() => { stdin.destroy(); stdin = undefined; });
        }
        return stdin;
      },
    },
    stdout: { configurable: true, enumerable: true, get: getters.stdout },
    stderr: { configurable: true, enumerable: true, get: getters.stderr }
  });
  process.openStdin = () => { const stream = process.stdin; stream.resume(); return stream; };
  // Explicit process.exit bypasses native state teardown. Restore terminal mode
  // here too; the shared net state handles normal completion and fatal teardown.
  process.on('exit', () => native('ttyResetMode', []));
}

// node.cc ResetStdio: the terminals stdio found at startup get their modes back.
function resetStdio() { native('ttyResetMode', []); }

module.exports = { install, resetStdio, direct: (fd, text) => direct !== undefined && direct(fd, text) };
