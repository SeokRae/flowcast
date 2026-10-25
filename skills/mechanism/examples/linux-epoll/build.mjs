// node build.mjs [--light]: 파이프 교환대, poll과 epoll (flowcast:mechanism 예제, 합성)
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
const NAME = "linux-epoll";
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
const INIT_STEPS = 8; // 처음 보여줄 상태: epoll 등록 뒤 2번과 5번에 쓴 순간, 카드 두 장이 레인에 섰다 (trace[8])
const LINES = Array.from({ length: M.N }, (_, i) => i);
if (TRACE.some((s) => s.data.some((d) => d > 1))) throw new Error("the figure draws at most one chip per pipe");
if (TRACE[INIT_STEPS].ready.join() !== M.READY.join()) throw new Error("initial pose should show the ready cards");
const FIRST_POLL = TRACE.find((s) => s.last && s.last.ins.op === "poll").last;
const WAKE_POLL = TRACE.find((s) => s.last && s.last.pollwake).last;
const FIRST_WAIT = TRACE.find((s) => s.last && s.last.ins.op === "epoll_wait").last;

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const PARTS = [
  { id: "pipe", name: "홈통과 칩", concept: "파이프와 그 버퍼", text: `파이프 ${M.N}개입니다. 뒤쪽 끝으로 들어오는 칩 하나가 write 1바이트이고, 앞쪽 끝에 머문 칩은 아직 읽지 않은 데이터예요. read가 칩을 앞으로 빼냅니다.` },
  { id: "jack", name: "잭", concept: "pipe_poll", text: "파일마다 하나 있는 poll 메서드(파이프는 pipe_poll)입니다. 탐침이 꽂힐 때마다 한 번 불려서 칩이 있는지 답해요. poll도 epoll도 결국 이 잭에 묻습니다." },
  { id: "probe", name: "탐침 캐리지", concept: "커널이 파일에 묻는 일", text: `계수 창은 이번 단계에서 잭을 꽂은 횟수(pipe_poll)입니다. poll은 호출마다 ${M.N}개를 다 꽂고, 잠들었다 깨면 ${WAKE_POLL.visits.length}개를 한 번 더 꽂아요. epoll_wait는 레인에 선 카드의 잭만 꽂습니다. 파이프 ${M.SCALE.n}개로 재면 poll 한 번에 ${M.SCALE.pollReady.pipe_poll}번, epoll_wait 한 번에 ${M.SCALE.epollWait.pipe_poll}번이었습니다.` },
  { id: "rail", name: "걸이 막대", concept: "파이프의 대기열 rd_wait", text: "잭마다 하나 있는 대기열입니다. write가 데이터를 넣으면 막대에 걸린 항목을 앞에서부터 하나씩 깨워요(__wake_up_common). 꼬리표와 드롭은 모두 이 막대에 걸립니다." },
  { id: "tag", name: "꼬리표", concept: "poll의 임시 대기 항목", text: `poll이 잭을 물으며 거는 항목(__pollwait)이고, 깨워지면 pollwake가 poll을 깨웁니다. 반환할 때 모두 걷혀서(poll_freewait) 다음 호출은 처음부터 다시 걸어요. 준비된 파이프를 하나 찾으면 그 뒤로는 걸지 않아서, 2번이 준비된 첫 호출은 ${FIRST_POLL.hooksAdded.length}개만 걸었습니다.` },
  { id: "drop", name: "드롭", concept: "epoll의 영구 대기 항목", text: "epoll_ctl ADD 때 잭마다 한 번 거는 항목(ep_ptable_queue_proc)입니다. 함수가 ep_poll_callback이라서 write가 깨우면 쓰는 쪽에서 곧바로 카드를 레인으로 떨어뜨려요. 등록을 지울 때까지 남습니다." },
  { id: "card", name: "카드", concept: "epitem", text: "감시하는 fd 하나마다 있는 epitem입니다. 레인에 서 있는 동안이 ready 목록에 오른 상태예요. 숫자 창은 파이프 번호입니다." },
  { id: "queue", name: "레인", concept: "ready 목록 rdllist", text: `epoll_wait는 이 레인만 봅니다. 비어 있으면 아무 잭도 묻지 않고, 카드가 있으면 그 카드의 잭만 다시 물어요(ep_send_events, 첫 호출 ${FIRST_WAIT.visits.length}번). 레벨 트리거라서 보고한 카드는 레인 끝에 다시 서고, 다시 물었을 때 비어 있어야 제자리로 돌아갑니다.` },
  { id: "bell", name: "종", concept: "잠든 호출 깨우기", text: `호출이 잠들면 망치가 젖혀져 있다가, write가 대기 항목을 깨우면 종을 칩니다(pollwake, ep_autoremove_wake_function). 깨어난 poll은 잭 ${WAKE_POLL.visits.length}개를 다시 묻고, epoll_wait는 레인의 카드만 물어요.` },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";
// 같은 data-sel을 단 노드가 한 묶음이다. 떨어져 그려지는 부품은 같은 id로 여러 번 감싼다.
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 380;
const PLATE = { x: -132, y: -68, w: 298, d: 122, r: 9 };
const PLATE_H = 10;
const FOOT_H = 5;

const PITCH = 22;
const MX = (i) => -92 + PITCH * i; // 회선 모듈 왼쪽 끝
const SX = (i) => MX(i) + 5.5; // 잭(소켓) x = 탐침이 서는 x
const CX = (i) => MX(i) + 13.5; // 홈통 가운데
const DECK_TOP = 3;
const BLOCK_Y0 = -18;
const BLOCK_TOP = 17;
const SOCKET_Z = 11.5;
const CH_Y0 = -56;
const CH_Y1 = -1;
const CH_FLOOR = 4;
const CH_WALL = 7;
const CHIP_R = 2.5;
const CHIP_H = 2.4;
const CHIP_IN = -52; // 칩이 들어오는 자리 (쓰는 쪽 끝)
const CHIP_REST = -3.6; // 읽는 쪽 끝
const RAIL_Z = [BLOCK_TOP + 1.6, BLOCK_TOP + 2.6];
const HOUSING_TOP = 21.5;
const CARD = { w: 4.4, d: 2.2, h: 9.5 };
const homeOf = (i) => [MX(i) + 6.5, -7.6, HOUSING_TOP];
const GUTTER = { y0: 4, y1: 14, x0: -98, x1: 152 };
const CARD_Y = 9;
const slotX = (j) => 146 - 5.6 * j;
const RAILS = [[21, 24], [35, 38]];
const RAIL_X = [-124, 90];
const RAIL_TOP = 2.4;
const BODY = { y0: 17, y1: 42, z0: RAIL_TOP, z1: 9.4 };
const COLUMN = { y0: 24, y1: 36, z1: 21 };
const ARM_Z = [10.1, 12.9];
const TIP_IN = 1.6; // 핀 끝이 소켓 면(y = 0)에 닿는 자리
const TIP_OUT = 14.4;
const HOME_X = -112;
const BELL = { x: -114, y: 0 };
const STRIKER = { x: -114, y: 9, strike: -1.9, cock: 2.3 }; // 망치는 y로 움직인다

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [MX(0) + 8, -8, HOUSING_TOP + CARD.h], [MX(7) + 8, -8, HOUSING_TOP + CARD.h], [HOME_X, 30, COLUMN.z1], [BELL.x, BELL.y, 21]],
  WIDTH,
  HEIGHT,
  { pad: 20, azimuth: 56, elevation: 36 },
);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
// 수직면(y = const) 위 닫힌 사각 테두리
const frontRect = (x0, x1, y, z0, z1) => k.pathOf([at([x0, y, z0]), at([x1, y, z0]), at([x1, y, z1]), at([x0, y, z1])], true);
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;
// y = const 면에 붙은 표시창: 왼쪽 위 모서리가 (x0, y, z1), 로컬 u는 +x, v는 아래
function faceWindow(x0, x1, y, z0, z1, text, { digit = "", size = 3 } = {}) {
  const w = x1 - x0;
  const h = z1 - z0;
  return (
    L(frontRect(x0, x1, y, z0, z1), { tone: "lo", className: "ep-win" }) +
    `<g transform="${k.sideMatrix([x0, y], z1, P, "left")}"><text class="ep-digit"${digit ? ` data-digit="${digit}"` : ""} x="${(w / 2).toFixed(2)}" y="${(h / 2 + size * 0.36).toFixed(2)}" font-size="${size}" text-anchor="middle">${text}</text></g>`
  );
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
  const label = { x: 104, y: -44, w: 46, d: 12, r: 1.2 };
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([32, 24, 28].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.8 + i * 2.1], [label.x + 4 + w, label.y + 2.8 + i * 2.1], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3, label.y + 2.6, 0.8]), at([label.x + label.w - 3, label.y + label.d - 2.6, 0.8])], { size: 0.45 }));
  // 눈금 띠: 큰 눈금이 잭마다 하나 (탐침이 서는 x), 작은 눈금은 그 사이를 넷으로 나눈다
  const strip = box(-118, 44.5, 88, 48, 0.6);
  out.push(S(k.slabOf(strip, 0, 0.5, P, 3), { tone: "lo", crease: "none" }));
  const minor = [];
  const major = [];
  for (let n = -6; n <= 7 * 4 + 3; n++) {
    const x = SX(0) + n * (PITCH / 4);
    if (x < strip.x + 1.5 || x > strip.x + strip.w - 1.5) continue;
    const big = n % 4 === 0 && n >= 0 && n <= 28;
    (big ? major : minor).push(k.lineOnTop([x, strip.y + 0.2], [x, strip.y + (big ? 2.4 : 1.3)], 0.5, P));
  }
  out.push(L(minor.join(""), { tone: "lo" }), L(major.join(""), { tone: "mid" }));
  // 집 자리 표시: 탐침이 쉬는 x
  out.push(L(k.lineOnTop([HOME_X, strip.y + 0.2], [HOME_X, strip.y + strip.d - 0.2], 0.5, P), { tone: "hi" }));
  out.push(D([at([strip.x + 1.2, strip.y + 1.75, 0.5]), at([strip.x + strip.w - 1.2, strip.y + 1.75, 0.5])], { size: 0.4 }));
  return out.join("");
}

