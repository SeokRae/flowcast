// JIT 계층 컴파일 진실 모델: Tiers.measure(Shape) 하나가 tier 0, 3, 4로 올라가고 deopt로 내려오는 과정
// 대상: Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64, 기본 계층 컴파일
// 그림의 레버 위치, 게이지 바늘, 티켓, 셔터, 트랩 눈금, 리드아웃은 모두 이 모듈에서 나온다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.

export const JDK = "Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot)";
export const SOURCE = "static int measure(Shape s) { return s.area() + 1; }";
export const RECEIVERS = ["Square", "Circle"];

// java -XX:+PrintFlagsFinal -version (truth/flags.txt). CompileThresholdScaling = 1.0이라 값이 그대로 쓰인다.
export const FLAGS = {
  Tier3InvocationThreshold: 200,
  Tier3MinInvocationThreshold: 100,
  Tier3CompileThreshold: 2000,
  Tier4InvocationThreshold: 5000,
  Tier4MinInvocationThreshold: 600,
  Tier4CompileThreshold: 15000,
  Tier0InvokeNotifyFreqLog: 7,
  Tier3InvokeNotifyFreqLog: 10,
  Tier3DelayOn: 5,
  TieredStopAtLevel: 4,
  CICompilerCount: 4,
  PerBytecodeTrapLimit: 4,
  TypeProfileWidth: 2,
};

// CompilationPolicy::initialize(): C1 스레드 = max(count / 3, 1), C2 스레드 = max(count - C1, 1)
export const C1_THREADS = Math.max(Math.floor(FLAGS.CICompilerCount / 3), 1);
export const C2_THREADS = Math.max(FLAGS.CICompilerCount - C1_THREADS, 1);

// 카운터가 정책을 부르는 간격. 인터프리터는 MethodCounters와 MDO의 _invoke_mask(Tier0InvokeNotifyFreqLog),
// tier 3 코드는 LIRGenerator::increment_event_counter(Tier3InvokeNotifyFreqLog)로 2^n번마다 한 번 알린다.
export const NOTIFY = { 0: 2 ** FLAGS.Tier0InvokeNotifyFreqLog, 3: 2 ** FLAGS.Tier3InvokeNotifyFreqLog };

// CallPredicate::apply_scaled. measure에는 루프가 없어 backedge b = 0이다.
// k는 threshold_scale(): 큐 길이 / (LoadFeedback * 스레드 수) + 1. measure의 모든 사건에서 로그가 queues=0,0 k=1.00,1.00이다.
export function callPredicate(level, i, b = 0, k = 1) {
  if (level === 0 || level === 2) {
    return i >= FLAGS.Tier3InvocationThreshold * k || (i >= FLAGS.Tier3MinInvocationThreshold * k && i + b >= FLAGS.Tier3CompileThreshold * k);
  }
  if (level === 3) {
    return i >= FLAGS.Tier4InvocationThreshold * k || (i >= FLAGS.Tier4MinInvocationThreshold * k && i + b >= FLAGS.Tier4CompileThreshold * k);
  }
  return true;
}

// CompilationPolicy::common<CallPredicate>에서 이 메서드가 지나는 갈래만 옮겼다
// (is_trivial 아님, C2 큐 0 <= Tier3DelayOn * C2 스레드라 tier 2로 돌지 않음).
// counters.i = method->invocation_count(), counters.mdo = mdo->invocation_count_delta() (MDO가 없으면 null)
export function decide(level, counters) {
  if (level === 0) {
    // 먼저 "지금 레벨 3이었다면 4로 갈 만큼 MDO 증분이 쌓였는가"를 본다: 프로파일이 이미 익었으면 C1을 건너뛴다
    if (counters.mdo !== null && callPredicate(3, counters.mdo)) {
      return { next: 4, reading: { counter: "mdo", count: counters.mdo, threshold: FLAGS.Tier4InvocationThreshold } };
    }
    const reading = { counter: "i", count: counters.i, threshold: FLAGS.Tier3InvocationThreshold };
    return { next: callPredicate(0, counters.i) ? 3 : 0, reading };
  }
  if (level === 3) {
    const reading = { counter: "mdo", count: counters.mdo, threshold: FLAGS.Tier4InvocationThreshold };
    return { next: callPredicate(3, counters.mdo) ? 4 : 3, reading };
  }
  return { next: level, reading: null }; // C2 코드는 호출 수를 세지 않는다
}

// 사건 순서와 카운터 값은 truth/print-tiered.txt(-XX:+PrintTieredEvents) 그대로다. 결과(머무름, 요청 레벨,
// made not entrant)는 적지 않고 step()이 위 정책으로 계산한다. check.mjs가 로그와 대조한다.
// install은 로그에 시각이 없다. 컴파일은 백그라운드라 요청 뒤 몇 번째 호출에서 설치되는지는 실행마다 다르고,
// 이 모델은 "요청 다음, 새 tier의 첫 사건 앞"이라는 순서만 주장한다.
export const EVENTS = [
  { kind: "check", i: 128, mdo: null },
  { kind: "check", i: 256, mdo: null },
  { kind: "install" },
  { kind: "check", i: 1324, mdo: 1024 },
  { kind: "check", i: 2348, mdo: 2048 },
  { kind: "check", i: 3372, mdo: 3072 },
  { kind: "check", i: 4396, mdo: 4096 },
  { kind: "check", i: 5420, mdo: 5120 },
  { kind: "install" },
  { kind: "trap", receiver: "Circle" },
  { kind: "trap", receiver: "Circle" },
  { kind: "trap", receiver: "Circle" },
  { kind: "trap", receiver: "Circle" },
  { kind: "check", i: 5548, mdo: 5248 },
  { kind: "install" },
];

