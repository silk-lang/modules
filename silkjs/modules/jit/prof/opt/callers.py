import sys,re,collections,bisect
# callers.py DUMP CGOUT PATTERN: optimized-code call sites (fn#inst) of callees matching PATTERN, by calls
dump,cg,pat=sys.argv[1:4]
funcs=[];cur=None;regions=[]
for l in open(dump,errors='replace'):
    if l.startswith('jit: optimized ssa'): cur=[]; continue
    if l.startswith('jit: optimized map'):
        p=l.split()[3:]; funcs.append(([int(x) for x in p[:-1]],int(p[-1]),cur)); cur=None; continue
    m=re.match(r'jit: optimized code at (\d+) ([0-9a-f]+)',l)
    if m: regions.append((int(m.group(1)),len(m.group(2))//2)); continue
    if cur is not None and l.startswith('  '): cur.append(l.strip())
starts=sorted((a,k) for k,(a,n) in enumerate(regions))
names={};addr=0;cfn=None;hits=collections.Counter()
for l in open(cg):
    if l.startswith('cfn='):
        m=re.match(r'cfn=\((\d+)\)(?: (.*))?',l.strip())
        if m.group(2): names[m.group(1)]=m.group(2)
        cfn=names.get(m.group(1),''); continue
    if l.startswith('fn='):
        m=re.match(r'fn=\((\d+)\)(?: (.*))?',l.strip())
        if m.group(2): names[m.group(1)]=m.group(2)
        continue
    if l.startswith('calls='):
        n=int(l.split('=')[1].split()[0]); pend=n; continue
    f=l.split()
    if not f: continue
    a=f[0]
    if a.startswith('0x'): addr=int(a,16)
    elif a[0]=='+' and a[1:].isdigit(): addr+=int(a[1:])
    elif a[0]=='-' and a[1:].isdigit(): addr-=int(a[1:])
    elif a=='*': pass
    else: continue
    if 'pend' in dir() and pend is not None:
        if cfn and pat in cfn: hits[addr]+=pend
        pend=None
for ad,n in hits.most_common(25):
    i=bisect.bisect_right(starts,(ad,1<<30))-1
    if i<0: print(hex(ad),n,'?'); continue
    a,k=starts[i]
    if ad>=a+regions[k][1]: print(hex(ad),n,'not optimized'); continue
    offs,end,insts=funcs[k]; o=ad-a
    j=-1 if o>=end else bisect.bisect_right(offs,o)-1
    print(n,'fn%d#%d'%(k,j), insts[j][:110] if j>=0 else '<tail>')