// ---- 회선 모듈: 받침 하나 위에 잭 블록과 홈통 (모듈마다 받침이 따로라서 짝이 보인다) ----
function plinth(i) {
  const m = MX(i);
  const plan = box(m - 1.2, CH_Y0 - 2.6, m + 18.2, 1.6, 1);
  return [
    `<path class="iso-halo" d="${k.haloOf(plan, 0, 3, P)}" style="opacity:.6"/>`,
    S(k.slabOf(plan, 0, DECK_TOP, P, 3, 0.5), { tone: "lo" }),
    D([at([plan.x + 1.8, plan.y + 1.8, DECK_TOP]), at([plan.x + plan.w - 1.8, plan.y + 1.8, DECK_TOP]), at([plan.x + 1.8, plan.y + plan.d - 1.8, DECK_TOP]), at([plan.x + plan.w - 1.8, plan.y + plan.d - 1.8, DECK_TOP])], { size: 0.4 }),
  ].join("");
}

function jack(i) {
  const m = MX(i);
  const plan = box(m, BLOCK_Y0, m + 9, 0, 1);
  const out = [];
  out.push(S(k.slabOf(plan, DECK_TOP, BLOCK_TOP - DECK_TOP, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(plan, 6, P, 3), { tone: "faint" }) }));
  // 소켓: 앞면의 구멍과 테
  out.push(`<path class="iso-line ep-hole" data-tone="lo" d="${k.sideRing([SX(i), 0, SOCKET_Z], 1.3, "y", P, 20)}"/>`);
  out.push(L(k.sideRing([SX(i), 0, SOCKET_Z], 2.2, "y", P, 24), { tone: "lo" }));
  out.push(D([at([m + 1.4, 0, 4.6]), at([m + 7.6, 0, 4.6])], { size: 0.4 }));
  // 감지 레버: 블록 오른쪽 면에서 홈통 끝 위로 뻗어, 읽는 쪽 끝에 칩이 있는지 짚는다
  const c = CX(i);
  out.push(S(k.slabOf(box(m + 9, -4.4, c + 0.8, -2.8, 0.3), 8.4, 1, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(c, -3.6, 0.9, 7, 1.4, P, 12), { tone: "mid", crease: "none" }));
  return out.join("");
}

