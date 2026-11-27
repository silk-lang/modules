import sys,re,collections
# callees.py CGOUT PATTERN [N]: direct callees of functions matching PATTERN, by inclusive Ir, plus self Ir.
NPOS=1
names={}; out=collections.Counter(); selfc=0
pat=re.compile(sys.argv[2]); N=int(sys.argv[3]) if len(sys.argv)>3 else 30
def name(tok):
    m=re.match(r'\((\d+)\)(?: (.*))?',tok)
    if not m: return tok
    if m.group(2): names[m.group(1)]=m.group(2)
    return names.get(m.group(1),m.group(1))
fn=None; cfn=None; incall=False; inf=False
for l in open(sys.argv[1],errors='replace'):
    if l.startswith('positions:'): NPOS=len(l.split())-1
    l=l.rstrip('\n')
    if l.startswith('fn='): fn=name(l[3:]); inf=bool(pat.search(fn)); continue
    if l.startswith('cfn='): cfn=name(l[4:]); continue
    if l.startswith('cfi=') or l.startswith('cob='): continue
    if l.startswith('calls='): incall=True; continue
    if l and (l[0].isdigit() or l[0] in '+-*'):
        parts=l.split()
        if len(parts)>=2 and inf:
            c=int(parts[NPOS]) if len(parts)>NPOS else 0
            if incall: out[cfn]+=c
            else: selfc+=c
        incall=False
print('self', selfc)
for k,v in out.most_common(N): print('%12d %s'%(v,k[:110]))
