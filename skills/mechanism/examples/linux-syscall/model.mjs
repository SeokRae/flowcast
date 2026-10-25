// 시스템 콜 진실 모델: Linux 7.0.14 (Docker Desktop linuxkit), arm64, 64비트 EL0에서 raw `svc #0` 네 번
// 그림의 다이얼 숫자, 서랍 위치, 캐리지가 멈추는 칸, x0 창의 값, 리드아웃은 모두 이 모듈에서 나온다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.
// 출처: truth/kernel-refs.md (소스 줄 범위와 요약), truth/*.txt (실측 원본 그대로)

export const KERNEL = "Linux 7.0.14 (linuxkit), arm64";

// 표 길이 __NR_syscalls. scripts/syscall.tbl에서 arm64 ABI(common, 64, renameat, rlimit, memfd_secret)의
// 가장 큰 번호 471 + 1 (scripts/syscallhdr.sh --emit-nr). 실측: 471은 표를 거쳐 __arm64_sys_rseq_slice_yield,
// 472는 표를 건너뛰고 sys_ni_syscall (truth/ftrace.txt)
export const NR_SYSCALLS = 472;

// 표 안에서 번호가 배정되지 않은 칸. scripts/syscalltbl.sh가 sys_ni_syscall로 채우고,
// arch/arm64/kernel/sys.c가 그 칸을 __arm64_sys_ni_syscall로 둔다 (check-source.mjs가 syscall.tbl로 다시 계산)
export const EMPTY_RUNS = [
  [244, 259],
  [295, 423],
];

// 예외 벡터: VBAR_EL1 + 0x400 = 하위 EL(AArch64)의 동기 예외. Arm ARM 벡터 표, entry.S의 vectors 9번째 항목
// (.align 7 = 0x80바이트씩). 실측: /proc/kcore의 vectors+0x400이 el0t_64_sync로 분기 (truth/vector-el0-sync.txt)
export const VECTOR_OFFSET = 0x400;
// 같은 실측의 sub sp, sp, #0x140: 커널 스택에 잡는 pt_regs 크기 (PT_REGS_SIZE)
export const PT_REGS_SIZE = 0x140;
// ESR_EL1.EC: SVC64 = 0x15 (arch/arm64/include/asm/esr.h), el0t_64_sync_handler가 이 값으로 el0_svc를 고른다
export const EC_SVC64 = 0x15;
// 인자 레지스터 x0..x5 (syscall_wrapper.h SC_ARM64_REGS_TO_ARGS), 번호는 x8 (syscall.c do_el0_svc)
export const ARG_REGS = 6;

// errno (include/uapi/asm-generic/errno-base.h, errno.h)
export const ERRNO = { EBADF: 9, ENOSYS: 38 };
// glibc 2.41: cmn x0, #0x1, lsl #12 / b.hi. x0가 -4095..-1이면 errno = -x0, 반환 -1 (truth/glibc-excerpt.txt)
export const MAX_ERRNO = 4095;

// 진입 경로: 함수 추적기 스택 (truth/ftrace.txt). el0_svc_common은 do_el0_svc 안으로 인라인되어 심볼이 없다
export const ENTRY_CHAIN = ["el0t_64_sync", "el0t_64_sync_handler", "el0_svc", "do_el0_svc", "invoke_syscall.constprop.0"];

// 번호가 배정된 칸 중 이 그림이 쓰는 것 (truth/probe.txt의 SYS_* 값, scripts/syscall.tbl)
export const NAMES = { 63: "read", 172: "getpid" };

// 그림이 차례로 보여주는 네 호출 (truth/syscall-probe.c의 raw svc, 실행 1회)
// pid는 컨테이너 pid 네임스페이스 안의 값이다 (getpid = task_tgid_vnr)
export const PID = 45;
export const CALLS = [
  { nr: 172, x0: 0 },
  { nr: 63, x0: 99 }, // read(99, buf, 8): 열린 적 없는 fd
  { nr: 244, x0: 0 }, // 표 안의 빈 칸
  { nr: 472, x0: 0 }, // 표 바로 뒤
];
export const STAGES = ["load", "svc", "dispatch", "return", "eret"];

