# HotSpot 소스 참조 (jdk-21.0.1+12)

모델이 기대는 정책 코드의 위치와, 그 줄이 하는 일을 우리 말로 요약한 기록이다. OpenJDK 소스(GPLv2 + CPE)의 원문은 이 저장소에 두지 않는다. 원문이 필요하면 `sh truth/fetch-hotspot.sh [dir]`로 임시 디렉터리에 내려받고, `node check-source.mjs [dir]`로 아래 조건이 그 자리에 있는지 확인한다.

- 저장소: openjdk/jdk21u
- 태그: `jdk-21.0.1+12` (태그 객체 `d4397127d8f20451382a8cc14b8f8dc0cb386ea9`, 커밋 `060c4f7589e7f13febd402f4dac3320f4c032b08`)
- 실행 JDK: Amazon Corretto 21.0.1.12.1 (`build 21.0.1+12-LTS`). 이 태그에서 빌드된 배포판이다. Corretto 자체 패치가 아래 파일을 바꿨는지는 대조하지 않았다. 실측 로그와 어긋나는 곳은 없었다
- `compiler/compilationPolicy.cpp`는 태그 `jdk-21.0.1-ga`에서도 바이트 단위로 같다
- 파일마다 SHA-256을 `truth/fetch-hotspot.sh`에 고정했다. 내려받은 파일이 다르면 스크립트가 멈춘다

아래 URL은 모두 `https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/` 아래 경로다. 수식에서 s는 임계값 배율(아래 `threshold_scale`의 k에, 메서드별 `CompileThresholdScaling` 옵션이 있으면 그 값을 곱한 것), i는 호출 수, b는 백엣지 수다.

## 전이 정책: `compiler/compilationPolicy.cpp`

