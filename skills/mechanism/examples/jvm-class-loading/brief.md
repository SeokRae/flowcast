# 3층 서고와 승강기

## 대상

- 메커니즘: 클래스 로딩. JDK 21 내장 클래스 로더(Bootstrap, Platform, App)가 클래스 하나를 요청받았을 때 위임하고 적재하는 과정 (`BuiltinClassLoader.loadClassOrNull`의 판단 하나하나)
- 버전과 구현: Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64. 규칙은 같은 JDK의 `lib/src.zip` 소스, 결과는 같은 JDK의 실행 출력
- 대상 입력: `demo.Probe`가 `ClassLoader.getSystemClassLoader().loadClass(cn)`로 다섯 건을 차례로 요청한다. `java.time.Duration`(java.base, 부트), `java.sql.Types`(java.sql, 플랫폼), `demo.Greeter`(클래스 경로), `demo.Greeter` 다시, `demo.Missing`(없음)
- 크기: Figure (부품 40~80개, 아래 부품표 약 75개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| 로더 사슬 App → Platform → Boot, 부트 로더는 `getParent()`에서 null | `ClassLoaders` static 블록(`new AppClassLoader(PLATFORM_LOADER, ucp)`, `new PlatformClassLoader(BOOT_LOADER)`), Probe 출력 `app.parent: platform`, `platform.parent: null` | `truth/probe-out.txt` |
| 판단 순서: 이미 적재 확인, 패키지로 모듈 찾기, 모듈이 있으면 그 로더로 직행, 없으면 부모 다음 클래스 경로 | `BuiltinClassLoader.loadClassOrNull(String, boolean)` (src.zip 650행), `findLoadedModule`, `ClassLoaders$BootClassLoader.loadClassOrNull` | `model.mjs` 주석 |
| 요청마다 실제로 불린 로더 메서드와 반환값의 순서 | JDI 추적기(`truth/LoaderTrace.java`)가 `Probe.request()` 안의 메서드 반환과 예외를 기록 | `truth/loader-trace.txt` |
| 패키지 → 모듈 → 로더 (`java.time` → java.base @boot, `java.sql` → java.sql @platform, `demo` → 없음) | `BuiltinClassLoader.packageToModule` (리플렉션) | `truth/probe-out.txt` |
| 클래스 경로는 앱 로더에만 있다 | JDI: `platform hasClassPath() -> false`, `app hasClassPath() -> true` | `truth/loader-trace.txt` |
| 부트 레이어 모듈 수와 이름: boot 21, platform 22, app 19 | `ModuleLayer.boot().modules()`를 `getClassLoader()`로 묶음 | `truth/probe-out.txt` |
| 정의한 로더와 적재 출처 (`shared objects file`, `jrt:/java.sql`, `file:<work>/classes/`) | `getClassLoader()`, `-Xlog:class+load` | `truth/probe-out.txt` |
| 두 번째 `demo.Greeter`는 `findLoadedClass`에서 끝나고 새 적재 줄이 없다 | JDI 기록, 요청 전 `app.findLoadedClass: hit` | `truth/loader-trace.txt`, `truth/probe-out.txt` |
| `demo.Missing`은 `BuiltinClassLoader.loadClass`가 `ClassNotFoundException`을 던진다 | JDI 예외 기록, Probe 출력 | `truth/loader-trace.txt`, `truth/probe-out.txt` |
| 첫 요청 전 정의된 클래스: platform 0개, app 1개(`demo.Probe`) | `-Xlog:class+load=debug`의 loader 필드 | `truth/defined-before.txt` |
| 클래스 경로의 class 파일: `demo/Greeter.class`, `demo/Probe.class` | 컴파일 출력 디렉터리 목록 | `truth/classpath-listing.txt` |
| 실행 환경 | `java -version` (`Corretto-21.0.1.12.1`, `build 21.0.1+12-LTS`) | `truth/java-version.txt` |

재현: `JAVA_HOME=... truth/run.sh`가 `truth/`의 실행 출력 다섯 파일을 다시 만든다(작업 경로는 `<work>`로 바꾼다). 모델: `model.mjs` (`node check.mjs` 통과). 그림의 숫자와 순서는 모두 이 모듈에서 읽는다. `check.mjs`는 모델의 판단 순서를 JDI 기록과, 패키지 맵, 적재 여부, 정의한 로더, 적재 출처, 모듈 이름 목록을 Probe 출력과 대조한다.

## 기계 매핑

한 문장: 요청 카드를 실은 승강 칸이 지금 판단하는 로더의 층에 서고, 그 층에서 기록 서랍(findLoadedClass)을 열어 보고, 색인 기둥(packageToModule)의 깃발이 가리키는 층으로 곧장 가거나, 깃발이 바닥에 떨어지면 부모 층으로 한 층씩 올라갔다가 App 층의 클래스 경로 서랍으로 돌아온다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 승강 칸 (층 위치) | 지금 `loadClassOrNull`을 실행 중인 로더, 층을 오가는 이동 = 위임과 반환 | `state.at`, `state.last.op` (`delegate`, `parent`, `return`) |
| 칸 안의 요청 카드 | `loadClass(cn)` 요청 하나 | `state.cn`, `state.req` |
| 기록 서랍 2개 (App, Platform)와 그 안의 카드 | `findLoadedClass`: 이 로더가 이미 정의한 클래스 기록 | `state.defined.app`, `state.defined.platform` |
| 색인 기둥의 깃발 캐리지 | `findLoadedModule`: 패키지가 든 이름 있는 모듈을 정의한 로더. 지침판이 그 층 표지판을 가리키고, 바닥 표지판은 null, 기둥 꼭대기는 대기 | `state.flag` |
| 부트 금고 서랍 | `findBootstrapClassOrNull` (VM이 직접 찾는다) | `state.last.op == "findBootstrapClassOrNull"` |
| Platform 층의 java.sql 책 | `findClassInModuleOrNull`: 이 로더에 정의된 모듈에서 읽어 정의 | `state.last.op == "findClassInModuleOrNull"` |
| App 층의 클래스 경로 서랍 | `findClassOnClassPathOrNull` | `state.last.op == "findClassOnClassPathOrNull"` |
| Class 블록 | 찾은 `Class` 객체 (저장소에서 칸으로, 칸에서 호출자에게) | `state.carry`, `state.out` |
| 반환 트레이 | `loadClass`가 돌려준 `Class` | `state.out.loader` |
| 거절함 | `ClassNotFoundException` | `state.out.error` |

책 수는 그 층 로더가 정의한 부트 레이어 모듈 수(`MODULES`)이고 이름순으로 꽂는다. java.sql은 Platform 층 6번째 책이다. 그림에는 글자를 넣지 않는다. 층과 부품의 뜻은 부품 목록이 설명한다.

## 부품표

배치: 바닥판 위 받침에 앞이 열린 3층 서고가 서 있다(옆판 2장, 뒤벽, 지붕). 왼쪽 칸(승강로)에는 뒤벽의 가이드 레일 2개를 따라 승강 칸이 오르내리고, 지붕 위 권양기에서 케이블이 내려온다. 오른쪽 칸은 층판 3장(아래부터 App, Platform, Boot)이고 층마다 뒤쪽에 모듈 책, 앞쪽에 서랍장, 맨 앞 가장자리에 이송 레일이 있다. 서고 오른쪽 앞에는 색인 기둥이 서 있고 지침판이 오른쪽 옆판의 층 표지판을 가리킨다. 승강로 앞 바닥판 위에 반환 트레이와 거절함이 놓인다. 모두 합쳐 약 75개다.

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 4개 포함), 판 가장자리 홈, 모서리 나사 4개(링과 머리), 라벨판(규칙선 3줄, 나사 2개) |
| 구조 | 서고 받침(이음선, 리벳 6개), 왼쪽 옆판, 오른쪽 옆판(층판 이음선 6줄), 뒤벽(층마다 이음선과 리벳 4개), 층판 3장, 층 이름표 3개, 지붕판(홈, 나사 4개, 통풍 슬롯 6개), 권양기 받침판, 가이드 레일 2개(볼트 3개씩), 승강로 바닥 완충대, 이송 레일 3줄(롤러 점 13개씩), 층 표지판 3개(오른쪽 옆판), 없음 표지판(받침 오른쪽 면), 색인 기둥 받침, 색인 기둥, 머리 캡 |
| 메커니즘 | 승강 칸(바닥, 뒤벽, 앞 기둥, 낮은 난간, 크로스헤드, 가이드 슈 4개, 카드 받침, 케이블 걸이), 승강 케이블, 요청 카드, Class 블록, 기록 서랍장 2개(몸체, 서랍 앞판, 카드 꽂이, 손잡이, 열린 몸통, 기록 카드), 깃발 캐리지(슬리브, 지침판), 모듈 책 62권(boot 21, platform 22, app 19), java.sql 책, 부트 금고(몸체, 서랍), 클래스 경로 서랍장(몸체, 서랍, class 파일 카드 2장), Platform 층 덮개판(나사 4개), 반환 트레이(바닥, 테 4개), 거절함(바닥, 벽 4개) |
| 조작부 | 권양기(모터 몸체, 드럼, 크랭크 목, 널링 노브), 금고 다이얼(널링, 눈금), 깃발 캐리지 손나사 |
| 강조 대상 | 지금 움직이는 부품 하나 (요청 카드, 서랍 앞판, 깃발 캐리지, 승강 칸 뒤벽, Class 블록 중 하나) |

