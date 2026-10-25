// node check.mjs: model.mjs를 Corretto 21.0.1 실측(truth/)과 대조한다 (실패하면 exit 1)
// truth/loader-trace.txt: JDI로 기록한 로더 메서드 반환 순서, truth/probe-out.txt: Probe 출력과 -Xlog:class+load
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "truth", name), "utf8");

// ---- 대상 버전 ----
const version = read("java-version.txt");
assert.ok(version.includes(`build ${M.RUNTIME}-LTS`), "java -version build");
assert.ok(version.includes("Corretto-21.0.1.12.1"), "Corretto build");

// ---- 모델 자체 ----
const T = M.trace();
assert.equal(T.length, 43);
assert.equal(T.at(-1).done, true);
assert.equal(M.step(T.at(-1)), T.at(-1), "done state is a fixed point");
for (const s of T.slice(0, -1)) {
  const before = JSON.stringify(s);
  M.step(s);
  assert.equal(JSON.stringify(s), before, "step must not mutate its input");
}
const byRequest = M.REQUESTS.map((_, r) => T.filter((s) => s.req === r));
// JDK 9 이후의 핵심: java.base 패키지는 플랫폼 층에 서지 않고 부트 층으로 바로 간다
assert.ok(byRequest[0].every((s) => s.at !== "platform"), "java.time.Duration skips the platform loader");
// 부모 위임은 한 층씩 오르고, 모듈 위임은 그 모듈을 정의한 로더 층으로 바로 간다
for (let i = 1; i < T.length; i++) {
  const floor = (s) => M.LOADERS.indexOf(s.at);
  if (T[i].last.op === "parent") assert.equal(floor(T[i]) - floor(T[i - 1]), 1);
  if (T[i].last.op === "delegate") assert.equal(T[i].at, M.PACKAGES[T[i].cn.slice(0, T[i].cn.lastIndexOf("."))].loader);
}

// ---- JDI 기록과 판단 순서 대조 ----
function modelTokens(states) {
  const out = [];
  for (const s of states) {
    const { loader, op, result } = s.last;
    if (op === "loadClass" && result === null) continue; // 요청 카드를 넣는 상태
    if (op === "delegate" || op === "parent") continue; // 호출 진입은 기록하지 않았다 (반환만 기록)
    if (op === "findClassOnClassPathOrNull") out.push(`${loader} hasClassPath true`);
    if (op === "return") {
      if (s.last.bare) out.push(`${s.last.from} hasClassPath false`);
      out.push(`${s.last.from} loadClassOrNull ${result}`);
    } else if (op === "loadClass") {
      out.push(`${loader} loadClassOrNull ${result === "ClassNotFoundException" ? "null" : "class"}`);
      out.push(`${loader} loadClass ${result === "ClassNotFoundException" ? result : "class"}`);
    } else out.push(`${loader} ${op} ${result}`);
  }
  return out;
}

function traceTokens(r, cn) {
  const lines = read("loader-trace.txt").split("\n").filter((l) => l.startsWith(`  ${r} `));
  const out = [];
  for (const line of lines) {
    const m = line.match(/^ {2}\d+ (\S+) (\S+)\.(\w+)\(([^)]*)\) (?:-> (.*)|throws (.*))$/);
    assert.ok(m, `unparsed trace line: ${line}`);
    const [, loader, , method, arg, ret, thrown] = m;
    // 정의 도중 VM이 같은 로더로 상위 클래스를 다시 요청한 중첩 호출은 이 요청의 판단이 아니다
    if (arg && !arg.startsWith("module ") && arg !== cn) continue;
    const value = thrown ? thrown.replace(/^java\.lang\./, "") : ret.startsWith("class ") ? "class" : ret.replace(/^module /, "");
    const name = method === "loadClass" ? "loadClass" : method;
    const token = `${loader} ${name} ${value}`;
    if (out.at(-1) !== token) out.push(token); // 오버로드와 래퍼(1인자 loadClassOrNull, AppClassLoader.loadClass)는 한 번으로
  }
  return out;
}

M.REQUESTS.forEach((cn, r) => {
  const head = read("loader-trace.txt").split("\n").find((l) => l.startsWith(`request ${r} `));
  assert.equal(head, `request ${r} ${cn}`);
  assert.deepEqual(modelTokens(byRequest[r]), traceTokens(r, cn), `request ${r} ${cn}`);
});

