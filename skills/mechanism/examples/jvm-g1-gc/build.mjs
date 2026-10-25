// node build.mjs [--light]: G1 영역 트레이와 피커 (flowcast:mechanism 예제, 합성)
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
const NAME = "jvm-g1-gc";
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
const STARTS = TRACE.filter((s) => s.last && s.last.kind === "start").map((s) => s.last);
const THRESHOLDS = STARTS.map((s) => s.threshold);
const DESIRED = STARTS[0].desired;
const FINAL = TRACE.at(-1);
const PROMOTED_AT = FINAL.items.A.age;
const INIT_STEPS = 23; // 처음 보여줄 상태: GC(2)가 A를 Old 0번 영역에 막 내려놓은 순간
const KB = M.BLOCK_BYTES / 1024;
const MB = M.REGION_BYTES / 1048576;
if (TRACE[INIT_STEPS].last.kind !== "promote" || TRACE[INIT_STEPS].last.id !== "A") throw new Error("initial pose should be the promotion of A");
// 캡션의 숫자는 모델 상수와 같아야 한다
for (const n of [M.JDK, `${M.REGIONS}개`, `${MB}MB`, `${KB}KB`, `${M.BOOT_BYTES}바이트`, `${M.CANARY_BYTES}바이트`, `임계값 ${THRESHOLDS.join(", ")}`]) {
  if (!CAPTION.includes(n)) throw new Error(`caption should say ${n}`);
}

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const PARTS = [
  { id: "trays", name: "트레이", concept: "힙 영역", text: `힙 ${M.REGIONS * MB}MB를 ${MB}MB 영역 ${M.REGIONS}개로 나눈 것입니다. 앞줄로 올수록 번호가 커지고(뒷줄 0~3, 앞줄 12~15), 종류는 정해져 있지 않아 빈 트레이가 그때그때 Eden, Survivor, Old가 돼요.` },
  { id: "flags", name: "라벨 창", concept: "영역 종류", text: "G1이 지금 그 영역을 무엇으로 쓰는지 보여 줍니다. E는 Eden, S는 Survivor, O는 Old, 빈칸은 free예요. young(E, S)은 빈 영역의 위쪽 끝(높은 번호)에서, Old는 아래쪽 끝(0번)에서 꺼냅니다." },
  { id: "garbage", name: "창 없는 블록", concept: "쓰레기", text: `프로그램이 만들자마자 버린 ${KB}KB 배열입니다. G1은 이 블록을 한 번도 건드리지 않고, 살아 있는 것을 다 옮긴 뒤 트레이째 비워요. 숫자가 지워진 창의 블록은 복사가 끝나 전달 포인터만 남은 원본입니다.` },
  { id: "live", name: "창 달린 블록", concept: "살아 있는 객체와 나이", text: `keep 배열이 붙잡고 있는 ${KB}KB 배열 A, B, C입니다. 창의 숫자는 mark word의 나이 비트이고 Survivor로 복사될 때마다 1씩 올라가요. A는 나이 ${PROMOTED_AT}일 때 임계값이 ${THRESHOLDS.at(-1)}로 내려간 세 번째 GC에서 Old로 갔습니다. ${M.MAX_TENURING}번을 채우지 않았어요.` },
  { id: "boot", name: "알갱이 컵", concept: "작은 객체 묶음", text: `JVM과 프로그램이 시작하며 만든 작은 객체 ${M.BOOT_BYTES}바이트를 한 묶음으로 그렸습니다. 첫 Eden 영역 앞머리에 있다가 A와 똑같이 나이를 먹고 함께 승격돼요.` },
  { id: "picker", name: "피커", concept: "GC 워커 1개", text: "GC 워커 스레드 하나입니다(ParallelGCThreads=1). 살아 있는 객체만 하나씩 집어 사본을 만들고, 나이가 임계값보다 작으면 Survivor로, 아니면 Old로 내려놓아요. 원본은 제자리에 둡니다." },
  { id: "gauge", name: "높이 게이지", concept: "직전 나이표 누적", text: `pause를 시작할 때 직전 GC의 나이표를 나이 1부터 더한 바이트입니다. 기준 눈금은 희망 survivor 크기 ${DESIRED}바이트(survivor ${M.MAX_SURVIVOR_REGIONS[0]}영역 x ${M.TARGET_SURVIVOR_RATIO}%)이고, 떠오른 표시가 이 눈금을 넘는 나이에서 슬라이더가 멈춰요.` },
  { id: "slider", name: "임계 나이 슬라이더", concept: "tenuring threshold", text: `young에 남을 수 있는 나이의 상한입니다. pause마다 다시 계산하며 이번 실행에서는 ${THRESHOLDS.join(", ")}였어요. 오른쪽 멈춤쇠가 MaxTenuringThreshold ${M.MAX_TENURING}이라 그 너머로는 가지 않습니다.` },
  { id: "counter", name: "빈 영역 카운터", concept: "free 영역 수", text: "어느 종류로도 쓰이지 않는 빈 영역 수입니다. Eden을 할당하거나 새 Survivor, Old 영역을 열 때 하나씩 줄고, pause 끝에 collection set을 비우면 한꺼번에 늘어요." },
  { id: "cds", name: "아카이브 판", concept: "CDS 아카이브 힙", text: `CDS 아카이브에 미리 만들어 둔 객체 ${M.CDS_BYTES}바이트가 시작할 때 맨 위 두 영역(${M.CDS_REGIONS.join(", ")})에 Old로 매핑됩니다. -Xshare:off로 돌리면 이 두 Old 영역이 없어요.` },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";
// 같은 data-sel을 단 노드가 한 묶음이다. 떨어져 그려지는 부품(트레이 뒤와 앞)은 같은 id로 여러 번 감싼다.
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 380;
const PLATE = { x: -176, y: -104, w: 352, d: 202, r: 9 };
const PLATE_H = 10;
const FOOT_H = 5;

const COLS = 4;
const PITCH_X = 72;
const PITCH_Y = 34;
const TRAY_W = 64;
const TRAY_D = 19;
const RUNNER_TOP = 1.5;
const FLOOR_TOP = 3;
const WALL_TOP = 6;
const WALL_T = 1.4;
const SLOT_P = (TRAY_W - 2 * WALL_T) / M.SLOTS;
const BLOCK = 12.4;
const BH = 9;
const BOOT_H = 7.5;
const trayCenter = (i) => [((i % COLS) - 1.5) * PITCH_X, (Math.floor(i / COLS) - 1.5) * PITCH_Y];
const slotCenter = (i, s) => {
  const [cx, cy] = trayCenter(i);
  return [cx - TRAY_W / 2 + WALL_T + SLOT_P * (s + 0.5), cy];
};

const RAIL_Y = -86;
const RAIL_Z = 64;
const POST_X = [-160, 160];
const ARM_Z = 55;
const ARM_Y0 = RAIL_Y + 7;
const ARM_Y1 = 60;
const CAR_Z = 47;
const CARRY_Z = WALL_TOP + 8; // 옮기는 사본의 바닥 높이 (다른 블록 위를 지난다)
const PARK = [-150, -34];

const AGE_X = (age) => -114 + age * 14.4;
const RULER = { x: -126, y: 80, w: 238, d: 5, r: 0.8 };
const GUIDE = { x: -128, y: 70, w: 242, d: 5, r: 1 };
const GAUGE = { x: 157, y: 74, w: 10, d: 9, r: 1 };
const GAUGE_TOP = 40;
const GAUGE_Z0 = 8;
const GAUGE_PER = 2.4 / 65536; // 64 KiB마다 2.4
const COUNTER = { x: -168, y: 68, w: 26, d: 12, r: 1.5 };
const COUNTER_H = 14;

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [POST_X[0] - 6, RAIL_Y - 4, RAIL_Z + 13], [POST_X[1] + 6, RAIL_Y - 4, RAIL_Z + 13], [GAUGE.x + GAUGE.w, GAUGE.y + GAUGE.d, GAUGE_TOP + 3]],
  WIDTH,
  HEIGHT,
  { pad: 20, azimuth: 58 },
);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;
const faceRect = (u0, v0, w, h) => `M${u0} ${v0}H${u0 + w}V${v0 + h}H${u0}Z`;

