"""flowcast manifest preflight validator tests."""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "scripts" / "validate_manifest.py"

_spec = importlib.util.spec_from_file_location("validate_manifest", SCRIPT)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
validate_manifest = _module.validate_manifest


def _unit(**overrides):
    unit = {
        "unit_id": "checkout-flow-sequence",
        "system": "checkout",
        "source_ref": "docs/checkout.md",
        "name": "checkout-flow-sequence",
        "view": "sequence",
        "title": "Checkout flow",
        "data": "Customer submits an order.",
        "ambiguous": False,
        "view_candidates": [],
        "notes": [],
        "pair_id": None,
        "segment_numbers": [1, 2],
    }
    unit.update(overrides)
    return unit


def _manifest(**overrides):
    manifest = {
        "schema_version": "1.0",
        "out_dir": "/tmp/flowcast-out",
        "units": [_unit()],
        "notes": [],
    }
    manifest.update(overrides)
    return manifest


def _errors(payload):
    return "\n".join(validate_manifest(payload))


def _run_cli(tmp_path, payload):
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )


def test_cli_accepts_valid_manifest(tmp_path):
    result = _run_cli(tmp_path, _manifest())

    assert result.returncode == 0
    assert "valid" in result.stdout.lower()
    assert result.stderr == ""


def test_cli_rejects_invalid_manifest(tmp_path):
    result = _run_cli(tmp_path, _manifest(out_dir="relative/output"))

    assert result.returncode == 1
    assert "out_dir" in result.stderr
    assert result.stdout == ""


