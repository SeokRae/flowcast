// node build.mjs [--light]: 세이프포인트 신호 야드 (flowcast:mechanism 예제, 합성)
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
const NAME = "jvm-safepoint";
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
const NAMES = M.THREADS.map((t) => t.name);
const INIT_STEPS = 8; // 처음 보여줄 상태: compiled만 아직 달리는 2회차 검사 (trace[8])
if (TRACE[INIT_STEPS].last.pass !== 2 || M.safeCount(TRACE[INIT_STEPS]) !== NAMES.length - 1) throw new Error("initial pose should be pass 2");
const T = M.TIMES_NS;
const byName = Object.fromEntries(M.THREADS.map((t) => [t.name, t]));

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const PARTS = [
  { id: "box", name: "신호소", concept: "VM 스레드", text: `main이 System.gc()로 맡긴 ${M.VM_OP}을 받아 세이프포인트를 여는 쪽입니다. 이 실행에서 JavaThread는 ${M.TOTAL_THREADS}개였고, 그중 ${M.THREADS.length}개만 선로로 그렸어요.` },
  { id: "lever", name: "상태 레버", concept: "SafepointSynchronize::_state", text: "홈이 not_synchronized, 1칸이 synchronizing, 2칸이 synchronized입니다. arm_safepoint()가 1칸으로 당기고, 모든 스레드가 safe로 세어지면 2칸, disarm_safepoint()가 홈으로 되돌려요." },
  { id: "stops", name: "트립 스톱", concept: "local poll과 wait barrier", text: `스레드마다 있는 폴링 값을 arm하면 ${M.THREADS.length}개가 한꺼번에 올라옵니다. 폴링에 걸린 스레드는 스스로 blocked가 되어 ${M.WAIT_BARRIER} wait barrier에서 기다리고, 스톱이 내려가야(disarm) 다시 달려요.` },
  { id: "compiled", name: "열차 compiled", concept: `${byName.compiled.runs} 루프`, text: `C2가 컴파일한 루프는 back-edge마다 polling page를 읽습니다. arm되면 그 읽기가 트랩되고, 시그널 처리를 거쳐 멈춰요. 이 실행에서는 그 사이 검사 ${TRACE.filter((s) => s.last && s.last.op === "check" && s.last.thread === "compiled" && !s.last.safe).length}번 동안 in_Java로 보였습니다(page_trap_count ${M.PAGE_TRAPS}).` },
  { id: "interp", name: "열차 interp", concept: `${byName.interp.runs} 루프`, text: "인터프리터는 branch 바이트코드 뒤에 poll word를 한 번 확인합니다. arm 직후 곧바로 멈춰서, VM 스레드가 처음 볼 때 이미 blocked였어요." },
  { id: "native", name: "열차 native", concept: "_thread_in_native", text: `${byName.native.runs}에서 read를 기다리는 중이라 차고(native 코드) 안에 있습니다. 걸을 수 있는 자바 프레임이 있으면 폴링 없이 safe로 세고, 세이프포인트 중에도 native 코드는 계속 돌 수 있어요. 자바로 돌아오려 하면 스톱에서 멈춥니다.` },
  { id: "sleeper", name: "열차 sleeper", concept: byName.sleeper.runs, text: "잠든 스레드는 이미 blocked라 검사 한 번에 safe입니다. 고임목은 sleep 타이머이고, 세이프포인트 중에 깨어나도 스톱 앞에서 다시 멈춰요." },
  { id: "waiter", name: "열차 waiter", concept: byName.waiter.runs, text: "모니터의 notify를 기다리는 스레드도 blocked라 검사 한 번에 safe입니다. 고임목은 모니터 대기이고, 세이프포인트가 이 대기를 깨우지는 않아요." },
  { id: "carriage", name: "검사 캐리지", concept: "examine_state_of_thread()", text: `VM 스레드가 목록 순서대로 한 스레드씩 상태를 읽습니다. 1회차는 전부, 그 뒤로는 아직 running인 스레드만 back_off 하며 다시 봐요. 1회차가 끝났을 때 남은 수가 initial_running ${M.INITIAL_RUNNING}입니다.` },
  { id: "flags", name: "깃발", concept: "_safepoint_safe", text: `VM 스레드가 safe로 센 스레드마다 하나씩 섭니다. 그린 ${M.THREADS.length}개와 그리지 않은 ${M.OTHER_THREADS}개가 모두 safe여야 synchronized가 되고, 이 실행에서 여기까지(Reaching safepoint) ${T.reaching} ns가 걸렸어요. 끝나면 restart()로 모두 내려갑니다.` },
  { id: "crane", name: "갠트리 크레인", concept: `VM 작업 ${M.VM_OP}`, text: `모든 스레드가 멈춘 동안에만 도는 작업입니다. cleanup ${T.cleanup} ns 뒤에 시작하고, 이 작업과 disarm을 합친 At safepoint 구간이 ${T.atSafepoint} ns였어요. 세이프포인트 전체는 ${T.total} ns였습니다(실행 1회 값).` },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";
// 같은 data-sel을 단 노드가 한 묶음이다. 떨어져 그려지는 부품(차고 뒤 기둥과 앞 기둥)은 같은 id로 여러 번 감싼다.
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 340;
const PLATE = { x: -168, y: -88, w: 312, d: 168, r: 9 };
const PLATE_H = 10;
const FOOT_H = 5;

const LANE_Y = [-54, -30, -6, 18, 42]; // compiled, interp, native, sleeper, waiter (목록 순서, 뒤에서 앞으로)
const BED_X = [-84, 116];
const BED_HALF = 8.6;
const BED_TOP = 2.4;
const RAIL_OFF = 4.9;
const RAIL_D = 1.6;
const RAIL_TOP = 4.2;
const X_TRIP = 46; // 트립 스톱 줄
const STOP = { x: X_TRIP - 2, w: 4, dy: -8, d: 1.6 }; // 뒤 레일 바깥, 선로 바닥 위
const STOP_H = 10;

// 열차: 앞이 x = 0, 뒤로 44
const TRAIN_L = 48;
const X_RUN = 16; // 달리는 중 (앞 위치)
const X_POLL = X_TRIP - 3.5; // 스톱 앞에 멈춤
const X_GO = 88; // 다시 달림
const X_NATIVE = 34; // 차고 안
const X_PARK = 12; // 고임목 앞
const AT_X = { run: X_RUN, poll: X_POLL, resumed: X_GO, native: X_NATIVE, parked: X_PARK };
const SHED = { x0: -20, x1: 38, y0: LANE_Y[2] - 12, y1: LANE_Y[2] + 12, z: 24 };
const CHOCK_X = X_PARK + 4;

// 검사 레일과 깃발
const CAR_X = -99; // 캐리지 중심 x
const CAR_RAIL = { x: CAR_X - 3, y: -72, w: 6, d: 124, r: 1 };
const CAR_PARK = -66; // arm 전과 disarm 뒤의 자리
const FLAG_X = -77;
const FLAG_Y = LANE_Y.map((y) => y - 12);
const FLAG_DOWN = 0;
const FLAG_UP = 10;

// 신호소와 상태 레버
const BOX = { x: -158, y: -22, w: 36, d: 40, r: 2 };
const BOX_FRONT = BOX.y + BOX.d; // +y 면
const LEVER_X = [-148, -139, -130]; // not_synchronized, synchronizing, synchronized
const LEVER_Z = 15;

// 크레인
const CRANE_Y = [-76, 62];
const CRANE_RAIL_X = [-48, 134];
const CRANE_PARK = 118;
const CRANE_FAR = -32;
const BEAM_Z = 46;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [BOX.x, BOX.y, 42], [CRANE_PARK, CRANE_Y[0] - 3, BEAM_Z + 10], [CRANE_PARK, CRANE_Y[1] + 3, BEAM_Z + 10]],
  WIDTH,
  HEIGHT,
  { pad: 20, azimuth: 58, elevation: 36 },
);
const CAM = k.cameraOf(P);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
// 수직면 위 닫힌 사각 테두리: y = const 면과 x = const 면
const yRect = (x0, x1, y, z0, z1) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);
const xRect = (x, y0, y1, z0, z1) => k.pathOf([at([x, y0, z0]), at([x, y1, z0]), at([x, y1, z1]), at([x, y0, z1])], true);
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;

