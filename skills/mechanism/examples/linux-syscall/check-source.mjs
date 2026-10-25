// node check-source.mjs [dir]: truth/kernel-refs.md와 모델의 소스 근거를 Linux 원문(v7.0.14)에 대조한다
// 원문은 저장소에 두지 않는다(GPLv2). 먼저 bash truth/fetch-kernel.sh로 받는다.
// dir: 인자, 없으면 LINUX_SRC, 없으면 ${TMPDIR:-/tmp}/flowcast-linux-7.0.14. 원문이 없으면 exit 2, 대조 실패는 exit 1
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as M from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] ?? process.env.LINUX_SRC ?? join(process.env.TMPDIR || "/tmp", "flowcast-linux-7.0.14");
const refs = readFileSync(join(HERE, "truth", "kernel-refs.md"), "utf8");

// 표 한 줄: | `파일` | [L시작-L끝](링크) 또는 [L줄](링크) | 함수 | `식별자`, ... | 하는 일 |
const rows = refs
  .split("\n")
  .filter((line) => /^\| `(arch|kernel|fs|include|scripts)\//.test(line))
  .map((line) => {
    const cells = line.split("|").map((c) => c.trim());
    const m = cells[2].match(/^\[L(\d+)(?:-L(\d+))?\]/);
    const from = Number(m[1]);
    return { file: cells[1].replace(/`/g, ""), from, to: Number(m[2] ?? m[1]), ids: [...cells[4].matchAll(/`([^`]+)`/g)].map((x) => x[1]) };
  });
const files = [...new Set(rows.map((r) => r.file))];
const missing = files.filter((f) => !existsSync(join(DIR, f)));
if (missing.length) {
  console.error(`Linux 원문이 없습니다: ${join(DIR, missing[0])} 외 ${missing.length - 1}개`);
  console.error("먼저 받으세요: bash truth/fetch-kernel.sh [dir] (그 뒤 node check-source.mjs [dir] 또는 LINUX_SRC=dir)");
  process.exit(2);
}
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const lines = (f, a, b) => src[f].split("\n").slice(a - 1, b).join("\n");

// 1. 참조 표: 줄 범위마다 대조 식별자가 그 안에 있다 (태그가 바뀌거나 줄이 밀리면 실패)
let ids = 0;
for (const r of rows) {
  const text = lines(r.file, r.from, r.to);
  for (const id of r.ids) {
    assert.ok(text.includes(id), `${r.file} L${r.from}-L${r.to}: ${id}`);
    ids += 1;
  }
}

// 2. 표 길이와 빈 칸: scripts/syscall.tbl을 arm64 ABI로 다시 읽는다
const mk = src["arch/arm64/kernel/Makefile.syscalls"];
const extra = mk.match(/^syscall_abis_64 \+= (.+)$/m)[1].trim().split(/\s+/);
const abis = new Set(["common", "64", ...extra]);
assert.deepEqual([...abis], ["common", "64", "renameat", "rlimit", "memfd_secret"]);
assert.equal(src["arch/arm64/tools/syscall_64.tbl"].trim(), "../../../scripts/syscall.tbl");
const table = new Map();
for (const line of src["scripts/syscall.tbl"].split("\n")) {
  const m = line.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(\S+)/);
  if (m && abis.has(m[2])) table.set(Number(m[1]), { name: m[3], entry: m[4] });
}
const max = Math.max(...table.keys());
assert.equal(max + 1, M.NR_SYSCALLS, "__NR_syscalls = max + 1");
assert.match(src["scripts/syscallhdr.sh"], /__NR_\$\{prefix\}syscalls \$\(\(\$max \+ 1\)\)/);
assert.match(src["scripts/Makefile.asm-headers"], /^syscall_abis_64\s+\+= common,64$/m);
const runs = [];
for (let n = 0; n < M.NR_SYSCALLS; n++) {
  if (table.has(n)) continue;
  if (runs.length && runs.at(-1)[1] === n - 1) runs.at(-1)[1] = n;
  else runs.push([n, n]);
}
assert.deepEqual(runs, M.EMPTY_RUNS, "empty slots");
for (const [nr, name] of Object.entries(M.NAMES)) assert.equal(table.get(Number(nr)).name, name);
assert.equal(table.get(471).name, "rseq_slice_yield");
assert.match(src["scripts/syscalltbl.sh"], /echo "__SYSCALL\(\$nxt, sys_ni_syscall\)"/);

// 3. 모델이 기대는 줄
const sc = src["arch/arm64/kernel/syscall.c"];
const sys = src["arch/arm64/kernel/sys.c"];
const entry = src["arch/arm64/kernel/entry.S"];
const common = src["arch/arm64/kernel/entry-common.c"];
assert.match(sc, /el0_svc_common\(regs, regs->regs\[8\], __NR_syscalls, sys_call_table\);/); // 번호는 x8
assert.match(sc, /if \(likely\(scno < sc_nr\)\) \{/); // 표 길이 검사
assert.match(sc, /\} else \{\n\t\tret = do_ni_syscall\(regs, scno\);/);
assert.match(sc, /syscall_set_return_value\(current, regs, 0, ret\);/);
assert.match(sc, /regs->orig_x0 = regs->regs\[0\];\n\tregs->syscallno = scno;/);
assert.match(sys, /\[0 \.\.\. __NR_syscalls - 1\] = __arm64_sys_ni_syscall,/); // 빈 칸은 ni
assert.match(src["arch/arm64/include/asm/syscall.h"], /regs->regs\[0\] = val;/);
assert.match(src["kernel/sys_ni.c"], /asmlinkage long sys_ni_syscall\(void\)\n\{\n\treturn -ENOSYS;/);
assert.match(src["arch/arm64/include/asm/esr.h"], new RegExp(`#define ESR_ELx_EC_SVC64\\tUL\\(0x${M.EC_SVC64.toString(16)}\\)`));
assert.match(common, /case ESR_ELx_EC_SVC64:\n\t\tel0_svc\(regs\);/);
assert.match(common, /static void noinstr el0_svc\(struct pt_regs \*regs\)\n\{[^}]*do_el0_svc\(regs\);/);
// 벡터: 0x800 정렬, 항목 0x80바이트, 9번째가 64비트 EL0 동기 예외
const vectors = entry.match(/\.align\t11\nSYM_CODE_START\(vectors\)\n([\s\S]*?)SYM_CODE_END\(vectors\)/)[1];
const items = [...vectors.matchAll(/kernel_ventry\t(\d), (\w), (\d+), (\w+)/g)].map((m) => m.slice(1).join(" "));
assert.equal(items.length, 16);
assert.equal(items[M.VECTOR_OFFSET / 0x80], "0 t 64 sync");
assert.match(entry, /\.macro kernel_ventry, el:req, ht:req, regsize:req, label:req\n\t\.align 7/);
assert.match(entry, /stp\tx8, x9, \[sp, #16 \* 4\]/); // x8도 pt_regs에 저장된다
assert.match(entry, /ldp\tx0, x1, \[sp, #16 \* 0\]/); // 돌아갈 때 x0를 pt_regs에서 다시 읽는다
assert.match(entry, /entry_handler\t0, t, 64, sync/);
// 핸들러
assert.match(src["kernel/sys.c"], /SYSCALL_DEFINE0\(getpid\)\n\{\n\treturn task_tgid_vnr\(current\);/);
assert.match(src["fs/read_write.c"], /ssize_t ksys_read\(unsigned int fd, char __user \*buf, size_t count\)\n\{\n\tCLASS\(fd_pos, f\)\(fd\);\n\tssize_t ret = -EBADF;/);
assert.match(src["include/uapi/asm-generic/errno-base.h"], new RegExp(`#define\\tEBADF\\t\\t ${M.ERRNO.EBADF}\\t`));
assert.match(src["include/uapi/asm-generic/errno.h"], new RegExp(`#define\\tENOSYS\\t\\t${M.ERRNO.ENOSYS}\\t`));
assert.match(src["arch/arm64/include/asm/syscall_wrapper.h"], /,,regs->regs\[0\],,regs->regs\[1\],,regs->regs\[2\]\t\\\n\t      ,,regs->regs\[3\],,regs->regs\[4\],,regs->regs\[5\]\)/);
assert.equal(M.ARG_REGS, 6);
assert.match(src["kernel/rseq.c"], /#ifdef CONFIG_RSEQ_SLICE_EXTENSION\n[\s\S]*SYSCALL_DEFINE0\(rseq_slice_yield\)[\s\S]*#endif \/\* CONFIG_RSEQ_SLICE_EXTENSION \*\//);

// 4. 이 빌드에서 약한 스텁만 남은 칸 (truth/weak-stubs.txt는 실행한 커널의 /proc/kallsyms)
const weak = readFileSync(join(HERE, "truth", "weak-stubs.txt"), "utf8").trim().split("\n").map((s) => s.replace("__arm64_sys_", ""));
const byName = new Map([...table].map(([nr, { entry: e }]) => [e.replace(/^sys_/, ""), nr]));
const stubSlots = weak.filter((w) => byName.has(w)).map((w) => byName.get(w)).sort((a, b) => a - b);
assert.ok(stubSlots.includes(471));
const empty = runs.reduce((n, [a, b]) => n + b - a + 1, 0);

console.log(`source check passed: ${rows.length} refs, ${ids} identifiers, ${files.length} files in ${DIR}`);
console.log(`arm64 table: ${M.NR_SYSCALLS} slots, ${table.size} numbered, ${empty} empty (${runs.map(([a, b]) => `${a}-${b}`).join(", ")}), ${stubSlots.length} numbered slots are weak stubs in the running build (${stubSlots.join(", ")})`);
