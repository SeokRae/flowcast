# 세이프포인트 신호 야드

## 대상

- 메커니즘: 세이프포인트. VM 스레드가 VM 작업 전에 모든 자바 스레드를 폴링 지점에서 멈추고(또는 이미 안전한 상태로 세고), 작업 뒤 풀어 준다
- 버전과 구현: Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64, G1. 소스는 openjdk/jdk21u 태그 `jdk-21.0.1+12`
- 대상 작업: 합성 프로그램 `truth/SafepointProbe.java`의 `System.gc()`가 요청한 `G1CollectFull` (전역 세이프포인트 VM 작업)
- 대상 스레드: `compiled`(C2 OSR 루프), `interp`(JIT 제외 루프), `native`(`System.in.read()`), `sleeper`(`Thread.sleep`), `waiter`(`Object.wait`)
- 크기: Figure (부품 40~80개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| 작업 이름 `G1CollectFull`, 요청자 main (tid 5123) | `-Xlog:vmthread=debug`: `Adding VM operation`, `Evaluating safepoint VM operation` | `truth/safepoint.log` |
| JavaThread 16개, `semaphore` wait barrier | `-Xlog:safepoint=debug`: `Safepoint synchronization initiated using semaphore wait barrier. (16 threads)` | `truth/safepoint.log` |
| `initial_running 1`, `page_trap_count 1` | `-Xlog:safepoint+stats` 표 | `truth/safepoint-stats.log` |
| Reaching 63834, Cleanup 3541, At safepoint 1960542, Total 2027917 ns (실행 1회) | `-Xlog:safepoint` info 줄과 stats 표 | `truth/safepoint.log`, `truth/safepoint-stats.log` |
| 검사에서 running으로 찍힌 스레드는 nid 0x6303(`compiled`) 하나, 두 번, 그 뒤 `found polling page loop exception` | `-Xlog:safepoint=trace` | `truth/safepoint.log` |
| 스레드 이름, nid, 순서, 자바 상태, 스택 (`FileInputStream.readBytes(Native Method)` 등) | `jcmd <pid> Thread.print` | `truth/threads.txt` |
| `compiledLoop`은 level 4 OSR, `interpretedLoop`은 JIT 제외 | `-XX:+PrintCompilation`, `-XX:CompileCommand=exclude` | `truth/compile.txt` |
| native와 blocked는 폴링 없이 safe | `safepoint.cpp` `safepoint_safe_with()` | `truth/hotspot-refs.md` (원문 대조: `check-source.mjs`) |
| arm은 `_state`를 `_synchronizing`으로 바꾸고 모든 스레드에 `arm_local_poll` | `safepoint.cpp` `arm_safepoint()` | `truth/hotspot-refs.md` |
| 1회차는 목록 전체, 그 뒤는 running만 `back_off` 하며 다시 검사 | `safepoint.cpp` `synchronize_threads()` | `truth/hotspot-refs.md` |
| 폴링에 걸린 스레드는 스스로 `_thread_blocked`가 되어 wait barrier에서 기다림 | `safepoint.cpp` `SafepointSynchronize::block()` | `truth/hotspot-refs.md` |
| 인터프리터는 branch 뒤 poll word를 확인하고, C2 루프는 polling page를 읽어 트랩됨 | `interp_masm_aarch64.cpp` `dispatch_base()`, `templateTable_aarch64.cpp` `branch()`, `aarch64.ad` `safePoint`, `safepointMechanism.cpp` `default_initialize()` | `truth/hotspot-refs.md` |
| native에서 돌아올 때와 blocked에서 풀릴 때 폴링 검사 | `interfaceSupport.inline.hpp` `transition_from_native`, `~ThreadBlockInVMPreprocess` | `truth/hotspot-refs.md` |
| 끝은 `_state`를 `_not_synchronized`로 바꾸고, TSS `restart()`, wait barrier `disarm` | `safepoint.cpp` `disarm_safepoint()` | `truth/hotspot-refs.md` |

모델: `model.mjs` (`node check.mjs` 통과). `check.mjs`는 위 로그를 직접 읽어 상수와 대조하고 오프라인으로 돈다. HotSpot 원문(GPLv2 + Classpath Exception)은 MIT인 이 저장소에 두지 않는다. `truth/hotspot-refs.md`에 고정 태그의 줄 범위 링크와 요약만 적고, 원문 대조는 `bash truth/fetch-hotspot.sh`로 임시 폴더에 받은 뒤 `node check-source.mjs`로 한다. 그림의 숫자는 모두 이 모듈에서 읽는다. 로그 재현은 `bash truth/run.sh <작업 폴더>`이고, 커밋한 로그는 그중 실행 1회다. 같은 조건으로 여섯 번 돌렸을 때 `initial_running 1`, `page_trap_count 1`은 매번 같았고, Reaching safepoint는 58000~117791 ns 사이에서 달라졌다.

판단 기록:

- interp가 첫 검사 전에 이미 멈췄다는 순서는 trace에서 읽었다. 1회차에 running으로 찍힌 스레드가 compiled뿐이므로 interp는 검사받을 때 이미 `_thread_blocked`였다. 루프 안에서 blocked가 되는 길은 `SafepointSynchronize::block()`뿐이다
- compiled의 2회차 검사(in_Java)는 이 실행의 trace에 찍힌 그대로다. 실행에 따라 1회차만 찍히기도 한다
- 그리지 않은 JavaThread 11개(main, Reference Handler, 컴파일러 스레드, Attach Listener 등)는 trace에 running으로 찍히지 않았으므로 첫 검사에서 모두 safe였다. 그래서 그림의 `safe n/5`와 로그의 `initial_running 1`이 모순되지 않는다
- 카탈로그 후보 "역마다 신호기가 있는 철도"를 다듬었다. 신호기 대신 트립 스톱(열차를 물리적으로 세우는 장치)을 썼고, 정지 판정을 하는 VM 스레드의 검사 캐리지, 판정 결과 깃발, VM 작업을 하는 갠트리 크레인을 더했다. 열차가 멈추는 것만으로는 "native와 blocked는 폴링 없이 safe"와 "VM 스레드가 세어야 끝난다"가 보이지 않기 때문이다

## 기계 매핑

한 문장: 신호소 레버를 당기면 다섯 선로의 트립 스톱이 한꺼번에 올라오고, 달리던 열차는 스톱 앞에서 멈추며, 검사 캐리지가 선로를 하나씩 보며 안전한 선로마다 깃발을 올리고, 깃발이 모두 서면 갠트리 크레인이 야드를 오가고, 레버를 되돌리면 스톱이 내려가 멈춘 열차가 다시 달린다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 신호소의 상태 레버 (홈, 1칸, 2칸) | `SafepointSynchronize::_state` (not_synchronized, synchronizing, synchronized) | `state.phase` |
| 트립 스톱 5개 (선로마다 하나, 한꺼번에 오르내림) | 스레드마다의 local poll (arm, disarm). 멈춘 열차를 붙잡는 것은 wait barrier | `state.armed` |
| 열차 compiled | C2 OSR 루프를 도는 스레드. 폴링 페이지 읽기가 트랩되어 멈춤 | `state.threads[0].at` |
| 열차 interp | 인터프리터 루프를 도는 스레드. branch 뒤 poll word 검사로 멈춤 | `state.threads[1].at` |
| 검사 캐리지와 포인터 | VM 스레드의 `examine_state_of_thread()` 한 번, 회차 | `state.looked`, `state.last.pass` |
| 깃발 5개 | `ThreadSafepointState::_safepoint_safe` | `state.threads[i].safe` |
| 갠트리 크레인 | VM 작업 `G1CollectFull` | `state.vmop` |

움직이는 부품은 전부 이 표에 있다. native 열차(차고 안), sleeper와 waiter 열차(고임목 앞)는 이 작업 내내 움직이지 않는다. 그게 이 그림의 요점이다(폴링 지점까지 가지 않아도 safe).

## 부품표

배치: x 방향으로 긴 판 위에 선로 다섯 줄이 뒤에서 앞으로 compiled, interp, native, sleeper, waiter 순서(= VM 스레드가 훑는 목록 순서)로 놓인다. 왼쪽 끝에 신호소, 그 오른쪽에 y 방향 검사 레일과 깃발 기둥 다섯 개, 선로 가운데쯤(x = 46)에 트립 스톱 다섯 개가 한 줄로 선다. native 선로의 스톱 왼쪽은 기둥과 보만 있는 열린 차고 틀이다(지붕판이 있으면 안의 열차와 뒤 선로가 가려진다). 야드 앞뒤 바깥에 크레인 레일 두 줄이 있고 갠트리 크레인이 오른쪽 끝에 서 있다. 모두 합쳐 약 90개다. 80개를 조금 넘는 것은 선로 다섯 줄의 반복 부품(레일, 스톱 홈, 스톱 날, 깃발) 때문이라 크기는 Figure로 둔다.

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 포함), 판 가장자리 홈, 모서리 나사 4개, 라벨판(규칙선 3줄, 나사 2개), 앞쪽 눈금 띠(선로 방향 눈금, 트립 스톱 위치가 0 눈금), 크레인 레일 2줄과 끝 멈춤쇠 4개 |
| 구조 | 선로 바닥 5개(침목 줄 포함), 레일 10줄, 스톱 홈 5개, 신호소(받침, 몸체, 지붕, 환기구, 창 5개, 레버 패널과 홈), 검사 레일과 끝 멈춤쇠 2개, 깃발 기둥 5개, 차고 틀(기둥 4개, 세로보 2개, 가로보 2개), 고임목 2개, 크레인 다리 2개, 크레인 끝 대차 2개 |
| 메커니즘 | 상태 레버 손잡이, 트립 스톱 날 5개, 열차 5대(대차 2개, 바퀴 테 4개, 하부 프레임, 몸체, 지붕, 창 줄, 앞 완충기 2개), 검사 캐리지(몸체, 포인터 팔, 포인터 끝), 깃발판 5개, 갠트리 빔과 트롤리 |
| 조작부 | 신호소 널링 노브, 검사 레일 손나사, 크레인 핸드휠 |
| 강조 대상 | 상태마다 하나: 레버(entry, arm, disarm), 멈추는 열차(block), 검사 캐리지(check), 갠트리 빔(VM 작업) |

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `box` | 신호소 | VM 스레드 | 받침, 몸체, 지붕, 창, 널링 노브 |
| 02 | `lever` | 상태 레버 | `_state` | 레버 패널, 홈, 눈금, 손잡이 |
| 03 | `stops` | 트립 스톱 | local poll과 wait barrier | 스톱 홈 5개, 스톱 날 5개 |
| 04 | `compiled` | 열차 compiled | C2 루프 | 열차 |
| 05 | `interp` | 열차 interp | 인터프리터 루프 | 열차 |
| 06 | `native` | 열차 native | `_thread_in_native` | 열차, 차고 틀 |
| 07 | `sleeper` | 열차 sleeper | `Thread.sleep` | 열차, 고임목 |
| 08 | `waiter` | 열차 waiter | `Object.wait` | 열차, 고임목 |
| 09 | `carriage` | 검사 캐리지 | `examine_state_of_thread()` | 검사 레일, 멈춤쇠, 손나사, 캐리지 |
| 10 | `flags` | 깃발 | `_safepoint_safe` | 깃발 기둥 5개, 깃발판 5개 |
| 11 | `crane` | 갠트리 크레인 | VM 작업 `G1CollectFull` | 다리, 대차, 빔, 트롤리, 핸드휠 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, 스레드 수, 시간, 작업 이름은 `model.mjs`에서 읽는다. 베이스, 선로 바닥과 레일, 크레인 레일은 어느 묶음에도 넣지 않았다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 13개 상태 순서대로 `entry | not_synchronized | safe 0/5`, `arm | synchronizing | safe 0/5`, `interp poll | blocked | safe 0/5`, `pass 1 compiled | in_Java | safe 0/5`, `pass 1 interp | blocked | safe 1/5`, `pass 1 native | in_native | safe 2/5`, `pass 1 sleeper | blocked | safe 3/5`, `pass 1 waiter | blocked | safe 4/5`, `pass 2 compiled | in_Java | safe 4/5`, `compiled trap | blocked | safe 4/5`, `pass 3 compiled | blocked | safe 5/5`, `G1CollectFull | synchronized | safe 5/5`, `disarm | not_synchronized | safe 0/5`
- 키보드: → 또는 Space = step 1회, Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 11개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- idle tour: 동작 하나를 1초 동안 움직이고 1초 쉰다(VM 작업은 2.2초). disarm 뒤 2.6초 쉰 다음 처음 상태로 돌아간다(다시 달리던 열차는 사라졌다가 출발점에 다시 나타난다)
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[8] (`pass 2 compiled | in_Java | safe 4/5`). 스톱이 모두 서 있고, interp는 멈췄고, 깃발 넷이 섰는데 compiled만 아직 달리는 순간이 정지 이미지에 남는다
- 강조(lit): 방금 움직인 부품 하나. entry에서는 다음 STEP(arm)에서 움직일 상태 레버

## 캡션

Amazon Corretto 21.0.1(OpenJDK 21.0.1+12 HotSpot, macOS arm64)에서 System.gc()가 요청한 G1CollectFull 세이프포인트를 -Xlog:safepoint의 trace와 stats 로그 순서대로 한 동작씩 재생합니다. 이 실행의 JavaThread 16개 중 합성 프로그램의 스레드 5개만 그렸고, 나머지 11개는 첫 검사에서 이미 safe였어요. 시간은 기록한 실행 1회 값으로 Reaching safepoint 63834 ns, Cleanup 3541 ns, At safepoint 1960542 ns, Total 2027917 ns이며 실행마다 달라집니다. 스레드 로컬 핸드셰이크(JEP 312)로 처리하는 작업, VM 스레드의 back_off 대기, Threads_lock과 JNI critical 집계, cleanup 작업 내용, 트랩의 시그널 처리 경로, return poll과 스택 워터마크, G1 Full GC 자체의 동작은 그리지 않았어요.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`, `jvm-safepoint.html`, `jvm-safepoint-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.