// ---- 베이스 ----
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // 라벨판: 규칙선 3줄은 인쇄된 글자를 뜻한다 (free)
  const label = { x: -154, y: 66, w: 44, d: 10, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([32, 24, 28].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.8 + i * 2.1], [label.x + 4 + w, label.y + 2.8 + i * 2.1], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3, label.y + 2.6, 0.8]), at([label.x + label.w - 3, label.y + label.d - 2.6, 0.8])], { size: 0.45 }));
  // 눈금 띠: 선로 방향 눈금, 트립 스톱 줄(X_TRIP)이 0 눈금
  const strip = box(BED_X[0], 70, BED_X[1], 73.6, 0.6);
  out.push(S(k.slabOf(strip, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const minor = [];
  const major = [];
  for (let i = -38; i <= 24; i++) {
    const x = X_TRIP + i * 4;
    if (i === 0 || x < strip.x + 2 || x > strip.x + strip.w - 2) continue;
    (i % 5 === 0 ? major : minor).push(k.lineOnTop([x, strip.y + 0.2], [x, strip.y + (i % 5 === 0 ? 2.4 : 1.3)], 0.6, P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  out.push(L(k.lineOnTop([X_TRIP, strip.y + 0.2], [X_TRIP, strip.y + strip.d - 0.2], 0.6, P), { tone: "hi" }));
  out.push(D([at([strip.x + 1.2, strip.y + 1.8, 0.6]), at([strip.x + strip.w - 1.2, strip.y + 1.8, 0.6])], { size: 0.4 }));
  return out.join("");
}

function craneRail(y) {
  const out = [S(k.slabOf(box(CRANE_RAIL_X[0], y - 1.2, CRANE_RAIL_X[1], y + 1.2, 0.4), 0, 2, P, 2, 0.3), { tone: "mid" })];
  out.push(D([CRANE_RAIL_X[0] + 8, 20, 80, CRANE_RAIL_X[1] - 8].map((x) => at([x, y, 2])), { size: 0.4, tone: "lo" }));
  for (const x of [CRANE_RAIL_X[0] - 4, CRANE_RAIL_X[1]]) {
    out.push(S(k.slabOf(box(x, y - 2.6, x + 4, y + 2.6, 0.6), 0, 4.4, P, 2, 0.4), { tone: "mid" }));
    out.push(D([at([x + 2, y - 1.4, 4.4]), at([x + 2, y + 1.4, 4.4])], { size: 0.4 }));
  }
  return out.join("");
}

// ---- 신호소 (VM 스레드)와 상태 레버 ----
function signalBox() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BOX, 0, 8, P)}"/>`];
  const plinth = k.insetPlan(BOX, -2);
  out.push(S(k.slabOf(plinth, 0, 6, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(plinth, 2.4, P, 4), { tone: "faint" }) }));
  out.push(D(k.corners(plinth, 2.4).map(([x, y]) => at([x, y, 6])), { size: 0.45 }));
  out.push(S(k.slabOf(BOX, 6, 30, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(BOX, 20, P, 4), { tone: "faint" }) }));
  // 창: 앞(+y) 셋, 오른쪽(+x) 둘, 띠 위
  for (const x of [-153, -142, -131]) out.push(L(yRect(x, x + 8, BOX_FRONT, 23, 32), { tone: "lo" }), L(yRect(x + 1.2, x + 6.8, BOX_FRONT, 24.2, 30.8), { tone: "faint" }));
  for (const y of [-16, 0]) out.push(L(xRect(BOX.x + BOX.w, y, y + 10, 23, 32), { tone: "lo" }), L(xRect(BOX.x + BOX.w, y + 1.2, y + 8.8, 24.2, 30.8), { tone: "faint" }));
  const roof = k.insetPlan(BOX, -3.4);
  out.push(S(k.slabOf(roof, 36, 3, P, 4, 0.8), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(roof, 4), 39, P, 4), { tone: "faint" }));
  out.push(S(k.slabOf(box(-145, -7, -135, 3, 1), 39, 3, P, 3, 0.4), { tone: "mid" }));
  // 널링 노브: 받침 앞 턱 위
  const knob = [-157, BOX_FRONT + 1];
  out.push(S(k.cylinder(knob[0], knob[1], 2.4, 6, 1.4, P, 20), { tone: "mid" }));
  out.push(S(k.cylinder(knob[0], knob[1], 1.8, 7.4, 3.6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(knob[0], knob[1], 1.8, 7.4, 11, 16, P), { tone: "lo" }));
  return out.join("");
}

