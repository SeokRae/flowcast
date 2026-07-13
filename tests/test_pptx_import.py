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


def _cxn_loose(sid, x, y, cx, cy, flip="", st=None, en=None):
    """glue 없는(또는 한쪽만) 커넥터. flip: 'H'/'V' 포함 문자열."""
    glue = ""
    if st is not None:
        glue += f'<a:stCxn id="{st}" idx="3"/>'
    if en is not None:
        glue += f'<a:endCxn id="{en}" idx="1"/>'
    fh = ' flipH="1"' if "H" in flip else ""
    fv = ' flipV="1"' if "V" in flip else ""
    return f"""
    <p:cxnSp>
      <p:nvCxnSpPr><p:cNvPr id="{sid}" name="c{sid}"/><p:cNvCxnSpPr>{glue}</p:cNvCxnSpPr></p:nvCxnSpPr>
      <p:spPr><a:xfrm{fh}{fv}><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm></p:spPr>
    </p:cxnSp>"""


def _grp(inner, x, y, cx, cy, chx, chy, chcx, chcy, gid=90):
    """그룹 도형 — off/ext(부모 좌표) + chOff/chExt(자식 좌표계)."""
    return f"""
    <p:grpSp>
      <p:nvGrpSpPr><p:cNvPr id="{gid}" name="g{gid}"/></p:nvGrpSpPr>
      <p:grpSpPr><a:xfrm>
        <a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/>
        <a:chOff x="{chx}" y="{chy}"/><a:chExt cx="{chcx}" cy="{chcy}"/>
      </a:xfrm></p:grpSpPr>{inner}
    </p:grpSp>"""


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


def test_connector_glue_extracts_start_and_end_shapes(tmp_path):
    d = import_pptx(_fixture(tmp_path))
    assert d["slides"][0]["connectors"] == [{"from": "2", "to": "3"}]
    assert d["slides"][0]["connectors_loose"] == []  # 양쪽 glue → loose 아님
    assert d["slides"][1]["connectors"] == []  # 커넥터 없는 슬라이드


def test_shape_without_xfrm_skipped(tmp_path):
    no_pos = """
    <p:sp><p:nvSpPr><p:cNvPr id="9" name="np"/></p:nvSpPr>
      <p:spPr/><p:txBody><a:p><a:r><a:t>NoPos</a:t></a:r></a:p></p:txBody></p:sp>"""
    path = _make_pptx(tmp_path / "np.pptx", [no_pos + _sp(2, "Has", 914400, 914400)])
    d = import_pptx(path)
    texts = [s["text"] for s in d["slides"][0]["shapes"]]
    assert "NoPos" not in texts and "Has" in texts


def test_connector_without_glue_goes_to_loose_with_endpoints(tmp_path):
    # stCxn/endCxn 없는 커넥터 → 방향 미확증 → connectors_loose 로 끝점 좌표 유지
    bare = _cxn_loose(5, 100, 200, 300, 0)
    path = _make_pptx(tmp_path / "bare.pptx", [_sp(2, "A", 0, 0) + bare])
    d = import_pptx(path, scale=1.0)
    s = d["slides"][0]
    assert s["connectors"] == []
    assert s["connectors_loose"] == [
        {"sid": "5", "x1": 100.0, "y1": 200.0, "x2": 400.0, "y2": 200.0}
    ]


def test_loose_connector_flip_swaps_endpoints(tmp_path):
    # flipH → 시작점이 오른쪽, flipV → 시작점이 아래
    path = _make_pptx(
        tmp_path / "flip.pptx",
        [_cxn_loose(5, 100, 200, 300, 400, flip="HV")],
    )
    d = import_pptx(path, scale=1.0)
    [c] = d["slides"][0]["connectors_loose"]
    assert (c["x1"], c["y1"]) == (400.0, 600.0)
    assert (c["x2"], c["y2"]) == (100.0, 200.0)


def test_partial_glue_connector_keeps_known_endpoint_sid(tmp_path):
    # 한쪽 glue 만 → loose 로 가되 확인된 쪽 sid(st/en)는 보존
    path = _make_pptx(
        tmp_path / "part.pptx",
        [_sp(2, "A", 0, 0) + _cxn_loose(5, 0, 0, 100, 0, st=2)],
    )
    d = import_pptx(path, scale=1.0)
    [c] = d["slides"][0]["connectors_loose"]
    assert c["st"] == "2" and "en" not in c


def test_group_child_coords_compensated(tmp_path):
    # 그룹 off(1000,1000) ext(2000,2000), chOff(0,0) chExt(1000,1000) → k=2
    # 자식 sp off(100,100) ext(200,200) → 절대 (1200,1200) 크기 (400,400)
    grp = _grp(_sp(2, "In Group", 100, 100, cx=200, cy=200),
               1000, 1000, 2000, 2000, 0, 0, 1000, 1000)
    path = _make_pptx(tmp_path / "grp.pptx", [grp])
    d = import_pptx(path, scale=1.0)
    [s] = d["slides"][0]["shapes"]
    assert (s["x"], s["y"], s["w"], s["h"]) == (1200.0, 1200.0, 400.0, 400.0)


def test_nested_group_transforms_compose(tmp_path):
    # 외부 그룹 k=2 (off 0,0) 안에 내부 그룹 off(100,100) ext(400,400) chExt(200,200) k=2
    # 자식 sp off(50,50) ext(100,100) → 절대 x = 2*(100 + 2*50) = 400, 크기 400
    inner = _grp(_sp(3, "Deep", 50, 50, cx=100, cy=100),
                 100, 100, 400, 400, 0, 0, 200, 200, gid=91)
    outer = _grp(inner, 0, 0, 2000, 2000, 0, 0, 1000, 1000, gid=90)
    path = _make_pptx(tmp_path / "nested.pptx", [outer])
    d = import_pptx(path, scale=1.0)
    [s] = d["slides"][0]["shapes"]
    assert (s["x"], s["y"], s["w"], s["h"]) == (400.0, 400.0, 400.0, 400.0)


def test_connector_inside_group_transformed(tmp_path):
    # 그룹 k=2, off(1000,0) 안의 loose 커넥터 off(100,50) ext(200,0)
    # → 절대 시작 (1000+2*100, 2*50) = (1200,100), 끝 (1600,100)
    grp = _grp(_cxn_loose(5, 100, 50, 200, 0),
               1000, 0, 2000, 2000, 0, 0, 1000, 1000)
    path = _make_pptx(tmp_path / "gcxn.pptx", [grp])
    d = import_pptx(path, scale=1.0)
    [c] = d["slides"][0]["connectors_loose"]
    assert (c["x1"], c["y1"], c["x2"], c["y2"]) == (1200.0, 100.0, 1600.0, 100.0)
