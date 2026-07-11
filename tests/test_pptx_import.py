"""flowcast scripts/pptx_import.py — .pptx draft 추출 테스트.

픽스처 .pptx 는 stdlib(zipfile)로 그 자리에서 합성 생성 — 바이너리 커밋 없음, 실 데이터 없음.
파서가 읽는 부분(ppt/presentation.xml, ppt/slides/slideN.xml)만 최소 구성한다.
"""

import importlib.util
import zipfile
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "pptx_import",
    Path(__file__).parent.parent / "scripts" / "pptx_import.py",
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
import_pptx = _mod.import_pptx

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"

_PRESENTATION = f"""<?xml version="1.0" encoding="UTF-8"?>
<p:presentation xmlns:p="{P}" xmlns:a="{A}">
  <p:sldSz cx="9144000" cy="6858000"/>
</p:presentation>"""


def _sp(sid, text, x, y, cx=1828800, cy=457200):
    return f"""
    <p:sp>
      <p:nvSpPr><p:cNvPr id="{sid}" name="s{sid}"/></p:nvSpPr>
      <p:spPr><a:xfrm><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm></p:spPr>
      <p:txBody><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:txBody>
    </p:sp>"""


def _cxn(sid, frm, to):
    return f"""
    <p:cxnSp>
      <p:nvCxnSpPr><p:cNvPr id="{sid}" name="c{sid}"/>
        <p:cNvCxnSpPr><a:stCxn id="{frm}" idx="3"/><a:endCxn id="{to}" idx="1"/></p:cNvCxnSpPr>
      </p:nvCxnSpPr>
      <p:spPr><a:xfrm><a:off x="2743200" y="1143000"/><a:ext cx="1828800" cy="0"/></a:xfrm></p:spPr>
    </p:cxnSp>"""


def _slide(inner):
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:p="{P}" xmlns:a="{A}">
  <p:cSld><p:spTree>{inner}</p:spTree></p:cSld>
</p:sld>"""


def _make_pptx(path, slides):
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr("ppt/presentation.xml", _PRESENTATION)
        for i, inner in enumerate(slides, 1):
            zf.writestr(f"ppt/slides/slide{i}.xml", _slide(inner))
    return path


def _fixture(tmp_path):
    slide1 = _sp(2, "Web Store", 914400, 914400) + _sp(3, "Order API", 4572000, 914400) + _cxn(4, 2, 3)
    slide2 = _sp(2, "Alert\nQueue", 914400, 914400)
    return _make_pptx(tmp_path / "deck.pptx", [slide1, slide2])


# ── 테스트 ────────────────────────────────────────────────────

def test_slide_size_and_count(tmp_path):
    d = import_pptx(_fixture(tmp_path))
    assert d["slide_size"] == {"cx": 9144000, "cy": 6858000}
    assert len(d["slides"]) == 2


def test_autofit_scale_maps_slide_width_to_canvas(tmp_path):
    d = import_pptx(_fixture(tmp_path), canvas=1000.0)
    # 914400 EMU / 9144000 slide_cx * 1000 = 100.0 ; 4572000 = 500.0 (결정적)
    xs = {s["text"]: s["x"] for s in d["slides"][0]["shapes"]}
    assert xs["Web Store"] == 100.0
    assert xs["Order API"] == 500.0


def test_explicit_scale_overrides_canvas(tmp_path):
    d = import_pptx(_fixture(tmp_path), scale=0.001)
    xs = {s["text"]: s["x"] for s in d["slides"][0]["shapes"]}
    assert xs["Web Store"] == 914.4  # 914400 * 0.001


def test_shapes_text_and_ids(tmp_path):
    d = import_pptx(_fixture(tmp_path))
    s1 = d["slides"][0]["shapes"]
    assert [s["sid"] for s in s1] == ["2", "3"]
    assert {s["text"] for s in s1} == {"Web Store", "Order API"}


def test_multiline_text_joined_with_newline(tmp_path):
    d = import_pptx(_fixture(tmp_path))
    s2 = d["slides"][1]["shapes"]
    assert s2[0]["text"] == "Alert\nQueue"


def test_connector_glue_extracted_with_direction(tmp_path):
    d = import_pptx(_fixture(tmp_path))
    assert d["slides"][0]["connectors"] == [{"from": "2", "to": "3"}]
    assert d["slides"][1]["connectors"] == []  # 커넥터 없는 슬라이드


def test_shape_without_xfrm_skipped(tmp_path):
    no_pos = """
    <p:sp><p:nvSpPr><p:cNvPr id="9" name="np"/></p:nvSpPr>
      <p:spPr/><p:txBody><a:p><a:r><a:t>NoPos</a:t></a:r></a:p></p:txBody></p:sp>"""
    path = _make_pptx(tmp_path / "np.pptx", [no_pos + _sp(2, "Has", 914400, 914400)])
    d = import_pptx(path)
    texts = [s["text"] for s in d["slides"][0]["shapes"]]
    assert "NoPos" not in texts and "Has" in texts


def test_connector_without_glue_excluded(tmp_path):
    # stCxn/endCxn 없는 커넥터 → 방향 불명 → 제외
    bare = """
    <p:cxnSp><p:nvCxnSpPr><p:cNvPr id="5" name="c5"/><p:cNvCxnSpPr/></p:nvCxnSpPr>
      <p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="10" cy="0"/></a:xfrm></p:spPr></p:cxnSp>"""
    path = _make_pptx(tmp_path / "bare.pptx", [_sp(2, "A", 0, 0) + bare])
    d = import_pptx(path)
    assert d["slides"][0]["connectors"] == []
