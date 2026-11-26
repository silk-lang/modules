#!/usr/bin/env python3
"""Differential test of the Silk decoder against the reference libzstd 1.5.7.

Every case is decoded twice, by tools/dcli (the Silk decoder) and by tests/ref/dref.c (the same
program against the reference library), with the same input and output chunk sizes. The decoded
bytes, the final status and the trace of every call (input position, output position, return value
or error code) must be identical.

    python3 tests/decode_diff.py [--ref DIR] [--quick] [--seed N] [--only valid|corrupt|window|dict]

DIR is an unpacked zstd-1.5.7 source tree in which `make -C lib libzstd.a` and
`make -C programs zstd` have run (default: $ZSTD_REF). The Silk CLI is built with `silk build
--release` in tools/dcli first.
"""
import argparse, os, random, struct, subprocess, sys, tempfile, hashlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
DCLI = os.path.join(ROOT, "tools/dcli/build/llvm/x86_64-unknown-linux-gnu/release/silkjs-zstd-dcli")

def run(cmd, env=None, input=None):
    e = dict(os.environ); e.update(env or {})
    return subprocess.run(cmd, env=e, input=input, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)

class Harness:
    def __init__(self, ref, work):
        self.ref, self.work = ref, work
        self.zstd = os.path.join(ref, "programs/zstd")
        self.dref = os.path.join(work, "dref")
        r = run(["cc", "-O2", "-o", self.dref, os.path.join(HERE, "ref/dref.c"), "-I", os.path.join(ref, "lib"),
                 os.path.join(ref, "lib/libzstd.a"), "-lpthread"])
        if r.returncode: sys.exit("cannot build the reference harness:\n" + r.stdout.decode())
        if not os.path.exists(DCLI): sys.exit("build tools/dcli first (silk build --release)")
        self.failures, self.count = [], 0

    def path(self, name): return os.path.join(self.work, name)

    def write(self, name, data):
        with open(self.path(name), "wb") as f: f.write(data)
        return self.path(name)

    def compress(self, data, args, stream=False):
        if stream:   # through a pipe: the frame has no content size
            return run([self.zstd, "-q", "-c"] + args, input=data).stdout
        src = self.write("src.bin", data)
        out = self.path("src.zst")
        r = run([self.zstd, "-q", "-f", src, "-o", out] + args)
        if r.returncode: sys.exit("reference zstd failed: %s %s" % (args, r.stdout.decode()))
        return open(out, "rb").read()

    def decode(self, exe, frame_path, inchunk, outchunk, extra):
        env = {"ZIN": frame_path, "ZOUT": self.path("out." + os.path.basename(exe)), "ZTRACE": "1", "ZOUTCHUNK": str(outchunk)}
        if inchunk: env["ZINCHUNK"] = str(inchunk)
        env.update(extra)
        r = run([exe], env)
        lines = [l for l in r.stdout.decode(errors="replace").splitlines()]
        trace = [l for l in lines if l.startswith("call ")]
        status = [l.split("(usec")[0] if l.startswith("error") else l for l in lines if not l.startswith("call ")]
        status = [(" ".join(l.split()[:4]) if l.startswith("in ") else l) for l in status]
        out = open(env["ZOUT"], "rb").read() if os.path.exists(env["ZOUT"]) else None
        return r.returncode, trace, status, out

    def check(self, label, frame, chunks, extra=None, expect=None):
        extra = extra or {}
        fp = self.write("case.zst", frame)
        for inchunk, outchunk in chunks:
            self.count += 1
            a = self.decode(DCLI, fp, inchunk, outchunk, extra)
            b = self.decode(self.dref, fp, inchunk, outchunk, extra)
            what = None
            if a[3] != b[3]: what = "decoded bytes differ"
            elif a[2] != b[2]: what = "status differs: silk %s / ref %s" % (a[2], b[2])
            elif a[0] != b[0]: what = "exit code differs"
            elif a[1] != b[1]:
                i = next((k for k, (x, y) in enumerate(zip(a[1], b[1])) if x != y), min(len(a[1]), len(b[1])))
                what = "trace differs at call %d: silk %s / ref %s" % (i, a[1][i:i+1], b[1][i:i+1])
            elif expect is not None and b[3] != expect and b[0] == 0: what = "reference output is not the original"
            if what:
                digest = hashlib.sha1(frame).hexdigest()[:12]
                keep = self.write("fail-%s.zst" % digest, frame)
                self.failures.append("%s [in=%s out=%s %s]: %s (%s)" % (label, inchunk or "all", outchunk, extra, what, keep))
                print("FAIL", self.failures[-1], flush=True)