// ---- 블록, 컵, 아카이브 판: 빌드와 페이지가 같은 소스로 그린다 (페이지에서는 kit 함수가 전역에 있다) ----
const ITEM = { FLOOR_TOP, BLOCK, BH, BOOT_H, SLOT_P, WALL_T, TRAY_W };
const ITEM_SRC = String.raw`
function g1Window(C, P, x, y, top, v0, h, digit, font) {
  const m = sideMatrix([x - C.BLOCK / 2, y + C.BLOCK / 2], top, P, "left");
  const w = 7.2;
  const u0 = (C.BLOCK - w) / 2;
  const text = digit === null ? "" : '<text class="g1-digit" x="' + (C.BLOCK / 2) + '" y="' + (v0 + h * 0.8).toFixed(2) + '" font-size="' + font + '" text-anchor="middle">' + digit + "</text>";
  return '<g transform="' + m + '"><path class="iso-line g1-win" data-tone="lo" d="M' + u0 + " " + v0 + "h" + w + "v" + h + "h" + -w + 'Z"/>' + text + "</g>";
}
function g1Item(C, P, kind, age, x, y, h, lit) {
  const z0 = C.FLOOR_TOP;
  if (kind === "cds14" || kind === "cds15") {
    const long = kind === "cds14";
    const half = long ? (C.TRAY_W - 2 * C.WALL_T) / 2 - 1.2 : C.BLOCK / 2;
    const cx = long ? x + C.SLOT_P * 1.5 : x;
    const plan = { x: cx - half, y: y - C.BLOCK / 2, w: half * 2, d: C.BLOCK, r: 1 };
    const height = long ? 5 : 1.2;
    const out = [solidSvg(slabOf(plan, z0, height, P, 3, long ? 0.5 : 0), { tone: "mid", crease: "lo" })];
    if (long) {
      out.push(lineSvg(planOutline(insetPlan(plan, 1.8), z0 + height, P, 3), { tone: "faint" }));
      out.push(dotsSvg(dotGrid(plan.x + 3.2, plan.y + 3.2, 18, 3, 3, z0 + height, P), { size: 0.4, tone: "lo" }));
    }
    return out.join("");
  }
  const plan = { x: x - C.BLOCK / 2, y: y - C.BLOCK / 2, w: C.BLOCK, d: C.BLOCK, r: kind === "boot" || kind === "bootstub" ? 1.8 : 1 };
  const cup = kind === "boot" || kind === "bootstub";
  const full = cup ? C.BOOT_H : C.BH;
  const height = Math.max(0.1, full * h);
  const top = z0 + height;
  const dim = kind === "garbage" || kind === "stub" || kind === "bootstub";
  const out = [solidSvg(slabOf(plan, z0, height, P, 3, h > 0.6 ? 0.5 : 0), { tone: dim ? "lo" : "mid", crease: dim ? "faint" : "lo", lit })];
  if (h < 0.6) return out.join("");
  out.push(lineSvg(planOutline(insetPlan(plan, cup ? 1.4 : 2), top, P, 3), { tone: "faint" }));
  if (cup) out.push(dotsSvg(dotGrid(x - 3.6, y - 3.6, 4, 4, 2.4, top, P), { size: 0.5, tone: kind === "boot" ? "mid" : "lo" }));
  if (kind === "block") out.push(g1Window(C, P, x, y, top, 1.2, 4.4, age, 3.8));
  if (kind === "stub") out.push(g1Window(C, P, x, y, top, 1.2, 4.4, null, 3.8));
  if (cup) out.push(g1Window(C, P, x, y, top, 0.8, 3.6, kind === "boot" ? age : null, 3.1));
  return out.join("");
}`;
const g1Item = new Function(...Object.keys(k), `${ITEM_SRC}\nreturn g1Item;`)(...Object.values(k));
const itemOf = (kind, age, x, y, h = 1, lit = false) => g1Item(ITEM, P, kind, age, x, y, h, lit);

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
  const label = { x: 148, y: 4, w: 22, d: 36, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([16, 11, 13].map((w, i) => k.lineOnTop([label.x + 3 + i * 2.2, label.y + 4], [label.x + 3 + i * 2.2, label.y + 4 + w * 1.6], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + 3, label.y + label.d - 3, 0.8]), at([label.x + label.w - 3, label.y + label.d - 3, 0.8])], { size: 0.45 }));
  return out.join("");
}

