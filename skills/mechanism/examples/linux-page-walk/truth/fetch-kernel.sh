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
  "arch/arm64/include/asm/pgtable-hwdef.h c2f6fbc045eeeb1ea71548c726a04267a43cc298dd4e2e5096793f1cc704f9ff"
  "arch/arm64/include/asm/pgtable-types.h 46d1c93edf95a9ece5e593a7e260d52502c9c4958902cb8dfa98cbbc5d82f816"
  "include/asm-generic/pgtable-nop4d.h cd44b14101a24b43beabda8be0f2a1f54c3d5d5492bbb89fcc9eb93fd575dadb"
  "include/linux/pgtable.h 681e25b6c9cea9dfc72324654355c1526fd2f06d9c42d944b0e61e0dc83de5fb"
  "arch/arm64/mm/context.c e9a19455022663241d5373ac00e08fc5c11b62394fd7d95df428b811745a81d5"
  "arch/arm64/include/asm/mmu_context.h 59bfbbe020d9a13f4b065f0f2d6b10ac40692d7ee0aa535e53e2182b205cbd25"
  "arch/arm64/include/asm/processor.h 6cad451a1bda70574aefaa74c7f6e403c91e0e486bc7633819da507b136bf585"
  "arch/arm64/kernel/entry-common.c 6736a83ff479e4eb12333ed1484bb3b72f0be092cdcdaf44a5ab685f280b5690"
  "arch/arm64/mm/fault.c db7c0d079241b3d9eed44781d9af9f781698511a2a024ce7d4f08b0ad91a307b"
  "mm/memory.c ad328e9aa9fee867a6ba401c9e66bf5e40c162836c8096c4541cd61f95a46ba0"
  "include/linux/mm.h 92c812f7d025c2edafba391fcbda7e2f62ff2763c0d2682dbb02696d194b1f59"
  "mm/pgtable-generic.c f394c7f283fd45beb61d517e4fe0f7766af3d14d9289c3b711e55ef4a35ff137"
  "arch/arm64/include/asm/tlbflush.h 9ddec5414470e6b0d8867189c12419ec9166af3f1969ce29a340981a14e17bbb"
  "arch/arm64/include/asm/pgtable.h 75db6c8078be97138beb4eaee52c6ace94990c9f4883c02250b4a092f98b019f"
  "fs/proc/task_mmu.c 7832dcaf290aaed3ece300c3df2ed5444d29e6d19beb8c6956f733050cd63025"
  "fs/proc/page.c 736a42b69b8e3211c80dc94cc2b6a5c79da02f0a7d6741a5432671488fd636a2"
  "include/uapi/linux/kernel-page-flags.h 3faf64bb4e395bba5e66752a5129d5d23e0893ae94d202a824dfe88ce3024dda"
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
