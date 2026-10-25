// node check.mjs: model.mjs를 Corretto 21.0.1의 플래그, PrintTieredEvents 로그, PrintInlining 로그와 대조한다 (실패하면 exit 1)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { C1_THREADS, C2_THREADS, EVENTS, FLAGS, NOTIFY, callPredicate, decide, gauge, makeState, readout, step, trace } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const truth = (name) => readFileSync(join(HERE, "truth", name), "utf8");

// 1. 플래그: truth/flags.txt의 PrintFlagsFinal 값과 같다
const flags = truth("flags.txt");
for (const [name, want] of Object.entries(FLAGS)) {
  const m = flags.match(new RegExp(`\\s${name}\\s+=\\s+(\\d+)\\s`));
  assert.ok(m, `${name} missing from flags.txt`);
  assert.equal(Number(m[1]), want, name);
}
assert.match(flags, /CompileThresholdScaling\s+= 1\.000000/);
assert.match(flags, /TieredCompilation\s+= true/);
assert.match(flags, /build 21\.0\.1\+12-LTS/);
// CICompilerCount 4는 1개 C1 스레드와 3개 C2 스레드로 나뉜다
assert.equal(C1_THREADS, 1);
assert.equal(C2_THREADS, 3);
assert.deepEqual(NOTIFY, { 0: 128, 3: 1024 });

// 2. 술어 경계: 200과 5000에서 바뀐다 (b = 0이면 Min/Compile 갈래는 15000 아래에서 성립하지 않는다)
assert.equal(callPredicate(0, 199), false);
assert.equal(callPredicate(0, 200), true);
assert.equal(callPredicate(3, 4999), false);
assert.equal(callPredicate(3, 5000), true);
assert.equal(callPredicate(3, 1000, 14000), true); // i >= 600 && i + b >= 15000
// 알림 간격의 배수만 검사되므로 결정은 200 위 첫 128 배수(256), 5000 위 첫 1024 배수(5120)에서 난다
const firstAbove = (threshold, every) => Math.ceil(threshold / every) * every;
assert.equal(firstAbove(FLAGS.Tier3InvocationThreshold, NOTIFY[0]), 256);
assert.equal(firstAbove(FLAGS.Tier4InvocationThreshold, NOTIFY[3]), 5120);
// deopt 뒤 tier 0에서 MDO가 이미 익었으면 C1을 건너뛰고 4로 간다
assert.equal(decide(0, { i: 5548, mdo: 5248 }).next, 4);
assert.equal(decide(0, { i: 5548, mdo: 4000 }).next, 3);

// 3. STEP은 입력 state를 바꾸지 않는다, done에서는 그대로다
const s0 = makeState();
const before = JSON.stringify(s0);
step(s0);
assert.equal(JSON.stringify(s0), before);
const t = trace();
assert.equal(t.length, EVENTS.length + 1);
assert.equal(step(t.at(-1)), t.at(-1));
assert.ok(t.every((s) => s.tier <= FLAGS.TieredStopAtLevel && [0, 3, 4].includes(s.tier)));
assert.ok(t.every((s) => s.seen.length <= FLAGS.TypeProfileWidth));
assert.ok(t.every((s) => gauge(s) >= 0 && gauge(s) < 1.5)); // 게이지 눈금은 1.5까지

