# Kernel time of the HTTP order service, by system call

Step 0 of the plan of 20 November left one item open: name the kernel time on the HTTP order
service (28 µs per order with the default JIT on 19 November, 11 more with compiled calls).
This is that measurement, on the embedding host of `modules/jit/embed-smoke` at the head of
`claude/project-thread-4okpcj`, with Node 22.23 beside it on the same fixture and client.

The host this ran on is about 1.35 times slower than the one of 19 November (Node takes 73 µs
of CPU per order here, 54 there), so read the numbers against each other, not against the
earlier tables.

## Result

The server makes three system calls per order, the same three Node makes with the same
arguments: one `epoll_pwait2`, one `read` of up to 65,536 bytes that returns the 1,739-byte
request, one `write` of the 178-byte response. Both set `TCP_NODELAY`. There is no fourth call
to remove.

CPU per order in µs, sampled on the task clock, 12,000 orders per column after 4,800 to warm:

| | Default JIT | Interpreter | Compiled calls | Node | Node, interpreter only |
| --- | ---: | ---: | ---: | ---: | ---: |
| Orders per second | 2,073 | 2,283 | 1,670 | 7,245 | 4,002 |
| User | 350.6 | 314.3 | 465.3 | 32.5 | 175.9 |
| Kernel | 51.2 | 47.3 | 52.2 | 29.6 | 33.5 |
| `write` (`writev` in Node) | 23.3 | 21.1 | 25.4 | 11.4 | 14.9 |
| `read` | 13.7 | 13.3 | 15.3 | 7.3 | 8.3 |
| `epoll_pwait2` (`epoll_pwait`) | 11.2 | 10.5 | 8.3 | 9.6 | 8.9 |
| Page faults and `madvise` | 1.4 | 1.5 | 2.1 | 0.2 | 0.0 |
| Entry, exit, interrupts | 1.7 | 0.9 | 1.1 | 1.0 | 1.2 |

Repeats on this shared host: the default JIT's kernel time came out at 45.9 and 51.2, Node's
at 29.6, 31.7 and 34.0.

What the kernel does inside those calls, default JIT (Node in brackets):

| Work | µs per order |
| --- | ---: |
| Waking the client, which sleeps on another CPU (`sock_def_readable`, with interrupts off) | 12.4 (7.7) |
| Delivering to the client's socket through loopback: softirq, IP, the peer's receive path | 12.3 (5.8) |
| Going to sleep in `epoll_pwait2` and switching back (`finish_task_switch`) | 7.9 (8.5) |
| TCP transmit | 4.4 (1.6) |
| Copying the request out (`tcp_recvmsg`) | 4.3 (2.0) |
| epoll itself | 2.5 (1.3) |
| Socket buffer allocation and free | 1.9 (0.9) |
| The calls' own entry code, timers | 4.2 (1.6) |

## What it means

- **About 30 µs is the benchmark's shape.** One client sends one order at a time from another
  CPU, so every order costs one wake of the client, one sleep and one wake of the server, and a
  round trip through loopback. Node pays 30 for exactly that. Under concurrent or pipelined
  load most of it is shared between orders.
- **The other 15 to 22 µs is the same kernel work running slower for this process.** Every
  part of the network path costs 1.6 to 2.8 times what it costs under Node, with the same
  calls and sizes. Node's own kernel time rises from 30 to 34 µs when its user work rises
  from 33 to 176 µs per order (interpreter only), so some of it is kernel code and data gone
  cold while user code runs. If that went on in a line it would account for 9 µs at this
  server's 350 µs of user work. The rest is not explained here: this VM has no cache or TLB
  counters. It should be measured again once user time per order has come down.
- **Page faults and `madvise`, 1.4 µs, are the heap's own traffic.** The heap grows by about
  24 KB per order until a collection returns it (resident size holds at 92 MB over 32,000
  orders): the collector takes 7 MB arenas with `mmap` and `MADV_HUGEPAGE`, malloc grows the
  break, and each fresh page faults once. That belongs to the allocation and collection lane of
  the plan, not to the kernel.
- **Compiled calls do not add system calls.** With `--jit-calls` the same three calls cost 52
  µs against 46 to 51: one more `madvise` per 30 orders and slightly slower network calls
  after 465 µs of user work. `/proc` reported 57 against 44 for the same windows, but a window
  of 12,000 orders holds about 55 clock ticks of system time, so that figure is good to 13%
  at best. The 11 µs of 19 November came from the same counter.

So the kernel line of the CPU split is not a lane of its own. It has no call to remove, 30 µs
of it is the single-client loopback round trip that Node pays too, and what is above that has
to be measured again as user time comes down.

## Method

`kernel.py` starts the host pinned to CPU 0 and a client on CPU 1, sends 4,800 verified orders,
then samples every thread of the server on `PERF_COUNT_SW_TASK_CLOCK` every 97 µs of CPU with
the kernel call chain (`ksample.c`) while it sends 12,000 more. A sample in kernel code is
charged to the system call, fault or interrupt its chain entered through, and to the first
frame from the inside that names a known part of the network or scheduler path. Samples in
code that runs with interrupts off land where they are enabled again
(`_raw_spin_unlock_irqrestore`, `finish_task_switch`), which is why the chain and not the
innermost function names the work. A second window of 2,000 orders counts calls with
`strace -c`. No sample was lost or throttled.

```sh
silk build --release --manifest-path modules/jit/embed-smoke/silk.toml
dir=docs/jit/jit-scorecard-results/2026-11-20-http-kernel
python3 $dir/kernel.py --host build/x86_64-unknown-linux-gnu/release/silkjs-jit-embed-smoke --out /tmp/kernel
python3 $dir/kernel.py --host "$(command -v node)" --mode node --out /tmp/kernel-node
```

Modes: `default`, `interpret`, `calls`, `baseline`, `node`, `node-interpreter`. It needs root (or
`perf_event_paranoid` below 2 and `kptr_restrict` 0), `strace` and a C compiler. Results of the
runs above: [default](default.json), [interpreter](interpret.json), [compiled calls](calls.json),
[Node](node.json), [Node, interpreter only](node-interpreter.json).
