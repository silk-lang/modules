#!/usr/bin/env python3
"""Differential test of the Silk compressor against libzstd 1.5.7.

For each case (input, parameters, call pattern) it runs tools/cli and its C twin tests/ref/cref.c
(linked against the reference libzstd.a) with the same environment, and compares the output bytes
and the trace of every API call (result, input position, output position). Outputs of successful
runs are also decoded with the reference `zstd -d`. `--node` adds a comparison of one-shot cases
with Node's zlib.zstdCompressSync.

  python3 tests/compress_diff.py [--full] [--node] [--filter SUBSTR] [-j N]
  python3 tests/compress_diff.py --dict [--full] [--node] [--filter SUBSTR] [-j N]

`--dict` runs the dictionary cases instead (ZDICT, ZRESET, ZDROP, ZMIDLOAD of tools/cli): trained
and raw-content dictionaries of several sizes, corrupt dictionaries, inputs on both sides of the
attach / copy cut-offs, several frames from one context. Their outputs are also decoded with
`zstd -d -D` and with tools/dcli (ZDICT). The dictionaries are made in ZSTD_SCRATCH/dicts.

Paths can be changed with ZSTD_REF (reference source tree with lib/libzstd.a and programs/zstd),
ZSTD_CORPUS (directory of corpus files), ZSTD_NODE and ZSTD_SCRATCH.
"""
import os, sys, subprocess, hashlib, json, argparse, random
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
PKG = os.path.dirname(HERE)
REF = os.environ.get('ZSTD_REF', '/home/user/ref/zstd-1.5.7')
CORPUS = os.environ.get('ZSTD_CORPUS', '/home/user/corpus')
NODE = os.environ.get('ZSTD_NODE', '/opt/node24/bin/node')
SCRATCH = os.environ.get('ZSTD_SCRATCH', '/home/user/zdev/agent-core/difftest')
CLI = os.path.join(PKG, 'tools/cli/build/llvm/x86_64-unknown-linux-gnu/release/silkjs-zstd-cli')
DCLI = os.path.join(PKG, 'tools/dcli/build/llvm/x86_64-unknown-linux-gnu/release/silkjs-zstd-dcli')
CREF = os.path.join(SCRATCH, 'cref')
ZSTD = os.path.join(REF, 'programs/zstd')

P = dict(level=100, windowLog=101, hashLog=102, chainLog=103, searchLog=104, minMatch=105, targetLength=106,
         strategy=107, ldm=160, ldmHashLog=161, ldmMinMatch=162, ldmBucketSizeLog=163, ldmHashRateLog=164,
         contentSize=200, checksum=201, dictID=202, nbWorkers=400, jobSize=401, overlapLog=402)

def build():
    os.makedirs(SCRATCH, exist_ok=True)
    env = dict(os.environ)
    home = os.path.expanduser('~')
    env['PATH'] = f"{home}/.silk/bin:{home}/.silk/llvm/bin:" + env['PATH']
    env.setdefault('SILK_CLANG', f"{home}/.silk/llvm/bin/clang")
    subprocess.run(['silk', 'build', '--release', '-q'], cwd=os.path.join(PKG, 'tools/cli'), env=env, check=True)
    # The twin links a multithreaded build of the reference (as Node's is), compiled once.
    libmt = os.path.join(SCRATCH, 'libzstd_mt.a')
    if not os.path.exists(libmt):
        import glob
        objdir = os.path.join(SCRATCH, 'obj'); os.makedirs(objdir, exist_ok=True)
        srcs = glob.glob(os.path.join(REF, 'lib/common/*.c')) + glob.glob(os.path.join(REF, 'lib/compress/*.c'))
        def cc(src):
            obj = os.path.join(objdir, os.path.basename(src)[:-2] + '.o')
            subprocess.run(['cc', '-O3', '-DZSTD_MULTITHREAD', '-DNDEBUG', '-c', src, '-o', obj], check=True)
            return obj
        with ThreadPoolExecutor(4) as ex: objs = list(ex.map(cc, srcs))
        subprocess.run(['ar', 'rcs', libmt] + objs, check=True)
    subprocess.run(['cc', '-O2', '-o', CREF, os.path.join(HERE, 'ref/cref.c'), '-I' + os.path.join(REF, 'lib'), libmt, '-lpthread'], check=True)