// STATE: 지금 이 순간 전부.
export function makeState() {
  return {
    tier: 0, // 다음 호출을 처리하는 코드: 0 인터프리터, 3 C1(full profile), 4 C2
    queued: null, // 요청했지만 아직 설치되지 않은 레벨
    reading: null, // 마지막 검사가 읽은 값 { counter, count, threshold }, 검사 다음 사건에서는 null
    seen: [], // bci 1(invokeinterface)의 수신자 타입 프로파일 행, 최대 TypeProfileWidth개
    accepts: null, // 설치된 C2 코드가 트랩 없이 받는 수신자 타입, C2 코드가 없으면 null
    traps: 0, // bci 1의 class_check 트랩 수 (MDO 트랩 기록, 재컴파일 뒤에도 남는다)
    retired: [], // made not entrant 된 nmethod의 레벨, 순서대로
    at: 0, // 다음 EVENTS 인덱스
    last: null, // 방금 처리한 사건
    done: false,
  };
}

// STEP: 호출 1회 = 정책에 닿는 사건 1개 (카운터 알림 검사, 컴파일 설치, 트랩 중 하나).
// 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(s) {
  if (s.done) return s;
  const ev = EVENTS[s.at];
  const n = { ...s, seen: s.seen.slice(), retired: s.retired.slice(), at: s.at + 1, reading: null };
  if (ev.kind === "check") {
    // CompilationPolicy::event -> method_invocation_event -> call_event -> common<CallPredicate>
    const d = decide(s.tier, ev);
    n.reading = d.reading;
    // compilation_is_in_queue: 이미 큐에 있으면 다시 요청하지 않는다
    const request = d.next !== s.tier && s.queued === null ? d.next : null;
    if (request !== null) n.queued = request;
    n.last = { kind: "check", request };
  } else if (ev.kind === "install") {
    if (s.queued === null) throw new Error(`install without a request at event ${s.at}`);
    const level = s.queued;
    // tier 4가 들어오면 tier 3 nmethod는 교체되어 made not entrant (트랩이 아니다)
    if (s.tier === 3 && level === 4) n.retired.push(3);
    n.tier = level;
    n.queued = null;
    // tier 3 코드는 bci 1의 수신자를 MDO에 기록한다. 1단계는 Square만 보낸다
    if (level === 3 && n.seen.length === 0) n.seen.push("Square");
    // C2는 컴파일 시점의 수신자 프로파일만큼 인라인한다 (truth/print-inlining.txt의 TypeProfile)
    n.accepts = level === 4 ? n.seen.slice() : null;
    n.last = { kind: "install", level, compiler: level === 4 ? "C2" : "C1" };
  } else if (ev.kind === "trap") {
    // Deoptimization::uncommon_trap_inner, reason class_check, action maybe_recompile
    if (s.tier !== 4 || s.accepts.includes(ev.receiver)) throw new Error(`no class_check trap at event ${s.at}`);
    n.traps = s.traps + 1;
    // 트랩 난 프레임은 bci 1부터 인터프리터에서 다시 실행되고, 인터프리터가 이 수신자를 프로파일에 남긴다
    if (!n.seen.includes(ev.receiver) && n.seen.length < FLAGS.TypeProfileWidth) n.seen.push(ev.receiver);
    // maybe_recompile은 코드를 그대로 두다가, 앞선 트랩이 있고 this_trap_count >= PerBytecodeTrapLimit이면 make_not_entrant.
    // 첫 재컴파일이라 reprofile은 없다 (MDO 시작 카운터를 그대로 둔다)
    const notEntrant = n.traps >= FLAGS.PerBytecodeTrapLimit;
    if (notEntrant) {
      n.tier = 0;
      n.accepts = null;
      n.retired.push(4);
    }
    n.last = { kind: "trap", receiver: ev.receiver, count: n.traps, notEntrant };
  } else {
    throw new Error(`unknown event ${ev.kind}`);
  }
  n.done = n.at === EVENTS.length;
  return n;
}

export function trace() {
  const out = [makeState()];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

// 게이지 바늘: 마지막 검사가 읽은 값 / 그 tier의 임계값. 검사가 아닌 사건 뒤에는 0에 쉰다
export function gauge(s) {
  return s.reading ? s.reading.count / s.reading.threshold : 0;
}

// 다음 검사가 먼저 대는 임계값: tier 3은 5000. tier 0은 MDO가 있으면 "full profile이었다면 C2로 갈까"(5000)를
// 먼저 보고, 없으면 200. C2 코드는 세지 않으므로 없음
export function nextThreshold(s) {
  if (s.tier === 3) return FLAGS.Tier4InvocationThreshold;
  if (s.tier === 0) return s.seen.length > 0 ? FLAGS.Tier4InvocationThreshold : FLAGS.Tier3InvocationThreshold;
  return null;
}

export function readout(s) {
  const tier = `tier ${s.tier}`;
  const L = s.last;
  if (!L) return `${tier} | entry | i 0`;
  if (L.kind === "check") {
    const r = s.reading;
    return `${tier} | ${r.counter} ${r.count} ${r.count >= r.threshold ? "≥" : "<"} ${r.threshold} | ${L.request === null ? "stay" : `queue ${L.request}`}`;
  }
  if (L.kind === "install") return `${tier} | ${L.compiler} installed${s.accepts ? ` | ${s.accepts.join("+")}` : ""}`;
  return `${tier} | trap ${L.count}/${FLAGS.PerBytecodeTrapLimit} | ${L.notEntrant ? "not entrant" : "keep code"}`;
}
