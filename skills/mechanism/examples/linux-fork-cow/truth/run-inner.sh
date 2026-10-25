#!/usr/bin/env bash
# Runs inside the privileged probe container (see truth/run.sh). Writes into /work/out.
# Uses its own ftrace instance only, filtered by the probe's pid, and removes it at the end.
set -euo pipefail
OUT=/work/out
mkdir -p "$OUT"
T=/sys/kernel/tracing
[ -d "$T/instances" ] || mount -t tracefs nodev "$T"
I="$T/instances/linux-fork-cow"
cleanup() {
  if [ -d "$I" ]; then
    echo 0 > "$I/tracing_on" || true
    echo nop > "$I/current_tracer" || true
    rmdir "$I" || true
  fi
}
trap cleanup EXIT

gcc -O1 -Wall -Wextra -o /tmp/cow_probe /work/cow_probe.c

{
  uname -r -v -m
  echo "nproc $(nproc)"
  zcat /proc/config.gz | grep -E '^CONFIG_(ARM64_4K_PAGES|PGTABLE_LEVELS|TRANSPARENT_HUGEPAGE|PAGE_MAPCOUNT|KSM|LRU_GEN|LRU_GEN_ENABLED|ARM64_HW_AFDBM|USERFAULTFD|SWAP)=' || true
  zcat /proc/config.gz | grep -E '^# CONFIG_(USERFAULTFD|NO_PAGE_MAPCOUNT) ' || true
  echo "thp_enabled $(cat /sys/kernel/mm/transparent_hugepage/enabled)"
  for f in /sys/kernel/mm/transparent_hugepage/hugepages-*/enabled; do
    echo "thp_$(basename "$(dirname "$f")") $(cat "$f")"
  done
  echo "ksm_run $(cat /sys/kernel/mm/ksm/run)"
  echo "swap_total_kb $(awk '/^SwapTotal/ {print $2}' /proc/meminfo)"
  dpkg-query -W -f='${Package} ${Version}\n' gcc-14 libc6
} > "$OUT/env.txt"

setup_trace() {
  cleanup
  mkdir "$I"
  echo 0 > "$I/tracing_on"
  echo 'do_wp_page handle_mm_fault kernel_clone dup_mmap copy_page_range copy_user_highpage ptep_clear_flush folio_add_new_anon_rmap folio_add_lru_vma folio_add_lru folio_remove_rmap_ptes folio_move_anon_rmap lru_add_drain lru_add_drain_cpu folio_batch_move_lru' > "$I/set_ftrace_filter"
  echo 1 > "$I/options/function-fork"
  echo 4096 > "$I/buffer_size_kb"
  echo function > "$I/current_tracer"
  : > "$I/trace"
}

# 1. main run: first touch, fork and every write on CPU 3
setup_trace
/tmp/cow_probe -n 3 -a 3 -t "$I" > "$OUT/cow-probe.log"
cat "$I/trace" > "$OUT/ftrace-main.txt"

# 2. split run: first touch on CPU 3, then fork and every write on CPU 5
setup_trace
/tmp/cow_probe -n 3 -a 3 -b 5 -t "$I" > "$OUT/cow-probe-split.log"
cat "$I/trace" > "$OUT/ftrace-split.txt"
cleanup

# 3. repeats without tracing, to see which outcome is stable
: > "$OUT/repeats.log"
for i in 1 2 3 4 5; do
  echo "run main $i" >> "$OUT/repeats.log"
  /tmp/cow_probe -n 3 -a 3 >> "$OUT/repeats.log"
  echo "run split $i" >> "$OUT/repeats.log"
  /tmp/cow_probe -n 3 -a 3 -b 5 >> "$OUT/repeats.log"
done
echo "probe outputs: $OUT"