// 줄 받침: 트레이 네 개가 한 받침 위에 앉는다
function runners() {
  const out = [];
  for (let row = 0; row < 4; row++) {
    const cy = trayCenter(row * COLS)[1];
    const plan = box(-146, cy - 7, 146, cy + 7, 1.5);
    out.push(S(k.slabOf(plan, 0, RUNNER_TOP, P, 3), { tone: "lo", crease: "none" }));
    out.push(D([at([-143, cy - 4, RUNNER_TOP]), at([-143, cy + 4, RUNNER_TOP]), at([143, cy - 4, RUNNER_TOP]), at([143, cy + 4, RUNNER_TOP])], { size: 0.45 }));
  }
  return out.join("");
}

// ---- 레일 기둥과 빔 (맨 뒤) ----
function railPost(x) {
  const out = [];
  const foot = box(x - 9, RAIL_Y - 9, x + 9, RAIL_Y + 9, 1.5);
  out.push(`<path class="iso-halo" d="${k.haloOf(foot, 0, 4, P)}" style="opacity:.6"/>`);
  out.push(S(k.slabOf(foot, 0, 3.5, P, 3, 0.5), { tone: "mid" }));
  out.push(D([at([x - 6, RAIL_Y - 6, 3.5]), at([x + 6, RAIL_Y - 6, 3.5]), at([x - 6, RAIL_Y + 6, 3.5]), at([x + 6, RAIL_Y + 6, 3.5])], { size: 0.45 }));
  const col = box(x - 3.5, RAIL_Y - 3.5, x + 3.5, RAIL_Y + 3.5, 0.8);
  out.push(S(k.slabOf(col, 3.5, RAIL_Z - 3.5, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(col, 30, P, 3), { tone: "faint" }) }));
  // 손나사: 받침 위, 기둥 앞
  out.push(S(k.slabOf(box(x - 1.2, RAIL_Y + 3.5, x + 1.2, RAIL_Y + 5.8, 0.5), 5, 3, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(x, RAIL_Y + 7, 2.4, 3.5, 6, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(x, RAIL_Y + 7, 2.4, 3.5, 9.5, 18, P), { tone: "lo" }));
  return out.join("");
}

function railBeam() {
  const plan = box(-166, RAIL_Y - 4, 166, RAIL_Y + 4, 0.8);
  const out = [S(k.slabOf(plan, RAIL_Z, 6, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, RAIL_Z + 2, P, 3), { tone: "faint" }) })];
  for (const x of [-169, 166]) out.push(S(k.slabOf(box(x, RAIL_Y - 4.6, x + 3, RAIL_Y + 4.6, 0.5), RAIL_Z - 0.6, 7.2, P, 2), { tone: "mid" }));
  out.push(D([-150, -100, -50, 0, 50, 100, 150].map((x) => at([x, RAIL_Y, RAIL_Z + 6])), { size: 0.4, tone: "lo" }));
  return out.join("");
}

// ---- 트레이: 뒤 절반 (바닥, 뒷벽, 왼벽, 자리 홈), 자리, 앞 절반 (오른벽, 앞벽, 라벨 홀더) ----
function trayBack(i) {
  const [cx, cy] = trayCenter(i);
  const plan = box(cx - TRAY_W / 2, cy - TRAY_D / 2, cx + TRAY_W / 2, cy + TRAY_D / 2, 1.2);
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, RUNNER_TOP, 3, P)}" style="opacity:.45"/>`];
  out.push(S(k.slabOf(plan, RUNNER_TOP, FLOOR_TOP - RUNNER_TOP, P, 3), { tone: "mid" }));
  out.push(S(k.slabOf(box(plan.x, plan.y, plan.x + TRAY_W, plan.y + WALL_T, 0.4), FLOOR_TOP, WALL_TOP - FLOOR_TOP, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(box(plan.x, plan.y + WALL_T, plan.x + WALL_T, plan.y + TRAY_D - WALL_T, 0), FLOOR_TOP, WALL_TOP - FLOOR_TOP, P, 2), { tone: "mid", crease: "none" }));
  // 자리 홈: 블록 하나(256KB)가 앉는 자리 네 칸
  const seats = [];
  for (let s = 0; s < M.SLOTS; s++) {
    const [x, y] = slotCenter(i, s);
    seats.push(k.planOutline(box(x - BLOCK / 2 - 0.6, y - BLOCK / 2 - 0.6, x + BLOCK / 2 + 0.6, y + BLOCK / 2 + 0.6, 1.2), FLOOR_TOP, P, 3));
  }
  out.push(L(seats.join(""), { tone: "faint" }));
  return out.join("");
}

function trayFront(i) {
  const [cx, cy] = trayCenter(i);
  const x0 = cx - TRAY_W / 2;
  const x1 = cx + TRAY_W / 2;
  const y1 = cy + TRAY_D / 2;
  const walls = [
    S(k.slabOf(box(x1 - WALL_T, cy - TRAY_D / 2 + WALL_T, x1, y1 - WALL_T, 0), FLOOR_TOP, WALL_TOP - FLOOR_TOP, P, 2), { tone: "mid", crease: "none" }),
    S(k.slabOf(box(x0, y1 - WALL_T, x1, y1, 0.4), FLOOR_TOP, WALL_TOP - FLOOR_TOP, P, 2), { tone: "mid", crease: "none" }),
    D([at([x0 + 1.5, y1, WALL_TOP - 1.4]), at([x1 - 1.5, y1, WALL_TOP - 1.4])], { size: 0.4, tone: "mid" }),
  ];
  return sel("trays", ...walls);
}

