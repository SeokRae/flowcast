// node build.mjs [--light]: 3층 서고와 승강기 (flowcast:mechanism 예제, 합성)
// 그림의 층, 책 수, 서랍 카드, 색인 깃발, 리드아웃은 모두 model.mjs에서 나온다. kit는 vendor/anatomy에서 가져온다.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_ROOT = process.env.MECHANISM_KIT ?? join(HERE, "../../vendor/anatomy");
const k = await import(pathToFileURL(join(KIT_ROOT, "kit/iso-kit.mjs")).href);
const { kitScript } = await import(pathToFileURL(join(KIT_ROOT, "scripts/inline-kit.mjs")).href);
const theme = process.argv.includes("--light") ? "light" : "dark";
const NAME = "jvm-class-loading";
const NOTICE = "<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->";

// pageHtml은 kit와 live 코드를 한 module 스코프에 넣는다. 모델을 IIFE로 감싸 이름 충돌을 막는다.
function inlineModel(src) {
  const names = [...src.matchAll(/^export (?:const|function) (\w+)/gm)].map((m) => m[1]);
  return `const MODEL = (() => {\n${src.replace(/^export /gm, "")}\nreturn { ${names.join(", ")} };\n})();\n`;
}
const modelScript = inlineModel(readFileSync(join(HERE, "model.mjs"), "utf8"));

