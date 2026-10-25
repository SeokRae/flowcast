// node build.mjs [--light]: 시스템 콜 창구 (flowcast:mechanism 예제, 합성)
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
const NAME = "linux-syscall";
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
const INIT_STEPS = 8; // 처음 보여줄 상태: read의 dispatch (캐리지가 63번 칸 카드를 읽는 순간)
if (TRACE[INIT_STEPS].stage !== "dispatch" || TRACE[INIT_STEPS].x8 !== 63) throw new Error("initial pose should be read's dispatch");
const EMPTY = M.EMPTY_RUNS.reduce((n, [a, b]) => n + b - a + 1, 0);
const runText = M.EMPTY_RUNS.map(([a, b]) => `${a}~${b}번(${b - a + 1}칸)`).join("과 ");
const call = (nr) => M.CALLS.find((c) => c.nr === nr);
const ret = (nr) => M.handlerResult(nr, call(nr).x0);
const READ = 63;
const GAP = M.CALLS.find((c) => M.isEmptySlot(c.nr)).nr;
const OUT = M.CALLS.find((c) => c.nr >= M.NR_SYSCALLS).nr;
const hex = (v) => `0x${v.toString(16)}`;

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const PARTS = [
  { id: "dial", name: "x8 카운터", concept: "시스템 콜 번호 x8", text: `사용자 코드가 svc 직전에 번호를 x8에 싣습니다. arm64는 x86-64와 달리 공용 표 scripts/syscall.tbl의 번호를 써서 read는 ${READ}번, getpid는 ${M.CALLS[0].nr}번이에요. glibc 2.41의 read 래퍼는 ${READ}을 먼저 x6에 넣고, 내부 함수가 x8로 옮긴 뒤 svc를 실행합니다.` },
  { id: "x0", name: "x0 창", concept: "첫 인자이자 반환값 x0", text: `들어갈 때는 첫 인자(read의 fd ${call(READ).x0})이고 나올 때는 반환값이라, 커널은 덮어쓰기 전에 원래 값을 orig_x0에 따로 적어 둡니다. 실패는 음수 errno 그대로 돌아와요(${ret(READ)}, ${ret(GAP)}). glibc가 -${M.MAX_ERRNO}~-1 범위를 보고 -1과 errno ${-ret(READ)}로 바꿉니다.` },
  { id: "args", name: "인자 칸", concept: `x1~x${M.ARG_REGS - 1}`, text: `나머지 인자 ${M.ARG_REGS - 1}개 자리입니다. read(${call(READ).x0}, buf, 8)이면 x1에 버퍼 주소, x2에 8이 들어가요. 커널 쪽 __arm64_sys_* 래퍼가 pt_regs의 x0~x${M.ARG_REGS - 1}를 C 인자로 펼칩니다.` },
  { id: "drawer", name: "서랍과 손잡이", concept: "svc #0, 레지스터 묶음(pt_regs)", text: `손잡이를 미는 동작이 svc #0입니다. EL1에 들어가면 kernel_entry가 x0~x29와 돌아갈 주소를 커널 스택의 pt_regs(${hex(M.PT_REGS_SIZE)}바이트)에 저장해요. 커널은 이 사본을 읽고 쓰고, eret 직전에 레지스터로 되돌립니다.` },
  { id: "glass", name: "방탄유리 칸막이", concept: "EL0와 EL1의 경계", text: "사용자 코드(EL0)는 커널 메모리를 읽거나 커널 함수를 직접 부를 수 없습니다. 이쪽에서 저쪽으로 가는 길은 예외뿐이고, 시스템 콜은 svc 명령이 일으키는 동기 예외예요." },
  { id: "gate", name: "입구 셔터", concept: `예외 벡터 VBAR_EL1 + ${hex(M.VECTOR_OFFSET)}`, text: `번호와 상관없이 모든 svc가 같은 입구로 들어옵니다. VBAR_EL1 + ${hex(M.VECTOR_OFFSET)}의 벡터 항목이 el0t_64_sync로 분기하고, el0t_64_sync_handler가 ESR_EL1의 EC ${hex(M.EC_SVC64)}(SVC64)를 보고 el0_svc로 보내요.` },
  { id: "el", name: "EL 셔틀", concept: "CPU가 실행 중인 예외 수준", text: "svc가 CPU를 EL1로 올리고 eret이 EL0로 내립니다. 셔틀은 레지스터 묶음이 커널 쪽에 있는 동안만 커널 쪽 끝에 있어요." },
  { id: "carriage", name: "선택 캐리지", concept: "invoke_syscall", text: `do_el0_svc가 pt_regs의 x8을 번호로 넘기면, invoke_syscall은 번호가 ${M.NR_SYSCALLS}보다 작은지 보고 표에서 함수를 꺼내 pt_regs만 넘겨 부릅니다. 돌려받은 값은 pt_regs의 x0 자리에 써요. ftrace 스택에는 ${M.ENTRY_CHAIN.join(", ")} 순서로 찍히고, 인라인된 el0_svc_common은 보이지 않습니다.` },
  { id: "rack", name: "카드 랙", concept: `sys_call_table (${M.NR_SYSCALLS}칸)`, text: `칸 번호가 곧 시스템 콜 번호인 함수 포인터 표입니다. 표 길이 ${M.NR_SYSCALLS}칸은 scripts/syscall.tbl의 마지막 번호 ${M.NR_SYSCALLS - 1}에 1을 더한 값이에요. 상수 배열이라 호출할 때 고쳐지지 않고, 칸막이 선은 8칸마다, 탭은 64칸마다입니다.` },
  { id: "blank", name: "빈 카드", concept: `번호 없는 칸 ${EMPTY}개`, text: `${runText}은 번호가 배정되지 않아 __arm64_sys_ni_syscall을 가리킵니다. 부르면 -ENOSYS(${-M.ERRNO.ENOSYS})가 와요. 번호는 있지만 이 빌드 설정에서 빠진 칸(예: ${M.NR_SYSCALLS - 1}번 rseq_slice_yield)도 약한 스텁이 같은 값을 돌려줍니다.` },
  { id: "stop", name: "끝 멈춤쇠", concept: "표 길이 검사", text: `${M.NR_SYSCALLS} 이상이면 표를 읽지 않고 do_ni_syscall로 가서 sys_ni_syscall이 -ENOSYS를 돌려줍니다. ${GAP}번과 ${OUT}번은 같은 ${ret(OUT)}을 받지만, ftrace에는 앞의 것만 __arm64_sys_ni_syscall을 거친 것으로 남아요.` },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";
// 같은 data-sel을 단 노드가 한 묶음이다. 떨어져 그려지는 부품(칸막이, 캐리지 앞뒤)은 같은 id로 여러 번 감싼다.
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 330;
const LP = { x0: -118, x1: -12, x2: 176, y0: -80, y1: -20, y2: 52 }; // L자 바닥판: 부스(뒤, 랙)와 카운터(왼쪽 앞, 칸막이와 서랍)
const PLATE_H = 10;
const FOOT_H = 5;

// 칸막이 (y = -4..4)
const WALL = { y0: -4, y1: 4, knee: 16, rail: [16, 19], header: [46, 50], front: 3 };
const SLOT = [-94, -30];
const WALL_X = [-116, -12]; // 칸막이는 카운터 폭만큼: 그 오른쪽 부스 앞은 잘라 낸 단면처럼 열어 둔다
const POSTS = [WALL_X[0], WALL_X[1] - 4]; // 기둥 왼쪽 x, 폭 4
const SHUTTER = { x0: SLOT[0], x1: SLOT[1], y0: -6.4, y1: -5.2, z: 0.6, h: 15, lift: 17 };

// 서랍 (지역 좌표, yD만큼 옮긴다)
const REST = 24;
const DOCK = -48;
const X0_BLOCK = { x0: -70, x1: -58 };
const X0_TOP = 12.5;
const PARK = (X0_BLOCK.x0 + X0_BLOCK.x1) / 2;

// 랙
const PITCH = 0.32;
const TABLE_W = M.NR_SYSCALLS * PITCH;
const DECK = { y0: -60, y1: -36, base: 2.5, top: 15, empty: 8 };
const CARD = { y0: -57, y1: -39, h: 12 };
const POP = 13;
const STOP = { x0: TABLE_W, x1: TABLE_W + 6.5 };
const NI = { x: (STOP.x0 + STOP.x1) / 2, top: 22.4, h: 9, pop: 9 };

// 갠트리와 캐리지
const BEAM = { x0: -114, x1: 174, y0: -51, y1: -45, z: 52, h: 6 };
const CAR_Z = 42; // 캐리지 몸통 바닥
const HEAD_UP = 34; // 헤드 접점의 쉬는 높이
const HEAD_H = 5.3;
const ROD_Y = -48;
const EL_Y = 9; // 셔틀: +9 = EL0, -9 = EL1
const EL_X = -62;

const P = k.fitProjection(
  [[LP.x0, LP.y2, -PLATE_H - FOOT_H], [LP.x1, LP.y2, -PLATE_H - FOOT_H], [LP.x2, LP.y1, -PLATE_H - FOOT_H], [LP.x2, LP.y0, 0], [LP.x0, LP.y0, 0], [BEAM.x0, BEAM.y0, BEAM.z + BEAM.h + 6], [BEAM.x1, BEAM.y0, BEAM.z + BEAM.h + 6], [LP.x2, LP.y0, BEAM.z]],
  WIDTH,
  HEIGHT,
  { pad: 20, azimuth: 60 },
);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
const slab = (plan, z, h, style, steps = 3, bevel = 0) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;
const seg3 = (a, b) => k.pathOf([at(a), at(b)]);
// 수직면(y = const) 위 닫힌 사각 테두리
const frontRect = (x0, x1, y, z0, z1) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);

