# model.mjs 독립 대조 기록: jvm-bytecode

- 대상 버전: javac 21.0.1, class file major 65, 실행 확인은 OpenJDK 21.0.1 (Amazon Corretto 21.0.1). 의미는 JVMS Java SE 21 6.5절 수준
- 진실 출처:
  - truth/javap-calc.txt (javap -c -v Calc.class 출력)
  - truth/code-bytes.txt (class 파일 Code 속성 원본 바이트, xxd)
  - truth/Calc.java (컴파일한 소스)
  - JVMS Java SE 21 6.5절 iload_<n>, iconst_<i>, iadd, imul, ireturn: https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-6.html
  - java 21.0.1 실측 반환값 (truth/Calc.java를 컴파일해 다시 돌릴 수 있다)
- 대조자: mechanism-verifier (작성 맥락 없이 출처와 model.mjs만 읽음)

## 회차 1

- 일시: 2026-10-31 11:43
- model.mjs sha256: 448f1602f54250d7a914a43a553a93ff319913112ff07727105ad68da9eae2d1
- 판정: 통과

출처를 먼저 읽어 기대값을 만들고 나서 model.mjs를 열었습니다. 실측은 대상과 같은 도구(`javac 21.0.1`, `openjdk version "21.0.1"`, `Corretto-21.0.1.12.1`)로 truth/Calc.java를 `$TMP`에서 다시 컴파일해 얻었어요. JVMS 인용은 위 URL을 `$TMP/jvms-6.html`로 내려받아 태그를 벗긴 본문에서 직접 읽은 것입니다.

