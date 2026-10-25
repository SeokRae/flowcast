// node check-source.mjs [dir]: truth/kernel-refs.md와 모델의 소스 근거를 커널 원문(stable v7.0.14)에 대조한다
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

// 표 한 줄: | `파일` | [L시작-L끝](링크) | 함수 | `식별자`, ... | 하는 일 |
const rows = refs
  .split("\n")
  .filter((line) => /^\| `(kernel|include|arch)\//.test(line))
  .map((line) => {
    const cells = line.split("|").map((c) => c.trim());
    const [, from, to] = cells[2].match(/^\[L(\d+)-L(\d+)\]/).map(Number);
    return { file: cells[1].replace(/`/g, ""), from, to, ids: [...cells[4].matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  });
const files = [...new Set(rows.map((r) => r.file))];
const missing = files.filter((f) => !existsSync(join(DIR, f)));
if (missing.length) {
  console.error(`커널 원문이 없습니다: ${join(DIR, missing[0])} 외 ${missing.length - 1}개`);
  console.error("먼저 받으세요: bash truth/fetch-kernel.sh [dir] (그 뒤 node check-source.mjs [dir] 또는 LINUX_SRC=dir)");
  process.exit(2);
}
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const lines = (file, from, to) => src[file].split("\n").slice(from - 1, to).join("\n");

// 1. 참조 표: 줄 범위마다 대조 식별자가 그 안에 있다 (태그가 바뀌거나 줄이 밀리면 실패)
let ids = 0;
for (const r of rows) {
  const text = lines(r.file, r.from, r.to);
  for (const id of r.ids) {
    assert.ok(text.includes(id), `${r.file} L${r.from}-L${r.to}: ${id}`);
    ids += 1;
  }
}

