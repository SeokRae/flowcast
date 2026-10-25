# 파이프 교환대

## 대상

- 메커니즘: poll과 epoll의 차이. poll은 호출할 때마다 감시하는 fd를 전부 확인하지만, epoll은 등록할 때 fd마다 콜백을 걸어 두어 준비된 fd만 ready 목록에 오르고 epoll_wait는 그것만 돌려받는다
- 버전과 구현: Linux 7.0.14, Docker Desktop linuxkit 빌드(`7.0.14-linuxkit #1 SMP PREEMPT`), arm64, vCPU 11개. 사용자 공간은 Debian trixie, glibc 2.41, gcc 14.2. 소스 참조는 업스트림 stable 태그 `v7.0.14`(커밋 `458c6079fc1d41d564c37679c8ace02cd83ee817`)이고, 측정한 동작은 linuxkit 빌드의 것이다
- 대상 코드: 합성 프로브 `truth/epoll_probe.c`. `O_NONBLOCK` 파이프 8개의 읽는 쪽을 감시하고, 2번과 5번에 1바이트씩 쓴다. 감시 대상의 poll 메서드는 `pipe_poll`이다
- 크기: Figure. 부품표 항목은 38종이고, 그중 회선 모듈에 드는 11종(받침, 잭 블록, 감지 레버, 홈통, 끝막이, 배출 틈, 걸이 막대, 칩, 꼬리표, 드롭, 카드)을 파이프 수만큼 8벌 그렸다. 반복을 낱개로 세면 약 120개로 Figure 범위(40~80)를 넘는다. 회선 모듈이 같은 모양의 반복이라 설계와 검증의 몫은 Figure로 잡았다

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| 파이프 8개, 2번과 5번에 1바이트씩, 프로브가 낸 시스템 콜 순서 | 프로브 소스와 출력 | `truth/epoll_probe.c`, `truth/ftrace-n8.stdout` |
| poll 1회(2번과 5번이 이미 준비): `pipe_poll` 8회, `__pollwait` 3회. 항목은 0, 1, 2번에만 걸린다 | ftrace(자기 인스턴스, pid 필터, 부모 함수 표시) | `truth/ftrace-n8.trace`, `truth/ftrace-counts.txt` |
| 잠드는 poll: `pipe_poll` 8회와 `__pollwait` 8회, 자식의 write가 `pollwake` 1회, 깨어난 뒤 `pipe_poll` 8회 | ftrace | 같은 파일 |
| `epoll_ctl(ADD)` 8회: 파일마다 `ep_item_poll` 1회, `pipe_poll` 1회, `ep_ptable_queue_proc` 1회 | ftrace | 같은 파일 |
| write 1회마다 쓰는 쪽 문맥에서 `ep_poll_callback` 1회 | ftrace(`<-__wake_up_common`) | 같은 파일 |
| epoll_wait(LT): `ep_send_events` 1회, `pipe_poll` 2회, 반환 2. 다시 불러도 2회와 2. 읽은 뒤에는 `pipe_poll` 2회에 반환 0, 그다음은 `ep_send_events`조차 없이 0 | ftrace, strace | `truth/ftrace-n8.trace`, `truth/strace-n8.txt` |
| 잠든 epoll_wait: 자식의 write가 `ep_poll_callback` 1회와 `ep_autoremove_wake_function` 1회, 깨어난 쪽이 `pipe_poll` 1회 | ftrace | `truth/ftrace-n8.trace` |
| 파이프 1024개: poll 1회에 `pipe_poll` 1024회(`__pollwait` 3회), 잠드는 poll 2048회(`__pollwait` 1024회), `epoll_ctl` 1024회, epoll_wait 1회에 2회 | 같은 프로브의 scale 실행 | `truth/ftrace-counts.txt` (원본 추적 약 670 KB는 작업 폴더에만 둔다) |
| ET: 보고한 뒤 다시 부르면 아무것도 묻지 않고 0. 이미 데이터가 있는 파이프에 또 쓰면 콜백이 다시 불리고 다시 보고 | ftrace의 `et-*` 구간, strace | `truth/ftrace-n8.trace`, `truth/strace-n8.txt` |
| 반환값, revents, 보고 순서(2 다음 5) | strace 6.13 | `truth/strace-n8.txt` |
| arm64에서 glibc의 `poll()`은 `ppoll`, `epoll_wait()`는 `epoll_pwait`로 들어간다 | strace, ftrace 부모 함수(`__arm64_sys_ppoll`, `do_epoll_pwait.part.0`) | `truth/strace-n8.txt`, `truth/ftrace-n8.trace` |
| `ep_insert`, `ep_poll`, `do_poll`, `do_pollfd`, `vfs_poll`은 이 빌드에 따로 된 심볼이 없다 | `/proc/kallsyms` | `truth/env.txt` |
| 준비된 fd를 찾으면 그 뒤로는 항목을 걸지 않는다, 깬 뒤 둘째 바퀴는 걸지 않는다, 반환 때 모두 걷는다 | `fs/select.c` `do_poll()`, `do_sys_poll()`, `poll_freewait()` | `truth/kernel-refs.md` (원문 대조: `check-source.mjs`) |
| 등록 때 콜백 항목을 걸고 이미 준비됐으면 목록에 올린다 | `fs/eventpoll.c` `ep_insert()`, `ep_ptable_queue_proc()` | `truth/kernel-refs.md` |
| 콜백은 목록에 없을 때만 끝에 붙인다, 재확인 poll_table에는 대기 함수가 없다, 0이면 빠지고 LT면 다시 붙는다 | `fs/eventpoll.c` `ep_poll_callback()`, `ep_send_events()` | `truth/kernel-refs.md` |
| 파이프는 poll로 물은 적이 있으면 쓸 때마다 대기열을 깨운다 | `fs/pipe.c` `anon_pipe_write()`, `pipe_poll()`의 `poll_usage` | `truth/kernel-refs.md` |

