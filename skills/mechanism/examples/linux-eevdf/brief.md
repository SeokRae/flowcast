# EEVDF 레인 선택기

## 대상

- 메커니즘: EEVDF 스케줄러가 CPU 하나의 실행 가능한 태스크 가운데 자격(lag >= 0, 곧 v <= V)이 있는 것 중 가상 마감이 가장 이른 것을 고르고, 고른 태스크의 vruntime이 nice 가중치에 따라 다른 속도(1024/w배)로 흐르는 과정
- 버전과 구현: Linux 7.0.14, Docker Desktop linuxkit 빌드(`7.0.14-linuxkit #1 SMP PREEMPT`), arm64, CPU 11개, `CONFIG_HZ=1000`, `CONFIG_PREEMPT_LAZY=y`. 코드 근거는 업스트림 stable 태그 `v7.0.14`(커밋 `458c6079fc1d41d564c37679c8ace02cd83ee817`)이고, 측정한 동작은 linuxkit 빌드의 것이다. 6.5 이하의 CFS(가장 작은 vruntime을 고름)는 그리지 않는다
- 대상 태스크 셋: CPU 10에 고정한 CPU 바운드 태스크 3개, `n0`(nice 0), `n1`(nice 1), `n5`(nice 5). 같은 순간 lag 0으로 깨어난 배치에서 시작해 결정 13번(#0 배치 때 1번, 그 뒤 실행마다 1번)을 그린다
- 크기: Figure (부품 약 70개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| 기본 슬라이스 2.8 ms = (1 + ilog2(min(11, 8))) x 0.7 ms | `fair.c` `get_update_sysctl_factor()`, `update_sysctl()`. 실측 `base_slice_ns` 2800000, `tunable_scaling` 1(LOG), online CPU 0-10 | `truth/env.txt`, `truth/kernel-refs.md` |
| 틱 1 ms, HRTICK 꺼짐 | `CONFIG_HZ=1000`, `TICK_NSEC`, 실측 `features`의 `NO_HRTICK` | `truth/env.txt` |
| 기능: PLACE_LAG, PLACE_DEADLINE_INITIAL, RUN_TO_PARITY, PREEMPT_SHORT, PICK_BUDDY, DELAY_DEQUEUE 켜짐, NEXT_BUDDY, HRTICK 꺼짐 | 실측 `/sys/kernel/debug/sched/features`, 기본값은 `features.h` | `truth/env.txt` |
| 가중치 1024, 820, 335 (nice 10은 110) | 실측 `se.load.weight`(1024배), `prio` 120 + nice. 표는 `core.c` `sched_prio_to_weight` | `truth/proc-sched.txt`, `truth/proc-sched-wide.txt` |
| vruntime 증가 = calc_delta_fair(실행 시간) = 실행 시간 x 1024/w (32비트 역수 곱과 시프트) | `fair.c` `__calc_delta()`, `calc_delta_fair()`, 역수는 `sched_prio_to_wmult`. 실측: 창 동안 nice 0은 vruntime 증가 = 실행 시간이 정확히 같고, nice 1과 5는 갱신마다 내림한 만큼만(316 ns, 133 ns) 모자란다 | `truth/proc-sched.txt`, `check.mjs` |
| 자격 = sum(w_j (v_j - v_i)) >= 0, 지금 도는 태스크 포함 | `fair.c` `vruntime_eligible()`. 실측: sched/debug 스냅숏 6개의 E와 N 18개가 이 식과 모두 같다 | `truth/debug-sched.txt` |
| 마감 = v + calc_delta_fair(슬라이스), v가 마감에 닿을 때만 갱신 | `fair.c` `update_deadline()`, `place_entity()`. 실측: 스냅숏마다 0 < d - v <= vslice | `truth/debug-sched.txt` |
| 선택 = 자격 있는 것 중 마감이 가장 이른 것, 지금 도는 것은 마감이 더 이를 때만 | `fair.c` `pick_eevdf()` | `truth/kernel-refs.md` |
| 보호 경계 = 마감(슬라이스가 모두 같을 때), 다시 뽑히면 낡은 채로 남음 | `fair.c` `set_protect_slice()`, `update_curr()`, `sched.h` `put_prev_set_next_task()` | `truth/kernel-refs.md` |
| resched는 틱 인터럽트에서 사용자 공간으로 돌아가는 길에 바로 일어남 | `core.c` `resched_curr_lazy()`, `kernel/entry/common.c` `__exit_to_user_mode_loop()`, arm64 `GENERIC_IRQ_ENTRY`. 실측: 전환 843번 중 95.4 %가 3.0 +-0.1 ms | `truth/sched_switch.txt` |
| 점유율 46.9/37.7/15.5 % (가중치 비 47.0/37.6/15.4 %) | 실측 `sum_exec_runtime` 증가분(첫 샘플과 마지막 샘플 사이, 실행 시간 합 1.28 s, 실행 1회의 값) | `truth/proc-sched.txt` |
| 다음 전환 예측 46/48 | 스냅숏의 v와 d에서 모델을 이어 돌린 결과를 그 뒤 `sched_switch`와 대조(실행 1회의 값) | `check.mjs` |
| 넓은 가중치 차(nice 0과 10): 무거운 쪽이 28 ms 안팎을 내리 돔 | 실측 `sched_switch-wide.txt`(중앙값 28 ms), 모델은 다시 뽑힘 뒤 틱마다 결정 | `truth/sched_switch-wide.txt` |

모델: `model.mjs` (`node check.mjs` 통과). 그림의 숫자는 모두 이 모듈에서 읽는다. 커널 원문 대조는 `bash truth/fetch-kernel.sh && node check-source.mjs`(참조 44개, 식별자 155개). 실측은 `bash truth/run.sh`로 다시 만든다(프로브 이미지 레시피 `truth/Dockerfile`, 프로브 `truth/spin.c`, `truth/run-inner.sh`).

### 결정적인 부분과 통계적인 부분 (`check.mjs`)

| 구분 | 검사 | 허용치 |
|---|---|---|
| 결정적 | 커널 버전, CPU 수, HZ, PREEMPT_LAZY, 기능 목록, `tunable_scaling`, `base_slice_ns` = 모델 상수 | 정확히 같음 |
| 결정적 | 태스크마다 `se.load.weight` = w x 1024, `prio` = 120 + nice, `se.slice` = 2800000 | 정확히 같음 |
| 결정적 | `calcDeltaFair`의 고정값(틱 1 ms의 가상 시간 1000000, 1248780, 3056716, vslice 2800000, 3496585, 8558806) | 정확히 같음 |
| 결정적 | 창 동안 vruntime 증가 = calc_delta_fair(실행 시간 증가) | nice 0은 같음, 나머지는 갱신 횟수(틱 + 2 x 전환) 이하로만 작음 |
| 결정적 | 스냅숏의 E/N = `eligible()`, 0 < d - v <= vslice, 슬라이스 2.8 ms, nr_queued 3, lag 한계 | 정확히 같음 |
| 결정적 | 모델: 비변경성, done에서 그대로, 결정마다 3틱, V는 결정마다 3 ms x 1024/2179 전진, #2만 마감이 가장 이른 것이 자격이 없어 건너뜀, 리드아웃 13개 고정 문자열 | 정확히 같음 |
| 통계적 | 전환 사이 실행이 3.0 +-0.1 ms인 비율, 중앙값 | 90 % 이상, 3 ms +-20 us |
| 통계적 | 점유율: 실측과 가중치 비, 모델 장기 실행(2000번)과 가중치 비 | 0.01, 0.005 |
| 통계적 | 넓은 셋: w0 실행 중앙값 28 ms, w10 실행 3 ms | +-0.6 ms, 90 % 이상 |
| 통계적 | 스냅숏에서 이어 돌린 다음 전환 8번 x 6 | 40/48 이상, 8번 모두 맞힌 스냅숏 4개 이상, 맞힌 전환 시각 +-0.2 ms |

## 기계 매핑

한 문장: CPU 구동 캐리지가 붙은 레인의 드럼만 돌아 그 레인의 캐리지를 끌고(지름이 1024/w배라 가벼운 태스크일수록 빨리 감긴다), 게이트는 세 캐리지 무게추의 무게중심(V)에 서며, 게이트 뒤에 있는 캐리지의 마감 핀만 서서, 왼쪽에서 오는 탐침 바가 처음 닿는 핀의 레인이 다음에 돈다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 캐리지 3개 (레인 위 위치, 표시창 숫자) | 태스크의 vruntime | `state.tasks[i].v` |
| 캐리지 위 무게추 (높이 = w) | nice 가중치 | `TASKS[i].weight` |
| 캡스턴 드럼 (반지름 = 1024/w, 돌 때 표시선이 돈다) | calc_delta_fair: 실행 1 ns가 가상 시간 몇 ns인가 | `calcDeltaFair(TICK_NS, w)` |
| CPU 구동 캐리지 (y 레일을 따라 레인을 옮김, 피니언이 돈다) | 지금 CPU를 받은 태스크 | `state.curr` |
| 게이트 팔과 지시봉 | 가중 평균 V (`avg_vruntime`) | `state.V` |
| 마감 핀 (트랙 위 위치) | 가상 마감 | `state.tasks[i].d` |
| 마감 핀의 높이 (서 있음과 내려감) | 자격 (v <= V) | `state.elig[i]` |
| 탐침 바 (멈춘 자리) | pick_eevdf: 자격 있는 것 중 가장 이른 마감 | `state.tasks[state.curr].d` |
| 케이블 | 드럼과 캐리지의 연결(감긴 길이 = vruntime 증가) | `state.ran.dv` |

움직이는 부품은 전부 이 표에 있다. 나머지(판, 레일, 스토퍼, 트랙, 받침, 노브)는 움직이지 않는다.

## 부품표

배치: 레인 3개가 x 방향(가상 시간 축, 1 ms = 6.6 단위)으로 뒤에서 앞으로 n0, n1, n5 순서로 놓인다. 레인 뒤쪽에 게이트 레일과 탐침 레일이 있고, 게이트 팔과 탐침 바는 그 레일에서 앞으로 레인을 가로질러 앞쪽 눈금 띠까지 내민 외팔보다. 오른쪽 끝에 레인마다 캡스턴이 있고, 그 뒤 y 레일에 CPU 구동 캐리지가 있다. 같은 모양이 되풀이되는 레일 클램프는 한 항목으로 세어 모두 합쳐 약 75개다.

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 4개 포함), 판 가장자리 홈, 모서리 나사 4개(링과 머리), 라벨판(규칙선 3줄, 나사 2개), 앞쪽 눈금 띠(0.5 ms 작은 눈금, 5 ms 큰 눈금, 0 ms 눈금), 레인 이름표 3개(표시창) |
| 구조 | 레인 레일 3개, 레일 왼쪽 스토퍼 3개, 레일 클램프(5 ms마다 레일 양옆, 나사 점), 마감 핀 트랙 3개(홈 포함)와 끝 스토퍼 6개, 캡스턴 받침대 3개, 케이블 안내 롤러 3개, 게이트 레일과 끝 캡 2개, 탐침 레일과 끝 캡 2개, CPU y 레일(홈 포함), CPU 레일 스토퍼 2개 |
| 메커니즘 | 캐리지 3개(부싱 4개, 표시창), 무게추 3개(높이 = 가중치), 케이블 3개(끝점 포함), 캡스턴 3개(기어 원판, 드럼, 위 플랜지, 회전 표시선), 마감 핀 3개(슬라이더, 핀, 머리), 게이트(캐리지, 팔, 지시봉), 탐침 바(캐리지, 팔, 지시 끝), CPU 구동 캐리지(블록, 모터, 피니언, 각인 `CPU 10`) |
| 조작부 | 게이트 레일 손나사, 탐침 레일 손나사, CPU 캐리지 널링 노브 |
| 강조 대상 | 방금 돈 캐리지 하나 (entry에서는 다음에 돌 n0의 캐리지) |

그리기 순서: 베이스와 눈금 띠, 뒤 레일 두 개와 그 위 캐리지, 레인 0, 1, 2(레인마다 고정 부품, 케이블, 움직이는 부품, 캡스턴), 앞 영역의 팔 끝, CPU 구동부 순서다. 레인을 가로지르는 게이트 팔과 탐침 바는 레인 경계에서 조각으로 나눠(이음매에 리벳 두 개) 각 레인 안에서 정렬한다. 레인 안의 움직이는 부품은 프레임마다 x로 순서를 정한다: 캐리지는 늘 핀보다 먼저(핀은 앞 트랙), 팔은 핀보다 왼쪽이면 먼저, 캐리지가 팔보다 완전히 앞이면 팔이 먼저, 게이트와 탐침은 x가 큰 쪽이 나중(같으면 높은 게이트가 나중)이다.

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `cpu` | CPU 구동 캐리지 | 지금 CPU를 받은 태스크 | CPU y 레일, 스토퍼 2개, 블록, 피니언 팔, 피니언, 모터, 노브, 각인 |
| 02 | `drum` | 캡스턴 드럼 | calc_delta_fair (1024/w) | 받침대, 기어 원판, 드럼, 플랜지 3벌, 케이블 안내 롤러 3개 |
| 03 | `carriage` | 캐리지 | vruntime | 캐리지 3개와 표시창, 케이블 3개 |
| 04 | `weight` | 무게추 | nice 가중치 | 무게추 3개 |
| 05 | `gate` | 게이트 | V (avg_vruntime) | 게이트 레일과 캡, 캐리지, 팔, 지시봉, 손나사 |
| 06 | `pin` | 마감 핀 | 가상 마감과 자격 | 핀 트랙 3개와 끝 스토퍼, 슬라이더, 핀, 머리 |
| 07 | `probe` | 탐침 바 | pick_eevdf | 탐침 레일과 캡, 캐리지, 팔, 지시 끝, 손나사 |
| 08 | `lane` | 레인 | 태스크 하나 (n0, n1, n5) | 레일 3개, 스토퍼 3개, 레일 클램프, 이름표 3개 |
| 09 | `ruler` | 눈금 띠 | 가상 시간 (ms) | 눈금 띠와 눈금 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, 가중치, 슬라이스, 틱, 비율은 `model.mjs`에서 읽는다. 베이스 판과 라벨판은 어느 묶음에도 넣지 않았다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 13개 상태 순서대로 `#0 pick n0 | elig n0 n1 n5 | V 0.00 ms`, `#1 pick n1 | elig n1 n5 | V 1.41 ms`, `#2 pick n5 | elig n5 | V 2.82 ms`, `#3 pick n0 | elig n0 n1 | V 4.23 ms`, `#4 pick n1 | elig n1 | V 5.64 ms`, `#5 pick n0 | elig n0 | V 7.05 ms`, `#6 pick n1 | elig n1 | V 8.46 ms`, `#7 pick n0 | elig n0 n5 | V 9.87 ms`, `#8 pick n1 | elig n1 n5 | V 11.28 ms`, `#9 pick n0 | elig n0 n5 | V 12.69 ms`, `#10 pick n5 | elig n5 | V 14.10 ms`, `#11 pick n0 | elig n0 n1 | V 15.51 ms`, `#12 pick n1 | elig n1 | V 16.92 ms`. `elig`는 그 결정 순간 자격 있는 태스크, `V`는 그 순간의 가중 평균이다
- 키보드: → 또는 Space = step 1회(결정 1번), Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 9개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- idle tour: 결정을 하나씩(약 1.9초 전이와 0.5초 쉼) 끝까지 돌고, 1.6초 쉰 뒤 reset
- 한 STEP의 움직임 순서: 뽑힌 레인의 드럼이 돌아 캐리지가 vruntime 증가만큼 가고, 게이트가 새 V로 가며, 탐침 바는 집으로 물러난다. 캐리지가 마감을 넘었으면 그 핀이 v + vslice로 옮겨진다. 이어 결정 순간의 자격대로 핀이 서거나 내려가고, 탐침 바가 왼쪽에서 와서 처음 닿는 핀에 멈추며, CPU 구동 캐리지가 그 레인으로 옮긴다
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[2] (`#2 pick n5 | elig n5 | V 2.82 ms`). n0과 n1의 핀이 n5의 핀보다 왼쪽(마감이 이르다)에 있지만 내려가 있어 탐침 바가 그 위를 지나 n5의 핀에 멈춘 모습이 정지 이미지에 남는다
- 강조(lit): 방금 돈 캐리지 하나. entry(#0)에서는 다음 STEP에 돌 n0의 캐리지

## 캡션

Linux 7.0.14(linuxkit, arm64)의 CPU 10 하나를 nice 0, 1, 5 태스크가 EEVDF로 나눕니다. 기본 슬라이스 2.8 ms(0.7 ms에 CPU 11개를 8로 자른 배율 4를 곱한 값), 가중치 1024, 820, 335, 1 ms 틱은 커널 소스와 /proc, sched/debug 실측에서 왔고, 그림의 한 결정은 3틱 실행이에요. 실측 점유율 46.9/37.7/15.5 %는 한 번 기록한 실행의 값입니다. 그룹 스케줄링과 cgroup, CPU 사이 부하 분산, RT와 deadline 클래스, 깨어날 때의 배치와 선점(PLACE_LAG, DELAY_DEQUEUE, PREEMPT_SHORT), PREEMPT_LAZY의 틱 세부, 같은 태스크가 다시 뽑혀 틱마다 결정을 받는 경우(이 셋에서는 #32에서 처음 나와요), CPU 10에 끼어든 다른 태스크는 그리지 않았습니다.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`, `linux-eevdf.html`, `linux-eevdf-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.

## 판단 기록 (오케스트레이터 없이 정한 것)

- 태스크 셋을 nice 0, 1, 5로 골랐다. 0, 2, 5는 처음 15번의 결정(#0에서 #14) 동안 마감이 가장 이른 태스크가 늘 자격도 있어서 자격 규칙이 결과를 바꾸는 장면이 없었다. 0, 1, 5는 #2에서 바로 그 장면(n0의 마감 5.80 ms가 가장 이르지만 자격이 없어 n5)이 나오고, nice 1은 흔히 말하는 "nice 한 단계 = 1.25배"를 보여 준다
- STEP 1회를 "뽑힌 태스크가 다음 결정 지점까지 돈 뒤 pick_eevdf가 다음을 고름"으로 정했고, 배치 때의 첫 선택을 #0(entry)에 넣었다. 그래서 모든 상태가 결정 순간이고 리드아웃과 정지 그림이 같은 순간을 가리킨다
- 시작 배치는 lag 0으로 같은 순간 깨어난 상태(v = 0, d = vslice)로 정했다. 실측은 시그널로 동시에 깨운 셋이라 처음 몇 ms는 다르게 시작하므로, 실측과의 대조는 정상 상태의 통계와 스냅숏에서 이어 돌리기로 했다
- 다시 뽑힘(전환 없는 결정) 뒤 틱마다 결정하는 동작은 모델에 넣었지만 그림의 13개 결정에는 나오지 않는다. 그래서 넓은 가중치 차 셋(nice 0, 10)을 따로 측정해 이 규칙을 확인했다
- `--pid=host`로 컨테이너를 돌렸다. 컨테이너 PID 이름공간에서는 `set_event_pid`와 sched/debug가 쓰는 전역 PID를 알 수 없었다(첫 시도에서 다른 커널 스레드가 잡혔다)
- 소음: 그림 셋을 측정하는 동안 CPU 10에 `kworker/10:1`이 8번, `kworker/10:1H`가 1번 끼어들었고, 넓은 셋 동안에는 `kworker/10:1`이 11번 끼어들어 w0의 28 ms 실행 몇 개를 둘로 잘랐다(각 기록 첫 줄의 `swapper/10`은 깨우기 직전의 idle). `oracle-pg` 컨테이너와 다른 에이전트의 프로브는 CPU 10에 나타나지 않았다
