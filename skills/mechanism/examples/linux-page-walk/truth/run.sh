#!/usr/bin/env bash
# Records the truth logs for the linux-page-walk figure from scratch.
# Usage: bash truth/run.sh [work-dir]   (Docker Desktop on arm64; the kernel under test is its VM kernel)
# Builds the probe image if it is missing, runs truth/run-inner.sh in a privileged container, and copies
# the outputs here. --pid=host makes the probe's pid the kernel's own pid, which set_ftrace_pid expects
# (inside a container pid namespace the number the shell sees is not the one ftrace filters on).
# Committed files are one run; addresses come from setarch -R, PFNs and fault totals can differ per run.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$(mktemp -d)}"
IMAGE=flowcast-linux-probe:trixie
mkdir -p "$WORK"
if ! docker image inspect "$IMAGE" > /dev/null 2>&1; then
  docker build -t "$IMAGE" -f "$HERE/Dockerfile" "$HERE"
fi
cp "$HERE/pagewalk-probe.c" "$HERE/run-inner.sh" "$WORK/"
rm -rf "$WORK/out"
docker run --rm --privileged --pid=host -v "$WORK":/work "$IMAGE" bash /work/run-inner.sh

OUT="$WORK/out"
cp "$OUT/config.txt" "$OUT/scenario.txt" "$OUT/controls.txt" "$HERE/"
# ftrace: keep the header and the probe's own lines (the instance is pid-filtered, this is a second guard)
PID="$(awk '/tracing_mark_write: access 1/ { split($1, a, "-"); print a[length(a)]; exit }' "$OUT/ftrace-raw.txt")"
awk -v pid="$PID" '/^#/ || index($0, "-" pid " ") || /^ +=> / ' "$OUT/ftrace-raw.txt" > "$HERE/ftrace.txt"
{
  for n in 0 512; do
    for r in 1 2 3 4 5; do
      echo "## perf stat -x, -e minor-faults,major-faults setarch -R pagewalk-probe touch $n (run $r)"
      grep -v '^# started on' "$OUT/perf-touch-$n-$r.csv" | grep -v '^$'
    done
  done
} > "$HERE/perf-touch.txt"
sed -i.bak "s#$WORK#<work>#g" "$HERE"/*.txt && rm -f "$HERE"/*.txt.bak
echo "work dir: $WORK"