// ---- L자 바닥판 ----
function lRing(d, r, rc, steps) {
  const x0 = LP.x0 + d, x1 = LP.x1 - d, x2 = LP.x2 - d, y0 = LP.y0 + d, y1 = LP.y1 - d, y2 = LP.y2 - d;
  const verts = [[x0, y0, r], [x2, y0, r], [x2, y1, r], [x1, y1, rc], [x1, y2, r], [x0, y2, r]];
  const unit = (x, y) => { const l = Math.hypot(x, y); return [x / l, y / l]; };
  const out = [];
  verts.forEach(([vx, vy, rad], i) => {
    const [px, py] = verts[(i + verts.length - 1) % verts.length];
    const [nx, ny] = verts[(i + 1) % verts.length];
    const u1 = unit(px - vx, py - vy);
    const u2 = unit(nx - vx, ny - vy);
    const cx = vx + (u1[0] + u2[0]) * rad;
    const cy = vy + (u1[1] + u2[1]) * rad;
    const a0 = Math.atan2(vy + u1[1] * rad - cy, vx + u1[0] * rad - cx);
    let da = Math.atan2(vy + u2[1] * rad - cy, vx + u2[0] * rad - cx) - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let s = 0; s <= steps; s++) out.push([cx + rad * Math.cos(a0 + (da * s) / steps), cy + rad * Math.sin(a0 + (da * s) / steps)]);
  });
  return out;
}

