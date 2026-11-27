"""Sample exclusive user-mode instruction pointers from a warmed HTTP host on Linux/x86-64."""

import argparse
import bisect
import collections
import ctypes as C
import gzip
import hashlib
import http.client
import json
import os
import re
import select
import subprocess
import sys
import tempfile
import time
from pathlib import Path

DIR = Path(__file__).resolve().parent


def load_reader(path):
    global lib
    lib = C.CDLL(str(path), use_errno=True)
    configure(lib)


class Point(C.Structure):
    _fields_ = [
        ("ip", C.c_uint64),
        ("pid", C.c_uint32),
        ("tid", C.c_uint32),
        ("ts", C.c_uint64),
        ("period", C.c_uint64),
    ]


def configure(lib):
    for name, args, ret in [
        ("open_perf", [C.c_int, C.c_ulong, C.c_int], C.c_void_p),
        ("state_perf", [C.c_void_p, C.c_int], C.c_int),
        ("drain_perf", [C.c_void_p, C.POINTER(Point), C.c_int], C.c_int),
        ("end_perf", [C.c_void_p, C.POINTER(C.c_uint64)], C.c_int),
    ]:
        f = getattr(lib, name)
        f.argtypes = args
        f.restype = ret


def checked(n):
    if n is None or n < 0:
        raise OSError(C.get_errno(), os.strerror(C.get_errno()))
    return n


def sha(p):
    return hashlib.file_digest(Path(p).open("rb"), "sha256").hexdigest()


def clocks(pid):
    raw = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
    return [time.clock_gettime_ns(((~pid) << 3) | 2), int(raw[11]), int(raw[12])]


class Sample:
    def __init__(self, proc, period, root, mode, digest):
        self.mode = mode
        self.host_digest = digest
        self.p = proc
        self.root = root
        self.period = period
        self.tids = sorted(
            int(x.name) for x in Path(f"/proc/{proc.pid}/task").iterdir()
        )
        self.rings = {tid: checked(lib.open_perf(tid, period, 1)) for tid in self.tids}
        self.buffer = (Point * 32768)()
        self.ips = collections.Counter()

    def record(self):
        for ring in self.rings.values():
            while True:
                n = checked(lib.drain_perf(ring, self.buffer, len(self.buffer)))
                self.ips.update(self.buffer[i].ip for i in range(n))
                if n < len(self.buffer):
                    break

    def start(self):
        (self.root / "maps-start.txt").write_bytes(
            Path(f"/proc/{self.p.pid}/maps").read_bytes()
        )
        self.start_clock = clocks(self.p.pid)
        for ring in self.rings.values():
            checked(lib.state_perf(ring, 1))

    def end(self):
        for ring in self.rings.values():
            checked(lib.state_perf(ring, 0))
        end = clocks(self.p.pid)
        self.record()
        (self.root / "maps-end.txt").write_bytes(
            Path(f"/proc/{self.p.pid}/maps").read_bytes()
        )
        # The server is idle, and the event has already been disabled.
        self.code_names = generated_names(
            self.p.pid, self.root, self.mode, self.host_digest, self.ips
        )
        tids_end = sorted(
            int(x.name) for x in Path(f"/proc/{self.p.pid}/task").iterdir()
        )
        out = {}
        for tid, ring in self.rings.items():
            results = (C.c_uint64 * 14)()
            checked(lib.end_perf(ring, results))
            out[tid] = {
                "task_clock_ns": results[0],
                "enabled_ns": results[1],
                "running_ns": results[2],
                "samples": results[3],
                "lost": results[4],
                "throttle_records": results[5],
                "sample_mode": results[6:14],
            }
        delta, ut, st = [b - a for a, b in zip(self.start_clock, end)]
        ticks = os.sysconf("SC_CLK_TCK")
        samples = sum(self.ips.values())
        prof = sum(x["task_clock_ns"] for x in out.values())
        result = dict(
            period_ns=self.period,
            process_clock_ns=delta,
            user_s=ut / ticks,
            sys_s=st / ticks,
            kernel_clock_hz=ticks,
            samples=samples,
            sampled_cpu_s=samples * self.period / 1e9,
            periods_vs_task_clock=samples * self.period / prof,
            perf_task_clock_vs_proc_clock=prof / delta,
            threads=out,
            tids_end=tids_end,
        )
        (self.root / "ips.json").write_text(json.dumps(dict(self.ips)))
        return result