// 걸이 막대: 블록 윗면 앞쪽, 기둥 두 개 위의 가로대
function rail(i) {
  const m = MX(i);
  const bar = box(m + 0.5, -2.6, m + 8.5, -1.2, 0.4);
  return [
    S(k.slabOf(box(m + 0.6, -2.8, m + 1.6, -1, 0.2), BLOCK_TOP, RAIL_Z[0] - BLOCK_TOP, P, 2), { tone: "mid", crease: "none" }),
    S(k.slabOf(box(m + 7.4, -2.8, m + 8.4, -1, 0.2), BLOCK_TOP, RAIL_Z[0] - BLOCK_TOP, P, 2), { tone: "mid", crease: "none" }),
    S(k.slabOf(bar, RAIL_Z[0], RAIL_Z[1] - RAIL_Z[0], P, 2), { tone: "mid" }),
    D([at([m + 1.1, -1.9, RAIL_Z[1]]), at([m + 7.9, -1.9, RAIL_Z[1]])], { size: 0.35, tone: "lo" }),
  ].join("");
}

function channel(i) {
  const c = CX(i);
  const out = [];
  // 쓰는 쪽 끝막이: 칩이 들어오는 틈 (앞면의 닫힌 선)
  const cap = box(c - 4.3, CH_Y0 - 2, c + 4.3, CH_Y0, 0.5);
  out.push(`<g data-intake="${i}">${S(k.slabOf(cap, DECK_TOP, 6.5, P, 2, 0.3), { tone: "mid" })}</g>`);
  out.push(L(frontRect(c - 2.8, c + 2.8, CH_Y0, CH_FLOOR + 0.3, CH_FLOOR + 3), { tone: "lo" }));
  out.push(S(k.slabOf(box(c - 3.5, CH_Y0, c + 3.5, CH_Y1, 0.3), DECK_TOP, CH_FLOOR - DECK_TOP, P, 2), { tone: "lo", crease: "none" }));
  // 읽는 쪽 끝의 배출 틈 (바닥 위 닫힌 선)
  out.push(L(k.planOutline(box(c - 2.2, CH_Y1 - 3, c + 2.2, CH_Y1 - 1.2, 0.6), CH_FLOOR, P, 2), { tone: "faint" }));
  out.push(S(k.slabOf(box(c - 3.5, CH_Y0, c - 2.6, CH_Y1, 0.2), CH_FLOOR, CH_WALL - CH_FLOOR, P, 2), { tone: "mid", crease: "none" }));
  return out.join("");
}

function channelFront(i) {
  const c = CX(i);
  return [
    S(k.slabOf(box(c + 2.6, CH_Y0, c + 3.5, CH_Y1, 0.2), CH_FLOOR, CH_WALL - CH_FLOOR, P, 2), { tone: "mid", crease: "none" }),
    D([-42, -26, -10].map((y) => at([c + 3.5, y, CH_WALL - 1.1])), { size: 0.35, tone: "lo" }),
  ].join("");
}

// 바이트 칩: 정지 위치(원점)에서 한 번 만들고 옮긴다
const CHIP = S(k.cylinder(0, 0, CHIP_R, 0, CHIP_H, P, 28, 0.4), { tone: "hi", crease: "lo", inner: L(k.ring(0, 0, CHIP_R - 1, CHIP_H, P, 20), { tone: "faint" }) });

// ---- 걸이 막대에 걸리는 것: 꼬리표(poll)와 드롭(epoll) ----
function tag(i) {
  const m = MX(i);
  const plate = box(m + 0.5, 0.1, m + 3, 1.1, 0.3);
  return [
    // 고리: 가로대 위를 넘어 앞으로
    S(k.slabOf(box(m + 1.35, -2.2, m + 2.15, 1.1, 0.2), RAIL_Z[1], 0.6, P, 2), { tone: "mid", crease: "none" }),
    S(k.slabOf(box(m + 1.35, 0.1, m + 2.15, 1.1, 0.2), 19.2, RAIL_Z[1] - 19.2, P, 2), { tone: "mid", crease: "none" }),
    S(k.slabOf(plate, 13.6, 5.6, P, 2), { tone: "hi", crease: "lo" }),
    L(k.sideRing([m + 1.75, 1.1, 18], 0.5, "y", P, 12), { tone: "lo" }),
    L([0, 1].map((n) => k.segment([m + 0.95, 1.1, 16.4 - n * 1.2], [m + 2.55, 1.1, 16.4 - n * 1.2], P)).join(""), { tone: "lo", free: true }),
  ].join("");
}

