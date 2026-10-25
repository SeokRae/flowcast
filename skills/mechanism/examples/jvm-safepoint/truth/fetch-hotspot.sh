#!/usr/bin/env bash
# Downloads the HotSpot sources that truth/hotspot-refs.md points to, from the pinned tag, into a temp dir.
# The sources are GPLv2 with the Classpath Exception and stay out of this (MIT) repo.
# Usage: bash truth/fetch-hotspot.sh [dir]   (default: ${TMPDIR:-/tmp}/flowcast-hotspot-21.0.1)
# Then:  node check-source.mjs [dir]         (or HOTSPOT_SRC=dir node check-source.mjs)
set -euo pipefail
TAG="jdk-21.0.1+12" # openjdk/jdk21u, commit 060c4f7589e7f13febd402f4dac3320f4c032b08
BASE="https://raw.githubusercontent.com/openjdk/jdk21u/$TAG"
TMP="${TMPDIR:-/tmp}"
DIR="${1:-${TMP%/}/flowcast-hotspot-21.0.1}"

# path under the repo root, SHA-256 of the file at the tag
FILES=(
  "src/hotspot/share/runtime/safepoint.cpp 5e355ca68649e02d33cc7d9ae83f489ff9519a80af0cd850069c3683f8cec69c"
  "src/hotspot/share/runtime/vmThread.cpp 85136404f8ba780a240a43cce505bea0bc352af02ff2b0a423c9f73af6518cdd"
  "src/hotspot/share/runtime/interfaceSupport.inline.hpp 64b34ddceab3c685aa6e0638132748196042989d01e4e20d42b09bb622fbbb5c"
  "src/hotspot/share/runtime/safepointMechanism.inline.hpp 5fc5d5530a927ac3f74e2527045e7931dc00f0e636054d2e05bcead89ac6d0a2"
  "src/hotspot/share/runtime/safepointMechanism.cpp 32cc5658a7af5ee962bb50a3e3c2205d832f9ca9af398b8330b7cd4b04cbfe0f"
  "src/hotspot/cpu/aarch64/interp_masm_aarch64.cpp f8e861341bad77eecb61228f35b43e584d114185a556bb9431ab6de1b49f59e2"
  "src/hotspot/cpu/aarch64/templateTable_aarch64.cpp 5d0a61f2d345d94bf1e1d0b099504fc0a1a3080ea2ada9468d2f1be09ce78e3f"
  "src/hotspot/cpu/aarch64/aarch64.ad 77224d2c7aa91a28fdd1506d51dfdcf21ab3e00cc07a3a2dd6797e5784f32f96"
)

for entry in "${FILES[@]}"; do
  path="${entry% *}"
  want="${entry#* }"
  out="$DIR/$path"
  mkdir -p "$(dirname "$out")"
  if [ ! -f "$out" ] || [ "$(shasum -a 256 "$out" | cut -d' ' -f1)" != "$want" ]; then
    curl -fsSL -o "$out" "$BASE/$path"
  fi
  got="$(shasum -a 256 "$out" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    echo "sha256 mismatch: $path (got $got)" >&2
    exit 1
  fi
done
echo "hotspot sources ($TAG): $DIR"
