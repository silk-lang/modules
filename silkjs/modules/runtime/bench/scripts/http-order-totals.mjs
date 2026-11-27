import { createServer } from 'node:http';

function totalCents(lines) {
  let total = 0;
  for (let i = 0; i < lines.length; i++) total += lines[i].units * lines[i].price;
  return total;
}

const server = createServer((request, response) => {
  if (request.method === 'POST' && request.url === '/stop') {
    response.end('stopped');
    server.close();
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { body += chunk; });
  request.on('end', () => {
    const order = JSON.parse(body);
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ id: order.id, total: totalCents(order.lines) }));
  });
});

server.listen(0, '127.0.0.1', () => console.log('ready ' + server.address().port));
