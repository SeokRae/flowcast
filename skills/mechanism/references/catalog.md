# 메커니즘 매핑 카탈로그

질의 대본 5번의 출발점이다. 기계 후보는 제안일 뿐이고, 최종 매핑은 대상 버전과 진실 모델을 확정한 뒤 정한다. 리드아웃 칸은 `readout(state)`가 보여줄 값이고, 출처 칸은 `check.mjs`가 대조할 1차 출처의 예다.

## Linux

예제는 Docker Desktop VM의 Linux 7.0.14(linuxkit, arm64, 4K 페이지, 48비트 VA)에서 실측했다. 이 VM에는 하드웨어 PMU가 없어 perf 하드웨어 이벤트(TLB, 캐시)를 쓸 수 없다. tracefs와 debugfs는 VM 전체가 함께 쓰므로 ftrace는 자기 인스턴스(`instances/{name}`)에서만 켜고, `set_ftrace_pid`와 `set_event_pid`는 VM 전역 pid를 받으므로 컨테이너를 `--pid=host`로 띄운다.

| 메커니즘 | 기계 후보 | 움직임 = 의미 | 리드아웃 | 출처 예 |
|---|---|---|---|---|
| 시스템 콜 | 방탄유리 창구의 서랍과 카드 랙 | 손잡이를 밀면(`svc #0`) x8 카운터와 인자 칸을 실은 서랍이 셔터를 지나 커널로 들어감. 셔터(예외 벡터)는 번호와 무관하게 하나이고, 캐리지(`invoke_syscall`)가 길이 검사 뒤 표(`sys_call_table`)의 그 번호 칸 카드를 읽어 핸들러를 고름. 결과는 x0 창에 찍혀 돌아옴(실패면 음수 errno, 이를 errno와 -1로 바꾸는 것은 glibc). 표 안 빈 칸, 표 밖 번호, 설정에서 빠진 번호는 모두 -38(ENOSYS)이지만 가는 길이 다름 | 단계(load, svc, dispatch, return, eret), syscall 번호, 핸들러, x0 | `strace -n`(`-c`는 번호를 보여주지 않음), ftrace function tracer와 `func_stack_trace`. 표는 arm64가 `scripts/syscall.tbl`과 `arch/arm64/kernel/syscall.c`, x86-64가 `arch/x86/entry/syscalls/syscall_64.tbl` (예제 `examples/linux-syscall/`, arm64) |
| 가상 주소 변환 | 회전식 카드 인덱스(TLB)가 붙은 4단 선반과 크레인 | 주소 막대의 비트 필드가 워커(MMU)를 선반 단마다 보냄 = 하드웨어 page walk. 빈 칸이면 깃발이 오르고 크레인(커널)이 테이블이나 페이지를 가져온 뒤 워커가 처음부터 다시 걸음 = page fault. 빈 2 MiB 영역의 첫 fault는 L2에서 멈추고 커널이 L3 테이블과 페이지를 함께 만듦. 읽기만 하면 공용 zero page를 걸고, 나중에 쓰면 fault가 한 번 더 남 | 접근, 걷는 단과 색인, fault 수. VA 비트 분해는 arm64 4K 48비트와 x86-64 4단계 모두 9+9+9+9+12(arm64 L0~L3 = pgd, pud, pmd, pte, 4단에서 p4d는 접힘) | `/proc/self/pagemap`, `/proc/kpageflags`, perf 소프트웨어 이벤트 `minor-faults`, ftrace(`__pte_alloc`, `do_wp_page`), `arch/arm64/include/asm/pgtable-hwdef.h`. TLB 적중은 하드웨어 PMU가 있을 때만 `perf stat -e dTLB-load-misses`(Docker Desktop VM에는 없음) (예제 `examples/linux-page-walk/`, arm64) |
| 스케줄러 (CFS, 6.5 이하) | 태스크마다 기어비가 다른 적산계 + 선택 암 | 실행 중인 태스크의 계기만 돌고, 가중치가 낮을수록(nice가 클수록) 기어비가 커져 빨리 감김 = vruntime 가중 누적, 선택 암은 가장 작은 계기를 집음 | 태스크별 vruntime, 타임 슬라이스 | `kernel/sched/fair.c`, `kernel/sched/core.c`의 `sched_prio_to_weight` |
| 스케줄러 (EEVDF, 6.6 이상) | 레인마다 vruntime 캐리지와 지름이 1024/w배인 드럼, 무게중심 게이트(V), 마감 핀과 탐침 바 | 게이트(V) 뒤에 있는 캐리지의 마감 핀만 서고(lag ≥ 0), 탐침 바가 처음 닿는 서 있는 핀(자격 있는 것 중 가상 마감이 가장 이른 것)의 레인이 돎. 슬라이스는 가중치와 상관없이 같아서(7.0: 0.7 ms x (1 + ilog2(min(CPU 수, 8))), HZ 1000이면 틱 단위로 끝남) 가중치는 뽑히는 횟수로만 나타남. 도는 태스크는 자격을 잃어도 마감까지 계속 돌고(RUN_TO_PARITY), 같은 태스크가 다시 뽑히면 보호 없이 틱마다 결정을 받음 | 결정 번호, 뽑힌 태스크, 그 순간 자격 있는 태스크, V | `kernel/sched/fair.c`(7.0: `pick_eevdf`, `zero_vruntime`와 `sum_w_vruntime`를 쓰는 `vruntime_eligible`, `update_curr`, `set_protect_slice`), `/sys/kernel/debug/sched/debug`의 E/N과 deadline, `sched_switch` (예제 `examples/linux-eevdf/`) |
| fork와 COW | 판 줄을 사이에 둔 두 헤드 뱅크(부모, 자식 페이지 테이블)와 갠트리 캐리지 | fork 레버를 누르면 자식 헤드가 같은 판에 앉고 양쪽 깃발(쓰기 금지)이 모두 섬. 깃발 선 헤드가 쓰면 막히고(쓰기 금지 폴트), 캐리지가 판의 참조 수를 재서 1이면 깃발만 내리고(재사용, PFN 그대로) 아니면 빈 판에 내용을 옮겨 쓴 쪽에만 줌(복사). 참조 수는 mapcount가 아니라 folio refcount라서, 첫 쓰기를 한 CPU의 LRU 추가 배치에 남은 페이지는 혼자 매핑해도 복사됨 | 누가 몇 번 페이지를 썼나, 폴트와 처리(복사, 재사용, 폴트 없음), 옛 PFN → 새 PFN | `/proc/{pid}/pagemap`(PFN, 비트 56), `/proc/kpagecount`, `/proc/kpageflags`, `/proc/{pid}/smaps`(Private가 쓰기 가능을 뜻하지는 않음), `getrusage` minflt, ftrace `do_wp_page`, `copy_user_highpage`, `folio_move_anon_rmap`, `mm/memory.c`의 `wp_can_reuse_anon_folio` (예제 `examples/linux-fork-cow/`) |
| epoll | 드롭과 카드, ready 레인이 있는 교환대 | poll은 호출마다 모든 잭을 꽂고 임시 꼬리표를 걸었다가 걷음. epoll은 등록(`epoll_ctl`) 때 잭마다 영구 드롭(`ep_poll_callback`)을 걸고, 쓰기가 오면 그 잭의 카드가 ready 레인으로 떨어짐. `epoll_wait`는 레인에 선 카드의 잭만 다시 꽂아 확인함. LT 항목은 보고 뒤 레인 끝에 다시 서고, 다시 물어 0이 나올 때 빠짐(램프로는 순서와 재삽입이 보이지 않음) | 단계별 `pipe_poll` 횟수, 반환값과 보고된 fd | ftrace function tracer(`pipe_poll`, `ep_poll_callback`, `ep_send_events`, `__pollwait`), strace(arm64 glibc는 `ppoll`, `epoll_pwait`로 들어감), `fs/eventpoll.c`, `fs/select.c`, `fs/pipe.c`. 파이프는 `poll_usage` 때문에 ET에서도 write마다 발화함 (예제 `examples/linux-epoll/`) |

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
