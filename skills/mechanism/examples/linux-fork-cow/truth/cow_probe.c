// cow_probe.c: fork and copy-on-write probe for the linux-fork-cow figure (flowcast:mechanism, synthetic).
// The parent maps NPAGES private anonymous pages, writes all of them, forks, and then the two
// processes take turns writing single pages. After every event the parent records, for both
// processes, the PFN of each page (/proc/<pid>/pagemap), the page's mapcount (/proc/kpagecount),
// its flags (/proc/kpageflags), the region's smaps counters and the minor faults of the write.
// Needs CAP_SYS_ADMIN (PFNs are zero otherwise). Run it inside the privileged probe container.
//
// usage: cow_probe [-n npages (default 3)] [-a fault_cpu] [-b run_cpu] [-t tracefs_instance_dir]
//   -a: CPU for the parent's first touch of the region (default 3)
//   -b: CPU for everything after the first touch: the fork and every write in both processes (default: same as -a)
//   -t: ftrace instance; the probe adds its own pid to set_ftrace_pid and writes phase markers
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <sched.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

#define PM_PFN_MASK ((1ULL << 55) - 1)
#define PM_SOFT_DIRTY (1ULL << 55)
#define PM_MMAP_EXCLUSIVE (1ULL << 56)
#define PM_PRESENT (1ULL << 63)
// include/uapi/linux/kernel-page-flags.h
#define KPF_LRU 5
#define KPF_ANON 12
#define KPF_THP 22
#define KPF_KSM 21

static long PAGE;
static int npages = 3;
static int fault_cpu = 3, run_cpu = -1;
static const char *tdir;
static int marker_fd = -1;
static char *region;
static pid_t parent_pid, child_pid;
static int to_child[2], from_child[2];

static void die(const char *what) { perror(what); exit(1); }

static void pin(int cpu) {
  cpu_set_t set;
  CPU_ZERO(&set);
  CPU_SET(cpu, &set);
  if (sched_setaffinity(0, sizeof set, &set)) die("sched_setaffinity");
}

static void write_file(const char *dir, const char *name, const char *text) {
  char path[512];
  snprintf(path, sizeof path, "%s/%s", dir, name);
  int fd = open(path, O_WRONLY);
  if (fd < 0) die(path);
  if (write(fd, text, strlen(text)) < 0) die(path);
  close(fd);
}

// One line into the ftrace instance, so the trace shows where each event starts and ends.
static void mark(const char *text) {
  if (marker_fd >= 0 && write(marker_fd, text, strlen(text)) < 0) die("trace_marker");
}

static long minflt_self(void) {
  struct rusage r;
  getrusage(RUSAGE_SELF, &r);
  return r.ru_minflt;
}

static long minflt_of(pid_t pid) {
  char path[64], buf[1024];
  snprintf(path, sizeof path, "/proc/%d/stat", pid);
  int fd = open(path, O_RDONLY);
  if (fd < 0) die(path);
  ssize_t n = read(fd, buf, sizeof buf - 1);
  close(fd);
  if (n <= 0) die("stat");
  buf[n] = 0;
  // field 10 (minflt) comes 8 fields after the ")" that closes comm
  char *p = strrchr(buf, ')');
  long v = 0;
  for (int field = 2; p && field <= 10; field++) {
    p = strchr(p + 1, ' ');
    if (field == 9 && p) v = strtol(p + 1, NULL, 10);
  }
  return v;
}

static uint64_t read_u64(const char *path, off_t index) {
  int fd = open(path, O_RDONLY);
  if (fd < 0) die(path);
  uint64_t v = 0;
  if (pread(fd, &v, sizeof v, index * 8) != (ssize_t)sizeof v) die(path);
  close(fd);
  return v;
}

static void pages_of(const char *who, pid_t pid) {
  char path[64];
  snprintf(path, sizeof path, "/proc/%d/pagemap", pid);
  for (int i = 0; i < npages; i++) {
    uint64_t e = read_u64(path, ((uintptr_t)region + i * PAGE) / PAGE);
    uint64_t pfn = e & PM_PFN_MASK;
    printf("page %s %d present=%d pfn=0x%llx exclusive=%d soft_dirty=%d", who, i, !!(e & PM_PRESENT),
           (unsigned long long)pfn, !!(e & PM_MMAP_EXCLUSIVE), !!(e & PM_SOFT_DIRTY));
    if ((e & PM_PRESENT) && pfn) {
      uint64_t count = read_u64("/proc/kpagecount", pfn);
      uint64_t flags = read_u64("/proc/kpageflags", pfn);
      printf(" kpagecount=%llu anon=%d lru=%d thp=%d ksm=%d", (unsigned long long)count, (int)(flags >> KPF_ANON & 1),
             (int)(flags >> KPF_LRU & 1), (int)(flags >> KPF_THP & 1), (int)(flags >> KPF_KSM & 1));
    }
    printf("\n");
  }
}

