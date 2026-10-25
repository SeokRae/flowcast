# 판을 나눠 쓰는 두 인쇄대

## 대상

- 메커니즘: fork와 COW(copy-on-write). fork 뒤 부모와 자식은 같은 물리 페이지를 읽기 전용으로 함께 매핑하고, 한쪽이 쓰는 순간 그쪽에만 새 페이지가 복사된다. 남은 쪽은 그 페이지를 혼자 갖게 되어 다음 쓰기에서 복사 없이 재사용한다(실측으로 확인했다. 단 재사용 조건은 "혼자 매핑"이 아니라 "참조 수 1"이다)
- 버전과 구현: Linux 7.0.14, Docker Desktop linuxkit 빌드(`7.0.14-linuxkit #1 SMP PREEMPT`), arm64, vCPU 11개, 4 KiB 페이지, THP `[always]`. 소스 줄 참조는 upstream stable 태그 `v7.0.14`(커밋 `458c6079fc1d41d564c37679c8ace02cd83ee817`)이고, 측정은 linuxkit 빌드에서 했다(linuxkit가 패치를 몇 개 더 얹었을 수 있다)
- 대상 프로그램: 합성 프로브 `truth/cow_probe.c`. 사적 익명 페이지 3장을 `mmap`하고 `MADV_NOHUGEPAGE`를 건 뒤(이 커널은 THP가 `[always]`라서 안 걸면 큰 folio가 될 수 있다) 세 장 모두 쓰고 fork한다. 그 뒤 자식 p0, 부모 p0, 부모 p1, 자식 p1, 자식 p0 순서로 한 바이트씩 쓴다. 쓰는 값은 부모 `0xa0 | 차례`, 자식 `0xc0 | 차례`, 첫 쓰기는 `0x10 | 페이지`
- 크기: Figure (부품 40~80개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| 페이지마다 PFN, 혼자 매핑 비트(56), present | `/proc/<pid>/pagemap` (privileged라 PFN이 보인다) | `truth/cow-probe.log` |
| 페이지마다 mapcount, LRU, anon, THP, KSM 비트 | `/proc/kpagecount`, `/proc/kpageflags` | `truth/cow-probe.log` |
| 영역의 Shared_Dirty, Private_Dirty, Rss, AnonHugePages 0, THPeligible 0, VmFlags `nh` | `/proc/<pid>/smaps` | `truth/cow-probe.log` |
| 쓰기 한 번의 minor fault 수 (1, 1, 1, 1, 0) | `getrusage(RUSAGE_SELF)` 전후 차 | `truth/cow-probe.log` |
| 각 프로세스가 읽은 페이지 내용 | 프로브가 읽은 첫 바이트 | `truth/cow-probe.log` |
| 쓰기마다 어느 길로 갔나: 복사는 `copy_user_highpage`, `ptep_clear_flush`, `folio_add_new_anon_rmap`, `folio_remove_rmap_ptes`, 재사용은 `folio_move_anon_rmap`만, 폴트 없음은 `handle_mm_fault` 없음 | ftrace 인스턴스 `linux-fork-cow`의 function tracer, `set_ftrace_pid` + `function-fork`, `trace_marker`로 쓰기마다 구간 표시 | `truth/ftrace-main.txt` |
| fork 구간: `kernel_clone` 1, `dup_mmap` 1, `copy_page_range` 19 (VMA 수) | 같은 ftrace | `truth/ftrace-main.txt` |
| CPU를 나눈 실행: 첫 쓰기는 CPU 3, fork와 쓰기는 CPU 5. 원래 페이지는 끝까지 `lru=0`, 쓰기 폴트 4번 모두 `lru_add_drain` 뒤 복사 | `cow_probe -a 3 -b 5`, 같은 관찰 | `truth/cow-probe-split.log`, `truth/ftrace-split.txt` |
| 두 실행 모두 5번씩 반복해 결과 패턴이 같았다 | 추적 없이 반복 | `truth/repeats.log` |
| 커널, 설정, THP, KSM, 스왑, 툴체인 | `uname`, `/proc/config.gz`, sysfs, dpkg | `truth/env.txt` |
| fork가 PTE마다 부모와 자식을 쓰기 금지로 넣는다, 익명 rmap 복제가 `PageAnonExclusive`를 지운다 | `mm/memory.c` `__copy_present_ptes()`, `copy_present_ptes()`, `include/linux/rmap.h` `__folio_try_dup_anon_rmap()` | `truth/kernel-refs.md` |
| arm64의 쓰기 금지 = `PTE_WRITE`(DBM) 지우고 `PTE_RDONLY` 세우기 | `arch/arm64/include/asm/pgtable.h` `pte_wrprotect()` | `truth/kernel-refs.md` |
| 쓰기 금지 폴트는 `do_wp_page`, 재사용은 전용 표시가 있거나 참조 수가 1일 때 | `mm/memory.c` `handle_pte_fault()`, `do_wp_page()`, `wp_can_reuse_anon_folio()` | `truth/kernel-refs.md` |
| 복사는 새 페이지 할당, 4 KiB 복사, PTE 교체 뒤 옛 mapcount 감소 | `mm/memory.c` `wp_page_copy()`, `arch/arm64/mm/copypage.c` | `truth/kernel-refs.md` |
| 새 folio는 CPU별 LRU 추가 배치(31개)에 참조를 잡고 들어가고, `lru_add_drain`은 지금 CPU만 비운다 | `mm/swap.c`, `include/linux/pagevec.h` | `truth/kernel-refs.md` |
| pagemap 비트 56과 kpagecount는 mapcount, smaps는 참조 수 1이면 private | `fs/proc/task_mmu.c`, `fs/proc/page.c` | `truth/kernel-refs.md` |

모델: `model.mjs` (`node check.mjs` 통과). `check.mjs`는 위 로그 넷과 반복 로그를 직접 읽어, 두 실행의 7개 상태마다 프로세스별 페이지별 PFN, kpagecount, pagemap 비트, smaps 두 값, 읽은 바이트, 쓰기마다 폴트 수와 ftrace 구간의 함수 이름까지 모델과 대조하고 오프라인으로 돈다. 커널 소스(GPLv2)는 MIT인 이 저장소에 두지 않는다. `truth/kernel-refs.md`에 고정 태그의 줄 범위 링크와 요약만 적고, 원문 대조는 `bash truth/fetch-kernel.sh`로 임시 폴더에 받은 뒤 `node check-source.mjs`로 한다(식별자가 줄 범위 안에 정해진 순서로 있는지만 본다). 로그 재현은 `bash truth/run.sh [작업 폴더]`이고, 커밋한 로그는 그 스크립트의 실행 1회다. 그림의 숫자는 모두 이 모듈에서 읽는다. PFN은 실행마다 달라지고, 결과 패턴(복사, 재사용, 복사, 재사용, 폴트 없음)은 10번 모두 같았다.

판단 기록:

- 페이지 수: 처음에 4장으로 쟀다가 3장으로 줄였다. 한 장은 자식이 먼저, 한 장은 부모가 먼저 쓰고, 한 장은 아무도 쓰지 않는다. 넷째 장은 셋째 장과 같은 이야기라 기계만 길어졌다
- CPU 고정: 주 실행은 모든 일을 CPU 3에서 했다. 측정 중 다른 에이전트의 부하가 같은 VM에 있었고(`oracle-pg` 컨테이너도 돈다), 판정이 CPU별 배치에 달려 있어서 고정하지 않으면 결과가 실행마다 바뀔 수 있다
- `--pid=host`: `set_ftrace_pid`는 VM 전역 pid를 받는다. 컨테이너 pid 이름공간 안의 pid(예: 1)를 쓰면 필터가 엉뚱한 프로세스를 가리켜 아무것도 찍히지 않았다. 다른 컨테이너는 건드리지 않았다
- 주 실행에서 fork 직후 세 페이지가 `lru=1`인 이유: fork 구간 ftrace에 부모 자신의 COW 폴트(스택, 힙)가 낸 `lru_add_drain <-do_wp_page`가 한 번 있고, 그게 CPU 3 배치를 비웠다. 그래서 판정 때 참조 수 = mapcount였다. split 실행은 그 drain이 CPU 5에서 일어나 CPU 3 배치가 남았다
- 카탈로그 후보 "판 하나를 공유하는 인쇄기 두 대"를 다듬었다. 인쇄기 두 대는 판 줄 앞뒤의 헤드 뱅크 두 줄(페이지 테이블 둘)이 되었고, "판을 새로 주조"하는 일은 갠트리 캐리지(폴트 처리)가 빈 판 매거진(할당기)에서 판을 가져와 쓴 쪽 옆 칸에 놓는 일로 나눴다. 쓰기 금지 비트(깃발)와 판정(감지 막대)을 따로 둔 것은, 판이 그대로인 재사용 쓰기에도 폴트가 난다는 것(부모 p0)과 판정이 참조 수를 본다는 것이 보여야 해서다
- 쓰기 한 번을 따로 재는 법: 프로브는 쓰기 직전과 직후에 `trace_marker`로 구간을 찍고, 그 사이에는 `getrusage` 두 번과 store 하나만 둔다. fork 뒤에는 스택도 쓰기 금지라서, 두 프로세스 모두 fork 직후 64 KiB 스택을 미리 써서(warm) 그 COW 폴트가 구간 밖에서 끝나게 했다. 그래서 구간 안의 `handle_mm_fault` 수가 minflt 차와 같다(`check.mjs`가 대조한다)
- 캐리지의 순서: 감지 막대로 먼저 재고, 복사로 정해진 뒤에야 매거진에서 빈 판을 집는다. 커널도 `do_wp_page`가 재사용을 포기한 다음 `wp_page_copy` 안에서 할당한다(`folio_prealloc`). 그래서 복사 단계는 캐리지가 열과 매거진을 한 번씩 오간다
- 새 판의 자리: 실제 새 PFN은 메모리 아무 곳에서나 나온다. 그림은 누가 가졌는지 보이도록 부모 것은 원래 판의 왼쪽 칸, 자식 것은 오른쪽 칸에 놓는다. 칸 위치는 PFN 값과 상관없다
- 자식 헤드의 대기 자리: fork 전에는 자식이 없으므로 자식 헤드 셋을 레일 오른쪽 끝에 세워 두고, fork 때 열 0, 1, 2 순서로 원래 판 위로 온다(`copy_pte_range`가 주소 순으로 PTE를 채운다)

## 기계 매핑

한 문장: 판 줄을 사이에 두고 부모 헤드 뱅크(뒤)와 자식 헤드 뱅크(앞)가 같은 판을 짚고 있다가, fork 레버를 누르면 자식 헤드가 와서 앉고 양쪽 깃발이 모두 서며, 깃발 선 헤드가 누름대를 누르면 막히고 갠트리 캐리지가 와서 감지 막대로 판의 참조를 재고, 둘이면 매거진의 빈 판에 내용을 옮겨 쓴 쪽 옆 칸에 놓고 그 헤드를 옮겨 앉히며, 하나면 깃발만 내려 준다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 원래 판 3장, 앞면 표시창 | fork 전 첫 쓰기로 할당된 물리 페이지 3장(PFN), 표시창은 그 페이지의 첫 바이트 | `state.frames[0..2]` |
| 부모 헤드 3개 (레일을 따라 x로 미끄러짐) | 부모 PTE. 헤드가 앉은 판 = PTE가 가리키는 PFN | `state.pte.parent[k].frame` |
| 자식 헤드 3개 | 자식 PTE. fork 전에는 레일 끝 대기(PTE 없음) | `state.pte.child[k].frame` |
| 깃발 6개 (헤드 위에서 오르내림) | PTE의 쓰기 금지(`PTE_RDONLY` 세움, `PTE_WRITE` 지움) | `!state.pte[who][k].write` |
| 누름대 6개 | 사용자 쓰기 한 번(store). 깃발이 서 있으면 막힌다 = 쓰기 금지 폴트 | `state.last.who`, `state.last.page`, `state.last.fault` |
| fork 레버 | `fork()` 한 번 (`kernel_clone`, `dup_mmap`, `copy_page_range`) | `state.last.kind == "fork"` |
| 갠트리 캐리지 | 폴트 처리 `do_wp_page` | `state.last.action` |
| 감지 막대 | 재사용 판정 `wp_can_reuse_anon_folio`: 참조 수가 1인가 | `state.last.refs` |
| 집게 | `wp_page_copy`의 할당과 복사(`copy_user_highpage`) | `state.last.action == "copy"` |
| 새 판 2장 | 복사로 생긴 페이지. 쓴 쪽만 갖는다 | `state.frames[3..]` |

움직이는 부품은 전부 이 표에 있다. 매거진은 움직이지 않는다(위의 빈 판만 집게가 집어 간다). 원래 판과 새 판의 표시창 값도 이 표의 일부다.

## 부품표

배치: 바닥판 가운데에 x 방향으로 긴 판 받침대가 있고, 그 위에 칸 9개(열 3개 x 칸 3개, 가운데 칸이 원래 판)가 판다. 받침대 뒤(y = -46)에 부모 레일과 헤드 3개, 앞(y = +46)에 자식 레일과 헤드 3개가 있다. 자식 레일은 오른쪽으로 길게 나가 fork 전 대기 자리가 된다. 받침대 왼쪽 끝 밖에 빈 판 매거진, 그 너머와 받침대 오른쪽 끝 밖에 갠트리 기둥 두 개가 서고, 판 줄 바로 위 높이 60에 갠트리 빔이 지나간다. 캐리지는 빔 밑에 매달려 x로만 움직이고, 감지 막대(왼쪽)와 집게(오른쪽)를 내린다. 모두 합쳐 약 80개다(칸 홈 9개와 헤드 여섯 벌의 반복 부품이 많다).

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 포함), 판 가장자리 홈, 모서리 나사 4개, 라벨판(규칙선 3줄, 나사 2개), 판 줄 앞 눈금 띠(칸마다 큰 눈금) |
| 구조 | 판 받침대(칸 홈 9개, 나사 4개), 부모 레일과 끝 블록 2개, 자식 레일과 끝 블록 2개(오른쪽 블록이 대기 자리 멈춤쇠), 갠트리 기둥 2개와 받침 2개, 갠트리 빔과 끝 캡 2개, 매거진 몸체(투입구, 나사 2개) |
| 메커니즘 | 원래 판 3장(표시창), 새 판 2장(표시창), 매거진 위 빈 판, 부모 헤드 3개(대차, 받침, 팔, 끝 하우징), 자식 헤드 3개(같음), 깃발 6개, 누름대 6개(봉, 발, 손잡이), fork 레버(봉, 손잡이), 갠트리 캐리지(몸체, 빔을 감싸는 볼 2개), 감지 막대(봉, 끝 구슬), 집게(봉, 흡착 패드) |
| 조작부 | 갠트리 끝 널링 노브, 레일 끝 손나사 2개, 매거진 손나사 |
| 강조 대상 | 상태마다 하나: fork 레버(entry, fork), 방금 쓴 판(쓰기 다섯 번). 움직이는 동안에는 막힌 누름대, 옮겨지는 새 판 순서로 넘어간다 |

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `fork` | fork 레버 | `fork()` | 레버 봉과 손잡이, 부모 레일 오른쪽 끝 블록 |
| 02 | `plates` | 원래 판 | 물리 페이지(PFN) | 원래 판 3장과 표시창, 판 받침대 |
| 03 | `parent` | 부모 헤드 | 부모 PTE | 부모 레일, 왼쪽 끝 블록과 손나사, 헤드 3개(대차, 받침, 팔, 하우징) |
| 04 | `child` | 자식 헤드 | 자식 PTE | 자식 레일, 끝 블록 2개, 손나사, 헤드 3개 |
| 05 | `flag` | 깃발 | 쓰기 금지 비트 | 깃발 6개 |
| 06 | `plunger` | 누름대 | 사용자 쓰기 한 번 | 누름대 6개 |
| 07 | `handler` | 갠트리 캐리지 | `do_wp_page` | 캐리지(몸체, 볼 2개), 빔과 끝 캡, 기둥 2개와 받침, 노브 |
| 08 | `feeler` | 감지 막대 | `wp_can_reuse_anon_folio` | 감지 막대와 끝 구슬 |
| 09 | `magazine` | 빈 판 매거진 | 페이지 할당기 | 매거진 몸체, 위의 빈 판, 손나사 |
| 10 | `gripper` | 집게 | `wp_page_copy`의 할당과 복사 | 집게 봉과 패드 |
| 11 | `copy` | 새 판 | 복사된 페이지 | 새 판 2장과 표시창 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, PFN, 페이지 수, 바이트 값, 참조 수, smaps 크기는 `model.mjs`에서 읽는다. 베이스와 눈금 띠는 어느 묶음에도 넣지 않았다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 형식은 `무엇을 했나 | 폴트와 처리 | 그 쓰기가 닿은 PFN`(복사면 옛 PFN → 새 PFN). 7개 상태 순서대로 `entry | 3 pages rw | private 12 kB`, `fork | 6 PTEs ro | shared 12 kB`, `child p0 | fault, copy | 0xb579a → 0x7a665`, `parent p0 | fault, reuse | 0xb579a`, `parent p1 | fault, copy | 0xf399a → 0xf404c`, `child p1 | fault, reuse | 0xf399a`, `child p0 | no fault | 0x7a665`
- 키보드: → 또는 Space = step 1회, Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 11개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- idle tour: 한 단계씩 움직이고(fork 2.4초, 복사 4.6초, 재사용 2.8초, 폴트 없는 쓰기 1초) 단계 사이 1초 쉰다. 마지막 쓰기 뒤 3초 쉬고 1.6초 동안 처음 상태로 돌아간다(새 판은 흐려지며 사라지고 자식 헤드는 대기 자리로 간다)
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[4] (`parent p1 | fault, copy | 0xf399a → 0xf404c`). 열 0은 자식이 복사해 가고 부모가 재사용한 뒤, 열 1은 부모가 막 복사해 간 순간, 열 2는 아직 공유 중이라 한 장에 복사, 재사용, 공유가 모두 남는다
- 강조(lit): 방금 움직인 부품 하나. entry에서는 다음 STEP(fork)에서 움직일 fork 레버

