'use strict';

const os = require('internal/os_constants');
// Without a file system (Files.empty) fs's constants are not part of it.
const files = require('internal/host').hasService('Files') ? require('fs').constants : {};
module.exports = Object.freeze({
  ...os.dlopen, ...os.errno, ...os.priority, ...os.signals,
  ...files, ...(require('internal/host').hasService('Crypto') ? require('crypto').constants : {}),
});
