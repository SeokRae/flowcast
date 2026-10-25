// HotSpot 세이프포인트 진실 모델: Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12), macOS arm64
// 그림의 열차 위치, 트립 암, 검사 캐리지, 깃발, 크레인, 리드아웃은 모두 이 모듈에서 나온다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.

export const JDK = "Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64";

// truth/safepoint.log: "Evaluating safepoint VM operation: G1CollectFull" (System.gc()를 부른 main이 요청)
export const VM_OP = "G1CollectFull";
// truth/safepoint.log: "Safepoint synchronization initiated using semaphore wait barrier. (16 threads)"
export const WAIT_BARRIER = "semaphore";
export const TOTAL_THREADS = 16;
// truth/safepoint-stats.log: G1CollectFull [ threads: total 16, initial_running 1 ] ... page_trap_count 1
export const INITIAL_RUNNING = 1;
export const PAGE_TRAPS = 1;
// truth/safepoint.log 같은 실행 1회의 시간 (ns). 실행마다 달라진다
export const TIMES_NS = { reaching: 63834, cleanup: 3541, atSafepoint: 1960542, total: 2027917 };

// SafepointProbe의 스레드 5개. 순서는 jcmd Thread.print의 순서(= VM 스레드가 훑는 ThreadsList 순서)
// state는 safepoint.cpp의 JavaThreadState, at은 그림에서 열차가 있는 곳
export const THREADS = [
  { name: "compiled", runs: "C2 OSR (level 4)", state: "_thread_in_Java", at: "run" },
  { name: "interp", runs: "interpreter", state: "_thread_in_Java", at: "run" },
  { name: "native", runs: "FileInputStream.readBytes", state: "_thread_in_native", at: "native" },
  { name: "sleeper", runs: "Thread.sleep", state: "_thread_blocked", at: "parked" },
  { name: "waiter", runs: "Object.wait", state: "_thread_blocked", at: "parked" },
];
// 나머지 JavaThread 11개(main, 컴파일러 스레드, Reference Handler, Attach Listener 등)는 그리지 않는다.
// trace 로그에 running으로 찍힌 스레드는 compiled(nid 0x6303) 하나뿐이라, 이들은 첫 검사에서 모두 safe였다.
export const OTHER_THREADS = TOTAL_THREADS - THREADS.length;

// 기록한 실행에서 각 스레드가 폴링 지점에 닿은 때 (VM 스레드의 어느 동작 직후인가)
// interp: 첫 검사에서 이미 blocked였다(trace에 running으로 찍히지 않음). arm 직후 backward branch의 poll word 검사에서 멈췄다.
// compiled: 1, 2회차 검사에서 _thread_in_Java로 찍힌 뒤 "found polling page loop exception"을 내고 멈췄다.
export const ARRIVALS = [
  { thread: "interp", after: { op: "arm" }, via: "poll" },
  { thread: "compiled", after: { op: "check", thread: "compiled", pass: 2 }, via: "trap" },
];

const SHORT = { _thread_in_Java: "in_Java", _thread_in_native: "in_native", _thread_blocked: "blocked" };

// STATE: 지금 이 순간 전부. phase는 SafepointSynchronize::_state, safe는 ThreadSafepointState::_safepoint_safe
export function makeState() {
  return {
    phase: "not_synchronized",
    armed: false,
    threads: THREADS.map((t) => ({ name: t.name, state: t.state, at: t.at, safe: false })),
    pass: 0,
    list: [], // 이번 회차에 검사할 스레드 이름 (1회차는 전부, 그 뒤는 아직 running인 것만)
    cursor: 0,
    running: [], // 이번 회차에서 아직 safe가 아닌 스레드
    pending: null, // 직전 동작 직후 폴링 지점에 닿을 스레드
    looked: null, // VM 스레드가 마지막으로 검사한 스레드 (검사 캐리지가 서 있는 선로)
    vmop: false,
    last: null,
    done: false,
  };
}