def make_inputs():
    d = os.path.join(SCRATCH, 'in'); os.makedirs(d, exist_ok=True)
    inputs = {}
    def put(name, data):
        path = os.path.join(d, name)
        if not os.path.exists(path) or os.path.getsize(path) != len(data):
            open(path, 'wb').write(data)
        inputs[name] = path
    text = open(os.path.join(CORPUS, 'text.bin'), 'rb').read()
    binary = open(os.path.join(CORPUS, 'binary.bin'), 'rb').read()
    js = open(os.path.join(CORPUS, 'json.bin'), 'rb').read()
    rnd = open(os.path.join(CORPUS, 'random.bin'), 'rb').read()
    for n in (0, 1, 2, 3, 4, 5, 6, 7, 8, 10, 100, 1000, 131071, 131072, 131073, 262144, 262145):
        put(f'text{n}', text[:n])
    for n in (1, 2, 3, 7, 8, 100, 1000, 131072, 131073, 300000):
        put(f'run{n}', b'a' * n)
    put('zeros1m', bytes(1 << 20))
    put('rand100', rnd[:100]); put('rand1000', rnd[:1000]); put('rand200k', rnd[:200000]); put('rand1m', rnd[:1 << 20])
    put('text1m', text[:1 << 20]); put('text3m', text[1 << 20:4 << 20]); put('json2m', js[:2 << 20])
    put('bin1m', binary[:1 << 20]); put('bin5m', binary[3 << 20:8 << 20])
    put('mixed', text[:200000] + rnd[:150000] + b'z' * 140000 + binary[:300000] + text[:200000] + rnd[:300000])
    put('period', (text[:37] * 40000)[:1 << 20])
    put('ab', b'ab' * 70000)
    rs = random.Random(7)
    put('lowent', bytes(rs.choice(b'abcd') for _ in range(400000)))
    put('twobyte', bytes(rs.choice(b'ab') for _ in range(300)))
    for name in ('text', 'json', 'binary', 'random'):
        inputs[name] = os.path.join(CORPUS, name + '.bin')
    return inputs

