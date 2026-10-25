// Synthetic probe for the jvm-jit-tiers figure. One hot method, measure(Shape),
// climbs 0 -> 3 -> 4 while only Square reaches it, then a Circle breaks the
// type-profile assumption C2 compiled in, and the method climbs again.
// Run: see run.sh next to this file (the dontinline option keeps measure a real call,
// so its own counters and its own compiled code are what the log shows).
public class Tiers {
    interface Shape { int area(); }

    static final class Square implements Shape {
        final int s;
        Square(int s) { this.s = s; }
        public int area() { return s * s; }
    }

    static final class Circle implements Shape {
        final int r;
        Circle(int r) { this.r = r; }
        public int area() { return 3 * r * r; }
    }

    static int measure(Shape shape) {
        return shape.area() + 1;
    }

    static long sum;

    // Calls measure in small batches with a pause after each, so a queued
    // compilation has time to finish and the markers bracket where it landed.
    static int batches(Shape a, Shape b, int count, int size, int calls) throws InterruptedException {
        for (int n = 0; n < count; n++) {
            for (int j = 0; j < size; j++) {
                sum += measure((j & 1) == 0 ? a : b);
                calls++;
            }
            System.out.println("# calls=" + calls);
            Thread.sleep(10);
        }
        return calls;
    }

    public static void main(String[] args) throws InterruptedException {
        Shape square = new Square(3);
        Shape circle = new Circle(2);
        System.out.println("# phase 1: Square only");
        int calls = batches(square, square, 70, 100, 0);
        System.out.println("# phase 2: first Circle");
        calls = batches(circle, circle, 1, 1, calls);
        System.out.println("# phase 3: Square and Circle");
        calls = batches(square, circle, 70, 100, calls);
        System.out.println("# done sum=" + sum);
    }
}
