# JIT 계층 변속기

## 대상

- 메커니즘: 핫 메서드 하나가 계층 컴파일로 인터프리터(tier 0)에서 C1(tier 3), C2(tier 4)로 올라가고, C2의 타입 가정이 깨지면 deopt로 내려왔다가 다시 올라가는 과정
- 버전과 구현: Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot, `build 21.0.1+12-LTS`), macOS arm64, 11 CPU, 기본 계층 컴파일(`TieredCompilation`, `TieredStopAtLevel=4`). 정책 소스는 openjdk/jdk21u 태그 `jdk-21.0.1+12`
- 대상 코드: `static int measure(Shape s) { return s.area() + 1; }` (`truth/Tiers.java`). 1단계는 Square만, 2단계에 Circle 한 번, 3단계는 Square와 Circle을 번갈아 보낸다
- 관찰 조건: `-XX:CompileCommand=dontinline,Tiers::measure` 하나만 더했다. 호출하는 쪽 루프가 OSR 컴파일되며 measure를 인라인하면 measure 자신의 카운터와 nmethod가 로그에서 사라지기 때문이다. 임계값과 정책 플래그는 모두 기본값이다
- 크기: Figure (부품표 약 70개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| `Tier3InvocationThreshold=200`, `Tier3MinInvocationThreshold=100`, `Tier3CompileThreshold=2000`, `Tier4InvocationThreshold=5000`, `Tier4MinInvocationThreshold=600`, `Tier4CompileThreshold=15000`, `CompileThresholdScaling=1.0` | `java -XX:+PrintFlagsFinal -version` | `truth/flags.txt` |
| 알림 간격 `Tier0InvokeNotifyFreqLog=7`(128번), `Tier3InvokeNotifyFreqLog=10`(1024번) | PrintFlagsFinal, `MethodCounters`와 `MethodData`의 `_invoke_mask`, `LIRGenerator::increment_event_counter` | `truth/flags.txt`, `truth/hotspot-refs.md` |
| 전이 술어: tier 0은 `i >= 200` 또는 (`i >= 100`이고 `i + b >= 2000`), tier 3은 MDO 증분으로 `i >= 5000` 또는 (`i >= 600`이고 `i + b >= 15000`) | `CallPredicate::apply_scaled`, `CompilationPolicy::common` | `truth/hotspot-refs.md` |
| tier 0에서 MDO가 이미 익었으면 C1을 건너뛰고 tier 4 (레벨 0의 판단이 먼저 "지금 레벨 3이었다면 4로 갈 만큼 MDO 증분이 쌓였는가"를 묻는다) | `CompilationPolicy::common`의 `CompLevel_none` 갈래 | `truth/hotspot-refs.md` |
| 임계값 배율 k = 1 (큐가 비어 있음) | `threshold_scale`, 로그의 `queues=0,0 k=1.00,1.00` | `truth/print-tiered.txt` |
| `CICompilerCount=4`는 C1 스레드 1개, C2 스레드 3개 | PrintFlagsFinal(ergonomic), `CompilationPolicy::initialize` | `truth/flags.txt`, `truth/hotspot-refs.md` |
| 검사 사건 8번과 그때 읽은 카운터(`total=128`, `256`, `mdo=1024` ~ `5120`, deopt 뒤 `mdo=5248`), 요청 레벨 3, 4, 4 | `-XX:+PrintTieredEvents` (4회 실행 모두 같은 순서와 값) | `truth/print-tiered.txt` |
| tier 3 nmethod는 tier 4 설치 때 made not entrant, tier 4는 네 번째 `class_check maybe_recompile` 트랩 뒤 made not entrant | `-XX:+PrintCompilation`, `-Xlog:deoptimization=debug` | `truth/print-tiered.txt` |
| `maybe_recompile`은 코드를 두다가 `this_trap_count >= PerBytecodeTrapLimit(4)`에서 make_not_entrant, 첫 재컴파일이라 reprofile 없음 | `Deoptimization::uncommon_trap_inner` | `truth/hotspot-refs.md` |
| 첫 C2는 `TypeProfile (5200/5200 counts) = Tiers$Square`만 인라인, 재컴파일은 Square와 Circle 둘 다 | `-XX:+PrintInlining` | `truth/print-inlining.txt` |
| `TypeProfileWidth=2` | PrintFlagsFinal | `truth/flags.txt` |

모델: `model.mjs` (`node check.mjs` 통과). `check.mjs`는 플래그 파일과 두 로그를 직접 읽어 모델의 사건 순서, 요청 레벨, 설치 레벨, made not entrant 순서, 트랩 수, 인라인 타입을 대조한다. HotSpot 소스 원문(GPLv2 + CPE)은 MIT인 이 저장소에 두지 않는다. `truth/hotspot-refs.md`에 고정 태그 URL과 줄 범위, 우리 말 요약만 두고, `sh truth/fetch-hotspot.sh [dir]`로 저장소 밖 임시 디렉터리에 내려받아 `node check-source.mjs [dir]`로 모델이 기대는 조건(전이 술어, 레벨 0에서 4로 가는 갈래, `PerBytecodeTrapLimit` 비교, 컴파일러 스레드 분배, 알림 마스크, 플래그 기본값)이 그 자리에 있는지 확인한다. 그림의 숫자는 모두 이 모듈에서 읽는다.

정직성 제약: 정책은 호출마다가 아니라 카운터가 알림 간격을 채울 때만 깨어나므로 결정은 128이나 1024의 배수에서 난다(200 위 첫 배수 256, 5000 위 첫 배수 5120). 반면 컴파일은 백그라운드라서 요청 뒤 몇 번째 호출에서 새 코드가 설치되는지는 실행마다 다르다. 모델과 리드아웃은 검사 때 읽은 값만 숫자로 보여주고, 설치 사건에는 호출 수를 붙이지 않는다.

## 기계 매핑

한 문장: 변속 레버가 놓인 칸의 코드가 다음 호출을 받고, 카운터 게이지가 정해진 간격마다 읽은 값이 임계값 눈금을 넘을 때만 컴파일 티켓이 C1이나 C2 스테이션으로 가며, 티켓이 소화된 뒤에야 레버가 올라가고, C2 코드가 게이트로 막아 둔 트랙에서 원형 퍽(Circle 수신자)이 걸려 트레이에 네 개 쌓이면 레버가 0으로 떨어진다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 변속 레버 (변속 슬롯 칸 0~4) | 다음 호출을 처리하는 코드의 tier | `state.tier` |
| 게이지 바늘 | 마지막 검사가 읽은 카운터 / 그 tier의 임계값 | `gauge(state)` = `state.reading.count / state.reading.threshold` |
| 게이지 위 창, 아래 창 | 마지막 검사가 읽은 값, 다음 검사가 대는 임계값 | `state.reading`, `nextThreshold(state)` |
| 컴파일 티켓 (창에 레벨 숫자) | 큐에 들어간 컴파일 요청 | `state.queued` |
| 게이트 (내려옴 = 막음) | 설치된 C2 코드가 Circle을 트랩으로 보내는가 | `state.accepts` |
| 원형 퍽 (트랙을 따라 와서 게이트에 걸림) | 가정을 깨는 Circle 수신자 호출 하나 | `state.last.kind == "trap"` |
| 트레이에 쌓인 퍽 | bci 1의 class_check 트랩 수 | `state.traps` |

값은 게이지의 두 창과 티켓 창, 변속 슬롯 눈금 숫자(각인 하나)로만 보여준다. 그 밖의 글자는 그림에 넣지 않는다.

## 부품표

배치: 뒷줄은 왼쪽부터 카운터 게이지, 티켓 디스펜서, C1 스테이션, C2 스테이션이고, 그 앞을 티켓 레일 하나가 가로지른다. 앞줄은 왼쪽에 변속기 하우징과 변속 슬롯, 오른쪽에 수신자 템플릿 상자(뚜껑에 구멍 2개와 원형 퍽 트랙, 트랙을 가로지르는 게이트, 앞에 트랩 트레이)가 있다. 퍽을 위에서 떨어뜨리는 드로퍼를 먼저 세웠다가, 그 기둥이 C2 투입구 앞 티켓을 가려 수평 트랙과 게이트로 바꿨다. 모두 합쳐 약 70개다.

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 4개 포함), 판 가장자리 홈, 모서리 나사 4개(링과 머리), 라벨판(규칙선 3줄, 나사 2개) |
| 구조 | 게이지 받침판, 게이지 기둥, 카운터 상자, 게이지 하우징과 베젤, 디스펜서(배출구), 티켓 레일, 레일 받침 3개, 레일 끝 스토퍼 2개, C1 몸체(투입구 1개, 통풍 슬롯 3개, 모터, 모터 캡), C2 몸체(투입구 3개, 통풍 슬롯, 스핀들 3개와 콜릿 3개), 변속기 하우징(뚜껑 이음선, 점검판과 나사 4개, 모서리 나사 4개), 변속 슬롯, 멈춤 홈 5개, 눈금 띠(눈금 5개, 각인 숫자), 템플릿 상자와 뚜껑(이음선, 점검판과 나사 2개, 모서리 나사 4개), 네모 구멍, 둥근 구멍, 트랙 뒤 레일, 트랙 앞 레일 두 토막(출구에서 끊김), 트랙 끝 블록, 게이트 프레임(기둥 2개, 가로대), 트레이(포켓 4개), 스테이션 옆면 통풍 슬롯과 나사 |
| 메커니즘 | 변속 레버(부트, 로드, 손잡이), 게이지 바늘과 중심 캡, 위 창과 아래 창 숫자, 컴파일 티켓(창), 게이트(당김 탭), 원형 퍽, 트레이 퍽 4개 |
| 조작부 | 게이지 영점 노브(널링), 변속기 브리더 캡(널링), 레일 클램프 손나사 |
| 강조 대상 | 방금 움직인 부품 하나(바늘, 티켓, 레버, 트레이에 떨어진 퍽 중 하나) |

