# 시스템 콜 창구

## 대상

- 메커니즘: 시스템 콜. 사용자 공간 코드가 번호(x8)와 인자(x0~x5)를 레지스터에 싣고 `svc #0`으로 커널에 들어가면, 커널이 번호로 핸들러를 골라 실행하고 결과(실패면 음수 errno)를 x0에 담아 돌려준다. 범위는 경계 넘기와 디스패치이고, 핸들러 안(VFS 등)은 그리지 않는다
- 버전과 구현: Linux 7.0.14, Docker Desktop linuxkit 빌드(`7.0.14-linuxkit #1 SMP PREEMPT`), arm64, 64비트 EL0. 소스 근거는 upstream stable 태그 `v7.0.14`(커밋 `458c6079fc1d41d564c37679c8ace02cd83ee817`)이고, 동작은 linuxkit 빌드에서 실측했다. 사용자 공간은 Debian trixie, glibc 2.41, gcc 14.2, strace 6.13
- 대상 호출: 합성 프로브 `truth/syscall-probe.c`가 glibc를 거치지 않는 raw `svc #0`으로 부른 네 번. `getpid`(172), `read(99, buf, 8)`(63, 열린 적 없는 fd), 번호 없는 칸 244, 표 바로 뒤 472
- 크기: Figure (부품표 약 75개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| 번호 read 63, getpid 172 (openat 56, close 57, write 64도 확인) | 컴파일한 프로브가 찍은 `SYS_*` (linux-libc-dev 6.12 헤더), strace `-n`, ftrace `sys_enter` | `truth/probe.txt`, `truth/strace.txt`, `truth/ftrace.txt` |
| 네 호출의 x0: 45, -9, -38, -38 | raw svc가 받은 값, ftrace `sys_exit` | `truth/probe-traced.txt`, `truth/ftrace.txt` |
| 핸들러: `__arm64_sys_getpid`, `__arm64_sys_read`(그 아래 `ksys_read`), `__arm64_sys_ni_syscall`(그 아래 `sys_ni_syscall`), 472는 `invoke_syscall.constprop.0`이 `sys_ni_syscall`을 바로 부름 | ftrace function tracer + `func_stack_trace`, 자기 instance, 자기 pid만 | `truth/ftrace.txt` |
| 진입 경로 `el0t_64_sync`, `el0t_64_sync_handler`, `el0_svc`, `do_el0_svc`, `invoke_syscall.constprop.0` | ftrace 스택. `el0_svc_common`, `do_ni_syscall`, `__invoke_syscall`는 인라인되어 심볼이 없음 | `truth/ftrace.txt`, `truth/kallsyms.txt` |
| 표 길이 472 (`__NR_syscalls`) | `scripts/syscall.tbl`을 arm64 ABI로 읽은 최대 번호 471 + 1. 실측: 471은 표를 거쳐 `__arm64_sys_rseq_slice_yield`, 472는 표를 건너뜀 | `truth/kernel-refs.md`, `truth/ftrace.txt` |
| 빈 칸 145개: 244~259, 295~423 | `scripts/syscall.tbl`, `scripts/syscalltbl.sh`, `arch/arm64/kernel/sys.c` (check-source.mjs가 다시 셈) | `truth/kernel-refs.md` |
| 번호는 있으나 약한 스텁인 칸 11개 (104, 106, 235~239, 282, 294, 450, 471) | `/proc/kallsyms`의 `W __arm64_sys_*` 61개 중 arm64 표에 있는 것 | `truth/weak-stubs.txt`, `check-source.mjs` |
| 벡터 VBAR_EL1 + 0x400, pt_regs 0x140바이트 | `/proc/kcore`를 gdb로 읽은 vectors+0x400 명령 10개 (`sub sp, sp, #0x140`, `b el0t_64_sync`). Arm ARM 벡터 표, `entry.S`의 vectors 9번째 항목 | `truth/vector-el0-sync.txt`, `truth/kernel-refs.md` |
| ESR_EL1.EC SVC64 = 0x15 | `arch/arm64/include/asm/esr.h` | `truth/kernel-refs.md` |
| errno EBADF 9, ENOSYS 38 | `errno-base.h`, `errno.h`, 프로브의 glibc 호출 (`-1 errno 9`, `-1 errno 38`) | `truth/probe.txt` |
| glibc read는 63을 x6에 넣고 내부 함수가 x8로 옮겨 svc, `cmn x0, #0x1, lsl #12`로 -4095~-1을 errno로 바꿈. getpid는 `mov x8, #0xac; svc #0; ret` | `objdump -d` libc.so.6 (2.41-12+deb13u4) 발췌 | `truth/glibc-excerpt.txt` |
| strace는 raw 호출의 -9도 `-1 EBADF`로 보여준다. glibc의 clock_gettime은 svc가 없다(strace에 raw 한 번만) | strace 6.13 `-n` (상수를 숫자로 찍은 `-X raw` 판도 함께) | `truth/strace.txt`, `truth/strace-raw.txt` |

모델: `model.mjs` (`node check.mjs` 통과). `check.mjs`는 위 원본 파일을 직접 읽어 상수와 대조하고 오프라인으로 돈다. 커널 원문(GPLv2)은 이 저장소(MIT)에 두지 않는다. `truth/kernel-refs.md`에 고정 태그의 줄 링크와 우리 말 요약만 적고, 원문 대조는 `bash truth/fetch-kernel.sh`로 임시 폴더에 받은 뒤 `node check-source.mjs`로 한다. glibc(LGPL) 디스어셈블은 필요한 명령 12줄만 `truth/glibc-excerpt.txt`에 남겼고, 전체 출력은 커밋하지 않는다. 실측 재현은 `bash truth/run.sh <작업 폴더>`이고(이미지가 없으면 `truth/Dockerfile`로 만든다), 커밋한 로그는 그중 실행 1회다. pid, 시각, CPU 번호, 주소는 실행마다 달라지고 번호, 반환값, 호출 경로는 같다. 프로브를 띄우기까지의 순서가 같은 스크립트로 세 번 돌렸을 때 getpid는 매번 45였다(컨테이너 pid 네임스페이스가 매번 새로 생기고, 그 앞에 뜨는 프로세스 수가 같으므로). ftrace의 pid 칸은 VM 전역 pid라 이 값과 다르다.

판단 기록:

- 카탈로그 후보 "방탄유리 창구의 서류 서랍"을 다듬었다. 서랍은 레지스터 묶음이고, 커널 쪽에 닿으면 pt_regs가 된다(kernel_entry가 레지스터를 커널 스택에 저장한 사본을 커널이 읽고 쓴다). 서랍만으로는 "모든 호출이 같은 입구로 들어온다"와 "번호로 표를 고른다"가 보이지 않아, 입구 셔터(예외 벡터), EL 셔틀(예외 수준), 카드 랙(sys_call_table)과 선택 캐리지(invoke_syscall), 끝 멈춤쇠(표 길이 검사)를 더했다
- STEP 한 번은 경계 넘기의 한 단계(load, svc, dispatch, return, eret)다. 이 그림의 주제가 경계 넘기이므로 호출 하나를 STEP 하나로 묶으면 넘는 순간이 애니메이션 안으로 숨어 리드아웃으로 짚을 수 없다. 단계마다 바뀌는 상태가 다르다(load는 x8, svc는 예외 수준과 레지스터 위치, dispatch는 고른 핸들러, return은 x0, eret은 다시 예외 수준)
- 호출은 raw svc로 했다. glibc를 거치면 x0의 음수 errno가 -1과 errno로 바뀌어 커널이 실제로 돌려준 값이 가려진다. glibc의 변환은 x0 창의 설명에 실측으로 적었다
- 244번(표 안의 빈 칸)과 472번(표 밖)을 둘 다 넣었다. 둘 다 -38이지만 앞의 것은 표에서 `__arm64_sys_ni_syscall`을 꺼내고, 뒤의 것은 표를 읽지 않는다. 이 차이는 ftrace 스택에서만 보인다
- 카드 랙의 칸 간격은 0.32 단위로, 472칸이 한 줄에 들어가게 정했다(칸 위치는 정확하고 카드 두께도 한 칸이다). 랙 윗면의 칸막이 선은 8칸마다, 색인 탭과 앞 눈금 띠의 큰 눈금은 64칸마다다. 그림 안 글자는 서랍의 x8 카운터 창과 x0 창이 보여주는 숫자(기계의 표시창)뿐이다
- 471번(rseq_slice_yield)은 표 끝을 확인하려고 프로브에서 함께 불렀지만 그림의 차례에는 넣지 않았다
- 벡터 오프셋과 pt_regs 크기는 소스만으로 정하지 않고, 실행 중인 커널의 `/proc/kcore`를 gdb로 읽어 `vectors+0x400`의 명령을 확인했다(주소는 `vectors` 기준 오프셋으로 바꿔 커밋)
- `kit/lathe.mjs`, `kit/tube.mjs`를 쓰지 않았으므로 기하 감사(`--audit`)는 해당 없다
- 프로브의 ftrace 단계는 raw_syscalls 이벤트를 켜므로 그동안 el0_svc_common이 `syscall_trace_enter`를 거친다. 핸들러 스택(invoke_syscall 위아래)은 그 경로와 상관없이 같다. 컨테이너가 자기 pid 네임스페이스를 가지므로 프로브는 trace_marker로 자기 전역 pid를 알리고, 그 pid로 `set_ftrace_pid`와 `set_event_pid`를 건 뒤에 네 호출을 했다. instance는 끝나면 지웠다

## 기계 매핑

한 문장: 손잡이를 밀면(`svc #0`) 번호 카운터(x8)와 인자 칸을 실은 서랍이 하나뿐인 셔터를 지나 방탄유리 뒤 커널 쪽으로 들어가고, 캐리지가 472칸 랙의 그 번호 칸으로 가서 솟아오른 카드를 읽은 뒤 결과를 x0 창에 찍으면 서랍이 같은 길로 돌아온다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| x8 카운터의 세 자리 창 (숫자가 굴러 바뀜) | 시스템 콜 번호 x8 | `state.x8` |
| x0 창 (값이 바뀜) | 첫 인자이자 반환값 x0 | `state.x0` |
| 서랍 (사용자 쪽과 커널 쪽 사이를 미끄러짐) | 레지스터 묶음. 커널 쪽에 닿으면 pt_regs | `state.side` |
| 입구 셔터 (서랍이 지날 때만 올라감) | 예외 벡터 VBAR_EL1 + 0x400 | `state.stage` (svc, eret) |
| 헤더 위 EL 셔틀 (사용자 쪽 끝과 커널 쪽 끝을 오감) | CPU가 실행 중인 예외 수준 | `state.el` |
| 선택 캐리지와 헤드 (빔을 따라 움직이고, 헤드가 내려와 카드를 읽거나 x0를 찍음) | invoke_syscall: 길이 검사, 표 조회, 호출, 반환값 기록 | `state.x8`, `state.handler`, `state.inTable` |
| 솟아오르는 카드 하나 (랙의 칸 하나, 또는 멈춤쇠 위 ni 카드) | 고른 표 칸 (함수 포인터) | `state.handler`, `state.inTable` |

움직이는 부품은 전부 이 표에 있다. 표에 없는 부품은 정지한 구조물이다.

## 부품표

배치: 바닥판은 L자다. 뒤쪽 긴 부스(커널 쪽)와 왼쪽 앞으로 튀어나온 카운터(사용자 쪽) 사이를 방탄유리 칸막이가 카운터 폭만큼 막는다. 칸막이 오른쪽 부스 앞은 잘라 낸 단면처럼 열어 두었다(칸막이를 부스 전체 폭으로 세우면 헤더와 기둥이 랙과 캐리지를 가린다). 서랍은 카운터에서 칸막이 아래 슬롯을 지나 부스 왼쪽의 도킹 자리까지 레일 위를 미끄러진다. 부스 안에는 도킹 자리 오른쪽으로 카드 랙과 끝 멈춤쇠가 x 방향으로 늘어서고, 그 위를 갠트리 빔이 도킹 자리부터 멈춤쇠 너머까지 가로지른다. 캐리지는 빔에 매달려 빔 앞면의 톱니 띠를 따라 움직인다. 모두 합쳐 약 75개다.

| 묶음 | 부품 |
|---|---|
| 베이스 | L자 바닥판, 발 5개(플랜지 포함), 판 가장자리 홈, 모서리 나사 5개(링과 머리), 라벨판(규칙선 3줄, 나사 2개), 카운터의 서랍 자리 홈, 랙 앞 눈금 띠(8칸마다 작은 눈금, 64칸마다 큰 눈금, 0번 칸 표시) |
| 구조 | 칸막이 아랫벽 2개(슬롯 좌우, 나사), 유리 아래 가로대, 기둥 2개, 유리판(반사선 2줄), 헤더, 셔터 안내 홈 2개, 서랍 레일 2개와 앞 멈춤 2개, 도킹 범퍼(완충 패드 2개), 도킹 옆 안내대 2개, 갠트리 기둥 2개와 받침 2개, 갠트리 빔과 끝 캡 2개, 빔 앞면 톱니 띠(구동 랙), 랙 받침과 뒷벽, 앞벽, 왼쪽 끝벽, 끝 멈춤쇠 블록과 나사, ni 카드 홀더, EL 셔틀 가로 레일과 멈춤 2개 |
| 메커니즘 | 서랍(바닥, 벽, 앞 립), 손잡이, x8 카운터(세 자리 창), x0 블록(창), 인자 캡 5개(x1~x5), 입구 셔터(손잡이 립), EL 셔틀, 캐리지(몸통, 앞뒤 볼 판, 나사), 헤드와 로드, 카드 덱 5덩이(번호 있는 칸 3덩이, 빈 칸 2덩이, 8칸마다 칸막이 선이 윗면과 앞면에), 색인 탭 7개, 솟는 카드, ni 카드 |
| 조작부 | 빔 오른쪽 기둥 위 널링 노브, 갠트리 받침 손나사 2개 |
| 강조 대상 | 상태마다 하나: 방금 바뀐 x8 카운터, 서랍, 고른 카드, 값이 찍힌 x0 블록 |

움직이는 것: x8 카운터 숫자(load), x0 창 숫자(load와 return), 서랍(svc와 eret, y 방향), 셔터(svc와 eret, 위아래), EL 셔틀(svc와 eret), 캐리지(dispatch에서 칸으로, return에서 도킹 자리로), 헤드(카드와 x0 블록 위로 내려옴), 고른 카드(dispatch에서 솟고 return에서 내려감). 랙, 칸막이, 빔은 움직이지 않는다.

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `dial` | x8 카운터 | 시스템 콜 번호 x8 | 카운터 블록과 세 자리 창 |
| 02 | `x0` | x0 창 | 첫 인자이자 반환값 x0 | x0 블록과 창 |
| 03 | `args` | 인자 칸 | x1~x5 | 인자 캡 5개 |
| 04 | `drawer` | 서랍과 손잡이 | svc #0, 레지스터 묶음(pt_regs) | 서랍 바닥, 벽, 앞 립, 손잡이, 레일과 앞 멈춤, 도킹 범퍼와 안내대 |
| 05 | `glass` | 방탄유리 칸막이 | EL0와 EL1의 경계 | 아랫벽 2개, 유리 아래 가로대, 기둥 2개, 유리판, 헤더 |
| 06 | `gate` | 입구 셔터 | 예외 벡터 VBAR_EL1 + 0x400 | 셔터, 안내 홈 2개 |
| 07 | `el` | EL 셔틀 | CPU가 실행 중인 예외 수준 | 가로 레일, 멈춤 2개, 셔틀 |
| 08 | `carriage` | 선택 캐리지 | invoke_syscall | 캐리지 몸통과 볼 판, 로드, 헤드 (빔과 톱니 띠는 넣지 않음) |
| 09 | `rack` | 카드 랙 | sys_call_table (472칸) | 랙 받침과 벽, 번호 있는 덱 3덩이, 색인 탭, 눈금 띠, 솟는 카드 |
| 10 | `blank` | 빈 카드 | 번호 없는 칸 145개 | 빈 칸 덱 2덩이와 그 위 탭 |
| 11 | `stop` | 끝 멈춤쇠 | 표 길이 검사, 표 밖은 sys_ni_syscall | 멈춤쇠 블록, ni 카드 홀더, ni 카드 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, 번호, 칸 수, 오프셋, 반환값은 `model.mjs`에서 읽는다. 베이스, 갠트리 기둥과 빔, 라벨판은 어느 묶음에도 넣지 않았다. 솟는 카드는 빈 칸에서 솟을 때도 랙 묶음에 둔다(노드가 하나다).

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 21개 상태 순서대로 `entry | EL0`, 그 뒤 호출마다 `load | EL0 | x8 172 getpid | x0 0`, `svc #0 | EL0 -> EL1 | vector +0x400`, `dispatch | [172] __arm64_sys_getpid`, `return | x0 = 45`, `eret | EL1 -> EL0 | x0 45`. read는 `dispatch | [63] __arm64_sys_read`, `return | x0 = -9 EBADF`, 244는 `dispatch | [244] __arm64_sys_ni_syscall`, 472는 `dispatch | 472 >= 472 | sys_ni_syscall`
- 키보드: → 또는 Space = step 1회, Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 11개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- idle tour: trace 전체를 한 단계씩(전이 0.75~1.5초, 그 사이 0.7초) 돌고, 마지막 eret 뒤 1.6초 쉰 다음 reset
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[8] (`dispatch | [63] __arm64_sys_read`). 서랍이 커널 쪽에 있고 캐리지가 63번 칸의 카드를 읽는 모습이 정지 이미지에 남는다
- 강조(lit): load는 x8 카운터, svc와 eret은 서랍, dispatch는 고른 카드, return은 x0 블록. entry에서는 다음 STEP(load)이 바꿀 x8 카운터

## 캡션

Linux 7.0.14(Docker Desktop linuxkit, arm64)에서 raw svc #0으로 부른 네 시스템 콜(getpid 172, read 63, 빈 칸 244, 표 밖 472)을 경계 넘기 다섯 단계로 따라갑니다. 번호, 반환값, 호출 경로는 실행 1회의 ftrace, strace, /proc/kcore 실측이고, 표 길이 472칸과 빈 칸 145개는 v7.0.14 소스에서 셌어요. getpid의 45는 컨테이너 pid 네임스페이스에서 본 값입니다. 진입 직후의 컨텍스트 추적과 인터럽트 처리, 커널 스택 위치 무작위화, 추적과 seccomp가 거치는 syscall_trace_enter, 돌아가기 전 시그널과 재스케줄 처리, 핸들러 안의 VFS, glibc의 취소 처리와 vDSO(clock_gettime은 svc 없이 끝나요), KPTI 트램펄린 벡터, 32비트 compat 표는 그리지 않았습니다.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`, `linux-syscall.html`, `linux-syscall-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.
