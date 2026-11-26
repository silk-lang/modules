import sys,subprocess,re
# usage: dis.py dump.txt N  -> disassemble the Nth "jit: optimized code at" block
lines=[l for l in open(sys.argv[1]) if l.startswith('jit: optimized code at ')]
n=int(sys.argv[2]) if len(sys.argv)>2 else 0
_,_,_,_,addr,hexs=lines[n].split()
open(''+__import__('os').environ.get('SILKJS_PROF','.')+'/opt/code.bin','wb').write(bytes.fromhex(hexs))
out=subprocess.run(['objdump','-D','-b','binary','-mi386:x86-64','-M','intel','--adjust-vma=%d'%int(addr),''+__import__('os').environ.get('SILKJS_PROF','.')+'/opt/code.bin'],capture_output=True,text=True).stdout
for l in out.splitlines()[7:]:
    m=re.match(r'\s*([0-9a-f]+):\s+((?:[0-9a-f]{2} )+)\s*(.*)',l)
    if m: print('%x: %s'%(int(m.group(1),16)-int(addr),m.group(3)))
