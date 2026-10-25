#!/usr/bin/env bash
# Runs inside the flowcast-linux-probe container (privileged). Called by truth/run.sh; writes into /work/out.
# The kernel is shared with every other container on the VM, so this script only reads global settings,
# traces in its own ftrace instance filtered to the probe's pid, and removes the instance at the end.
set -euo pipefail
cd /work
OUT=/work/out
mkdir -p "$OUT"
gcc -O1 -Wall -o /tmp/pagewalk-probe pagewalk-probe.c

{
  echo "uname: $(uname -r -v -m)"
  echo "pagesize: $(getconf PAGESIZE)"
  zcat /proc/config.gz | grep -E '^CONFIG_(ARM64_4K_PAGES|ARM64_VA_BITS|PGTABLE_LEVELS|TRANSPARENT_HUGEPAGE|TRANSPARENT_HUGEPAGE_ALWAYS|ARM64_HW_AFDBM|ARM64_CONTPTE|PER_VMA_LOCK)='
  echo "thp enabled: $(cat /sys/kernel/mm/transparent_hugepage/enabled)"
  echo "thp use_zero_page: $(cat /sys/kernel/mm/transparent_hugepage/use_zero_page)"
  for d in /sys/kernel/mm/transparent_hugepage/hugepages-*kB; do
    [ -f "$d/enabled" ] && echo "thp $(basename "$d"): $(cat "$d/enabled")"
  done
  echo "gcc: $(gcc --version | head -1)"
} > "$OUT/config.txt"

T=/sys/kernel/tracing
[ -d "$T/instances" ] || mount -t tracefs nodev "$T"
I="$T/instances/linux-page-walk"
cleanup() {
  if [ -d "$I" ]; then
    echo 0 > "$I/tracing_on" || true
    echo nop > "$I/current_tracer" || true
    rmdir "$I" || true
  fi
}
trap cleanup EXIT
[ -d "$I" ] && rmdir "$I"
mkdir "$I"
echo 0 > "$I/tracing_on"
# Traceable functions on the fault path (do_page_fault and do_translation_fault sit in .kprobes.text and
# handle_pte_fault, do_anonymous_page, wp_page_copy are inlined, so they appear only in the stack traces).
echo 'handle_mm_fault __pud_alloc __pmd_alloc __pte_alloc do_wp_page vma_alloc_zeroed_movable_folio' > "$I/set_ftrace_filter"
echo 1 > "$I/options/func_stack_trace"
# The subshell writes its own pid into the filter and then execs the probe, which keeps that pid.
(
  echo "$BASHPID" > "$I/set_ftrace_pid"
  echo function > "$I/current_tracer"
  exec setarch -R /tmp/pagewalk-probe scenario "$I"
) > "$OUT/scenario.txt"
cp "$I/trace" "$OUT/ftrace-raw.txt"
cleanup
trap - EXIT

setarch -R /tmp/pagewalk-probe controls > "$OUT/controls.txt"
# perf's own minor-faults count over whole processes: touching 512 fresh pages adds about 512 faults to the
# baseline. Process start-up adds a few faults that vary per run, so each case runs five times.
for n in 0 512; do
  for r in 1 2 3 4 5; do
    perf stat -x, -e minor-faults,major-faults -o "$OUT/perf-touch-$n-$r.csv" setarch -R /tmp/pagewalk-probe touch "$n"
  done
done
