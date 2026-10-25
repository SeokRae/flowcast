// pagewalk-probe.c: truth probe for the linux-page-walk figure (Linux 7.0.14 linuxkit, arm64, 4K pages)
// Build: gcc -O1 -Wall -o pagewalk-probe pagewalk-probe.c
// Run privileged (pagemap PFNs and /proc/kpageflags need CAP_SYS_ADMIN), under setarch -R for a fixed layout.
//   pagewalk-probe scenario [tracefs-instance-dir]   the four accesses the figure replays, one line each
//   pagewalk-probe controls                          512-page runs: faults per touch, zero page sharing, THP on
//   pagewalk-probe touch N                           write-touch N fresh pages and exit (for perf stat totals)
#define _GNU_SOURCE
#include <fcntl.h>
#include <linux/perf_event.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

#define PAGE 4096UL
#define MIB2 (2UL << 20)
#define OFF 0x0a8UL // byte offset the scenario touches inside each page
#define P1 256      // p1 sits 256 pages after p0, so their level 3 entries are 0 and 256 (far apart in the figure)

static int pm_fd = -1, kpf_fd = -1, perf_fd = -1, mark_fd = -1, on_fd = -1;

static uint64_t pagemap(const void *va) {
  uint64_t e = 0;
  if (pread(pm_fd, &e, 8, ((uintptr_t)va / PAGE) * 8) != 8) e = ~0ULL;
  return e;
}
static int present(uint64_t e) { return (int)(e >> 63) & 1; }
static uint64_t pfn(uint64_t e) { return e & ((1ULL << 55) - 1); }
static uint64_t kflags(uint64_t f) {
  uint64_t v = 0;
  if (kpf_fd < 0 || pread(kpf_fd, &v, 8, f * 8) != 8) v = ~0ULL;
  return v;
}
static uint64_t perf_minflt(void) {
  uint64_t v = 0;
  if (read(perf_fd, &v, 8) != 8) v = ~0ULL;
  return v;
}
static long rusage_minflt(void) {
  struct rusage r;
  getrusage(RUSAGE_SELF, &r);
  return r.ru_minflt;
}
static char statbuf[4096];
static long stat_minflt(void) { // field 10 of /proc/self/stat
  int fd = open("/proc/self/stat", O_RDONLY);
  ssize_t n = read(fd, statbuf, sizeof statbuf - 1);
  close(fd);
  if (n <= 0) return -1;
  statbuf[n] = 0;
  char *p = strrchr(statbuf, ')'); // comm may hold spaces; fields restart after ')'
  long v = -1;
  int field = 2;
  for (char *t = strtok(p + 2, " "); t; t = strtok(NULL, " ")) {
    if (++field == 10) { v = atol(t); break; }
  }
  return v;
}
static void mark(const char *s) {
  if (mark_fd >= 0 && write(mark_fd, s, strlen(s)) < 0) perror("trace_marker");
}
static void tracing(int on) {
  if (on_fd >= 0 && write(on_fd, on ? "1" : "0", 1) < 0) perror("tracing_on");
}

static void open_counters(void) {
  pm_fd = open("/proc/self/pagemap", O_RDONLY);
  kpf_fd = open("/proc/kpageflags", O_RDONLY);
  struct perf_event_attr a;
  memset(&a, 0, sizeof a);
  a.type = PERF_TYPE_SOFTWARE;
  a.size = sizeof a;
  a.config = PERF_COUNT_SW_PAGE_FAULTS_MIN; // the event perf calls minor-faults
  a.exclude_hv = 1;
  perf_fd = (int)syscall(SYS_perf_event_open, &a, 0, -1, -1, 0);
  if (pm_fd < 0 || perf_fd < 0) { perror("open counters"); exit(1); }
}

