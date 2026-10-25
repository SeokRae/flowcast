// node build.mjs [--light]: JIT 계층 변속기 (flowcast:mechanism 예제, 합성)
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
const NAME = "jvm-jit-tiers";
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
const F = M.FLAGS;
const TRACE = M.trace();
const INIT_STEPS = 8; // 처음 보여줄 상태: tier 4를 요청했지만 레버는 아직 3 (trace[8])
if (TRACE[INIT_STEPS].queued !== 4 || TRACE[INIT_STEPS].tier !== 3) throw new Error("initial pose should show a queued tier 4 request at tier 3");
// 캡션의 숫자는 모델 상수와 같아야 한다
for (const n of [F.Tier3InvocationThreshold, F.Tier4InvocationThreshold, M.NOTIFY[0], M.NOTIFY[3]]) {
  if (!CAPTION.includes(String(n))) throw new Error(`caption lacks ${n}`);
}
if (!CAPTION.includes("21.0.1+12") || !CAPTION.includes(`${["", "한", "두", "세", "네"][F.PerBytecodeTrapLimit]} 번`)) throw new Error("caption lacks version or trap limit");
const TIERS = [0, 1, 2, 3, 4].filter((t) => t <= F.TieredStopAtLevel);
const USED = [...new Set(TRACE.map((s) => s.tier))];

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const PARTS = [
  { id: "gauge", name: "카운터 게이지", concept: "호출 카운터와 임계값", text: `정책은 호출마다 깨어나지 않고, 카운터가 인터프리터에서는 ${M.NOTIFY[0]}번, tier 3 코드에서는 ${M.NOTIFY[3]}번 찰 때만 값을 읽습니다. 바늘은 그때 읽은 값을 그 tier의 임계값(${F.Tier3InvocationThreshold}, ${F.Tier4InvocationThreshold})으로 나눈 비율이고, 굵은 눈금이 1이에요. 위 창이 읽은 값, 아래 창이 다음 검사의 임계값입니다.` },
  { id: "ticket", name: "컴파일 티켓", concept: "컴파일 요청", text: "임계값을 넘은 검사에서만 나오는 요청이고, 창의 숫자가 요청한 tier예요. 컴파일은 백그라운드 스레드가 하므로 요청한 순간에는 tier가 그대로이고, 그사이 호출은 지금 코드로 계속 돕니다." },
  { id: "c1", name: "C1 스테이션", concept: `C1 컴파일러 스레드 ${M.C1_THREADS}개`, text: `tier 3 코드를 만듭니다. CICompilerCount ${F.CICompilerCount}의 3분의 1인 ${M.C1_THREADS}개가 C1 몫이에요. tier 3 코드는 실행하면서 호출 수와 수신자 타입을 MDO에 기록합니다.` },
  { id: "c2", name: "C2 스테이션", concept: `C2 컴파일러 스레드 ${M.C2_THREADS}개`, text: `tier 4 코드를 만들고, 나머지 ${M.C2_THREADS}개 스레드가 C2 몫이에요. MDO에 모인 프로파일을 근거로 가정을 세우고 그 가정 위에서 최적화합니다.` },
  { id: "lever", name: "변속 레버", concept: "지금 tier", text: `레버가 놓인 칸의 코드가 다음 호출을 받습니다. 칸은 0부터 ${F.TieredStopAtLevel}까지 ${TIERS.length}개지만 이 메서드는 ${USED.join(", ")}만 지나요(1은 단순한 메서드, 2는 C2 큐가 밀릴 때 씁니다). 새 코드가 설치될 때와 코드가 버려질 때만 움직여요.` },
  { id: "template", name: "수신자 템플릿", concept: "bci 1의 수신자 타입 프로파일", text: `s.area() 호출 지점(bci 1)에서 본 수신자 타입을 기록하는 자리입니다. 구멍 ${F.TypeProfileWidth}개는 TypeProfileWidth이고, 네모가 ${M.RECEIVERS[0]}, 둥근 것이 ${M.RECEIVERS[1]} 자리예요. 트랙은 ${M.RECEIVERS[1]} 호출이 둥근 구멍으로 가는 길입니다.` },
  { id: "gate", name: "게이트", concept: "C2 코드의 타입 가정", text: `첫 C2 코드는 ${M.RECEIVERS[0]}만 보고 컴파일돼 area()를 ${M.RECEIVERS[0]} 것으로 인라인하고, 다른 타입이 오면 트랩으로 빠지게 했습니다. 게이트가 내려와 있는 동안 ${M.RECEIVERS[1]}은 지나가지 못해요. 그 코드가 버려지면 올라가고, 둘을 다 본 재컴파일 코드에서도 올라가 있습니다.` },
  { id: "puck", name: "원형 퍽", concept: `${M.RECEIVERS[1]} 수신자 호출`, text: "가정을 깨는 호출 하나입니다. 내려온 게이트에 걸리면 class_check 트랩이 나고, 그 호출은 인터프리터로 넘어가 끝까지 실행돼요. 이때 코드는 아직 버리지 않습니다(maybe_recompile)." },
  { id: "tray", name: "트랩 트레이", concept: `class_check 트랩 수, 한도 ${F.PerBytecodeTrapLimit}`, text: `트랩이 날 때마다 퍽이 한 칸씩 쌓이고, ${F.PerBytecodeTrapLimit}칸이 차면(PerBytecodeTrapLimit) tier 4 코드가 made not entrant 되어 레버가 0으로 떨어집니다. 첫 재컴파일이라 MDO 카운터를 되돌리지 않아서, 다음 검사가 C1을 건너뛰고 바로 tier 4를 요청해요.` },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";
// 같은 data-sel을 단 노드가 한 묶음이다. 떨어져 그려지는 부품(템플릿의 뒤와 앞)은 같은 id로 여러 번 감싼다.
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;
const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 380;
const PLATE = { x: -160, y: -76, w: 248, d: 140, r: 9 };
const PLATE_H = 10;
const FOOT_H = 5;

// 카운터 게이지 (뒤 왼쪽): 기둥 위 눈금판, 앞에 창 두 개가 달린 카운터 상자
const GC = [-126, -46];
const G_FOOT = box(-148, -68, -104, -12, 2);
const G_R = 20;
const G_Z = 44;
const G_TOP = G_Z + 7;
const G_TICK_R = G_R - 3;
const G_MAX = 1.5; // 눈금 끝 = 임계값의 1.5배
const G_FROM = (-150 * Math.PI) / 180;
const G_SPAN = (300 * Math.PI) / 180;
const CBOX = box(-145, -38, -107, -28, 1.5);
const CBOX_Z = [4, 40];
const WIN_COUNT = { x0: -141, x1: -117, z0: 32, z1: 38.5 };
const WIN_LIMIT = { x0: -141, x1: -121, z0: 24, z1: 29.5 };

// 티켓 레일 (뒤 가운데): 디스펜서에서 스테이션 투입구까지
const DISP = box(-100, -38, -90, -21, 1.2);
const RAIL = box(-92, -31, 72, -27, 0.8);
const RAIL_Y = RAIL.y + RAIL.d / 2;
const RAIL_TOP = 14;
const RAIL_POSTS = [-80, -8, 62];
const DISPENSE_X = DISP.x + DISP.w + 6;
const TICKET = { w: 10, d: 8, h: 5 };

// 스테이션 (뒤 오른쪽): 투입구 수 = 스레드 수
const C1_BOX = box(-64, -68, -28, -42, 2);
const C2_BOX = box(-16, -68, 66, -42, 2);
const STATION_H = 26;
const C1_BAYS = Array.from({ length: M.C1_THREADS }, (_, i) => C1_BOX.x + C1_BOX.w / 2 + i * 26);
const C2_BAYS = Array.from({ length: M.C2_THREADS }, (_, i) => C2_BOX.x + 15 + i * 26);
const BAY_Z = [12.4, 20.6];

// 변속기 (앞 왼쪽): 칸 0..TieredStopAtLevel
const GB = box(-148, -8, -36, 32, 3);
const GB_H = 18;
const TIER_X = TIERS.map((t) => -128 + t * 19);
const SLOT_Y = 8;
const LEVER_ROD = 12;
const SLOT = box(TIER_X[0] - 7, SLOT_Y - 2.5, TIER_X[TIER_X.length - 1] + 7, SLOT_Y + 2.5, 2.5);
const STRIP = box(TIER_X[0] - 10, 14, TIER_X[TIER_X.length - 1] + 10, 23, 1);

// 수신자 템플릿 (앞 오른쪽): 구멍 2개, 원형 퍽이 오는 트랙과 그 앞을 막는 게이트, 앞에 트랩 트레이
const SB = box(-8, -6, 68, 31, 3);
const SB_H = 16;
const LID_TOP = 18;
const TRACK_Y = 18;
const ROUND = [22, TRACK_Y];
const ROUND_R = 7;
const SQUARE = box(-3, TRACK_Y - 7, 11, TRACK_Y + 7, 0.8);
const RAIL_IN = 7; // 트랙 레일 안쪽 = 퍽 반지름 + 여유
const TRACK_X = [13, 66];
const GATE_X = 38;
const GATE = box(GATE_X - 1, TRACK_Y - RAIL_IN + 0.4, GATE_X + 1, TRACK_Y + RAIL_IN - 0.4, 0.3);
const GATE_H = 9.6;
const GATE_LIFT = 6.2; // 열리면 퍽 높이보다 위로
const FRAME_TOP = LID_TOP + GATE_H + GATE_LIFT + 2;
const PUCK_R = 6;
const PUCK_H = 5;
const PUCK_REST = [58, TRACK_Y, LID_TOP];
const PUCK_STOP = GATE_X + 1 + PUCK_R + 1;
const GAP = [GATE_X + 3, GATE_X + 18]; // 앞 레일이 끊긴 출구: 막힌 퍽이 여기로 밀려 나간다
const TRAY = box(8, 38, 68, 54, 2);
const TRAY_TOP = 3;
const POCKETS = Array.from({ length: F.PerBytecodeTrapLimit }, (_, i) => TRAY.x + 9 + i * 14);
const POCKET_Y = TRAY.y + TRAY.d / 2;
const LABEL = box(-130, 42, -86, 52, 1.2);

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [GATE_X, TRACK_Y, FRAME_TOP + 3], [GC[0], GC[1] - G_R, G_TOP + 1], [TIER_X[0], SLOT_Y, GB_H + LEVER_ROD + 9], [C2_BAYS[C2_BAYS.length - 1], -55, STATION_H + 12]],
  WIDTH,
  HEIGHT,
  { pad: 18, azimuth: 52 },
);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
// 수직면 위 닫힌 사각 테두리: y = const 면과 x = const 면
const frontRect = (x0, x1, y, z0, z1) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);
const sideRect = (x, y0, y1, z0, z1) => k.pathOf([at([x, y0, z0]), at([x, y1, z0]), at([x, y1, z1]), at([x, y0, z1])], true);
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;

