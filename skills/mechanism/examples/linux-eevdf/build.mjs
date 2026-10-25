// node build.mjs [--light]: EEVDF 레인 선택기 (flowcast:mechanism 예제, 합성)
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
const NAME = "linux-eevdf";
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
const INIT_STEPS = 2; // 처음 보여줄 상태: 마감이 가장 이른 n0이 자격이 없어 n5가 뽑힌 결정 (#2)
const N = M.TASKS.length;
const W_SUM = M.TASKS.reduce((a, t) => a + t.weight, 0);
const vtick = M.TASKS.map((t) => M.calcDeltaFair(M.TICK_NS, t.weight)); // 실행 1 ms가 가상 시간 몇 ns인가
const VSLICE = M.TASKS.map((t) => M.vslice(t.weight));
{
  const s = TRACE[INIT_STEPS];
  const earliest = s.tasks.reduce((b, x, i) => (x.d < s.tasks[b].d ? i : b), 0);
  if (earliest === s.curr || s.elig[earliest]) throw new Error("initial pose should show a skipped earliest deadline");
}

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위). x축이 가상 시간이다 ----
const WIDTH = 600;
const HEIGHT = 310;
const SCALE = 6.6; // 가상 시간 1 ms = 6.6 단위
const XA = -100; // 가상 시간 0 (배치 순간의 V)
const X = (ns) => XA + (SCALE * ns) / 1e6;
const MS_MAX = 28; // 눈금 끝. 그림의 가장 먼 마감(#11의 n5)보다 뒤
if (Math.max(...TRACE.flatMap((s) => s.tasks.map((t) => t.d))) / 1e6 > MS_MAX) throw new Error("ruler too short");

