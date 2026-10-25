// EEVDF 진실 모델: Linux 7.0.14 (linuxkit, arm64)의 fair 클래스, CPU 하나를 나눠 쓰는 CPU 바운드 태스크 셋
// 그림의 캐리지 위치, 마감 핀, 게이트, 선택 암, 리드아웃은 모두 이 모듈에서 나온다.
// 규칙의 근거는 truth/kernel-refs.md(태그 v7.0.14의 줄 범위), 상수는 truth/의 실측값이다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.

export const KERNEL = "7.0.14-linuxkit";
export const PROBE_CPU = 10;

// 실측 env.txt: online CPU 0-10, tunable_scaling 1(SCHED_TUNABLESCALING_LOG), base_slice_ns 2800000
export const ONLINE_CPUS = 11;
export const TUNABLE_SCALING = 1;
// fair.c normalized_sysctl_sched_base_slice
export const NORMALIZED_BASE_SLICE_NS = 700000;
// fair.c get_update_sysctl_factor(): CPU 수는 8에서 자르고, LOG면 1 + ilog2(cpus)
export function scalingFactor(cpus, scaling = TUNABLE_SCALING) {
  const c = Math.min(cpus, 8);
  if (scaling === 0) return 1;
  if (scaling === 2) return c;
  return 1 + Math.floor(Math.log2(c));
}
export const BASE_SLICE_NS = scalingFactor(ONLINE_CPUS) * NORMALIZED_BASE_SLICE_NS;

// 실측 env.txt: CONFIG_HZ=1000, NO_HRTICK. 슬라이스 끝은 1 ms 틱에서만 확인된다 (include/vdso/jiffies.h TICK_NSEC)
export const HZ = 1000;
export const TICK_NS = Math.floor((1e9 + HZ / 2) / HZ);

// scale_load_down(NICE_0_LOAD): nice 0 가중치. 64비트에서 se.load.weight는 이 값에 1024를 곱해 보인다
export const NICE_0_WEIGHT = 1024;

// 실측 proc-sched.txt: se.load.weight = weight * 1024, prio = 120 + nice (core.c sched_prio_to_weight 표와 같다)
export const TASKS = [
  { name: "n0", nice: 0, weight: 1024 },
  { name: "n1", nice: 1, weight: 820 },
  { name: "n5", nice: 5, weight: 335 },
];
// 넓은 가중치 차 실측(proc-sched-wide.txt): nice 10 = 110
export const WIDE_TASKS = [
  { name: "w0", nice: 0, weight: 1024 },
  { name: "w10", nice: 10, weight: 110 },
];

// 그림이 보여주는 결정 수: 배치 때 1회(#0) + 실행 뒤 12회
export const DECISIONS = 12;

// core.c sched_prio_to_wmult: 2^32 / weight를 반올림한 값 (check-source.mjs가 표와 대조)
export function invWeight(weight) {
  return Math.round(2 ** 32 / weight);
}

// fair.c calc_delta_fair() -> __calc_delta(delta, NICE_0_LOAD, &se->load): delta * 1024 / w 를
// 32비트 역수 곱과 시프트로 계산한다. 정수 결과까지 같게 BigInt로 옮겼다.
export function calcDeltaFair(deltaNs, weight) {
  if (weight === NICE_0_WEIGHT) return deltaNs;
  let fact = BigInt(NICE_0_WEIGHT) * BigInt(invWeight(weight));
  let shift = 32n;
  const hi = fact >> 32n;
  if (hi > 0n) {
    const fs = BigInt(hi.toString(2).length); // fls()
    shift -= fs;
    fact >>= fs;
  }
  return Number((BigInt(deltaNs) * fact) >> shift);
}

// 가상 시간으로 잰 요청 크기: update_deadline()과 place_entity()의 calc_delta_fair(se->slice, se)
export function vslice(weight) {
  return calcDeltaFair(BASE_SLICE_NS, weight);
}

// fair.c vruntime_eligible(): sum(w_j * (v_j - v_i)) >= 0, 즉 v_i <= V (lag >= 0). 지금 도는 태스크도 합에 든다
export function eligible(tasks, set, i) {
  let sum = 0;
  for (let j = 0; j < tasks.length; j++) sum += set[j].weight * (tasks[j].v - tasks[i].v);
  return sum >= 0;
}

// fair.c avg_vruntime(): 가중 평균 V. 음수 쪽으로 내림 (원점은 배치 순간의 V)
export function avgVruntime(tasks, set) {
  let num = 0;
  let den = 0;
  for (let j = 0; j < tasks.length; j++) {
    num += set[j].weight * tasks[j].v;
    den += set[j].weight;
  }
  return Math.floor(num / den);
}

