const N = +process.env.N || 300;
for (let i = 0; i < 20; i++) Bun.spawnSync({ cmd: ["echo", "hi"] });
const t = performance.now();
for (let i = 0; i < N; i++) Bun.spawnSync({ cmd: ["echo", "hi"] });
console.log(`Bun.spawnSync echo hi: ${((performance.now() - t) * 1000 / N).toFixed(1)} us/iter`);