| ID | 분류 | 항목 | 모델 값 (위치) | 출처 근거 | 기대값 | 판정 |
|---|---|---|---|---|---|---|
| R1 | 버전 | 머리 주석의 컴파일러와 class 버전 | `javac 21.0.1 (class file major 65)` (model.mjs:1) | target 원문. 재실행 `javac -version` 결과 `javac 21.0.1`, `$TMP/probe/javap-full.txt:7` `major version: 65`, class 파일 머리 바이트 `cafebabe00000041` | javac 21.0.1, major 65 | 일치 |
| R2 | 버전 | 실측에 쓴 실행 도구 | 모델 표기 없음 (실측 근거의 전제) | 재실행 `java -version` 결과 `openjdk version "21.0.1" 2023-10-17 LTS`, `Corretto-21.0.1.12.1 (build 21.0.1+12-LTS)` | OpenJDK 21.0.1 (Corretto 21.0.1) | 일치 |
| R3 | 상수 | `SOURCE` | `static int calc(int a, int b) { return (a + b) * 2; }` (model.mjs:5) | truth/Calc.java:2-4 `static int calc(int a, int b) {` `return (a + b) * 2;` `}` | 같은 토큰열 (줄바꿈과 들여쓰기만 다름) | 일치 |
| R4 | 상수 | `MAX_STACK` | 2 (model.mjs:8, 근거 주석 model.mjs:7) | truth/javap-calc.txt:5 `stack=2, locals=2, args_size=2`. 재컴파일 class 파일 Code 속성 max_stack `0002` | 2 | 일치 |
| R5 | 상수 | `MAX_LOCALS` | 2 (model.mjs:9) | truth/javap-calc.txt:5 `locals=2`. 재컴파일 class 파일 max_locals `0002` | 2 | 일치 |
| R6 | 상수 | `CODE` 길이와 pc 오프셋 | 6개, pc 0, 1, 2, 3, 4, 5 (model.mjs:12-19) | truth/javap-calc.txt:6-11 `0:` ~ `5:`. 재컴파일 class 파일 code_length `00000006` | 6개, 0~5 연속 | 일치 |
| R7 | 상수 | `CODE[0]` | pc 0, `0x1a`, `iload_0` (model.mjs:13) | truth/javap-calc.txt:6 `0: iload_0`, truth/code-bytes.txt:1 1번째 바이트 `1a`, JVMS#jvms-6.5.iload_n `iload_0 = 26 (0x1a)` | 0x1a iload_0 | 일치 |
| R8 | 상수 | `CODE[1]` | pc 1, `0x1b`, `iload_1` (model.mjs:14) | truth/javap-calc.txt:7 `1: iload_1`, truth/code-bytes.txt:1 2번째 바이트 `1b`, JVMS#jvms-6.5.iload_n `iload_1 = 27 (0x1b)` | 0x1b iload_1 | 일치 |
| R9 | 상수 | `CODE[2]` | pc 2, `0x60`, `iadd` (model.mjs:15) | truth/javap-calc.txt:8 `2: iadd`, truth/code-bytes.txt:1 3번째 바이트 `60`, JVMS#jvms-6.5.iadd `iadd = 96 (0x60)` | 0x60 iadd | 일치 |
| R10 | 상수 | `CODE[3]` | pc 3, `0x05`, `iconst_2` (model.mjs:16) | truth/javap-calc.txt:9 `3: iconst_2`, truth/code-bytes.txt:1 4번째 바이트 `05`, JVMS#jvms-6.5.iconst_i `iconst_2 = 5 (0x5)` | 0x05 iconst_2 | 일치 |
| R11 | 상수 | `CODE[4]` | pc 4, `0x68`, `imul` (model.mjs:17) | truth/javap-calc.txt:10 `4: imul`, truth/code-bytes.txt:1 5번째 바이트 `68`, JVMS#jvms-6.5.imul `imul = 104 (0x68)` | 0x68 imul | 일치 |
| R12 | 상수 | `CODE[5]` | pc 5, `0xac`, `ireturn` (model.mjs:18) | truth/javap-calc.txt:11 `5: ireturn`, truth/code-bytes.txt:1 6번째 바이트 `ac`, JVMS#jvms-6.5.ireturn `ireturn = 172 (0xac)` | 0xac ireturn | 일치 |
| R13 | 상수 | 바이트 근거 주석 | `xxd: 1a 1b 60 05 68 ac` (model.mjs:11) | truth/code-bytes.txt:1 `1a1b600568ac`. 재컴파일 class 파일에 `0002 0002 00000006 1a1b600568ac` 그대로 있음 | 1a 1b 60 05 68 ac | 일치 |
| R14 | 입력 | `ARGS` | `[3, 4]` (model.mjs:21) | 입력으로 고른 대표 인자 | 없음 | 대조 안 함 |
| R15 | 전이 | 진입 상태 | pc 0, locals `[3, 4]`, stack `[]` (model.mjs:24-34, trace[0]) | truth/javap-calc.txt:3 `ACC_STATIC`, :5 `args_size=2`. `$TMP/probe-g/javap-l.txt` LocalVariableTable `0 6 0 a I`, `0 6 1 b I`. 빈 스택은 javap-calc.txt:5 `stack=2`에서 따름 (pc 1에서 깊이 2이므로 진입 깊이가 0이 아니면 max_stack을 넘음) | slot 0=a, slot 1=b, 깊이 0 | 일치 |
| R16 | 전이 | pc 0 `iload_0` | `[]` → `[3]`, moved local slot 0 값 3 (model.mjs:44-49, trace[1]) | JVMS#jvms-6.5.iload_n `... → ..., value`, `The value of the local variable at <n> is pushed onto the operand stack.` | `[a]` | 일치 |
| R17 | 전이 | pc 1 `iload_1` | `[3]` → `[3, 4]`, moved local slot 1 값 4 (trace[2]) | JVMS#jvms-6.5.iload_n 같은 절 | `[a, b]` | 일치 |
| R18 | 전이 | pc 2 `iadd` | `[3, 4]` → `[7]`, 위를 b로 먼저 꺼내고 아래를 a로 꺼냄, operands `[3, 4]` (model.mjs:57-62, trace[3]) | JVMS#jvms-6.5.iadd `..., value1, value2 →` `..., result`, `The int result is value1 + value2.` | `[a+b]`, value1=아래, value2=위 | 일치 |
| R19 | 전이 | pc 3 `iconst_2` | `[7]` → `[7, 2]`, moved const 2 (model.mjs:51-54, trace[4]) | JVMS#jvms-6.5.iconst_i `... →` `..., <i>`, `Push the int constant <i>` | `[a+b, 2]` | 일치 |
| R20 | 전이 | pc 4 `imul` | `[7, 2]` → `[14]`, operands `[7, 2]` (model.mjs:55-62, trace[5]) | JVMS#jvms-6.5.imul `..., value1, value2 →` `..., result`, `The int result is value1 * value2.` | `[(a+b)*2]` | 일치 |
| R21 | 전이 | pc 5 `ireturn` | `[14]` → `[]`, returned 14, done (model.mjs:65-68, 75, trace[6]) | JVMS#jvms-6.5.ireturn `..., value →` `[empty]`, `value is popped from the operand stack of the current frame (§2.6) and pushed onto the operand stack of the frame of the invoker` | 반환 14, 스택 비움 | 일치 |
| R22 | 전이 | STEP 단위와 pc 진행 | 호출 1회에 opcode 1개, 다음 pc는 +1, 6회 뒤 종료, trace 7상태 (model.mjs:36-37, 76-77) | truth/javap-calc.txt:6-11 오프셋 0~5 연속. JVMS 다섯 절의 Format에 피연산자 바이트가 없음 (`iadd`, `iconst_<i>`, `iload_<n>`, `imul`, `ireturn`) | 1바이트 명령 6개, STEP 6회 | 일치 |
| R23 | 값 | 대표 입력 반환값 | `trace([3, 4])` returned 14 | `$TMP/java-out.txt` `calc(3, 4) = 14` | 14 | 일치 |
| R24 | 값 | 경계 입력 반환값 12쌍 | 아래 표의 모델 값 | `$TMP/java-out.txt` 12줄, `$TMP/model-out.txt`와 `diff` 결과 차이 없음 | 아래 표의 java 값 | 일치 |
| R25 | 값 | iadd 오버플로 중간값 | (2147483647, 1) → -2147483648, (-2147483648, -1) → 2147483647, (2147483647, 2147483647) → -2, (-2147483648, -2147483648) → 0 (model.mjs:60) | JVMS#jvms-6.5.iadd `The result is the 32 low-order bits of the true mathematical result in a sufficiently wide two's-complement format`, `never throws a run-time exception` | 수학적 합의 하위 32비트 | 일치 |
| R26 | 값 | imul 오버플로 | (1073741824, 0): 1073741824 * 2 → -2147483648, (-1073741825, 0): → 2147483646 (model.mjs:60) | JVMS#jvms-6.5.imul `The result is the 32 low-order bits of the true mathematical result`. `$TMP/java-out.txt` `calc(1073741824, 0) = -2147483648`, `calc(-1073741825, 0) = 2147483646` | 같은 값 | 일치 |
| R27 | 값 | max_stack 한계 | 13쌍 모두 최대 깊이 2, model.mjs:72-74 가드 미발동 | truth/javap-calc.txt:5 `stack=2` | 깊이 2 이하 | 일치 |
| R28 | 근거 없음 | 출처 없는 숫자나 상태 | 숫자 리터럴은 바이트 6개, pc 0~5, 2(MAX와 iconst_2), pc +1, ARGS | R4~R22에서 모두 출처 위치 확인. ARGS는 R14 입력 | 출처 없는 값 없음 | 일치 |

