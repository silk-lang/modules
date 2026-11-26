#define _GNU_SOURCE
#include <errno.h>
#include <linux/perf_event.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <unistd.h>

struct perf_session {
    int fd;
    struct perf_event_mmap_page *map;
    size_t len;
    uint64_t lost, throttles, samples, mode[8];
};
struct point {
    uint64_t ip;
    uint32_t pid, tid;
    uint64_t time, period;
};
struct perf_session *open_perf(int tid, unsigned long period, int exclude_kernel) {
    struct perf_event_attr a = {};
    a.size = sizeof(a);
    a.type = PERF_TYPE_SOFTWARE;
    a.config = PERF_COUNT_SW_TASK_CLOCK;
    a.sample_period = period;
    a.sample_type = PERF_SAMPLE_IP | PERF_SAMPLE_TID | PERF_SAMPLE_TIME | PERF_SAMPLE_PERIOD;
    a.disabled = 1;
    a.exclude_kernel = exclude_kernel;
    a.exclude_hv = 1;
    a.read_format = PERF_FORMAT_TOTAL_TIME_ENABLED | PERF_FORMAT_TOTAL_TIME_RUNNING;
    int fd = syscall(SYS_perf_event_open, &a, tid, -1, -1, PERF_FLAG_FD_CLOEXEC);
    if (fd < 0)
        return NULL;
    size_t len = 129 * sysconf(_SC_PAGESIZE);
    void *map = mmap(NULL, len, PROT_READ | PROT_WRITE, MAP_SHARED, fd, 0);
    if (map == MAP_FAILED) {
        int e = errno;
        close(fd);
        errno = e;
        return NULL;
    }
    struct perf_session *p = calloc(1, sizeof(*p));
    if (!p) {
        int e = errno;
        munmap(map, len);
        close(fd);
        errno = e;
        return NULL;
    }
    p->fd = fd;
    p->map = map;
    p->len = len;
    return p;
}
int state_perf(struct perf_session *p, int on) {
    return ioctl(p->fd, on ? PERF_EVENT_IOC_ENABLE : PERF_EVENT_IOC_DISABLE, 0);
}
static void copy_ring(struct perf_session *p, uint64_t pos, void *out, size_t size) {
    size_t n = p->map->data_size, at = pos & (n - 1), first = n - at;
    if (first > size)
        first = size;
    char *ring = (char *)p->map + p->map->data_offset;
    memcpy(out, ring + at, first);
    if (first < size)
        memcpy((char *)out + first, ring, size - first);
}
int drain_perf(struct perf_session *p, struct point *out, int room) {
    struct perf_event_mmap_page *m = p->map;
    uint64_t head = __atomic_load_n(&m->data_head, __ATOMIC_ACQUIRE);
    uint64_t tail = m->data_tail;
    if (head - tail > m->data_size) {
        errno = EOVERFLOW;
        return -1;
    }
    int used = 0;
    while (tail < head && used < room) {
        struct perf_event_header h;
        copy_ring(p, tail, &h, sizeof h);
        if (h.size < sizeof h || h.size > head - tail) {
            errno = EPROTO;
            return -1;
        }
        if (h.type == PERF_RECORD_SAMPLE) {
            if (h.size != sizeof h + sizeof(struct point)) {
                errno = EPROTO;
                return -1;
            }
            copy_ring(p, tail + sizeof h, out + used, sizeof *out);
            p->samples++;
            p->mode[h.misc & 7]++;
            used++;
        }
        if (h.type == PERF_RECORD_LOST) {
            uint64_t lost;
            copy_ring(p, tail + sizeof h + 8, &lost, 8);
            p->lost += lost;
        }
        if (h.type == PERF_RECORD_THROTTLE)
            p->throttles++;
        tail += h.size;
    }
    __atomic_store_n(&m->data_tail, tail, __ATOMIC_RELEASE);
    return used;
}
int end_perf(struct perf_session *p, uint64_t result[14]) {
    if (read(p->fd, result, 24) != 24)
        return -1;
    result[3] = p->samples;
    result[4] = p->lost;
    result[5] = p->throttles;
    memcpy(result + 6, p->mode, sizeof p->mode);
    munmap(p->map, p->len);
    close(p->fd);
    free(p);
    return 0;
}
