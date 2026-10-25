// node check.mjs: model.mjs를 truth/의 실측 로그(Corretto 21.0.1, -Xlog:safepoint)에 대조한다 (실패하면 exit 1)
// 오프라인으로 돈다. HotSpot 원문 대조는 check-source.mjs가 따로 한다(원문은 저장소에 두지 않는다)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "truth", name), "utf8");
const log = read("safepoint.log");
const stats = read("safepoint-stats.log");
const dump = read("threads.txt");
const compile = read("compile.txt");

// 1. 대상 VM과 작업: 덤프 머리, VM 스레드 로그
assert.match(dump, /OpenJDK 64-Bit Server VM \(21\.0\.1\+12-LTS/);
assert.match(log, new RegExp(`Evaluating  safepoint VM operation: ${M.VM_OP}`));
const opAt = log.indexOf(`Evaluating  safepoint VM operation: ${M.VM_OP}`);
const section = log.slice(opAt, log.indexOf(`Safepoint "${M.VM_OP}"`, opAt));
assert.match(section, new RegExp(`using ${M.WAIT_BARRIER} wait barrier\\. \\(${M.TOTAL_THREADS} threads\\)`));

// 2. 시간 4개 (실행 1회 값): info 줄과 stats 표가 서로 같고 모델 상수와 같다
const info = log.match(new RegExp(`Safepoint "${M.VM_OP}".*Reaching safepoint: (\\d+) ns, Cleanup: (\\d+) ns, At safepoint: (\\d+) ns, Total: (\\d+) ns`));
assert.ok(info, "info line");
assert.deepEqual(info.slice(1).map(Number), [M.TIMES_NS.reaching, M.TIMES_NS.cleanup, M.TIMES_NS.atSafepoint, M.TIMES_NS.total]);
const row = stats.match(new RegExp(`^${M.VM_OP}\\s+\\[\\s+(\\d+)\\s+(\\d+) \\]\\[\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+) \\]\\s+(\\d+)$`, "m"));
assert.ok(row, "stats row");
const [total, initialRunning, sync, cleanup, vmop, sum, traps] = row.slice(1).map(Number);
assert.deepEqual([total, initialRunning, traps], [M.TOTAL_THREADS, M.INITIAL_RUNNING, M.PAGE_TRAPS]);
assert.deepEqual([sync, cleanup, vmop, sum], [M.TIMES_NS.reaching, M.TIMES_NS.cleanup, M.TIMES_NS.atSafepoint, M.TIMES_NS.total]);
assert.equal(M.TIMES_NS.reaching + M.TIMES_NS.cleanup + M.TIMES_NS.atSafepoint, M.TIMES_NS.total);

// 3. 스레드 5개: 덤프에 있는 순서와 상태, 그리고 nid
const nid = {};
let lastAt = -1;
for (const t of M.THREADS) {
  const m = dump.match(new RegExp(`^"${t.name}" #\\d+ \\[(\\d+)\\].*\\n\\s+java\\.lang\\.Thread\\.State: (\\S+)`, "m"));
  assert.ok(m, `thread ${t.name} in dump`);
  nid[t.name] = Number(m[1]);
  const at = dump.indexOf(`"${t.name}" #`);
  assert.ok(at > lastAt, `ThreadsList order: ${t.name}`);
  lastAt = at;
  const javaState = { _thread_in_Java: "RUNNABLE", _thread_in_native: "RUNNABLE", _thread_blocked: /WAITING/ }[t.state];
  if (typeof javaState === "string") assert.equal(m[2], javaState, t.name);
  else assert.match(m[2], javaState, t.name);
}
assert.match(dump, /"native"[\s\S]*?at java\.io\.FileInputStream\.readBytes\(java\.base@21\.0\.1\/Native Method\)/);
assert.match(dump, /"sleeper"[\s\S]*?TIMED_WAITING \(sleeping\)/);
assert.match(dump, /"waiter"[\s\S]*?WAITING \(on object monitor\)/);
assert.equal((dump.match(/^"[^"]+" #\d+ /gm) ?? []).length, M.TOTAL_THREADS, "JavaThreads in dump");
// compiled는 C2 OSR(level 4)로, interp는 JIT에서 제외되어 인터프리터로 돈다
assert.match(compile, /%\s+4\s+SafepointProbe::compiledLoop @ 2/);
assert.match(compile, /Excluding compile: static SafepointProbe::interpretedLoop/);

// 4. trace: 이 작업 동안 running으로 찍힌 스레드는 compiled 하나(2회), 그 뒤 polling page trap
const hex = (n) => `0x${n.toString(16)}`;
const runningTids = [...section.matchAll(/Thread: 0x[0-9a-f]+\s+\[(0x[0-9a-f]+)\] State: _running/g)].map((m) => m[1]);
assert.deepEqual(runningTids, [hex(nid.compiled), hex(nid.compiled)]);
assert.match(section, new RegExp(`\\[${nid.compiled}\\s*\\]\\[debug\\]\\[safepoint\\] \\.\\.\\. found polling page loop exception`));
assert.equal(new Set(runningTids).size, M.INITIAL_RUNNING);

// 5. safe 판정 규칙 (근거: truth/hotspot-refs.md의 safepoint_safe_with(), 원문 대조는 check-source.mjs)
for (const t of M.THREADS) assert.equal(M.safeWith(t.state), t.state !== "_thread_in_Java", t.name);

// 6. 모델: STEP 비변경성, 1회차 결과, 순서, 끝 상태
const s0 = M.makeState();
const before = JSON.stringify(s0);
M.step(s0);
assert.equal(JSON.stringify(s0), before);
const t = M.trace();
const done = t.at(-1);
assert.equal(M.step(done), done, "step on done is identity");
const passOne = t.filter((s) => s.last && s.last.op === "check" && s.last.pass === 1);
assert.deepEqual(passOne.map((s) => s.last.thread), M.THREADS.map((x) => x.name));
assert.equal(passOne.filter((s) => !s.last.safe).length, M.INITIAL_RUNNING);
assert.equal(t.filter((s) => s.last && s.last.op === "block" && s.last.via === "trap").length, M.PAGE_TRAPS);
assert.equal(Math.max(...t.map(M.safeCount)), M.THREADS.length);
// 모두 safe가 된 뒤에만 VM 작업이 돈다
const vmAt = t.findIndex((s) => s.last && s.last.op === "vmop");
assert.equal(t[vmAt - 1].phase, "synchronized");
assert.equal(M.safeCount(t[vmAt]), M.THREADS.length);
// 폴링 지점에 멈춘 둘은 다시 달리고, native, sleeper, waiter는 제자리
assert.deepEqual(done.threads.map((x) => x.at), ["resumed", "resumed", "native", "parked", "parked"]);
assert.equal(done.phase, "not_synchronized");
assert.equal(M.safeCount(done), 0);
assert.equal(M.OTHER_THREADS, 11);
// 검사 캐리지가 서는 선로: arm 전 없음, 1회차는 목록 순서, 그 뒤 compiled에 머문다, disarm 뒤 없음
assert.deepEqual(t.map((s) => s.looked), [null, null, null, "compiled", "interp", "native", "sleeper", "waiter", "compiled", "compiled", "compiled", "compiled", null]);

// 그림의 리드아웃은 이 문자열과 같아야 한다
assert.deepEqual(t.map(M.readout), [
  "entry | not_synchronized | safe 0/5",
  "arm | synchronizing | safe 0/5",
  "interp poll | blocked | safe 0/5",
  "pass 1 compiled | in_Java | safe 0/5",
  "pass 1 interp | blocked | safe 1/5",
  "pass 1 native | in_native | safe 2/5",
  "pass 1 sleeper | blocked | safe 3/5",
  "pass 1 waiter | blocked | safe 4/5",
  "pass 2 compiled | in_Java | safe 4/5",
  "compiled trap | blocked | safe 4/5",
  "pass 3 compiled | blocked | safe 5/5",
  "G1CollectFull | synchronized | safe 5/5",
  "disarm | not_synchronized | safe 0/5",
]);
assert.ok(Math.max(...t.map((s) => M.readout(s).length)) <= 40, "readout fits the card at 390 px");

console.log(`model check passed: ${t.length - 1} steps, ${M.VM_OP}, threads ${M.TOTAL_THREADS} (drawn ${M.THREADS.length}), initial_running ${M.INITIAL_RUNNING}, total ${M.TIMES_NS.total} ns`);