움직이는 것: 레버(설치와 not entrant에서만), 바늘(검사에서만, 설치 때 0으로), 티켓(요청 때 디스펜서에서 스테이션 투입구 앞으로, 설치 때 투입구 안으로), 게이트(첫 C2 설치 때 내려오고 not entrant 때 올라감), 원형 퍽(트랩마다 트랙을 따라 게이트까지 와서 튕기고, 앞 레일 출구로 밀려 트레이 포켓으로 떨어진 뒤 다음 퍽이 트랙 끝에 나타남), 트레이 퍽(쌓임). 게이지 하우징, 스테이션, 템플릿 상자는 움직이지 않는다.

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `gauge` | 카운터 게이지 | 호출 카운터와 임계값 | 받침판, 기둥, 카운터 상자와 두 창, 하우징, 눈금, 바늘, 영점 노브 |
| 02 | `ticket` | 컴파일 티켓 | 컴파일 요청 | 디스펜서, 레일, 레일 받침과 스토퍼, 클램프 손나사, 티켓 |
| 03 | `c1` | C1 스테이션 | C1 컴파일러 스레드 | C1 몸체, 투입구, 통풍 슬롯, 모터 |
| 04 | `c2` | C2 스테이션 | C2 컴파일러 스레드 | C2 몸체, 투입구 3개, 통풍 슬롯, 스핀들 3개 |
| 05 | `lever` | 변속 레버 | 지금 tier | 변속기 하우징, 변속 슬롯, 멈춤 홈, 눈금 띠, 브리더 캡, 레버 |
| 06 | `template` | 수신자 템플릿 | bci 1의 수신자 타입 프로파일 | 템플릿 상자와 뚜껑, 네모 구멍, 둥근 구멍, 트랙 레일, 끝 블록, 게이트 프레임 |
| 07 | `gate` | 게이트 | C2 코드의 타입 가정 | 게이트, 당김 탭 |
| 08 | `puck` | 원형 퍽 | Circle 수신자 호출 | 트랙 위 원형 퍽 |
| 09 | `tray` | 트랩 트레이 | class_check 트랩 수 | 트레이, 포켓 4개, 트레이 퍽 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, 임계값, 알림 간격, 스레드 수, 트랩 한도, 프로파일 폭은 `model.mjs`에서 읽는다. 베이스와 라벨판은 어느 묶음에도 넣지 않았다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 16개 상태 순서대로 `tier 0 | entry | i 0`, `tier 0 | i 128 < 200 | stay`, `tier 0 | i 256 ≥ 200 | queue 3`, `tier 3 | C1 installed`, `tier 3 | mdo 1024 < 5000 | stay`, `tier 3 | mdo 2048 < 5000 | stay`, `tier 3 | mdo 3072 < 5000 | stay`, `tier 3 | mdo 4096 < 5000 | stay`, `tier 3 | mdo 5120 ≥ 5000 | queue 4`, `tier 4 | C2 installed | Square`, `tier 4 | trap 1/4 | keep code`, `tier 4 | trap 2/4 | keep code`, `tier 4 | trap 3/4 | keep code`, `tier 0 | trap 4/4 | not entrant`, `tier 0 | mdo 5248 ≥ 5000 | queue 4`, `tier 4 | C2 installed | Square+Circle`
- 키보드: → 또는 Space = step 1회(사건 하나), Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 9개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- idle tour: trace 끝까지 사건 하나씩(전이 0.9~1.5초, 사이 0.5초) 돌고, 마지막 설치 뒤 2초 쉰 다음 reset
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[8] (`tier 3 | mdo 5120 ≥ 5000 | queue 4`). 바늘이 임계 눈금을 넘었고 tier 4 티켓이 C2 투입구 앞에 있지만 레버는 아직 3에 있는 모습, 즉 요청과 설치가 다른 순간이라는 점이 정지 이미지에 남는다
- 강조(lit): 방금 움직인 부품 하나. 검사는 바늘(요청이 나왔으면 티켓), 설치와 not entrant는 레버, 1~3번째 트랩은 트레이에 떨어진 퍽. 트랩 전이 중에는 움직이는 퍽이 lit이고 끝나면 넘겨준다. entry에서는 다음 STEP(검사)이 움직일 바늘

