#!/usr/bin/env bash
# Records the truth logs for the jvm-safepoint figure.
# Usage: bash truth/run.sh [work-dir]   (java and javac 21.0.1 on PATH)
# Writes into the work dir, never into the repo: compile output, logs, thread dump.
# The committed files in truth/ are copies of one run with absolute paths replaced by <work>.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${1:-$(mktemp -d)}"
mkdir -p "$WORK"
cd "$WORK"
rm -f go safepoint.log safepoint-stats.log compile.txt stdout.txt threads.txt
javac -d . "$HERE/SafepointProbe.java"

# stdin is a pipe that stays open and empty for 12 s, so native-read blocks in native code.
( sleep 12 | java \
    -XX:CompileCommand=exclude,SafepointProbe::interpretedLoop \
    -XX:+PrintCompilation \
    -Xlog:safepoint=trace,vmthread=debug:file=safepoint.log:uptime,tid,level,tags \
    -Xlog:safepoint+stats=info:file=safepoint-stats.log:none \
    -cp . SafepointProbe "$WORK/go" > stdout.txt 2>&1 ) &
sleep 3
PID="$(jcmd | awk '/SafepointProbe/ {print $1}')"
jcmd "$PID" Thread.print > threads.txt
sleep 1
touch go
wait || true
grep -E 'SafepointProbe::(compiled|interpreted)Loop|Excluding' stdout.txt > compile.txt || true
echo "work dir: $WORK"
grep -n 'G1CollectFull' safepoint.log safepoint-stats.log
