// epoll_probe.c: poll() versus epoll on N pipes, two of them readable (pipes 2 and 5).
// Usage: epoll_probe N [trace_marker path] [scale]
//   N       number of pipes (read ends are watched)
//   marker  if given, a "phase NAME" line is written there before each phase,
//           so the ftrace instance's trace can be split per phase
//   scale   run only the poll phases and the first epoll round (for large N)
// Every pipe is O_NONBLOCK. epoll data.u32 is the pipe index.
#define _GNU_SOURCE
#include <fcntl.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/wait.h>
#include <unistd.h>

static int n;
static int (*p)[2];
static int marker = -1;
static const int READY[] = { 2, 5 };
#define K 2

static void die(const char *what) { perror(what); exit(1); }

static void phase(const char *name) {
  printf("== %s\n", name);
  fflush(stdout);
  if (marker >= 0 && dprintf(marker, "phase %s\n", name) < 0) die("trace_marker");
}

static void put(int i) { if (write(p[i][1], "x", 1) != 1) die("write"); }

static void drain(int i) {
  char buf[64];
  if (read(p[i][0], buf, sizeof buf) < 1) die("read");
}

// A child writes one byte into pipe i after 50 ms, while the parent sleeps in poll or epoll_wait.
static pid_t later_put(int i) {
  pid_t c = fork();
  if (c < 0) die("fork");
  if (c == 0) {
    usleep(50000);
    put(i);
    _exit(0);
  }
  return c;
}

static void reap(pid_t c) { if (waitpid(c, NULL, 0) != c) die("waitpid"); }

static void do_poll(struct pollfd *fds, int timeout) {
  int ret = poll(fds, n, timeout);
  if (ret < 0) die("poll");
  printf("poll(nfds=%d, timeout=%d) = %d revents:", n, timeout, ret);
  for (int i = 0; i < n; i++)
    if (fds[i].revents) printf(" [%d]=%s", i, fds[i].revents == POLLIN ? "POLLIN" : "other");
  printf("\n");
}

static void do_wait(int ep, int timeout) {
  struct epoll_event ev[16];
  int ret = epoll_wait(ep, ev, 16, timeout);
  if (ret < 0) die("epoll_wait");
  printf("epoll_wait(maxevents=16, timeout=%d) = %d events:", timeout, ret);
  for (int i = 0; i < ret; i++) printf(" [%u]=%s", ev[i].data.u32, ev[i].events == EPOLLIN ? "EPOLLIN" : "other");
  printf("\n");
}

static int make_epoll(unsigned flags) {
  int ep = epoll_create1(0);
  if (ep < 0) die("epoll_create1");
  for (int i = 0; i < n; i++) {
    struct epoll_event ev = { .events = EPOLLIN | flags, .data.u32 = (unsigned)i };
    if (epoll_ctl(ep, EPOLL_CTL_ADD, p[i][0], &ev) < 0) die("epoll_ctl");
  }
  printf("epoll_ctl(ADD) x%d, events=%s\n", n, flags & EPOLLET ? "EPOLLIN|EPOLLET" : "EPOLLIN");
  return ep;
}

int main(int argc, char **argv) {
  if (argc < 2) { fprintf(stderr, "usage: %s N [marker] [scale]\n", argv[0]); return 2; }
  n = atoi(argv[1]);
  if (argc > 2 && strcmp(argv[2], "-") != 0 && (marker = open(argv[2], O_WRONLY)) < 0) die("open marker");
  int scale = argc > 3 && strcmp(argv[3], "scale") == 0;
  if (n < 6) { fprintf(stderr, "N must be at least 6\n"); return 2; }
  p = calloc(n, sizeof *p);
  struct pollfd *fds = calloc(n, sizeof *fds);
  for (int i = 0; i < n; i++) {
    if (pipe2(p[i], O_NONBLOCK) < 0) die("pipe2");
    fds[i] = (struct pollfd){ .fd = p[i][0], .events = POLLIN };
  }
  printf("pid %d, %d pipes, readable: %d %d\n", getpid(), n, READY[0], READY[1]);

  // poll: the kernel asks every fd on every call
  phase("poll-ready");
  for (int j = 0; j < K; j++) put(READY[j]);
  do_poll(fds, -1);
  phase("poll-drain");
  for (int j = 0; j < K; j++) drain(READY[j]);
  phase("poll-block");
  pid_t c = later_put(READY[1]);
  do_poll(fds, -1);
  reap(c);
  drain(READY[1]);

  // epoll: register once (one wait-queue callback per fd), then only ready items are asked
  phase("epoll-ctl");
  int ep = make_epoll(0);
  phase("write");
  for (int j = 0; j < K; j++) put(READY[j]);
  phase("epoll-wait-1");
  do_wait(ep, -1);
  if (scale) { phase("end"); return 0; }

  // level-triggered: reported items go back on the ready list and are asked again next time
  phase("epoll-wait-2");
  do_wait(ep, 0);
  phase("drain");
  for (int j = 0; j < K; j++) drain(READY[j]);
  phase("epoll-wait-3");
  do_wait(ep, 0);
  phase("epoll-wait-4");
  do_wait(ep, 0);
  phase("epoll-block");
  c = later_put(READY[1]);
  do_wait(ep, -1);
  reap(c);
  drain(READY[1]);
  phase("epoll-wait-5");
  do_wait(ep, 0);
  close(ep);

  // edge-triggered: reported items are not put back
  phase("et-ctl");
  ep = make_epoll(EPOLLET);
  phase("et-write-1");
  put(READY[0]);
  phase("et-wait-1");
  do_wait(ep, 0);
  phase("et-wait-2");
  do_wait(ep, 0);
  phase("et-write-2");
  put(READY[0]);
  phase("et-wait-3");
  do_wait(ep, 0);
  phase("end");
  return 0;
}
