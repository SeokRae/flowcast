// node build.mjs [--light]: 판을 나눠 쓰는 두 인쇄대, fork와 COW (flowcast:mechanism 예제, 합성)
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
const NAME = "linux-fork-cow";
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
const SPLIT = M.trace(M.SPLIT);
const FINAL = TRACE.at(-1);
const INIT_STEPS = 4; // 처음 보여줄 상태: 복사, 재사용, 공유가 한 장에 모두 남는 순간 (trace[4])
const hex = (n) => "0x" + n.toString(16);
const hex2 = (n) => n.toString(16).padStart(2, "0");
const writesOf = (t, action) => t.filter((s) => s.last && s.last.kind === "write" && s.last.action === action);
const COPIES = writesOf(TRACE, "copy");
const REUSES = writesOf(TRACE, "reuse");
const SPLIT_COPIES = writesOf(SPLIT, "copy");
// 캡션의 숫자는 모델 상수와 같아야 한다
for (const want of ["7.0.14", `${M.NPAGES}장`, `${M.PAGE_KB} KiB`, `${SPLIT_COPIES.length}번`]) {
  if (!CAPTION.includes(want)) throw new Error(`caption should say ${want}`);
}

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 370;
const PLATE = { x: -162, y: -57, w: 334, d: 114, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;

const COLS = [-70, 0, 70]; // 원래 판(페이지 0, 1, 2)의 x
const LANE = 22; // 부모 새 판은 왼쪽 칸, 자식 새 판은 오른쪽 칸
const TIP = 4.5; // 부모 헤드는 판의 오른쪽 뒤, 자식 헤드는 왼쪽 앞을 짚는다
const PW = 18;
const PD = 24;
const PT = 9;
const BED = { x: -103, y: -16, w: 206, d: 32, r: 2 };
const PZ = 4; // 판 바닥 = 받침대 윗면
const PTOP = PZ + PT;

const RAIL_Y = 40;
const RAIL_H = 5;
const RAILS = { parent: [-120, 112], child: [-120, 164] };
const PARK = [120, 137, 154]; // fork 전 자식 헤드 대기 자리 (팁 x)
const BODY_Y = [34, 46];
const BODY_Z = [RAIL_H, 15];
const RISER_Y = [35, 41];
const ARM_Y = [13, 41];
const ARM_Z = [18, 21];
const HOUSE_Y = [4, 13];
const HOUSE_Z = [17, 27];
const PL_Y = 8;
const FOOT_Z = PTOP + 2.5;
const PRESS = FOOT_Z - PTOP; // 누름대 발이 판에 닿는 깊이
const BUMP = 1.1; // 깃발에 막혀 내려가는 깊이
const KNOB_Z = [31, 33.5];
const FLAG_Y = [10.6, 12];
const FLAG_Z = [HOUSE_Z[1], HOUSE_Z[1] + 8];
const FLAG_DROP = 8.6;

const MAG = { x: -134, y: -15, w: 24, d: 30, r: 2 };
const MAG_H = 16;
const MAG_X = MAG.x + MAG.w / 2;
const POSTS = [-146, 116];
const BEAM_X = [-152, 122];
const BEAM_Z = [64, 70];
const CAR_Z = [54, 62];
const FEEL_DX = -6;
const GRIP_DX = 6;
const CAR_PARK = MAG_X - GRIP_DX;
const FEEL_REST = 41; // 감지 막대 끝 구슬 중심 높이
const BALL_R = 1.7;
const FEEL_DOWN = PTOP + BALL_R;
const GRIP_REST = 47; // 흡착 패드 바닥 높이 (나르는 판 윗면)
const PAD_R = 4.5;
const PAD_H = 1.6;
const LEVER = [115, -RAIL_Y];
const LEVER_Z = 10;
const LEVER_PRESS = 4;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [BEAM_X[0], -4, BEAM_Z[1] + 4], [BEAM_X[1], 4, BEAM_Z[1] + 4], [PLATE.x + PLATE.w, PLATE.y + PLATE.d, 0]],
  WIDTH,
  HEIGHT,
  { pad: 20, azimuth: 56, elevation: 33 },
);
const CAM = k.cameraOf(P);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const box = (x0, y0, x1, y1, r = 0) => ({ x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), d: Math.abs(y1 - y0), r });
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;

function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
// 상자 하나의 화면 외곽 (클립용)
const boxHull = (x0, x1, y0, y1, z0, z1) => {
  const c = [];
  for (const x of [x0, x1]) for (const y of [y0, y1]) for (const z of [z0, z1]) c.push(at([x, y, z]));
  return k.pathOf(hull(c), true);
};