const copy = (s) => ({ ...s, threads: s.threads.map((t) => ({ ...t })), list: s.list.slice(), running: s.running.slice() });
const find = (s, name) => s.threads.find((t) => t.name === name);

// safepoint.cpp safepoint_safe_with(): native(걸을 수 있는 프레임)와 blocked는 폴링 지점까지 가지 않아도 safe
export function safeWith(state) {
  return state === "_thread_in_native" || state === "_thread_blocked";
}

function arrivalAfter(last) {
  return ARRIVALS.find((a) => Object.entries(a.after).every(([key, value]) => last[key] === value)) ?? null;
}

// STEP: 호출 1회 = 최소 연산 1회(arm, 스레드 하나의 block, 스레드 하나의 검사, VM 작업, disarm).
// 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(s) {
  if (s.done) return s;
  const n = copy(s);
  if (n.pending) {
    // SafepointSynchronize::block(): 스레드가 스스로 _thread_blocked가 되어 wait barrier에서 기다린다
    const t = find(n, n.pending.thread);
    t.state = "_thread_blocked";
    t.at = "poll";
    n.last = { op: "block", thread: t.name, via: n.pending.via };
    n.pending = null;
    return n;
  }
  if (n.phase === "not_synchronized" && !n.vmop) {
    // arm_safepoint(): _state = _synchronizing, 모든 JavaThread의 local poll을 arm
    n.phase = "synchronizing";
    n.armed = true;
    n.pass = 1;
    n.list = n.threads.map((t) => t.name);
    n.cursor = 0;
    n.running = [];
    n.last = { op: "arm" };
  } else if (n.phase === "synchronizing") {
    // synchronize_threads(): 목록을 차례로 검사하고, 회차가 끝나면 back_off 뒤 running만 다시 본다
    const t = find(n, n.list[n.cursor]);
    const safe = safeWith(t.state);
    if (safe) t.safe = true;
    else n.running.push(t.name);
    n.looked = t.name;
    n.last = { op: "check", thread: t.name, pass: n.pass, result: t.state, safe };
    n.cursor += 1;
    if (n.cursor === n.list.length) {
      if (n.running.length === 0) {
        n.phase = "synchronized";
      } else {
        n.pass += 1;
        n.list = n.running;
        n.running = [];
        n.cursor = 0;
      }
    }
  } else if (n.phase === "synchronized" && !n.vmop) {
    // begin()의 do_cleanup_tasks() 뒤 VMThread::evaluate_operation()
    n.vmop = true;
    n.last = { op: "vmop", name: VM_OP };
  } else {
    // end() -> disarm_safepoint(): _state = _not_synchronized, TSS restart, wait barrier disarm
    n.phase = "not_synchronized";
    n.armed = false;
    n.threads.forEach((t) => {
      t.safe = false;
      if (t.at === "poll") {
        t.at = "resumed";
        t.state = "_thread_in_Java";
      }
    });
    n.list = [];
    n.cursor = 0;
    n.looked = null;
    n.last = { op: "disarm" };
    n.done = true;
  }
  n.pending = arrivalAfter(n.last);
  return n;
}

export function trace() {
  const out = [makeState()];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

export function safeCount(s) {
  return s.threads.filter((t) => t.safe).length;
}

export function readout(s) {
  const safe = `safe ${safeCount(s)}/${s.threads.length}`;
  const l = s.last;
  if (!l) return `entry | ${s.phase} | ${safe}`;
  if (l.op === "arm" || l.op === "disarm") return `${l.op} | ${s.phase} | ${safe}`;
  if (l.op === "block") return `${l.thread} ${l.via} | ${SHORT[find(s, l.thread).state]} | ${safe}`;
  if (l.op === "check") return `pass ${l.pass} ${l.thread} | ${SHORT[l.result]} | ${safe}`;
  return `${l.name} | ${s.phase} | ${safe}`;
}