const PLATE = { x: -150, y: -98, w: 304, d: 160, r: 9 };
const PLATE_H = 10;
const FOOT_H = 5;
const LANE_Y = [-44, -10, 24]; // n0, n1, n5 (뒤에서 앞으로)
const PIN_DY = 14; // 마감 핀 트랙: 레인 앞쪽
const CABLE_DY = -4; // 케이블: 레인 뒤쪽
const RAIL_X = [-112, 100];
const TRACK_X = [-96, 92];
const X_CAP = 114;
const GEAR_R = 12.5;
const R0 = 3; // nice 0 드럼 반지름. 다른 레인은 1024/w배 (calc_delta_fair의 기어비)
const DRUM_R = vtick.map((v) => (R0 * v) / M.TICK_NS);
const DRUM_Y = LANE_Y.map((y, i) => y + CABLE_DY + DRUM_R[i]); // 케이블이 드럼 뒤쪽에 접한다
const DRUM_Z = [5, 15];
const CAB_Z = 6;
const CAR_Z = [3, 9];
const WEIGHT_R = 4.2;
const WEIGHT_H = M.TASKS.map((t) => (9 * t.weight) / M.NICE_0_WEIGHT); // 무게추 높이 = 가중치
const SLIDER_Z = [2.5, 7];
const PIN_R = 1.3;
const PIN_UP = 25; // 서 있는 핀 머리 아래 (탐침 팔 위 23보다 높다)
const PIN_DOWN = 11.5; // 내려간 핀 머리 아래 (탐침 팔 아래 20보다 낮다)
const HEAD_H = 1.2;
const PROBE_Z = [20, 23];
const GATE_Z = [30, 33];
const ARM_W = 3;
const PROBE_OFF = PIN_R + ARM_W / 2; // 탐침 팔 중심은 핀 몸통 왼쪽 면에 닿는 자리
const PROBE_HOME = X(-1.8e6);
const GATE_RAIL_Y = -84;
const PROBE_RAIL_Y = -72;
const BACK_Y = -61; // 뒤 영역과 레인 0의 경계
const LANE_SPAN = 17; // 레인 하나가 덮는 y 반폭 (팔을 나누는 경계)
const FRONT_Y = 41; // 레인 2와 앞 영역의 경계
const RULER = { x: -112, y: 44, w: 208, d: 10, r: 1 };
const RULER_TOP = 0.6;
const PROBE_TIP_Y = 47;
const GATE_ROD_Y = 51;
const CPU_X = 140;
const CPU_RAIL = { x: CPU_X - 3, y: -64, w: 6, d: 104, r: 1 };
const PINION_R = 4;
const PINION_X = X_CAP + GEAR_R + PINION_R;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [PLATE.x + 10, GATE_RAIL_Y, GATE_Z[1]], [PLATE.x + PLATE.w, PLATE.y, 24], [CPU_X, -64, 24]],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 68, elevation: 36 },
);
const CAM = k.cameraOf(P);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const ms2 = (ns) => (ns / 1e6).toFixed(2);
const names = M.TASKS.map((t) => t.name).join(", ");
const PARTS = [
  { id: "cpu", name: "CPU 구동 캐리지", concept: "지금 CPU를 받은 태스크", text: `CPU ${M.PROBE_CPU} 하나는 한 번에 태스크 하나만 돌립니다. 이 캐리지가 붙은 레인의 드럼만 돌고, 결정이 끝날 때마다 다음에 뽑힌 레인으로 옮겨 가요. 그림의 한 결정은 ${M.TICK_NS / 1e6} ms 틱 3번 동안의 실행입니다.` },
  { id: "drum", name: "캡스턴 드럼", concept: "calc_delta_fair, 1024/w", text: `기어는 레인마다 같은 속도로 돌지만 드럼 지름이 1024/w배라서, 실행 1 ms에 감기는 가상 시간이 ${M.TASKS.map((t, i) => `${t.name} ${ms2(vtick[i])}`).join(", ")} ms로 다릅니다. 가벼운 태스크일수록 vruntime이 빨리 흘러요.` },
  { id: "carriage", name: "캐리지", concept: "vruntime", text: `태스크가 지금까지 받은 가상 시간입니다(표시창 숫자, ms). 실측에서는 세 태스크의 vruntime이 거의 같이 갔고, 실제로 받은 CPU 시간은 가중치에 비례했어요. 방금 돈 캐리지가 밝습니다.` },
  { id: "weight", name: "무게추", concept: "nice 가중치", text: `높이가 가중치입니다: ${M.TASKS.map((t) => `nice ${t.nice} = ${t.weight}`).join(", ")}(core.c 표, /proc의 se.load.weight와 같아요). 세 무게추의 무게중심이 V가 됩니다.` },
  { id: "gate", name: "게이트", concept: "V (avg_vruntime)", text: `vruntime의 가중 평균입니다. 누가 돌든 실행 1 ms마다 1024/${W_SUM} ms씩 앞으로 가요. 게이트보다 뒤(왼쪽)에 있는 캐리지, 곧 lag가 0 이상인 태스크만 자격이 있습니다.` },
  { id: "pin", name: "마감 핀", concept: "가상 마감과 자격", text: `핀 자리가 가상 마감(v + 슬라이스 ${M.BASE_SLICE_NS / 1e6} ms의 가상 길이 ${M.TASKS.map((t, i) => ms2(VSLICE[i])).join(", ")} ms)입니다. 캐리지가 마감에 닿을 때만 앞으로 옮겨져요. 결정 순간 자격이 있으면 서고, 없으면 내려갑니다.` },
  { id: "probe", name: "탐침 바", concept: "pick_eevdf", text: "왼쪽 끝에서 와서 처음 닿는 서 있는 핀에 멈춥니다. 자격 있는 태스크 가운데 가상 마감이 가장 이른 것이 다음에 돌아요. 내려간 핀은 마감이 더 일러도 그냥 지나갑니다." },
  { id: "lane", name: "레인", concept: `태스크 하나 (${names})`, text: `CPU ${M.PROBE_CPU}에 고정한, CPU를 놓지 않는 태스크 셋입니다. 이름표 표시창이 comm, 뒤에서부터 nice ${M.TASKS.map((t) => t.nice).join(", ")}이에요.` },
  { id: "ruler", name: "눈금 띠", concept: "가상 시간 (ms)", text: `작은 눈금 0.5 ms, 큰 눈금 5 ms이고, 0은 세 태스크가 lag 0으로 깨어난 순간의 V입니다. 게이트 지시봉은 V를, 탐침 끝은 뽑힌 마감을 가리켜요.` },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";

// ---- 표시창: 면 위 창과 숫자 ----
let clipCount = 0;
// +y 면(앞면)에 붙은 창. at은 창 중심, w와 h는 창 크기
function frontWindow(cx, y, cz, w, h, text, part) {
  const id = `ev-clip-${clipCount++}`;
  const m = k.sideMatrix([cx, y], cz, P, "left");
  const rect = `M${-w / 2} ${-h / 2}H${w / 2}V${h / 2}H${-w / 2}Z`;
  return [
    `<g transform="${m}"><clipPath id="${id}"><path d="${rect}"/></clipPath>`,
    `<path class="iso-line ev-win" data-tone="lo" d="${rect}"/>`,
    `<text class="ev-digit"${part ? ` data-digit="${part}"` : ""} clip-path="url(#${id})" x="0" y="${(h * 0.32).toFixed(2)}" font-size="${(h * 0.82).toFixed(2)}" text-anchor="middle">${text}</text></g>`,
  ].join("");
}

// ---- 베이스 ----
function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
    out.push(S(k.cylinder(x, y, 7.5, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.8, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: L(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
  const screws = k.corners(PLATE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // 라벨판: 규칙선 3줄은 인쇄된 글자를 뜻한다 (free)
  const label = { x: 102, y: 45, w: 40, d: 9, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([26, 19, 23].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.6 + i * 1.9], [label.x + 4 + w, label.y + 2.6 + i * 1.9], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3, label.y + 2.4, 0.8]), at([label.x + label.w - 3, label.y + label.d - 2.4, 0.8])], { size: 0.45 }));
  return out.join("");
}

// 눈금 띠: 0.5 ms 작은 눈금, 5 ms 큰 눈금, 0 ms는 hi
function ruler() {
  const out = [S(k.slabOf(RULER, 0, RULER_TOP, P, 3), { tone: "lo", crease: "none" })];
  const minor = [];
  const major = [];
  const edge = RULER.y + 0.4;
  for (let i = -2; i <= MS_MAX * 2; i++) {
    const x = X(i * 5e5);
    if (i === 0) continue;
    (i % 10 === 0 ? major : minor).push(k.lineOnTop([x, edge], [x, edge + (i % 10 === 0 ? 3.6 : 2)], RULER_TOP, P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  out.push(L(k.lineOnTop([X(0), edge], [X(0), RULER.y + RULER.d], RULER_TOP, P), { tone: "hi" }));
  out.push(D([at([RULER.x + 1.4, RULER.y + RULER.d - 1.6, RULER_TOP]), at([RULER.x + RULER.w - 1.4, RULER.y + RULER.d - 1.6, RULER_TOP])], { size: 0.4 }));
  return out.join("");
}

// ---- 뒤 레일 (게이트, 탐침) ----
function backRail(y, screwAt) {
  const plan = box(PLATE.x + 14, y - 3, X_CAP - 10, y + 3, 1);
  const out = [S(k.slabOf(plan, 0, 3, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, 1.4, P, 3), { tone: "faint" }) })];
  out.push(L(k.planOutline(box(plan.x + 6, y - 0.7, plan.x + plan.w - 6, y + 0.7, 0.7), 3, P, 2), { tone: "faint" }));
  for (const x of [plan.x - 1, plan.x + plan.w - 3]) out.push(S(k.slabOf(box(x, y - 4, x + 4, y + 4, 0.6), 0, 5, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([plan.x + 1, y, 5]), at([plan.x + plan.w - 1, y, 5])], { size: 0.45 }));
  // 손나사: 레일 앞면, 스토퍼 옆
  const sx = screwAt;
  out.push(S(k.slabOf(box(sx - 1.2, y + 3, sx + 1.2, y + 5, 0.4), 0.6, 1.8, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(sx, y + 6.6, 2.2, 0, 4.6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(sx, y + 6.6, 2.2, 0, 4.6, 16, P), { tone: "lo" }));
  return out.join("");
}

// ---- 팔 (탐침, 게이트): y 구간마다 나눈 조각. 조각 사이 이음매에는 리벳 두 개 ----
function armChunk(y0, y1, z, extra = "") {
  const plan = box(-ARM_W / 2, y0, ARM_W / 2, y1, 0.3);
  return S(k.slabOf(plan, z[0], z[1] - z[0], P, 2, 0.3), { tone: "mid" }) + D([at([-0.8, y1 - 1.2, z[1]]), at([0.8, y1 - 1.2, z[1]])], { size: 0.35 }) + extra;
}
const PROBE_CHUNKS = [[PROBE_RAIL_Y - 1.5, BACK_Y], ...LANE_Y.map((y) => [y - LANE_SPAN, y + LANE_SPAN]), [FRONT_Y, PROBE_TIP_Y + 1.5]];
const GATE_CHUNKS = [[GATE_RAIL_Y - 1.6, BACK_Y], ...LANE_Y.map((y) => [y - LANE_SPAN, y + LANE_SPAN]), [FRONT_Y, GATE_ROD_Y + 1.5]];

function probeCarriage() {
  const out = [];
  const plan = box(-6, PROBE_RAIL_Y - 5, 6, PROBE_RAIL_Y + 5, 1);
  out.push(S(k.slabOf(plan, 3, 6, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, 5.6, P, 3), { tone: "faint" }) }));
  out.push(D([at([-4, PROBE_RAIL_Y + 5, 7]), at([4, PROBE_RAIL_Y + 5, 7])], { size: 0.45 }));
  out.push(S(k.slabOf(box(-1.5, PROBE_RAIL_Y - 1.5, 1.5, PROBE_RAIL_Y + 1.5, 0.3), 9, PROBE_Z[0] - 9, P, 2), { tone: "mid", crease: "none" }));
  return out.join("");
}
function probeTip() {
  // 앞 끝 브래킷과 아래로 내린 손가락: 손가락 끝이 뽑힌 마감 눈금에 닿는다
  const out = [S(k.slabOf(box(-ARM_W / 2, PROBE_TIP_Y - 1.5, PROBE_OFF + 1.2, PROBE_TIP_Y + 1.5, 0.3), PROBE_Z[0], PROBE_Z[1] - PROBE_Z[0], P, 2, 0.3), { tone: "mid" })];
  out.push(S(k.cylinder(PROBE_OFF, PROBE_TIP_Y, 0.8, RULER_TOP, PROBE_Z[0] - RULER_TOP, P, 14), { tone: "mid", crease: "none" }));
  out.push(D([at([PROBE_OFF, PROBE_TIP_Y, RULER_TOP])], { size: 0.5, tone: "hi" }));
  return out.join("");
}
function gateCarriage() {
  const out = [];
  const plan = box(-7, GATE_RAIL_Y - 6, 7, GATE_RAIL_Y + 6, 1.2);
  out.push(S(k.slabOf(plan, 3, 7, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, 6.4, P, 3), { tone: "faint" }) }));
  out.push(D([at([-5, GATE_RAIL_Y + 6, 8]), at([5, GATE_RAIL_Y + 6, 8])], { size: 0.45 }));
  out.push(S(k.slabOf(box(-1.6, GATE_RAIL_Y - 1.6, 1.6, GATE_RAIL_Y + 1.6, 0.3), 10, GATE_Z[0] - 10, P, 2), { tone: "mid", crease: "none" }));
  return out.join("");
}
function gateRod() {
  const out = [S(k.cylinder(0, GATE_ROD_Y, 1, RULER_TOP, GATE_Z[0] - RULER_TOP, P, 16), { tone: "mid", crease: "none", inner: L(k.sideArc(0, GATE_ROD_Y, 1, 6, P, 10), { tone: "faint" }) })];
  out.push(D([at([0, GATE_ROD_Y, RULER_TOP])], { size: 0.5, tone: "hi" }));
  return out.join("");
}

