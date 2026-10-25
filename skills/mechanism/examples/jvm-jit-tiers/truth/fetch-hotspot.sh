#!/bin/sh
# Downloads the HotSpot sources that truth/hotspot-refs.md points to, pinned to openjdk/jdk21u tag jdk-21.0.1+12,
# into a temporary directory outside the repository (flowcast is MIT; the OpenJDK text stays out of it).
# Usage: sh truth/fetch-hotspot.sh [dir]    default dir: ${TMPDIR:-/tmp}/flowcast-hotspot-21.0.1
# Then:  node check-source.mjs [dir]
set -eu
TAG="jdk-21.0.1+12"
BASE="https://raw.githubusercontent.com/openjdk/jdk21u/$TAG/src/hotspot/share"
DIR="${1:-${TMPDIR:-/tmp}/flowcast-hotspot-21.0.1}"

# path under src/hotspot/share, then the SHA-256 of that file at the tag
FILES="
compiler/compilationPolicy.cpp 280dd5800ec3d8058c5633be3ccb782c56f9f8133a1d5fcafb8f7333d42a6ce1
compiler/compiler_globals.hpp 4059f61890ebd6e54cb7320d369f01cfabce9e88612dc9a5b5710277d2ebaf4c
runtime/globals.hpp 0a925f2221a42fce5cec3db7977445edb1ccb9ae73ed0c906908698a680f2ec8
runtime/deoptimization.cpp b801493ef4a3cf64bc57dceb8475df77b7b6eb4b908fa413b5b3e2f52976af81
oops/methodCounters.cpp c9c6ceaebe048e6e32afcff65eecea5f8c2fa0e1e994c22813cb7d71a1b7e22d
oops/methodData.cpp b25a1a24b27769d601a5667a6ec767e2aa560fd6c6c9e386698b3d8c33c0ed95
oops/methodData.hpp c17b7727fcca77b5f7520349454afee402a74b6b97cf4662a1025712013d1286
c1/c1_LIRGenerator.cpp 389ccae5a5412c6e29bc75c3e95f11a9e5fd02e432fc09e88b33b6e06e93d4f7
"

sha256() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d' ' -f1
  else shasum -a 256 "$1" | cut -d' ' -f1; fi
}

echo "$FILES" | while read -r path want; do
  [ -n "$path" ] || continue
  out="$DIR/$path"
  mkdir -p "$(dirname "$out")"
  curl -fsSL "$BASE/$path" -o "$out"
  got="$(sha256 "$out")"
  if [ "$got" != "$want" ]; then
    echo "sha256 mismatch: $path (got $got)" >&2
    exit 1
  fi
  echo "ok $path"
done
echo "fetched $TAG into $DIR"
