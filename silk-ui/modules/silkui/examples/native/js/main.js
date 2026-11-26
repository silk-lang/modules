import { createBox, createText, mount } from "@silkui/core";
import { countPrimes, divide, fib, greet, isPrime } from "../silk/math.silk";

// Each call runs the Silk function in the host, natively. `.async` runs it on a thread.
const lines = [
  greet("JavaScript"),
  `isPrime(97) = ${isPrime(97)}`,
  `fib(90) = ${fib(90)}`,
];
try {
  divide(1, 0);
} catch (error) {
  lines.push(`divide(1, 0) threw: ${error.message}`);
}

const status = createText("counting primes below 2,000,000 on a thread…");
countPrimes.async(2_000_000).then((count) => {
  status.data = `${count} primes below 2,000,000`;
});

mount(
  createBox(
    { position: "absolute", inset: 0, display: "flex", flexDirection: "column", gap: 8, padding: 24, backgroundColor: "rgb(250, 250, 250)", fontFamily: "sans-serif", fontSize: 16 },
    ...lines.map((line) => createBox({}, createText(line))),
    createBox({ color: "rgb(37, 99, 235)" }, status),
  ),
);
