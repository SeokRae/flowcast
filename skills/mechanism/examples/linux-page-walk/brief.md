# 4단 선반장과 카드 인덱스

## 대상

- 메커니즘: 가상 주소 변환. arm64 4 KiB 페이지, 48비트 VA를 9+9+9+9+12비트로 나누고, TLB에 변환이 없으면 MMU가 4단 페이지 테이블을 걸어 내려가며, 항목이 비어 있으면 page fault로 커널이 채운 뒤 같은 명령을 다시 실행한다
- 버전과 구현: Linux 7.0.14, Docker Desktop linuxkit 빌드(`7.0.14-linuxkit #1 SMP PREEMPT`), arm64, 11 vCPU. `CONFIG_ARM64_4K_PAGES=y`, `CONFIG_ARM64_VA_BITS=48`, `CONFIG_PGTABLE_LEVELS=4`, THP `[always]`. 소스 참조는 upstream stable 태그 `v7.0.14`(커밋 `458c6079fc1d`)이고, 측정은 linuxkit 빌드에서 했다(패치가 몇 개 더 있을 수 있다)
- 대상 코드: `truth/pagewalk-probe.c`. 4 MiB를 `PROT_NONE`으로 예약하고 그 안의 첫 2 MiB 경계에 257쪽짜리 익명 영역을 `MAP_FIXED`로 건 뒤 `MADV_NOHUGEPAGE`를 준다. 그 2 MiB 영역에는 다른 매핑이 없어 L3 테이블이 아직 없다. p0(영역의 첫 쪽)과 p1(256쪽 뒤)의 오프셋 `0x0a8`을 `read p0`, `write p0`, `write p1`, `read p1` 순서로 만진다. `setarch -R`로 주소를 고정했다
- 크기: Figure (부품 약 65개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| 페이지 4096바이트, VA 48비트, 4단, THP `[always]`, mTHP는 2048kB 말고 모두 `never` | `/proc/config.gz`, `getconf PAGESIZE`, sysfs | `truth/config.txt` |
| 단계별 시프트 39, 30, 21, 12와 항목 512개 | `pgtable-hwdef.h`의 `ARM64_HW_PGTABLE_LEVEL_SHIFT(n)` 식 (항목 8바이트, 단계당 9비트) | `truth/kernel-refs.md`, `check-source.mjs` |
| 리눅스 이름 pgd(p4d 접힘), pud, pmd, pte와 Arm 단계 0~3의 대응 | `pgtable-hwdef.h`, `pgtable-types.h`, `pgtable-nop4d.h` | `truth/kernel-refs.md` |
| p0 VA `0xfffff78000a8` = 색인 511, 511, 444, 0, 오프셋 `0x0a8`. p1 VA `0xfffff79000a8` = 511, 511, 444, 256 | 프로브 출력(같은 시프트로 계산), 모델 `split()`과 대조 | `truth/scenario.txt` |
| 접근별 minor fault 1, 1, 1, 0 | 프로브 안의 perf 소프트웨어 이벤트(`PERF_COUNT_SW_PAGE_FAULTS_MIN`), `getrusage`, `/proc/self/stat` 10번째 칸이 모두 같은 값 | `truth/scenario.txt` |
| 만지기 전 not present, 만진 뒤 present. read p0 = PFN `0x72553`(kpageflags ZERO_PAGE), write p0 = `0xbe291`, write p1 = `0xbe292`(ANON) | `/proc/self/pagemap`, `/proc/kpageflags` (privileged 실행 1회) | `truth/scenario.txt` |
| access 1에서 `__pte_alloc`, access 2에서 `do_wp_page`와 `vma_alloc_zeroed_movable_folio`, access 3에서 `vma_alloc_zeroed_movable_folio`. `__pud_alloc`, `__pmd_alloc`은 없음. access 1, 3의 스택에만 `do_translation_fault` | 자체 ftrace 인스턴스, function 트레이서 + `func_stack_trace`, `set_ftrace_pid`로 프로브만 | `truth/ftrace.txt` |
| 걷기가 멈춘 단계: access 1은 L2(빈 pmd), access 2는 L3 permission, access 3은 L3(빈 pte) | 위 ftrace의 할당 함수와 `fault_info` 표, `pud_alloc`, `pmd_alloc`, `pte_alloc`의 조건. ESR은 읽지 못했다(`do_mem_abort`는 kprobe 금지) | `truth/kernel-refs.md` |
| 읽기만 한 512쪽은 512 fault에 모두 같은 PFN `0x72553`, 쓰면 쪽마다 fault 1 | 대조 실험 | `truth/controls.txt` |
| `perf stat -e minor-faults`로 본 프로세스 전체: 512쪽을 만지면 중앙값 87에서 599로 512 늘어남 (각 5회) | `perf stat` | `truth/perf-touch.txt` |
| TLB에는 걷기에 성공한 변환만 둘 수 있고, 빈 항목이나 fault를 낸 항목은 두지 않으며, `TLBI`로 지운다 | Arm 아키텍처(DDI 0487 TLB 절)의 규칙, `do_anonymous_page`의 주석(전에 없던 항목이라 무효화 불필요), `ptep_clear_flush` | `truth/kernel-refs.md` |

모델: `model.mjs` (`node check.mjs` 통과). 그림의 숫자는 모두 이 모듈에서 읽는다. 커널 원문 대조는 `bash truth/fetch-kernel.sh && node check-source.mjs`. 측정은 `bash truth/run.sh`로 처음부터 다시 할 수 있다(PFN과 THP 대조 결과는 실행마다 달라질 수 있다).

측정하지 않은 것: TLB 적중과 실패. 이 VM에는 하드웨어 PMU가 없어 `dTLB-load-misses`를 셀 수 없다. 그래서 그림의 카드 인덱스는 아키텍처 규칙만 따르는 단순화다. 처음 만지는 쪽과 fault 뒤 재시도의 miss는 규칙상 확실하다(빈 항목은 캐시되지 않고, 복사 경로는 옛 항목을 지운다). 걷기에 성공한 결과는 카드로 남는다고 가정했고, 그래서 access 2의 첫 조회와 access 4는 hit로 그렸다. hit 비율 같은 숫자는 없다. 아키텍처 규칙은 Arm ARM 원문을 이번 작업에서 다시 읽지 않았고, 같은 규칙에 기대는 커널 쪽 근거(`do_anonymous_page`의 무효화 생략, `ptep_clear_flush`, `flush_tlb_page` 설명)로 뒷받침했다.

## 기계 매핑

한 문장: 주소 막대의 9비트 칸 네 개가 워커를 선반장의 L0부터 L3까지 한 단씩 그 칸 위치로 보내고, 카드가 없는 자리에서 깃발이 오르면 크레인(커널)이 창고에서 트레이나 카드를 가져와 꽂고, 워커가 처음부터 다시 걷는다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 주소 막대의 키 48개 (올라온 키 = 1), 칸막이로 9, 9, 9, 9, 12 | 가상 주소와 그 비트 분할 | `bitsOf(PAGES[page].va)`, `SHIFTS` |
| 주소 막대 색인 창 5개 | 단계별 색인과 오프셋 | `split(va)` |
| 주소 막대 왼쪽 끝 슬라이드 스위치 (앞 = 읽기, 뒤 = 쓰기) | 접근 종류 | `ACCESSES[i].op` |
| 카드 인덱스의 카드와 감지 빗 | TLB에 캐시된 변환, TLB 조회 | `state.tlb`, `last.kind == "tlb-*"` |
| 워커 캐리지(가로)와 헤드(세로), 탐침 | MMU의 테이블 걷기, 가로 위치 = 그 단계 색인, 높이 = 단계 | `state.at.stage`, `last.index` |
| 선반 L0~L3의 카드 (고리 카드 = 다음 테이블, 창 카드 = 페이지와 PFN, 자물쇠 = 읽기 전용) | 페이지 테이블 항목 | `state.tables[n]` |
| L3 트레이 (처음에는 없다) | L3 테이블(페이지 한 장) | `state.tables[3]` |
| 예외 깃발 | fault: MMU가 abort를 내고 커널로 넘어감 | `state.fault` |
| 크레인 트롤리, 호이스트, 훅 | 커널의 fault 처리(`do_anonymous_page`, `do_wp_page`) | `last.kind == "kernel"` |
| 창고의 빈 트레이 더미, 새 페이지 카드 탄창 | 페이지 할당(`__pte_alloc`, `vma_alloc_zeroed_movable_folio`) | `last.did` |
| zero page 꽂이 | 공용 zero page (할당하지 않고 읽기 전용으로 건다) | `PFN.zero` |

움직이지 않는 것: 선반장, 레일, 크레인 빔과 기둥, 창고 받침, 카드 인덱스 상자. 워커가 하드웨어, 크레인이 커널이다. 둘은 서로 다른 레일에 있고, 크레인은 fault 때만 움직인다.

## 부품표

배치: 뒷줄 왼쪽은 4단 선반장(아래가 L0, 맨 위가 열린 L3 칸), 오른쪽은 다리 넷 달린 창고 선반이고 그 윗면에 zero page 꽂이, 새 페이지 카드 탄창, 빈 트레이 더미가 크레인 빔 아래 한 줄로 놓인다(크레인은 x로만 움직이므로 집는 곳과 놓는 곳이 모두 빔 아래에 있다). 선반장 앞에는 워커 레일과 눈금 띠, 그 오른쪽 끝에 예외 깃발 기둥. 앞줄 왼쪽은 주소 막대, 오른쪽은 카드 인덱스.

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 포함), 판 가장자리 홈, 모서리 나사 4개, 라벨판(규칙선 3줄, 나사 2개), 워커 레일 앞 눈금 띠(512칸, 32칸마다 작은 눈금, 64칸마다 중간 눈금, 256칸마다 큰 눈금), 트레이 앞 테의 눈금(64칸마다), 크레인 기둥 받침 2개 |
| 구조 | 선반장 받침, 옆판 2개(이음선), 뒤판, 선반 4장(앞면 홈 포함), 옆판 나사, 워커 레일과 끝 멈추개 2개, 크레인 기둥 2개와 받침, 크레인 빔, 빔 끝 캡 2개, 창고 선반(다리 4개와 받침, 옆 버팀대 2개, 윗판, 깔판), 트레이 더미 안내 기둥 4개, 꽂이 상자 2개(앞 벽 포함), 카드 인덱스 상자(바닥, 벽 4개, 카드 홈), 주소 막대 몸체와 끝 캡, 키 홈, 깃발 기둥과 받침, 기둥 꼭지 |
| 메커니즘 | 주소 키 48개, 칸막이 4개, 색인 창 5개, 읽기/쓰기 슬라이드 스위치, TLB 감지 빗과 안내 기둥 2개, TLB 카드 2장(자물쇠 덮개 포함), 워커 캐리지, 마스트, 헤드, 탐침, 예외 깃발, 크레인 트롤리, 호이스트 드럼, 호이스트 줄, 훅, 표 카드 3장(L0, L1, L2), 선반 트레이 3장(앞 테 눈금 포함), L3 트레이, L3 카드 2장과 나르는 카드 1장(자물쇠 덮개 포함), 빈 트레이 더미 3장, 새 페이지 카드 탄창(카드 3장, 누름판), zero page 판(PFN 창)과 카드 꽂이(카드 2장) |
| 조작부 | 주소 막대 이송 노브, 카드 인덱스 크랭크 노브, 워커 캐리지 손나사, 크레인 트롤리 손나사 |
| 강조 대상 | 지금 움직이는 부품 하나(감지 빗, 맞은 TLB 카드, 워커 헤드, 깃발, 크레인이 나르는 트레이나 카드) |