// 앞면(y = const)에 놓인 표시창: 어두운 창과 그 평면에 누운 숫자
function frontWindow(win, y, part, text, size = 4.4) {
  const rect = frontRect(win.x0, win.x1, y, win.z0, win.z1);
  const mid = (win.x0 + win.x1) / 2;
  const matrix = k.sideMatrix([mid, y], (win.z0 + win.z1) / 2, P, "left");
  return `<path class="iso-line jt-win" data-tone="lo" d="${rect}"/><text class="jt-digit" data-digit="${part}" transform="${matrix}" x="0" y="${(size * 0.36).toFixed(2)}" font-size="${size}" text-anchor="middle">${text}</text>`;
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
  out.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([30, 22, 26].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 2.8 + i * 2], [LABEL.x + 4 + w, LABEL.y + 2.8 + i * 2], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([LABEL.x + LABEL.w - 3, LABEL.y + 2.6, 0.8]), at([LABEL.x + LABEL.w - 3, LABEL.y + LABEL.d - 2.6, 0.8])], { size: 0.45 }));
  return out.join("");
}

// ---- 카운터 게이지 ----
function gauge() {
  const out = [];
  const [x, y] = GC;
  out.push(`<path class="iso-halo" d="${k.haloOf(G_FOOT, 0, 4, P)}"/>`);
  out.push(S(k.slabOf(G_FOOT, 0, 4, P, 4, 0.6), { tone: "mid" }));
  out.push(D(k.corners(G_FOOT, 3).map(([px, py]) => at([px, py, 4])), { size: 0.45 }));
  out.push(S(k.cylinder(x, y, 4.5, 4, G_Z - 4, P, 24), { tone: "mid", crease: "none", inner: L(k.sideArc(x, y, 4.5, 30, P, 14), { tone: "faint" }) }));
  // 하우징과 베젤, 눈금판
  out.push(S(k.cylinder(x, y, G_R, G_Z, G_TOP - G_Z, P, 64, 0.8), { tone: "mid", inner: L(k.sideArc(x, y, G_R, G_Z + 2.4, P, 40), { tone: "faint" }) }));
  out.push(L(k.ring(x, y, G_R - 1.6, G_TOP, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(x, y, G_TICK_R, 30, 5, G_TOP, [1.3, 2.8], P, G_FROM, G_SPAN);
  out.push(L(k.ring(x, y, G_TICK_R, G_TOP, P, 64), { tone: "faint" }));
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  // 임계 눈금 (비율 1): 굵고 길게
  const trip = G_FROM + (1 / G_MAX) * G_SPAN;
  const tripIn = G_TICK_R - 5.2;
  out.push(`<path class="iso-line" data-tone="hi" style="stroke-width:1.2" d="${k.lineOnTop([x + Math.sin(trip) * tripIn, y - Math.cos(trip) * tripIn], [x + Math.sin(trip) * G_TICK_R, y - Math.cos(trip) * G_TICK_R], G_TOP, P)}"/>`);
  // 임계 눈금 안쪽 끝의 표시 점
  out.push(D([at([x + Math.sin(trip) * tripIn, y - Math.cos(trip) * tripIn, G_TOP])], { size: 0.6, tone: "hi" }));
  // 멈춤 핀 (눈금 끝)
  out.push(D([at([x + Math.sin(G_FROM + G_SPAN) * (G_TICK_R - 5), y - Math.cos(G_FROM + G_SPAN) * (G_TICK_R - 5), G_TOP])], { size: 0.6, tone: "mid" }));
  // 카운터 상자 (기둥 앞, 받침판 위): 위 창 = 읽은 값, 아래 창 = 다음 검사의 임계값
  out.push(S(k.slabOf(CBOX, CBOX_Z[0], CBOX_Z[1] - CBOX_Z[0], P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(CBOX, 20, P, 3), { tone: "faint" }) }));
  const face = CBOX.y + CBOX.d;
  out.push(frontWindow(WIN_COUNT, face, "count", "----"));
  out.push(frontWindow(WIN_LIMIT, face, "limit", "----", 3.8));
  out.push(D([at([CBOX.x + CBOX.w - 3.5, face, 35]), at([CBOX.x + CBOX.w - 3.5, face, 26.5])], { size: 0.45, tone: "mid" }));
  // 영점 노브 (상자 위)
  const knob = [CBOX.x + CBOX.w - 4.5, CBOX.y + CBOX.d / 2];
  out.push(S(k.cylinder(knob[0], knob[1], 2.6, CBOX_Z[1], 3.6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(knob[0], knob[1], 2.6, CBOX_Z[1], CBOX_Z[1] + 3.6, 16, P), { tone: "lo" }));
  return out.join("");
}

const needleAt = (fraction) => {
  const a = G_FROM + (Math.min(fraction, G_MAX) / G_MAX) * G_SPAN;
  const [x, y] = GC;
  return k.lineOnTop([x - Math.sin(a) * 3, y + Math.cos(a) * 3], [x + Math.sin(a) * (G_TICK_R - 1.5), y - Math.cos(a) * (G_TICK_R - 1.5)], G_TOP + 0.2, P);
};

// ---- 디스펜서와 레일 ----
function rail() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(DISP, 0, 3, P)}" style="opacity:.6"/>`);
  out.push(S(k.slabOf(DISP, 0, RAIL_TOP + TICKET.h + 4, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(DISP, 8, P, 3), { tone: "faint" }) }));
  out.push(`<path class="iso-line jt-hole" data-tone="lo" d="${sideRect(DISP.x + DISP.w, RAIL_Y - TICKET.d / 2 - 0.6, RAIL_Y + TICKET.d / 2 + 0.6, RAIL_TOP - 0.4, RAIL_TOP + TICKET.h + 0.8)}"/>`);
  out.push(D([at([DISP.x + 2.4, DISP.y + DISP.d, RAIL_TOP + TICKET.h + 1.8]), at([DISP.x + DISP.w - 2.4, DISP.y + DISP.d, RAIL_TOP + TICKET.h + 1.8])], { size: 0.45 }));
  for (const x of RAIL_POSTS) out.push(S(k.slabOf(box(x - 2.5, RAIL.y - 1, x + 2.5, RAIL.y + RAIL.d + 1, 0.6), 0, RAIL_TOP - 2.5, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf(RAIL, RAIL_TOP - 2.5, 2.5, P, 2, 0.4), { tone: "mid", inner: L(k.sideSeam(RAIL, RAIL_TOP - 1.2, P, 2), { tone: "faint" }) }));
  out.push(D(RAIL_POSTS.map((x) => at([x, RAIL_Y, RAIL_TOP])), { size: 0.4, tone: "lo" }));
  // 끝 스토퍼
  out.push(S(k.slabOf(box(RAIL.x + RAIL.w - 2, RAIL.y - 1, RAIL.x + RAIL.w, RAIL.y + RAIL.d + 1, 0.4), RAIL_TOP, 4, P, 2), { tone: "mid" }));
  // 클램프 손나사 (왼쪽 받침 앞)
  out.push(S(k.cylinder(RAIL_POSTS[0], RAIL.y + RAIL.d + 3.4, 2.2, 0, 5, P, 18), { tone: "mid" }));
  out.push(L(k.knurl(RAIL_POSTS[0], RAIL.y + RAIL.d + 3.4, 2.2, 0, 5, 14, P), { tone: "lo" }));
  return out.join("");
}

function ticket() {
  const out = [];
  const plan = box(-TICKET.w / 2, -TICKET.d / 2, TICKET.w / 2, TICKET.d / 2, 1);
  out.push(S(k.slabOf(plan, 0, TICKET.h, P, 3, 0.4), { tone: "mid", crease: "lo" }));
  out.push(frontWindow({ x0: -3, x1: 3, z0: 0.9, z1: 4.1 }, TICKET.d / 2, "ticket", "", 3));
  out.push(D([at([-3.6, 0, TICKET.h]), at([3.6, 0, TICKET.h])], { size: 0.4, tone: "mid" }));
  return out.join("");
}

// ---- 스테이션 ----
function station(plan, bays, kind) {
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, 0, 6, P)}"/>`];
  out.push(S(k.slabOf(plan, 0, STATION_H, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(plan, 17, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(plan, 3), STATION_H, P, 4), { tone: "faint" }));
  out.push(D(k.corners(plan, 3).map(([x, y]) => at([x, y, STATION_H])), { size: 0.45 }));
  const face = plan.y + plan.d;
  for (const x of bays) {
    out.push(`<path class="iso-line jt-hole" data-tone="lo" d="${frontRect(x - TICKET.w / 2 - 1, x + TICKET.w / 2 + 1, face, BAY_Z[0], BAY_Z[1])}"/>`);
    out.push(S(k.slabOf(box(x - TICKET.w / 2 - 2, face, x + TICKET.w / 2 + 2, face + 2.2, 0.5), BAY_Z[0] - 1.6, 1.6, P, 2), { tone: "mid" }));
  }
  out.push(D([plan.x + 3, plan.x + plan.w - 3].map((x) => at([x, face, STATION_H - 3])), { size: 0.45, tone: "mid" }));
  // 통풍 슬롯: 앞면 아래와 오른쪽 옆면에 닫힌 슬롯 3줄씩
  for (let i = 0; i < 3; i++) out.push(L(frontRect(plan.x + 4, plan.x + plan.w - 4, face, 4 + i * 2, 5 + i * 2), { tone: "faint" }));
  const side = plan.x + plan.w;
  for (let i = 0; i < 3; i++) out.push(L(sideRect(side, plan.y + 5, plan.y + plan.d - 5, 7 + i * 2.6, 8.2 + i * 2.6), { tone: "lo" }));
  out.push(D([at([side, plan.y + 3, STATION_H - 3]), at([side, plan.y + plan.d - 3, STATION_H - 3])], { size: 0.45, tone: "mid" }));
  const y = plan.y + plan.d / 2;
  if (kind === "c1") {
    const x = bays[0];
    out.push(S(k.cylinder(x, y, 7.5, STATION_H, 8, P, 40, 0.5), { tone: "mid", inner: L(k.sideArc(x, y, 7.5, STATION_H + 3, P, 24), { tone: "faint" }) }));
    out.push(L(k.ring(x, y, 5, STATION_H + 8, P, 32), { tone: "faint" }));
    out.push(S(k.cylinder(x, y, 3.2, STATION_H + 8, 2.4, P, 24), { tone: "mid" }));
    out.push(D([at([x, y, STATION_H + 10.4])], { size: 0.5, tone: "mid" }));
  } else {
    for (const x of bays) {
      out.push(S(k.cylinder(x, y, 6, STATION_H, 6.5, P, 36, 0.5), { tone: "mid", inner: L(k.sideArc(x, y, 6, STATION_H + 2.6, P, 20), { tone: "faint" }) }));
      out.push(S(k.cylinder(x, y, 2.8, STATION_H + 6.5, 4.5, P, 20), { tone: "mid", crease: "none" }));
      out.push(L(k.knurl(x, y, 2.8, STATION_H + 6.5, STATION_H + 11, 12, P), { tone: "lo" }));
    }
  }
  return out.join("");
}

