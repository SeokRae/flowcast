#!/usr/bin/env bash
# Downloads the Linux sources that truth/kernel-refs.md points to, from the pinned stable tag, into a temp dir.
# The kernel is GPLv2 and its source stays out of this (MIT) repo.
# Usage: bash truth/fetch-kernel.sh [dir]   (default: ${TMPDIR:-/tmp}/flowcast-linux-7.0.14)
# Then:  node check-source.mjs [dir]         (or LINUX_SRC=dir node check-source.mjs)
set -euo pipefail
TAG="v7.0.14" # stable linux.git, commit 458c6079fc1d41d564c37679c8ace02cd83ee817
BASE="https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/plain"
TMP="${TMPDIR:-/tmp}"
DIR="${1:-${TMP%/}/flowcast-linux-7.0.14}"

# path under the tree root, SHA-256 of the file at the tag
# (arch/arm64/tools/syscall_64.tbl is a symlink; the plain endpoint serves its target path as the file body)
FILES=(
  "arch/arm64/include/asm/esr.h 500611e89da22bc9d3c1c2a177236e4fa8648e559c6cb25a575e293fed3361e3"
  "arch/arm64/include/asm/syscall_wrapper.h a72413a5e168e53560a53806799dd1ec9dc96e1c80448037dd599fb514ad1588"
  "arch/arm64/include/asm/syscall.h 60a260d6faf93bf0b91672d29d6039d830f649a5ff1a53c291d01af1fb4451a8"
  "arch/arm64/kernel/entry-common.c 6736a83ff479e4eb12333ed1484bb3b72f0be092cdcdaf44a5ab685f280b5690"
  "arch/arm64/kernel/entry.S 1db96dc7904e4a1688492b395aea4eb01e6388f516f342e415ce03fd39c1554d"
  "arch/arm64/kernel/Makefile.syscalls 27e95d7bd10c3ab67c8a3f16c7dfe5da30c586c2fda3993c42025109a22098c5"
  "arch/arm64/kernel/sys.c f052e58e829fd4a977f7a52ce96a774051430c3a677e6d8b805694b8d466da9c"
  "arch/arm64/kernel/syscall.c d9d7b825ed742cfc6f3ab50108062ef99816f3fede5d66bd9414d4434ee121f2"
  "arch/arm64/tools/syscall_64.tbl e0a5d9a188af7952060d69e4e248675df79a583610ae535e68787bb5481a30db"
  "fs/read_write.c 58fe9b05f89c830accaf97a4f4b680c48e94f7c59ea22e2c2b6dbeb0b063c59f"
  "include/uapi/asm-generic/errno-base.h 2c148e92b8318deeb767fabd60822113e575ee664ff09a1873aed8f7a495793c"
  "include/uapi/asm-generic/errno.h 651dbafba40d561d5ba2d6dc43263238e3894e91942d30af925971dc92230daf"
  "kernel/rseq.c 140c6c69677ca070c02384539400fb8652702c623a27a978232331328091a398"
  "kernel/sys_ni.c f5cbbc8b10f1878400a530329e7210b4595d57a5d9ed1a8156a9810d79c8e555"
  "kernel/sys.c 418d0bd8929cb41497a73a23e6700412224b062ec6904145c0628d5225abcd5e"
  "scripts/Makefile.asm-headers a41518fb74c884e12f0b6a3addb974d13d76f008582f4e0e7c332a5e8201e325"
  "scripts/syscall.tbl 222c40f91975eb2860bf4d334863005ef084fee39dd031d252ad2f2f2342d485"
  "scripts/syscallhdr.sh a0faed17e23781d10296eeebe89a7ed35cd80e70ce309c309b95fb916fee779f"
  "scripts/syscalltbl.sh 813a2cd88e3bd01a4e10c13ef68aa00060a5ad1d5328f5086fa8c86c44d5abbd"
)

for entry in "${FILES[@]}"; do
  path="${entry% *}"
  want="${entry#* }"
  out="$DIR/$path"
  mkdir -p "$(dirname "$out")"
  if [ ! -f "$out" ] || [ "$(shasum -a 256 "$out" | cut -d' ' -f1)" != "$want" ]; then
    curl -fsSL -o "$out" "$BASE/$path?h=$TAG"
  fi
  got="$(shasum -a 256 "$out" | cut -d' ' -f1)"
  if [ "$got" != "$want" ]; then
    echo "sha256 mismatch: $path (got $got)" >&2
    exit 1
  fi
done
echo "linux sources ($TAG): $DIR"
