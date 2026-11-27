import sys, bisect, subprocess, collections, re
binary, samples, dump = sys.argv[1], sys.argv[2], sys.argv[3]
maps=[]
for l in open(samples.replace('all','s1')+'.maps'):
    p=l.split()
    if 'x' in p[1]:
        a,b=(int(x,16) for x in p[0].split('-')); maps.append((a,b,int(p[2],16),p[-1].split('/')[-1] if len(p)>5 else ''))
syms=[]
for line in subprocess.run(['nm','-n','--defined-only',binary],capture_output=True,text=True).stdout.splitlines():
    p=line.split()
    if len(p)==3 and p[1] in 'tTwW': syms.append((int(p[0],16),p[2]))
addrs=[a for a,_ in syms]
base=0  # the shell is not position independent
regions=[]  # (start,end,label)
kinds=collections.Counter(); last_map=None
for l in open(dump, errors='replace'):
    if l.startswith('jit: baseline map'): last_map=l
    m=re.match(r'jit: (baseline|optimized|osr|)\s?code at (\d+) ([0-9a-f]+)',l)
    if m:
        k=m.group(1) or 'old'; a=int(m.group(2)); n=len(m.group(3))//2
        regions.append((a,a+n,'%s#%d'%(k,kinds[k]),last_map if k=='baseline' else None)); kinds[k]+=1
regions.sort(); starts=[r[0] for r in regions]
c=collections.Counter(); detail=collections.defaultdict(collections.Counter)
for l in open(samples):
    s=int(l,16); i=bisect.bisect_right(starts,s)-1
    if i>=0 and s<regions[i][1]:
        c[regions[i][2]]+=1; detail[regions[i][2]][s-regions[i][0]]+=1; continue
    name=None
    for a,b,o,n in maps:
        if a<=s<b: name=n; break
    if name==binary.split('/')[-1]:
        j=bisect.bisect_right(addrs,s-base)-1; c[syms[j][1]]+=1
    else: c['<%s>'%name]+=1
tot=sum(c.values())
grp=collections.Counter()
for k,v in c.items(): grp[k.split('#')[0] if '#' in k else 'native']+=v
print('total',tot,' '.join('%s %.1f%%'%(k,100*v/tot) for k,v in grp.most_common()))
for k,v in c.most_common(int(sys.argv[4]) if len(sys.argv)>4 else 30): print('%-60s %5.1f%%'%(k[:60],100*v/tot))
if len(sys.argv)>5:
    k=sys.argv[5]; r=[r for r in regions if r[2]==k][0]
    marks=[]
    if r[3]:
        for t in r[3].split()[3:]:
            p=t.split(':'); marks.append((int(p[0]),p[2]))
    mo=[m[0] for m in marks]; d=collections.Counter()
    for off,v in detail[k].items():
        if marks:
            j=bisect.bisect_right(mo,off)-1; d['%d %s'%marks[j]]+=v
        else: d[off//32*32]+=v
    for a,v in sorted(d.items(), key=lambda x:-x[1])[:40]: print('   ',a,'%.1f%%'%(100*v/tot))
