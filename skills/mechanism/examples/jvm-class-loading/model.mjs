// JDK 21 내장 클래스 로더의 위임과 적재 진실 모델: Amazon Corretto 21.0.1 (OpenJDK 21.0.1+12 HotSpot), macOS arm64
// 그림의 승강 칸 층, 기록 서랍, 색인 기둥, 저장소 서랍, 리드아웃은 모두 이 모듈에서 나온다.
// 규칙은 $JAVA_HOME/lib/src.zip의 java.base/jdk/internal/loader/BuiltinClassLoader.java와 ClassLoaders.java를 옮긴 것이고,
// 결과는 truth/의 실행 출력(probe-out.txt, loader-trace.txt)과 check.mjs가 대조한다.
// 페이지에 인라인되므로 import 없이 쓰고, export는 const와 function 선언 앞에만 둔다.

export const RUNTIME = "21.0.1+12";

// 층 순서 (아래에서 위로). ClassLoaders의 static 블록:
// BOOT_LOADER = new BootClassLoader(bcp), PLATFORM_LOADER = new PlatformClassLoader(BOOT_LOADER),
// APP_LOADER = new AppClassLoader(PLATFORM_LOADER, ucp)
export const LOADERS = ["app", "platform", "boot"];
export const PARENT = { app: "platform", platform: "boot", boot: null };

// BuiltinClassLoader.ucp: 클래스 경로는 앱 로더에만 있다 (loader-trace: hasClassPath() -> true, false)
export const CLASS_PATH = { app: true, platform: false };

// ModuleLayer.boot()의 모듈을 정의한 로더별로, 이름순 (probe-out: layer.boot, layer.platform, layer.app)
export const MODULES = {
  boot: ["java.base", "java.datatransfer", "java.desktop", "java.instrument", "java.logging", "java.management", "java.management.rmi", "java.naming", "java.prefs", "java.rmi", "java.security.sasl", "java.xml", "jdk.jfr", "jdk.management", "jdk.management.agent", "jdk.management.jfr", "jdk.naming.rmi", "jdk.net", "jdk.nio.mapmode", "jdk.sctp", "jdk.unsupported"],
  platform: ["java.compiler", "java.net.http", "java.scripting", "java.security.jgss", "java.smartcardio", "java.sql", "java.sql.rowset", "java.transaction.xa", "java.xml.crypto", "jdk.accessibility", "jdk.charsets", "jdk.crypto.cryptoki", "jdk.crypto.ec", "jdk.dynalink", "jdk.httpserver", "jdk.jsobject", "jdk.localedata", "jdk.naming.dns", "jdk.security.auth", "jdk.security.jgss", "jdk.xml.dom", "jdk.zipfs"],
  app: ["jdk.attach", "jdk.compiler", "jdk.editpad", "jdk.internal.ed", "jdk.internal.jvmstat", "jdk.internal.le", "jdk.internal.opt", "jdk.jartool", "jdk.javadoc", "jdk.jconsole", "jdk.jdeps", "jdk.jdi", "jdk.jdwp.agent", "jdk.jlink", "jdk.jpackage", "jdk.jshell", "jdk.jstatd", "jdk.random", "jdk.unsupported.desktop"],
};

// BuiltinClassLoader.packageToModule (모든 내장 로더가 공유하는 static 맵) 중 이 요청들이 찾는 패키지.
// null = 부트 레이어의 이름 있는 모듈에 없는 패키지 (probe-out: packageToModule)
export const PACKAGES = {
  "java.time": { module: "java.base", loader: "boot" },
  "java.sql": { module: "java.sql", loader: "platform" },
  "demo": null,
};

// 각 로더 자신의 저장소에서 나오는 클래스와 class+load의 source (probe-out의 요청 구간)
// boot: findBootstrapClassOrNull (VM), platform: findClassInModuleOrNull, app: findClassOnClassPathOrNull
export const STORE = {
  "java.time.Duration": { loader: "boot", source: "shared objects file" },
  "java.sql.Types": { loader: "platform", source: "jrt:/java.sql" },
  "demo.Greeter": { loader: "app", source: "file:<work>/classes/" },
};