모델: `model.mjs` (`node check.mjs` 통과). `check.mjs`는 커밋한 ftrace 원본을 시스템 콜 구간으로 나눠, 프로브 전체(그림의 15단계와 그 뒤의 ET 구간까지 24단계)를 모델로 돌린 결과와 함수 호출 횟수를 구간마다 대조한다. N=1024 횟수 표, strace의 반환값과 revents, `env.txt`의 커널 문자열과 심볼도 대조하고 오프라인으로 돈다. 그림의 숫자는 모두 이 모듈에서 읽는다. 커널 소스(GPLv2)는 MIT인 이 저장소에 두지 않는다. `truth/kernel-refs.md`에 고정 태그의 줄 링크와 요약만 적고, 원문 대조는 `bash truth/fetch-kernel.sh`로 임시 폴더에 받은 뒤 `node check-source.mjs`로 한다. 기록 재현은 `bash truth/run.sh <작업 폴더>`이다(이미지가 없으면 `truth/Dockerfile`로 만든다). 이 그림은 시간 값을 쓰지 않는다. 함수 호출 횟수는 실행할 때마다 같았다.

판단 기록:

- 측정 방법: 프로브는 자기 ftrace 인스턴스(`instances/linux-epoll`)에 function 트레이서를 걸고 `set_ftrace_pid`와 `function-fork`로 자기와 자식만 거른다. 단계 경계는 프로브가 그 인스턴스의 `trace_marker`에 쓴 `phase` 줄이다. `set_ftrace_pid`는 VM 전역 pid를 받으므로 컨테이너를 `--pid=host`로 띄웠다(컨테이너 안 pid를 쓰면 아무것도 걸리지 않았다). 한 CPU(3번)에 묶어 링 버퍼 하나에 순서대로 남겼고, 버퍼 손실이 없는지(`entries-in-buffer`와 `entries-written`이 같은지)를 `count.py`와 `check.mjs`가 확인한다. 같은 VM에서 다른 에이전트와 `oracle-pg` 컨테이너가 돌고 있었지만 pid 필터 때문에 기록에 섞이지 않았다
- `function_profile_enabled`는 전역이라 쓰지 않았다. 횟수는 함수 추적 줄을 직접 센다
- STEP 묶음: 같은 종류를 연달아 낸 시스템 콜(write 2회, read 2회, `epoll_ctl` 8회)은 한 STEP으로 묶었다. 잠드는 호출은 "잠듦"과 "자식의 write가 깨움" 두 STEP으로 나눴고, `check.mjs`는 ftrace를 자식의 `anon_pipe_write` 줄에서 끊어 대조한다. 그래서 계수 창과 리드아웃의 `pipe_poll`은 STEP 단위다. 잠든 poll 한 호출의 16회는 4단계의 8회와 5단계의 8회로 나뉘어 보인다
- 카탈로그 후보 "램프가 달린 전화 교환대"를 다듬었다. 램프 대신 드롭(교환대의 호출 표시기)과 카드를 썼다. ready 목록은 순서가 있는 목록이고, LT에서 카드가 다시 줄을 서는 것과 다시 물었을 때 빠지는 것을 보여야 해서 줄을 서는 레인이 필요했다. 램프가 여럿 켜지면 "lit은 하나" 규칙과도 맞지 않는다. poll 쪽에 꼬리표를 더했다. poll의 비용은 묻는 횟수만이 아니라 호출마다 대기 항목을 걸고 걷는 일이기 때문이다
- 파이프는 쓰는 쪽(뒤)과 읽는 쪽(앞)이 있는 홈통으로, 1바이트는 칩 하나로 그렸다. 그림의 SCRIPT에서 파이프 하나에 든 바이트는 1을 넘지 않는다(빌드가 확인한다)
- 홈통은 잭 블록 오른쪽에 나란히 두고 모듈마다 받침을 따로 깔았다. 홈통을 블록 뒤에 두면 이 카메라에서 블록이 칩을 가린다
- 드롭과 카드는 등록(`epoll_ctl`) 때 생긴다. 카드가 레인에 서 있는 동안이 `rdllink`가 ready 목록에 걸린 상태다. 실제 epitem은 그동안에도 레드블랙 트리에 남아 있는데, 그림은 트리를 그리지 않고 카드의 자리만으로 목록에 걸렸는지를 보인다
- ET 구간은 그림에 넣지 않았다. 모델은 같은 규칙으로 ET를 돌리고 `check.mjs`가 ftrace와 대조한다