// 캡션은 brief.md의 "## 캡션" 절을 그대로 쓴다 (마크다운 코드 표시 백틱만 걷어 낸다)
const brief = readFileSync(join(HERE, "brief.md"), "utf8");
const CAPTION = (brief.split(/^## 캡션\s*$/m)[1] ?? "").split(/^## /m)[0].trim().split(/\n\s*\n/)[0].replace(/`/g, "");
if (!CAPTION) throw new Error("brief.md has no caption section");
// 캡션의 숫자는 모델 상수와 같아야 한다
const COUNT_WORD = ["", "한", "두", "세", "네", "다섯", "여섯"][M.REQUESTS.length];
if (!CAPTION.includes(M.RUNTIME) || !CAPTION.includes(`${COUNT_WORD} 건`)) throw new Error("caption numbers differ from model.mjs");

// ---- 진실: 모델에서 읽는 값 ----
const TRACE = M.trace();
const INIT_STEPS = 4; // 처음 보여줄 상태: Duration을 들고 Platform 층을 건너뛴 칸이 Boot 층에 선 순간
if (TRACE[INIT_STEPS].at !== "boot" || !TRACE[INIT_STEPS].carry) throw new Error("initial pose should show the car at boot with the class");
const DURATION = M.REQUESTS[0];
const SQL_MODULE = M.PACKAGES["java.sql"].module;
const SQL_BOOK = M.MODULES.platform.indexOf(SQL_MODULE); // 이름순 6번째 책
const TOTAL_MODULES = M.LOADERS.reduce((n, l) => n + M.MODULES[l].length, 0);
const GREETER = M.REQUESTS.find((cn) => M.STORE[cn] && M.STORE[cn].loader === "app");
const MISSING = M.REQUESTS.find((cn) => !M.STORE[cn]);
// 클래스 경로 디렉터리의 class 파일을 클래스 이름으로 (demo/Greeter.class -> demo.Greeter)
const CP_FILES = M.CLASS_PATH_FILES.map((f) => f.replace(/\.class$/, "").replace(/\//g, "."));
if (!CP_FILES.includes(GREETER) || CP_FILES.includes(MISSING)) throw new Error("class path listing and STORE disagree");

// ---- 부품 목록: 호버하거나 번호를 누르면 그 묶음만 밝아지고 설명이 나온다 (brief.md "부품 목록") ----
const PARTS = [
  { id: "car", name: "승강 칸", concept: "지금 판단하는 로더", text: "칸이 선 층의 로더가 지금 loadClassOrNull을 실행합니다. 위로 가면 위임이고, 아래로 가면 결과(Class나 null)를 들고 호출한 로더에게 돌아가는 거예요." },
  { id: "register", name: "기록 서랍", concept: "findLoadedClass", text: `로더마다 먼저 이미 정의한 클래스인지 봅니다. 맞는 카드가 있으면 거기서 끝나요. 첫 요청 전에 App 서랍에는 ${M.DEFINED_BEFORE.app.join(", ")} ${M.DEFINED_BEFORE.app.length}장, Platform 서랍에는 ${M.DEFINED_BEFORE.platform.length}장이 있었습니다.` },
  { id: "index", name: "색인 기둥", concept: "packageToModule", text: `패키지 이름으로 부트 레이어의 이름 있는 모듈 ${TOTAL_MODULES}개 중 하나와 그 모듈을 정의한 로더를 찾는 static 맵이에요. 세 로더가 함께 씁니다. 깃발이 층을 가리키면 그 층으로 바로 가고, 바닥 표지판으로 내려가면(null) 부모에게 묻습니다.` },
  { id: "boot", name: "Boot 층", concept: "부트 로더", text: `VM 안에 구현된 로더라 자바 쪽에서는 null로 보입니다(getClassLoader()가 null). ${M.MODULES.boot[0]}을 비롯한 모듈 ${M.MODULES.boot.length}개가 이 층에 정의돼 있어요.` },
  { id: "vault", name: "부트 금고", concept: "findBootstrapClassOrNull", text: `부트 로더는 자바 코드로 찾지 않고 VM에 이름을 넘깁니다. 이 실행에서 ${DURATION}은 CDS 아카이브(source: ${M.STORE[DURATION].source})에서 나왔고, demo 패키지 이름에는 null이 돌아왔어요.` },
  { id: "platform", name: "Platform 층", concept: "플랫폼 로더", text: `${SQL_MODULE}을 비롯한 모듈 ${M.MODULES.platform.length}개를 정의합니다(${SQL_MODULE}은 이름순 ${SQL_BOOK + 1}번째 책). 클래스 경로가 없어서 부모가 null을 주면 그대로 null을 돌려줘요. 오른쪽 덮개판이 그 빈자리입니다.` },
  { id: "app", name: "App 층", concept: "앱 로더", text: `ClassLoader.getSystemClassLoader()가 돌려주는 로더예요. 부모는 ${M.PARENT.app}이고, 모듈 ${M.MODULES.app.length}개와 클래스 경로를 함께 맡습니다.` },
  { id: "classpath", name: "클래스 경로 서랍", concept: "findClassOnClassPathOrNull", text: `패키지가 이름 있는 모듈에 없고 부모들도 찾지 못했을 때만 엽니다. 카드 ${CP_FILES.length}장은 이 디렉터리의 class 파일이고, ${GREETER}는 ${M.STORE[GREETER].source}에서 읽혀 앱 로더에 정의됐어요.` },
  { id: "out", name: "반환 트레이", concept: "loadClass의 반환값", text: "Class 블록이 여기 놓이면 loadClass가 Class를 돌려준 것입니다. 블록을 만든 층이 그 클래스를 정의한 로더예요(getClassLoader())." },
  { id: "reject", name: "거절함", concept: "ClassNotFoundException", text: `세 층이 모두 null을 돌려주면 가장 바깥의 BuiltinClassLoader.loadClass가 ClassNotFoundException을 던집니다. ${MISSING}의 요청 카드가 여기로 떨어져요.` },
].map((part, i) => ({ no: String(i + 1).padStart(2, "0"), ...part }));
const NOTE_IDLE = "부품에 커서를 올리거나 번호를 누르면 그 부품이 무엇인지 보여 줍니다.";
// 같은 data-sel을 단 노드가 한 묶음이다. 떨어져 그려지는 부품(기록 서랍 두 층)은 같은 id로 여러 번 감싼다.
const sel = (id, ...svg) => `<g data-sel="${id}">${svg.join("")}</g>`;

// ---- 월드 (단위 약 1px, x와 y가 바닥, z가 위) ----
const WIDTH = 600;
const HEIGHT = 380;
const PLATE = { x: -134, y: -48, w: 276, d: 124, r: 9 };
const PLATE_H = 10;
const FOOT_H = 5;

const box = (x0, y0, x1, y1, r = 0) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
const PLINTH = box(-106, -36, 106, 36, 2);
const PLINTH_H = 16;
const DECK_T = 4;
const DECK = { app: 20, platform: 70, boot: 120 }; // 층판 윗면
const ROOF_Z = 166;
const ROOF_T = 4;
const DECK_X0 = -65; // 승강로(왼쪽 칸)와 층판의 경계
const FACE_Y = 14; // 서랍장 앞면
const OPEN = 7; // 서랍이 열리는 거리
const LIFT = 5; // 맞는 카드가 들리는 높이
const BOOK = { y0: -28, y1: -16, x0: -62, pitch: 6, w: 4.8 };
const BOOK_OUT = 7; // java.sql 책이 앞으로 빠지는 거리
const RAIL = { y0: 26, y1: 30 };
const CAR_X = -80;
const CAR_Z = Object.fromEntries(M.LOADERS.map((l) => [l, DECK[l] - 3])); // 칸 바닥 윗면 = 층판 윗면
const CAR_TOP = 32;
const CABLE_Y = -21;
const COLUMN = { x: 126, y: 22 };
const SLEEVE_H = 8;
// 깃발 캐리지 바닥 높이: 지침판(캐리지 가운데)이 층판 끝 표지판을 가리킨다. none은 받침 위, park는 머리 아래
const FLAG_Z = { none: 2.6, app: DECK.app - 6, platform: DECK.platform - 6, boot: DECK.boot - 6, park: 176 };
const COLUMN_TOP = 186;
const TRAY = box(-96, 42, -64, 64, 2);
const BIN = box(-58, 44, -34, 62, 1.5);
const BIN_H = 7;
const CARD = { w: 12, t: 1.2, h: 13 };
const BLOCK = 8;

const REG = { x0: -60, x1: -32, h: 14 }; // 기록 서랍장 (App, Platform)
const RIGHT = { x0: 40, x1: 84 }; // 오른쪽 서랍장 (App: 클래스 경로, Boot: 금고, Platform: 덮개판)
const VAULT_H = 18;
const DRAWERS = {
  app: { x0: REG.x0 + 2, x1: REG.x1 - 2, base: DECK.app + 1.5, h: 7, panel: [DECK.app + 1, DECK.app + 12] },
  platform: { x0: REG.x0 + 2, x1: REG.x1 - 2, base: DECK.platform + 1.5, h: 7, panel: [DECK.platform + 1, DECK.platform + 12] },
  cp: { x0: RIGHT.x0 + 2, x1: RIGHT.x1 - 2, base: DECK.app + 1.5, h: 7, panel: [DECK.app + 1, DECK.app + 12] },
  vault: { x0: RIGHT.x0 + 3, x1: RIGHT.x1 - 3, base: DECK.boot + 2, h: 9, panel: [DECK.boot + 1.5, DECK.boot + 15] },
};
const CARD_DY = (i) => -(2.4 + 2.2 * i); // 서랍 앞면에서 i번째 카드까지
const REC = { w: 18, t: 0.8, h: 8 }; // 기록 카드와 class 파일 카드

const bookX = (i) => BOOK.x0 + i * BOOK.pitch;
const bookH = (name) => 9 + (name.length % 5); // 책 높이는 모듈 이름 길이로 정한다 (위 층판에 가리지 않게 13 이하)

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [-108, -38, 184], [108, 38, ROOF_Z + ROOF_T], [COLUMN.x + 5, COLUMN.y + 5, COLUMN_TOP + 3], [COLUMN.x - 5, COLUMN.y - 5, COLUMN_TOP + 3]],
  WIDTH,
  HEIGHT,
  { pad: 18, azimuth: 58 },
);
const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
const groupAt = (by, svg, attrs = "") => `<g${attrs} transform="${k.translateAlong(P, by)}">${svg}</g>`;
// y = const 인 수직면 위 가로선 (면의 왼쪽 끝에서 오른쪽 끝까지)
const acrossY = (x0, x1, y, z) => k.segment([x0, y, z], [x1, y, z], P);

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
  const label = box(58, 62, 106, 71, 1.2);
  out.push(S(k.slabOf(label, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(k.planOutline(k.insetPlan(label, 1.4), 0.8, P, 3), { tone: "faint" }));
  out.push(L([32, 24, 28].map((w, i) => k.lineOnTop([label.x + 4, label.y + 2.6 + i * 1.9], [label.x + 4 + w, label.y + 2.6 + i * 1.9], 0.8, P)).join(""), { tone: "lo", free: true }));
  out.push(D([at([label.x + label.w - 3, label.y + 2.4, 0.8]), at([label.x + label.w - 3, label.y + label.d - 2.4, 0.8])], { size: 0.45 }));
  return out.join("");
}

// ---- 서고 몸체 ----
function plinth() {
  const out = [`<path class="iso-halo" d="${k.haloOf(PLINTH, 0, 8, P)}"/>`];
  out.push(S(k.slabOf(PLINTH, 0, PLINTH_H, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(PLINTH, 4, P, 4), { tone: "faint" }) }));
  out.push(D([[-100, 36], [-60, 36], [-20, 36], [20, 36], [60, 36], [100, 36]].map(([x, y]) => at([x, y, 10])), { size: 0.45, tone: "mid" }));
  return out.join("");
}

function tower() {
  const out = [];
  // 왼쪽 옆판 (보는 쪽에서 등을 돌린 면이라 앞 모서리만 보인다)과 뒤벽
  out.push(S(k.slabOf(box(-104, -32, -100, 32, 0.6), PLINTH_H, ROOF_Z - PLINTH_H, P, 2, 0.4), { tone: "mid" }));
  const wall = box(-100, -32, 100, -29, 0.4);
  out.push(S(k.slabOf(wall, PLINTH_H, ROOF_Z - PLINTH_H, P, 2), { tone: "lo" }));
  // 층마다 뒤벽 판 이음선과 리벳 (층판 바로 위, 책 뒤)
  for (const l of M.LOADERS) {
    out.push(L(acrossY(-100, 100, -29, DECK[l] + 30), { tone: "faint" }));
    out.push(D([-56, -10, 36, 82].map((x) => at([x, -29, DECK[l] + 33])), { size: 0.4, tone: "lo" }));
  }
  return out.join("");
}

function rails() {
  const out = [];
  for (const x of [-95, -68]) {
    const plan = box(x, -29, x + 3, -26, 0.4);
    out.push(S(k.slabOf(plan, PLINTH_H, ROOF_Z - PLINTH_H, P, 2), { tone: "mid", crease: "none" }));
    // 레일 고정 볼트 (층마다 하나)
    out.push(D(M.LOADERS.map((l) => at([x + 1.5, -26, DECK[l] + 20])), { size: 0.45, tone: "mid" }));
  }
  // 승강로 바닥 완충대
  out.push(S(k.slabOf(box(-90, -12, -70, 6, 1), PLINTH_H, 0.8, P, 3), { tone: "lo", crease: "none" }));
  return out.join("");
}

// ---- 승강 칸 (CAR_X, 0, 칸 바닥 z 기준으로 한 번 만들고 transform으로 옮긴다) ----
function car() {
  const out = [];
  const shoe = (x0, z) => S(k.slabOf(box(x0, -26, x0 + 4, -22, 0.4), z, 7, P, 2), { tone: "mid", crease: "none" });
  out.push(shoe(-94, 4), shoe(-70, 4), shoe(-94, 20), shoe(-70, 20));
  const floor = box(-90, -22, -70, 13, 1);
  out.push(S(k.slabOf(floor, 0, 3, P, 3, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(floor, 2), 3, P, 3), { tone: "faint" }));
  // 뒤벽: 칸의 강조(lit) 부품
  out.push(`<g data-lit-key="car">${S(k.slabOf(box(-90, -22, -70, -19.4, 0.4), 3, CAR_TOP - 7, P, 2), { tone: "mid", inner: L(k.sideSeam(box(-90, -22, -70, -19.4, 0.4), 16, P, 2), { tone: "faint" }) })}</g>`);
  // 앞쪽 기둥, 왼쪽 낮은 난간, 크로스헤드
  out.push(S(k.slabOf(box(-90, 10.6, -88.4, 13, 0.3), 3, CAR_TOP - 7, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.slabOf(box(-90, -19.4, -88.6, 10.6, 0.3), 3, 5, P, 2), { tone: "mid", crease: "none" }));
  const head = box(-92, -24, -68, 13, 1);
  out.push(S(k.slabOf(head, CAR_TOP - 4, 4, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(head, CAR_TOP - 2, P, 3), { tone: "faint" }) }));
  // 요청 카드 받침
  out.push(S(k.slabOf(box(-88, -14.4, -72, -10.8, 0.4), 3, 1.2, P, 2), { tone: "lo", crease: "none" }));
  // 케이블 걸이 (점이 케이블 끝을 받는다)
  out.push(D([at([CAR_X, CABLE_Y, CAR_TOP])], { size: 0.9, tone: "hi" }));
  return out.join("");
}

// 요청 카드: 원점(카드 앞면 가운데 아래)에서 한 번 만든다. 규칙선 3줄은 적힌 클래스 이름을 뜻한다 (free)
function requestCard() {
  const plan = box(-CARD.w / 2, -CARD.t / 2, CARD.w / 2, CARD.t / 2, 0.2);
  const lines = [[-4, 3.6, 10], [-4, 1.8, 8.4], [-4, 3.2, 6.8]].map(([x, w, z]) => acrossY(x, x + w * 2, CARD.t / 2, z));
  return [
    `<g data-lit-key="card">${S(k.slabOf(plan, 0, CARD.h, P, 2), { tone: "hi", crease: "lo" })}</g>`,
    L(lines.join(""), { tone: "lo", free: true }),
  ].join("");
}

// Class 블록: 찾은 Class 객체
function classBlock() {
  const plan = box(-BLOCK / 2, -BLOCK / 2, BLOCK / 2, BLOCK / 2, 1);
  return `<g data-lit-key="block">${S(k.slabOf(plan, 0, BLOCK, P, 3, 0.5), {
    tone: "hi",
    crease: "lo",
    inner: L(k.sideSeam(plan, 2.4, P, 3), { tone: "lo" }),
  })}</g>${L(k.planOutline(k.insetPlan(plan, 1.8), BLOCK, P, 3), { tone: "lo" })}`;
}

// ---- 층 ----
function deck(l) {
  const plan = box(DECK_X0, -29, 100, 32, 0.8);
  return S(k.slabOf(plan, DECK[l] - DECK_T, DECK_T, P, 3, 0.6), { tone: "mid" });
}

function books(l) {
  const out = [];
  M.MODULES[l].forEach((name, i) => {
    const x = bookX(i);
    const plan = box(x, BOOK.y0, x + BOOK.w, BOOK.y1, 0.5);
    const h = bookH(name);
    const svg = S(k.slabOf(plan, DECK[l], h, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(plan, DECK[l] + h - 2.2, P, 2) + k.sideSeam(plan, DECK[l] + 2, P, 2), { tone: "faint" }) });
    if (l === "platform" && i === SQL_BOOK) out.push(`<g data-part="book" data-sel="platform" transform="">${svg}</g>`);
    else out.push(svg);
  });
  return out.join("");
}

// 층 이름표: 층판 앞쪽 가운데의 얇은 판. 규칙선 2줄은 인쇄된 층 이름을 뜻한다 (free)
function nameplate(l) {
  const plan = box(-22, 16, 2, 23, 1);
  const z = DECK[l];
  return [
    S(k.slabOf(plan, z, 0.8, P, 3), { tone: "lo", crease: "none" }),
    L(k.planOutline(k.insetPlan(plan, 1.2), z + 0.8, P, 3), { tone: "faint" }),
    L([14, 10].map((w, i) => k.lineOnTop([plan.x + 3.4, plan.y + 2.6 + i * 1.9], [plan.x + 3.4 + w, plan.y + 2.6 + i * 1.9], z + 0.8, P)).join(""), { tone: "lo", free: true }),
    D([at([plan.x + plan.w - 2.6, plan.y + plan.d / 2, z + 0.8])], { size: 0.45 }),
  ].join("");
}

function rail(l) {
  const plan = box(DECK_X0 + 1, RAIL.y0, 92, RAIL.y1, 0.6);
  const z = DECK[l];
  return [
    S(k.slabOf(plan, z, 2, P, 2, 0.3), { tone: "lo" }),
    D(Array.from({ length: 13 }, (_, i) => at([DECK_X0 + 6 + i * 12.2, (RAIL.y0 + RAIL.y1) / 2, z + 2])), { size: 0.5, tone: "mid" }),
  ].join("");
}

// 서랍장 몸체 (앞면 FACE_Y). 서랍 구멍 테두리는 앞면 위의 닫힌 선
function cabinet(x0, x1, z, h, { dial = false } = {}) {
  const plan = box(x0, -8, x1, FACE_Y, 1.5);
  const out = [`<path class="iso-halo" d="${k.haloOf(plan, z, 4, P)}" style="opacity:.6"/>`];
  out.push(S(k.slabOf(plan, z, h, P, 3, 0.6), { tone: "mid", inner: L(k.sideSeam(plan, z + h - 3, P, 3), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(plan, 2.4), z + h, P, 3), { tone: "faint" }));
  out.push(D(k.corners(plan, 3).map(([x, y]) => at([x, y, z + h])), { size: 0.45 }));
  if (dial) {
    // 금고 다이얼: 위면의 널링 손잡이와 눈금
    const [cx, cy] = [x1 - 9, 1];
    out.push(S(k.cylinder(cx, cy, 5.4, z + h, 1.4, P, 36), { tone: "lo" }));
    out.push(S(k.cylinder(cx, cy, 4, z + h + 1.4, 2.6, P, 32), { tone: "mid" }));
    out.push(L(k.knurl(cx, cy, 4, z + h + 1.4, z + h + 4, 24, P), { tone: "lo" }));
    out.push(L(k.ring(cx, cy, 2.2, z + h + 4, P, 20), { tone: "faint" }));
    out.push(L(k.lineOnTop([cx, cy - 0.6], [cx, cy - 3.6], z + h + 4, P), { tone: "hi" }));
    const ticks = k.radialTicks(cx, cy, 5.2, 20, 5, z + h + 1.4, [0.7, 1.2], P);
    out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
    out.push(L(k.ring(cx, cy, 5.2, z + h + 1.4, P, 36), { tone: "faint" }));
  }
  return out.join("");
}

// 서랍: 앞판은 한 번 만들고 옮긴다. 열린 몸통(바닥과 옆벽)과 카드는 live 코드가 프레임마다 다시 그린다
function drawerFront(id, d) {
  const panel = box(d.x0 - 1, FACE_Y, d.x1 + 1, FACE_Y + 2.4, 0.6);
  const [z0, z1] = d.panel;
  const mid = (d.x0 + d.x1) / 2;
  const pull = box(mid - 5, FACE_Y + 2.4, mid + 5, FACE_Y + 4, 0.5);
  const holder = [mid - 4, mid + 4];
  return `<g data-part="front-${id}" transform="">${[
    `<g data-lit-key="drawer-${id}">${S(k.slabOf(panel, z0, z1 - z0, P, 2, 0.4), { tone: "mid" })}</g>`,
    // 카드 꽂이: 앞판 위의 닫힌 테두리와 리벳
    L(k.pathOf([at([holder[0], FACE_Y + 2.4, z1 - 4.4]), at([holder[1], FACE_Y + 2.4, z1 - 4.4]), at([holder[1], FACE_Y + 2.4, z1 - 1.6]), at([holder[0], FACE_Y + 2.4, z1 - 1.6])], true), { tone: "lo" }),
    D([at([holder[0] - 1.4, FACE_Y + 2.4, z1 - 3]), at([holder[1] + 1.4, FACE_Y + 2.4, z1 - 3])], { size: 0.4 }),
    S(k.slabOf(pull, z0 + 3, 1.6, P, 2), { tone: "mid", crease: "none" }),
  ].join("")}</g>`;
}

// 클래스 경로 없음 덮개판 (Platform 층): 서랍장이 설 자리를 막은 판과 나사 넷
function coverPlate() {
  const plan = box(RIGHT.x0, -8, RIGHT.x1, FACE_Y, 1.5);
  const z = DECK.platform;
  return [
    S(k.slabOf(plan, z, 1.2, P, 3, 0.4), { tone: "lo" }),
    L(k.planOutline(k.insetPlan(plan, 4), z + 1.2, P, 3), { tone: "faint" }),
    L(k.corners(plan, 3.4).map(([x, y]) => k.ring(x, y, 1.4, z + 1.2, P, 12)).join(""), { tone: "lo" }),
    D(k.corners(plan, 3.4).map(([x, y]) => at([x, y, z + 1.2])), { size: 0.45 }),
  ].join("");
}

// 오른쪽 옆판: 층판 끝 이음선과 층 표지판 (색인 깃발의 지침판이 가리킨다)
function rightSide() {
  const panel = box(100, -32, 104, 32, 0.6);
  // 층판이 옆판에 닿는 자리: 보이는 모서리를 감아 실루엣에서 끝나는 이음선
  const seams = M.LOADERS.flatMap((l) => [DECK[l] - DECK_T, DECK[l]]).map((z) => k.sideSeam(panel, z, P, 2));
  return [
    S(k.slabOf(panel, PLINTH_H, ROOF_Z - PLINTH_H, P, 2, 0.4), { tone: "mid", inner: L(seams.join(""), { tone: "faint" }) }),
    ...M.LOADERS.map((l) => sel(l, sidePlate(104, DECK[l] - 2))),
    sel("index", sidePlate(106, FLAG_Z.none + SLEEVE_H / 2)),
  ].join("");
}

function sidePlate(x, zc) {
  const plan = box(x, 14, x + 1.4, 30, 0.3);
  return [
    S(k.slabOf(plan, zc - 4, 8, P, 2), { tone: "lo" }),
    D([at([x + 1.4, 16.4, zc]), at([x + 1.4, 27.6, zc])], { size: 0.45, tone: "mid" }),
  ].join("");
}

function roof() {
  const plan = box(-108, -38, 108, 38, 2);
  const top = ROOF_Z + ROOF_T;
  const out = [S(k.slabOf(plan, ROOF_Z, ROOF_T, P, 4, 0.8), { tone: "mid", inner: L(k.sideSeam(plan, ROOF_Z + 1.6, P, 4), { tone: "faint" }) })];
  out.push(L(k.planOutline(k.insetPlan(plan, 5), top, P, 4), { tone: "faint" }));
  const screws = k.corners(plan, 9);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2, top, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, top])), { size: 0.45 }));
  // 승강로 위 권양기 받침판과 통풍 슬롯 (닫힌 테두리)
  const mount = box(-104, -36, -60, 0, 1.5);
  out.push(S(k.slabOf(mount, top, 0.8, P, 3), { tone: "lo", crease: "none" }));
  out.push(L(Array.from({ length: 6 }, (_, i) => k.planOutline(box(-30 + i * 14, -6, -22 + i * 14, 20, 1), top, P, 3)).join(""), { tone: "faint" }));
  return out.join("");
}

