'use strict';
// End to end: an HTTP server that gzips a JSON body per request (zlib.gzip, on the thread pool)
// and a fetch client in the same process that asks for gzip and decodes it. One line of JSON.
//
//   silkjs bench/scripts/gzip-http.cjs [requests]
const http = require('node:http');
const zlib = require('node:zlib');

const requests = Number(process.argv[2] || 400);
const rows = [];
for (let i = 0; i < 4000; i++) rows.push({ id: i, name: 'user' + (i * 7919) % 5000, active: i % 3 !== 0, score: (i * 31) % 1000 / 10, tags: ['alpha', 'beta', 'gamma'].slice(0, 1 + i % 3) });
const body = Buffer.from(JSON.stringify(rows));

const server = http.createServer((request, response) => {
  zlib.gzip(body, (error, packed) => {
    if (error) { response.statusCode = 500; response.end(); return; }
    response.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip', 'content-length': packed.length });
    response.end(packed);
  });
});
server.listen(0, '127.0.0.1', async () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  const one = async () => {
    const response = await fetch(url, { headers: { 'accept-encoding': 'gzip' } });
    const text = await response.text();
    if (text.length !== body.length) throw new Error(`decoded ${text.length} of ${body.length} bytes`);
  };
  for (let i = 0; i < 20; i++) await one();
  const start = process.hrtime.bigint();
  for (let i = 0; i < requests; i++) await one();
  const seconds = Number(process.hrtime.bigint() - start) / 1e9;
  console.log(JSON.stringify({ name: 'gzip-http', requestsPerSecond: +(requests / seconds).toFixed(1), bodyBytes: body.length, maxRssMb: +(process.resourceUsage().maxRSS / 1024).toFixed(1) }));
  server.close();
});
