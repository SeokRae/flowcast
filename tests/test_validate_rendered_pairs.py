"""flowcast dispatch-후 실측 대조기(validate_rendered_pairs) 테스트."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "scripts" / "validate_rendered_pairs.py"

_spec = importlib.util.spec_from_file_location("validate_rendered_pairs", SCRIPT)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
validate_rendered_pairs = _module.validate_rendered_pairs
extract_rendered_numbers = _module.extract_rendered_numbers
_visible_distinct = _module._visible_distinct


# ── 빌더 ────────────────────────────────────────────────────────
def _seq_unit(**overrides):
    unit = {
        "unit_id": "pay-seq",
        "system": "svc",
        "source_ref": "docs/flow.md#pay",
        "name": "svc-seq",
        "view": "sequence",
        "title": "결제",
        "data": "x",
        "ambiguous": False,
        "view_candidates": [],
        "notes": [],
        "pair_id": "pay",
        "segment_numbers": [1, 2, 3],
    }
    unit.update(overrides)
    return unit


def _topo_unit(**overrides):
    unit = _seq_unit(
        unit_id="pay-topo",
        name="svc-topo",
        view="topology",
    )
    unit.update(overrides)
    return unit


def _seq_rendered(numbers=(1, 2, 3), source="docs/flow.md#pay"):
    rendered = {
        "system": "svc",
        "view": "sequence",
        "scenarios": [{
            "title": "결제",
            "steps": [
                {"n": n, "from": "a", "to": "b", "label": "x", "kind": "req"}
                for n in numbers
            ],
        }],
    }
    if source is not None:
        rendered["source"] = source
    return rendered


def _topo_rendered(numbers=(1, 2, 3), source="docs/flow.md#pay"):
    rendered = {
        "system": "svc",
        "view": "topology",
        "nodes": [{"id": "a", "name": "A", "col": 1, "row": 1}],
        "scenarios": [{
            "title": "결제",
            "segments": [
                {"n": n, "from": "a", "to": "b", "label": "x"} for n in numbers
            ],
        }],
    }
    if source is not None:
        rendered["source"] = source
    return rendered


def _manifest(units, out_dir="/tmp/flowcast-out"):
    return {"schema_version": "1.0", "out_dir": out_dir, "units": units}


def _loader(rendered_by_name):
    def loader(name):
        if name in rendered_by_name:
            return rendered_by_name[name], None
        return None, "not found: {}".format(name)
    return loader


def _check(units, rendered_by_name):
    return validate_rendered_pairs(_manifest(units), _loader(rendered_by_name))


# ── extract_rendered_numbers (순수 함수) ────────────────────────
def test_extract_pulls_step_numbers_for_sequence():
    rendered = _seq_rendered(numbers=(1, 2, 3))
    assert extract_rendered_numbers(rendered, "sequence") == [1, 2, 3]


def test_extract_pulls_segment_numbers_for_topology():
    rendered = _topo_rendered(numbers=(1, 2, 3))
    assert extract_rendered_numbers(rendered, "topology") == [1, 2, 3]


def test_extract_pulls_edge_numbers_for_component():
    rendered = {"scenarios": [{"edges": [{"n": 1}, {"n": 2}]}]}
    assert extract_rendered_numbers(rendered, "component") == [1, 2]


def test_extract_absent_view_defaults_to_sequence_steps():
    rendered = _seq_rendered(numbers=(1, 2))
    assert extract_rendered_numbers(rendered, None) == [1, 2]


def test_extract_skips_null_n_and_flattens_scenarios():
    rendered = {
        "scenarios": [
            {"steps": [{"n": 1}, {"label": "무번호"}, {"n": 2}]},
            {"steps": [{"n": 3}]},
        ]
    }
    assert extract_rendered_numbers(rendered, "sequence") == [1, 2, 3]


def test_extract_pure_config_scenario_contributes_nothing():
    rendered = {
        "scenarios": [
            {"title": "인프라 구성도", "segments": []},
            {"title": "요청 처리", "segments": [{"n": 1}, {"n": 2}]},
        ]
    }
    assert extract_rendered_numbers(rendered, "topology") == [1, 2]


def test_extract_tolerates_malformed_shapes_without_raising():
    assert extract_rendered_numbers({}, "sequence") == []
    assert extract_rendered_numbers({"scenarios": "nope"}, "sequence") == []
    assert extract_rendered_numbers({"scenarios": [None, {"steps": None}]}, "sequence") == []


# ── _visible_distinct ───────────────────────────────────────────
def test_visible_distinct_normalizes_int_string_and_whitespace():
    assert _visible_distinct([1, "2", " 3 "]) == ["1", "2", "3"]


def test_visible_distinct_dedupes_preserving_first_appearance_order():
    # render.py 는 중복 n 을 원문 보존으로 허용 → distinct 로 오탐 방지.
    assert _visible_distinct([1, 2, 2, 3]) == ["1", "2", "3"]


def test_visible_distinct_keeps_reordering_visible():
    assert _visible_distinct([1, 3, 2]) == ["1", "3", "2"]


# ── (A) 페어 실측 번호 대조 ─────────────────────────────────────
def test_pair_matching_rendered_numbers_pass():
    errors, warnings = _check(
        [_seq_unit(), _topo_unit()],
        {"svc-seq": _seq_rendered((1, 2, 3)), "svc-topo": _topo_rendered((1, 2, 3))},
    )
    assert errors == []
    assert warnings == []


def test_pair_topology_split_is_reported_with_both_sides():
    errors, _ = _check(
        [_seq_unit(), _topo_unit()],
        {
            "svc-seq": _seq_rendered((1, 2, 3)),
            "svc-topo": _topo_rendered((1, 2, 3, 4, 5)),
        },
    )
    joined = "\n".join(errors)
    assert "pay" in joined
    assert "'1', '2', '3'" in joined  # 선언 + sequence 실측
    assert "'4', '5'" in joined       # topology 가 쪼갠 번호


def test_pair_duplicate_preservation_does_not_false_positive():
    errors, _ = _check(
        [_seq_unit(), _topo_unit()],
        {
            "svc-seq": _seq_rendered((1, 2, 3)),
            "svc-topo": _topo_rendered((1, 2, 2, 3)),
        },
    )
    assert errors == []


def test_pair_reordering_is_reported():
    errors, _ = _check(
        [_seq_unit(), _topo_unit()],
        {
            "svc-seq": _seq_rendered((1, 2, 3)),
            "svc-topo": _topo_rendered((1, 3, 2)),
        },
    )
    assert any("pay" in error for error in errors)


def test_pair_sequence_diverging_from_declared_is_reported():
    errors, _ = _check(
        [_seq_unit(), _topo_unit()],
        {
            "svc-seq": _seq_rendered((1, 2)),  # 선언은 1,2,3
            "svc-topo": _topo_rendered((1, 2, 3)),
        },
    )
    assert any("pay" in error for error in errors)


def test_pair_missing_member_is_warning_not_error():
    errors, warnings = _check(
        [_seq_unit(), _topo_unit()],
        {"svc-seq": _seq_rendered((1, 2, 3))},  # topo 렌더 JSON 없음
    )
    assert errors == []
    assert any("svc-topo" in warning for warning in warnings)


def test_non_paired_units_are_not_number_checked():
    # pair_id=null 이면 segment_numbers 대조 대상이 아니다(자기 서브셋일 수 있음).
    errors, _ = _check(
        [_seq_unit(pair_id=None, segment_numbers=[1, 2])],
        {"svc-seq": _seq_rendered((1, 2, 3, 4, 5))},
    )
    assert errors == []


# ── (B) source 전사 대조 ────────────────────────────────────────
def test_source_transcribed_verbatim_passes():
    errors, _ = _check(
        [_seq_unit(pair_id=None)],
        {"svc-seq": _seq_rendered((1, 2, 3), source="docs/flow.md#pay")},
    )
    assert errors == []


def test_source_mismatch_is_reported_without_normalization():
    errors, _ = _check(
        [_seq_unit(pair_id=None)],
        {"svc-seq": _seq_rendered((1, 2, 3), source="docs/flow.md")},
    )
    assert any("source" in error and "svc-seq" in error for error in errors)


@pytest.mark.parametrize("rendered_source", [" docs/flow.md#pay", "DOCS/FLOW.MD#PAY", ""])
def test_source_whitespace_case_and_empty_all_mismatch(rendered_source):
    errors, _ = _check(
        [_seq_unit(pair_id=None)],
        {"svc-seq": _seq_rendered((1, 2, 3), source=rendered_source)},
    )
    assert any("source" in error for error in errors)


def test_source_absent_in_rendered_is_light_path_skip():
    # render.py 가 계보 warning 을 이미 냈다 — 여기선 전사 실패로 치지 않는다.
    errors, warnings = _check(
        [_seq_unit(pair_id=None)],
        {"svc-seq": _seq_rendered((1, 2, 3), source=None)},
    )
    assert errors == []
    assert warnings == []


def test_source_check_applies_to_component_units_too():
    unit = _seq_unit(
        unit_id="cmp", name="svc-cmp", view="component",
        pair_id=None, source_ref="docs/arch.md",
    )
    errors, _ = _check(
        [unit],
        {"svc-cmp": {"view": "component", "source": "docs/other.md", "scenarios": []}},
    )
    assert any("svc-cmp" in error for error in errors)


# ── 방어적 입력 ─────────────────────────────────────────────────
def test_malformed_manifest_returns_errors_without_raising():
    errors, _ = validate_rendered_pairs(None, _loader({}))
    assert any("object" in error for error in errors)


def test_empty_units_returns_error_without_raising():
    errors, _ = validate_rendered_pairs(_manifest([]), _loader({}))
    assert any("units" in error for error in errors)


def test_unsafe_unit_name_is_warned_and_skipped():
    errors, warnings = _check([_seq_unit(pair_id=None, name="../evil")], {})
    assert errors == []
    assert any("name" in warning for warning in warnings)


# ── CLI (파일 로더 + exit code) ─────────────────────────────────
def _write_pair(tmp_path, seq_numbers, topo_numbers,
                seq_source="docs/flow.md#pay", topo_source="docs/flow.md#pay"):
    out_dir = tmp_path
    manifest = _manifest([_seq_unit(), _topo_unit()], out_dir=str(out_dir))
    (out_dir / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
    (out_dir / "svc-seq.json").write_text(
        json.dumps(_seq_rendered(seq_numbers, source=seq_source)), encoding="utf-8")
    (out_dir / "svc-topo.json").write_text(
        json.dumps(_topo_rendered(topo_numbers, source=topo_source)), encoding="utf-8")
    return out_dir / "manifest.json"


def _run_cli(manifest_path):
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(manifest_path)],
        capture_output=True, text=True, check=False,
    )


def test_cli_accepts_consistent_pair(tmp_path):
    result = _run_cli(_write_pair(tmp_path, (1, 2, 3), (1, 2, 3)))

    assert result.returncode == 0
    assert "consistent" in result.stdout.lower()
    assert result.stderr == ""


def test_cli_rejects_number_divergence(tmp_path):
    result = _run_cli(_write_pair(tmp_path, (1, 2, 3), (1, 2, 3, 4, 5)))

    assert result.returncode == 1
    assert "pay" in result.stderr
    assert result.stdout == ""


def test_cli_rejects_source_divergence(tmp_path):
    result = _run_cli(
        _write_pair(tmp_path, (1, 2, 3), (1, 2, 3), topo_source="docs/flow.md"))

    assert result.returncode == 1
    assert "source" in result.stderr


def test_cli_missing_rendered_json_warns_but_passes(tmp_path):
    manifest_path = _write_pair(tmp_path, (1, 2, 3), (1, 2, 3))
    (tmp_path / "svc-topo.json").unlink()

    result = _run_cli(manifest_path)

    assert result.returncode == 0
    assert "warning" in result.stderr.lower()
    assert "svc-topo" in result.stderr


def test_cli_reports_invalid_json(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text("{not-json", encoding="utf-8")

    result = _run_cli(path)

    assert result.returncode == 1
    assert "JSON" in result.stderr


def test_cli_reports_missing_manifest(tmp_path):
    result = _run_cli(tmp_path / "missing.json")

    assert result.returncode == 1
    assert "read" in result.stderr.lower()


def test_cli_usage_error_without_argument():
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        capture_output=True, text=True, check=False,
    )

    assert result.returncode == 1
    assert "usage" in result.stderr.lower()
