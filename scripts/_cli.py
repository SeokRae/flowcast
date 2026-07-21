#!/usr/bin/env python3
"""flowcast CLI 공용 헬퍼 (stdlib only) — 입력 로드·오류 계약 단일 진실.

스크립트마다 제각각이던 파일 없음·깨진 JSON 처리(traceback vs 한 줄)와 프리픽스를
한곳으로 모은다. render·pptx_export·plantuml_export 가 `load_json` 을 공유한다.

exit code 계약 (전 스크립트 공통):
    0 = 성공
    1 = 입력·검증 오류 — 파일 없음 · 깨진 JSON · 스키마 위반 · 미지원 view
    2 = 선택 의존성·선택 출력 실패 — python-pptx 부재 · Chrome PDF 실패
        (drawer 는 exit 2 를 `status: partial` 로 해석한다)

진단 프리픽스 (전 스크립트 공통): `error:` / `warning:`
    검증기(validate_manifest·validate_plugin_manifest·validate_rendered_pairs)와
    skills/flowcast/SKILL.md 계약이 이미 쓰는 소문자 규약에 맞춘다.
"""
import json
import sys
from pathlib import Path


def load_json(path):
    """JSON 파일을 읽어 파싱한다. 실패 시 한 줄 `error:` 로 종료(exit 1) — 트레이스백 없음.

    - 파일 없음        → error: 파일 없음: {path}
    - 비-UTF8 바이트    → error: UTF-8 디코딩 실패: {path}: {msg}
    - 깨진 JSON        → error: JSON 파싱 실패: {path}: {msg}
    - 기타 읽기 실패    → error: 읽기 실패: {path}: {msg}

    UnicodeDecodeError 는 ValueError 하위라 OSError/JSONDecodeError 어디에도 안 걸리므로
    (비-UTF8 .json·이진 파일 오입력) 별도 분기로 잡아 트레이스백 노출을 막는다.
    """
    p = Path(path)
    if not p.exists():
        print("error: 파일 없음: {}".format(p), file=sys.stderr)
        raise SystemExit(1)
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print("error: JSON 파싱 실패: {}: {}".format(p, exc), file=sys.stderr)
        raise SystemExit(1)
    except UnicodeDecodeError as exc:
        print("error: UTF-8 디코딩 실패: {}: {}".format(p, exc), file=sys.stderr)
        raise SystemExit(1)
    except OSError as exc:
        print("error: 읽기 실패: {}: {}".format(p, exc), file=sys.stderr)
        raise SystemExit(1)