움직이는 것: 승강 칸(층 사이), 요청 카드(앞에서 칸으로, 칸에서 거절함으로), 기록 서랍(열림과 닫힘, 맞는 카드가 들림), 깃발 캐리지(색인 기둥을 따라), java.sql 책(앞으로 빠짐), 부트 금고 서랍, 클래스 경로 서랍, Class 블록(저장소에서 이송 레일을 타고 칸으로, 칸에서 반환 트레이로). 층판, 책장, 레일, 기둥은 움직이지 않는다.

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `car` | 승강 칸 | 지금 판단하는 로더 | 승강 칸 전체, 요청 카드, 케이블, 가이드 레일 2개, 권양기와 크랭크 |
| 02 | `register` | 기록 서랍 | `findLoadedClass` | App과 Platform 층의 서랍장 몸체, 서랍, 기록 카드 |
| 03 | `index` | 색인 기둥 | `packageToModule` | 기둥 받침, 기둥, 머리 캡, 깃발 캐리지, 없음 표지판 |
| 04 | `boot` | Boot 층 | 부트 로더 | Boot 층판, 층 이름표, 책 21권, 이송 레일, 층 표지판 |
| 05 | `vault` | 부트 금고 | `findBootstrapClassOrNull` | 금고 몸체, 서랍, 다이얼 |
| 06 | `platform` | Platform 층 | 플랫폼 로더 | Platform 층판, 층 이름표, 책 22권(java.sql 포함), 이송 레일, 덮개판, 층 표지판 |
| 07 | `app` | App 층 | 앱 로더 | App 층판, 층 이름표, 책 19권, 이송 레일, 층 표지판 |
| 08 | `classpath` | 클래스 경로 서랍 | `findClassOnClassPathOrNull` | 서랍장 몸체, 서랍, class 파일 카드 2장 |
| 09 | `out` | 반환 트레이 | `loadClass`의 반환값 | 트레이 |
| 10 | `reject` | 거절함 | `ClassNotFoundException` | 거절함 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, 모듈 수와 이름, 패키지 맵, 적재 출처는 `model.mjs`에서 읽는다. 바닥판, 서고 받침, 옆판, 뒤벽, 지붕판, Class 블록은 어느 묶음에도 넣지 않았다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 형식은 `요청 클래스 | 지금 판단하는 로더 | 판단이나 이동`. 예: `java.time.Duration | app | findLoadedModule → java.base @boot`, `demo.Greeter | platform | parent of app`, `demo.Greeter | app | null from platform (no class path)`, `demo.Missing | app | loadClass → ClassNotFoundException`. 43개 상태 전체는 `check.mjs`에 고정돼 있다
- 키보드: → 또는 Space = step 1회, Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 10개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- idle tour: trace 전체(요청 5건, 42 step)를 한 단계에 약 0.85초(전이 0.72초와 쉼 0.12초)로 돌고, ClassNotFoundException 뒤 1.6초 쉰 다음 reset
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[4] (`java.time.Duration | boot | findBootstrapClassOrNull → class`). 칸이 Platform 층을 건너뛰고 Boot 층에 선 모습이 정지 이미지에 남는다
- 강조(lit): 방금 움직인 부품 하나. 요청 시작은 요청 카드, `findLoadedClass`는 서랍(맞으면 Class 블록), `findLoadedModule`은 깃발 캐리지, 위임과 반환은 승강 칸, 저장소 탐색은 찾으면 Class 블록이고 못 찾으면 그 서랍, 끝은 반환 트레이의 Class 블록이나 거절함의 요청 카드. entry(trace[0])에서는 다음 STEP이 여는 App 층 기록 서랍

