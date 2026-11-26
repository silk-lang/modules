// The reference twin of modules/zstd/tools/dcli: same environment variables, same call pattern.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "zstd.h"
#include "zstd_errors.h"
static size_t num(const char* n, size_t d){ const char* v=getenv(n); return v? (size_t)atol(v): d; }
static void* rd(const char* name, size_t* len){ size_t cap=(size_t)1<<31; void* b=malloc(cap); FILE* f=fopen(name,"rb"); if(!f){*len=0;return b;} *len=fread(b,1,cap,f); fclose(f); return b; }
int main(void){
  size_t inLen; const char* in=rd(getenv("ZIN"),&inLen); size_t cap=(size_t)1<<32; char* out=malloc(cap);
  size_t inChunk=num("ZINCHUNK",inLen+1), outChunk=num("ZOUTCHUNK",16384), repeat=num("ZREPEAT",1), wlm=num("ZWLM",0);
  int trace = getenv("ZTRACE")!=NULL;
  ZSTD_DStream* s=ZSTD_createDStream();
  if(wlm){ size_t r=ZSTD_DCtx_setParameter(s,ZSTD_d_windowLogMax,(int)wlm); if(ZSTD_isError(r)){printf("parameter error %d: %s\n",(int)ZSTD_getErrorCode(r),ZSTD_getErrorName(r));return 1;} }
  if(getenv("ZDICT")){ size_t dl; void* d=rd(getenv("ZDICT"),&dl); size_t r=ZSTD_DCtx_loadDictionary(s,d,dl); if(ZSTD_isError(r)){printf("dictionary error %d: %s\n",(int)ZSTD_getErrorCode(r),ZSTD_getErrorName(r));return 1;} }
  size_t written=0,last=0; long elapsed=0;
  for(size_t round=0;round<repeat;round++){
    ZSTD_DCtx_reset(s,ZSTD_reset_session_only); clock_t st=clock(); size_t inPos=0,outPos=0,inLimit=0; last=0;
    for(;;){
      if(inPos==inLimit){ inLimit+=inChunk; if(inLimit>inLen) inLimit=inLen; }
      size_t outLimit=outPos+outChunk; if(outLimit>cap) outLimit=cap;
      size_t bi=inPos, bo=outPos;
      ZSTD_inBuffer ib={in,inLimit,inPos}; ZSTD_outBuffer ob={out,outLimit,outPos};
      last=ZSTD_decompressStream(s,&ob,&ib); inPos=ib.pos; outPos=ob.pos;
      if(trace) printf("call in %zu->%zu out %zu->%zu ret %zu\n",bi,inPos,bo,outPos,ZSTD_isError(last)?(size_t)-(long)ZSTD_getErrorCode(last):last);
      if(ZSTD_isError(last)) break;
      if(inPos==inLen && outPos<outLimit && bi==inPos && bo==outPos) break;
      if(inPos==inLen && last==0) break;
    }
    elapsed=(long)(clock()-st); written=outPos;
  }
  if(ZSTD_isError(last)) printf("error %d after %ld bytes (usec %ld): %s\n",(int)ZSTD_getErrorCode(last),(long)written,elapsed,ZSTD_getErrorName(last));
  else { printf("in %ld out %ld usec %ld\n",(long)inLen,(long)written,elapsed); if(last) printf("unfinished: hint %ld\n",(long)last); }
  FILE* o=fopen(getenv("ZOUT"),"wb"); if(o){fwrite(out,1,written,o);fclose(o);}
  return (ZSTD_isError(last)||last)?1:0;
}
