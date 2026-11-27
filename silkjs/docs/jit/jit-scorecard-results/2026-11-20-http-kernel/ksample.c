// ksample PID PERIOD_NS: samples every thread of PID on the task clock, kernel and user, with
// the kernel call chain, until stdin closes. Prints one line per sample: "u" for a sample in
// user code, or "k" and the kernel addresses from the innermost frame outwards.
#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <linux/perf_event.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <unistd.h>

#define MAX 64
struct ring { int fd; struct perf_event_mmap_page *map; };
static struct ring rings[MAX];
static int count;
static uint64_t lost, throttled;

static void take(struct ring *r, uint64_t pos, void *out, size_t size) {
    size_t n = r->map->data_size, at = pos & (n - 1), first = n - at;
    char *data = (char *)r->map + r->map->data_offset;
    if (first > size) first = size;
    memcpy(out, data + at, first);
    if (first < size) memcpy((char *)out + first, data, size - first);
}
static void drain(struct ring *r) {
    uint64_t head = __atomic_load_n(&r->map->data_head, __ATOMIC_ACQUIRE), tail = r->map->data_tail;
    static uint64_t body[8192];
    while (tail < head) {
        struct perf_event_header h;
        take(r, tail, &h, sizeof h);
        if (h.size < sizeof h || h.size - sizeof h > sizeof body) { fprintf(stderr, "bad record\n"); exit(1); }
        take(r, tail + sizeof h, body, h.size - sizeof h);
        if (h.type == PERF_RECORD_SAMPLE) {
            // PERF_SAMPLE_IP | PERF_SAMPLE_CALLCHAIN: ip, nr, ips[nr]
            uint64_t nr = body[1];
            if ((h.misc & PERF_RECORD_MISC_CPUMODE_MASK) == PERF_RECORD_MISC_KERNEL) {
                fputs("k", stdout);
                for (uint64_t i = 0; i < nr; i++)
                    if (body[2 + i] < (uint64_t)-4096) printf(" %llx", (unsigned long long)body[2 + i]);
                fputs("\n", stdout);
            } else fputs("u\n", stdout);
        } else if (h.type == PERF_RECORD_LOST) lost += body[1];
        else if (h.type == PERF_RECORD_THROTTLE) throttled++;
        tail += h.size;
    }
    __atomic_store_n(&r->map->data_tail, tail, __ATOMIC_RELEASE);
}
int main(int argc, char **argv) {
    if (argc != 3) { fprintf(stderr, "usage: ksample PID PERIOD_NS\n"); return 2; }
    char path[64];
    snprintf(path, sizeof path, "/proc/%s/task", argv[1]);
    DIR *tasks = opendir(path);
    if (!tasks) { perror(path); return 1; }
    size_t length = 257 * sysconf(_SC_PAGESIZE);
    for (struct dirent *e; (e = readdir(tasks)) && count < MAX;) {
        if (e->d_name[0] == '.') continue;
        struct perf_event_attr a = {0};
        a.size = sizeof a;
        a.type = PERF_TYPE_SOFTWARE;
        a.config = PERF_COUNT_SW_TASK_CLOCK;
        a.sample_period = strtoull(argv[2], NULL, 10);
        a.sample_type = PERF_SAMPLE_IP | PERF_SAMPLE_CALLCHAIN;
        a.exclude_callchain_user = 1;
        a.exclude_hv = 1;
        a.disabled = 1;
        int fd = syscall(SYS_perf_event_open, &a, atoi(e->d_name), -1, -1, PERF_FLAG_FD_CLOEXEC);
        if (fd < 0) { perror("perf_event_open"); return 1; }
        void *map = mmap(NULL, length, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
        if (map == MAP_FAILED) { perror("mmap"); return 1; }
        rings[count].fd = fd;
        rings[count++].map = map;
    }
    closedir(tasks);
    for (int i = 0; i < count; i++) ioctl(rings[i].fd, PERF_EVENT_IOC_ENABLE, 0);
    fprintf(stderr, "sampling %d threads\n", count);
    struct pollfd in = {0, POLLIN | POLLHUP, 0};
    char byte;
    for (;;) {
        int ready = poll(&in, 1, 20);
        for (int i = 0; i < count; i++) drain(&rings[i]);
        if (ready > 0 && read(0, &byte, 1) <= 0) break;
    }
    for (int i = 0; i < count; i++) ioctl(rings[i].fd, PERF_EVENT_IOC_DISABLE, 0);
    for (int i = 0; i < count; i++) drain(&rings[i]);
    fprintf(stderr, "lost %llu throttled %llu\n", (unsigned long long)lost, (unsigned long long)throttled);
    return 0;
}
