// node check.mjs: model.mjs를 Linux 7.0.14 linuxkit(arm64) 실측 기록과 대조한다 (실패하면 exit 1)
// 원본: truth/ftrace-n8.trace (함수 추적 원본), truth/ftrace-counts.txt (N=8, N=1024 구간별 횟수),
//       truth/strace-n8.txt (반환값과 revents), truth/env.txt (커널과 심볼). 모두 truth/run.sh가 기록했다.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { N, PROBE_TAIL, READY, SCALE, SCRIPT, makeState, readout, step, trace } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "truth", name), "utf8");

// ---- 1. 대상 커널과 심볼 ----
const env = read("env.txt");
assert.match(env, /^Linux 7\.0\.14-linuxkit #1 SMP PREEMPT .* aarch64$/m);
// ep_insert, ep_poll, do_poll, do_pollfd는 이 빌드에서 따로 된 심볼이 없다(인라인). 그 일은 부른 쪽 이름으로 찍힌다
for (const name of ["ep_insert", "ep_poll", "do_poll", "do_pollfd"]) assert.match(env, new RegExp(`^kallsyms ${name} no$`, "m"));
for (const name of ["pipe_poll", "ep_poll_callback", "ep_send_events", "ep_item_poll.isra.0", "__pollwait"]) assert.match(env, new RegExp(`^kallsyms ${name.replace(".", "\\.")} yes$`, "m"));

// ---- 2. 모델 자체 ----
const s0 = makeState();
const before = JSON.stringify(s0);
step(s0);
assert.equal(JSON.stringify(s0), before, "step must not change its input");
const T = trace();
assert.equal(T.length, SCRIPT.length + 1);
assert.equal(T.at(-1).done, true);
assert.equal(step(T.at(-1)), T.at(-1), "done state stays");
assert.deepEqual(SCRIPT[0].fds, READY);

// ---- 3. ftrace 원본을 시스템 콜 구간으로 나눈다 ----
// 함수 하나가 부를 때마다 한 줄: "comm-pid [cpu] flags time: fn <-caller". phase 줄은 프로브가 trace_marker에 쓴 것이다.
const ENTRY = new Set(["do_sys_poll", "do_epoll_ctl", "do_epoll_wait", "anon_pipe_write", "anon_pipe_read"]);
function segmentsOf(text) {
  const head = text.match(/entries-in-buffer\/entries-written: (\d+)\/(\d+)/);
  assert.ok(head && head[1] === head[2], "ring buffer lost entries");
  let phase = null;
  let main = null;
  const out = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*\S+-(\d+)\s+\[\d+\]\s+\S+\s+[\d.]+: (.*)$/);
    if (!m) continue;
    const [, pid, what] = m;
    if (what.startsWith("tracing_mark_write: phase ")) {
      phase = what.slice("tracing_mark_write: phase ".length).trim();
      main ??= pid;
      continue;
    }
    const [fn, caller] = what.split(" <-");
    const who = pid === main ? "main" : "child";
    if (ENTRY.has(fn)) out.push({ phase, who, calls: [] });
    assert.ok(out.length, `event before any syscall: ${what}`);
    out.at(-1).calls.push(`${fn}<-${caller}`);
  }
  return out;
}

// 모델의 한 STEP이 ftrace에 남겨야 할 함수 호출 횟수
function expected(a) {
  const c = {};
  const add = (key, n) => { if (n) c[key] = (c[key] ?? 0) + n; };
  const op = a.ins.op;
  add("anon_pipe_write<-vfs_write", a.writes.length);
  add("anon_pipe_read<-vfs_read", a.reads.length);
  add("do_sys_poll<-__arm64_sys_ppoll", op === "poll" ? a.syscalls : 0);
  add("do_epoll_ctl<-__arm64_sys_epoll_ctl", op === "epoll_ctl" ? a.syscalls : 0);
  add("do_epoll_wait<-do_epoll_pwait.part.0", op === "epoll_wait" ? a.syscalls : 0);
  add(a.via === "poll" ? "pipe_poll<-do_sys_poll" : "pipe_poll<-ep_item_poll.isra.0", a.visits.length);
  add("ep_item_poll.isra.0<-do_epoll_ctl", a.relaysAdded.length);
  add("ep_item_poll.isra.0<-ep_send_events", a.via === "epoll" ? a.visits.length - a.relaysAdded.length : 0);
  add("__pollwait<-pipe_poll", a.hooksAdded.length);
  add("ep_ptable_queue_proc<-pipe_poll", a.relaysAdded.length);
  add("ep_poll_callback<-__wake_up_common", a.callbacks.length);
  add("pollwake<-__wake_up_common", a.pollwake);
  add("ep_autoremove_wake_function<-__wake_up_common", a.epWake);
  add("ep_send_events<-do_epoll_wait", a.sendEvents);
  add("ep_start_scan<-ep_send_events", a.sendEvents);
  add("ep_done_scan<-ep_send_events", a.sendEvents);
  return c;
}
const tally = (calls) => calls.reduce((c, k) => ((c[k] = (c[k] ?? 0) + 1), c), {});
const sorted = (c) => Object.fromEntries(Object.entries(c).sort(([a], [b]) => a.localeCompare(b)));
const syscallsOf = (ins) => (ins.op === "write" || ins.op === "read" || ins.op === "epoll_ctl" ? ins.fds.length : ins.op === "close" ? 0 : 1);

