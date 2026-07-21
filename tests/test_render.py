"""flowcast scripts/render.py — 검증 로직·SVG/HTML 렌더 출력 테스트.

예제 픽스처는 전량 합성(examples/*.json) — 실 파트너·내부 데이터 없음.
"""

import importlib.util
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

_spec = importlib.util.spec_from_file_location(
    "flowcast_render",
    Path(__file__).parent.parent / "scripts" / "render.py",
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
validate = _mod.validate
validate_topology = _mod.validate_topology
validate_component = _mod.validate_component
render_svg_component = _mod.render_svg_component
render_svg = _mod.render_svg
render_svg_topology = _mod.render_svg_topology
build_html = _mod.build_html
_split_step_label = _mod._split_step_label

EX = Path(__file__).parent.parent / "examples"


def test_split_step_label_ignores_mid_dash():
    """흐름 설명 단계 분리 — label 중간 보충설명 대시를 단계 구분자로 오인하지 않음 (#49)."""
    # 짧은 앞구절(≤12자) → 단계로 분리
    assert _split_step_label("주문 접수 — Stripe가 요청") == ("주문 접수", "Stripe가 요청")
    # 긴 앞부분(보충설명 대시) → 단계 없음, 전체가 설명
    step, desc = _split_step_label("공인 IP → api VIP (HTTPS 443, pay·api 공용 — pay 전용 VIP 미확정)")
    assert step == "" and "공인 IP" in desc and "미확정" in desc
    # 대시 없음 → 전체 설명
    assert _split_step_label("L4 분배 → 결제창 WEB (443)") == ("", "L4 분배 → 결제창 WEB (443)")


def _base(**over):
    data = {
        "system": "테스트",
        "source": "docs/test-flow.md",
        "zones": [{"id": "z1", "name": "존1"}],
        "actors": [
            {"id": "a", "name": "액터A"},
            {"id": "b", "name": "액터B", "zone": "z1"},
            {"id": "c", "name": "액터C", "zone": "z1"},
        ],
        "scenarios": [
            {"title": "시나리오", "steps": [
                {"n": 1, "from": "a", "to": "b", "label": "요청", "kind": "req"},
                {"n": 2, "from": "b", "to": "a", "label": "응답", "kind": "res"},
            ]},
        ],
    }
    data.update(over)
    return data


# ── validate ──────────────────────────────────────────────────

def test_validate_ok():
    errors, warnings = validate(_base())
    assert errors == []
    assert warnings == []


@pytest.mark.parametrize("validator", [validate, validate_topology, validate_component])
def test_validate_requires_nonempty_system(validator):
    data = _base(system="")
    errors, _ = validator(data)
    assert any("system" in error for error in errors)


@pytest.mark.parametrize("validator", [validate, validate_topology, validate_component])
def test_validators_require_system_key(validator):
    data = _base()
    del data["system"]
    errors, _ = validator(data)
    assert any("system" in error for error in errors)


@pytest.mark.parametrize("validator", [validate, validate_topology, validate_component])
def test_validators_require_nonempty_scenarios_list(validator):
    data = _base()
    data["scenarios"] = []
    errors, _ = validator(data)
    assert any("scenarios" in error and "비어" in error for error in errors)


@pytest.mark.parametrize("validator", [validate, validate_topology, validate_component])
@pytest.mark.parametrize("data", [None, [], "malformed", 3, True])
def test_validators_are_total_for_non_object_json(validator, data):
    errors, warnings = validator(data)
    assert errors
    assert warnings == []


def test_validate_rejects_non_list_scenarios():
    errors, _ = validate(_base(scenarios={"title": "not a list"}))
    assert any("scenarios" in error for error in errors)


def test_validate_rejects_malformed_nested_objects_without_throwing():
    data = _base(
        zones=[None, {"name": "id 없음"}],
        actors=["actor 아님"],
        scenarios=[None, {"title": "시나리오", "steps": ["step 아님"]}],
    )
    errors, _ = validate(data)
    assert any("zone" in error for error in errors)
    assert any("actor" in error for error in errors)
    assert any("scenario" in error for error in errors)
    assert any("step" in error for error in errors)


def test_validate_sequence_requires_steps_list():
    data = _base()
    del data["scenarios"][0]["steps"]
    errors, _ = validate(data)
    assert any("steps" in error for error in errors)


@pytest.mark.parametrize(
    ("owner", "field"),
    [
        ("root", "source"),
        ("actor", "port"),
        ("actor", "line"),
        ("step", "label"),
        ("step", "sub"),
        ("step", "protocol"),
    ],
)
def test_validate_rejects_non_string_sequence_text(owner, field):
    data = _base()
    target = {
        "root": data,
        "actor": data["actors"][0],
        "step": data["scenarios"][0]["steps"][0],
    }[owner]
    target[field] = ["문자열 아님"]

    errors, _ = validate(data)

    assert any(field in error and "문자열" in error for error in errors)


def test_validate_allows_empty_optional_sequence_text():
    data = _base(source="")
    data["actors"][0].update(port="", line="")
    data["scenarios"][0]["steps"][0].update(label="", sub="", protocol="")

    errors, _ = validate(data)

    assert errors == []


def test_validate_unknown_actor_ref():
    data = _base()
    data["scenarios"][0]["steps"][0]["to"] = "ghost"
    errors, _ = validate(data)
    assert any("미정의 actor 참조" in e for e in errors)


def test_validate_bad_kind():
    data = _base()
    data["scenarios"][0]["steps"][0]["kind"] = "arrow"
    errors, _ = validate(data)
    assert any("잘못된 kind" in e for e in errors)


def test_validate_duplicate_n_is_warning_not_error():
    data = _base()
    data["scenarios"][0]["steps"][1]["n"] = 1
    errors, warnings = validate(data)
    assert errors == []
    assert any("스텝 번호 1 중복" in w for w in warnings)


def test_validate_noncontiguous_zone():
    data = _base()
    # b(zone)·a(무존)·c(zone) 순서로 재배치 → 존 밴드 비연속
    data["actors"] = [data["actors"][1], data["actors"][0], data["actors"][2]]
    errors, _ = validate(data)
    assert any("비연속 배치" in e for e in errors)


def test_validate_note_requires_label():
    data = _base()
    data["scenarios"][0]["steps"].append(
        {"from": "a", "to": "b", "label": "", "kind": "note"})
    errors, _ = validate(data)
    assert any("note에 label 필수" in e for e in errors)


def test_validate_actor_undefined_zone():
    data = _base()
    data["actors"][1]["zone"] = "ghost-zone"
    errors, _ = validate(data)
    assert any("미정의 zone 참조" in e for e in errors)


# ── validate_topology (구성도 뷰) ─────────────────────────────

def _topo(**over):
    data = {
        "system": "테스트망",
        "source": "docs/test-topology.md",
        "view": "topology",
        "zones": [{"id": "z1", "name": "대외계 존"}],
        "nodes": [
            {"id": "m", "name": "클라이언트", "col": 0, "row": 1, "kind": "ext"},
            {"id": "r1", "name": "중계서버 #01", "zone": "z1", "col": 1, "row": 0},
            {"id": "r2", "name": "중계서버 #02", "zone": "z1", "col": 1, "row": 1},
        ],
        "scenarios": [
            {"title": "인프라 구성도"},  # segments 없음 = 순수 구성도
            {"title": "승인 흐름", "segments": [
                {"n": 1, "from": "m", "to": "r1", "label": "요청 발생"},
                {"n": 2, "from": "r1", "self": True, "label": "중계"},
            ]},
        ],
    }
    data.update(over)
    return data


def test_topology_validate_ok():
    errors, warnings = validate_topology(_topo())
    assert errors == []
    assert warnings == []


def test_topology_rejects_malformed_zone_without_throwing():
    data = _topo(zones=["zone 아님", {"name": "id 없음"}])
    errors, _ = validate_topology(data)
    assert any("zone" in error for error in errors)


@pytest.mark.parametrize("value", [True, "10", float("nan"), float("inf"), float("-inf")])
def test_topology_rejects_non_finite_or_non_numeric_coordinates(value):
    data = _topo()
    data["nodes"][0] = {"id": "m", "name": "클라이언트", "x": value, "y": 10}
    errors, _ = validate_topology(data)
    assert any("x" in error and "유한한 숫자" in error for error in errors)


def test_topology_rejects_invalid_grid_coordinates():
    data = _topo()
    data["nodes"][0]["col"] = False
    data["nodes"][0]["row"] = float("nan")
    errors, _ = validate_topology(data)
    assert any("col" in error and "유한한 숫자" in error for error in errors)
    assert any("row" in error and "유한한 숫자" in error for error in errors)


@pytest.mark.parametrize(("owner", "field"), [("root", "source"), ("segment", "label"), ("segment", "meta")])
def test_topology_rejects_non_string_text(owner, field):
    data = _topo()
    target = data if owner == "root" else data["scenarios"][1]["segments"][0]
    target[field] = {"문자열": "아님"}

    errors, _ = validate_topology(data)

    assert any(field in error and "문자열" in error for error in errors)


def test_topology_allows_empty_optional_text():
    data = _topo(source="")
    data["scenarios"][1]["segments"][0].update(label="", meta="")

    errors, _ = validate_topology(data)

    assert errors == []


def test_topology_pure_diagram_no_segments_ok():
    data = _topo(scenarios=[{"title": "인프라 구성도"}])
    errors, _ = validate_topology(data)
    assert errors == []


def test_topology_unknown_node_ref():
    data = _topo()
    data["scenarios"][1]["segments"][0]["to"] = "ghost"
    errors, _ = validate_topology(data)
    assert any("미정의 node 참조 to='ghost'" in e for e in errors)


def test_topology_node_missing_position():
    data = _topo()
    del data["nodes"][0]["col"]
    del data["nodes"][0]["row"]
    errors, _ = validate_topology(data)
    assert any("위치 없음" in e for e in errors)


def test_topology_abs_xy_position_ok():
    data = _topo()
    data["nodes"][0] = {"id": "m", "name": "클라이언트", "x": 10, "y": 200, "kind": "ext"}
    errors, _ = validate_topology(data)
    assert errors == []


def test_topology_undefined_zone_ref():
    data = _topo()
    data["nodes"][1]["zone"] = "ghost-zone"
    errors, _ = validate_topology(data)
    assert any("미정의 zone 참조" in e for e in errors)


def test_topology_self_segment_needs_no_to():
    data = _topo()
    # self 구간은 to 없이도 통과해야 함
    errors, _ = validate_topology(data)
    assert errors == []


def test_topology_duplicate_segment_n_is_warning():
    data = _topo()
    data["scenarios"][1]["segments"][1]["n"] = 1
    errors, warnings = validate_topology(data)
    assert errors == []
    assert any("구간 번호 1 중복" in w for w in warnings)


def test_topology_links_ok():
    data = _topo(links=[{"from": "m", "to": "r1"}, {"from": "r1", "to": "r2"}])
    errors, _ = validate_topology(data)
    assert errors == []


def test_topology_links_unknown_ref():
    data = _topo(links=[{"from": "r1", "to": "ghost"}])
    errors, _ = validate_topology(data)
    assert any("links[0]: 미정의 node 참조 to='ghost'" in e for e in errors)


# ── render_svg / build_html ───────────────────────────────────

def test_render_svg_contains_core_elements():
    data = _base()
    svg, w, h = render_svg(data, data["scenarios"][0])
    assert "액터A" in svg and "액터B" in svg and "존1" in svg
    assert 'class="ar-req ar"' in svg and 'class="ar-res ar"' in svg
    assert 'class="lifeline"' in svg and 'class="act-bar"' in svg
    assert "1. 요청" in svg and "2. 응답" in svg
    assert w > 0 and h > 0


def test_render_svg_empty_label_res_has_arrow_only():
    data = _base()
    data["scenarios"][0]["steps"].append(
        {"from": "b", "to": "a", "label": "", "kind": "res"})
    svg, _, _ = render_svg(data, data["scenarios"][0])
    assert svg.count('class="ar-res ar"') == 2
    # 무라벨 스텝은 라벨 텍스트를 만들지 않음 (기존 라벨 2개만)
    assert svg.count('class="lb-res"') == 1


def test_build_html_theme_and_print():
    data = _base()
    rendered = [render_svg(data, sc) for sc in data["scenarios"]]
    out = build_html(data, rendered)
    assert "themeToggle" in out and "localStorage" in out
    assert "@media print" in out and "@page { size:" in out
    assert 'data-theme="dark"' in out


# ── render_svg_topology (구성도 뷰) ───────────────────────────

def test_topology_render_overlay_scenario():
    data = _topo()
    svg, w, h = render_svg_topology(data, data["scenarios"][1])
    assert "클라이언트" in svg and "중계서버 #01" in svg
    assert "대외계 존" in svg                       # 존 라벨
    assert 'class="topo-seg"' in svg                # 구간 화살표
    assert svg.count('class="topo-badge"') == 2     # 번호 배지 2개
    assert "흐름 설명" in svg and "요청 발생" in svg  # legend
    assert 'class="topo-node topo-ext on"' in svg   # 경로상 외부 노드 강조
    assert w > 0 and h > 0


def test_topology_render_pure_diagram_no_badges():
    data = _topo()
    svg, _, _ = render_svg_topology(data, data["scenarios"][0])  # segments 없음
    assert 'class="topo-badge"' not in svg
    assert "흐름 설명" not in svg
    assert "중계서버 #01" in svg                     # 노드는 그대로 렌더
    assert ' dim"' not in svg and ' on"' not in svg  # 순수 구성도 = 중립(흐림/강조 없음)


def test_topology_grid_and_abs_coord():
    data = _topo()
    data["nodes"][0] = {"id": "m", "name": "클라이언트", "x": 500, "y": 40, "kind": "ext"}
    svg, _, _ = render_svg_topology(data, data["scenarios"][0])
    assert 'x="500.0"' in svg and 'y="40.0"' in svg  # 절대 좌표 반영


def test_topology_render_static_links():
    data = _topo(links=[{"from": "m", "to": "r1"}, {"from": "r1", "to": "r2"}])
    svg, _, _ = render_svg_topology(data, data["scenarios"][0])
    assert svg.count('class="topo-link"') == 2   # 정적 배선 2개
    assert 'class="topo-badge"' not in svg        # 배선엔 번호 없음


def test_topology_build_html_end_to_end():
    data = _topo()
    rendered = [render_svg_topology(data, sc) for sc in data["scenarios"]]
    out = build_html(data, rendered)
    assert "themeToggle" in out and "@page { size:" in out
    assert "인프라 구성도" in out and "승인 흐름" in out


# ── validate/render_component (컴포넌트 뷰) ────────────────────

def _comp(**over):
    data = {
        "system": "테스트PG",
        "source": "docs/test-component.md",
        "view": "component",
        "scenarios": [{
            "title": "카드결제",
            "zones": [{"id": "internal", "name": "< Internal >"}],
            "nodes": [
                {"id": "merchant", "name": "클라이언트", "kind": "ext", "x": 0, "y": 100},
                {"id": "web", "name": "PG Web", "port": "15010", "x": 200, "y": 100},
                {"id": "was", "name": "PG WAS", "port": "13010", "zone": "internal", "x": 400, "y": 100},
            ],
            "edges": [
                {"from": "web", "to": "was", "n": 1, "label": "결제요청", "protocol": "http, https", "lx": 300, "ly": 90},
                {"from": "was", "to": "web", "n": 2, "label": "결제결과", "protocol": "http, https"},
                {"from": "web", "to": "merchant", "bidir": True},
            ],
        }],
    }
    data.update(over)
    return data


def test_component_validate_ok():
    errors, warnings = validate_component(_comp())
    assert errors == []
    assert warnings == []


# ── source 계보 부재 warning (3뷰 공통, #94) ───────────────────

@pytest.mark.parametrize(
    ("validator", "builder"),
    [(validate, _base), (validate_topology, _topo), (validate_component, _comp)],
)
def test_validators_warn_on_missing_source(validator, builder):
    """source 부재는 error가 아니라 warning (라이트 경로 예외 — #94)."""
    data = builder()
    del data["source"]
    errors, warnings = validator(data)
    assert errors == []
    assert any("source" in w for w in warnings)


def test_component_rejects_malformed_nested_objects_without_throwing():
    data = _comp(scenarios=[{
        "title": "카드결제",
        "zones": [None],
        "nodes": ["node 아님"],
        "edges": ["edge 아님"],
    }])
    errors, _ = validate_component(data)
    assert any("zone" in error for error in errors)
    assert any("node" in error for error in errors)
    assert any("edge" in error for error in errors)


@pytest.mark.parametrize("value", [True, "10", float("nan"), float("inf"), float("-inf")])
def test_component_rejects_non_finite_or_non_numeric_coordinates(value):
    data = _comp()
    data["scenarios"][0]["nodes"][0]["x"] = value
    errors, _ = validate_component(data)
    assert any("x" in error and "유한한 숫자" in error for error in errors)


@pytest.mark.parametrize(
    "via",
    [
        [100],
        [100, 200, 300],
        [True, 200],
        [float("nan"), 200],
        ['0" onload="alert(1)', 200],
    ],
)
def test_component_rejects_malformed_via(via):
    data = _comp()
    data["scenarios"][0]["edges"][0]["via"] = via
    errors, _ = validate_component(data)
    assert any("via" in error for error in errors)


@pytest.mark.parametrize(("field", "value"), [("lx", True), ("ly", float("inf"))])
def test_component_rejects_invalid_label_coordinates(field, value):
    data = _comp()
    data["scenarios"][0]["edges"][0][field] = value
    errors, _ = validate_component(data)
    assert any(field in error and "유한한 숫자" in error for error in errors)


def test_component_accepts_numeric_lpos_interpolation():
    data = _comp()
    data["scenarios"][0]["edges"][0]["lpos"] = 0.25
    errors, _ = validate_component(data)
    assert errors == []


@pytest.mark.parametrize("value", ["left", True, float("inf"), -0.1, 1.1])
def test_component_rejects_invalid_lpos_interpolation(value):
    data = _comp()
    data["scenarios"][0]["edges"][0]["lpos"] = value
    errors, _ = validate_component(data)
    assert any("lpos" in error for error in errors)


@pytest.mark.parametrize(
    ("owner", "field"),
    [("root", "source"), ("node", "port"), ("edge", "label"), ("edge", "protocol")],
)
def test_component_rejects_non_string_text(owner, field):
    data = _comp()
    target = {
        "root": data,
        "node": data["scenarios"][0]["nodes"][0],
        "edge": data["scenarios"][0]["edges"][0],
    }[owner]
    target[field] = ["문자열 아님"]

    errors, _ = validate_component(data)

    assert any(field in error and "문자열" in error for error in errors)


def test_component_allows_empty_optional_text():
    data = _comp(source="")
    data["scenarios"][0]["nodes"][0]["port"] = ""
    data["scenarios"][0]["edges"][0].update(label="", protocol="")

    errors, _ = validate_component(data)

    assert errors == []


def test_component_node_missing_position():
    data = _comp()
    del data["scenarios"][0]["nodes"][0]["x"]
    del data["scenarios"][0]["nodes"][0]["y"]
    errors, _ = validate_component(data)
    assert any("위치 없음" in e for e in errors)


def test_component_undefined_node_ref():
    data = _comp()
    data["scenarios"][0]["edges"][0]["to"] = "ghost"
    errors, _ = validate_component(data)
    assert any("미정의 node 참조 to='ghost'" in e for e in errors)


def test_component_undefined_zone_ref():
    data = _comp()
    data["scenarios"][0]["nodes"][2]["zone"] = "nope"
    errors, _ = validate_component(data)
    assert any("미정의 zone 참조" in e for e in errors)


def test_component_duplicate_edge_n_is_warning():
    data = _comp()
    data["scenarios"][0]["edges"][1]["n"] = 1  # edge0과 중복
    errors, warnings = validate_component(data)
    assert errors == []
    assert any("엣지 번호 1 중복" in w for w in warnings)


def test_component_render_ports_and_labels():
    data = _comp()
    svg, _, _ = render_svg_component(data, data["scenarios"][0])
    assert "Port: 15010" in svg and "Port: 13010" in svg   # 포트 2단 라벨
    assert "(1) 결제요청" in svg                             # 번호 인라인
    assert "( http, https )" in svg                         # 프로토콜
    assert "comp-ext" in svg                                # 외부 액터 (comp-node comp-ext)
    assert "&lt; Internal &gt;" in svg                      # 존 라벨(이스케이프)


def test_component_bidir_has_start_marker():
    data = _comp()
    svg, _, _ = render_svg_component(data, data["scenarios"][0])
    assert 'marker-start="url(#mk-comp-s)"' in svg          # 양방향 화살촉


# ── 노드 드래그 (topology·component만 주입) ───────────────────

def test_topology_html_has_drag_metadata():
    data = _topo()
    rendered = [render_svg_topology(data, sc) for sc in data["scenarios"]]
    out = build_html(data, rendered)
    assert 'class="iff-node"' in out and 'data-from=' in out   # 노드 그룹 + 엣지 참조
    assert 'class="iff-zone"' in out and 'data-members=' in out  # 존 그룹 + 멤버
    assert 'setPointerCapture' in out                          # 드래그 JS 주입
    assert 'iff-export' in out                                 # 좌표 복사 버튼


def test_component_html_has_drag_metadata():
    data = _comp()
    rendered = [render_svg_component(data, sc) for sc in data["scenarios"]]
    out = build_html(data, rendered)
    assert 'class="iff-node"' in out and 'data-from=' in out
    assert 'setPointerCapture' in out and 'iff-export' in out


def test_sequence_html_has_no_drag():
    data = _base()
    rendered = [render_svg(data, sc) for sc in data["scenarios"]]
    out = build_html(data, rendered)
    assert 'iff-node' not in out          # sequence는 드래그 미적용
    assert 'setPointerCapture' not in out
    assert 'iff-export' not in out


# ── main view dispatch ────────────────────────────────────────

@pytest.mark.parametrize("view", ["unknown", None, []])
def test_main_rejects_unknown_view(view, tmp_path, monkeypatch, capsys):
    data_path = tmp_path / "unknown.json"
    out_path = tmp_path / "unknown.html"
    data_path.write_text(json.dumps(_base(view=view)), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["render.py", str(data_path), "-o", str(out_path)])

    with pytest.raises(SystemExit) as exc:
        _mod.main()

    assert exc.value.code == 1
    assert "알 수 없는 view" in capsys.readouterr().err
    assert not out_path.exists()


def test_main_missing_view_defaults_to_sequence(tmp_path, monkeypatch):
    data_path = tmp_path / "sequence.json"
    out_path = tmp_path / "sequence.html"
    data_path.write_text(json.dumps(_base()), encoding="utf-8")
    monkeypatch.setattr(sys, "argv", ["render.py", str(data_path), "-o", str(out_path)])

    _mod.main()

    assert out_path.exists()
    assert "액터A" in out_path.read_text(encoding="utf-8")


def test_pdf_dependency_failure_uses_partial_success_exit_code(tmp_path, monkeypatch, capsys):
    html_path = tmp_path / "diagram.html"
    pdf_path = tmp_path / "diagram.pdf"
    html_path.write_text("<html></html>", encoding="utf-8")
    monkeypatch.setattr(_mod, "CHROME_CANDIDATES", [])

    with pytest.raises(SystemExit) as exc:
        _mod.to_pdf(html_path, pdf_path)

    assert exc.value.code == 2
    assert "Chrome" in capsys.readouterr().err
    assert not pdf_path.exists()


def _configure_fake_chrome(tmp_path, monkeypatch):
    chrome = tmp_path / "chrome"
    chrome.write_text("fake", encoding="utf-8")
    monkeypatch.setattr(_mod, "CHROME_CANDIDATES", [str(chrome)])


def test_pdf_subprocess_start_failure_exits_two_and_preserves_target(
        tmp_path, monkeypatch, capsys):
    _configure_fake_chrome(tmp_path, monkeypatch)
    html_path = tmp_path / "diagram.html"
    pdf_path = tmp_path / "diagram.pdf"
    html_path.write_text("<html></html>", encoding="utf-8")
    pdf_path.write_bytes(b"previous")

    def fail_to_start(*args, **kwargs):
        raise OSError("spawn failed")

    monkeypatch.setattr(_mod.subprocess, "run", fail_to_start)

    with pytest.raises(SystemExit) as exc:
        _mod.to_pdf(html_path, pdf_path)

    assert exc.value.code == 2
    assert "spawn failed" in capsys.readouterr().err
    assert pdf_path.read_bytes() == b"previous"


def test_pdf_does_not_accept_stale_target_or_temporary_output(tmp_path, monkeypatch):
    _configure_fake_chrome(tmp_path, monkeypatch)
    html_path = tmp_path / "diagram.html"
    pdf_path = tmp_path / "diagram.pdf"
    temp_path = pdf_path.with_name(f".{pdf_path.name}.tmp")
    html_path.write_text("<html></html>", encoding="utf-8")
    pdf_path.write_bytes(b"previous")
    temp_path.write_bytes(b"stale")
    monkeypatch.setattr(
        _mod.subprocess, "run",
        lambda *args, **kwargs: SimpleNamespace(returncode=0, stderr=""),
    )

    with pytest.raises(SystemExit) as exc:
        _mod.to_pdf(html_path, pdf_path)

    assert exc.value.code == 2
    assert pdf_path.read_bytes() == b"previous"
    assert not temp_path.exists()


def test_pdf_rejects_empty_fresh_output_and_preserves_target(
        tmp_path, monkeypatch, capsys):
    _configure_fake_chrome(tmp_path, monkeypatch)
    html_path = tmp_path / "diagram.html"
    pdf_path = tmp_path / "diagram.pdf"
    temp_path = pdf_path.with_name(f".{pdf_path.name}.tmp")
    html_path.write_text("<html></html>", encoding="utf-8")
    pdf_path.write_bytes(b"previous")

    def create_empty_output(command, **_kwargs):
        output_arg = next(arg for arg in command if arg.startswith("--print-to-pdf="))
        Path(output_arg.split("=", 1)[1]).write_bytes(b"")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(_mod.subprocess, "run", create_empty_output)

    with pytest.raises(SystemExit) as exc_info:
        _mod.to_pdf(html_path, pdf_path)

    assert exc_info.value.code == 2
    assert pdf_path.read_bytes() == b"previous"
    assert not temp_path.exists()
    assert "PDF 변환 실패" in capsys.readouterr().err


def test_pdf_atomically_replaces_target_with_fresh_temporary_output(tmp_path, monkeypatch):
    _configure_fake_chrome(tmp_path, monkeypatch)
    html_path = tmp_path / "diagram.html"
    pdf_path = tmp_path / "diagram.pdf"
    html_path.write_text("<html></html>", encoding="utf-8")
    pdf_path.write_bytes(b"previous")
    produced_paths = []

    def render_to_requested_path(command, **kwargs):
        output_arg = next(arg for arg in command if arg.startswith("--print-to-pdf="))
        output_path = Path(output_arg.split("=", 1)[1])
        produced_paths.append(output_path)
        output_path.write_bytes(b"fresh")
        return SimpleNamespace(returncode=0, stderr="")

    monkeypatch.setattr(_mod.subprocess, "run", render_to_requested_path)

    _mod.to_pdf(html_path, pdf_path)

    assert produced_paths == [pdf_path.with_name(f".{pdf_path.name}.tmp")]
    assert pdf_path.read_bytes() == b"fresh"
    assert not produced_paths[0].exists()


# ── 합성 예제 회귀 (examples/*.json) ──────────────────────────

def test_sequence_example_validates_and_renders():
    data = json.loads((EX / "order-service-sequence.json").read_text(encoding="utf-8"))
    errors, warnings = validate(data)
    assert errors == []
    assert len(data["scenarios"]) == 2
    svg, _, _ = render_svg(data, data["scenarios"][0])
    for a in data["actors"]:
        assert a["name"] in svg


def test_topology_example_validates():
    data = json.loads((EX / "three-tier-topology.json").read_text(encoding="utf-8"))
    errors, _ = validate_topology(data)
    assert errors == []
    assert len(data["scenarios"]) == 2


def test_component_example_validates():
    data = json.loads((EX / "microservice-component.json").read_text(encoding="utf-8"))
    errors, _ = validate_component(data)
    assert errors == []
    assert len(data["scenarios"]) == 2


def test_topology_badge_overlap_spread():
    # 동일 엣지 2개 → 소박한 배지 위치 완전 중첩 — spread 로 지름(22px) 이상 분리돼야 (#19)
    import re
    data = {
        "view": "topology",
        "system": "S",
        "nodes": [
            {"id": "a", "name": "A", "col": 0, "row": 0},
            {"id": "b", "name": "B", "col": 1, "row": 0},
        ],
        "scenarios": [{"title": "T", "segments": [
            {"n": 1, "from": "a", "to": "b", "label": "one"},
            {"n": 2, "from": "a", "to": "b", "label": "two"},
        ]}],
    }
    svg, _, _ = render_svg_topology(data, data["scenarios"][0])
    pts = [(float(m.group(1)), float(m.group(2)))
           for m in re.finditer(r'class="topo-badge" cx="([-\d.]+)" cy="([-\d.]+)"', svg)]
    assert len(pts) == 2
    (x1, y1), (x2, y2) = pts
    assert ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5 >= 22


def test_topology_badge_spread_antiparallel_roundtrip():
    # 왕복 구간(a→b, b→a) — 역평행 엣지에서 부호 규칙이 둘을 같은 방향으로 밀면
    # 겹침이 유지되는 퇴행(#21). 내적 기반 부호로 지름(22px) 이상 분리돼야.
    import re
    data = {
        "view": "topology",
        "system": "S",
        "nodes": [
            {"id": "a", "name": "A", "col": 0, "row": 0},
            {"id": "b", "name": "B", "col": 1, "row": 0},
        ],
        "scenarios": [{"title": "T", "segments": [
            {"n": 1, "from": "a", "to": "b", "label": "go"},
            {"n": 2, "from": "b", "to": "a", "label": "back"},
        ]}],
    }
    svg, _, _ = render_svg_topology(data, data["scenarios"][0])
    pts = [(float(m.group(1)), float(m.group(2)))
           for m in re.finditer(r'class="topo-badge" cx="([-\d.]+)" cy="([-\d.]+)"', svg)]
    assert len(pts) == 2
    (x1, y1), (x2, y2) = pts
    assert ((x1 - x2) ** 2 + (y1 - y2) ** 2) ** 0.5 >= 22


# ── fw(방화벽) kind ────────────────────────────────────────────

def test_topology_fw_kind_validates_ok():
    data = _topo()
    data["nodes"][1]["kind"] = "fw"
    errors, warnings = validate_topology(data)
    assert errors == []
    assert warnings == []


def test_topology_unknown_kind_warns():
    data = _topo()
    data["nodes"][1]["kind"] = "bogus"
    errors, warnings = validate_topology(data)
    assert errors == []
    assert any("알 수 없는 kind 'bogus'" in w for w in warnings)


def test_topology_non_string_kind_is_an_error():
    data = _topo()
    data["nodes"][1]["kind"] = ["fw"]

    errors, warnings = validate_topology(data)

    assert any("kind는 문자열" in error for error in errors)
    assert warnings == []


@pytest.mark.parametrize("value", [10 ** 1000, 1e200])
def test_finite_number_guard_rejects_unsafe_renderer_magnitudes(value):
    data = _topo()
    data["nodes"][0]["x"] = value

    errors, _ = validate_topology(data)

    assert any("x" in error and "유한한 숫자" in error for error in errors)


def test_topology_fw_node_renders_brick():
    data = _topo()
    data["nodes"][1]["kind"] = "fw"  # r1 → 방화벽
    svg, _, _ = render_svg_topology(data, data["scenarios"][1])
    assert "topo-fw" in svg            # fw 클래스 적용
    assert 'id="fw-brick"' in svg      # 벽돌 패턴 정의(defs)
    assert 'class="fw-mortar"' in svg  # 벽돌 mortar 패턴 내용 출력


# ── l4(L4/VIP 로드밸런서) kind ─────────────────────────────────

def test_topology_l4_kind_validates_ok():
    data = _topo()
    data["nodes"][1]["kind"] = "l4"
    errors, warnings = validate_topology(data)
    assert errors == []
    assert warnings == []


def test_topology_l4_node_renders_fanout_icon():
    data = _topo()
    data["nodes"][1]["kind"] = "l4"  # r1 → L4/VIP
    svg, _, _ = render_svg_topology(data, data["scenarios"][1])
    assert "topo-l4" in svg           # l4 클래스 적용
    assert 'class="l4-ico"' in svg    # fan-out 아이콘(입력 점)
    assert 'class="l4-ico-l"' in svg  # fan-out 분배 선


def test_topology_l4_and_fw_are_distinct():
    data = _topo()
    data["nodes"][1]["kind"] = "l4"
    data["nodes"][2]["kind"] = "fw"
    svg, _, _ = render_svg_topology(data, data["scenarios"][1])
    assert "topo-l4" in svg and "topo-fw" in svg  # 두 표현 공존·구분


def test_topology_l4_box_is_narrower_than_srv():
    import re
    data = _topo()
    data["nodes"][1]["kind"] = "l4"   # r1 → l4(좁은 박스), r2 = srv(표준)
    svg, _, _ = render_svg_topology(data, data["scenarios"][1])

    def width_of(nid):
        m = re.search(r'data-id="' + nid + r'".*?<rect class="[^"]*"[^>]*width="([\d.]+)"', svg)
        return float(m.group(1))
    assert width_of("r1") < width_of("r2")  # l4 폭 < srv 폭


# ── 흐름 설명 범례: 단어경계 줄바꿈 + meta 부라인 ──────────────

def test_wrap_keeps_words_intact():
    lines = _mod._wrap("가맹점 returnUrl 회신", 14)   # width가 단어를 담을 만큼 큼
    toks = [t for l in lines for t in l.split(" ")]
    assert "returnUrl" in toks               # 단어 중간에서 안 끊김


def test_wrap_hard_splits_only_overlong_word():
    lines = _mod._wrap("abcdefghij", 4)      # 한 단어가 width 초과 → 그것만 하드 분할
    assert lines == ["abcd", "efgh", "ij"]


def test_topology_meta_renders_muted_subline():
    data = _topo()
    data["scenarios"][1]["segments"][0]["meta"] = "HTTPS 443 · FW 09"
    svg, _, _ = render_svg_topology(data, data["scenarios"][1])
    assert "topo-legend-meta" in svg          # 흐린 부라인 클래스
    assert "HTTPS 443" in svg                  # meta 내용 렌더


# ── 예제 산출물 골든 회귀 (#69) ────────────────────────────────
# 커밋된 examples/*.html 이 렌더러 변경을 따라오지 못해 낡는 것을 막는다.
# 실패하면 `bash scripts/regen-examples.sh` 후 결과를 함께 커밋한다.
# render.py 는 datetime/uuid/random 을 쓰지 않아 바이트 비교가 결정적이다.

DOCS_EX = Path(__file__).parent.parent / "docs" / "examples"
EXAMPLE_NAMES = sorted(p.stem for p in EX.glob("*.json"))

_RENDERERS = {
    "sequence": render_svg,
    "topology": render_svg_topology,
    "component": render_svg_component,
}


def _render_example(name):
    """render.py main() 과 동일한 디스패치로 예제 1건의 HTML 전문을 만든다."""
    data = json.loads((EX / f"{name}.json").read_text(encoding="utf-8"))
    render = _RENDERERS[data.get("view", "sequence")]
    return build_html(data, [render(data, sc) for sc in data["scenarios"]])


def test_examples_present():
    assert EXAMPLE_NAMES, "examples/*.json 이 없다 — 골든 회귀가 무력화된다"


@pytest.mark.parametrize("name", EXAMPLE_NAMES)
def test_example_html_matches_current_render(name):
    assert _render_example(name) == (EX / f"{name}.html").read_text(encoding="utf-8"), (
        f"examples/{name}.html 이 현재 render.py 출력과 다르다 "
        f"— bash scripts/regen-examples.sh 후 재생성분을 함께 커밋"
    )


@pytest.mark.parametrize("name", EXAMPLE_NAMES)
def test_docs_example_matches_source(name):
    assert (DOCS_EX / f"{name}.html").read_text(encoding="utf-8") == (
        EX / f"{name}.html"
    ).read_text(encoding="utf-8"), (
        f"docs/examples/{name}.html (Pages 게시본) 이 examples/{name}.html 과 다르다 "
        f"— bash scripts/regen-examples.sh 후 재생성분을 함께 커밋"
    )
