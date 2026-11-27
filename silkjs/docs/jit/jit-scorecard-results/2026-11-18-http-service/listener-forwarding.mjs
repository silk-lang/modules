import { createServer } from 'node:http';


let depth = 0;
const retained = Symbol('forwarding chains');
let dataEvents = 0, endEvents = 0;
function forwarding(next) {
  return function forward(...args) { return next.apply(this, args); };
}
function chain(listener) {
  const links = [listener];
  for (let i = 0; i < 8; i++) links.push(forwarding(links[i]));
  return links;
}

function totalCents(lines) {
  let total = 0;
  for (let i = 0; i < lines.length; i++) total += lines[i].units * lines[i].price;
  return total;
}

const server = createServer((request, response) => {
  if (request.url.startsWith('/probe-depth/')) {
    depth = +request.url.slice('/probe-depth/'.length);
    response.end('ok');
    return;
  }
  if (request.method === 'POST' && request.url === '/stop') {
    console.log('events', dataEvents, endEvents);
    response.end('stopped');
    server.close();
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  const data = chain(function(chunk) {
    if (this !== request || arguments.length !== 1) throw Error('data arguments');
    dataEvents++;
    body += chunk;
  });
  const end = chain(function() {
    if (this !== request || arguments.length !== 0) throw Error('end arguments');
    endEvents++;
    const order = JSON.parse(body);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: order.id, total: totalCents(order.lines) }));
  });
  request[retained] = [data, end];
  request.on('data', data[depth]);
  request.on('end', end[depth]);
});

server.listen(0, '127.0.0.1', () => console.log('ready ' + server.address().port));