def samples(corpus, quick):
    rnd = random.Random(1)
    def take(name, n, at=0):
        p = os.path.join(corpus, name)
        if not os.path.exists(p):
            return bytes(rnd.getrandbits(8) for _ in range(min(n, 200000)))
        with open(p, "rb") as f:
            f.seek(at); return f.read(n)
    out = [("empty", b""), ("one", b"x"), ("two", b"ab"), ("runs", b"a" * 70000 + b"b" * 3 + b"a" * 200000),
           ("text1k", take("text.bin", 1000)), ("text100k", take("text.bin", 100000, 50000)),
           ("json300k", take("json.bin", 300000)), ("random50k", take("random.bin", 50000)),
           ("block", take("text.bin", 131072)), ("block+1", take("text.bin", 131073)),
           ("mixed", take("text.bin", 60000) + take("random.bin", 70000) + take("json.bin", 90000) + bytes(40000) + take("binary.bin", 150000, 1 << 20))]
    if not quick:
        out += [("text3m", take("text.bin", 3 << 20)), ("binary4m", take("binary.bin", 4 << 20, 2 << 20)), ("json5m", take("json.bin", 5 << 20))]
    return out

SMALL = [(1, 1), (1, 16384), (3, 7), (7, 100), (4096, 1), (None, 16384), (None, 1 << 30), (65536, 16384)]
LARGE = [(None, 16384), (None, 1 << 30), (65536, 16384), (131075, 131072), (1000, 100000), (7, 1 << 20)]