## 기계 매핑

한 문장: 탐침이 잭에 꽂힐 때마다 커널이 파일의 poll 메서드(`pipe_poll`)를 한 번 부르는데, poll은 호출마다 잭 8개를 다 꽂으며 꼬리표를 걸었다가 걷고, epoll은 등록 때 잭마다 드롭을 한 번 걸어 두어 write가 들어오면 그 잭의 카드만 레인으로 떨어지고 epoll_wait는 레인에 선 카드의 잭만 꽂는다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 칩 (홈통 뒤 끝으로 들어와 앞 끝에 머묾, read면 앞 끝 틈으로 빠짐) | 파이프 버퍼의 1바이트 | `state.data` |
| 탐침 캐리지와 플러그 (잭 하나를 꽂았다 뺌) | `pipe_poll` 1회 (`vfs_poll`) | `state.last.visits` |
| 계수 창의 숫자 | 이 STEP에서 부른 `pipe_poll` 횟수 | `state.last.visits.length` |
| 꼬리표 (잭 앞면에 걸렸다가 반환 때 걷힘) | poll의 대기 항목 (`__pollwait`가 걸고 `pollwake`가 깨우고 `poll_freewait`가 걷음) | `state.hooks` |
| 드롭 (등록 때 걸이 막대에 걸리고 남음) | epoll의 대기 항목 `eppoll_entry`, 함수 `ep_poll_callback` | `state.relays` |
| 카드 (드롭 위가 제자리, 레인으로 떨어지고 돌아옴) | epitem, 레인에 선 동안 ready 목록에 걸림 | `state.relays`, `state.ready` |
| 레인 위 카드의 순서 (끝막이 쪽이 머리) | ready 목록 `rdllist`의 순서 | `state.ready` |
| 종 망치 (잠들면 젖혀지고, 깨우면 종을 침) | 잠든 호출과 깨우기 (`pollwake`, `ep_autoremove_wake_function`) | `state.waiter`, `state.last.pollwake`, `state.last.epWake` |