## 부품 목록 (호버 설명)

| 번호 | id | 이름 | 개념 | 감싸는 부품 |
|---|---|---|---|---|
| 01 | `va` | 주소 막대 | 가상 주소 48비트 | 몸체, 키 48개, 칸막이, 색인 창 5개, 스위치, 이송 노브 |
| 02 | `tlb` | 카드 인덱스 | TLB | 상자, 칸막이, 카드, 감지 빗, 안내 기둥, 크랭크 |
| 03 | `walker` | 워커 | MMU의 테이블 걷기 | 레일, 끝 멈추개, 캐리지, 마스트, 헤드, 탐침, 눈금 띠 |
| 04 | `l0` | L0 단 | pgd (p4d 접힘) | 맨 아래 선반과 카드 |
| 05 | `l1` | L1 단 | pud | 둘째 선반과 카드 |
| 06 | `l2` | L2 단 | pmd | 셋째 선반과 카드 |
| 07 | `l3` | L3 단 | pte | 맨 위 칸, L3 트레이와 카드 |
| 08 | `flag` | 예외 깃발 | page fault (abort) | 깃발 기둥과 깃발 |
| 09 | `crane` | 크레인 | 커널의 fault 처리 | 기둥, 빔, 트롤리, 호이스트 줄, 훅 |
| 10 | `store` | 창고 | 페이지 할당 | 창고 선반, 깔판, 빈 트레이 더미와 안내 기둥, 새 페이지 카드 탄창 |
| 11 | `zero` | zero page 꽂이 | 공용 zero page | 판, 카드 꽂이 |

