#!/usr/bin/env bash
# Records the truth logs for the linux-syscall figure on Linux 7.0.14 (Docker Desktop linuxkit, arm64).
# Usage: bash truth/run.sh [work-dir]   (docker on PATH; builds flowcast-linux-probe:trixie if missing)
# The probe runs in a privileged container (it needs tracefs and /proc/kcore), in its own ftrace instance.
# Outputs land in the work dir first, then the committed files in truth/ are replaced by this run's copies.
# Pids, timestamps and CPU numbers change on every run; numbers, return values and call stacks do not.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
IMAGE=flowcast-linux-probe:trixie
WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK"
WORK="$(cd "$WORK" && pwd)"
docker image inspect "$IMAGE" > /dev/null 2>&1 || docker build -t "$IMAGE" -f "$HERE/Dockerfile" "$HERE"
cp "$HERE/syscall-probe.c" "$HERE/run-inner.sh" "$WORK/"
rm -rf "$WORK/out"
docker run --rm --privileged -v "$WORK":/work "$IMAGE" bash /work/run-inner.sh
for f in env.txt probe.txt probe-traced.txt strace.txt strace-raw.txt ftrace.txt glibc-excerpt.txt vector-el0-sync.txt kallsyms.txt weak-stubs.txt traceable.txt; do
  sed -e "s#$WORK#<work>#g" -e 's#/work/out#<work>/out#g' "$WORK/out/$f" > "$HERE/$f"
done
echo "work dir: $WORK"
