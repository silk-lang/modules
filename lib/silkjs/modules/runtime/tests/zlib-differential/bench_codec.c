// Codec throughput: the Silk adapter (zs_*) and zlib 1.3.1 (zr_*) on the same calls, in turns.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#ifndef SILK_DEFLATE_NEW
#define SILK_DEFLATE_NEW zs_deflate_new
#endif
void *SILK_DEFLATE_NEW(int, int, int, int); void zs_deflate_free(void *);
int zs_deflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *);
void *zr_deflate_new(int, int, int, int); void zr_deflate_free(void *);
int zr_deflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *);
void *zs_inflate_new(int); void zs_inflate_free(void *);
int zs_inflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *, char *);
void *zr_inflate_new(int); void zr_inflate_free(void *);
int zr_inflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *, char *);
typedef void *(*dnew)(int, int, int, int); typedef void (*dfree)(void *);
typedef int (*dstep)(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *);
typedef void *(*inew)(int); typedef int (*istep)(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *, char *);
static uint32_t seed = 0x2545f491;
static uint32_t rnd(void) { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return seed; }
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }
static const char *words[] = {"the","of","and","to","in","is","that","for","it","as","was","with","be","by","on","not","stream","window","buffer","deflate","block","compress","level","memory","function","return","const","value","object","string","number","length","index","error","callback","promise"};
static size_t fill(unsigned char *d, size_t n, int kind, const char *path) {
  size_t i = 0;
  if (kind == 0) { while (i < n) { const char *w = words[rnd() % 36]; size_t l = strlen(w); if (l > n - i) l = n - i; memcpy(d + i, w, l); i += l; if (i < n) d[i++] = rnd() % 11 ? ' ' : '\n'; } }
  else if (kind == 1) { while (i < n) { char row[160]; int l = snprintf(row, sizeof row, "{\"id\":%u,\"name\":\"user%u\",\"active\":%s,\"score\":%u.%u,\"tags\":[\"alpha\",\"beta\"]},", rnd() % 100000, rnd() % 5000, rnd() % 3 ? "true" : "false", rnd() % 1000, rnd() % 100); if ((size_t)l > n - i) l = n - i; memcpy(d + i, row, l); i += l; } }
  else if (kind == 2) { for (; i < n; i++) d[i] = rnd(); }
  else { FILE *f = fopen(path, "rb"); fseek(f, 1 << 20, SEEK_SET); n = fread(d, 1, n, f); fclose(f); }
  return n;
}
static size_t deflate_all(dnew mk, dfree fr, dstep st, int level, int wb, unsigned char *in, size_t n, unsigned char *out, size_t cap, size_t chunk) {
  void *h = mk(level, wb, 8, 0); size_t at = 0, o = 0, c, w; int s = 0;
  if (!chunk) { s = st(h, in, n, out, cap, 4, &c, &w); o = w; }
  else while (s != 1) { size_t len = n - at < chunk ? n - at : chunk; s = st(h, in + at, len, out + o, 16384 < cap - o ? 16384 : cap - o, at + len == n ? 4 : 0, &c, &w); at += c; o += w; }
  fr(h); return s == 1 ? o : 0;
}
static size_t inflate_all(inew mk, dfree fr, istep st, int wb, unsigned char *in, size_t n, unsigned char *out, size_t cap, size_t chunk) {
  void *h = mk(wb); size_t at = 0, o = 0, c, w; int s = 0; char m[64];
  if (!chunk) { s = st(h, in, n, out, cap, 4, &c, &w, m); o = w; }
  else while (s != 1 && s >= -5 && (s == 0 || s == -5)) { size_t len = n - at < chunk ? n - at : chunk; s = st(h, in + at, len, out, 16384, 0, &c, &w, m); at += c; o += w; if (s == -5 && at == n) break; }
  fr(h); return s == 1 ? o : 0;
}
static int cmp(const void *a, const void *b) { double x = *(double *)a, y = *(double *)b; return x < y ? -1 : x > y; }
int main(int argc, char **argv) {
  int rounds = argc > 2 ? atoi(argv[2]) : 5; const char *kinds[] = {"text", "json", "random", "binary"};
  printf("%-34s %9s %9s %6s\n", "case", "zlib MB/s", "silk MB/s", "silk/zlib");
  for (int kind = 0; kind < 4; kind++) {
    size_t n = kind == 3 ? 16u << 20 : 4u << 20; unsigned char *in = malloc(n); n = fill(in, n, kind, argv[1]);
    size_t cap = n + n / 8 + 1024; unsigned char *z = malloc(cap), *back = malloc(n + 1024);
    for (int format = 0; format < 2; format++) for (int li = 0; li < 3; li++) for (int op = 0; op < 2; op++) for (int mode = 0; mode < 2; mode++) {
      int level = (int[]){1, 6, 9}[li], wb = format ? -15 : 31; size_t chunk = mode ? 1024 : 0;
      size_t zl = deflate_all(zr_deflate_new, zr_deflate_free, zr_deflate, level, wb, in, n, z, cap, 0);
      double t[2][16];
      for (int r = 0; r < rounds; r++) for (int k = 0; k < 2; k++) {
        int silk = (k + r) & 1; double a = now(); size_t got;
        if (op == 0) got = silk ? deflate_all(SILK_DEFLATE_NEW, zs_deflate_free, zs_deflate, level, wb, in, n, z, cap, chunk) : deflate_all(zr_deflate_new, zr_deflate_free, zr_deflate, level, wb, in, n, z, cap, chunk);
        else got = silk ? inflate_all(zs_inflate_new, zs_inflate_free, zs_inflate, wb, z, zl, back, n + 1024, chunk) : inflate_all(zr_inflate_new, zr_inflate_free, zr_inflate, wb, z, zl, back, n + 1024, chunk);
        t[silk][r] = now() - a;
        if (!got || (op == 0 && !chunk && got != zl) || (op == 1 && got != n)) { printf("wrong result: %zu\n", got); return 1; }
      }
      qsort(t[0], rounds, sizeof(double), cmp); qsort(t[1], rounds, sizeof(double), cmp);
      double a = n / 1048576.0 / t[0][rounds / 2], b = n / 1048576.0 / t[1][rounds / 2];
      char name[64]; snprintf(name, sizeof name, "%s-%s-%d-%s-%s", op ? "inflate" : "deflate", format ? "raw" : "gzip", level, kinds[kind], mode ? "stream" : "oneshot");
      printf("%-34s %9.1f %9.1f %6.2f\n", name, a, b, b / a); fflush(stdout);
    }
    free(in); free(z); free(back);
  }
  return 0;
}
