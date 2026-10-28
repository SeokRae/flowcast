"""flowcast:explain 예제 (합성): 이진 탐색은 왜 빨리 끝날까.

16칸에서 맨 끝 값을 찾는 가장 긴 경우를 보여준다. 가운데 칸은 (lo + hi) // 2이고,
남는 칸이 16, 8, 4, 2, 1로 정확히 절반씩 줄어 비교는 5번(floor(log2 16) + 1)이다.

렌더: narrate.py로 timings.json을 만든 뒤 render_video.sh로 렌더한다 (references/video.md).
"""
from manim import (
    BLUE_C, DOWN, GREEN, GREY_B, LEFT, PI, RIGHT, UP, YELLOW,
    Arrow, Brace, Create, FadeIn, FadeOut, Group, GrowFromCenter, Indicate,
    Square, Triangle, VGroup, Write,
)

from narrated import NarratedScene

VALUES = [2, 5, 8, 11, 13, 15, 17, 19, 21, 23, 26, 29, 31, 34, 37, 40]
TARGET = 40


class Explainer(NarratedScene):
    def construct(self):
        self.lo, self.hi, self.count = 0, len(VALUES) - 1, 0

        with self.segment("s1") as d:
            title = self.text("이진 탐색은 왜 빨리 끝날까", font_size=52)
            sub = self.text("칸 16개, 비교는 많아야 5번", font_size=32, color=GREY_B).next_to(title, DOWN)
            self.play(Write(title), run_time=min(2.0, d * 0.4))
            self.play(FadeIn(sub, shift=UP * 0.2), run_time=1.0)

        with self.segment("s2") as d:
            self.play(FadeOut(title), FadeOut(sub), run_time=0.6)
            self.cells = VGroup(*[self.cell(v) for v in VALUES]).arrange(RIGHT, buff=0.08).shift(DOWN * 0.3)
            goal = self.text(f"찾는 값  {TARGET}", font_size=30, color=YELLOW).to_corner(UP + LEFT)
            self.status = self.status_text()
            self.play(Create(self.cells), run_time=min(2.0, d * 0.35))
            self.play(FadeIn(goal), FadeIn(self.status), run_time=0.8)

        with self.segment("s3") as d:
            self.compare(step_time=d * 0.7)

        with self.segment("s4") as d:
            for _ in range(3):
                self.compare(step_time=d * 0.85 / 3)

        with self.segment("s5") as d:
            self.compare(step_time=min(2.5, d * 0.6))

        with self.segment("s6") as d:
            self.play(FadeOut(Group(*self.mobjects)), run_time=0.6)
            sizes = VGroup(*[self.text(str(n), font_size=48) for n in (16, 8, 4, 2, 1)]).arrange(RIGHT, buff=1.3)
            arrows, halves = VGroup(), VGroup()
            for a, b in zip(sizes[:-1], sizes[1:]):
                arrow = Arrow(a.get_right(), b.get_left(), buff=0.2, color=GREY_B)
                arrows.add(arrow)
                halves.add(self.text("÷2", font_size=26, color=BLUE_C).next_to(arrow, UP, buff=0.1))
            chain = VGroup(sizes, arrows, halves).move_to(UP * 0.8)
            brace = Brace(arrows, DOWN, buff=0.5)
            times = self.text("반으로 4번  (16 = 2⁴)", font_size=30).next_to(brace, DOWN)
            rule = self.text("비교 횟수 ≤ ⌊log₂ n⌋ + 1", font_size=40, color=YELLOW).next_to(times, DOWN, buff=0.6)
            step = d * 0.15
            self.play(FadeIn(sizes[0]), run_time=0.5)
            for i in range(4):
                self.play(Create(arrows[i]), FadeIn(halves[i]), FadeIn(sizes[i + 1]), run_time=step)
            self.play(GrowFromCenter(brace), FadeIn(times), run_time=1.0)
            self.play(Write(rule), run_time=1.2)

    def cell(self, value):
        box = Square(side_length=0.66, stroke_color=BLUE_C, stroke_width=3)
        return VGroup(box, self.text(str(value), font_size=22).move_to(box))

    def status_text(self):
        remaining = self.hi - self.lo + 1
        return self.text(f"남은 칸  {remaining}     비교  {self.count}", font_size=28).to_corner(UP + RIGHT)

    def compare(self, step_time):
        """가운데 칸 하나를 비교하고, 40이 있을 수 없는 쪽을 흐리게 한다."""
        mid = (self.lo + self.hi) // 2
        self.count += 1
        pointer = Triangle(color=YELLOW, fill_opacity=1).scale(0.12).rotate(PI).next_to(self.cells[mid], UP, buff=0.12)
        part = step_time / 3
        self.play(FadeIn(pointer, shift=DOWN * 0.2), self.cells[mid][0].animate.set_stroke(YELLOW, width=6), run_time=part)
        if VALUES[mid] == TARGET:
            self.lo = self.hi = mid
            found = self.status_text()
            self.play(self.cells[mid][0].animate.set_fill(GREEN, opacity=0.5), self.status.animate.become(found), run_time=part)
            self.play(Indicate(self.cells[mid], color=GREEN), run_time=part)
            return
        if VALUES[mid] < TARGET:
            dropped = range(self.lo, mid + 1)
            self.lo = mid + 1
        else:
            dropped = range(mid, self.hi + 1)
            self.hi = mid - 1
        status = self.status_text()
        self.play(*[self.cells[i].animate.fade(0.75) for i in dropped], self.status.animate.become(status), run_time=part)
        self.play(FadeOut(pointer), run_time=part)
