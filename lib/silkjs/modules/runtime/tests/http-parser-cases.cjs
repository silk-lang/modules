// Prints one JSON line per case: the events Node's HTTPParser reports for the input, split at
// every given point, and how it fails. tests/http-parser-differential.mjs compares a runtime's
// lines with Node's.
const { HTTPParser, methods } = require('_http_common');
const { kOnMessageBegin, kOnHeaders, kOnHeadersComplete, kOnBody, kOnMessageComplete } = HTTPParser;
const LENIENT_HEADERS = 1, LENIENT_CHUNKED_LENGTH = 2, LENIENT_KEEP_ALIVE = 4;

function run(name, type, input, options = {}) {
  const events = [];
  try { runCase(events, type, input, options); } catch (error) { events.push(['threw', String(error && error.message)]); }
  console.log(JSON.stringify({ name, events }));
}
function runCase(events, type, input, options) {
  const parser = new HTTPParser();
  parser.initialize(type, {}, options.maxHeaderSize ?? 0, options.lenient ?? 0);
  parser[kOnMessageBegin] = () => { events.push(['begin']); };
  parser[kOnHeaders] = (headers, url) => { events.push(['headers', headers, url]); };
  parser[kOnHeadersComplete] = (major, minor, headers, method, url, status, message, upgrade, keepAlive) => {
    events.push(['complete', major, minor, headers, method === undefined ? undefined : methods[method], url, status, message, upgrade, keepAlive]);
    return options.skipBody ? 1 : 0;
  };
  parser[kOnBody] = (chunk) => { events.push(['body', chunk.toString('latin1')]); };
  parser[kOnMessageComplete] = () => { events.push(['message']); };
  const bytes = Buffer.from(input, 'latin1');
  const cuts = [0, ...(options.split ?? []), bytes.length];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const result = parser.execute(bytes.subarray(cuts[i], cuts[i + 1]));
    if (result instanceof Error) { events.push(['error', result.code, result.reason, result.bytesParsed]); break; }
    events.push(['executed', result]);
  }
  const end = parser.finish();
  if (end instanceof Error) events.push(['finish', end.code, end.reason]);
  parser.close?.();
}
const REQ = HTTPParser.REQUEST, RES = HTTPParser.RESPONSE;
// Requests.
run('get', REQ, 'GET /a?b=c HTTP/1.1\r\nHost: x\r\nUser-Agent: test\r\n\r\n');
run('get split everywhere', REQ, 'GET /path HTTP/1.1\r\nHost: example\r\nX-Long: value here\r\n\r\n', { split: [1, 3, 5, 9, 13, 18, 20, 25, 30, 40, 45] });
run('post content-length', REQ, 'POST /p HTTP/1.1\r\nContent-Length: 11\r\n\r\nhello world');
run('post body split', REQ, 'POST /p HTTP/1.1\r\nContent-Length: 11\r\n\r\nhello world', { split: [40, 45] });
run('chunked', REQ, 'POST /c HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n6;ext=1\r\n world\r\n0\r\nTrailer: t\r\n\r\n');
run('chunked split', REQ, 'POST /c HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n', { split: [50, 52, 55, 58] });
run('pipelined', REQ, 'GET /1 HTTP/1.1\r\nHost: a\r\n\r\nGET /2 HTTP/1.1\r\nHost: b\r\n\r\n');
run('keep-alive 1.0', REQ, 'GET / HTTP/1.0\r\nConnection: keep-alive\r\n\r\n');
run('close 1.1', REQ, 'GET / HTTP/1.1\r\nConnection: close\r\n\r\n');
run('data after close', REQ, 'GET / HTTP/1.1\r\nConnection: close\r\n\r\nGET / HTTP/1.1\r\n\r\n');
run('upgrade', REQ, 'GET /ws HTTP/1.1\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\nrest of stream');
run('connect', REQ, 'CONNECT host:443 HTTP/1.1\r\nHost: host:443\r\n\r\ntunnel');
run('methods', REQ, 'PURGE /x HTTP/1.1\r\n\r\nM-SEARCH * HTTP/1.1\r\n\r\nOPTIONS * HTTP/1.1\r\n\r\nQUERY /q HTTP/1.1\r\nContent-Length: 0\r\n\r\n');
run('header value spaces', REQ, 'GET / HTTP/1.1\r\nX-A:   padded value   \r\nX-B:\r\nX-C: a\tb\r\n\r\n');
run('many headers', REQ, 'GET / HTTP/1.1\r\n' + Array.from({ length: 40 }, (_, i) => `H${i}: v${i}\r\n`).join('') + '\r\n');
run('header overflow', REQ, 'GET / HTTP/1.1\r\nX: ' + 'a'.repeat(200) + '\r\n\r\n', { maxHeaderSize: 100 });
run('leading crlf', REQ, '\r\n\r\nGET / HTTP/1.1\r\n\r\n');
// Request errors.
run('bad method', REQ, 'GOT / HTTP/1.1\r\n\r\n');
run('lowercase method', REQ, 'get / HTTP/1.1\r\n\r\n');
run('bad version', REQ, 'GET / HTTP/2.1\r\n\r\n');
run('bad version text', REQ, 'GET / HTXP/1.1\r\n\r\n');
run('url control char', REQ, 'GET /a\x01b HTTP/1.1\r\n\r\n');
run('http2 preface', REQ, 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n\x00\x00\x00\x04');
run('http2 preface split', REQ, 'PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n', { split: [3, 15, 18, 20] });
run('http2 preface broken', REQ, 'PRI * HTTP/2.0\r\n\r\nSX\r\n\r\n');
run('bad header token', REQ, 'GET / HTTP/1.1\r\nBad Header: x\r\n\r\n');
run('header value control', REQ, 'GET / HTTP/1.1\r\nX: a\x00b\r\n\r\n');
run('bad content-length', REQ, 'POST / HTTP/1.1\r\nContent-Length: 1x\r\n\r\n');
run('duplicate content-length', REQ, 'POST / HTTP/1.1\r\nContent-Length: 1\r\nContent-Length: 2\r\n\r\nab');
run('te and cl', REQ, 'POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 5\r\n\r\n0\r\n\r\n');
run('te not chunked', REQ, 'POST / HTTP/1.1\r\nTransfer-Encoding: gzip\r\n\r\n');
run('bad chunk size', REQ, 'POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n');
run('lf only', REQ, 'GET / HTTP/1.1\nHost: x\n\n');
run('lenient headers', REQ, 'GET / HTTP/1.1\r\nX: a\x00b\r\n\r\n', { lenient: LENIENT_HEADERS });
run('incomplete at finish', REQ, 'POST / HTTP/1.1\r\nContent-Length: 10\r\n\r\nabc');
run('obs-fold', REQ, 'GET / HTTP/1.1\r\nX: a\r\n  b\r\n\r\n');
// Responses.
run('response', RES, 'HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nhi');
run('response eof body', RES, 'HTTP/1.1 200 OK\r\n\r\nuntil the end');
run('response chunked', RES, 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n3\r\nabc\r\n0\r\n\r\n');
run('response 204', RES, 'HTTP/1.1 204 No Content\r\n\r\n');
run('response 304 then 200', RES, 'HTTP/1.1 304 Not Modified\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\nx');
run('response 100 continue', RES, 'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
run('response 101', RES, 'HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: upgrade\r\n\r\nframes');
run('response head', RES, 'HTTP/1.1 200 OK\r\nContent-Length: 50\r\n\r\n', { skipBody: true });
run('response no reason', RES, 'HTTP/1.1 404\r\n\r\n');
run('response 1.0', RES, 'HTTP/1.0 200 OK\r\nContent-Length: 1\r\n\r\nz');
run('bad status', RES, 'HTTP/1.1 2x0 OK\r\n\r\n');
run('bad response start', RES, 'HTXP/1.1 200 OK\r\n\r\n');
run('response split', RES, 'HTTP/1.1 200 OK\r\nX-Header: value\r\nContent-Length: 5\r\n\r\nhello', { split: [4, 9, 13, 17, 26, 33, 50, 55] });
// More shapes.
run('absolute url', REQ, 'GET http://example.com:8080/a/b?c=d#e HTTP/1.1\r\nHost: example.com\r\n\r\n');
run('query and fragment', REQ, 'GET /p?x=1&y=%20#frag HTTP/1.1\r\n\r\n');
run('obs-text value', REQ, 'GET / HTTP/1.1\r\nX: caf\xe9\r\n\r\n');
run('long url split', REQ, 'GET /' + 'u'.repeat(300) + ' HTTP/1.1\r\n\r\n', { split: [3, 50, 120, 299, 305] });
run('chunk extensions', REQ, 'POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n3;a=b;c="d e"\r\nabc\r\n0;last\r\n\r\n');
run('two trailers', RES, 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\nok\r\n0\r\nA: 1\r\nB: 2\r\n\r\n');
run('chunk size split', RES, 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n1a\r\n' + 'z'.repeat(26) + '\r\n0\r\n\r\n', { split: [46, 47, 48, 50, 60] });
run('pipelined responses', RES, 'HTTP/1.1 200 OK\r\nContent-Length: 1\r\n\r\naHTTP/1.1 201 Created\r\nContent-Length: 2\r\n\r\nbc');
run('upgrade with body', REQ, 'POST /u HTTP/1.1\r\nConnection: upgrade\r\nUpgrade: x\r\nContent-Length: 3\r\n\r\nabcrest');
run('connect with data split', REQ, 'CONNECT a:1 HTTP/1.1\r\n\r\nxyz', { split: [10, 25] });
run('te chunked list', REQ, 'POST / HTTP/1.1\r\nTransfer-Encoding: gzip, chunked\r\n\r\n1\r\nq\r\n0\r\n\r\n');
run('te chunked not last', RES, 'HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked, gzip\r\n\r\nraw until close');
run('connection tokens', REQ, 'GET / HTTP/1.1\r\nConnection: keep-alive, Upgrade\r\nUpgrade: h2c\r\n\r\n');
run('http 1.0 no keep-alive', REQ, 'GET / HTTP/1.0\r\n\r\nGET / HTTP/1.0\r\n\r\n');
run('finish in head', REQ, 'GET / HTTP/1.1\r\nHost: x');
run('finish in chunk', REQ, 'POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n5\r\nab');
run('lenient chunked length', REQ, 'POST / HTTP/1.1\r\nTransfer-Encoding: chunked\r\nContent-Length: 3\r\n\r\n0\r\n\r\n', { lenient: LENIENT_CHUNKED_LENGTH });
run('lenient keep-alive', REQ, 'GET / HTTP/1.1\r\nConnection: close\r\n\r\nGET /2 HTTP/1.1\r\n\r\n', { lenient: LENIENT_KEEP_ALIVE });
run('empty content-length value', REQ, 'POST / HTTP/1.1\r\nContent-Length: \r\n\r\n');
run('space before colon', REQ, 'GET / HTTP/1.1\r\nHost : x\r\n\r\n');
run('missing lf', REQ, 'GET / HTTP/1.1\r\nHost: x\rY');
run('status 1xx then', RES, 'HTTP/1.1 103 Early Hints\r\nLink: </s>\r\n\r\nHTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n');
run('response split body', RES, 'HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n0123456789', { split: [39, 41, 45] });
run('header field split', REQ, 'GET / HTTP/1.1\r\nContent-Type: text/plain\r\n\r\n', { split: [18, 22, 30, 32, 40] });