// 라벨 창: 트레이 왼쪽 틈에 선 작은 판, 창 글자는 영역 종류 (live 코드가 바꾼다)
function flagPlate(i) {
  const [cx, cy] = trayCenter(i);
  const x0 = cx - TRAY_W / 2 - 7.2;
  const y1 = cy + TRAY_D / 2 - 0.6;
  const top = WALL_TOP + 5.5;
  const plate = box(x0, y1 - 1.2, x0 + 6.4, y1, 0.3);
  const foot = box(x0 - 0.4, y1 - 4.6, x0 + 6.8, y1 + 0.6, 0.6);
  const m = k.sideMatrix([x0, y1], top, P, "left");
  return sel("flags",
    S(k.slabOf(foot, RUNNER_TOP, 1.4, P, 2, 0.3), { tone: "mid" }),
    `<g data-flagbox="${i}">${S(k.slabOf(plate, RUNNER_TOP + 1.4, top - RUNNER_TOP - 1.4, P, 2), { tone: "mid", crease: "none" })}</g>`,
    `<g transform="${m}"><path class="iso-line g1-win" data-tone="lo" d="${faceRect(0.7, 0.8, 5, 4.4)}"/><text class="g1-letter" data-flag="${i}" x="3.2" y="4.35" font-size="3.4" text-anchor="middle">${LETTERS[restPose0.regions[i].type]}</text></g>`,
    D([at([x0 + 3.2, y1, RUNNER_TOP + 3.2])], { size: 0.4, tone: "mid" }));
}

// ---- 앞쪽 띠: 빈 영역 카운터, 임계 나이 자와 슬라이더, 높이 게이지 ----
function counter() {
  const out = [`<path class="iso-halo" d="${k.haloOf(COUNTER, 0, 5, P)}" style="opacity:.6"/>`];
  out.push(`<g data-counterbox>${S(k.slabOf(COUNTER, 0, COUNTER_H, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(COUNTER, 4, P, 3), { tone: "faint" }) })}</g>`);
  const front = COUNTER.y + COUNTER.d;
  const m = k.sideMatrix([COUNTER.x, front], COUNTER_H, P, "left");
  out.push(`<g transform="${m}"><path class="iso-line g1-win" data-tone="lo" d="${faceRect(5, 2.4, 13.4, 6.6)}"/><text class="g1-count" data-counter x="11.7" y="7.9" font-size="5.6" text-anchor="middle">${String(M.counts(restPose0).free).padStart(2, "0")}</text></g>`);
  out.push(D([at([COUNTER.x + 2, front, COUNTER_H - 2]), at([COUNTER.x + COUNTER.w - 2, front, COUNTER_H - 2])], { size: 0.45, tone: "mid" }));
  // 리셋 노브: 함 위
  const [nx, ny] = [COUNTER.x + COUNTER.w - 5.5, COUNTER.y + 6];
  out.push(S(k.cylinder(nx, ny, 3, COUNTER_H, 3.4, P, 24), { tone: "mid" }));
  out.push(L(k.knurl(nx, ny, 3, COUNTER_H, COUNTER_H + 3.4, 20, P), { tone: "lo" }));
  out.push(L(k.planOutline(box(COUNTER.x + 3, COUNTER.y + 3, COUNTER.x + 13, COUNTER.y + 9, 1), COUNTER_H, P, 3), { tone: "faint" }));
  return out.join("");
}