def valid(h, corpus, quick):
    levels = ["--fast=5", "-1", "-3", "-5", "-9", "-13", "-16", "-19", "--ultra -22"]
    for name, data in samples(corpus, quick):
        chunks = SMALL if len(data) <= 131073 else LARGE
        for level in levels:
            if len(data) > (1 << 20) and level in ("-19", "--ultra -22") and quick: continue
            for extra in ([], ["--no-check"], ["--long=27"] if level == "-3" else None, ["--no-content-size"] if level == "-1" else None):
                if extra is None: continue
                frame = h.compress(data, level.split() + extra)
                h.check("%s %s %s" % (name, level, extra), frame, chunks, expect=data)
        h.check("%s piped" % name, h.compress(data, ["-3"], stream=True), chunks, expect=data)
    # Frames one after another, and skippable frames between them.
    a = h.compress(samples(corpus, True)[5][1], ["-3"])
    b = h.compress(samples(corpus, True)[6][1], ["-19", "--no-check"])
    skip = lambda n, k=0: struct.pack("<II", 0x184D2A50 + k, n) + bytes(range(256)) * (n // 256) + bytes(n % 256)
    for label, frame in [("two frames", a + b), ("skippable first", skip(10) + a), ("skippable between", a + skip(70000, 7) + b + skip(0, 15)),
                         ("empty skippable only", skip(0)), ("skippable only", skip(300, 3)), ("frame then garbage", a + b"\x00\x01\x02\x03\x04\x05garbage"),
                         ("empty frames", h.compress(b"", ["-3"]) * 3), ("frame then partial magic", a + b"\x28\xb5")]:
        h.check(label, frame, SMALL)

def corrupt(h, corpus, quick, seed):
    rnd = random.Random(seed)
    bases = []
    text = samples(corpus, True)[5][1]
    for args in (["-1"], ["-3", "--no-check"], ["-19"], ["-3", "--no-content-size"]):
        bases.append((" ".join(args), h.compress(text, args)))
    bases.append(("mixed -5", h.compress(samples(corpus, True)[10][1], ["-5"])))
    bases.append(("piped -3", h.compress(text, ["-3"], stream=True)))
    chunks = [(None, 16384), (None, 1 << 30), (4096, 16384), (1000, 777)]
    trials = 40 if quick else 250
    for label, frame in bases:
        for t in range(trials):
            mutated = bytearray(frame)
            kind = rnd.choice(["flip", "flip", "flip", "header", "truncate", "byte", "insert", "delete"])
            if kind == "flip":
                at = rnd.randrange(len(mutated)); mutated[at] ^= 1 << rnd.randrange(8)
            elif kind == "header":
                at = rnd.randrange(min(len(mutated), 24)); mutated[at] = rnd.randrange(256)
            elif kind == "truncate":
                del mutated[rnd.randrange(len(mutated)):]
            elif kind == "byte":
                at = rnd.randrange(len(mutated)); mutated[at] = rnd.randrange(256)
            elif kind == "insert":
                at = rnd.randrange(len(mutated)); mutated[at:at] = bytes([rnd.randrange(256)])
            else:
                at = rnd.randrange(len(mutated)); del mutated[at]
            h.check("corrupt %s %s#%d" % (label, kind, t), bytes(mutated), [rnd.choice(chunks), chunks[0]])

def window(h, corpus, quick):
    data = samples(corpus, True)[5][1]
    for log in (27, 28, 30, 31):
        frame = h.compress(data, ["-3", "--long=%d" % log], stream=True)
        for wlm in ({}, {"ZWLM": "10"}, {"ZWLM": "27"}, {"ZWLM": str(log)}, {"ZWLM": "31"}, {"ZWLM": "9"}, {"ZWLM": "32"}):
            h.check("window %d" % log, frame, [(None, 16384), (4096, 1 << 30)], extra=wlm)
    big = samples(corpus, False)[11][1] if not quick else data * 20
    for log in (10, 12, 17):
        frame = h.compress(big, ["-3", "--zstd=wlog=%d" % log], stream=True)
        h.check("small window %d" % log, frame, LARGE, expect=big)

def dictionary(h, corpus, quick):
    text = samples(corpus, False)[11][1] if not quick else samples(corpus, True)[5][1] * 8
    pieces = [text[i:i + 4000] for i in range(0, min(len(text), 2 << 20), 4000)]
    names = [h.write("sample%d" % i, p) for i, p in enumerate(pieces)]
    trained = h.path("trained.dict")
    r = run([h.zstd, "-q", "--train", "--maxdict=20000", "-o", trained] + names)
    raw = h.write("raw.dict", text[1000:9000])
    other = h.write("other.dict", text[20000:26000])
    payload = text[100000:160000]
    src = h.write("dsrc.bin", payload)
    dicts = [("raw", raw)]
    if r.returncode == 0: dicts.append(("trained", trained))
    else: print("note: zstd --train failed, skipping the trained dictionary:", r.stdout.decode()[:200])
    for label, d in dicts:
        for level in ("-1", "-3", "-19"):
            out = h.path("d.zst")
            run([h.zstd, "-q", "-f", level, "-D", d, src, "-o", out])
            frame = open(out, "rb").read()
            h.check("dict %s %s" % (label, level), frame, SMALL + LARGE, extra={"ZDICT": d}, expect=payload)
            h.check("dict %s %s without" % (label, level), frame, [(None, 16384), (4096, 1 << 30)])
            h.check("dict %s %s wrong" % (label, level), frame, [(None, 16384), (4096, 1 << 30)], extra={"ZDICT": other})
    if len(dicts) > 1:
        bad = bytearray(open(trained, "rb").read())
        for at in (9, 40, 100, len(bad) // 2):
            bad2 = bytearray(bad); bad2[at] ^= 0x55
            h.check("corrupt dictionary %d" % at, open(h.path("d.zst"), "rb").read(), [(None, 16384)], extra={"ZDICT": h.write("bad.dict", bytes(bad2))})
        h.check("short dictionary", open(h.path("d.zst"), "rb").read(), [(None, 16384)], extra={"ZDICT": h.write("bad.dict", bytes(bad[:8]))})

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default=os.environ.get("ZSTD_REF", ""))
    ap.add_argument("--corpus", default=os.environ.get("ZSTD_CORPUS", "/home/user/corpus"))
    ap.add_argument("--quick", action="store_true")
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--only", default="")
    ap.add_argument("--work", default="")
    a = ap.parse_args()
    if not a.ref: sys.exit("say where the reference zstd-1.5.7 tree is: --ref DIR or ZSTD_REF")
    work = a.work or tempfile.mkdtemp(prefix="zstd-decode-diff-")
    os.makedirs(work, exist_ok=True)
    h = Harness(a.ref, work)
    parts = {"valid": lambda: valid(h, a.corpus, a.quick), "corrupt": lambda: corrupt(h, a.corpus, a.quick, a.seed),
             "window": lambda: window(h, a.corpus, a.quick), "dict": lambda: dictionary(h, a.corpus, a.quick)}
    for name, part in parts.items():
        if a.only and a.only != name: continue
        before = h.count, len(h.failures)
        part()
        print("%s: %d comparisons, %d failures" % (name, h.count - before[0], len(h.failures) - before[1]), flush=True)
    print("total: %d comparisons, %d failures (work directory %s)" % (h.count, len(h.failures), work))
    sys.exit(1 if h.failures else 0)

if __name__ == "__main__":
    main()
