package demo;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.Map;

// 앱 클래스 로더에 클래스 다섯 건을 차례로 요청하고, 요청 전후의 로더 상태를 찍는다.
// 실행: java --add-opens java.base/java.lang=ALL-UNNAMED --add-opens java.base/jdk.internal.loader=ALL-UNNAMED
//            -Xlog:class+load -cp <classes> demo.Probe
// 문자열 연결(invokedynamic)은 요청 구간에 클래스 적재를 섞으므로 print를 이어 쓴다.
public class Probe {
    static final String[] REQUESTS = {
        "java.time.Duration", // java.base: 부트 로더에 정의된 모듈
        "java.sql.Types",     // java.sql: 플랫폼 로더에 정의된 모듈
        "demo.Greeter",       // 이름 있는 모듈에 없는 패키지: 클래스 경로
        "demo.Greeter",       // 같은 이름 두 번째 요청
        "demo.Missing",       // 어디에도 없음
    };

    static Method findLoaded;
    static Field packageToModule;
    static Method moduleName;
    static Field moduleLoader;

    public static void main(String[] args) throws Exception {
        // catch 절의 예외 타입을 요청 구간 밖에서 미리 푼다 (상수 풀 항목을 공유한다)
        Class<?> cnfe = ClassNotFoundException.class;
        ClassLoader app = ClassLoader.getSystemClassLoader();
        ClassLoader platform = ClassLoader.getPlatformClassLoader();
        findLoaded = ClassLoader.class.getDeclaredMethod("findLoadedClass", String.class);
        findLoaded.setAccessible(true);
        Class<?> bcl = Class.forName("jdk.internal.loader.BuiltinClassLoader");
        packageToModule = bcl.getDeclaredField("packageToModule");
        packageToModule.setAccessible(true);
        Class<?> lm = Class.forName("jdk.internal.loader.BuiltinClassLoader$LoadedModule");
        moduleName = lm.getDeclaredMethod("name");
        moduleName.setAccessible(true);
        moduleLoader = lm.getDeclaredField("loader");
        moduleLoader.setAccessible(true);
        // 부트 레이어 모듈을 정의한 로더별로 모은다 (ModuleLayer.boot(), getClassLoader() == null 이면 boot)
        java.util.TreeSet<String> boot = new java.util.TreeSet<>();
        java.util.TreeSet<String> plat = new java.util.TreeSet<>();
        java.util.TreeSet<String> appMods = new java.util.TreeSet<>();
        for (Module m : ModuleLayer.boot().modules()) {
            ClassLoader l = m.getClassLoader();
            if (l == null) boot.add(m.getName());
            else if (l == platform) plat.add(m.getName());
            else if (l == app) appMods.add(m.getName());
        }
        line("layer.boot.modules", String.valueOf(boot.size()));
        line("layer.platform.modules", String.valueOf(plat.size()));
        line("layer.app.modules", String.valueOf(appMods.size()));
        line("layer.boot", boot.toString());
        line("layer.platform", plat.toString());
        line("layer.app", appMods.toString());
        line("layer.java.sql", String.valueOf(ModuleLayer.boot().findModule("java.sql").get().getClassLoader().getName()));
        line("main.loader", Probe.class.getClassLoader().getName());
        line("app.name", app.getName());
        line("app.parent", app.getParent().getName());
        line("platform.parent", String.valueOf(platform.getParent()));
        line("cnfe", cnfe.getName());

        for (int i = 0; i < REQUESTS.length; i++) {
            String cn = REQUESTS[i];
            String pn = cn.substring(0, cn.lastIndexOf('.'));
            System.out.print("== request ");
            System.out.print(i);
            System.out.print(' ');
            System.out.println(cn);
            line("  package", pn);
            line("  packageToModule", describe(((Map<?, ?>) packageToModule.get(null)).get(pn)));
            line("  before app.findLoadedClass", found(app, cn));
            line("  before platform.findLoadedClass", found(platform, cn));
            System.out.println("  -- loadClass begin");
            System.out.flush();
            Class<?> c = request(app, cn);
            System.out.flush();
            System.out.println("  -- loadClass end");
            if (c != null) {
                ClassLoader def = c.getClassLoader();
                line("  getClassLoader", def == null ? "null (bootstrap)" : def.getName());
                line("  getModule", String.valueOf(c.getModule().getName()));
            }
            line("  after app.findLoadedClass", found(app, cn));
            line("  after platform.findLoadedClass", found(platform, cn));
            System.out.flush();
        }
    }

    // JDI 추적기는 이 메서드에 들어오고 나가는 동안만 로더 메서드를 기록한다
    static Class<?> request(ClassLoader app, String cn) {
        try {
            return app.loadClass(cn);
        } catch (ClassNotFoundException e) {
            System.out.print("  ClassNotFoundException: ");
            System.out.println(e.getMessage());
            return null;
        }
    }

    static String found(ClassLoader loader, String cn) throws Exception {
        return findLoaded.invoke(loader, cn) == null ? "null" : "hit";
    }

    static String describe(Object loaded) throws Exception {
        if (loaded == null) return "null (no named module)";
        Object loader = moduleLoader.get(loaded);
        String ln = ((ClassLoader) loader).getName();
        StringBuilder sb = new StringBuilder();
        sb.append(moduleName.invoke(loaded)).append(" -> ").append(ln == null ? "boot" : ln);
        return sb.toString();
    }

    static void line(String key, String value) {
        System.out.print(key);
        System.out.print(": ");
        System.out.println(value);
    }
}
