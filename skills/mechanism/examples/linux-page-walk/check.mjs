// node check.mjs: model.mjs를 truth/의 실측 기록(Linux 7.0.14 linuxkit, arm64)과 대조한다 (실패하면 exit 1)
// 오프라인으로 돈다. 커널 원문 대조는 check-source.mjs가 따로 한다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "truth", name), "utf8");

// 1. 구성: 4 KiB 페이지, 48비트 VA, 4단 (truth/config.txt)
const config = read("config.txt");
assert.match(config, /^pagesize: 4096$/m);
assert.match(config, /^CONFIG_ARM64_4K_PAGES=y$/m);
assert.match(config, new RegExp(`^CONFIG_ARM64_VA_BITS=${M.VA_BITS}$`, "m"));
assert.match(config, new RegExp(`^CONFIG_PGTABLE_LEVELS=${M.LEVELS}$`, "m"));
assert.match(config, /^thp enabled: \[always\] madvise never$/m);
assert.equal(2 ** M.PAGE_SHIFT, 4096);
// pgtable-hwdef.h의 식을 풀면 39, 30, 21, 12이고, 9비트 4단에 12비트 오프셋이 48비트를 채운다
assert.deepEqual(M.SHIFTS, [39, 30, 21, 12]);
assert.equal(M.ENTRIES, 512);
assert.equal(M.TABLE_SHIFT * M.LEVELS + M.PAGE_SHIFT, M.VA_BITS);
assert.equal(M.LINUX_NAMES.length, M.LEVELS);

// 2. 주소 분해: 프로브가 같은 시프트로 계산해 찍은 값과 모델의 계산이 같다
const scenario = read("scenario.txt");
for (const [page, { va }] of Object.entries(M.PAGES)) {
  const m = scenario.match(new RegExp(`^split ${page} va 0x([0-9a-f]+) l0 (\\d+) l1 (\\d+) l2 (\\d+) l3 (\\d+) offset 0x([0-9a-f]+)$`, "m"));
  assert.ok(m, `split line for ${page}`);
  assert.equal(parseInt(m[1], 16), va);
  const { index, offset } = M.split(va);
  assert.deepEqual(index, m.slice(2, 6).map(Number), `${page} indexes`);
  assert.equal(offset, parseInt(m[6], 16));
  // 키 48개를 다시 읽으면 같은 주소다
  assert.equal(M.bitsOf(va).reduce((acc, b) => acc * 2 + b, 0), va);
}
// p0과 p1은 같은 2 MiB 영역(L0, L1, L2 색인이 같다)의 서로 다른 L3 항목이다
const [i0, i1] = [M.split(M.PAGES.p0.va).index, M.split(M.PAGES.p1.va).index];
assert.deepEqual(i0.slice(0, 3), i1.slice(0, 3));
assert.notEqual(i0[3], i1[3]);
// 그 영역에는 이 VMA와 PROT_NONE 예약뿐이다 (truth/scenario.txt의 maps 줄)
const maps = [...scenario.matchAll(/^maps ([0-9a-f]+)-([0-9a-f]+) (\S+)/gm)].map((m) => [parseInt(m[1], 16), parseInt(m[2], 16), m[3]]);
assert.deepEqual(maps.map((m) => m[2]), ["rw-p", "---p"]);
assert.equal(maps[0][0] % 2 ** M.SHIFTS[2], 0, "region starts on a 2 MiB boundary");
assert.equal(maps[1][0], maps[0][1], "the reservation starts where the rw VMA ends");
assert.ok(maps[1][1] - maps[0][0] >= 2 ** M.SHIFTS[2], "rw VMA plus reservation cover the whole 2 MiB region");