export const isEmptySlot = (nr) => EMPTY_RUNS.some(([a, b]) => nr >= a && nr <= b);

// invoke_syscall: scno < sc_nr이면 표에서 고르고, 아니면 do_ni_syscall (compat이 꺼져 있어 곧 sys_ni_syscall)
export function dispatch(nr) {
  if (nr >= NR_SYSCALLS) return { inTable: false, handler: "sys_ni_syscall" };
  if (isEmptySlot(nr)) return { inTable: true, handler: "__arm64_sys_ni_syscall" };
  if (!NAMES[nr]) throw new Error(`no handler name for ${nr}`);
  return { inTable: true, handler: `__arm64_sys_${NAMES[nr]}` };
}

// 핸들러가 돌려주는 값 (실측과 같다: truth/ftrace.txt의 sys_exit)
export function handlerResult(nr, x0) {
  const { handler } = dispatch(nr);
  if (handler === "sys_ni_syscall" || handler === "__arm64_sys_ni_syscall") return -ERRNO.ENOSYS;
  if (handler === "__arm64_sys_getpid") return PID;
  if (handler === "__arm64_sys_read") return x0 === 99 ? -ERRNO.EBADF : null; // ksys_read: fd가 비어 있으면 -EBADF
  throw new Error(`no result for ${handler}`);
}

// glibc 래퍼가 x0를 사용자에게 보여주는 방식
export function glibcView(x0) {
  return x0 < 0 && x0 >= -MAX_ERRNO ? { ret: -1, errno: -x0 } : { ret: x0, errno: 0 };
}

export const errName = (v) => Object.keys(ERRNO).find((k) => -ERRNO[k] === v) ?? "";

// STATE: 지금 이 순간 전부. i = 호출 순번(-1은 시작 전), el = CPU가 실행 중인 예외 수준,
// side = 레지스터 묶음(서랍)이 있는 쪽, x8과 x0는 지금 그 값
export function makeState() {
  return { i: -1, stage: "entry", el: 0, side: "user", x8: null, x0: null, inTable: null, handler: null, done: false };
}

// STEP: 호출 1회 = 경계 넘기의 한 단계. 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(s) {
  if (s.done) return s;
  if (s.stage === "entry" || s.stage === "eret") {
    const c = CALLS[s.i + 1];
    return { ...s, i: s.i + 1, stage: "load", el: 0, side: "user", x8: c.nr, x0: c.x0, inTable: null, handler: null };
  }
  if (s.stage === "load") return { ...s, stage: "svc", el: 1, side: "kernel" };
  if (s.stage === "svc") return { ...s, stage: "dispatch", ...dispatch(s.x8) };
  if (s.stage === "dispatch") return { ...s, stage: "return", x0: handlerResult(s.x8, CALLS[s.i].x0) };
  if (s.stage === "return") return { ...s, stage: "eret", el: 0, side: "user", done: s.i === CALLS.length - 1 };
  throw new Error(`unknown stage ${s.stage}`);
}

export function trace() {
  const out = [makeState()];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

const hex = (v) => `0x${v.toString(16)}`;
const withErr = (v) => (errName(v) ? `${v} ${errName(v)}` : `${v}`);

export function readout(s) {
  switch (s.stage) {
    case "entry":
      return "entry | EL0";
    case "load":
      return `load | EL0 | x8 ${s.x8}${NAMES[s.x8] ? ` ${NAMES[s.x8]}` : ""} | x0 ${s.x0}`;
    case "svc":
      return `svc #0 | EL0 -> EL1 | vector +${hex(VECTOR_OFFSET)}`;
    case "dispatch":
      return s.inTable ? `dispatch | [${s.x8}] ${s.handler}` : `dispatch | ${s.x8} >= ${NR_SYSCALLS} | ${s.handler}`;
    case "return":
      return `return | x0 = ${withErr(s.x0)}`;
    case "eret":
      return `eret | EL1 -> EL0 | x0 ${s.x0}`;
    default:
      throw new Error(`unknown stage ${s.stage}`);
  }
}
