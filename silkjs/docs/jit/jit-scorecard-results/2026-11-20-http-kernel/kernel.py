#!/usr/bin/env python3
"""Where the HTTP order service's kernel time goes (Linux, needs perf_event_open on kernel code).

Starts the JIT embedding host on the order fixture, warms it, then samples the server's threads
on the task clock with kernel call chains (ksample.c) while a client on another CPU sends
verified orders. Each kernel sample is charged to the system call (or fault, or interrupt) its
chain entered the kernel through. A second window counts system calls with strace.

    python3 kernel.py --host build/.../silkjs-jit-embed-smoke --out /tmp/kernel [--mode baseline]
"""
import argparse
import bisect
import collections
import http.client
import json
import os
from pathlib import Path
import re
import select
import signal
import subprocess
import sys
import tempfile
import time

DIR = Path(__file__).resolve().parent
REPO = DIR.parents[3]
sys.path.insert(0, str(REPO / "modules/runtime/bench"))
import jit_http  # noqa: E402

# "node" runs the fixture on a Node.js given as --host, for the same split of its kernel time.
FLAGS = {"default": [], "calls": ["--jit-calls"], "baseline": ["--jit-baseline"], "interpret": ["--no-jit"], "node": [],
         "node-interpreter": ["--no-opt", "--no-maglev", "--no-sparkplug"]}
# The first of these found from a sample's innermost frame outwards names what the kernel was
# doing inside the system call.
PARTS = [
    ("wake the client", ("try_to_wake_up", "__wake_up_common", "sock_def_readable", "ep_poll_callback")),
    ("receive path of the peer socket", ("tcp_v4_rcv", "tcp_v4_do_rcv", "tcp_rcv_established", "tcp_ack", "tcp_data_queue")),
    ("loopback and softirq", ("net_rx_action", "__napi_poll", "process_backlog", "__netif_receive_skb", "loopback_xmit",
                              "do_softirq", "handle_softirqs", "__local_bh_enable_ip", "ip_local_deliver", "ip_rcv")),
    ("IP output and filters", ("ip_output", "ip_finish_output2", "__ip_queue_xmit", "__dev_queue_xmit", "dev_hard_start_xmit",
                               "nf_hook_slow", "ip_local_out")),
    ("TCP transmit", ("__tcp_transmit_skb", "tcp_write_xmit", "__tcp_push_pending_frames", "tcp_push", "tcp_sendmsg_locked",
                      "tcp_sendmsg", "tcp_send_ack", "tcp_cleanup_rbuf", "__tcp_cleanup_rbuf")),
    ("TCP receive copy", ("tcp_recvmsg_locked", "tcp_recvmsg", "skb_copy_datagram_iter")),
    ("socket buffers", ("__alloc_skb", "kmem_cache_alloc_node", "kfree_skb", "__kfree_skb", "consume_skb", "skb_release_data",
                        "kmem_cache_free", "kmalloc_reserve", "sk_stream_alloc_skb", "tcp_stream_alloc_skb")),
    ("epoll", ("ep_poll", "do_epoll_wait", "ep_send_events", "do_epoll_ctl", "ep_insert", "ep_modify")),
    ("timers and clocks", ("hrtimer_start_range_ns", "hrtimer_cancel", "ktime_get", "timerfd_", "do_timerfd", "schedule_hrtimeout")),
    ("scheduler", ("schedule", "__schedule", "pick_next_task", "finish_task_switch", "dequeue_task", "enqueue_task")),
]


def kallsyms():
    names, starts = [], []
    for line in Path("/proc/kallsyms").read_text().splitlines():
        fields = line.split()
        if len(fields) >= 3 and fields[1] in "tTwW":
            starts.append(int(fields[0], 16))
            names.append(fields[2])
    order = sorted(range(len(starts)), key=starts.__getitem__)
    starts = [starts[i] for i in order]
    names = [names[i] for i in order]
    if not starts or starts[-1] == 0:
        sys.exit("/proc/kallsyms shows no addresses: run as root with kernel.kptr_restrict=0")
    return starts, names


def entry(chain):
    """The way into the kernel, from the outermost frames."""
    for name in reversed(chain):
        found = re.match(r"(?:__x64_sys_|__do_sys_|__se_sys_|__ia32_sys_|ksys_)(\w+)", name)
        if found:
            return found[1]
        if name in ("do_writev", "do_readv"):
            return name[3:]
    for name in reversed(chain):
        if "page_fault" in name:
            return "(page fault)"
        if name.startswith(("asm_sysvec", "sysvec_", "asm_common_interrupt", "common_interrupt")):
            return "(interrupt)"
    for name in reversed(chain):
        if name.startswith(("syscall_exit", "do_syscall_64", "entry_SYSCALL_64", "syscall_return", "x64_sys_call")):
            return "(system call entry and exit)"
    return "(other)"


def part(chain):
    for name in chain:
        for label, markers in PARTS:
            if any(name == m or (m.endswith("_") and name.startswith(m)) for m in markers):
                return label
    return "the call itself"


def start(host, mode, cpu):
    env = {k: v for k, v in os.environ.items() if k not in {"BUN_OPTIONS", "NODE_OPTIONS"}}
    env["SILKJS_PREPARSE_THREADS"] = "0"
    log = tempfile.TemporaryFile()
    process = subprocess.Popen(["taskset", "-c", str(cpu), str(host), *FLAGS[mode], str(jit_http.FIXTURE)],
                               stdout=subprocess.PIPE, stderr=log, env=env, start_new_session=True)
    marker = b""
    while b"\n" not in marker:
        if not select.select([process.stdout], [], [], 30)[0]:
            raise TimeoutError("no listening port in 30 seconds")
        piece = os.read(process.stdout.fileno(), 256)
        if not piece:
            break
        marker += piece
    ready = re.fullmatch(rb"ready (\d+)\n", marker)
    if not ready:
        log.seek(0)
        raise ValueError(f"expected a listening port, received {marker[:120]!r} {log.read()[-400:]!r}")
    return process, http.client.HTTPConnection("127.0.0.1", int(ready[1]), timeout=10), log


