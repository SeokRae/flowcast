// node check-source.mjs [dir]: model.mjs가 기대는 HotSpot 조건이 jdk-21.0.1+12 소스의 그 자리에 있는지 확인한다.
// 소스는 저장소에 두지 않는다(OpenJDK는 GPLv2 + CPE). 먼저 sh truth/fetch-hotspot.sh [dir]로 내려받는다.
// 기본 dir은 fetch 스크립트와 같은 ${TMPDIR:-/tmp}/flowcast-hotspot-21.0.1. 어긋나면 exit 1, 파일이 없으면 exit 2.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FLAGS } from "./model.mjs";

const DIR = process.argv[2] ?? join(process.env.TMPDIR || "/tmp", "flowcast-hotspot-21.0.1");
const FILES = [
  "compiler/compilationPolicy.cpp",
  "compiler/compiler_globals.hpp",
  "runtime/globals.hpp",
  "runtime/deoptimization.cpp",
  "oops/methodCounters.cpp",
  "oops/methodData.cpp",
  "oops/methodData.hpp",
  "c1/c1_LIRGenerator.cpp",
];
const missing = FILES.filter((f) => !existsSync(join(DIR, f)));
if (missing.length) {
  console.error(`HotSpot sources not found in ${DIR}: ${missing.join(", ")}`);
  console.error("run: sh truth/fetch-hotspot.sh" + (process.argv[2] ? ` ${process.argv[2]}` : ""));
  process.exit(2);
}
const src = Object.fromEntries(FILES.map((f) => [f, readFileSync(join(DIR, f), "utf8")]));

// 식별자와 연산자 토큰을 공백 무시로 이은 정규식. 원문 줄을 옮기지 않고 조건의 모양만 찾는다.
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const seq = (...tokens) => new RegExp(tokens.map(esc).join("\\s*"));
// 함수나 클래스 하나의 본문: from 토큰부터 다음 to 토큰 앞까지
function body(file, from, to) {
  const text = src[file];
  const a = text.search(seq(...from));
  const b = a < 0 ? -1 : text.slice(a + 1).search(seq(...to));
  return a < 0 || b < 0 ? null : { text: text.slice(a, a + 1 + b), at: a };
}
const lineOf = (file, index) => src[file].slice(0, index).split("\n").length;

const results = [];
function expect(name, file, scope, ...patterns) {
  // patterns는 순서대로 나와야 한다 (앞 패턴이 끝난 뒤에서 다음을 찾는다)
  let ok = scope !== null;
  let cursor = 0;
  let first = -1;
  for (const p of ok ? patterns : []) {
    const m = scope.text.slice(cursor).match(p);
    if (!m) { ok = false; break; }
    if (first < 0) first = scope.at + cursor + m.index;
    cursor += m.index + m[0].length;
  }
  results.push({ name, ok, where: ok ? `${file}:${lineOf(file, first)}` : file });
}
const whole = (file) => ({ text: src[file], at: 0 });

// 1. 전이 술어 (CallPredicate::apply_scaled): tier 0과 2, tier 3
const callPred = body("compiler/compilationPolicy.cpp", ["class", "CallPredicate"], ["};"]);
expect("CallPredicate tier 0: i >= Tier3InvocationThreshold*s or (i >= Tier3Min*s and i+b >= Tier3Compile*s)", "compiler/compilationPolicy.cpp", callPred,
  seq("case", "CompLevel_none", ":"),
  seq("i", ">=", "Tier3InvocationThreshold", "*", "scale"),
  seq("i", ">=", "Tier3MinInvocationThreshold", "*", "scale", "&&", "i", "+", "b", ">=", "Tier3CompileThreshold", "*", "scale"));
expect("CallPredicate tier 3: i >= Tier4InvocationThreshold*s or (i >= Tier4Min*s and i+b >= Tier4Compile*s)", "compiler/compilationPolicy.cpp", callPred,
  seq("case", "CompLevel_full_profile", ":"),
  seq("i", ">=", "Tier4InvocationThreshold", "*", "scale"),
  seq("i", ">=", "Tier4MinInvocationThreshold", "*", "scale", "&&", "i", "+", "b", ">=", "Tier4CompileThreshold", "*", "scale"));
// 큐가 비면 k = 1
expect("threshold_scale: k = queue_size / (feedback_k * comp_count) + 1", "compiler/compilationPolicy.cpp",
  body("compiler/compilationPolicy.cpp", ["double", "CompilationPolicy", "::", "threshold_scale"], ["return", "1", ";"]),
  seq("queue_size", "/", "(", "feedback_k", "*", "comp_count", ")", "+", "1"));

// 2. common<Predicate>: CompLevel_none에서 full profile 술어가 맞으면 바로 tier 4, 아니면 Tier3DelayOn으로 2와 3을 가른다
const common = body("compiler/compilationPolicy.cpp", ["CompLevel", "CompilationPolicy", "::", "common", "("], ["CompLevel", "CompilationPolicy", "::", "call_event", "("]);
expect("common: CompLevel_none -> CompLevel_full_optimization when the full-profile predicate holds", "compiler/compilationPolicy.cpp", common,
  seq("case", "CompLevel_none", ":"),
  seq("common", "<", "Predicate", ">", "(", "method", ",", "CompLevel_full_profile"),
  seq("==", "CompLevel_full_optimization", ")"),
  seq("next_level", "=", "CompLevel_full_optimization", ";"),
  seq("Predicate", "::", "apply", "(", "method", ",", "cur_level", ",", "i", ",", "b", ")"),
  seq("Tier3DelayOn", "*", "compiler_count", "(", "CompLevel_full_optimization", ")"),
  seq("next_level", "=", "CompLevel_limited_profile"),
  seq("next_level", "=", "CompLevel_full_profile"));