// 앱 로더 클래스 경로(<work>/classes/)에 있는 class 파일 (truth/classpath-listing.txt)
export const CLASS_PATH_FILES = ["demo/Greeter.class", "demo/Probe.class"];

// 첫 요청 전에 이미 정의된 클래스 중 이 그림이 서랍에 보여주는 것 (defined-before.txt: platform 0, app 1 = demo.Probe)
export const DEFINED_BEFORE = { app: ["demo.Probe"], platform: [] };

// demo.Probe가 ClassLoader.getSystemClassLoader().loadClass(cn)으로 차례로 요청하는 다섯 건
export const REQUESTS = ["java.time.Duration", "java.sql.Types", "demo.Greeter", "demo.Greeter", "demo.Missing"];

const packageOf = (cn) => cn.slice(0, cn.lastIndexOf("."));

// 프레임 하나 = 로더 하나의 loadClassOrNull(cn) 호출. pc는 그 메서드 안에서 다음에 할 일
function frameFor(loader) {
  // ClassLoaders$BootClassLoader.loadClassOrNull은 JLA.findBootstrapClassOrNull(cn) 하나로 끝난다
  return { loader, pc: loader === "boot" ? "bootstrap" : "findLoadedClass", c: null, via: null, branch: null };
}

function begin(req, defined) {
  const cn = REQUESTS[req];
  return {
    req,
    cn,
    at: "app",
    stack: [frameFor("app")],
    defined,
    carry: null,
    flag: null,
    out: null,
    last: { loader: "app", op: "loadClass", result: null },
    done: false,
  };
}

// STATE: 지금 이 순간 전부. at은 승강 칸이 선 층(지금 판단하는 로더), stack은 loadClassOrNull 호출 사슬,
// defined는 로더가 정의한 클래스(findLoadedClass가 찾는 기록), carry는 칸에 실린 Class, flag는 색인 기둥의 답,
// out은 호출자에게 돌아간 결과, last는 방금 한 판단이나 이동 하나.
export function makeState() {
  return begin(0, { app: DEFINED_BEFORE.app.slice(), platform: DEFINED_BEFORE.platform.slice(), boot: [] });
}