// 4. 로그 대조: truth/print-tiered.txt의 measure 사건을 순서대로 꺼낸다
const log = [];
for (const line of truth("print-tiered.txt").split("\n")) {
  let m;
  if ((m = line.match(/\[call level=(\d) \[Tiers\.measure.*total=(\d+),(\d+) mdo=(\d+)\((\d+)\)/))) {
    log.push({ kind: "check", level: +m[1], i: +m[2], b: +m[3], mdo: +m[4], start: +m[5] });
  } else if ((m = line.match(/\[compile level=(\d) \[Tiers\.measure/))) {
    log.push({ kind: "request", level: +m[1] });
  } else if ((m = line.match(/^\s*\d+\s+\d+\s+(\d)\s+Tiers::measure \(9 bytes\)\s+made not entrant/))) {
    log.push({ kind: "retire", level: +m[1] });
  } else if ((m = line.match(/^\s*\d+\s+\d+\s+(\d)\s+Tiers::measure \(9 bytes\)\s*$/))) {
    log.push({ kind: "compile", level: +m[1] });
  } else if ((m = line.match(/deoptimization\].*level=(\d) Tiers\.measure.*trap_bci=(\d+) (\w+) (\w+)/))) {
    log.push({ kind: "trap", level: +m[1], bci: +m[2], reason: m[3], action: m[4] });
  }
}
// 검사 사건: 모델이 읽은 tier와 카운터가 로그와 같다. backedge는 늘 0, MDO 시작 카운터는 끝까지 0(reprofile 없음)
const logChecks = log.filter((e) => e.kind === "check");
const modelChecks = t.slice(1).filter((s) => s.last.kind === "check").map((s, n) => ({ s, prev: t[t.indexOf(s) - 1], n }));
assert.equal(modelChecks.length, logChecks.length);
modelChecks.forEach(({ s, prev, n }) => {
  const e = logChecks[n];
  const ev = EVENTS[prev.at];
  assert.equal(prev.tier, e.level, `check ${n} level`);
  assert.equal(ev.i, e.i, `check ${n} total`);
  assert.equal(ev.mdo ?? 0, e.mdo, `check ${n} mdo`);
  assert.equal(e.b, 0);
  assert.equal(e.start, 0);
  // 읽은 카운터는 그 tier의 알림 간격 배수다 (tier 0 뒤 deopt도 MDO 카운터에 Tier0 마스크)
  assert.equal(s.reading.count % NOTIFY[prev.tier], 0, `check ${n} on a notify boundary`);
});
// 요청: 모델이 큐에 넣은 레벨 = 로그의 compile level, 같은 순서
assert.deepEqual(t.filter((s) => s.last && s.last.kind === "check" && s.last.request !== null).map((s) => s.last.request), log.filter((e) => e.kind === "request").map((e) => e.level));
assert.deepEqual(log.filter((e) => e.kind === "request").map((e) => e.level), [3, 4, 4]);
// 설치: PrintCompilation이 찍은 컴파일 레벨 = 모델 install 레벨
assert.deepEqual(t.filter((s) => s.last && s.last.kind === "install").map((s) => s.last.level), log.filter((e) => e.kind === "compile").map((e) => e.level));
// made not entrant: tier 3은 교체로, tier 4는 네 번째 트랩으로
assert.deepEqual(t.at(-1).retired, log.filter((e) => e.kind === "retire").map((e) => e.level));
assert.deepEqual(t.at(-1).retired, [3, 4]);
// 트랩: 모두 tier 4 코드의 bci 1 class_check maybe_recompile이고, PerBytecodeTrapLimit번째에 not entrant
const traps = log.filter((e) => e.kind === "trap");
assert.equal(traps.length, FLAGS.PerBytecodeTrapLimit);
assert.ok(traps.every((e) => e.level === 4 && e.bci === 1 && e.reason === "class_check" && e.action === "maybe_recompile"));
const order = log.map((e) => e.kind).join(",");
assert.ok(order.includes("trap,trap,trap,trap,retire,check,request,compile"), order);
const notEntrant = t.findIndex((s) => s.last && s.last.kind === "trap" && s.last.notEntrant);
assert.equal(t[notEntrant].last.count, FLAGS.PerBytecodeTrapLimit);
assert.equal(t[notEntrant].tier, 0);

// 5. 수신자 프로파일: 첫 C2는 Square만, 재컴파일은 Square와 Circle을 인라인했다 (truth/print-inlining.txt)
const inlining = truth("print-inlining.txt");
const c2 = inlining.split(/^.*\s4\s+Tiers::measure \(9 bytes\)\s*$/m).slice(1).map((block) => [...block.matchAll(/TypeProfile \(\d+\/\d+ counts\) = Tiers\$(\w+)/g)].map((m) => m[1]).sort());
assert.deepEqual(c2.filter((list) => list.length > 0), [["Square"], ["Circle", "Square"]]);
const accepts = t.filter((s) => s.last && s.last.kind === "install" && s.last.level === 4).map((s) => s.accepts.slice().sort());
assert.deepEqual(accepts, [["Square"], ["Circle", "Square"]]);

// 6. 그림의 리드아웃은 이 문자열과 같아야 한다
assert.deepEqual(t.map(readout), [
  "tier 0 | entry | i 0",
  "tier 0 | i 128 < 200 | stay",
  "tier 0 | i 256 ≥ 200 | queue 3",
  "tier 3 | C1 installed",
  "tier 3 | mdo 1024 < 5000 | stay",
  "tier 3 | mdo 2048 < 5000 | stay",
  "tier 3 | mdo 3072 < 5000 | stay",
  "tier 3 | mdo 4096 < 5000 | stay",
  "tier 3 | mdo 5120 ≥ 5000 | queue 4",
  "tier 4 | C2 installed | Square",
  "tier 4 | trap 1/4 | keep code",
  "tier 4 | trap 2/4 | keep code",
  "tier 4 | trap 3/4 | keep code",
  "tier 0 | trap 4/4 | not entrant",
  "tier 0 | mdo 5248 ≥ 5000 | queue 4",
  "tier 4 | C2 installed | Square+Circle",
]);

console.log(`model check passed: ${EVENTS.length} events, tiers ${[...new Set(t.map((s) => s.tier))].join(" ")}, ${log.length} log events matched, C1 ${C1_THREADS} + C2 ${C2_THREADS} threads`);
