// poll과 epoll 진실 모델: Linux 7.0.14 (linuxkit, arm64), 파이프 8개 중 2번과 5번에 1바이트씩 쓴다.
// 그림의 공, 꼬리표, 드롭, 카드, 탐침 위치, 계수 창, 리드아웃은 모두 이 모듈에서 나온다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.
// 규칙의 출처는 truth/kernel-refs.md(태그 v7.0.14의 줄 범위), 값의 출처는 truth/의 ftrace와 strace 기록이다.

// truth/epoll_probe.c: 파이프 8개, 2번과 5번이 읽을 수 있게 된다
export const N = 8;
export const READY = [2, 5];

// truth/ftrace-counts.txt의 N=1024 실행(같은 프로브, scale 모드)에서 센 값. 그림은 N=8만 그리고, 이 값은 설명 문장에 쓴다.
export const SCALE = {
  n: 1024,
  pollReady: { pipe_poll: 1024, __pollwait: 3 },
  pollBlock: { pipe_poll: 2048, __pollwait: 1024 },
  epollCtl: { pipe_poll: 1024, ep_ptable_queue_proc: 1024 },
  epollWait: { pipe_poll: 2 },
};

const ALL = (n) => Array.from({ length: n }, (_, i) => i);

// 그림이 도는 순서: 프로브가 낸 시스템 콜을 같은 종류끼리 묶은 것. phase는 trace_marker 구간 이름이다.
// 잠든 호출을 깨우는 write는 자식 프로세스가 냈다(by: "child").
export const SCRIPT = [
  { phase: "poll-ready", op: "write", fds: [2, 5] },
  { phase: "poll-ready", op: "poll", timeout: -1 },
  { phase: "poll-drain", op: "read", fds: [2, 5] },
  { phase: "poll-block", op: "poll", timeout: -1 },
  { phase: "poll-block", op: "write", fds: [5], by: "child" },
  { phase: "poll-block", op: "read", fds: [5] },
  { phase: "epoll-ctl", op: "epoll_ctl", fds: ALL(N), et: false },
  { phase: "write", op: "write", fds: [2, 5] },
  { phase: "epoll-wait-1", op: "epoll_wait", timeout: -1 },
  { phase: "epoll-wait-2", op: "epoll_wait", timeout: 0 },
  { phase: "drain", op: "read", fds: [2, 5] },
  { phase: "epoll-wait-3", op: "epoll_wait", timeout: 0 },
  { phase: "epoll-wait-4", op: "epoll_wait", timeout: 0 },
  { phase: "epoll-block", op: "epoll_wait", timeout: -1 },
  { phase: "epoll-block", op: "write", fds: [5], by: "child" },
];

// 프로브는 그 뒤로 더 돈다. 그림에는 없지만 check.mjs가 같은 규칙으로 돌려 ftrace와 대조한다(EPOLLET 포함).
export const PROBE_TAIL = [
  { phase: "epoll-block", op: "read", fds: [5] },
  { phase: "epoll-wait-5", op: "epoll_wait", timeout: 0 },
  { phase: "epoll-wait-5", op: "close" },
  { phase: "et-ctl", op: "epoll_ctl", fds: ALL(N), et: true },
  { phase: "et-write-1", op: "write", fds: [2] },
  { phase: "et-wait-1", op: "epoll_wait", timeout: 0 },
  { phase: "et-wait-2", op: "epoll_wait", timeout: 0 },
  { phase: "et-write-2", op: "write", fds: [2] },
  { phase: "et-wait-3", op: "epoll_wait", timeout: 0 },
];

