"""flowcast scripts/render.py — 검증 로직·SVG/HTML 렌더 출력 테스트.

예제 픽스처는 전량 합성(examples/*.json) — 실 파트너·내부 데이터 없음.
"""

import importlib.util
import json
from pathlib import Path

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

EX = Path(__file__).parent.parent / "examples"


def _base(**over):
    data = {
        "system": "테스트",
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
