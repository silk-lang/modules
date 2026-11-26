import sys,re,bisect,collections
# stubprof.py DUMP CGOUT: Ir per shared stub (baseline region 0), from its map marks.
dump,cg=sys.argv[1:3]
base=None;marks=None
for l in open(dump,errors='replace'):
    m=re.match(r'jit: baseline code at (\d+) ([0-9a-f]+)',l)
    if m and base is None: base=int(m.group(1)); size=len(m.group(2))//2; continue
    if l.startswith('jit: baseline map') and marks is None:
        marks=[(int(p.split(':')[0]),p.split(':')[2]) for p in l.split()[3:]]
        break
cnt=collections.Counter(); calls=collections.Counter(); addr=0; after_call=False
for l in open(cg):
    if l.startswith('calls='): after_call=True; continue
    f=l.split()
    if not f: continue
    a=f[0]
    if a.startswith('0x'): addr=int(a,16)
    elif a[0]=='+' and a[1:].isdigit(): addr+=int(a[1:])
    elif a[0]=='-' and a[1:].isdigit(): addr-=int(a[1:])
    elif a=='*': pass
    else: continue
    if after_call: after_call=False; continue
    if len(f)>=3 and base<=addr<base+size: cnt[addr-base]+=int(f[2])
offs=[o for o,_ in marks]
per=collections.Counter(); first={}
for o,n in cnt.items():
    j=bisect.bisect_right(offs,o)-1
    per[j]+=n
    if o==offs[j]: first[j]=n
for j,n in per.most_common(40):
    print('%-8s @%-5d %12d  entries %s'%(marks[j][1],marks[j][0],n,first.get(j,'?')))
print('total',sum(per.values()))