개념이 붙은 정지 부품: 잭 블록의 소켓 = 파일의 poll 메서드, 걸이 막대 = 파이프의 대기열 `rd_wait`, 레인 = ready 목록, 홈통 뒤 끝막이 = 쓰는 쪽. 그림 안 글자는 카드의 파이프 번호 창과 탐침의 계수 창뿐이다.

## 부품표

배치: 뒤쪽 왼쪽에서 오른쪽으로 회선 모듈 8개(받침 위에 잭 블록, 그 오른쪽에 홈통), 그 앞을 레인이 가로질러 오른쪽 끝막이까지 가고, 맨 앞을 탐침 레일 두 줄이 지난다. 탐침이 쉬는 집 자리는 레일 왼쪽 끝이고 그 뒤에 종이 선다. 뒤쪽 오른쪽에 라벨판이 있다.

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 4개 포함), 판 가장자리 홈, 모서리 나사 4개(링과 머리), 라벨판(규칙선 3줄, 나사 2개), 눈금 띠(잭마다 큰 눈금, 그 사이 작은 눈금, 집 자리 표시 1줄, 나사 2개) |
| 구조 | 회선 받침 8개(나사 4개씩), 잭 블록 8개(이음선, 앞면 나사 2개), 감지 레버 8개(팔과 끝 패드), 홈통 8개(바닥, 벽 2개, 벽 위 나사), 쓰는 쪽 끝막이 8개(칩이 드는 틈), 읽는 쪽 배출 틈 8개, 걸이 막대 8개(기둥 2개와 가로대), 레인(바닥, 벽 2개, 자리 표시 8칸), 레인 끝막이, 탐침 레일 2줄과 끝막이, 종 받침과 기둥, 망치 발 |
| 메커니즘 | 칩 8개, 꼬리표 8개(고리, 판, 구멍 테, 규칙선 2줄), 드롭 8개(몸통, 걸쇠, 카드 집게 2개), 카드 8개(번호 창), 탐침 캐리지(몸통, 슬리브, 기둥, 계수 창), 팔, 플러그(머리와 핀), 종(테, 몸통, 어깨, 꼭지), 망치(대와 머리) |
| 조작부 | 탐침 캐리지의 널링 노브(눈금선 하나) |
| 강조 대상 | 방금 움직인 부품 하나: 탐침이 움직였으면 탐침 기둥, 아니면 방금 들어온 칩이나 레인으로 간 카드, 종을 칠 때는 망치 머리 |