// 권양기: 지붕 위, 승강로 바로 위
function hoist() {
  const z = ROOF_Z + ROOF_T + 0.8;
  const motor = box(-102, -34, -88, -8, 1.5);
  const out = [];
  out.push(S(k.slabOf(motor, z, 12, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(motor, z + 4, P, 3), { tone: "faint" }) }));
  out.push(D([at([-95, -8, z + 8]), at([-91, -8, z + 8])], { size: 0.45 }));
  out.push(S(k.slabOf(box(-88, -24, -86, -18, 0.4), z + 3, 3, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(CAR_X, CABLE_Y, 6.5, z, 1.4, P, 36), { tone: "lo" }));
  out.push(S(k.cylinder(CAR_X, CABLE_Y, 5.4, z + 1.4, 7, P, 36), { tone: "mid", inner: L(k.sideArc(CAR_X, CABLE_Y, 5.4, z + 4.8, P, 24), { tone: "faint" }) }));
  out.push(L(k.ring(CAR_X, CABLE_Y, 2, z + 8.4, P, 16), { tone: "lo" }));
  // 크랭크: 목 슬래브와 널링 노브
  out.push(S(k.slabOf(box(-74.6, -22.2, -71, -19.8, 0.4), z + 6.4, 2, P, 2), { tone: "mid", crease: "none" }));
  out.push(S(k.cylinder(-68.4, CABLE_Y, 2.6, z + 4.4, 6, P, 24), { tone: "mid" }));
  out.push(L(k.knurl(-68.4, CABLE_Y, 2.6, z + 4.4, z + 10.4, 16, P), { tone: "lo" }));
  out.push(D([at([-68.4, CABLE_Y, z + 10.4])], { size: 0.5, tone: "hi" }));
  return out.join("");
}