// ---- 레인 ----
function laneStatic(i) {
  const y = LANE_Y[i];
  const out = [];
  // 이름표: 왼쪽 끝 받침과 앞면 표시창 (comm)
  const tag = box(PLATE.x + 10, y - 6, PLATE.x + 30, y + 6, 1.2);
  out.push(`<path class="iso-halo" d="${k.haloOf(tag, 0, 4, P)}" style="opacity:.55"/>`);
  out.push(sel("lane", S(k.slabOf(tag, 0, 9, P, 3, 0.5), { tone: "mid" }), frontWindow(tag.x + 10, y + 6, 5, 11, 5, M.TASKS[i].name), D([at([tag.x + 2.5, y + 6, 7.8]), at([tag.x + tag.w - 2.5, y + 6, 7.8])], { size: 0.4 })));
  // 핀 트랙 (앞쪽), 레일, 스토퍼
  const track = box(TRACK_X[0], y + PIN_DY - 2.5, TRACK_X[1], y + PIN_DY + 2.5, 0.8);
  out.push(sel("pin", S(k.slabOf(track, 0, SLIDER_Z[0], P, 2, 0.4), { tone: "lo" }), L(k.planOutline(box(TRACK_X[0] + 3, y + PIN_DY - 0.6, TRACK_X[1] - 3, y + PIN_DY + 0.6, 0.6), SLIDER_Z[0], P, 2), { tone: "faint" })));
  const rail = box(RAIL_X[0], y - 2.5, RAIL_X[1], y + 2.5, 0.8);
  out.push(sel("lane",
    S(k.slabOf(rail, 0, CAR_Z[0], P, 2, 0.4), { tone: "mid", inner: L(k.sideSeam(rail, 1.3, P, 2), { tone: "faint" }) }),
    S(k.slabOf(box(RAIL_X[0] - 4, y - 5, RAIL_X[0] + 1, y + 5, 0.8), 0, 7, P, 2, 0.4), { tone: "mid" }),
    D([at([RAIL_X[0] - 1.5, y - 3, 7]), at([RAIL_X[0] - 1.5, y + 3, 7])], { size: 0.45 }),
    // 레일 고정 클램프: 5 ms마다 레일 양옆, 캐리지 부싱 아래 높이
    ...Array.from({ length: 5 }, (_, n) => X((n + 1) * 5e6)).flatMap((x) => [y - 4.2, y + 4.2].map((cy) => S(k.slabOf(box(x - 2, cy - 1.6, x + 2, cy + 1.6, 0.5), 0, 1.6, P, 2, 0.3), { tone: "lo" }) + D([at([x, cy, 1.6])], { size: 0.4 })))));
  // 핀 트랙 끝 스토퍼
  out.push(sel("pin", ...TRACK_X.map((x, n) => S(k.slabOf(box(n ? x : x - 3, y + PIN_DY - 3.2, n ? x + 3 : x, y + PIN_DY + 3.2, 0.6), 0, 4.5, P, 2, 0.3), { tone: "mid" }))));
  // 케이블 안내 롤러: 케이블 뒤에서 닿는다
  const gx = X_CAP - 18;
  const gy = y + CABLE_DY - 1.8;
  out.push(sel("drum", S(k.cylinder(gx, gy, 2.6, 0, 1.6, P, 20), { tone: "lo" }), S(k.cylinder(gx, gy, 1.8, 1.6, CAB_Z + 1.4, P, 20), { tone: "mid", inner: L(k.sideArc(gx, gy, 1.8, CAB_Z, P, 12), { tone: "faint" }) }), S(k.cylinder(gx, gy, 2.4, CAB_Z + 3, 0.8, P, 20), { tone: "mid" })));
  return out.join("");
}

