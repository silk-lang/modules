import sys,re,bisect,collections
# regprof.py DUMP CGOUT : instruction counts by region kind (optimized code, baseline code, the rest),
# from a callgrind --dump-instr=yes run with --jit-dump.
dump,cg=sys.argv[1:3]
regions=[]
for l in open(dump,errors='replace'):
    m=re.match(r'jit: (optimized|baseline) code at (\d+) ([0-9a-f]+)',l)
    if m: regions.append((int(m.group(2)),len(m.group(3))//2,m.group(1),len(regions)))
cnt=collections.Counter(); addr=0; after_call=False; total=0
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
    if len(f)>=3: n=int(f[2]); cnt[addr]+=n; total+=n
starts=sorted(regions)
kind=collections.Counter(); per=collections.Counter()
for ad,n in cnt.items():
    i=bisect.bisect_right(starts,(ad,1<<60,'',0))-1
    if i>=0 and ad<starts[i][0]+starts[i][1]: kind[starts[i][2]]+=n; per[(starts[i][2],starts[i][3])]+=n
    else: kind['rest']+=n
print('Ir total %d'%total)
for k,v in kind.most_common(): print('  %-10s %5.1f%% %13d'%(k,100*v/total,v))
for (k,i),v in per.most_common(int(sys.argv[3]) if len(sys.argv)>3 else 12): print('    %s region %d (%d bytes) %d'%(k,i,regions[i][1],v))