function base() {
  const booth = box(LP.x0, LP.y0, LP.x2, LP.y1, 8);
  const counter = box(LP.x0, LP.y1, LP.x1, LP.y2, 8);
  const out = [`<path class="iso-halo" d="${k.haloOf(booth, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`, `<path class="iso-halo" d="${k.haloOf(counter, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`];
  const feet = [[LP.x0 + 20, LP.y0 + 20], [LP.x2 - 20, LP.y0 + 20], [LP.x2 - 20, LP.y1 - 20], [LP.x1 - 20, LP.y2 - 20], [LP.x0 + 20, LP.y2 - 20]];
  for (const [x, y] of byDepth(feet)) {
    out.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.extrude(lRing(0, 8, 3, 8), -PLATE_H, PLATE_H, P, { convex: false }), { tone: "mid" }));
  out.push(L(k.onTop(lRing(4, 4, 7, 6), 0, P, true), { tone: "lo" }));
  const screws = [[LP.x0 + 9, LP.y0 + 9], [LP.x2 - 9, LP.y0 + 9], [LP.x2 - 9, LP.y1 - 9], [LP.x1 - 9, LP.y2 - 9], [LP.x0 + 9, LP.y2 - 9]];
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  // 서랍이 쉬는 자리 (카운터 위 얕은 홈)
  out.push(L(k.planOutline(box(-93, REST - 18, -31, REST + 20, 2), 0, P, 3), { tone: "faint" }));
  // 라벨판: 규칙선 3줄은 인쇄된 글자를 뜻한다 (free)
  const label = box(-114, 22, -95, 34, 1.2);
  out.push(slab(label, 0, 0.8, { tone: "lo", crease: "none" }, 3));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([12, 9, 11].map((w, i) => k.lineOnTop([label.x + 3, label.y + 3.4 + i * 2.6], [label.x + 3 + w, label.y + 3.4 + i * 2.6], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 2.6, label.y + 2.4, 0.8]), at([label.x + label.w - 2.6, label.y + label.d - 2.4, 0.8])], { size: 0.45 }));
  return out.join("");
}

// ---- 서랍 레일, 도킹 자리 ----
function rails() {
  const out = [];
  for (const x of [-82, -44]) {
    out.push(slab(box(x, DOCK - 18, x + 2, 46, 0.4), 0, 1.6, { tone: "mid" }, 2));
    out.push(D([-60, -30, 0, 30].map((y) => at([x + 1, y, 1.6])), { size: 0.35, tone: "lo" }));
    out.push(slab(box(x - 1, 43, x + 3, 46, 0.6), 0, 2.4, { tone: "mid" }, 2));
  }
  return out.join("");
}

function bayBack() {
  const out = [];
  const bumper = box(-86, DOCK - 21, -38, DOCK - 18, 0.8);
  out.push(slab(bumper, 0, 8, { tone: "mid" }, 3, 0.4));
  for (const x of [-78, -52]) out.push(slab(box(x, DOCK - 18, x + 6, DOCK - 17, 0.3), 3, 3, { tone: "lo" }, 2));
  out.push(D([at([-84, DOCK - 19.5, 8]), at([-40, DOCK - 19.5, 8])], { size: 0.45 }));
  out.push(slab(box(-94, DOCK - 20, -92, DOCK + 18, 0.4), 0, 5, { tone: "mid" }, 2));
  return out.join("");
}
const bayFront = () => slab(box(-32, DOCK - 20, -30, DOCK + 18, 0.4), 0, 5, { tone: "mid" }, 2);

// ---- 갠트리 ----
function gantryPost(x) {
  const out = [];
  const foot = box(x - 7, -56, x + 7, -40, 1.5);
  out.push(`<path class="iso-halo" d="${k.haloOf(foot, 0, 4, P)}" style="opacity:.5"/>`);
  out.push(slab(foot, 0, 4, { tone: "mid" }, 3, 0.5));
  out.push(D([at([x - 4.5, -53, 4]), at([x + 4.5, -53, 4]), at([x - 4.5, -43, 4]), at([x + 4.5, -43, 4])], { size: 0.45 }));
  const post = box(x - 3, -52, x + 3, -44, 0.8);
  out.push(S(k.slabOf(post, 4, BEAM.z - 4, P, 3, 0.4), { tone: "mid", inner: L(k.sideSeam(post, 30, P, 3), { tone: "faint" }) }));
  // 손나사: 받침 위, 기둥 앞
  out.push(slab(box(x - 1.2, -44, x + 1.2, -41.6, 0.5), 5, 3, { tone: "mid", crease: "none" }, 2));
  out.push(S(k.cylinder(x, -40.4, 2.4, 4, 5.5, P, 20), { tone: "mid" }));
  out.push(L(k.knurl(x, -40.4, 2.4, 4, 9.5, 18, P), { tone: "lo" }));
  return out.join("");
}

function beam() {
  const plan = box(BEAM.x0, BEAM.y0, BEAM.x1, BEAM.y1, 0.8);
  const out = [S(k.slabOf(plan, BEAM.z, BEAM.h, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, BEAM.z + 2, P, 3), { tone: "faint" }) })];
  for (const x of [BEAM.x0 - 2, BEAM.x1]) out.push(slab(box(x, BEAM.y0 - 0.6, x + 2, BEAM.y1 + 0.6, 0.5), BEAM.z - 0.6, BEAM.h + 1.2, { tone: "mid" }, 2));
  out.push(D([-90, -40, 10, 60, 110, 150].map((x) => at([x, BEAM.y1 - 3, BEAM.z + BEAM.h])), { size: 0.4, tone: "lo" }));
  // 구동 랙: 빔 앞면에 붙은 톱니 띠, 캐리지가 이것을 물고 간다
  const strip = box(-100, BEAM.y1, 160, BEAM.y1 + 0.6, 0);
  const teeth = k.sideTicks(-99, 159, 2, 1000, BEAM.y1 + 0.6, BEAM.z + 2.4, [2, 2], P);
  out.push(S(k.slabOf(strip, BEAM.z + 0.4, 2, P, 1), { tone: "mid", crease: "lo", inner: L(teeth.minor + teeth.major, { tone: "lo" }) }));
  // 오른쪽 끝 널링 노브 (빔 위)
  const kx = 167;
  out.push(S(k.cylinder(kx, -48, 2.2, BEAM.z + BEAM.h, 1.6, P, 20), { tone: "mid" }));
  out.push(S(k.cylinder(kx, -48, 3.8, BEAM.z + BEAM.h + 1.6, 4, P, 28), { tone: "mid" }));
  out.push(L(k.knurl(kx, -48, 3.8, BEAM.z + BEAM.h + 1.6, BEAM.z + BEAM.h + 5.6, 26, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([kx, -48], [kx + 3.8, -48], BEAM.z + BEAM.h + 5.6, P), { tone: "hi" }));
  out.push(D([at([kx, -48, BEAM.z + BEAM.h + 5.6])], { size: 0.5, tone: "hi" }));
  return out.join("");
}