// fair.c pick_eevdf() (PICK_BUDDY의 next는 비어 있다): 트리(지금 도는 태스크 밖)에서 자격 있는 것 중
// 마감이 가장 이른 것. 같은 마감이면 먼저 넣은 쪽(seq). 지금 도는 태스크는 자격이 있고 마감이 더 이를 때만 이긴다
export function pickEevdf(tasks, set, curr) {
  let best = -1;
  for (let i = 0; i < tasks.length; i++) {
    if (i === curr || !eligible(tasks, set, i)) continue;
    if (best < 0 || tasks[i].d < tasks[best].d || (tasks[i].d === tasks[best].d && tasks[i].seq < tasks[best].seq)) best = i;
  }
  if (curr >= 0 && eligible(tasks, set, curr) && (best < 0 || tasks[curr].d < tasks[best].d)) best = curr;
  return best;
}

// STATE: 결정 하나가 끝난 순간 전부. curr는 방금 뽑혀 다음 STEP에 돌 태스크, ran은 이 결정 직전에 돈 실행
export function makeState(input = {}) {
  const set = input.tasks ?? TASKS;
  const decisions = input.decisions ?? DECISIONS;
  // 같은 순간 lag 0으로 깨어난 배치: v = V, 마감 = v + vslice (place_entity, ENQUEUE_INITIAL 아님)
  const tasks = set.map((t, i) => ({ v: 0, d: vslice(t.weight), sum: 0, runs: 0, seq: i }));
  const curr = pickEevdf(tasks, set, -1);
  return {
    set,
    decisions,
    k: 0,
    tasks,
    curr,
    // set_next_entity() -> set_protect_slice(): 슬라이스가 모두 같아 보호 경계는 마감 그 자체
    vprot: tasks[curr].d,
    seq: set.length,
    elig: tasks.map((_, i) => eligible(tasks, set, i)),
    V: avgVruntime(tasks, set),
    ran: null,
    switched: true,
    done: decisions === 0,
  };
}

// STEP: 호출 1회 = 스케줄 결정 1회. 뽑힌 태스크가 다음 결정 지점까지 돌고(틱마다 update_curr), 그 틱에서 pick_eevdf가
// 다음 태스크를 고른다. 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(s) {
  if (s.done) return s;
  const set = s.set;
  const tasks = s.tasks.map((t) => ({ ...t }));
  const c = s.curr;
  const t = tasks[c];
  const w = set[c].weight;
  const v0 = t.v;
  let ticks = 0;
  let renewed = false;
  for (;;) {
    // update_curr(): vruntime += calc_delta_fair(delta_exec)
    t.v += calcDeltaFair(TICK_NS, w);
    t.sum += TICK_NS;
    ticks += 1;
    // update_deadline(): v가 마감에 닿으면 새 마감 = v + vslice, 그리고 resched
    let resched = false;
    if (t.v >= t.d) {
      t.d = t.v + vslice(w);
      resched = true;
      renewed = true;
    }
    // update_curr(): resched || !protect_slice(curr) 이면 resched_curr_lazy(). 사용자 공간으로 돌아가는 길에 schedule()
    if (resched || !(t.v < s.vprot)) break;
  }
  t.runs += 1;
  const next = pickEevdf(tasks, set, c);
  let seq = s.seq;
  let vprot = s.vprot;
  const switched = next !== c;
  if (switched) {
    // put_prev_entity()가 이전 태스크를 트리에 다시 넣고, set_next_entity()가 새 보호 경계를 정한다
    tasks[c].seq = seq++;
    vprot = tasks[next].d;
  }
  // 같은 태스크를 다시 뽑으면 put_prev_set_next_task()가 아무것도 하지 않아 보호 경계가 낡은 채로 남는다:
  // 그 뒤로는 틱마다 결정한다
  return {
    set,
    decisions: s.decisions,
    k: s.k + 1,
    tasks,
    curr: next,
    vprot,
    seq,
    elig: tasks.map((_, i) => eligible(tasks, set, i)),
    V: avgVruntime(tasks, set),
    ran: { task: c, ticks, dv: t.v - v0, renewed },
    switched,
    done: s.k + 1 >= s.decisions,
  };
}

export function trace(input = {}) {
  const out = [makeState(input)];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

export const ms = (ns) => (ns / 1e6).toFixed(2);

export function readout(s) {
  const names = s.set.filter((_, i) => s.elig[i]).map((t) => t.name);
  return `#${s.k} pick ${s.set[s.curr].name} | elig ${names.join(" ")} | V ${ms(s.V)} ms`;
}