// ---- 색인 기둥 ----
const COL = box(COLUMN.x - 3, COLUMN.y - 3, COLUMN.x + 3, COLUMN.y + 3, 0.5);
const SLEEVE = box(COLUMN.x - 5.5, COLUMN.y - 5.5, COLUMN.x + 5.5, COLUMN.y + 5.5, 1);
function columnBack() {
  const foot = box(COLUMN.x - 8, COLUMN.y - 8, COLUMN.x + 8, COLUMN.y + 8, 1.5);
  return [
    `<path class="iso-halo" d="${k.haloOf(foot, 0, 3, P)}" style="opacity:.6"/>`,
    S(k.slabOf(foot, 0, FLAG_Z.none, P, 3, 0.5), { tone: "mid" }),
    D(k.corners(foot, 2.4).map(([x, y]) => at([x, y, FLAG_Z.none])), { size: 0.45 }),
    S(k.slabOf(COL, FLAG_Z.none, COLUMN_TOP - FLAG_Z.none, P, 2), { tone: "mid", crease: "none" }),
  ].join("");
}
function carriage() {
  const ptr = box(108, COLUMN.y - 1.2, SLEEVE.x, COLUMN.y + 1.2, 0.4);
  return [
    S(k.slabOf(ptr, SLEEVE_H / 2 - 1, 2, P, 2), { tone: "mid", crease: "none" }),
    `<g data-lit-key="flag">${S(k.slabOf(SLEEVE, 0, SLEEVE_H, P, 3, 0.5), { tone: "mid", inner: L(k.sideSeam(SLEEVE, 2, P, 3), { tone: "faint" }) })}</g>`,
    // 손나사: 슬리브 앞면
    S(k.slabOf(box(COLUMN.x - 1, SLEEVE.y + SLEEVE.d, COLUMN.x + 1, SLEEVE.y + SLEEVE.d + 1.4, 0.3), 3, 2, P, 2), { tone: "mid", crease: "none" }),
    S(k.cylinder(COLUMN.x, SLEEVE.y + SLEEVE.d + 2.8, 1.8, 2, 4, P, 18), { tone: "mid" }),
    L(k.knurl(COLUMN.x, SLEEVE.y + SLEEVE.d + 2.8, 1.8, 2, 6, 12, P), { tone: "lo" }),
  ].join("");
}
function columnCap() {
  const cap = box(COLUMN.x - 4.5, COLUMN.y - 4.5, COLUMN.x + 4.5, COLUMN.y + 4.5, 1);
  return [S(k.slabOf(cap, COLUMN_TOP, 3, P, 3, 0.5), { tone: "mid" }), D([at([COLUMN.x, COLUMN.y, COLUMN_TOP + 3])], { size: 0.5 })].join("");
}

