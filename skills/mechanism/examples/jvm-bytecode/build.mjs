// node build.mjs [--light]: 바이트코드 테이프 리더 (flowcast:mechanism 예제, 합성)
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
const NAME = "jvm-bytecode";
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
const LOCALS = M.makeState().locals; // 서랍 디스크 값
const CONST_VALUE = TRACE.find((s) => s.moved && s.moved.from === "const").moved.value; // 호퍼 디스크 값
const INIT_STEPS = 2; // 처음 보여줄 상태: 튜브가 max_stack까지 찬 순간 (trace[2])

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const opsWhere = (test) => TRACE.filter((s) => s.moved && test(s.moved)).map((s) => s.last.op);
const LOAD_OPS = opsWhere((m) => m.to === "stack" && m.from !== "stack");
const MATH_OPS = opsWhere((m) => m.from === "stack" && m.to === "stack");
const RETURN_OPS = opsWhere((m) => m.to === "caller");
const CONST_OP = M.CODE.find((c) => c.op === TRACE.find((s) => s.moved && s.moved.from === "const").last.op);
const hex = (b) => b.toString(16).padStart(2, "0");
const PARTS = [
  { id: "tape", name: "천공 테이프", concept: "Code 배열", text: `javac가 메서드 본문을 컴파일한 바이트 배열입니다. 칸 하나가 1바이트이고, 구멍 뚫린 자리가 1인 비트예요. 이 메서드는 ${M.CODE.length}바이트(${M.CODE.map((c) => hex(c.byte)).join(" ")})입니다.` },
  { id: "head", name: "리더 헤드", concept: "pc", text: "지금 실행하는 명령이 Code 배열의 몇 번째 바이트인지 가리킵니다. 헤드는 제자리에 있고, 명령을 하나 실행할 때마다 테이프가 그 길이만큼 지나가요." },
  { id: "locals", name: "서랍", concept: "지역 변수 배열", text: `호출하는 순간 인자가 0번 슬롯부터 채워집니다(a = ${LOCALS[0]}, b = ${LOCALS[1]}). 서랍 ${M.MAX_LOCALS}칸은 javac가 정한 max_locals이고, 값을 꺼내 가도 서랍의 디스크는 그대로 남아요.` },
  { id: "const", name: "호퍼", concept: "명령에 든 상수", text: `${CONST_OP.op}는 값 ${CONST_VALUE}를 명령 1바이트(0x${hex(CONST_OP.byte)})에 담고 있습니다. 메모리 영역이 아니라 명령이 값을 직접 갖고 있다는 뜻이에요.` },
  { id: "arm", name: "픽업 암", concept: LOAD_OPS.join(", "), text: "서랍이나 호퍼의 값을 복사해 스택 맨 위에 올립니다. 원본은 제자리에 두고 사본만 옮겨요." },
  { id: "stack", name: "튜브", concept: "피연산자 스택", text: `계산은 모두 이 스택을 거칩니다. 마지막에 넣은 값이 먼저 나와요. 높이 ${M.MAX_STACK}장은 javac가 정한 max_stack이고, 클래스를 로드할 때 검증기가 넘지 않는지 확인합니다.` },
  { id: "press", name: "프레스", concept: MATH_OPS.join(", "), text: "스택 위의 두 값을 꺼내 계산하고 결과 하나를 다시 올립니다. 결과는 32비트로 감겨서, 넘쳐도 예외 없이 값이 돌아가요." },
  { id: "tray", name: "슈트와 트레이", concept: RETURN_OPS.join(", "), text: "스택 맨 위 값을 꺼내 호출한 쪽 프레임의 스택(트레이)으로 넘기고, 이 프레임을 버립니다." },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";
// 같은 data-sel을 단 노드가 한 묶음이다. 떨어져 그려지는 부품(튜브 뒤와 앞)은 같은 id로 여러 번 감싼다.
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;
if (TRACE[INIT_STEPS].stack.length !== M.MAX_STACK) throw new Error("initial pose should show a full stack");

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 380;
const PLATE = { x: -166, y: -54, w: 244, d: 168, r: 9 };
const PLATE_H = 10;
const FOOT_H = 5;

const DR = 9.5; // 디스크 반지름
const DH = 8; // 디스크 두께 = 슬롯 한 칸
const TB = 6; // 튜브 받침판 윗면
const SLOT_Z = Array.from({ length: M.MAX_STACK }, (_, i) => TB + i * DH);
const POST = 11; // 튜브 기둥 중심 (±POST, ±POST)
const POST_W = 2.4;
const CAGE_TOP = TB + M.MAX_STACK * DH + 2; // 기둥 꼭대기
const BAR_H = 3;

const DRAWER_X = Array.from({ length: M.MAX_LOCALS }, (_, i) => -112 + i * 28);
const DRAWER_FLOOR = 6;
const DRAWER_DISC = 7.5; // 서랍 디스크 바닥 z
const HOPPER_X = -46;
const HOPPER_DISC = 12;

const RAIL_Z = 66; // 갠트리 빔 바닥
const CAR_Z = 58; // 캐리지 바닥
const ARM_PARK = -24;
const PRESS_PARK = 32;
const TRAVEL = CAGE_TOP + BAR_H + 3; // 옮기는 디스크 바닥 높이
const GRIP_TRAVEL = TRAVEL + DH;
const PLATE_REST = CAGE_TOP + BAR_H + 4;
const PLATE_R = 8;
const PLATE_T = 3;
const ROD_TOP = CAR_Z - 4;

const TRAY = { x: -13, y: 27, w: 26, d: 21, r: 3 };
const TRAY_TOP = 4;
const CHUTE = { x: -12, y: 15, w: 24, d: 12, r: 1 };

const CELL = 15;
const HX = -36; // 리더 헤드 x
const BED = { x: -156, y: 54, w: 214, d: 42, r: 2 };
const BED_TOP = 3;
const TAPE_Y0 = 58;
const TAPE_D = 34;
const TAPE_T = 1;
const TAPE_TOP = BED_TOP + TAPE_T;
const GUIDE_IN = [-140, 52]; // 이 x 바깥의 테이프는 가이드 밑으로 들어간다
const TAPE_LOCAL = [-180, 104];
const PITCH = 3.4; // 채널 간격
const channelY = (j) => TAPE_Y0 + TAPE_D - 3.4 - j * PITCH; // j=0이 앞 가장자리
const bitChannel = (bit) => (bit < 3 ? bit : bit + 1); // 이송 구멍은 3번 채널 자리

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-158, -3, RAIL_Z + 7], [64, 3, RAIL_Z + 7], [HX, 105, 47], [PLATE.x + PLATE.w, PLATE.y + PLATE.d, 0]],
  WIDTH,
  HEIGHT,
  { pad: 22, azimuth: 58 },
);
const CAM = k.cameraOf(P);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
// 수직면 위 닫힌 사각 테두리 (y = const 면)
const frontRect = (x0, x1, y, z0, z1) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);