function housing(i) {
  const m = MX(i);
  const plan = box(m + 4.2, -12, m + 8.8, -3.2, 0.6);
  return [
    S(k.slabOf(plan, BLOCK_TOP, HOUSING_TOP - BLOCK_TOP, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(plan, BLOCK_TOP + 1.2, P, 2), { tone: "faint" }) }),
    // 걸이 막대를 무는 걸쇠
    S(k.slabOf(box(m + 5.6, -3.2, m + 7.4, -1, 0.3), RAIL_Z[1] - 0.2, HOUSING_TOP - RAIL_Z[1] + 0.2, P, 2), { tone: "mid", crease: "none" }),
    // 카드 집게 두 개
    S(k.slabOf(box(m + 4.3, -9.4, m + 4.9, -5.8, 0.1), HOUSING_TOP, 1.4, P, 2), { tone: "mid", crease: "none" }),
    S(k.slabOf(box(m + 8.1, -9.4, m + 8.7, -5.8, 0.1), HOUSING_TOP, 1.4, P, 2), { tone: "mid", crease: "none" }),
  ].join("");
}

// 카드: 바닥 가운데가 원점, 앞면(+y)에 파이프 번호 창
function cardSvg(i) {
  const body = box(-CARD.w / 2, -CARD.d / 2, CARD.w / 2, CARD.d / 2, 0.4);
  return [
    S(k.slabOf(body, 0, CARD.h, P, 2, 0.3), { tone: "mid", crease: "lo" }),
    faceWindow(-1.7, 1.7, CARD.d / 2, CARD.h - 5, CARD.h - 1.2, String(i), { size: 3.4 }),
    L(k.segment([-1.5, CARD.d / 2, 2.4], [1.5, CARD.d / 2, 2.4], P), { tone: "faint", free: true }),
  ].join("");
}

// ---- 레인 (ready 목록) ----
function gutterBack() {
  const out = [];
  const floor = box(GUTTER.x0, GUTTER.y0, GUTTER.x1, GUTTER.y1, 1);
  out.push(`<path class="iso-halo" d="${k.haloOf(floor, 0, 2, P)}" style="opacity:.5"/>`);
  out.push(S(k.slabOf(floor, 0, 1, P, 3), { tone: "lo", crease: "none" }));
  out.push(S(k.slabOf(box(GUTTER.x0, GUTTER.y0, GUTTER.x1, GUTTER.y0 + 1.2, 0.3), 1, 3.5, P, 2), { tone: "mid", crease: "none" }));
  // 레인 바닥의 자리 표시: 카드가 설 자리마다 닫힌 홈 (머리는 끝막이 쪽)
  out.push(L(LINES.map((j) => k.planOutline(box(slotX(j) - 2.7, CARD_Y - 1.7, slotX(j) + 2.7, CARD_Y + 1.7, 0.6), 1, P, 2)).join(""), { tone: "faint" }));
  return out.join("");
}

function gutterFront() {
  const stop = box(GUTTER.x1, GUTTER.y0, GUTTER.x1 + 4, GUTTER.y1, 0.8);
  return [
    S(k.slabOf(box(GUTTER.x0, GUTTER.y1 - 1.2, GUTTER.x1, GUTTER.y1, 0.3), 1, 3.5, P, 2), { tone: "mid", crease: "none" }),
    D([-80, 0, 80, 140].map((x) => at([x, GUTTER.y1, 3])), { size: 0.35, tone: "lo" }),
    S(k.slabOf(stop, 0, 12, P, 2, 0.4), { tone: "mid" }),
    D([at([GUTTER.x1 + 2, GUTTER.y0 + 2, 12]), at([GUTTER.x1 + 2, GUTTER.y1 - 2, 12])], { size: 0.45 }),
  ].join("");
}

// ---- 종 ----
function bell() {
  const plinth = box(-124, -8, -104, 13, 1.2);
  const out = [`<path class="iso-halo" d="${k.haloOf(plinth, 0, 3, P)}" style="opacity:.6"/>`];
  out.push(S(k.slabOf(plinth, 0, 2.6, P, 3, 0.5), { tone: "mid" }));
  out.push(D([at([plinth.x + 2.4, plinth.y + 2.4, 2.6]), at([plinth.x + 2.4, plinth.y + plinth.d - 2.4, 2.6]), at([plinth.x + plinth.w - 2.4, plinth.y + 2.4, 2.6]), at([plinth.x + plinth.w - 2.4, plinth.y + plinth.d - 2.4, 2.6])], { size: 0.45 }));
  out.push(S(k.cylinder(BELL.x, BELL.y, 2.4, 2.6, 1.4, P, 20), { tone: "mid" }));
  out.push(S(k.cylinder(BELL.x, BELL.y, 1.1, 4, 9, P, 16), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(BELL.x, BELL.y, 5.6, 12.6, 1, P, 44, 0.3), { tone: "hi", crease: "lo" }));
  out.push(S(k.cylinder(BELL.x, BELL.y, 4.8, 13.6, 3.4, P, 40), { tone: "hi", crease: "lo", inner: L(k.sideArc(BELL.x, BELL.y, 4.8, 15, P, 28), { tone: "faint" }) }));
  out.push(S(k.cylinder(BELL.x, BELL.y, 3.4, 17, 1.6, P, 32), { tone: "hi", crease: "lo" }));
  out.push(S(k.cylinder(BELL.x, BELL.y, 1.3, 18.6, 1.6, P, 16), { tone: "mid" }));
  return out.join("");
}

function striker() {
  const { x, y } = STRIKER;
  return [
    S(k.slabOf(box(x - 0.5, y - 0.5, x + 0.5, y + 0.5, 0.2), 2.6, 9.8, P, 2), { tone: "mid", crease: "none" }),
    S(k.cylinder(x, y, 1.5, 12.4, 3, P, 20, 0.3), { tone: "hi", crease: "lo" }),
  ].join("");
}