// ---- 반환 트레이와 거절함 (뒤 절반, 내용물 층, 앞 테) ----
function trayBack() {
  return [
    `<path class="iso-halo" d="${k.haloOf(TRAY, 0, 3, P)}" style="opacity:.6"/>`,
    S(k.slabOf(TRAY, 0, 1.5, P, 3, 0.4), { tone: "mid" }),
    S(k.slabOf(box(TRAY.x, TRAY.y, TRAY.x + TRAY.w, TRAY.y + 1.4, 0.4), 1.5, 3, P, 2), { tone: "mid" }),
    S(k.slabOf(box(TRAY.x, TRAY.y + 1.4, TRAY.x + 1.4, TRAY.y + TRAY.d - 1.4), 1.5, 3, P, 2), { tone: "mid" }),
    L(k.planOutline(k.insetPlan(TRAY, 4), 1.5, P, 3), { tone: "faint" }),
  ].join("");
}
function trayFront() {
  return [
    S(k.slabOf(box(TRAY.x + TRAY.w - 1.4, TRAY.y + 1.4, TRAY.x + TRAY.w, TRAY.y + TRAY.d - 1.4), 1.5, 3, P, 2), { tone: "mid" }),
    S(k.slabOf(box(TRAY.x, TRAY.y + TRAY.d - 1.4, TRAY.x + TRAY.w, TRAY.y + TRAY.d, 0.4), 1.5, 3, P, 2, 0.3), { tone: "mid" }),
  ].join("");
}
function binBack() {
  return [
    `<path class="iso-halo" d="${k.haloOf(BIN, 0, 3, P)}" style="opacity:.6"/>`,
    S(k.slabOf(BIN, 0, 1.2, P, 3), { tone: "lo" }),
    S(k.slabOf(box(BIN.x, BIN.y, BIN.x + BIN.w, BIN.y + 1.4, 0.4), 1.2, BIN_H, P, 2), { tone: "mid" }),
    S(k.slabOf(box(BIN.x, BIN.y + 1.4, BIN.x + 1.4, BIN.y + BIN.d - 1.4), 1.2, BIN_H, P, 2), { tone: "mid" }),
  ].join("");
}
function binFront() {
  const front = box(BIN.x, BIN.y + BIN.d - 1.4, BIN.x + BIN.w, BIN.y + BIN.d, 0.4);
  return [
    S(k.slabOf(box(BIN.x + BIN.w - 1.4, BIN.y + 1.4, BIN.x + BIN.w, BIN.y + BIN.d - 1.4), 1.2, BIN_H, P, 2), { tone: "mid" }),
    S(k.slabOf(front, 1.2, BIN_H, P, 2, 0.3), { tone: "mid", inner: L(k.sideSeam(front, 1.2 + BIN_H - 2, P, 2), { tone: "faint" }) }),
    // 투입구 표시: 앞 벽 위 리벳 둘
    D([at([BIN.x + 4, BIN.y + BIN.d, 1.2 + BIN_H / 2]), at([BIN.x + BIN.w - 4, BIN.y + BIN.d, 1.2 + BIN_H / 2])], { size: 0.45 }),
  ].join("");
}