def ticks(pid):
    fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return int(fields[11]), int(fields[12])


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", type=Path, required=True, help="built JIT embedding host (or node, with --mode node)")
    parser.add_argument("--mode", choices=sorted(FLAGS), default="default")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--warm", type=int, default=4800)
    parser.add_argument("--orders", type=int, default=24000)
    parser.add_argument("--counted", type=int, default=2000, help="orders under strace, for the counts")
    parser.add_argument("--items", type=int, default=64)
    parser.add_argument("--period", type=int, default=97001, help="sampling period in ns of task clock")
    parser.add_argument("--server-cpu", type=int, default=0)
    parser.add_argument("--client-cpu", type=int, default=1)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    sampler = args.out / "ksample"
    subprocess.run(["cc", "-O2", "-o", str(sampler), str(DIR / "ksample.c")], check=True)
    starts, names = kallsyms()
    payloads = jit_http.cases(args.items)
    os.sched_setaffinity(0, {args.client_cpu})
    process, connection, log = start(args.host, args.mode, args.server_cpu)
    try:
        def orders(count):
            for i in range(count):
                jit_http.post(connection, "/order", *payloads[i % len(payloads)])

        orders(args.warm)
        samples = args.out / "samples.txt"
        with samples.open("w") as out:
            reader = subprocess.Popen([str(sampler), str(process.pid), str(args.period)], stdin=subprocess.PIPE,
                                      stdout=out, stderr=subprocess.PIPE)
            reader.stderr.readline()
            before = ticks(process.pid)
            began = time.perf_counter()
            orders(args.orders)
            elapsed = time.perf_counter() - began
            after = ticks(process.pid)
            reader.stdin.close()
            note = reader.stderr.read().decode().strip()
            reader.wait()
        counts = {}
        if args.counted:
            table = args.out / "strace.txt"
            tracer = subprocess.Popen(["strace", "-f", "-c", "-p", str(process.pid), "-o", str(table)],
                                      stderr=subprocess.DEVNULL)
            time.sleep(0.5)
            orders(args.counted)
            tracer.send_signal(signal.SIGINT)
            tracer.wait()
            for line in table.read_text().splitlines():
                fields = line.split()
                if len(fields) >= 5 and fields[0].replace(".", "").isdigit() and fields[-1] != "total":
                    counts[fields[-1]] = int(fields[3]) / args.counted
        jit_http.post(connection, "/stop", b"", b"stopped")
        connection.close()
        process.communicate(timeout=15)
    finally:
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGKILL)
    hz = os.sysconf("SC_CLK_TCK")
    user_us = (after[0] - before[0]) * 1e6 / hz / args.orders
    system_us = (after[1] - before[1]) * 1e6 / hz / args.orders
    unit = args.period / 1000 / args.orders  # µs per order of one sample
    by_entry, by_part, by_function = collections.Counter(), collections.Counter(), collections.Counter()
    user = kernel = 0
    for line in samples.read_text().splitlines():
        if line == "u":
            user += 1
            continue
        kernel += 1
        chain = []
        for word in line.split()[1:]:
            at = bisect.bisect_right(starts, int(word, 16)) - 1
            chain.append(names[at] if at >= 0 else "?")
        if not chain:
            chain = ["?"]
        way = entry(chain)
        by_entry[way] += 1
        by_part[(way, part(chain))] += 1
        by_function[chain[0]] += 1
    result = {
        "mode": args.mode, "orders": args.orders, "items": args.items, "period_ns": args.period,
        "elapsed_s": elapsed, "orders_per_s": args.orders / elapsed, "sampler": note,
        "proc_user_us_per_order": user_us, "proc_system_us_per_order": system_us,
        "sampled_user_us_per_order": user * unit, "sampled_kernel_us_per_order": kernel * unit,
        "kernel_us_per_order_by_entry": {k: v * unit for k, v in by_entry.most_common()},
        "kernel_us_per_order_by_entry_and_part": [[way, what, n * unit] for (way, what), n in by_part.most_common()],
        "kernel_us_per_order_by_function": {k: v * unit for k, v in by_function.most_common(60)},
        "system_calls_per_order": dict(sorted(counts.items(), key=lambda item: -item[1])),
        "kernel": os.uname().release,
    }
    (args.out / "result.json").write_text(json.dumps(result, indent=1) + "\n")
    print(f"{args.mode}: {args.orders / elapsed:.0f} orders/s, /proc user {user_us:.1f} system {system_us:.1f} µs per order;"
          f" sampled user {user * unit:.1f} kernel {kernel * unit:.1f} ({note})")
    print("\nkernel µs per order, by way in (system calls per order):")
    for way, n in by_entry.most_common():
        called = counts.get(way)
        print(f"  {n * unit:6.2f}  {way}" + (f"  ({called:.2f} calls)" if called else ""))
        for (w, what), m in by_part.most_common():
            if w == way and m * unit >= 0.2:
                print(f"          {m * unit:6.2f}  {what}")
    print("\nkernel µs per order, by function (exclusive):")
    for name, n in by_function.most_common(25):
        print(f"  {n * unit:6.2f}  {name}")
    if counts:
        print("\nsystem calls per order:", ", ".join(f"{k} {v:.2f}" for k, v in result["system_calls_per_order"].items() if v >= 0.01))


if __name__ == "__main__":
    main()