// ---- 판의 자리: 원래 판은 열 가운데, 복사본은 쓴 쪽 옆 칸 ----
const slotOf = (f) => COLS[f.page] + (f.owner === "parent" ? -LANE : f.owner === "child" ? LANE : 0);
const FRAMES = FINAL.frames.map((f) => ({ x: slotOf(f), page: f.page, owner: f.owner }));
const SLOTS = COLS.flatMap((x) => [x - LANE, x, x + LANE]);

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const pfns = (list) => list.map(hex).join(", ");
const PARTS = [
  { id: "fork", name: "fork 레버", concept: "fork()", text: `부모가 fork()를 부르는 순간입니다. 커널은 부모의 VMA를 하나씩 복제하면서 PTE를 자식에게 옮겨 적고(copy_page_range), 페이지 내용은 한 바이트도 복사하지 않아요. 이 실행에서 복제한 VMA는 ${M.FORK_VMAS}개였습니다.` },
  { id: "plates", name: "원래 판", concept: "물리 페이지(PFN)", text: `부모가 fork 전에 처음 쓸 때 받은 물리 페이지 ${M.NPAGES}장입니다(이 실행의 PFN ${pfns(M.MAIN.first)}). 앞면 표시창은 그 페이지의 첫 바이트이고, 위에 앉은 헤드 수가 /proc/kpagecount의 mapcount예요.` },
  { id: "parent", name: "부모 헤드", concept: "부모 PTE", text: "헤드 하나가 부모 페이지 테이블의 PTE 하나입니다. 헤드가 앉은 판이 그 PTE가 가리키는 PFN이에요. 쓰기 금지 폴트가 복사로 끝나면 헤드가 새 판으로 옮겨 앉습니다." },
  { id: "child", name: "자식 헤드", concept: "자식 PTE", text: "자식의 페이지 테이블입니다. fork 전에는 레일 끝에서 기다리다가(PTE 없음) fork 때 부모 헤드와 같은 판에 앉아요. 커널은 주소 순서대로 PTE를 채우고, 자식 PTE는 처음부터 쓰기 금지로 들어갑니다." },
  { id: "flag", name: "깃발", concept: "쓰기 금지 비트", text: "깃발이 서 있으면 그 PTE는 읽기 전용입니다(arm64에서 PTE_WRITE를 지우고 PTE_RDONLY를 세운 상태). fork는 자식 것뿐 아니라 부모 쪽 깃발도 모두 세워요. 그래서 판을 혼자 갖게 된 뒤에도 부모의 첫 쓰기는 폴트가 납니다." },
  { id: "plunger", name: "누름대", concept: "사용자 쓰기 한 번", text: "프로세스가 그 페이지에 한 바이트를 쓰는 명령입니다. 깃발이 서 있으면 판에 닿기 전에 막히고(쓰기 금지 폴트, minor fault 1번), 커널이 처리한 뒤 같은 명령을 다시 실행해 씁니다. 깃발이 내려가 있으면 폴트 없이 바로 써요." },
  { id: "handler", name: "갠트리 캐리지", concept: "do_wp_page", text: `쓰기 금지 폴트를 받는 커널 함수입니다. 감지 막대로 판을 재 보고, 혼자 쓰는 판이면 깃발만 내리고(재사용), 아니면 새 판을 가져와 복사합니다. 이 실행의 쓰기 금지 폴트 ${COPIES.length + REUSES.length}번 가운데 복사가 ${COPIES.length}번, 재사용이 ${REUSES.length}번이었어요.` },
  { id: "feeler", name: "감지 막대", concept: "wp_can_reuse_anon_folio", text: `재사용해도 되는지 판단합니다. 보는 값은 mapcount가 아니라 folio 참조 수이고, 정확히 1일 때만 재사용해요. 이 실행에서 판정 때 본 참조 수는 복사한 쓰기에서 (${COPIES.map((s) => s.last.refs).join(", ")}), 재사용한 쓰기에서 (${REUSES.map((s) => s.last.refs).join(", ")})입니다. 첫 쓰기만 다른 CPU에서 한 실행에서는 그 CPU의 LRU 추가 배치가 참조를 하나 더 잡고 있어서, 혼자 매핑한 페이지도 복사됐어요.` },
  { id: "magazine", name: "빈 판 매거진", concept: "페이지 할당기", text: `복사할 때 새 물리 페이지를 내주는 곳입니다. 쌓인 판 수에는 뜻이 없어요. 이 실행에서 내준 PFN은 차례로 다음과 같습니다: ${pfns(M.MAIN.alloc)}.` },
  { id: "gripper", name: "집게", concept: "wp_page_copy", text: `새 페이지에 원래 페이지 ${M.PAGE_KB} KiB를 그대로 복사하고(copy_user_highpage), 쓴 쪽 PTE를 새 페이지로 바꿔 쓰기 가능하게 만듭니다. 옛 페이지의 mapcount는 PTE를 바꾼 뒤에야 하나 줄어요.` },
  { id: "copy", name: "새 판", concept: "복사된 페이지", text: "복사로 생긴 페이지는 쓴 쪽만 가집니다. 그림은 부모 것을 원래 판 왼쪽 칸에, 자식 것을 오른쪽 칸에 놓지만 실제 PFN은 메모리 아무 데서나 나와요. 새 페이지는 처음부터 전용이라 다시 써도 폴트가 나지 않습니다." },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";

// ---- 표시창: 판 앞면(y = +PD/2)에 붙은 창, 첫 바이트 두 자리 ----
const WIN = { w: 11, h: 6.2 };
let clipCount = 0;
function plateWindow(part, text) {
  const id = `fc-clip-${clipCount++}`;
  const matrix = k.sideMatrix([-WIN.w / 2, PD / 2], PTOP - (PT - WIN.h) / 2, P, "left");
  const rect = `M0 0H${WIN.w}V${WIN.h}H0Z`;
  return [
    `<g transform="${matrix}"><clipPath id="${id}"><path d="${rect}"/></clipPath>`,
    `<path class="iso-line fc-win" data-tone="lo" d="${rect}"/>`,
    `<text class="fc-digit" data-digit="${part}" clip-path="url(#${id})" x="${WIN.w / 2}" y="${WIN.h * 0.8}" font-size="5.2" text-anchor="middle">${text}</text></g>`,
  ].join("");
}

// 판 한 장 (x = 0, 받침대 위에 놓인 자세로 만든다)
function plateSvg(index, text, window = true) {
  const plan = box(-PW / 2, -PD / 2, PW / 2, PD / 2, 1.2);
  const out = [S(k.slabOf(plan, PZ, PT, P, 3, 0.5), { tone: "hi", crease: "lo", inner: L(k.sideSeam(plan, PZ + 1.6, P, 3), { tone: "faint" }) })];
  out.push(L(k.planOutline(k.insetPlan(plan, 2.4), PTOP, P, 3), { tone: "faint" }));
  out.push(D(k.corners(plan, 1.6).map(([x, y]) => at([x, y, PTOP])), { size: 0.4 }));
  if (window) out.push(plateWindow(`plate-${index}`, text));
  return out.join("");
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
  const label = { x: 128, y: -53, w: 32, d: 8, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([22, 15, 19].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.6 + i * 1.9], [label.x + 4 + w, label.y + 2.6 + i * 1.9], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3, label.y + 2.4, 0.8]), at([label.x + label.w - 3, label.y + label.d - 2.4, 0.8])], { size: 0.45 }));
  // 눈금 띠: 판 줄 앞, 5 간격 눈금, 칸 가운데마다 큰 눈금, 원래 판 칸은 hi
  const strip = box(-101, 19, 101, 23, 0.8);
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const minor = [], major = [], zero = [];
  for (let x = -98; x <= 98; x += 2) {
    const list = COLS.includes(x) ? zero : SLOTS.includes(x) ? major : minor;
    list.push(k.lineOnTop([x, strip.y + 0.2], [x, strip.y + (list === minor ? 1.4 : 2.6)], 0.6, P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }), L(zero.join(""), { tone: "hi" }));
  out.push(D([at([strip.x + 1.4, strip.y + 2, 0.6]), at([strip.x + strip.w - 1.4, strip.y + 2, 0.6])], { size: 0.4 }));
  return out.join("");
}