function sliderBed() {
  const out = [];
  out.push(S(k.slabOf(RULER, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const minor = [];
  const major = [];
  for (let age = 0; age <= M.MAX_TENURING; age++) {
    (age % 5 === 0 ? major : minor).push(k.lineOnTop([AGE_X(age), RULER.y + 0.2], [AGE_X(age), RULER.y + (age % 5 === 0 ? 3.4 : 2)], 0.6, P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  out.push(D([at([RULER.x + 1.4, RULER.y + 2.5, 0.6]), at([RULER.x + RULER.w - 1.4, RULER.y + 2.5, 0.6])], { size: 0.4 }));
  out.push(S(k.slabOf(GUIDE, 0, 2.4, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(GUIDE, 1.2, P, 3), { tone: "faint" }) }));
  // 멈춤쇠: 왼쪽은 아직 계산 전(나이 0), 오른쪽은 MaxTenuringThreshold
  for (const x of [AGE_X(0) - 10, AGE_X(M.MAX_TENURING) + 6]) {
    out.push(S(k.slabOf(box(x, GUIDE.y - 1.5, x + 4, GUIDE.y + GUIDE.d + 1.5, 0.6), 0, 6, P, 2, 0.4), { tone: "mid" }));
    out.push(D([at([x + 2, GUIDE.y + 0.5, 6]), at([x + 2, GUIDE.y + GUIDE.d - 0.5, 6])], { size: 0.45 }));
  }
  return out.join("");
}

function sliderBody() {
  const x = AGE_X(0);
  const plan = box(x - 6, GUIDE.y - 2.4, x + 6, GUIDE.y + GUIDE.d + 2, 1.4);
  return [
    `<g data-sliderbox>${S(k.slabOf(plan, 2.4, 5.6, P, 3, 0.5), { tone: "mid" })}</g>`,
    // 포인터 혀: 슬라이더 앞면 아래에서 눈금 띠 위로, 가운데 선이 읽는 나이
    S(k.slabOf(box(x - 1.6, plan.y + plan.d, x + 1.6, RULER.y + 2.6, 0.5), 2.4, 0.7, P, 2), { tone: "mid", crease: "none" }),
    L(k.lineOnTop([x, plan.y + plan.d], [x, RULER.y + 2.6], 3.1, P), { tone: "hi" }),
    S(k.cylinder(x, GUIDE.y + 2.5, 2.4, 8, 3, P, 20), { tone: "mid" }),
    L(k.knurl(x, GUIDE.y + 2.5, 2.4, 8, 11, 16, P), { tone: "lo" }),
  ].join("");
}

function gauge() {
  const out = [];
  const pad = box(GAUGE.x - 5, GAUGE.y - 3, GAUGE.x + GAUGE.w + 5, GAUGE.y + GAUGE.d + 3, 2);
  out.push(`<path class="iso-halo" d="${k.haloOf(pad, 0, 4, P)}" style="opacity:.6"/>`);
  out.push(S(k.slabOf(pad, 0, 3, P, 3, 0.5), { tone: "mid" }));
  out.push(D(k.corners(pad, 2.4).map(([x, y]) => at([x, y, 3])), { size: 0.45 }));
  out.push(S(k.slabOf(GAUGE, 3, GAUGE_TOP - 3, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(GAUGE, 6, P, 3), { tone: "faint" }) }));
  out.push(S(k.slabOf(k.insetPlan(GAUGE, -0.8), GAUGE_TOP, 2.4, P, 3, 0.4), { tone: "mid" }));
  // 앞면 창: 직전 나이표의 누적 바이트를 표시가 오르내리며 보여준다. 눈금은 64 KiB마다, 굵은 눈금은 256 KiB마다
  const front = GAUGE.y + GAUGE.d;
  const m = k.sideMatrix([GAUGE.x, front], GAUGE_TOP, P, "left");
  const v = (z) => GAUGE_TOP - z;
  const top = GAUGE_Z0 + 12 * 65536 * GAUGE_PER;
  const slot = faceRect(2.4, v(top + 1), 3.2, top + 1 - (GAUGE_Z0 - 1));
  const ticks = [];
  const majors = [];
  for (let n = 0; n <= 12; n++) {
    const z = GAUGE_Z0 + n * 65536 * GAUGE_PER;
    (n % 4 === 0 ? majors : ticks).push(`M5.6 ${v(z).toFixed(2)}H${n % 4 === 0 ? 8.4 : 7.2}`);
  }
  const mark = v(GAUGE_Z0 + DESIRED * GAUGE_PER).toFixed(2);
  out.push(
    `<g transform="${m}"><clipPath id="g1-gauge-slot"><path d="${slot}"/></clipPath>` +
      `<path class="iso-line g1-win" data-tone="lo" d="${slot}"/>` +
      `<g clip-path="url(#g1-gauge-slot)"><path class="iso-line g1-float" data-float data-tone="hi" d=""/></g>` +
      `<path class="iso-line" data-tone="lo" d="${ticks.join("")}"/><path class="iso-line" data-tone="mid" d="${majors.join("")}"/>` +
      `<path class="iso-line" data-tone="hi" d="M2.4 ${mark}H9.4"/></g>`,
  );
  return out.join("");
}

// ---- 피커: 트럭, 암, 캐리지 (x=0, y=0에서 한 번 만들고 transform으로 옮긴다) ----
function truck() {
  const out = [];
  const body = box(-11, RAIL_Y - 7, 11, RAIL_Y + 7, 1.5);
  out.push(S(k.slabOf(body, RAIL_Z + 6, 6, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(body, RAIL_Z + 8.5, P, 3), { tone: "faint" }) }));
  const plate = box(-11, RAIL_Y + 4.4, 11, RAIL_Y + 7, 0.6);
  out.push(S(k.slabOf(plate, ARM_Z - 2, RAIL_Z + 6 - ARM_Z + 2, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([-8, RAIL_Y + 7, RAIL_Z + 2]), at([8, RAIL_Y + 7, RAIL_Z + 2]), at([-8, RAIL_Y + 7, ARM_Z + 1]), at([8, RAIL_Y + 7, ARM_Z + 1])], { size: 0.5, tone: "mid" }));
  out.push(S(k.cylinder(0, RAIL_Y, 2.6, RAIL_Z + 12, 3.4, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(0, RAIL_Y, 2.6, RAIL_Z + 12, RAIL_Z + 15.4, 18, P), { tone: "lo" }));
  return out.join("");
}

function arm() {
  const plan = box(-3.5, ARM_Y0, 3.5, ARM_Y1, 0.8);
  return [
    S(k.slabOf(plan, ARM_Z, 5, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(plan, ARM_Z + 1.6, P, 3), { tone: "faint" }) }),
    S(k.slabOf(box(-4.6, ARM_Y1, 4.6, ARM_Y1 + 2.6, 0.6), ARM_Z - 2, 8, P, 2, 0.4), { tone: "mid" }),
    D([at([-2.4, ARM_Y1 + 2.6, ARM_Z + 4]), at([2.4, ARM_Y1 + 2.6, ARM_Z + 4])], { size: 0.45 }),
  ].join("");
}

function carriage() {
  const plan = box(-6.5, -6.5, 6.5, 6.5, 1.2);
  return [
    S(k.slabOf(plan, CAR_Z, ARM_Z - CAR_Z, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, CAR_Z + 2.4, P, 3), { tone: "faint" }) }),
    D([at([-4, 6.5, ARM_Z - 2]), at([4, 6.5, ARM_Z - 2])], { size: 0.5, tone: "mid" }),
  ].join("");
}

function suctionPad() {
  return [
    S(k.cylinder(0, 0, 4.4, 0, 1.4, P, 28), { tone: "lo" }),
    S(k.cylinder(0, 0, 3, 1.4, 2.6, P, 24, 0.3), { tone: "mid" }),
    D([at([0, 0, 4])], { size: 0.5 }),
  ].join("");
}

// ---- 그림 조립 ----
const restPose0 = TRACE[INIT_STEPS];
const SELOF = { block: "live", boot: "boot", garbage: "garbage", stub: "garbage", bootstub: "garbage", cds14: "cds", cds15: "cds" };
const LETTERS = { eden: "E", survivor: "S", old: "O", free: "" };
function slotAt(i, s) {
  const id = restPose0.regions[i].items[s];
  if (!id) return `<g data-slot="${i}.${s}"></g>`;
  const it = restPose0.items[id];
  const kind = it.kind === "cds" ? id : it.kind === "stub" ? (it.of === "boot" ? "bootstub" : "stub") : it.kind;
  const lit = id === restPose0.last.id;
  const [x, y] = slotCenter(i, s);
  return `<g data-slot="${i}.${s}" data-sel="${SELOF[kind]}"${lit ? " data-on" : ""}>${itemOf(kind, it.age, x, y, 1, lit)}</g>`;
}
const order = Array.from({ length: M.REGIONS }, (_, i) => i).sort((a, b) => k.depthOf([...trayCenter(a), 0], P) - k.depthOf([...trayCenter(b), 0], P));
const trays = order.map((i) => {
  const slots = Array.from({ length: M.SLOTS }, (_, s) => slotAt(i, s)).join("");
  return flagPlate(i) + sel("trays", trayBack(i)) + slots + `<g data-layer="tray-${i}"></g>` + trayFront(i);
});

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `G1 힙을 영역 트레이 ${M.REGIONS}개로 그린 기계. 블록이 Eden 트레이로 떨어지고, 뒤 레일에 매달린 피커가 살아 있는 블록만 집어 빈 트레이로 옮기며 나이를 올린다. 앞쪽의 슬라이더가 임계 나이를, 게이지가 직전 나이표의 누적 바이트를, 카운터가 빈 영역 수를 보여준다.`,
  body: [
    base(),
    runners(),
    railPost(POST_X[0]),
    railPost(POST_X[1]),
    railBeam(),
    ...trays,
    `<g data-layer="high"><g data-part="mover" style="display:none"></g>${groupAt([0, 0, 0], suctionPad(), ` data-part="pad" data-sel="picker"`)}<g data-part="rod" data-sel="picker"></g></g>`,
    sel("counter", counter()),
    sel("slider", sliderBed()),
    groupAt([0, 0, 0], sliderBody(), ` data-part="slider" data-sel="slider"`),
    sel("gauge", gauge()),
    groupAt([0, 0, 0], truck(), ` data-part="truck" data-sel="picker"`),
    groupAt([0, 0, 0], carriage(), ` data-part="carriage" data-sel="picker"`),
    groupAt([0, 0, 0], arm(), ` data-part="arm" data-sel="picker"`),
  ],
});