## 캡션

Amazon Corretto 21.0.1(OpenJDK 21.0.1+12 HotSpot, macOS arm64)에서 Tiers.measure 하나가 기본 계층 컴파일로 tier 0, 3, 4를 오르고, Circle 수신자가 C2의 타입 가정을 네 번 깨면 tier 0으로 내려왔다가 프로파일이 이미 익어 C1 없이 tier 4로 돌아갑니다. 임계값 200과 5000, 검사 간격 128과 1024는 PrintFlagsFinal과 compilationPolicy.cpp에서, 사건 순서와 검사 때 읽은 카운터는 PrintTieredEvents 로그에서 그대로 가져왔어요. 컴파일은 백그라운드라 요청 뒤 몇 번째 호출에서 새 코드가 설치되는지는 실행마다 달라서 설치 장면에는 호출 수를 붙이지 않았습니다. tier 1과 2, OSR과 백엣지 카운터, 인라이닝(관찰하려고 measure만 dontinline으로 묶음), 큐 길이에 따른 임계값 배율(여기서는 1), 코드 캐시 압박, class_check 말고 다른 deopt 사유는 그리지 않았어요.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다). 회전체는 `k.cylinder`만 쓰고 `kit/lathe.mjs`, `kit/tube.mjs`는 쓰지 않는다.
6. 산출물: `build.mjs`, `jvm-jit-tiers.html`, `jvm-jit-tiers-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.