// 2. 모델이 기대는 줄 (원문을 옮기지 않으려고 한 줄 안팎의 짧은 패턴만 쓴다)
const fair = src["kernel/sched/fair.c"];
const core = src["kernel/sched/core.c"];
const sched = src["kernel/sched/sched.h"];
const features = src["kernel/sched/features.h"];
// 기본 슬라이스: 정규화 값과 배율
assert.match(fair, new RegExp(`normalized_sysctl_sched_base_slice\\s*=\\s*${M.NORMALIZED_BASE_SLICE_NS}ULL;`));
assert.match(fair, /unsigned int cpus = min_t\(unsigned int, num_online_cpus\(\), 8\);/);
assert.match(fair, /factor = 1 \+ ilog2\(cpus\);/);
assert.match(fair, /\(sysctl_##name = \(factor\) \* normalized_sysctl_##name\)/);
assert.match(src["include/linux/sched/sysctl.h"], /SCHED_TUNABLESCALING_NONE,\n\tSCHED_TUNABLESCALING_LOG,/);
assert.match(src["include/vdso/jiffies.h"], /#define TICK_NSEC \(\(NSEC_PER_SEC\+HZ\/2\)\/HZ\)/);
// vruntime 증가식
assert.match(fair, /#define WMULT_SHIFT\t32/);
assert.match(fair, /delta = __calc_delta\(delta, NICE_0_LOAD, &se->load\);/);
assert.match(fair, /fact = mul_u32_u32\(fact, lw->inv_weight\);/);
assert.match(fair, /fs = fls\(fact_hi\);/);
assert.match(fair, /return mul_u64_u32_shr\(delta_exec, fact, shift\);/);
assert.match(fair, /curr->vruntime \+= calc_delta_fair\(delta_exec, curr\);/);
assert.match(sched, /# define NICE_0_LOAD_SHIFT\t\(SCHED_FIXEDPOINT_SHIFT \+ SCHED_FIXEDPOINT_SHIFT\)/);
// 가중치와 역수 표: 모델의 가중치와 invWeight()가 표의 값이다
const table = (name) => {
  const body = core.match(new RegExp(`const (?:int|u32) ${name}\\[40\\] = \\{([\\s\\S]*?)\\};`))[1];
  return body.replace(/\/\*[\s\S]*?\*\//g, "").split(",").map((x) => x.trim()).filter(Boolean).map(Number);
};
const weights = table("sched_prio_to_weight");
const wmult = table("sched_prio_to_wmult");
assert.equal(weights.length, 40);
assert.equal(wmult.length, 40);
for (const t of [...M.TASKS, ...M.WIDE_TASKS]) {
  assert.equal(weights[20 + t.nice], t.weight, `weight nice ${t.nice}`);
  assert.equal(wmult[20 + t.nice], M.invWeight(t.weight), `wmult nice ${t.nice}`);
}
assert.match(core, /lw\.inv_weight = sched_prio_to_wmult\[prio\];/);
assert.match(fair, /load->inv_weight = lw->inv_weight;/);
// 자격, 평균, 마감, 선택
assert.match(fair, /return avg >= vruntime_op\(vruntime, "-", cfs_rq->zero_vruntime\) \* load;/);
assert.match(fair, /avg \+= entity_key\(cfs_rq, curr\) \* weight;/);
assert.match(fair, /runtime -= \(weight - 1\);/);
assert.match(fair, /return vruntime_cmp\(a->deadline, "<", b->deadline\);/);
assert.match(fair, /if \(vruntime_cmp\(se->vruntime, "<", se->deadline\)\)/);
assert.match(fair, /se->deadline = se->vruntime \+ calc_delta_fair\(se->slice, se\);/);
assert.match(fair, /if \(curr && \(!curr->on_rq \|\| !entity_eligible\(cfs_rq, curr\)\)\)/);
assert.match(fair, /if \(se && entity_eligible\(cfs_rq, se\)\) \{/);
assert.match(fair, /if \(!best \|\| \(curr && entity_before\(curr, best\)\)\)/);
assert.match(fair, /se = pick_next_entity\(rq, cfs_rq, true\);/);
// 보호 경계와 resched
assert.match(fair, /slice = cfs_rq_min_slice\(cfs_rq\);/);
assert.match(fair, /slice = min\(slice, se->slice\);/);
assert.match(fair, /return vruntime_cmp\(se->vruntime, "<", se->vprot\);/);
assert.match(fair, /set_protect_slice\(cfs_rq, se\);/);
assert.match(fair, /if \(resched \|\| !protect_slice\(curr\)\) \{/);
assert.match(fair, /\tif \(prev != p\) \{/);
assert.match(sched, /if \(next == prev\)\n\t\treturn;/);
// 배치: v = V - lag, 마감 = v + vslice
assert.match(fair, /se->vruntime = vruntime - lag;/);
assert.match(fair, /vslice \/= 2;/);
assert.match(fair, /se->deadline = se->vruntime \+ vslice;/);
// lag 한계
assert.match(fair, /u64 max_slice = cfs_rq_max_slice\(cfs_rq\) \+ TICK_NSEC;/);
assert.match(fair, /se->vlag = clamp\(vlag, -limit, limit\);/);
// 기본 기능
for (const [name, on] of [["PLACE_LAG", true], ["PLACE_DEADLINE_INITIAL", true], ["RUN_TO_PARITY", true], ["PREEMPT_SHORT", true], ["NEXT_BUDDY", false], ["PICK_BUDDY", true], ["DELAY_DEQUEUE", true], ["HRTICK", false]]) {
  assert.match(features, new RegExp(`^SCHED_FEAT\\(${name}, ${on}\\)$`, "m"), name);
}
// 틱과 lazy resched: 사용자 공간으로 돌아가는 길에 schedule()
assert.match(core, /return IS_ENABLED\(CONFIG_PREEMPT_LAZY\);/);
assert.match(core, /if \(dynamic_preempt_lazy\(\) && tif_test_bit\(TIF_NEED_RESCHED_LAZY\)\)/);
assert.match(src["include/linux/irq-entry-common.h"], /_TIF_NEED_RESCHED \| _TIF_NEED_RESCHED_LAZY \|/);
assert.match(src["kernel/entry/common.c"], /if \(ti_work & \(_TIF_NEED_RESCHED \| _TIF_NEED_RESCHED_LAZY\)\) \{/);
assert.match(src["arch/arm64/Kconfig"], /^\tselect GENERIC_IRQ_ENTRY$/m);
assert.match(src["arch/arm64/Kconfig"], /^\tselect ARCH_HAS_PREEMPT_LAZY$/m);
// 실측 파일의 E/N과 슬라이스 칸
const debug = src["kernel/sched/debug.c"];
assert.match(debug, /entity_eligible\(cfs_rq_of\(&p->se\), &p->se\) \? 'E' : 'N',/);
assert.match(debug, /debugfs_create_u32\("base_slice_ns", 0644, debugfs_sched, &sysctl_sched_base_slice\);/);

console.log(`source check passed: ${rows.length} refs, ${ids} identifiers, ${files.length} files in ${DIR}`);
