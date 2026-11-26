import { spawnSync } from "node:child_process";
const N = +process.env.N || 300;
for (let i = 0; i < 20; i++) spawnSync("echo", ["hi"]);
const t = performance.now();
for (let i = 0; i < N; i++) spawnSync("echo", ["hi"]);
const us = (performance.now() - t) * 1000 / N;
console.log(`spawnSync echo hi: ${us.toFixed(1)} us/iter`);
