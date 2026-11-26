/* Prints what a few libuv calls do, for tools/libuv_suite.py --diagnostic: linked once with real
 * libuv and once with the runtime's Silk exports, the two outputs are compared line by line.
 * Covers the cases where libuv's suite found the two apart on macOS. */
#include <uv.h>
#include <errno.h>
#include <signal.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <unistd.h>
#ifdef __APPLE__
#include <sys/event.h>
#endif

static void on_event(uv_fs_event_t *h, const char *name, int events, int status) { (void) h; (void) name; (void) events; (void) status; }
static void on_poll(uv_poll_t *h, int status, int events) { printf("poll_cb status=%d events=%d\n", status, events); uv_poll_stop(h); }
#ifdef __APPLE__
static char select_buffer[64];
static void on_alloc(uv_handle_t *h, size_t size, uv_buf_t *buf) { (void) h; (void) size; *buf = uv_buf_init(select_buffer, sizeof select_buffer); }
static void on_read(uv_stream_t *s, ssize_t nread, const uv_buf_t *buf) { (void) buf; printf("read_cb nread=%zd\n", nread); uv_read_stop(s); uv_close((uv_handle_t *) s, NULL); }
static void on_write(uv_write_t *req, int status) { printf("write_cb status=%d\n", status); uv_close((uv_handle_t *) req->handle, NULL); }
#endif

int uv_suite_diagnostic(void) {
  uv_loop_t *loop = uv_default_loop();
  char buf[1024];
  size_t len;
  int r;
  mkdir("diag_dir", 0777);
  const char *paths[] = { "diag_dir", "diag_dir/", "diag_dir//.", NULL };
  for (int i = 0; paths[i]; i++) {
    uv_fs_event_t ev;
    r = uv_fs_event_init(loop, &ev); printf("fs_event_init %d\n", r);
    len = sizeof buf; r = uv_fs_event_getpath(&ev, buf, &len); printf("getpath before start %d len=%zu\n", r, len);
    r = uv_fs_event_start(&ev, on_event, paths[i], 0); printf("fs_event_start(%s) %d active=%d\n", paths[i], r, uv_is_active((uv_handle_t *) &ev));
    len = 1; r = uv_fs_event_getpath(&ev, buf, &len); printf("getpath len1 %d len=%zu\n", r, len);
    len = sizeof buf; r = uv_fs_event_getpath(&ev, buf, &len); printf("getpath %d len=%zu %s\n", r, len, r == 0 ? buf : "-");
    printf("public path %s\n", ev.path ? ev.path : "(null)");
    r = uv_fs_event_stop(&ev); printf("fs_event_stop %d\n", r);
    uv_close((uv_handle_t *) &ev, NULL);
    uv_run(loop, UV_RUN_DEFAULT);
  }
  rmdir("diag_dir");
#ifdef __APPLE__
  {
    int kq = kqueue();
    struct stat st; fstat(kq, &st);
    printf("kqueue st_mode=%o\n", (unsigned) (st.st_mode & S_IFMT));
    uv_poll_t p;
    r = uv_poll_init(loop, &p, kq); printf("poll_init(kqueue) %d\n", r);
    if (r == 0) uv_close((uv_handle_t *) &p, NULL);
    uv_run(loop, UV_RUN_DEFAULT);
    close(kq);
  }
#endif
  {
    int sv[2];
    socketpair(AF_UNIX, SOCK_STREAM, 0, sv);
    uv_poll_t p;
    r = uv_poll_init(loop, &p, sv[0]); printf("poll_init(socket) %d\n", r);
    r = uv_poll_start(&p, UV_PRIORITIZED | UV_READABLE, on_poll); printf("poll_start(pri|read) %d\n", r);
    write(sv[1], "x", 1);
    uv_run(loop, UV_RUN_ONCE);
    uv_close((uv_handle_t *) &p, NULL);
    uv_run(loop, UV_RUN_DEFAULT);
    close(sv[0]); close(sv[1]);
  }
#ifdef __APPLE__
  /* kqueue refuses /dev/null (EINVAL): libuv watches such a pipe with a select() thread. */
  {
    uv_pipe_t in;
    int fd = open("/dev/null", O_RDONLY);
    r = uv_pipe_init(loop, &in, 0); printf("pipe_init %d\n", r);
    r = uv_pipe_open(&in, fd); printf("pipe_open(/dev/null, read) %d\n", r);
    r = uv_read_start((uv_stream_t *) &in, on_alloc, on_read); printf("read_start %d\n", r);
    r = uv_run(loop, UV_RUN_DEFAULT); printf("run %d\n", r);
  }
  {
    uv_pipe_t out;
    uv_write_t req;
    int fd = open("/dev/null", O_WRONLY);
    uv_buf_t buf = uv_buf_init("written", 7);
    r = uv_pipe_init(loop, &out, 0); printf("pipe_init %d\n", r);
    r = uv_pipe_open(&out, fd); printf("pipe_open(/dev/null, write) %d\n", r);
    r = uv_write(&req, (uv_stream_t *) &out, &buf, 1, on_write); printf("write %d\n", r);
    r = uv_run(loop, UV_RUN_DEFAULT); printf("run %d\n", r);
  }
#endif
  /* uv_loop_configure is variadic: its signal argument must arrive on every target. */
  {
    uv_loop_t other;
    uv_loop_init(&other);
    r = uv_loop_configure(&other, UV_LOOP_BLOCK_SIGNAL, SIGPROF); printf("configure(BLOCK_SIGNAL, SIGPROF) %d\n", r);
    r = uv_loop_configure(&other, UV_LOOP_BLOCK_SIGNAL, SIGINT); printf("configure(BLOCK_SIGNAL, SIGINT) %d\n", r);
    r = uv_loop_configure(&other, UV_LOOP_BLOCK_SIGNAL, 0); printf("configure(BLOCK_SIGNAL, 0) %d\n", r);
    r = uv_loop_configure(&other, UV_METRICS_IDLE_TIME); printf("configure(METRICS_IDLE_TIME) %d\n", r);
    r = uv_loop_close(&other); printf("other loop_close %d\n", r);
  }
  r = uv_loop_close(loop); printf("loop_close %d\n", r);
  fflush(stdout);
  return 0;
}
