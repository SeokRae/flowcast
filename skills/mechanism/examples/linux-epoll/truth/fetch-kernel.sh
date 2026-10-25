#!/usr/bin/env bash
# Downloads the Linux sources that truth/kernel-refs.md points to, from the pinned stable tag, into a temp dir.
# The kernel is GPLv2 and its source text stays out of this (MIT) repo.
# Usage: bash truth/fetch-kernel.sh [dir]   (default: ${TMPDIR:-/tmp}/flowcast-linux-7.0.14)
# Then:  node check-source.mjs [dir]        (or LINUX_SRC=dir node check-source.mjs)
set -euo pipefail
TAG="v7.0.14" # linux stable, tag object b38d6c0b6e7f406a7feb7d46f184ec3edaac8c3b, commit 458c6079fc1d41d564c37679c8ace02cd83ee817
BASE="https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/plain"
TMP="${TMPDIR:-/tmp}"
DIR="${1:-${TMP%/}/flowcast-linux-7.0.14}"

# path under the repo root, SHA-256 of the file at the tag
FILES=(
  "fs/eventpoll.c e8dace5d2d4b8d8def7a5e32485cb4e4051940f71303ac4740334510aeae214b"
  "fs/select.c 321a153b85522c64262f7af59c6daf7504da3374597816883a3935d9fe941dc8"
  "fs/pipe.c 56251a2dd4baac01424132e2b96413b14d85d9ff13284146658be5d3c347b68c"
  "include/linux/poll.h 2e9d66ec3a6ae91ae35d1e2065e90f42116e48081c68456da56594656b6022eb"
  "kernel/sched/wait.c 1f3be3b6ce51b6248cadf17ad56a520e12ea87d733c3606f0525bc626e400a49"
)

for entry in "${FILES[@]}"; do
  path="${entry% *}"
  want="${entry#* }"
  out="$DIR/$path"
  mkdir -p "$(dirname "$out")"
  if [ ! -f "$out" ] || [ "$(shasum -a 256 "$out" | cut -d' ' -f1)" != "$want" ]; then
    curl -fsSL -o "$out.part" "$BASE/$path?h=$TAG"
    mv "$out.part" "$out"
  fi
  got="$(shasum -a 256 "$out" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    echo "sha256 mismatch: $path (got $got)" >&2
    exit 1
  fi
done
echo "linux sources ($TAG): $DIR"
