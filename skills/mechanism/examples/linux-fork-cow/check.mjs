// node check.mjs: model.mjs를 커밋한 실측(truth/)과 대조한다. 오프라인으로 돌고, 실패하면 exit 1
// 커널 원문 대조는 따로 한다: bash truth/fetch-kernel.sh && node check-source.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "truth", name), "utf8");

// ---- cow_probe 로그 읽기 ----
function parseRun(lines) {
  const run = { states: [], events: [], pendingChild: null };
  for (const line of lines) {
    let m;
    if ((m = line.match(/^probe npages=(\d+) page_size=(\d+) fault_cpu=(\d+) run_cpu=(\d+)/))) {
      Object.assign(run, { npages: +m[1], pageSize: +m[2], faultCpu: +m[3], runCpu: +m[4] });
    } else if ((m = line.match(/^event (parent|child) write page=(\d+) value=([0-9a-f]+) minflt_delta=(\d+) cpu=(\d+)/))) {
      run.events.push({ who: m[1], page: +m[2], value: parseInt(m[3], 16), minflt: +m[4], cpu: +m[5] });
    } else if ((m = line.match(/^event parent first touch pages=(\d+) minflt_delta=(\d+) cpu=(\d+)/))) {
      run.firstTouch = { pages: +m[1], minflt: +m[2], cpu: +m[3] };
    } else if ((m = line.match(/^event fork child=(\d+) cpu=(\d+)/))) {
      run.fork = { child: +m[1], cpu: +m[2] };
    } else if ((m = line.match(/^state (\S+)/))) {
      run.states.push({ label: m[1], pages: { parent: [], child: [] }, smaps: { parent: {}, child: {} }, bytes: {} });
      if (run.pendingChild) run.states.at(-1).bytes.child = run.pendingChild;
      run.pendingChild = null;
    } else if ((m = line.match(/^page (parent|child) (\d+) present=1 pfn=0x([0-9a-f]+) exclusive=(\d) soft_dirty=\d kpagecount=(\d+) anon=(\d) lru=(\d) thp=(\d) ksm=(\d)/))) {
      run.states.at(-1).pages[m[1]][+m[2]] = { pfn: parseInt(m[3], 16), exclusive: +m[4], count: +m[5], anon: +m[6], lru: +m[7], thp: +m[8], ksm: +m[9] };
    } else if ((m = line.match(/^smaps (parent|child) (\w+) (.*)$/))) {
      run.states.at(-1).smaps[m[1]][m[2]] = m[3].trim();
    } else if ((m = line.match(/^bytes (parent|child) (.*)$/))) {
      const bytes = m[2].trim().split(" ").map((b) => parseInt(b, 16));
      if (m[1] === "child") run.pendingChild = bytes;
      else run.states.at(-1).bytes.parent = bytes;
    }
  }
  return run;
}
const runsIn = (text) => {
  const out = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^run (main|split) (\d+)$/);
    if (m) out.push((cur = { name: m[1], lines: [] }));
    else if (cur) cur.lines.push(line);
  }
  return out.map((r) => ({ name: r.name, ...parseRun(r.lines) }));
};
const kb = (text) => Number(text.replace(/ kB$/, ""));

// ---- 모델 상태와 실측 상태를 한 줄씩 대조 ----
const LABELS = ["entry", "fork", "child-write-0", "parent-write-0", "parent-write-1", "child-write-1", "child-write-0-again"];
function compare(run, input, tag) {
  const t = M.trace(input);
  assert.equal(run.npages, M.NPAGES, `${tag}: npages`);
  assert.equal(run.pageSize, M.PAGE_KB * 1024, `${tag}: page size`);
  assert.deepEqual(run.states.map((s) => s.label), LABELS, `${tag}: state labels`);
  assert.equal(t.length, run.states.length, `${tag}: trace length`);
  assert.deepEqual(run.events.map(({ who, page, value }) => ({ who, page, value })), M.WRITES, `${tag}: writes`);
  assert.deepEqual({ pages: run.firstTouch.pages, minflt: run.firstTouch.minflt }, { pages: M.NPAGES, minflt: M.NPAGES }, `${tag}: first touch`);
  t.forEach((s, i) => {
    const got = run.states[i];
    for (const who of ["parent", "child"]) {
      if (!s.pte[who]) {
        assert.equal(got.pages[who].length, 0, `${tag} ${got.label}: no ${who} yet`);
        continue;
      }
      for (let page = 0; page < M.NPAGES; page++) {
        const want = s.frames[s.pte[who][page].frame];
        const seen = got.pages[who][page];
        const at = `${tag} ${got.label} ${who} p${page}`;
        assert.equal(seen.pfn, want.pfn, `${at}: pfn`);
        assert.equal(seen.count, want.maps, `${at}: kpagecount = mapcount`);
        assert.equal(seen.exclusive, want.maps === 1 ? 1 : 0, `${at}: pagemap exclusive`);
        assert.deepEqual([seen.anon, seen.thp, seen.ksm], [1, 0, 0], `${at}: anon, no THP, no KSM`);
      }
      const sm = M.smapsOf(s, who);
      assert.equal(kb(got.smaps[who].Shared_Dirty), sm.shared, `${tag} ${got.label} ${who}: Shared_Dirty`);
      assert.equal(kb(got.smaps[who].Private_Dirty), sm.private, `${tag} ${got.label} ${who}: Private_Dirty`);
      assert.equal(kb(got.smaps[who].Rss), M.NPAGES * M.PAGE_KB, `${tag} ${got.label} ${who}: Rss`);
      assert.equal(kb(got.smaps[who].AnonHugePages), 0, `${tag} ${got.label} ${who}: AnonHugePages`);
      assert.equal(got.smaps[who].THPeligible, "0", `${tag} ${got.label} ${who}: THPeligible`);
      assert.match(got.smaps[who].VmFlags, /\bnh\b/, `${tag} ${got.label} ${who}: VmFlags nh (MADV_NOHUGEPAGE)`);
    }
    assert.deepEqual(got.bytes.parent, M.bytesOf(s, "parent"), `${tag} ${got.label}: parent bytes`);
    if (got.bytes.child) assert.deepEqual(got.bytes.child, M.bytesOf(s, "child"), `${tag} ${got.label}: child bytes`);
    if (i >= 2) assert.equal(run.events[i - 2].minflt, s.last.fault ? 1 : 0, `${tag} ${got.label}: minor faults of the write`);
  });
  return t;
}