// 캐리지 (x = 0에서 만들고 옮긴다)
function carriageBack() {
  const out = [];
  out.push(slab(box(-6, -54, 6, -51.4, 0.5), BEAM.z, 4, { tone: "mid" }, 2));
  const body = box(-8, -54, 8, -42, 1);
  out.push(S(k.slabOf(body, CAR_Z, BEAM.z - CAR_Z, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(body, CAR_Z + 3, P, 3), { tone: "faint" }) }));
  out.push(D([at([-5, -42, BEAM.z - 2.4]), at([5, -42, BEAM.z - 2.4]), at([-5, -42, CAR_Z + 1.4]), at([5, -42, CAR_Z + 1.4])], { size: 0.45, tone: "mid" }));
  return out.join("");
}
const carriageFront = () => [slab(box(-6, -44.6, 6, -42, 0.5), BEAM.z, 5, { tone: "mid" }, 2), D([at([-3.6, -42, BEAM.z + 2.5]), at([3.6, -42, BEAM.z + 2.5])], { size: 0.45 })].join("");
function head() {
  return [
    slab(box(-3, -51, 3, -45, 0.6), 0, 0.8, { tone: "lo" }, 2),
    S(k.slabOf(box(-3.5, -51.5, 3.5, -44.5, 0.8), 0.8, HEAD_H - 0.8, P, 3, 0.4), { tone: "mid" }),
    D([at([-2, -44.5, 3.2]), at([2, -44.5, 3.2])], { size: 0.4 }),
  ].join("");
}

// ---- 랙 (sys_call_table) ----
const xOf = (nr) => (nr + 0.5) * PITCH;
function deckRuns() {
  const runs = [];
  let start = 0;
  for (let n = 1; n <= M.NR_SYSCALLS; n++) {
    if (n === M.NR_SYSCALLS || M.isEmptySlot(n) !== M.isEmptySlot(start)) {
      runs.push({ a: start, b: n - 1, empty: M.isEmptySlot(start) });
      start = n;
    }
  }
  return runs;
}
function rack() {
  const out = [];
  const trough = box(-3, -63, TABLE_W, -33, 0.6);
  out.push(sel("rack",
    `<path class="iso-halo" d="${k.haloOf(trough, 0, 4, P)}" style="opacity:.6"/>`,
    slab(trough, 0, DECK.base, { tone: "mid" }, 3, 0.4),
    slab(box(-3, -63, TABLE_W, -61.5, 0.4), DECK.base, 6.5, { tone: "mid" }, 2),
    slab(box(-3, -61.5, -1.5, -34.5, 0), DECK.base, 6.5, { tone: "mid" }, 2)));
  const empty = [];
  for (const run of deckRuns()) {
    const x0 = run.a * PITCH;
    const x1 = (run.b + 1) * PITCH;
    const top = run.empty ? DECK.empty : DECK.top;
    const lines = [];
    // 8칸마다 칸막이: 윗면을 가로지르고 앞면을 따라 내려간다 (카드 가장자리 묶음)
    for (let n = Math.ceil(run.a / 8) * 8; n <= run.b; n += 8) if (n > run.a) lines.push(k.pathOf([at([n * PITCH, DECK.y0, top]), at([n * PITCH, DECK.y1, top]), at([n * PITCH, DECK.y1, DECK.base])]));
    const svg = S(k.slabOf(box(x0, DECK.y0, x1, DECK.y1, 0), DECK.base, top - DECK.base, P, 2), { tone: run.empty ? "mid" : "hi", crease: run.empty ? "faint" : "lo", inner: L(lines.join(""), { tone: "faint" }) });
    const tabs = [];
    for (let n = Math.ceil(run.a / 64) * 64; n <= run.b; n += 64) if (n > 0) tabs.push(slab(box(n * PITCH, DECK.y0, n * PITCH + 1.6, DECK.y0 + 2.4, 0.2), top, 2.2, { tone: run.empty ? "mid" : "hi", crease: "none" }, 2));
    out.push(run.empty ? sel("blank", svg, ...tabs) : sel("rack", svg, ...tabs));
    if (run.empty) empty.push(run);
  }
  out.push(sel("rack", slab(box(-1.5, -34.5, TABLE_W, -33, 0.3), DECK.base, 3.5, { tone: "mid" }, 2)));
  // 눈금 띠: 8칸마다 작은 눈금, 64칸마다 큰 눈금, 0번 칸 표시
  const strip = box(0, -31.6, TABLE_W, -28.6, 0.4);
  const t = k.topTicks(8 * PITCH, TABLE_W, 8 * PITCH, 8, strip.y + 0.2, 0.6, [1.1, 2.2], P);
  out.push(sel("rack",
    slab(strip, 0, 0.6, { tone: "lo", crease: "none" }, 2),
    L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }),
    L(k.lineOnTop([0.2, strip.y + 0.2], [0.2, strip.y + strip.d - 0.2], 0.6, P), { tone: "hi" })));
  return out.join("");
}