// ---- 4. N=8: 프로브 전체를 모델로 돌려 ftrace의 구간마다 대조한다 ----
const PROBE = [...SCRIPT, ...PROBE_TAIL];
const full = trace({ script: PROBE });
const segs = segmentsOf(read("ftrace-n8.trace"));
let at = 0;
for (const s of full.slice(1)) {
  const a = s.last;
  const mine = segs.slice(at, at + syscallsOf(a.ins));
  at += mine.length;
  const label = `${a.ins.phase} ${a.ins.op}`;
  for (const seg of mine) {
    assert.equal(seg.phase, a.ins.phase, `${label}: trace phase`);
    // 깨우는 write의 구간은 자식이 열고, 깨어난 쪽(main)의 호출이 그 뒤에 이어진다
    assert.equal(seg.who, a.ins.by === "child" ? "child" : "main", `${label}: who`);
  }
  assert.deepEqual(sorted(tally(mine.flatMap((seg) => seg.calls))), sorted(expected(a)), label);
  // poll 첫 바퀴: 항목은 앞에서부터 준비된 첫 파이프까지만 걸린다 (pipe_poll 다음 줄이 __pollwait)
  if (a.ins.op === "poll") {
    const want = ["do_sys_poll<-__arm64_sys_ppoll", ...a.visits.flatMap((fd, k) => ["pipe_poll<-do_sys_poll", ...(k < a.hooksAdded.length ? ["__pollwait<-pipe_poll"] : [])])];
    assert.deepEqual(mine[0].calls, want, `${label}: order`);
    assert.deepEqual(a.hooksAdded, a.visits.slice(0, a.hooksAdded.length));
  }
}
assert.equal(at, segs.length, "every traced syscall is in the model");