// STATE: 지금 이 순간 전부.
//   data[fd]   파이프에 든 바이트 수
//   used[fd]   pipe_poll이 한 번이라도 불렸는가 (pipe->poll_usage, fs/pipe.c)
//   hooks      poll이 건 임시 대기 항목이 매달린 파이프 (poll_table_entry, 반환 때 poll_freewait가 걷는다)
//   relays     epoll이 건 영구 대기 항목이 매달린 파이프 (eppoll_entry, 콜백 ep_poll_callback)
//   ready      epoll ready 목록(rdllist)에 오른 파이프, 앞이 먼저
//   waiter     잠든 호출: null, "poll", "epoll"
//   last       방금 한 일과 그때 커널 함수가 불린 횟수
export function makeState({ n = N, script = SCRIPT } = {}) {
  return {
    n,
    script,
    i: 0,
    data: Array(n).fill(0),
    used: Array(n).fill(false),
    hooks: [],
    relays: [],
    et: false,
    ready: [],
    waiter: null,
    last: null,
    done: script.length === 0,
  };
}

// 커널 함수 하나가 불린 일을 센다. 이름은 ftrace의 함수명과 같다.
function blank(ins) {
  return {
    ins,
    visits: [], // pipe_poll을 부른 파이프 순서 (poll이면 do_sys_poll이, epoll이면 ep_item_poll이 부른다)
    via: null, // "poll" | "epoll"
    hooksAdded: [], // __pollwait
    hooksDropped: 0, // poll_freewait가 걷은 수
    relaysAdded: [], // ep_ptable_queue_proc
    callbacks: [], // ep_poll_callback (쓴 쪽 문맥에서)
    queued: [], // 콜백이나 ep_insert가 ready 목록 끝에 붙인 파이프
    dropped: [], // ep_send_events가 다시 물어 보니 준비가 안 되어 목록에서 뺀 파이프
    requeued: [], // LT라서 보고한 뒤 목록 끝에 다시 붙인 파이프
    pollwake: 0,
    epWake: 0, // ep_autoremove_wake_function
    sendEvents: 0, // ep_send_events
    syscalls: 0, // do_sys_poll, do_epoll_ctl, do_epoll_wait를 연 횟수
    writes: [],
    reads: [],
    ret: null,
    events: [],
    slept: false,
  };
}

function visit(s, a, fd, via) {
  a.visits.push(fd);
  a.via = via;
  s.used[fd] = true;
  return s.data[fd] > 0;
}

// do_poll 한 바퀴. qproc가 살아 있으면 pipe_poll이 그 파이프의 대기열에 항목을 건다(__pollwait).
// 준비된 파이프를 하나 찾으면 qproc를 끄므로 그 뒤 파이프에는 걸지 않는다 (fs/select.c do_poll).
function pollPass(s, a, register) {
  let qproc = register;
  const events = [];
  for (let fd = 0; fd < s.n; fd++) {
    const readable = visit(s, a, fd, "poll");
    if (qproc) {
      s.hooks.push(fd);
      a.hooksAdded.push(fd);
    }
    if (readable) {
      events.push(fd);
      qproc = false;
    }
  }
  return events;
}

function pollReturn(s, a, events) {
  a.ret = events.length;
  a.events = events;
  a.hooksDropped = s.hooks.length;
  s.hooks = [];
  s.waiter = null;
}

// ep_send_events: ready 목록을 통째로 떼어 와 항목마다 pipe_poll을 다시 부른다(ep_item_poll).
// 준비됐으면 보고하고, LT면 목록 끝에 다시 붙인다. 준비가 안 됐으면 목록에서 빠진다.
function sendEvents(s, a) {
  a.sendEvents += 1;
  const tx = s.ready;
  s.ready = [];
  const events = [];
  for (const fd of tx) {
    if (visit(s, a, fd, "epoll")) {
      events.push(fd);
      if (!s.et) {
        s.ready.push(fd);
        a.requeued.push(fd);
      }
    } else a.dropped.push(fd);
  }
  return events;
}