// ---- 판 받침대: 칸 9개 ----
function bed() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BED, 0, 3, P)}" style="opacity:.6"/>`];
  out.push(S(k.slabOf(BED, 0, PZ, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(BED, 1.6, P, 3), { tone: "faint" }) }));
  for (const x of SLOTS) out.push(L(k.planOutline(box(x - PW / 2 - 1.2, -PD / 2 - 1.2, x + PW / 2 + 1.2, PD / 2 + 1.2, 1.4), PZ, P, 3), { tone: COLS.includes(x) ? "lo" : "faint" }));
  out.push(D(k.corners(BED, 3).map(([x, y]) => at([x, y, PZ])), { size: 0.45 }));
  return out.join("");
}

// ---- 매거진: 빈 판이 위에 하나 보인다 ----
function magazine() {
  const out = [`<path class="iso-halo" d="${k.haloOf(MAG, 0, 6, P)}"/>`];
  out.push(S(k.slabOf(MAG, 0, MAG_H, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(MAG, 5, P, 3), { tone: "faint" }) }));
  const mouth = k.insetPlan(MAG, 2.4);
  out.push(L(k.planOutline(mouth, MAG_H, P, 3), { tone: "lo" }));
  const blank = box(MAG_X - PW / 2, -PD / 2, MAG_X + PW / 2, PD / 2, 1.2);
  out.push(S(k.slabOf(blank, MAG_H - 0.6, 0.6, P, 3), { tone: "hi", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(blank, 2.4), MAG_H, P, 3), { tone: "faint" }));
  out.push(D([at([MAG.x + 1.4, MAG.y + MAG.d - 1.2, MAG_H]), at([MAG.x + MAG.w - 1.4, MAG.y + MAG.d - 1.2, MAG_H])], { size: 0.45 }));
  // 손나사: 매거진 오른쪽 앞, 받침 위
  const nx = MAG.x + MAG.w + 4;
  out.push(S(k.slabOf(box(nx - 4, 8, nx + 1, 12, 0.5), 0, 3, P, 2), { tone: "mid" }));
  out.push(S(k.cylinder(nx - 0.5, 10, 2.2, 3, 3.6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(nx - 0.5, 10, 2.2, 3, 6.6, 16, P), { tone: "lo" }));
  return out.join("");
}

// ---- 레일 ----
function rail(who) {
  const y = who === "parent" ? -RAIL_Y : RAIL_Y;
  const [x0, x1] = RAILS[who];
  const plan = box(x0, y - 3, x1, y + 3, 1);
  const out = [S(k.slabOf(plan, 0, RAIL_H, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(plan, 2, P, 3), { tone: "faint" }) })];
  const dots = [];
  for (let x = x0 + 10; x < x1 - 4; x += 30) dots.push(at([x, y, RAIL_H]));
  out.push(D(dots, { size: 0.4, tone: "lo" }));
  return out.join("");
}
function railEnd(who, side) {
  const y = who === "parent" ? -RAIL_Y : RAIL_Y;
  const x = side === "left" ? RAILS[who][0] - 6 : RAILS[who][1];
  const plan = box(x, y - 6, x + 6, y + 6, 1);
  const out = [S(k.slabOf(plan, 0, 10, P, 3, 0.5), { tone: "mid" })];
  out.push(D([at([x + 3, y - 3.6, 10]), at([x + 3, y + 3.6, 10])], { size: 0.45 }));
  return out.join("");
}
// 손나사: 레일 왼쪽 끝 블록 앞
function railScrew(who) {
  const y = who === "parent" ? -RAIL_Y : RAIL_Y;
  const x = RAILS[who][0] - 3;
  return [
    S(k.slabOf(box(x - 1.2, y + 6, x + 1.2, y + 8.4, 0.5), 4, 3, P, 2), { tone: "mid", crease: "none" }),
    S(k.cylinder(x, y + 9.6, 2.4, 3, 5.5, P, 20), { tone: "mid" }),
    L(k.knurl(x, y + 9.6, 2.4, 3, 8.5, 18, P), { tone: "lo" }),
  ].join("");
}

