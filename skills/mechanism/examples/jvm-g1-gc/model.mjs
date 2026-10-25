// G1 young GC 진실 모델: Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64
// 실행: -Xms16m -Xmx16m -XX:+UseG1GC -XX:ParallelGCThreads=1, 프로그램은 truth/Ages.java (합성)
// 그림의 트레이 종류, 블록 위치와 나이, 슬라이더, 게이지, 리드아웃은 모두 이 모듈에서 나온다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.

export const JDK = "Amazon Corretto 21.0.1";

// flags.txt: G1HeapRegionSize = 1048576 {ergonomic}, MaxHeapSize = 16777216
export const REGION_BYTES = 1048576;
export const REGIONS = 16;
// probe.txt: 모든 배열이 byte[] 256 KiB (헤더 16바이트 포함), 영역 하나에 4개
export const BLOCK_BYTES = 262144;
export const SLOTS = 4;
// flags.txt: MaxTenuringThreshold = 15, TargetSurvivorRatio = 50
export const MAX_TENURING = 15;
export const TARGET_SURVIVOR_RATIO = 50;
// gc.log "Survivor regions: a->b(1)": 각 pause가 쓸 수 있는 survivor 영역 수
export const MAX_SURVIVOR_REGIONS = [1, 1, 1];
// gc.log: GC(0) 전에 ALLOC(OLD) 두 번, cds-heap.txt: CDS 아카이브 힙 1061272바이트를 맨 위 두 영역에 매핑
export const CDS_REGIONS = [14, 15];
export const CDS_BYTES = 1061272;
// gc.log GC(1) "age 2: 366688" - A 262144 = JVM과 프로그램이 시작하며 만든 작은 객체 묶음 (그림의 알갱이 접시)
export const BOOT_BYTES = 104544;
// Ages.java가 GC를 알아채려고 pause마다 새로 만드는 WeakReference 하나. 다음 pause에서 늘 나이 1로 복사된다 (그림에 없음)
export const CANARY_BYTES = 32;

// mutator 구간마다 Eden 영역을 할당 순서대로, 영역 안 내용은 주소 순서대로 (probe.txt alloc 줄)
// "g"는 만들자마자 버린 배열, "boot"는 첫 영역 앞머리의 작은 객체 묶음
export const PERIODS = [
  [["boot", "g", "g", "A"], ["g", "g", "g", "g"]],
  [["g", "B", "g"], ["g", "g", "g", "g"]],
  [["g", "g", "g"], ["g", "C", "g", "g"], ["g", "g", "g", "g"], ["g", "g", "g", "g"], ["g", "g", "g", "g"]],
];
// pause 안 복사 순서. 목적지 영역 안 순서는 probe.txt 주소 순서이고, 목적지 사이 순서는
// 워커 하나가 keep 배열의 원소를 스택에 넣었다 꺼내는 순서(뒤 원소 먼저)로 정했다
export const COPY_ORDER = [["boot", "A"], ["boot", "B", "A"], ["boot", "C", "B", "A"]];

// 실행 순서: 구간 e마다 Eden 영역 할당 n번, pause 시작, 복사, pause 끝
export const SCRIPT = PERIODS.flatMap((regions, gc) => [
  ...regions.map((_, index) => ({ kind: "alloc", gc, index })),
  { kind: "start", gc },
  ...COPY_ORDER[gc].map((id) => ({ kind: "copy", gc, id })),
  { kind: "end", gc },
]);

const clone = (s) => JSON.parse(JSON.stringify(s));

// STATE: 지금 이 순간 전부. regions[i].items는 그 트레이의 자리 순서대로 놓인 항목 id
export function makeState() {
  const regions = Array.from({ length: REGIONS }, () => ({ type: "free", items: [] }));
  const items = {};
  for (const r of CDS_REGIONS) {
    const id = `cds${r}`;
    items[id] = { id, kind: "cds", region: r, slot: 0, age: null };
    regions[r] = { type: "old", items: [id] };
  }
  return {
    cursor: 0, gc: 0, phase: "mutator", regions, items,
    threshold: null, desired: null, cum: 0, cset: [], dest: null, table: null, tables: [], startCounts: null,
    last: null, moved: null, done: false,
  };
}

export function counts(s) {
  const n = (type) => s.regions.filter((r) => r.type === type).length;
  return { eden: n("eden"), survivor: n("survivor"), old: n("old"), free: n("free") };
}

// G1은 young 영역(Eden, Survivor)을 빈 영역 목록의 위쪽 끝에서, Old 영역을 아래쪽 끝에서 꺼낸다 (gc.log G1HR ALLOC)
function takeFree(s, young) {
  const free = s.regions.map((r, i) => (r.type === "free" ? i : -1)).filter((i) => i >= 0);
  if (!free.length) throw new Error("heap full");
  return young ? free[free.length - 1] : free[0];
}

// AgeTable::compute_tenuring_threshold: 나이 1부터 바이트를 더해 희망 크기를 넘는 첫 나이, 끝까지 안 넘으면 최대값
export function tenuring(table, desired) {
  let total = 0;
  let age = 1;
  while (age <= MAX_TENURING) {
    total += table[age] ?? 0;
    if (total > desired) break;
    age++;
  }
  return { threshold: Math.min(age, MAX_TENURING), cum: total };
}

// 나이 1..age 누적 바이트 (게이지가 슬라이더를 따라 읽는 값)
export function cumulative(table, age) {
  let total = 0;
  for (let a = 1; a <= age; a++) total += table[a] ?? 0;
  return total;
}

