package demo;

// 클래스 경로에만 있는 합성 클래스. Probe는 이 이름을 문자열로만 들고 있어서 상수 풀로 미리 풀리지 않는다.
public class Greeter {
    public static String hello() {
        return "hello";
    }
}