def test_cli_reports_invalid_json(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text("{not-json", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(path)],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "JSON" in result.stderr


def test_cli_reports_missing_file(tmp_path):
    result = subprocess.run(
        [sys.executable, str(SCRIPT), str(tmp_path / "missing.json")],
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 1
    assert "read" in result.stderr.lower()


@pytest.mark.parametrize("payload", [None, [], "manifest", 42, True])
def test_manifest_must_be_an_object_without_raising(payload):
    errors = validate_manifest(payload)

    assert isinstance(errors, list)
    assert "object" in "\n".join(errors)


def test_schema_version_is_required_and_exact():
    missing = _manifest()
    del missing["schema_version"]

    assert "schema_version" in _errors(missing)
    assert "schema_version" in _errors(_manifest(schema_version=1.0))
    assert "schema_version" in _errors(_manifest(schema_version="2.0"))


def test_units_must_be_a_non_empty_array():
    assert "units" in _errors(_manifest(units=[]))
    assert "units" in _errors(_manifest(units={}))


def test_top_level_notes_are_optional_but_must_be_strings():
    without_notes = _manifest()
    del without_notes["notes"]

    assert validate_manifest(without_notes) == []
    assert "manifest.notes" in _errors(_manifest(notes="note"))
    assert "manifest.notes" in _errors(_manifest(notes=["ok", 3]))


@pytest.mark.parametrize(
    "field",
    [
        "unit_id",
        "system",
        "source_ref",
        "name",
        "view",
        "title",
        "data",
        "ambiguous",
        "view_candidates",
        "notes",
        "pair_id",
        "segment_numbers",
    ],
)
def test_each_unit_field_is_required(field):
    unit = _unit()
    del unit[field]

    assert field in _errors(_manifest(units=[unit]))


@pytest.mark.parametrize("field", ["unit_id", "system", "source_ref", "title"])
@pytest.mark.parametrize("value", [None, "", "   ", [], 7])
def test_unit_text_fields_must_be_non_empty_strings(field, value):
    assert field in _errors(_manifest(units=[_unit(**{field: value})]))


@pytest.mark.parametrize("data", [None, "", "   ", [], {}])
def test_unit_data_must_be_non_empty(data):
    assert "data" in _errors(_manifest(units=[_unit(data=data)]))


def test_unit_data_may_be_non_empty_structured_json():
    assert validate_manifest(_manifest(units=[_unit(data={"steps": [1]})])) == []


@pytest.mark.parametrize(
    "name", ["Checkout-Flow", "checkout_flow", "checkout/flow", "-checkout", "checkout-"]
)
def test_name_must_be_safe_kebab_case(name):
    assert "name" in _errors(_manifest(units=[_unit(name=name)]))


def test_unit_id_and_name_are_unique():
    duplicate = _unit()

    errors = _errors(_manifest(units=[_unit(), duplicate]))

    assert "duplicate unit_id" in errors
    assert "duplicate name" in errors


@pytest.mark.parametrize("view", ["flow", "SEQUENCE", "", None])
def test_view_must_be_supported(view):
    assert "view" in _errors(_manifest(units=[_unit(view=view)]))


def test_ambiguous_must_be_boolean_false_and_reports_candidate_reasons():
    unit = _unit(
        ambiguous=True,
        view_candidates=[
            {"view": "sequence", "reason": "ordered calls"},
            {"view": "topology", "reason": "network zones"},
        ],
    )

    errors = _errors(_manifest(units=[unit]))

    assert "ambiguous" in errors
    assert "ordered calls" in errors
    assert "network zones" in errors
    assert "ambiguous" in _errors(_manifest(units=[_unit(ambiguous="false")]))


@pytest.mark.parametrize(
    "candidates",
    [
        "sequence",
        ["sequence"],
        [{"view": "flow", "reason": "looks connected"}],
        [{"view": "sequence", "reason": "  "}],
        [{"view": "sequence"}],
    ],
)
def test_view_candidates_have_supported_view_and_reason(candidates):
    assert "view_candidates" in _errors(
        _manifest(units=[_unit(view_candidates=candidates)])
    )


def test_unit_notes_must_be_an_array_of_strings():
    assert "notes" in _errors(_manifest(units=[_unit(notes="note")]))
    assert "notes" in _errors(_manifest(units=[_unit(notes=["ok", None])]))


@pytest.mark.parametrize("pair_id", ["Checkout-Pair", "checkout_pair", "../pair", "", 3])
def test_pair_id_is_null_or_a_safe_string(pair_id):
    assert "pair_id" in _errors(_manifest(units=[_unit(pair_id=pair_id)]))


@pytest.mark.parametrize(
    "segment_numbers",
    ["1,2", [1, 1], ["one", "one"], [True], [1.5], [{}], [[1]]],
)
def test_segment_numbers_are_unique_integer_or_string_scalars(segment_numbers):
    assert "segment_numbers" in _errors(
        _manifest(units=[_unit(segment_numbers=segment_numbers)])
    )


def test_segment_number_strings_must_be_non_empty_after_strip():
    assert "segment_numbers" in _errors(
        _manifest(units=[_unit(segment_numbers=["   "])])
    )


def test_segment_number_duplicates_use_visible_normalized_values():
    errors = _errors(_manifest(units=[_unit(segment_numbers=[1, " 1 "])]))

    assert "duplicate" in errors


def _paired_units(segment_numbers=None):
    segments = [1, "2"] if segment_numbers is None else segment_numbers
    sequence = _unit(
        pair_id="checkout-pair",
        segment_numbers=segments,
    )
    topology = _unit(
        unit_id="checkout-flow-topology",
        name="checkout-flow-topology",
        view="topology",
        pair_id="checkout-pair",
        segment_numbers=list(segments),
    )
    return [sequence, topology]


def test_pair_has_exactly_one_sequence_and_one_topology_with_same_segments():
    assert validate_manifest(_manifest(units=_paired_units())) == []


def test_pair_segment_comparison_uses_visible_normalized_values():
    units = _paired_units()
    units[0]["segment_numbers"] = [1, " 2 "]
    units[1]["segment_numbers"] = ["1", "2"]

    assert validate_manifest(_manifest(units=units)) == []


def test_pair_requires_both_views_exactly_once():
    missing_topology = [_paired_units()[0]]
    duplicate_sequence = _paired_units() + [
        _unit(
            unit_id="checkout-flow-sequence-two",
            name="checkout-flow-sequence-two",
            pair_id="checkout-pair",
        )
    ]

    assert "checkout-pair" in _errors(_manifest(units=missing_topology))
    assert "checkout-pair" in _errors(_manifest(units=duplicate_sequence))


def test_pair_rejects_empty_or_different_segment_numbers():
    empty = _paired_units([])
    different = _paired_units()
    different[1]["segment_numbers"] = [1, "3"]

    assert "non-empty" in _errors(_manifest(units=empty))
    assert "identical" in _errors(_manifest(units=different))


def test_malformed_unit_returns_errors_instead_of_raising():
    errors = validate_manifest(_manifest(units=[None, [], "unit"]))

    assert len(errors) == 3
    assert all("object" in error for error in errors)


def test_malformed_nested_view_values_return_errors_instead_of_raising():
    unit = _unit(
        view=[],
        view_candidates=[{"view": [], "reason": "malformed candidate"}],
    )

    errors = validate_manifest(_manifest(units=[unit]))

    assert any(".view" in error for error in errors)
    assert any("view_candidates" in error for error in errors)


def test_file_validator_returns_numeric_value_errors(tmp_path, monkeypatch):
    path = tmp_path / "manifest.json"
    path.write_text("{}", encoding="utf-8")

    def raise_integer_digit_limit(_stream):
        raise ValueError("integer string conversion exceeds digit limit")

    monkeypatch.setattr(_module.json, "load", raise_integer_digit_limit)
    try:
        errors = _module.validate_manifest_file(path)
    except ValueError as exc:
        pytest.fail("validate_manifest_file leaked ValueError: {}".format(exc))

    assert "invalid JSON/numeric value" in "\n".join(errors)


# ── 문서 manifest 예시 ↔ 검증기 동기화 (#97) ──────────────────
# manifest·dispatch-unit 예시가 3개 문서에 흩어져 있는데 파싱 테스트가 0건이었다.
# 문서 예시가 검증기 계약과 어긋나면(현재 드리프트 0 — 예방적) 여기서 red 가 된다.

import re  # noqa: E402

_DOCS = (
    ROOT / "agents" / "diagram-router.md",
    ROOT / "skills" / "flowcast" / "SKILL.md",
    ROOT / "agents" / "diagram-drawer.md",
)
_JSON_BLOCK = re.compile(r"```json\n(.*?)\n```", re.DOTALL)
REQUIRED_UNIT_FIELDS = frozenset(_module.REQUIRED_UNIT_FIELDS)
# dispatch-unit(오케스트레이터→drawer 입력)이 unit 계약 위에 얹는 실행 파라미터.
# out_dir 은 문서에 placeholder(비-절대경로)로 적혀 있어 unit 계약 대상이 아니다 →
# 투영에서 제외(치환 아님). 이 집합 단언이 drawer.md·SKILL.md 필드 패리티를 강제한다.
_EXEC_PARAMS = frozenset(
    ("out_dir", "vault_iframe", "pdf", "export", "plantuml", "smetana")
)


def _doc_json_blocks():
    blocks = []
    for doc in _DOCS:
        for raw in _JSON_BLOCK.findall(doc.read_text(encoding="utf-8")):
            obj = json.loads(raw)  # 파싱 실패 자체가 문서 결함 → 그대로 raise
            if isinstance(obj, dict):
                blocks.append((doc.name, obj))
    return blocks


def _classify(obj):
    if "schema_version" in obj and "units" in obj:
        return "manifest"
    if "status" in obj:            # drawer 반환 — manifest 계약 대상 아님
        return "drawer-return"
    if {"unit_id", "data", "ambiguous"} <= obj.keys():
        return "dispatch-unit"
    return "other"


def test_doc_manifest_examples_pass_validator():
    seen = {"manifest": 0, "dispatch-unit": 0}
    for name, obj in _doc_json_blocks():
        kind = _classify(obj)
        if kind == "manifest":
            seen["manifest"] += 1
            assert validate_manifest(obj) == [], name
        elif kind == "dispatch-unit":
            seen["dispatch-unit"] += 1
            extra = set(obj) - REQUIRED_UNIT_FIELDS
            # 필드 패리티: 두 문서의 dispatch-unit 이 같은 실행 파라미터 집합을 써야 한다.
            assert extra == set(_EXEC_PARAMS), (name, sorted(extra))
            projected = {k: obj[k] for k in REQUIRED_UNIT_FIELDS if k in obj}
            manifest = {
                "schema_version": "1.0",
                "out_dir": "/tmp/flowcast-out",  # 문서 placeholder 는 제외하고 절대경로로
                "units": [projected],
            }
            assert validate_manifest(manifest) == [], name
    # 추출 자체가 깨지면(문서 구조 변경 등) 조용히 통과하지 않도록 개수를 고정한다.
    assert seen == {"manifest": 1, "dispatch-unit": 2}