// Reserve 4 MiB with PROT_NONE and map `len` bytes at its first 2 MiB boundary. Nothing else lives in that
// 2 MiB region, so the process has no level 3 table for it until the first fault there.
static char *fresh_region(size_t len, int nohuge) {
  char *r = mmap(NULL, 2 * MIB2, PROT_NONE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_NORESERVE, -1, 0);
  if (r == MAP_FAILED) { perror("reserve"); exit(1); }
  char *base = (char *)(((uintptr_t)r + MIB2 - 1) & ~(MIB2 - 1));
  char *m = mmap(base, len, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED, -1, 0);
  if (m != base) { perror("map"); exit(1); }
  if (nohuge && madvise(m, len, MADV_NOHUGEPAGE)) { perror("madvise"); exit(1); }
  return m;
}

static void print_maps(const char *lo, const char *hi) {
  FILE *f = fopen("/proc/self/maps", "r");
  char line[512];
  while (fgets(line, sizeof line, f)) {
    unsigned long a, b;
    if (sscanf(line, "%lx-%lx", &a, &b) == 2 && b > (uintptr_t)lo - MIB2 && a < (uintptr_t)hi + MIB2) printf("maps %s", line);
  }
  fclose(f);
}

static void split(const char *tag, uintptr_t va) {
  printf("split %s va 0x%012lx l0 %lu l1 %lu l2 %lu l3 %lu offset 0x%03lx\n", tag, (unsigned long)va,
         (unsigned long)(va >> 39) & 511, (unsigned long)(va >> 30) & 511, (unsigned long)(va >> 21) & 511,
         (unsigned long)(va >> 12) & 511, (unsigned long)va & 4095);
}

struct sample { uint64_t pm; uint64_t perf; long ru, st; };
static struct sample sample(const void *va) {
  struct sample s;
  s.st = stat_minflt();
  s.ru = rusage_minflt();
  s.pm = pagemap(va);
  s.perf = perf_minflt();
  return s;
}

static void report(int n, const char *op, const char *page, const volatile char *va, struct sample b, struct sample a) {
  printf("access %d %s %s va 0x%012lx | before present %d pfn 0x%lx | after present %d pfn 0x%lx kpageflags 0x%lx zero_page %d anon %d"
         " | minor-faults perf %lu rusage %ld stat %ld\n",
         n, op, page, (unsigned long)(uintptr_t)va, present(b.pm), (unsigned long)pfn(b.pm), present(a.pm), (unsigned long)pfn(a.pm),
         (unsigned long)kflags(pfn(a.pm)), (int)(kflags(pfn(a.pm)) >> 24) & 1, (int)(kflags(pfn(a.pm)) >> 12) & 1,
         (unsigned long)(a.perf - b.perf), a.ru - b.ru, a.st - b.st);
}

static void scenario(const char *inst) {
  char path[512];
  if (inst) {
    snprintf(path, sizeof path, "%s/trace_marker", inst);
    mark_fd = open(path, O_WRONLY);
    snprintf(path, sizeof path, "%s/tracing_on", inst);
    on_fd = open(path, O_WRONLY);
  }
  char *buf = fresh_region((P1 + 1) * PAGE, 1);
  char *page1 = buf + P1 * PAGE;
  volatile char *p0 = buf + OFF, *p1 = page1 + OFF;
  printf("pagesize %ld\n", sysconf(_SC_PAGESIZE));
  print_maps(buf, buf + (P1 + 1) * PAGE);
  split("p0", (uintptr_t)p0);
  split("p1", (uintptr_t)p1);
  struct sample b, a;
  volatile char sink;
  sample(buf); // warm every path once (stat buffer, counters) before measuring
  tracing(1);
  mark("access 1 read p0");
  b = sample(buf); sink = *p0; a = sample(buf);
  report(1, "read", "p0", p0, b, a);
  mark("access 2 write p0");
  b = sample(buf); *p0 = 1; a = sample(buf);
  report(2, "write", "p0", p0, b, a);
  mark("access 3 write p1");
  b = sample(page1); *p1 = 1; a = sample(page1);
  report(3, "write", "p1", p1, b, a);
  mark("access 4 read p1");
  b = sample(page1); sink = *p1; a = sample(page1);
  report(4, "read", "p1", p1, b, a);
  mark("done");
  tracing(0);
  (void)sink;
}