R24 상세 (모델 반환값과 java 21.0.1 실측):

| a | b | 모델 | java |
|---|---|---|---|
| 0 | 0 | 0 | 0 |
| 1 | 2 | 6 | 6 |
| -1 | -2 | -6 | -6 |
| 2147483647 | 1 | 0 | 0 |
| 2147483647 | 0 | -2 | -2 |
| 1073741824 | 0 | -2147483648 | -2147483648 |
| 1073741823 | 1 | -2147483648 | -2147483648 |
| -2147483648 | -1 | -2 | -2 |
| -2147483648 | 0 | 0 | 0 |
| -1073741825 | 0 | 2147483646 | 2147483646 |
| 2147483647 | 2147483647 | -4 | -4 |
| -2147483648 | -2147483648 | 0 | 0 |

참고 (판정에 넣지 않은 관찰):

- truth/javap-calc.txt는 `javap -c -v` 출력이라고 적혀 있지만 메서드 부분만 잘라 둔 것이라 `major version` 줄이 없습니다. 그래서 R1의 major 65는 같은 javac로 다시 컴파일한 출력(`$TMP/probe/javap-full.txt:7`)에서 확인했어요. 재컴파일 출력의 메서드 부분은 truth/javap-calc.txt와 `diff` 차이가 없습니다.
- R15의 slot 매핑은 출처 목록 안의 JVMS 6.5절만으로는 정해지지 않습니다(정적 메서드 인자 배치는 2.6.1절). 덧셈은 교환 법칙이 성립해서 반환값으로도 가를 수 없어요. 그래서 truth/Calc.java를 같은 javac에 `-g`로 다시 컴파일해 LocalVariableTable을 읽었고, `-g`를 붙여도 Code 바이트는 `1a1b600568ac` 그대로였습니다.
- 모델의 ireturn은 값 하나만 꺼냅니다(model.mjs:66). JVMS는 남은 값을 버린다고 적지만(`Any other values on the operand stack of the current method are discarded.`), 이 Code에서는 pc 5 직전 깊이가 1이라 결과가 같습니다. 다른 Code에 재사용할 때만 갈립니다.
- 종료 상태에서 pc가 5에 머물고 locals가 `[3, 4]`로 남는 것(model.mjs:77)은 호출자에게 제어가 넘어간 뒤의 프레임을 그림에서 어떻게 보일지 정한 표기입니다. 출처에서 온 값처럼 쓰인 곳이 없어서 대조하지 않았어요.
- 빈 입력은 descriptor `(II)I`상 Java 쪽에 대응이 없습니다. model.mjs:27의 정수 강제 변환은 입력 처리라 대조 대상에서 뺐습니다.

