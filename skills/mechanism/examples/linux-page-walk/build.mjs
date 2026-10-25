// node build.mjs [--light]: 4단 선반장과 카드 인덱스 (flowcast:mechanism 예제, 합성 프로브)
// 그림의 숫자, 위치, 리드아웃은 모두 model.mjs에서 나온다. kit는 vendor/anatomy에서 가져온다.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = process.env.MECHANISM_KIT ?? join(HERE, "../../vendor/anatomy");
const k = await import(pathToFileURL(join(KIT_ROOT, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(KIT_ROOT, "scripts/inline-kit.mjs")).href);
const theme = process.argv.includes("--light") ? "light" : "dark";
const NAME = "linux-page-walk";
const NOTICE = "<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->";

// pageHtml은 kit와 live 코드를 한 module 스코프에 넣는다. 모델을 IIFE로 감싸 이름 충돌을 막는다.
function inlineModel(src) {
  const names = [...src.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  return `const MODEL = (() => {\n${src.replace(/^export /gm, "")}\nreturn { ${names.join(", ")} };\n})();\n`;
}
const modelScript = inlineModel(readFileSync(join(HERE, "model.mjs"), "utf8"));

// 캡션은 brief.md의 "## 캡션" 절을 그대로 쓴다 (마크다운 코드 표시 백틱만 걷어 낸다)
const brief = readFileSync(join(HERE, "brief.md"), "utf8");
const CAPTION = (brief.split(/^## 캡션\s*$/m)[1] ?? "").split(/^## /m)[0].trim().replace(/`/g, "");
if (!CAPTION) throw new Error("brief.md has no caption section");

// ---- 진실: 모델에서 읽는 값 ----
const TRACE = M.trace();
const INIT_STEPS = 4; // 처음 보여줄 상태: L2 항목이 비어 깃발이 오른 순간 (trace[4])
if (!(TRACE[INIT_STEPS].last.kind === "fault" && TRACE[INIT_STEPS].last.level === 2)) throw new Error("initial pose should be the L2 fault");
const SPLIT = Object.fromEntries(Object.entries(M.PAGES).map(([p, { va }]) => [p, M.split(va)]));
const IDX = SPLIT.p0.index;
const FIELD_BITS = [...M.SHIFTS.map(() => M.TABLE_SHIFT), M.PAGE_SHIFT]; // 9, 9, 9, 9, 12
const hx = (n) => M.hex(n);

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const vaHex = (p) => `0x${hx(M.PAGES[p].va)}`;
const PARTS = [
  { id: "va", name: "주소 막대", concept: "가상 주소 48비트", text: `키 ${M.VA_BITS}개가 지금 만지는 주소의 비트예요(올라온 키가 1). 칸막이가 ${FIELD_BITS.join(" + ")}비트로 나누고, 창 다섯 개는 단계별 색인과 페이지 안 오프셋입니다. p0 ${vaHex("p0")}는 ${IDX.join(", ")}과 오프셋 0x${hx(SPLIT.p0.offset)}로 갈려요. 왼쪽 끝 스위치는 읽기(앞)와 쓰기(뒤)입니다.` },
  { id: "tlb", name: "카드 인덱스", concept: "TLB", text: "걷기에 성공한 변환을 카드로 둡니다. 감지 빗이 내려와 같은 쪽의 카드가 올라오면 hit이고, 걷지 않고 바로 물리 주소를 내요. 이 VM에는 PMU가 없어 실제 적중은 재지 못했어요. 그림은 아키텍처 규칙(빈 항목과 fault는 캐시되지 않는다, 무효화하면 지운다)만 따르고, 성공한 결과는 남는다고 가정합니다." },
  { id: "walker", name: "워커", concept: "MMU의 테이블 걷기", text: `CPU의 MMU가 하는 일이라 커널 코드가 끼어들지 않습니다. TTBR0_EL1이 가리키는 L0 테이블에서 시작해 한 단에 항목 하나씩 읽고, 가로 위치가 그 단계 색인이에요(눈금 띠의 작은 눈금은 32항목, 큰 눈금은 256항목, 오른쪽 끝이 ${M.ENTRIES - 1}).` },
  { id: "l0", name: "L0 단", concept: `${M.LINUX_NAMES[0]} (p4d 접힘)`, text: `비트 ${M.VA_BITS - 1}..${M.SHIFTS[0]}이 고르는 맨 위 테이블이에요. 4단 구성이라 리눅스의 p4d는 별도 테이블 없이 이 항목과 같습니다. 고리 카드는 다음 테이블을 가리키는 항목인데, 그 물리 주소는 사용자 공간에서 읽을 수 없어 적지 않았어요. 각 단에는 이 주소가 지나는 항목만 그렸고, 다른 매핑(라이브러리, 스택)의 항목은 생략했습니다.` },
  { id: "l1", name: "L1 단", concept: M.LINUX_NAMES[1], text: `비트 ${M.SHIFTS[0] - 1}..${M.SHIFTS[1]}로 고릅니다. ftrace에 __pud_alloc, __pmd_alloc이 없어서 L0과 L1 항목은 처음부터 있었다고 봐요.` },
  { id: "l2", name: "L2 단", concept: M.LINUX_NAMES[2], text: `비트 ${M.SHIFTS[1] - 1}..${M.SHIFTS[2]}로 고르는 칸(${IDX[2]})이 처음에는 비어 있습니다. 예약한 2 MiB 영역에 다른 매핑이 없어서예요. 그래서 첫 걷기는 L3까지 가지 못하고 여기서 translation fault를 냅니다.` },
  { id: "l3", name: "L3 단", concept: M.LINUX_NAMES[3], text: `L3 테이블은 페이지 한 장(항목 ${M.ENTRIES}개)이고 처음에는 없어요. 커널이 첫 fault에서 만들어 이 칸에 넣습니다. 창 카드에 PFN이 적혀 있고 자물쇠가 달린 카드는 읽기 전용입니다. p0은 색인 ${SPLIT.p0.index[3]}, p1은 ${SPLIT.p1.index[3]}이에요.` },
  { id: "flag", name: "예외 깃발", concept: "page fault", text: "걷기가 빈 항목에서 멈추거나 읽기 전용에 쓰면 MMU가 데이터 abort를 내고 커널(el0_da, do_mem_abort)로 넘어갑니다. 깃발이 서 있는 동안 크레인이 움직이고, 고치고 나면 내려가요. 그다음 CPU는 같은 명령을 처음부터 다시 실행합니다." },
  { id: "crane", name: "크레인", concept: "커널의 fault 처리", text: `커널은 걷기에 끼어들지 않고 fault 때만 움직입니다. 빈 L2 항목이면 L3 테이블을 만들고(__pte_alloc), 빈 L3 항목이면 페이지를 걸고(do_anonymous_page), 읽기 전용 zero page에 쓰면 새 페이지로 바꿔 걸어요(do_wp_page). 처리 하나를 끝낼 때마다 minor fault가 하나 늘고, 이 시나리오는 모두 ${TRACE.at(-1).faults}번입니다.` },
  { id: "store", name: "창고", concept: "페이지 할당", text: "빈 트레이와 새 페이지 카드는 같은 페이지 할당자에서 나옵니다. 새 페이지는 0으로 채워져 나와요(vma_alloc_zeroed_movable_folio). 더미 높이는 뜻이 없어요. 남은 자유 페이지는 아주 많습니다." },
  { id: "zero", name: "zero page 꽂이", concept: "공용 zero page", text: `한 번도 쓰지 않은 익명 페이지를 읽으면 커널은 페이지를 할당하지 않고 공용 zero page(PFN 0x${hx(M.PFN.zero)})를 읽기 전용으로 겁니다. 읽기만 한 512쪽이 모두 이 PFN이었어요. 나중에 쓰면 fault가 한 번 더 나고 새 페이지로 바뀝니다.` },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";
// 같은 data-sel을 단 노드가 한 묶음이다. 떨어져 그려지는 부품은 같은 id로 여러 번 감싼다.
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 400;
const PLATE = { x: -156, y: -66, w: 352, d: 100, r: 9 };
const PLATE_H = 10;
const FOOT_H = 5;
const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });

// 선반장: 아래가 L0, 맨 위가 열린 L3 칸
const CAB = { x0: -116, x1: 0, y0: -58, y1: -28 };
const PANEL = 4;
const SHELF_TOP = [5, 25, 45, 65];
const SHELF_T = 2;
const CAB_TOP = 81; // 옆판 꼭대기
const TRAY = box(-108, -50, -8, -32, 1);
const TRAY_FLOOR = 1.2;
const LIP = 3;
const xIdx = (i) => -100 + (i / (M.ENTRIES - 1)) * 84; // 512칸 눈금 위 색인 i의 x
const CARD = { hw: 7.5, y0: -37, y1: -35.6, h: 12 };

// 워커 (MMU)
const RAIL = box(-128, -23, 6, -18.4, 0.8);
const RAIL_H = 2.6;
const PARK_X = -112;
const headZ = (n) => SHELF_TOP[n] + TRAY_FLOOR + 7;
const PROBE_FROM = -25; // 헤드 뒷면
const PROBE_TO = CARD.y1; // 카드 앞면에 닿는다
const MAST_TOP = headZ(3) + 8;

// 크레인 (커널)
const CRANE_Y = (TRAY.y + TRAY.y + TRAY.d) / 2;
const BEAM_Z = 108;
const POST_X = [-128, 184];
const TROLLEY_H = 8;
const HOOK_H = 4;
const HOOK_UP = 94; // 나를 때 훅 바닥 높이 (카드 밑이 옆판 위를 지난다)
const CRANE_PARK = 112;

// 창고: 빈 트레이 더미, 새 페이지 카드 탄창, zero page 꽂이
// 창고는 다리 넷 달린 선반(RACK) 위에 있다. 그 위의 높이는 선반 윗면 기준이다
const RACK = box(8, -60, 176, -24, 2);
const RACK_Z = 60;
const STACK = box(62, TRAY.y, 162, TRAY.y + TRAY.d, 1); // 빈 트레이 더미 (선반 트레이와 같은 크기)
const STACK_N = 3;
const STACK_BASE = 4;
const TRAY_H = LIP; // 트레이 높이 = 앞 테 높이
const STACK_TOP = STACK_BASE + STACK_N * TRAY_H;
const MAG_X = 45; // 새 페이지 카드 탄창
const ZERO_X = 25; // zero page 꽂이
const POCKET_Z = 9; // 꽂이와 탄창 안 카드 바닥

// 깃발
const FLAG_POST = [10, -20.7];
const FLAG_DOWN = 22;
const FLAG_UP = 34;

// 카드 인덱스 (TLB)
const TLB = box(108, -8, 166, 18, 2);
const TLB_H = 7;
const TLB_SLOT_X = [124, 150];
const TLB_CARD = { hw: 8, y0: 3.3, y1: 4.7, h: 11 };
const COMB_Z = 17; // 빗 바닥, 쉬는 높이
const COMB_Y = TLB_CARD.y0 - 3.2; // 빗은 카드 바로 뒤를 지난다
const COMB_DOWN = 4;

// 주소 막대
const BAR = box(-150, 2, 20, 20, 2);
const BAR_H = 6;
const KEY = { pitch: 3.2, w: 2.3, gap: 2.6 };
const keyX = (i) => {
  const group = i < 36 ? Math.floor(i / 9) : 4;
  return -140 + i * KEY.pitch + group * KEY.gap;
};
const groupSpan = (g) => {
  const first = [0, 9, 18, 27, 36][g];
  const last = first + FIELD_BITS[g] - 1;
  return [keyX(first), keyX(last) + KEY.w];
};

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [POST_X[0], CRANE_Y, BEAM_Z + 7], [POST_X[1], CRANE_Y, BEAM_Z + 7], [-120, -60, BEAM_Z + 7]],
  WIDTH,
  HEIGHT,
  { pad: 18, azimuth: 58 },
);
const CAM = k.cameraOf(P);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;
// 수직면 위 닫힌 사각 테두리 (y = const 면)
const frontRect = (x0, x1, y, z0, z1) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);