// ---- 디스크와 표시창 ----
let clipCount = 0;
// 보는 사람을 정면으로 향한 평면: u는 화면 가로, v는 아래
function viewerMatrix(point) {
  const [ox, oy] = at(point);
  return `matrix(${CAM.k.toFixed(4)} 0 0 ${(CAM.k * CAM.cosE).toFixed(4)} ${ox.toFixed(2)} ${oy.toFixed(2)})`;
}
// 표시창은 정면점에서 화면 왼쪽으로 조금 옮긴다: 튜브 오른쪽 앞 기둥이 두 자리 값을 가리지 않게
const WIN = { w: 8.4, h: 5.6, u: -1.8 };
function disc(value, { part = "", lit = false } = {}) {
  // 쉬는 디스크는 mid, 움직이는 디스크 하나만 lit (data-lit은 live 코드가 바꾼다)
  const front = [DR * CAM.cosA, DR * CAM.sinA, DH / 2];
  const id = `bc-clip-${clipCount++}`;
  const [x0, x1] = [WIN.u - WIN.w / 2, WIN.u + WIN.w / 2];
  const rect = `M${x0} ${-WIN.h / 2}H${x1}V${WIN.h / 2}H${x0}Z`;
  const text = value === null ? "" : String(value);
  return [
    S(k.cylinder(0, 0, DR, 0, DH, P, 44, 0.5), { tone: lit ? "hi" : "mid", crease: "lo", lit, inner: L(k.ring(0, 0, DR - 2.4, DH, P, 36), { tone: "faint" }) }),
    `<g transform="${viewerMatrix(front)}"><clipPath id="${id}"><path d="${rect}"/></clipPath>`,
    `<path class="iso-line bc-win" data-tone="lo" d="${rect}"/>`,
    `<text class="bc-digit"${part ? ` data-digit="${part}"` : ""} clip-path="url(#${id})" x="${WIN.u}" y="1.75" font-size="4.6" text-anchor="middle">${text}</text></g>`,
  ].join("");
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
  const label = { x: 18, y: 99, w: 44, d: 9, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([30, 22, 26].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.6 + i * 1.9], [label.x + 4 + w, label.y + 2.6 + i * 1.9], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3, label.y + 2.4, 0.8]), at([label.x + label.w - 3, label.y + label.d - 2.4, 0.8])], { size: 0.45 }));
  return out.join("");
}

// ---- 갠트리 기둥 (빔은 캐리지 뒤에 그린다) ----
function gantryPost(x) {
  const out = [];
  const foot = box(x - 8, -10, x + 8, 10, 1.5);
  out.push(S(k.slabOf(foot, 0, 4, P, 3, 0.5), { tone: "mid" }));
  out.push(D([at([x - 5, -7, 4]), at([x + 5, -7, 4]), at([x - 5, 7, 4]), at([x + 5, 7, 4])], { size: 0.45 }));
  out.push(S(k.slabOf(box(x - 3, -4, x + 3, 4, 0.8), 4, RAIL_Z - 4, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(box(x - 3, -4, x + 3, 4, 0.8), 30, P, 3), { tone: "faint" }) }));
  // 손나사: 받침 위, 기둥 앞
  out.push(S(k.slabOf(box(x - 1.2, 4, x + 1.2, 6.4, 0.5), 5, 3, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(x, 7.6, 2.4, 4, 5.5, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(x, 7.6, 2.4, 4, 9.5, 18, P), { tone: "lo" }));
  return out.join("");
}

function beam() {
  const plan = box(-158, -3, 62, 3, 0.8);
  const out = [S(k.slabOf(plan, RAIL_Z, 6, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, RAIL_Z + 2, P, 3), { tone: "faint" }) })];
  for (const x of [-160, 62]) out.push(S(k.slabOf(box(x, -3.6, x + 2, 3.6, 0.5), RAIL_Z - 0.6, 7.2, P, 2), { tone: "mid" }));
  out.push(D([-150, -100, -50, 0, 50].map((x) => at([x, 0, RAIL_Z + 6])), { size: 0.4, tone: "lo" }));
  return out.join("");
}

