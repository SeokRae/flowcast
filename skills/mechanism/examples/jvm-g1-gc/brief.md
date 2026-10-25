# G1 영역 트레이와 피커

## 대상

- 메커니즘: G1 young GC가 Eden과 Survivor 영역의 살아 있는 객체를 새 Survivor 영역으로 복사하고, 나이가 임계값에 닿은 객체는 Old 영역으로 승격한 뒤 collection set 영역을 통째로 비우는 과정 (young GC 3번)
- 버전과 구현: Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64, G1 (기본 수집기)
- 실행: `-Xms16m -Xmx16m -XX:+UseG1GC -XX:ParallelGCThreads=1`, 프로그램은 `truth/Ages.java` (합성, 256 KiB 배열만 할당)
- 크기: Figure (부품 40~80개, 아래 부품표 약 70개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| 영역 1048576바이트, 16개 | `-XX:+PrintFlagsFinal`의 `G1HeapRegionSize {ergonomic}`, `MaxHeapSize` | `truth/flags.txt` |
| `MaxTenuringThreshold = 15`, `TargetSurvivorRatio = 50` | `-XX:+PrintFlagsFinal` | `truth/flags.txt` |
| 블록 하나 = byte[] 262144바이트, 영역마다 4개 | `Ages.java`의 `BLOCK_BYTES`, 할당 주소 간격 | `truth/probe.txt` |
| 처음부터 Old인 영역 14, 15 = CDS 아카이브 힙 1061272바이트 | `-Xlog:gc+region=trace`의 GC(0) 전 `ALLOC(OLD)` 두 줄, `-Xlog:cds`, `-Xshare:off`면 `Old regions: 0->0` | `truth/gc.log`, `truth/cds-heap.txt` |
| 구간마다 Eden 영역 번호 (13, 12 / 13, 12 / 13, 12, 11, 9, 8) | `G1HR ALLOC(EDEN)` | `truth/gc.log` |
| young은 빈 영역의 위쪽 끝, Old는 아래쪽 끝에서 꺼낸다 | 위 `ALLOC(EDEN)`, `ALLOC(SURV)` 11, 10, 7, `ALLOC(OLD)` 0 | `truth/gc.log` |
| 영역 안 블록 순서, 복사 뒤 블록 위치와 나이 | `Ages.java`가 `sun.misc.Unsafe`로 읽은 주소와 mark word의 age 비트 | `truth/probe.txt` |
| 희망 survivor 크기 524288바이트 = 1영역 x 1048576 x 50% | `Desired survivor size`, `Survivor regions: a->b(1)` | `truth/gc.log` |
| 임계값 15, 15, 2 | `new threshold N (max threshold 15)`, 직전 나이표를 나이 1부터 더해 524288을 넘는 첫 나이 (GC(2): 262176 + 366688 = 628864) | `truth/gc.log` |
| 나이표 바이트 | `Age table with threshold N` 아래 `- age k:` 줄 | `truth/gc.log` |
| 영역 수 변화, collection set, 해제한 영역 | `Eden/Survivor/Old regions: a->b`, `G1HR CSET`, `G1HR CLEANUP(FREE)` | `truth/gc.log` |
| 작은 객체 묶음 104544바이트 | GC(1) `age 2: 366688` 에서 A의 262144를 뺀 값 | `truth/gc.log` |
| 32바이트 | `Ages.java`가 GC를 알아채려고 pause마다 새로 만드는 `WeakReference` 하나. 다음 pause에서 나이 1로 복사된다 | `truth/gc.log` |

모델: `model.mjs` (`node check.mjs` 통과). `check.mjs`는 위 원본 파일을 직접 읽어 모델의 모든 상태와 대조한다. 그림의 숫자는 모두 이 모듈에서 읽는다. `truth/run.sh`로 원본을 다시 만들 수 있다(힙 시작 주소만 실행마다 바뀐다).

## 기계 매핑

한 문장: 트레이 16개가 1MB 영역이고, 캔틸레버 피커가 살아 있는 블록만 집어 위쪽 빈 트레이(Survivor)나 아래쪽 빈 트레이(Old)로 옮긴 뒤, 비운 트레이의 남은 블록은 바닥으로 가라앉는다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 트레이 16개 (4 x 4, 앞줄이 높은 번호) | 힙 영역 16개, 각 1048576바이트 | `state.regions` |
| 트레이 왼쪽 틈에 선 라벨 판의 창 글자 (E, S, O, 빈칸) | 영역 종류 (Eden, Survivor, Old, free) | `state.regions[i].type` |
| 위에서 떨어져 자리에 앉는 블록 | mutator가 Eden 영역 하나를 채움 | `state.moved.kind == "alloc"` |
| 창 달린 블록과 창의 숫자 | 살아 있는 배열 A, B, C와 mark word의 나이 | `state.items.{A,B,C}.age` |
| 알갱이 컵과 창의 숫자 | JVM과 프로그램이 시작하며 만든 작은 객체 묶음, 그 나이 | `state.items.boot` |
| 창 없는 블록 | 만들자마자 버린 배열 (쓰레기) | `kind == "garbage"` |
| 숫자가 지워진 창의 블록 | 복사가 끝나 전달 포인터만 남은 원본 | `kind == "stub"` |
| 피커 (트럭, 암, 캐리지, 로드, 흡착 패드) | GC 워커 스레드 하나가 객체 하나를 복사 | `state.moved.kind == "copy"` |
| 가라앉는 블록과 비는 라벨 창 | collection set 영역 해제 | `state.moved.kind == "end"` |
| 임계 나이 슬라이더 (오른쪽 멈춤쇠 = 15) | tenuring threshold, pause 시작마다 다시 계산 | `state.threshold` |
| 높이 게이지 창 속의 떠오르는 표시와 기준 눈금 | 직전 나이표의 누적 바이트와 희망 survivor 크기 | `state.cum`, `state.desired` |
| 빈 영역 카운터의 두 자리 창 | free 영역 수 | `counts(state).free` |
| 아카이브 판 (트레이 14, 15) | CDS 아카이브 힙 | `CDS_REGIONS` |

글자는 기계가 보여주는 창(라벨 창, 블록과 컵의 나이 창, 카운터 창)에만 있다. 그 밖의 글자는 그림에 넣지 않는다.

## 부품표

배치: 바닥판 위에 줄 받침 4개가 앞뒤로 놓이고, 받침마다 트레이 4개가 왼쪽에서 오른쪽으로 영역 번호 순서대로 앉는다(뒷줄 0~3, 앞줄 12~15). 트레이마다 왼쪽 틈에 라벨 판이 서 있고, 라벨판은 오른쪽 가장자리에 있다. 뒤쪽 기둥 2개가 레일 빔을 받치고, 레일을 타는 트럭에서 암이 앞으로 뻗어 나와 캐리지가 그 아래를 오간다. 앞쪽 띠에는 왼쪽부터 빈 영역 카운터, 임계 나이 자와 슬라이더, 오른쪽 끝에 높이 게이지가 있다.

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 4개 포함), 판 가장자리 홈, 모서리 나사 4개(링과 머리), 라벨판(규칙선 3줄, 나사 2개), 줄 받침 4개(끝 나사 16개), 임계 나이 눈금 띠(나이 0~15 눈금, 5마다 큰 눈금) |
| 구조 | 레일 기둥 2개(받침 2개, 손나사 2개), 레일 빔, 빔 끝 캡 2개, 암 끝 멈춤쇠, 슬라이더 가이드 레일, 가이드 멈춤쇠 2개(오른쪽 = 최대 15), 게이지 받침과 기둥, 기둥 캡, 카운터 함 |
| 메커니즘 | 트레이 16개(바닥, 벽 4개, 자리 홈 4개, 앞벽 리벳 2개), 라벨 판 16개(받침, 판, 창, 리벳), 피커(트럭, 바퀴 자리 나사, 암, 캐리지, 리프트 로드, 흡착 패드), 블록(창 달린 것, 창 없는 것, 숫자 지운 것), 알갱이 컵, 아카이브 판 2개, 임계 나이 슬라이더(포인터 날 포함), 게이지 앞면 창과 눈금, 떠오르는 표시, 카운터 창 |
| 조작부 | 트럭 손나사, 슬라이더 손잡이, 카운터 리셋 노브 |
| 강조 대상 | 지금 움직이는 부품 하나: 옮겨지는 사본, pause 시작의 슬라이더, 막 Eden이 된 트레이의 라벨 창, pause 끝의 카운터 |

