import sys,re,bisect,collections
# callsites.py DUMP CGOUT PATTERN : calls into functions matching PATTERN, by the optimized SSA instruction (or stub region) making them.
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
names={}
addr=0; cfn=None; pending=None; out=collections.Counter(); ir=collections.Counter()
for l in open(cg):
    if l.startswith('fn='):
        m=re.match(r'fn=\((\d+)\)(?: (.*))?',l.strip())
        if m and m.group(2): names[m.group(1)]=m.group(2)
        continue
    if l.startswith('cfn='):
        m=re.match(r'cfn=\((\d+)\)(?: (.*))?',l.strip())
        if m:
            if m.group(2): names[m.group(1)]=m.group(2)
            cfn=names.get(m.group(1),'')
        continue
    if l.startswith('calls='):
        pending=int(l.split('=')[1].split()[0]); continue
    f=l.split()
    if not f: continue
    a=f[0]
    if a.startswith('0x'): addr=int(a,16)
    elif a[0]=='+' and a[1:].isdigit(): addr+=int(a[1:])
    elif a[0]=='-' and a[1:].isdigit(): addr-=int(a[1:])
    elif a=='*': pass
    else: continue
    if pending is not None:
        if cfn and re.search(pat,cfn):
            i=bisect.bisect_right(starts,(addr,1<<30))-1; key='outside optimized code %x'%(addr>>12<<12)
            if i>=0:
                s,k=starts[i]
                if addr<s+regions[k][1]:
                    offs,end,insts=funcs[k]; o=addr-s; j=bisect.bisect_right(offs,o)-1
                    key='fn %d #%d %s'%(k,j,insts[j][:90] if j>=0 else '?')
            out[key]+=pending; ir[key]+=int(f[-1])
        pending=None
for k,v in out.most_common(25): print('%9d calls %11d Ir  %s'%(v,ir[k],k))