const main = parseRun(read("cow-probe.log").split("\n"));
const split = parseRun(read("cow-probe-split.log").split("\n"));
assert.deepEqual([main.faultCpu, main.runCpu, split.faultCpu, split.runCpu], [3, 3, 3, 5]);
const T = compare(main, M.MAIN, "main");
const TS = compare(split, M.SPLIT, "split");

// 원래 페이지의 LRU 비트가 remoteBatch의 근거다: main은 fork 직후 모두 LRU, split은 매핑이 남은 동안 끝까지 배치 안
main.states[1].pages.parent.forEach((p, page) => assert.equal(p.lru, 1, `main fork p${page}: lru`));
split.states.forEach((st) =>
  ["parent", "child"].forEach((who) =>
    st.pages[who].forEach((p, page) => {
      if (M.SPLIT.first.includes(p.pfn)) assert.equal(p.lru, 0, `split ${st.label} ${who} p${page}: original still in CPU 3 batch`);
    }),
  ),
);

// 결과 패턴: 부모와 자식이 한 번씩 복사하고 한 번씩 재사용, 마지막 쓰기는 폴트 없음 (main)
const actions = (t) => t.slice(2).map((s) => s.last.action);
assert.deepEqual(actions(T), ["copy", "reuse", "copy", "reuse", "none"]);
assert.deepEqual(actions(TS), ["copy", "copy", "copy", "copy", "none"]);
// 판정 때의 참조 수: main은 혼자 매핑한 페이지가 1, split은 CPU 3 배치의 참조가 하나 더 있어 혼자 매핑해도 2
// (공유 중이면 3: wp_can_reuse_anon_folio의 "3 초과면 바로 포기"에는 걸리지 않고 끝 조건에서 떨어진다)
assert.deepEqual(T.slice(2).map((s) => s.last.refs), [2, 1, 2, 1, 1]);
assert.deepEqual(TS.slice(2).map((s) => s.last.refs), [3, 2, 3, 2, 1]);

// 반복 실행 5회씩: PFN이 바뀌었는지와 폴트 수로 본 결과가 매번 같다
const outcome = (run) =>
  run.events.map((e, i) => {
    const before = run.states[i + 1].pages[e.who][e.page].pfn;
    const after = run.states[i + 2].pages[e.who][e.page].pfn;
    return e.minflt === 0 ? "none" : before === after ? "reuse" : "copy";
  });
const repeats = runsIn(read("repeats.log"));
assert.equal(repeats.length, 10);
for (const r of repeats) assert.deepEqual(outcome(r), actions(r.name === "main" ? T : TS), `repeat ${r.name}`);
assert.deepEqual(outcome(main), actions(T));
assert.deepEqual(outcome(split), actions(TS));

