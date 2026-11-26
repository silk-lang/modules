import sys, bisect, collections, re
# opprof.py MAPDUMP REGIONDUMP SAMPLES [K] : samples of optimized code by SSA operation.
mapdump, regdump, samples = sys.argv[1:4]
funcs=[]; cur=None
for l in open(mapdump, errors='replace'):
    if l.startswith('jit: optimized ssa'): cur=[]; continue
    if l.startswith('jit: optimized map'):
        p=l.split()[3:]; end=int(p[-1]); offs=[int(x) for x in p[:-1]]
        funcs.append((offs,end,cur)); cur=None; continue
    if cur is not None and l.startswith('  '): cur.append(l.strip())
regions=[]
for l in open(regdump, errors='replace'):
    m=re.match(r'jit: optimized code at (\d+) ([0-9a-f]+)',l)
    if m: regions.append((int(m.group(1)),len(m.group(2))//2))
assert len(regions)==len(funcs),(len(regions),len(funcs))
allc=collections.Counter(); per={}
total=0
S=[int(l,16) for l in open(samples)]
for k,((addr,n),(offs,end,insts)) in enumerate(zip(regions,funcs)):
    assert len(offs)==len(insts),(k,len(offs),len(insts))
    c=collections.Counter()
    for s in S:
        if addr<=s<addr+n:
            o=s-addr
            if o>=end: c[-1]+=1
            else: c[bisect.bisect_right(offs,o)-1]+=1
    per[k]=c
def opname(t):
    t=t.split(' = ')[-1] if ' = ' in t else t
    return t.split()[0]
tot=len(S)
which=[int(sys.argv[4])] if len(sys.argv)>4 else sorted(per)
ops=collections.Counter(); size=collections.Counter()
for k in which:
    offs,end,insts=funcs[k]
    for i,v in per[k].items():
        if i<0: ops['<tails>']+=v
        else: ops[opname(insts[i])]+=v
print('samples',tot,'in these',sum(ops.values()))
for o,v in ops.most_common(30): print('  %-14s %5.1f%%'%(o,100*v/tot))
if len(which)==1:
    k=which[0]; offs,end,insts=funcs[k]
    print('top instructions')
    for i,v in per[k].most_common(45):
        if i>=0: print('  %4d %4.1f%% @%d+%d  %s'%(i,100*v/tot,offs[i],(offs[i+1] if i+1<len(offs) else end)-offs[i],insts[i][:110]))
