// Differential fuzzer: the Silk decoder (zs_*) against zlib 1.3.1 (zr_*), call by call, on valid
// and damaged streams.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
void *zr_deflate_new(int, int, int, int); void zr_deflate_free(void *);
int zr_deflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *);
int zr_deflate_dictionary(void *, unsigned char *, size_t);
void *zs_inflate_new(int); void zs_inflate_free(void *); int zs_inflate_reset(void *); int zs_inflate_dictionary(void *, unsigned char *, size_t);
int zs_inflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *, char *);
void *zr_inflate_new(int); void zr_inflate_free(void *); int zr_inflate_reset(void *); int zr_inflate_dictionary(void *, unsigned char *, size_t);
int zr_inflate(void *, unsigned char *, size_t, unsigned char *, size_t, int, size_t *, size_t *, char *);

static uint64_t rs;
static uint64_t rnd(void) { rs ^= rs << 13; rs ^= rs >> 7; rs ^= rs << 17; return rs; }
static size_t below(size_t n) { return n ? rnd() % n : 0; }
static int verbose;
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
  switch (below(8)) { case 0: return 1 + below(8); case 1: return 1 + below(64); case 2: return 1 + below(700); case 3: return 16384; case 4: return 65536; case 5: return 1 + below(70000); case 6: return 257 + below(300); default: return 1 + below(5000); }
}
static size_t chunk(void) {
  switch (below(8)) { case 0: return 1 + below(4); case 1: return below(100); case 2: return below(3000); case 3: return below(40000); case 4: return 1000000; case 5: return 5 + below(4); default: return below(1000); }
}
// One member: compresses `n` bytes of `data` with zlib 1.3.1 into `out`; returns its length.
static size_t member(unsigned char *data, size_t n, unsigned char *out, size_t cap, int wb, unsigned char *dict, size_t dl) {
  int level = (int)below(11) - 1, strategy = below(3) ? 0 : (int)below(5), mem = below(3) ? 8 : 1 + (int)below(9);
  void *r = zr_deflate_new(level, wb, mem, strategy);
  if (dict) zr_deflate_dictionary(r, dict, dl);
  size_t at = 0, o = 0;
  for (;;) {
    size_t len = below(3) ? n - at : below(n - at + 1);
    int flush = at + len == n ? 4 : (int)below(4); size_t c, w;
    int s = zr_deflate(r, data + at, len, out + o, cap - o, flush, &c, &w);
    at += c; o += w;
    if (s == 1) break;
    if (s < 0 && s != -5) { printf("member failed %d\n", s); exit(2); }
  }
  zr_deflate_free(r);
  return o;
}
#define FAIL(...) do { printf("MISMATCH seed=%llu call=%d: ", (unsigned long long)seed, calls); printf(__VA_ARGS__); printf("\n"); return 1; } while (0)