// 레버 패널: 앞면(+y)에 붙은 판, 홈과 세 칸 눈금 (손잡이는 따로 움직인다)
function leverPanel() {
  const out = [];
  const panel = box(LEVER_X[0] - 6, BOX_FRONT, LEVER_X[2] + 6, BOX_FRONT + 1.2, 0.3);
  out.push(S(k.slabOf(panel, LEVER_Z - 4, 8, P, 2, 0.3), { tone: "mid" }));
  out.push(L(yRect(LEVER_X[0] - 1.2, LEVER_X[2] + 1.2, BOX_FRONT + 1.2, LEVER_Z - 0.6, LEVER_Z + 0.6), { tone: "lo" }));
  // 칸 눈금: 패널 윗변에서 내려온다 (홈이 not_synchronized 칸, 강조)
  const ticks = LEVER_X.map((x, i) => [x, i]);
  out.push(L(ticks.slice(1).map(([x]) => k.segment([x, BOX_FRONT + 1.2, LEVER_Z + 4], [x, BOX_FRONT + 1.2, LEVER_Z + 2.2], P)).join(""), { tone: "mid" }));
  out.push(L(k.segment([LEVER_X[0], BOX_FRONT + 1.2, LEVER_Z + 4], [LEVER_X[0], BOX_FRONT + 1.2, LEVER_Z + 1.6], P), { tone: "hi" }));
  out.push(D([at([panel.x + 1.6, BOX_FRONT + 1.2, LEVER_Z + 2.6]), at([panel.x + panel.w - 1.6, BOX_FRONT + 1.2, LEVER_Z + 2.6]), at([panel.x + 1.6, BOX_FRONT + 1.2, LEVER_Z - 2.6]), at([panel.x + panel.w - 1.6, BOX_FRONT + 1.2, LEVER_Z - 2.6])], { size: 0.4 }));
  return out.join("");
}

