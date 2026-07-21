#!/usr/bin/env python3
"""렌더 산출물을 manifest 와 대조하는 **dispatch 후 전용** 검증기.

`validate_manifest.py` 는 drawer 팬아웃 **전** 게이트라 선언값만 본다(pair 당
sequence 1 + topology 1, `segment_numbers` 동일성). 그런데 그 번호가 실제로
그려졌는지, `source_ref` 가 렌더 JSON `source` 로 전사됐는지는 아무도 확인하지
않았다(#88 · #94 핸드오프). 이 스크립트가 그 두 실측 대조를 맡는다:

    (A) 페어 실측 번호   — 같은 `pair_id` 의 sequence `steps[].n` / topology
        `segments[].n` 을 렌더 JSON 에서 실측해, 선언한 `segment_numbers` 와
        대조한다. drawer 가 구간을 쪼개(1..4 → 1..6) 그려도 반환 에코는 그대로라
        preflight 게이트가 형식적으로만 통과하던 구멍을 닫는다.
    (B) source 전사      — `source_ref` 가 비어 있지 않은 모든 unit 에 대해 렌더
        JSON `source` 가 원문 그대로인지 대조한다(정규화 금지 — 공백·대소문자·
        경로 구분자 차이도 불일치). 렌더 JSON 에 애초에 `source` 가 없으면(라이트
        경로, render.py 가 이미 계보 warning) 건너뛴다.

불일치는 **자동 수정하지 않는다** — 양쪽 값을 나란히 보고하고 사람이 원문·번호를
확인한다(#88 전반의 "자동 재번호 금지" 원칙). preflight 게이트(`validate_manifest`)
에 `--check-rendered` 로 얹지 않고 별도 스크립트로 둔 이유는 "dispatch 전 게이트"
와 "dispatch 후 실측" 의 의미가 섞이지 않게 하기 위함이다.

사용법:
    python3 scripts/validate_rendered_pairs.py {out_dir}/_workspace/units.json

manifest 의 `out_dir` 아래 `{name}.json` 에서 렌더 산출물을 찾는다. 위반이 있으면
`error:` 를 stderr 에 찍고 exit 1, 대조 불가(렌더 JSON 누락 등)는 `warning:` +
exit 0(실패한 drawer 는 이미 오케스트레이터가 보고). 표준 라이브러리만 사용한다.
"""

import importlib.util
import json
import os
import sys
from pathlib import Path