// STEP: 호출 1회 = 시스템 콜 한 묶음 1회. 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(state) {
  if (state.done) return state;
  const s = {
    ...state,
    data: state.data.slice(),
    used: state.used.slice(),
    hooks: state.hooks.slice(),
    relays: state.relays.slice(),
    ready: state.ready.slice(),
  };
  const ins = s.script[s.i];
  const a = blank(ins);
  switch (ins.op) {
    case "write": {
      for (const fd of ins.fds) {
        const wasEmpty = s.data[fd] === 0;
        s.data[fd] += 1;
        a.writes.push(fd);
        // anon_pipe_write는 비어 있던 파이프이거나 pipe_poll을 거친 적이 있는 파이프면 대기열을 깨운다 (fs/pipe.c)
        if (!(wasEmpty || s.used[fd])) continue;
        // __wake_up_common이 대기열에 매달린 항목의 함수를 하나씩 부른다
        if (s.hooks.includes(fd) && s.waiter === "poll") {
          a.pollwake += 1;
        }
        if (s.relays.includes(fd)) {
          a.callbacks.push(fd);
          if (!s.ready.includes(fd)) {
            s.ready.push(fd);
            a.queued.push(fd);
          }
          if (s.waiter === "epoll") a.epWake += 1;
        }
      }
      if (a.pollwake) {
        // 깨어난 poll은 qproc 없이 한 바퀴 더 돌고 반환한다
        pollReturn(s, a, pollPass(s, a, false));
      } else if (a.epWake) {
        s.waiter = null;
        const events = sendEvents(s, a);
        a.ret = events.length;
        a.events = events;
      }
      break;
    }
    case "read":
      for (const fd of ins.fds) {
        s.data[fd] = 0;
        a.reads.push(fd);
      }
      break;
    case "poll": {
      a.syscalls += 1;
      const events = pollPass(s, a, ins.timeout !== 0);
      if (events.length || ins.timeout === 0) pollReturn(s, a, events);
      else {
        s.waiter = "poll";
        a.slept = true;
      }
      break;
    }
    case "epoll_ctl":
      // ep_insert: 파일마다 pipe_poll을 한 번 불러 대기열에 콜백 항목을 걸고(ep_ptable_queue_proc), 이미 준비됐으면 목록에 올린다
      s.et = !!ins.et;
      for (const fd of ins.fds) {
        a.syscalls += 1;
        const readable = visit(s, a, fd, "epoll");
        s.relays.push(fd);
        a.relaysAdded.push(fd);
        if (readable && !s.ready.includes(fd)) {
          s.ready.push(fd);
          a.queued.push(fd);
        }
      }
      break;
    case "epoll_wait": {
      a.syscalls += 1;
      // ep_poll: 목록이 비어 있으면 아무 파일도 묻지 않는다. 시간 제한 0이면 바로 0, 아니면 잠든다
      let events = [];
      if (s.ready.length) events = sendEvents(s, a);
      if (events.length || ins.timeout === 0) {
        a.ret = events.length;
        a.events = events;
      } else {
        s.waiter = "epoll";
        a.slept = true;
      }
      break;
    }
    case "close":
      s.relays = [];
      s.ready = [];
      s.et = false;
      break;
    default:
      throw new Error(`unknown op ${ins.op}`);
  }
  s.i += 1;
  s.last = a;
  s.done = s.i >= s.script.length;
  return s;
}

export function trace(input) {
  const out = [makeState(input)];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

const list = (fds) => fds.join(" ");

export function readout(s) {
  if (!s.last) return "entry | pipe_poll 0 | readable []";
  const a = s.last;
  const ins = a.ins;
  const tail = () => (s.relays.length ? `ready [${list(s.ready)}]` : `readable [${list(s.data.flatMap((d, fd) => (d ? [fd] : [])))}]`);
  const ret = a.slept ? "sleep" : a.events.length ? `ret ${a.ret} [${list(a.events)}]` : `ret ${a.ret}`;
  switch (ins.op) {
    case "write":
      if (a.ret !== null) return `wake by write ${list(ins.fds)} | pipe_poll ${a.visits.length} | ${ret}`;
      return `write ${list(ins.fds)} | pipe_poll 0 | ${tail()}`;
    case "read":
      return `read ${list(ins.fds)} | pipe_poll 0 | ${tail()}`;
    case "epoll_ctl":
      return `epoll_ctl ADD x${ins.fds.length} | pipe_poll ${a.visits.length} | ${tail()}`;
    case "close":
      return "close | pipe_poll 0 | ready []";
    default:
      return `${ins.op} | pipe_poll ${a.visits.length} | ${ret}`;
  }
}
