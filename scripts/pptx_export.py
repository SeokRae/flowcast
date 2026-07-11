#!/usr/bin/env python3
"""flowcast PPT export (B-out) — component 뷰 JSON → 편집 가능한 네이티브 .pptx.

python-pptx 는 **export 경로 전용 선택적 의존성**이다(코어 render/import 는 stdlib 유지).
미설치 시 친절히 안내하고 종료한다.

좌표는 render.py 의 component 배치 로직(`_c_rect`·`_edge_pt`·`C_*` 상수)을 **그대로 재사용**해
HTML/PDF 와 동일한 위치로 도형을 찍는다(재구현 금지). px → EMU(×9525) 변환.

사용법:
    python3 scripts/pptx_export.py {component.json} [-o {out.pptx}]

지원: component 뷰. (topology·sequence 는 후속 Issue)
- 노드 → 둥근 사각형 도형 + 텍스트(name, port 2단)
- 존   → 배경 사각형(소속 노드 bounding box)
- 엣지 → 직선 커넥터 + 라벨/번호 텍스트박스, bidir 은 양방향 화살촉
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

PX_TO_EMU = 9525   # 1px @96dpi
PAD_PX = 20        # 슬라이드 여백(px)

FILL = {"comp": (0xE6, 0xF4, 0xF1), "ext": (0xFD, 0xF3, 0xE7)}
LINE = {"comp": (0x2C, 0x7A, 0x7B), "ext": (0xB7, 0x79, 0x1F)}

# topology kind: srv(기본) · ext(외부, 앰버) · gear(장비, 점선)
TOPO_FILL = {"srv": (0xF8, 0xFA, 0xFC), "ext": (0xFD, 0xF3, 0xE7), "gear": (0xF8, 0xFA, 0xFC)}
TOPO_LINE = {"srv": (0x64, 0x74, 0x8B), "ext": (0xB7, 0x79, 0x1F), "gear": (0x94, 0xA3, 0xB8)}


def _load_render():
    spec = importlib.util.spec_from_file_location(
        "flowcast_render", Path(__file__).parent / "render.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _import_pptx():
    try:
        import pptx  # noqa: F401
        return True
    except ImportError:
        return False


def _scene_geometry(R, scenario):
    """시나리오의 노드 사각형·존 박스·전체 bounding box (px)."""
    nodes = scenario.get("nodes") or []
    zones = scenario.get("zones") or []
    rects = {n["id"]: R._c_rect(n) for n in nodes}
    xs, ys = [], []
    for x, y, w, h in rects.values():
        xs += [x, x + w]
        ys += [y, y + h]
    zone_boxes = []
    for z in zones:
        members = [n["id"] for n in nodes if n.get("zone") == z["id"]]
        mr = [rects[m] for m in members]
        if not mr:
            continue
        zx1 = min(r[0] for r in mr) - R.C_ZONE_PAD
        zy1 = min(r[1] for r in mr) - R.C_ZONE_PAD - R.C_ZONE_LBL
        zx2 = max(r[0] + r[2] for r in mr) + R.C_ZONE_PAD
        zy2 = max(r[1] + r[3] for r in mr) + R.C_ZONE_PAD
        zone_boxes.append((z, zx1, zy1, zx2, zy2))
        xs += [zx1, zx2]
        ys += [zy1, zy2]
    bbox = (min(xs), min(ys), max(xs), max(ys)) if xs else (0, 0, 0, 0)
    return rects, zone_boxes, bbox


def export_component(data, out_path):
    """component 뷰 JSON → .pptx (시나리오 1개 = 슬라이드 1장)."""
    from pptx import Presentation
    from pptx.util import Emu, Pt
    from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.dml.color import RGBColor
    from pptx.oxml.ns import qn

    R = _load_render()
    scenarios = data.get("scenarios") or []

    # 슬라이드 크기 = 시나리오 중 최대 bounding box + 여백 (px→EMU)
    geoms = [_scene_geometry(R, sc) for sc in scenarios]
    max_w = max(((b[2] - b[0]) for _, _, b in geoms), default=400)
    max_h = max(((b[3] - b[1]) for _, _, b in geoms), default=300)
    emu = lambda px: Emu(int(round(px * PX_TO_EMU)))

    prs = Presentation()
    prs.slide_width = emu(max_w + 2 * PAD_PX)
    prs.slide_height = emu(max_h + 2 * PAD_PX)
    blank = prs.slide_layouts[6]

    def _arrow(connector, tail=True, head=False):
        ln = connector.line._get_or_add_ln()
        if head:
            ln.append(ln.makeelement(qn("a:headEnd"), {"type": "triangle"}))
        if tail:
            ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle"}))

    for scenario, (rects, zone_boxes, bbox) in zip(scenarios, geoms):
        minx, miny = bbox[0], bbox[1]
        ox, oy = -minx + PAD_PX, -miny + PAD_PX   # 원점 이동
        slide = prs.slides.add_slide(blank)
        shapes = slide.shapes

        # 존 배경 먼저(뒤에 깔림)
        for z, zx1, zy1, zx2, zy2 in zone_boxes:
            zb = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                  emu(zx1 + ox), emu(zy1 + oy),
                                  emu(zx2 - zx1), emu(zy2 - zy1))
            zb.fill.background()
            zb.line.color.rgb = RGBColor(0x9C, 0xA3, 0xAF)
            zb.line.dash_style = None
            zb.shadow.inherit = False
            tf = zb.text_frame
            tf.text = z["name"]
            tf.paragraphs[0].alignment = PP_ALIGN.RIGHT
            tf.paragraphs[0].runs[0].font.size = Pt(9)
            tf.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x6B, 0x72, 0x80)
            tf.word_wrap = True
            zb.text_frame.vertical_anchor = MSO_ANCHOR.TOP

        # 노드
        node_by_id = {n["id"]: n for n in scenario.get("nodes") or []}
        for nid, (x, y, w, h) in rects.items():
            nd = node_by_id[nid]
            kind = nd.get("kind", "comp")
            box = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE,
                                   emu(x + ox), emu(y + oy), emu(w), emu(h))
            box.fill.solid()
            box.fill.fore_color.rgb = RGBColor(*FILL.get(kind, FILL["comp"]))
            box.line.color.rgb = RGBColor(*LINE.get(kind, LINE["comp"]))
            box.shadow.inherit = False
            tf = box.text_frame
            tf.word_wrap = True
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf.text = nd["name"]
            p0 = tf.paragraphs[0]
            p0.alignment = PP_ALIGN.CENTER
            p0.runs[0].font.size = Pt(11)
            p0.runs[0].font.bold = True
            p0.runs[0].font.color.rgb = RGBColor(0x1A, 0x20, 0x2C)  # 밝은 fill 위 가독성
            if nd.get("port"):
                pp = tf.add_paragraph()
                pp.alignment = PP_ALIGN.CENTER
                r = pp.add_run()
                r.text = f"Port: {nd['port']}"
                r.font.size = Pt(8)
                r.font.color.rgb = RGBColor(0x4B, 0x55, 0x63)

        # 엣지: 경계 앵커 사이 직선 커넥터 + 라벨
        for e in scenario.get("edges") or []:
            r1, r2 = rects.get(e["from"]), rects.get(e["to"])
            if not r1 or not r2:
                continue
            c1 = (r1[0] + r1[2] / 2, r1[1] + r1[3] / 2)
            c2 = (r2[0] + r2[2] / 2, r2[1] + r2[3] / 2)
            ax, ay = R._edge_pt(r1, *c2)
            bx, by = R._edge_pt(r2, *c1)
            conn = shapes.add_connector(MSO_CONNECTOR.STRAIGHT,
                                        emu(ax + ox), emu(ay + oy),
                                        emu(bx + ox), emu(by + oy))
            conn.line.color.rgb = RGBColor(0x4B, 0x55, 0x63)
            _arrow(conn, tail=True, head=bool(e.get("bidir")))

            # 라벨(번호 인라인 + 프로토콜)
            parts = []
            if e.get("n") is not None:
                parts.append(f"({e['n']})")
            if e.get("label"):
                parts.append(e["label"])
            proto = f"( {e['protocol']} )" if e.get("protocol") else ""
            if parts or proto:
                mx = (e["lx"] if e.get("lx") is not None else (ax + bx) / 2)
                my = (e["ly"] if e.get("ly") is not None else (ay + by) / 2)
                tb = shapes.add_textbox(emu(mx + ox - 60), emu(my + oy - 12),
                                        emu(140), emu(30))
                tf = tb.text_frame
                tf.word_wrap = True
                tf.text = " ".join(parts)
                tf.paragraphs[0].alignment = PP_ALIGN.CENTER
                tf.paragraphs[0].runs[0].font.size = Pt(9)
                if proto:
                    pp = tf.add_paragraph()
                    pp.alignment = PP_ALIGN.CENTER
                    r = pp.add_run()
                    r.text = proto
                    r.font.size = Pt(8)

    prs.save(str(out_path))
    return len(scenarios)


def export_topology(data, out_path):
    """topology 뷰 JSON → .pptx. nodes/links/zones 공유(모든 슬라이드) + 시나리오별 segments 오버레이."""
    from pptx import Presentation
    from pptx.util import Emu, Pt
    from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.dml.color import RGBColor
    from pptx.oxml.ns import qn

    R = _load_render()
    nodes = data.get("nodes") or []
    zones = data.get("zones") or []
    links = data.get("links") or []
    scenarios = data.get("scenarios") or [{"title": data.get("system", "topology")}]
    rects = {n["id"]: R._t_rect(n) for n in nodes}
    node_by_id = {n["id"]: n for n in nodes}

    xs, ys = [], []
    for x, y, w, h in rects.values():
        xs += [x, x + w]
        ys += [y, y + h]
    zone_boxes = []
    for z in zones:
        members = [n["id"] for n in nodes if n.get("zone") == z["id"]]
        mr = [rects[m] for m in members]
        if not mr:
            continue
        zx1 = min(r[0] for r in mr) - R.T_ZONE_PAD
        zy1 = min(r[1] for r in mr) - R.T_ZONE_PAD - R.T_ZONE_LBL
        zx2 = max(r[0] + r[2] for r in mr) + R.T_ZONE_PAD
        zy2 = max(r[1] + r[3] for r in mr) + R.T_ZONE_PAD
        zone_boxes.append((z, zx1, zy1, zx2, zy2))
        xs += [zx1, zx2]
        ys += [zy1, zy2]
    minx, miny = (min(xs), min(ys)) if xs else (0, 0)
    maxx, maxy = (max(xs), max(ys)) if xs else (0, 0)
    ox, oy = -minx + PAD_PX, -miny + PAD_PX

    emu = lambda px: Emu(int(round(px * PX_TO_EMU)))
    prs = Presentation()
    prs.slide_width = emu((maxx - minx) + 2 * PAD_PX)
    prs.slide_height = emu((maxy - miny) + 2 * PAD_PX)
    blank = prs.slide_layouts[6]

    def _anchor(r1, r2):
        c1 = (r1[0] + r1[2] / 2, r1[1] + r1[3] / 2)
        c2 = (r2[0] + r2[2] / 2, r2[1] + r2[3] / 2)
        return R._edge_pt(r1, *c2), R._edge_pt(r2, *c1)

    def _label(mx, my, text):
        tb = shapes.add_textbox(emu(mx + ox - 60), emu(my + oy - 10), emu(120), emu(20))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.text = text
        tf.paragraphs[0].alignment = PP_ALIGN.CENTER
        tf.paragraphs[0].runs[0].font.size = Pt(9)

    for scenario in scenarios:
        segments = scenario.get("segments") or []
        slide = prs.slides.add_slide(blank)
        shapes = slide.shapes

        for z, zx1, zy1, zx2, zy2 in zone_boxes:
            zb = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, emu(zx1 + ox), emu(zy1 + oy),
                                  emu(zx2 - zx1), emu(zy2 - zy1))
            zb.fill.background()
            zb.line.color.rgb = RGBColor(0x9C, 0xA3, 0xAF)
            zb.shadow.inherit = False
            zb.text_frame.text = z["name"]
            zb.text_frame.vertical_anchor = MSO_ANCHOR.TOP
            zb.text_frame.paragraphs[0].runs[0].font.size = Pt(9)
            zb.text_frame.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x6B, 0x72, 0x80)

        for nid, (x, y, w, h) in rects.items():
            nd = node_by_id[nid]
            kind = nd.get("kind", "srv")
            box = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, emu(x + ox), emu(y + oy), emu(w), emu(h))
            box.fill.solid()
            box.fill.fore_color.rgb = RGBColor(*TOPO_FILL.get(kind, TOPO_FILL["srv"]))
            box.line.color.rgb = RGBColor(*TOPO_LINE.get(kind, TOPO_LINE["srv"]))
            box.shadow.inherit = False
            tf = box.text_frame
            tf.word_wrap = True
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf.text = nd["name"]
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
            tf.paragraphs[0].runs[0].font.size = Pt(10)
            tf.paragraphs[0].runs[0].font.bold = True
            tf.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x1A, 0x20, 0x2C)

        # 정적 배선(links) — 화살촉 없는 회색선, 모든 슬라이드 공통
        for lk in links:
            r1, r2 = rects.get(lk.get("from")), rects.get(lk.get("to"))
            if not r1 or not r2:
                continue
            (ax, ay), (bx, by) = _anchor(r1, r2)
            ln = shapes.add_connector(MSO_CONNECTOR.STRAIGHT, emu(ax + ox), emu(ay + oy),
                                      emu(bx + ox), emu(by + oy))
            ln.line.color.rgb = RGBColor(0x94, 0xA3, 0xB8)

        # 구간 오버레이(segments) — 화살촉 + 번호 라벨
        for sg in segments:
            r1 = rects.get(sg.get("from"))
            if not r1:
                continue
            parts = ([f"({sg['n']})"] if sg.get("n") is not None else []) + \
                    ([sg["label"]] if sg.get("label") else [])
            label = " ".join(parts)
            to = sg.get("to")
            if sg.get("self") or not to or to not in rects:
                # self·대상없음 → 노드 위 라벨만 (rail/self 고급 라우팅은 범위 밖)
                if label:
                    _label(r1[0] + r1[2] / 2, r1[1] - 10, label)
                continue
            r2 = rects[to]
            (ax, ay), (bx, by) = _anchor(r1, r2)
            conn = shapes.add_connector(MSO_CONNECTOR.STRAIGHT, emu(ax + ox), emu(ay + oy),
                                        emu(bx + ox), emu(by + oy))
            conn.line.color.rgb = RGBColor(0x33, 0x41, 0x55)
            ln = conn.line._get_or_add_ln()
            ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle"}))
            if label:
                _label((ax + bx) / 2, (ay + by) / 2, label)

    prs.save(str(out_path))
    return len(scenarios)


def main():
    ap = argparse.ArgumentParser(description="flowcast 흐름도 → 편집가능 .pptx export (component·topology)")
    ap.add_argument("data", help="component 뷰 JSON 경로")
    ap.add_argument("-o", "--out", help="출력 .pptx (기본: 입력과 같은 위치 .pptx)")
    args = ap.parse_args()

    if not _import_pptx():
        print("python-pptx 가 필요합니다 (flowcast PPT export 전용 선택적 의존성).\n"
              "  pip install python-pptx", file=sys.stderr)
        return 2

    path = Path(args.data)
    if not path.exists():
        print(f"파일 없음: {path}", file=sys.stderr)
        return 1
    data = json.loads(path.read_text(encoding="utf-8"))
    dispatch = {"component": export_component, "topology": export_topology}
    view = data.get("view")
    if view not in dispatch:
        print(f"이 export 는 component·topology 뷰를 지원합니다 (view={view!r}). "
              "sequence 는 후속 예정.", file=sys.stderr)
        return 1

    out = Path(args.out) if args.out else path.with_suffix(".pptx")
    n = dispatch[view](data, out)
    print(f"pptx: {out} (슬라이드 {n})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
