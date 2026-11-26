// Reference side of the differential harness: zlib 1.3.1 behind the shim's calling convention.
#include <stdlib.h>
#include <string.h>
#include "zlib.h"
typedef struct { z_stream z; int inflate; } ref;
void *zr_deflate_new(int level, int windowBits, int memLevel, int strategy) {
  ref *r = calloc(1, sizeof(ref));
  if (deflateInit2(&r->z, level, Z_DEFLATED, windowBits, memLevel, strategy) != Z_OK) { free(r); return 0; }
  return r;
}
void zr_deflate_free(void *h) { ref *r = h; deflateEnd(&r->z); free(r); }
int zr_deflate(void *h, unsigned char *in, size_t len, unsigned char *out, size_t cap, int flush, size_t *consumed, size_t *written) {
  ref *r = h; r->z.next_in = in; r->z.avail_in = len; r->z.next_out = out; r->z.avail_out = cap;
  int s = deflate(&r->z, flush);
  *consumed = len - r->z.avail_in; *written = cap - r->z.avail_out; return s;
}
void zr_deflate_reset(void *h) { ref *r = h; deflateReset(&r->z); }
int zr_deflate_params(void *h, int level, int strategy, unsigned char *out, size_t cap, size_t *written) {
  ref *r = h; r->z.next_in = 0; r->z.avail_in = 0; r->z.next_out = out; r->z.avail_out = cap;
  int s = deflateParams(&r->z, level, strategy); *written = cap - r->z.avail_out; return s;
}
int zr_deflate_dictionary(void *h, unsigned char *d, size_t len) { ref *r = h; return deflateSetDictionary(&r->z, d, len); }
void *zr_inflate_new(int windowBits) {
  ref *r = calloc(1, sizeof(ref)); r->inflate = 1;
  if (inflateInit2(&r->z, windowBits) != Z_OK) { free(r); return 0; }
  return r;
}
void zr_inflate_free(void *h) { ref *r = h; inflateEnd(&r->z); free(r); }
int zr_inflate(void *h, unsigned char *in, size_t len, unsigned char *out, size_t cap, int flush, size_t *consumed, size_t *written, char *msg) {
  ref *r = h; r->z.next_in = in; r->z.avail_in = len; r->z.next_out = out; r->z.avail_out = cap; r->z.msg = 0;
  int s = inflate(&r->z, flush);
  *consumed = len - r->z.avail_in; *written = cap - r->z.avail_out;
  msg[0] = 0; if (r->z.msg) strncpy(msg, r->z.msg, 63);
  return s;
}
int zr_inflate_reset(void *h) { ref *r = h; return inflateReset(&r->z); }
int zr_inflate_dictionary(void *h, unsigned char *d, size_t len) { ref *r = h; return inflateSetDictionary(&r->z, d, len); }
