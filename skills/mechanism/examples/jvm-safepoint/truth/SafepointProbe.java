import java.nio.file.Files;
import java.nio.file.Path;

// Synthetic probe for the jvm-safepoint figure (flowcast:mechanism).
// Five Java threads sit in different HotSpot states, then main calls System.gc(),
// which runs the G1CollectFull VM operation at a global safepoint.
// run.sh records -Xlog:safepoint* while this runs.
public class SafepointProbe {
    static volatile boolean stop = false;
    static volatile long sink;
    static final Object LOCK = new Object();

    // Hot loop: C2 compiles it (OSR), so the thread polls in compiled code.
    static long compiledLoop() {
        long x = 1;
        while (!stop) {
            x = x * 31 + 7;
        }
        return x;
    }

    // Same loop, but run.sh excludes it from JIT: it stays in the interpreter,
    // which polls on backward branches and returns.
    static long interpretedLoop() {
        long x = 1;
        while (!stop) {
            x = x * 31 + 7;
        }
        return x;
    }

    public static void main(String[] args) throws Exception {
        Path go = Path.of(args[0]);
        Thread compiled = new Thread(() -> sink = compiledLoop(), "compiled");
        Thread interp = new Thread(() -> sink = interpretedLoop(), "interp");
        // System.in is a pipe that never gets data: the thread stays in native read.
        Thread nat = new Thread(() -> {
            try { sink = System.in.read(); } catch (Exception e) { }
        }, "native");
        Thread sleeping = new Thread(() -> {
            try { Thread.sleep(60_000); } catch (InterruptedException e) { }
        }, "sleeper");
        Thread waiting = new Thread(() -> {
            synchronized (LOCK) {
                try { LOCK.wait(); } catch (InterruptedException e) { }
            }
        }, "waiter");
        for (Thread t : new Thread[] {compiled, interp, nat, sleeping, waiting}) {
            t.setDaemon(true);
            t.start();
        }
        // run.sh takes a thread dump, then creates the go file.
        while (!Files.exists(go)) Thread.sleep(50);
        for (Thread t : new Thread[] {compiled, interp, nat, sleeping, waiting}) {
            System.out.println("before gc: " + t.getName() + " " + t.getState());
        }
        System.gc();
        System.out.println("after gc");
        stop = true;
        compiled.join();
        interp.join();
        System.out.println("loops stopped");
    }
}
