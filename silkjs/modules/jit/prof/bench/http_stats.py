import sys, os, re, select, subprocess, http.client, time
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[4] / "modules/runtime/bench"))
import jit_http as bench
host, n = sys.argv[1], int(sys.argv[2]); flags = sys.argv[3:]
p = subprocess.Popen([host, *flags, "--jit-stats", str(bench.FIXTURE)], stdout=subprocess.PIPE, stderr=open("http_stats.err", "wb"))
ready = re.fullmatch(rb"ready (\d+)\n", p.stdout.readline())
c = http.client.HTTPConnection("127.0.0.1", int(ready[1]), timeout=15); c.connect()
cases = bench.cases()
clock = ((~p.pid) << 3) | 2
for block in range(n // 1000):
    before = time.clock_gettime_ns(clock)
    for i in range(1000): bench.post(c, "/order", *cases[i % len(cases)])
    print(block, round((time.clock_gettime_ns(clock) - before) / 1e6), "us/order", flush=True)
bench.post(c, "/stop", b"", b"stopped"); c.close(); p.communicate(timeout=15)
print(open("http_stats.err", errors="replace").read()[-1500:])