// STEP: 호출 1회 = 판단 하나(findLoadedClass, findLoadedModule, 저장소 탐색) 또는 로더 사이 이동 하나.
// 입력 state를 바꾸지 않고 다음 state를 돌려준다.
export function step(s) {
  if (s.done) return s;
  const top = s.stack[s.stack.length - 1];
  // 요청 하나가 끝났으면 다음 요청 카드를 넣는다
  if (!top) return begin(s.req + 1, s.defined);
  const stack = s.stack.map((f) => ({ ...f }));
  const f = stack[stack.length - 1];
  const me = f.loader;
  const cn = s.cn;
  let defined = s.defined;
  let carry = s.carry;
  let flag = null;
  let out = null;
  let last;
  let at = s.at;
  let done = false;

  const define = (loader) => {
    defined = { ...defined, [loader]: [...defined[loader], cn] };
    return { cn, loader };
  };

  switch (f.pc) {
    case "findLoadedClass": {
      // BuiltinClassLoader.loadClassOrNull: c = findLoadedClass(cn)
      const hit = defined[me].includes(cn);
      last = { loader: me, op: "findLoadedClass", result: hit ? "class" : "null" };
      if (hit) {
        // 기록에 있던 Class를 그대로 칸에 싣는다
        carry = f.c = { cn, loader: me };
        f.pc = "return";
      } else f.pc = "findLoadedModule";
      break;
    }
    case "findLoadedModule": {
      // packageToModule.get(패키지): 있으면 그 모듈을 정의한 로더로, 없으면 부모 다음 클래스 경로
      const entry = PACKAGES[packageOf(cn)] ?? null;
      last = { loader: me, op: "findLoadedModule", result: entry ? `${entry.module} @${entry.loader}` : "null" };
      flag = entry ? entry.loader : "none";
      if (entry && entry.loader === me) f.pc = "findClassInModule";
      else if (entry) {
        f.pc = "delegate";
        f.via = entry.loader;
      } else if (PARENT[me]) {
        f.pc = "parent";
        f.via = PARENT[me];
      } else f.pc = "classPath";
      break;
    }
    case "delegate":
    case "parent": {
      // loader.loadClassOrNull(cn) 또는 parent.loadClassOrNull(cn): 승강 칸이 그 층으로 간다
      const to = f.via;
      last = { loader: to, op: f.pc, result: me };
      f.branch = f.pc;
      f.pc = "waiting";
      stack.push(frameFor(to));
      at = to;
      break;
    }
    case "bootstrap": {
      // JLA.findBootstrapClassOrNull(cn): VM이 부트 로더 쪽에서 찾는다
      const store = STORE[cn];
      const found = defined.boot.includes(cn) || (store && store.loader === "boot");
      last = { loader: "boot", op: "findBootstrapClassOrNull", result: found ? "class" : "null" };
      if (found) {
        f.c = defined.boot.includes(cn) ? { cn, loader: "boot" } : define("boot");
        carry = f.c;
      }
      f.pc = "return";
      break;
    }
    case "findClassInModule": {
      // VM.isModuleSystemInited()가 참이면 findClassInModuleOrNull(loadedModule, cn)
      const store = STORE[cn];
      const found = store && store.loader === me;
      last = { loader: me, op: "findClassInModuleOrNull", result: found ? "class" : "null" };
      if (found) carry = f.c = define(me);
      f.pc = "return";
      break;
    }
    case "classPath": {
      // c == null && hasClassPath() 이면 findClassOnClassPathOrNull(cn)
      const store = STORE[cn];
      const found = store && store.loader === me;
      last = { loader: me, op: "findClassOnClassPathOrNull", result: found ? "class" : "null" };
      if (found) carry = f.c = define(me);
      f.pc = "return";
      break;
    }
    case "return": {
      stack.pop();
      const caller = stack[stack.length - 1];
      if (!caller) {
        // 가장 바깥 프레임: BuiltinClassLoader.loadClass는 null이면 ClassNotFoundException을 던진다
        last = { loader: me, op: "loadClass", result: f.c ? `class @${f.c.loader}` : "ClassNotFoundException" };
        out = f.c ? { cn, loader: f.c.loader } : { cn, error: "ClassNotFoundException" };
        carry = null;
        done = s.req === REQUESTS.length - 1;
        break;
      }
      // 한 층 아래 호출자에게 돌아간다. 클래스 경로가 없는 로더는 부모가 null을 주면 그대로 null을 돌려준다
      const bare = !f.c && f.branch === "parent" && !CLASS_PATH[f.loader];
      last = { loader: caller.loader, op: "return", result: f.c ? "class" : "null", from: me, bare };
      caller.c = f.c;
      // 모듈로 위임한 호출자는 결과를 그대로 돌려주고, 부모에게 물은 호출자는 null이면 자기 클래스 경로를 본다
      if (caller.branch === "delegate" || f.c) caller.pc = "return";
      else caller.pc = CLASS_PATH[caller.loader] ? "classPath" : "return";
      at = caller.loader;
      break;
    }
    default:
      throw new Error(`unknown pc ${f.pc}`);
  }
  return { req: s.req, cn, at, stack, defined, carry, flag, out, last, done };
}

export function trace() {
  const out = [makeState()];
  while (!out[out.length - 1].done) out.push(step(out[out.length - 1]));
  return out;
}

export function readout(s) {
  const { loader, op, result } = s.last;
  let event;
  if (op === "loadClass") event = result === null ? "loadClass" : `loadClass → ${result}`;
  else if (op === "delegate") event = `delegated by ${result}`;
  else if (op === "parent") event = `parent of ${result}`;
  else if (op === "return") event = `${result} from ${s.last.from}${s.last.bare ? " (no class path)" : ""}`;
  else event = `${op} → ${result}`;
  return `${s.cn} | ${loader} | ${event}`;
}