// The smaps block of the probe region, one "smaps <who> Key=value kB" line per field.
static void smaps_of(const char *who, pid_t pid) {
  char path[64], line[512], head[32];
  snprintf(path, sizeof path, "/proc/%d/smaps", pid);
  snprintf(head, sizeof head, "%lx-", (unsigned long)(uintptr_t)region);
  FILE *f = fopen(path, "r");
  if (!f) die(path);
  int in = 0;
  while (fgets(line, sizeof line, f)) {
    // a VMA header starts with its hex start address; field lines start with a capitalised key
    int vma_line = (line[0] >= '0' && line[0] <= '9') || (line[0] >= 'a' && line[0] <= 'f');
    if (strncmp(line, head, strlen(head)) == 0) { in = 1; continue; }
    if (in && vma_line) break;
    if (!in) continue;
    const char *keys[] = {"Rss:", "Pss:", "Shared_Clean:", "Shared_Dirty:", "Private_Clean:", "Private_Dirty:",
                          "Anonymous:", "AnonHugePages:", "THPeligible:", "VmFlags:"};
    for (size_t k = 0; k < sizeof keys / sizeof keys[0]; k++) {
      if (strncmp(line, keys[k], strlen(keys[k])) == 0) {
        char *v = line + strlen(keys[k]);
        while (*v == ' ') v++;
        v[strcspn(v, "\n")] = 0;
        printf("smaps %s %.*s %s\n", who, (int)strlen(keys[k]) - 1, keys[k], v);
      }
    }
  }
  fclose(f);
}

static void values_of_parent(void) {
  printf("bytes parent");
  for (int i = 0; i < npages; i++) printf(" %02x", (unsigned char)region[i * PAGE]);
  printf("\n");
}

static void snapshot(const char *label) {
  printf("state %s\n", label);
  pages_of("parent", parent_pid);
  if (child_pid) pages_of("child", child_pid);
  smaps_of("parent", parent_pid);
  if (child_pid) smaps_of("child", child_pid);
  values_of_parent();
  printf("minflt parent=%ld", minflt_of(parent_pid));
  if (child_pid) printf(" child=%ld", minflt_of(child_pid));
  printf("\n");
  fflush(stdout);
}

// The measured store: nothing else that could fault runs between the two getrusage calls
// (the stack and the marker strings were touched before, see warm()).
static long store(int page, unsigned char value, const char *who) {
  char text[96];
  snprintf(text, sizeof text, "cow_probe: begin %s write page %d", who, page);
  mark(text);
  long before = minflt_self();
  region[page * PAGE] = value;
  long after = minflt_self();
  snprintf(text, sizeof text, "cow_probe: end %s write page %d", who, page);
  mark(text);
  return after - before;
}

// After fork every private writable page of both processes is write-protected, the stack too.
// Touch the stack and the marker path once, so later brackets only see the probe region.
static void warm(const char *who) {
  volatile char pad[64 * 1024];
  memset((char *)pad, 0, sizeof pad);
  char text[96];
  snprintf(text, sizeof text, "cow_probe: warm %s", who);
  mark(text);
  (void)minflt_self();
}

static void child_loop(void) {
  warm("child");
  unsigned char cmd[3];
  for (;;) {
    if (read(to_child[0], cmd, 3) != 3) _exit(2);
    if (cmd[0] == 'q') _exit(0);
    long delta = 0;
    unsigned char got[64];
    if (cmd[0] == 'w') delta = store(cmd[1], cmd[2], "child");
    for (int i = 0; i < npages; i++) got[i] = region[i * PAGE];
    int cpu = sched_getcpu();
    if (write(from_child[1], &delta, sizeof delta) < 0 || write(from_child[1], &cpu, sizeof cpu) < 0 ||
        write(from_child[1], got, npages) < 0)
      _exit(3);
  }
}

// Every write after the fork stores a value that names its writer and its turn:
// 0xa0 | turn for the parent, 0xc0 | turn for the child (turn 1..5). The first touch stores 0x10 | page.
static int turn;

