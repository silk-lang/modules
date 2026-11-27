import sys,re
t=open(sys.argv[1]).read().split()
keys=sys.argv[2:] or None
d={}
i=0
while i<len(t)-1:
    if re.fullmatch(r'\d+',t[i+1]) and not re.fullmatch(r'\d+',t[i]): d[t[i]]=int(t[i+1]); i+=2
    else: i+=1
for k,v in d.items():
    if (keys is None and v) or (keys and any(x in k for x in keys)): print(k,v)
