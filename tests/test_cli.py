"""flowcast scripts/_cli.py — 공용 load_json·read_json 오류 계약 유닛 테스트.

render/pptx_export/plantuml_export 가 공유하는 단일 진실이라, CLI 서브프로세스로
간접 확인하는 대신 load_json 을 직접 호출해 네 분기(파일없음·깨진 JSON·비-UTF8·OSError)의
exit code(1)·프리픽스(error:)·구체 메시지·트레이스백 부재를 한곳에서 고정한다 (#89).
read_json 은 검증기 3종이 쓰는 return-스타일 형제로, 같은 어휘를 raise 대신
(data, error) 로 돌려주는지·어떤 로드 실패에도 예외를 흘리지 않는지 고정한다 (#124).
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
read_json = _mod.read_json


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


# ── read_json — load_json 의 return-스타일 형제 (#124) ────────────────
# 검증기 3종이 오류를 모아 반환하려 쓰는 total 함수. 같은 한국어 어휘를 raise 대신
# (data, error) 로 돌려주는지, 어떤 로드 실패에도 예외를 흘리지 않는지 고정한다.

def test_read_json_valid_returns_data_and_no_error(tmp_path):
    good = tmp_path / "ok.json"
    good.write_text('{"a": 1}', encoding="utf-8")
    assert read_json(good) == ({"a": 1}, None)


def test_read_json_missing_file(tmp_path):
    data, error = read_json(tmp_path / "nope.json")
    assert data is None
    assert error.startswith("파일 없음:") and "nope.json" in error


def test_read_json_broken_json(tmp_path):
    bad = tmp_path / "broken.json"
    bad.write_text("{not valid", encoding="utf-8")
    data, error = read_json(bad)
    assert data is None and error.startswith("JSON 파싱 실패:")


def test_read_json_non_utf8_bytes(tmp_path):
    binf = tmp_path / "utf16.json"
    binf.write_bytes(b"\xff\xfe{ \x00")
    data, error = read_json(binf)
    assert data is None and error.startswith("UTF-8 디코딩 실패:")


def test_read_json_directory_is_read_error(tmp_path):
    d = tmp_path / "adir"
    d.mkdir()
    data, error = read_json(d)
    assert data is None and error.startswith("읽기 실패:")


def test_read_json_label_replaces_path_in_message(tmp_path):
    """label 을 주면 메시지 식별자가 path 대신 label — plugin.json 같은 짧은 라벨 보존."""
    data, error = read_json(tmp_path / "nope.json", label="plugin.json")
    assert data is None and error == "파일 없음: plugin.json"


def test_read_json_folds_numeric_value_error(tmp_path, monkeypatch):
    """json.loads 가 JSONDecodeError 아닌 ValueError(정수 자릿수 한도)를 던져도 흡수 — 누출 금지."""
    good = tmp_path / "big.json"
    good.write_text("{}", encoding="utf-8")

    def raise_digit_limit(_text):
        raise ValueError("integer string conversion exceeds digit limit")

    monkeypatch.setattr(_mod.json, "loads", raise_digit_limit)
    data, error = read_json(good)
    assert data is None and error.startswith("JSON 파싱 실패:")


def test_read_json_null_literal_is_data_not_error(tmp_path):
    """유효한 "null" → (None, None): 데이터가 None 인 것과 로드 실패를 error 로 구분한다."""
    nullf = tmp_path / "null.json"
    nullf.write_text("null", encoding="utf-8")
    assert read_json(nullf) == (None, None)
