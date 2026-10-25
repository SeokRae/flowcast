// Synthetic allocation probe for one G1 young-GC figure (flowcast:mechanism, jvm-g1-gc). No real data.
// Every array it allocates is a byte[] of exactly 256 KiB (16-byte header + 262128 bytes).
// Three named blocks are kept in the static array keep (the only root that holds blocks); every other block is garbage at once.
// After each young GC it reads, with sun.misc.Unsafe, where each named block now lives and the age bits of its mark word.
import java.lang.ref.WeakReference;
import java.lang.reflect.Field;
import sun.misc.Unsafe;

public class Ages {
  static final int BLOCK_BYTES = 262144;
  static final int PAYLOAD = BLOCK_BYTES - 16;
  // block name, young GCs done when it is allocated, its index among the blocks of that period
  static final String[] NAME = { "A", "B", "C" };
  static final int[] BORN = { 0, 1, 2 };
  static final int[] AT = { 2, 1, 4 };
  static final int GCS = 3;

  static final Object[] keep = new Object[NAME.length];
  static final long[] allocAddr = new long[512];
  static final int[] allocEpoch = new int[512];
  static final int[] allocNamed = new int[512];
  static final long[][] afterAddr = new long[GCS][NAME.length];
  static final int[][] afterAge = new int[GCS][NAME.length];
  static Unsafe U;
  static long BASE;
  static WeakReference<Object> canary; // cleared by the first young GC after it is made

  // zero-based compressed oops with shift 3 (the GC log prints the mode)
  static long narrowToAddress(int narrow) { return (narrow & 0xffffffffL) << 3; }

  public static void main(String[] args) throws Exception {
    Field f = Unsafe.class.getDeclaredField("theUnsafe");
    f.setAccessible(true);
    U = (Unsafe) f.get(null);
    BASE = U.arrayBaseOffset(Object[].class);
    if (U.arrayIndexScale(Object[].class) != 4) throw new IllegalStateException("expects compressed oops");
    canary = new WeakReference<>(new Object());
    Object[] tmp = new Object[1];
    int epoch = 0, inEpoch = 0, n = 0;
    while (true) {
      byte[] b = new byte[PAYLOAD];
      if (canary.get() == null) {
        // the allocation that just ran triggered young GC number `epoch`, so b already sits in the new Eden
        canary = new WeakReference<>(new Object());
        for (int i = 0; i < NAME.length; i++) {
          if (keep[i] == null) continue;
          afterAddr[epoch][i] = narrowToAddress(U.getInt(keep, BASE + 4L * i));
          afterAge[epoch][i] = (int) ((U.getLong(keep[i], 0L) >>> 3) & 0xf); // markWord age, bits 3..6
        }
        epoch++;
        inEpoch = 0;
        if (epoch == GCS) break;
      }
      int named = -1;
      for (int i = 0; i < NAME.length; i++) if (BORN[i] == epoch && AT[i] == inEpoch) named = i;
      if (named >= 0) keep[named] = b;
      tmp[0] = b;
      allocAddr[n] = narrowToAddress(U.getInt(tmp, BASE));
      allocEpoch[n] = epoch;
      allocNamed[n] = named;
      // drop the frame's own references, so an unnamed block is garbage before the next allocation
      tmp[0] = null;
      b = null;
      n++;
      inEpoch++;
    }
    System.out.println("block_bytes " + BLOCK_BYTES);
    for (int i = 0; i < n; i++) {
      System.out.println("alloc epoch " + allocEpoch[i] + " addr 0x" + Long.toHexString(allocAddr[i]) + (allocNamed[i] >= 0 ? " name " + NAME[allocNamed[i]] : " garbage"));
    }
    for (int g = 0; g < GCS; g++) {
      for (int i = 0; i < NAME.length; i++) {
        if (BORN[i] > g) continue;
        System.out.println("after GC(" + g + ") " + NAME[i] + " addr 0x" + Long.toHexString(afterAddr[g][i]) + " age " + afterAge[g][i]);
      }
    }
  }
}