// 3. 접근별 실측: PFN, zero page 여부, minor fault 수 (perf, getrusage, /proc/self/stat)
const lines = [...scenario.matchAll(/^access (\d) (read|write) (p\d) va 0x([0-9a-f]+) \| before present (\d) pfn 0x([0-9a-f]+) \| after present (\d) pfn 0x([0-9a-f]+) kpageflags 0x[0-9a-f]+ zero_page (\d) anon (\d) \| minor-faults perf (\d+) rusage (\d+) stat (\d+)$/gm)];
assert.equal(lines.length, M.ACCESSES.length);
const t = M.trace();
const ends = M.accessEnds(t);
let before = 0;
lines.forEach((m, k) => {
  const a = M.ACCESSES[k];
  assert.equal(m[2], a.op);
  assert.equal(m[3], a.page);
  assert.equal(parseInt(m[4], 16), M.PAGES[a.page].va);
  const [perf, ru, st] = [m[11], m[12], m[13]].map(Number);
  assert.equal(perf, a.faults, `access ${k + 1} perf`);
  assert.equal(ru, a.faults, `access ${k + 1} getrusage`);
  assert.equal(st, a.faults, `access ${k + 1} /proc/self/stat`);
  // 모델: 그 접근에서 커널이 센 fault 수
  assert.equal(ends[k].faults - before, a.faults, `access ${k + 1} model faults`);
  before = ends[k].faults;
  // 모델: 접근이 끝났을 때 L3 항목의 PFN과 zero page 여부
  const entry = ends[k].tables[3][M.split(M.PAGES[a.page].va).index[3]];
  assert.equal(Number(m[7]), 1, `access ${k + 1} present after`);
  assert.equal(entry.pfn, parseInt(m[8], 16), `access ${k + 1} pfn`);
  assert.equal(entry.zero ? 1 : 0, Number(m[9]), `access ${k + 1} zero_page`);
  assert.equal(entry.zero ? 0 : 1, Number(m[10]), `access ${k + 1} anon`);
});
assert.equal(parseInt(lines[0][8], 16), M.PFN.zero);
assert.equal(Number(lines[0][5]), 0, "p0 not present before the first touch");
assert.equal(Number(lines[2][5]), 0, "p1 not present before the first touch");

// 4. ftrace (함수 트레이서, 이 pid만): 접근마다 커널이 한 일
const ftrace = read("ftrace.txt");
const blocks = ftrace.split(/tracing_mark_write: /).slice(1).map((b) => ({ head: b.split("\n")[0], body: b }));
const calls = (k) => {
  const block = blocks.find((b) => b.head.startsWith(`access ${k + 1} `));
  assert.ok(block, `ftrace block for access ${k + 1}`);
  return [...block.body.matchAll(/: (\w+) <-/g)].map((m) => m[1]);
};
const stackHas = (k, fn) => blocks.find((b) => b.head.startsWith(`access ${k + 1} `)).body.includes(`=> ${fn}\n`);
assert.ok(!/__pud_alloc|__pmd_alloc/.test(ftrace), "L0 and L1 entries already existed");
M.ACCESSES.forEach((a, k) => {
  const did = t.filter((s) => s.last && s.last.i === k && s.last.kind === "kernel").map((s) => s.last.did);
  const fault = t.find((s) => s.last && s.last.i === k && s.last.kind === "fault");
  const c = calls(k);
  assert.equal(c.filter((f) => f === "handle_mm_fault").length, a.faults, `access ${k + 1} handle_mm_fault`);
  assert.equal(c.includes("__pte_alloc"), did.includes("table"), `access ${k + 1} __pte_alloc`);
  assert.equal(c.includes("do_wp_page"), did.includes("cow"), `access ${k + 1} do_wp_page`);
  // zero page를 걸 때는 페이지를 받지 않는다. 새 페이지와 복사는 0으로 채운 페이지를 받는다
  assert.equal(c.includes("vma_alloc_zeroed_movable_folio"), did.includes("new") || did.includes("cow"), `access ${k + 1} zeroed folio`);
  // fault_info: translation fault는 do_translation_fault를 거치고 permission fault는 바로 do_page_fault로 간다
  if (fault) {
    assert.equal(stackHas(k, "do_translation_fault"), fault.last.type === "translation", `access ${k + 1} fault type`);
    for (const fn of ["do_page_fault", "do_mem_abort", "el0_da"]) assert.ok(stackHas(k, fn), `access ${k + 1} ${fn}`);
  }
});

// 5. 대조 실험: 512쪽 영역에서 쪽마다 fault 하나, 읽기만 하면 512쪽이 모두 같은 zero page
const controls = read("controls.txt");
assert.match(controls, /^control write-only nohugepage 1 pages 512 \| read faults 0 \| write faults 512 \|/m);
assert.match(controls, /^control read-then-write nohugepage 1 pages 512 \| read faults 512 \| write faults 512 \|/m);
assert.match(controls, new RegExp(`^control read-only nohugepage 1 pages 512 \\| read faults 512 \\| same pfn 0x${M.hex(M.PFN.zero)} on 512 pages \\| zero_page 512$`, "m"));
// THP를 끄지 않은 영역은 2 MiB 페이지 하나(fault 1) 또는 실패 후 4 KiB 512장(fault 512) 중 하나다
const thp = controls.match(/^control thp-default nohugepage 0 pages 512 \| read faults 0 \| write faults (\d+) \| pfn contiguous (\d) \| zero_page 0 \| thp (\d+) \| vmstat thp_fault_alloc \+(\d+) thp_fault_fallback \+(\d+)$/m);
assert.ok(thp && ((thp[1] === "1" && thp[3] === "512") || (thp[1] === "512" && thp[3] === "0" && Number(thp[5]) >= 1)), "thp control");

