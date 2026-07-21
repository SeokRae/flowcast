"""pptx_export CLI — python-pptx **미설치** 경로 (exit 2) + slide-size 파싱.

`tests/test_pptx_export.py` 는 module-level `pytest.importorskip("pptx")` 라
설치 환경(CI)에서 exit-2 경로가 절대 재현되지 않는다(#71 은 `_import_pptx` 를
monkeypatch 해 우회). 여기서는 ImportError 를 내는 `pptx` 스텁을 `PYTHONPATH` 로
주입해, python-pptx 설치 여부와 무관하게 미설치 CLI 동작을 스크립트 직접 실행으로
검증한다. `pptx_export.py` 는 pptx 를 lazy import 하므로 모듈 로드에는 pptx 가 없어도 된다.
"""

import importlib.util
import os
import subprocess
import sys
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "pptx_export.py"

_spec = importlib.util.spec_from_file_location("pptx_export_cli", SCRIPT)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)


def test_missing_pptx_cli_exits_two(tmp_path):
    """python-pptx 부재 → exit 2(= partial 계약) + 안내, 트레이스백 없음.

    스텁 `pptx/__init__.py` 가 import 시 ImportError 를 던지고, PYTHONPATH 로
    site-packages 보다 앞에 놓여 실제 설치본을 가린다. 의존성 검사(exit 2)는
    파일 존재/검증(exit 1)보다 먼저라 데이터 파일이 없어도 exit 2 가 나온다.
    """
    stub = tmp_path / "stub" / "pptx"
    stub.mkdir(parents=True)
    (stub / "__init__.py").write_text(
        'raise ImportError("stubbed: python-pptx not installed")\n', encoding="utf-8"
    )
    env = dict(os.environ, PYTHONPATH=str(tmp_path / "stub"))
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path / "any.json")],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 2
    assert "python-pptx" in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize("bad", ["1x", "wide x tall", "1024x"])
def test_parse_slide_size_rejects_malformed(bad):
    with pytest.raises(SystemExit):
        _mod._parse_slide_size(bad)


def test_parse_slide_size_accepts_presets_and_dimensions():
    assert _mod._parse_slide_size("wide") == (1920, 1080)  # SLIDE_PRESETS 조회 분기
    assert _mod._parse_slide_size("auto") is None
    assert _mod._parse_slide_size("1024x768") == (1024, 768)
