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
  "kernel/sched/fair.c e5bba93fb68377f09e8da1a3afc02339694c1ca431847d70ee2abaf29f9de287"
  "kernel/sched/core.c 345b83492b5dd5e44995c255388cd4afebcecb0a08f8044eac4ef6ada8014d4a"
  "kernel/sched/sched.h 8793436044d20d4d4d8c5f21321a8f11f2ffdbd25f3fa2060aae4d5560506d25"
  "kernel/sched/features.h 25c6cfe2b7989ea40f46975874b2e0f02fa0138d0810fa4825aaa3b57b718672"
  "kernel/sched/debug.c 883f386b500ab3cda11df327cce07b827a701ef663d343f2eb1c59e0bd0f1de4"
  "include/linux/sched/sysctl.h a783d52cba4988e2733f048cb104af7ddb75c2f511230178ba412c0fd89aa1dd"
  "include/vdso/jiffies.h 8ddcec4187616b2a4855e4219b454ee0890a4eeb52bad4f51d8384d76a84a3c3"
  "include/linux/irq-entry-common.h bb9accdfa2b6f99d59a78e9adcfc2de798c0a56370951cce4be13db07886e90c"
  "kernel/entry/common.c 898b4d839464609e6a1ac5f58e20e459393a3f7a40ea83539460d8bf8b1edd63"
  "arch/arm64/Kconfig e9076788b1378f7be5efd004296e672e446ccca61096414ea42cc2b1e19d2ac2"
  "arch/arm64/kernel/entry-common.c 6736a83ff479e4eb12333ed1484bb3b72f0be092cdcdaf44a5ab685f280b5690"
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
