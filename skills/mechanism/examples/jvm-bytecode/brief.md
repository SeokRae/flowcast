# 바이트코드 테이프 리더

## 대상

- 메커니즘: JVM 인터프리터가 메서드 하나의 바이트코드를 opcode 단위로 실행하는 과정 (오퍼랜드 스택, 지역 변수 슬롯, pc)
- 버전과 구현: javac 21.0.1, class file major 65, 실행 확인은 OpenJDK 21.0.1. 명세 수준(JVMS 6.5)의 의미만 그린다
- 대상 코드: `static int calc(int a, int b) { return (a + b) * 2; }`, 인자 `calc(3, 4)`
- 크기: Figure (부품 40~80개)

## 진실 출처

| 값 | 출처 | 원본 |
|---|---|---|
| `stack=2, locals=2, args_size=2` | `javap -c -v Calc.class` | `truth/javap-calc.txt` |
| 오프셋 0~5와 니모닉 6개 | `javap -c -v Calc.class` | `truth/javap-calc.txt` |
| opcode 바이트 `1a 1b 60 05 68 ac` | class 파일 Code 속성 원본 (`xxd`) | `truth/code-bytes.txt` |
| `iadd`, `imul`은 32비트 2의 보수로 감싼다 | JVMS 6.5, `java` 실측: `calc(2147483647, 1) = 0`, `calc(1 << 30, 0) = -2147483648` | `check.mjs` |
| `calc(3, 4) = 14` | `java` 실측 | `check.mjs` |

모델: `model.mjs` (`node check.mjs` 통과). 그림의 숫자는 모두 이 모듈에서 읽는다.

## 기계 매핑

한 문장: 천공 테이프가 한 칸 전진할 때마다 opcode 하나가 실행되고, 값 디스크가 지역 변수 서랍과 두 칸짜리 스택 튜브 사이를 오간다.

| 부품 | 개념 | 모델 필드 |
|---|---|---|
| 천공 테이프 6칸, 칸마다 8비트 구멍 열 (구멍 = 1) | 메서드의 Code 배열, 칸 하나 = opcode 바이트 하나 | `CODE[i].byte` |
| 리더 헤드와 칸을 가리키는 포인터 | pc | `state.pc`, `state.last.pc` |
| 지역 변수 서랍 2칸 (서랍 수 = `max_locals`) | locals[0] = a, locals[1] = b | `state.locals` |
| 스택 튜브, 디스크 두 장 높이 (높이 = `max_stack`) | 오퍼랜드 스택 | `state.stack` |
| 서랍에서 튜브로 디스크를 옮기는 픽업 암 | `iload_0`, `iload_1` | `state.moved.from == "local"` |
| 상수 디스크 호퍼 | `iconst_2` | `state.moved.from == "const"` |
| 튜브 위 프레스 (위 두 장을 눌러 한 장으로) | `iadd`, `imul` | `state.moved.operands` |
| 반환 슈트와 호출자 트레이 | `ireturn` | `state.returned` |
| 디스크 표면의 작은 표시창 | 그 슬롯이나 스택 칸의 int 값 | `state.locals`, `state.stack` |

값은 디스크에 붙은 작은 표시창(기계가 보여주는 글자)으로만 보여준다. 그 밖의 글자는 그림에 넣지 않는다.

## 부품표

배치: 앞줄은 테이프 베드와 리더 브리지, 뒷줄은 왼쪽부터 서랍장, 호퍼, 스택 튜브이고, 그 위를 갠트리 빔 하나가 가로지른다. 빔에는 캐리지가 둘 걸린다(왼쪽 픽업 암, 오른쪽 프레스). 반환 슈트는 튜브 앞쪽 아래에서 호출자 트레이로 내려간다. 모두 합쳐 약 70개다.