// ---- Probe 출력과 대조 ----
const probe = read("probe-out.txt");
const value = (key, text = probe) => {
  const m = text.match(new RegExp(`^ *${key.replace(/\./g, "\\.")}: (.*)$`, "m"));
  assert.ok(m, `missing ${key}`);
  return m[1];
};
for (const loader of M.LOADERS) {
  assert.equal(value(`layer.${loader}.modules`), String(M.MODULES[loader].length));
  assert.equal(value(`layer.${loader}`), `[${M.MODULES[loader].join(", ")}]`);
}
assert.equal(value("layer.java.sql"), M.PACKAGES["java.sql"].loader);
assert.equal(value("app.parent"), M.PARENT.app);
assert.equal(value("platform.parent"), "null"); // getParent()는 부트 로더를 null로 돌려준다
assert.equal(value("main.loader"), "app");
const before = Object.fromEntries(read("defined-before.txt").trim().split("\n").map((l) => l.split(" ")).map(([k, v]) => [k, Number(v)]));
assert.equal(before.platform, M.DEFINED_BEFORE.platform.length);
assert.equal(before.app, M.DEFINED_BEFORE.app.length);
assert.deepEqual(M.DEFINED_BEFORE.app, ["demo.Probe"]);
assert.match(probe, /\[class,load\] demo\.Probe source: file:<work>\/classes\//);
assert.deepEqual(read("classpath-listing.txt").trim().split("\n"), M.CLASS_PATH_FILES);
// 클래스 경로에서 정의되는 클래스는 그 목록에 있고, 없는 클래스는 목록에도 없다
for (const cn of M.REQUESTS) {
  const file = `${cn.replace(/\./g, "/")}.class`;
  assert.equal(M.CLASS_PATH_FILES.includes(file), !!(M.STORE[cn] && M.STORE[cn].loader === "app") || M.DEFINED_BEFORE.app.includes(cn), file);
}

const blocks = probe.split(/^== request /m).slice(1);
assert.equal(blocks.length, M.REQUESTS.length);
M.REQUESTS.forEach((cn, r) => {
  const block = blocks[r];
  assert.ok(block.startsWith(`${r} ${cn}\n`));
  const states = byRequest[r];
  const first = states[0];
  const last = states.at(-1);
  const pkg = M.PACKAGES[cn.slice(0, cn.lastIndexOf("."))];
  assert.equal(value("packageToModule", block), pkg ? `${pkg.module} -> ${pkg.loader}` : "null (no named module)");
  for (const loader of ["app", "platform"]) {
    assert.equal(value(`before ${loader}.findLoadedClass`, block), first.defined[loader].includes(cn) ? "hit" : "null", `${cn} before ${loader}`);
    assert.equal(value(`after ${loader}.findLoadedClass`, block), last.defined[loader].includes(cn) ? "hit" : "null", `${cn} after ${loader}`);
  }
  const window = block.split("-- loadClass begin")[1].split("-- loadClass end")[0];
  const load = window.match(new RegExp(`\\[class,load\\] ${cn.replace(/\./g, "\\.")} source: (.*)$`, "m"));
  const definedNow = M.LOADERS.some((l) => last.defined[l].length > first.defined[l].length);
  assert.equal(!!load, definedNow, `${cn}: class+load line iff defined in this request`);
  if (load) assert.equal(load[1], M.STORE[cn].source);
  if (last.out.error) {
    assert.match(window, new RegExp(`ClassNotFoundException: ${cn.replace(/\./g, "\\.")}`));
    assert.ok(!block.includes("getClassLoader:"));
  } else {
    assert.equal(value("getClassLoader", block), last.out.loader === "boot" ? "null (bootstrap)" : last.out.loader);
    assert.equal(value("getModule", block), pkg ? pkg.module : "null");
  }
});

// ---- 그림의 리드아웃은 이 문자열과 같아야 한다 ----
assert.deepEqual(T.map(M.readout), [
  "java.time.Duration | app | loadClass",
  "java.time.Duration | app | findLoadedClass → null",
  "java.time.Duration | app | findLoadedModule → java.base @boot",
  "java.time.Duration | boot | delegated by app",
  "java.time.Duration | boot | findBootstrapClassOrNull → class",
  "java.time.Duration | app | class from boot",
  "java.time.Duration | app | loadClass → class @boot",
  "java.sql.Types | app | loadClass",
  "java.sql.Types | app | findLoadedClass → null",
  "java.sql.Types | app | findLoadedModule → java.sql @platform",
  "java.sql.Types | platform | delegated by app",
  "java.sql.Types | platform | findLoadedClass → null",
  "java.sql.Types | platform | findLoadedModule → java.sql @platform",
  "java.sql.Types | platform | findClassInModuleOrNull → class",
  "java.sql.Types | app | class from platform",
  "java.sql.Types | app | loadClass → class @platform",
  "demo.Greeter | app | loadClass",
  "demo.Greeter | app | findLoadedClass → null",
  "demo.Greeter | app | findLoadedModule → null",
  "demo.Greeter | platform | parent of app",
  "demo.Greeter | platform | findLoadedClass → null",
  "demo.Greeter | platform | findLoadedModule → null",
  "demo.Greeter | boot | parent of platform",
  "demo.Greeter | boot | findBootstrapClassOrNull → null",
  "demo.Greeter | platform | null from boot",
  "demo.Greeter | app | null from platform (no class path)",
  "demo.Greeter | app | findClassOnClassPathOrNull → class",
  "demo.Greeter | app | loadClass → class @app",
  "demo.Greeter | app | loadClass",
  "demo.Greeter | app | findLoadedClass → class",
  "demo.Greeter | app | loadClass → class @app",
  "demo.Missing | app | loadClass",
  "demo.Missing | app | findLoadedClass → null",
  "demo.Missing | app | findLoadedModule → null",
  "demo.Missing | platform | parent of app",
  "demo.Missing | platform | findLoadedClass → null",
  "demo.Missing | platform | findLoadedModule → null",
  "demo.Missing | boot | parent of platform",
  "demo.Missing | boot | findBootstrapClassOrNull → null",
  "demo.Missing | platform | null from boot",
  "demo.Missing | app | null from platform (no class path)",
  "demo.Missing | app | findClassOnClassPathOrNull → null",
  "demo.Missing | app | loadClass → ClassNotFoundException",
]);

const steps = T.length - 1;
console.log(`model check passed: ${M.REQUESTS.length} requests, ${steps} steps, JDI trace and probe output match (OpenJDK ${M.RUNTIME})`);