function endStop() {
  const plan = box(STOP.x0, -63, STOP.x1, -33, 0.8);
  const holder = box(NI.x - 1.8, -58, NI.x + 1.8, -38, 0.6);
  return [
    `<path class="iso-halo" d="${k.haloOf(plan, 0, 4, P)}" style="opacity:.6"/>`,
    S(k.slabOf(plan, 0, 20, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(plan, 6, P, 3), { tone: "faint" }) }),
    D([at([STOP.x0 + 1.6, -61, 20]), at([STOP.x1 - 1.6, -61, 20]), at([STOP.x0 + 1.6, -35, 20]), at([STOP.x1 - 1.6, -35, 20])], { size: 0.45 }),
    D([at([STOP.x0 + 2, -33, 13]), at([STOP.x1 - 2, -33, 13])], { size: 0.45, tone: "mid" }),
    slab(holder, 20, NI.top - 20, { tone: "mid" }, 2),
    L(k.planOutline(box(NI.x - 0.5, CARD.y0 - 0.4, NI.x + 0.5, CARD.y1 + 0.4, 0.2), NI.top, P, 2), { tone: "lo" }),
  ].join("");
}

// 솟는 카드: 지역 x = 0, 아랫면 z = 0. 덱 윗면 아래는 클립으로 가린다
function cardSvg(h) {
  return S(k.slabOf(box(-PITCH / 2, CARD.y0, PITCH / 2, CARD.y1, 0), 0, h, P, 1), { tone: "hi", crease: "lo" });
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
// 카드 면(+x 쪽)의 밑변보다 위만 보이게 하는 클립 (live 코드도 같은 식을 쓴다)
const cardClipD = (x, top) => {
  const pts = [];
  for (const cx of [x - 0.8, x + PITCH / 2]) for (const y of [CARD.y0 - 1, CARD.y1 + 1]) for (const z of [top, top + 40]) pts.push(at([cx, y, z]));
  return k.pathOf(hull(pts), true);
};

// ---- 서랍 (yD = 0에서 만들고 y로 옮긴다) ----
let clipCount = 0;
const WHEEL = { w: 3.6, h: 5, gap: 0.9, z: 11.6, font: 4.2 };
// 앞면(y = 6) 평면 위 창 하나: 지역 u = x, v = 아래
function windowSvg(x0, w, wheel) {
  const id = `lx-clip-${clipCount++}`;
  const m = k.sideMatrix([x0, 6], WHEEL.z, P, "left");
  const rect = `M0 0H${w}V${WHEEL.h}H0Z`;
  const base = WHEEL.h / 2 + WHEEL.font * 0.36;
  return `<g transform="${m}"><clipPath id="${id}"><path d="${rect}"/></clipPath><path class="iso-line lx-win" data-tone="lo" d="${rect}"/>` +
    `<g clip-path="url(#${id})"><g data-wheel="${wheel}"><text class="lx-digit" data-a x="${w / 2}" y="${base}" font-size="${WHEEL.font}" text-anchor="middle"></text>` +
    `<text class="lx-digit" data-b x="${w / 2}" y="${base + WHEEL.h + 1}" font-size="${WHEEL.font}" text-anchor="middle"></text></g></g></g>`;
}
function drawer() {
  const out = [];
  const tray = [
    slab(box(-90, -16, -34, 16, 1.2), 1.6, 1.6, { tone: "hi", crease: "lo" }, 3),
    slab(box(-90, -16, -34, -14.6, 0.4), 3.2, 5.8, { tone: "hi", crease: "lo" }, 2),
    slab(box(-90, -14.6, -88.6, 16, 0), 3.2, 5.8, { tone: "hi", crease: "lo" }, 2),
  ];
  out.push(sel("drawer", `<g data-lit-key="drawer">${tray.join("")}</g>`));
  // x8 카운터: 세 자리 창
  const dial = box(-87, -6, -72, 6, 0.8);
  const wheels = [0, 1, 2].map((i) => windowSvg(-87 + 1.2 + i * (WHEEL.w + WHEEL.gap), WHEEL.w, i)).join("");
  out.push(sel("dial", `<g data-lit-key="dial" data-on-key="dial">${S(k.slabOf(dial, 3.2, 9.3, P, 3, 0.4), { tone: "hi", crease: "lo" })}${wheels}</g>`));
  // x0 블록: 창 하나
  const x0 = box(X0_BLOCK.x0, -6, X0_BLOCK.x1, 6, 0.8);
  out.push(sel("x0", `<g data-lit-key="x0" data-on-key="x0">${S(k.slabOf(x0, 3.2, X0_TOP - 3.2, P, 3, 0.4), { tone: "hi", crease: "lo" })}${windowSvg(X0_BLOCK.x0 + 1, X0_BLOCK.x1 - X0_BLOCK.x0 - 2, "x0")}</g>`));
  // x1..x5 캡
  const caps = [];
  for (let i = 0; i < M.ARG_REGS - 1; i++) {
    const cx0 = -56 + i * 4;
    caps.push(slab(box(cx0, -5, cx0 + 3.4, 5, 0.5), 3.2, 5.3, { tone: "hi", crease: "lo" }, 2, 0.3));
    caps.push(D([at([cx0 + 1.7, 0, 8.5])], { size: 0.45, tone: "mid" }));
  }
  out.push(sel("args", ...caps));
  const front = [
    slab(box(-35.4, -14.6, -34, 16, 0), 3.2, 5.8, { tone: "hi", crease: "lo" }, 2),
    slab(box(-91, 16, -33, 18.4, 0.8), 1.6, 5.4, { tone: "hi", crease: "lo" }, 3, 0.4),
  ];
  const handle = [
    slab(box(-68, 18.4, -66, 22, 0.4), 3, 2, { tone: "mid" }, 2),
    slab(box(-58, 18.4, -56, 22, 0.4), 3, 2, { tone: "mid" }, 2),
    S(k.slabOf(box(-70, 22, -54, 24, 1), 2.6, 2.8, P, 3, 0.3), { tone: "mid" }),
  ];
  out.push(sel("drawer", `<g data-lit-key="drawer">${front.join("")}</g>`, D([at([-86, 18.4, 5]), at([-38, 18.4, 5])], { size: 0.45 }), ...handle));
  return out.join("");
}

// ---- 칸막이 ----
const kneeLeft = () => [S(k.slabOf(box(WALL_X[0], WALL.y0, SLOT[0], WALL.y1, 0.6), 0, WALL.knee, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(box(WALL_X[0], WALL.y0, SLOT[0], WALL.y1, 0.6), 4, P, 3), { tone: "faint" }) }), D([-110, -100].map((x) => at([x, WALL.y1, 10])), { size: 0.45, tone: "mid" })].join("");
function kneeRight() {
  const plan = box(SLOT[1], WALL.y0, WALL_X[1], WALL.y1, 0.6);
  return [
    S(k.slabOf(plan, 0, WALL.knee, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, 4, P, 3), { tone: "faint" }) }),
    D([-25, -17].map((x) => at([x, WALL.y1, 10])), { size: 0.45, tone: "mid" }),
  ].join("");
}
const guide = (x) => S(k.slabOf(box(x, -8, x + 4, WALL.y0, 0.4), 0, 33, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(box(x, -8, x + 4, WALL.y0, 0.4), 16, P, 2), { tone: "faint" }) });
function frame() {
  const out = [];
  const rail = box(WALL_X[0], -3, WALL_X[1], 3, 0.4);
  out.push(S(k.slabOf(rail, WALL.rail[0], WALL.rail[1] - WALL.rail[0], P, 2, 0.4), { tone: "mid" }));
  for (const x of POSTS) out.push(S(k.slabOf(box(x, -3, x + 4, 3, 0.4), WALL.rail[1], WALL.header[0] - WALL.rail[1], P, 2), { tone: "mid", crease: "none" }));
  // 유리판: 앞면(y = 3) 평면, 반사선은 아래 가로대 모서리에서 헤더 모서리까지
  const [z0, z1] = [WALL.rail[1], WALL.header[0]];
  const panes = [];
  const glints = [];
  for (let i = 0; i < POSTS.length - 1; i++) {
    const xa = POSTS[i] + 4;
    const xb = POSTS[i + 1];
    panes.push(k.pathOf([at([xa, WALL.front, z0]), at([xb, WALL.front, z0]), at([xb, WALL.front, z1]), at([xa, WALL.front, z1])], true));
    const g = xa + 6; // 반사선은 판의 왼쪽 끝: 뒤에 보이는 서랍을 가로지르지 않게
    glints.push(seg3([g, WALL.front, z0], [g + 12, WALL.front, z1]), seg3([g + 5, WALL.front, z0], [g + 11, WALL.front, z0 + (z1 - z0) * 0.5]));
  }
  out.push(`<path class="lx-glass" d="${panes.join("")}"/>`);
  out.push(L(glints.filter((_, i) => i % 2 === 0).join(""), { tone: "lo" }));
  out.push(L(glints.filter((_, i) => i % 2 === 1).join(""), { tone: "lo", free: "end" }));
  const header = box(WALL_X[0], -3, WALL_X[1], 3, 0.6);
  out.push(S(k.slabOf(header, WALL.header[0], WALL.header[1] - WALL.header[0], P, 2, 0.4), { tone: "mid", inner: L(k.sideSeam(header, WALL.header[0] + 1.4, P, 2), { tone: "faint" }) }));
  out.push(D(POSTS.map((x) => at([x + 2, 3, WALL.header[0] + 2.6])), { size: 0.45, tone: "mid" }));
  return out.join("");
}
function shutter() {
  const plan = box(SHUTTER.x0, SHUTTER.y0, SHUTTER.x1, SHUTTER.y1, 0.3);
  return [
    S(k.slabOf(plan, 0, SHUTTER.h, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(plan, 5, P, 2) + k.sideSeam(plan, 10, P, 2), { tone: "faint" }) }),
    slab(box(-70, SHUTTER.y1, -54, SHUTTER.y1 + 1.4, 0.5), 1.2, 1.8, { tone: "mid" }, 2),
  ].join("");
}
function elRail() {
  const out = [];
  out.push(slab(box(EL_X - 3, -14, EL_X + 3, 14, 0.4), WALL.header[1], 1.4, { tone: "mid" }, 2));
  for (const y of [-14, 12.6]) out.push(slab(box(EL_X - 3, y, EL_X + 3, y + 1.4, 0.3), WALL.header[1] + 1.4, 2.6, { tone: "mid" }, 2));
  return out.join("");
}
const shuttleSvg = () => [S(k.slabOf(box(EL_X - 4, -3, EL_X + 4, 3, 0.8), WALL.header[1] + 1.4, 3.8, P, 3, 0.4), { tone: "hi", crease: "lo" }), D([at([EL_X, 3, WALL.header[1] + 3.3])], { size: 0.5, tone: "hi" })].join("");

