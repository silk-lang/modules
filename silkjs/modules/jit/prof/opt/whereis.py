import re,sys
# whereis.py DUMP RIP(hex): the SSA instruction whose code holds the address, and its function's SSA
rip=int(sys.argv[2],16)
funcs=[];cur=None;regions=[]
for l in open(sys.argv[1],errors='replace'):
    if l.startswith('jit: optimized ssa'): cur=[]; continue
    if l.startswith('jit: optimized map'):
        p=l.split()[3:]; funcs.append(([int(x) for x in p[:-1]],int(p[-1]),cur)); cur=None; continue
    m=re.match(r'jit: optimized code at (\d+) ([0-9a-f]+)',l)
    if m: regions.append((int(m.group(1)),len(m.group(2))//2)); continue
    if cur is not None and l.startswith('  '): cur.append(l.strip())
for k,(a,n) in enumerate(regions):
    if a<=rip<a+n:
        offs,end,insts=funcs[k]; o=rip-a
        print('fn',k,'off',o,'end',end)
        for j,t in enumerate(insts): print('%4d @%d %s'%(j,offs[j],t))