function capstan(i) {
  const y = DRUM_Y[i];
  const r = DRUM_R[i];
  const out = [];
  out.push(`<path class="iso-halo" d="${k.haloOf(box(X_CAP - GEAR_R, y - GEAR_R, X_CAP + GEAR_R, y + GEAR_R, GEAR_R), 0, 3, P)}" style="opacity:.6"/>`);
  out.push(S(k.cylinder(X_CAP, y, GEAR_R - 1.5, 0, 3, P, 48), { tone: "lo" }));
  out.push(S(k.cylinder(X_CAP, y, GEAR_R, 3, 2, P, 64, 0.4), { tone: "mid", inner: L(k.sideArc(X_CAP, y, GEAR_R, 4, P, 32), { tone: "faint" }) }));
  out.push(`<path class="iso-line" data-tone="lo" data-teeth="${i}" d=""/>`);
  out.push(S(k.cylinder(X_CAP, y, r, DRUM_Z[0], DRUM_Z[1] - DRUM_Z[0], P, 40), { tone: "mid", inner: L([8, 10.5, 13].map((z) => k.sideArc(X_CAP, y, r, z, P, 24)).join(""), { tone: "faint" }) }));
  out.push(S(k.cylinder(X_CAP, y, r + 1.2, DRUM_Z[1], 1.4, P, 40, 0.3), { tone: "mid" }));
  out.push(`<path class="iso-line" data-tone="hi" data-mark="${i}" d=""/>`);
  out.push(D([at([X_CAP, y, DRUM_Z[1] + 1.4])], { size: 0.55, tone: "mid" }));
  return out.join("");
}