// ---- 카드와 표시창 ----
let clipCount = 0;
// y = const 면 위의 글자: u는 +x, v는 아래
function faceWindow(x0, x1, y, zTop, zBot, text, { part = "", size = 3.2 } = {}) {
  const id = `pw-clip-${clipCount++}`;
  const m = k.sideMatrix([0, y], 0, P, "left");
  const rect = `M${x0} ${-zTop}H${x1}V${-zBot}H${x0}Z`;
  return [
    `<g transform="${m}"><clipPath id="${id}"><path d="${rect}"/></clipPath>`,
    `<path class="iso-line pw-win" data-tone="lo" d="${rect}"/>`,
    `<text class="pw-digit"${part ? ` data-digit="${part}"` : ""} clip-path="url(#${id})" x="${(x0 + x1) / 2}" y="${-(zTop + zBot) / 2 + size * 0.36}" font-size="${size}" text-anchor="middle">${text}</text></g>`,
  ].join("");
}

// 선반 카드: 원점 x = 0, 바닥 z = 0. table = 다음 테이블을 가리키는 고리 카드, page = PFN 창 카드
function card(kind, { part = "", text = "", spec = CARD, lit = false } = {}) {
  const plan = box(-spec.hw, spec.y0, spec.hw, spec.y1, 0.3);
  const out = [S(k.slabOf(plan, 0, spec.h, P, 2), { tone: "hi", crease: "lo", lit })];
  if (kind === "table") {
    // 고리: 카드 앞면 위쪽의 구멍 (닫힌 원)
    out.push(L(k.sideRing([0, spec.y1, spec.h - 2.6], 1.3, "y", P), { tone: "lo" }));
    out.push(L(frontRect(-spec.hw + 1.4, spec.hw - 1.4, spec.y1, 1.6, spec.h - 5), { tone: "faint" }));
  } else {
    out.push(faceWindow(-spec.hw + 1, spec.hw - 1, spec.y1, spec.h - 1.4, spec.h - 5.8, text, { part }));
  }
  return out.join("");
}
// 읽기 전용 자물쇠: 카드 위의 작은 덮개 (data-lock으로 켜고 끈다)
function lockCap(spec = CARD, attrs = "") {
  const out = [S(k.slabOf(box(-2.6, spec.y0 - 0.4, 2.6, spec.y1 + 0.4, 0.3), spec.h, 1.8, P, 2), { tone: "mid", crease: "none" })];
  out.push(D([at([0, spec.y1 + 0.4, spec.h + 0.9])], { size: 0.4, tone: "lo" }));
  return `<g data-lock${attrs}>${out.join("")}</g>`;
}

// ---- 베이스 ----
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // 라벨판: 규칙선 3줄은 인쇄된 글자를 뜻한다 (free)
  const label = box(44, 12, 86, 22, 1.2);
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([28, 20, 24].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.8 + i * 2.1], [label.x + 4 + w, label.y + 2.8 + i * 2.1], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3, label.y + 2.6, 0.8]), at([label.x + label.w - 3, label.y + label.d - 2.6, 0.8])], { size: 0.45 }));
  return out.join("");
}

// ---- 크레인 기둥 (빔은 선반장 뒤에, 트롤리와 훅은 위 레이어에) ----
function cranePost(x) {
  const out = [];
  const foot = box(x - 9, CRANE_Y - 9, x + 9, CRANE_Y + 9, 1.5);
  out.push(`<path class="iso-halo" d="${k.haloOf(foot, 0, 3, P)}" style="opacity:.6"/>`);
  out.push(S(k.slabOf(foot, 0, 4, P, 3, 0.5), { tone: "mid" }));
  out.push(D(k.corners(foot, 3).map(([px, py]) => at([px, py, 4])), { size: 0.45 }));
  const post = box(x - 3.2, CRANE_Y - 3.2, x + 3.2, CRANE_Y + 3.2, 0.8);
  out.push(S(k.slabOf(post, 4, BEAM_Z - 4, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(post, 46, P, 3), { tone: "faint" }) }));
  return out.join("");
}

function beam() {
  const plan = box(POST_X[0] - 4, CRANE_Y - 3, POST_X[1] + 4, CRANE_Y + 3, 0.8);
  const out = [S(k.slabOf(plan, BEAM_Z, 6, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, BEAM_Z + 2, P, 3), { tone: "faint" }) })];
  for (const x of [POST_X[0] - 6, POST_X[1] + 4]) out.push(S(k.slabOf(box(x, CRANE_Y - 3.6, x + 2, CRANE_Y + 3.6, 0.5), BEAM_Z - 0.6, 7.2, P, 2), { tone: "mid" }));
  out.push(D([-100, -50, 0, 50, 100, 150].map((x) => at([x, CRANE_Y + 3, BEAM_Z + 4.4])), { size: 0.4, tone: "lo" }));
  return out.join("");
}

// 트롤리: 빔 아래에 매달려 x로 움직인다 (원점 x = 0)
function trolley() {
  const out = [];
  const plan = box(-8, CRANE_Y - 5, 8, CRANE_Y + 5, 1);
  out.push(S(k.slabOf(plan, BEAM_Z - TROLLEY_H, TROLLEY_H, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, BEAM_Z - 3, P, 3), { tone: "faint" }) }));
  out.push(D([at([-5, CRANE_Y + 5, BEAM_Z - 1.6]), at([5, CRANE_Y + 5, BEAM_Z - 1.6])], { size: 0.5, tone: "mid" }));
  // 손나사: 트롤리 앞면
  out.push(S(k.slabOf(box(3.6, CRANE_Y + 5, 5.6, CRANE_Y + 6.6, 0.4), BEAM_Z - 5.6, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(4.6, CRANE_Y + 8, 1.8, BEAM_Z - 6.6, 4, P, 18), { tone: "mid" }));
  out.push(L(k.knurl(4.6, CRANE_Y + 8, 1.8, BEAM_Z - 6.6, BEAM_Z - 2.6, 14, P), { tone: "lo" }));
  // 호이스트 드럼 (트롤리 밑)
  out.push(S(k.cylinder(-3, CRANE_Y, 2.4, BEAM_Z - TROLLEY_H - 2, 2, P, 20), { tone: "lo" }));
  return out.join("");
}

// 훅: 원점 x = 0, 바닥 z = 0
function hook() {
  const out = [];
  const plan = box(-6, CRANE_Y - 3, 6, CRANE_Y + 3, 0.8);
  out.push(S(k.slabOf(plan, 0, HOOK_H, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(plan, 1.4, P, 3), { tone: "faint" }) }));
  out.push(S(k.slabOf(box(-1.4, CRANE_Y - 1.4, 1.4, CRANE_Y + 1.4, 0.4), HOOK_H, 1.6, P, 2), { tone: "lo", crease: "none" }));
  out.push(D([at([-4, CRANE_Y + 3, 2.6]), at([4, CRANE_Y + 3, 2.6])], { size: 0.4 }));
  return out.join("");
}