// ---- 그림 조립 ----
const NI_BASE = NI.top - NI.h;
const niClip = `<clipPath id="lx-ni-clip"><path d="${cardClipD(NI.x, NI.top)}"/></clipPath>`;
const deckClip = `<clipPath id="lx-card-clip"><path d="${cardClipD(xOf(63), DECK.top)}"/></clipPath>`;
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `방탄유리 칸막이로 나뉜 창구 기계. 왼쪽 앞 카운터의 서랍에는 번호 카운터와 x0 창, 인자 칸이 실려 있고, 서랍은 칸막이 아래 셔터를 지나 뒤쪽 커널 부스로 들어간다. 부스에는 ${M.NR_SYSCALLS}칸 카드 랙과 끝 멈춤쇠가 있고, 위 빔에 매달린 캐리지가 번호의 카드를 읽은 뒤 서랍의 x0 창에 결과를 찍는다.`,
  body: [
    base(),
    sel("drawer", rails(), bayBack()),
    gantryPost(-107),
    rack(),
    sel("stop", endStop(), niClip, `<g clip-path="url(#lx-ni-clip)"><g data-part="ni" data-lit-key="ni" transform="">${groupAt([NI.x, 0, NI_BASE], cardSvg(NI.h))}</g></g>`),
    deckClip,
    `<g clip-path="url(#lx-card-clip)"><g data-part="card" data-sel="rack" data-lit-key="card" style="display:none" transform="">${cardSvg(CARD.h)}</g></g>`,
    gantryPost(167),
    sel("glass", kneeLeft()),
    sel("gate", guide(SLOT[0] - 4)),
    groupAt([0, REST, 0], drawer(), ` data-part="drawer"`),
    sel("drawer", bayFront()),
    `<g data-part="rod" data-sel="carriage"></g>`,
    groupAt([PARK, 0, HEAD_UP], head(), ` data-part="head" data-sel="carriage"`),
    groupAt([PARK, 0, 0], carriageBack(), ` data-part="car" data-sel="carriage"`),
    beam(),
    groupAt([PARK, 0, 0], carriageFront(), ` data-part="car-front" data-sel="carriage"`),
    groupAt([0, 0, SHUTTER.z], shutter(), ` data-part="shutter" data-sel="gate"`),
    sel("gate", guide(SLOT[1])),
    sel("glass", kneeRight(), frame()),
    sel("el", elRail()),
    groupAt([0, EL_Y, 0], shuttleSvg(), ` data-part="shuttle" data-sel="el"`),
  ],
});

