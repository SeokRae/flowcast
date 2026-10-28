#!/usr/bin/env python3
"""flowcast:explain 4단계 내레이션 생성기 (stdlib만).

script.json의 구간별 내레이션을 WAV로 만들고, 구간 길이를 timings.json에 적는다.
장면(scenes.py)은 이 길이에 맞춰 움직인다. 내레이션이 먼저고 장면이 따라간다.

script.json:
    {
      "title": "이진 탐색은 왜 log n번이면 끝나는가",
      "engine": "say",            # 선택. say(기본, macOS) | elevenlabs
      "voice": "Yuna",            # 선택. say는 음성 이름, elevenlabs는 voice_id
      "rate": 180,                # 선택. say 전용, 분당 단어 수
      "segments": [
        {"id": "s1", "text": "정렬된 칸 16개에서 23을 찾습니다."}
      ]
    }

출력 (OUT_DIR):
    audio/{id}.wav
    timings.json  {"engine", "voice", "total", "segments": [{"id", "file", "duration"}]}

엔진:
    say         macOS 내장 TTS. 로컬에서 돌고 비용이 없다. 한국어 음성은 `say -v '?' | grep ko_KR`.
    elevenlabs  ELEVENLABS_API_KEY 환경변수가 필요하다. voice는 voice_id이고,
                없으면 ELEVENLABS_VOICE_ID를 쓴다. PCM으로 받아 WAV로 감싸므로 ffmpeg가 필요 없다.

종료 코드: 0 성공, 2 입력 오류, 3 엔진을 쓸 수 없음(blocked).

사용:
    python3 narrate.py script.json -o WORK_DIR [--engine say|elevenlabs] [--voice NAME]
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
import wave

ID_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
DEFAULT_VOICE = {"say": "Yuna", "elevenlabs": None}
ELEVEN_URL = "https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=pcm_24000"
ELEVEN_MODEL = "eleven_multilingual_v2"
ELEVEN_RATE = 24000


class Blocked(Exception):
    """엔진을 쓸 수 없다. 입력 오류와 구분해 종료 코드 3으로 보고한다."""


def load_script(path):
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return validate_script(data)


def validate_script(data):
    """script.json 구조를 검사하고 오류 목록이 있으면 ValueError로 올린다."""
    errors = []
    segments = data.get("segments")
    if not isinstance(segments, list) or not segments:
        errors.append("segments: 구간이 하나 이상 있어야 한다")
        segments = []
    seen = set()
    for i, seg in enumerate(segments):
        sid = seg.get("id") if isinstance(seg, dict) else None
        text = seg.get("text") if isinstance(seg, dict) else None
        if not isinstance(sid, str) or not ID_RE.match(sid):
            errors.append(f"segments[{i}].id: 소문자, 숫자, -, _ 만 쓴다 ({sid!r})")
        elif sid in seen:
            errors.append(f"segments[{i}].id: 중복 ({sid})")
        else:
            seen.add(sid)
        if not isinstance(text, str) or not text.strip():
            errors.append(f"segments[{i}].text: 비어 있다")
    engine = data.get("engine", "say")
    if engine not in DEFAULT_VOICE:
        errors.append(f"engine: say | elevenlabs ({engine!r})")
    if errors:
        raise ValueError("\n".join(errors))
    return data


def wav_duration(path):
    with wave.open(path, "rb") as w:
        return w.getnframes() / float(w.getframerate())


def synth_say(text, out_path, voice, rate):
    if not shutil.which("say"):
        raise Blocked("say 명령이 없다 (macOS 전용). --engine elevenlabs를 쓰거나 macOS에서 실행한다")
    with tempfile.NamedTemporaryFile("w", suffix=".txt", encoding="utf-8", delete=False) as tf:
        tf.write(text)
        text_path = tf.name
    cmd = ["say", "-v", voice, "--file-format=WAVE", "--data-format=LEI16@24000", "-o", out_path, "-f", text_path]
    if rate:
        cmd[1:1] = ["-r", str(rate)]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
    finally:
        os.unlink(text_path)
    if result.returncode != 0:
        raise Blocked(f"say 실패 (음성 {voice!r}): {result.stderr.strip()}")


def synth_elevenlabs(text, out_path, voice):
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise Blocked("ELEVENLABS_API_KEY가 없다")
    if not voice:
        raise Blocked("voice_id가 없다 (script.json voice 또는 ELEVENLABS_VOICE_ID)")
    body = json.dumps({"text": text, "model_id": ELEVEN_MODEL}).encode("utf-8")
    req = urllib.request.Request(
        ELEVEN_URL.format(voice=voice),
        data=body,
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            pcm = resp.read()
    except urllib.error.HTTPError as e:
        raise Blocked(f"ElevenLabs HTTP {e.code}: {e.read()[:300].decode('utf-8', 'replace')}")
    except urllib.error.URLError as e:
        raise Blocked(f"ElevenLabs 연결 실패: {e.reason}")
    with wave.open(out_path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(ELEVEN_RATE)
        w.writeframes(pcm)


def narrate(data, out_dir, engine=None, voice=None):
    engine = engine or data.get("engine", "say")
    voice = voice or data.get("voice") or DEFAULT_VOICE.get(engine)
    if engine == "elevenlabs" and not voice:
        voice = os.environ.get("ELEVENLABS_VOICE_ID")
    audio_dir = os.path.join(out_dir, "audio")
    os.makedirs(audio_dir, exist_ok=True)
    rows = []
    for seg in data["segments"]:
        rel = os.path.join("audio", f"{seg['id']}.wav")
        path = os.path.join(out_dir, rel)
        if engine == "say":
            synth_say(seg["text"].strip(), path, voice, data.get("rate"))
        else:
            synth_elevenlabs(seg["text"].strip(), path, voice)
        rows.append({"id": seg["id"], "file": rel, "duration": round(wav_duration(path), 3)})
    timings = {
        "engine": engine,
        "voice": voice,
        "total": round(sum(r["duration"] for r in rows), 3),
        "segments": rows,
    }
    with open(os.path.join(out_dir, "timings.json"), "w", encoding="utf-8") as f:
        json.dump(timings, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return timings


def main(argv=None):
    ap = argparse.ArgumentParser(description="script.json → audio/*.wav + timings.json")
    ap.add_argument("script")
    ap.add_argument("-o", "--out", required=True, help="작업 폴더 (audio/와 timings.json을 쓴다)")
    ap.add_argument("--engine", choices=sorted(DEFAULT_VOICE))
    ap.add_argument("--voice")
    args = ap.parse_args(argv)
    try:
        data = load_script(args.script)
    except (OSError, json.JSONDecodeError, ValueError) as e:
        print(f"입력 오류: {e}", file=sys.stderr)
        return 2
    try:
        timings = narrate(data, args.out, args.engine, args.voice)
    except Blocked as e:
        print(f"blocked: {e}", file=sys.stderr)
        return 3
    for row in timings["segments"]:
        print(f"{row['id']}\t{row['duration']:.2f}s")
    print(f"total\t{timings['total']:.2f}s ({timings['engine']}, {timings['voice']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
