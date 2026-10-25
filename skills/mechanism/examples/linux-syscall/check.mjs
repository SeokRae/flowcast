// node check.mjs: model.mjs를 Linux 7.0.14 (linuxkit, arm64) 실측 원본과 대조한다 (실패하면 exit 1)
// 오프라인으로 돈다. 커널 소스 대조는 check-source.mjs (소스는 GPLv2라 저장소에 두지 않는다)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(HERE, "truth", name), "utf8");

// 1. 대상: 실행한 커널과 사용자 공간
const env = read("env.txt");
const envHas = (re) => assert.ok(re.test(env), `env.txt: ${re}`);
envHas(/^uname -r: 7\.0\.14-linuxkit$/m);
envHas(/^uname -m: aarch64$/m);
envHas(/^# CONFIG_COMPAT is not set$/m); // do_ni_syscall의 compat 분기는 이 빌드에 없다
envHas(/^libc6: 2\.41-/m);

// 2. 번호: 사용자 헤더가 정의한 SYS_* (컴파일한 프로브가 찍은 값)
const probe = read("probe-traced.txt");
const sys = Object.fromEntries([...read("probe.txt").matchAll(/^SYS_(\w+) (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
for (const [nr, name] of Object.entries(M.NAMES)) assert.equal(sys[name], Number(nr), `SYS_${name}`);
assert.deepEqual([sys.openat, sys.close, sys.write], [56, 57, 64]);

// 3. 네 호출의 x0: raw svc가 받은 값 == 모델의 핸들러 결과
const raw = Object.fromEntries([...probe.matchAll(/^raw svc x8=(\d+).* -> x0=(-?\d+)/gm)].map((m) => [Number(m[1]), Number(m[2])]));
for (const c of M.CALLS) assert.equal(raw[c.nr], M.handlerResult(c.nr, c.x0), `raw x0 of ${c.nr}`);
assert.equal(raw[471], -M.ERRNO.ENOSYS); // 표의 마지막 칸: 이 설정에서는 약한 스텁

// 4. 커널 쪽 실측 (ftrace): 호출 순서, 핸들러, 반환값, 진입 경로
const ft = read("ftrace.txt");
const events = [...ft.matchAll(/(sys_enter: NR (\d+) \(([^)]*)\))|(sys_exit: NR (\d+) = (-?\d+))|: (\S+) <-(\S+)/g)];
const calls = [];
for (const e of events) {
  if (e[1]) calls.push({ nr: Number(e[2]), args: e[3].split(", ").map((a) => parseInt(a, 16)), fns: [] });
  else if (e[4] && calls.length && calls.at(-1).nr === Number(e[5])) calls.at(-1).ret = Number(e[6]);
  else if (e[7] && calls.length && calls.at(-1).ret === undefined) calls.at(-1).fns.push([e[7], e[8]]);
}
const traced = calls.filter((c) => c.ret !== undefined);
assert.deepEqual(traced.map((c) => c.nr).slice(0, M.CALLS.length), M.CALLS.map((c) => c.nr));
assert.equal(traced[M.CALLS.length].nr, 471);
for (const [i, c] of M.CALLS.entries()) {
  const t = traced[i];
  const d = M.dispatch(c.nr);
  assert.equal(t.args[0], c.x0, `x0 of ${c.nr}`);
  assert.equal(t.ret, M.handlerResult(c.nr, c.x0), `ret of ${c.nr}`);
  // invoke_syscall이 부른 첫 함수가 모델의 핸들러다
  const called = t.fns.find(([, parent]) => parent === "invoke_syscall.constprop.0");
  assert.equal(called[0], d.handler, `handler of ${c.nr}`);
  // 표 밖이면 __arm64_sys_ni_syscall을 거치지 않는다 (표에 손대지 않았다)
  assert.equal(t.fns.some(([fn]) => fn === "__arm64_sys_ni_syscall"), d.inTable && d.handler === "__arm64_sys_ni_syscall", `ni path of ${c.nr}`);
}
assert.equal(traced[M.CALLS.length].fns.find(([, p]) => p === "invoke_syscall.constprop.0")[0], "__arm64_sys_rseq_slice_yield");
// 핸들러 스택: 아래에서 위로 el0t_64_sync -> ... -> invoke_syscall.constprop.0 -> 핸들러
const stacks = [...ft.matchAll(/<stack trace>\n((?: => .*\n)+)/g)].map((m) => m[1].trim().split("\n").map((l) => l.replace(" => ", "").trim()));
const getpidStack = stacks.find((s) => s[1] === "__arm64_sys_getpid");
assert.deepEqual(getpidStack.slice(2).reverse(), M.ENTRY_CHAIN);
assert.ok(!ft.includes("el0_svc_common"), "el0_svc_common is inlined");

// 5. 예외 벡터와 pt_regs 크기 (/proc/kcore)
const vec = read("vector-el0-sync.txt").trim().split("\n");
assert.match(vec[0], new RegExp(`^vectors\\+0x${M.VECTOR_OFFSET.toString(16)}:`));
assert.match(vec.at(-1), /b\s+el0t_64_sync$/);
assert.ok(vec.some((l) => l.includes(`sub\tsp, sp, #0x${M.PT_REGS_SIZE.toString(16)}`)), "pt_regs size");
assert.equal(M.VECTOR_OFFSET, 8 * 0x80); // vectors의 9번째 항목, 항목마다 .align 7

// 6. glibc: 번호는 x6에서 x8로, -4095..-1은 errno로
const g = read("glibc-excerpt.txt");
assert.match(g, /mov\tx6, #0x3f/);
assert.match(g, /mov\tx8, x6/);
assert.match(g, /cmn\tx0, #0x1, lsl #12/);
assert.match(g, /mov\tx8, #0xac/);
assert.equal(1 << 12, M.MAX_ERRNO + 1);
assert.match(probe, /^glibc read\(99, buf, 8\) = -1 errno 9 EBADF$/m);
assert.match(probe, /^glibc syscall\(244\) = -1 errno 38 ENOSYS$/m);
assert.deepEqual(M.glibcView(-9), { ret: -1, errno: 9 });
assert.deepEqual(M.glibcView(M.PID), { ret: M.PID, errno: 0 });

// 7. strace는 raw 호출도 -1과 errno 이름으로 보여준다. glibc clock_gettime은 vDSO라 svc가 없다
const st = read("strace.txt");
const has = (re, what) => assert.ok(re.test(st), `strace: ${what}`);
has(/^\[ +63\] read\(99, 0x[0-9a-f]+, 8\) += -1 EBADF/m, "read(99) shown as -1 EBADF");
has(/^\[ +244\] syscall_0xf4\(0, 0, 0, 0, 0, 0\) += -1 ENOSYS/m, "244 shown as -1 ENOSYS");
has(/^\[ +472\] syscall_0x1d8\(0, 0, 0, 0, 0, 0\) += -1 ENOSYS/m, "472 shown as -1 ENOSYS");
assert.equal((st.match(/^\[ +113\] clock_gettime/gm) ?? []).length, 1, "one clock_gettime svc (glibc used the vDSO)");

// 8. 기호: 인라인된 함수는 /proc/kallsyms에 없다
const ks = read("kallsyms.txt");
for (const s of ["el0_svc_common", "invoke_syscall", "do_ni_syscall"]) assert.match(ks, new RegExp(`^absent ${s}$`, "m"));
assert.match(ks, /^t invoke_syscall\.constprop\.0$/m);
assert.match(ks, /^W __arm64_sys_rseq_slice_yield$/m);

// 9. 모델 자체
const empty = M.EMPTY_RUNS.reduce((n, [a, b]) => n + b - a + 1, 0);
assert.equal(empty, 145);
assert.ok(M.EMPTY_RUNS.every(([, b]) => b < M.NR_SYSCALLS));
const s0 = M.makeState();
const before = JSON.stringify(s0);
M.step(s0);
assert.equal(JSON.stringify(s0), before);
const t = M.trace();
assert.equal(t.length, 1 + M.CALLS.length * M.STAGES.length);
assert.equal(M.step(t.at(-1)), t.at(-1));
assert.ok(t.every((s) => (s.side === "kernel") === (s.el === 1)), "registers sit in the kernel exactly while EL1");
assert.deepEqual(t.map(M.readout), [
  "entry | EL0",
  "load | EL0 | x8 172 getpid | x0 0",
  "svc #0 | EL0 -> EL1 | vector +0x400",
  "dispatch | [172] __arm64_sys_getpid",
  "return | x0 = 45",
  "eret | EL1 -> EL0 | x0 45",
  "load | EL0 | x8 63 read | x0 99",
  "svc #0 | EL0 -> EL1 | vector +0x400",
  "dispatch | [63] __arm64_sys_read",
  "return | x0 = -9 EBADF",
  "eret | EL1 -> EL0 | x0 -9",
  "load | EL0 | x8 244 | x0 0",
  "svc #0 | EL0 -> EL1 | vector +0x400",
  "dispatch | [244] __arm64_sys_ni_syscall",
  "return | x0 = -38 ENOSYS",
  "eret | EL1 -> EL0 | x0 -38",
  "load | EL0 | x8 472 | x0 0",
  "svc #0 | EL0 -> EL1 | vector +0x400",
  "dispatch | 472 >= 472 | sys_ni_syscall",
  "return | x0 = -38 ENOSYS",
  "eret | EL1 -> EL0 | x0 -38",
]);

console.log(`model check passed: ${M.CALLS.length} calls x ${M.STAGES.length} stages, table ${M.NR_SYSCALLS} slots (${empty} empty), pid ${M.PID}`);