## 캡션

Linux 7.0.14(Docker Desktop linuxkit, arm64, 4 KiB 페이지)에서 사적 익명 페이지 3장(MADV_NOHUGEPAGE)을 쓰고 fork한 뒤 두 프로세스가 번갈아 쓴 실행 1회를 그대로 옮겼습니다. PFN, mapcount, smaps, 폴트 수는 그 실행의 pagemap, kpagecount, smaps, getrusage 값이고, 쓰기마다 복사와 재사용 중 어느 길로 갔는지는 ftrace로 확인했어요. PFN은 실행마다 달라집니다. 재사용 판정은 mapcount가 아니라 참조 수가 1인지를 보기 때문에, 첫 쓰기를 한 CPU의 LRU 추가 배치에 페이지가 남아 있으면 혼자 매핑해도 복사돼요(첫 쓰기만 다른 CPU에서 한 실행에서는 쓰기 폴트 4번이 모두 복사였습니다). THP와 mTHP의 큰 folio, KSM, 공유 매핑, vfork와 CLONE_VM, 파일 매핑과 페이지 캐시, 스왑, DMA로 고정된 페이지의 fork 때 복사, TLB 비우기, 페이지 테이블 자체의 할당과 복사는 그리지 않았어요.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`, `linux-fork-cow.html`, `linux-fork-cow-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.