expect("common: CompLevel_full_profile uses the MDO deltas (invocation_count_delta)", "compiler/compilationPolicy.cpp", common,
  seq("case", "CompLevel_full_profile", ":"),
  seq("mdo_i", "=", "mdo", "->", "invocation_count_delta", "(", ")"),
  seq("Predicate", "::", "apply", "(", "method", ",", "cur_level", ",", "mdo_i", ",", "mdo_b", ")"),
  seq("next_level", "=", "CompLevel_full_optimization"));

// 3. 컴파일러 스레드 분배 (CompilationPolicy::initialize)
const init = body("compiler/compilationPolicy.cpp", ["void", "CompilationPolicy", "::", "initialize", "("], ["set_increase_threshold_at_ratio"]);
expect("initialize: count = max(log_cpu * loglog_cpu * 3 / 2, 2)", "compiler/compilationPolicy.cpp", init,
  seq("count", "=", "MAX2", "(", "log_cpu", "*", "loglog_cpu", "*", "3", "/", "2", ",", "2", ")"));
expect("initialize: C1 = max(count / 3, 1), C2 = max(count - C1, 1)", "compiler/compilationPolicy.cpp", init,
  seq("set_c1_count", "(", "MAX2", "(", "count", "/", "3", ",", "1", ")", ")"),
  seq("set_c2_count", "(", "MAX2", "(", "count", "-", "c1_count", "(", ")", ",", "1", ")", ")"));

// 4. 알림 간격: 인터프리터는 Tier0InvokeNotifyFreqLog 마스크, tier 3 코드는 Tier3InvokeNotifyFreqLog
for (const file of ["oops/methodCounters.cpp", "oops/methodData.cpp"]) {
  expect(`${file}: _invoke_mask from Tier0InvokeNotifyFreqLog`, file, whole(file),
    seq("_invoke_mask", "=", "right_n_bits", "(", "CompilerConfig", "::", "scaled_freq_log", "(", "Tier0InvokeNotifyFreqLog"));
}
expect("increment_event_counter: tier 3 code notifies with Tier3InvokeNotifyFreqLog", "c1/c1_LIRGenerator.cpp",
  body("c1/c1_LIRGenerator.cpp", ["void", "LIRGenerator", "::", "increment_event_counter", "("], ["ShouldNotReachHere"]),
  seq("level", "==", "CompLevel_full_profile"),
  seq("Tier3InvokeNotifyFreqLog"));

// 5. 트랩: maybe_recompile은 코드를 두고, this_trap_count >= PerBytecodeTrapLimit에서 make_not_entrant, reprofile은 재컴파일 이력이 있을 때만
const trap = body("runtime/deoptimization.cpp", ["Deoptimization", "::", "uncommon_trap_inner", "("], ["Deoptimization", "::", "query_update_method_data", "("]);
const maybe = trap && trap.text.match(/case\s+Action_maybe_recompile\s*:([\s\S]*?)case\s+Action_reinterpret\s*:/);
results.push({
  name: "uncommon_trap_inner: Action_maybe_recompile keeps the code (no make_not_entrant in its case)",
  ok: !!maybe && /\bbreak\s*;/.test(maybe[1]) && !/make_not_entrant/.test(maybe[1].replace(/\/\/.*$/gm, "")),
  where: maybe ? `runtime/deoptimization.cpp:${lineOf("runtime/deoptimization.cpp", trap.at + maybe.index)}` : "runtime/deoptimization.cpp",
});
expect("uncommon_trap_inner: make_not_entrant once this_trap_count >= PerBytecodeTrapLimit", "runtime/deoptimization.cpp", trap,
  seq("maybe_prior_trap"),
  seq("this_trap_count", ">=", "(", "uint", ")", "PerBytecodeTrapLimit", ")"),
  seq("make_not_entrant", "=", "true", ";"));
expect("uncommon_trap_inner: reprofile only with a prior recompile at this trap point", "runtime/deoptimization.cpp", trap,
  seq("make_not_entrant", "&&", "maybe_prior_recompile", "&&", "maybe_prior_trap"),
  seq("reprofile", "=", "true", ";"),
  seq("CompilationPolicy", "::", "reprofile", "("));
expect("query_update_method_data: this_trap_count = inc_trap_count(idx)", "runtime/deoptimization.cpp", whole("runtime/deoptimization.cpp"),
  seq("this_trap_count", "=", "trap_mdo", "->", "inc_trap_count", "(", "idx", ")"));
expect("inc_trap_count: one more per trap", "oops/methodData.hpp", whole("oops/methodData.hpp"),
  seq("uint", "inc_trap_count", "(", "int", "reason", ")"),
  seq("cnt1", "=", "1", "+", "_trap_hist", ".", "_array", "[", "reason", "]"));

// 6. 플래그 기본값 = model.mjs FLAGS (CICompilerCount는 ergonomic이라 소스 기본값이 상수가 아니다)
for (const [name, value] of Object.entries(FLAGS)) {
  if (name === "CICompilerCount") continue;
  const file = ["PerBytecodeTrapLimit", "TypeProfileWidth"].includes(name) ? "runtime/globals.hpp" : "compiler/compiler_globals.hpp";
  expect(`default ${name} = ${value}`, file, whole(file), new RegExp(`product\\s*\\(\\s*intx\\s*,\\s*${name}\\s*,\\s*${value}\\s*,`));
}

for (const r of results) console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  (${r.where})`);
const failed = results.filter((r) => !r.ok).length;
if (failed) {
  console.error(`source check failed: ${failed} of ${results.length}`);
  process.exit(1);
}
console.log(`source check passed: ${results.length} conditions in ${FILES.length} files under ${DIR}`);