function strikerFoot() {
  const { x, y } = STRIKER;
  return [
    S(k.slabOf(box(x - 2, y - 2, x + 2, y + 2, 0.6), 2.6, 1.2, P, 2), { tone: "mid" }),
    D([at([x, y - 1.2, 3.8]), at([x, y + 1.2, 3.8])], { size: 0.35, tone: "lo" }),
  ].join("");
}

// ---- 탐침 캐리지 (x = 0에서 만들고 옮긴다) ----
function scannerRails() {
  const out = [];
  for (const [y0, y1] of RAILS) {
    const plan = box(RAIL_X[0], y0, RAIL_X[1], y1, 0.6);
    out.push(S(k.slabOf(plan, 0, RAIL_TOP, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(plan, 1, P, 2), { tone: "faint" }) }));
    out.push(D([-96, -40, 16, 72].map((x) => at([x, (y0 + y1) / 2, RAIL_TOP])), { size: 0.35, tone: "lo" }));
  }
  // 오른쪽 끝막이
  const stop = box(RAIL_X[1], 18, RAIL_X[1] + 4, 41, 0.8);
  out.push(S(k.slabOf(stop, 0, 7, P, 2, 0.4), { tone: "mid" }));
  out.push(D([at([RAIL_X[1] + 2, 22.5, 7]), at([RAIL_X[1] + 2, 36.5, 7])], { size: 0.45 }));
  return out.join("");
}

function carriage() {
  const out = [];
  const body = box(-10, BODY.y0, 10, BODY.y1, 1.2);
  out.push(`<path class="iso-halo" d="${k.haloOf(body, BODY.z0, 3, P)}" style="opacity:.5"/>`);
  out.push(S(k.slabOf(body, BODY.z0, BODY.z1 - BODY.z0, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(body, BODY.z0 + 2.4, P, 3), { tone: "faint" }) }));
  // 팔이 나오는 슬리브: 몸통 뒤 가장자리 위
  out.push(S(k.slabOf(box(-3.2, BODY.y0, 3.2, BODY.y0 + 5.5, 0.6), BODY.z1, ARM_Z[1] + 1.4 - BODY.z1, P, 2, 0.3), { tone: "mid" }));
  out.push(D([[-7.5, 20], [7.5, 20], [-7.5, 39], [7.5, 39]].map(([x, y]) => at([x, y, BODY.z1])), { size: 0.45 }));
  const col = box(-5.5, COLUMN.y0, 5.5, COLUMN.y1, 0.8);
  out.push(`<g data-column>${S(k.slabOf(col, BODY.z1, COLUMN.z1 - BODY.z1, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(col, COLUMN.z1 - 2.2, P, 3), { tone: "faint" }) })}</g>`);
  out.push(L(k.planOutline(k.insetPlan(col, 1.6), COLUMN.z1, P, 3), { tone: "faint" }));
  // 계수 창: 이번 단계에서 잭을 꽂은 횟수
  out.push(faceWindow(-4, 4, COLUMN.y1, 12.6, 18.6, "0", { digit: "count", size: 4.2 }));
  // 손잡이: 널링 노브
  out.push(S(k.cylinder(6.5, 39, 2.6, BODY.z1, 1.4, P, 20), { tone: "mid" }));
  out.push(S(k.cylinder(6.5, 39, 3.2, BODY.z1 + 1.4, 3, P, 28), { tone: "mid" }));
  out.push(L(k.knurl(6.5, 39, 3.2, BODY.z1 + 1.4, BODY.z1 + 4.4, 22, P), { tone: "lo" }));
  out.push(L(k.lineOnTop([6.5, 39], [9.7, 39], BODY.z1 + 4.4, P), { tone: "hi" }));
  return out.join("");
}

// 플러그: 핀 끝이 원점 y에서 TIP만큼 앞, x = 0에서 만든다
function plug() {
  return [
    S(k.slabOf(box(-0.7, -1.6, 0.7, 0, 0.2), SOCKET_Z - 0.7, 1.4, P, 2), { tone: "hi", crease: "none" }),
    S(k.slabOf(box(-2.2, 0, 2.2, 2.6, 0.5), SOCKET_Z - 1.9, 3.8, P, 2, 0.3), { tone: "hi", crease: "lo" }),
  ].join("");
}
const armPaths = (x, tip) => k.slabOf(box(x - 1.2, tip + 2.6, x + 1.2, BODY.y0, 0.3), ARM_Z[0], ARM_Z[1] - ARM_Z[0], P, 2);

// ---- 그림 조립 ----
const MODULES = LINES.map((i) =>
  [
    sel("jack", jack(i)),
    sel("rail", rail(i)),
    sel("pipe", channel(i)),
    groupAt([CX(i), 0, CH_FLOOR], CHIP, ` data-chip="${i}" data-sel="pipe" style="display:none"`),
    sel("pipe", channelFront(i)),
  ].join(""),
);

const TOPS = LINES.map((i) =>
  [
    `<g data-tag="${i}" data-sel="tag" style="display:none">${tag(i)}</g>`,
    `<g data-housing="${i}" data-sel="drop" style="display:none">${housing(i)}</g>`,
  ].join(""),
);
const CARDS = LINES.map((i) => `<g data-card="${i}" data-sel="card" style="display:none" transform="">${cardSvg(i)}</g>`);

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `파이프 ${M.N}개를 감시하는 교환대. 뒤쪽에 홈통 ${M.N}개가 있고 앞쪽 끝마다 잭이 달렸다. 앞의 탐침 캐리지가 잭을 꽂아 파이프에 묻고, 걸이 막대에는 poll의 꼬리표나 epoll의 드롭이 걸린다. 드롭이 떨어뜨린 카드는 앞쪽 레인으로 미끄러져 줄을 서고, 왼쪽 끝의 종이 잠든 호출을 깨운다.`,
  body: [
    base(),
    sel("bell", bell(), strikerFoot()),
    groupAt([0, 0, 0], striker(), ` data-part="striker" data-sel="bell"`),
    ...LINES.map(plinth),
    ...MODULES,
    ...TOPS,
    sel("queue", gutterBack()),
    ...CARDS,
    sel("queue", gutterFront()),
    sel("probe", scannerRails()),
    `<g data-part="arm" data-sel="probe"></g>`,
    groupAt([HOME_X, TIP_OUT, 0], plug(), ` data-part="plug" data-sel="probe"`),
    groupAt([HOME_X, 0, 0], carriage(), ` data-part="carriage" data-sel="probe"`),
  ],
});