const CFG = {
  P, ITEM,
  SLOT: Array.from({ length: M.REGIONS }, (_, i) => Array.from({ length: M.SLOTS }, (_, s) => slotCenter(i, s))),
  FLOOR_TOP, WALL_TOP, BH, BOOT_H, CARRY_Z, CAR_Z, PARK, AGE0: AGE_X(0), AGE_STEP: AGE_X(1) - AGE_X(0),
  GAUGE_TOP, GAUGE_Z0, GAUGE_PER, INIT_STEPS,
  TIME: { alloc: 0.9, start: 1.5, copy: 1.9, end: 1.3, rewind: 1.2 }, TOUR_GAP: 0.5, TOUR_REST: 1.8, RESUME: 6,
};

const live = `
${ITEM_SRC}
const C = ${JSON.stringify(CFG)};
const P = C.P;
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const q = (s) => svg.querySelector(s);
const readoutEl = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const el = {
  mover: q('[data-part="mover"]'), pad: q('[data-part="pad"]'), rod: q('[data-part="rod"]'),
  truck: q('[data-part="truck"]'), carriage: q('[data-part="carriage"]'), arm: q('[data-part="arm"]'),
  slider: q('[data-part="slider"]'), sliderBox: q("[data-sliderbox] .iso-solid"), float: q("[data-float]"),
  counter: q("[data-counter]"), counterBox: q("[data-counterbox] .iso-solid"), high: q('[data-layer="high"]'),
  slots: C.SLOT.map((row, i) => row.map((_, s) => q('[data-slot="' + i + "." + s + '"]'))),
  layers: C.SLOT.map((_, i) => q('[data-layer="tray-' + i + '"]')),
  flags: C.SLOT.map((_, i) => q('[data-flag="' + i + '"]')),
  flagBoxes: C.SLOT.map((_, i) => q('[data-flagbox="' + i + '"] .iso-solid')),
};
const PARTS = ${JSON.stringify(PARTS)};
const NOTE_IDLE = ${JSON.stringify(NOTE_IDLE)};
const note = document.querySelector("[data-note]");
const picks = [...document.querySelectorAll("[data-pick]")];
// 호버가 우선이고, 호버가 없으면 번호로 고른 것(pin)을 보여준다
let hoverSel = null, pinSel = null, shownSel = null;
const picked = () => hoverSel ?? pinSel;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const seg = (u, a, b) => ease((u - a) / (b - a));
const lerp = (a, b, t) => a + (b - a) * t;
const LETTER = { eden: "E", survivor: "S", old: "O", free: "" };
const SELOF = ${JSON.stringify(SELOF)};
const heightOf = (kind) => (kind === "boot" ? C.BOOT_H : C.BH);

function initial() { let s = MODEL.makeState(); for (let i = 0; i < C.INIT_STEPS; i++) s = MODEL.step(s); return s; }
let state = initial();
let anim = null; // { from, to, kind, t }
const kindOf = (s, id) => { const it = s.items[id]; return it.kind === "cds" ? id : it.kind === "stub" ? (it.of === "boot" ? "bootstub" : "stub") : it.kind; };
// 움직인 부품이 없는 상태(entry)의 lit: 다음 STEP이 E로 바꿀 트레이의 라벨 창
function nextRegion(s) { if (s.last || s.done) return null; return MODEL.step(s).last.region; }

// 정지 자세: 상태 하나로 정해진다
function rest(s) {
  const L = s.last;
  const litItem = L && (L.kind === "copy" || L.kind === "promote") ? L.id : null;
  const slots = s.regions.map((r) => C.SLOT[0].map((_, i) => {
    const id = r.items[i];
    if (!id) return null;
    const it = s.items[id];
    return { id, kind: kindOf(s, id), age: it.age, lit: id === litItem, h: 1, dz: 0 };
  }));
  const litFlag = L ? (L.kind === "alloc" ? L.region : null) : nextRegion(s);
  const flags = s.regions.map((r, i) => ({ letter: LETTER[r.type], lit: i === litFlag }));
  const dest = litItem ? C.SLOT[L.to][s.items[L.id].slot] : C.PARK;
  const top = litItem ? C.CARRY_Z + heightOf(s.items[L.id].kind) : C.CARRY_Z + C.BH;
  return {
    slots, flags, mover: null,
    gx: dest[0], gy: dest[1], pad: top,
    slider: s.threshold ?? 0, sliderLit: !!L && L.kind === "start",
    cum: s.cum, counter: MODEL.counts(s).free, counterLit: !!L && L.kind === "end",
  };
}

// 전이 자세: 직전 상태에서 다음 상태로, u = 0..1
function between(a, b, u, kind) {
  if (u >= 1) return rest(b);
  const pose = rest(a);
  pose.slots.forEach((row) => row.forEach((slot) => slot && (slot.lit = false)));
  pose.flags.forEach((f) => (f.lit = false));
  pose.sliderLit = false;
  pose.counterLit = false;
  const park = (from, to) => { const t = seg(u, from, to); pose.gx = lerp(pose.gx, C.PARK[0], t); pose.gy = lerp(pose.gy, C.PARK[1], t); pose.pad = lerp(pose.pad, C.CARRY_Z + C.BH, t); };
  if (kind === "rewind") {
    const sink = 1 - seg(u, 0, 0.6);
    pose.slots.forEach((row) => row.forEach((slot) => { if (slot && !slot.kind.startsWith("cds")) slot.h = sink; }));
    if (u >= 0.6) { const r = rest(b); pose.slots = r.slots; pose.flags = r.flags; pose.counter = r.counter; }
    pose.slider = lerp(pose.slider, 0, seg(u, 0.2, 0.9));
    pose.cum = lerp(a.cum, 0, seg(u, 0.2, 0.9));
    park(0, 0.8);
    return pose;
  }
  const L = b.last;
  if (L.kind === "alloc") {
    const r = rest(b);
    if (u >= 0.06) { pose.flags[L.region] = { letter: "E", lit: true }; pose.counter = r.counter; }
    pose.slots[L.region] = r.slots[L.region].map((slot, i) => {
      if (!slot) return null;
      const t = clamp01((u - 0.12 - i * 0.12) / 0.34);
      if (t <= 0) return null;
      return { ...slot, dz: 22 * (1 - t * t) };
    });
    park(0, 0.6);
  } else if (L.kind === "start") {
    pose.sliderLit = true;
    const table = b.tables[L.gc - 1] ?? {};
    // 나이 0에서 출발해 한 칸씩 나이표 바이트를 더하고, 희망 크기를 넘는 나이(또는 최대값)에서 멈춘다
    const from = a.threshold ?? 0;
    const span = Math.max(0.3, (0.7 * L.threshold) / 15);
    if (u < 0.2) { pose.slider = lerp(from, 0, seg(u, 0, 0.2)); pose.cum = lerp(a.cum, 0, seg(u, 0, 0.2)); }
    else {
      pose.slider = L.threshold * clamp01((u - 0.2) / span);
      const f = Math.floor(pose.slider + 1e-6);
      const lo = MODEL.cumulative(table, f);
      pose.cum = f >= L.threshold ? lo : lo + (MODEL.cumulative(table, f + 1) - lo) * ease(pose.slider - f);
    }
    park(0, 0.5);
  } else if (L.kind === "copy" || L.kind === "promote") {
    const it = b.items[L.id];
    const kindNow = it.kind;
    const src = C.SLOT[L.from][a.items[L.id].slot];
    const dst = C.SLOT[L.to][it.slot];
    const h = heightOf(kindNow);
    const travel = C.CARRY_Z + h;
    const seat = C.FLOOR_TOP + h;
    let mover = null;
    if (u < 0.24) { const t = seg(u, 0, 0.24); pose.gx = lerp(pose.gx, src[0], t); pose.gy = lerp(pose.gy, src[1], t); pose.pad = lerp(pose.pad, travel, t); }
    else if (u < 0.34) { pose.gx = src[0]; pose.gy = src[1]; pose.pad = lerp(travel, seat, seg(u, 0.24, 0.34)); }
    else if (u < 0.44) { pose.gx = src[0]; pose.gy = src[1]; pose.pad = lerp(seat, travel, seg(u, 0.34, 0.44)); }
    else if (u < 0.7) { const t = seg(u, 0.44, 0.7); pose.gx = lerp(src[0], dst[0], t); pose.gy = lerp(src[1], dst[1], t); pose.pad = travel; }
    else if (u < 0.82) { pose.gx = dst[0]; pose.gy = dst[1]; pose.pad = lerp(travel, seat, seg(u, 0.7, 0.82)); }
    else { pose.gx = dst[0]; pose.gy = dst[1]; pose.pad = lerp(seat, travel, seg(u, 0.82, 1)); }
    if (u >= 0.34) {
      // 집는 순간 사본이 생긴다: 원본 자리에는 숫자 지운 블록, 사본에는 새 나이
      const stub = b.items[L.id + "@" + L.from];
      pose.slots[L.from][stub.slot] = { id: stub.id, kind: kindNow === "boot" ? "bootstub" : "stub", age: null, lit: false, h: 1, dz: 0 };
      if (u < 0.82) mover = { kind: kindNow, age: it.age, x: pose.gx, y: pose.gy, z: pose.pad - h, region: u < 0.58 ? L.from : L.to };
    }
    if (u >= 0.44 && L.fresh) { pose.flags[L.to] = { letter: L.kind === "copy" ? "S" : "O", lit: false }; pose.counter = rest(b).counter; }
    if (u >= 0.82) pose.slots[L.to][it.slot] = { id: L.id, kind: kindNow, age: it.age, lit: true, h: 1, dz: 0 };
    pose.mover = mover;
  } else if (L.kind === "end") {
    const sink = 1 - seg(u, 0.05, 0.6);
    for (const r of L.freed) pose.slots[r].forEach((slot) => slot && (slot.h = sink));
    if (u >= 0.6) { for (const r of L.freed) { pose.flags[r] = { letter: "", lit: false }; pose.slots[r] = pose.slots[r].map(() => null); } pose.counter = rest(b).counter; pose.counterLit = true; }
    park(0, 0.6);
  }
  return pose;
}

const shown = { slots: C.SLOT.map((row) => row.map(() => "")), flags: [], counter: null, moverKey: "" };
function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }
function draw(pose) {
  pose.slots.forEach((row, i) => row.forEach((slot, s) => {
    const node = el.slots[i][s];
    const key = slot ? [slot.kind, slot.age, slot.lit, slot.h.toFixed(3)].join("|") : "";
    if (shown.slots[i][s] !== key) {
      shown.slots[i][s] = key;
      if (!slot || slot.h <= 0.02) { node.innerHTML = ""; delete node.dataset.sel; node.removeAttribute("data-on"); }
      else {
        const [x, y] = C.SLOT[i][s];
        node.innerHTML = g1Item(C.ITEM, P, slot.kind, slot.age, x, y, slot.h, slot.lit);
        node.dataset.sel = SELOF[slot.kind];
        node.toggleAttribute("data-on", slot.lit);
        if (shownSel) node.toggleAttribute("data-picked", node.dataset.sel === shownSel);
      }
    }
    const dz = slot && slot.dz ? translateAlong(P, [0, 0, slot.dz]) : "";
    if ((node.getAttribute("transform") ?? "") !== dz) dz ? node.setAttribute("transform", dz) : node.removeAttribute("transform");
  }));
  pose.flags.forEach((f, i) => {
    if (el.flags[i].textContent !== f.letter) el.flags[i].textContent = f.letter;
    el.flagBoxes[i].toggleAttribute("data-lit", f.lit);
    el.flags[i].toggleAttribute("data-on", f.lit);
  });
  const text = String(pose.counter).padStart(2, "0");
  if (el.counter.textContent !== text) el.counter.textContent = text;
  el.counterBox.toggleAttribute("data-lit", pose.counterLit);
  el.counter.toggleAttribute("data-on", pose.counterLit);
  put(el.slider, [C.AGE_STEP * pose.slider, 0, 0]);
  el.sliderBox.toggleAttribute("data-lit", pose.sliderLit);
  const fz = C.GAUGE_Z0 + pose.cum * C.GAUGE_PER;
  el.float.setAttribute("d", "M2.4 " + (C.GAUGE_TOP - fz - 0.9).toFixed(2) + "H5.6V" + (C.GAUGE_TOP - fz + 0.9).toFixed(2) + "H2.4Z");
  put(el.truck, [pose.gx, 0, 0]);
  put(el.arm, [pose.gx, 0, 0]);
  put(el.carriage, [pose.gx, pose.gy, 0]);
  put(el.pad, [pose.gx, pose.gy, pose.pad]);
  const rodFrom = pose.pad + 4;
  el.rod.innerHTML = solidSvg(cylinder(pose.gx, pose.gy, 1.4, rodFrom, C.CAR_Z - rodFrom, P, 16), { tone: "mid", crease: "none" });
  const m = pose.mover;
  el.mover.style.display = m ? "" : "none";
  if (m) {
    const key = m.kind + "|" + m.age;
    if (shown.moverKey !== key) { shown.moverKey = key; el.mover.innerHTML = g1Item(C.ITEM, P, m.kind, m.age, 0, 0, 1, true); el.mover.dataset.sel = SELOF[m.kind]; }
    put(el.mover, [m.x, m.y, m.z - C.FLOOR_TOP]);
    // 트레이 벽보다 낮으면 그 트레이의 자리 다음, 앞벽 앞에 그린다. 높으면 모든 트레이 위에 그린다
    const host = m.z < C.WALL_TOP + 0.5 ? el.layers[m.region] : el.high;
    if (el.mover.parentNode !== host) host === el.high ? el.high.insertBefore(el.mover, el.high.firstChild) : host.appendChild(el.mover);
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
  anim = { from, to, kind, t: 0, seconds: C.TIME[kind === "rewind" ? "rewind" : to.last.kind === "promote" ? "copy" : to.last.kind] };
  if (still.matches) { anim = null; draw(rest(to)); }
  run();
}
function advance() {
  if (state.done) return false;
  const from = state;
  state = MODEL.step(state);
  say();
  begin(from, state, "step");
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
  svg.querySelectorAll("[data-sel]").forEach((g) => g.toggleAttribute("data-picked", g.dataset.sel === id));
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
  if (pinSel && !event.target.closest(".g1-parts, .iso-stage")) { pinSel = null; choose(); }
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
  `${F} .g1-digit,${F} .g1-letter,${F} .g1-count{fill:var(--anatomy-mid)}`,
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
  `${FP} .g1-digit,${FP} .g1-letter,${FP} .g1-count{fill:var(--anatomy-lit)}`,
].join("\n");

const css = `<style>
.iso{--g1-win:#0b0b0b}
.iso[data-theme="light"]{--g1-win:#ececea}
.iso-line.g1-win{fill:var(--g1-win)}
.iso-line.g1-float{fill:var(--anatomy-hi)}
.g1-digit,.g1-letter,.g1-count{fill:var(--anatomy-hi);font-family:var(--anatomy-mono);font-weight:600}
.g1-letter{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-weight:700}
[data-on] .g1-digit,[data-part="mover"] .g1-digit,.g1-letter[data-on],.g1-count[data-on]{fill:var(--anatomy-lit)}
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:118%;margin:0 -9%}}
.g1-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.g1-parts{display:flex;flex-wrap:wrap;gap:6px}
.g1-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.g1-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.g1-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.g1-parts button[data-picked] span{color:var(--anatomy-strong)}
.g1-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.g1-note{min-height:4.6em;color:var(--anatomy-text)}
.g1-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="g1-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="g1-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 6",
    title: "G1 영역 트레이와 피커",
    hint: "클릭이나 → 한 단계, Home 처음",
    readout: M.readout(restPose0),
    keys: [{ mark: "lit", label: "지금 움직인 부품: 옮겨진 사본, 슬라이더, 막 Eden이 된 라벨 창, 카운터" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="G1 영역 트레이와 피커. 클릭, 오른쪽 화살표, 스페이스로 한 단계(Eden 영역 할당, pause 시작, 객체 하나 복사, collection set 해제)를 진행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="g1-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "G1 영역 트레이와 피커", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