def syms(path, dyn=False):
    rows = []
    cmd = ["nm", "-n", "-S", "--defined-only"]
    if dyn:
        cmd += ["-D"]
    try:
        out = subprocess.run(
            [*cmd, path], capture_output=True, text=True, check=True
        ).stdout
    except (OSError, subprocess.CalledProcessError):
        out = ""
    for line in out.splitlines():
        m = re.match(r"^([\da-f]+) ([\da-f]+) [tTiIwW] (.+)", line)
        if m:
            rows.append((int(m[1], 16), int(m[2], 16), m[3]))
    return rows


def symbolize(root, host, matches):
    ips = {int(k): v for k, v in json.loads((root / "ips.json").read_text()).items()}
    mapped = []
    for p in ["maps-end.txt", "maps-start.txt"]:
        for row in (root / p).read_text().splitlines():
            addr, perms, off, device, inode, *ds = row.split(None, 5)
            if "x" not in perms:
                continue
            a, b = [int(w, 16) for w in addr.split("-")]
            desc = ds[0] if ds else "[anonymous executable]"
            addrmap = (a, b, int(off, 16), desc)
            if addrmap not in mapped:
                mapped.append(addrmap)
    table = {}
    names = {}
    if Path(str(host) + ".symbols").is_file():
        for l in Path(str(host) + ".symbols").read_text().splitlines():
            if "\t" in l:
                token, _, n = l.split("\t", 2)
                names[token] = n
    counts = collections.Counter()
    for ip, n in ips.items():
        if ip in matches:
            counts["[matching generated JS]!" + matches[ip]] += n
            continue
        hit = next((m for m in mapped if m[0] <= ip < m[1]), None)
        if not hit:
            counts["[unmapped or kernel IP]"] += n
            continue
        start, _, fileoff, desc = hit
        if not desc.startswith("/"):
            counts[desc] += n
            continue
        if desc not in table:
            prog = subprocess.run(
                ["readelf", "-lW", desc], capture_output=True, text=True
            ).stdout
            segments = []
            for l in prog.splitlines():
                m = re.match(r"^\s*LOAD\s+(0x\w+)\s+(0x\w+)\s+0x\w+\s+(0x\w+)", l)
                if m:
                    segments.append(tuple(int(x, 16) for x in m.groups()))
            rows = syms(desc) or syms(desc, True)
            table[desc] = (segments, [x[0] for x in rows], rows)
        segments, starts, rows = table[desc]
        offset = fileoff + ip - start
        seg = next((s for s in segments if s[0] <= offset < s[0] + s[2]), None)
        symbol = "[unresolved]"
        if seg:
            address = seg[1] + offset - seg[0]
            i = bisect.bisect_right(starts, address) - 1
            if i >= 0 and address < rows[i][0] + rows[i][1]:
                raw = rows[i][2].split(".llvm.")[0].split("'")[0]
                symbol = names.get(raw, raw)
        counts[Path(desc).name + "!" + symbol] += n
    return counts


def run(args):
    root = args.out
    root.mkdir(parents=True, exist_ok=True)
    control = args.mode == "control"
    host = args.control if control else args.host.resolve()
    digest = sha(host)
    cmd = (
        [str(host)]
        if control
        else [str(host)]
        + (["--jit-calls"] if args.mode == "calls" else [])
        + [str(bench.FIXTURE)]
    )
    server = subprocess.Popen(
        ["taskset", "-c", str(args.server_cpu), *cmd],
        stdout=subprocess.PIPE,
        stdin=subprocess.PIPE,
        stderr=(root / "stderr").open("wb"),
        start_new_session=True,
    )
    con = None
    try:
        if not select.select([server.stdout], [], [], 10)[0]:
            raise RuntimeError("server did not start")
        ready = server.stdout.readline().split()
        assert ready and ready[0] == b"ready", ready
        if not control:
            con = http.client.HTTPConnection("127.0.0.1", int(ready[1]), timeout=10)
            payloads = bench.cases(args.items)

            def request(i):
                bench.post(con, "/order", *payloads[i % len(payloads)])

            for i in range(args.warm):
                request(i)
        samp = Sample(server, args.period, root, args.mode, digest)
        samp.start()
        if control:
            server.stdin.write(b"\n")
            server.stdin.flush()
            assert server.stdout.readline() == b"done\n"
        else:
            for i in range(args.orders):
                request(i)
                if i % 1000 == 999:
                    samp.record()
        results = samp.end()
        if control:
            server.stdin.write(b"\n")
            server.stdin.flush()
        else:
            bench.post(con, "/stop", b"", b"stopped")
        assert server.wait(timeout=15) == 0
        funcs = symbolize(root, host, samp.code_names)
        cpu_stat = results["process_clock_ns"] / 1e9
        results.update(
            mode=args.mode,
            pid=server.pid,
            server_cpu=args.server_cpu,
            host_sha256=digest,
            host=str(host),
            orders=args.orders if not control else None,
            warmup=args.warm if not control else None,
            fixture_sha256=None if control else sha(bench.FIXTURE),
            function_samples=funcs.most_common(),
        )
        if not control:
            results["jit"] = bench.jit_counters((root / "stderr").read_text())
        (root / "result.json").write_text(json.dumps(results, indent=2) + "\n")
        print(
            args.mode,
            "CPU",
            round(cpu_stat, 4),
            "sampled",
            results["sampled_cpu_s"],
            "samples",
            results["samples"],
            "TIDs",
            len(results["threads"]),
            "top",
            funcs.most_common(5),
            flush=True,
        )
    finally:
        if con:
            con.close()
        if server.poll() is None:
            server.kill()
            server.wait()


