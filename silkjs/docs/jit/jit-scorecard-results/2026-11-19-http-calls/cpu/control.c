#include <stdint.h>
#include <stdio.h>
#include <time.h>
static volatile uint64_t number = 42;
#define WORK(name)                                                                                 \
    __attribute__((noinline)) static void name(void) {                                             \
        uint64_t x = number;                                                                       \
        for (int i = 0; i < 25000; i++) {                                                          \
            x = x * 6364136223846793005ULL + 1;                                                    \
            asm volatile("" : "+r"(x));                                                            \
        }                                                                                          \
        number = x;                                                                                \
    }
WORK(hot_alpha) WORK(hot_beta) static long long ns(void) {
    struct timespec t;
    clock_gettime(CLOCK_THREAD_CPUTIME_ID, &t);
    return 1000000000LL * t.tv_sec + t.tv_nsec;
}
int main(void) {
    puts("ready");
    fflush(stdout);
    getchar();
    long long start = ns();
    while (ns() - start < 1200000000LL) {
        hot_alpha();
        hot_beta();
        hot_alpha();
        hot_alpha();
    }
    puts("done");
    fflush(stdout);
    getchar();
}
