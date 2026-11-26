import sys,re,bisect,collections
# opsites.py DUMP CGOUT OPNAME [N]: the hottest instructions of one SSA operation across all optimized functions.
dump,cg,want=sys.argv[1:4]; N=int(sys.argv[4]) if len(sys.argv)>4 else 30
funcs=[];cur=None;regions=[]
for l in open(dump,errors='replace'):
    if l.startswith('jit: optimized ssa'): cur=[]; continue
    if l.startswith('jit: optimized map'):
        p=l.split()[3:]; funcs.append(([int(x) for x in p[:-1]],int(p[-1]),cur)); cur=None; continue
    m=re.match(r'jit: optimized code at (\d+) ([0-9a-f]+)',l)
    if m: regions.append((int(m.group(1)),len(m.group(2))//2)); continue
    if cur is not None and l.startswith('  '): cur.append(l.strip())
cnt=collections.Counter(); addr=0; after=False
for l in open(cg):
    if l.startswith('calls='): after=True; continue
    f=l.split()
    if not f: continue
    a=f[0]
    if a.startswith('0x'): addr=int(a,16)
    elif a[0]=='+' and a[1:].isdigit(): addr+=int(a[1:])
    elif a[0]=='-' and a[1:].isdigit(): addr-=int(a[1:])
    elif a=='*': pass
    else: continue
    if after: after=False; continue
    if len(f)>=3: cnt[addr]+=int(f[2])
starts=sorted((a,k) for k,(a,n) in enumerate(regions))
per=collections.Counter()
for ad,n in cnt.items():
    i=bisect.bisect_right(starts,(ad,1<<30))-1
    if i<0: continue
    a,k=starts[i]
    if ad>=a+regions[k][1]: continue
    offs,end,insts=funcs[k]; o=ad-a
    if o>=end: continue
    j=bisect.bisect_right(offs,o)-1
    t=insts[j]; t2=t.split(' = ')[-1] if ' = ' in t else t
    if t2.split()[0]==want: per[(k,j)]+=n
for (k,j),v in per.most_common(N): print('%10d fn %d #%d %s'%(v,k,j,funcs[k][2][j][:110]))
