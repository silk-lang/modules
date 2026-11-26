'use strict';

// The write goes to the descriptor itself, as Node's SyncWriteStream reaches
// binding.writeBuffer, so a user patch of fs.writeSync does not take over stdio.
// Without a file system (Files.empty) the descriptor is still the process's: the engine's os
// write, and an errno turned into the error fs would throw.
const host = require('internal/host');
const c = host.hasService('Files') ? require('internal/fs/utils') : {
  os: host.rawOS,
  fail(result, syscall) {
    if (result >= 0) return result;
    const code = require('util').getSystemErrorName(result);
    throw Object.assign(new Error(`${code}: ${host.strerror(-result)}, ${syscall}`), { errno: result, code, syscall });
  },
};

// Files and POSIX terminals are synchronous Node stdio destinations. Do not
// silently truncate a partial write, and leave callback scheduling to Writable.
function writeAll(fd, chunk) {
  let offset = 0;
  while (offset < chunk.length) {
    const count = c.fail(c.os.write(fd, chunk.buffer, chunk.byteOffset + offset, chunk.length - offset), 'write');
    if (count === 0) throw Object.assign(new Error('EIO: write returned zero bytes'), { code: 'EIO', syscall: 'write', errno: -5 });
    offset += count;
  }
}

module.exports = { writeAll };
