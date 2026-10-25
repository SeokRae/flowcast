// node check-source.mjs [dir]: truth/kernel-refs.md와 모델의 소스 근거를 리눅스 원문(v7.0.14)에 대조한다
// 원문은 저장소에 두지 않는다(GPLv2). 먼저 bash truth/fetch-kernel.sh로 받는다.
// dir: 인자, 없으면 LINUX_SRC, 없으면 ${TMPDIR:-/tmp}/flowcast-linux-7.0.14. 원문이 없으면 exit 2, 대조 실패는 exit 1
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] ?? process.env.LINUX_SRC ?? join(process.env.TMPDIR || "/tmp", "flowcast-linux-7.0.14");
const refs = readFileSync(join(HERE, "truth", "kernel-refs.md"), "utf8");

// 표 한 줄: | `파일` | [L시작-L끝](링크) | 함수 | `식별자`, ... | 하는 일 |
const rows = refs
  .split("\n")
  .filter((line) => /^\| `(arch|mm|include|fs)\//.test(line))
  .map((line) => {
    const cells = line.split("|").map((c) => c.trim());
    const [, from, to] = cells[2].match(/^\[L(\d+)-L(\d+)\]/).map(Number);
    return { file: cells[1].replace(/`/g, ""), from, to, ids: [...cells[4].matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  });
const files = [...new Set(rows.map((r) => r.file))];
const missing = files.filter((f) => !existsSync(join(DIR, f)));
if (missing.length) {
  console.error(`리눅스 원문이 없습니다: ${join(DIR, missing[0])} 외 ${missing.length - 1}개`);
  console.error("먼저 받으세요: bash truth/fetch-kernel.sh [dir] (그 뒤 node check-source.mjs [dir] 또는 LINUX_SRC=dir)");
  process.exit(2);
}
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
// 원문 전체를 오류 메시지에 쏟지 않도록 정규식만 보여 준다
const has = (text, re) => assert.ok(re.test(text), `not found: ${re}`);

// 1. 참조 표: 줄 범위마다 대조 식별자가 그 안에 있다 (태그가 바뀌거나 줄이 밀리면 실패)
let ids = 0;
for (const r of rows) {
  const text = src[r.file].split("\n").slice(r.from - 1, r.to).join("\n");
  for (const id of r.ids) {
    assert.ok(text.includes(id), `${r.file} L${r.from}-L${r.to}: ${id}`);
    ids += 1;
  }
}

