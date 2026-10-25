#!/usr/bin/env bash
# truth/의 실행 출력을 다시 만든다: JAVA_HOME = Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64
# 산출: java-version.txt, probe-out.txt, defined-before.txt, loader-trace.txt, classpath-listing.txt (작업 경로는 <work>로 바꾼다)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$(mktemp -d)}"
JAVA="${JAVA_HOME:?JAVA_HOME required}/bin/java"
OPENS="--add-opens java.base/java.lang=ALL-UNNAMED --add-opens java.base/jdk.internal.loader=ALL-UNNAMED"

"$JAVA" -version 2> "$HERE/java-version.txt"
"$JAVA_HOME/bin/javac" -XDstringConcat=inline -d "$WORK/classes" "$HERE/demo/Probe.java" "$HERE/demo/Greeter.java"
(cd "$WORK/classes" && find . -name '*.class' | sed 's|^\./||' | LC_ALL=C sort) > "$HERE/classpath-listing.txt"
(cd "$WORK" && "$JAVA" $OPENS -Xlog:class+load -cp "$WORK/classes" demo.Probe) > "$WORK/probe-raw.txt"
(cd "$WORK" && "$JAVA" $OPENS -Xlog:class+load=debug -cp "$WORK/classes" demo.Probe) > "$WORK/probe-debug.txt"
"$JAVA" "$HERE/LoaderTrace.java" "$WORK/classes" > "$HERE/loader-trace.txt" 2> /dev/null

# Probe 자신의 출력, demo.Probe 적재 줄, 요청 구간(loadClass begin과 end 사이)의 class+load 줄만 남긴다
awk '/-- loadClass begin/ {inside=1} /-- loadClass end/ {inside=0}
     !/^\[/ || /class,load\] demo\.Probe / || inside' "$WORK/probe-raw.txt" \
  | sed "s|$WORK|<work>|g" > "$HERE/probe-out.txt"

# 첫 요청 전까지 로더별로 정의된 클래스 수 (class+load=debug의 loader 필드)
awk '/-- loadClass begin/ {exit}
     /\[debug\]\[class,load\]/ { if ($0 ~ /of .bootstrap./) n["boot"]++; else if ($0 ~ /PlatformClassLoader/) n["platform"]++; else if ($0 ~ /AppClassLoader/) n["app"]++ }
     END { printf "boot %d\nplatform %d\napp %d\n", n["boot"], n["platform"], n["app"] }' "$WORK/probe-debug.txt" > "$HERE/defined-before.txt"
