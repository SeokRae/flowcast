// node check-source.mjs [dir]: truth/hotspot-refs.md와 모델의 소스 근거를 HotSpot 원문(jdk-21.0.1+12)에 대조한다
// 원문은 저장소에 두지 않는다(GPLv2 + Classpath Exception). 먼저 bash truth/fetch-hotspot.sh로 받는다.
// dir: 인자, 없으면 HOTSPOT_SRC, 없으면 ${TMPDIR:-/tmp}/flowcast-hotspot-21.0.1. 원문이 없으면 exit 2, 대조 실패는 exit 1
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] ?? process.env.HOTSPOT_SRC ?? join(process.env.TMPDIR || "/tmp", "flowcast-hotspot-21.0.1");
const refs = readFileSync(join(HERE, "truth", "hotspot-refs.md"), "utf8");

// 표 한 줄: | `파일` | [L시작-L끝](링크) | 함수 | `식별자`, ... | 하는 일 |
const rows = refs
  .split("\n")
  .filter((line) => /^\| `(share|cpu)\//.test(line))
  .map((line) => {
    const cells = line.split("|").map((c) => c.trim());
    const [, from, to] = cells[2].match(/^\[L(\d+)-L(\d+)\]/).map(Number);
    return { file: `src/hotspot/${cells[1].replace(/`/g, "")}`, from, to, ids: [...cells[4].matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  });
const files = [...new Set(rows.map((r) => r.file))];
const missing = files.filter((f) => !existsSync(join(DIR, f)));
if (missing.length) {
  console.error(`HotSpot 원문이 없습니다: ${join(DIR, missing[0])} 외 ${missing.length - 1}개`);
  console.error("먼저 받으세요: bash truth/fetch-hotspot.sh [dir] (그 뒤 node check-source.mjs [dir] 또는 HOTSPOT_SRC=dir)");
  process.exit(2);
}
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));

// 1. 참조 표: 줄 범위마다 대조 식별자가 그 안에 있다 (태그가 바뀌거나 줄이 밀리면 실패)
let ids = 0;
for (const r of rows) {
  const text = src[r.file].split("\n").slice(r.from - 1, r.to).join("\n");
  for (const id of r.ids) {
    assert.ok(text.includes(id), `${r.file} L${r.from}-L${r.to}: ${id}`);
    ids += 1;
  }
}

// 2. 모델이 기대는 줄 (check.mjs에 있던 원문 대조를 그대로 옮겼다)
const safepoint = src["src/hotspot/share/runtime/safepoint.cpp"];
const interp = src["src/hotspot/cpu/aarch64/interp_masm_aarch64.cpp"];
const ad = src["src/hotspot/cpu/aarch64/aarch64.ad"];
assert.match(safepoint, /case _thread_in_native:\n.*\n.*return !thread->has_last_Java_frame\(\) \|\| thread->frame_anchor\(\)->walkable\(\);/);
assert.match(safepoint, /case _thread_blocked:/);
assert.match(safepoint, /SafepointMechanism::arm_local_poll\(cur\);/);
assert.match(safepoint, /thread->set_thread_state_fence\(_thread_blocked\);\n.*\n.*_wait_barrier->wait\(static_cast<int>\(safepoint_id\)\);/);
assert.match(safepoint, /_state = _synchronized;/);
assert.match(safepoint, /cur_state->restart\(\); \/\/ TSS _running/);
assert.match(safepoint, /_wait_barrier->disarm\(\);/);
assert.match(interp, /tbnz\(rscratch2, exact_log2\(SafepointMechanism::poll_bit\(\)\), safepoint\);/);
assert.match(ad, /"ldrw zr, \[\$poll\]\\t# Safepoint: poll for GC"/);

console.log(`source check passed: ${rows.length} refs, ${ids} identifiers, ${files.length} files in ${DIR}`);
