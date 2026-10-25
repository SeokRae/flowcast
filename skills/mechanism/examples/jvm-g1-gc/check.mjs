// node check.mjs: model.mjs를 truth/의 실측(Corretto 21.0.1, G1)과 대조한다 (실패하면 exit 1)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "truth", name), "utf8");
const log = read("gc.log").split("\n");
const probe = read("probe.txt").split("\n");
const flags = read("flags.txt");
const cds = read("cds-heap.txt");

// ---- 대상 버전과 플래그 ----
assert.match(read("java-version.txt"), /Corretto-21\.0\.1\.12\.1 \(build 21\.0\.1\+12-LTS\)/);
const flag = (name) => Number(flags.match(new RegExp(`\\b${name}\\s+= (\\d+)`))[1]);
assert.equal(flag("G1HeapRegionSize"), M.REGION_BYTES);
assert.equal(flag("MaxHeapSize") / flag("G1HeapRegionSize"), M.REGIONS);
assert.equal(flag("MaxTenuringThreshold"), M.MAX_TENURING);
assert.equal(flag("TargetSurvivorRatio"), M.TARGET_SURVIVOR_RATIO);
assert.equal(flag("ParallelGCThreads"), 1);
assert.ok(log.some((l) => l.includes("Heap Region Size: 1M")));
assert.ok(log.some((l) => l.includes("Using G1")));

// ---- 블록 크기: 영역 하나에 4개, 영역 절반보다 작아 humongous가 아니다 ----
assert.equal(Number(probe[0].match(/block_bytes (\d+)/)[1]), M.BLOCK_BYTES);
assert.equal(M.REGION_BYTES / M.BLOCK_BYTES, M.SLOTS);
assert.ok(M.BLOCK_BYTES < M.REGION_BYTES / 2);