// ---- 층 조립 ----
function floor(l) {
  const out = [deck(l) + nameplate(l), books(l)];
  if (l !== "boot") out.push(sel("register", cabinet(REG.x0, REG.x1, DECK[l], REG.h)));
  if (l === "app") out.push(sel("classpath", cabinet(RIGHT.x0, RIGHT.x1, DECK[l], REG.h)));
  if (l === "boot") out.push(sel("vault", cabinet(RIGHT.x0, RIGHT.x1, DECK[l], VAULT_H, { dial: true })));
  if (l === "platform") out.push(sel("platform", coverPlate()));
  return out;
}
const drawerOf = { app: ["app", "cp"], platform: ["platform"], boot: ["vault"] };
const drawerSel = { app: "register", platform: "register", cp: "classpath", vault: "vault" };
function floorFront(l) {
  return drawerOf[l].map((id) => sel(drawerSel[id], `<g data-part="body-${id}"></g>`, drawerFront(id, DRAWERS[id])));
}

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: `클래스 로더 세 개를 3층 서고로 옮긴 기계. 왼쪽 승강로의 칸이 요청 카드를 싣고 App, Platform, Boot 층을 오가고, 층마다 기록 서랍과 모듈 책(아래부터 ${M.MODULES.app.length}권, ${M.MODULES.platform.length}권, ${M.MODULES.boot.length}권)이 있다. 오른쪽 색인 기둥의 깃발이 패키지를 정의한 로더의 층을 가리키고, 찾은 Class 블록은 앞쪽 반환 트레이로, 찾지 못한 요청 카드는 거절함으로 간다.`,
  body: [
    base(),
    plinth(),
    tower(),
    sel("car", rails()),
    sel("car", `<path class="iso-line" data-part="cable" data-tone="mid" d=""/>`),
    `<g data-part="car" data-sel="car" transform="">${car()}</g>`,
    `<g data-layer="car"><g data-part="card" data-sel="car" transform="">${requestCard()}</g><g data-part="block" transform="">${classBlock()}</g></g>`,
    ...M.LOADERS.flatMap((l) => [sel(l, ...floor(l).slice(0, 2)), ...floor(l).slice(2), ...floorFront(l), sel(l, rail(l)), `<g data-layer="${l}"></g>`]),
    rightSide(),
    roof(),
    sel("car", hoist()),
    sel("index", columnBack()),
    `<g data-part="flag" data-sel="index" transform="">${carriage()}</g>`,
    sel("index", `<g data-part="column-top"></g>`, columnCap()),
    sel("out", trayBack()),
    `<g data-layer="tray"></g>`,
    sel("out", trayFront()),
    sel("reject", binBack()),
    `<g data-layer="bin"></g>`,
    sel("reject", binFront()),
    `<g data-layer="front"></g>`,
  ],
});

const CFG = {
  P,
  DECK, CAR_Z, CAR_X, CAR_TOP, CABLE_Y, ROOF_Z, DECK_X0, FACE_Y, OPEN, LIFT, BOOK_OUT, RAIL, BLOCK, CARD, REC,
  FLAG_Z, SLEEVE_H, COL, COLUMN_TOP,
  DRAWERS, CARD_DY: [0, 1, 2].map(CARD_DY), CP_FILES,
  SQL_BOOK_X: bookX(SQL_BOOK) + BOOK.w / 2, BOOK_TOP: bookH(SQL_MODULE),
  TRAY_AT: [(TRAY.x * 2 + TRAY.w) / 2, TRAY.y + TRAY.d / 2, 1.5],
  BIN_AT: [(BIN.x * 2 + BIN.w) / 2, BIN.y + BIN.d / 2, 1.2],
  FRONT_Y: 33,
  INIT_STEPS,
  STEP_SECONDS: 0.72, TOUR_GAP: 0.12, TOUR_REST: 1.6, RESUME: 6,
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
const part = (name) => q('[data-part="' + name + '"]');
const el = {
  car: part("car"), cable: part("cable"), flag: part("flag"), columnTop: part("column-top"), book: part("book"),
  card: part("card"), block: part("block"),
  front: Object.fromEntries(Object.keys(C.DRAWERS).map((id) => [id, part("front-" + id)])),
  body: Object.fromEntries(Object.keys(C.DRAWERS).map((id) => [id, part("body-" + id)])),
};
const layers = Object.fromEntries([...svg.querySelectorAll("[data-layer]")].map((g) => [g.dataset.layer, g]));
const litNodes = Object.fromEntries([...svg.querySelectorAll("[data-lit-key]")].map((g) => [g.dataset.litKey, g.querySelector(".iso-solid")]));
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
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
// 꺾은선 경로 위의 점 (길이 비율 t)
function along(points, t) {
  const lens = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1], p[2] - points[i][2]));
  let d = clamp01(t) * lens.reduce((a, b) => a + b, 0);
  for (let i = 0; i < lens.length; i++) {
    if (d <= lens[i] || i === lens.length - 1) return lerp3(points[i], points[i + 1], lens[i] ? Math.min(1, d / lens[i]) : 1);
    d -= lens[i];
  }
  return points[points.length - 1];
}

function initial() { let s = MODEL.makeState(); for (let i = 0; i < C.INIT_STEPS; i++) s = MODEL.step(s); return s; }
let state = initial();
let anim = null;

