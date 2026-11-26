import sys,re,collections
path,pat=sys.argv[1],sys.argv[2]
names={}
cur=None; addr=0; skip=False
acc=collections.Counter()
def pos(tok,prev):
    if tok.startswith('+'): return prev+int(tok[1:],0)
    if tok.startswith('-'): return prev-int(tok[1:],0)
    if tok=='*': return prev
    return int(tok,0)
for line in open(path):
    line=line.rstrip('\n')
    if not line: continue
    c=line[0]
    if line.startswith('fn='):
        m=re.match(r'fn=\((\d+)\)(?: (.*))?',line)
        if m.group(2): names[m.group(1)]=m.group(2)
        cur=names.get(m.group(1),''); continue
    if line.startswith('cfn='):
        m=re.match(r'cfn=\((\d+)\)(?: (.*))?',line)
        if m.group(2): names[m.group(1)]=m.group(2)
        continue
    if line.startswith('calls='):
        skip=True; continue
    if c.isdigit() or c in '+-*':
        parts=line.split()
        a=pos(parts[0],addr); addr=a
        if skip: skip=False; continue
        if cur and pat in cur and len(parts)>=3:
            acc[a]+=int(parts[2])
        continue
    if '=' in line: continue
for a,v in sorted(acc.items()):
    print(hex(a),v)