// ---- 로그 쪼개기: pause 번호별 줄, pause 밖 줄 ----
const BASE = BigInt(log.find((l) => l.includes("Heap address:")).match(/Heap address: (0x[0-9a-f]+)/)[1]);
const regionOf = (hex) => Number((BigInt(hex) - BASE) >> 20n);
const offsetOf = (hex) => Number((BigInt(hex) - BASE) & 0xfffffn);
const pause = (g) => log.filter((l) => l.includes(`GC(${g})`));
const hr = (l) => l.match(/G1HR (\w+)\((\w+)\) \[(0x[0-9a-f]+)/);
// pause 밖의 ALLOC 줄을 구간별로: 구간 e = GC(e-1)이 끝나고 GC(e)가 시작하기 전
const periods = [[]];
for (const l of log) {
  if (/GC\(\d+\) Pause Young .*ms$/.test(l)) periods.push([]);
  const m = hr(l);
  if (m && !/GC\(\d+\)/.test(l) && m[1] === "ALLOC") periods.at(-1).push({ type: m[2], region: regionOf(m[3]) });
}

// ---- CDS 아카이브 힙: 첫 Eden 전에 맨 위 두 영역이 Old, CDS를 끄면 Old 0개 ----
assert.deepEqual(periods[0].filter((a) => a.type === "OLD").map((a) => a.region), M.CDS_REGIONS);
assert.equal(Number(cds.match(/size =\s+(\d+) bytes/)[1]), M.CDS_BYTES);
assert.ok(M.CDS_BYTES > M.REGION_BYTES && M.CDS_BYTES <= M.REGION_BYTES * M.CDS_REGIONS.length);
assert.match(cds, /GC\(0\) Old regions: 0->0/);

// ---- 모델 실행 ----
const T = M.trace();
const s0 = M.makeState();
const before = JSON.stringify(s0);
M.step(s0);
assert.equal(JSON.stringify(s0), before, "step must not mutate its input");
assert.equal(M.step(T.at(-1)), T.at(-1), "done state stays put");
const ends = T.filter((s) => s.last && s.last.kind === "end");
assert.equal(ends.length, M.PERIODS.length);

// ---- Eden 할당: 구간마다 영역 번호와 순서 (young은 빈 영역 목록 위쪽 끝에서) ----
M.PERIODS.forEach((_, e) => {
  const want = periods[e].filter((a) => a.type === "EDEN").map((a) => a.region);
  const got = T.filter((s) => s.last && s.last.kind === "alloc" && s.last.gc === e).map((s) => s.last.region);
  assert.deepEqual(got, want, `Eden regions of period ${e}`);
});

// ---- 할당 주소: 영역 안 블록 순서가 PERIODS와 같다 (boot은 첫 영역 앞머리의 작은 객체 자리) ----
const allocs = probe.filter((l) => l.startsWith("alloc")).map((l) => {
  const m = l.match(/alloc epoch (\d+) addr (0x[0-9a-f]+) (?:name (\w)|garbage)/);
  return { epoch: Number(m[1]), region: regionOf(m[2]), offset: offsetOf(m[2]), name: m[3] ?? "g" };
});
M.PERIODS.forEach((regions, e) => {
  const edens = T.filter((s) => s.last && s.last.kind === "alloc" && s.last.gc === e).map((s) => s.last.region);
  regions.forEach((names, i) => {
    const got = allocs.filter((a) => a.epoch === e && a.region === edens[i]).sort((a, b) => a.offset - b.offset);
    assert.deepEqual(got.map((a) => a.name), names.filter((n) => n !== "boot"), `contents of period ${e} region ${edens[i]}`);
    if (names[0] === "boot") assert.ok(got[0].offset >= M.BOOT_BYTES, "small objects come before the first block");
  });
});

// ---- pause마다: 희망 survivor 크기와 임계값, 나이표, 영역 수, collection set, 새 영역 ----
const ageRows = (g) => Object.fromEntries(pause(g).filter((l) => /- age\s+\d+:/.test(l)).map((l) => {
  const m = l.match(/age\s+(\d+):\s+(\d+) bytes/);
  return [m[1], Number(m[2])];
}));
const regionLine = (g, kind) => pause(g).find((l) => l.includes(`${kind} regions:`)).match(/(\d+)->(\d+)(?:\((\d+)\))?/).slice(1).map((v) => (v === undefined ? null : Number(v)));
ends.forEach((s, g) => {
  const start = T.find((x) => x.last && x.last.kind === "start" && x.last.gc === g).last;
  const d = pause(g).find((l) => l.includes("Desired survivor size")).match(/size (\d+) bytes, new threshold (\d+) \(max threshold (\d+)\)/).slice(1).map(Number);
  assert.deepEqual(d, [start.desired, start.threshold, M.MAX_TENURING], `GC(${g}) threshold line`);
  assert.ok(pause(g).some((l) => l.includes(`Age table with threshold ${start.threshold} `)));
  const table = Object.fromEntries(Object.entries(s.tables[g]).map(([a, b]) => [a, b]));
  assert.deepEqual(ageRows(g), table, `GC(${g}) age table`);
  const [eb, ea, max] = regionLine(g, "Eden");
  const [sb, sa, smax] = regionLine(g, "Survivor");
  const [ob, oa] = regionLine(g, "Old");
  const { before: b, after: a } = s.last;
  assert.deepEqual([eb, ea, sb, sa, ob, oa], [b.eden, a.eden, b.survivor, a.survivor, b.old, a.old], `GC(${g}) region counts`);
  assert.equal(smax, M.MAX_SURVIVOR_REGIONS[g]);
  assert.ok(max >= 1);
  assert.deepEqual(regionLine(g, "Humongous").slice(0, 2), [0, 0]);
  const hrs = pause(g).map(hr).filter(Boolean);
  assert.deepEqual(hrs.filter((m) => m[1] === "CSET").map((m) => regionOf(m[3])).sort((x, y) => x - y), [...s.last.freed].sort((x, y) => x - y), `GC(${g}) collection set`);
  assert.deepEqual(hrs.filter((m) => m[1] === "CLEANUP").map((m) => regionOf(m[3])).sort((x, y) => x - y), [...s.last.freed].sort((x, y) => x - y), `GC(${g}) freed`);
  const fresh = hrs.filter((m) => m[1] === "ALLOC").map((m) => [m[2] === "SURV" ? "survivor" : "old", regionOf(m[3])]);
  const modelFresh = T.filter((x) => x.last && (x.last.kind === "copy" || x.last.kind === "promote") && x.last.gc === g && x.last.fresh).map((x) => [x.last.kind === "copy" ? "survivor" : "old", x.last.to]);
  assert.deepEqual(modelFresh, fresh, `GC(${g}) new survivor and old regions, in log order`);
  // 블록 위치와 나이: probe가 mark word에서 읽은 값
  const after = probe.filter((l) => l.startsWith(`after GC(${g})`)).map((l) => {
    const m = l.match(/after GC\(\d+\) (\w) addr (0x[0-9a-f]+) age (\d+)/);
    return { name: m[1], region: regionOf(m[2]), offset: offsetOf(m[2]), age: Number(m[3]) };
  });
  for (const p of after) {
    const it = s.items[p.name];
    assert.equal(it.region, p.region, `GC(${g}) ${p.name} region`);
    assert.equal(it.age, p.age, `GC(${g}) ${p.name} age`);
  }
  // 영역 안 자리 순서: 주소 순서. boot이 앞에 있으면 첫 블록 앞의 공간이 boot보다 크다
  for (const r of new Set(after.map((p) => p.region))) {
    const items = s.regions[r].items;
    const blocks = after.filter((p) => p.region === r).sort((x, y) => x.offset - y.offset).map((p) => p.name);
    assert.deepEqual(items.filter((id) => id !== "boot"), blocks, `GC(${g}) slot order in region ${r}`);
    if (items[0] === "boot") assert.ok(after.filter((p) => p.region === r).every((p) => p.offset >= M.BOOT_BYTES));
  }
});

// ---- 나이표 바이트가 그림의 항목으로 설명된다: 블록, boot, 그리고 32바이트 WeakReference ----
assert.equal(M.BOOT_BYTES, ageRows(1)["2"] - M.BLOCK_BYTES);
assert.equal(ageRows(0)["1"], M.BLOCK_BYTES + M.BOOT_BYTES + M.CANARY_BYTES);
// 임계값 2: 나이 1만으로는 희망 크기를 못 넘고, 나이 2까지 더하면 넘는다
assert.ok(M.cumulative(T.at(-1).tables[1], 1) <= 524288 && M.cumulative(T.at(-1).tables[1], 2) > 524288);

// ---- 그림의 리드아웃은 이 문자열과 같아야 한다 ----
assert.deepEqual(T.map(M.readout), [
  "mutator | Eden 0 | Survivor 0 | Old 2 | free 14",
  "mutator | region 13 -> Eden | Eden 1 | free 13",
  "mutator | region 12 -> Eden | Eden 2 | free 12",
  "GC(0) start | 0 B <= 524288 B | threshold 15",
  "GC(0) copy boot | 13 -> 11 Survivor | age 1",
  "GC(0) copy A | 13 -> 11 Survivor | age 1",
  "GC(0) end | Eden 2->0 | Survivor 0->1 | Old 2->2",
  "mutator | region 13 -> Eden | Eden 1 | free 12",
  "mutator | region 12 -> Eden | Eden 2 | free 11",
  "GC(1) start | 366720 B <= 524288 B | threshold 15",
  "GC(1) copy boot | 11 -> 10 Survivor | age 2",
  "GC(1) copy B | 13 -> 10 Survivor | age 1",
  "GC(1) copy A | 11 -> 10 Survivor | age 2",
  "GC(1) end | Eden 2->0 | Survivor 1->1 | Old 2->2",
  "mutator | region 13 -> Eden | Eden 1 | free 12",
  "mutator | region 12 -> Eden | Eden 2 | free 11",
  "mutator | region 11 -> Eden | Eden 3 | free 10",
  "mutator | region 9 -> Eden | Eden 4 | free 9",
  "mutator | region 8 -> Eden | Eden 5 | free 8",
  "GC(2) start | 628864 B > 524288 B | threshold 2",
  "GC(2) promote boot | 10 -> 0 Old | age 2",
  "GC(2) copy C | 12 -> 7 Survivor | age 1",
  "GC(2) copy B | 10 -> 7 Survivor | age 2",
  "GC(2) promote A | 10 -> 0 Old | age 2",
  "GC(2) end | Eden 5->0 | Survivor 1->1 | Old 2->3",
]);

console.log(`model check passed: ${M.REGIONS} regions of ${M.REGION_BYTES} B, ${T.length - 1} steps, thresholds ${T.filter((s) => s.last && s.last.kind === "start").map((s) => s.last.threshold).join(", ")}, A promoted at age ${T.at(-1).items.A.age}`);