움직이는 것: 칩(들어옴, 빠짐), 탐침 캐리지(레일을 따라 x), 팔과 플러그(y로 내밀고 거둠), 꼬리표(나타남, 흔들림, 걷힘), 드롭(나타남), 카드(제자리에서 레인으로, 레인에서 제자리로, 재확인 때 들림), 망치(젖힘, 침). 잭 블록, 걸이 막대, 홈통, 레인, 종은 움직이지 않는다.

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `pipe` | 홈통과 칩 | 파이프와 그 버퍼 | 홈통 8개(바닥, 벽, 끝막이, 배출 틈), 칩 8개 |
| 02 | `jack` | 잭 | `pipe_poll` | 잭 블록 8개(소켓, 감지 레버) |
| 03 | `probe` | 탐침 캐리지 | 커널이 파일에 묻는 일 | 탐침 레일 2줄과 끝막이, 캐리지(몸통, 슬리브, 기둥, 계수 창, 노브), 팔, 플러그 |
| 04 | `rail` | 걸이 막대 | 파이프의 대기열 `rd_wait` | 걸이 막대 8개(기둥과 가로대) |
| 05 | `tag` | 꼬리표 | poll의 임시 대기 항목 | 꼬리표 8개 |
| 06 | `drop` | 드롭 | epoll의 영구 대기 항목 | 드롭 8개(몸통, 걸쇠, 집게) |
| 07 | `card` | 카드 | epitem | 카드 8개 |
| 08 | `queue` | 레인 | ready 목록 `rdllist` | 레인 바닥과 벽, 자리 표시, 끝막이 |
| 09 | `bell` | 종 | 잠든 호출 깨우기 | 종 받침, 기둥, 종, 망치와 발 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, 파이프 수, 꼬리표 수(첫 poll의 `__pollwait` 3회), 깬 뒤 다시 묻는 수, 첫 epoll_wait의 재확인 수, N=1024 횟수는 `model.mjs`에서 읽는다. 베이스, 회선 받침, 눈금 띠, 라벨판은 어느 묶음에도 넣지 않았다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 16개 상태 순서대로 `entry | pipe_poll 0 | readable []`, `write 2 5 | pipe_poll 0 | readable [2 5]`, `poll | pipe_poll 8 | ret 2 [2 5]`, `read 2 5 | pipe_poll 0 | readable []`, `poll | pipe_poll 8 | sleep`, `wake by write 5 | pipe_poll 8 | ret 1 [5]`, `read 5 | pipe_poll 0 | readable []`, `epoll_ctl ADD x8 | pipe_poll 8 | ready []`, `write 2 5 | pipe_poll 0 | ready [2 5]`, `epoll_wait | pipe_poll 2 | ret 2 [2 5]`, `epoll_wait | pipe_poll 2 | ret 2 [2 5]`, `read 2 5 | pipe_poll 0 | ready [2 5]`, `epoll_wait | pipe_poll 2 | ret 0`, `epoll_wait | pipe_poll 0 | ret 0`, `epoll_wait | pipe_poll 0 | sleep`, `wake by write 5 | pipe_poll 1 | ret 1 [5]`. 셋째 칸은 epoll 인스턴스가 있으면 ready 목록, 없으면 읽을 수 있는 파이프다
- 키보드: → 또는 Space = step 1회, Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 9개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- 전이 길이: STEP마다 모델의 `last`를 동작 목록으로 바꿔 돈다. 잭 하나를 꽂는 데 0.26초, 탐침 이동은 초당 300 단위라서 poll은 epoll_wait보다 눈에 띄게 오래 걸린다
- idle tour: 첫 화면 상태에서 끝까지 한 단계씩(전이가 끝나고 0.9초 뒤) 돌고, 마지막 뒤 2.5초 쉰 다음 entry로 돌아가 다시 돈다
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[8] (`write 2 5 | pipe_poll 0 | ready [2 5]`). 드롭 8개가 걸렸고, 카드 2와 5가 레인에 줄을 선 모습이 정지 이미지에 남는다
- 강조(lit): 방금 움직인 부품 하나. 탐침이 움직인 STEP은 탐침 기둥, 탐침이 안 움직인 write는 마지막에 레인으로 간 카드(없으면 마지막에 들어온 칩), read는 다음에 움직일 탐침 기둥, entry는 다음 write가 들어갈 2번 홈통의 끝막이

## 캡션

Linux 7.0.14(Docker Desktop linuxkit, arm64)에서 파이프 8개 중 2번과 5번에 1바이트씩 쓰고, 커널이 파일의 poll 메서드(pipe_poll)를 몇 번 부르는지 ftrace로 센 순서를 그대로 돌아요. poll은 호출마다 8개를 모두 묻고 잠들었다 깨면 8개를 다시 묻지만, epoll_wait는 ready 목록에 오른 카드의 파이프만 다시 묻습니다. 파이프를 1024개로 늘려도 poll 한 번은 1024회, epoll_wait 한 번은 2회였어요. 엣지 트리거(EPOLLET), EPOLLONESHOT, EPOLLEXCLUSIVE, 중첩 epoll, 소켓과 그 깨우기 경로, select(), 보내는 동안 들어온 이벤트를 모으는 ovflist, busy poll, EPOLLWAKEUP, 등록 항목의 레드블랙 트리는 그리지 않았습니다.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`, `linux-epoll.html`, `linux-epoll-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.