def run_case(case):
    name, path, params, mode = case['input'], case['path'], case['params'], case['mode']
    tag = hashlib.md5(json.dumps([name, params, mode]).encode()).hexdigest()[:16]
    env = dict(ZIN=path, ZPARAMS=' '.join(f'{k} {v}' for k, v in params))
    for k in ('ZICHUNK', 'ZOCHUNK', 'ZFLUSH', 'ZPLEDGE', 'ZREPEAT', 'ZDICT', 'ZRESET', 'ZDROP', 'ZMIDLOAD', 'ZLOOPS'):
        if k in mode: env[k] = str(mode[k])
    res = []
    for exe, suffix in ((CLI, 's'), (CREF, 'c')):
        e = dict(env, ZOUT=os.path.join(SCRATCH, f'{tag}.{suffix}.zst'), ZTRACE=os.path.join(SCRATCH, f'{tag}.{suffix}.tr'))
        r = subprocess.run([exe], env=e, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        res.append((r.returncode, e['ZOUT'], e['ZTRACE'], r.stderr[-300:]))
    (rs, outs, trs, errs), (rc, outc, trc, _) = res
    problems = []
    if rs != rc: problems.append(f'exit code {rs} vs reference {rc} {errs!r}')
    if rs in (0, 1) and rc in (0, 1):
        exact = case.get('exact', True)
        a, b = open(outs, 'rb').read(), open(outc, 'rb').read()
        case['same'] = a == b and open(trs).read() == open(trc).read()
        if exact:
            if a != b:
                i = next((i for i in range(min(len(a), len(b))) if a[i] != b[i]), min(len(a), len(b)))
                problems.append(f'bytes differ at {i} (sizes {len(a)} vs {len(b)})')
            ta, tb = open(trs).read(), open(trc).read()
            if ta != tb:
                la, lb = ta.split('\n'), tb.split('\n')
                i = next((i for i in range(min(len(la), len(lb))) if la[i] != lb[i]), min(len(la), len(lb)))
                problems.append(f'trace differs at call {i}: {la[i:i+1]} vs {lb[i:i+1]}')
        if rs == 0 and (mode.get('ZREPEAT', 1) == 1 or ('ZDICT' in mode and 'ZDROP' not in mode)):
            dict_args = ['-D', mode['ZDICT']] if 'ZDICT' in mode else []
            want = open(path, 'rb').read() * (mode.get('ZREPEAT', 1) * mode.get('ZLOOPS', 1))
            d = subprocess.run([ZSTD, '-d', '-c', '--no-check'] + dict_args + [outs], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if d.returncode != 0 or d.stdout != want:
                problems.append('reference decoder rejects the output or decodes other bytes: ' + d.stderr.decode()[-200:])
            if 'ZDICT' in mode and os.path.exists(DCLI):
                dout = outs + '.d'
                d = subprocess.run([DCLI], env=dict(ZIN=outs, ZOUT=dout, ZDICT=mode['ZDICT']), stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if d.returncode != 0 or open(dout, 'rb').read() != want:
                    problems.append('Silk decoder (tools/dcli) rejects the output or decodes other bytes: ' + d.stdout.decode()[-200:])
                try: os.remove(dout)
                except OSError: pass
            if any(k == 201 and v for k, v in params):
                d = subprocess.run([ZSTD, '-t'] + (['-D', mode['ZDICT']] if 'ZDICT' in mode else []) + [outs], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                if d.returncode != 0: problems.append('checksum rejected: ' + d.stderr.decode()[-200:])
    for f in (outs, trs, outc, trc):
        try: os.remove(f)
        except OSError: pass
    return case, problems

def cases(inputs, full):
    out = []
    def add(name, params=(), exact=None, **mode):
        ps = [(P[k] if isinstance(k, str) else k, v) for k, v in params]
        if exact is None:
            level = dict(ps).get(100, 3)
            strat = dict(ps).get(107, 0)
            exact = (strat in (1, 2)) or (strat == 0 and level <= 4)
            if dict(ps).get(160, 0) == 1: exact = False
        out.append(dict(input=name, path=inputs[name], params=ps, mode=mode, exact=exact))
    levels = [-131072, -1000, -50, -10, -5, -3, -1, 1, 2, 3, 4]
    small = [n for n in inputs if n not in ('text', 'json', 'binary', 'random')]
    big = ['text', 'json', 'binary', 'random']
    # 1. one-shot, every level, every small input (+ the corpus in full mode).
    for n in small + (big if full else []):
        for l in levels:
            add(n, [('level', l)])
    if not full:
        for n in big:
            for l in (-5, 1, 3):
                add(n, [('level', l)])
    # 2. one-shot with other output buffer sizes (the output staging path).
    for n in ('text0', 'text1', 'text10', 'text1000', 'text131072', 'text131073', 'run300000', 'mixed', 'text1m', 'rand200k'):
        for oc in (1, 64, 1000, 1 << 20):
            for l in (1, 3):
                add(n, [('level', l)], ZOCHUNK=oc)
    # 3. streaming: input chunks x output chunks x flush pattern.
    ichunks = (1, 7, 1000, 65536, 131072, 1 << 20)
    ochunks = (1, 64, 16384, 1 << 20)
    for n in ('text1000', 'text131073', 'mixed', 'text1m', 'lowent') + (('text3m', 'bin5m', 'json2m', 'rand1m') if full else ()):
        size = os.path.getsize(inputs[n])
        for ic in ichunks:
            if ic == 1 and size > 300000 and not full: continue
            if ic <= 7 and size > (1 << 20): continue
            for oc in ochunks:
                if oc == 1 and size > 300000: continue
                for fl in (0, 1, 3):
                    if fl and ic == 1 and size > 2000: continue
                    for l in ((1, 3) if not full else (-5, 1, 2, 3, 4)):
                        add(n, [('level', l)], ZICHUNK=ic, ZOCHUNK=oc, ZFLUSH=fl)
    # 4. small windows with input larger than the window, streaming: the buffer wraps (extDict).
    for n in ('text1m', 'mixed', 'bin1m', 'period') + (('text3m', 'bin5m', 'json2m') if full else ()):
        for wl in (10, 11, 12, 14, 16, 17):
            for strat in (1, 2):
                for ic, oc, fl in ((1000, 16384, 0), (65536, 1 << 20, 0), (131072, 64, 3), (100000, 16384, 1), (1 << 20, 1 << 20, 0)):
                    add(n, [('windowLog', wl), ('strategy', strat)], ZICHUNK=ic, ZOCHUNK=oc, ZFLUSH=fl)
                    if full:
                        add(n, [('windowLog', wl), ('strategy', strat), ('minMatch', 4 + wl % 4), ('level', -3)], ZICHUNK=ic, ZOCHUNK=oc, ZFLUSH=fl)
    # 5. explicit parameter overrides.
    for n in ('text1m', 'mixed', 'bin1m', 'text131073', 'json2m'):
        for strat in (1, 2):
            for mm in (3, 4, 5, 6, 7):
                add(n, [('strategy', strat), ('minMatch', mm)])
            for hl, cl in ((6, 6), (10, 12), (17, 14), (20, 20), (12, 22)):
                add(n, [('strategy', strat), ('hashLog', hl), ('chainLog', cl)])
            for tl in (0, 1, 2, 7, 64, 131072):
                add(n, [('strategy', strat), ('targetLength', tl)])
            for wl in (10, 15, 18, 19, 23, 27):
                add(n, [('strategy', strat), ('windowLog', wl)])
                add(n, [('strategy', strat), ('windowLog', wl)], ZICHUNK=50000, ZFLUSH=4)
    # 6. frame parameters and pledged sizes.
    for n in ('text0', 'text1', 'text100', 'text1000', 'text131072', 'text262145', 'mixed', 'run300000'):
        size = os.path.getsize(inputs[n])
        for cs in (0, 1):
            for ck in (0, 1):
                add(n, [('contentSize', cs), ('checksum', ck)])
                add(n, [('contentSize', cs), ('checksum', ck)], ZICHUNK=40000)
                add(n, [('contentSize', cs), ('checksum', ck)], ZICHUNK=40000, ZPLEDGE=size)
                add(n, [('contentSize', cs), ('checksum', ck)], ZPLEDGE=size)
        add(n, [('dictID', 0)])
        for wrong in (size + 1, max(size - 1, 0), 0, size * 2 + 5):
            add(n, [], ZPLEDGE=wrong)
            add(n, [], ZPLEDGE=wrong, ZICHUNK=1000)
            add(n, [], ZPLEDGE=wrong, ZICHUNK=1000, ZFLUSH=2, ZOCHUNK=100)
    # 7. several frames from one context (the tables and the indices carry over).
    for n in ('text1000', 'text131073', 'mixed', 'text1m'):
        for l in (1, 3):
            add(n, [('level', l)], ZREPEAT=3)
            add(n, [('level', l)], ZREPEAT=3, ZICHUNK=30000, ZFLUSH=5)
            add(n, [('level', l), ('windowLog', 12)], ZREPEAT=3, ZICHUNK=30000)
    # 8. parameter bounds and validation: every parameter, at and around its bounds.
    bounds = {100: (-131072, 22), 101: (10, 31), 102: (6, 30), 103: (6, 30), 104: (1, 30), 105: (3, 7), 106: (0, 131072),
              107: (1, 9), 160: (0, 2), 161: (6, 30), 162: (4, 4096), 163: (1, 8), 164: (0, 25), 200: (0, 1), 201: (0, 1),
              202: (0, 1), 400: (0, 256), 401: (0, 1 << 30), 402: (0, 9), 130: (1340, 131072), 500: (0, 1), 10: (0, 1),
              1000: (0, 1), 1001: (0, 3), 1002: (0, 2), 1004: (0, 2147483647), 1005: (0, 1), 1006: (0, 1), 1007: (0, 1),
              1008: (0, 1), 1009: (0, 1), 1010: (0, 2), 1011: (0, 2), 1012: (0, 1), 1013: (0, 2), 1014: (0, 1),
              1015: (1024, 131072), 1016: (0, 2), 1017: (0, 6), 99: (0, 0), 1003: (0, 0), 1018: (0, 0), 0: (0, 0)}
    for pid, (lo, hi) in bounds.items():
        for v in sorted(x for x in {lo - 1, lo, lo + 1, hi - 1, hi, hi + 1, 0, 1, -1, 5, 2147483647, -2147483648} if -2147483648 <= x <= 2147483647):
            # Only the validation is compared; values that change the output beyond what is
            # ported are followed by a reset of the parameter to a neutral value.
            neutral = [(pid, 0)] if pid in (130, 160, 400, 401, 402, 500, 1006, 1007, 1010, 1015, 10, 1002, 1017, 107, 104) else []
            if pid == 100: neutral = [(100, 1)]
            if pid in (101, 102, 103, 105, 106): neutral = [(pid, 0), (107, 1)]
            add('text1000', [(pid, v)] + neutral, exact=True)
    # 9. levels >= 5 and 0: validity and round trip only, unless the strategy is ported.
    for n in ('text1000', 'text131073', 'mixed', 'text1m', 'bin1m', 'rand200k', 'run300000'):
        for l in (0, 5, 6, 7, 9, 12, 13, 15, 16, 18, 19, 22):
            add(n, [('level', l)])
            add(n, [('level', l)], ZICHUNK=70000, ZFLUSH=3)
        for strat in range(3, 10):
            add(n, [('strategy', strat), ('windowLog', 12)], ZICHUNK=70000)
        add(n, [('ldm', 1)])
        add(n, [('ldm', 1), ('level', 1), ('windowLog', 20)], ZICHUNK=70000)
    # 10. stable buffer modes (ZSTD_c_stableInBuffer / ZSTD_c_stableOutBuffer), and their errors.
    # (Inputs smaller than a block are left out: with a stable input the final call of the
    # harness would make the library read before the buffer, in the reference too.)
    for n in ('text131073', 'mixed', 'text1m'):
        for ps in ([(1006, 1)], [(1007, 1)], [(1006, 1), (1007, 1)]):
            add(n, ps + [('level', 1)], exact=True, ZOCHUNK=1 << 21)
            add(n, ps + [('level', 3)], exact=True, ZOCHUNK=1 << 21, ZICHUNK=1 << 21)
            add(n, ps + [('level', 3)], exact=True, ZOCHUNK=1 << 21, ZICHUNK=1 << 21, ZFLUSH=1)
            add(n, ps + [('level', 1)], exact=True, ZOCHUNK=5000, ZICHUNK=70000)
            add(n, ps + [('level', 1)], exact=True, ZOCHUNK=500)
    return out

def make_dicts():
    """Trained dictionaries (zstd --train on samples of the corpus), raw-content ones, and corrupt
    ones. Returns {name: path}."""
    d = os.path.join(SCRATCH, 'dicts'); os.makedirs(d, exist_ok=True)
    js = open(os.path.join(CORPUS, 'json.bin'), 'rb').read()
    tx = open(os.path.join(CORPUS, 'text.bin'), 'rb').read()
    bn = open(os.path.join(CORPUS, 'binary.bin'), 'rb').read()
    rnd = open(os.path.join(CORPUS, 'random.bin'), 'rb').read()
    out = {}
    def put(name, data):
        path = os.path.join(d, name + '.dict')
        if not os.path.exists(path) or open(path, 'rb').read() != data: open(path, 'wb').write(data)
        out[name] = path
    tdir = os.path.join(d, 'train'); os.makedirs(tdir, exist_ok=True)
    for i in range(600): open(os.path.join(tdir, f'j{i}'), 'wb').write(js[i * 3000:i * 3000 + 2000])
    for i in range(300): open(os.path.join(tdir, f't{i}'), 'wb').write(tx[i * 5000:i * 5000 + 3000])
    for size in (1024, 4096, 16384, 65536, 114688):
        path = os.path.join(d, f'tr{size}.dict')
        if not os.path.exists(path):
            subprocess.run([ZSTD, '-q', '-f', '--train', '--maxdict=%d' % size, '-o', path] + [os.path.join(tdir, f) for f in sorted(os.listdir(tdir))], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        out[f'tr{size}'] = path
    for n in (1, 7, 8, 9, 100, 3000, 32768, 200000, 1 << 20, 3 << 20):
        put(f'rawtext{n}', tx[5000000:5000000 + n])
    put('rawjson50000', js[7000000:7050000]); put('rawbin65536', bn[100000:165536]); put('rawrand10000', rnd[:10000])
    import struct
    tr = open(out['tr4096'], 'rb').read()
    i = tr.find(struct.pack('<III', 1, 4, 8))
    def patch(at, data):
        b = bytearray(tr); b[at:at + len(data)] = data; return bytes(b)
    put('bad_magiconly', tr[:4]); put('bad_eight', tr[:8]); put('bad_trunc20', tr[:20]); put('bad_trunc200', tr[:200])
    put('bad_hdronly', tr[:i + 12])
    put('bad_rep0', patch(i, struct.pack('<I', 0))); put('bad_repbig', patch(i + 4, struct.pack('<I', len(tr))))
    put('bad_repmax', patch(i + 8, struct.pack('<I', len(tr) - i - 12))); put('bad_repmax1', patch(i + 8, struct.pack('<I', len(tr) - i - 11)))
    put('bad_huf', patch(8, b'\xff\xff')); put('bad_huf2', patch(8, bytes(32))); put('bad_fse', patch(i - 30, b'\xff' * 30))
    return out

def dict_cases(inputs, full):
    dicts = make_dicts()
    d = os.path.join(SCRATCH, 'in'); os.makedirs(d, exist_ok=True)
    js = open(os.path.join(CORPUS, 'json.bin'), 'rb').read()
    tx = open(os.path.join(CORPUS, 'text.bin'), 'rb').read()
    def put(name, data):
        path = os.path.join(d, name)
        if not os.path.exists(path) or os.path.getsize(path) != len(data): open(path, 'wb').write(data)
        inputs[name] = path
        return name
    sizes = [0, 100, 3000, 8191, 8192, 8193, 16384, 16385, 32768, 32769, 100000, 131071, 131072, 131073, 1 << 20]
    if full: sizes += [5 << 20]
    out = []
    def add(name, dname, params=(), exact=None, **mode):
        ps = [(P[k] if isinstance(k, str) else k, v) for k, v in params]
        # Every strategy has its dictionary variants: every case is compared byte for byte.
        exact = True
        out.append(dict(input=name, path=inputs[name], params=ps, mode=dict(mode, ZDICT=dicts[dname]), exact=exact, dict=dname))
    levels = (-5, -1, 1, 2, 3, 4)
    good = ['tr1024', 'tr4096', 'tr16384', 'tr65536', 'tr114688', 'rawtext1', 'rawtext7', 'rawtext8', 'rawtext9', 'rawtext100', 'rawtext3000', 'rawtext32768', 'rawtext200000', 'rawjson50000', 'rawbin65536', 'rawrand10000']
    big = ['rawtext1048576', 'rawtext3145728']
    for n in sizes:
        ji = put(f'dj{n}', js[9000000:9000000 + n]); ti = put(f'dt{n}', tx[9000000:9000000 + n])
        for dn in good + (big if n in (3000, 131073, 1 << 20) else []):
            inp = ji if (dn.startswith('tr') or 'json' in dn) else ti
            for l in levels:
                add(inp, dn, [('level', l)])
                if n in (0, 3000, 32769, 131073, 1 << 20) or full:
                    add(inp, dn, [('level', l)], ZICHUNK=50000)
                    add(inp, dn, [('level', l)], ZICHUNK=50000, ZPLEDGE=n)
    # 6 x dictSize +- 1 (the cut-off of the reference between the CDict parameters and a reload).
    for dn in ('tr65536', 'tr114688', 'rawtext200000', 'rawjson50000'):
        ds = os.path.getsize(dicts[dn])
        for n in (6 * ds - 1, 6 * ds, 6 * ds + 1):
            inp = put(f'dj{n}', js[9000000:9000000 + n])
            for l in (1, 3):
                add(inp, dn, [('level', l)]); add(inp, dn, [('level', l)], ZICHUNK=100000, ZPLEDGE=n)
    # The attach preference (ZSTD_c_forceAttachDict, 1001), forceMaxWindow, dictIDFlag, checksum,
    # contentSize, an explicit window smaller than the dictionary.
    for dn in ('tr4096', 'tr114688', 'rawtext200000', 'rawtext8'):
        for n in (3000, 32769, 131073):
            inp = put(f'dj{n}', js[9000000:9000000 + n])
            for pref in (0, 1, 2, 3):
                for l in (1, 3):
                    add(inp, dn, [('level', l), (1001, pref)])
                    add(inp, dn, [('level', l), (1001, pref)], ZICHUNK=40000)
            for l in (-1, 1, 2, 3):
                add(inp, dn, [('level', l), (1000, 1)])
                add(inp, dn, [('level', l), ('dictID', 0)]); add(inp, dn, [('level', l), ('dictID', 0)], ZICHUNK=40000)
                add(inp, dn, [('level', l), ('checksum', 1)]); add(inp, dn, [('level', l), ('contentSize', 0)])
                for wl in (10, 12, 14):
                    add(inp, dn, [('level', l), ('windowLog', wl)]); add(inp, dn, [('level', l), ('windowLog', wl)], ZICHUNK=7000, ZFLUSH=2)
            add(inp, dn, [('strategy', 1), ('minMatch', 6), ('hashLog', 12)]); add(inp, dn, [('strategy', 2), ('minMatch', 5), ('chainLog', 11)])
            add(inp, dn, [('strategy', 2), ('minMatch', 7), ('hashLog', 24), ('chainLog', 24)])
            add(inp, dn, [('level', 3), ('ldm', 1)], exact=False); add(inp, dn, [('level', 1), ('ldm', 1), (1001, 3)])
    # Several frames from one context: the dictionary persists across frames and session resets;
    # loading an empty one drops it; loading during a frame is stage_wrong.
    for dn in ('tr4096', 'tr114688', 'rawtext32768', 'rawtext200000'):
        for n in (3000, 32769, 131073, 1 << 20):
            inp = put(f'dj{n}', js[9000000:9000000 + n])
            for l in (1, 3):
                add(inp, dn, [('level', l)], ZREPEAT=3)
                add(inp, dn, [('level', l)], ZREPEAT=3, ZRESET=1, ZICHUNK=30000, ZFLUSH=5)
                add(inp, dn, [('level', l)], ZREPEAT=3, ZDROP=1)
                add(inp, dn, [('level', l)], ZREPEAT=2, ZICHUNK=1000, ZMIDLOAD=1)
    # Streaming much more than the window: the dictionary falls out of the window.
    for dn in ('tr16384', 'rawtext200000', 'rawtext1048576'):
        for wl in (10, 12, 17):
            for l in (1, 2, 3):
                add('text1m', dn, [('level', l), ('windowLog', wl)], ZICHUNK=65536)
                add('text1m', dn, [('level', l), ('windowLog', wl)], ZICHUNK=1000, ZFLUSH=7)
                add('text1m', dn, [('level', l), ('windowLog', wl)], ZICHUNK=65536, ZLOOPS=3)
    # Corrupt dictionaries: the same error at the same call.
    for dn in sorted(k for k in dicts if k.startswith('bad_')):
        for n in (0, 3000, 131073):
            inp = put(f'dj{n}', js[9000000:9000000 + n])
            for l in (1, 3, 19):
                add(inp, dn, [('level', l)], exact=l < 4); add(inp, dn, [('level', l)], exact=l < 4, ZICHUNK=1000, ZREPEAT=2)
    # greedy .. btlazy2 (levels 4 to 11, and the strategies with and without the row match finder).
    for dn in ('tr1024', 'tr16384', 'tr65536', 'rawtext9', 'rawtext3000', 'rawtext200000', 'rawjson50000', 'rawtext1048576'):
        for n in (100, 3000, 16385, 32769, 131073, 1 << 20):
            inp = put(f'dj{n}', js[9000000:9000000 + n]) if (dn.startswith('tr') or 'json' in dn) else put(f'dt{n}', tx[9000000:9000000 + n])
            for l in range(4, 12):
                add(inp, dn, [('level', l)], exact=True)
                if n in (3000, 131073): add(inp, dn, [('level', l)], exact=True, ZICHUNK=20000, ZFLUSH=2)
            for strat in (3, 4, 5, 6):
                for row in (0, 1, 2):
                    add(inp, dn, [('strategy', strat), (1011, row)], exact=True)
                    if n == 32769: add(inp, dn, [('strategy', strat), (1011, row), ('searchLog', 7), ('minMatch', 6)], exact=True, ZICHUNK=10000)
    # btopt .. btultra2 (levels 12 to 22 with every dictionary, and the strategies).
    for dn in ('tr1024', 'tr16384', 'tr65536', 'rawtext9', 'rawtext3000', 'rawtext200000', 'rawjson50000'):
        for n in (100, 3000, 32769, 131073):
            inp = put(f'dj{n}', js[9000000:9000000 + n]) if (dn.startswith('tr') or 'json' in dn) else put(f'dt{n}', tx[9000000:9000000 + n])
            for l in (12, 14, 16, 17, 18, 19, 20, 22):
                add(inp, dn, [('level', l)])
                if n == 131073: add(inp, dn, [('level', l)], ZICHUNK=40000)
            for strat in (7, 8, 9):
                add(inp, dn, [('strategy', strat)]); add(inp, dn, [('strategy', strat), ('minMatch', 3)], ZICHUNK=10000)
    # Levels 5..22.
    for dn in ('tr4096', 'tr114688', 'rawtext32768', 'rawtext200000'):
        for n in (3000, 32769, 131073, 1 << 20):
            inp = put(f'dj{n}', js[9000000:9000000 + n])
            for l in (5, 6, 7, 9, 12, 13, 16, 18, 19, 22):
                add(inp, dn, [('level', l)], exact=False); add(inp, dn, [('level', l)], exact=False, ZICHUNK=50000)
    return out

def node_dict_check(inputs, dict_cases_list):
    """One-shot dictionary cases against Node's zlib.zstdCompressSync(buf, {dictionary, params})."""
    jobs = []
    for c in dict_cases_list:
        m = c['mode']
        if any(k in m for k in ('ZICHUNK', 'ZREPEAT', 'ZPLEDGE', 'ZOCHUNK')) or c['dict'].startswith('bad_'): continue
        if not c['exact']: continue
        # Node accepts only the public parameters.
        if any(k >= 1000 for k, _ in c['params']): continue
        jobs.append(dict(input=c['path'], dict=m['ZDICT'], params=dict(c['params']), chunkSize=16384))
    script = r"""
const zlib = require('zlib'), fs = require('fs'), crypto = require('crypto');
const jobs = JSON.parse(fs.readFileSync(0));
const out = jobs.map(j => { const params = {}; for (const k in j.params) params[k] = j.params[k];
  try { const r = zlib.zstdCompressSync(fs.readFileSync(j.input), {params, chunkSize: j.chunkSize, dictionary: fs.readFileSync(j.dict)});
  return crypto.createHash('md5').update(r).digest('hex'); } catch (e) { return 'error ' + e.message; } });
console.log(JSON.stringify(out));
"""
    r = subprocess.run([NODE, '-e', script], input=json.dumps(jobs).encode(), stdout=subprocess.PIPE, check=True)
    want = json.loads(r.stdout)
    def one(i):
        j = jobs[i]
        o = os.path.join(SCRATCH, f'nodedict{i}.zst')
        params = dict(j['params'])
        if params.get(100) == -1: del params[100]
        env = dict(ZIN=j['input'], ZOUT=o, ZDICT=j['dict'], ZPARAMS=' '.join(f'{k} {v}' for k, v in params.items()), ZOCHUNK=str(j['chunkSize']))
        rc = subprocess.run([CLI], env=env, stdout=subprocess.DEVNULL).returncode
        data = open(o, 'rb').read(); os.remove(o)
        if rc != 0: return 'error'
        if len(data) % j['chunkSize'] == 0 and len(data) > 0:
            fhd = 0x20 | (4 if params.get(201) else 0)
            data += bytes([0x28, 0xb5, 0x2f, 0xfd]) + (bytes([fhd, 0]) if params.get(200, 1) else bytes([fhd & ~0x20, 0x00])) + bytes([1, 0, 0])
        return hashlib.md5(data).hexdigest()
    with ThreadPoolExecutor(4) as ex: got = list(ex.map(one, range(len(jobs))))
    bad = 0
    for j, g, w in zip(jobs, got, want):
        if g != w:
            bad += 1
            print('NODE MISMATCH', os.path.basename(j['input']), os.path.basename(j['dict']), j['params'], w if w.startswith('error') else '')
    print(f'node: {len(jobs) - bad}/{len(jobs)} one-shot dictionary cases identical to zlib.zstdCompressSync')
    return bad

def node_check(inputs, full):
    """One-shot cases against Node: zstdCompressSync calls ZSTD_compressStream2(e_end) with an
    output buffer of chunkSize, as the CLI does with ZOCHUNK."""
    jobs = []
    names = [n for n in inputs if n not in ('text', 'json', 'binary', 'random')] + (['text', 'json', 'binary', 'random'] if full else [])
    for n in names:
        for l in (-131072, -1000, -50, -10, -5, -3, -1, 1, 2, 3, 4):
            for cs in ((16384,) if not full else (16384, 64, 1 << 20)):
                if cs == 64 and os.path.getsize(inputs[n]) > (1 << 20): continue
                jobs.append(dict(input=inputs[n], params={100: l}, chunkSize=cs))
        for extra in ({201: 1}, {200: 0}, {107: 2, 101: 14}, {107: 1, 105: 6, 102: 12}):
            jobs.append(dict(input=inputs[n], params={100: 3, **extra}, chunkSize=16384))
    script = r"""
const zlib = require('zlib'), fs = require('fs'), crypto = require('crypto');
const jobs = JSON.parse(fs.readFileSync(0));
const out = jobs.map(j => { const params = {}; for (const k in j.params) params[k] = j.params[k];
  const r = zlib.zstdCompressSync(fs.readFileSync(j.input), {params, chunkSize: j.chunkSize});
  return crypto.createHash('md5').update(r).digest('hex'); });
console.log(JSON.stringify(out));
"""
    r = subprocess.run([NODE, '-e', script], input=json.dumps(jobs).encode(), stdout=subprocess.PIPE, check=True)
    want = json.loads(r.stdout)
    bad = 0
    def one(i):
        j = jobs[i]
        o = os.path.join(SCRATCH, f'node{i}.zst')
        params = dict(j['params'])
        # Node quirk 1: a compression level of -1 is the same as leaving the level unset.
        if params.get(100) == -1: del params[100]
        env = dict(ZIN=j['input'], ZOUT=o, ZPARAMS=' '.join(f'{k} {v}' for k, v in params.items()), ZOCHUNK=str(j['chunkSize']))
        subprocess.run([CLI], env=env, stdout=subprocess.DEVNULL)
        data = open(o, 'rb').read(); os.remove(o)
        # Node quirk 2: when the frame ends exactly at the end of an output chunk, Node calls
        # ZSTD_compressStream2(e_end) once more, which writes an empty frame.
        if len(data) % j['chunkSize'] == 0 and len(data) > 0:
            fhd = 0x20 | (4 if params.get(201) else 0)
            data += bytes([0x28, 0xb5, 0x2f, 0xfd]) + (bytes([fhd, 0]) if params.get(200, 1) else bytes([fhd & ~0x20, 0x00 if False else 0x00])) + bytes([1, 0, 0])
        return hashlib.md5(data).hexdigest()
    with ThreadPoolExecutor(4) as ex:
        got = list(ex.map(one, range(len(jobs))))
    for j, g, w in zip(jobs, got, want):
        if g != w:
            bad += 1
            print('NODE MISMATCH', os.path.basename(j['input']), j['params'], j['chunkSize'])
    print(f'node: {len(jobs) - bad}/{len(jobs)} one-shot cases identical to zlib.zstdCompressSync')
    return bad

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--full', action='store_true'); ap.add_argument('--node', action='store_true'); ap.add_argument('--dict', action='store_true')
    ap.add_argument('--filter', default=''); ap.add_argument('-j', type=int, default=4); ap.add_argument('--no-build', action='store_true')
    a = ap.parse_args()
    if not a.no_build: build()
    inputs = make_inputs()
    seen = set(); cs = []
    for c in (dict_cases(inputs, a.full) if a.dict else cases(inputs, a.full)):
        key = json.dumps([c['input'], c['params'], c['mode']])
        if key in seen or a.filter not in key: continue
        seen.add(key); cs.append(c)
    bad = 0; exact = 0; valid_only = 0
    with ThreadPoolExecutor(a.j) as ex:
        for case, problems in ex.map(run_case, cs):
            if case['exact']: exact += 1
            else: valid_only += 1
            if problems:
                bad += 1
                print('FAIL', case['input'], case['params'], case['mode'], 'exact' if case['exact'] else 'valid-only')
                for p in problems: print('   ', p)
    print(f'{len(cs)} cases ({exact} compared byte for byte and call by call, {valid_only} for validity only): {bad} failed')
    same = [c for c in cs if not c['exact'] and c.get('same')]
    print(f'of the {valid_only} validity-only cases, {len(same)} are identical to the reference anyway')
    if a.dict:
        for c in cs:
            if not c['exact'] and not c.get('same', True): print('  differs (not compared):', c['input'], os.path.basename(c['mode']['ZDICT']), c['params'], {k: v for k, v in c['mode'].items() if k != 'ZDICT'})
    if a.node: bad += node_dict_check(inputs, cs) if a.dict else node_check(inputs, a.full)
    sys.exit(1 if bad else 0)

if __name__ == '__main__':
    main()