def generated_names(pid, root, mode, host_digest, ips):
    # Read only the anonymous executable pages of this child after sampling.
    if mode == "control":
        return {}
    with gzip.open(DIR / "generated-signatures.json.gz", "rt") as file:
        reference = json.load(file)
    if reference["host_sha256"] != host_digest:
        return {}
    signatures = collections.defaultdict(list)
    for prefix, length, digest, name in reference["modes"][mode]:
        signatures[bytes.fromhex(prefix)].append((length, digest, name))
    named = {}
    try:
        mem = os.open(f"/proc/{pid}/mem", os.O_RDONLY)
    except PermissionError:
        return named
    try:
        for row in (root / "maps-end.txt").read_text().splitlines():
            fields = row.split()
            if (
                len(fields) != 5
                or "x" not in fields[1]
                or fields[3:5] != ["00:00", "0"]
            ):
                continue
            lo, hi = [int(x, 16) for x in fields[0].split("-")]
            if hi - lo > 64 * 1024**2:
                continue
            body = os.pread(mem, hi - lo, lo)
            for start in range(0, len(body), os.sysconf("SC_PAGE_SIZE")):
                known = [
                    (size, name)
                    for size, digest, name in signatures.get(
                        body[start : start + 16], []
                    )
                    if hashlib.sha256(body[start : start + size]).hexdigest() == digest
                ]
                if len({name for _, name in known}) != 1:
                    continue
                size, name = max(known)
                for ip in ips:
                    if lo + start <= ip < lo + start + size:
                        named[ip] = name
    finally:
        os.close(mem)
    return named


def main():
    global bench
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["default", "calls", "control"])
    parser.add_argument("--host", type=Path, help="JIT-enabled HTTP embedding host")
    parser.add_argument("--repo", type=Path, default=DIR.parents[4])
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--server-cpu", type=int, default=0)
    parser.add_argument("--client-cpu", type=int, default=1)
    parser.add_argument(
        "--period",
        type=int,
        default=999983,
        help="Task-clock sampling period in nanoseconds",
    )
    parser.add_argument("--warm", type=int, default=4800)
    parser.add_argument("--orders", type=int, default=24000)
    parser.add_argument("--items", type=int, default=64)
    args = parser.parse_args()
    if args.mode != "control" and args.host is None:
        parser.error("--host is required for HTTP modes")
    if args.server_cpu == args.client_cpu or not {
        args.server_cpu,
        args.client_cpu,
    } <= os.sched_getaffinity(0):
        parser.error("choose two distinct CPUs available in this process affinity mask")
    if min(args.period, args.orders, args.items) <= 0 or args.warm < 0:
        parser.error(
            "period, orders and items must be positive, warmup must be nonnegative"
        )
    sys.path.insert(0, str(args.repo.resolve() / "modules/runtime/bench"))
    import jit_http as bench

    with tempfile.TemporaryDirectory() as temporary:
        libpath = Path(temporary) / "perf_ring.so"
        subprocess.run(
            ["cc", "-O2", "-fPIC", "-shared", DIR / "perf_ring.c", "-o", libpath],
            check=True,
        )
        load_reader(libpath)
        if args.mode == "control":
            args.control = Path(temporary) / "control"
            subprocess.run(
                ["gcc", "-O2", "-fno-ipa-icf", DIR / "control.c", "-o", args.control],
                check=True,
            )
        os.sched_setaffinity(0, {args.client_cpu})
        run(args)


if __name__ == "__main__":
    main()
