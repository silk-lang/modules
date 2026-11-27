import sys,re,subprocess
# opdis.py DUMP K INSTINDEX... : machine code of optimized function K for the given SSA instruction indexes
dump=sys.argv[1]; K=int(sys.argv[2]); want=[int(x) for x in sys.argv[3:]]
funcs=[];cur=None;regions=[]
for l in open(dump,errors='replace'):
    if l.startswith('jit: optimized ssa'): cur=[]; continue
    if l.startswith('jit: optimized map'):
        p=l.split()[3:]; funcs.append(([int(x) for x in p[:-1]],int(p[-1]),cur)); cur=None; continue
    m=re.match(r'jit: optimized code at (\d+) ([0-9a-f]+)',l)
    if m: regions.append((int(m.group(1)),m.group(2))); continue
    if cur is not None and l.startswith('  '): cur.append(l.strip())
offs,end,insts=funcs[K]; addr,hexs=regions[K]
open('/tmp/opd.bin','wb').write(bytes.fromhex(hexs))
out=subprocess.run(['objdump','-D','-b','binary','-mi386:x86-64','-M','intel','/tmp/opd.bin'],capture_output=True,text=True).stdout
code=[]
for l in out.splitlines()[7:]:
    m=re.match(r'\s*([0-9a-f]+):\s+((?:[0-9a-f]{2} )+)\s*(.*)',l)
    if m: code.append((int(m.group(1),16),m.group(3)))
for j in want:
    lo=offs[j]; hi=offs[j+1] if j+1<len(offs) else end
    print('#%d %s  [%d,%d)'%(j,insts[j],lo,hi))
    for o,t in code:
        if lo<=o<hi: print('   %5d: %s'%(o,t))