// 6. perf stat의 프로세스 전체 minor-faults: 512쪽을 만지면 중앙값이 512 늘어난다
const perf = read("perf-touch.txt");
const runs = (n) => [...perf.matchAll(new RegExp(`touch ${n} \\(run \\d\\)\\n(\\d+),,minor-faults`, "g"))].map((m) => Number(m[1])).sort((a, b) => a - b);
const median = (xs) => xs[Math.floor(xs.length / 2)];
assert.equal(runs(0).length, 5);
assert.equal(median(runs(512)) - median(runs(0)), 512);

// 7. STEP은 입력 state를 바꾸지 않고, done에서는 그대로다
const s0 = M.makeState();
const snap = JSON.stringify(s0);
M.step(s0);
assert.equal(JSON.stringify(s0), snap);
t.forEach((s) => {
  const j = JSON.stringify(s);
  M.step(s);
  assert.equal(JSON.stringify(s), j);
});
assert.equal(M.step(t.at(-1)), t.at(-1));

// 8. 아키텍처 규칙: TLB에는 걷기에 성공한 변환만 있고, 복사 뒤에는 옛 변환이 없다
t.forEach((s) => {
  for (const card of s.tlb) {
    const page = M.split(card.page * 2 ** M.PAGE_SHIFT).index[3];
    const entry = s.tables[3] && s.tables[3][page];
    assert.ok(entry && entry.pfn === card.pfn && entry.rw === card.rw, "TLB card matches the live L3 entry");
  }
});
// 걷기는 처음 만난 빈 항목에서 멈춘다: L2에서 한 번, L3에서 한 번
assert.deepEqual(t.filter((s) => s.last && s.last.kind === "fault").map((s) => `${s.last.type} L${s.last.level}`), ["translation L2", "permission L3", "translation L3"]);

// 9. 그림의 리드아웃은 이 문자열과 같아야 한다
assert.deepEqual(t.map(M.readout), [
  "read p0 | entry | faults 0",
  "read p0 | TLB miss | faults 0",
  "read p0 | L0[511] table | faults 0",
  "read p0 | L1[511] table | faults 0",
  "read p0 | L2[444] empty, translation fault | faults 0",
  "read p0 | kernel: new L3 table | faults 0",
  "read p0 | kernel: L3[0] zero page ro | faults 1",
  "read p0 | retry, TLB miss | faults 1",
  "read p0 | L0[511] table | faults 1",
  "read p0 | L1[511] table | faults 1",
  "read p0 | L2[444] table | faults 1",
  "read p0 | L3[0] PA 0x725530a8 ro | faults 1",
  "write p0 | TLB hit ro, permission fault | faults 1",
  "write p0 | kernel: zero page to PFN 0xbe291 rw | faults 2",
  "write p0 | retry, TLB miss | faults 2",
  "write p0 | L0[511] table | faults 2",
  "write p0 | L1[511] table | faults 2",
  "write p0 | L2[444] table | faults 2",
  "write p0 | L3[0] PA 0xbe2910a8 rw | faults 2",
  "write p1 | TLB miss | faults 2",
  "write p1 | L0[511] table | faults 2",
  "write p1 | L1[511] table | faults 2",
  "write p1 | L2[444] table | faults 2",
  "write p1 | L3[256] empty, translation fault | faults 2",
  "write p1 | kernel: L3[256] PFN 0xbe292 rw | faults 3",
  "write p1 | retry, TLB miss | faults 3",
  "write p1 | L0[511] table | faults 3",
  "write p1 | L1[511] table | faults 3",
  "write p1 | L2[444] table | faults 3",
  "write p1 | L3[256] PA 0xbe2920a8 rw | faults 3",
  "read p1 | TLB hit, PA 0xbe2920a8 | faults 3",
]);

console.log(`model check passed: ${t.length - 1} steps, ${M.ACCESSES.length} accesses, ${t.at(-1).faults} faults, shifts ${M.SHIFTS.join("/")}`);
