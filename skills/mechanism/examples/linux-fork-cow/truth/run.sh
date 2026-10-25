#!/usr/bin/env bash
# Records the truth logs for the linux-fork-cow figure from scratch.
# Usage: bash truth/run.sh [work-dir]   (Docker Desktop on the Linux 7.0.14 linuxkit arm64 VM)
# Builds the probe image if missing, runs cow_probe in a privileged container (PFNs need CAP_SYS_ADMIN)
# with its own ftrace instance, then copies the outputs into truth/ with the work dir replaced by <work>.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$(mktemp -d)}"
IMAGE=flowcast-linux-probe:trixie
mkdir -p "$WORK"
docker image inspect "$IMAGE" > /dev/null 2>&1 || docker build -t "$IMAGE" -f "$HERE/Dockerfile" "$HERE"
cp "$HERE/cow_probe.c" "$HERE/run-inner.sh" "$WORK/"
rm -rf "$WORK/out"
# --pid=host: set_ftrace_pid takes VM-global pids, and the probe writes its own pid there
docker run --rm --privileged --pid=host -v "$WORK":/work "$IMAGE" bash /work/run-inner.sh

for f in env.txt cow-probe.log cow-probe-split.log ftrace-main.txt ftrace-split.txt repeats.log; do
  sed -e "s#$WORK#<work>#g" -e "s#/work/out#<work>/out#g" "$WORK/out/$f" > "$HERE/$f"
done
echo "work dir: $WORK"
grep -E '^event' "$HERE/cow-probe.log"
