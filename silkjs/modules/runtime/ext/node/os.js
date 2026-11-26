// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.
//
'use strict';
const host = require('internal/host');
const { Buffer } = require('buffer');
const darwin = host.platform === 'darwin';
const { validateInteger } = require('internal/validators');
function integer(value, name, min = -2147483648, max = 2147483647) {
  validateInteger(value, name, min, max);
  return value;
}
// lib/os.js: each call reads the binding's function then, so a patched binding is used.
const binding = require('internal/os_binding');
function systemError(ctx) {
  // Node's os.js throws ERR_SYSTEM_ERROR with the context the binding filled.
  return new (require('internal/errors').codes.ERR_SYSTEM_ERROR)(ctx);
}
function checked(name, ...args) {
  const ctx = {};
  const result = binding[name](...args, ctx);
  if (result === undefined) throw systemError(ctx);
  return result;
}
// Read on first use: a heap image may hold this module, loaded on another machine.
let unameFields;
const uname = () => unameFields ||= checked('getOSInformation');
function arch() { return host.arch; }
function platform() { return host.platform; }
function availableParallelism() { return binding.getAvailableParallelism(); }
function freemem() { return binding.getFreeMem(); }
function totalmem() { return binding.getTotalMem(); }
function hostname() { return checked('getHostname'); }
function homedir() { return checked('getHomeDirectory'); }
function tmpdir() {
  // Node's POSIX precedence differs from uv_os_tmpdir (which only uses TMPDIR).
  let path = process.env.TMPDIR || process.env.TMP || process.env.TEMP || '/tmp';
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}
function type() { return uname()[0]; }
function version() { return uname()[1]; }
function release() { return uname()[2]; }
function machine() { return uname()[3]; }
function uptime() { return checked('getUptime'); }
function endianness() { return binding.isBigEndian ? 'BE' : 'LE'; }
function loadavg() {
  const values = [0, 0, 0];
  binding.getLoadAvg(values);
  return values;
}
function cpus() {
  const data = binding.getCPUs();
  const result = [];
  for (let i = 0; i < data.length; i += 7)
    result.push({ model: data[i], speed: data[i + 1], times: { user: data[i + 2], nice: data[i + 3], sys: data[i + 4], idle: data[i + 5], irq: data[i + 6] } });
  return result;
}
function networkInterfaces() {
  const data = checked('getInterfaceAddresses');
  const result = {};
  for (let i = 0; i < data.length; i += 7) {
    const name = data[i];
    const family = data[i + 3];
    const entry = { address: data[i + 1], netmask: data[i + 2], family, mac: data[i + 4], internal: data[i + 5], cidr: require('internal/util').getCIDR(data[i + 1], data[i + 2], family) };
    if (data[i + 6] !== -1) entry.scopeid = data[i + 6];
    if (Object.prototype.hasOwnProperty.call(result, name)) result[name].push(entry);
    else Object.defineProperty(result, name, { value: [entry], enumerable: true, configurable: true, writable: true });
  }
  return result;
}
function getPriority(pid) { return checked('getPriority', integer(pid === undefined ? 0 : pid, 'pid')); }
function setPriority(pid, priority) {
  if (priority === undefined) { priority = pid; pid = 0; }
  integer(pid, 'pid'); integer(priority, 'priority', -20, 19);
  const ctx = {};
  if (binding.setPriority(pid, priority, ctx) !== 0) throw systemError(ctx);
}
function userInfo(options) {
  return checked('getUserInfo', options);
}
// The platform's ABI constants are the core's (internal/os_constants).
const constants = require('internal/os_constants');
for (const fn of [arch, availableParallelism, endianness, freemem, homedir, hostname, platform, release, tmpdir, totalmem, type, uptime, version, machine])
  fn[Symbol.toPrimitive] = () => fn();
module.exports = { arch, availableParallelism, cpus, endianness, freemem, getPriority, homedir, hostname, loadavg, networkInterfaces, platform, release, setPriority, tmpdir, totalmem, type, userInfo, uptime, version, machine };
Object.defineProperties(module.exports, {
  constants: { value: constants, enumerable: true },
  EOL: { value: '\n', enumerable: true, configurable: true },
  devNull: { value: '/dev/null', enumerable: true, configurable: true },
});