// 캐리지: 정지 위치 x = 0에서 만들고 X(v)로 옮긴다
function carriage(i) {
  const y = LANE_Y[i];
  const out = [];
  const body = box(-9, y - 6, 9, y + 6, 1.2);
  out.push(`<g data-sel="carriage">`);
  out.push(S(k.slabOf(box(-7.5, y - 7.2, -4.5, y + 7.2, 0.5), CAR_Z[0], 4.4, P, 2), { tone: "mid" }));
  out.push(`<g data-body="${i}">${S(k.slabOf(body, CAR_Z[0] + 0.4, CAR_Z[1] - CAR_Z[0] - 0.4, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(body, CAR_Z[0] + 2, P, 3), { tone: "faint" }) })}</g>`);
  out.push(S(k.slabOf(box(4.5, y - 7.2, 7.5, y + 7.2, 0.5), CAR_Z[0], 4.4, P, 2), { tone: "mid" }));
  out.push(D([-6, 6].map((x) => at([x, y + 7.2, CAR_Z[0] + 3.4])), { size: 0.4 }));
  // 케이블 클램프: 뒤쪽 +x 면
  out.push(S(k.slabOf(box(9, y + CABLE_DY - 2, 11, y + CABLE_DY + 2, 0.4), CAB_Z - 2, 4, P, 2), { tone: "mid", crease: "none" }));
  out.push(frontWindow(0, y + 6, 6.1, 12, 4.4, ms2(0), `v-${i}`));
  out.push(`</g>`);
  // 무게추: 높이 = 가중치, 윗면 링과 손잡이 점
  const h = WEIGHT_H[i];
  out.push(sel("weight",
    S(k.cylinder(0, y, WEIGHT_R, CAR_Z[1], h, P, 32, 0.3), { tone: "mid", inner: h > 4 ? L(k.sideArc(0, y, WEIGHT_R, CAR_Z[1] + h / 2, P, 20), { tone: "faint" }) : "" }),
    L(k.ring(0, y, WEIGHT_R - 1.4, CAR_Z[1] + h, P, 24), { tone: "faint" }),
    D([at([0, y, CAR_Z[1] + h])], { size: 0.5, tone: "mid" })));
  return out.join("");
}

// 마감 핀: 슬라이더는 고정 모양, 핀 몸통은 높이가 바뀌어 프레임마다 다시 만든다
function pinSlider(i) {
  const y = LANE_Y[i] + PIN_DY;
  const plan = box(-3.2, y - 2.6, 3.2, y + 2.6, 0.8);
  return S(k.slabOf(plan, SLIDER_Z[0], SLIDER_Z[1] - SLIDER_Z[0], P, 2, 0.4), { tone: "mid" }) + L(k.ring(0, y, PIN_R + 0.6, SLIDER_Z[1], P, 16), { tone: "lo" });
}
// 서 있는 핀(자격 있음)은 hi, 내려간 핀은 mid
function pinBody(i, top, tone) {
  const y = LANE_Y[i] + PIN_DY;
  return S(k.cylinder(0, y, PIN_R, SLIDER_Z[1], top - SLIDER_Z[1], P, 16), { tone, crease: "none" }) + S(k.cylinder(0, y, 2.2, top, HEAD_H, P, 24, 0.3), { tone, crease: "lo" });
}

// ---- CPU 구동 캐리지 ----
function cpuRail() {
  const out = [S(k.slabOf(CPU_RAIL, 0, 3, P, 2, 0.5), { tone: "mid", inner: L(k.sideSeam(CPU_RAIL, 1.4, P, 2), { tone: "faint" }) })];
  out.push(L(k.planOutline(box(CPU_X - 0.7, CPU_RAIL.y + 5, CPU_X + 0.7, CPU_RAIL.y + CPU_RAIL.d - 5, 0.7), 3, P, 2), { tone: "faint" }));
  for (const y of [CPU_RAIL.y - 2, CPU_RAIL.y + CPU_RAIL.d - 2]) out.push(S(k.slabOf(box(CPU_X - 4, y, CPU_X + 4, y + 4, 0.6), 0, 6, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([CPU_X, CPU_RAIL.y, 6]), at([CPU_X, CPU_RAIL.y + CPU_RAIL.d, 6])], { size: 0.45 }));
  return out.join("");
}
function cpuCarriage() {
  // y = 0에서 만들고 뽑힌 레인의 드럼 y로 옮긴다. 블록은 레일 위, 팔이 피니언을 드럼 기어 옆까지 내민다
  const out = [];
  const plan = box(CPU_X - 7, -9, CPU_X + 8, 9, 1.6);
  out.push(`<path class="iso-halo" d="${k.haloOf(box(PINION_X - 5, -9, CPU_X + 8, 9, 2), 0, 4, P)}" style="opacity:.5"/>`);
  // 피니언 팔: 기어 원판과 같은 높이, 블록 아래에서 나온다
  const arm = box(PINION_X, -3, CPU_X - 6, 3, 0.8);
  out.push(S(k.slabOf(arm, 5.4, 2.2, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(arm, 6.5, P, 2), { tone: "faint" }) }));
  out.push(S(k.cylinder(PINION_X, 0, 1.4, 5, 3.2, P, 14), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(PINION_X, 0, PINION_R, 3, 2, P, 28, 0.3), { tone: "mid", crease: "lo" }));
  out.push(`<path class="iso-line" data-tone="lo" data-pinion d=""/>`);
  out.push(S(k.cylinder(PINION_X, 0, 1.6, 7.6, 1, P, 14), { tone: "mid" }));
  out.push(S(k.slabOf(box(CPU_X - 5, -8, CPU_X + 5, 8, 1), 3, 3, P, 3, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(plan, 6, 6, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(plan, 9, P, 4), { tone: "faint" }) }));
  out.push(faceTextTop());
  out.push(D([at([plan.x + 2, plan.y + 2, 12]), at([plan.x + plan.w - 2, plan.y + 2, 12]), at([plan.x + plan.w - 2, plan.y + plan.d - 2, 12])], { size: 0.45 }));
  // 모터: 블록 위 원통, 띠 이음선, 윗면 환기 점
  out.push(S(k.cylinder(CPU_X + 3, -3, 4.6, 12, 8, P, 36, 0.4), { tone: "mid", inner: L(k.sideArc(CPU_X + 3, -3, 4.6, 15, P, 24) + k.sideArc(CPU_X + 3, -3, 4.6, 17.5, P, 24), { tone: "faint" }) }));
  out.push(D(k.dotGrid(CPU_X + 1.5, -4.5, 3, 3, 1.5, 20, P), { size: 0.35, tone: "lo" }));
  // 노브: 블록 앞면
  out.push(S(k.slabOf(box(CPU_X + 1.5, 9, CPU_X + 3.9, 11, 0.4), 7.5, 2.4, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(CPU_X + 2.7, 13.4, 2.6, 6.4, 4.6, P, 22), { tone: "mid" }));
  out.push(L(k.knurl(CPU_X + 2.7, 13.4, 2.6, 6.4, 11, 18, P), { tone: "lo" }));
  return out.join("");
}
function faceTextTop() {
  // 각인 라벨 하나: CPU 블록 윗면
  return k.faceTextSvg(k.topMatrix([CPU_X - 5, 7], 12, P, "x"), `CPU ${M.PROBE_CPU}`, { size: 2.6, tone: "lo" });
}

