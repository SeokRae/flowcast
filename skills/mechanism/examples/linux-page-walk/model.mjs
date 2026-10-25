// 가상 주소 변환 진실 모델: Linux 7.0.14 (linuxkit), arm64, 4 KiB 페이지, 48비트 VA, 4단 페이지 테이블
// 그림의 주소 키, 카드, 워커와 크레인 위치, 리드아웃은 모두 이 모듈에서 나온다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.

// /proc/config.gz: CONFIG_ARM64_4K_PAGES=y, CONFIG_ARM64_VA_BITS=48, CONFIG_PGTABLE_LEVELS=4 (truth/config.txt)
export const PAGE_SHIFT = 12;
export const VA_BITS = 48;
export const LEVELS = 4;
// pgtable-hwdef.h: 항목 8바이트(PTDESC_ORDER 3), 한 단계가 푸는 비트 = PAGE_SHIFT - 3
export const PTDESC_ORDER = 3;
export const TABLE_SHIFT = PAGE_SHIFT - PTDESC_ORDER;
export const ENTRIES = 2 ** TABLE_SHIFT;
// ARM64_HW_PGTABLE_LEVEL_SHIFT(n) = TABLE_SHIFT * (4 - n) + PTDESC_ORDER, Arm 단계 0..3
export const SHIFTS = [0, 1, 2, 3].map((n) => TABLE_SHIFT * (4 - n) + PTDESC_ORDER);
// 리눅스 이름: pgd(단계 0, p4d는 접혀 같은 항목), pud(1), pmd(2), pte(3)
export const LINUX_NAMES = ["pgd", "pud", "pmd", "pte"];

// truth/scenario.txt (setarch -R로 고정한 배치, 실행 1회): 두 페이지와 그 안에서 만진 바이트
export const PAGES = {
  p0: { va: 0xfffff78000a8 },
  p1: { va: 0xfffff79000a8 },
};
// 같은 실행의 pagemap PFN. ZERO는 공용 zero page(kpageflags ZERO_PAGE), 나머지는 새 익명 페이지
export const PFN = { zero: 0x72553, p0: 0xbe291, p1: 0xbe292 };
// 프로브가 차례로 한 접근 네 번과 각 접근의 minor fault 수(perf, getrusage, /proc/self/stat 모두 같은 값)
export const ACCESSES = [
  { op: "read", page: "p0", faults: 1 },
  { op: "write", page: "p0", faults: 1 },
  { op: "write", page: "p1", faults: 1 },
  { op: "read", page: "p1", faults: 0 },
];

// 주소 하나를 단계별 색인 4개와 페이지 안 오프셋으로 나눈다 (pgd_index, pud_index, pmd_index, pte_index)
// VA는 2^53보다 작아 나눗셈으로 정확히 계산된다 (JS 비트 연산은 32비트라 쓰지 않는다)
export function indexOf(va, level) {
  return Math.floor(va / 2 ** SHIFTS[level]) % ENTRIES;
}
export function split(va) {
  return { index: [0, 1, 2, 3].map((n) => indexOf(va, n)), offset: va % 2 ** PAGE_SHIFT };
}
export function bitsOf(va) {
  // 비트 47..0, 그림의 키 48개 (왼쪽이 47)
  return Array.from({ length: VA_BITS }, (_, i) => Math.floor(va / 2 ** (VA_BITS - 1 - i)) % 2);
}
export const hex = (n, width = 0) => n.toString(16).padStart(width, "0");

// STATE: 지금 이 순간 전부.
//   tables[n]: 걷기 경로 위 단계 n 테이블의 항목들 { 색인: 항목 }. null이면 그 테이블이 아직 없다.
//     항목은 { kind: "table" } 또는 { kind: "page", pfn, rw, zero }.
//   처음 상태는 ftrace로 정했다: access 1에서 __pte_alloc만 불리고 __pud_alloc, __pmd_alloc은 불리지 않았으니
//   L0, L1 항목은 있고 L2 항목은 비었으며 L3 테이블은 없다.
//   tlb: 캐시된 변환 카드. 측정하지 않았다(PMU 없음). 아키텍처가 정한 규칙만 따른다(아래 step 주석).
//   at: { i: 접근 번호, stage: "tlb" | 0..3 (걷는 단계) | "kernel" }, fault: 처리 중인 fault, last: 방금 한 일
export function makeState() {
  const { index } = split(PAGES.p0.va);
  return {
    at: { i: 0, stage: "tlb" },
    tables: [{ [index[0]]: { kind: "table" } }, { [index[1]]: { kind: "table" } }, {}, null],
    tlb: [],
    faults: 0,
    fault: null,
    retry: false,
    last: null,
    done: false,
  };
}