function leverHandle() {
  const y0 = BOX_FRONT + 1.2;
  return [
    S(k.slabOf(box(-1, y0, 1, y0 + 2.6, 0.3), LEVER_Z - 0.5, 1, P, 2), { tone: "mid", crease: "none" }),
    S(k.slabOf(box(-2.2, y0 + 2.6, 2.2, y0 + 5, 0.8), LEVER_Z - 2.2, 4.4, P, 3, 0.4), { tone: "mid" }),
  ].join("");
}

// ---- 검사 레일과 캐리지 (VM 스레드의 검사) ----
function carriageRail() {
  const out = [S(k.slabOf(CAR_RAIL, 0, 3, P, 2, 0.4), { tone: "mid", inner: L(k.sideSeam(CAR_RAIL, 1.4, P, 2), { tone: "faint" }) })];
  out.push(L(k.lineOnTop([CAR_X, CAR_RAIL.y], [CAR_X, CAR_RAIL.y + CAR_RAIL.d], 3, P), { tone: "faint" }));
  for (const y of [CAR_RAIL.y - 4, CAR_RAIL.y + CAR_RAIL.d]) {
    out.push(S(k.slabOf(box(CAR_X - 4.4, y, CAR_X + 4.4, y + 4, 0.6), 0, 6, P, 2, 0.4), { tone: "mid" }));
    out.push(D([at([CAR_X - 2.4, y + 2, 6]), at([CAR_X + 2.4, y + 2, 6])], { size: 0.4 }));
  }
  // 손나사: 앞 멈춤쇠 옆면
  const ty = CAR_RAIL.y + CAR_RAIL.d + 4;
  out.push(S(k.slabOf(box(CAR_X - 0.8, ty, CAR_X + 0.8, ty + 1.6, 0.3), 2.4, 1.6, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(CAR_X, ty + 3, 2, 1.4, 4, P, 18), { tone: "mid" }));
  out.push(L(k.knurl(CAR_X, ty + 3, 2, 1.4, 5.4, 14, P), { tone: "lo" }));
  return out.join("");
}

function carriage() {
  const out = [];
  const body = box(CAR_X - 6, -5, CAR_X + 6, 5, 1);
  out.push(`<path class="iso-halo" d="${k.haloOf(body, 3, 1, P)}" style="opacity:.5"/>`);
  out.push(S(k.slabOf(body, 3, 7, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(body, 5.4, P, 3), { tone: "faint" }) }));
  out.push(D([at([body.x + 2, body.y + 2, 10]), at([body.x + 2, body.y + body.d - 2, 10])], { size: 0.4 }));
  // 포인터 팔: 선로 시작점을 가리킨다
  const arm = box(CAR_X + 6, -1, BED_X[0] - 4, 1, 0.3);
  out.push(S(k.slabOf(arm, 7, 1.6, P, 2, 0.3), { tone: "mid" }));
  return out.join("");
}

function pointerTip() {
  return S(k.cylinder(BED_X[0] - 4, 0, 1.6, 6, 3, P, 18), { tone: "mid" });
}

// ---- 깃발 (_safepoint_safe) ----
function flagPost(i) {
  const y = FLAG_Y[i];
  return [
    S(k.cylinder(FLAG_X, y, 2, 0, 1.2, P, 18), { tone: "lo" }),
    S(k.slabOf(box(FLAG_X - 0.7, y - 0.7, FLAG_X + 0.7, y + 0.7, 0.2), 1.2, 18, P, 2), { tone: "mid", crease: "none" }),
    S(k.cylinder(FLAG_X, y, 1, 19.2, 0.8, P, 14), { tone: "mid" }),
  ].join("");
}
function flagPlate(i) {
  const y = FLAG_Y[i];
  return S(k.slabOf(box(FLAG_X + 0.7, y - 0.4, FLAG_X + 8, y + 0.4, 0.2), 3, 5, P, 2), { tone: "mid" });
}