// ---- 그림 조립 ----
// 레인 하나: 고정 부품 → 케이블 → 움직이는 부품(프레임마다 정렬) → 캡스턴
const laneSvg = (i) => [
  laneStatic(i),
  sel("carriage", `<path class="iso-line" data-tone="mid" data-cable="${i}" d=""/>`),
  `<g data-lane="${i}">`,
  `<g data-item="car-${i}">${carriage(i)}</g>`,
  `<g data-item="pin-${i}" data-sel="pin">${pinSlider(i)}<g data-pinbody="${i}">${pinBody(i, PIN_UP, "hi")}</g></g>`,
  `<g data-item="probe-${i}" data-sel="probe">${armChunk(PROBE_CHUNKS[i + 1][0], PROBE_CHUNKS[i + 1][1], PROBE_Z)}</g>`,
  `<g data-item="gate-${i}" data-sel="gate">${armChunk(GATE_CHUNKS[i + 1][0], GATE_CHUNKS[i + 1][1], GATE_Z)}</g>`,
  `</g>`,
  sel("drum", capstan(i)),
].join("");

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `EEVDF 스케줄러를 레인 세 개의 기계로 옮긴 그림. 레인마다 vruntime 캐리지가 있고 그 위 무게추 높이가 nice 가중치, 오른쪽 캡스턴 드럼 지름이 1024/w배입니다. CPU 구동 캐리지가 붙은 레인의 드럼만 돌아 캐리지를 끌고, 게이트는 가중 평균 V에, 마감 핀은 가상 마감에 서며, 게이트 뒤에 있는 캐리지의 핀만 섭니다. 왼쪽에서 오는 탐침 바가 처음 닿는 서 있는 핀의 레인이 다음에 돕니다.`,
  body: [
    base(),
    sel("ruler", ruler()),
    sel("gate", backRail(GATE_RAIL_Y, X_CAP - 22)),
    sel("probe", backRail(PROBE_RAIL_Y, X_CAP - 32)),
    `<g data-lane="back">`,
    `<g data-item="gatecar" data-sel="gate">${gateCarriage()}</g>`,
    `<g data-item="probe-back" data-sel="probe">${probeCarriage()}${armChunk(PROBE_CHUNKS[0][0], PROBE_CHUNKS[0][1], PROBE_Z)}</g>`,
    `<g data-item="gate-back" data-sel="gate">${armChunk(GATE_CHUNKS[0][0], GATE_CHUNKS[0][1], GATE_Z)}</g>`,
    `</g>`,
    ...M.TASKS.map((_, i) => laneSvg(i)),
    `<g data-lane="front">`,
    `<g data-item="probe-front" data-sel="probe">${armChunk(PROBE_CHUNKS[4][0], PROBE_CHUNKS[4][1], PROBE_Z)}${probeTip()}</g>`,
    `<g data-item="gate-front" data-sel="gate">${armChunk(GATE_CHUNKS[4][0], GATE_CHUNKS[4][1], GATE_Z)}${gateRod()}</g>`,
    `</g>`,
    sel("cpu", cpuRail()),
    `<g data-item="cpu" data-sel="cpu">${cpuCarriage()}</g>`,
  ],
});

