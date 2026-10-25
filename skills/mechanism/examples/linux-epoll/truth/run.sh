#!/usr/bin/env bash
# Records the truth logs for the linux-epoll figure from scratch.
# Usage: bash truth/run.sh [work-dir]   (Docker Desktop on the Linux 7.0.14 linuxkit arm64 VM)
# Builds the probe image if missing, runs the probe in a privileged container with its own ftrace instance,
# then copies the outputs into truth/ with the work dir replaced by <work>.
# The raw N=1024 trace stays in the work dir (about 670 KB); its per-phase counts are committed in ftrace-counts.txt.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$(mktemp -d)}"
IMAGE=flowcast-linux-probe:trixie
mkdir -p "$WORK"
docker image inspect "$IMAGE" > /dev/null 2>&1 || docker build -t "$IMAGE" -f "$HERE/Dockerfile" "$HERE"
cp "$HERE/epoll_probe.c" "$HERE/count.py" "$HERE/run-inner.sh" "$WORK/"
rm -rf "$WORK/out"
# --pid=host: set_ftrace_pid takes VM-global pids, and the probe writes its own pid there
docker run --rm --privileged --pid=host -v "$WORK":/work "$IMAGE" bash /work/run-inner.sh

for f in env.txt ftrace-n8.trace ftrace-n8.stdout ftrace-n8.filter ftrace-n1024.stdout ftrace-counts.txt strace-n8.txt strace-n8.stdout; do
  sed -e "s#$WORK#<work>#g" -e "s#/work/out#<work>/out#g" "$WORK/out/$f" > "$HERE/$f"
done
echo "work dir: $WORK"
grep -E '^(poll|epoll_wait)' "$HERE/ftrace-n8.stdout"