// ---- 선로 ----
function bed(i) {
  const y = LANE_Y[i];
  const plan = box(BED_X[0], y - BED_HALF, BED_X[1], y + BED_HALF, 0.6);
  const sleepers = [];
  for (let x = BED_X[0] + 4; x < BED_X[1] - 2; x += 8) sleepers.push(k.lineOnTop([x, y - BED_HALF], [x, y + BED_HALF], BED_TOP, P));
  return [
    S(k.slabOf(plan, 0, BED_TOP, P, 2, 0.4), { tone: "lo", inner: L(sleepers.join(""), { tone: "faint" }) }),
    sel("stops", L(k.planOutline(box(STOP.x - 0.4, y + STOP.dy - 0.4, STOP.x + STOP.w + 0.4, y + STOP.dy + STOP.d + 0.4, 0.3), BED_TOP, P, 2), { tone: "lo" })),
  ].join("");
}
const rail = (y) => S(k.slabOf(box(BED_X[0], y - RAIL_D / 2, BED_X[1], y + RAIL_D / 2, 0.2), BED_TOP, RAIL_TOP - BED_TOP, P, 2), { tone: "mid", crease: "lo" });
const stopPlan = (i) => box(STOP.x, LANE_Y[i] + STOP.dy, STOP.x + STOP.w, LANE_Y[i] + STOP.dy + STOP.d, 0.3);

function train(y) {
  const out = [];
  for (const x0 of [-44, -15]) {
    const plan = box(x0, y - 5.8, x0 + 11, y + 5.8, 0.6);
    out.push(S(k.slabOf(plan, RAIL_TOP, 2.4, P, 2, 0.3), { tone: "lo" }));
    out.push(L([x0 + 2.8, x0 + 8.2].map((x) => k.sideRing([x, y + 5.8, RAIL_TOP + 1.2], 1.2, "y", P, 16)).join(""), { tone: "mid" }));
  }
  out.push(S(k.slabOf(box(-TRAIN_L, y - 6.3, 0, y + 6.3, 0.6), RAIL_TOP + 2.4, 1.3, P, 2, 0.3), { tone: "lo" }));
  const body = box(-TRAIN_L + 1, y - 5.8, -1, y + 5.8, 1.2);
  const z0 = RAIL_TOP + 3.7;
  const windows = [-43, -36, -29, -22, -15].map((x) => yRect(x, x + 5, y + 5.8, z0 + 3.3, z0 + 6.5)).join("") + xRect(-1, y - 3.4, y + 3.4, z0 + 3.3, z0 + 6.7);
  out.push(`<g data-body>${S(k.slabOf(body, z0, 8.4, P, 3, 0.5), { tone: "hi", crease: "lo", inner: L(k.sideSeam(body, z0 + 1.8, P, 3), { tone: "faint" }) })}</g>`);
  out.push(L(windows, { tone: "lo" }));
  const roof = k.insetPlan(body, 0.8);
  out.push(S(k.slabOf(roof, z0 + 8.4, 1.5, P, 3, 0.4), { tone: "mid" }));
  out.push(L(k.lineOnTop([roof.x, y], [roof.x + roof.w, y], z0 + 9.9, P), { tone: "faint" }));
  for (const dy of [-4.2, 4.2]) out.push(S(k.slabOf(box(0, y + dy - 1, 1.8, y + dy + 1, 0.4), RAIL_TOP + 2.8, 1.8, P, 2), { tone: "mid", crease: "none" }));
  return out.join("");
}

function chock(y) {
  const plan = box(CHOCK_X, y - 6.4, CHOCK_X + 3, y + 6.4, 0.5);
  return [
    S(k.slabOf(plan, RAIL_TOP, 2.2, P, 2, 0.3), { tone: "mid" }),
    S(k.slabOf(box(CHOCK_X + 0.6, y - 1.2, CHOCK_X + 2.4, y + 1.2, 0.4), RAIL_TOP + 2.2, 1.6, P, 2), { tone: "mid" }),
    D([at([CHOCK_X + 1.5, y - 4.9, RAIL_TOP + 2.2]), at([CHOCK_X + 1.5, y + 4.9, RAIL_TOP + 2.2])], { size: 0.4 }),
  ].join("");
}

