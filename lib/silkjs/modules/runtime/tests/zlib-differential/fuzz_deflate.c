// Differential fuzzer: the Silk encoder (zs_*) against zlib 1.3.1 (zr_*), call by call.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#ifndef SILK_DEFLATE_NEW
#define SILK_DEFLATE_NEW zs_deflate_new
#endif
void *SILK_DEFLATE_NEW(int, int, int, int); void zs_deflate_free(void *);
int zs_deflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *);
void zs_deflate_reset(void *); int zs_deflate_params(void *, int, int); int zs_deflate_dictionary(void *, unsigned char *, size_t);
void *zr_deflate_new(int, int, int, int); void zr_deflate_free(void *);
int zr_deflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *);
void zr_deflate_reset(void *); int zr_deflate_params(void *, int, int, unsigned char *, size_t, size_t *); int zr_deflate_dictionary(void *, unsigned char *, size_t);

static uint64_t rs;
static uint64_t rnd(void) { rs ^= rs << 13; rs ^= rs >> 7; rs ^= rs << 17; return rs; }
static size_t below(size_t n) { return n ? rnd() % n : 0; }
static int verbose; static FILE *ds, *dr;

static const char *words[] = {"the ","function ","return ","const ","{\"id\":","\"name\":\"","value","},\n","  ","0123456789","silk","deflate ","aaaaaaaa","\n","if (","error","abc","xyzzy "};
static void generate(unsigned char *d, size_t n, int kind) {
  size_t i = 0;
  while (i < n) {
    int k = kind == 5 ? (int)below(5) : kind;
    size_t run = 1 + below(kind == 5 ? 3000 : 400);
    if (run > n - i) run = n - i;
    if (k == 0) { for (size_t j = 0; j < run; j++) d[i + j] = rnd(); }
    else if (k == 1) { size_t j = 0; while (j < run) { const char *w = words[below(18)]; size_t l = strlen(w); if (l > run - j) l = run - j; memcpy(d + i + j, w, l); j += l; } }
    else if (k == 2) { unsigned char b = rnd(); memset(d + i, b, run); }
    else if (k == 3) { for (size_t j = 0; j < run; j++) d[i + j] = "ab"[below(2)]; }
    else { if (i == 0) { for (size_t j = 0; j < run; j++) d[j] = rnd() & 15; } else { size_t back = 1 + below(i < 40000 ? i : 40000); for (size_t j = 0; j < run; j++) d[i + j] = d[i + j - back]; } }
    i += run;
  }
}
static size_t capacity(void) {
  switch (below(8)) { case 0: return 1 + below(8); case 1: return 1 + below(64); case 2: return 1 + below(700); case 3: return 16384; case 4: return 65536; case 5: return 1 + below(70000); case 6: return 1 + below(300000); default: return 1 + below(5000); }
}
static size_t chunk(void) {
  switch (below(7)) { case 0: return below(4); case 1: return below(100); case 2: return below(3000); case 3: return below(40000); case 4: return below(200000); case 5: return 65536; default: return below(1000); }
}
#define FAIL(...) do { printf("MISMATCH seed=%llu call=%d: ", (unsigned long long)seed, calls); printf(__VA_ARGS__); printf("\n"); return 1; } while (0)