const CFG = {
  P,
  N, XA, SCALE, LANE_Y, PIN_DY, CABLE_DY, CAB_Z, X_CAP, GEAR_R, DRUM_R, DRUM_Y, DRUM_Z, PINION_X, PINION_R,
  PIN_R, PIN_UP, PIN_DOWN, SLIDER_Z, HEAD_H, ARM_W, PROBE_OFF, PROBE_HOME, CAR_HALF: 9, CLAMP_X: 11,
  INIT_STEPS,
  STEP_SECONDS: 1.9, TOUR_GAP: 0.5, TOUR_REST: 1.6, RESUME: 6,
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
const LANES = Array.from({ length: C.N }, (_, i) => i);
const el = {
  car: LANES.map((i) => q('[data-item="car-' + i + '"]')),
  body: LANES.map((i) => q('[data-body="' + i + '"] .iso-solid')),
  pin: LANES.map((i) => q('[data-item="pin-' + i + '"]')),
  pinBody: LANES.map((i) => q('[data-pinbody="' + i + '"]')),
  probe: [q('[data-item="probe-back"]'), ...LANES.map((i) => q('[data-item="probe-' + i + '"]')), q('[data-item="probe-front"]')],
  gate: [q('[data-item="gatecar"]'), q('[data-item="gate-back"]'), ...LANES.map((i) => q('[data-item="gate-' + i + '"]')), q('[data-item="gate-front"]')],
  cable: LANES.map((i) => q('[data-cable="' + i + '"]')),
  mark: LANES.map((i) => q('[data-mark="' + i + '"]')),
  teeth: LANES.map((i) => q('[data-teeth="' + i + '"]')),
  pinion: q("[data-pinion]"),
  cpu: q('[data-item="cpu"]'),
  lanes: [q('[data-lane="back"]'), ...LANES.map((i) => q('[data-lane="' + i + '"]')), q('[data-lane="front"]')],
};
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
const X = (ns) => C.XA + (C.SCALE * ns) / 1e6;

function initial() { let s = MODEL.makeState(); for (let i = 0; i < C.INIT_STEPS; i++) s = MODEL.step(s); return s; }
let state = initial();
let anim = null; // { from, to, kind, t }

// 드럼 각도는 캐리지 위치에서 정해진다: 감긴 케이블 길이 / 드럼 반지름
const drumAngle = (i, v) => (X(v) - C.XA) / C.DRUM_R[i];
// 정지 자세: 상태 하나로 정해진다 (결정 순간)
function rest(s) {
  return {
    v: s.tasks.map((t) => t.v),
    d: s.tasks.map((t) => t.d),
    up: s.elig.map((e) => (e ? 1 : 0)),
    V: s.V,
    probe: X(s.tasks[s.curr].d) - C.PROBE_OFF,
    cpu: C.DRUM_Y[s.curr],
    lit: s.ran ? s.ran.task : s.curr,
  };
}
// 전이 자세: u = 0..1. 실행(캐리지, 드럼, 게이트) → 마감 갱신 → 자격대로 핀 → 탐침 → CPU
function between(a, b, u, kind) {
  const A = rest(a), B = rest(b);
  if (u >= 1) return B;
  const pose = { ...A, v: [...A.v], d: [...A.d], up: [...A.up] };
  if (kind === "rewind") {
    const t = seg(u, 0.05, 0.6);
    pose.v = A.v.map((v, i) => lerp(v, B.v[i], t));
    pose.d = A.d.map((d, i) => lerp(d, B.d[i], t));
    pose.V = lerp(A.V, B.V, t);
    pose.up = A.up.map((x, i) => lerp(x, B.up[i], seg(u, 0.55, 0.7)));
    pose.probe = u < 0.3 ? lerp(A.probe, C.PROBE_HOME, seg(u, 0, 0.3)) : lerp(C.PROBE_HOME, B.probe, seg(u, 0.7, 0.88));
    pose.cpu = lerp(A.cpu, B.cpu, seg(u, 0.5, 0.95));
    pose.lit = B.lit;
    return pose;
  }
  const c = a.curr;
  const run = seg(u, 0, 0.42);
  pose.v[c] = lerp(A.v[c], B.v[c], run);
  pose.V = lerp(A.V, B.V, run);
  pose.lit = c;
  pose.probe = lerp(A.probe, C.PROBE_HOME, seg(u, 0, 0.2));
  pose.d[c] = lerp(A.d[c], B.d[c], seg(u, 0.44, 0.58));
  pose.up = A.up.map((x, i) => lerp(x, B.up[i], seg(u, 0.6, 0.7)));
  if (u >= 0.7) pose.probe = lerp(C.PROBE_HOME, B.probe, seg(u, 0.7, 0.86));
  pose.cpu = lerp(A.cpu, B.cpu, seg(u, 0.86, 1));
  return pose;
}

// 레인 안의 그리기 순서: 높이가 다른 부품끼리 x로 정한다 (brief.md 부품표 아래 "그리기 순서")
// 캐리지는 늘 핀보다 먼저(핀은 앞 트랙), 팔은 핀보다 왼쪽이면 먼저, 캐리지가 팔보다 완전히 앞이면 팔이 먼저, 게이트와 탐침은 x가 큰 쪽이 나중
function before(a, b) {
  const arm = (it) => it.kind === "probe" || it.kind === "gate";
  if (a.kind === "fixed") return true;
  if (b.kind === "fixed") return false;
  if (a.kind === "car" && b.kind === "pin") return true;
  if (a.kind === "pin" && b.kind === "car") return false;
  if (arm(a) && b.kind === "pin") return a.x < b.x;
  if (a.kind === "pin" && arm(b)) return !(b.x < a.x);
  if (arm(a) && b.kind === "car") return b.x - C.CAR_HALF > a.x + C.ARM_W / 2 + 0.1;
  if (a.kind === "car" && arm(b)) return !(a.x - C.CAR_HALF > b.x + C.ARM_W / 2 + 0.1);
  if (arm(a) && arm(b)) {
    if (a.kind === b.kind) return false;
    const g = a.kind === "gate" ? a : b, p = a.kind === "gate" ? b : a;
    const gateLater = g.x >= p.x;
    return a.kind === "gate" ? !gateLater : gateLater;
  }
  return false;
}
function orderLane(container, items) {
  // 작은 위상 정렬 (항목 4개 안팎)
  const left = [...items];
  const out = [];
  while (left.length) {
    const i = left.findIndex((it) => left.every((o) => o === it || !before(o, it)));
    out.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  const nodes = [...container.children];
  if (out.every((it, i) => nodes[i] === it.node)) return;
  const frag = document.createDocumentFragment();
  out.forEach((it) => frag.appendChild(it.node));
  container.appendChild(frag);
}

function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }
function pinPaths(i, top, tone) {
  const y = C.LANE_Y[i] + C.PIN_DY;
  return solidSvg(cylinder(0, y, C.PIN_R, C.SLIDER_Z[1], top - C.SLIDER_Z[1], P, 16), { tone, crease: "none" }) + solidSvg(cylinder(0, y, 2.2, top, C.HEAD_H, P, 24, 0.3), { tone, crease: "lo" });
}
const shownTop = [];
function teethPath(i, angle) {
  const y = C.DRUM_Y[i];
  const parts = [];
  for (let n = 0; n < 36; n++) {
    const a = angle + (n / 36) * Math.PI * 2;
    parts.push(lineOnTop([C.X_CAP + (C.GEAR_R - 1.3) * Math.cos(a), y + (C.GEAR_R - 1.3) * Math.sin(a)], [C.X_CAP + C.GEAR_R * Math.cos(a), y + C.GEAR_R * Math.sin(a)], C.DRUM_Z[0], P));
  }
  return parts.join("");
}
function draw(pose) {
  const probeX = pose.probe, gateX = X(pose.V);
  let total = 0;
  for (const i of LANES) {
    const vx = X(pose.v[i]);
    put(el.car[i], [vx, 0, 0]);
    put(el.pin[i], [X(pose.d[i]), 0, 0]);
    const top = lerp(C.PIN_DOWN, C.PIN_UP, ease(pose.up[i]));
    if (shownTop[i] !== top) { el.pinBody[i].innerHTML = pinPaths(i, top, pose.up[i] > 0.5 ? "hi" : "mid"); shownTop[i] = top; }
    const y = C.LANE_Y[i] + C.CABLE_DY;
    el.cable[i].setAttribute("d", pathOf([iso([vx + C.CLAMP_X - 0.6, y, C.CAB_Z], P), iso([C.X_CAP + 0.6, y, C.CAB_Z], P)]));
    const angle = drumAngle(i, pose.v[i]);
    total += angle;
    const r = C.DRUM_R[i];
    el.mark[i].setAttribute("d", lineOnTop([C.X_CAP + 0.8 * Math.cos(angle), C.DRUM_Y[i] + 0.8 * Math.sin(angle)], [C.X_CAP + (r + 1.2) * Math.cos(angle), C.DRUM_Y[i] + (r + 1.2) * Math.sin(angle)], C.DRUM_Z[1] + 1.4, P));
    el.teeth[i].setAttribute("d", teethPath(i, angle));
    const lit = i === pose.lit;
    el.body[i].toggleAttribute("data-lit", lit);
    el.car[i].toggleAttribute("data-on", lit);
    const text = (pose.v[i] / 1e6).toFixed(2);
    const dg = digit("v-" + i);
    if (dg.textContent !== text) dg.textContent = text;
  }
  el.probe.forEach((node) => put(node, [probeX, 0, 0]));
  el.gate.forEach((node) => put(node, [gateX, 0, 0]));
  put(el.cpu, [0, pose.cpu, 0]);
  const pa = -total * C.GEAR_R / C.PINION_R;
  el.pinion.setAttribute("d", lineOnTop([C.PINION_X, pose.cpu], [C.PINION_X + (C.PINION_R - 0.6) * Math.cos(pa), pose.cpu + (C.PINION_R - 0.6) * Math.sin(pa)], 5, P));
  // 그리기 순서: 레인 안의 움직이는 부품, 뒤와 앞 영역의 팔
  LANES.forEach((i) => orderLane(el.lanes[i + 1], [
    { kind: "car", x: X(pose.v[i]), node: el.car[i] },
    { kind: "pin", x: X(pose.d[i]), node: el.pin[i] },
    { kind: "probe", x: probeX, node: el.probe[i + 1] },
    { kind: "gate", x: gateX, node: el.gate[i + 2] },
  ]));
  orderLane(el.lanes[0], [{ kind: "fixed", x: 0, node: el.gate[0] }, { kind: "probe", x: probeX, node: el.probe[0] }, { kind: "gate", x: gateX, node: el.gate[1] }]);
  orderLane(el.lanes[C.N + 1], [{ kind: "probe", x: probeX, node: el.probe[C.N + 1] }, { kind: "gate", x: gateX, node: el.gate[C.N + 2] }]);
}

function say() {
  const text = MODEL.readout(state);
  if (readoutEl.textContent !== text) readoutEl.textContent = text;
  return text;
}

// 루프
let frame = 0, last = 0, visible = false, touring = !still.matches, wait = C.TOUR_REST, idleTimer = 0;
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
  if (pinSel && !event.target.closest(".ev-parts, .iso-stage")) { pinSel = null; choose(); }
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
  `${F} .ev-digit{fill:var(--anatomy-mid)}`,
  `${F} .iso-face-text{fill:var(--anatomy-faint)}`,
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
  `${FP} .ev-digit{fill:var(--anatomy-lit)}`,
  `${FP} .iso-face-text{fill:var(--anatomy-hi)}`,
].join("\n");

const css = `<style>
.iso{--ev-win:#0b0b0b}
.iso[data-theme="light"]{--ev-win:#ececea}
.iso-line.ev-win{fill:var(--ev-win)}
.ev-digit{fill:var(--anatomy-hi);font-family:var(--anatomy-mono);font-weight:600}
[data-on] .ev-digit{fill:var(--anatomy-lit)}
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:116%;margin:0 -8%}}
.ev-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.ev-parts{display:flex;flex-wrap:wrap;gap:6px}
.ev-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.ev-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.ev-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.ev-parts button[data-picked] span{color:var(--anatomy-strong)}
.ev-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.ev-note{min-height:4.6em;color:var(--anatomy-text)}
.ev-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="ev-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="ev-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 5",
    title: "EEVDF 레인 선택기",
    hint: "클릭이나 → 결정 하나, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [{ mark: "lit", label: "방금 CPU를 받아 vruntime이 움직인 캐리지" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="EEVDF 레인 선택기. 클릭, 오른쪽 화살표, 스페이스로 스케줄 결정 하나를 진행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="ev-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "EEVDF 레인 선택기", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