const access = (s) => ACCESSES[s.at.i];
const vaOf = (s) => PAGES[access(s).page].va;
const paOf = (pfn, va) => pfn * 2 ** PAGE_SHIFT + (va % 2 ** PAGE_SHIFT);
const copyTables = (t) => t.map((tab) => (tab ? { ...tab } : null));

// 접근 하나가 끝나면 다음 접근의 TLB 조회로 넘어간다
function finish(s, next) {
  const i = s.at.i + 1;
  return { ...next, at: { i: Math.min(i, ACCESSES.length - 1), stage: "tlb" }, retry: false, done: i >= ACCESSES.length };
}

// STEP: 호출 1회 = 하드웨어나 커널의 최소 동작 1회
//   "tlb": TLB 조회 1회. 카드가 있으면 hit. 읽기 전용 카드에 쓰면 permission fault(단계 3)
//   0..3: 그 단계 테이블 항목 하나를 읽는다. 비었으면 translation fault(그 단계)
//   "kernel": 커널이 fault를 고치는 동작 1회(L3 테이블 만들기, 항목 쓰기, 복사 후 다시 쓰기)
// 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(s) {
  if (s.done) return s;
  const a = access(s);
  const va = vaOf(s);
  const { index } = split(va);
  const page = Math.floor(va / 2 ** PAGE_SHIFT);
  const base = { ...s, tables: copyTables(s.tables), tlb: s.tlb.map((c) => ({ ...c })) };

  if (s.at.stage === "tlb") {
    const card = base.tlb.find((c) => c.page === page);
    if (card && (a.op === "read" || card.rw)) {
      // TLB hit: 걷지 않고 PA를 낸다 (가정: 걷기에 성공한 결과가 아직 남아 있다)
      return finish(s, { ...base, last: { i: s.at.i, kind: "tlb-hit", pfn: card.pfn, rw: card.rw, pa: paOf(card.pfn, va) } });
    }
    if (card) {
      // 읽기 전용 변환에 쓰기: permission fault, 단계 3 (항목은 L3에서 왔다)
      const fault = { type: "permission", level: 3 };
      return { ...base, at: { ...s.at, stage: "kernel" }, fault, last: { i: s.at.i, kind: "fault", via: "tlb", ...fault } };
    }
    return { ...base, at: { ...s.at, stage: 0 }, last: { i: s.at.i, kind: "tlb-miss", retry: s.retry } };
  }

  if (typeof s.at.stage === "number") {
    const n = s.at.stage;
    const entry = base.tables[n] && base.tables[n][index[n]];
    if (!entry) {
      // Arm: 걷기는 처음 만난 빈 항목에서 멈추고 그 단계를 알린다. 빈 항목은 TLB에 남지 않는다
      const fault = { type: "translation", level: n };
      return { ...base, at: { ...s.at, stage: "kernel" }, fault, last: { i: s.at.i, kind: "fault", via: "walk", ...fault, index: index[n] } };
    }
    if (entry.kind === "table") {
      return { ...base, at: { ...s.at, stage: n + 1 }, last: { i: s.at.i, kind: "walk", level: n, index: index[n], entry: "table" } };
    }
    if (a.op === "write" && !entry.rw) {
      const fault = { type: "permission", level: n };
      return { ...base, at: { ...s.at, stage: "kernel" }, fault, last: { i: s.at.i, kind: "fault", via: "walk", ...fault, index: index[n] } };
    }
    // 걷기 성공: 결과를 TLB에 둔다 (아키텍처는 둘 수 있다고만 한다. 그림은 늘 둔다고 가정)
    base.tlb = base.tlb.filter((c) => c.page !== page).concat([{ page, pfn: entry.pfn, rw: entry.rw }]);
    const last = { i: s.at.i, kind: "walk", level: n, index: index[n], entry: "page", pfn: entry.pfn, rw: entry.rw, zero: entry.zero, pa: paOf(entry.pfn, va) };
    return finish(s, { ...base, last });
  }

  // kernel: 하나씩 고친다 (handle_pte_fault 분기 순서)
  const f = s.fault;
  if (f.type === "translation" && f.level < 3) {
    // do_anonymous_page -> pte_alloc -> __pte_alloc: 페이지 한 장을 L3 테이블로 걸고 L2 항목을 채운다
    // (L0, L1이 비는 경우는 이 시나리오에 없다: __pud_alloc, __pmd_alloc이 불리지 않았다)
    if (f.level !== 2) throw new Error(`unexpected translation fault at level ${f.level}`);
    base.tables[3] = {};
    base.tables[2][index[2]] = { kind: "table" };
    return { ...base, fault: { type: "translation", level: 3 }, last: { i: s.at.i, kind: "kernel", did: "table", level: 3, index: index[2] } };
  }
  let entry;
  let did;
  if (f.type === "translation") {
    // do_anonymous_page: 읽기면 zero page를 읽기 전용으로, 쓰기면 0으로 채운 새 페이지를 쓰기 가능으로 건다
    entry = a.op === "read" ? { kind: "page", pfn: PFN.zero, rw: false, zero: true } : { kind: "page", pfn: PFN[a.page], rw: true, zero: false };
    did = a.op === "read" ? "zero" : "new";
  } else {
    // do_wp_page -> wp_page_copy: zero page는 재사용할 수 없다. 0으로 채운 새 페이지를 받고
    // ptep_clear_flush로 옛 항목과 그 TLB 항목을 지운 뒤 새 항목을 쓰기 가능으로 건다
    const old = base.tables[3][index[3]];
    if (!old || !old.zero) throw new Error("permission fault without a zero page entry");
    entry = { kind: "page", pfn: PFN[a.page], rw: true, zero: false };
    did = "cow";
    base.tlb = base.tlb.filter((c) => c.page !== page);
  }
  base.tables[3][index[3]] = entry;
  // mm_account_fault: 처리가 끝난 fault 하나를 센다. 같은 명령을 다시 실행한다(재시도)
  return {
    ...base,
    at: { ...s.at, stage: "tlb" },
    faults: s.faults + 1,
    fault: null,
    retry: true,
    last: { i: s.at.i, kind: "kernel", did, level: 3, index: index[3], pfn: entry.pfn, rw: entry.rw },
  };
}