// 2. 모델이 기대는 줄
const hwdef = src["arch/arm64/include/asm/pgtable-hwdef.h"];
// 항목 8바이트, 한 단계 9비트, 단계 n의 시프트 식 (모델 SHIFTS의 근거)
has(hwdef, new RegExp(`#define PTDESC_ORDER ${M.PTDESC_ORDER}\\n`));
has(hwdef, /#define PTDESC_TABLE_SHIFT\s+\(PAGE_SHIFT - PTDESC_ORDER\)/);
has(hwdef, /#define ARM64_HW_PGTABLE_LEVEL_SHIFT\(n\)\s+\(PTDESC_TABLE_SHIFT \* \(4 - \(n\)\) \+ PTDESC_ORDER\)/);
has(hwdef, /#define PMD_SHIFT\s+ARM64_HW_PGTABLE_LEVEL_SHIFT\(2\)/);
has(hwdef, /#define PUD_SHIFT\s+ARM64_HW_PGTABLE_LEVEL_SHIFT\(1\)/);
has(hwdef, /#define PGDIR_SHIFT\s+ARM64_HW_PGTABLE_LEVEL_SHIFT\(4 - CONFIG_PGTABLE_LEVELS\)/);
has(hwdef, /#define PTRS_PER_PTE\s+\(1 << PTDESC_TABLE_SHIFT\)/);
has(hwdef, /#define PTE_RDONLY\s+\(_AT\(pteval_t, 1\) << 7\)/);
has(src["arch/arm64/include/asm/pgtable-types.h"], /#elif CONFIG_PGTABLE_LEVELS == 4\n#include <asm-generic\/pgtable-nop4d.h>/);
has(src["include/linux/pgtable.h"], /return \(address >> PAGE_SHIFT\) & \(PTRS_PER_PTE - 1\);/);

const fault = src["arch/arm64/mm/fault.c"];
// DFSC 표: 단계별 translation fault는 do_translation_fault, permission fault는 do_page_fault
for (const n of [0, 1, 2, 3]) {
  has(fault, new RegExp(`\\{ do_translation_fault,\\s+SIGSEGV, SEGV_MAPERR,\\s+"level ${n} translation fault"\\s+\\}`));
  has(fault, new RegExp(`\\{ do_page_fault,\\s+SIGSEGV, SEGV_ACCERR,\\s+"level ${n} permission fault"\\s+\\}`));
}
has(fault, /static int __kprobes do_translation_fault\([\s\S]*?if \(is_ttbr0_addr\(addr\)\)\n\s+return do_page_fault\(far, esr, regs\);/);
has(fault, /NOKPROBE_SYMBOL\(do_mem_abort\);/);
has(fault, /fault = handle_mm_fault\(vma, addr, mm_flags \| FAULT_FLAG_VMA_LOCK, regs\);/);

const memory = src["mm/memory.c"];
const body = (name) => {
  // 정의만 (앞쪽의 전방 선언은 세미콜론으로 끝난다)
  const start = memory.search(new RegExp(`^(static )?vm_fault_t ${name}\\([^;{]*\\)\\n(\\t__releases\\([^)]*\\)\\n)?\\{`, "m"));
  assert.ok(start >= 0, name);
  return memory.slice(start, memory.indexOf("\n}\n", start));
};
// handle_pte_fault: L2 항목이 비면 pte 없음, L3 항목이 비면 pte 없음, 둘 다 do_pte_missing. 쓰기 금지면 do_wp_page
const hpf = body("handle_pte_fault");
has(hpf, /if \(unlikely\(pmd_none\(\*vmf->pmd\)\)\) \{[\s\S]*?vmf->pte = NULL;/);
has(hpf, /if \(pte_none\(vmf->orig_pte\)\) \{\n\s+pte_unmap\(vmf->pte\);\n\s+vmf->pte = NULL;/);
has(hpf, /if \(!vmf->pte\)\n\s+return do_pte_missing\(vmf\);/);
has(hpf, /if \(!pte_write\(entry\)\)\n\s+return do_wp_page\(vmf\);/);
// do_anonymous_page: L3 테이블을 먼저, 읽기면 zero page(쓰기 비트 없음), 쓰기면 새 folio에 쓰기 비트
const anon = body("do_anonymous_page");
assert.ok(anon.indexOf("pte_alloc(vma->vm_mm, vmf->pmd)") < anon.indexOf("my_zero_pfn"), "pte_alloc before the zero page");
has(anon, /if \(!\(vmf->flags & FAULT_FLAG_WRITE\) &&\n\s+!mm_forbids_zeropage\(vma->vm_mm\)\) \{\n\s+entry = pte_mkspecial\(pfn_pte\(my_zero_pfn\(vmf->address\),/);
has(anon, /if \(vma->vm_flags & VM_WRITE\)\n\s+entry = pte_mkwrite\(pte_mkdirty\(entry\), vma\);/);
// wp_page_copy: zero page면 0으로 채운 새 페이지, 옛 항목은 지우고 TLB를 비운 다음 새 항목
const copy = body("wp_page_copy");
has(copy, /pfn_is_zero = is_zero_pfn\(pte_pfn\(vmf->orig_pte\)\);\n\s+new_folio = folio_prealloc\(mm, vma, vmf->address, pfn_is_zero\);/);
assert.ok(copy.indexOf("ptep_clear_flush(vma, vmf->address, vmf->pte);") < copy.indexOf("set_pte_at(mm, vmf->address, vmf->pte, entry);"), "flush before the new pte");
has(memory, /if \(need_zero\)\n\s+new_folio = vma_alloc_zeroed_movable_folio\(vma, addr\);/);
// mm_account_fault: minor fault 하나가 min_flt와 perf minor-faults를 함께 올린다
has(memory, /current->min_flt\+\+;/);
has(memory, /perf_sw_event\(PERF_COUNT_SW_PAGE_FAULTS_MIN, 1, regs, address\);/);
// __handle_mm_fault: L0, L1 항목은 비었을 때만 테이블을 만든다 (ftrace에 __pud_alloc, __pmd_alloc이 없다)
const mm = src["include/linux/mm.h"];
has(mm, /return \(unlikely\(p4d_none\(\*p4d\)\) && __pud_alloc\(mm, p4d, address\)\) \?/);
has(mm, /return \(unlikely\(pud_none\(\*pud\)\) && __pmd_alloc\(mm, pud, address\)\)\?/);
has(mm, /#define pte_alloc\(mm, pmd\) \(unlikely\(pmd_none\(\*\(pmd\)\)\) && __pte_alloc\(mm, pmd\)\)/);
// ptep_clear_flush: 접근 가능했던 항목이면 그 주소의 TLB 항목을 무효화한다
has(src["mm/pgtable-generic.c"], /pte = ptep_get_and_clear\(mm, address, ptep\);\n\s+if \(pte_accessible\(mm, pte\)\)\n\s+flush_tlb_page\(vma, address\);/);
// arm64의 update_mmu_cache_range는 본문에 문장이 없다 (주석만 있다)
has(src["arch/arm64/include/asm/pgtable.h"], /static inline void update_mmu_cache_range\(struct vm_fault \*vmf,\n[^\n]*\n[^\n]*\)\n\{\n\s*\/\*[\s\S]*?\*\/\n\}/);
// pagemap: PFN 55비트, 비트 63 present. kpageflags: ZERO_PAGE 24, ANON 12
const pm = src["fs/proc/task_mmu.c"];
has(pm, /#define PM_PFRAME_BITS\t\t55/);
has(pm, /#define PM_PRESENT\t\tBIT_ULL\(63\)/);
const kpf = src["include/uapi/linux/kernel-page-flags.h"];
has(kpf, /#define KPF_ZERO_PAGE\t\t24/);
has(kpf, /#define KPF_ANON\t\t12/);
// 사용자 공간 변환의 시작점: pgd의 물리 주소를 TTBR0_EL1에 쓴다
has(src["arch/arm64/mm/context.c"], /unsigned long ttbr0 = phys_to_ttbr\(pgd_phys\);[\s\S]*?write_sysreg\(ttbr0, ttbr0_el1\);/);

console.log(`source check passed: ${rows.length} refs, ${ids} identifiers, ${files.length} files in ${DIR}`);
