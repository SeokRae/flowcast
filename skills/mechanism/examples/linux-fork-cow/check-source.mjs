// node check-source.mjs [dir]: truth/kernel-refs.md와 모델의 소스 근거를 리눅스 원문(v7.0.14)에 대조한다
// 원문은 저장소에 두지 않는다(GPLv2). 먼저 bash truth/fetch-kernel.sh로 받는다.
// dir: 인자, 없으면 LINUX_SRC, 없으면 ${TMPDIR:-/tmp}/flowcast-linux-7.0.14. 원문이 없으면 exit 2, 대조 실패는 exit 1
// 대조는 식별자와 숫자로만 한다: 식별자가 줄 범위 안에 있는지, 정해진 순서로 나오는지.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] ?? process.env.LINUX_SRC ?? join(process.env.TMPDIR || "/tmp", "flowcast-linux-7.0.14");
const refs = readFileSync(join(HERE, "truth", "kernel-refs.md"), "utf8");

// 표 한 줄: | `파일` | [L시작-L끝](링크) | 함수 | `식별자`, ... | 하는 일 |
const rows = refs
  .split("\n")
  .filter((line) => /^\| `(mm|include|fs|kernel|arch)\//.test(line))
  .map((line) => {
    const cells = line.split("|").map((c) => c.trim());
    const m = cells[2].match(/^\[L(\d+)(?:-L(\d+))?\]/);
    const from = Number(m[1]);
    return { file: cells[1].replace(/`/g, ""), from, to: m[2] ? Number(m[2]) : from, ids: [...cells[4].matchAll(/`([^`]+)`/g)].map((x) => x[1]) };
  });
const files = [...new Set(rows.map((r) => r.file))];
const missing = files.filter((f) => !existsSync(join(DIR, f)));
if (missing.length) {
  console.error(`리눅스 원문이 없습니다: ${join(DIR, missing[0])} 외 ${missing.length - 1}개`);
  console.error("먼저 받으세요: bash truth/fetch-kernel.sh [dir] (그 뒤 node check-source.mjs [dir] 또는 LINUX_SRC=dir)");
  process.exit(2);
}
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const lines = (file, from, to) => src[file].split("\n").slice(from - 1, to).join("\n");

// 1. 참조 표: 줄 범위마다 대조 식별자가 그 안에 있다 (태그가 바뀌거나 줄이 밀리면 실패)
let ids = 0;
for (const r of rows) {
  const text = lines(r.file, r.from, r.to);
  for (const id of r.ids) {
    assert.ok(text.includes(id), `${r.file} L${r.from}-L${r.to}: ${id}`);
    ids += 1;
  }
}

// 2. 모델이 기대는 규칙: 줄 범위 안에서 식별자가 이 순서로 나온다
const range = (file, name) => {
  const r = rows.find((x) => x.file === file && x.ids.includes(name));
  assert.ok(r, `no ref row for ${name} in ${file}`);
  return lines(r.file, r.from, r.to);
};
function inOrder(text, names, what) {
  let at = 0;
  for (const name of names) {
    const next = text.indexOf(name, at);
    assert.ok(next >= 0, `${what}: ${name} after offset ${at}`);
    at = next + name.length;
  }
}
// fork: COW 매핑의 쓰기 가능 PTE는 부모 쪽을 쓰기 금지로, 자식 값도 쓰기 금지로 만든 뒤 넣는다
inOrder(range("mm/memory.c", "wrprotect_ptes"), ["is_cow_mapping", "pte_write", "wrprotect_ptes", "pte_wrprotect", "set_ptes"], "__copy_present_ptes");
// fork: 작은 folio는 참조 +1, rmap 복제(PageAnonExclusive 지움, mapcount +1)
inOrder(range("mm/memory.c", "folio_try_dup_anon_rmap_pte"), ["folio_get", "folio_try_dup_anon_rmap_pte", "MM_ANONPAGES", "__copy_present_ptes"], "copy_present_ptes");
inOrder(range("include/linux/rmap.h", "ClearPageAnonExclusive"), ["folio_test_large", "PageAnonExclusive", "ClearPageAnonExclusive", "_mapcount"], "__folio_try_dup_anon_rmap");
// 익명 페이지가 있는 VMA만 복사한다
inOrder(range("mm/memory.c", "VM_COPY_ON_FORK"), ["VM_COPY_ON_FORK", "return true", "anon_vma", "return true", "return false"], "vma_needs_copy");
// 쓰기 폴트 + 쓰기 권한 없음 = do_wp_page
inOrder(range("mm/memory.c", "FAULT_FLAG_WRITE"), ["FAULT_FLAG_WRITE", "pte_write", "do_wp_page"], "handle_pte_fault");
inOrder(range("arch/arm64/mm/fault.c", "ESR_ELx_WNR"), ["ESR_ELx_WNR", "ESR_ELx_CM"], "is_write_abort");
// do_wp_page: 공유 매핑 분기, 그다음 익명 페이지는 전용 표시나 재사용 검사, 아니면 복사
inOrder(
  range("mm/memory.c", "wp_can_reuse_anon_folio"),
  ["VM_SHARED", "wp_page_shared", "folio_test_anon", "PageAnonExclusive", "wp_can_reuse_anon_folio", "SetPageAnonExclusive", "wp_page_reuse", "folio_get", "wp_page_copy"],
  "do_wp_page",
);
// 재사용 판정: 참조 수가 3을 넘으면 포기, LRU 밖이면 지금 CPU 배치를 비우고, 끝 조건은 참조 수 1
const reuse = range("mm/memory.c", "folio_move_anon_rmap");
inOrder(reuse, ["folio_test_ksm", "folio_ref_count", "folio_test_lru", "lru_add_drain", "folio_ref_count", "folio_test_swapcache", "folio_trylock", "folio_ref_count", "folio_move_anon_rmap"], "wp_can_reuse_anon_folio");
assert.match(reuse, /folio_ref_count\(folio\)[^;\n]*\b3\b/, "wp_can_reuse_anon_folio: early limit 3");
assert.match(reuse, /folio_ref_count\(folio\)[^;\n]*\b1\b[^;\n]*folio_test_swapcache/, "wp_can_reuse_anon_folio: 1 + swapcache");
assert.ok(!/folio_mapcount|page_mapcount|_mapcount/.test(reuse), "wp_can_reuse_anon_folio does not read the mapcount for small folios");
// 재사용은 같은 PTE에 비트만 세우고, 복사는 새 PTE(쓰기 가능)를 넣은 뒤 옛 mapcount를 줄인다
inOrder(range("mm/memory.c", "PGREUSE"), ["pte_mkyoung", "maybe_mkwrite", "ptep_set_access_flags", "PGREUSE"], "wp_page_reuse");
inOrder(
  range("mm/memory.c", "folio_prealloc"),
  ["folio_prealloc", "__wp_page_copy_user", "maybe_mkwrite", "ptep_clear_flush", "folio_add_new_anon_rmap", "RMAP_EXCLUSIVE", "folio_add_lru_vma", "set_pte_at", "folio_remove_rmap_pte"],
  "wp_page_copy",
);
inOrder(range("arch/arm64/mm/copypage.c", "copy_highpage"), ["copy_user_highpage", "copy_highpage", "flush_dcache_page"], "copy_user_highpage");
// arm64의 쓰기 금지 = PTE_WRITE(DBM) 지우고 PTE_RDONLY 세우기
inOrder(range("arch/arm64/include/asm/pgtable.h", "pte_wrprotect"), ["pte_hw_dirty", "PTE_DIRTY", "clear_pte_bit", "PTE_WRITE", "set_pte_bit", "PTE_RDONLY"], "pte_wrprotect");
assert.match(src["arch/arm64/include/asm/pgtable-prot.h"], /#define PTE_WRITE[^\n]*PTE_DBM/);
assert.match(src["arch/arm64/include/asm/pgtable-hwdef.h"], /#define PTE_RDONLY[^\n]*<<\s*7\b/);
// LRU 추가 배치: 넣을 때 참조를 잡고, 31개가 차면 LRU로 옮긴다. drain은 지금 CPU만
inOrder(range("mm/swap.c", "folio_batch_move_lru"), ["folio_get", "folio_batch_add", "folio_batch_move_lru"], "__folio_batch_add_and_move");
inOrder(range("mm/swap.c", "smp_processor_id"), ["lru_add_drain_cpu", "smp_processor_id"], "lru_add_drain");
assert.match(src["include/linux/pagevec.h"], /#define PAGEVEC_SIZE\s+31\b/);
// 관찰 도구: pagemap exclusive와 kpagecount는 mapcount, smaps는 참조 수 1이면 private
inOrder(range("fs/proc/task_mmu.c", "CONFIG_PAGE_MAPCOUNT"), ["CONFIG_PAGE_MAPCOUNT", "folio_precise_page_mapcount"], "__folio_page_mapped_exclusively");
inOrder(range("fs/proc/task_mmu.c", "smaps_page_accumulate"), ["folio_ref_count", "smaps_page_accumulate", "folio_precise_page_mapcount"], "smaps_account");
inOrder(range("fs/proc/page.c", "get_kpage_count"), ["CONFIG_PAGE_MAPCOUNT", "folio_precise_page_mapcount"], "get_kpage_count");

// 3. 프로브가 쓴 비트 번호가 원문과 같다 (truth/cow_probe.c)
const probe = readFileSync(join(HERE, "truth", "cow_probe.c"), "utf8");
const flags = src["include/uapi/linux/kernel-page-flags.h"];
for (const name of ["KPF_LRU", "KPF_ANON", "KPF_KSM", "KPF_THP"]) {
  const want = flags.match(new RegExp(`#define ${name}\\s+(\\d+)`))[1];
  assert.equal(probe.match(new RegExp(`#define ${name} (\\d+)`))[1], want, `cow_probe.c ${name}`);
}
assert.match(src["fs/proc/task_mmu.c"], /#define PM_MMAP_EXCLUSIVE[^\n]*\b56\b/);
assert.match(probe, /#define PM_MMAP_EXCLUSIVE \(1ULL << 56\)/);

console.log(`source check passed: ${rows.length} refs, ${ids} identifiers, ${files.length} files in ${DIR}`);