const CFG = {
  P,
  N: M.N,
  SX: LINES.map(SX),
  CX: LINES.map(CX),
  HOME: LINES.map(homeOf),
  SLOT: LINES.map(slotX),
  CARD_Y, CHIP_Z: CH_FLOOR, CHIP_IN, CHIP_REST, TIP_IN, TIP_OUT, HOME_X,
  STRIKER: [STRIKER.strike, STRIKER.cock],
  ARM_Z, BODY_Y0: BODY.y0,
  INIT_STEPS,
  SPEED: 300, PLUG: 0.26, TOUR_GAP: 0.9, TOUR_REST: 1.6, RESUME: 6,
};

const live = `
const C = ${JSON.stringify(CFG)};
const P = C.P;
const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const q = (s) => svg.querySelector(s);
const qa = (s) => [...svg.querySelectorAll(s)];
const readoutEl = document.querySelector("[data-readout]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const el = {
  chip: qa("[data-chip]"), tag: qa("[data-tag]"), housing: qa("[data-housing]"), card: qa("[data-card]"), intake: qa("[data-intake]"),
  arm: q('[data-part="arm"]'), plug: q('[data-part="plug"]'), carriage: q('[data-part="carriage"]'), striker: q('[data-part="striker"]'),
  count: q('[data-digit="count"]'),
};
const PARTS = ${JSON.stringify(PARTS)};
const NOTE_IDLE = ${JSON.stringify(NOTE_IDLE)};
const note = document.querySelector("[data-note]");
const picks = [...document.querySelectorAll("[data-pick]")];
const groups = [...svg.querySelectorAll("[data-sel]")];
let hoverSel = null, pinSel = null, shownSel = null;
const picked = () => hoverSel ?? pinSel;
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const ease = (v) => { const t = clamp01(v); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// 꺾은선 경로를 따라 u = 0..1
function along(points, u) {
  const lens = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1], p[2] - points[i][2]));
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  let d = clamp01(u) * total;
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) return lerp3(points[i], points[i + 1], lens[i] ? clamp01(d / lens[i]) : 1);
    d -= lens[i];
  }
  return points[points.length - 1];
}

function initial() { let s = MODEL.makeState(); for (let i = 0; i < C.INIT_STEPS; i++) s = MODEL.step(s); return s; }
let state = initial();
let anim = null; // { from, to, plan, t }

const slotPos = (j) => [C.SLOT[j], C.CARD_Y, 1];
const cardPath = (i, j) => { const h = C.HOME[i]; return [h, [h[0], h[1], h[2] + 2.2], [h[0], C.CARD_Y, h[2] + 2.2], [h[0], C.CARD_Y, 1], slotPos(j)]; };
// 정지 상태의 lit: 탐침이 움직였으면 플러그, 아니면 방금 움직인 칩이나 카드. entry는 다음 write가 들어갈 2번 끝막이
function litOf(s) {
  const a = s.last;
  if (!a) return { kind: "intake", i: s.script[0].fds[0] };
  if (a.ins.op === "write" && !a.visits.length) return a.queued.length ? { kind: "card", i: a.queued[a.queued.length - 1] } : { kind: "chip", i: a.writes[a.writes.length - 1] };
  return { kind: "probe" };
}
function rest(s) {
  return {
    chips: s.data.map((d) => (d > 0 ? { y: C.CHIP_REST, z: 0, o: 1 } : null)),
    tags: Array.from({ length: C.N }, (_, i) => (s.hooks.includes(i) ? { z: 0, o: 1 } : null)),
    housings: Array.from({ length: C.N }, (_, i) => (s.relays.includes(i) ? { z: 0, o: 1 } : null)),
    cards: Array.from({ length: C.N }, (_, i) => (!s.relays.includes(i) ? null : { p: s.ready.includes(i) ? slotPos(s.ready.indexOf(i)) : C.HOME[i], o: 1 })),
    x: C.HOME_X, tip: C.TIP_OUT, count: s.last ? s.last.visits.length : 0,
    striker: s.waiter ? C.STRIKER[1] : 0,
    lit: litOf(s),
  };
}
const clone = (pose) => JSON.parse(JSON.stringify(pose));

// 전이 계획: 모델이 남긴 last(방금 한 일)를 시간 순서의 동작 목록으로 바꾼다
function planOf(a, b, kind) {
  const acts = [];
  let t = 0;
  const add = (act, d) => { acts.push({ ...act, t0: t, t1: t + d }); t += d; };
  if (kind === "rewind") { add({ type: "rewind" }, 0.9); return { acts, D: t }; }
  const L = b.last;
  const op = L.ins.op;
  let x = C.HOME_X;
  let count = 0;
  const travel = (to, speed = C.SPEED) => { const d = Math.abs(to - x) / speed; if (d > 0.02) add({ type: "move", from: x, to }, Math.max(0.1, d)); x = to; };
  // 탐침이 잭 하나를 꽂는다: pipe_poll 1회. 꽂힌 순간의 부수 효과(꼬리표, 드롭)를 함께 싣는다
  const visit = (fd, effect) => { travel(C.SX[fd]); count += 1; add({ type: "plug", fd, count, effect }, C.PLUG); };
  const home = () => travel(C.HOME_X, C.SPEED * 1.6);
  // ready 목록 위 자리: 전이 시작 때의 순서
  const readyAt = (fd) => a.ready.indexOf(fd);
  if (op === "write") {
    for (const fd of L.writes) {
      add({ type: "chipIn", fd }, 0.55);
      if (L.callbacks.includes(fd) && L.queued.includes(fd)) add({ type: "cardFall", fd, j: b.ready.includes(fd) ? b.ready.indexOf(fd) : L.queued.indexOf(fd) }, 0.75);
    }
    if (L.pollwake) {
      add({ type: "jiggle", fd: L.writes[L.writes.length - 1] }, 0.22);
      add({ type: "bell" }, 0.32);
      L.visits.forEach((fd) => visit(fd, null));
      home();
      add({ type: "tagsOff" }, 0.35);
    } else if (L.epWake) {
      add({ type: "bell" }, 0.32);
      L.visits.forEach((fd) => visit(fd, { lift: fd }));
      L.dropped.forEach((fd) => add({ type: "cardHome", fd, j: -1 }, 0.75));
      home();
    }
  } else if (op === "read") {
    add({ type: "chipOut", fds: L.reads }, 0.45);
  } else if (op === "poll") {
    L.visits.forEach((fd, n) => visit(fd, n < L.hooksAdded.length ? { tag: fd } : null));
    home();
    if (!L.slept) add({ type: "tagsOff" }, 0.35);
    else add({ type: "cock" }, 0.3);
  } else if (op === "epoll_ctl") {
    L.visits.forEach((fd) => visit(fd, { relay: fd, ready: L.queued.includes(fd) }));
    home();
  } else if (op === "epoll_wait") {
    L.visits.forEach((fd) => {
      visit(fd, { lift: fd });
      if (L.dropped.includes(fd)) add({ type: "cardHome", fd, j: readyAt(fd) }, 0.75);
    });
    if (L.visits.length) home();
    if (L.slept) add({ type: "cock" }, 0.3);
    if (!L.visits.length && !L.slept) add({ type: "idle" }, 0.3);
  }
  add({ type: "settle" }, 0.25);
  return { acts, D: t };
}

// 계획 위 시각 t의 자세: 끝난 동작은 끝 효과, 진행 중인 동작은 중간 자세
function poseAt(a, b, plan, t) {
  if (t >= plan.D) return rest(b);
  const pose = rest(a);
  pose.count = 0;
  if (plan.acts[0] && plan.acts[0].type === "rewind") {
    const u = ease(t / plan.D);
    const end = rest(b);
    pose.chips = pose.chips.map((c, i) => (c && !end.chips[i] ? { ...c, o: 1 - u } : end.chips[i]));
    pose.cards = pose.cards.map((c) => (c ? { ...c, o: 1 - u } : null));
    pose.housings = pose.housings.map((h) => (h ? { ...h, o: 1 - u } : null));
    pose.striker = lerp(pose.striker, 0, u);
    pose.lit = end.lit;
    return pose;
  }
  for (const act of plan.acts) {
    if (t < act.t0) break;
    const u = clamp01((t - act.t0) / (act.t1 - act.t0));
    const e = ease(u);
    switch (act.type) {
      case "move": pose.x = lerp(act.from, act.to, e); pose.lit = { kind: "probe" }; break;
      case "plug": {
        // 0..0.45 내밀기, 0.45..0.55 닿음, 0.55..1 거두기
        pose.x = C.SX[act.fd];
        pose.tip = u < 0.45 ? lerp(C.TIP_OUT, C.TIP_IN, ease(u / 0.45)) : u < 0.55 ? C.TIP_IN : lerp(C.TIP_IN, C.TIP_OUT, ease((u - 0.55) / 0.45));
        pose.lit = { kind: "probe" };
        const touched = u >= 0.45;
        pose.count = touched ? act.count : act.count - 1;
        const f = act.effect;
        if (f && f.tag !== undefined && touched) { const v = ease((u - 0.45) / 0.4); pose.tags[f.tag] = { z: 2.5 * (1 - v), o: v }; }
        if (f && f.relay !== undefined && touched) {
          const v = ease((u - 0.45) / 0.4);
          pose.housings[f.relay] = { z: 3 * (1 - v), o: v };
          const h = C.HOME[f.relay];
          pose.cards[f.relay] = { p: [h[0], h[1], h[2] + 3 * (1 - v)], o: v };
        }
        if (f && f.lift !== undefined && pose.cards[f.lift]) {
          const c = pose.cards[f.lift];
          const lift = Math.sin(Math.PI * clamp01((u - 0.2) / 0.7)) * 2.6;
          pose.cards[f.lift] = { ...c, p: [c.p[0], c.p[1], c.p[2] + lift] };
        }
        break;
      }
      case "chipIn": {
        const v = clamp01(u / 0.18);
        pose.chips[act.fd] = { y: lerp(C.CHIP_IN, C.CHIP_REST, ease((u - 0.1) / 0.9)), z: 0, o: v };
        pose.lit = { kind: "chip", i: act.fd };
        break;
      }
      case "chipOut":
        for (const fd of act.fds) pose.chips[fd] = u >= 1 ? null : { y: C.CHIP_REST, z: -3.2 * e, o: 1 - e };
        pose.lit = { kind: "probe" };
        break;
      case "cardFall":
        pose.cards[act.fd] = { p: along(cardPath(act.fd, act.j), e), o: 1 };
        pose.lit = { kind: "card", i: act.fd };
        break;
      case "cardHome": {
        const j = act.j >= 0 ? act.j : 0;
        const from = pose.cards[act.fd] ? pose.cards[act.fd].p : slotPos(j);
        const path = cardPath(act.fd, j).reverse();
        path[0] = from;
        pose.cards[act.fd] = { p: along(path, e), o: 1 };
        pose.lit = { kind: "card", i: act.fd };
        break;
      }
      case "jiggle":
        if (pose.tags[act.fd]) pose.tags[act.fd] = { z: Math.sin(Math.PI * 2 * u) * 0.8, o: 1 };
        break;
      case "bell":
        pose.striker = u < 0.35 ? lerp(pose.striker, C.STRIKER[0], ease(u / 0.35)) : lerp(C.STRIKER[0], 0, ease((u - 0.35) / 0.65));
        pose.lit = { kind: "striker" };
        break;
      case "cock":
        pose.striker = lerp(0, C.STRIKER[1], e);
        break;
      case "tagsOff":
        pose.tags = pose.tags.map((g) => (g ? { z: 2.5 * e, o: 1 - e } : null));
        break;
      case "idle":
      case "settle":
        break;
    }
  }
  return pose;
}

const LIT = {
  probe: [el.carriage.querySelector("[data-column] .iso-solid")],
  striker: [...el.striker.querySelectorAll(".iso-solid")].slice(-1),
};
function setLit(lit) {
  const want = new Set(lit.kind === "probe" ? LIT.probe : lit.kind === "striker" ? LIT.striker : [(lit.kind === "chip" ? el.chip : lit.kind === "card" ? el.card : el.intake)[lit.i].querySelector(".iso-solid")]);
  svg.querySelectorAll(".iso-solid[data-lit]").forEach((n) => { if (!want.has(n)) n.removeAttribute("data-lit"); });
  want.forEach((n) => n.setAttribute("data-lit", ""));
  el.card.forEach((g, i) => g.toggleAttribute("data-on", lit.kind === "card" && lit.i === i));
}
function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }
function show(node, on, o = 1) {
  node.style.display = on ? "" : "none";
  if (on) node.style.opacity = o < 1 ? Math.max(0, o).toFixed(3) : "";
}
function draw(pose) {
  pose.chips.forEach((c, i) => { show(el.chip[i], !!c, c ? c.o : 1); if (c) put(el.chip[i], [C.CX[i], c.y, C.CHIP_Z + c.z]); });
  pose.tags.forEach((g, i) => { show(el.tag[i], !!g, g ? g.o : 1); if (g) put(el.tag[i], [0, 0, g.z]); });
  pose.housings.forEach((h, i) => { show(el.housing[i], !!h, h ? h.o : 1); if (h) put(el.housing[i], [0, 0, h.z]); });
  pose.cards.forEach((c, i) => { show(el.card[i], !!c, c ? c.o : 1); if (c) put(el.card[i], c.p); });
  put(el.carriage, [pose.x, 0, 0]);
  put(el.plug, [pose.x, pose.tip, 0]);
  el.arm.innerHTML = solidSvg(slabOf({ x: pose.x - 1.2, y: pose.tip + 2.6, w: 2.4, d: C.BODY_Y0 - pose.tip - 2.6, r: 0.3 }, C.ARM_Z[0], C.ARM_Z[1] - C.ARM_Z[0], P, 2), { tone: "mid", crease: "none" });
  put(el.striker, [0, pose.striker, 0]);
  const text = String(pose.count);
  if (el.count.textContent !== text) el.count.textContent = text;
  setLit(pose.lit);
}

function say() {
  const text = MODEL.readout(state);
  if (readoutEl.textContent !== text) readoutEl.textContent = text;
  return text;
}

// 루프
let frame = 0, last = 0, visible = false, touring = !still.matches, wait = C.TOUR_REST, idleTimer = 0;
function begin(from, to, kind = "step") {
  anim = { from, to, kind, plan: planOf(from, to, kind), t: 0 };
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
    anim.t += dt;
    draw(poseAt(anim.from, anim.to, anim.plan, anim.t));
    if (anim.t >= anim.plan.D) anim = null;
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
  if (pinSel && !event.target.closest(".ep-parts, .iso-stage")) { pinSel = null; choose(); }
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
  `${F} .ep-digit{fill:var(--anatomy-mid)}`,
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
  `${FP} .ep-digit{fill:var(--anatomy-lit)}`,
].join("\n");

const css = `<style>
.iso{--ep-hole:#030303;--ep-win:#0b0b0b}
.iso[data-theme="light"]{--ep-hole:#a3a3a0;--ep-win:#ececea}
.iso-line.ep-hole{fill:var(--ep-hole)}
.iso-line.ep-win{fill:var(--ep-win)}
.ep-digit{fill:var(--anatomy-hi);font-family:var(--anatomy-mono);font-weight:600}
[data-on] .ep-digit{fill:var(--anatomy-lit)}
.iso-stage{cursor:pointer;touch-action:pan-y}
.iso-stage:focus{outline:none}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso-plate{overflow:hidden}
@media (max-width:560px){.iso-plate .iso-svg{width:116%;margin:0 -8%}}
.ep-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.ep-parts{display:flex;flex-wrap:wrap;gap:6px}
.ep-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.ep-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.ep-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.ep-parts button[data-picked] span{color:var(--anatomy-strong)}
.ep-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.ep-note{min-height:4.6em;color:var(--anatomy-text)}
.ep-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="ep-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="ep-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 7",
    title: "파이프 교환대",
    hint: "클릭이나 → 한 단계, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [{ mark: "lit", label: "방금 움직인 부품: 탐침 캐리지, 들어온 칩, 레인을 오가는 카드, 종 망치" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="파이프 교환대. 클릭, 오른쪽 화살표, 스페이스로 시스템 콜 한 묶음을 진행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="ep-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "파이프 교환대", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
