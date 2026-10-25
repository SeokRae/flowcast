// syscall-probe.c: system calls on Linux 7.0.14 (arm64), through glibc and through a raw `svc #0`.
// Synthetic probe for the flowcast:mechanism linux-syscall figure. Build: gcc -O2 -o syscall-probe syscall-probe.c
//
// Usage: syscall-probe [marker]
//   marker: path to an ftrace trace_marker. The probe writes "lx-syscall ready" there, waits for one byte
//   on stdin (so the caller can read its global pid from the trace and set pid filters), then brackets the
//   four figure calls (and slot 471) with "lx-syscall begin" and "lx-syscall end".
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

// arm64 Linux ABI: number in x8, arguments in x0..x5, result in x0. No libc in between.
static long raw3(long nr, long a0, long a1, long a2) {
  register long x8 __asm__("x8") = nr;
  register long x0 __asm__("x0") = a0;
  register long x1 __asm__("x1") = a1;
  register long x2 __asm__("x2") = a2;
  __asm__ volatile("svc #0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2) : "memory");
  return x0;
}

static const char *errname(long v) {
  switch (v) {
    case -EBADF: return "EBADF";
    case -ENOSYS: return "ENOSYS";
    default: return "";
  }
}

static int marker = -1;
static void mark(const char *s) {
  if (marker >= 0) write(marker, s, strlen(s));
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  char buf[16];

  // 1. Numbers as the userspace headers (linux-libc-dev) define them
  printf("SYS_openat %d\n", SYS_openat);
  printf("SYS_close %d\n", SYS_close);
  printf("SYS_read %d\n", SYS_read);
  printf("SYS_write %d\n", SYS_write);
  printf("SYS_exit_group %d\n", SYS_exit_group);
  printf("SYS_clock_gettime %d\n", SYS_clock_gettime);
  printf("SYS_getpid %d\n", SYS_getpid);
#ifdef SYS_mseal
  printf("SYS_mseal %d\n", SYS_mseal);
#endif
#ifdef SYS_rseq_slice_yield
  printf("SYS_rseq_slice_yield %d\n", SYS_rseq_slice_yield);
#else
  printf("SYS_rseq_slice_yield (not in these headers)\n");
#endif

  // 2. The four calls the figure steps through, raw svc only, bracketed for ftrace
  if (argc > 1) {
    marker = open(argv[1], O_WRONLY);
    mark("lx-syscall ready");
    char go;
    if (read(0, &go, 1) != 1) return 2;
    mark("lx-syscall begin");
  }
  long pid = raw3(SYS_getpid, 0, 0, 0);
  long rd = raw3(SYS_read, 99, (long)buf, 8);
  long gap = raw3(244, 0, 0, 0);
  long out = raw3(472, 0, 0, 0);
  long last = raw3(471, 0, 0, 0); // the last table slot, for the boundary (not in the figure)
  mark("lx-syscall end");
  printf("raw svc x8=%d -> x0=%ld\n", SYS_getpid, pid);
  printf("raw svc x8=%d x0=99 x2=8 -> x0=%ld %s\n", SYS_read, rd, errname(rd));
  printf("raw svc x8=244 -> x0=%ld %s\n", gap, errname(gap));
  printf("raw svc x8=472 -> x0=%ld %s\n", out, errname(out));
  printf("raw svc x8=471 -> x0=%ld %s\n", last, errname(last));

  // 3. The same through glibc: the wrapper turns -errno into -1 and sets errno
  printf("glibc getpid() = %ld (same as raw: %s)\n", (long)getpid(), getpid() == pid ? "yes" : "no");
  errno = 0;
  long r = read(99, buf, 8);
  printf("glibc read(99, buf, 8) = %ld errno %d %s\n", r, errno, errno == EBADF ? "EBADF" : "");
  errno = 0;
  r = syscall(244);
  printf("glibc syscall(244) = %ld errno %d %s\n", r, errno, errno == ENOSYS ? "ENOSYS" : "");

  // 4. A successful file round trip through glibc (numbers show in strace)
  int fd = open("/tmp/lx-syscall.txt", O_WRONLY | O_CREAT | O_TRUNC, 0600);
  write(fd, "hello\n", 6);
  close(fd);
  fd = open("/tmp/lx-syscall.txt", O_RDONLY);
  long n = read(fd, buf, sizeof buf);
  int c = close(fd);
  printf("glibc open = %d, read = %ld, close = %d\n", fd, n, c);
  unlink("/tmp/lx-syscall.txt");

  // 5. clock_gettime through glibc goes to the vDSO; the raw svc enters the kernel
  struct timespec ts;
  int g = clock_gettime(CLOCK_MONOTONIC, &ts);
  long k = raw3(SYS_clock_gettime, CLOCK_MONOTONIC, (long)&ts, 0);
  printf("glibc clock_gettime = %d, raw svc x8=%d -> x0=%ld\n", g, SYS_clock_gettime, k);
  return 0;
}