export function trace() {
  const out = [makeState()];
  while (!out[out.length - 1].done) {
    out.push(step(out[out.length - 1]));
    if (out.length > 200) throw new Error("trace does not end");
  }
  return out;
}

// 접근 하나가 끝난 직후의 상태들 (check.mjs가 fault 수를 접근별로 대조한다)
export function accessEnds(t = trace()) {
  return t.filter((s, i) => i > 0 && (s.done || s.at.i !== t[i - 1].at.i));
}

const rwText = (rw) => (rw ? "rw" : "ro");
// 리드아웃: "{op} {page} | {방금 한 일} | faults {n}". 방금 한 일의 접근 번호는 last.i에 있다
export function readout(s) {
  const prev = s.last;
  const a = ACCESSES[prev ? prev.i : 0];
  const head = `${a.op} ${a.page}`;
  const tail = `faults ${s.faults}`;
  if (!prev) return `${head} | entry | ${tail}`;
  const L = (n, i) => `L${n}[${i}]`;
  switch (prev.kind) {
    case "tlb-miss":
      return `${head} | ${prev.retry ? "retry, " : ""}TLB miss | ${tail}`;
    case "tlb-hit":
      return `${head} | TLB hit, PA 0x${hex(prev.pa)} | ${tail}`;
    case "walk":
      if (prev.entry === "table") return `${head} | ${L(prev.level, prev.index)} table | ${tail}`;
      return `${head} | ${L(prev.level, prev.index)} PA 0x${hex(prev.pa)} ${rwText(prev.rw)} | ${tail}`;
    case "fault":
      if (prev.via === "tlb") return `${head} | TLB hit ro, permission fault | ${tail}`;
      return `${head} | ${L(prev.level, prev.index)} empty, translation fault | ${tail}`;
    case "kernel":
      if (prev.did === "table") return `${head} | kernel: new L3 table | ${tail}`;
      if (prev.did === "zero") return `${head} | kernel: L3[${prev.index}] zero page ro | ${tail}`;
      if (prev.did === "new") return `${head} | kernel: L3[${prev.index}] PFN 0x${hex(prev.pfn)} rw | ${tail}`;
      return `${head} | kernel: zero page to PFN 0x${hex(prev.pfn)} rw | ${tail}`;
    default:
      throw new Error(`unknown step ${prev.kind}`);
  }
}