// Global THP fault counters from /proc/vmstat (other processes on the VM can add to them too).
static long vmstat(const char *key) {
  FILE *f = fopen("/proc/vmstat", "r");
  char k[128];
  long v, out = -1;
  while (fscanf(f, "%127s %ld", k, &v) == 2)
    if (!strcmp(k, key)) out = v;
  fclose(f);
  return out;
}

// Touch every page of a 2 MiB region and count minor faults with the perf counter.
static void run512(const char *tag, int nohuge, int read_first) {
  long alloc0 = vmstat("thp_fault_alloc"), fallback0 = vmstat("thp_fault_fallback");
  char *m = fresh_region(MIB2, nohuge);
  volatile char sink = 0;
  uint64_t f0 = perf_minflt();
  if (read_first)
    for (unsigned long i = 0; i < MIB2; i += PAGE) sink += ((volatile char *)m)[i];
  uint64_t f1 = perf_minflt();
  for (unsigned long i = 0; i < MIB2; i += PAGE) ((volatile char *)m)[i] = 1;
  uint64_t f2 = perf_minflt();
  // distinct PFNs and how many are the shared zero page, after the writes
  uint64_t first = pfn(pagemap(m)), contiguous = 1;
  unsigned long zero = 0, thp = 0;
  for (unsigned long i = 0; i < MIB2; i += PAGE) {
    uint64_t e = pagemap(m + i), k = kflags(pfn(e));
    if (pfn(e) != first + i / PAGE) contiguous = 0;
    zero += (k >> 24) & 1;
    thp += (k >> 22) & 1;
  }
  printf("control %s nohugepage %d pages %lu | read faults %lu | write faults %lu | pfn contiguous %lu | zero_page %lu | thp %lu"
         " | vmstat thp_fault_alloc +%ld thp_fault_fallback +%ld\n", tag, nohuge, MIB2 / PAGE, (unsigned long)(f1 - f0),
         (unsigned long)(f2 - f1), (unsigned long)contiguous, zero, thp, vmstat("thp_fault_alloc") - alloc0,
         vmstat("thp_fault_fallback") - fallback0);
  (void)sink;
}

static void read_only_sharing(void) {
  char *m = fresh_region(MIB2, 1);
  volatile char sink = 0;
  uint64_t f0 = perf_minflt();
  for (unsigned long i = 0; i < MIB2; i += PAGE) sink += ((volatile char *)m)[i];
  uint64_t f1 = perf_minflt();
  uint64_t z = pfn(pagemap(m));
  unsigned long same = 0, zero = 0;
  for (unsigned long i = 0; i < MIB2; i += PAGE) {
    uint64_t e = pagemap(m + i);
    same += pfn(e) == z;
    zero += (kflags(pfn(e)) >> 24) & 1;
  }
  printf("control read-only nohugepage 1 pages %lu | read faults %lu | same pfn 0x%lx on %lu pages | zero_page %lu\n", MIB2 / PAGE,
         (unsigned long)(f1 - f0), (unsigned long)z, same, zero);
  (void)sink;
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  if (argc > 2 && !strcmp(argv[1], "touch")) { // no counters: perf stat measures this whole process
    long n = atol(argv[2]);
    // map at least one page even for n = 0, so both runs execute the same code and touch the same text pages
    char *m = fresh_region((size_t)(n > 0 ? n : 1) * PAGE, 1);
    for (long i = 0; i < n; i++) ((volatile char *)m)[i * PAGE] = 1;
    return 0;
  }
  open_counters();
  if (argc > 1 && !strcmp(argv[1], "scenario")) scenario(argc > 2 ? argv[2] : NULL);
  else if (argc > 1 && !strcmp(argv[1], "controls")) {
    run512("write-only", 1, 0);
    run512("read-then-write", 1, 1);
    read_only_sharing();
    run512("thp-default", 0, 0);
  } else {
    fprintf(stderr, "usage: %s scenario [tracefs-instance] | controls | touch N\n", argv[0]);
    return 2;
  }
  return 0;
}