static int one(uint64_t seed) {
  rs = seed * 0x9E3779B97F4A7C15ull + 1; rnd(); rnd();
  int calls = 0;
  size_t n = below(5) == 0 ? below(400000) : below(4) == 0 ? below(300) : below(60000);
  unsigned char *data = malloc(n + 1); generate(data, n, (int)below(6));
  int format = (int)below(3), bits = below(3) ? 15 : 9 + (int)below(7);
  int wb = format == 0 ? -bits : format == 1 ? bits : bits + 16;
  size_t dl = 0; unsigned char *dict = 0;
  if (format != 2 && below(4) == 0) { dl = 1 + (below(3) == 0 ? below(70000) : below(2000)); dict = malloc(dl); generate(dict, dl, (int)below(6)); }
  size_t cap = n + n / 8 + 100000, len = 0; unsigned char *z = malloc(cap * 3 + 64);
  // random junk before the stream, sometimes
  int members = format == 2 && below(4) == 0 ? 2 + (int)below(2) : 1;
  for (int m = 0; m < members; m++) len += member(data, m ? below(n + 1) : n, z + len, cap, wb, dict, dl);
  if (below(5) == 0) { size_t junk = 1 + below(40); for (size_t i = 0; i < junk; i++) z[len++] = below(3) ? rnd() : 0; }
  // damage
  int damage = (int)below(10);
  if (damage == 0 && len) { size_t k = 1 + below(4); while (k--) z[below(len)] ^= 1 << below(8); }
  else if (damage == 1 && len) { len = below(len); }
  else if (damage == 2 && len) { size_t p = below(len < 40 ? len : 40); z[p] = rnd(); }
  else if (damage == 3 && len) { size_t p = below(len); z[p] = rnd(); if (below(2) && p + 1 < len) z[p + 1] = rnd(); }
  else if (damage == 4) { len = below(64); for (size_t i = 0; i < len; i++) z[i] = rnd(); if (below(2) && len > 2) { z[0] = 0x78; z[1] = 0x9c; } if (below(4) == 0 && len > 3) { z[0] = 0x1f; z[1] = 0x8b; z[2] = 8; } }
  else if (damage == 5 && len > 20) { size_t p = len - 1 - below(12); z[p] ^= 1 + below(255); }
  // how the reader opens it
  int rwb = wb;
  switch (below(12)) {
    case 0: rwb = format == 0 ? wb : 32 + bits; break;                 // either
    case 1: rwb = format == 0 ? -15 : format == 1 ? 15 : 31; break;   // full window
    case 2: { int nb = 8 + (int)below(8); rwb = format == 0 ? -nb : format == 1 ? nb : nb + 16; break; } // another window
    case 3: rwb = format == 1 ? 0 : wb; break;                       // window of the header
    case 4: { int f2 = (int)below(4); rwb = f2 == 0 ? -15 : f2 == 1 ? 15 : f2 == 2 ? 31 : 47; break; } // another format
    case 5: rwb = format == 0 ? wb : 32; break;
    default: break;
  }
  if (rwb < 0 && rwb > -8) rwb = -8;
  void *s = zs_inflate_new(rwb), *r = zr_inflate_new(rwb);
  if (!s || !r) { if (!s && !r) { free(data); free(z); free(dict); return 0; } FAIL("init silk=%p ref=%p rwb=%d", s, r, rwb); }
  int useDict = dict && below(8) != 0; unsigned char *rd = dict; size_t rdl = dl;
  unsigned char *other = 0;
  if (dict && below(8) == 0) { other = malloc(dl); generate(other, dl, 0); rd = other; useDict = 1; }
  int raw = rwb < 0;
  if (useDict) { if (raw) { zs_inflate_dictionary(s, rd, rdl); zr_inflate_dictionary(r, rd, rdl); } else zs_inflate_dictionary(s, rd, rdl); }
  if (verbose) printf("seed=%llu n=%zu wb=%d rwb=%d len=%zu damage=%d dict=%zu use=%d members=%d\n", (unsigned long long)seed, n, wb, rwb, len, damage, dl, useDict, members);
  size_t ocap = 400000; unsigned char *os = malloc(ocap), *orr = malloc(ocap);
  size_t at = 0; int stall = 0;
  for (;;) {
    size_t take = chunk(); if (take > len - at) take = len - at;
    int flush = below(4) ? 0 : (below(2) ? 5 : (below(2) ? 2 : 4));
    if (at + take == len && below(2)) flush = 4;
    size_t oc = capacity(); if (oc > ocap) oc = ocap;
    size_t c1, w1, c2, w2; char m1[64], m2[64];
    int a = zs_inflate(s, z + at, take, os, oc, flush, &c1, &w1, m1);
    int b = zr_inflate(r, z + at, take, orr, oc, flush, &c2, &w2, m2); calls++;
    if (b == 2 && useDict && !raw) {
      // Node's binding: load the dictionary when zlib asks, and go on.
      int d = zr_inflate_dictionary(r, rd, rdl);
      if (d != 0) b = -3001;
      else { size_t c3, w3; b = zr_inflate(r, z + at + c2, take - c2, orr + w2, oc - w2, flush, &c3, &w3, m2); c2 += c3; w2 += w3; if (b == -5 && (c2 || w2) && flush != 4) b = 0; }
    }
    if (verbose) printf("  inflate take=%zu cap=%zu flush=%d -> silk %d c=%zu w=%zu '%s' | ref %d c=%zu w=%zu '%s'\n", take, oc, flush, a, c1, w1, m1, b, c2, w2, m2);
    if (a != b) FAIL("status silk=%d '%s' ref=%d '%s' (take=%zu cap=%zu flush=%d at=%zu len=%zu rwb=%d wb=%d damage=%d) silk c=%zu w=%zu ref c=%zu w=%zu", a, m1, b, m2, take, oc, flush, at, len, rwb, wb, damage, c1, w1, c2, w2);
    if (b < 0 && b != -5 || b == 2) { if (strcmp(m1, m2)) FAIL("message silk='%s' ref='%s'", m1, m2); break; }
    if (c1 != c2 || w1 != w2) FAIL("take=%zu cap=%zu flush=%d silk st=%d c=%zu w=%zu ref st=%d c=%zu w=%zu (at=%zu len=%zu rwb=%d wb=%d damage=%d)", take, oc, flush, a, c1, w1, b, c2, w2, at, len, rwb, wb, damage);
    if (memcmp(os, orr, w1)) { size_t i = 0; while (os[i] == orr[i]) i++; FAIL("bytes differ at %zu of %zu", i, w1); }
    at += c2;
    if (b == 1) {
      // Node: another gzip member follows unless the next byte is 0.
      if (at < len && z[at] != 0 && below(4)) { int x = zs_inflate_reset(s), y = zr_inflate_reset(r); if (x != y) FAIL("reset silk=%d ref=%d", x, y); if (useDict) { if (raw) { zs_inflate_dictionary(s, rd, rdl); zr_inflate_dictionary(r, rd, rdl); } else zs_inflate_dictionary(s, rd, rdl); } continue; }
      break;
    }
    if (c2 == 0 && w2 == 0) { if (++stall > 50) break; } else stall = 0;
    if (at == len && b == -5 && flush == 4) break;
  }
  zs_inflate_free(s); zr_inflate_free(r); free(data); free(z); free(os); free(orr); free(dict); free(other);
  return 0;
}
int main(int argc, char **argv) {
  uint64_t from = argc > 1 ? strtoull(argv[1], 0, 10) : 1, count = argc > 2 ? strtoull(argv[2], 0, 10) : 1000;
  verbose = argc > 3;
  int bad = 0;
  for (uint64_t seed = from; seed < from + count; seed++) { if (one(seed)) { if (++bad >= 8) break; } }
  printf("%s: seeds %llu..%llu, %d mismatching\n", bad ? "FAILED" : "ok", (unsigned long long)from, (unsigned long long)(from + count - 1), bad);
  return bad != 0;
}
