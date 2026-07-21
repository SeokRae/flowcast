#!/usr/bin/env python3
"""flowcast CLI 공용 헬퍼 (stdlib only) — 입력 로드·오류 계약 단일 진실.

스크립트마다 제각각이던 파일 없음·깨진 JSON 처리(traceback vs 한 줄)와 프리픽스를
한곳으로 모은다. render·pptx_export·plantuml_export 는 raise-스타일 `load_json` 을,
검증기 3종은 오류를 모아 반환해야 하므로 return-스타일 형제 `read_json` 을 공유한다 —
둘이 같은 한국어 어휘를 쓴다(#124).

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


def read_json(path, label=None):
    """load_json 의 return-스타일 형제 — 실패해도 raise 하지 않고 (data, error) 로 돌려준다.

    검증기 3종(validate_manifest·validate_rendered_pairs·validate_plugin_manifest)은
    로드 실패를 다른 검증 오류와 함께 리스트로 **모아 반환**하는 계약이라, 첫 오류에서
    SystemExit 하는 load_json 을 쓸 수 없다(그래서 #89 가 범위 밖에 뒀다). 이 함수가
    load_json 과 **같은 어휘·언어(한국어)** 로 한 줄 오류 문자열을 만들어 돌려준다:

        성공        → (data, None)
        파일 없음    → (None, "파일 없음: {name}")
        깨진 JSON   → (None, "JSON 파싱 실패: {name}: {msg}")
        비-UTF8     → (None, "UTF-8 디코딩 실패: {name}: {msg}")
        기타 읽기 실패 → (None, "읽기 실패: {name}: {msg}")

    - `error:` 프리픽스는 붙이지 않는다 — 호출부(검증기 main)가 붙인다.
    - `label` 을 주면 메시지 식별자로 path 대신 label 을 쓴다(plugin.json·marketplace.json
      처럼 여러 파일을 짧은 라벨로 구분하는 validate_plugin_manifest 용).
    - 어떤 로드 실패에도 raise 하지 않는다(검증기 계약). json.loads 가 JSONDecodeError 가
      아닌 ValueError(정수 문자열 자릿수 한도 초과)를 던져도 "JSON 파싱 실패" 로 흡수한다.
      JSONDecodeError·UnicodeDecodeError 는 ValueError 하위라 먼저 걸러야 한다.
    """
    p = Path(path)
    name = label if label is not None else str(p)
    if not p.exists():
        return None, "파일 없음: {}".format(name)
    try:
        return json.loads(p.read_text(encoding="utf-8")), None
    except json.JSONDecodeError as exc:
        return None, "JSON 파싱 실패: {}: {}".format(name, exc)
    except UnicodeDecodeError as exc:
        return None, "UTF-8 디코딩 실패: {}: {}".format(name, exc)
    except ValueError as exc:
        return None, "JSON 파싱 실패: {}: {}".format(name, exc)
    except OSError as exc:
        return None, "읽기 실패: {}: {}".format(name, exc)