// ---- fork 레버: 부모 레일 오른쪽 끝 블록 위 ----
function leverCollar() {
  return L(k.ring(LEVER[0], LEVER[1], 2.2, LEVER_Z, P, 16), { tone: "lo" });
}
function leverSvg() {
  const [x, y] = LEVER;
  return [
    S(k.cylinder(x, y, 1.2, LEVER_Z - LEVER_PRESS, LEVER_PRESS + 8, P, 16), { tone: "mid", crease: "none" }),
    S(k.cylinder(x, y, 3, LEVER_Z + 8, 3, P, 28, 0.4), { tone: "mid" }),
  ].join("");
}

// ---- 헤드 (팁 x = 0에서 만들고 x로 옮긴다) ----
function head(who, index) {
  const s = who === "parent" ? -1 : 1;
  const yr = (a, b) => [s * a, s * b];
  const bx = (x0, x1, a, b, r) => box(x0, s * a, x1, s * b, r);
  const body = bx(-6.5, 6.5, ...BODY_Y, 1.5);
  const riser = bx(-3, 3, ...RISER_Y, 0.6);
  const arm = bx(-2.5, 2.5, ...ARM_Y, 0.8);
  const house = bx(-4.5, 4.5, ...HOUSE_Y, 1);
  const py = s * PL_Y;
  const flagPlan = bx(-3.5, 3.5, ...FLAG_Y, 0.3);
  const part = `${who}-${index}`;

  const bodySvg = [
    S(k.slabOf(body, BODY_Z[0], BODY_Z[1] - BODY_Z[0], P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(body, 9, P, 3), { tone: "faint" }) }),
    D([at([-4, s * 43.5, BODY_Z[1]]), at([4, s * 43.5, BODY_Z[1]])], { size: 0.42 }),
    S(k.slabOf(riser, BODY_Z[1], ARM_Z[0] - BODY_Z[1], P, 2, 0.3), { tone: "mid", crease: "none" }),
  ].join("");
  const armSvg = S(k.slabOf(arm, ARM_Z[0], ARM_Z[1] - ARM_Z[0], P, 2, 0.3), { tone: "mid" });
  const houseSvg = [
    S(k.slabOf(house, HOUSE_Z[0], HOUSE_Z[1] - HOUSE_Z[0], P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(house, HOUSE_Z[0] + 3, P, 3), { tone: "faint" }) }),
    L(k.planOutline(bx(-3.8, 3.8, FLAG_Y[0] - 0.3, FLAG_Y[1] + 0.3, 0.4), HOUSE_Z[1], P, 2), { tone: "lo" }),
    L(k.ring(0, py, 1.9, HOUSE_Z[1], P, 16), { tone: "lo" }),
  ].join("");
  // 누름대: 하우징 밑 (발과 봉) / 하우징 위 (봉과 손잡이). 위쪽은 하우징 윗면 위만 보이게 자른다
  const lower = [
    S(k.cylinder(0, py, 1.3, FOOT_Z + 1.5, HOUSE_Z[1] - FOOT_Z - 1.5, P, 16), { tone: "mid", crease: "none" }),
    S(k.cylinder(0, py, 2.6, FOOT_Z, 1.5, P, 24), { tone: "mid" }),
  ].join("");
  const upper = [
    S(k.cylinder(0, py, 1.3, HOUSE_Z[1] - BUMP - PRESS, KNOB_Z[0] - HOUSE_Z[1] + BUMP + PRESS, P, 16), { tone: "mid", crease: "none" }),
    S(k.cylinder(0, py, 2.3, KNOB_Z[0], KNOB_Z[1] - KNOB_Z[0], P, 24, 0.3), { tone: "mid" }),
  ].join("");
  const upClip = `fc-clip-up-${part}`;
  const flagClip = `fc-clip-flag-${part}`;
  const upperSvg = `<clipPath id="${upClip}"><path d="${boxHull(-2.9, 2.9, py - 2.9, py + 2.9, HOUSE_Z[1], KNOB_Z[1] + 0.6)}"/></clipPath><g clip-path="url(#${upClip})"><g data-part="plunger-hi-${part}" data-sel="plunger" data-lit-node="plunger-${part}">${upper}</g></g>`;
  const flagSvg = `<clipPath id="${flagClip}"><path d="${boxHull(-3.9, 3.9, ...yr(FLAG_Y[0] - 0.3, FLAG_Y[1] + 0.3).sort((a, b) => a - b), FLAG_Z[0], FLAG_Z[1] + 0.6)}"/></clipPath><g clip-path="url(#${flagClip})"><g data-part="flag-${part}" data-sel="flag">${S(k.slabOf(flagPlan, FLAG_Z[0], FLAG_Z[1] - FLAG_Z[0], P, 2, 0.3), { tone: "hi", crease: "lo" })}</g></g>`;
  const lowerSvg = `<g data-part="plunger-lo-${part}" data-sel="plunger">${lower}</g>`;
  const own = (svg) => sel(who, svg);
  // 페인터 순서: 부모(뒤)는 대차 → 팔 → 누름대 아래 → 하우징 → 깃발 → 누름대 위
  //              자식(앞)은 누름대 아래 → 하우징 → 누름대 위 → 깃발 → 팔 → 대차
  const inner = who === "parent"
    ? [own(bodySvg + armSvg), lowerSvg, own(houseSvg), flagSvg, upperSvg]
    : [lowerSvg, own(houseSvg), upperSvg, flagSvg, own(armSvg + bodySvg)];
  return `<g data-head="${part}" transform="">${inner.join("")}</g>`;
}