// 차고 (native 구간): 기둥 4개 위에 세로보 2개와 가로보 2개를 얹은 열린 틀. 지붕판이 없어 안의 열차가 보인다
const POST_TOP = SHED.z - 2.4;
const shedPost = (x, y) => {
  const plan = box(x - 1.2, y - 1.2, x + 1.2, y + 1.2, 0.3);
  return S(k.slabOf(plan, 0, POST_TOP, P, 2), { tone: "mid", crease: "none", inner: L(k.sideSeam(plan, 2, P, 2), { tone: "faint" }) });
};
function shedSide(y) {
  const plan = box(SHED.x0 - 1.6, y - 1.4, SHED.x1 + 1.6, y + 1.4, 0.4);
  return [
    shedPost(SHED.x0, y),
    shedPost(SHED.x1, y),
    S(k.slabOf(plan, POST_TOP, 2.4, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(plan, POST_TOP + 1.2, P, 2), { tone: "faint" }) }),
    D([SHED.x0, SHED.x1].map((x) => at([x, y, SHED.z])), { size: 0.4 }),
  ].join("");
}
function shedTies() {
  return [SHED.x0, SHED.x1].map((x) => {
    const plan = box(x - 1.4, SHED.y0 - 1.8, x + 1.4, SHED.y1 + 1.8, 0.4);
    return S(k.slabOf(plan, SHED.z, 1.8, P, 2, 0.3), { tone: "mid" }) + D([at([x, SHED.y0, SHED.z + 1.8]), at([x, SHED.y1, SHED.z + 1.8])], { size: 0.4 });
  }).join("");
}

// ---- 크레인 (VM 작업). 정지 위치(CRANE_PARK)에서 만들어 x로 옮긴다 ----
function craneTruck(y) {
  const x = CRANE_PARK;
  const plan = box(x - 9, y - 2.4, x + 9, y + 2.4, 0.8);
  return [
    S(k.slabOf(plan, 2, 4.4, P, 2, 0.4), { tone: "mid" }),
    L([x - 5.5, x + 5.5].map((cx) => k.sideRing([cx, y + 2.4, 4.2], 1.6, "y", P, 18)).join(""), { tone: "lo" }),
  ].join("");
}
const craneLeg = (y) => S(k.slabOf(box(CRANE_PARK - 3, y - 1.6, CRANE_PARK + 3, y + 1.6, 0.6), 6.4, BEAM_Z - 6.4, P, 2, 0.4), { tone: "mid", inner: L(k.sideSeam(box(CRANE_PARK - 3, y - 1.6, CRANE_PARK + 3, y + 1.6, 0.6), 24, P, 2), { tone: "faint" }) });
function craneBeam() {
  const plan = box(CRANE_PARK - 4, CRANE_Y[0] - 3, CRANE_PARK + 4, CRANE_Y[1] + 3, 0.8);
  const out = [`<g data-beam>${S(k.slabOf(plan, BEAM_Z, 5, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(plan, BEAM_Z + 2, P, 3), { tone: "faint" }) })}</g>`];
  out.push(D([CRANE_Y[0], CRANE_Y[1]].map((y) => at([CRANE_PARK, y, BEAM_Z + 5])), { size: 0.45 }));
  const trolley = box(CRANE_PARK - 5.4, -10, CRANE_PARK + 5.4, 4, 1);
  out.push(S(k.slabOf(trolley, BEAM_Z + 5, 4, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(trolley, BEAM_Z + 6.6, P, 3), { tone: "faint" }) }));
  out.push(D([at([trolley.x + 2, trolley.y + 2, BEAM_Z + 9]), at([trolley.x + trolley.w - 2, trolley.y + trolley.d - 2, BEAM_Z + 9])], { size: 0.4 }));
  return out.join("");
}
function craneWheel() {
  const [x, y] = [CRANE_PARK + 6, CRANE_Y[1]];
  return [
    S(k.cylinder(x, y, 1, 6.4, 1.6, P, 12), { tone: "mid", crease: "none" }),
    S(k.cylinder(x, y, 3, 8, 1.4, P, 28), { tone: "mid" }),
    L(k.knurl(x, y, 3, 8, 9.4, 22, P), { tone: "lo" }),
  ].join("");
}

// ---- 그림 조립 (뒤에서 앞으로, 아래에서 위로) ----
const trainSvg = (i) => groupAt([AT_X[M.THREADS[i].at], 0, 0], train(LANE_Y[i]), ` data-part="train-${i}" data-sel="${NAMES[i]}"`);
const stopSvg = (i) => `<g data-sel="stops"><g data-part="stop-${i}"></g></g>`;
const flagSvg = (i) => sel("flags", flagPost(i), groupAt([0, 0, FLAG_DOWN], flagPlate(i), ` data-part="flag-${i}"`));

