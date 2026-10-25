#!/usr/bin/env bash
# Runs inside flowcast-linux-probe:trixie (docker run --privileged). Called by truth/run.sh.
# Writes everything into /work/out. Uses its own ftrace instance and removes it at the end:
# tracefs is global to the VM and other people trace at the same time.
set -euo pipefail
OUT=/work/out
NAME=linux-syscall
mkdir -p "$OUT"
cd "$OUT"

# 0. What we ran on
{
  echo "uname -r: $(uname -r)"
  echo "uname -v: $(uname -v)"
  echo "uname -m: $(uname -m)"
  echo "nproc: $(nproc)"
  zcat /proc/config.gz | grep -E '^(CONFIG_UNMAP_KERNEL_AT_EL0|CONFIG_RANDOMIZE_KSTACK_OFFSET|CONFIG_COMPAT|CONFIG_FTRACE_SYSCALLS|CONFIG_ARM64_PTR_AUTH|CONFIG_ARM64_BTI|CONFIG_ARM64_MTE|CONFIG_RSEQ)=' || true
  zcat /proc/config.gz | grep -E '^# CONFIG_COMPAT is not set' || true
  echo "config lines mentioning RSEQ_SLICE_EXTENSION: $(zcat /proc/config.gz | grep -c RSEQ_SLICE_EXTENSION || true)"
  echo "meltdown: $(cat /sys/devices/system/cpu/vulnerabilities/meltdown)"
  echo "libc6: $(dpkg-query -W -f='${Version}' libc6)"
  echo "linux-libc-dev: $(dpkg-query -W -f='${Version}' linux-libc-dev)"
  echo "gcc: $(gcc -dumpfullversion)"
  echo "strace: $(strace -V | head -1)"
} > env.txt

# 1. Build and run the probe (plain)
gcc -O2 -Wall -o syscall-probe /work/syscall-probe.c
./syscall-probe > probe.txt

# 2. strace with syscall numbers (-n), default and raw constants
strace -n -o strace.txt ./syscall-probe > /dev/null
strace -n -X raw -o strace-raw.txt ./syscall-probe > /dev/null

# 3. ftrace: function tracer with stack traces + raw_syscalls events, our pid only
mountpoint -q /sys/kernel/tracing || mount -t tracefs nodev /sys/kernel/tracing
T=/sys/kernel/tracing/instances/$NAME
[ -d "$T" ] && rmdir "$T"
mkdir "$T"
cleanup() { echo 0 > "$T/tracing_on" 2>/dev/null || true; echo nop > "$T/current_tracer" 2>/dev/null || true; rmdir "$T" 2>/dev/null || true; }
trap cleanup EXIT
echo 4096 > "$T/buffer_size_kb"
echo 1 > "$T/tracing_on"   # nop tracer, no events: only trace_marker writes land here
rm -f go.fifo
mkfifo go.fifo
./syscall-probe "$T/trace_marker" < go.fifo > probe-traced.txt &
PROBE=$!
exec 3> go.fifo
# The probe writes "ready" and waits. Its global pid (the container has its own pid namespace) is in the trace.
GPID=""
for _ in $(seq 1 100); do
  GPID="$(grep -m1 'lx-syscall ready' "$T/trace" | sed -E 's/^ *[^ ]+-([0-9]+) .*/\1/' || true)"
  [ -n "$GPID" ] && break
  sleep 0.05
done
[ -n "$GPID" ] || { echo "probe pid not found in trace" >&2; exit 1; }
echo 0 > "$T/tracing_on"
echo "$GPID" > "$T/set_ftrace_pid"
echo "$GPID" > "$T/set_event_pid"
echo '__arm64_sys_getpid __arm64_sys_read ksys_read __arm64_sys_ni_syscall sys_ni_syscall __arm64_sys_rseq_slice_yield invoke_syscall.constprop.0 do_el0_svc' > "$T/set_ftrace_filter"
echo function > "$T/current_tracer"
echo 1 > "$T/options/func_stack_trace"
echo 1 > "$T/events/raw_syscalls/sys_enter/enable"
echo 1 > "$T/events/raw_syscalls/sys_exit/enable"
echo > "$T/trace"
echo 1 > "$T/tracing_on"
echo go >&3
exec 3>&-
wait "$PROBE"
echo 0 > "$T/tracing_on"
# keep the bracketed part only
awk '/lx-syscall begin/{on=1} on{print} /lx-syscall end/{exit}' "$T/trace" > ftrace.txt
cleanup
trap - EXIT