움직이는 것: 떨어지는 블록(할당), 피커와 옮겨지는 사본(복사), 원본 블록의 창(전달 포인터), 가라앉는 블록(해제), 라벨 창 글자, 슬라이더와 게이지 표시(pause 시작), 카운터 숫자. 트레이, 받침, 기둥, 레일은 움직이지 않는다.

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `trays` | 트레이 | 힙 영역 | 트레이 16개의 바닥, 벽, 자리 홈 |
| 02 | `flags` | 라벨 창 | 영역 종류 | 라벨 판 16개(받침, 판, 창, 리벳) |
| 03 | `garbage` | 창 없는 블록 | 쓰레기 | 창 없는 블록, 숫자 지운 블록 |
| 04 | `live` | 창 달린 블록 | 살아 있는 객체와 나이 | A, B, C 블록과 옮겨지는 블록 사본 |
| 05 | `boot` | 알갱이 컵 | 작은 객체 묶음 | 알갱이 컵과 옮겨지는 컵 사본 |
| 06 | `picker` | 피커 | GC 워커 1개 | 트럭, 손나사, 암, 멈춤쇠, 캐리지, 로드, 흡착 패드 |
| 07 | `gauge` | 높이 게이지 | 직전 나이표 누적 | 게이지 받침, 기둥, 캡, 앞면 창, 눈금, 기준 눈금, 떠오르는 표시 |
| 08 | `slider` | 임계 나이 슬라이더 | tenuring threshold | 눈금 띠, 가이드 레일, 멈춤쇠 2개, 슬라이더 |
| 09 | `counter` | 빈 영역 카운터 | free 영역 수 | 카운터 함, 창, 리셋 노브 |
| 10 | `cds` | 아카이브 판 | CDS 아카이브 힙 | 트레이 14, 15 위의 판 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, 바이트와 개수, 임계값은 `model.mjs`에서 읽는다. 바닥판, 줄 받침, 레일 기둥과 빔, 라벨판은 어느 묶음에도 넣지 않았다. 블록 칸은 담긴 것이 바뀔 때마다 `data-sel`이 바뀐다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 25개 상태 중 예: `GC(2) start | 628864 B > 524288 B | threshold 2`, `GC(2) promote A | 10 -> 0 Old | age 2`, `GC(2) end | Eden 5->0 | Survivor 1->1 | Old 2->3`. 끝 줄 형식은 로그의 `Eden regions: 5->0`과 같다
- 키보드: → 또는 Space = step 1회, Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 10개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- idle tour: trace 전체를 한 단계씩(할당 0.9초, pause 시작 1.5초, 복사 1.9초, pause 끝 1.3초, 사이 0.5초) 돌고, 끝에서 1.8초 쉰 다음 reset
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[23] (`GC(2) promote A | 10 -> 0 Old | age 2`). Eden 트레이 5개가 쓰레기와 원본으로 차 있고, 슬라이더는 2, A가 맨 뒤 왼쪽 Old 트레이에 막 앉은 모습이 정지 이미지에 남는다
- 강조(lit): 방금 움직인 부품 하나. 할당은 막 E가 된 라벨 창, pause 시작은 슬라이더, 복사는 옮겨진 사본, pause 끝은 카운터. entry에서는 다음 STEP이 E로 바꿀 트레이 13의 라벨 창

