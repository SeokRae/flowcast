// fork와 COW 진실 모델: Linux 7.0.14 (linuxkit, arm64, 4 KiB 페이지), 사적 익명 페이지 3장
// 그림의 판 위치, 깃발, 표시창 값, 리드아웃은 모두 이 모듈에서 나온다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.

// truth/cow-probe.log의 "probe npages=3 page_size=4096", smaps의 "VmFlags ... nh" (MADV_NOHUGEPAGE)
export const NPAGES = 3;
export const PAGE_KB = 4;

// fork가 복제한 VMA 수: truth/ftrace-main.txt fork 구간의 copy_page_range 호출 수 (VMA마다 한 번)
export const FORK_VMAS = 19;

// 첫 쓰기는 0x10 | page (cow_probe.c). fork 뒤 쓰기는 부모 0xa0 | 차례, 자식 0xc0 | 차례
export const FIRST_BYTES = [0x10, 0x11, 0x12];
export const WRITES = [
  { who: "child", page: 0, value: 0xc1 },
  { who: "parent", page: 0, value: 0xa2 },
  { who: "parent", page: 1, value: 0xa3 },
  { who: "child", page: 1, value: 0xc4 },
  { who: "child", page: 0, value: 0xc5 },
];

// 실행 1회의 PFN. first: 첫 쓰기 때 할당된 페이지, alloc: 복사할 때마다 할당기가 내준 페이지(순서대로).
// remoteBatch: 원래 페이지마다 다른 CPU의 LRU 추가 배치가 잡고 있는 참조 수.
//   MAIN은 모든 일을 CPU 3에서 했다. fork 안에서 부모가 낸 COW 폴트의 lru_add_drain이 CPU 3 배치를 비워
//   fork 직후 세 페이지 모두 lru=1이었다 (truth/ftrace-main.txt, cow-probe.log "state fork").
//   SPLIT은 첫 쓰기만 CPU 3, fork와 쓰기는 CPU 5에서 했다. CPU 3 배치는 끝까지 안 비워졌다(lru=0).
export const MAIN = { name: "main", first: [0xb579a, 0xf399a, 0x7694d], alloc: [0x7a665, 0xf404c], remoteBatch: 0 };
export const SPLIT = { name: "split", first: [0xcfcae, 0x8565f, 0xc4541], alloc: [0x91cd0, 0x9d0d1, 0x80c02, 0xc8891], remoteBatch: 1 };

// STATE: 지금 이 순간 전부.
//   frames: 물리 페이지. maps = 이 페이지를 가리키는 PTE 수(mapcount), batch = 다른 CPU 배치의 참조,
//           exclusive = PageAnonExclusive, home = 원래 페이지면 page 번호, 복사본이면 그 페이지 번호와 주인
//   pte: 프로세스마다 페이지마다 { frame(frames 색인), write(쓰기 가능 비트) }. child는 fork 전 null
//   last: 방금 한 일. done: 쓰기 5번을 다 했다
export function makeState(run = MAIN) {
  return {
    run: run.name,
    alloc: run.alloc,
    turn: 0,
    frames: run.first.map((pfn, page) => ({ pfn, byte: FIRST_BYTES[page], maps: 1, batch: run.remoteBatch, exclusive: true, page, owner: null })),
    pte: { parent: FIRST_BYTES.map((_, page) => ({ frame: page, write: true })), child: null },
    used: 0,
    last: null,
    done: false,
  };
}

// 참조 수: PTE마다 하나, 그리고 다른 CPU의 LRU 추가 배치가 잡은 것. 지금 CPU 배치의 참조는
// wp_can_reuse_anon_folio가 lru_add_drain으로 먼저 놓으므로 판정 때 남지 않는다.
export function refcount(frame) {
  return frame.maps + frame.batch;
}

const cloneFrames = (s) => s.frames.map((f) => ({ ...f }));
const clonePte = (s) => ({ parent: s.pte.parent.map((e) => ({ ...e })), child: s.pte.child && s.pte.child.map((e) => ({ ...e })) });