설명 문장은 `build.mjs`의 `PARTS`에 있고, 색인, PFN, 시프트, fault 수는 `model.mjs`에서 읽는다. 바닥판, 선반장 옆판과 뒤판은 어느 묶음에도 넣지 않았다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 31개 상태, 예: `read p0 | entry | faults 0`, `read p0 | L2[444] empty, translation fault | faults 0`, `read p0 | kernel: new L3 table | faults 0`, `write p0 | TLB hit ro, permission fault | faults 1`, `read p1 | TLB hit, PA 0xbe2920a8 | faults 3`
- 키보드: → 또는 Space = step 1회, Home = reset
- 포인터: click = step 1회, hover = 부품 선택(그 묶음만 밝아지고 설명 줄이 바뀐다)
- 부품 목록: 그림 아래 번호 버튼 11개. 호버, 포커스, 탭으로 고른다. 고르는 동안 idle tour를 멈추고, 풀면 6초 뒤 다시 돈다
- idle tour: trace 전체를 한 칸씩 돈다. 전이 시간은 TLB 조회 0.8초, 걷기 0.75초, 커널 2.2초이고 STEP 사이에 0.55초 쉰다. 끝에서 1.6초 더 쉰 다음 reset
- 검증 훅: `window.mechanism = { reset(), step(), readout(), pick(id) }`
- 첫 화면 상태: trace[4] (`read p0 | L2[444] empty, translation fault | faults 0`). 워커가 빈 L2 칸 앞에 서고 깃발이 오른 모습, L3 칸이 비어 있는 모습이 정지 이미지에 남는다
- 강조(lit): 방금 움직인 부품 하나. entry에서는 다음 STEP(TLB 조회)이 움직일 감지 빗