// ---- 변속기와 레버 ----
function gearbox() {
  const out = [`<path class="iso-halo" d="${k.haloOf(GB, 0, 6, P)}"/>`];
  out.push(S(k.slabOf(GB, 0, GB_H, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(GB, 9, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(GB, 3), GB_H, P, 4), { tone: "faint" }));
  out.push(D(k.corners(GB, 6).map(([x, y]) => at([x, y, GB_H])), { size: 0.5 }));
  // 점검판 (앞면)
  const face = GB.y + GB.d;
  out.push(L(frontRect(GB.x + 8, GB.x + 46, face, 2.2, 7), { tone: "lo" }));
  out.push(D([at([GB.x + 10, face, 4.6]), at([GB.x + 44, face, 4.6])], { size: 0.45, tone: "mid" }));
  // 변속 슬롯과 멈춤 홈
  out.push(`<path class="iso-line jt-hole" data-tone="lo" d="${k.planOutline(SLOT, GB_H, P, 4)}"/>`);
  out.push(L(TIER_X.map((x) => k.ring(x, SLOT_Y, 3.2, GB_H, P, 20)).join(""), { tone: "lo" }));
  // 눈금 띠: 칸마다 눈금 하나와 각인 숫자 (변속 슬롯 색인이 그림의 유일한 각인)
  out.push(S(k.slabOf(STRIP, GB_H, 0.6, P, 3), { tone: "lo", crease: "none" }));
  TIERS.forEach((t, i) => {
    const used = USED.includes(t);
    out.push(L(k.lineOnTop([TIER_X[i], STRIP.y + 0.2], [TIER_X[i], STRIP.y + 2.8], GB_H + 0.6, P), { tone: used ? "mid" : "lo" }));
    out.push(k.faceTextSvg(k.topMatrix([TIER_X[i], STRIP.y + 7.4], GB_H + 0.6, P, "x"), String(t), { size: 4.2, tone: used ? "mid" : "lo", anchor: "middle" }));
  });
  out.push(D([at([STRIP.x + 1.8, STRIP.y + STRIP.d / 2, GB_H + 0.6]), at([STRIP.x + STRIP.w - 1.8, STRIP.y + STRIP.d / 2, GB_H + 0.6])], { size: 0.4 }));
  // 브리더 캡
  const cap = [GB.x + GB.w - 9, GB.y + 5.5];
  out.push(S(k.cylinder(cap[0], cap[1], 2.6, GB_H, 3.6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(cap[0], cap[1], 2.6, GB_H, GB_H + 3.6, 16, P), { tone: "lo" }));
  return out.join("");
}

function lever() {
  return [
    S(k.cylinder(0, SLOT_Y, 4.2, GB_H, 2.4, P, 28, 0.4), { tone: "mid" }),
    S(k.cylinder(0, SLOT_Y, 1.4, GB_H + 2.4, LEVER_ROD, P, 16), { tone: "mid", crease: "none" }),
    S(k.cylinder(0, SLOT_Y, 4.4, GB_H + 2.4 + LEVER_ROD, 5.4, P, 32, 0.5), { tone: "hi", crease: "lo", inner: L(k.knurl(0, SLOT_Y, 4.4, GB_H + 3.4 + LEVER_ROD, GB_H + 6.8 + LEVER_ROD, 24, P), { tone: "lo" }) }),
    D([at([0, SLOT_Y, GB_H + 7.8 + LEVER_ROD])], { size: 0.55, tone: "hi" }),
  ].join("");
}

// ---- 수신자 템플릿, 게이트, 트레이 ----
const railPlan = (x0, x1, side) => box(x0, TRACK_Y + side * RAIL_IN + (side < 0 ? -1.6 : 0), x1, TRACK_Y + side * RAIL_IN + (side < 0 ? 0 : 1.6), 0.4);
const postPlan = (side) => box(GATE_X - 1.6, TRACK_Y + side * (RAIL_IN + 1.6) + (side < 0 ? -2 : 0), GATE_X + 1.6, TRACK_Y + side * (RAIL_IN + 1.6) + (side < 0 ? 0 : 2), 0.4);

// 상자, 뚜껑, 구멍, 뒤 레일, 게이트 프레임 뒤 기둥, 끝 블록 (게이트와 퍽보다 먼저)
function templateBack() {
  const out = [`<path class="iso-halo" d="${k.haloOf(SB, 0, 6, P)}"/>`];
  out.push(S(k.slabOf(SB, 0, SB_H, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(SB, 7, P, 4), { tone: "faint" }) }));
  const lid = k.insetPlan(SB, 1);
  out.push(S(k.slabOf(lid, SB_H, LID_TOP - SB_H, P, 4, 0.5), { tone: "mid" }));
  out.push(D(k.corners(lid, 3).map(([x, y]) => at([x, y, LID_TOP])), { size: 0.45 }));
  // 앞면 점검판과 나사
  const face = SB.y + SB.d;
  out.push(L(frontRect(SB.x + 8, SB.x + 34, face, 2.4, 6.4), { tone: "lo" }));
  out.push(D([at([SB.x + 10, face, 4.4]), at([SB.x + 32, face, 4.4])], { size: 0.45, tone: "mid" }));
  // 구멍 2개 = TypeProfileWidth: 네모 = Square, 둥근 = Circle
  out.push(`<path class="iso-line jt-hole" data-tone="lo" d="${k.ring(ROUND[0], ROUND[1], ROUND_R, LID_TOP, P, 40)}"/>`);
  out.push(`<path class="iso-line jt-hole" data-tone="lo" d="${k.planOutline(SQUARE, LID_TOP, P, 2)}"/>`);
  out.push(L(k.planOutline(k.insetPlan(SQUARE, -1.6), LID_TOP, P, 2), { tone: "faint" }));
  out.push(S(k.slabOf(railPlan(TRACK_X[0], TRACK_X[1], -1), LID_TOP, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(postPlan(-1), LID_TOP, FRAME_TOP - LID_TOP, P, 2), { tone: "mid", crease: "none" }));
  // 끝 블록: 다음 퍽이 여기 기대어 기다린다
  const stop = box(TRACK_X[1] - 3, TRACK_Y - RAIL_IN, TRACK_X[1], TRACK_Y + RAIL_IN, 0.5);
  out.push(S(k.slabOf(stop, LID_TOP, 6, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([TRACK_X[1] - 1.5, TRACK_Y - 3, LID_TOP + 6]), at([TRACK_X[1] - 1.5, TRACK_Y + 3, LID_TOP + 6])], { size: 0.4 }));
  return out.join("");
}

// 앞 레일 두 토막(출구에서 끊김), 프레임 앞 기둥, 가로대 (트랙 위 퍽보다 나중)
function templateFront() {
  const out = [];
  out.push(S(k.slabOf(railPlan(TRACK_X[0], GAP[0], 1), LID_TOP, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(railPlan(GAP[1], TRACK_X[1], 1), LID_TOP, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(postPlan(1), LID_TOP, FRAME_TOP - LID_TOP, P, 2), { tone: "mid", crease: "none" }));
  const bar = box(GATE_X - 1.6, TRACK_Y - RAIL_IN - 3.6, GATE_X + 1.6, TRACK_Y + RAIL_IN + 3.6, 0.4);
  out.push(S(k.slabOf(bar, FRAME_TOP, 2.4, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([GATE_X, TRACK_Y - RAIL_IN - 2.6, FRAME_TOP + 2.4]), at([GATE_X, TRACK_Y + RAIL_IN + 2.6, FRAME_TOP + 2.4])], { size: 0.4 }));
  return out.join("");
}

// 게이트: 닫힌 높이에서 한 번 만들고 z로 올린다
function gate() {
  return [
    S(k.slabOf(GATE, LID_TOP + 0.4, GATE_H, P, 2), { tone: "mid", crease: "lo", inner: L(k.sideSeam(GATE, LID_TOP + GATE_H - 2, P, 2), { tone: "faint" }) }),
    S(k.slabOf(box(GATE_X - 0.6, TRACK_Y - 2, GATE_X + 0.6, TRACK_Y + 2, 0.2), LID_TOP + 0.4 + GATE_H, 1.4, P, 2), { tone: "mid" }),
  ].join("");
}

const puckSvg = () => [
  S(k.cylinder(0, 0, PUCK_R, 0, PUCK_H, P, 40, 0.4), { tone: "mid", crease: "lo", inner: L(k.sideArc(0, 0, PUCK_R, 1.6, P, 24), { tone: "faint" }) }),
  L(k.ring(0, 0, PUCK_R - 2.2, PUCK_H, P, 28), { tone: "faint" }),
].join("");

function tray() {
  const out = [`<path class="iso-halo" d="${k.haloOf(TRAY, 0, 2, P)}" style="opacity:.6"/>`];
  out.push(S(k.slabOf(TRAY, 0, TRAY_TOP, P, 3, 0.5), { tone: "mid" }));
  out.push(L(POCKETS.map((x) => k.ring(x, POCKET_Y, PUCK_R + 0.6, TRAY_TOP, P, 32)).join(""), { tone: "lo" }));
  out.push(D([at([TRAY.x + 1.6, POCKET_Y, TRAY_TOP]), at([TRAY.x + TRAY.w - 1.6, POCKET_Y, TRAY_TOP])], { size: 0.45 }));
  return out.join("");
}

// ---- 그림 조립 ----
// 게이트가 닫혀 있는가: 설치된 C2 코드가 Circle을 인라인하지 않았다 (live 코드와 같은 규칙)
const gateClosed = (s) => s.accepts !== null && !s.accepts.includes(M.RECEIVERS[1]);
const TRAY_PUCKS = POCKETS.map((x, i) => groupAt([x, POCKET_Y, TRAY_TOP], puckSvg(), ` data-tray="${i}" data-sel="tray" style="display:none"`));
const TICKET_SVG = groupAt([C2_BAYS[0], RAIL_Y, RAIL_TOP], ticket(), ` data-part="ticket" data-sel="ticket"`);
const LEVER_SVG = groupAt([TIER_X[TRACE[INIT_STEPS].tier], 0, 0], lever(), ` data-part="lever" data-sel="lever"`);

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `호출 카운터가 달린 변속기. 왼쪽 뒤 카운터 게이지가 정해진 간격마다 호출 수를 읽어 임계값 ${F.Tier3InvocationThreshold}이나 ${F.Tier4InvocationThreshold}과 견주고, 넘으면 컴파일 티켓이 레일을 따라 C1 스테이션(투입구 ${M.C1_THREADS}개)이나 C2 스테이션(투입구 ${M.C2_THREADS}개)으로 간다. 앞 왼쪽 변속 레버는 칸 0부터 ${F.TieredStopAtLevel} 가운데 설치된 코드의 tier에 놓인다. 앞 오른쪽 수신자 템플릿의 게이트가 내려와 있으면 트랙을 따라 온 원형 퍽이 걸려 트레이에 쌓이고, ${F.PerBytecodeTrapLimit}개가 차면 레버가 0으로 떨어진다.`,
  body: [
    base(),
    sel("gauge", gauge()),
    `<path data-part="needle" data-sel="gauge" class="iso-line" data-tone="hi" data-free="" style="stroke-width:1.1" d="${needleAt(M.gauge(TRACE[INIT_STEPS]))}"/>`,
    sel("gauge", D([at([GC[0], GC[1], G_TOP + 0.2])], { size: 0.9, tone: "hi" })),
    sel("c1", station(C1_BOX, C1_BAYS, "c1")),
    sel("c2", station(C2_BOX, C2_BAYS, "c2")),
    sel("ticket", rail()),
    TICKET_SVG,
    sel("lever", gearbox()),
    LEVER_SVG,
    sel("template", templateBack()),
    groupAt([0, 0, gateClosed(TRACE[INIT_STEPS]) ? 0 : GATE_LIFT], gate(), ` data-part="gate" data-sel="gate"`),
    // 트랙 위 퍽은 앞 레일 뒤(inner), 출구로 나가 떨어지는 퍽은 트레이 앞(outer)에 그린다
    `<g data-layer="inner">${groupAt(PUCK_REST, puckSvg(), ` data-part="puck" data-sel="puck"`)}</g>`,
    sel("template", templateFront()),
    sel("tray", tray()),
    ...TRAY_PUCKS,
    `<g data-layer="outer"></g>`,
  ],
});

const CFG = {
  P,
  TIER_X, GC, G_R, G_TOP, G_TICK_R, G_MAX, G_FROM, G_SPAN,
  RAIL_Y, RAIL_TOP, DISPENSE_X, C1_BAY: C1_BAYS[0], C2_BAY: C2_BAYS[0], BAY_Y: C1_BOX.y + C1_BOX.d - 2,
  GATE_LIFT, TRACK_Y, PUCK_REST, PUCK_STOP, EXIT_Y: SB.y + SB.d - 1, POCKETS, POCKET_Y, TRAY_TOP, CIRCLE: M.RECEIVERS[1],
  INIT_STEPS,
  SECONDS: { check: 0.9, install: 1.1, trap: 1.3, out: 1.6, rewind: 1.0 }, TOUR_GAP: 0.5, TOUR_REST: 2, RESUME: 6,
};

const live = `
const C = ${JSON.stringify(CFG)};
const P = C.P;
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const q = (s) => svg.querySelector(s);
const readoutEl = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const el = {
  lever: q('[data-part="lever"]'), needle: q('[data-part="needle"]'), ticket: q('[data-part="ticket"]'),
  gate: q('[data-part="gate"]'), puck: q('[data-part="puck"]'),
  tray: [...svg.querySelectorAll("[data-tray]")],
};
const digit = (name) => q('[data-digit="' + name + '"]');
const PARTS = ${JSON.stringify(PARTS)};
const NOTE_IDLE = ${JSON.stringify(NOTE_IDLE)};
const note = document.querySelector("[data-note]");
const picks = [...document.querySelectorAll("[data-pick]")];
const groups = [...svg.querySelectorAll("[data-sel]")];
// 호버가 우선이고, 호버가 없으면 번호로 고른 것(pin)을 보여준다
let hoverSel = null, pinSel = null, shownSel = null;
const picked = () => hoverSel ?? pinSel;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const seg = (u, a, b) => ease((u - a) / (b - a));
const fall = (u, a, b) => { const t = clamp01((u - a) / (b - a)); return t * t; };
const lerp = (a, b, t) => a + (b - a) * t;
const needleAt = ${needleAt.toString().replace("k.lineOnTop", "lineOnTop")};
const G_FROM = C.G_FROM, G_SPAN = C.G_SPAN, G_MAX = C.G_MAX, GC = C.GC, G_TICK_R = C.G_TICK_R, G_TOP = C.G_TOP;

function initial() { let s = MODEL.makeState(); for (let i = 0; i < C.INIT_STEPS; i++) s = MODEL.step(s); return s; }
let state = initial();
let anim = null; // { from, to, kind, t }
const bayX = (level) => (level === 3 ? C.C1_BAY : C.C2_BAY);
const closed = (s) => s.accepts !== null && !s.accepts.includes(C.CIRCLE);
const layer = { inner: q('[data-layer="inner"]'), outer: q('[data-layer="outer"]') };
// 강조(lit)는 상태마다 하나: 방금 움직인 부품. entry에서는 다음 STEP(검사)이 움직일 바늘
function litOf(s) {
  const L = s.last;
  if (!L) return "needle";
  if (L.kind === "check") return L.request === null ? "needle" : "ticket";
  if (L.kind === "install") return "lever";
  return L.notEntrant ? "lever" : "tray-" + (L.count - 1);
}

// 정지 자세: 상태 하나로 정해진다
function rest(s) {
  const limit = s.reading ? s.reading.threshold : MODEL.nextThreshold(s);
  return {
    lever: C.TIER_X[s.tier],
    needle: MODEL.gauge(s),
    count: s.reading ? String(s.reading.count) : "----",
    limit: limit === null ? "----" : String(limit),
    ticket: s.queued === null ? null : { x: bayX(s.queued), y: C.RAIL_Y, o: 1, level: s.queued },
    gate: closed(s) ? 0 : C.GATE_LIFT,
    puck: { x: C.PUCK_REST[0], y: C.PUCK_REST[1], z: C.PUCK_REST[2], o: 1, lit: false },
    tray: s.traps, trayO: 1,
    lit: litOf(s),
  };
}

// 전이 자세: 직전 상태에서 다음 상태로, u = 0..1
function between(a, b, u, kind) {
  if (u >= 1) return rest(b);
  const pose = rest(a);
  pose.lit = litOf(b);
  if (kind === "rewind") {
    pose.lever = lerp(rest(a).lever, rest(b).lever, seg(u, 0.2, 0.9));
    pose.trayO = 1 - seg(u, 0, 0.5);
    pose.needle = lerp(MODEL.gauge(a), 0, seg(u, 0, 0.5));
    if (u >= 0.5) Object.assign(pose, { tray: 0, trayO: 1, count: rest(b).count, limit: rest(b).limit, ticket: null });
    pose.gate = lerp(rest(a).gate, rest(b).gate, seg(u, 0.2, 0.8));
    return pose;
  }
  const L = b.last;
  if (L.kind === "check") {
    pose.needle = lerp(MODEL.gauge(a), MODEL.gauge(b), seg(u, 0.05, 0.5));
    if (u >= 0.05) { pose.count = rest(b).count; pose.limit = rest(b).limit; }
    if (L.request !== null) {
      // 티켓: 디스펜서에서 나와 레일을 따라 스테이션 투입구 앞으로
      const x = lerp(C.DISPENSE_X, bayX(L.request), seg(u, 0.45, 0.95));
      pose.ticket = u < 0.4 ? null : { x, y: C.RAIL_Y, o: seg(u, 0.4, 0.5), level: L.request };
      if (u < 0.45) pose.lit = "needle";
    }
  } else if (L.kind === "install") {
    // 티켓이 투입구로 들어가 사라지고, 새 코드가 설치되면 레버가 옮겨 간다
    const t = rest(a).ticket;
    if (t) pose.ticket = { ...t, y: lerp(C.RAIL_Y, C.BAY_Y, seg(u, 0, 0.3)), o: 1 - seg(u, 0.15, 0.32) };
    if (u >= 0.32) pose.ticket = null;
    pose.needle = lerp(MODEL.gauge(a), 0, seg(u, 0.3, 0.6));
    if (u >= 0.3) { pose.count = rest(b).count; pose.limit = rest(b).limit; }
    pose.lever = lerp(C.TIER_X[a.tier], C.TIER_X[b.tier], seg(u, 0.35, 0.9));
    pose.gate = lerp(rest(a).gate, rest(b).gate, seg(u, 0.6, 0.95));
  } else if (L.kind === "trap") {
    // 원형 퍽: 트랙을 따라 와서 닫힌 게이트에 걸리고, 앞 레일 출구로 밀려 트레이 포켓으로 떨어진다
    const [x0, y0, z0] = C.PUCK_REST;
    const pocket = C.POCKETS[L.count - 1];
    const p = { x: x0, y: y0, z: z0, o: 1, lit: true };
    if (u < 0.3) p.x = lerp(x0, C.PUCK_STOP, seg(u, 0, 0.3));
    else if (u < 0.4) p.x = C.PUCK_STOP + 1.6 * Math.sin(Math.PI * (u - 0.3) / 0.1);
    else if (u < 0.6) { p.x = C.PUCK_STOP; p.y = lerp(y0, C.EXIT_Y, seg(u, 0.42, 0.6)); }
    else if (u < 0.78) {
      const t = (u - 0.6) / 0.18;
      p.x = lerp(C.PUCK_STOP, pocket, ease(t));
      p.y = lerp(C.EXIT_Y, C.POCKET_Y, ease(t));
      p.z = lerp(z0, C.TRAY_TOP, t * t);
    } else { p.x = pocket; p.y = C.POCKET_Y; p.z = C.TRAY_TOP; }
    if (u >= 0.78) { pose.tray = b.traps; p.o = 0; p.lit = false; }
    // 다음 퍽이 트랙 끝에서 기다린다
    if (u >= 0.84) Object.assign(p, { x: x0, y: y0, z: z0, o: seg(u, 0.84, 1), lit: false });
    pose.puck = p;
    if (u < 0.78) pose.lit = "puck";
    if (L.notEntrant) {
      pose.lever = lerp(C.TIER_X[a.tier], C.TIER_X[b.tier], seg(u, 0.8, 1));
      pose.gate = lerp(rest(a).gate, rest(b).gate, seg(u, 0.8, 1));
      if (u >= 0.8) pose.limit = rest(b).limit;
    }
  }
  return pose;
}

function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }
function lightUp(node, on) {
  node.querySelectorAll(".iso-solid").forEach((n) => n.toggleAttribute("data-lit", on));
  node.toggleAttribute("data-on", on);
}
function text(name, value) { const d = digit(name); if (d.textContent !== value) d.textContent = value; }
function draw(pose) {
  put(el.lever, [pose.lever, 0, 0]);
  lightUp(el.lever, pose.lit === "lever");
  el.needle.setAttribute("d", needleAt(pose.needle));
  el.needle.dataset.tone = pose.lit === "needle" ? "lit" : "hi";
  text("count", pose.count);
  text("limit", pose.limit);
  const t = pose.ticket;
  el.ticket.style.display = t ? "" : "none";
  if (t) {
    put(el.ticket, [t.x, t.y, C.RAIL_TOP]);
    el.ticket.style.opacity = t.o < 1 ? t.o.toFixed(3) : "";
    text("ticket", String(t.level));
  }
  lightUp(el.ticket, pose.lit === "ticket");
  put(el.gate, [0, 0, pose.gate]);
  const p = pose.puck;
  put(el.puck, [p.x, p.y, p.z]);
  const into = p.y > C.TRACK_Y + 2 ? layer.outer : layer.inner;
  if (el.puck.parentNode !== into) into.appendChild(el.puck);
  el.puck.style.opacity = p.o < 1 ? p.o.toFixed(3) : "";
  lightUp(el.puck, pose.lit === "puck");
  el.tray.forEach((node, i) => {
    node.style.display = i < pose.tray ? "" : "none";
    node.style.opacity = pose.trayO < 1 ? pose.trayO.toFixed(3) : "";
    lightUp(node, pose.lit === "tray-" + i);
  });
}

function say() {
  const value = MODEL.readout(state);
  if (readoutEl.textContent !== value) readoutEl.textContent = value;
  return value;
}

// 루프
let frame = 0, last = 0, visible = false, touring = !still.matches, wait = C.TOUR_REST, idleTimer = 0;
const durationOf = (kind, to) => kind === "rewind" ? C.SECONDS.rewind : to.last.kind === "trap" && to.last.notEntrant ? C.SECONDS.out : C.SECONDS[to.last.kind];
function begin(from, to, kind = "step") {
  anim = { from, to, kind, t: 0, seconds: durationOf(kind, to) };
  if (still.matches) { anim = null; draw(rest(to)); }
  run();
}
function advance() {
  if (state.done) return false;
  const from = state;
  state = MODEL.step(state);
  say();
  begin(from, state);
  return true;
}
function rewind() {
  const from = state;
  state = MODEL.makeState();
  say();
  begin(from, state, "rewind");
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (anim) {
    anim.t += dt / anim.seconds;
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
  if (pinSel && !event.target.closest(".jt-parts, .iso-stage")) { pinSel = null; choose(); }
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
const FS = ".iso-stage[data-focus]";
const FP = `${FS} [data-picked]`;
const SHADES = [0, 1, 2, 3];
const FOCUS_CSS = [
  `${FS} .iso-line[data-tone="hi"],${FS} .iso-line[data-tone="lit"]{stroke:var(--anatomy-mid)}`,
  `${FS} .iso-line[data-tone="mid"]{stroke:var(--anatomy-lo)}`,
  `${FS} .iso-line[data-tone="lo"]{stroke:var(--anatomy-faint)}`,
  `${FS} .iso-solid[data-lit]>.iso-fill{fill:var(--anatomy-paper)}`,
  `${FS} .iso-solid[data-lit]>.iso-top{fill:var(--anatomy-top)}`,
  `${FS} .iso-solid[data-lit]>.iso-edge{stroke:var(--anatomy-mid)}`,
  `${FS} .iso-solid[data-seamless][data-lit]>.iso-top{stroke:var(--anatomy-top)}`,
  ...SHADES.map((n) => `${FS} .iso-solid[data-lit]>.iso-shade[data-shade="${n}"]{fill:var(--anatomy-shade-${n})}`),
  ...SHADES.map((n) => `${FS} .iso-solid[data-seamless][data-lit]>.iso-shade[data-shade="${n}"]{stroke:var(--anatomy-shade-${n})}`),
  `${FS} .iso-dots circle{opacity:.18}`,
  `${FS} .jt-digit{fill:var(--anatomy-mid)}`,
  `${FS} .iso-face-text{fill:var(--anatomy-lo)}`,
  `${FP} .iso-line[data-tone="hi"],${FP} .iso-line[data-tone="lit"],${FP}.iso-line[data-tone="hi"],${FP}.iso-line[data-tone="lit"]{stroke:var(--anatomy-lit)}`,
  `${FP} .iso-line[data-tone="mid"]{stroke:var(--anatomy-hi)}`,
  `${FP} .iso-line[data-tone="lo"]{stroke:var(--anatomy-mid)}`,
  `${FP} .iso-line[data-tone="faint"]{stroke:var(--anatomy-lo)}`,
  `${FP} .iso-solid>.iso-fill{fill:var(--anatomy-face)}`,
  `${FP} .iso-solid>.iso-top{fill:var(--anatomy-lit-top)}`,
  `${FP} .iso-solid>.iso-shade[data-shade]{fill:var(--anatomy-lit-shade)}`,
  `${FP} .iso-solid[data-seamless]>.iso-top{stroke:var(--anatomy-lit-top)}`,
  `${FP} .iso-solid[data-seamless]>.iso-shade[data-shade]{stroke:var(--anatomy-lit-shade)}`,
  `${FP} .iso-dots circle,${FP}.iso-dots circle{opacity:.85}`,
  `${FP} .jt-digit{fill:var(--anatomy-lit)}`,
  `${FP} .iso-face-text{fill:var(--anatomy-hi)}`,
].join("\n");

const css = `<style>
.iso{--jt-hole:#030303;--jt-win:#0b0b0b}
.iso[data-theme="light"]{--jt-hole:#a3a3a0;--jt-win:#ececea}
.iso-line.jt-hole{fill:var(--jt-hole)}
.iso-line.jt-win{fill:var(--jt-win)}
.jt-digit{fill:var(--anatomy-hi);font-family:var(--anatomy-mono);font-weight:600}
[data-on] .jt-digit{fill:var(--anatomy-lit)}
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:118%;margin:0 -9%}}
.jt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.jt-parts{display:flex;flex-wrap:wrap;gap:6px}
.jt-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.jt-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.jt-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.jt-parts button[data-picked] span{color:var(--anatomy-strong)}
.jt-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.jt-note{min-height:4.6em;color:var(--anatomy-text)}
.jt-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="jt-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="jt-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 5",
    title: "JIT 계층 변속기",
    hint: "클릭이나 → 사건 하나, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [{ mark: "lit", label: "방금 움직인 부품: 바늘, 티켓, 레버, 트레이에 떨어진 퍽 중 하나" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="JIT 계층 변속기. 클릭, 오른쪽 화살표, 스페이스로 정책에 닿는 사건 하나를 진행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="jt-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "JIT 계층 변속기", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
