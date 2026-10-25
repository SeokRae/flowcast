// Synthetic probe for the linux-eevdf figure (flowcast:mechanism).
// One CPU-bound task: it names itself (comm), waits for SIGUSR1, then spins in user space
// for the given number of seconds. clock_gettime goes through the vDSO, so the loop never
// enters the kernel on its own; only the timer tick and the scheduler take the CPU away.
// Usage: spin <comm> <seconds>
#define _GNU_SOURCE
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/prctl.h>
#include <time.h>
#include <unistd.h>

static double now(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec + ts.tv_nsec / 1e9;
}

int main(int argc, char **argv) {
  if (argc != 3) return 2;
  prctl(PR_SET_NAME, argv[1]);
  sigset_t set;
  sigemptyset(&set);
  sigaddset(&set, SIGUSR1);
  sigprocmask(SIG_BLOCK, &set, NULL);
  printf("%s %d ready\n", argv[1], getpid());
  fflush(stdout);
  int sig;
  sigwait(&set, &sig);
  double end = now() + atof(argv[2]);
  volatile unsigned long spins = 0;
  while (now() < end)
    for (int i = 0; i < 1000; i++) spins++;
  printf("%s %d done\n", argv[1], getpid());
  return 0;
}