function lane(i) {
  const y = LANE_Y[i];
  const out = [flagSvg(i)];
  if (NAMES[i] === "native") out.push(sel("native", shedSide(SHED.y0)));
  out.push(bed(i), stopSvg(i), rail(y - RAIL_OFF), rail(y + RAIL_OFF), trainSvg(i));
  if (M.THREADS[i].at === "parked") out.push(sel(NAMES[i], chock(y)));
  if (NAMES[i] === "native") out.push(sel("native", shedSide(SHED.y1), shedTies()));
  return out.join("");
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `세이프포인트를 철도 야드로 옮긴 기계. 왼쪽 신호소가 VM 스레드이고, 선로 ${M.THREADS.length}줄에 스레드마다 열차가 하나씩 있다. 레버를 당기면 모든 선로의 트립 스톱이 올라오고, 달리던 열차는 스톱 앞에서 멈추며, 차고 안 열차와 고임목 앞 열차는 그대로 있다. 검사 캐리지가 선로를 하나씩 보며 안전한 선로마다 깃발을 세우고, 깃발이 모두 서면 갠트리 크레인이 야드를 오간 뒤 스톱이 내려간다.`,
  body: [
    base(),
    craneRail(CRANE_Y[0]),
    sel("crane", groupAt([0, 0, 0], craneTruck(CRANE_Y[0]) + craneLeg(CRANE_Y[0]), ` data-part="crane-back"`)),
    sel("box", signalBox()),
    sel("lever", leverPanel(), groupAt([LEVER_X[0], 0, 0], leverHandle(), ` data-part="lever"`)),
    sel("carriage", carriageRail(), groupAt([0, CAR_PARK, 0], carriage() + pointerTip(), ` data-part="carriage"`)),
    ...LANE_Y.map((_, i) => lane(i)),
    craneRail(CRANE_Y[1]),
    sel("crane", groupAt([0, 0, 0], craneTruck(CRANE_Y[1]) + craneLeg(CRANE_Y[1]) + craneWheel() + craneBeam(), ` data-part="crane-front"`)),
  ],
});

const CFG = {
  P, NAMES, LANE_Y, AT_X, STOP_H, BED_TOP,
  STOPS: LANE_Y.map((_, i) => stopPlan(i)),
  CAR_PARK, FLAG_DOWN, FLAG_UP, LEVER_X,
  PHASE_AT: { not_synchronized: 0, synchronizing: 1, synchronized: 2 },
  CRANE_PARK, CRANE_FAR, INIT_STEPS,
  STEP_SECONDS: 1.0, VMOP_SECONDS: 2.2, TOUR_GAP: 1.0, TOUR_REST: 1.6, RESUME: 6,
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
  lever: q('[data-part="lever"]'), carriage: q('[data-part="carriage"]'),
  craneBack: q('[data-part="crane-back"]'), craneFront: q('[data-part="crane-front"]'),
  trains: C.NAMES.map((_, i) => q('[data-part="train-' + i + '"]')),
  stops: C.NAMES.map((_, i) => q('[data-part="stop-' + i + '"]')),
  flags: C.NAMES.map((_, i) => q('[data-part="flag-' + i + '"]')),
};
// lit 후보: 상태마다 정확히 하나만 data-lit을 단다
const litOf = {
  lever: el.lever.querySelectorAll(".iso-solid")[1],
  carriage: el.carriage.querySelector(".iso-solid"),
  crane: el.craneFront.querySelector("[data-beam] .iso-solid"),
};
C.NAMES.forEach((name, i) => (litOf[name] = el.trains[i].querySelector("[data-body] .iso-solid")));
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
const lerp = (a, b, t) => a + (b - a) * t;

function initial() { let s = MODEL.makeState(); for (let i = 0; i < C.INIT_STEPS; i++) s = MODEL.step(s); return s; }
let state = initial();
let anim = null; // { from, to, kind, t }

// 정지 자세: 상태 하나로 정해진다
function litFor(s) {
  const l = s.last;
  if (!l || l.op === "arm" || l.op === "disarm") return "lever";
  if (l.op === "block") return l.thread;
  if (l.op === "check") return "carriage";
  return "crane";
}
function rest(s) {
  return {
    lever: C.PHASE_AT[s.phase],
    stop: s.armed ? 1 : 0,
    trains: s.threads.map((t) => C.AT_X[t.at]),
    fade: s.threads.map(() => 1),
    car: s.looked ? C.LANE_Y[C.NAMES.indexOf(s.looked)] : C.CAR_PARK,
    flags: s.threads.map((t) => (t.safe ? 1 : 0)),
    crane: C.CRANE_PARK,
    lit: litFor(s),
  };
}

