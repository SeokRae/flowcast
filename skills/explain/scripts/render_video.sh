#!/usr/bin/env bash
# render_video.sh: flowcast:explain 4단계, scenes.py + timings.json → mp4
#
# 사용: bash render_video.sh WORK_DIR NAME [l|m|h]
#   WORK_DIR  scenes.py(클래스 Explainer)와 timings.json(narrate.py 출력)이 있는 폴더
#   NAME      출력 파일 이름 (확장자 없이). 결과는 WORK_DIR/NAME.mp4
#   품질      l=480p15, m=720p30(기본), h=1080p60
#
# 실패 방향: 의존성이 없으면 exit 3(blocked)으로 멈추고 설치 방법을 알린다.
# 렌더 뒤 검증(오디오 스트림 존재, 영상 길이 >= 내레이션 합)이 어긋나면 exit 4.
set -euo pipefail

[ $# -ge 2 ] || { echo "사용: render_video.sh WORK_DIR NAME [l|m|h]" >&2; exit 2; }
WORK="$(cd "$1" && pwd)"
NAME="$2"
Q="${3:-m}"
HERE="$(cd "$(dirname "$0")" && pwd)"
VENV="${FLOWCAST_VIDEO_VENV:-$HOME/.local/share/flowcast-video/venv}"
MANIM="$VENV/bin/manim"

case "$Q" in l|m|h) ;; *) echo "품질은 l, m, h 중 하나" >&2; exit 2 ;; esac
[ -x "$MANIM" ] || { echo "blocked: Manim이 없다 ($MANIM). skills/explain/references/video.md의 설치 절차를 따른다" >&2; exit 3; }
command -v ffprobe >/dev/null || { echo "blocked: ffprobe가 없다 (brew install ffmpeg)" >&2; exit 3; }
[ -f "$WORK/scenes.py" ] || { echo "$WORK/scenes.py가 없다" >&2; exit 2; }
[ -f "$WORK/timings.json" ] || { echo "$WORK/timings.json이 없다. narrate.py를 먼저 돌린다" >&2; exit 2; }

cd "$WORK"
EXPLAIN_TIMINGS="$WORK/timings.json" PYTHONPATH="$HERE${PYTHONPATH:+:$PYTHONPATH}" \
  "$MANIM" render "-q$Q" --media_dir "$WORK/media" -o "$NAME" scenes.py Explainer

OUT="$(find "$WORK/media/videos/scenes" -name "$NAME.mp4" -newer "$WORK/timings.json" | head -1)"
[ -n "$OUT" ] || { echo "렌더 결과 $NAME.mp4를 찾지 못했다" >&2; exit 4; }
cp "$OUT" "$WORK/$NAME.mp4"

# 검증: 오디오 스트림이 있고, 영상이 내레이션보다 짧지 않다.
VIDEO_DUR="$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$WORK/$NAME.mp4")"
AUDIO="$(ffprobe -v error -select_streams a -show_entries stream=codec_type -of csv=p=0 "$WORK/$NAME.mp4" | head -1)"
python3 - "$WORK/timings.json" "$VIDEO_DUR" "$AUDIO" "$WORK/$NAME.mp4" <<'PY'
import json, sys
timings, video, audio, path = sys.argv[1], float(sys.argv[2]), sys.argv[3], sys.argv[4]
total = json.load(open(timings, encoding="utf-8"))["total"]
print(f"영상 {video:.2f}s, 내레이션 합 {total:.2f}s, 오디오 스트림 {'있음' if audio else '없음'}")
problems = []
if not audio:
    problems.append("오디오 스트림이 없다")
if video + 0.1 < total:
    problems.append("영상이 내레이션보다 짧다")
if problems:
    print("검증 실패: " + ", ".join(problems), file=sys.stderr)
    sys.exit(4)
print(path)
PY
