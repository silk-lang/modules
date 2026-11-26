// Same as bun-serve.js, on the runtime's native serve().
const { serve } = require('silk:serve');
serve({ port: +process.env.PORT || 3000, fetch(req) { return new Response('Bun!'); } });