## 캡션

Amazon Corretto 21.0.1(OpenJDK 21.0.1+12 HotSpot, macOS arm64)에서 앱 클래스 로더에 클래스 다섯 건을 차례로 요청하고, JDI로 기록한 `BuiltinClassLoader.loadClassOrNull`의 판단 순서를 그대로 옮겼습니다. 패키지가 부트 레이어의 이름 있는 모듈에 있으면 칸은 그 모듈을 정의한 로더 층으로 바로 가고, 없을 때만 부모를 한 층씩 거쳐 App 층의 클래스 경로로 돌아와요. 링킹과 초기화, 정의 중에 VM이 다시 적재하는 상위 타입(`java.time.Duration`의 `TemporalAmount`, `java.sql.Types`를 정의할 때 플랫폼 로더로 다시 들어오는 `java.lang.Object` 요청), 부트 로더 안쪽의 VM 탐색, 클래스 이름별 잠금, 초기 로더(initiating loader) 기록, `Class.forName` 경로, 사용자 정의 로더와 모듈 레이어는 그리지 않았습니다.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`(필요하면 부품 모듈), `jvm-class-loading.html`, `jvm-class-loading-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.

## 결정 기록 (오케스트레이터 없이 정한 것)

- ② 3번 진실 출처: 소스 읽기만으로는 실제로 어느 로더가 불렸는지 증명할 수 없어서, JDI로 `Probe.request()` 구간의 로더 메서드 반환과 예외를 기록했다. 요청은 `Class.forName` 대신 `loadClass`로 했다. `Class.forName`은 VM이 초기 로더 기록을 먼저 보므로 자바 코드의 판단 순서가 가려진다.
- ② 4번 STEP: 판단 하나(`findLoadedClass`, `findLoadedModule`, 저장소 탐색 하나) 또는 로더 사이 이동 하나. 클래스 경로가 없는 Platform 로더가 부모의 null을 그대로 돌려주는 판단(`hasClassPath() -> false`)은 반환 이동과 한 STEP으로 묶었다. 그 STEP에서 움직이는 부품이 승강 칸 하나뿐이기 때문이다. 요청 카드를 넣는 일도 STEP 하나다.
- ② 5번 매핑: 카탈로그 후보(꼭대기까지 먼저 올라가고 한 층씩 내려옴)는 JDK 8의 부모 우선 위임이다. 21.0.1 소스와 JDI 기록에서는 `java.time.Duration`이 Platform 층을 거치지 않으므로 색인 기둥을 더해 직행을 그렸다.
- ② 7번 크기: Figure. 층 3개와 부품 약 75개로 Hero까지 키우지 않았다.
