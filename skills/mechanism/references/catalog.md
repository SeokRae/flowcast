# 메커니즘 매핑 카탈로그

질의 대본 5번의 출발점이다. 기계 후보는 제안일 뿐이고, 최종 매핑은 대상 버전과 진실 모델을 확정한 뒤 정한다. 리드아웃 칸은 `readout(state)`가 보여줄 값이고, 출처 칸은 `check.mjs`가 대조할 1차 출처의 예다.

## Linux

| 메커니즘 | 기계 후보 | 움직임 = 의미 | 리드아웃 | 출처 예 |
|---|---|---|---|---|
| 시스템 콜 | 방탄유리 창구의 서류 서랍 | 다이얼(syscall 번호)을 맞춘 서랍을 밀어 넣음 = 사용자 모드에서 커널 모드로 전환, 처리 결과가 서랍으로 돌아옴 | syscall 번호, 반환값 | `strace -c`, `arch/x86/entry/syscalls/syscall_64.tbl` |
| 가상 주소 변환 | 앞에 회전식 카드 인덱스가 붙은 4단 서랍장 | 인덱스에 카드가 있으면 서랍장을 건너뜀 = TLB hit, 없으면 PGD, PUD, PMD, PTE 서랍을 차례로 엶 = page walk, 빈 서랍이면 크레인이 창고에서 가져옴 = page fault | VA 비트 분해(x86-64 4단계: 9+9+9+9+12), TLB 적중 여부, fault 수 | `getconf PAGESIZE`, `/proc/{pid}/maps`, `perf stat -e dTLB-load-misses` |
| 스케줄러 (CFS, 6.5 이하) | 태스크마다 기어비가 다른 적산계 + 선택 암 | 실행 중인 태스크의 계기만 돌고, 가중치가 낮을수록(nice가 클수록) 기어비가 커져 빨리 감김 = vruntime 가중 누적, 선택 암은 가장 작은 계기를 집음 | 태스크별 vruntime, 타임 슬라이스 | `kernel/sched/fair.c`, `kernel/sched/core.c`의 `sched_prio_to_weight` |
| 스케줄러 (EEVDF, 6.6 이상) | 위 기계 + 마감 시각 눈금자 | 자격(lag ≥ 0)이 있는 태스크 중 가상 마감이 가장 이른 것을 집음 | 태스크별 vruntime, lag, 가상 마감 | `kernel/sched/fair.c` (6.6 이상) |
| fork와 COW | 판 하나를 공유하는 인쇄기 두 대 | 두 팔이 같은 판을 읽기 전용으로 씀, 한쪽이 쓰려는 순간 그쪽 판만 새로 주조 = 쓰기 시점 페이지 복사 | 공유 페이지 수, 복사된 페이지 수 | `/proc/{pid}/smaps`의 `Shared_*`, `Private_*` |
| epoll | 램프가 달린 전화 교환대 | poll은 교환원이 잭을 하나씩 확인, epoll은 준비된 회선 램프만 켜지고 그 카드만 ready 트레이로 떨어짐 | 감시 fd 수, 깨어날 때 확인한 fd 수 | `fs/eventpoll.c`, `man 7 epoll` |

## JVM

