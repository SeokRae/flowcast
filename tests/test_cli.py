"""flowcast scripts/_cli.py — 공용 load_json 오류 계약 유닛 테스트.

render/pptx_export/plantuml_export 가 공유하는 단일 진실이라, CLI 서브프로세스로
간접 확인하는 대신 load_json 을 직접 호출해 네 분기(파일없음·깨진 JSON·비-UTF8·OSError)의
exit code(1)·프리픽스(error:)·구체 메시지·트레이스백 부재를 한곳에서 고정한다 (#89).
"""

import importlib.util
import sys
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "flowcast_cli", Path(__file__).parent.parent / "scripts" / "_cli.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
load_json = _mod.load_json


def test_missing_file(tmp_path, capsys):
    with pytest.raises(SystemExit) as exc:
        load_json(tmp_path / "nope.json")
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert err.startswith("error: 파일 없음:") and "Traceback" not in err


def test_broken_json(tmp_path, capsys):
    bad = tmp_path / "broken.json"
    bad.write_text("{not valid", encoding="utf-8")
    with pytest.raises(SystemExit) as exc:
        load_json(bad)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "error: JSON 파싱 실패:" in err and "Traceback" not in err


def test_non_utf8_bytes(tmp_path, capsys):
    """비-UTF8 바이트(UTF-16 BOM 등) → UnicodeDecodeError 를 한 줄로 막는다 (#89 리뷰)."""
    binf = tmp_path / "utf16.json"
    binf.write_bytes(b"\xff\xfe{ \x00")   # 0xFF 0xFE = UTF-16 LE BOM → UTF-8 디코딩 실패
    with pytest.raises(SystemExit) as exc:
        load_json(binf)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "error: UTF-8 디코딩 실패:" in err and "Traceback" not in err


def test_directory_is_oserror(tmp_path, capsys):
    """디렉토리 경로 → exists()는 True, read_text 가 IsADirectoryError(OSError) → 읽기 실패 분기."""
    d = tmp_path / "adir"
    d.mkdir()
    with pytest.raises(SystemExit) as exc:
        load_json(d)
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "error: 읽기 실패:" in err and "Traceback" not in err


def test_valid_json_returns_object(tmp_path):
    good = tmp_path / "ok.json"
    good.write_text('{"a": 1}', encoding="utf-8")
    assert load_json(good) == {"a": 1}
