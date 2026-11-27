import sys,re,bisect
dump,dis,k,lo,hi=sys.argv[1],sys.argv[2],int(sys.argv[3]),int(sys.argv[4]),int(sys.argv[5])
funcs=[];cur=None
for l in open(dump,errors='replace'):
    if l.startswith('jit: optimized ssa'): cur=[]; continue
    if l.startswith('jit: optimized map'):
        funcs.append(([int(x) for x in l.split()[3:]],cur)); cur=None; continue
    if cur is not None and l.startswith('  '): cur.append(l.strip())
offs,insts=funcs[k]
D=[]
for l in open(dis):
    o,t=l.split(':',1); D.append((int(o,16),t.strip()))
for i in range(lo,hi+1):
    print('--- %d %s'%(i,insts[i][:120]))
    for o,t in D:
        if offs[i]<=o<offs[i+1] and t: print('      %5d %s'%(o,t))