// ---- 갠트리 ----
function post(x) {
  const pad = box(x - 8, -8, x + 8, 8, 1.5);
  const col = box(x - 4, -4, x + 4, 4, 0.8);
  return [
    `<path class="iso-halo" d="${k.haloOf(pad, 0, 4, P)}" style="opacity:.6"/>`,
    S(k.slabOf(pad, 0, 3, P, 3, 0.5), { tone: "mid" }),
    D(k.corners(pad, 2.6).map(([px, py]) => at([px, py, 3])), { size: 0.45 }),
    S(k.slabOf(col, 3, BEAM_Z[0] - 3, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(col, 30, P, 3), { tone: "faint" }) }),
  ].join("");
}
function beam() {
  const plan = box(BEAM_X[0], -4, BEAM_X[1], 4, 0.8);
  const out = [S(k.slabOf(plan, BEAM_Z[0], BEAM_Z[1] - BEAM_Z[0], P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, BEAM_Z[0] + 2, P, 3), { tone: "faint" }) })];
  for (const x of [BEAM_X[0] - 2, BEAM_X[1]]) out.push(S(k.slabOf(box(x, -4.6, x + 2, 4.6, 0.5), BEAM_Z[0] - 0.6, BEAM_Z[1] - BEAM_Z[0] + 1.2, P, 2), { tone: "mid" }));
  out.push(D([-130, -80, -30, 20, 70].map((x) => at([x, 0, BEAM_Z[1]])), { size: 0.4, tone: "lo" }));
  // 노브: 빔 오른쪽 끝 위
  const kx = BEAM_X[1] - 6;
  out.push(S(k.cylinder(kx, 0, 2.2, BEAM_Z[1], 1.6, P, 20), { tone: "mid" }));
  out.push(S(k.cylinder(kx, 0, 3.6, BEAM_Z[1] + 1.6, 3.4, P, 28), { tone: "mid" }));
  out.push(L(k.knurl(kx, 0, 3.6, BEAM_Z[1] + 1.6, BEAM_Z[1] + 5, 24, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([kx, 0], [kx + 3.6, 0], BEAM_Z[1] + 5, P), { tone: "hi" }));
  out.push(D([at([kx, 0, BEAM_Z[1] + 5])], { size: 0.5, tone: "hi" }));
  return out.join("");
}
// 캐리지: 빔 밑에 매달린 몸체와 빔 양옆 볼. 뒤 볼은 빔 앞에, 몸체와 앞 볼은 빔 뒤에 그린다
const CHEEK = (s) => box(-9, s * 4.2, 9, s * 6.6, 0.5);
function carriageBack() {
  return S(k.slabOf(CHEEK(-1), CAR_Z[1] - 1, BEAM_Z[1] - CAR_Z[1] + 1, P, 2, 0.3), { tone: "mid" });
}
function carriageFront() {
  const body = box(-11, -7, 11, 7, 1.5);
  return [
    S(k.slabOf(body, CAR_Z[0], CAR_Z[1] - CAR_Z[0], P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(body, CAR_Z[0] + 3, P, 3), { tone: "faint" }) }),
    S(k.slabOf(CHEEK(1), CAR_Z[1] - 1, BEAM_Z[1] - CAR_Z[1] + 1, P, 2, 0.3), { tone: "mid" }),
    D([at([-5.5, 6.6, BEAM_Z[0] + 2.6]), at([5.5, 6.6, BEAM_Z[0] + 2.6])], { size: 0.5, tone: "mid" }),
    L(k.ring(FEEL_DX, 0, 2, CAR_Z[0], P, 16), { tone: "lo" }),
    L(k.ring(GRIP_DX, 0, 2.4, CAR_Z[0], P, 16), { tone: "lo" }),
  ].join("");
}

