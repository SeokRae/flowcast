#!/usr/bin/env bash
# Records the truth logs for the linux-eevdf figure on the Docker Desktop VM (Linux 7.0.14-linuxkit, arm64).
# Usage: bash truth/run.sh [work-dir]   (docker on PATH)
# Builds the probe image from truth/Dockerfile if it is missing, runs truth/run-inner.sh in a
# privileged container, and copies the logs into truth/ with the container id replaced by <container>.
# The committed logs are one such run. Timing values (run lengths, shares) differ per run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$(mktemp -d)}"
IMAGE=flowcast-linux-probe:trixie
mkdir -p "$WORK"
docker image inspect "$IMAGE" > /dev/null 2>&1 || docker build -t "$IMAGE" "$HERE"
cp "$HERE/spin.c" "$HERE/run-inner.sh" "$WORK/"
docker run --rm --privileged --pid=host -v "$WORK":/work "$IMAGE" bash /work/run-inner.sh
for f in env.txt tasks.txt proc-sched.txt debug-sched.txt sched_switch.txt proc-sched-wide.txt sched_switch-wide.txt; do
  sed -E 's#/docker/[0-9a-f]{12,64}#/docker/<container>#g' "$WORK/out/$f" > "$HERE/$f"
done
echo "work dir: $WORK"
wc -l "$HERE"/*.txt
