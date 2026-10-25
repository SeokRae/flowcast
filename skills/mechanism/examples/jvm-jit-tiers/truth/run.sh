#!/bin/sh
# Reproduces truth/flags.txt, truth/print-tiered.txt and truth/print-inlining.txt.
# JAVA_HOME = Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64, 11 CPUs.
# Only Tiers::measure is kept out of inlining, so its own counters and nmethods are what the log shows.
# Every other flag is the default (tiered compilation on, TieredStopAtLevel 4).
set -e
OUT="${TMPDIR:-/tmp}/jit-tiers"
mkdir -p "$OUT"
"$JAVA_HOME/bin/javac" -d "$OUT" Tiers.java
"$JAVA_HOME/bin/java" -version 2>&1
"$JAVA_HOME/bin/java" -XX:+PrintFlagsFinal -version 2>/dev/null | grep -E 'Tier3|Tier4|Tier0InvokeNotifyFreqLog|Tier0ProfilingStartPercentage|CompileThresholdScaling|TieredStopAtLevel|TieredCompilation |CICompilerCount |PerBytecodeTrapLimit|PerMethodTrapLimit|TypeProfileWidth|BackgroundCompilation|PrintTieredEvents'
"$JAVA_HOME/bin/java" -cp "$OUT" -XX:CompileCommand=quiet -XX:CompileCommand=dontinline,Tiers::measure \
  -XX:+PrintCompilation -XX:+PrintTieredEvents -Xlog:deoptimization=debug Tiers \
  | grep -E 'Tiers.measure|Tiers::measure|^# |deoptimization'
"$JAVA_HOME/bin/java" -cp "$OUT" -XX:CompileCommand=quiet -XX:CompileCommand=dontinline,Tiers::measure \
  -XX:+UnlockDiagnosticVMOptions -XX:+PrintCompilation -XX:+PrintInlining Tiers \
  | grep -A4 'Tiers::measure (9 bytes)'