const CFG = {
  P, PITCH, CARD, POP, NI, DECK_TOP: DECK.top, EMPTY_TOP: DECK.empty, END_X: NI.x, NI_BASE,
  REST, DOCK, PARK, HEAD_UP, HEAD_H, X0_TOP, CAR_Z, ROD_Y, LIFT: SHUTTER.lift, SHUTTER_Z: SHUTTER.z, EL_Y,
  WHEEL_STEP: WHEEL.h + 1, INIT_STEPS,
  SECONDS: { load: 0.75, svc: 1.2, dispatch: 1.25, return: 1.5, eret: 1.2, rewind: 0.8 },
  TOUR_GAP: 0.7, TOUR_REST: 1.6, RESUME: 6,
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
  drawer: q('[data-part="drawer"]'), shutter: q('[data-part="shutter"]'), shuttle: q('[data-part="shuttle"]'),
  car: q('[data-part="car"]'), carFront: q('[data-part="car-front"]'), head: q('[data-part="head"]'), rod: q('[data-part="rod"]'),
  card: q('[data-part="card"]'), cardClip: q('#lx-card-clip path'), ni: q('[data-part="ni"]'),
};
const litGroups = [...svg.querySelectorAll("[data-lit-key]")];
const wheels = { d: [0, 1, 2].map((i) => q('[data-wheel="' + i + '"]')), x0: q('[data-wheel="x0"]') };
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
let anim = null; // { from, to, kind, t, seconds }
const digits = (v) => (v === null ? ["", "", ""] : String(v).padStart(3, "0").split(""));
const x0Text = (v) => (v === null ? "" : String(v));
const STAGE_LIT = { entry: "dial", load: "dial", svc: "drawer", dispatch: "card", return: "x0", eret: "drawer" };
// 캐리지가 갈 곳: 표 안이면 그 칸, 표 밖이면 끝 멈춤쇠 위 ni 카드
function target(s) {
  if (s.x8 === null) return null;
  if (s.x8 >= MODEL.NR_SYSCALLS) return { x: C.END_X, kind: "ni", top: C.NI.top, read: C.NI.top + C.NI.pop };
  const top = MODEL.isEmptySlot(s.x8) ? C.EMPTY_TOP : C.DECK_TOP;
  return { x: (s.x8 + 0.5) * C.PITCH, kind: "deck", top, read: top + C.POP };
}

// 정지 자세: 상태 하나로 정해진다
function rest(s) {
  const t = s.stage === "dispatch" ? target(s) : null;
  return {
    drawerY: s.side === "kernel" ? C.DOCK : C.REST,
    shutter: 0,
    shuttleY: s.el ? -C.EL_Y : C.EL_Y,
    carX: t ? t.x : C.PARK,
    head: t ? t.read : C.HEAD_UP,
    card: t ? { ...t, rise: 1 } : null,
    x8: [digits(s.x8), digits(s.x8), 1],
    x0: [x0Text(s.x0), x0Text(s.x0), 1],
    lit: STAGE_LIT[s.stage],
  };
}

// 전이 자세: 직전 상태에서 다음 상태로, u = 0..1
function between(a, b, u, kind) {
  if (u >= 1) return rest(b);
  const pose = rest(a);
  if (kind === "rewind" || b.stage === "load") {
    pose.x8 = [digits(a.x8), digits(b.x8), seg(u, 0, 0.6)];
    pose.x0 = [x0Text(a.x0), x0Text(b.x0), seg(u, 0.3, 0.85)];
    pose.lit = "dial";
  } else if (b.stage === "svc" || b.stage === "eret") {
    const ra = rest(a), rb = rest(b);
    pose.shutter = u < 0.82 ? seg(u, 0, 0.2) : 1 - seg(u, 0.82, 1);
    pose.drawerY = lerp(ra.drawerY, rb.drawerY, seg(u, 0.18, 0.8));
    pose.shuttleY = lerp(ra.shuttleY, rb.shuttleY, seg(u, 0.42, 0.68));
    pose.lit = "drawer";
  } else if (b.stage === "dispatch") {
    const t = target(b);
    pose.carX = lerp(C.PARK, t.x, seg(u, 0, 0.55));
    pose.card = { ...t, rise: seg(u, 0.5, 0.7) };
    pose.head = lerp(C.HEAD_UP, t.read, seg(u, 0.6, 0.76));
    pose.lit = "card";
  } else if (b.stage === "return") {
    const t = target(a);
    pose.carX = lerp(t.x, C.PARK, seg(u, 0.14, 0.62));
    pose.card = { ...t, rise: 1 - seg(u, 0.06, 0.24) };
    if (u < 0.14) pose.head = lerp(t.read, C.HEAD_UP, seg(u, 0, 0.12));
    else if (u < 0.64) pose.head = C.HEAD_UP;
    else if (u < 0.84) pose.head = lerp(C.HEAD_UP, C.X0_TOP, seg(u, 0.64, 0.78));
    else pose.head = lerp(C.X0_TOP, C.HEAD_UP, seg(u, 0.84, 1));
    pose.x0 = [x0Text(a.x0), x0Text(b.x0), seg(u, 0.77, 0.86)];
    pose.lit = u < 0.24 ? "card" : u >= 0.77 ? "x0" : null;
  }
  return pose;
}

