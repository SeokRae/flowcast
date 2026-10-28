# 4단계: 설명 영상 (Manim + 내레이션)

3Blue1Brown 스타일 설명 영상 1편을 mp4로 만든다. 순서는 원고 → 음성 → 장면 → 렌더다. **내레이션이 먼저고 장면이 따라간다.** 음성 길이를 재고, 장면은 그 길이에 맞춘다.

## 준비 (한 번)

| 의존성 | 확인 | 설치 |
|---|---|---|
| Manim CE | `~/.local/share/flowcast-video/venv/bin/manim --version` | 아래 명령 |
| ffmpeg, ffprobe | `ffprobe -version` | `brew install ffmpeg` |
| 내레이션 | macOS `say -v '?' \| grep ko_KR` (기본 Yuna) | 내장. ElevenLabs는 `ELEVENLABS_API_KEY` |

```bash
brew install cairo pango pkgconf          # pycairo 빌드에 pkg-config가 필요하다
uv venv --python 3.12 ~/.local/share/flowcast-video/venv
uv pip install --python ~/.local/share/flowcast-video/venv/bin/python manim
```

다른 경로에 깔았으면 `FLOWCAST_VIDEO_VENV`로 알린다. 의존성이 없으면 `render_video.sh`가 exit 3(blocked)으로 멈춘다. 설치는 사용자에게 확인받고 한다. LaTeX는 쓰지 않는다. 수식은 `Text`와 유니코드(₂, ⁴, ⌊ ⌋, ≤, ÷)로 그린다.

## 1. 원고: `script.json`

```json
{
  "title": "이진 탐색은 왜 빨리 끝날까",
  "engine": "say",
  "voice": "Yuna",
  "segments": [
    {"id": "s1", "text": "이진 탐색은 정렬된 목록에서 값을 찾는 방법입니다."}
  ]
}
```

- 구간 하나 = 화면에서 일어나는 일 하나. 구간 하나는 5~12초(내레이션 2~4문장)가 알맞다.
- 내레이션은 1단계 규칙(`plain-ko.md`, `plain-en.md`)으로 쓴다. 귀로 듣는 글이라 문장이 짧을수록 좋다.
- 기호는 읽는 말로 쓴다. 화면에 `log₂ n`을 띄우고 원고에는 "로그 2 n"이라고 쓴다.
- **렌더 전에 원고를 사용자에게 보여주고 확인받는다.** 렌더는 몇 분이 걸리고, 원고가 영상의 뼈대다.

## 2. 음성: `narrate.py`

```bash
python3 {skill}/scripts/narrate.py WORK/script.json -o WORK
```

`WORK/audio/{id}.wav`와 `WORK/timings.json`(구간별 길이, 합계)을 만든다. `--engine elevenlabs --voice {voice_id}`로 엔진을 바꾼다. ElevenLabs 경로는 `eleven_multilingual_v2` 모델로 PCM 24kHz를 받아 WAV로 감싼다. 이 경로는 API 키가 없는 환경에서 만들어 아직 실제 호출로 검증하지 않았다.

## 3. 장면: `scenes.py`

클래스 이름은 `Explainer`, 부모는 `NarratedScene`(`scripts/narrated.py`)이다.

```python
from manim import *
from narrated import NarratedScene

class Explainer(NarratedScene):
    def construct(self):
        with self.segment("s1") as d:          # d = 이 구간 음성 길이(초)
            title = self.text("이진 탐색", font_size=52)
            self.play(Write(title), run_time=min(2, d * 0.4))
```

- `segment(id)`가 음성을 깔고, 블록이 끝나면 남은 시간을 프레임 단위로 올림해 채운다. 애니메이션이 음성보다 길면 `[narrated]` 경고를 찍는다. 경고가 나오면 `run_time`을 `d`의 비율로 줄인다.
- 모든 `play`는 `segment` 블록 안에 둔다. 블록 밖 애니메이션은 다음 음성을 늦춘다.
- 한글은 `self.text(...)`로 만든다. 글꼴이 비면 한글이 두부(□)로 나온다. 기본 글꼴은 Apple SD Gothic Neo이고 `EXPLAIN_FONT`로 바꾼다.

### 3b1b 스타일 규칙

1. **화면 하나에 생각 하나.** 새 생각이 오면 이전 것을 치우거나 흐리게 한다.
2. **쌓아 올린다.** 결론을 먼저 띄우지 않는다. 구체적인 예(칸 16개)로 시작하고 일반식(n)으로 끝낸다.
3. **바꿔서 보여준다.** 새 물체를 띄우기보다 있던 물체를 `Transform`, `animate`로 바꾼다. 무엇이 무엇이 됐는지 눈이 따라간다.
4. **색은 의미 하나에 하나.** 예: 노랑 = 지금 보는 것, 초록 = 찾은 것, 흐림 = 버린 것. 영상 끝까지 바꾸지 않는다.
5. **글자는 적게.** 화면 글은 라벨과 식만. 설명은 내레이션이 한다.

## 4. 렌더와 검증: `render_video.sh`

```bash
bash {skill}/scripts/render_video.sh WORK NAME [l|m|h]   # l=480p15, m=720p30(기본), h=1080p60
```

결과는 `WORK/NAME.mp4`다. 스크립트가 끝에서 두 가지를 검사한다. 오디오 스트림이 있는가, 영상 길이가 내레이션 합보다 짧지 않은가. 어긋나면 exit 4다.

검사를 통과해도 화면은 눈으로 확인한다. 구간마다 프레임을 하나씩 뽑아 한 장으로 붙여 본다.

```bash
ffmpeg -v error -ss {초} -i WORK/NAME.mp4 -frames:v 1 WORK/f_1.png    # 구간마다
ffmpeg -v error -i WORK/f_%d.png -filter_complex "tile=2x3" WORK/sheet.png
```

볼 것: 한글과 기호가 두부로 나오지 않는가, 글자가 화면 밖으로 나가지 않는가, 화면의 숫자와 상태가 내레이션과 맞는가.

처음에는 `l`로 렌더해 확인하고, 확정되면 `m`이나 `h`로 다시 렌더한다. `WORK/media/`는 Manim 캐시라 지워도 된다.
