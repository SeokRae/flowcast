// node check-source.mjs [dir]: truth/kernel-refs.md와 모델의 소스 근거를 Linux 원문(stable v7.0.14)에 대조한다
// 원문은 저장소에 두지 않는다(GPLv2). 먼저 bash truth/fetch-kernel.sh로 받는다.
// dir: 인자, 없으면 LINUX_SRC, 없으면 ${TMPDIR:-/tmp}/flowcast-linux-7.0.14. 원문이 없으면 exit 2, 대조 실패는 exit 1
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = process.argv[2] ?? process.env.LINUX_SRC ?? join(process.env.TMPDIR || "/tmp", "flowcast-linux-7.0.14");
const refs = readFileSync(join(HERE, "truth", "kernel-refs.md"), "utf8");

// 표 한 줄: | `파일` | [L시작-L끝](링크) | 함수 | `식별자`, ... | 하는 일 |
const rows = refs
  .split("\n")
  .filter((line) => /^\| `(fs|include|kernel)\//.test(line))
  .map((line) => {
    const cells = line.split("|").map((c) => c.trim());
    const [, from, to] = cells[2].match(/^\[L(\d+)-L(\d+)\]\(.*#n(\d+)\)$/).map(Number);
    assert.equal(Number(cells[2].match(/#n(\d+)\)$/)[1]), from, `${cells[1]}: link line`);
    return { file: cells[1].replace(/`/g, ""), from, to, ids: [...cells[4].matchAll(/`([^`]+)`/g)].map((m) => m[1]) };
  });
const files = [...new Set(rows.map((r) => r.file))];
const missing = files.filter((f) => !existsSync(join(DIR, f)));
if (missing.length) {
  console.error(`Linux 원문이 없습니다: ${join(DIR, missing[0])} 외 ${missing.length - 1}개`);
  console.error("먼저 받으세요: bash truth/fetch-kernel.sh [dir] (그 뒤 node check-source.mjs [dir] 또는 LINUX_SRC=dir)");
  process.exit(2);
}
const src = Object.fromEntries(files.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));
const span = (file, from, to) => src[file].split("\n").slice(from - 1, to).join("\n");

// 1. 참조 표: 줄 범위마다 대조 식별자가 그 안에 있다 (태그가 바뀌거나 줄이 밀리면 실패)
let ids = 0;
for (const r of rows) {
  const text = span(r.file, r.from, r.to);
  for (const id of r.ids) {
    assert.ok(text.includes(id), `${r.file} L${r.from}-L${r.to}: ${id}`);
    ids += 1;
  }
}
const at = (file, name) => {
  const r = rows.find((row) => row.file === file && row.ids.includes(name));
  assert.ok(r, `no ref row for ${name}`);
  return span(r.file, r.from, r.to);
};

// 2. 모델이 기대는 줄 (식별자와 연산자만 맞춘다. 주석은 건너뛴다)
// poll: 준비된 fd를 찾으면 그 뒤로는 항목을 걸지 않는다 (model.mjs pollPass의 qproc)
assert.match(at("fs/select.c", "poll_schedule_timeout"), /if \(mask\) \{\s+count\+\+;\s+pt->_qproc = NULL;/);
// poll: 한 바퀴가 끝나면 다음 바퀴부터는 걸지 않는다 (깨어난 뒤의 둘째 바퀴)
assert.match(at("fs/select.c", "poll_schedule_timeout"), /\}\s+(?:\/\*[\s\S]*?\*\/\s+)?pt->_qproc = NULL;\s+if \(!count\)/);
// poll: 항목은 호출 한 번 동안만 산다
assert.match(at("fs/select.c", "do_poll"), /poll_initwait\(&table\);\s+fdcount = do_poll\(head, &table, end_time\);\s+poll_freewait\(&table\);/);
assert.match(at("fs/select.c", "poll_get_entry"), /init_waitqueue_func_entry\(&entry->wait, pollwake\);/);
// epoll 등록: 콜백 항목을 걸고, 이미 준비됐으면 목록에 올린다
assert.match(at("fs/eventpoll.c", "init_waitqueue_func_entry"), /init_waitqueue_func_entry\(&pwq->wait, ep_poll_callback\);/);
const insert = at("fs/eventpoll.c", "ep_insert");
assert.match(insert, /init_poll_funcptr\(&epq\.pt, ep_ptable_queue_proc\);/);
assert.match(insert, /revents = ep_item_poll\(epi, &epq\.pt, 1\);/);
assert.match(insert, /if \(revents && !ep_is_linked\(epi\)\) \{\s+list_add_tail\(&epi->rdllink, &ep->rdllist\);/);
// 콜백: 목록에 없을 때만 끝에 붙인다
assert.match(at("fs/eventpoll.c", "ep_poll_callback"), /\} else if \(!ep_is_linked\(epi\)\) \{\s+(?:\/\*[\s\S]*?\*\/\s+)?list_add_tail\(&epi->rdllink, &ep->rdllist\);/);
// epoll_wait: 재확인 poll_table에는 대기 함수가 없다, 0이면 빠진다, LT면 다시 붙는다
const send = at("fs/eventpoll.c", "ep_send_events");
assert.match(send, /init_poll_funcptr\(&pt, NULL\);/);
assert.match(send, /list_del_init\(&epi->rdllink\);/);
assert.match(send, /revents = ep_item_poll\(epi, &pt, 1\);\s+if \(!revents\)\s+continue;/);
assert.match(send, /else if \(!\(epi->event\.events & EPOLLET\)\) \{\s+(?:\/\*[\s\S]*?\*\/\s+)?list_add_tail\(&epi->rdllink, &ep->rdllist\);/);
// ep_poll: 목록에 있을 때만 보내 보고, 시간 제한 0이면 돌아간다
const poll = at("fs/eventpoll.c", "schedule_hrtimeout_range");
assert.match(poll, /if \(eavail\) \{\s+res = ep_try_send_events\(ep, events, maxevents\);/);
assert.match(poll, /if \(timed_out\)\s+return 0;/);
// 파이프: poll_usage가 서면 쓸 때마다 rd_wait를 깨운다, pipe_poll은 먼저 걸고 나서 본다
assert.match(at("fs/pipe.c", "was_empty"), /if \(was_empty \|\| pipe->poll_usage\)\s+wake_up_interruptible_sync_poll\(&pipe->rd_wait, EPOLLIN \| EPOLLRDNORM\);/);
const pp = at("fs/pipe.c", "pipe_empty");
assert.match(pp, /WRITE_ONCE\(pipe->poll_usage, true\);/);
assert.match(pp, /poll_wait\(filp, &pipe->rd_wait, wait\);[\s\S]*if \(!pipe_empty\(idx\.head, idx\.tail\)\)\s+mask \|= EPOLLIN \| EPOLLRDNORM;/);
// 대기 함수 호출과 대기열 깨우기
assert.match(at("include/linux/poll.h", "_qproc"), /if \(p && p->_qproc\) \{\s+p->_qproc\(filp, wait_address, p\);/);
assert.match(at("kernel/sched/wait.c", "__wake_up_common"), /ret = curr->func\(curr, mode, wake_flags, key\);/);

console.log(`source check passed: ${rows.length} refs, ${ids} identifiers, ${files.length} files in ${DIR}`);
