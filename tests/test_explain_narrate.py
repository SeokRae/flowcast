"""flowcast:explain 내레이션 생성기(narrate.py) 테스트.

실제 TTS는 부르지 않는다. 합성 함수를 무음 WAV를 쓰는 가짜로 바꿔 구조 검사,
길이 계산, timings.json 형식, blocked 종료 코드만 확인한다.
"""

import importlib.util
import json
import wave
from pathlib import Path

import pytest


ROOT = Path(__file__).parent.parent
SKILL = ROOT / "skills" / "explain"
SCRIPT = SKILL / "scripts" / "narrate.py"

_spec = importlib.util.spec_from_file_location("explain_narrate", SCRIPT)
narrate = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(narrate)


def _silent_wav(path, seconds, rate=24000):
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(b"\x00\x00" * int(seconds * rate))


def _script(**overrides):
    data = {
        "title": "t",
        "segments": [
            {"id": "s1", "text": "첫 문장입니다."},
            {"id": "s2", "text": "둘째 문장입니다."},
        ],
    }
    data.update(overrides)
    return data


def test_validate_accepts_minimal_script():
    assert narrate.validate_script(_script())["segments"][0]["id"] == "s1"


@pytest.mark.parametrize(
    "segments, message",
    [
        ([], "구간이 하나 이상"),
        ([{"id": "S1", "text": "x"}], "소문자"),
        ([{"id": "s1", "text": "x"}, {"id": "s1", "text": "y"}], "중복"),
        ([{"id": "s1", "text": "  "}], "비어 있다"),
    ],
)
def test_validate_rejects_bad_segments(segments, message):
    with pytest.raises(ValueError, match=message):
        narrate.validate_script(_script(segments=segments))


def test_validate_rejects_unknown_engine():
    with pytest.raises(ValueError, match="engine"):
        narrate.validate_script(_script(engine="festival"))


def test_narrate_writes_audio_and_timings(tmp_path, monkeypatch):
    lengths = {"첫 문장입니다.": 1.5, "둘째 문장입니다.": 0.75}
    calls = []

    def fake_say(text, out_path, voice, rate):
        calls.append(voice)
        _silent_wav(out_path, lengths[text])

    monkeypatch.setattr(narrate, "synth_say", fake_say)
    timings = narrate.narrate(_script(), str(tmp_path))

    assert calls == ["Yuna", "Yuna"]
    assert [s["duration"] for s in timings["segments"]] == [1.5, 0.75]
    assert timings["total"] == 2.25
    on_disk = json.loads((tmp_path / "timings.json").read_text(encoding="utf-8"))
    assert on_disk == timings
    for seg in on_disk["segments"]:
        assert (tmp_path / seg["file"]).is_file()


def test_main_reports_blocked_with_exit_3(tmp_path, monkeypatch, capsys):
    script = tmp_path / "script.json"
    script.write_text(json.dumps(_script(), ensure_ascii=False), encoding="utf-8")
    monkeypatch.setattr(narrate.shutil, "which", lambda name: None)

    assert narrate.main([str(script), "-o", str(tmp_path / "out")]) == 3
    assert "blocked" in capsys.readouterr().err


def test_main_reports_input_error_with_exit_2(tmp_path, capsys):
    script = tmp_path / "script.json"
    script.write_text(json.dumps({"segments": []}), encoding="utf-8")

    assert narrate.main([str(script), "-o", str(tmp_path)]) == 2
    assert "입력 오류" in capsys.readouterr().err


def test_elevenlabs_without_key_is_blocked(tmp_path, monkeypatch):
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    with pytest.raises(narrate.Blocked, match="ELEVENLABS_API_KEY"):
        narrate.narrate(_script(engine="elevenlabs", voice="v"), str(tmp_path))


def test_example_script_is_valid_and_matches_scene_segments():
    example = SKILL / "examples" / "binary-search"
    data = narrate.load_script(example / "script.json")
    scenes = (example / "scenes.py").read_text(encoding="utf-8")
    for seg in data["segments"]:
        assert f'self.segment("{seg["id"]}")' in scenes