// ---- 자세: rest()와 between()은 이 문자열 하나로 Node(정적 SVG의 첫 자세)와 페이지에서 함께 쓴다 ----
const POSE_SRC = `
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const seg = (u, a, b) => ease((u - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const hex2 = (n) => n.toString(16).padStart(2, "0");
const tipOf = (who, x) => x + (who === "parent" ? C.TIP : -C.TIP);
const writtenFrame = (s) => s.pte[s.last.who][s.last.page].frame;
function litOf(s) {
  if (!s.last || s.last.kind === "fork") return "lever";
  return "plate-" + writtenFrame(s);
}
// 정지 자세: 상태 하나로 정해진다
function rest(s) {
  const plates = C.FRAMES.map((f, i) => {
    const fr = s.frames[i];
    return fr ? { x: f.x, z: 0, show: true, text: hex2(fr.byte), mid: false, o: 1 } : { x: C.MAG_X, z: C.MAG_H - C.PTOP, show: false, text: "", mid: false, o: 1 };
  });
  const heads = {};
  for (const who of ["parent", "child"]) {
    heads[who] = C.COLS.map((_, k) => {
      const e = s.pte[who] && s.pte[who][k];
      if (!e) return { x: C.PARK[k], flag: 0, press: 0 };
      return { x: tipOf(who, C.FRAMES[e.frame].x), flag: e.write ? 0 : 1, press: 0 };
    });
  }
  return { lever: 0, heads, plates, car: C.CAR_PARK, feel: C.FEEL_REST, grip: C.GRIP_REST, lit: litOf(s) };
}
// 전이 자세: 직전 상태 a에서 다음 상태 b로, u = 0..1
function between(a, b, u, kind) {
  if (u >= 1) return rest(b);
  const pose = rest(a);
  if (kind === "rewind") {
    const end = rest(b);
    pose.plates.forEach((p, i) => {
      if (i >= C.COLS.length) { p.o = 1 - seg(u, 0, 0.35); p.show = p.show && u < 0.35; }
      else if (u >= 0.35) p.text = end.plates[i].text;
    });
    for (const who of ["parent", "child"]) {
      pose.heads[who].forEach((h, k) => {
        const from = h.x;
        const t0 = who === "parent" ? 0.1 : 0.2 + 0.1 * (C.COLS.length - 1 - k);
        h.x = lerp(from, end.heads[who][k].x, seg(u, t0, t0 + 0.5));
        h.flag = h.flag * (1 - seg(u, 0, 0.25));
      });
    }
    if (u >= 0.5) pose.lit = "lever";
    return pose;
  }
  const mv = b.last;
  if (mv.kind === "fork") {
    pose.lever = seg(u, 0, 0.1) - seg(u, 0.86, 1);
    C.COLS.forEach((x, k) => {
      const t0 = 0.08 + 0.14 * k;
      pose.heads.child[k].x = lerp(C.PARK[k], tipOf("child", x), seg(u, t0, t0 + 0.42));
      const up = seg(u, t0 + 0.42, t0 + 0.48);
      pose.heads.child[k].flag = up;
      pose.heads.parent[k].flag = up;
    });
    pose.lit = "lever";
    return pose;
  }
  const who = mv.who;
  const k = mv.page;
  const head = pose.heads[who][k];
  const target = writtenFrame(b);
  const origin = a.pte[who][k].frame;
  const O = C.FRAMES[origin].x;
  if (mv.action === "none") {
    head.press = C.PRESS * (seg(u, 0, 0.4) - seg(u, 0.4, 0.8));
    if (u >= 0.38) pose.plates[target].text = hex2(mv.value);
    pose.lit = "plate-" + target;
    return pose;
  }
  pose.lit = "plunger-" + who + "-" + k;
  if (mv.action === "reuse") {
    head.press = C.BUMP * (seg(u, 0, 0.07) - seg(u, 0.07, 0.14));
    const feelAt = O - C.FEEL_DX;
    pose.car = u < 0.58 ? lerp(C.CAR_PARK, feelAt, seg(u, 0.08, 0.32)) : lerp(feelAt, C.CAR_PARK, seg(u, 0.58, 0.9));
    pose.feel = lerp(C.FEEL_REST, C.FEEL_DOWN, seg(u, 0.32, 0.44) - seg(u, 0.44, 0.54));
    head.flag = 1 - seg(u, 0.54, 0.62);
    head.press += C.PRESS * (seg(u, 0.66, 0.76) - seg(u, 0.76, 0.86));
    if (u >= 0.74) pose.plates[target].text = hex2(mv.value);
    if (u >= 0.54) pose.lit = "plate-" + target;
    return pose;
  }
  // copy: 막힘 → 감지 → 매거진에서 빈 판 → 쓴 쪽 칸에 놓기 → 헤드 옮김, 깃발 내림 → 쓰기
  const S = C.FRAMES[target].x;
  const feelAt = O - C.FEEL_DX;
  const magAt = C.CAR_PARK;
  const slotAt = S - C.GRIP_DX;
  head.press = C.BUMP * (seg(u, 0, 0.05) - seg(u, 0.05, 0.1));
  if (u < 0.33) pose.car = lerp(C.CAR_PARK, feelAt, seg(u, 0.06, 0.2));
  else if (u < 0.6) pose.car = lerp(feelAt, magAt, seg(u, 0.33, 0.47));
  else if (u < 0.86) pose.car = lerp(magAt, slotAt, seg(u, 0.6, 0.74));
  else pose.car = lerp(slotAt, C.CAR_PARK, seg(u, 0.86, 1));
  pose.feel = lerp(C.FEEL_REST, C.FEEL_DOWN, seg(u, 0.2, 0.27) - seg(u, 0.27, 0.33));
  const down = (lo, t0, t1, t2) => lerp(C.GRIP_REST, lo, seg(u, t0, t1) - seg(u, t1, t2));
  pose.grip = u < 0.6 ? down(C.MAG_H, 0.47, 0.53, 0.6) : down(C.PTOP, 0.74, 0.81, 0.86);
  const plate = pose.plates[target];
  if (u >= 0.53 && u < 0.81) {
    plate.show = true;
    plate.mid = true;
    plate.x = pose.car + C.GRIP_DX;
    plate.z = pose.grip - C.PTOP;
    plate.text = "";
  } else if (u >= 0.81) {
    plate.show = true;
    plate.x = S;
    plate.z = 0;
    plate.text = hex2(u >= 0.96 ? mv.value : mv.copied);
  }
  head.x = lerp(tipOf(who, O), tipOf(who, S), seg(u, 0.84, 0.92));
  head.flag = 1 - seg(u, 0.9, 0.94);
  head.press += C.PRESS * (seg(u, 0.93, 0.97) - seg(u, 0.97, 1));
  if (u >= 0.53) pose.lit = "plate-" + target;
  return pose;
}
// 감지 막대와 집게: 길이가 바뀌므로 프레임마다 다시 만든다 (kit의 cylinder, solidSvg)
function feelerSvg(p) {
  const x = p.car + C.FEEL_DX;
  return solidSvg(cylinder(x, 0, 1.1, p.feel, C.CAR_Z[0] - p.feel, P, 14), { tone: "mid", crease: "none" }) +
    solidSvg(cylinder(x, 0, C.BALL_R, p.feel - C.BALL_R, C.BALL_R * 2, P, 18), { tone: "mid" });
}
function gripperSvg(p) {
  const x = p.car + C.GRIP_DX;
  return solidSvg(cylinder(x, 0, 1.4, p.grip + C.PAD_H, C.CAR_Z[0] - p.grip - C.PAD_H, P, 16), { tone: "mid", crease: "none" }) +
    solidSvg(cylinder(x, 0, C.PAD_R, p.grip, C.PAD_H, P, 28, 0.3), { tone: "lo" });
}
`;