def _load_validate_manifest():
    """`validate_manifest.py` 의 canonical/이름 헬퍼를 재사용한다.

    "보이는 번호" 정규화(int 1 == str '1' == ' 1 ')와 안전한 name 규칙을 preflight
    게이트와 **한 소스**로 유지해야, 여기서의 대조와 게이트가 갈리지 않는다.
    """
    spec = importlib.util.spec_from_file_location(
        "flowcast_validate_manifest", Path(__file__).parent / "validate_manifest.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


vm = _load_validate_manifest()

# 뷰별로 n 을 담는 항목 배열 필드. 미지정 view 는 sequence(render.py 기본)로 본다.
_VIEW_ITEM_FIELD = {"sequence": "steps", "topology": "segments", "component": "edges"}


def _as_list(value):
    return value if isinstance(value, list) else []


def _visible(value):
    """번호 하나를 "보이는 값" 으로 정규화(게이트의 segment_numbers 대조와 동일)."""
    canonical = vm._canonical_segment_number(value)
    if canonical is not None:
        return canonical
    return str(value).strip()


def _visible_distinct(values):
    """보이는 값의 **첫 등장 순서 · 중복 제거** 리스트.

    render.py 는 중복 n 을 원문 보존으로 허용(warning)하므로, 원문에 같은 번호가
    두 번 나오는 경우까지 불일치로 오탐하지 않도록 distinct 로 비교한다. 순서는
    유지해 재정렬(1,2,3 → 1,3,2)이나 구간 쪼갬(1..4 → 1..6)은 그대로 잡는다.
    """
    seen = set()
    ordered = []
    for value in values:
        visible = _visible(value)
        if visible not in seen:
            seen.add(visible)
            ordered.append(visible)
    return ordered


def extract_rendered_numbers(rendered, view):
    """렌더 JSON 에 실제로 찍힌 n 값을 문서 순서대로(null 제외) 모은다."""
    field = _VIEW_ITEM_FIELD.get(view, "steps")
    numbers = []
    scenarios = rendered.get("scenarios") if isinstance(rendered, dict) else None
    if not isinstance(scenarios, list):
        return numbers
    for scenario in scenarios:
        if not isinstance(scenario, dict):
            continue
        for item in _as_list(scenario.get(field)):
            if isinstance(item, dict) and item.get("n") is not None:
                numbers.append(item["n"])
    return numbers


def _safe_name(unit):
    name = unit.get("name")
    if isinstance(name, str) and vm.SAFE_KEBAB.fullmatch(name) is not None:
        return name
    return None


def _rendered_for(unit, loader):
    """(rendered_json, unavailable) — 파일이 없거나 못 읽으면 (None, True)."""
    name = _safe_name(unit)
    if name is None:
        return None, True
    rendered, read_error = loader(name)
    if read_error is not None or not isinstance(rendered, dict):
        return None, True
    return rendered, False


def _check_source_transcription(units, loader, errors, warnings):
    """(B) source_ref 가 비어 있지 않은 모든 unit 의 source 전사 대조."""
    for unit in units:
        name = _safe_name(unit)
        if name is None:
            warnings.append(
                "unit 의 name 이 없거나 안전하지 않아 건너뜀: {!r}".format(unit.get("name")))
            continue
        rendered, read_error = loader(name)
        if read_error is not None:
            warnings.append("unit {!r}: 렌더 JSON 대조 불가 — {}".format(name, read_error))
            continue
        source_ref = unit.get("source_ref")
        if not vm._is_non_empty_string(source_ref):
            continue  # source_ref 존재는 preflight 게이트의 몫
        rendered_source = rendered.get("source") if isinstance(rendered, dict) else None
        if rendered_source is None:
            continue  # 라이트 경로: render.py 가 이미 계보 warning 을 냈다
        if not isinstance(rendered_source, str) or rendered_source != source_ref:
            errors.append(
                "unit {!r}: source 가 원문 그대로 전사되지 않음 — "
                "manifest source_ref={!r}, 렌더 source={!r} (자동 수정 금지)".format(
                    name, source_ref, rendered_source))


def _check_pair_numbers(units, loader, errors, warnings):
    """(A) 같은 pair_id 의 sequence/topology 실측 번호를 선언값과 대조."""
    pairs = {}
    for unit in units:
        pair_id = unit.get("pair_id")
        if isinstance(pair_id, str) and vm.SAFE_KEBAB.fullmatch(pair_id) is not None:
            pairs.setdefault(pair_id, []).append(unit)

    for pair_id, members in pairs.items():
        by_view = {member.get("view"): member for member in members}
        seq_unit = by_view.get("sequence")
        topo_unit = by_view.get("topology")
        if seq_unit is None or topo_unit is None or len(members) != 2:
            continue  # 페어 구성(1 seq + 1 topo) 자체는 preflight 게이트가 잡는다

        seq_rendered, seq_missing = _rendered_for(seq_unit, loader)
        topo_rendered, topo_missing = _rendered_for(topo_unit, loader)
        if seq_missing or topo_missing:
            continue  # 누락은 (B) 루프에서 이미 warning — 페어 대조는 조용히 건너뛴다

        declared = _visible_distinct(_as_list(seq_unit.get("segment_numbers")))
        seq_numbers = _visible_distinct(extract_rendered_numbers(seq_rendered, "sequence"))
        topo_numbers = _visible_distinct(extract_rendered_numbers(topo_rendered, "topology"))
        if seq_numbers != declared or topo_numbers != declared:
            errors.append(
                "pair {!r}: 실측 구간 번호가 선언 segment_numbers {} 와 불일치 — "
                "sequence[{}]={}, topology[{}]={} (자동 재번호 금지 — 원문·번호를 사람이 확인)".format(
                    pair_id, declared,
                    seq_unit.get("name"), seq_numbers,
                    topo_unit.get("name"), topo_numbers))


def validate_rendered_pairs(manifest, loader):
    """실측 대조 위반(errors)과 대조 불가(warnings)를 raise 없이 돌려준다.

    loader(name) -> (rendered_json_or_None, read_error_or_None). manifest 는
    이미 `validate_manifest` 를 통과한 것으로 가정하되, 잘못된 입력에도 raise 하지
    않도록 타입을 방어적으로 확인한다.
    """
    errors, warnings = [], []
    if not isinstance(manifest, dict):
        return ["manifest: expected a JSON object"], warnings
    units = manifest.get("units")
    if not isinstance(units, list) or not units:
        return ["manifest.units: expected a non-empty array"], warnings

    valid_units = [unit for unit in units if isinstance(unit, dict)]
    _check_source_transcription(valid_units, loader, errors, warnings)
    _check_pair_numbers(valid_units, loader, errors, warnings)
    return errors, warnings


def _file_loader(out_dir):
    """manifest out_dir 아래 `{name}.json` 을 name 별 1회 읽어 캐시한다."""
    cache = {}

    def loader(name):
        if name in cache:
            return cache[name]
        rendered_path = os.path.join(out_dir, "{}.json".format(name))
        try:
            with open(rendered_path, "r", encoding="utf-8") as stream:
                result = (json.load(stream), None)
        except (OSError, TypeError, UnicodeError) as exc:
            result = (None, "읽지 못함 {}: {}".format(rendered_path, exc))
        except (json.JSONDecodeError, ValueError) as exc:
            result = (None, "JSON 오류 {}: {}".format(rendered_path, exc))
        cache[name] = result
        return result

    return loader


def validate_rendered_pairs_file(path):
    """*path* 의 manifest 를 읽어 out_dir 기준으로 렌더 산출물과 대조한다."""
    try:
        with open(path, "r", encoding="utf-8") as stream:
            manifest = json.load(stream)
    except (OSError, TypeError, UnicodeError) as exc:
        return ["could not read manifest: {}".format(exc)], []
    except json.JSONDecodeError as exc:
        return ["invalid JSON: {}".format(exc)], []
    except ValueError as exc:
        return ["invalid JSON/numeric value: {}".format(exc)], []

    if not isinstance(manifest, dict):
        return ["manifest: expected a JSON object"], []
    out_dir = manifest.get("out_dir")
    if not isinstance(out_dir, str) or not out_dir.strip():
        return ["manifest.out_dir: 렌더 JSON 위치를 정할 수 없음 (경로 필요)"], []

    return validate_rendered_pairs(manifest, _file_loader(out_dir))


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    if len(arguments) != 1:
        print("usage: validate_rendered_pairs.py MANIFEST", file=sys.stderr)
        return 1

    errors, warnings = validate_rendered_pairs_file(arguments[0])
    for warning in warnings:
        print("warning: {}".format(warning), file=sys.stderr)
    if errors:
        for error in errors:
            print("error: {}".format(error), file=sys.stderr)
        return 1

    print("Rendered pairs consistent")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
