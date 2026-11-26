#!/usr/bin/env python3
"""tm.py ROUNDS SCRIPT name=cmd... : median CPU ms per engine, interleaved on core 0."""
import os,resource,statistics,subprocess,sys,shlex
rounds=int(sys.argv[1]); script=sys.argv[2]
engines=[a.split('=',1) for a in sys.argv[3:]]
env={k:v for k,v in os.environ.items() if k not in('NODE_OPTIONS','BUN_OPTIONS')}
env['SILKJS_PREPARSE_THREADS']='0'
t={n:[] for n,_ in engines}
for r in range(rounds):
    for i in range(len(engines)):
        n,c=engines[(i+r)%len(engines)]
        b=resource.getrusage(resource.RUSAGE_CHILDREN)
        subprocess.run(['taskset','-c','0',*shlex.split(c),script],capture_output=True,env=env,check=True)
        a=resource.getrusage(resource.RUSAGE_CHILDREN)
        t[n].append((a.ru_utime-b.ru_utime+a.ru_stime-b.ru_stime)*1000)
print('  '.join('%s %.0f'%(n,statistics.median(v)) for n,v in t.items()))
