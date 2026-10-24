// node check.mjs: model.mjs를 javac 21.0.1, java 21.0.1 실측값과 대조한다 (실패하면 exit 1)
import assert from "node:assert/strict";
import { ARGS, CODE, MAX_LOCALS, MAX_STACK, makeState, readout, step, trace } from "./model.mjs";

// class 파일 Code 속성 원본 바이트
assert.deepEqual(CODE.map((c) => c.byte), [0x1a, 0x1b, 0x60, 0x05, 0x68, 0xac]);
// 피연산자 없는 1바이트 명령만 있어 오프셋이 0..5로 이어진다
assert.deepEqual(CODE.map((c) => c.pc), [0, 1, 2, 3, 4, 5]);

// STEP은 입력 state를 바꾸지 않는다
const s0 = makeState();
const before = JSON.stringify(s0);
step(s0);
assert.equal(JSON.stringify(s0), before);

const t = trace(ARGS);
assert.equal(t.length, CODE.length + 1);
assert.equal(t[0].locals.length, MAX_LOCALS);
// 스택은 정확히 max_stack까지 차고 넘지 않는다
assert.equal(Math.max(...t.map((s) => s.stack.length)), MAX_STACK);

// java Probe 실측: calc(3, 4) = 14, 그리고 32비트 감싸기 경계
assert.equal(t[t.length - 1].returned, 14);
for (const [a, b, want] of [
  [2147483647, 1, 0],
  [-7, 2, -10],
  [1 << 30, 0, -2147483648],
]) {
  assert.equal(trace([a, b]).at(-1).returned, want, `calc(${a}, ${b})`);
}

// 그림의 리드아웃은 이 문자열과 같아야 한다
assert.deepEqual(t.map(readout), [
  "pc 0 | entry | stack []",
  "pc 0 | iload_0 | stack [3]",
  "pc 1 | iload_1 | stack [3, 4]",
  "pc 2 | iadd | stack [7]",
  "pc 3 | iconst_2 | stack [7, 2]",
  "pc 4 | imul | stack [14]",
  "pc 5 | ireturn | returned 14",
]);

console.log(`model check passed: ${CODE.length} opcodes, max_stack ${MAX_STACK}, calc(${ARGS.join(", ")}) = 14`);
