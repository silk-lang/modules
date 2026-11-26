import net from "node:net";
import vm from "node:vm";
export function fakeHost(port) {
  const calls = [];
  const logs = [];
  const socket = net.connect(port, "127.0.0.1");
  const native = new Proxy(
    {
      devSend: (line) => socket.write(`${line}\n`),
      now: () => performance.now(),
    },
    {
      get(target, name) {
        if (name in target) return target[name];
        return (...args) => {
          calls.push([name, ...args]);
        };
      },
    },
  );
  const print = (...args) => logs.push(args.join(" "));
  const context = vm.createContext({
    __ui: native,
    console: { log: print, info: print, debug: print, warn: print, error: print },
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    queueMicrotask,
    performance,
    process: undefined,
  });
  let pending = "";
  let message = "";
  socket.setEncoding("utf8");
  socket.on("data", (text) => {
    pending += text;
    let end;
    while ((end = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      message += line.slice(2);
      if (line[1] === "+") continue;
      const whole = message;
      message = "";
      if (line[0] === "b") vm.runInContext(`(0, eval)(${whole})`, context);
      else native.devMessage(whole);
    }
  });
  const texts = () => calls.filter((call) => call[0] === "setText").map((call) => call[2]);
  return { calls, logs, texts, close: () => socket.destroy() };
}