## 캡션

Amazon Corretto 21.0.1(OpenJDK 21.0.1+12 HotSpot, macOS arm64)의 G1이 `-Xms16m -Xmx16m -XX:ParallelGCThreads=1`로 합성 프로그램을 돌리며 남긴 `-Xlog:gc*` 로그를 한 단계씩 옮겼습니다. 트레이 16개는 1MB 영역이고 블록 하나는 256KB 배열 하나예요. 처음부터 Old인 두 트레이는 CDS 아카이브 힙입니다. 영역 번호, 블록 위치와 나이, 나이표 바이트, 임계값 15, 15, 2는 그 로그와 프로그램이 mark word에서 읽은 값이에요. 트레이 안 자리는 주소 순서만 따르고, 목적지가 다른 복사 사이의 순서는 그림에서 정했습니다. TLAB의 작은 객체는 알갱이 컵 하나(104544바이트)로만 그렸고, GC 감지용 32바이트 WeakReference는 나이표에만 들어 있어요. 동시 마킹, mixed GC, humongous 객체, remembered set과 card table, PLAB, 참조 처리, 여러 워커의 병렬 복사, Eden 크기를 정하는 pause 시간 예측은 그리지 않았습니다.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`, `jvm-g1-gc.html`, `jvm-g1-gc-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.

## 결정 기록 (오케스트레이터 없이 정한 것)

- `-XX:ParallelGCThreads=1`: 기본(워커 9개)으로 돌리면 복사 순서와 survivor 자리가 실행마다 달라지고, 한 번은 survivor 영역이 꽉 차 A가 나이 0으로 Old에 들어갔다(조기 승격). 워커를 하나로 묶어 실행을 결정적으로 만들었고, 그림의 피커 하나가 그 워커 하나다. 임계값 계산과 나이 규칙은 워커 수와 무관하다.
- 힙 16MB: 영역 크기가 에르고노믹 최솟값 1MB로 정해져 영역이 16개가 되고, 4 x 4 트레이로 그릴 수 있다.
- 블록 256 KiB: humongous 기준(영역 절반, 512 KiB)보다 작고 영역에 정확히 4개 들어간다. 블록 A, B, C는 각 구간에서 몇 번째로 할당하는지만 정했고, 나머지 위치와 나이는 모두 실측이다.
- 시나리오: A는 GC(0), GC(1)을 살아남아 나이 2가 되고, GC(2)에서 임계값이 2로 내려가 15번이 아니라 3번째 GC에서 Old로 간다. 임계값이 내려간 이유는 survivor 공간이 1영역뿐이라 희망 크기가 524288바이트이고, 나이 1과 2를 더한 628864바이트가 그것을 넘기 때문이다.
- 첫 Eden 영역 앞머리의 작은 객체(시작 객체)는 생략하지 않고 알갱이 컵으로 그렸다. 104544바이트가 나이표에 그대로 들어가고, 이것이 없으면 GC(2)의 임계값 계산을 설명할 수 없다.
- 영역 사이 복사 순서: 목적지 영역 안 순서는 주소로 확인했다. GC(1)에서 B가 A보다 앞 주소에 있어 워커가 keep 배열의 뒤 원소부터 꺼낸다고 보고, GC(2)의 C, B, A 순서도 그렇게 정했다. GC(2) 첫 복사가 Old로 갔다는 것은 로그의 `ALLOC(OLD)`가 `ALLOC(SURV)`보다 먼저 찍힌 것으로 확인했다.