# 4. glibc wrappers: read (number goes x6 -> x8 inside glibc) and getpid
L=/lib/aarch64-linux-gnu/libc.so.6
objdump -T "$L" | grep -wE 'read|getpid' > glibc-symbols.txt
addr() { objdump -T "$L" | awk -v s="$1" '$NF==s {print $1; exit}'; }
size() { objdump -T "$L" | awk -v s="$1" '$NF==s {print $5; exit}'; }
dis() { objdump -d --no-show-raw-insn --start-address="0x$1" --stop-address="$(printf '0x%x' $((0x$1 + 0x$2)))" "$L" | grep -E '^ +[0-9a-f]+:'; }
{
  echo "## read (glibc $(dpkg-query -W -f='${Version}' libc6))"
  dis "$(addr read)" "$(size read)"
  echo "## getpid"
  dis "$(addr getpid)" "$(size getpid)"
} > glibc-wrappers.full.txt
# the read wrapper branches to an internal function without an exported symbol; follow it
TARGET="$(grep -m1 -E '\bb\s+[0-9a-f]+ ' glibc-wrappers.full.txt | awk '{print $3}')"
objdump -d --no-show-raw-insn --start-address="0x$(printf '%x' $((0x$TARGET - 0x90)))" --stop-address="0x$(printf '%x' $((0x$TARGET + 0x48)))" "$L" | grep -E '^ +[0-9a-f]+:' > glibc-cancel.full.txt
{
  echo "## read: number into x6, then branch to an internal function at 0x$TARGET"
  grep -E 'mov\s+x6, #0x3f|\bb\s+'"$TARGET" glibc-wrappers.full.txt
  echo "## internal (no symbol): number moved to x8, svc, then -4095..-1 becomes errno and -1"
  grep -E 'mov\s+x8, x6|svc\s+#0x0|cmn\s+x0, #0x1, lsl #12|b\.hi|neg\s+w3, w0|mov\s+x0, #0xffffffffffffffff|str\s+w3, \[x2, x1\]' glibc-cancel.full.txt
  echo "## getpid: textbook three instructions, no errno check"
  grep -E 'mov\s+x8, #0xac|svc\s+#0x0|\bret\b' glibc-wrappers.full.txt | tail -3
} > glibc-excerpt.txt

# 5. The EL0 64-bit synchronous vector, read from /proc/kcore, as offsets from `vectors`
V="$(awk '$3=="vectors" {print $1}' /proc/kallsyms)"
SYNC="$(awk '$3=="el0t_64_sync" {print $1}' /proc/kallsyms)"
gdb -q -batch -ex 'set pagination off' -ex "x/10i 0x$V+0x400" /dev/null /proc/kcore 2>/dev/null \
  | grep -E '^ +0x' \
  | python3 -c '
import re, sys
v, sync = int(sys.argv[1], 16), int(sys.argv[2], 16)
for line in sys.stdin:
    m = re.match(r"\s+0x([0-9a-f]+):\s+(.*)", line)
    a, insn = int(m.group(1), 16), m.group(2)
    insn = re.sub(r"0x([0-9a-f]{16})", lambda t: "el0t_64_sync" if int(t.group(1), 16) == sync else "vectors+0x%x" % (int(t.group(1), 16) - v), insn)
    print("vectors+0x%03x: %s" % (a - v, insn))
' "$V" "$SYNC" > vector-el0-sync.txt

# 6. Which entry and dispatch functions exist as symbols (inlined ones do not)
for s in vectors el0t_64_sync el0t_64_sync_handler el0_svc do_el0_svc el0_svc_common invoke_syscall invoke_syscall.constprop.0 __invoke_syscall do_ni_syscall sys_call_table __arm64_sys_getpid __arm64_sys_read ksys_read __arm64_sys_ni_syscall sys_ni_syscall __arm64_sys_rseq_slice_yield ret_to_user; do
  line="$(awk -v s="$s" '$3==s {print $2, $3; exit}' /proc/kallsyms)"
  echo "${line:-absent $s}"
done > kallsyms.txt
# syscalls left out of this config keep a weak stub (COND_SYSCALL) that returns -ENOSYS: type W
awk '$2=="W" && $3 ~ /^__arm64_sys_/ {print $3}' /proc/kallsyms | sort > weak-stubs.txt
echo "weak __arm64_sys_ stubs: $(wc -l < weak-stubs.txt)" >> kallsyms.txt
grep -E '^(invoke_syscall|do_el0_svc|__arm64_sys_getpid|__arm64_sys_read|ksys_read|__arm64_sys_ni_syscall|sys_ni_syscall|__arm64_sys_rseq_slice_yield)\b' /sys/kernel/tracing/available_filter_functions | sort > traceable.txt
echo "done"
