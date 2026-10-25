#!/usr/bin/env bash
# Rebuilds every file in truth/ with Amazon Corretto 21.0.1 (macOS arm64). Run from this folder with JAVA_HOME set.
# The class file goes to a temporary folder, so only text output lands here.
set -euo pipefail
OUT="$(mktemp -d)"
FLAGS=(-Xms16m -Xmx16m -XX:+UseG1GC -XX:ParallelGCThreads=1)
"$JAVA_HOME/bin/java" -version > java-version.txt 2>&1
"$JAVA_HOME/bin/javac" -nowarn -XDsuppressNotes -d "$OUT" Ages.java 2>/dev/null
"$JAVA_HOME/bin/java" "${FLAGS[@]}" -XX:+PrintFlagsFinal -version 2>/dev/null \
  | grep -E ' (G1HeapRegionSize|MaxTenuringThreshold|InitialTenuringThreshold|TargetSurvivorRatio|SurvivorRatio|MaxHeapSize|ParallelGCThreads|UseG1GC) ' > flags.txt
# the run the figure draws (-Xlog would rotate an old gc.log to gc.log.0)
rm -f gc.log gc.log.*
"$JAVA_HOME/bin/java" "${FLAGS[@]}" -cp "$OUT" \
  '-Xlog:gc*=info,gc+heap=debug,gc+heap+coops=debug,gc+age=trace,gc+region=trace:file=gc.log:uptime,level,tags' \
  Ages > probe.txt
# where the two Old regions at startup come from: the CDS archived heap, and none without CDS
{
  "$JAVA_HOME/bin/java" "${FLAGS[@]}" -cp "$OUT" '-Xlog:cds=info:stdout:level,tags' Ages | grep -E 'heap range|Requested heap region|map heap data'
  "$JAVA_HOME/bin/java" -Xshare:off "${FLAGS[@]}" -cp "$OUT" '-Xlog:gc+heap=info:stdout:level,tags' Ages | grep -E 'GC\(0\) Old regions'
} | sed "s#$JAVA_HOME#\$JAVA_HOME#g" > cds-heap.txt
rm -rf "$OUT"