function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }
function roll(wheel, from, to, t) {
  const a = wheel.querySelector("[data-a]"), b = wheel.querySelector("[data-b]");
  const moving = from !== to && t > 0 && t < 1;
  const top = moving ? from : t >= 1 ? to : from;
  if (a.textContent !== top) a.textContent = top;
  const next = moving ? to : "";
  if (b.textContent !== next) b.textContent = next;
  wheel.setAttribute("transform", moving ? "translate(0 " + (-C.WHEEL_STEP * t).toFixed(3) + ")" : "");
}
function clipFor(x, top) {
  const pts = [];
  for (const cx of [x - 0.8, x + C.PITCH / 2]) for (const y of [C.CARD.y0 - 1, C.CARD.y1 + 1]) for (const z of [top, top + 40]) pts.push(iso([cx, y, z], P));
  pts.sort((p, r) => p[0] - r[0] || p[1] - r[1]);
  const cross = (o, p, r) => (p[0] - o[0]) * (r[1] - o[1]) - (p[1] - o[1]) * (r[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (const p of [...pts].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return pathOf([...lo.slice(0, -1), ...up.slice(0, -1)], true);
}
let clipKey = "";
function draw(pose) {
  put(el.drawer, [0, pose.drawerY, 0]);
  put(el.shutter, [0, 0, C.SHUTTER_Z + pose.shutter * C.LIFT]);
  put(el.shuttle, [0, pose.shuttleY, 0]);
  put(el.car, [pose.carX, 0, 0]);
  put(el.carFront, [pose.carX, 0, 0]);
  put(el.head, [pose.carX, 0, pose.head]);
  const rodFrom = pose.head + C.HEAD_H;
  el.rod.innerHTML = solidSvg(cylinder(pose.carX, C.ROD_Y, 1.2, rodFrom, C.CAR_Z - rodFrom, P, 16), { tone: "mid", crease: "none" });
  const c = pose.card;
  const deck = c && c.kind === "deck" && c.rise > 0;
  el.card.style.display = deck ? "" : "none";
  if (deck) {
    const key = c.x + ":" + c.top;
    if (key !== clipKey) { el.cardClip.setAttribute("d", clipFor(c.x, c.top)); clipKey = key; }
    put(el.card, [c.x, 0, c.top + C.POP * c.rise - C.CARD.h]);
  }
  put(el.ni, [0, 0, c && c.kind === "ni" ? C.NI.pop * c.rise : 0]);
  const lit = pose.lit === "card" && c && c.kind === "ni" ? "ni" : pose.lit;
  litGroups.forEach((g) => {
    const on = g.dataset.litKey === lit;
    g.toggleAttribute("data-on", on);
    g.querySelectorAll(".iso-solid").forEach((s) => s.toggleAttribute("data-lit", on));
  });
  wheels.d.forEach((w, i) => roll(w, pose.x8[0][i], pose.x8[1][i], pose.x8[2]));
  roll(wheels.x0, pose.x0[0], pose.x0[1], pose.x0[2]);
}

function say() {
  const text = MODEL.readout(state);
  if (readoutEl.textContent !== text) readoutEl.textContent = text;
  return text;
}

// 루프
let frame = 0, last = 0, visible = false, touring = !still.matches, wait = C.TOUR_REST, idleTimer = 0;
function begin(from, to, kind = "step") {
  anim = { from, to, kind, t: 0, seconds: C.SECONDS[kind === "rewind" ? "rewind" : to.stage] };
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
  if (pinSel && !event.target.closest(".lx-parts, .iso-stage")) { pinSel = null; choose(); }
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
  `${F} .lx-digit{fill:var(--anatomy-mid)}`,
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
  `${FP} .lx-digit{fill:var(--anatomy-lit)}`,
  `${FP}.lx-glass,${FP} .lx-glass{fill-opacity:calc(var(--lx-glass-o) * 2)}`,
].join("\n");

const css = `<style>
.iso{--lx-win:#0b0b0b;--lx-glass:#d8dde2;--lx-glass-o:.045}
.iso[data-theme="light"]{--lx-win:#ececea;--lx-glass:#76808a;--lx-glass-o:.075}
.iso-line.lx-win{fill:var(--lx-win)}
.lx-glass{fill:var(--lx-glass);fill-opacity:var(--lx-glass-o);stroke:none;pointer-events:none}
.lx-digit{fill:var(--anatomy-hi);font-family:var(--anatomy-mono);font-weight:600}
[data-on] .lx-digit{fill:var(--anatomy-lit)}
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:106%;margin:0 -3%}}
.lx-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.lx-parts{display:flex;flex-wrap:wrap;gap:6px}
.lx-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.lx-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.lx-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.lx-parts button[data-picked] span{color:var(--anatomy-strong)}
.lx-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.lx-note{min-height:4.6em;color:var(--anatomy-text)}
.lx-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="lx-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="lx-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 3",
    title: "시스템 콜 창구",
    hint: "클릭이나 → 한 단계, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [{ mark: "lit", label: "지금 움직인 부품: 바뀐 x8 카운터, 오가는 서랍, 읽는 카드, 값이 찍힌 x0 블록" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="시스템 콜 창구. 클릭, 오른쪽 화살표, 스페이스로 경계 넘기 한 단계를 진행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="lx-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "시스템 콜 창구", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