| 묶음 | 부품 |
|---|---|
| 베이스 | 바닥판, 발 4개(플랜지 4개 포함), 판 가장자리 홈, 모서리 나사 4개(링과 머리), 라벨판(규칙선 3줄, 나사 2개), 테이프 베드 앞 눈금 띠(칸 간격 눈금, 읽기 위치가 0 눈금), 갠트리 기둥 받침 2개 |
| 구조 | 갠트리 기둥 2개, 갠트리 빔(두 캐리지의 레일), 빔 끝 캡 2개, 테이프 베드, 테이프 가이드 2개(테이프가 그 밑으로 드나든다), 리더 브리지 기둥 2개와 가로대, 리더 헤드 블록, 서랍장 몸체, 호퍼 통과 다리 4개, 호퍼 공급 립과 받침 선반, 스택 튜브 받침판, 튜브 기둥 4개, 튜브 위 테 4개, 반환 슈트, 호출자 트레이 |
| 메커니즘 | 천공 테이프(6칸, 칸마다 8비트 구멍과 이송 구멍, 칸 경계선), 헤드의 포인터 날, 지역 변수 서랍 2개(바닥 상자, 앞판, 손잡이), 서랍 디스크 2장(`locals` 값), 호퍼 디스크(`iconst_2`의 값), 픽업 암(캐리지, 호이스트 줄, 그리퍼, 흡착 패드), 프레스(캐리지, 플런저 로드, 누름판), 스택 디스크 2칸, 디스크마다 표시창 |
| 조작부 | 테이프 이송 널링 노브, 리더 브리지 손나사, 갠트리 기둥 손나사 2개 |
| 강조 대상 | 지금 움직이는 디스크 하나(옮겨지는 디스크, 프레스가 만든 결과 디스크, 반환되는 디스크) |

움직이는 것: 테이프(한 STEP에 한 칸, 헤드 아래 칸 = `state.last.pc`, entry에서는 0번 칸 바로 앞), 픽업 암(서랍이나 호퍼에서 튜브로, iconst_2도 호퍼 디스크를 이 암이 옮긴다), 프레스, 옮겨지는 디스크, 스택 디스크(쌓이고 사라짐), 반환 디스크. 헤드, 서랍, 호퍼는 움직이지 않는다.

## 리드아웃과 상호작용

- 리드아웃: `readout(state)` 문자열 그대로. 7개 상태 순서대로 `pc 0 | entry | stack []`, `pc 0 | iload_0 | stack [3]`, `pc 1 | iload_1 | stack [3, 4]`, `pc 2 | iadd | stack [7]`, `pc 3 | iconst_2 | stack [7, 2]`, `pc 4 | imul | stack [14]`, `pc 5 | ireturn | returned 14`
- 키보드: → 또는 Space = step 1회, Home = reset
- 포인터: click = step 1회
- idle tour: trace 전체를 한 칸씩(약 0.9초 간격) 돌고, 반환 뒤 1.4초 쉰 다음 reset
- 검증 훅: `window.mechanism = { reset(), step(), readout() }`
- 첫 화면 상태: trace[2] (`pc 1 | iload_1 | stack [3, 4]`). 튜브가 `max_stack`까지 찬 모습이 정지 이미지에 남는다
- 강조(lit): 방금 움직인 디스크 하나. entry에서는 다음 STEP(`iload_0`)이 옮길 0번 서랍 디스크

## 캡션

javac 21.0.1이 컴파일한 `calc(3, 4)`의 바이트코드 6개를 한 칸씩 실행합니다. 튜브 높이와 서랍 수는 `javap -c -v`가 보여주는 `stack=2, locals=2` 그대로입니다. JIT 컴파일, 프레임 생성과 반환 주소, 예외 테이블, 다중 바이트 명령의 피연산자는 그리지 않았습니다.

## 고정 제약

1. `SKILL.md` ⑤를 따른다. 진실은 `model.mjs`로 확정됐다. 수치를 바꾸거나 모델 밖의 숫자를 그림에 쓰지 않는다. 매핑이 기계로 성립하지 않으면 그리기 전에 돌아온다.
2. kit는 `join(HERE, "../../vendor/anatomy")`에서 동적 import한다(`MECHANISM_KIT` 환경 변수로 바꿀 수 있다). 모델은 `inlineModel()`로 감싸 페이지에 인라인한다.
3. `window.mechanism` 검증 훅을 노출한다. `reset()`과 `step()`은 idle tour를 멈추고 `[data-readout]`을 동기로 갱신한다.
4. 출력 HTML은 self-contained다. 앞부분에 `<!-- anatomy kit v1.1.0 (vendored in flowcast), MIT, Copyright (c) 2026 Ryan -->`를 넣는다.
5. WebGL, 3D, React는 쓸 수 없다(이관하지 않았다).
6. 산출물: `build.mjs`(필요하면 부품 모듈), `jvm-bytecode.html`, `jvm-bytecode-light.html`. `node build.mjs`와 `node build.mjs --light`로 다시 만들 수 있어야 한다.