// ---- 서랍장 (locals) ----
function cabinet() {
  const out = [];
  const body = box(-130, -42, -66, -14, 2);
  out.push(`<path class="iso-halo" d="${k.haloOf(body, 0, 6, P)}"/>`);
  // 위쪽 띠 이음선 (모서리를 감싸 실루엣에서 끝난다)
  out.push(S(k.slabOf(body, 0, 26, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(body, 15, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(body, 3), 26, P, 4), { tone: "faint" }));
  out.push(D([at([body.x + 4, body.y + 4, 26]), at([body.x + body.w - 4, body.y + 4, 26]), at([body.x + 4, body.y + body.d - 4, 26]), at([body.x + body.w - 4, body.y + body.d - 4, 26])], { size: 0.45 }));
  // 서랍 구멍 테두리 (앞면, 닫힌 선) 와 띠 위 나사
  for (const x of DRAWER_X) out.push(L(frontRect(x - 13.4, x + 13.4, -14, 4.6, 11), { tone: "lo" }));
  out.push(D([at([body.x + 4, -14, 20.5]), at([body.x + body.w - 4, -14, 20.5])], { size: 0.45, tone: "mid" }));
  DRAWER_X.forEach((x, slot) => out.push(drawer(x, slot)));
  return out.join("");
}

function drawer(x, slot) {
  const out = [];
  out.push(S(k.slabOf(box(x - 13, -14, x + 13, 10, 0.8), 5, DRAWER_DISC - 5, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf(box(x - 13, -14, x - 11.6, 10, 0.4), DRAWER_DISC, 2.5, P, 2), { tone: "mid" }));
  out.push(`<g data-source="local-${slot}">${groupAt([x, 0, DRAWER_DISC], disc(LOCALS[slot]))}</g>`);
  out.push(S(k.slabOf(box(x + 11.6, -14, x + 13, 10, 0.4), DRAWER_DISC, 2.5, P, 2), { tone: "mid" }));
  // 앞판과 손잡이
  out.push(S(k.slabOf(box(x - 14, 10, x + 14, 12.4, 0.8), 4.2, DRAWER_DISC + 0.5 - 4.2, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(box(x - 6, 12.4, x - 4, 15, 0.5), 5.4, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(box(x + 4, 12.4, x + 6, 15, 0.5), 5.4, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(box(x - 7, 15, x + 7, 17, 1), 5.4, 2, P, 3), { tone: "mid" }));
  return out.join("");
}

// ---- 호퍼 (iconst_2) ----
function hopper() {
  const out = [];
  const foot = box(HOPPER_X - 14, -40, HOPPER_X + 14, 11, 2);
  out.push(`<path class="iso-halo" d="${k.haloOf(foot, 0, 6, P)}"/>`);
  out.push(S(k.slabOf(foot, 0, HOPPER_DISC, P, 3, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(box(HOPPER_X - 11.5, -11.5, HOPPER_X + 11.5, 9, 1.5), HOPPER_DISC, P, 3), { tone: "faint" }));
  const bin = box(HOPPER_X - 12, -38, HOPPER_X + 12, -15, 2);
  out.push(S(k.slabOf(bin, HOPPER_DISC, 24, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(bin, HOPPER_DISC + 6, P, 3), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(bin, 2.4), HOPPER_DISC + 24, P, 3), { tone: "lo" }));
  // 투입구 안쪽 (위면 닫힌 선) 과 배출 슬롯 (앞면 닫힌 선)
  out.push(L(k.planOutline(k.insetPlan(bin, 5), HOPPER_DISC + 24, P, 3), { tone: "faint" }));
  out.push(L(frontRect(HOPPER_X - 9, HOPPER_X + 9, -15, HOPPER_DISC + 1.5, HOPPER_DISC + 4.5), { tone: "lo" }));
  out.push(D([at([bin.x + 3, bin.y + bin.d, HOPPER_DISC + 21]), at([bin.x + bin.w - 3, bin.y + bin.d, HOPPER_DISC + 21])], { size: 0.45 }));
  out.push(`<g data-source="const">${groupAt([HOPPER_X, 0, HOPPER_DISC], disc(CONST_VALUE))}</g>`);
  return out.join("");
}

// ---- 스택 튜브 ----
const postPlan = (sx, sy) => box(sx * POST - POST_W / 2, sy * POST - POST_W / 2, sx * POST + POST_W / 2, sy * POST + POST_W / 2, 0.4);
const postSvg = (sx, sy) => S(k.slabOf(postPlan(sx, sy), TB, CAGE_TOP - TB, P, 2), { tone: "mid", crease: "none" });
const barPlan = {
  back: box(-POST - POST_W / 2, -POST - POST_W / 2, POST + POST_W / 2, -POST + POST_W / 2, 0.4),
  front: box(-POST - POST_W / 2, POST - POST_W / 2, POST + POST_W / 2, POST + POST_W / 2, 0.4),
  left: box(-POST - POST_W / 2, -POST + POST_W / 2, -POST + POST_W / 2, POST - POST_W / 2, 0),
  right: box(POST - POST_W / 2, -POST + POST_W / 2, POST + POST_W / 2, POST - POST_W / 2, 0),
};
const barSvg = (name) => S(k.slabOf(barPlan[name], CAGE_TOP, BAR_H, P, 2), { tone: "mid" });

function tubeBack() {
  const pad = box(-15, -15, 15, 15, 2);
  return [
    sel("stack",
      `<path class="iso-halo" d="${k.haloOf(pad, 0, 4, P)}"/>`,
      S(k.slabOf(pad, 0, TB, P, 3, 0.6), { tone: "mid" }),
      D(k.corners(pad, 2.6).map(([x, y]) => at([x, y, TB])), { size: 0.45 })),
    // 반환 슈트와 호출자 트레이 (튜브 앞, 낮다)
    sel("tray",
      S(k.slabOf(CHUTE, 0, TB, P, 2, 0.4), { tone: "lo" }),
      chuteRail(CHUTE.x),
      `<path class="iso-halo" d="${k.haloOf(TRAY, 0, 2, P)}" style="opacity:.5"/>`,
      S(k.slabOf(TRAY, 0, TRAY_TOP, P, 4, 0.6), { tone: "mid" }),
      L(k.planOutline(k.insetPlan(TRAY, 2), TRAY_TOP, P, 4), { tone: "lo" }),
      L(k.planOutline(k.insetPlan(TRAY, 3.4), TRAY_TOP, P, 4), { tone: "faint" })),
    // 기둥: 뒤 둘, 왼쪽 앞 하나 (디스크보다 먼저), 위 테 뒤와 왼쪽
    sel("stack", postSvg(-1, -1), postSvg(1, -1), postSvg(-1, 1), barSvg("back"), barSvg("left")),
  ].join("");
}

const chuteRail = (x) => S(k.slabOf(box(x, CHUTE.y, x + 1.4, CHUTE.y + CHUTE.d, 0.4), TB, 2.4, P, 2), { tone: "mid" });

function tubeFront() {
  return [
    sel("stack", postSvg(1, 1)),
    sel("tray", chuteRail(CHUTE.x + CHUTE.w - 1.4)),
    sel("stack", barSvg("right"), barSvg("front"),
      D([[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sy]) => at([sx * POST, sy * POST, CAGE_TOP + BAR_H])), { size: 0.45, tone: "mid" })),
  ].join("");
}

// ---- 움직이는 부품 (정지 위치에서 한 번 만들고 transform으로 옮긴다) ----
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;

function gripper() {
  return [
    S(k.cylinder(0, 0, 5, 0, 1.5, P, 28), { tone: "lo" }),
    S(k.slabOf(box(-4, -4, 4, 4, 1), 1.5, 5, P, 3, 0.4), { tone: "mid" }),
    D([at([-2.6, 4, 4.4]), at([2.6, 4, 4.4])], { size: 0.4 }),
  ].join("");
}

function carriage(kind) {
  const out = [];
  if (kind === "press") {
    out.push(S(k.cylinder(0, 0, 4.2, ROD_TOP, CAR_Z - ROD_TOP, P, 24), { tone: "mid" }));
    out.push(L(k.sideArc(0, 0, 4.2, ROD_TOP + 1.4, P, 16), { tone: "faint" }));
  }
  const plan = box(-7, -3, 7, 3, 0.8);
  out.push(S(k.slabOf(plan, CAR_Z, RAIL_Z - CAR_Z, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(plan, CAR_Z + 2.6, P, 3), { tone: "faint" }) }));
  out.push(D([at([-4.4, 3, RAIL_Z - 2.2]), at([4.4, 3, RAIL_Z - 2.2])], { size: 0.5, tone: "mid" }));
  return out.join("");
}

function pressPlate() {
  return S(k.cylinder(0, 0, PLATE_R, 0, PLATE_T, P, 40, 0.4), { tone: "mid", inner: L(k.sideArc(0, 0, PLATE_R, 1.2, P, 24), { tone: "faint" }) });
}

// ---- 테이프 ----
function tape() {
  const out = [];
  const plan = box(TAPE_LOCAL[0], TAPE_Y0, TAPE_LOCAL[1], TAPE_Y0 + TAPE_D, 0);
  const holes = [];
  const sprockets = [];
  // 칸마다 이송 구멍 1개와 1인 비트마다 구멍 1개. 칸 밖 리더는 빈 테이프다 (0 바이트 칸으로 읽히지 않게)
  M.CODE.forEach((ins, i) => {
    const x = -i * CELL;
    sprockets.push(k.ring(x, channelY(3), 0.75, TAPE_TOP, P, 12));
    for (let bit = 0; bit < 8; bit++) if ((ins.byte >> bit) & 1) holes.push(k.ring(x, channelY(bitChannel(bit)), 1.25, TAPE_TOP, P, 16));
  });
  const lines = [];
  for (let i = 0; i <= M.CODE.length; i++) lines.push(k.lineOnTop([CELL / 2 - i * CELL, TAPE_Y0], [CELL / 2 - i * CELL, TAPE_Y0 + TAPE_D], TAPE_TOP, P));
  const ticks = M.CODE.map((_, i) => k.lineOnTop([-i * CELL, TAPE_Y0 + TAPE_D - 1.6], [-i * CELL, TAPE_Y0 + TAPE_D], TAPE_TOP, P));
  out.push(S(k.slabOf(plan, BED_TOP, TAPE_T, P, 1), { tone: "hi", crease: "lo", inner: L(lines.join(""), { tone: "faint" }) + L(ticks.join(""), { tone: "lo" }) }));
  out.push(`<path class="iso-line bc-hole" data-tone="lo" d="${sprockets.join("")}"/>`);
  out.push(`<path class="iso-line bc-hole" data-tone="mid" d="${holes.join("")}"/>`);
  return out.join("");
}

function tapeClip() {
  const corners = [];
  for (const x of GUIDE_IN) for (const y of [TAPE_Y0 - 1, TAPE_Y0 + TAPE_D + 1]) for (const z of [BED_TOP - 1, TAPE_TOP + 2]) corners.push(at([x, y, z]));
  return `<clipPath id="bc-tape-clip"><path d="${k.pathOf(hull(corners), true)}"/></clipPath>`;
}

function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function bed() {
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(BED, 0, 3, P)}" style="opacity:.6"/>`);
  out.push(S(k.slabOf(BED, 0, BED_TOP, P, 3, 0.6), { tone: "mid" }));
  out.push(L(k.planOutline(box(GUIDE_IN[0], TAPE_Y0 - 1.6, GUIDE_IN[1], TAPE_Y0 + TAPE_D + 1.6, 0), BED_TOP, P, 1), { tone: "faint" }));
  // 눈금 띠: 칸 간격 15를 다섯으로 나눈 눈금, 읽기 위치(HX)가 0 눈금
  const strip = box(-136, 92.6, 48, 95.4, 0.6);
  out.push(S(k.slabOf(strip, BED_TOP, 0.5, P, 3), { tone: "lo", crease: "none" }));
  const minor = [];
  const major = [];
  for (let i = -30; i <= 27; i++) {
    const x = HX + i * (CELL / 5);
    if (i === 0 || x < strip.x + 2 || x > strip.x + strip.w - 2) continue;
    (i % 5 === 0 ? major : minor).push(k.lineOnTop([x, strip.y + 0.2], [x, strip.y + (i % 5 === 0 ? 2.2 : 1.2)], BED_TOP + 0.5, P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  out.push(L(k.lineOnTop([HX, strip.y + 0.2], [HX, strip.y + strip.d - 0.2], BED_TOP + 0.5, P), { tone: "hi" }));
  out.push(D([at([strip.x + 1.2, strip.y + 1.4, BED_TOP + 0.5]), at([strip.x + strip.w - 1.2, strip.y + 1.4, BED_TOP + 0.5])], { size: 0.4 }));
  // 테이프 이송 노브 (왼쪽 끝, 베드 위)
  const knob = [-151, 75];
  out.push(S(k.cylinder(knob[0], knob[1], 3.4, BED_TOP, 2, P, 24), { tone: "mid" }));
  out.push(S(k.cylinder(knob[0], knob[1], 4.6, BED_TOP + 2, 4.4, P, 32), { tone: "mid" }));
  out.push(L(k.knurl(knob[0], knob[1], 4.6, BED_TOP + 2, BED_TOP + 6.4, 30, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([knob[0], knob[1]], [knob[0] + 4.6, knob[1]], BED_TOP + 6.4, P), { tone: "hi" }));
  out.push(D([at([knob[0], knob[1], BED_TOP + 6.4])], { size: 0.5, tone: "hi" }));
  return out.join("");
}

// 프레스 받침대: 쉬는 누름판이 이 위에 놓인다
function pressRest() {
  const x = PRESS_PARK;
  const out = [`<path class="iso-halo" d="${k.haloOf(box(x - 9, -9, x + 9, 9, 9), 0, 2, P)}" style="opacity:.6"/>`];
  out.push(S(k.cylinder(x, 0, 9, 0, 2.4, P, 40, 0.4), { tone: "mid" }));
  out.push(D([0, 1, 2, 3].map((i) => at([x + 6.6 * Math.cos(Math.PI / 4 + (i * Math.PI) / 2), 6.6 * Math.sin(Math.PI / 4 + (i * Math.PI) / 2), 2.4])), { size: 0.45 }));
  out.push(S(k.cylinder(x, 0, 2.6, 2.4, PLATE_REST - 2.4 - 2, P, 20), { tone: "mid", crease: "none", inner: L(k.sideArc(x, 0, 2.6, 14, P, 12), { tone: "faint" }) }));
  out.push(S(k.cylinder(x, 0, 5, PLATE_REST - 2, 2, P, 32), { tone: "lo" }));
  return out.join("");
}

// 테이프 받이 통: 읽힌 테이프가 오른쪽 가이드 밑을 지나 여기에 접혀 쌓인다
function takeUp() {
  const bin = box(60, 57, 75, 93, 1.2);
  const wall = 1.4;
  const out = [`<path class="iso-halo" d="${k.haloOf(bin, 0, 4, P)}" style="opacity:.6"/>`];
  out.push(S(k.slabOf(bin, 0, 1.6, P, 2), { tone: "lo" }));
  out.push(S(k.slabOf(box(bin.x, bin.y, bin.x + bin.w, bin.y + wall, 0.4), 1.6, 12, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf(box(bin.x, bin.y + wall, bin.x + wall, bin.y + bin.d - wall, 0), 1.6, 5, P, 2), { tone: "mid" }));
  for (let i = 0; i < 4; i++) {
    const fold = box(bin.x + wall + 0.4 + (i % 2) * 0.8, TAPE_Y0, bin.x + bin.w - wall - 1.2 + (i % 2) * 0.8, TAPE_Y0 + TAPE_D, 0.6);
    out.push(S(k.slabOf(fold, 1.6 + i * 1.1, 1.1, P, 2), { tone: "hi", crease: "lo" }));
  }
  out.push(S(k.slabOf(box(bin.x + bin.w - wall, bin.y + wall, bin.x + bin.w, bin.y + bin.d - wall, 0), 1.6, 12, P, 2), { tone: "mid" }));
  out.push(S(k.slabOf(box(bin.x, bin.y + bin.d - wall, bin.x + bin.w, bin.y + bin.d, 0.4), 1.6, 12, P, 2, 0.3), { tone: "mid" }));
  out.push(D([at([bin.x + 3, bin.y + bin.d, 10]), at([bin.x + bin.w - 3, bin.y + bin.d, 10])], { size: 0.45 }));
  return out.join("");
}

function guide(x0) {
  const plan = box(x0, 55, x0 + 8, 95, 1);
  return [
    S(k.slabOf(plan, BED_TOP, 7, P, 2, 0.4), { tone: "mid" }),
    L(k.planOutline(k.insetPlan(plan, 1.6), BED_TOP + 7, P, 2), { tone: "faint" }),
    D([at([x0 + 4, 58, BED_TOP + 7]), at([x0 + 4, 92, BED_TOP + 7])], { size: 0.45 }),
  ].join("");
}

function bridgeBack() {
  return S(k.slabOf(box(HX - 3, 48, HX + 3, 52, 0.6), 0, 38, P, 2, 0.4), { tone: "mid" });
}
function bridgeFront() {
  const out = [];
  const head = box(HX - 6, 56, HX + 6, 94, 1);
  out.push(S(k.slabOf(head, 22, 16, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(head, 26, P, 3), { tone: "faint" }) }));
  out.push(L(frontRect(HX - 4, HX + 4, 94, 28.4, 35.6), { tone: "lo" }));
  // 포인터 날: 헤드 앞 아래에서 읽는 칸을 가리킨다
  out.push(S(k.slabOf(box(HX - 0.6, 91, HX + 0.6, 93.6, 0.2), 9, 13, P, 1), { tone: "hi", crease: "none" }));
  out.push(S(k.slabOf(box(HX - 3, 100, HX + 3, 104, 0.6), 0, 38, P, 2, 0.4), { tone: "mid" }));
  const bar = box(HX - 4, 46.6, HX + 4, 105.4, 1);
  out.push(S(k.slabOf(bar, 38, 5, P, 3, 0.5), { tone: "mid" }));
  out.push(D([at([HX, 50, 43]), at([HX, 102, 43])], { size: 0.45 }));
  // 손나사: 가로대 위
  out.push(S(k.cylinder(HX, 75, 3, 43, 4, P, 24), { tone: "mid" }));
  out.push(L(k.knurl(HX, 75, 3, 43, 47, 20, P), { tone: "lo" }));
  return out.join("");
}

// ---- 그림 조립 ----
const SLOT_SVG = SLOT_Z.map((z, i) => groupAt([0, 0, z], disc(null, { part: `slot-${i}` }), ` data-slot="${i}" data-sel="stack"`));
const MOVER = `<g data-part="mover" style="display:none" transform="">${disc(null, { part: "mover", lit: true })}</g>`;
const ROD = `<g data-part="rod" data-sel="press"></g>`;

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `천공 테이프 리더가 JVM 바이트코드 ${M.CODE.length}개를 한 칸씩 읽는 기계. 뒤쪽에 지역 변수 서랍 ${M.MAX_LOCALS}칸과 상수 호퍼, 디스크 ${M.MAX_STACK}장 높이의 스택 튜브가 있고, 위 빔의 픽업 암이 디스크를 튜브로 옮기며, 프레스가 위 두 장을 한 장으로 누르고, 반환 디스크는 앞의 트레이로 미끄러진다.`,
  body: [
    base(),
    gantryPost(-152),
    sel("locals", cabinet()),
    sel("const", hopper()),
    tubeBack(),
    ...SLOT_SVG,
    sel("arm", `<path class="iso-line" data-part="cable" data-tone="mid" d=""/>`),
    `<g data-layer="inner"></g>`,
    tubeFront(),
    sel("press", pressRest()),
    `<g data-layer="high">${groupAt([PRESS_PARK, 0, PLATE_REST], pressPlate(), ` data-part="plate" data-sel="press"`)}${ROD}${MOVER}${groupAt([ARM_PARK, 0, GRIP_TRAVEL], gripper(), ` data-part="grip" data-sel="arm"`)}</g>`,
    gantryPost(58),
    groupAt([ARM_PARK, 0, 0], carriage("arm"), ` data-part="arm" data-sel="arm"`),
    groupAt([PRESS_PARK, 0, 0], carriage("press"), ` data-part="press" data-sel="press"`),
    beam(),
    sel("head", bridgeBack()),
    sel("tape", bed()),
    tapeClip(),
    `<g clip-path="url(#bc-tape-clip)"><g data-part="tape" data-sel="tape" transform="">${tape()}</g></g>`,
    sel("tape", guide(GUIDE_IN[0] - 6), guide(GUIDE_IN[1] - 2), takeUp()),
    sel("head", bridgeFront()),
  ],
});

const CFG = {
  P,
  DR, DH, TB, SLOT_Z, CAR_Z, ROD_TOP, ARM_PARK, PRESS_PARK, TRAVEL, GRIP_TRAVEL, PLATE_REST, PLATE_T,
  DRAWER_X, DRAWER_DISC, HOPPER_X, HOPPER_DISC,
  CAGE_ABOVE: CAGE_TOP + BAR_H,
  CHUTE_END: CHUTE.y + CHUTE.d - 2, TRAY_Y: TRAY.y + TRAY.d / 2, TRAY_TOP,
  CELL, HX, INIT_STEPS,
  STEP_SECONDS: 0.85, TOUR_GAP: 0.9, TOUR_REST: 1.4, RESUME: 6,
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
  tape: q('[data-part="tape"]'), mover: q('[data-part="mover"]'), grip: q('[data-part="grip"]'), cable: q('[data-part="cable"]'),
  arm: q('[data-part="arm"]'), press: q('[data-part="press"]'), plate: q('[data-part="plate"]'), rod: q('[data-part="rod"]'),
  slots: C.SLOT_Z.map((_, i) => q('[data-slot="' + i + '"]')),
  sources: [...svg.querySelectorAll("[data-source]")],
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
// 튜브 안을 지나는 부품은 뒤 테와 앞 테 사이(inner), 튜브 위에 있으면 앞 테 뒤(high)에 그린다
const layer = { inner: q('[data-layer="inner"]'), high: q('[data-layer="high"]') };
const LAYERED = [el.plate, el.rod, el.mover, el.grip];
function layerFor(high) {
  if (LAYERED.every((node, i) => (node.parentNode === layer.high) === high[i])) return;
  LAYERED.forEach((node, i) => (high[i] ? layer.high : layer.inner).appendChild(node));
}
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const seg = (u, a, b) => ease((u - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;

function initial() { let s = MODEL.makeState(); for (let i = 0; i < C.INIT_STEPS; i++) s = MODEL.step(s); return s; }
let state = initial();
let anim = null; // { from, to, kind, t }
const tapePos = (s) => (s.last ? s.last.pc : -1);
// 움직인 부품이 없는 상태(entry)의 lit: 다음 STEP이 옮길 디스크의 출처 (iload_0이면 0번 서랍)
function nextSource(s) {
  if (s.last || s.done) return null;
  const mv = MODEL.step(s).moved;
  return mv.from === "local" ? "local-" + mv.slot : mv.from === "const" ? "const" : null;
}

// 정지 자세: 상태 하나로 정해진다
function rest(s) {
  const top = s.stack.length - 1;
  return {
    tape: tapePos(s),
    slots: C.SLOT_Z.map((z, i) => (i < s.stack.length ? { v: s.stack[i], z, lit: !!s.last && i === top } : null)),
    mover: s.done ? { v: s.returned, x: 0, y: C.TRAY_Y, z: C.TRAY_TOP, o: 1 } : null,
    source: nextSource(s),
    armX: C.ARM_PARK, grip: C.GRIP_TRAVEL, pressX: C.PRESS_PARK, plate: C.PLATE_REST,
  };
}

// 전이 자세: 직전 상태에서 다음 상태로, u = 0..1
function between(a, b, u, kind) {
  const pose = rest(a);
  if (kind === "rewind") {
    pose.tape = lerp(tapePos(a), tapePos(b), seg(u, 0, 0.8));
    if (pose.mover) pose.mover.o = 1 - seg(u, 0, 0.5);
    if (u >= 0.5) { pose.mover = null; pose.source = nextSource(b); }
    if (u >= 1) return rest(b);
    return pose;
  }
  pose.tape = lerp(tapePos(a), tapePos(b), seg(u, 0, 0.3));
  if (u >= 1) return rest(b);
  const mv = b.moved;
  if (mv.to === "stack" && mv.from !== "stack") {
    const src = mv.from === "local" ? C.DRAWER_X[mv.slot] : C.HOPPER_X;
    const srcZ = mv.from === "local" ? C.DRAWER_DISC : C.HOPPER_DISC;
    const pick = srcZ + C.DH;
    const slotZ = C.SLOT_Z[b.stack.length - 1];
    if (u < 0.2) pose.armX = lerp(C.ARM_PARK, src, seg(u, 0, 0.2));
    else if (u < 0.44) pose.armX = src;
    else if (u < 0.66) pose.armX = lerp(src, 0, seg(u, 0.44, 0.66));
    else if (u < 0.78) pose.armX = 0;
    else pose.armX = lerp(0, C.ARM_PARK, seg(u, 0.78, 1));
    if (u >= 0.2 && u < 0.32) pose.grip = lerp(C.GRIP_TRAVEL, pick, seg(u, 0.2, 0.32));
    else if (u >= 0.32 && u < 0.44) pose.grip = lerp(pick, C.GRIP_TRAVEL, seg(u, 0.32, 0.44));
    pose.slots.forEach((slot) => slot && (slot.lit = false));
    if (u >= 0.32) pose.source = null; // 사본이 떠오르면 lit은 옮겨지는 디스크로 넘어간다
    if (u >= 0.32 && u < 0.66) pose.mover = { v: mv.value, x: pose.armX, y: 0, z: pose.grip - C.DH, o: 1 };
    else if (u >= 0.66 && u < 0.78) { const t = clamp01((u - 0.66) / 0.12); pose.mover = { v: mv.value, x: 0, y: 0, z: lerp(C.TRAVEL, slotZ, t * t), o: 1 }; }
    else if (u >= 0.78) pose.mover = { v: mv.value, x: 0, y: 0, z: slotZ, o: 1 };
  } else if (mv.from === "stack" && mv.to === "stack") {
    const [lo, hi] = C.SLOT_Z;
    if (u < 0.22) pose.pressX = lerp(C.PRESS_PARK, 0, seg(u, 0, 0.22));
    else if (u < 0.78) pose.pressX = 0;
    else pose.pressX = lerp(0, C.PRESS_PARK, seg(u, 0.78, 1));
    pose.slots.forEach((slot) => slot && (slot.lit = false));
    if (u >= 0.22 && u < 0.4) pose.plate = lerp(C.PLATE_REST, hi + C.DH, seg(u, 0.22, 0.4));
    else if (u >= 0.4 && u < 0.6) {
      pose.plate = lerp(hi + C.DH, lo + C.DH, seg(u, 0.4, 0.6));
      pose.slots[1] = { v: mv.operands[1], z: pose.plate - C.DH, lit: true };
    } else if (u >= 0.6 && u < 0.78) {
      pose.plate = lerp(lo + C.DH, C.PLATE_REST, seg(u, 0.6, 0.78));
      pose.slots = [{ v: mv.value, z: lo, lit: true }, null];
    }
    if (u >= 0.6) pose.slots = [{ v: mv.value, z: lo, lit: true }, null];
  } else if (mv.to === "caller") {
    pose.slots = C.SLOT_Z.map(() => null);
    const out = seg(u, 0.05, 0.55);
    const drop = seg(u, 0.55, 0.8);
    pose.mover = { v: mv.value, x: 0, y: lerp(0, C.CHUTE_END, out) + (C.TRAY_Y - C.CHUTE_END) * drop, z: lerp(C.SLOT_Z[0], C.TRAY_TOP, drop * drop), o: 1 };
  }
  return pose;
}

const shown = { slots: [], mover: undefined };
function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }
function draw(pose) {
  put(el.tape, [C.HX + pose.tape * C.CELL, 0, 0]);
  pose.slots.forEach((slot, i) => {
    const node = el.slots[i];
    node.style.display = slot ? "" : "none";
    if (!slot) return;
    put(node, [0, 0, slot.z]);
    node.querySelector(".iso-solid").toggleAttribute("data-lit", slot.lit);
    node.toggleAttribute("data-on", slot.lit);
    const text = String(slot.v);
    const d = digit("slot-" + i);
    if (d.textContent !== text) d.textContent = text;
  });
  el.sources.forEach((node) => {
    const on = node.dataset.source === pose.source;
    node.querySelector(".iso-solid").toggleAttribute("data-lit", on);
    node.toggleAttribute("data-on", on);
  });
  const m = pose.mover;
  el.mover.style.display = m ? "" : "none";
  if (m) {
    put(el.mover, [m.x, m.y, m.z]);
    el.mover.style.opacity = m.o < 1 ? m.o.toFixed(3) : "";
    const d = digit("mover");
    if (d.textContent !== String(m.v)) d.textContent = String(m.v);
  }
  put(el.arm, [pose.armX, 0, 0]);
  put(el.grip, [pose.armX, 0, pose.grip]);
  el.cable.setAttribute("d", pathOf([iso([pose.armX, 0, C.CAR_Z], P), iso([pose.armX, 0, pose.grip + 6.5], P)]));
  put(el.press, [pose.pressX, 0, 0]);
  put(el.plate, [pose.pressX, 0, pose.plate]);
  const rodFrom = pose.plate + C.PLATE_T;
  el.rod.innerHTML = solidSvg(cylinder(pose.pressX, 0, 2.2, rodFrom, C.ROD_TOP - rodFrom, P, 18), { tone: "mid", crease: "none" });
  const plateHigh = pose.plate >= C.CAGE_ABOVE - 0.01;
  layerFor([plateHigh, plateHigh, !m || m.z >= C.CAGE_ABOVE - 0.01, true]);
}

function say() {
  const text = MODEL.readout(state);
  if (readoutEl.textContent !== text) readoutEl.textContent = text;
  return text;
}

// 루프
let frame = 0, last = 0, visible = false, touring = !still.matches, clock = 0, wait = C.TOUR_REST, idleTimer = 0;
function begin(from, to, kind = "step") {
  anim = { from, to, kind, t: 0 };
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
  if (from === state) return;
  begin(from, state, "rewind");
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  if (anim) {
    anim.t += dt / C.STEP_SECONDS;
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
  if (pinSel && !event.target.closest(".bc-parts, .iso-stage")) { pinSel = null; choose(); }
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
  `${F} .bc-digit{fill:var(--anatomy-mid)}`,
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
  `${FP} .bc-digit{fill:var(--anatomy-lit)}`,
].join("\n");

const css = `<style>
.iso{--bc-hole:#030303;--bc-win:#0b0b0b}
.iso[data-theme="light"]{--bc-hole:#a3a3a0;--bc-win:#ececea}
.iso-line.bc-hole{fill:var(--bc-hole)}
.iso-line.bc-win{fill:var(--bc-win)}
.bc-digit{fill:var(--anatomy-hi);font-family:var(--anatomy-mono);font-weight:600}
[data-on] .bc-digit,[data-part="mover"] .bc-digit{fill:var(--anatomy-lit)}
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:118%;margin:0 -9%}}
.bc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.bc-parts{display:flex;flex-wrap:wrap;gap:6px}
.bc-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.bc-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.bc-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.bc-parts button[data-picked] span{color:var(--anatomy-strong)}
.bc-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.bc-note{min-height:3.1em;color:var(--anatomy-text)}
.bc-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="bc-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="bc-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 1",
    title: "바이트코드 테이프 리더",
    hint: "클릭이나 → 한 칸, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [{ mark: "lit", label: "지금 움직이는 디스크: 옮겨지는 값, 프레스가 만든 값, 반환되는 값" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="바이트코드 테이프 리더. 클릭, 오른쪽 화살표, 스페이스로 opcode 하나를 실행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="bc-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "바이트코드 테이프 리더", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
