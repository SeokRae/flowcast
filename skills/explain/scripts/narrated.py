"""flowcast:explain 4단계 영상용 Manim 장면 도우미.

narrate.py가 만든 timings.json을 읽어, 장면을 내레이션 구간 길이에 맞춘다.
장면 코드는 구간마다 `with self.segment("s1") as d:` 블록 안에서 애니메이션을 재생한다.
블록이 끝나면 남은 시간을 wait로 채우고, 애니메이션이 내레이션보다 길면 경고를 찍는다.

    from narrated import NarratedScene
    from manim import *

    class Explainer(NarratedScene):
        def construct(self):
            with self.segment("s1") as d:
                title = self.text("이진 탐색", font_size=56)
                self.play(Write(title), run_time=min(2, d))

환경 변수 (render_video.sh가 채운다):
    EXPLAIN_TIMINGS  timings.json 경로 (기본: 현재 폴더의 timings.json)
    EXPLAIN_FONT     한글 글꼴 이름 (기본: Apple SD Gothic Neo)

이 모듈은 Manim 가상환경 안에서만 import된다. flowcast 코어(stdlib)와 섞지 않는다.
"""
import json
import math
import os
from contextlib import contextmanager

from manim import Scene, Text, config

OVERRUN_TOLERANCE = 0.05


class NarratedScene(Scene):
    font = os.environ.get("EXPLAIN_FONT", "Apple SD Gothic Neo")

    def setup(self):
        path = os.path.abspath(os.environ.get("EXPLAIN_TIMINGS", "timings.json"))
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        base = os.path.dirname(path)
        self._segments = {s["id"]: (os.path.join(base, s["file"]), float(s["duration"])) for s in data["segments"]}
        self._order = [s["id"] for s in data["segments"]]
        self._played = []

    def text(self, s, **kwargs):
        """한글이 두부(□)로 나오지 않게 글꼴을 채운 Text."""
        kwargs.setdefault("font", self.font)
        return Text(s, **kwargs)

    @contextmanager
    def segment(self, seg_id):
        """구간 하나: 음성을 깔고, 블록이 끝나면 남은 시간을 채운다. 구간 길이(초)를 내준다."""
        path, duration = self._segments[seg_id]
        self.add_sound(path)
        start = self.time
        yield duration
        elapsed = self.time - start
        if elapsed < duration:
            # 정지 프레임 wait은 int(duration / dt)로 내림된다. 구간마다 한 프레임씩 영상이
            # 음성보다 짧아지지 않게, 필요한 프레임 수를 올림한 뒤 반 프레임을 더해 넘긴다.
            dt = 1 / config.frame_rate
            self.wait((math.ceil((duration - elapsed) / dt) + 0.5) * dt)
        elif elapsed > duration + OVERRUN_TOLERANCE:
            print(f"[narrated] {seg_id}: 장면 {elapsed:.2f}s가 내레이션 {duration:.2f}s보다 길다. 다음 음성이 늦게 시작한다")
        self._played.append(seg_id)

    def tear_down(self):
        missing = [sid for sid in self._order if sid not in self._played]
        if missing:
            print(f"[narrated] 재생하지 않은 구간: {', '.join(missing)}")
        if self._played != [sid for sid in self._order if sid in self._played]:
            print("[narrated] 구간 재생 순서가 script.json 순서와 다르다")