static int one(uint64_t seed) {
  rs = seed * 0x9E3779B97F4A7C15ull + 1; rnd(); rnd();
  int level = (int)below(11) - 1, strategy = below(3) ? 0 : (int)below(5), mem = below(3) ? 8 : 1 + (int)below(9);
  int format = (int)below(3), bits = below(3) ? 15 : 9 + (int)below(7);
  if (format == 1 && below(8) == 0) bits = 8;
  int wb = format == 0 ? -bits : format == 1 ? bits : bits + 16;
  int calls = 0;
  size_t n = below(4) == 0 ? below(600000) : below(4) == 0 ? below(300) : below(90000);
  unsigned char *data = malloc(n + 1); generate(data, n, (int)below(6));
  void *s = SILK_DEFLATE_NEW(level < 0 ? 6 : level, wb, mem, strategy), *r = zr_deflate_new(level, wb, mem, strategy);
  if (!s || !r) FAIL("init silk=%p ref=%p level=%d wb=%d mem=%d strategy=%d", s, r, level, wb, mem, strategy);
  if (verbose) printf("seed=%llu level=%d wb=%d mem=%d strategy=%d n=%zu\n", (unsigned long long)seed, level, wb, mem, strategy, n);
  size_t cap0 = 400000; unsigned char *os = malloc(cap0), *orr = malloc(cap0);
  int streams = 1 + (below(4) == 0 ? (int)below(3) : 0);
  for (int stream = 0; stream < streams; stream++) {
    if (stream) { zs_deflate_reset(s); zr_deflate_reset(r); if (below(2)) generate(data, n, (int)below(6)); }
    if (format != 2 && below(4) == 0) {
      size_t dl = below(3) == 0 ? below(70000) : below(2000); unsigned char *dict = malloc(dl + 1); generate(dict, dl, (int)below(6));
      int a = zs_deflate_dictionary(s, dict, dl), b = zr_deflate_dictionary(r, dict, dl); free(dict);
      if ((a == 0) != (b == 0)) FAIL("dictionary silk=%d ref=%d", a, b);
      if (verbose) printf("  dictionary %zu\n", dl);
    }
    size_t at = 0; int ended = 0, stall = 0;
    while (!ended) {
      // Node's params(): only after a complete flush, or before the first write, or with the same kind of level.
      if (below(12) == 0) {
        int nl = (int)below(10), ns = below(2) ? strategy : (int)below(5);
        // complete a sync flush first
        int fl = 2 + (int)below(2);
        for (int guard = 0; guard < 100000; guard++) {
          size_t cap = capacity(); if (cap > cap0) cap = cap0; size_t c1, w1, c2, w2;
          int a = zs_deflate(s, data + at, 0, os, cap, fl, &c1, &w1), b = zr_deflate(r, data + at, 0, orr, cap, fl, &c2, &w2); calls++;
          if (verbose) printf("  preflush cap=%zu -> silk %d c=%zu w=%zu | ref %d c=%zu w=%zu\n", cap, a, c1, w1, b, c2, w2);
          if (ds) { fwrite(os, 1, w1, ds); fwrite(orr, 1, w2, dr); }
          if (c1 != c2 || w1 != w2 || memcmp(os, orr, w1)) FAIL("preflush cap=%zu silk c=%zu w=%zu ref c=%zu w=%zu st=%d", cap, c1, w1, c2, w2, b);
          if (w2 < cap) break;
        }
        size_t w; int a = zs_deflate_params(s, nl, ns), b = zr_deflate_params(r, nl, ns, orr, cap0, &w);
        if (verbose) printf("  params level=%d strategy=%d -> silk %d ref %d w=%zu\n", nl, ns, a, b, w);
        if (w != 0) FAIL("params wrote %zu", w);
        if (b == 0 || b == -5) { level = nl; strategy = ns; }
      }
      size_t len = chunk(); if (len > n - at) len = n - at;
      int flush = below(3) ? 0 : (int)below(6); if (flush == 4 && at + len < n && below(3)) flush = 0;
      if (at + len == n && below(3) == 0) flush = 4;
      if (flush == 4) len = n - at;
      size_t cap = capacity(); if (cap > cap0) cap = cap0; size_t c1, w1, c2, w2;
      int a = zs_deflate(s, data + at, len, os, cap, flush, &c1, &w1), b = zr_deflate(r, data + at, len, orr, cap, flush, &c2, &w2); calls++;
      if (verbose) printf("  deflate len=%zu cap=%zu flush=%d -> silk %d c=%zu w=%zu | ref %d c=%zu w=%zu\n", len, cap, flush, a, c1, w1, b, c2, w2);
      if (ds) { fwrite(os, 1, w1, ds); fwrite(orr, 1, w2, dr); fflush(ds); fflush(dr); }
      if (c1 != c2 || w1 != w2) FAIL("len=%zu cap=%zu flush=%d silk st=%d c=%zu w=%zu ref st=%d c=%zu w=%zu (level=%d wb=%d mem=%d strategy=%d at=%zu n=%zu)", len, cap, flush, a, c1, w1, b, c2, w2, level, wb, mem, strategy, at, n);
      if (memcmp(os, orr, w1)) { size_t i = 0; while (os[i] == orr[i]) i++; FAIL("bytes differ at %zu of %zu: silk %02x ref %02x (len=%zu cap=%zu flush=%d level=%d wb=%d mem=%d strategy=%d at=%zu n=%zu)", i, w1, os[i], orr[i], len, cap, flush, level, wb, mem, strategy, at, n); }
      if ((a == 1) != (b == 1)) FAIL("status silk=%d ref=%d flush=%d", a, b, flush);
      if (a == -2) FAIL("silk failed, ref=%d", b);
      at += c2;
      if (b == 1) ended = 1;
      if (flush == 4 && b != 1) {
        // finish: keep calling with Z_FINISH
        for (int guard = 0; guard < 1000000 && !ended; guard++) {
          size_t rest = n - at;
          cap = capacity(); if (cap > cap0) cap = cap0;
          a = zs_deflate(s, data + at, rest, os, cap, 4, &c1, &w1); b = zr_deflate(r, data + at, rest, orr, cap, 4, &c2, &w2); calls++;
          if (verbose) printf("  finish rest=%zu cap=%zu -> silk %d c=%zu w=%zu | ref %d c=%zu w=%zu\n", rest, cap, a, c1, w1, b, c2, w2);
          if (b == -5 && rest == 0) continue;
          if (c1 != c2 || w1 != w2 || memcmp(os, orr, w1)) FAIL("finish rest=%zu cap=%zu silk st=%d c=%zu w=%zu ref st=%d c=%zu w=%zu (level=%d wb=%d mem=%d strategy=%d)", rest, cap, a, c1, w1, b, c2, w2, level, wb, mem, strategy);
          if ((a == 1) != (b == 1)) FAIL("finish status silk=%d ref=%d", a, b);
          if (b == -5 || b == -2) FAIL("ref status %d in finish", b);
          at += c2; if (b == 1) ended = 1;
        }
        if (!ended) FAIL("finish did not end");
      }
      if (c2 == 0 && w2 == 0) { if (++stall > 2000) { ended = 1; } } else stall = 0;
    }
  }
  zs_deflate_free(s); zr_deflate_free(r); free(data); free(os); free(orr);
  return 0;
}
int main(int argc, char **argv) {
  uint64_t from = argc > 1 ? strtoull(argv[1], 0, 10) : 1, count = argc > 2 ? strtoull(argv[2], 0, 10) : 1000;
  verbose = argc > 3; if (argc > 4) { ds = fopen("silk.bin", "wb"); dr = fopen("ref.bin", "wb"); }
  int bad = 0;
  for (uint64_t seed = from; seed < from + count; seed++) { if (one(seed)) { if (++bad >= 5) break; } }
  printf("%s: seeds %llu..%llu, %d mismatching\n", bad ? "FAILED" : "ok", (unsigned long long)from, (unsigned long long)(from + count - 1), bad);
  return bad != 0;
}