실행한 명령:

```bash
# 도구 버전과 JVMS 원문
java -version; javac -version
TMP=$(mktemp -d)
curl -sSL -o "$TMP/jvms-6.html" https://docs.oracle.com/javase/specs/jvms/se21/html/jvms-6.html
# heredoc 파이썬(python3 -I -)으로 태그를 벗겨 $TMP/jvms-6.txt를 만들고
# jvms-6.5.iadd, iconst_i, iload_n, imul, ireturn 앵커 구간을 sed -n으로 읽음

# 재컴파일과 javap, Code 바이트
mkdir -p "$TMP/probe" && cp truth/Calc.java "$TMP/probe/"
# $TMP/probe/Probe.java: 인자 쌍마다 Calc.calc(a, b)를 출력하는 하네스
(cd "$TMP/probe" && javac Calc.java Probe.java && javap -c -v Calc.class > javap-full.txt)
grep -n 'major version' "$TMP/probe/javap-full.txt"
sed -n '/static int calc/,/ireturn/p' "$TMP/probe/javap-full.txt" | diff - truth/javap-calc.txt
xxd -p "$TMP/probe/Calc.class" | tr -d '\n' | grep -o '00020002000000061a1b600568ac'

# slot 매핑
mkdir -p "$TMP/probe-g" && cp truth/Calc.java "$TMP/probe-g/"
(cd "$TMP/probe-g" && javac -g Calc.java && javap -c -l -v Calc.class > javap-l.txt)

# 모델 실행
node --input-type=module -e 'import * as m from "./model.mjs"; const t = m.trace(); for (const s of t) console.log(JSON.stringify(s), m.readout(s));'

# 실측과 모델 반환값 대조 (bash에서 실행, 13쌍)
IN="3 4 0 0 1 2 -1 -2 2147483647 1 2147483647 0 1073741824 0 1073741823 1 -2147483648 -1 -2147483648 0 -1073741825 0 2147483647 2147483647 -2147483648 -2147483648"
(cd "$TMP/probe" && java -cp . Probe $IN) > "$TMP/java-out.txt"
# stderr에는 iadd 직후 스택 값과 최대 깊이를 찍음 (R25, R27 근거)
node --input-type=module -e 'import * as m from "./model.mjs"; const a = process.argv.slice(1).map(Number); for (let i = 0; i + 1 < a.length; i += 2) { const t = m.trace([a[i], a[i+1]]); console.error(`iadd=${t.find(s => s.last && s.last.op === "iadd").stack[0]} depth=${Math.max(...t.map(s => s.stack.length))}`); console.log(`calc(${a[i]}, ${a[i+1]}) = ${t.at(-1).returned}`); }' -- $IN > "$TMP/model-out.txt"
diff "$TMP/java-out.txt" "$TMP/model-out.txt"

# sha256
node -e 'process.stdout.write(require("node:crypto").createHash("sha256").update(require("node:fs").readFileSync(process.argv[1])).digest("hex"))' model.mjs

rm -rf "$TMP"
```
