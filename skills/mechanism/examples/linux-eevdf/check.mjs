// node check.mjs: model.mjs를 truth/의 실측(Linux 7.0.14-linuxkit, arm64, CPU 10)과 대조한다 (실패하면 exit 1)
// 오프라인으로 돈다. 커널 원문 대조는 check-source.mjs가 따로 한다(원문은 저장소에 두지 않는다).
// 결정적인 부분(가중치, 슬라이스, vruntime 증가식, 자격과 마감 규칙)은 정확히, 통계적인 부분(점유율,
// 실행 길이, 스냅숏에서 이어지는 선택 순서)은 아래 적은 허용치 안에서 맞춘다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "truth", name), "utf8");
const env = read("env.txt");
// "ms.us" 문자열(6자리 소수, ns 정밀도)을 ns 정수로
const ns = (text) => {
  const neg = text.startsWith("-");
  const [a, b] = text.replace("-", "").split(".");
  const v = Number(a) * 1e6 + Number((b ?? "").padEnd(6, "0"));
  return neg ? -v : v;
};
const envValue = (key) => env.split(`== ${key}\n`)[1].split("\n")[0].trim();
const share = (xs) => {
  const total = xs.reduce((a, b) => a + b, 0);
  return xs.map((x) => x / total);
};

// ---- 1. 대상 커널과 스케줄러 설정 (결정적) ----
assert.equal(envValue("uname -r"), M.KERNEL);
assert.match(envValue("uname -v"), /^#1 SMP PREEMPT /);
assert.equal(envValue("uname -m"), "aarch64");
assert.equal(Number(envValue("nproc --all")), M.ONLINE_CPUS);
assert.equal(envValue("/sys/devices/system/cpu/online"), `0-${M.ONLINE_CPUS - 1}`);
assert.match(env, new RegExp(`^CONFIG_HZ=${M.HZ}$`, "m"));
assert.match(env, /^CONFIG_PREEMPT_LAZY=y$/m);
assert.match(env, /^# CONFIG_PREEMPT_DYNAMIC is not set$/m);
assert.match(env, /^CONFIG_FAIR_GROUP_SCHED=y$/m);
const features = envValue("/sys/kernel/debug/sched/features").split(/\s+/);
for (const f of ["PLACE_LAG", "PLACE_DEADLINE_INITIAL", "RUN_TO_PARITY", "PREEMPT_SHORT", "NO_NEXT_BUDDY", "PICK_BUDDY", "DELAY_DEQUEUE", "NO_HRTICK"]) {
  assert.ok(features.includes(f), `sched feature ${f}`);
}
assert.equal(Number(envValue("/sys/kernel/debug/sched/tunable_scaling")), M.TUNABLE_SCALING);
// base_slice_ns = (1 + ilog2(min(11, 8))) * 700000
assert.equal(M.scalingFactor(M.ONLINE_CPUS), 4);
assert.equal(Number(envValue("/sys/kernel/debug/sched/base_slice_ns")), M.BASE_SLICE_NS);
assert.equal(M.BASE_SLICE_NS, 2800000);
assert.equal(M.TICK_NS, 1000000);

// ---- 2. /proc/<pid>/sched 샘플: 가중치, prio, 슬라이스 (결정적) ----
function procSamples(name) {
  return read(name)
    .split(/^== sample /m)
    .filter(Boolean)
    .map((block) => {
      const field = (key) => block.match(new RegExp(`^${key.replace(/\./g, "\\.")}\\s+:\\s+(\\S+)`, "m"))[1];
      return {
        i: Number(block.match(/^(\d+) pid/)[1]),
        comm: block.match(/\n(\S+) \(\d+, #threads/)[1],
        v: ns(field("se.vruntime")),
        sum: ns(field("se.sum_exec_runtime")),
        switches: Number(field("nr_switches")),
        weight: Number(field("se.load.weight")),
        prio: Number(field("prio")),
        slice: Number(field("se.slice")),
      };
    });
}
const proc = { fig: procSamples("proc-sched.txt"), wide: procSamples("proc-sched-wide.txt") };
for (const [key, set] of [["fig", M.TASKS], ["wide", M.WIDE_TASKS]]) {
  for (const t of set) {
    const mine = proc[key].filter((p) => p.comm === t.name);
    assert.ok(mine.length >= 2, `${t.name} samples`);
    for (const p of mine) {
      assert.equal(p.weight, t.weight * 1024, `${t.name} se.load.weight`);
      assert.equal(p.prio, 120 + t.nice, `${t.name} prio`);
      assert.equal(p.slice, M.BASE_SLICE_NS, `${t.name} se.slice`);
    }
  }
}

// ---- 3. vruntime 증가식 calc_delta_fair (결정적) ----
assert.equal(M.invWeight(1024), 2 ** 22);
assert.deepEqual(M.TASKS.map((t) => M.vslice(t.weight)), [2800000, 3496585, 8558806]);
assert.deepEqual(M.TASKS.map((t) => M.calcDeltaFair(M.TICK_NS, t.weight)), [1000000, 1248780, 3056716]);
for (const t of [...M.TASKS, ...M.WIDE_TASKS]) {
  for (const d of [1, 999, M.TICK_NS, M.BASE_SLICE_NS, 123456789]) {
    assert.ok(Math.abs(M.calcDeltaFair(d, t.weight) - (d * 1024) / t.weight) < 1 + d * 1e-6, `${t.name} calc_delta_fair(${d})`);
  }
}
// 실측: 창(첫 샘플에서 마지막 샘플까지) 동안 vruntime 증가 = 실행 시간에 calc_delta_fair를 건 값.
// 갱신(틱, 전환)마다 따로 내림하므로 갱신 횟수만큼만 모자랄 수 있다. nice 0은 곱하지 않아 정확히 같다
function windowOf(samples, set) {
  const first = Math.min(...samples.map((p) => p.i));
  const last = Math.max(...samples.map((p) => p.i));
  return set.map((t) => {
    const a = samples.find((p) => p.i === first && p.comm === t.name);
    const b = samples.find((p) => p.i === last && p.comm === t.name);
    return { name: t.name, weight: t.weight, dsum: b.sum - a.sum, dv: b.v - a.v, dsw: b.switches - a.switches };
  });
}
const windows = { fig: windowOf(proc.fig, M.TASKS), wide: windowOf(proc.wide, M.WIDE_TASKS) };
for (const win of Object.values(windows)) {
  for (const x of win) {
    const want = M.calcDeltaFair(x.dsum, x.weight);
    const updates = Math.ceil(x.dsum / M.TICK_NS) + 2 * x.dsw;
    if (x.weight === M.NICE_0_WEIGHT) assert.equal(x.dv, want, `${x.name} vruntime == sum_exec_runtime`);
    else assert.ok(x.dv <= want && want - x.dv <= updates, `${x.name} vruntime ${x.dv} vs ${want} (updates ${updates})`);
  }
}

// ---- 4. sched/debug 스냅숏: E/N 표시, 마감, 슬라이스, lag 한계 (결정적) ----
const snaps = read("debug-sched.txt")
  .split(/^== sample /m)
  .filter(Boolean)
  .map((block) => {
    const tasks = block
      .split("\n")
      .filter((line) => /^[ >][RS]\s+\S+\s+\d+\s/.test(line))
      .map((line) => {
        const c = line.trim().split(/\s+/);
        return { curr: line.startsWith(">"), comm: c[1], v: ns(c[3]), flag: c[4], d: ns(c[5]), slice: ns(c[6]) };
      });
    return {
      i: Number(block.match(/^(\d+)/)[1]),
      at: ns(block.match(/\.se->exec_start\s+:\s+(\S+)/)[1]),
      queued: Number(block.match(/\.nr_queued\s+:\s+(\d+)/)[1]),
      avg: ns(block.match(/\.avg_vruntime\s+:\s+(\S+)/)[1]),
      tasks: M.TASKS.map((t) => tasks.find((x) => x.comm === t.name)),
    };
  });
assert.ok(snaps.length >= 5, "debug snapshots");
let flags = 0;
for (const snap of snaps) {
  assert.equal(snap.queued, M.TASKS.length, `sample ${snap.i} nr_queued`);
  assert.equal(snap.tasks.filter((x) => x.curr).length, 1, `sample ${snap.i} one running`);
  M.TASKS.forEach((t, i) => {
    const x = snap.tasks[i];
    assert.equal(x.slice, M.BASE_SLICE_NS, `sample ${snap.i} ${t.name} slice`);
    // print_task()의 E/N은 entity_eligible(). 같은 식을 스냅숏의 vruntime에 건다
    assert.equal(x.flag, M.eligible(snap.tasks, M.TASKS, i) ? "E" : "N", `sample ${snap.i} ${t.name} eligible`);
    flags += 1;
    // 마감은 v보다 앞에 있고, 갱신한 순간(d = v + vslice)보다 멀어지지 않는다
    assert.ok(x.d - x.v > 0 && x.d - x.v <= M.vslice(t.weight), `sample ${snap.i} ${t.name} deadline`);
    // lag 한계: |V - v| <= calc_delta_fair(slice + TICK) (update_entity_lag()의 clamp, EEVDF 정상 상태 한계)
    assert.ok(Math.abs(snap.avg - x.v) <= M.calcDeltaFair(M.BASE_SLICE_NS + M.TICK_NS, t.weight), `sample ${snap.i} ${t.name} lag`);
  });
}

// ---- 5. sched_switch: 실행 길이와 점유율 (통계적) ----
function runsOf(name, set) {
  const names = new Set(set.map((t) => t.name));
  const events = read(name)
    .split("\n")
    .filter((line) => line.includes(" sched_switch: "))
    .map((line) => {
      const m = line.match(/ (\d+)\.(\d+): sched_switch: prev_comm=(\S+) .* ==> next_comm=(\S+) next_pid=/);
      return { t: Number(m[1]) * 1e9 + Number(m[2]) * 1e3, prev: m[3], next: m[4] };
    });
  const runs = [];
  let open = null;
  let noise = 0;
  for (const e of events) {
    if (open && names.has(e.prev)) runs.push({ comm: e.prev, len: e.t - open.t, cut: !names.has(e.next) });
    if (!names.has(e.next)) noise += 1;
    open = names.has(e.next) ? { comm: e.next, t: e.t } : null;
  }
  return { events, runs, noise };
}
const near = (len, want, tol = 100000) => Math.abs(len - want) <= tol;
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1];
// 그림의 셋: 바뀔 때마다 거의 3틱(3 ms). 허용치: 3 ms +-0.1 ms가 90% 이상, 중앙값이 정확히 3 ms 근처
const fig = runsOf("sched_switch.txt", M.TASKS);
const figThree = fig.runs.filter((r) => near(r.len, 3 * M.TICK_NS)).length / fig.runs.length;
assert.ok(figThree >= 0.9, `fig runs at 3 ms: ${figThree}`);
assert.ok(near(median(fig.runs.map((r) => r.len)), 3 * M.TICK_NS, 20000));
assert.ok(fig.noise <= 20, `other tasks on CPU ${M.PROBE_CPU}: ${fig.noise}`);
// 넓은 셋: 무거운 w0은 슬라이스 하나 뒤에도 틱마다 다시 뽑혀 28 ms 안팎을 내리 돌고, w10은 3 ms
const wide = runsOf("sched_switch-wide.txt", M.WIDE_TASKS);
const wideRuns = (comm) => wide.runs.filter((r) => r.comm === comm && !r.cut).map((r) => r.len);
assert.ok(near(median(wideRuns("w0")), 28 * M.TICK_NS, 600000), `w0 median ${median(wideRuns("w0"))}`);
assert.ok(wideRuns("w10").filter((len) => near(len, 3 * M.TICK_NS)).length / wideRuns("w10").length >= 0.9);

// 모델을 오래 돌린 결과와 비교한다
function longRun(set, decisions) {
  const t = M.trace({ tasks: set, decisions });
  const lens = [];
  let runStart = 0;
  let clock = 0;
  for (let i = 1; i < t.length; i++) {
    clock += t[i].ran.ticks;
    if (t[i].switched) {
      lens.push({ comm: set[t[i].ran.task].name, ticks: clock - runStart });
      runStart = clock;
    }
  }
  return { last: t.at(-1), lens };
}
const figLong = longRun(M.TASKS, 2000);
const wideLong = longRun(M.WIDE_TASKS, 2000);
assert.ok(figLong.lens.filter((r) => r.ticks === 3).length / figLong.lens.length >= 0.95);
const wideW0 = wideLong.lens.filter((r) => r.comm === "w0").map((r) => r.ticks);
assert.equal(median(wideW0), 28);
assert.ok(wideLong.lens.filter((r) => r.comm === "w10").every((r) => r.ticks === 3));
// 점유율: 실측 sum_exec_runtime 증가분, 가중치 비, 모델 장기 실행이 서로 0.01 안에 든다
for (const [win, set, long] of [[windows.fig, M.TASKS, figLong], [windows.wide, M.WIDE_TASKS, wideLong]]) {
  const measured = share(win.map((x) => x.dsum));
  const weights = share(set.map((t) => t.weight));
  const model = share(long.last.tasks.map((x) => x.sum));
  set.forEach((t, i) => {
    assert.ok(Math.abs(measured[i] - weights[i]) <= 0.01, `${t.name} share ${measured[i]} vs weight ${weights[i]}`);
    assert.ok(Math.abs(model[i] - weights[i]) <= 0.005, `${t.name} model share`);
  });
}

// ---- 6. 스냅숏에서 이어 돌리기: 모델이 다음 전환 8번을 맞히는가 (통계적) ----
// 스냅숏의 v, d, 지금 도는 태스크에서 모델을 시작하고, 그 뒤 trace의 전환(다른 태스크로 바뀜)과 비교한다.
// 허용치: 48번 중 40번 이상, 그리고 8번 모두 맞힌 스냅숏이 4개 이상. 맞힌 전환의 시각은 0.2 ms 안
let hits = 0;
let total = 0;
let perfect = 0;
for (const snap of snaps) {
  const curr = snap.tasks.findIndex((x) => x.curr);
  const tasks = snap.tasks.map((x, i) => ({ v: x.v, d: x.d, sum: 0, runs: 0, seq: i }));
  let s = { set: M.TASKS, decisions: Infinity, k: 0, tasks, curr, vprot: tasks[curr].d, seq: M.TASKS.length, done: false };
  const predicted = [];
  let clock = 0;
  for (let guard = 0; predicted.length < 8 && guard < 200; guard++) {
    s = M.step(s);
    clock += s.ran.ticks * M.TICK_NS;
    if (s.switched) predicted.push({ comm: M.TASKS[s.curr].name, at: clock });
  }
  const actual = fig.events
    .filter((e) => e.t > snap.at && M.TASKS.some((t) => t.name === e.next))
    .filter((e) => !(e.next === M.TASKS[curr].name && e.t - snap.at < 200000))
    .slice(0, 8)
    .map((e) => ({ comm: e.next, at: e.t - snap.at }));
  let ok = 0;
  for (let i = 0; i < predicted.length && predicted[i].comm === actual[i]?.comm; i++) {
    assert.ok(Math.abs(predicted[i].at - actual[i].at) <= 200000, `sample ${snap.i} switch ${i} time`);
    ok += 1;
  }
  hits += ok;
  total += predicted.length;
  if (ok === predicted.length) perfect += 1;
}
assert.ok(hits >= 40 && total === 48, `replay ${hits}/${total}`);
assert.ok(perfect >= 4, `replay perfect snapshots ${perfect}`);

// ---- 7. 모델 자체: 비변경성, 끝 상태, 규칙, 리드아웃 (결정적) ----
const s0 = M.makeState();
const before = JSON.stringify(s0);
M.step(s0);
assert.equal(JSON.stringify(s0), before, "step does not mutate");
const t = M.trace();
assert.equal(t.length, M.DECISIONS + 1);
assert.equal(M.step(t.at(-1)), t.at(-1), "step on done is identity");
const W = M.TASKS.reduce((a, x) => a + x.weight, 0);
for (let i = 1; i < t.length; i++) {
  // 한 결정 = 3틱 실행. 누가 돌든 V는 3 ms * 1024 / W 만큼 간다 (내림 오차 2 ns 안)
  assert.equal(t[i].ran.ticks, 3);
  assert.ok(Math.abs(t[i].V - t[i - 1].V - (3 * M.TICK_NS * 1024) / W) <= 2, `V step ${i}`);
  assert.ok(t[i].switched, "fig trace never re-picks");
  for (let j = 0; j < M.TASKS.length; j++) {
    assert.ok(Math.abs(t[i].V - t[i].tasks[j].v) <= M.calcDeltaFair(M.BASE_SLICE_NS + M.TICK_NS, M.TASKS[j].weight), `lag bound ${i} ${j}`);
  }
}
// 뽑힌 것은 늘 자격이 있다. #2에서는 마감이 가장 이른 n0이 자격이 없어 n5가 뽑힌다
for (const s of t) assert.ok(s.elig[s.curr]);
const gated = t.filter((s) => {
  const earliest = s.tasks.reduce((b, x, i) => (x.d < s.tasks[b].d ? i : b), 0);
  return earliest !== s.curr;
});
assert.deepEqual(gated.map((s) => s.k), [2]);
assert.equal(t[2].tasks[0].d < t[2].tasks[2].d && !t[2].elig[0], true);
// 다시 뽑힘(전환 없는 결정)은 이 셋에서 #32에 처음 나온다(캡션). nice 0, 2, 5 셋은 #15 전까지 자격이 결과를 바꾸지 않는다(브리프)
assert.equal(M.trace({ decisions: 40 }).find((s) => s.ran && !s.switched).k, 32);
const earliestSkipped = (s) => s.tasks.reduce((b, x, i) => (x.d < s.tasks[b].d ? i : b), 0) !== s.curr;
const set025 = [M.TASKS[0], { name: "n2", nice: 2, weight: 655 }, M.TASKS[2]];
assert.equal(M.trace({ tasks: set025, decisions: 40 }).find(earliestSkipped).k, 15);
// 같은 가중치 둘은 3틱씩 번갈아 돈다. 넓은 셋은 다시 뽑힘(전환 없는 결정)이 생기고 그때는 1틱만 돈다
const pair = M.trace({ tasks: [M.TASKS[0], { ...M.TASKS[0], name: "m0" }], decisions: 8 });
assert.deepEqual(pair.slice(1).map((s) => s.ran.task), [0, 1, 0, 1, 0, 1, 0, 1]);
const wideT = M.trace({ tasks: M.WIDE_TASKS, decisions: 40 });
const repicks = wideT.filter((s) => s.ran && !s.switched);
assert.ok(repicks.length > 20);
assert.ok(wideT.slice(1).every((s, i) => (wideT[i].switched ? s.ran.ticks <= 3 : s.ran.ticks === 1)), "fresh run up to 3 ticks, re-picked 1 tick");

assert.deepEqual(t.map(M.readout), [
  "#0 pick n0 | elig n0 n1 n5 | V 0.00 ms",
  "#1 pick n1 | elig n1 n5 | V 1.41 ms",
  "#2 pick n5 | elig n5 | V 2.82 ms",
  "#3 pick n0 | elig n0 n1 | V 4.23 ms",
  "#4 pick n1 | elig n1 | V 5.64 ms",
  "#5 pick n0 | elig n0 | V 7.05 ms",
  "#6 pick n1 | elig n1 | V 8.46 ms",
  "#7 pick n0 | elig n0 n5 | V 9.87 ms",
  "#8 pick n1 | elig n1 n5 | V 11.28 ms",
  "#9 pick n0 | elig n0 n5 | V 12.69 ms",
  "#10 pick n5 | elig n5 | V 14.10 ms",
  "#11 pick n0 | elig n0 n1 | V 15.51 ms",
  "#12 pick n1 | elig n1 | V 16.92 ms",
]);
assert.ok(Math.max(...t.map((s) => M.readout(s).length)) <= 40, "readout fits the card at 390 px");

const pct = (xs) => xs.map((x) => (x * 100).toFixed(1)).join("/");
// 캡션(brief.md)의 숫자는 모델 상수와 이 실측에서 나온다
const caption = readFileSync(join(HERE, "brief.md"), "utf8").split(/^## 캡션\s*$/m)[1].split(/^## /m)[0];
for (const text of [
  `Linux ${M.KERNEL.split("-")[0]}`,
  `CPU ${M.PROBE_CPU}`,
  `nice ${M.TASKS.map((x) => x.nice).join(", ")}`,
  `기본 슬라이스 ${M.BASE_SLICE_NS / 1e6} ms(${M.NORMALIZED_BASE_SLICE_NS / 1e6} ms에 CPU ${M.ONLINE_CPUS}개를 8로 자른 배율 ${M.scalingFactor(M.ONLINE_CPUS)}`,
  `가중치 ${M.TASKS.map((x) => x.weight).join(", ")}`,
  `${M.TICK_NS / 1e6} ms 틱`,
  `${t[1].ran.ticks}틱 실행`,
  `점유율 ${pct(share(windows.fig.map((x) => x.dsum)))} %`,
  "#32",
]) assert.ok(caption.includes(text), `caption: ${text}`);
console.log(
  `model check passed: base slice ${M.BASE_SLICE_NS} ns, ${M.DECISIONS} decisions, ` +
    `share ${pct(share(windows.fig.map((x) => x.dsum)))} % (weights ${pct(share(M.TASKS.map((x) => x.weight)))}), ` +
    `3 ms runs ${(figThree * 100).toFixed(1)} %, E/N ${flags}, replay ${hits}/${total}`,
);