export function bytesOf(item) {
  return item.kind === "boot" ? BOOT_BYTES : BLOCK_BYTES;
}

// STEP: 호출 1회 = 최소 연산 1회 (Eden 영역 하나 할당, pause 시작의 임계값 계산, 객체 하나 복사, collection set 해제)
export function step(s) {
  if (s.done) return s;
  const n = clone(s);
  const op = SCRIPT[s.cursor];
  n.cursor = s.cursor + 1;
  n.moved = null;
  if (op.kind === "alloc") {
    const r = takeFree(n, true);
    const ids = PERIODS[op.gc][op.index].map((name, slot) => {
      const id = name === "g" ? `g${op.gc}.${op.index}.${slot}` : name;
      n.items[id] = { id, kind: name === "g" ? "garbage" : name === "boot" ? "boot" : "block", region: r, slot, age: 0 };
      return id;
    });
    n.regions[r] = { type: "eden", items: ids };
    n.last = { kind: "alloc", gc: op.gc, region: r };
    n.moved = { kind: "alloc", region: r, items: ids };
  } else if (op.kind === "start") {
    const desired = (MAX_SURVIVOR_REGIONS[op.gc] * REGION_BYTES * TARGET_SURVIVOR_RATIO) / 100;
    const { threshold, cum } = tenuring(n.tables[op.gc - 1] ?? {}, desired);
    n.phase = "gc";
    n.threshold = threshold;
    n.desired = desired;
    n.cum = cum;
    n.startCounts = counts(n);
    n.cset = n.regions.map((r, i) => (r.type === "eden" || r.type === "survivor" ? i : -1)).filter((i) => i >= 0);
    n.dest = { survivor: null, old: null };
    n.table = { 1: CANARY_BYTES };
    n.last = { kind: "start", gc: op.gc, threshold, cum, desired, from: s.threshold };
    n.moved = { kind: "start", from: s.threshold, to: threshold };
  } else if (op.kind === "copy") {
    const it = n.items[op.id];
    const from = it.region;
    const slotFrom = it.slot;
    // G1ParScanThreadState::next_region_attr: young 객체는 나이가 임계값보다 작을 때만 young에 남는다
    const toOld = it.age >= n.threshold;
    const type = toOld ? "old" : "survivor";
    let r = n.dest[type];
    if (r === null || n.regions[r].items.length >= SLOTS) {
      if (!toOld && n.regions.filter((x, i) => x.type === "survivor" && !n.cset.includes(i)).length >= MAX_SURVIVOR_REGIONS[op.gc]) {
        throw new Error("survivor overflow is not modeled");
      }
      r = takeFree(n, !toOld);
      n.regions[r] = { type, items: [] };
      n.dest[type] = r;
    }
    const age = toOld ? it.age : Math.min(it.age + 1, MAX_TENURING);
    // 원본 자리에는 전달 포인터만 남은 사본이 남고, 영역째 해제될 때 사라진다
    const stub = `${op.id}@${from}`;
    n.items[stub] = { id: stub, kind: "stub", region: from, slot: slotFrom, age: null, of: it.kind };
    n.regions[from].items[slotFrom] = stub;
    it.region = r;
    it.slot = n.regions[r].items.length;
    it.age = age;
    n.regions[r].items.push(op.id);
    if (!toOld) n.table[age] = (n.table[age] ?? 0) + bytesOf(it);
    n.last = { kind: toOld ? "promote" : "copy", gc: op.gc, id: op.id, from, to: r, age, fresh: n.regions[r].items.length === 1 };
    n.moved = { kind: "copy", id: op.id, stub, from, slotFrom, to: r, slotTo: it.slot, type };
  } else {
    for (const r of n.cset) {
      for (const id of n.regions[r].items) delete n.items[id];
      n.regions[r] = { type: "free", items: [] };
    }
    n.tables[op.gc] = n.table;
    n.last = { kind: "end", gc: op.gc, before: n.startCounts, after: counts(n), freed: n.cset };
    n.moved = { kind: "end", freed: n.cset };
    n.gc = op.gc + 1;
    n.phase = "mutator";
    n.cset = [];
    n.dest = null;
    n.table = null;
    if (n.cursor === SCRIPT.length) n.done = true;
  }
  return n;
}

export function trace() {
  const out = [makeState()];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

const NAMES = { boot: "boot", A: "A", B: "B", C: "C" };
export function readout(s) {
  const L = s.last;
  const c = counts(s);
  if (!L) return `mutator | Eden 0 | Survivor 0 | Old ${c.old} | free ${c.free}`;
  if (L.kind === "alloc") return `mutator | region ${L.region} -> Eden | Eden ${c.eden} | free ${c.free}`;
  if (L.kind === "start") return `GC(${L.gc}) start | ${L.cum} B ${L.cum > L.desired ? ">" : "<="} ${L.desired} B | threshold ${L.threshold}`;
  if (L.kind === "copy") return `GC(${L.gc}) copy ${NAMES[L.id]} | ${L.from} -> ${L.to} Survivor | age ${L.age}`;
  if (L.kind === "promote") return `GC(${L.gc}) promote ${NAMES[L.id]} | ${L.from} -> ${L.to} Old | age ${L.age}`;
  const b = L.before;
  const a = L.after;
  return `GC(${L.gc}) end | Eden ${b.eden}->${a.eden} | Survivor ${b.survivor}->${a.survivor} | Old ${b.old}->${a.old}`;
}