// ---- ftrace: 쓰기 한 번의 구간마다 어느 길로 갔는지 ----
function brackets(text) {
  const out = [];
  let cur = null;
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*cow_probe-(\d+)\s+\[(\d+)\].*?: (.*)$/);
    if (!m) continue;
    const [, pid, cpu, rest] = m;
    const mark = rest.match(/^tracing_mark_write: cow_probe: (begin|end) (.*)$/);
    if (mark && mark[1] === "begin") cur = { what: mark[2], pid: +pid, cpu: +cpu, calls: [] };
    else if (mark && cur) (out.push(cur), (cur = null));
    else if (cur && +pid === cur.pid) cur.calls.push(rest.split(" <-")[0]);
  }
  return out;
}
function checkTrace(text, run, t, tag) {
  const b = brackets(text);
  assert.deepEqual(
    b.map((x) => x.what),
    ["first touch", "fork", ...M.WRITES.map((w) => `${w.who} write page ${w.page}`)],
    `${tag}: brackets`,
  );
  const count = (x, name) => x.calls.filter((c) => c === name).length;
  // 첫 쓰기: 페이지마다 익명 폴트 한 번, 새 folio는 LRU 배치로
  assert.equal(count(b[0], "handle_mm_fault"), M.NPAGES);
  assert.equal(count(b[0], "folio_add_lru"), M.NPAGES);
  assert.equal(count(b[1], "kernel_clone"), 1);
  assert.equal(count(b[1], "dup_mmap"), 1);
  b.slice(2).forEach((x, i) => {
    const s = t[i + 2];
    const at = `${tag} ${x.what}`;
    assert.equal(x.pid, s.last.who === "parent" ? b[0].pid : run.fork.child, `${at}: pid`);
    assert.equal(count(x, "handle_mm_fault"), s.last.fault ? 1 : 0, `${at}: faults`);
    assert.equal(count(x, "do_wp_page"), s.last.fault ? 1 : 0, `${at}: do_wp_page`);
    const copied = ["copy_user_highpage", "ptep_clear_flush", "folio_add_new_anon_rmap", "folio_add_lru_vma", "folio_remove_rmap_ptes"];
    copied.forEach((name) => assert.equal(count(x, name), s.last.action === "copy" ? 1 : 0, `${at}: ${name}`));
    assert.equal(count(x, "folio_move_anon_rmap"), s.last.action === "reuse" ? 1 : 0, `${at}: folio_move_anon_rmap (reuse)`);
  });
  return b;
}
const BM = checkTrace(read("ftrace-main.txt"), main, T, "main");
const BS = checkTrace(read("ftrace-split.txt"), split, TS, "split");
// fork가 복제한 VMA 수 (truth/kernel-refs.md에 적은 값)
assert.equal(BM[1].calls.filter((c) => c === "copy_page_range").length, M.FORK_VMAS);
assert.ok(read("kernel-refs.md").includes(`커밋한 실행에서 ${M.FORK_VMAS}번`));
// split: 쓰기 폴트마다 페이지가 LRU에 없어 지금 CPU(5)의 배치를 비우지만, 그래도 복사한다
BS.slice(2, 6).forEach((x) => {
  assert.equal(x.cpu, 5);
  assert.ok(x.calls.includes("lru_add_drain") && x.calls.includes("copy_user_highpage"), `split ${x.what}: drain, then copy`);
});
// fork 구간: 부모 자신의 COW 폴트(fork 뒤 스택, 힙 쓰기)가 지금 CPU의 배치를 한 번 비운다.
// main은 그 CPU가 첫 쓰기를 한 CPU 3이라 원래 페이지가 LRU로 갔고, split은 CPU 5라 CPU 3 배치가 남았다
assert.deepEqual([BM[1].cpu, BM[1].calls.includes("lru_add_drain")], [3, true]);
assert.deepEqual([BS[1].cpu, BS[1].calls.includes("lru_add_drain")], [5, true]);
// main: 판정 때 페이지가 이미 LRU에 있어 배치를 비우지 않는다
BM.slice(2, 6).forEach((x) => assert.ok(!x.calls.includes("lru_add_drain"), `main ${x.what}: no drain`));

// ---- 실행 환경 ----
const env = read("env.txt");
for (const want of ["7.0.14-linuxkit", "aarch64", "CONFIG_ARM64_4K_PAGES=y", "CONFIG_PAGE_MAPCOUNT=y", "CONFIG_TRANSPARENT_HUGEPAGE=y", "thp_enabled [always] madvise never", "ksm_run 0", "nproc 11"]) {
  assert.ok(env.includes(want), `env.txt: ${want}`);
}

// ---- 모델 자체 ----
// STEP은 입력 state를 바꾸지 않는다
for (const s of T) {
  const before = JSON.stringify(s);
  M.step(s);
  assert.equal(JSON.stringify(s), before);
}
// done 상태의 STEP은 아무것도 바꾸지 않는다
assert.equal(M.step(T.at(-1)), T.at(-1));
// 끝까지 공유로 남는 것은 아무도 쓰지 않은 페이지 2뿐이다
assert.deepEqual([M.pfnOf(T.at(-1), "parent", 2), M.pfnOf(T.at(-1), "child", 2)], [M.MAIN.first[2], M.MAIN.first[2]]);

// 그림의 리드아웃은 이 문자열과 같아야 한다
assert.deepEqual(T.map(M.readout), [
  "entry | 3 pages rw | private 12 kB",
  "fork | 6 PTEs ro | shared 12 kB",
  "child p0 | fault, copy | 0xb579a → 0x7a665",
  "parent p0 | fault, reuse | 0xb579a",
  "parent p1 | fault, copy | 0xf399a → 0xf404c",
  "child p1 | fault, reuse | 0xf399a",
  "child p0 | no fault | 0x7a665",
]);

console.log(`model check passed: ${M.NPAGES} pages, ${M.WRITES.length} writes, main ${actions(T).join(" ")}, split ${actions(TS).join(" ")}, ${repeats.length} repeats`);
