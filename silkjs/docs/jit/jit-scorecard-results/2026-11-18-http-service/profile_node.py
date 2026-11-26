"""Run Node's production HTTP fixture under Callgrind on 400 verified orders."""
import argparse
import http.client
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--repo", required=True, type=Path)
parser.add_argument("--out", required=True, type=Path)
parser.add_argument("--node", type=Path, default=shutil.which("node"))
parser.add_argument("--warmup", type=int, default=1200)
args = parser.parse_args()
repo = args.repo.resolve()
out = args.out.resolve()
if args.warmup < 0 or not args.node:
    parser.error("provide a Node executable and nonnegative warmup")
out.mkdir(exist_ok=False)
warmup = args.warmup
sys.path.insert(0, str(repo / "modules/runtime/bench"))
import jit_http as bench

node = str(args.node.resolve(strict=True))
command = ["valgrind", "--tool=callgrind", "--instr-atstart=no", "--smc-check=all-non-file",
           "--callgrind-out-file=" + str(out / "cg.%p"), node, str(bench.FIXTURE)]
env = dict(os.environ)
env.pop("NODE_OPTIONS", None)
with (out / "node.log").open("w") as log:
    child = subprocess.Popen(command, start_new_session=True, env=env, stdout=subprocess.PIPE, stderr=log)

    def control(*flags):
        result = subprocess.run(["callgrind_control", *flags, str(child.pid)], timeout=60,
                                check=True, text=True, capture_output=True)
        if "PID " not in result.stdout or "ERROR" in result.stdout:
            raise ValueError(result.stdout)

    try:
        if not select.select([child.stdout], [], [], 90)[0]:
            raise TimeoutError("startup")
        ready = re.fullmatch(rb"ready (\d+)\n", child.stdout.readline())
        if not ready:
            raise RuntimeError((out / "node.log").read_text()[-2000:])
        conn = http.client.HTTPConnection("127.0.0.1", int(ready[1]), timeout=60)
        conn.connect()
        sock = conn.sock
        cases = bench.cases()

        def orders(n):
            for i in range(n):
                bench.post(conn, "/order", *cases[i % len(cases)])
                if sock is not conn.sock:
                    raise RuntimeError("lost keepalive")

        orders(warmup)
        control("-i", "on")
        control("-z")
        orders(400)
        control("--dump=400_orders")
        control("-i", "off")
        bench.post(conn, "/stop", b"", b"stopped")
        conn.close()
        child.communicate(timeout=60)
        if child.returncode:
            raise RuntimeError(f"exit {child.returncode}")
    finally:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
dump, = out.glob("cg.*.1")
fields = re.findall(r"^(summary|totals): (\d+)", dump.read_text(), re.M)
names = {}
parse_ir = 0
parse_calls = 0
callee = ""
count = None
for line in dump.read_text().splitlines():
    if line.startswith(("fn=", "cfn=")):
        k, v = line.split("=", 1)
        m = re.fullmatch(r"\((\d+)\)(?: (.*))?", v)
        if m:
            ident, name = m.groups()
            if name is not None:
                names[ident] = name
            v = names[ident]
        if k == "cfn":
            callee = v
    elif line.startswith("calls="):
        count = int(line.split()[0][6:])
    elif count is not None and re.match(r"^[*+0-9-]", line):
        if callee == "Builtins_JsonParse":
            parse_calls += count
            parse_ir += int(line.split()[-1])
        count = None
if parse_calls != 400:
    raise ValueError(f"expected 400 JSON.parse calls, got {parse_calls}")
print(json.dumps({"counts": dict(fields), "warmup": warmup, "verified": 400,
                  "json_parse_calls": parse_calls, "json_parse_inclusive_ir": parse_ir,
                  "node_sha256": bench.sha256(node), "node_version": subprocess.check_output([node, "--version"], text=True).strip(),
                  "fixture_sha256": bench.sha256(bench.FIXTURE), "dump_sha256": bench.sha256(dump)}, indent=2))