// STEP: 호출 1회 = fork 한 번 또는 사용자 쓰기 한 번. 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(s) {
  if (s.done) return s;
  const frames = cloneFrames(s);
  const pte = clonePte(s);
  if (!pte.child) {
    // fork: copy_pte_range가 PTE마다 부모를 쓰기 금지로 바꾸고 같은 PFN을 쓰기 금지로 자식에 넣는다.
    // 익명 rmap 복제가 PageAnonExclusive를 지우고 mapcount를 올린다.
    pte.child = pte.parent.map((e) => ({ frame: e.frame, write: false }));
    pte.parent.forEach((e) => (e.write = false));
    pte.child.forEach((e) => {
      frames[e.frame].maps += 1;
      frames[e.frame].exclusive = false;
    });
    return { ...s, frames, pte, turn: s.turn + 1, last: { kind: "fork", ptes: pte.child.length } };
  }
  const w = WRITES[s.turn - 1];
  const entry = pte[w.who][w.page];
  const frame = frames[entry.frame];
  let last;
  if (entry.write) {
    // PTE가 이미 쓰기 가능: 폴트 없이 그 페이지에 바로 쓴다
    frame.byte = w.value;
    last = { kind: "write", ...w, fault: false, action: "none", from: frame.pfn, to: frame.pfn, refs: refcount(frame) };
  } else if (frame.exclusive || refcount(frame) === 1) {
    // do_wp_page: 전용 표시가 있거나 참조 수가 1이면 재사용. PFN은 그대로, 쓰기 비트만 선다
    const refs = refcount(frame);
    frame.exclusive = true;
    entry.write = true;
    frame.byte = w.value;
    last = { kind: "write", ...w, fault: true, action: "reuse", from: frame.pfn, to: frame.pfn, refs };
  } else {
    // wp_page_copy: 새 페이지에 내용을 복사하고 PTE를 새 페이지(쓰기 가능)로 바꾼 뒤 옛 페이지의 mapcount를 줄인다
    const refs = refcount(frame);
    const copy = { pfn: s.alloc[s.used], byte: frame.byte, maps: 1, batch: 0, exclusive: true, page: w.page, owner: w.who };
    frames.push(copy);
    frame.maps -= 1;
    entry.frame = frames.length - 1;
    entry.write = true;
    copy.byte = w.value;
    last = { kind: "write", ...w, fault: true, action: "copy", from: frame.pfn, to: copy.pfn, refs, copied: frame.byte };
    return { ...s, frames, pte, used: s.used + 1, turn: s.turn + 1, last, done: s.turn === WRITES.length };
  }
  return { ...s, frames, pte, turn: s.turn + 1, last, done: s.turn === WRITES.length };
}

export function trace(run = MAIN) {
  const out = [makeState(run)];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

// 관찰값: 모델에서 계산해 실측과 대조한다 (check.mjs)
export function pfnOf(s, who, page) {
  const e = s.pte[who] && s.pte[who][page];
  return e ? s.frames[e.frame].pfn : null;
}
export function bytesOf(s, who) {
  return s.pte[who].map((e) => s.frames[e.frame].byte);
}
// smaps_account: 참조 수가 1이면 private, 아니면 mapcount 2 이상만 shared
export function smapsOf(s, who) {
  let shared = 0;
  let priv = 0;
  for (const e of s.pte[who]) {
    const f = s.frames[e.frame];
    if (refcount(f) !== 1 && f.maps >= 2) shared += PAGE_KB;
    else priv += PAGE_KB;
  }
  return { shared, private: priv };
}

const hex = (pfn) => "0x" + pfn.toString(16);
// 리드아웃: 무엇을 했나 | 폴트와 처리 | 그 쓰기가 닿은 PFN (복사면 옛 PFN → 새 PFN)
export function readout(s) {
  if (!s.last) return `entry | ${NPAGES} pages rw | private ${smapsOf(s, "parent").private} kB`;
  if (s.last.kind === "fork") return `fork | ${s.last.ptes * 2} PTEs ro | shared ${smapsOf(s, "parent").shared} kB`;
  const head = `${s.last.who} p${s.last.page}`;
  if (s.last.action === "copy") return `${head} | fault, copy | ${hex(s.last.from)} → ${hex(s.last.to)}`;
  if (s.last.action === "reuse") return `${head} | fault, reuse | ${hex(s.last.from)}`;
  return `${head} | no fault | ${hex(s.last.to)}`;
}