const CFG = {
  P,
  COLS, TIP, LANE, PARK, FRAMES,
  PTOP, MAG_X, MAG_H, CAR_PARK, FEEL_DX, GRIP_DX, FEEL_REST, FEEL_DOWN, BALL_R, GRIP_REST, PAD_R, PAD_H, CAR_Z,
  PRESS, BUMP, FLAG_DROP, LEVER, LEVER_PRESS,
  INIT_STEPS,
  SECONDS: { fork: 2.4, copy: 4.6, reuse: 2.8, none: 1.0, rewind: 1.6 },
  TOUR_GAP: 1.0, TOUR_REST: 2.0, RESUME: 6,
};
const POSE = new Function("C", "P", "solidSvg", "cylinder", `${POSE_SRC}\nreturn { rest, between, feelerSvg, gripperSvg };`)(CFG, P, k.solidSvg, k.cylinder);

// 정적 SVG의 첫 자세 (스크립트가 돌기 전에도 맞게 보이도록)
const POSE0 = POSE.rest(TRACE[INIT_STEPS]);
// 전이마다 자식 헤드끼리, 부모 헤드끼리 대차가 겹치지 않는다 (대차 폭 16)
const MOVES = [...TRACE.slice(1).map((s, i) => [TRACE[i], s, "step"]), [FINAL, TRACE[0], "rewind"]];
for (const [from, to, kind] of MOVES) {
  for (let u = 0; u <= 1.0001; u += 0.01) {
    const pose = POSE.between(from, to, u, kind);
    for (const who of ["parent", "child"]) {
      const xs = pose.heads[who].map((h) => h.x);
      for (let i = 1; i < xs.length; i++) if (xs[i] - xs[i - 1] < 14) throw new Error(`${who} heads collide at u=${u.toFixed(2)}`);
    }
  }
}

const tr = (by) => k.translateAlong(P, by);
const headX = (who, k) => POSE0.heads[who][k];
function headAt(who, i) {
  const h = headX(who, i);
  return head(who, i)
    .replace(`data-head="${who}-${i}" transform=""`, `data-head="${who}-${i}" transform="${tr([h.x, 0, 0])}"`)
    .replace(`data-part="flag-${who}-${i}" data-sel="flag">`, `data-part="flag-${who}-${i}" data-sel="flag" transform="${tr([0, 0, -FLAG_DROP * (1 - h.flag)])}"${h.flag ? "" : ' style="display:none"'}>`);
}
const PLATE_NODES = FRAMES.map((f, i) => {
  const p = POSE0.plates[i];
  const id = f.owner ? "copy" : "plates";
  return `<g data-plate="${i}" data-sel="${id}" data-lit-node="plate-${i}" transform="${tr([p.x, 0, p.z])}"${p.show ? "" : ' style="display:none"'}>${plateSvg(i, p.text)}</g>`;
});

// ---- 그림 조립 ----
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `fork와 copy-on-write를 보여 주는 기계. 판 받침대 위 가운데 칸에 원래 판 ${M.NPAGES}장이 있고, 뒤의 부모 헤드 ${M.NPAGES}개와 앞의 자식 헤드 ${M.NPAGES}개가 판을 짚는다. 헤드마다 쓰기 금지 깃발과 누름대가 있고, 위의 갠트리 캐리지가 감지 막대로 판을 재서 왼쪽 매거진의 빈 판을 쓴 쪽 옆 칸에 놓거나 깃발만 내린다.`,
  body: [
    base(),
    sel("handler", post(POSTS[0])),
    sel("magazine", magazine()),
    sel("parent", rail("parent"), railEnd("parent", "left"), railScrew("parent")),
    sel("fork", railEnd("parent", "right"), leverCollar()),
    `<g data-part="lever" data-sel="fork" data-lit-node="lever" transform="">${leverSvg()}</g>`,
    sel("plates", bed()),
    `<g data-layer="low">${PLATE_NODES.join("")}</g>`,
    ...[0, 1, 2].map((i) => headAt("parent", i)),
    groupAt([CAR_PARK, 0, 0], sel("handler", carriageBack()), ' data-part="car-back"'),
    `<g data-part="feeler" data-sel="feeler">${POSE.feelerSvg(POSE0)}</g>`,
    `<g data-layer="mid"></g>`,
    `<g data-part="gripper" data-sel="gripper">${POSE.gripperSvg(POSE0)}</g>`,
    sel("handler", post(POSTS[1])),
    sel("child", rail("child"), railEnd("child", "left"), railEnd("child", "right"), railScrew("child")),
    ...[0, 1, 2].map((i) => headAt("child", i)),
    sel("handler", beam()),
    groupAt([CAR_PARK, 0, 0], sel("handler", carriageFront()), ' data-part="car-front"'),
  ],
});