static void child_does(int page, const char *label) {
  unsigned char value = 0xc0 | ++turn;
  unsigned char cmd[3] = {'w', (unsigned char)page, value};
  long delta;
  int cpu;
  unsigned char got[64];
  if (write(to_child[1], cmd, 3) != 3) die("pipe");
  if (read(from_child[0], &delta, sizeof delta) != sizeof delta || read(from_child[0], &cpu, sizeof cpu) != sizeof cpu ||
      read(from_child[0], got, npages) != npages)
    die("pipe");
  printf("event child write page=%d value=%02x minflt_delta=%ld cpu=%d\n", page, value, delta, cpu);
  printf("bytes child");
  for (int i = 0; i < npages; i++) printf(" %02x", got[i]);
  printf("\n");
  snapshot(label);
}

static void parent_does(int page, const char *label) {
  unsigned char value = 0xa0 | ++turn;
  long delta = store(page, value, "parent");
  printf("event parent write page=%d value=%02x minflt_delta=%ld cpu=%d\n", page, value, delta, sched_getcpu());
  snapshot(label);
}

int main(int argc, char **argv) {
  int opt;
  while ((opt = getopt(argc, argv, "n:a:b:t:")) != -1) {
    if (opt == 'n') npages = atoi(optarg);
    else if (opt == 'a') fault_cpu = atoi(optarg);
    else if (opt == 'b') run_cpu = atoi(optarg);
    else if (opt == 't') tdir = optarg;
    else return 64;
  }
  if (run_cpu < 0) run_cpu = fault_cpu;
  if (npages < 2 || npages > 64) return 64;
  setvbuf(stdout, NULL, _IOFBF, 1 << 16);
  PAGE = sysconf(_SC_PAGESIZE);
  parent_pid = getpid();
  pin(fault_cpu);

  if (tdir) {
    char pid[32];
    snprintf(pid, sizeof pid, "%d\n", parent_pid);
    write_file(tdir, "set_ftrace_pid", pid);
    char path[512];
    snprintf(path, sizeof path, "%s/trace_marker", tdir);
    marker_fd = open(path, O_WRONLY);
    if (marker_fd < 0) die(path);
    write_file(tdir, "tracing_on", "1");
  }

  printf("probe npages=%d page_size=%ld fault_cpu=%d run_cpu=%d trace=%s\n", npages, PAGE, fault_cpu, run_cpu,
         tdir ? "on" : "off");
  region = mmap(NULL, npages * PAGE, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (region == MAP_FAILED) die("mmap");
  // THP is [always] on this kernel: without this the region could be backed by a large folio
  if (madvise(region, npages * PAGE, MADV_NOHUGEPAGE)) die("madvise");
  printf("region start=0x%lx bytes=%ld madvise=MADV_NOHUGEPAGE\n", (unsigned long)(uintptr_t)region, npages * PAGE);

  mark("cow_probe: begin first touch");
  long before = minflt_self();
  for (int i = 0; i < npages; i++) region[i * PAGE] = 0x10 | i;
  long after = minflt_self();
  mark("cow_probe: end first touch");
  printf("event parent first touch pages=%d minflt_delta=%ld cpu=%d\n", npages, after - before, sched_getcpu());
  // With -b, leave fault_cpu now: the new pages stay in that CPU's LRU add batch, which only it drains
  if (run_cpu != fault_cpu) pin(run_cpu);
  snapshot("entry");

  if (pipe(to_child) || pipe(from_child)) die("pipe");
  fflush(stdout);
  mark("cow_probe: begin fork");
  child_pid = fork();
  if (child_pid < 0) die("fork");
  if (child_pid == 0) {
    child_loop();
  }
  mark("cow_probe: end fork");
  warm("parent");
  printf("event fork child=%d cpu=%d\n", child_pid, sched_getcpu());
  snapshot("fork");

  child_does(0, "child-write-0");
  parent_does(0, "parent-write-0");
  parent_does(1, "parent-write-1");
  child_does(1, "child-write-1");
  child_does(0, "child-write-0-again");

  unsigned char quit[3] = {'q', 0, 0};
  if (write(to_child[1], quit, 3) != 3) die("pipe");
  int status;
  waitpid(child_pid, &status, 0);
  if (tdir) write_file(tdir, "tracing_on", "0");
  printf("done child_status=%d\n", WEXITSTATUS(status));
  return 0;
}
