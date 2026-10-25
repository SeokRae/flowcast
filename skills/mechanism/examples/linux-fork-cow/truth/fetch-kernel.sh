#!/usr/bin/env bash
# Downloads the Linux sources that truth/kernel-refs.md points to, from the pinned stable tag, into a temp dir.
# The sources are GPLv2 and stay out of this (MIT) repo.
# Usage: bash truth/fetch-kernel.sh [dir]   (default: ${TMPDIR:-/tmp}/flowcast-linux-7.0.14)
# Then:  node check-source.mjs [dir]        (or LINUX_SRC=dir node check-source.mjs)
set -euo pipefail
TAG="v7.0.14" # linux stable, commit 458c6079fc1d41d564c37679c8ace02cd83ee817
BASE="https://git.kernel.org/pub/scm/linux/kernel/git/stable/linux.git/plain"
TMP="${TMPDIR:-/tmp}"
DIR="${1:-${TMP%/}/flowcast-linux-7.0.14}"

# path under the repo root, SHA-256 of the file at the tag
FILES=(
  "mm/memory.c ad328e9aa9fee867a6ba401c9e66bf5e40c162836c8096c4541cd61f95a46ba0"
  "mm/mmap.c 88471d482e3300dbd88f97acbe28c8a1e3fcfc4cdb98387f0761deb9e8e0f08c"
  "kernel/fork.c 72db444288c0da611bfd4e635ee98e07cb584c127f053e75929119642ba93cf3"
  "include/linux/rmap.h 781d68b758a4809d3afe228ae39684affd32d497d3c3f55966d1a128cf436285"
  "mm/swap.c 0cdfbe9d3f98c6e53a09e4d0f291162a9ded61dfcbc68c3032caef3ef0d9c741"
  "include/linux/pagevec.h b5ab95c07fdc938aa773b0bf371c03c03aa2fb8f6c6b2f41628ffc6ad6b5abd4"
  "fs/proc/task_mmu.c 7832dcaf290aaed3ece300c3df2ed5444d29e6d19beb8c6956f733050cd63025"
  "fs/proc/page.c 736a42b69b8e3211c80dc94cc2b6a5c79da02f0a7d6741a5432671488fd636a2"
  "include/uapi/linux/kernel-page-flags.h 3faf64bb4e395bba5e66752a5129d5d23e0893ae94d202a824dfe88ce3024dda"
  "arch/arm64/include/asm/pgtable.h 75db6c8078be97138beb4eaee52c6ace94990c9f4883c02250b4a092f98b019f"
  "arch/arm64/include/asm/pgtable-prot.h 9b8ae871c4f7818dfda15326bdcc32c321a276d787beac2a9dde5535575ce4a2"
  "arch/arm64/include/asm/pgtable-hwdef.h c2f6fbc045eeeb1ea71548c726a04267a43cc298dd4e2e5096793f1cc704f9ff"
  "arch/arm64/mm/fault.c db7c0d079241b3d9eed44781d9af9f781698511a2a024ce7d4f08b0ad91a307b"
  "arch/arm64/mm/copypage.c b8fa2540a113b3b9222d26a6fafb3a49179a200d61b4e78eb723f0f3e37a021f"
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