const live = `
const C = ${JSON.stringify(CFG)};
const P = C.P;
${POSE_SRC}
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const q = (s) => svg.querySelector(s);
const readoutEl = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const WHO = ["parent", "child"];
const el = {
  lever: q('[data-part="lever"]'),
  heads: Object.fromEntries(WHO.map((who) => [who, C.COLS.map((_, k) => ({
    g: q('[data-head="' + who + "-" + k + '"]'),
    flag: q('[data-part="flag-' + who + "-" + k + '"]'),
    lo: q('[data-part="plunger-lo-' + who + "-" + k + '"]'),
    hi: q('[data-part="plunger-hi-' + who + "-" + k + '"]'),
  }))])),
  plates: C.FRAMES.map((_, i) => q('[data-plate="' + i + '"]')),
  digits: C.FRAMES.map((_, i) => q('[data-digit="plate-' + i + '"]')),
  carBack: q('[data-part="car-back"]'), carFront: q('[data-part="car-front"]'),
  feeler: q('[data-part="feeler"]'), gripper: q('[data-part="gripper"]'),
  low: q('[data-layer="low"]'), mid: q('[data-layer="mid"]'),
  lits: [...svg.querySelectorAll("[data-lit-node]")],
};
const PARTS = ${JSON.stringify(PARTS)};
const NOTE_IDLE = ${JSON.stringify(NOTE_IDLE)};
const note = document.querySelector("[data-note]");
const picks = [...document.querySelectorAll("[data-pick]")];
const groups = [...svg.querySelectorAll("[data-sel]")];
// 호버가 우선이고, 호버가 없으면 번호로 고른 것(pin)을 보여준다
let hoverSel = null, pinSel = null, shownSel = null;
const picked = () => hoverSel ?? pinSel;

function initial() { let s = MODEL.makeState(); for (let i = 0; i < C.INIT_STEPS; i++) s = MODEL.step(s); return s; }
let state = initial();
let anim = null; // { from, to, kind, t }
const kindOf = (from, to) => (to.last && to.last.kind === "write" ? to.last.action : "fork");

const put = (node, by) => node.setAttribute("transform", translateAlong(P, by));
let litShown = null;
function draw(p) {
  put(el.lever, [0, 0, -C.LEVER_PRESS * p.lever]);
  for (const who of WHO) {
    p.heads[who].forEach((h, k) => {
      const n = el.heads[who][k];
      put(n.g, [h.x, 0, 0]);
      put(n.flag, [0, 0, -C.FLAG_DROP * (1 - h.flag)]);
      n.flag.style.display = h.flag > 0.001 ? "" : "none";
      put(n.lo, [0, 0, -h.press]);
      put(n.hi, [0, 0, -h.press]);
    });
  }
  p.plates.forEach((pl, i) => {
    const node = el.plates[i];
    node.style.display = pl.show ? "" : "none";
    if (!pl.show) return;
    put(node, [pl.x, 0, pl.z]);
    node.style.opacity = pl.o < 1 ? pl.o.toFixed(3) : "";
    const layer = pl.mid ? el.mid : el.low;
    if (node.parentNode !== layer) layer.appendChild(node);
    const d = el.digits[i];
    if (d.textContent !== pl.text) d.textContent = pl.text;
  });
  put(el.carBack, [p.car, 0, 0]);
  put(el.carFront, [p.car, 0, 0]);
  const fx = p.car + C.FEEL_DX;
  el.feeler.innerHTML = feelerSvg(p);
  el.gripper.innerHTML = gripperSvg(p);
  if (p.lit !== litShown) {
    litShown = p.lit;
    el.lits.forEach((n) => {
      const on = n.dataset.litNode === p.lit;
      n.toggleAttribute("data-on", on);
      n.querySelectorAll(".iso-solid").forEach((solid, i) => solid.toggleAttribute("data-lit", on && (i === 0 || n.dataset.litNode === "lever" || n.dataset.litNode.startsWith("plunger"))));
    });
  }
}

function say() {
  const text = MODEL.readout(state);
  if (readoutEl.textContent !== text) readoutEl.textContent = text;
  return text;
}

// 루프
let frame = 0, last = 0, visible = false, touring = !still.matches, wait = C.TOUR_REST, idleTimer = 0;
function begin(from, to, kind) {
  anim = { from, to, kind, t: 0 };
  if (still.matches) { anim = null; draw(rest(to)); }
  run();
}
function advance() {
  if (state.done) return false;
  const from = state;
  state = MODEL.step(state);
  say();
  begin(from, state, kindOf(from, state));
  return true;
}
function rewind() {
  const from = state;
  state = MODEL.makeState();
  say();
  if (from === state) return;
  begin(from, state, "rewind");
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (anim) {
    anim.t += dt / C.SECONDS[anim.kind];
    draw(between(anim.from, anim.to, Math.min(1, anim.t), anim.kind));
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
  if (pinSel && !event.target.closest(".fc-parts, .iso-stage")) { pinSel = null; choose(); }
});
// 손으로 STEP이나 reset을 하면 진행 중인 전이는 끝 자세로 맞추고 다음 전이를 시작한다
function settleNow() { if (anim) { draw(rest(anim.to)); anim = null; } }
function userStep() { takeOver(); settleNow(); advance(); status.textContent = say(); }
function userReset() { takeOver(); settleNow(); state = MODEL.makeState(); say(); draw(rest(state)); status.textContent = say(); }

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
draw(rest(state));
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
  `${F} .fc-digit{fill:var(--anatomy-mid)}`,
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
  `${FP} .fc-digit{fill:var(--anatomy-lit)}`,
].join("\n");

const css = `<style>
.iso{--fc-win:#0b0b0b}
.iso[data-theme="light"]{--fc-win:#ececea}
.iso-line.fc-win{fill:var(--fc-win)}
.fc-digit{fill:var(--anatomy-hi);font-family:var(--anatomy-mono);font-weight:600}
[data-on] .fc-digit{fill:var(--anatomy-lit)}
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:116%;margin:0 -8%}}
.fc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.fc-parts{display:flex;flex-wrap:wrap;gap:6px}
.fc-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.fc-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.fc-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.fc-parts button[data-picked] span{color:var(--anatomy-strong)}
.fc-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.fc-note{min-height:4.6em;color:var(--anatomy-text)}
.fc-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="fc-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="fc-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 6",
    title: "판을 나눠 쓰는 두 인쇄대",
    hint: "클릭이나 → 한 단계, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [
      { mark: "lit", label: "지금 지켜볼 부품: fork 레버, 막힌 누름대, 방금 쓴 판" },
      { mark: "raised", label: "선 깃발: 쓰기 금지 PTE" },
    ],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="fork와 copy-on-write 기계. 클릭, 오른쪽 화살표, 스페이스로 fork나 쓰기 한 번을 진행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="fc-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "판을 나눠 쓰는 두 인쇄대", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