## 캡션

Linux 7.0.14(linuxkit, arm64, 4 KiB 페이지, 48비트 VA, 4단)에서 프로브가 만진 네 번의 접근을 그대로 다시 돌려요. 주소 분할(39, 30, 21, 12)은 커널 v7.0.14의 `pgtable-hwdef.h` 식이고, 접근마다 minor fault 1, 1, 1, 0과 PFN은 perf, getrusage, pagemap으로 한 번 실행해 기록한 값입니다. 처음 읽은 쪽은 공용 zero page(PFN 0x72553)에 읽기 전용으로 걸리고, 같은 쪽에 쓰면 fault가 한 번 더 나요. 이 VM에는 PMU가 없어 TLB 적중과 실패는 재지 못했고, 카드 인덱스는 아키텍처 규칙에 따른 단순화입니다(걷기에 성공한 결과는 남는다고 가정). huge page와 mTHP, contiguous 비트, walk cache, ASID, access flag와 dirty 비트 관리, 드물게 생기는 중복 fault, 스왑과 파일 매핑, 같은 테이블의 다른 항목(라이브러리, 스택 같은 다른 매핑), 테이블들의 물리 주소는 그리지 않았어요.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다. `pick(id)`는 부품 목록의 묶음 하나를 고르고 설명 줄 문자열을 돌려준다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`, `linux-page-walk.html`, `linux-page-walk-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.

## 판단 기록

- TLB를 남긴 이유: 고정된 메커니즘 문장이 "TLB에 변환이 없으면 걷는다"이고, 카드 인덱스가 없으면 재시도 때 왜 다시 걷는지(빈 항목은 캐시되지 않는다)와 access 4가 왜 fault 없이 끝나는지 보여 줄 부품이 없다. 대신 리드아웃의 `TLB hit`, `TLB miss`는 측정이 아니라 모델 규칙의 결과라고 캡션과 부품 설명에 적었다
- p1을 256쪽 뒤에 둔 이유: 선반 눈금은 512칸을 실제 비율로 그린다. p0 바로 다음 쪽(색인 1)이면 두 카드가 같은 자리에 겹친다
- 첫 접근이 L2에서 멈추게 한 이유: 예약한 2 MiB 영역에 다른 매핑이 없어서다. 흔한 설명(맨 아래 pte만 비어 있다)과 달리 첫 fault는 L3 테이블이 없는 경우가 많고, 커널은 그때 테이블과 페이지를 한 번의 fault에서 모두 만든다. access 3이 흔한 경우(L3 항목만 비어 있음)다
- zero page는 크레인이 창고(할당)가 아닌 꽂이에서 카드를 가져온다: access 1의 ftrace에는 할당 함수가 없고, 복사 경로(access 2)는 0으로 채운 새 페이지를 받는다(`vma_alloc_zeroed_movable_folio`, 복사할 내용이 없다)
- 표 카드(L0~L2)에는 숫자를 쓰지 않았다: 다음 테이블의 물리 주소는 사용자 공간에서 읽을 수 없어 측정하지 않았다
- ftrace를 프로브 pid로 거르려고 컨테이너를 `--pid=host`로 띄웠다. 컨테이너 pid 네임스페이스 안의 번호는 ftrace가 거르는 번호와 다르다