const drawerAt = { findLoadedClass: (l) => l, findBootstrapClassOrNull: () => "vault", findClassOnClassPathOrNull: () => "cp" };
const inCar = (carZ, what) => what === "card" ? [C.CAR_X, -12.6, carZ + 4.2] : [C.CAR_X, 4, carZ + 3];
// 서랍 안 카드: 기록 서랍은 그 로더가 정의한 클래스, 클래스 경로 서랍은 class 파일
const cardsOf = (s, id) => id === "cp" ? C.CP_FILES : id === "vault" ? [] : s.defined[id];
function cardPos(id, i, open, lift) {
  const d = C.DRAWERS[id];
  return [(d.x0 + d.x1) / 2, C.FACE_Y + C.CARD_DY[i] + open, d.base + 1 + lift];
}
// Class 블록이 나타나는 자리: 찾은 저장소 위
function storeAt(s, open) {
  const { op, loader } = s.last;
  if (op === "findLoadedClass") { const i = s.defined[loader].indexOf(s.cn); const p = cardPos(loader, i, open, C.LIFT); return [p[0], p[1], p[2] + C.REC.h - C.BLOCK]; }
  if (op === "findClassOnClassPathOrNull") { const i = C.CP_FILES.indexOf(s.cn); const p = cardPos("cp", i, open, C.LIFT); return [p[0], p[1], p[2] + C.REC.h - C.BLOCK]; }
  if (op === "findBootstrapClassOrNull") { const d = C.DRAWERS.vault; return [(d.x0 + d.x1) / 2, C.FACE_Y + open - 4.6, d.base + 1]; }
  return [C.SQL_BOOK_X, -22 + C.BOOK_OUT, C.DECK.platform + C.BOOK_TOP + 0.5];
}
function toCar(s, from, carZ) {
  const deck = C.DECK[s.at];
  const high = deck + 21;
  const railY = (C.RAIL.y0 + C.RAIL.y1) / 2;
  return [from, [from[0], from[1], high], [from[0], railY, high], [from[0], railY, deck + 2], [C.DECK_X0 - 7, railY, deck + 2], inCar(carZ, "block")];
}
const isStore = (op) => op === "findClassInModuleOrNull" || op === "findBootstrapClassOrNull" || op === "findClassOnClassPathOrNull" || op === "findLoadedClass";

function litOf(s) {
  const { op, loader, result } = s.last;
  if (op === "loadClass" && result === null) return s.req === 0 ? "drawer-app" : "card";
  if (op === "findLoadedModule") return "flag";
  if (op === "delegate" || op === "parent" || op === "return") return "car";
  if (op === "loadClass") return result === "ClassNotFoundException" ? "card" : "block";
  if (result === "class") return "block";
  return "drawer-" + drawerAt[op](loader);
}

// 정지 자세: 상태 하나로 정해진다
function rest(s) {
  const { op, loader, result } = s.last;
  const pose = {
    carZ: C.CAR_Z[s.at],
    open: { app: 0, platform: 0, cp: 0, vault: 0 },
    lift: {},
    flagZ: C.FLAG_Z[s.flag || "park"],
    book: op === "findClassInModuleOrNull" ? C.BOOK_OUT : 0,
    cards: { app: cardsOf(s, "app"), platform: cardsOf(s, "platform"), cp: C.CP_FILES, vault: [] },
    card: null,
    block: null,
    lit: litOf(s),
  };
  if (drawerAt[op]) {
    const id = drawerAt[op](loader);
    pose.open[id] = C.OPEN;
    if (result === "class" && id !== "vault") pose.lift[id + ":" + s.cn] = C.LIFT;
  }
  if (s.stack.length) pose.card = { at: inCar(pose.carZ, "card"), o: 1 };
  else if (s.out && s.out.error) pose.card = { at: C.BIN_AT, o: 1 };
  if (s.carry) pose.block = { at: inCar(pose.carZ, "block"), o: 1 };
  else if (s.out && !s.out.error) pose.block = { at: C.TRAY_AT, o: 1 };
  return pose;
}

// 전이 자세: 직전 상태에서 다음 상태로, u = 0..1
function between(a, b, u, kind) {
  const ra = rest(a), rb = rest(b);
  if (u >= 1) return rb;
  const pose = { ...rb, open: {}, lift: {}, cards: rb.cards };
  pose.carZ = lerp(ra.carZ, rb.carZ, seg(u, 0.05, 0.9));
  for (const id of Object.keys(ra.open)) pose.open[id] = lerp(ra.open[id], rb.open[id], seg(u, rb.open[id] ? 0.05 : 0, rb.open[id] ? 0.4 : 0.35));
  for (const key of new Set([...Object.keys(ra.lift), ...Object.keys(rb.lift)])) pose.lift[key] = lerp(ra.lift[key] || 0, rb.lift[key] || 0, seg(u, 0.25, 0.45));
  pose.flagZ = lerp(ra.flagZ, rb.flagZ, seg(u, 0.05, 0.8));
  pose.book = lerp(ra.book, rb.book, seg(u, 0, 0.3));
  const rideCar = (thing, what) => thing && thing.at[0] === C.CAR_X && thing.at[1] === inCar(0, what)[1] ? { at: inCar(pose.carZ, what), o: 1 } : thing;
  pose.card = rideCar(ra.card, "card");
  pose.block = rideCar(ra.block, "block");
  const op = b.last.op;
  if (kind === "rewind") {
    // 처음으로: 남은 것은 흐려지고, 요청 카드는 칸 안에 다시 나타난다
    const fade = 1 - seg(u, 0, 0.4);
    pose.block = ra.block ? { at: ra.block.at, o: fade } : null;
    pose.card = u < 0.5 ? (ra.card ? { at: ra.card.at, o: fade } : null) : { at: inCar(pose.carZ, "card"), o: seg(u, 0.55, 0.95) };
    return pose;
  }
  if (op === "loadClass" && b.last.result === null) {
    // 새 요청 카드가 앞에서 칸으로 들어오고, 지난 결과는 치운다
    const home = inCar(pose.carZ, "card");
    const entry = [[C.CAR_X, 52, home[2]], home];
    pose.card = { at: along(entry, seg(u, 0.1, 0.9)), o: seg(u, 0.05, 0.3) };
    pose.block = ra.block ? { at: ra.block.at, o: 1 - seg(u, 0, 0.35) } : null;
    if (ra.card && !ra.block) pose.card = u < 0.45 ? { at: ra.card.at, o: 1 - seg(u, 0, 0.4) } : { at: along(entry, seg(u, 0.45, 0.95)), o: seg(u, 0.45, 0.6) };
  } else if (isStore(op) && b.last.result === "class") {
    // Class 블록이 저장소 위에 나타나 이송 레일을 타고 칸으로 간다
    const from = storeAt(b, C.OPEN);
    pose.block = { at: along(toCar(b, from, pose.carZ), seg(u, 0.4, 1)), o: seg(u, 0.3, 0.42) };
  } else if (op === "loadClass") {
    if (b.last.result === "ClassNotFoundException") {
      pose.card = { at: along([inCar(pose.carZ, "card"), [C.CAR_X, -12.6, C.DECK.app + 16], [C.BIN_AT[0], C.BIN_AT[1], C.DECK.app + 16], C.BIN_AT], seg(u, 0.05, 0.95)), o: 1 };
    } else {
      pose.block = { at: along([inCar(pose.carZ, "block"), [C.CAR_X, C.TRAY_AT[1], C.DECK.app + 3], C.TRAY_AT], seg(u, 0.05, 0.9)), o: 1 };
      pose.card = { at: inCar(pose.carZ, "card"), o: 1 - seg(u, 0.4, 0.9) };
    }
  }
  return pose;
}