// ---- 5. 구간별 횟수 표 (N=8은 원본과 같은지, N=1024는 모델을 그 크기로 돌려 대조) ----
const counts = read("ftrace-counts.txt").split(/^# /m).filter(Boolean);
function table(section) {
  const rows = {};
  for (const line of section.split("\n").slice(1)) {
    const m = line.match(/^(\S+)\s+(main|child|-)\s+(\S+)\s+(\d+)$/);
    if (!m) continue;
    if (m[2] === "-") { rows[m[1]] ??= {}; continue; }
    (rows[m[1]] ??= {})[`${m[2]} ${m[3]}`] = Number(m[4]);
  }
  return rows;
}
function byPhase(states) {
  const rows = {};
  for (const s of states.slice(1)) {
    const a = s.last;
    const r = (rows[a.ins.phase] ??= {});
    // 깨우는 write는 자식의 write와 콜백, 깨어난 main의 나머지로 나뉜다
    for (const [k, n] of Object.entries(expected(a))) {
      const child = a.ins.by === "child" && /^(anon_pipe_write|pollwake|ep_poll_callback|ep_autoremove_wake_function)</.test(k);
      const key = `${child ? "child" : "main"} ${k}`;
      r[key] = (r[key] ?? 0) + n;
    }
  }
  return rows;
}
const [n8, n1024] = counts.map(table);
assert.ok(counts[0].startsWith("ftrace-n8.trace") && counts[1].startsWith("ftrace-n1024.trace"));
const want8 = byPhase(full);
for (const phase of Object.keys(n8)) assert.deepEqual(sorted(n8[phase]), sorted(want8[phase] ?? {}), `n8 ${phase}`);

const ALL1024 = Array.from({ length: SCALE.n }, (_, i) => i);
const scaleScript = SCRIPT.slice(0, SCRIPT.findIndex((ins) => ins.phase === "epoll-wait-1") + 1).map((ins) => (ins.op === "epoll_ctl" ? { ...ins, fds: ALL1024 } : ins));
const big = trace({ n: SCALE.n, script: scaleScript });
const want1024 = byPhase(big);
for (const phase of Object.keys(n1024)) assert.deepEqual(sorted(n1024[phase]), sorted(want1024[phase] ?? {}), `n1024 ${phase}`);
assert.equal(n1024["poll-ready"]["main pipe_poll<-do_sys_poll"], SCALE.pollReady.pipe_poll);
assert.equal(n1024["poll-ready"]["main __pollwait<-pipe_poll"], SCALE.pollReady.__pollwait);
assert.equal(n1024["poll-block"]["main pipe_poll<-do_sys_poll"], SCALE.pollBlock.pipe_poll);
assert.equal(n1024["poll-block"]["main __pollwait<-pipe_poll"], SCALE.pollBlock.__pollwait);
assert.equal(n1024["epoll-ctl"]["main pipe_poll<-ep_item_poll.isra.0"], SCALE.epollCtl.pipe_poll);
assert.equal(n1024["epoll-ctl"]["main ep_ptable_queue_proc<-pipe_poll"], SCALE.epollCtl.ep_ptable_queue_proc);
assert.equal(n1024["epoll-wait-1"]["main pipe_poll<-ep_item_poll.isra.0"], SCALE.epollWait.pipe_poll);

// ---- 6. strace: ppoll과 epoll_pwait의 반환값과 보고된 파이프 ----
const st = read("strace-n8.txt");
const readEnd = new Map([...st.matchAll(/pipe2\(\[(\d+), \d+\], O_NONBLOCK\)\s+= 0/g)].map((m, i) => [Number(m[1]), i]));
assert.equal(readEnd.size, N);
const results = [];
for (const line of st.split("\n")) {
  let m = line.match(/(?:ppoll\(.*\)|<\.\.\. ppoll resumed>\))\s+= (\d+)(?: \((\[.*\])\))?$/);
  if (m) { results.push(["poll", Number(m[1]), [...(m[2] ?? "").matchAll(/fd=(\d+), revents=POLLIN/g)].map((x) => readEnd.get(Number(x[1])))]); continue; }
  m = line.match(/(?:epoll_pwait\(\d+, |<\.\.\. epoll_pwait resumed>)(\[.*?\]), 16, -?\d+, NULL, 8\)\s+= (\d+)$/);
  if (m) results.push(["epoll_wait", Number(m[2]), [...m[1].matchAll(/events=EPOLLIN, data=(0x[0-9a-f]+|0)/g)].map((x) => Number(x[1]))]);
}
const modelResults = full.slice(1).filter((s) => s.last.ret !== null).map((s) => [s.last.via === "poll" ? "poll" : "epoll_wait", s.last.ret, s.last.events]);
assert.deepEqual(results, modelResults, "strace returns");

// ---- 7. 그림의 리드아웃은 이 문자열과 같아야 한다 ----
assert.deepEqual(T.map(readout), [
  "entry | pipe_poll 0 | readable []",
  "write 2 5 | pipe_poll 0 | readable [2 5]",
  "poll | pipe_poll 8 | ret 2 [2 5]",
  "read 2 5 | pipe_poll 0 | readable []",
  "poll | pipe_poll 8 | sleep",
  "wake by write 5 | pipe_poll 8 | ret 1 [5]",
  "read 5 | pipe_poll 0 | readable []",
  "epoll_ctl ADD x8 | pipe_poll 8 | ready []",
  "write 2 5 | pipe_poll 0 | ready [2 5]",
  "epoll_wait | pipe_poll 2 | ret 2 [2 5]",
  "epoll_wait | pipe_poll 2 | ret 2 [2 5]",
  "read 2 5 | pipe_poll 0 | ready [2 5]",
  "epoll_wait | pipe_poll 2 | ret 0",
  "epoll_wait | pipe_poll 0 | ret 0",
  "epoll_wait | pipe_poll 0 | sleep",
  "wake by write 5 | pipe_poll 1 | ret 1 [5]",
]);

const pollVisits = T.filter((s) => s.last && s.last.via === "poll").reduce((n, s) => n + s.last.visits.length, 0);
const epollVisits = T.filter((s) => s.last && s.last.via === "epoll" && s.last.ins.op !== "epoll_ctl").reduce((n, s) => n + s.last.visits.length, 0);
console.log(`model check passed: ${full.length - 1} probe steps against ${segs.length} traced syscalls, ${results.length} strace returns; figure: poll asks ${pollVisits}, epoll_wait asks ${epollVisits} (N=${N}); N=${SCALE.n}: poll ${SCALE.pollReady.pipe_poll}, epoll_wait ${SCALE.epollWait.pipe_poll}`);
