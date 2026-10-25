#!/usr/bin/env bash
# Runs inside flowcast-linux-probe:trixie (docker run --privileged --pid=host). Reads /work/*.c and /work/count.py, writes /work/out/.
# Uses its own ftrace instance (instances/linux-epoll) filtered by pid, never the top-level tracer, and removes it at the end.
set -euo pipefail
T=/sys/kernel/tracing
mountpoint -q "$T" || mount -t tracefs nodev "$T"
I="$T/instances/linux-epoll"
OUT=/work/out
mkdir -p "$OUT"
gcc -O2 -Wall -Wextra -o /tmp/epoll_probe /work/epoll_probe.c

# Traceable symbols. ep_insert, ep_poll, do_poll and do_pollfd are not separate symbols on this build (inlined),
# so their work shows up under the caller: do_epoll_ctl, do_epoll_wait, do_sys_poll.
FUNCS="pipe_poll __pollwait pollwake ep_ptable_queue_proc ep_poll_callback ep_autoremove_wake_function ep_send_events ep_item_poll.isra.0 ep_start_scan ep_done_scan do_sys_poll do_epoll_ctl do_epoll_wait anon_pipe_write anon_pipe_read"
{
  uname -srvm
  echo "nproc $(nproc)"
  echo "# names in /proc/kallsyms (addresses dropped)"
  for f in ep_insert ep_poll do_poll do_pollfd vfs_poll $FUNCS; do
    if awk -v f="$f" '$3 == f { found = 1 } END { exit !found }' /proc/kallsyms; then echo "kallsyms $f yes"; else echo "kallsyms $f no"; fi
  done
} > "$OUT/env.txt"

cleanup() {
  if [ -d "$I" ]; then
    echo 0 > "$I/tracing_on" || true
    echo nop > "$I/current_tracer" || true
    rmdir "$I" || true
  fi
}
trap cleanup EXIT

# trace_run NAME N [scale]
trace_run() {
  cleanup
  mkdir "$I"
  echo 0 > "$I/tracing_on"
  echo 16384 > "$I/buffer_size_kb"
  echo "$FUNCS" > "$I/set_ftrace_filter"
  echo 1 > "$I/options/function-fork"
  echo function > "$I/current_tracer"
  # The shell writes its own pid into the filter and then execs the probe, so the probe keeps that pid.
  # function-fork adds the forked writer child. One CPU keeps the trace in one ring.
  bash -c "echo \$\$ > '$I/set_ftrace_pid'; echo 1 > '$I/tracing_on'; exec taskset -c 3 /tmp/epoll_probe $2 '$I/trace_marker' ${3:-}" > "$OUT/$1.stdout"
  echo 0 > "$I/tracing_on"
  sort "$I/set_ftrace_filter" > "$OUT/$1.filter"
  cat "$I/trace" > "$OUT/$1.trace"
  cleanup
}

trace_run ftrace-n8 8
trace_run ftrace-n1024 1024 scale
python3 /work/count.py "$OUT/ftrace-n8.trace" "$OUT/ftrace-n1024.trace" > "$OUT/ftrace-counts.txt"

# Return values and revents from the syscall side (no tracing). On arm64 glibc's poll() is ppoll and epoll_wait() is epoll_pwait.
strace -f -qq -o "$OUT/strace-n8.txt" -e trace=pipe2,ppoll,epoll_create1,epoll_ctl,epoll_pwait,read,write,clone,wait4 \
  /tmp/epoll_probe 8 - > "$OUT/strace-n8.stdout"
echo "done"