| 메커니즘 | 기계 후보 | 움직임 = 의미 | 리드아웃 | 출처 예 |
|---|---|---|---|---|
| 바이트코드 실행 | 천공 테이프 리더 + 서랍 + 스택 튜브 | 테이프 한 칸 = opcode 한 바이트, 서랍 = 지역 변수 슬롯(`max_locals`), 튜브 높이 = `max_stack`, 프레스 = 산술 명령 | pc, opcode, 스택 내용 | `javap -c -v`, JVMS 6.5 (예제 `examples/jvm-bytecode/`) |
| 클래스 로딩 | 3층 서고와 승강기 | 요청 카드를 실은 승강 칸이 지금 판단하는 로더의 층에 선다. 층마다 기록 서랍(`findLoadedClass`)을 보고, 색인 기둥(`packageToModule`)이 가리키는 모듈의 로더 층으로 곧장 간다. 이름 있는 모듈에 없는 패키지만 부모 층으로 올라갔다가 App 층의 클래스 경로 서랍으로 돌아온다(JDK 9 이후. 꼭대기까지 올라갔다 한 층씩 내려오는 부모 우선은 JDK 8식 설명) | 요청 클래스, 지금 판단하는 로더, 판단 결과 | `BuiltinClassLoader.loadClassOrNull`(src.zip), JDI 추적, `-Xlog:class+load` (예제 `examples/jvm-class-loading/`) |
| JIT 계층 컴파일 | 호출 카운터가 달린 변속기 | 카운터는 알림 간격(128회, 1024회)마다 검사되고, 그때 임계값을 넘었으면 컴파일 요청이 큐에 들어감 = tier 0에서 3(C1), 다시 4(C2). 설치는 백그라운드에서 나중에 일어남. 타입 가정이 깨져 트랩이 한도를 넘으면 0으로 내려오고(deopt), 프로파일이 이미 있으면 C1을 건너뛰고 4로 바로 감 | 현재 tier, 검사 때 읽은 카운터(i 또는 mdo)와 임계값, 큐 길이 | `-XX:+PrintFlagsFinal`의 `Tier*Threshold`, `-XX:+PrintTieredEvents`, `-XX:+PrintCompilation`, jdk21u `compilationPolicy.cpp` (예제 `examples/jvm-jit-tiers/`) |
| 세대별 GC (G1) | 트레이 격자와 갠트리 피커 | 새 객체는 Eden 트레이에 쌓이고, young GC 때 피커가 살아 있는 객체만 Survivor로 옮기며 나이를 올림. 나이가 임계값 이상이면 Old로. 임계값은 pause마다 직전 나이표와 희망 survivor 크기로 다시 계산돼 15보다 작아질 수 있음. young GC는 collection set의 young 영역을 모두 비우고, 쓰레기가 많은 Old 영역부터 고르는 것은 mixed GC다 | 영역 종류별 수, 객체 나이, 임계값, 희망 survivor 크기 | `-Xlog:gc*`, `gc+age=trace`, `gc+region=trace`, `-XX:+PrintFlagsFinal`의 `MaxTenuringThreshold`, `TargetSurvivorRatio`, `G1HeapRegionSize` (예제 `examples/jvm-g1-gc/`) |
| 세이프포인트 | 신호소와 트립 스톱이 있는 철도 야드 | VM 스레드가 VM 작업 전에 레버를 당기면 모든 선로의 스톱이 올라오고, 자바 코드를 달리던 열차만 다음 폴링 지점에서 멈춤. native나 blocked 상태의 열차는 폴링 없이 safe로 세어지고, VM 스레드가 모두 세면 작업을 시작 | safe n/N, 처음에 달리던 스레드 수(`initial_running`), 폴링 트랩 수 | `-Xlog:safepoint=trace`, `-Xlog:safepoint+stats`, jdk21u `safepoint.cpp` (예제 `examples/jvm-safepoint/`) |

## 이 스킬에 맞지 않는 것

| 대상 | 이유 | 갈 곳 |
|---|---|---|
| 커널 서브시스템 지도, JVM 런타임 데이터 영역 지도 | 움직이는 부품이 없어 박스 그림이 된다 | `flowcast:component` |
| syscall 진입부터 반환까지의 호출 경로 | 시간순 요청과 응답이 핵심이다 | `flowcast:sequence` |
| happens-before 같은 메모리 모델 규칙 | 메커니즘보다 순서 규칙이다. 하드웨어 store buffer까지 내려가면 기계가 되지만 Hero 이상이다 | `flowcast:sequence` 또는 Hero로 별도 상의 |
| 정렬, 탐색 같은 순수 알고리즘의 상태 변화 | 상태를 그대로 보여주는 편이 정확하다 | `flowcast:state-loop` |
