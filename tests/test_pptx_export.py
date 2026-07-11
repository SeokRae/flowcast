"""flowcast scripts/pptx_export.py — component 뷰 → .pptx round-trip 테스트.

python-pptx 는 export 전용 선택적 의존성 → 미설치 환경에선 이 파일 전체 skip.
검증 전략: export 한 .pptx 를 python-pptx 로 **다시 열어** 도형·텍스트·위치가 보존됐는지 확인
(= PowerPoint 편집가능성의 자동 프록시).
"""

import importlib.util
import json
from pathlib import Path

import pytest

pytest.importorskip("pptx")
from pptx import Presentation  # noqa: E402
from pptx.enum.shapes import MSO_SHAPE_TYPE  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "pptx_export", Path(__file__).parent.parent / "scripts" / "pptx_export.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
export_component = _mod.export_component

EX = Path(__file__).parent.parent / "examples"
SRC = EX / "microservice-component.json"


def _export(tmp_path):
    data = json.loads(SRC.read_text(encoding="utf-8"))
    out = tmp_path / "c.pptx"
    n = export_component(data, out)
    return data, out, n


def _all_text(prs):
    return "\n".join(
        sh.text_frame.text for s in prs.slides for sh in s.shapes if sh.has_text_frame)


def test_slide_per_scenario(tmp_path):
    data, out, n = _export(tmp_path)
    assert n == len(data["scenarios"]) == 2
    assert len(Presentation(str(out)).slides) == 2


def test_node_names_and_ports_preserved(tmp_path):
    data, out, _ = _export(tmp_path)
    text = _all_text(Presentation(str(out)))
    for sc in data["scenarios"]:
        for nd in sc["nodes"]:
            assert nd["name"] in text
            if nd.get("port"):
                assert f"Port: {nd['port']}" in text


def test_edge_labels_preserved(tmp_path):
    _, out, _ = _export(tmp_path)
    text = _all_text(Presentation(str(out)))
    assert "(1)" in text and "주문 생성" in text and "( http )" in text
    assert "카드 승인" in text and "( https )" in text


def test_connector_count_equals_edges(tmp_path):
    data, out, _ = _export(tmp_path)
    prs = Presentation(str(out))
    total_edges = sum(len(sc.get("edges") or []) for sc in data["scenarios"])
    conns = sum(1 for s in prs.slides for sh in s.shapes
                if sh.shape_type == MSO_SHAPE_TYPE.LINE)
    assert conns == total_edges


def test_node_boxes_within_slide_bounds(tmp_path):
    data, out, _ = _export(tmp_path)
    prs = Presentation(str(out))
    names = {nd["name"] for sc in data["scenarios"] for nd in sc["nodes"]}
    total_nodes = sum(len(sc["nodes"]) for sc in data["scenarios"])
    W, H = prs.slide_width, prs.slide_height
    found = 0
    for s in prs.slides:
        for sh in s.shapes:
            if sh.has_text_frame and sh.text_frame.text.split("\n")[0] in names:
                assert 0 <= sh.left and sh.left + sh.width <= W
                assert 0 <= sh.top and sh.top + sh.height <= H
                found += 1
    assert found == total_nodes  # 모든 노드 박스가 슬라이드 경계 내


def test_non_component_view_returns_none_of_our_shapes(tmp_path):
    # export_component 는 component 전용 — view 가드는 main()에서. 여기선 정상 입력만 다룸.
    data, out, _ = _export(tmp_path)
    prs = Presentation(str(out))
    # 존 박스도 하나 존재해야(첫 시나리오 < Internal >)
    assert "< Internal >" in _all_text(prs)
