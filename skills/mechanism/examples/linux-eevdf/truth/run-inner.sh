#!/usr/bin/env bash
# Runs inside flowcast-linux-probe:trixie (docker run --privileged --pid=host), started by truth/run.sh.
# --pid=host makes /proc, set_event_pid, the trace and sched/debug all use the same (global) pids.
# Three CPU-bound tasks (nice 0, 1, 5) share one CPU. While they spin, this script records
#   sched_switch.txt  sched_switch events for their pids, from a private ftrace instance
#   proc-sched.txt    /proc/<pid>/sched of each task, sampled every SAMPLE_S seconds
#   debug-sched.txt   the probe CPU's part of /sys/kernel/debug/sched/debug at the same moments
#                     (only our container's cfs_rq block and the three task lines)
#   env.txt           kernel, config, scheduler features and tunables, read only
# Then a second set (nice 0 and 10) writes sched_switch-wide.txt and proc-sched-wide.txt.
# Nothing global is written: no sysctl, no top-level tracer. The instance is removed at exit.
set -euo pipefail
CPU="${CPU:-10}"
SPIN_S="${SPIN_S:-2.5}"
SAMPLE_S="${SAMPLE_S:-0.25}"
SAMPLES="${SAMPLES:-6}"
NAME=linux-eevdf
OUT=/work/out
rm -rf "$OUT"
mkdir -p "$OUT"

mountpoint -q /sys/kernel/debug || mount -t debugfs none /sys/kernel/debug
mountpoint -q /sys/kernel/tracing || mount -t tracefs none /sys/kernel/tracing
gcc -O2 -Wall -o /tmp/spin /work/spin.c

# Keep this shell and its samplers off the probe CPU.
others=""
for c in $(seq 0 $(($(nproc --all) - 1))); do
  [ "$c" -ne "$CPU" ] && others="$others${others:+,}$c"
done
taskset -pc "$others" $$ > /dev/null

{
  echo "== uname -r"; uname -r
  echo "== uname -v"; uname -v
  echo "== uname -m"; uname -m
  echo "== nproc --all"; nproc --all
  echo "== /sys/devices/system/cpu/online"; cat /sys/devices/system/cpu/online
  echo "== /proc/config.gz (selected)"
  zcat /proc/config.gz | grep -E '^(# )?CONFIG_(HZ|HZ_1000|PREEMPT|PREEMPT_LAZY|PREEMPT_DYNAMIC|SCHED_HRTICK|FAIR_GROUP_SCHED|CGROUP_SCHED|SCHED_AUTOGROUP|IRQ_TIME_ACCOUNTING|NO_HZ_IDLE|NO_HZ_FULL|SCHED_CLASS_EXT|SCHEDSTATS)[= ]'
  for f in features tunable_scaling base_slice_ns migration_cost_ns; do
    echo "== /sys/kernel/debug/sched/$f"; cat "/sys/kernel/debug/sched/$f"
  done
  echo "== /sys/fs/cgroup/cpu.weight"; cat /sys/fs/cgroup/cpu.weight
  echo "== /sys/fs/cgroup/cpu.max"; cat /sys/fs/cgroup/cpu.max
} > "$OUT/env.txt"

T="/sys/kernel/tracing/instances/$NAME"
[ -d "$T" ] && rmdir "$T"
mkdir "$T"
cleanup() {
  echo 0 > "$T/tracing_on" 2> /dev/null || true
  rmdir "$T" 2> /dev/null || true
}
trap cleanup EXIT
{
  echo "== $T/trace_clock"; cat "$T/trace_clock"
  echo "== $T/buffer_size_kb"; cat "$T/buffer_size_kb"
} >> "$OUT/env.txt"

GROUP="cfs_rq[$CPU]:/docker/$(hostname)"
snapshot() {
  awk -v cpu="cpu#$CPU" -v grp="$GROUP" -v pids=" $PIDS " '
    /^cpu#/ { on = ($1 == cpu) }
    !on { next }
    index($0, grp) == 1 { blk = 1 }
    blk && /^$/ { blk = 0 }
    blk { print; next }
    /^runnable tasks:/ { tasks = 1; print; next }
    tasks && (/^ S +task +PID / || /^---/) { print; next }
    tasks && index(pids, " " $3 " ") { print }
  ' /sys/kernel/debug/sched/debug
}

# probe <suffix> "<comm> <nice>"...: one task set on the probe CPU, traced from release to exit
probe() {
  local sfx="$1" spec outs=""
  shift
  PIDS=""
  for spec in "$@"; do
    set -- $spec
    taskset -c "$CPU" nice -n "$2" /tmp/spin "$1" "$SPIN_S" > "/tmp/$1.out" &
    PIDS="$PIDS${PIDS:+ }$!"
    outs="$outs /tmp/$1.out"
  done
  for f in $outs; do
    until grep -q ready "$f" 2> /dev/null; do sleep 0.01; done
  done
  echo > "$T/trace"
  echo "$PIDS" > "$T/set_event_pid"
  echo 1 > "$T/events/sched/sched_switch/enable"
  echo 1 > "$T/tracing_on"
  kill -USR1 $PIDS
  for i in $(seq 1 "$SAMPLES"); do
    sleep "$SAMPLE_S"
    for p in $PIDS; do
      echo "== sample $i pid $p"
      cat "/proc/$p/sched"
    done >> "$OUT/proc-sched$sfx.txt"
    if [ -z "$sfx" ]; then
      { echo "== sample $i"; snapshot; } >> "$OUT/debug-sched.txt"
    fi
  done
  wait
  echo 0 > "$T/tracing_on"
  cat "$T/trace" > "$OUT/sched_switch$sfx.txt"
  cat $outs >> "$OUT/tasks.txt"
  echo "pids$sfx: $PIDS"
}

# The figure's set: nice 0, 1 and 5.
probe "" "n0 0" "n1 1" "n5 5"
# A wide weight gap (nice 0 and 10): the heavy task is picked again at every tick after its slice.
probe "-wide" "w0 0" "w10 10"
