// JVM 바이트코드 실행 진실 모델: Calc.calc(int, int), javac 21.0.1 (class file major 65)
// 그림의 테이프 위치, 서랍 값, 스택 디스크, 리드아웃은 모두 이 모듈에서 나온다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.

export const SOURCE = "static int calc(int a, int b) { return (a + b) * 2; }";

// javap -c -v Calc.class 의 "stack=2, locals=2, args_size=2"
export const MAX_STACK = 2;
export const MAX_LOCALS = 2;

// 오프셋과 니모닉은 javap -c 출력, 바이트는 class 파일 Code 속성 원본(xxd: 1a 1b 60 05 68 ac)
export const CODE = [
  { pc: 0, byte: 0x1a, op: "iload_0" },
  { pc: 1, byte: 0x1b, op: "iload_1" },
  { pc: 2, byte: 0x60, op: "iadd" },
  { pc: 3, byte: 0x05, op: "iconst_2" },
  { pc: 4, byte: 0x68, op: "imul" },
  { pc: 5, byte: 0xac, op: "ireturn" },
];

export const ARGS = [3, 4];

// STATE: 지금 이 순간 전부. last는 방금 실행한 명령, moved는 그 명령이 옮긴 값.
export function makeState(args = ARGS) {
  return {
    pc: 0,
    locals: [args[0] | 0, args[1] | 0],
    stack: [],
    last: null,
    moved: null,
    returned: null,
    done: false,
  };
}

// STEP: 호출 1회 = opcode 1개. 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(s) {
  if (s.done) return s;
  const ins = CODE.find((c) => c.pc === s.pc);
  const stack = s.stack.slice();
  let moved = null;
  let returned = null;
  switch (ins.op) {
    case "iload_0":
    case "iload_1": {
      const slot = ins.op === "iload_0" ? 0 : 1;
      stack.push(s.locals[slot]);
      moved = { from: "local", slot, to: "stack", value: s.locals[slot] };
      break;
    }
    case "iconst_2":
      stack.push(2);
      moved = { from: "const", to: "stack", value: 2 };
      break;
    case "iadd":
    case "imul": {
      const b = stack.pop();
      const a = stack.pop();
      // JVMS 6.5: int 연산 결과는 32비트 2의 보수로 감싼다
      const r = ins.op === "iadd" ? (a + b) | 0 : Math.imul(a, b);
      stack.push(r);
      moved = { from: "stack", to: "stack", operands: [a, b], value: r };
      break;
    }
    case "ireturn":
      returned = stack.pop();
      moved = { from: "stack", to: "caller", value: returned };
      break;
    default:
      throw new Error(`unknown opcode at pc ${s.pc}`);
  }
  if (stack.length > MAX_STACK) {
    throw new Error(`operand stack overflow at pc ${s.pc}: ${stack.length} > ${MAX_STACK}`);
  }
  const done = ins.op === "ireturn";
  // 6개 모두 피연산자 없는 1바이트 명령이라 다음 pc는 +1
  return { pc: done ? s.pc : s.pc + 1, locals: s.locals, stack, last: ins, moved, returned, done };
}

export function trace(args = ARGS) {
  const out = [makeState(args)];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

export function readout(s) {
  if (!s.last) return `pc 0 | entry | stack []`;
  if (s.done) return `pc ${s.last.pc} | ireturn | returned ${s.returned}`;
  return `pc ${s.last.pc} | ${s.last.op} | stack [${s.stack.join(", ")}]`;
}