// 위치에 맞는 레이어: 서고 앞이면 front (트레이와 거절함 안이면 그 사이), 승강로면 car, 아니면 그 높이의 층
function layerFor(p, what) {
  if (p[1] >= C.FRONT_Y) {
    if (p[2] < 4) return what === "block" ? "tray" : "bin";
    return "front";
  }
  if (p[0] < C.DECK_X0 - 5) return "car";
  return p[2] >= C.DECK.boot - 4 ? "boot" : p[2] >= C.DECK.platform - 4 ? "platform" : "app";
}
function place(node, thing, what) {
  node.style.display = thing && thing.o > 0.01 ? "" : "none";
  if (!thing) return;
  const layer = layers[layerFor(thing.at, what)];
  if (node.parentNode !== layer) layer.appendChild(node);
  node.setAttribute("transform", translateAlong(P, thing.at));
  node.style.opacity = thing.o < 1 ? thing.o.toFixed(3) : "";
}

const S2 = (plan, z, h, tone, extra = {}) => solidSvg(slabOf(plan, z, h, P, 2, 0.3), { tone, crease: "none", ...extra });
const plan = (x0, y0, x1, y1, r = 0.3) => ({ x: x0, y: y0, w: x1 - x0, d: y1 - y0, r });
// 열린 서랍 몸통: 서랍장 앞면 밖으로 나온 바닥과 옆벽, 그 안의 카드
function drawerBody(id, open, cards, lift, cn) {
  if (open < 0.25) return "";
  const d = C.DRAWERS[id];
  const y0 = C.FACE_Y, y1 = C.FACE_Y + open;
  const out = [S2(plan(d.x0, y0, d.x1, y1), d.base, 1, "lo"), S2(plan(d.x0, y0, d.x0 + 1.2, y1), d.base + 1, d.h - 1, "mid")];
  cards.forEach((name, i) => {
    const p = cardPos(id, i, open, lift[id + ":" + name] || 0);
    if (p[1] - C.REC.t < y0 + 0.2) return;
    out.push(S2(plan(p[0] - C.REC.w / 2, p[1] - C.REC.t, p[0] + C.REC.w / 2, p[1]), p[2], C.REC.h, "hi", { crease: "lo" }));
  });
  out.push(S2(plan(d.x1 - 1.2, y0, d.x1, y1), d.base + 1, d.h - 1, "mid"));
  return out.join("");
}

const shown = { body: {} };
function draw(pose) {
  put(el.car, [0, 0, pose.carZ]);
  el.cable.setAttribute("d", pathOf([iso([C.CAR_X, C.CABLE_Y, pose.carZ + C.CAR_TOP], P), iso([C.CAR_X, C.CABLE_Y, C.ROOF_Z], P)]));
  put(el.flag, [0, 0, pose.flagZ]);
  const top = pose.flagZ + C.SLEEVE_H;
  el.columnTop.innerHTML = solidSvg(slabOf(C.COL, top, C.COLUMN_TOP - top, P, 2), { tone: "mid", crease: "none" });
  put(el.book, [0, pose.book, 0]);
  for (const id of Object.keys(C.DRAWERS)) {
    const open = pose.open[id];
    put(el.front[id], [0, open, 0]);
    const key = open.toFixed(2) + "|" + pose.cards[id].join(",") + "|" + JSON.stringify(pose.lift);
    if (shown.body[id] !== key) { shown.body[id] = key; el.body[id].innerHTML = drawerBody(id, open, pose.cards[id], pose.lift); }
  }
  place(el.card, pose.card, "card");
  place(el.block, pose.block, "block");
  for (const [key, node] of Object.entries(litNodes)) node.toggleAttribute("data-lit", key === pose.lit);
}
function put(node, by) { node.setAttribute("transform", translateAlong(P, by)); }

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
  if (pinSel && !event.target.closest(".cl-parts, .iso-stage")) { pinSel = null; choose(); }
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
@media (max-width:560px){.iso-plate .iso-svg{width:116%;margin:0 -8%}.iso-plate{padding-bottom:86px}.iso-plate-corner[data-corner="hint"]{bottom:34px}.iso-plate-corner[data-corner="readout"]{left:0;white-space:normal;text-align:right;line-height:1.4}}
.cl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.iso-halo{pointer-events:none}
${FOCUS_CSS}
.cl-parts{display:flex;flex-wrap:wrap;gap:6px}
.cl-parts button{font:inherit;font-size:12.5px;line-height:1.4;color:var(--anatomy-text);background:transparent;border:1px solid var(--anatomy-faint);border-radius:999px;padding:3px 10px;cursor:pointer}
.cl-parts button span{font-family:var(--anatomy-mono);font-size:11px;color:var(--anatomy-muted);margin-right:6px}
.cl-parts button[data-picked]{color:var(--anatomy-strong);border-color:var(--anatomy-hi)}
.cl-parts button[data-picked] span{color:var(--anatomy-strong)}
.cl-parts button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.cl-note{min-height:4.6em;color:var(--anatomy-text)}
.cl-note b{color:var(--anatomy-strong);font-weight:600;margin-right:8px}
</style>`;

const PARTS_HTML =
  `<span class="cl-parts" role="group" aria-label="부품 목록">${PARTS.map((p) => `<button type="button" data-pick="${p.id}"><span>${p.no}</span>${p.name}</button>`).join("")}</span>` +
  `<span class="cl-note" data-note aria-live="polite">${NOTE_IDLE}</span>`;

const body =
  css +
  k.plateHtml({
    fig: "Fig 3",
    title: "클래스 로더 서고",
    hint: "클릭이나 → 한 단계, Home 처음",
    readout: M.readout(TRACE[INIT_STEPS]),
    keys: [{ mark: "lit", label: "방금 움직인 부품: 요청 카드, 열린 서랍, 색인 깃발, 승강 칸, Class 블록 중 하나" }],
    caption: CAPTION,
    body: `<div class="iso-stage" tabindex="0" role="group" aria-label="클래스 로더 서고. 클릭, 오른쪽 화살표, 스페이스로 판단이나 이동 하나를 진행하고 Home으로 처음 상태로 돌아갑니다. 아래 부품 목록에서 부품을 고르면 설명이 나옵니다.">${svg}<span class="cl-sr" role="status" aria-live="polite" data-status></span></div>`,
  }).replace('<figcaption class="iso-legend">', `<figcaption class="iso-legend">${PARTS_HTML}`);

const page = k
  .pageHtml({ title: "클래스 로더 서고", theme, body, script: kitScript() + modelScript + live })
  .replace("<!doctype html>", `<!doctype html>\n${NOTICE}`)
  .replace('<html lang="en">', '<html lang="ko">');
const file = theme === "light" ? `${NAME}-light.html` : `${NAME}.html`;
writeFileSync(join(HERE, file), page);
console.log("wrote", file);