// 전이 자세: 직전 상태에서 다음 상태로, u = 0..1
function between(a, b, u, kind) {
  if (u >= 1) return rest(b);
  const p = rest(a), q2 = rest(b);
  const mix = (key, t) => (Array.isArray(p[key]) ? p[key].map((v, i) => lerp(v, q2[key][i], t)) : lerp(p[key], q2[key], t));
  const out = { ...p, lit: q2.lit };
  if (kind === "rewind") {
    out.lever = mix("lever", seg(u, 0, 0.4));
    out.car = mix("car", seg(u, 0, 0.6));
    // 다시 달리던 열차는 사라졌다가 출발점에 다시 나타난다
    out.fade = p.trains.map((x, i) => (x === q2.trains[i] ? 1 : u < 0.5 ? 1 - seg(u, 0, 0.45) : seg(u, 0.55, 1)));
    out.trains = p.trains.map((x, i) => (u < 0.5 ? x : q2.trains[i]));
    return out;
  }
  const op = b.last.op;
  if (op === "arm") {
    out.lever = mix("lever", seg(u, 0, 0.35));
    out.stop = mix("stop", seg(u, 0.3, 0.8));
  } else if (op === "block") {
    out.trains = mix("trains", seg(u, 0, 0.85));
  } else if (op === "check") {
    out.car = mix("car", seg(u, 0, 0.55));
    out.flags = mix("flags", seg(u, 0.6, 0.9));
    out.lever = mix("lever", seg(u, 0.7, 1));
  } else if (op === "vmop") {
    out.crane = u < 0.5 ? lerp(C.CRANE_PARK, C.CRANE_FAR, seg(u, 0, 0.5)) : lerp(C.CRANE_FAR, C.CRANE_PARK, seg(u, 0.5, 1));
  } else if (op === "disarm") {
    out.lever = mix("lever", seg(u, 0, 0.3));
    out.stop = mix("stop", seg(u, 0.2, 0.5));
    out.flags = mix("flags", seg(u, 0.2, 0.5));
    out.car = mix("car", seg(u, 0.25, 0.75));
    out.trains = mix("trains", seg(u, 0.45, 1));
  }
  return out;
}

function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }
const stopShown = C.NAMES.map(() => -1);
let litShown = null;
function draw(pose) {
  put(el.lever, [C.LEVER_X[0] + (C.LEVER_X[1] - C.LEVER_X[0]) * pose.lever, 0, 0]);
  const h = Math.round(pose.stop * C.STOP_H * 20) / 20;
  C.STOPS.forEach((plan, i) => {
    if (stopShown[i] === h) return;
    stopShown[i] = h;
    el.stops[i].innerHTML = h < 0.05 ? "" : solidSvg(slabOf(plan, C.BED_TOP, h, P, 2, 0.3), { tone: "hi", crease: "lo" });
  });
  pose.trains.forEach((x, i) => {
    put(el.trains[i], [x, 0, 0]);
    el.trains[i].style.opacity = pose.fade[i] < 1 ? pose.fade[i].toFixed(3) : "";
  });
  put(el.carriage, [0, pose.car, 0]);
  pose.flags.forEach((f, i) => put(el.flags[i], [0, 0, C.FLAG_DOWN + (C.FLAG_UP - C.FLAG_DOWN) * f]));
  put(el.craneBack, [pose.crane - C.CRANE_PARK, 0, 0]);
  put(el.craneFront, [pose.crane - C.CRANE_PARK, 0, 0]);
  if (pose.lit !== litShown) {
    litShown = pose.lit;
    Object.entries(litOf).forEach(([key, node]) => node.toggleAttribute("data-lit", key === pose.lit));
  }
}

function say() {
  const text = MODEL.readout(state);
  if (readoutEl.textContent !== text) readoutEl.textContent = text;
  return text;
}

// 루프
let frame = 0, last = 0, visible = false, touring = !still.matches, wait = C.TOUR_REST, idleTimer = 0;
function begin(from, to, kind = "step") {
  anim = { from, to, kind, t: 0, span: to.last && to.last.op === "vmop" ? C.VMOP_SECONDS : C.STEP_SECONDS };
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
    anim.t += dt / anim.span;
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
  if (pinSel && !event.target.closest(".sp-parts, .iso-stage")) { pinSel = null; choose(); }
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
].join("\n");

const css = `<style>
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:118%;margin:0 -9%}}
.sp-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.sp-parts{display:flex;flex-wrap:wrap;gap:6px}
.sp-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.sp-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.sp-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.sp-parts button[data-picked] span{color:var(--anatomy-strong)}
.sp-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.sp-note{min-height:4.6em;color:var(--anatomy-text)}
.sp-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="sp-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="sp-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 7",
    title: "세이프포인트 신호 야드",
    hint: "클릭이나 → 한 동작, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [{ mark: "lit", label: "방금 움직인 부품: 레버, 멈추는 열차, 검사 캐리지, 크레인 빔 중 하나" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="세이프포인트 신호 야드. 클릭, 오른쪽 화살표, 스페이스로 세이프포인트의 다음 동작 하나를 실행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="sp-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "세이프포인트 신호 야드", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
