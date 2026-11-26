// CRC-32 throughput: the standard library's (zs_crc32) and zlib 1.3.1's, in turns.
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <stdint.h>
unsigned zs_crc32(unsigned, unsigned char *, size_t);
unsigned long crc32(unsigned long, const unsigned char *, unsigned);
static double now(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return t.tv_sec + t.tv_nsec / 1e9; }
int main(void) {
  size_t sizes[] = {64, 1024, 16384, 1 << 20, 16 << 20};
  unsigned char *d = malloc(16 << 20); for (size_t i = 0; i < (16u << 20); i++) d[i] = i * 2654435761u >> 13;
  for (int k = 0; k < 5; k++) {
    size_t n = sizes[k], reps = (256u << 20) / n; double best[2] = {1e9, 1e9}; unsigned r[2];
    for (int round = 0; round < 3; round++) for (int who = 0; who < 2; who++) {
      double a = now(); unsigned c = 0;
      for (size_t i = 0; i < reps; i++) c = who ? zs_crc32(c, d, n) : (unsigned)crc32(c, d, n);
      double t = now() - a; if (t < best[who]) best[who] = t; r[who] = c;
    }
    printf("%9zu bytes: zlib %8.0f MB/s  silk %8.0f MB/s  %s\n", n, n * (double)reps / 1048576 / best[0], n * (double)reps / 1048576 / best[1], r[0] == r[1] ? "same" : "DIFFERENT");
  }
  return 0;
}
