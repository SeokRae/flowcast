import com.sun.jdi.*;
import com.sun.jdi.connect.Connector;
import com.sun.jdi.connect.LaunchingConnector;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.util.*;

// JDI로 demo.Probe를 띄우고, Probe.request() 안에서 일어나는 로더 메서드 호출과 반환값을 기록한다.
// 실행: java LoaderTrace.java <classes 경로>
// 출력 한 줄 = 메서드 하나의 반환: "<요청 번호> <로더> <메서드> <인자> -> <반환값>"
public class LoaderTrace {
    // 기록하는 메서드: BuiltinClassLoader.loadClassOrNull(cn, resolve)의 판단 지점과 부트 로더 진입점
    static final Set<String> WATCH = Set.of(
        "loadClassOrNull", "findLoadedClass", "findLoadedModule", "findClassInModuleOrNull",
        "hasClassPath", "findClassOnClassPathOrNull", "findBootstrapClassOrNull", "loadClass");

    public static void main(String[] args) throws Exception {
        LaunchingConnector lc = Bootstrap.virtualMachineManager().defaultConnector();
        Map<String, Connector.Argument> a = lc.defaultArguments();
        a.get("main").setValue("demo.Probe");
        a.get("options").setValue("-cp " + args[0]
            + " --add-opens java.base/java.lang=ALL-UNNAMED --add-opens java.base/jdk.internal.loader=ALL-UNNAMED");
        VirtualMachine vm = lc.launch(a);
        Process p = vm.process();
        Thread pump = new Thread(() -> { try { p.getInputStream().transferTo(System.err); } catch (Exception e) { } });
        pump.start();
        new Thread(() -> { try { p.getErrorStream().transferTo(System.err); } catch (Exception e) { } }).start();

        EventRequestManager erm = vm.eventRequestManager();
        MethodEntryRequest probeIn = erm.createMethodEntryRequest();
        probeIn.addClassFilter("demo.Probe");
        probeIn.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        probeIn.enable();
        MethodExitRequest probeOut = erm.createMethodExitRequest();
        probeOut.addClassFilter("demo.Probe");
        probeOut.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
        probeOut.enable();

        List<EventRequest> loaderReqs = null;
        int req = -1;
        boolean done = false;
        while (!done) {
            EventSet set = vm.eventQueue().remove();
            for (Event e : set) {
                if (e instanceof VMDeathEvent || e instanceof VMDisconnectEvent) { done = true; break; }
                if (e instanceof MethodEntryEvent me && me.method().declaringType().name().equals("demo.Probe")) {
                    if (!me.method().name().equals("request")) continue;
                    req++;
                    if (loaderReqs == null) {
                        loaderReqs = new ArrayList<>();
                        for (String pattern : List.of("jdk.internal.loader.*", "java.lang.ClassLoader")) {
                            MethodExitRequest r = erm.createMethodExitRequest();
                            r.addClassFilter(pattern);
                            r.addThreadFilter(me.thread());
                            r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                            loaderReqs.add(r);
                        }
                        // 예외로 끝나는 메서드는 MethodExit가 오지 않는다: 던지는 지점을 따로 기록한다
                        ExceptionRequest x = erm.createExceptionRequest(null, true, true);
                        x.addThreadFilter(me.thread());
                        x.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                        loaderReqs.add(x);
                    }
                    loaderReqs.forEach(EventRequest::enable);
                    System.out.println("request " + req + " " + str(me.thread().frame(0).getArgumentValues().get(1)));
                } else if (e instanceof ExceptionEvent ex) {
                    Location at = ex.location();
                    StackFrame f = ex.thread().frame(0);
                    List<Value> args0 = f.getArgumentValues();
                    String arg = args0.isEmpty() ? "" : str(args0.get(0));
                    String loader = at.method().isStatic() ? "boot" : loaderName(f.thisObject());
                    System.out.println("  " + req + " " + loader + " " + simple(at.declaringType().name()) + "." + at.method().name()
                        + "(" + arg + ") throws " + ex.exception().referenceType().name());
                } else if (e instanceof MethodExitEvent mx) {
                    String type = mx.method().declaringType().name();
                    if (type.equals("demo.Probe")) {
                        if (mx.method().name().equals("request") && loaderReqs != null) loaderReqs.forEach(EventRequest::disable);
                        continue;
                    }
                    String name = mx.method().name();
                    if (!WATCH.contains(name)) continue;
                    StackFrame f = mx.thread().frame(0);
                    List<Value> args0 = f.getArgumentValues();
                    String arg = args0.isEmpty() ? "" : str(args0.get(0));
                    String loader = mx.method().isStatic() ? "boot" : loaderName(f.thisObject());
                    System.out.println("  " + req + " " + loader + " " + simple(type) + "." + name + "(" + arg + ") -> " + str(mx.returnValue()));
                }
            }
            set.resume();
        }
        pump.join();
    }

    static String simple(String type) {
        return type.substring(type.lastIndexOf('.') + 1);
    }

    // ClassLoader.name 필드: 부트 로더(ClassLoaders$BootClassLoader)는 null
    static String loaderName(ObjectReference o) {
        Value v = o.getValue(((ClassType) o.referenceType()).fieldByName("name"));
        return v == null ? "boot" : ((StringReference) v).value();
    }

    static String str(Value v) {
        if (v == null) return "null";
        if (v instanceof StringReference s) return s.value();
        if (v instanceof ClassObjectReference c) return "class " + c.reflectedType().name();
        if (v instanceof ObjectReference o && o.referenceType().name().endsWith("$LoadedModule")) {
            ObjectReference loader = (ObjectReference) o.getValue(((ClassType) o.referenceType()).fieldByName("loader"));
            ObjectReference mref = (ObjectReference) o.getValue(((ClassType) o.referenceType()).fieldByName("mref"));
            ObjectReference desc = (ObjectReference) fieldOf(mref, "descriptor");
            return "module " + ((StringReference) fieldOf(desc, "name")).value() + " @" + loaderName(loader);
        }
        if (v instanceof BooleanValue b) return String.valueOf(b.value());
        if (v instanceof VoidValue) return "void";
        return v.toString();
    }

    static Value fieldOf(ObjectReference o, String field) {
        for (ReferenceType t = o.referenceType(); t != null; t = ((ClassType) t).superclass()) {
            Field f = t.fieldByName(field);
            if (f != null) return o.getValue(f);
            if (!(t instanceof ClassType)) break;
        }
        throw new IllegalStateException(field);
    }
}