// ---- 창고 ----
function rack() {
  const out = [`<path class="iso-halo" d="${k.haloOf(RACK, 0, 4, P)}" style="opacity:.7"/>`];
  const legs = byDepth(k.corners(RACK, 4));
  for (const [x, y] of legs) {
    const leg = box(x - 2.6, y - 2.6, x + 2.6, y + 2.6, 0.6);
    out.push(S(k.slabOf(box(x - 4, y - 4, x + 4, y + 4, 1), 0, 2, P, 3), { tone: "lo" }));
    out.push(S(k.slabOf(leg, 2, RACK_Z - 6, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(leg, 24, P, 2), { tone: "faint" }) }));
  }
  // 옆 버팀대 (왼쪽과 오른쪽 다리 사이, 아래)
  for (const x of [RACK.x + 4, RACK.x + RACK.w - 4]) out.push(S(k.slabOf(box(x - 1.2, RACK.y + 6.6, x + 1.2, RACK.y + RACK.d - 6.6, 0.3), 22, 2.4, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf(RACK, RACK_Z - 4, 4, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(RACK, RACK_Z - 2, P, 4), { tone: "faint" }) }));
  out.push(D(k.corners(RACK, 4).map(([x, y]) => at([x, y, RACK_Z])), { size: 0.45 }));
  return out.join("");
}
function storeBase() {
  const plinth = box(12, -57, 170, -27, 2);
  const out = [];
  out.push(S(k.slabOf(plinth, 0, STACK_BASE, P, 4, 0.6), { tone: "lo", inner: L(k.sideSeam(plinth, 1.6, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(STACK, -2.4), STACK_BASE, P, 3), { tone: "faint" }));
  out.push(D([at([plinth.x + 3, plinth.y + 3, STACK_BASE]), at([plinth.x + plinth.w - 3, plinth.y + 3, STACK_BASE]), at([plinth.x + 3, plinth.y + plinth.d - 3, STACK_BASE]), at([plinth.x + plinth.w - 3, plinth.y + plinth.d - 3, STACK_BASE])], { size: 0.45 }));
  return out.join("");
}

// 트레이 한 장 (빈 페이지 = 테이블이 될 판). 원점은 선반 트레이 자리, 바닥 z = 0
function trayShape({ ruler = false, lit = false } = {}) {
  const out = [];
  const tone = lit ? "hi" : "mid";
  out.push(S(k.slabOf(TRAY, 0, TRAY_FLOOR, P, 3, 0.4), { tone: "lo", lit: false }));
  out.push(S(k.slabOf(box(TRAY.x, TRAY.y, TRAY.x + TRAY.w, TRAY.y + 1.2, 0.3), TRAY_FLOOR, LIP - TRAY_FLOOR, P, 2), { tone }));
  out.push(S(k.slabOf(box(TRAY.x, TRAY.y + 1.2, TRAY.x + 1.2, TRAY.y + TRAY.d - 1.2, 0), TRAY_FLOOR, LIP - TRAY_FLOOR, P, 2), { tone }));
  out.push(S(k.slabOf(box(TRAY.x + TRAY.w - 1.2, TRAY.y + 1.2, TRAY.x + TRAY.w, TRAY.y + TRAY.d - 1.2, 0), TRAY_FLOOR, LIP - TRAY_FLOOR, P, 2), { tone }));
  out.push(`<g data-trayfront>${S(k.slabOf(box(TRAY.x, TRAY.y + TRAY.d - 1.4, TRAY.x + TRAY.w, TRAY.y + TRAY.d, 0.3), TRAY_FLOOR, LIP - TRAY_FLOOR, P, 2, 0.3), { tone, lit })}</g>`);
  if (ruler) {
    // 앞 테 윗면의 512칸 눈금: 64칸마다 작은 눈금, 256칸마다 큰 눈금 (테 바깥 모서리에서 자란다)
    const minor = [];
    const major = [];
    for (let i = 0; i <= M.ENTRIES; i += 64) {
      const x = xIdx(Math.min(i, M.ENTRIES - 1));
      (i % 256 === 0 || i === M.ENTRIES ? major : minor).push(k.lineOnTop([x, TRAY.y + TRAY.d], [x, TRAY.y + TRAY.d - (i % 256 === 0 || i === M.ENTRIES ? 1.4 : 0.8)], LIP, P));
    }
    out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  }
  return out.join("");
}

function warehouse() {
  const out = [];
  // 빈 트레이 더미: 원점이 선반 트레이 자리이므로 x로 옮겨 그린다
  const dx = STACK.x - TRAY.x;
  for (let n = 0; n < STACK_N; n++) out.push(groupAt([dx, 0, STACK_BASE + n * TRAY_H], trayShape()));
  // 더미 안내 기둥 4개
  for (const [px, py] of [[STACK.x - 2.6, STACK.y - 2.6], [STACK.x + STACK.w + 2.6, STACK.y - 2.6]]) out.push(S(k.cylinder(px, py, 1.3, STACK_BASE, STACK_TOP + 4 - STACK_BASE, P, 14), { tone: "mid", crease: "none" }));
  return out.join("");
}
function warehouseFront() {
  const out = [];
  for (const [px, py] of [[STACK.x - 2.6, STACK.y + STACK.d + 2.6], [STACK.x + STACK.w + 2.6, STACK.y + STACK.d + 2.6]]) out.push(S(k.cylinder(px, py, 1.3, STACK_BASE, STACK_TOP + 4 - STACK_BASE, P, 14), { tone: "mid", crease: "none" }));
  return out.join("");
}

// 꽂이 상자 (탄창과 zero page 꽂이 공통): 카드 한 장이 서는 주머니
function pocket(x, inner) {
  const out = [];
  const plan = box(x - 9, -49, x + 9, -31, 1.2);
  out.push(S(k.slabOf(plan, STACK_BASE, POCKET_Z - STACK_BASE, P, 3, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(plan, 2.2), POCKET_Z, P, 3), { tone: "faint" }));
  out.push(inner);
  // 앞 벽 (카드 아래쪽을 가린다)
  out.push(S(k.slabOf(box(x - 9, -34.2, x + 9, -31, 0.4), POCKET_Z, 4, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([x - 6, -31, POCKET_Z + 2]), at([x + 6, -31, POCKET_Z + 2])], { size: 0.4 }));
  return out.join("");
}
function magazine() {
  // 뒤로 기운 카드 대신 같은 자리에 겹쳐 선 카드 세 장 (맨 앞 장을 집는다)
  const cards = [-3, -1.5, 0].map((dy) => groupAt([MAG_X, dy, POCKET_Z], card("page", { text: "" }))).join("");
  const out = [pocket(MAG_X, cards)];
  // 스프링 누름판 손잡이 (탄창 뒤)
  out.push(S(k.slabOf(box(MAG_X - 6, -48.4, MAG_X + 6, -46.6, 0.4), POCKET_Z, 6, P, 2), { tone: "mid" }));
  return out.join("");
}
function zeroStand() {
  const out = [];
  // zero page 판: 꽂이 뒤에 선 판 하나 (공용 프레임, 움직이지 않는다)
  const plate = box(ZERO_X - 8, -47.6, ZERO_X + 8, -45.8, 0.4);
  out.push(S(k.slabOf(box(ZERO_X - 9, -49, ZERO_X + 9, -44.6, 0.8), STACK_BASE, 3, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf(plate, STACK_BASE + 3, 18, P, 2, 0.3), { tone: "hi", crease: "lo" }));
  out.push(faceWindow(ZERO_X - 6, ZERO_X + 6, -45.8, STACK_BASE + 19.4, STACK_BASE + 15, hx(M.PFN.zero)));
  out.push(L(frontRect(ZERO_X - 6, ZERO_X + 6, -45.8, STACK_BASE + 5, STACK_BASE + 13), { tone: "faint" }));
  const cards = [-1.4, 0].map((dy) => groupAt([ZERO_X, dy, POCKET_Z], card("page", { text: hx(M.PFN.zero) }) + lockCap(CARD))).join("");
  out.push(pocket(ZERO_X, cards));
  return out.join("");
}

// ---- 선반장 ----
function cabinetBack() {
  const out = [];
  const plinth = box(CAB.x0, CAB.y0, CAB.x1, CAB.y1, 1.5);
  out.push(`<path class="iso-halo" d="${k.haloOf(plinth, 0, 6, P)}"/>`);
  out.push(S(k.slabOf(plinth, 0, 3, P, 3, 0.6), { tone: "lo" }));
  // 뒤판과 왼쪽 옆판
  out.push(S(k.slabOf(box(CAB.x0, CAB.y0, CAB.x1, CAB.y0 + 3, 0.6), 3, CAB_TOP - 3, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(box(CAB.x0, CAB.y0 + 3, CAB.x0 + PANEL, CAB.y1, 0.6), 3, CAB_TOP - 3, P, 2, 0.4), { tone: "mid" }));
  out.push(D([14, 34, 54, 74].map((z) => at([CAB.x0 + PANEL / 2, CAB.y1, z])), { size: 0.45 }));
  return out.join("");
}
function shelf(n) {
  const plan = box(CAB.x0 + PANEL, CAB.y0 + 3, CAB.x1 - PANEL, CAB.y1, 0.4);
  const out = [S(k.slabOf(plan, SHELF_TOP[n] - SHELF_T, SHELF_T, P, 2, 0.3), { tone: "mid" })];
  out.push(L(frontRect(plan.x + 2, plan.x + plan.w - 2, CAB.y1, SHELF_TOP[n] - SHELF_T + 0.6, SHELF_TOP[n] - 0.6), { tone: "faint" }));
  return out.join("");
}
function cabinetFront() {
  const out = [];
  const panel = box(CAB.x1 - PANEL, CAB.y0 + 3, CAB.x1, CAB.y1, 0.6);
  out.push(S(k.slabOf(panel, 3, CAB_TOP - 3, P, 2, 0.4), { tone: "mid", inner: L(SHELF_TOP.slice(1).map((z) => k.sideSeam(panel, z - 1, P, 2)).join(""), { tone: "faint" }) }));
  out.push(D([14, 34, 54, 74].map((z) => at([CAB.x1 - PANEL / 2, CAB.y1, z])), { size: 0.45 }));
  return out.join("");
}

// ---- 워커 ----
function rail() {
  const out = [];
  out.push(S(k.slabOf(RAIL, 0, RAIL_H, P, 2, 0.4), { tone: "mid", inner: L(k.sideSeam(RAIL, 1, P, 2), { tone: "faint" }) }));
  for (const x of [RAIL.x - 3, RAIL.x + RAIL.w]) out.push(S(k.slabOf(box(x, RAIL.y - 1, x + 3, RAIL.y + RAIL.d + 1, 0.5), 0, 6, P, 2, 0.4), { tone: "mid" }));
  out.push(D([RAIL.x - 1.5, RAIL.x + RAIL.w + 1.5].map((x) => at([x, RAIL.y + RAIL.d / 2, 6])), { size: 0.45 }));
  // 눈금 띠: 워커의 가로 위치 = 색인 (64칸마다, 256칸마다 큰 눈금)
  const strip = box(xIdx(0) - 3, RAIL.y + RAIL.d + 1.2, xIdx(M.ENTRIES - 1) + 3, RAIL.y + RAIL.d + 4.6, 0.6);
  out.push(S(k.slabOf(strip, 0, 0.5, P, 3), { tone: "lo", crease: "none" }));
  const minor = [];
  const major = [];
  for (let i = 0; i <= M.ENTRIES; i += 32) {
    const x = xIdx(Math.min(i, M.ENTRIES - 1));
    const big = i % 256 === 0 || i === M.ENTRIES;
    const mid = i % 64 === 0;
    (big ? major : minor).push(k.lineOnTop([x, strip.y + 0.2], [x, strip.y + (big ? 2.6 : mid ? 1.7 : 1)], 0.5, P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  out.push(D([at([strip.x + 1.2, strip.y + strip.d - 1, 0.5]), at([strip.x + strip.w - 1.2, strip.y + strip.d - 1, 0.5])], { size: 0.4 }));
  return out.join("");
}
// 캐리지와 마스트: 원점 x = 0 (가로로만 움직인다)
function carriage() {
  const out = [];
  const plan = box(-7, RAIL.y - 1.6, 7, RAIL.y + RAIL.d + 1.6, 1);
  out.push(S(k.slabOf(plan, RAIL_H, 4.4, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, RAIL_H + 1.6, P, 3), { tone: "faint" }) }));
  const mast = box(-1.6, RAIL.y + 0.7, 1.6, RAIL.y + 3.9, 0.4);
  out.push(S(k.slabOf(mast, RAIL_H + 4.4, MAST_TOP - RAIL_H - 4.4, P, 2), { tone: "mid", crease: "none", inner: L(k.sideSeam(mast, headZ(1) - 4, P, 2) + k.sideSeam(mast, headZ(2) - 4, P, 2), { tone: "faint" }) }));
  out.push(S(k.slabOf(box(-2.6, RAIL.y - 0.3, 2.6, RAIL.y + 4.9, 0.4), MAST_TOP, 1.6, P, 2), { tone: "mid" }));
  // 손나사: 캐리지 앞면
  out.push(S(k.slabOf(box(-1, RAIL.y + RAIL.d + 1.6, 1, RAIL.y + RAIL.d + 3, 0.4), RAIL_H + 1.2, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(0, RAIL.y + RAIL.d + 4.4, 1.8, RAIL_H + 0.4, 3.6, P, 18), { tone: "mid" }));
  out.push(L(k.knurl(0, RAIL.y + RAIL.d + 4.4, 1.8, RAIL_H + 0.4, RAIL_H + 4, 14, P), { tone: "lo" }));
  return out.join("");
}
// 헤드: 원점 x = 0, z = 0이 헤드 가운데 (마스트를 따라 오르내린다)
function head() {
  const plan = box(-4.6, PROBE_FROM, 4.6, RAIL.y + 5.6, 0.8);
  return [
    S(k.slabOf(plan, -3.2, 6.4, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(plan, 0, P, 3), { tone: "faint" }) }),
    D([at([-2.8, RAIL.y + 5.6, 1.6]), at([2.8, RAIL.y + 5.6, 1.6])], { size: 0.45 }),
  ].join("");
}

// ---- 깃발 ----
function flagPost() {
  const [x, y] = FLAG_POST;
  const out = [];
  out.push(S(k.cylinder(x, y, 3.4, 0, 2, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(x, y, 1.1, 2, FLAG_UP + 9, P, 14), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(x, y, 1.8, FLAG_UP + 11, 1.4, P, 16), { tone: "mid" }));
  return out.join("");
}
// 깃발 판: 원점 z = 0 (기둥을 따라 오르내린다)
function flagPlate() {
  const [x, y] = FLAG_POST;
  const plan = box(x + 1.1, y - 0.6, x + 11, y + 0.6, 0.2);
  return [
    S(k.cylinder(x, y, 1.8, -0.6, 7.2, P, 16), { tone: "mid" }),
    S(k.slabOf(plan, 0, 6, P, 2), { tone: "mid" }),
    L(frontRect(x + 2.6, x + 9.6, y + 0.6, 1.4, 4.6), { tone: "lo" }),
  ].join("");
}

// ---- 카드 인덱스 (TLB) ----
function tlbBack() {
  const out = [`<path class="iso-halo" d="${k.haloOf(TLB, 0, 4, P)}"/>`];
  out.push(S(k.slabOf(TLB, 0, 1.6, P, 3, 0.5), { tone: "lo" }));
  // 뒤 벽과 옆 벽 (카드보다 먼저)
  out.push(S(k.slabOf(box(TLB.x, TLB.y, TLB.x + TLB.w, TLB.y + 1.6, 0.4), 1.6, TLB_H - 1.6, P, 2, 0.3), { tone: "mid" }));
  out.push(S(k.slabOf(box(TLB.x, TLB.y + 1.6, TLB.x + 1.6, TLB.y + TLB.d - 1.6, 0), 1.6, TLB_H - 1.6, P, 2), { tone: "mid" }));
  // 카드 칸막이 레일 (바닥 위 닫힌 홈)
  out.push(L(TLB_SLOT_X.map((x) => k.planOutline(box(x - TLB_CARD.hw - 1, TLB_CARD.y0 - 0.6, x + TLB_CARD.hw + 1, TLB_CARD.y1 + 0.6, 0.4), 1.6, P, 2)).join(""), { tone: "faint" }));
  // 빗 안내 기둥 둘: 카드 뒤에 서서 빗이 카드를 가리지 않는다
  for (const x of [TLB.x + 4, TLB.x + TLB.w - 4]) {
    out.push(S(k.cylinder(x, COMB_Y, 2.2, 1.6, 1.6, P, 18), { tone: "mid" }));
    out.push(S(k.cylinder(x, COMB_Y, 1.2, 3.2, COMB_Z + 8 - 3.2, P, 14), { tone: "mid", crease: "none" }));
    out.push(S(k.cylinder(x, COMB_Y, 1.8, COMB_Z + 8, 1.2, P, 16), { tone: "mid" }));
  }
  return out.join("");
}
function tlbFront() {
  const out = [];
  out.push(S(k.slabOf(box(TLB.x + TLB.w - 1.6, TLB.y + 1.6, TLB.x + TLB.w, TLB.y + TLB.d - 1.6, 0), 1.6, TLB_H - 1.6, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf(box(TLB.x, TLB.y + TLB.d - 1.6, TLB.x + TLB.w, TLB.y + TLB.d, 0.4), 1.6, TLB_H - 1.6, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(box(TLB.x, TLB.y + TLB.d - 1.6, TLB.x + TLB.w, TLB.y + TLB.d, 0.4), 4, P, 2), { tone: "faint" }) }));
  out.push(D([at([TLB.x + 4, TLB.y + TLB.d, 5]), at([TLB.x + TLB.w - 4, TLB.y + TLB.d, 5])], { size: 0.45 }));
  // 크랭크 노브 (오른쪽 벽)
  const kx = TLB.x + TLB.w + 3;
  const ky = TLB.y + TLB.d / 2;
  out.push(S(k.slabOf(box(TLB.x + TLB.w, ky - 1, kx - 1.6, ky + 1, 0.3), 3, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(kx, ky, 2.6, 1.6, 5, P, 22), { tone: "mid" }));
  out.push(L(k.knurl(kx, ky, 2.6, 1.6, 6.6, 18, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([kx, ky], [kx + 2.6, ky], 6.6, P), { tone: "hi" }));
  return out.join("");
}
// 감지 빗: 원점 z = 0 (안내 기둥을 따라 오르내린다)
function comb() {
  const plan = box(TLB.x + 1.6, COMB_Y - 2.2, TLB.x + TLB.w - 1.6, COMB_Y + 2.2, 0.6);
  const out = [S(k.slabOf(plan, 0, 2.6, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(plan, 1.2, P, 3), { tone: "faint" }) })];
  // 감지 창: 카드 칸마다 하나 (윗면의 닫힌 홈)
  out.push(L(TLB_SLOT_X.map((x) => k.planOutline(box(x - 4, COMB_Y - 1, x + 4, COMB_Y + 1, 0.4), 2.6, P, 2)).join(""), { tone: "lo" }));
  out.push(D(TLB_SLOT_X.map((x) => at([x, COMB_Y + 2.2, 1.6])), { size: 0.45 }));
  return out.join("");
}

// ---- 주소 막대 ----
function bar() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BAR, 0, 4, P)}"/>`];
  out.push(S(k.slabOf(BAR, 0, BAR_H, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(BAR, 2, P, 3), { tone: "faint" }) }));
  // 키 홈 (닫힌 홈 하나)
  out.push(L(k.planOutline(box(keyX(0) - 1.4, BAR.y + 3, keyX(M.VA_BITS - 1) + KEY.w + 1.4, BAR.y + 10.4, 0.6), BAR_H, P, 2), { tone: "faint" }));
  // 끝 캡과 이송 노브 (오른쪽)
  out.push(S(k.slabOf(box(BAR.x + BAR.w, BAR.y + 3, BAR.x + BAR.w + 3, BAR.y + BAR.d - 3, 0.5), 0.6, BAR_H - 1.2, P, 2), { tone: "mid" }));
  const kx = BAR.x + BAR.w + 6.6;
  const ky = BAR.y + BAR.d / 2;
  out.push(S(k.cylinder(kx, ky, 3.6, 1, 5.6, P, 26), { tone: "mid" }));
  out.push(L(k.knurl(kx, ky, 3.6, 1, 6.6, 22, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([kx, ky], [kx + 3.6, ky], 6.6, P), { tone: "hi" }));
  // 읽기/쓰기 스위치 홈 (왼쪽 끝 위)
  out.push(L(k.planOutline(box(BAR.x + 3, BAR.y + 4, BAR.x + 7, BAR.y + BAR.d - 4, 1.2), BAR_H, P, 3), { tone: "lo" }));
  return out.join("");
}
function dividers() {
  const out = [];
  for (let g = 1; g < FIELD_BITS.length; g++) {
    const x = (groupSpan(g - 1)[1] + groupSpan(g)[0]) / 2;
    out.push(S(k.slabOf(box(x - 0.45, BAR.y + 2.2, x + 0.45, BAR.y + 11.6, 0.2), BAR_H, 4, P, 2), { tone: "mid", crease: "none" }));
  }
  return out.join("");
}
// 색인 창 다섯 개: 막대 앞면, 칸마다 하나
function windows() {
  return FIELD_BITS.map((_, g) => {
    const [x0, x1] = groupSpan(g);
    const c = (x0 + x1) / 2;
    return `<g data-window="${g}">${faceWindow(c - 6.4, c + 6.4, BAR.y + BAR.d, BAR_H - 1, 1.2, "", { part: `win-${g}`, size: 3.1 })}</g>`;
  }).join("");
}
// 키 하나: 막대 윗면에 선다. 1이면 올라온 키, 0이면 눌린 키 (둘 다 만들어 두고 하나만 보인다)
const KEY_UP = 2.4;
const KEY_DOWN = 0.7;
function keySvg(i) {
  const x = keyX(i);
  const plan = box(x, BAR.y + 4, x + KEY.w, BAR.y + 9.4, 0.3);
  return `<g data-key="${i}"><g data-bit="1">${S(k.slabOf(plan, BAR_H, KEY_UP, P, 2), { tone: "mid", crease: "lo" })}</g><g data-bit="0">${S(k.slabOf(plan, BAR_H, KEY_DOWN, P, 2), { tone: "lo", crease: "faint" })}</g></g>`;
}
function rwKnob() {
  return S(k.slabOf(box(BAR.x + 3.6, -1.6, BAR.x + 6.4, 1.6, 0.6), BAR_H, 3, P, 3), { tone: "mid" });
}

// ---- 그림 조립 ----
const STATIC_CARDS = [0, 1].map((n) => groupAt([xIdx(IDX[n]), 0, SHELF_TOP[n] + TRAY_FLOOR], card("table"), ` data-entry="l${n}"`));
const L2_CARD = groupAt([xIdx(IDX[2]), 0, SHELF_TOP[2] + TRAY_FLOOR], card("table"), ` data-entry="l2" style="opacity:0"`);
// 움직이는 노드: L3 트레이, L3 카드 둘(p0, p1 자리), 크레인이 나르는 카드, TLB 카드 둘
const TRAY3 = `<g data-part="tray3" data-sel="l3" transform="">${trayShape({ ruler: true })}</g>`;
const l3Card = (name) => `<g data-part="${name}" data-sel="l3" style="display:none" transform="">${card("page", { part: name })}${lockCap(CARD)}</g>`;
const tlbCard = (slot) => `<g data-part="tlb-${slot}" data-sel="tlb" style="display:none" transform="">${card("page", { part: `tlb-${slot}`, spec: TLB_CARD })}${lockCap(TLB_CARD)}</g>`;
const KEYS = Array.from({ length: M.VA_BITS }, (_, i) => keySvg(i)).join("");

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `가상 주소 변환 기계. 앞쪽 주소 막대의 키 ${M.VA_BITS}개가 9, 9, 9, 9, 12비트로 나뉘고, 카드 인덱스(TLB)에 변환이 없으면 워커가 뒤쪽 4단 선반장의 L0부터 L3까지 색인 자리의 카드를 차례로 읽는다. 카드가 없는 자리에서 깃발이 오르면 위 크레인이 오른쪽 창고에서 트레이나 카드를 가져와 꽂고, 워커가 처음부터 다시 걷는다.`,
  body: [
    base(),
    sel("crane", cranePost(POST_X[0])),
    sel("store", rack(), groupAt([0, 0, RACK_Z], storeBase() + warehouse())),
    sel("zero", groupAt([0, 0, RACK_Z], zeroStand())),
    sel("store", groupAt([0, 0, RACK_Z], magazine() + warehouseFront())),
    cabinetBack(),
    sel("l0", shelf(0), groupAt([0, 0, SHELF_TOP[0]], trayShape({ ruler: true })), STATIC_CARDS[0]),
    sel("l1", shelf(1), groupAt([0, 0, SHELF_TOP[1]], trayShape({ ruler: true })), STATIC_CARDS[1]),
    sel("l2", shelf(2), groupAt([0, 0, SHELF_TOP[2]], trayShape({ ruler: true })), L2_CARD),
    sel("l3", shelf(3)),
    `<g data-layer="inner">${TRAY3}${l3Card("l3-a")}${l3Card("l3-b")}</g>`,
    cabinetFront(),
    sel("crane", cranePost(POST_X[1]), beam()),
    `<g data-layer="high"></g>`,
    groupAt([CRANE_PARK, 0, 0], trolley(), ` data-part="trolley" data-sel="crane"`),
    sel("crane", `<path class="iso-line" data-part="cable" data-tone="mid" d=""/>`),
    groupAt([CRANE_PARK, 0, HOOK_UP], hook(), ` data-part="hook" data-sel="crane"`),
    `<g data-part="carry-card" data-sel="l3" style="display:none" transform="">${card("page", { part: "carry" })}${lockCap(CARD)}</g>`,
    sel("walker", rail()),
    groupAt([PARK_X, 0, 0], carriage(), ` data-part="carriage" data-sel="walker"`),
    `<g data-part="probe" data-sel="walker"></g>`,
    groupAt([PARK_X, 0, headZ(0)], head(), ` data-part="head" data-sel="walker"`),
    sel("flag", flagPost()),
    groupAt([0, 0, FLAG_DOWN], flagPlate(), ` data-part="flag" data-sel="flag"`),
    sel("tlb", tlbBack()),
    groupAt([0, 0, COMB_Z], comb(), ` data-part="comb" data-sel="tlb"`),
    tlbCard(0),
    tlbCard(1),
    sel("tlb", tlbFront()),
    sel("va", bar(), KEYS, dividers(), windows()),
    groupAt([0, BAR.y + BAR.d / 2, 0], rwKnob(), ` data-part="rw" data-sel="va"`),
  ],
});

const CFG = {
  P,
  SHELF_TOP, TRAY_FLOOR, LIP, CAB_TOP, CARD_H: CARD.h, CARD_Y1: CARD.y1,
  X0: xIdx(0), X1: xIdx(M.ENTRIES - 1), ENTRIES: M.ENTRIES,
  PARK_X, HEAD_Z: [0, 1, 2, 3].map(headZ), HEAD_PARK: headZ(0), PROBE_FROM, PROBE_TO, RAIL_Y: RAIL.y,
  CRANE_PARK, CRANE_Y, BEAM_Z, TROLLEY_H, HOOK_H, HOOK_UP,
  STACK_DX: STACK.x - TRAY.x, STACK_TOP: RACK_Z + STACK_TOP, TRAY_H, TRAY_CX: TRAY.x + TRAY.w / 2,
  MAG_X, ZERO_X, POCKET_Z: RACK_Z + POCKET_Z,
  FLAG_DOWN, FLAG_UP,
  TLB_SLOT_X, TLB_CARD_Z: 1.6, TLB_LIFT: 4.4, COMB_Z, COMB_DOWN,
  KEY_UP, KEY_DOWN, BAR_H, RW_Y: [BAR.y + BAR.d - 6.6, BAR.y + 6.6],
  INIT_STEPS,
  SECONDS: { tlb: 0.8, walk: 0.75, kernel: 2.2, rewind: 1 },
  TOUR_GAP: 0.55, TOUR_REST: 1.6, RESUME: 6,
};

const live = `
const C = ${JSON.stringify(CFG)};
const P = C.P;
const TRACE = MODEL.trace();
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const q = (s) => svg.querySelector(s);
const readoutEl = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const el = {
  tray3: q('[data-part="tray3"]'), l3: [q('[data-part="l3-a"]'), q('[data-part="l3-b"]')], carry: q('[data-part="carry-card"]'),
  trolley: q('[data-part="trolley"]'), hook: q('[data-part="hook"]'), cable: q('[data-part="cable"]'),
  carriage: q('[data-part="carriage"]'), head: q('[data-part="head"]'), probe: q('[data-part="probe"]'),
  flag: q('[data-part="flag"]'), comb: q('[data-part="comb"]'), rw: q('[data-part="rw"]'),
  tlb: [q('[data-part="tlb-0"]'), q('[data-part="tlb-1"]')],
  l2card: q('[data-entry="l2"]'),
  keys: [...svg.querySelectorAll("[data-key]")],
};
const layer = { inner: q('[data-layer="inner"]'), high: q('[data-layer="high"]') };
const digit = (name) => q('[data-digit="' + name + '"]');
const PARTS = ${JSON.stringify(PARTS)};
const NOTE_IDLE = ${JSON.stringify(NOTE_IDLE)};
const note = document.querySelector("[data-note]");
const picks = [...document.querySelectorAll("[data-pick]")];
const groups = [...svg.querySelectorAll("[data-sel]")];
let hoverSel = null, pinSel = null, shownSel = null;
const picked = () => hoverSel ?? pinSel;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const seg = (u, a, b) => ease((u - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const xIdx = (i) => C.X0 + (i / (C.ENTRIES - 1)) * (C.X1 - C.X0);
const L3_SLOT = [MODEL.split(MODEL.PAGES.p0.va).index[3], MODEL.split(MODEL.PAGES.p1.va).index[3]];

// 페이지는 trace의 몇 번째 상태인지(n)를 함께 들고 다닌다. 상태 자체는 MODEL.step으로 만든다
let n = C.INIT_STEPS;
let state = TRACE[0];
for (let i = 0; i < n; i++) state = MODEL.step(state);
let anim = null; // { from, to, fromN, toN, kind, t, seconds }
const accessOf = (s) => MODEL.ACCESSES[s.last ? s.last.i : 0];
const pageOf = (s) => MODEL.PAGES[accessOf(s).page];
// 워커는 마지막으로 읽은 자리에 머문다. fault로 커널이 들어오면 걷기를 버리고 왼쪽 끝(L0 높이)으로 물러난다
function walkerAt(upTo) {
  for (let i = upTo; i > 0; i--) {
    const l = TRACE[i].last;
    if (l.kind === "kernel") break;
    if (l.kind === "walk" || (l.kind === "fault" && l.via === "walk")) return { x: xIdx(l.index), z: C.HEAD_Z[l.level], level: l.level };
  }
  return { x: C.PARK_X, z: C.HEAD_PARK, level: -1 };
}
const reading = (s) => !!s.last && (s.last.kind === "walk" || (s.last.kind === "fault" && s.last.via === "walk"));
// 움직인 부품이 없는 상태(entry)의 lit: 다음 STEP(TLB 조회)이 움직일 감지 빗
function litOf(s) {
  const l = s.last;
  if (!l || l.kind === "tlb-miss") return "comb";
  if (l.kind === "tlb-hit") return "tlb";
  if (l.kind === "fault") return "flag";
  if (l.kind === "walk") return "head";
  return l.did === "table" ? "tray3" : "l3card";
}

// 정지 자세: 상태 하나(와 trace 위치)로 정해진다
function rest(s, at) {
  const va = pageOf(s).va;
  const w = walkerAt(at);
  const t3 = s.tables[3];
  const lit = litOf(s);
  const hitPage = s.last && (s.last.kind === "tlb-hit" || (s.last.kind === "fault" && s.last.via === "tlb")) ? Math.floor(va / 4096) : null;
  return {
    bits: MODEL.bitsOf(va),
    split: MODEL.split(va),
    write: accessOf(s).op === "write" ? 1 : 0,
    field: reading(s) ? s.last.level : -1,
    comb: 0,
    tlb: [0, 1].map((slot) => {
      const c = s.tlb[slot];
      if (!c) return null;
      const hit = c.page === hitPage;
      return { pfn: c.pfn, rw: c.rw, lift: hit ? 1 : 0, o: 1, lit: hit && lit === "tlb" };
    }),
    walker: { x: w.x, z: w.z, probe: reading(s) ? 1 : 0 },
    flag: s.fault ? 1 : 0,
    crane: { x: C.CRANE_PARK, hook: C.HOOK_UP, carry: null },
    l2: s.tables[2][MODEL.split(va).index[2]] ? 1 : 0,
    tray3: t3 ? { where: "deck", x: C.TRAY_CX, z: C.SHELF_TOP[3] } : null,
    l3: L3_SLOT.map((slot) => {
      const e = t3 && t3[slot];
      if (!e) return null;
      return { x: xIdx(slot), z: C.SHELF_TOP[3] + C.TRAY_FLOOR, pfn: e.pfn, rw: e.rw, o: 1, lit: lit === "l3card" && s.last.index === slot };
    }),
    lit,
  };
}

// 크레인 한 번 왕복: 집는 곳(src)에서 놓는 곳(dst)까지. u = 0..1, 놓는 순간은 0.78
function craneTrip(pose, u, src, dst) {
  const legs = [[0, 0.16], [0.16, 0.27], [0.27, 0.38], [0.38, 0.6], [0.6, 0.74], [0.82, 0.9], [0.9, 1]];
  let x = C.CRANE_PARK, hookZ = C.HOOK_UP, held = false;
  if (u < legs[0][1]) x = lerp(C.CRANE_PARK, src.x, seg(u, ...legs[0]));
  else if (u < legs[1][1]) { x = src.x; hookZ = lerp(C.HOOK_UP, src.hook, seg(u, ...legs[1])); }
  else if (u < legs[2][1]) { x = src.x; hookZ = lerp(src.hook, C.HOOK_UP, seg(u, ...legs[2])); held = true; }
  else if (u < legs[3][1]) { x = lerp(src.x, dst.x, seg(u, ...legs[3])); held = true; }
  else if (u < legs[4][1]) { x = dst.x; hookZ = lerp(C.HOOK_UP, dst.hook, seg(u, ...legs[4])); held = true; }
  else if (u < legs[5][0]) { x = dst.x; hookZ = dst.hook; }
  else if (u < legs[5][1]) { x = dst.x; hookZ = lerp(dst.hook, C.HOOK_UP, seg(u, ...legs[5])); }
  else x = lerp(dst.x, C.CRANE_PARK, seg(u, ...legs[6]));
  pose.crane = { x, hook: hookZ, carry: held ? { ...src.carry } : null };
  return u >= legs[4][1];
}

// 전이 자세: 직전 상태에서 다음 상태로, u = 0..1
function between(a, b, u, kind, toN) {
  const pose = rest(a, toN - 1);
  const end = rest(b, toN);
  if (u >= 1) return end;
  const l = b.last;
  // 주소 막대: 다음 접근의 주소와 스위치로 (조회 첫머리)
  const keyT = seg(u, 0, 0.3);
  pose.bits = pose.bits.map((v, i) => lerp(v, end.bits[i], keyT));
  pose.write = lerp(pose.write, end.write, keyT);
  if (u > 0.15) pose.split = end.split;
  pose.field = -1;
  // 읽던 탐침은 먼저 빠진다
  pose.walker.probe *= 1 - seg(u, 0, 0.12);
  pose.tlb = pose.tlb.map((c) => c && { ...c, lift: c.lift * (1 - seg(u, 0, 0.2)), lit: false });
  pose.l3 = pose.l3.map((c) => c && { ...c, lit: false });
  if (l.kind === "tlb-miss" || l.kind === "tlb-hit" || (l.kind === "fault" && l.via === "tlb")) {
    pose.comb = seg(u, 0.25, 0.5) * (1 - seg(u, 0.55, 0.85));
    pose.lit = "comb";
    if (l.kind !== "tlb-miss") {
      const slot = b.tlb.findIndex((c) => c.page === Math.floor(pageOf(b).va / 4096));
      const lift = seg(u, 0.5, 0.75);
      pose.tlb[slot] = { ...end.tlb[slot], lift, lit: u >= 0.5 };
      if (u >= 0.5) pose.lit = "tlb";
      if (l.kind === "fault") { pose.flag = seg(u, 0.75, 0.95); if (u >= 0.75) { pose.lit = "flag"; pose.tlb[slot].lit = false; } }
    }
    return pose;
  }
  if (l.kind === "walk" || l.kind === "fault") {
    const to = end.walker;
    const t = seg(u, 0.12, 0.62);
    pose.walker = { x: lerp(pose.walker.x, to.x, t), z: lerp(pose.walker.z, to.z, t), probe: u < 0.62 ? pose.walker.probe : seg(u, 0.62, 0.82) };
    pose.lit = "head";
    if (u >= 0.82) pose.field = l.level;
    if (l.kind === "fault") { pose.flag = seg(u, 0.82, 1); if (u >= 0.85) pose.lit = "flag"; }
    if (l.kind === "walk" && l.entry === "page") {
      // 성공한 변환을 TLB 카드로 둔다 (아래로 떨어지듯 들어온다)
      const slot = b.tlb.findIndex((c) => c.page === Math.floor(pageOf(b).va / 4096));
      if (u >= 0.84) pose.tlb[slot] = { ...end.tlb[slot], lift: 1 - seg(u, 0.84, 1), o: seg(u, 0.84, 0.94), lit: false };
    }
    return pose;
  }
  // kernel: 워커는 물러나고 크레인이 한 번 왕복한다
  const home = seg(u, 0.04, 0.3);
  pose.walker = { x: lerp(pose.walker.x, end.walker.x, home), z: lerp(pose.walker.z, end.walker.z, home), probe: pose.walker.probe };
  pose.lit = l.did === "table" ? "tray3" : "l3card";
  const deck = C.SHELF_TOP[3];
  if (l.did === "table") {
    const src = { x: C.CRANE_PARK, hook: C.STACK_TOP, carry: { kind: "tray" } };
    const dst = { x: C.TRAY_CX, hook: deck + C.TRAY_H };
    const placed = craneTrip(pose, u, src, dst);
    if (pose.crane.carry) pose.tray3 = { where: "hook", x: pose.crane.x, z: pose.crane.hook - C.TRAY_H, o: 1 };
    else if (placed) pose.tray3 = { where: "deck", x: C.TRAY_CX, z: deck, o: 1 };
    pose.l2 = placed ? seg(u, 0.74, 0.86) : 0;
    return pose;
  }
  const slotX = xIdx(l.index);
  const which = L3_SLOT.indexOf(l.index);
  const cardTop = deck + C.TRAY_FLOOR + C.CARD_H;
  const fromZero = l.did === "zero";
  const src = { x: fromZero ? C.ZERO_X : C.MAG_X, hook: C.POCKET_Z + C.CARD_H, carry: { kind: "card", pfn: l.pfn, rw: l.rw } };
  const dst = { x: slotX, hook: cardTop };
  const placed = craneTrip(pose, u, src, dst);
  if (l.did === "cow") {
    // 옛 zero page 카드와 그 TLB 카드는 새 카드를 놓기 전에 빠진다 (ptep_clear_flush)
    const gone = 1 - seg(u, 0.6, 0.72);
    if (!placed) pose.l3[which] = pose.l3[which] && { ...pose.l3[which], o: gone };
    pose.tlb = pose.tlb.map((c, slot) => (c && !b.tlb[slot] ? { ...c, o: gone } : c));
  }
  if (placed) pose.l3[which] = { ...end.l3[which], lit: true };
  if (placed) pose.flag = 1 - seg(u, 0.84, 1);
  return pose;
}

function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }
function show(node, on, o = 1) {
  node.style.display = on ? "" : "none";
  node.style.opacity = on && o < 1 ? o.toFixed(3) : "";
}
function setCard(node, name, c) {
  show(node, !!c && c.o > 0.001, c ? c.o : 0);
  if (!c) return;
  const text = MODEL.hex(c.pfn);
  const d = digit(name);
  if (d.textContent !== text) d.textContent = text;
  node.querySelector("[data-lock]").style.display = c.rw ? "none" : "";
  node.querySelector(".iso-solid").toggleAttribute("data-lit", !!c.lit);
  node.toggleAttribute("data-on", !!c.lit);
}
function lit(node, on) { node.querySelector(".iso-solid").toggleAttribute("data-lit", on); node.toggleAttribute("data-on", on); }
function draw(pose) {
  el.keys.forEach((node, i) => {
    const up = pose.bits[i] >= 0.5;
    if (node.dataset.up !== String(up)) {
      node.dataset.up = String(up);
      node.children[0].style.display = up ? "" : "none";
      node.children[1].style.display = up ? "none" : "";
    }
  });
  put(el.rw, [0, lerp(C.RW_Y[0], C.RW_Y[1], pose.write) - (C.RW_Y[0] + C.RW_Y[1]) / 2, 0]);
  const texts = [...pose.split.index.map(String), MODEL.hex(pose.split.offset, 3)];
  texts.forEach((t, g) => {
    const d = digit("win-" + g);
    if (d.textContent !== t) d.textContent = t;
    d.parentNode.parentNode.toggleAttribute("data-on", pose.field === g);
  });
  put(el.comb, [0, 0, C.COMB_Z - pose.comb * C.COMB_DOWN]);
  lit(el.comb, pose.lit === "comb");
  pose.tlb.forEach((c, slot) => {
    setCard(el.tlb[slot], "tlb-" + slot, c);
    if (c) put(el.tlb[slot], [C.TLB_SLOT_X[slot], 0, C.TLB_CARD_Z + c.lift * C.TLB_LIFT]);
  });
  put(el.carriage, [pose.walker.x, 0, 0]);
  put(el.head, [pose.walker.x, 0, pose.walker.z]);
  lit(el.head, pose.lit === "head");
  const py = lerp(C.PROBE_FROM - 1.4, C.PROBE_TO, pose.walker.probe);
  const px = pose.walker.x, pz = pose.walker.z;
  el.probe.innerHTML = solidSvg(slabOf({ x: px - 0.7, y: py, w: 1.4, d: C.PROBE_FROM - py + 0.2, r: 0.3 }, pz - 0.7, 1.4, P, 2), { tone: "hi", crease: "none" });
  put(el.flag, [0, 0, lerp(C.FLAG_DOWN, C.FLAG_UP, pose.flag)]);
  lit(el.flag, pose.lit === "flag");
  // 크레인
  put(el.trolley, [pose.crane.x, 0, 0]);
  put(el.hook, [pose.crane.x, 0, pose.crane.hook]);
  el.cable.setAttribute("d", pathOf([iso([pose.crane.x - 3, C.CRANE_Y, C.BEAM_Z - C.TROLLEY_H - 2], P), iso([pose.crane.x, C.CRANE_Y, pose.crane.hook + C.HOOK_H + 1.6], P)]));
  const carryCard = pose.crane.carry && pose.crane.carry.kind === "card" ? pose.crane.carry : null;
  setCard(el.carry, "carry", carryCard && { pfn: carryCard.pfn, rw: carryCard.rw, o: 1, lit: true });
  if (carryCard) put(el.carry, [pose.crane.x, 0, pose.crane.hook - C.CARD_H]);
  // L3 트레이와 카드
  const t3 = pose.tray3;
  show(el.tray3, !!t3, t3 ? (t3.o ?? 1) : 0);
  if (t3) {
    put(el.tray3, [t3.x - C.TRAY_CX, 0, t3.z]);
    el.tray3.querySelector("[data-trayfront] .iso-solid").toggleAttribute("data-lit", pose.lit === "tray3");
    el.tray3.toggleAttribute("data-on", pose.lit === "tray3");
  }
  pose.l3.forEach((c, i) => {
    setCard(el.l3[i], "l3-" + (i ? "b" : "a"), c);
    if (c) put(el.l3[i], [c.x, 0, c.z]);
  });
  el.l2card.style.opacity = pose.l2 >= 1 ? "" : pose.l2.toFixed(3);
  // 선반장 위로 올라간 것은 오른쪽 옆판 다음에 그린다
  const high = (z) => z > C.CAB_TOP + 0.5;
  const trayHigh = !!t3 && t3.where === "hook" && high(t3.z);
  if ((el.tray3.parentNode === layer.high) !== trayHigh) (trayHigh ? layer.high : layer.inner).appendChild(el.tray3);
  const cardHigh = !!carryCard && high(pose.crane.hook - C.CARD_H);
  if ((el.carry.parentNode === layer.high) !== cardHigh) (cardHigh ? layer.high : layer.inner).appendChild(el.carry);
}

function say() {
  const text = MODEL.readout(state);
  if (readoutEl.textContent !== text) readoutEl.textContent = text;
  return text;
}
const kindOf = (s) => (s.last.kind === "kernel" ? "kernel" : s.last.kind === "walk" || (s.last.kind === "fault" && s.last.via === "walk") ? "walk" : "tlb");

// 루프
let frame = 0, last = 0, visible = false, touring = !still.matches, wait = C.TOUR_REST, idleTimer = 0;
function begin(from, to, toN, kind) {
  anim = { from, to, toN, kind, t: 0, seconds: C.SECONDS[kind] };
  if (still.matches) { anim = null; draw(rest(to, toN)); }
  run();
}
function advance() {
  if (state.done) return false;
  const from = state;
  state = MODEL.step(state);
  n += 1;
  say();
  begin(from, state, n, kindOf(state));
  return true;
}
function rewind() {
  const from = state;
  const fromN = n;
  state = MODEL.makeState();
  n = 0;
  say();
  if (fromN === 0) return;
  anim = { from, to: state, toN: 0, kind: "rewind", t: 0, seconds: C.SECONDS.rewind, fromN };
  if (still.matches) { anim = null; draw(rest(state, 0)); }
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (anim) {
    anim.t += dt / anim.seconds;
    const u = Math.min(1, anim.t);
    draw(anim.kind === "rewind" ? rewindPose(anim, u) : between(anim.from, anim.to, u, anim.kind, anim.toN));
    if (anim.t >= 1) anim = null;
  }
  if (touring && !anim) {
    wait -= dt;
    if (wait <= 0) {
      if (state.done) { rewind(); wait = C.TOUR_GAP; }
      else { advance(); wait = state.done ? C.TOUR_GAP + C.TOUR_REST : C.TOUR_GAP; }
    }
  }
  frame = visible && (anim || touring) ? requestAnimationFrame(tick) : 0;
}
function rewindPose(a, u) {
  // between의 rewind 분기는 trace 위치를 쓰므로 출발 자세를 직접 넘긴다
  const pose = rest(a.from, a.fromN);
  const end = rest(a.to, 0);
  if (u >= 1) return end;
  const t = seg(u, 0, 0.9);
  const fade = 1 - seg(u, 0, 0.5);
  const out = u < 0.5 ? pose : { ...end };
  out.walker = { x: lerp(pose.walker.x, end.walker.x, t), z: lerp(pose.walker.z, end.walker.z, t), probe: pose.walker.probe * (1 - seg(u, 0, 0.2)) };
  out.flag = lerp(pose.flag, end.flag, t);
  out.bits = pose.bits.map((v, i) => lerp(v, end.bits[i], t));
  out.write = lerp(pose.write, end.write, t);
  if (u < 0.5) {
    out.tlb = pose.tlb.map((c) => c && { ...c, o: fade, lit: false });
    out.l3 = pose.l3.map((c) => c && { ...c, o: fade, lit: false });
    if (pose.tray3) out.tray3 = { ...pose.tray3, o: fade };
    out.l2 = pose.l2 * fade;
  }
  out.lit = "none";
  return out;
}
function run() { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } }
function takeOver() {
  touring = false;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (still.matches || picked()) return; touring = true; wait = C.TOUR_REST; run(); }, C.RESUME * 1000);
}
// 고르는 동안 투어를 멈춘다: 커서 밑에서 부품이 움직이면 선택이 깜빡이고 lit이 둘이 된다
function choose() {
  const id = picked();
  if (id === shownSel) return;
  shownSel = id;
  if (id) stage.dataset.focus = id;
  else delete stage.dataset.focus;
  groups.forEach((g) => g.toggleAttribute("data-picked", g.dataset.sel === id));
  picks.forEach((b) => b.toggleAttribute("data-picked", b.dataset.pick === id));
  const part = PARTS.find((p) => p.id === id);
  if (part) {
    const name = document.createElement("b");
    name.textContent = part.no + " " + part.name + " | " + part.concept;
    note.replaceChildren(name, " " + part.text);
  } else note.textContent = NOTE_IDLE;
  if (id) { touring = false; clearTimeout(idleTimer); }
  else takeOver();
}
const mouse = (event) => event.pointerType !== "touch";
svg.addEventListener("pointerover", (event) => {
  if (!mouse(event)) return;
  const g = event.target.closest("[data-sel]");
  hoverSel = g ? g.dataset.sel : null;
  choose();
});
stage.addEventListener("pointerleave", (event) => { if (mouse(event)) { hoverSel = null; choose(); } });
picks.forEach((b) => {
  b.addEventListener("pointerenter", (event) => { if (mouse(event)) { hoverSel = b.dataset.pick; choose(); } });
  b.addEventListener("pointerleave", (event) => { if (mouse(event)) { hoverSel = null; choose(); } });
  b.addEventListener("focus", () => { pinSel = b.dataset.pick; choose(); });
  b.addEventListener("blur", () => { if (pinSel === b.dataset.pick) { pinSel = null; choose(); } });
  b.addEventListener("click", () => { pinSel = b.dataset.pick; choose(); });
});
// 탭으로 고르면 포커스가 오지 않는 브라우저가 있다: 부품 목록과 그림 밖을 누르면 푼다
document.addEventListener("click", (event) => {
  if (pinSel && !event.target.closest(".pw-parts, .iso-stage")) { pinSel = null; choose(); }
});
// 손으로 STEP이나 reset을 하면 진행 중인 전이는 끝 자세로 맞추고 다음 전이를 시작한다
function settleNow() { if (anim) { draw(rest(anim.to, anim.toN)); anim = null; } }
function userStep() { takeOver(); settleNow(); advance(); status.textContent = say(); }
function userReset() { takeOver(); settleNow(); state = MODEL.makeState(); n = 0; say(); draw(rest(state, 0)); status.textContent = say(); }

new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", () => { userStep(); stage.focus({ preventScroll: true }); });
stage.addEventListener("keydown", (event) => {
  if (event.key === "ArrowRight" || event.key === " ") { event.preventDefault(); userStep(); }
  else if (event.key === "Home") { event.preventDefault(); userReset(); }
});
window.mechanism = {
  reset() { userReset(); return say(); },
  step() { userStep(); return say(); },
  readout() { return readoutEl.textContent; },
  // 검증용: 묶음 하나를 번호로 고른 것처럼 (null이면 푼다). 설명 줄 문자열을 돌려준다
  pick(id) { pinSel = id; hoverSel = null; choose(); return note.textContent; },
};
say();
draw(rest(state, n));
`;

// 고른 묶음은 선 톤을 한 단계 올리고 면을 lit 채움으로, 나머지는 한 단계 내린다.
// 투명도로 흐리게 하지 않는다: 앞 부품이 비치면 페인터 순서로 가린 뒤 선이 드러난다.
const F = ".iso-stage[data-focus]";
const FP = `${F} [data-picked]`;
const SHADES = [0, 1, 2, 3];
const FOCUS_CSS = [
  `${F} .iso-line[data-tone="hi"],${F} .iso-line[data-tone="lit"]{stroke:var(--anatomy-mid)}`,
  `${F} .iso-line[data-tone="mid"]{stroke:var(--anatomy-lo)}`,
  `${F} .iso-line[data-tone="lo"]{stroke:var(--anatomy-faint)}`,
  `${F} .iso-solid[data-lit]>.iso-fill{fill:var(--anatomy-paper)}`,
  `${F} .iso-solid[data-lit]>.iso-top{fill:var(--anatomy-top)}`,
  `${F} .iso-solid[data-seamless][data-lit]>.iso-top{stroke:var(--anatomy-top)}`,
  ...SHADES.map((n) => `${F} .iso-solid[data-lit]>.iso-shade[data-shade="${n}"]{fill:var(--anatomy-shade-${n})}`),
  ...SHADES.map((n) => `${F} .iso-solid[data-seamless][data-lit]>.iso-shade[data-shade="${n}"]{stroke:var(--anatomy-shade-${n})}`),
  `${F} .iso-dots circle{opacity:.18}`,
  `${F} .pw-digit{fill:var(--anatomy-mid)}`,
  `${FP} .iso-line[data-tone="hi"],${FP} .iso-line[data-tone="lit"]{stroke:var(--anatomy-lit)}`,
  `${FP} .iso-line[data-tone="mid"]{stroke:var(--anatomy-hi)}`,
  `${FP} .iso-line[data-tone="lo"]{stroke:var(--anatomy-mid)}`,
  `${FP} .iso-line[data-tone="faint"]{stroke:var(--anatomy-lo)}`,
  `${FP} .iso-solid>.iso-fill{fill:var(--anatomy-face)}`,
  `${FP} .iso-solid>.iso-top{fill:var(--anatomy-lit-top)}`,
  `${FP} .iso-solid>.iso-shade[data-shade]{fill:var(--anatomy-lit-shade)}`,
  `${FP} .iso-solid[data-seamless]>.iso-top{stroke:var(--anatomy-lit-top)}`,
  `${FP} .iso-solid[data-seamless]>.iso-shade[data-shade]{stroke:var(--anatomy-lit-shade)}`,
  `${FP} .iso-dots circle{opacity:.85}`,
  `${FP} .pw-digit{fill:var(--anatomy-lit)}`,
].join("\n");

const css = `<style>
.iso{--pw-win:#0b0b0b}
.iso[data-theme="light"]{--pw-win:#ececea}
.iso-line.pw-win{fill:var(--pw-win)}
.pw-digit{fill:var(--anatomy-mid);font-family:var(--anatomy-mono);font-weight:600}
[data-on] .pw-digit,[data-part="carry-card"] .pw-digit{fill:var(--anatomy-lit)}
[data-window][data-on] .pw-digit{fill:var(--anatomy-strong)}
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:118%;margin:0 -9%}.iso-plate{padding-bottom:86px}.iso-plate-corner[data-corner="hint"]{bottom:34px}.iso-plate-corner[data-corner="readout"]{left:0;white-space:normal;text-align:right;line-height:1.4}}
.pw-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.pw-parts{display:flex;flex-wrap:wrap;gap:6px}
.pw-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.pw-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.pw-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.pw-parts button[data-picked] span{color:var(--anatomy-strong)}
.pw-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.pw-note{min-height:4.6em;color:var(--anatomy-text)}
.pw-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="pw-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="pw-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 4",
    title: "4단 선반장과 카드 인덱스",
    hint: "클릭이나 → 한 단계, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [{ mark: "lit", label: "지금 움직이는 부품: 감지 빗, 맞은 TLB 카드, 워커 헤드, 깃발, 크레인이 나르는 트레이나 카드" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="가상 주소 변환 기계. 클릭, 오른쪽 화살표, 스페이스로 한 단계씩 진행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="pw-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "4단 선반장과 카드 인덱스", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