| 위치 | 함수 | 하는 일 |
|---|---|---|
| [L228-L264](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L228-L264) | `LoopPredicate::apply_scaled`, `LoopPredicate::apply` | 루프(백엣지) 쪽 술어. tier 0과 2는 b ≥ `Tier3BackEdgeThreshold` × s, tier 3은 b ≥ `Tier4BackEdgeThreshold` × s. measure에는 루프가 없어 이 술어로는 올라가지 않는다 |
| [L266-L303](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L266-L303) | `CallPredicate::apply_scaled`, `CallPredicate::apply` | 호출 쪽 술어. tier 0과 2: i ≥ 200s 이거나, i ≥ 100s 이면서 i + b ≥ 2000s. tier 3: i ≥ 5000s 이거나, i ≥ 600s 이면서 i + b ≥ 15000s. 상수는 각각 `Tier3InvocationThreshold`, `Tier3MinInvocationThreshold`, `Tier3CompileThreshold`, `Tier4InvocationThreshold`, `Tier4MinInvocationThreshold`, `Tier4CompileThreshold`. `apply`는 현재 레벨에 맞는 k를 구해 `apply_scaled`에 넘긴다 |
| [L305-L324](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L305-L324) | `CompilationPolicy::threshold_scale` | k = (해당 레벨 컴파일 큐 길이) ÷ (`Tier3LoadFeedback` 또는 `Tier4LoadFeedback` × 그 레벨 컴파일러 스레드 수) + 1. C1 레벨이면 코드 캐시가 `IncreaseFirstTierCompileThresholdAt` 비율을 넘을 때 k를 더 키운다. 큐가 비어 있으면 k = 1이고, measure의 모든 사건이 그랬다(로그의 `k=1.00,1.00`) |
| [L432-L502](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L432-L502) | `CompilationPolicy::initialize` | `CICompilerCountPerCPU`이면 컴파일러 스레드 수 = max(⌊log2 CPU⌋ × ⌊log2 ⌊log2 CPU⌋⌋ × 3 / 2, 2). 코드 캐시에 컴파일러 버퍼가 다 들어가도록 상한을 둔다. 11 CPU에서 3 × 1 × 3 / 2 = 4(정수 나눗셈). 그중 C1 = max(⌊수 / 3⌋, 1) = 1, C2 = max(수 − C1, 1) = 3 |
| [L697-L708](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L697-L708) | `CompilationPolicy::reprofile` | 트랩이 난 범위의 메서드마다 MDO의 시작 카운터를 지금 값으로 다시 잡는다. 그 뒤 MDO 증분은 0부터 다시 쌓인다. 이번 실행에서는 불리지 않았다(로그의 `mdo=5248(0)`에서 시작값이 그대로 0) |
| [L981-L1017](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L981-L1017) | (`common` 앞 설명 주석) | 레벨 0은 인터프리터, 1은 프로파일 없는 C1, 2는 호출과 백엣지만 세는 C1, 3은 전체 프로파일 C1, 4는 C2라는 뜻과, 흔한 경로(0, 3, 4가 기본이고, C2가 밀리면 2를 거치며, deopt 뒤에는 0에서 바로 4로 갈 수 있다)를 설명한다 |
| [L1020-L1100](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L1020-L1100) | `CompilationPolicy::common<Predicate>` | 다음 레벨을 정한다. 단순 접근자는 1. 레벨 0이면 먼저 "지금 레벨 3이었다면 4로 갈 만큼 MDO 증분이 쌓였는가"를 같은 함수로 물어서, 그렇다면 바로 4를 고른다. 아니면 술어(레벨 0, i, b)가 참일 때 C2 큐 길이가 `Tier3DelayOn` × C2 스레드 수보다 길면 2, 아니면 3. 레벨 3이면 MDO 증분(`invocation_count_delta`, `backedge_count_delta`)으로 술어를 보고 참이면 4 |
| [L1105-L1122](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L1105-L1122) | `CompilationPolicy::call_event` | 호출 술어로 구한 레벨과 OSR 쪽 레벨 중 높은 쪽을 고른다(레벨 3에서 OSR 코드가 이미 4면 일반 진입도 4로 맞춘다). 오래 돈 메서드(`is_old`)는 큐 길이 피드백을 끈다 |
| [L1139-L1150](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compilationPolicy.cpp#L1139-L1150) | `CompilationPolicy::method_invocation_event` | 필요하면 MDO를 만들고, `call_event`가 고른 레벨이 지금과 다르며 이미 큐에 있지 않을 때만 컴파일을 요청한다. 모델의 `queued` 중복 방지가 이 조건이다 |

## 알림 간격

| 위치 | 함수 | 하는 일 |
|---|---|---|
| [oops/methodCounters.cpp L40-L46](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/oops/methodCounters.cpp#L40-L46) | `MethodCounters::MethodCounters` | 인터프리터의 호출 카운터 알림 마스크를 2^`Tier0InvokeNotifyFreqLog`(128)로 잡는다. 카운터가 128의 배수가 될 때마다 정책이 깨어난다 |
| [oops/methodData.cpp L1309-L1314](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/oops/methodData.cpp#L1309-L1314) | `MethodData::init` | MDO가 생긴 뒤 인터프리터가 쓰는 마스크도 같은 2^`Tier0InvokeNotifyFreqLog`. deopt 뒤 검사가 `mdo=5248`(128의 배수)에서 난 이유다 |
| [c1/c1_LIRGenerator.cpp L3236-L3245](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/c1/c1_LIRGenerator.cpp#L3236-L3245) | `LIRGenerator::increment_event_counter` | tier 3 코드는 2^`Tier3InvokeNotifyFreqLog`(1024)번마다 알린다(tier 2는 `Tier2InvokeNotifyFreqLog`). 그래서 tier 3 검사는 1024, 2048, ..., 5120에서 난다 |

## 트랩과 deopt: `runtime/deoptimization.cpp`, `oops/methodData.hpp`

| 위치 | 함수 | 하는 일 |
|---|---|---|
| [L2262-L2305](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/runtime/deoptimization.cpp#L2262-L2305) | `Deoptimization::uncommon_trap_inner` (action 분기) | `Action_maybe_recompile`은 지금 코드를 그대로 둔다. `Action_reinterpret`는 코드를 not entrant로 만들고 reprofile도 건다. `Action_make_not_entrant`는 바로 버린다 |
| [L2315-L2388](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/runtime/deoptimization.cpp#L2315-L2388) | `Deoptimization::uncommon_trap_inner` (트랩 기록 판단) | bci별로 기록하는 사유(class_check 포함)는 앞선 트랩이 있고 this_trap_count ≥ `PerBytecodeTrapLimit`(4)이면 not entrant로 바꾼다. 메서드 전체 한도(`PerMethodTrapLimit`)도 본다. 이미 재컴파일한 적이 있는 지점에서 다시 not entrant가 되면 그때 reprofile을 건다 |
| [L2390-L2440](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/runtime/deoptimization.cpp#L2390-L2440) | `Deoptimization::uncommon_trap_inner` (조치) | not entrant 처리와 재컴파일 기록, 재컴파일 횟수 한도(`PerBytecodeRecompilationCutoff`), reprofile 호출(`CompilationPolicy::reprofile`) |
| [L2453-L2535](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/runtime/deoptimization.cpp#L2453-L2535) | `Deoptimization::query_update_method_data` | 사유별 트랩 수를 MDO에서 하나 늘리고 그 값(this_trap_count)과, 앞선 트랩과 재컴파일이 있었는지를 돌려준다 |
| [oops/methodData.hpp L2007-L2018](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/oops/methodData.hpp#L2007-L2018) | `inc_trap_count` | 사유별 트랩 기록을 1 늘린다. 칸이 넘치면 따로 세는 넘침 카운터로 돌린다 |

## 플래그 기본값

| 위치 | 플래그 | 기본값 |
|---|---|---|
| [compiler/compiler_globals.hpp L141](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L141) | `Tier0InvokeNotifyFreqLog` | 7 |
| [L149](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L149) | `Tier3InvokeNotifyFreqLog` | 10 |
| [L179](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L179), [L184](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L184), [L188](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L188) | `Tier3InvocationThreshold`, `Tier3MinInvocationThreshold`, `Tier3CompileThreshold` | 200, 100, 2000 |
| [L197](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L197), [L202](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L202), [L206](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L206) | `Tier4InvocationThreshold`, `Tier4MinInvocationThreshold`, `Tier4CompileThreshold` | 5000, 600, 15000 |
| [L226](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L226) | `Tier3DelayOn` | 5 |
| [L251](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/compiler/compiler_globals.hpp#L251) | `TieredStopAtLevel` | 4 |
| [runtime/globals.hpp L1352](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/runtime/globals.hpp#L1352) | `TypeProfileWidth` | 2 |
| [runtime/globals.hpp L1376](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/runtime/globals.hpp#L1376) | `PerBytecodeTrapLimit` | 4 |
| [runtime/globals.hpp L921](https://github.com/openjdk/jdk21u/blob/jdk-21.0.1+12/src/hotspot/share/runtime/globals.hpp#L921) | `CICompilerCount` | 플랫폼 상수가 기본값이고, 실행 시 `initialize`가 CPU 수로 다시 정한다(이 기계에서 4, `truth/flags.txt`의 `{ergonomic}`) |

실행 값은 `truth/flags.txt`(PrintFlagsFinal)가 정본이고, `check.mjs`가 모델과 대조한다. 위 기본값은 `check-source.mjs`가 소스에서 다시 확인한다.
