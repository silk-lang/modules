require("http").createServer((req, res) => res.end("Bun!")).listen(+process.env.PORT || 3000);
