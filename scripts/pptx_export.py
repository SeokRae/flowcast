#!/usr/bin/env python3
"""flowcast PPT export (B-out) — component 뷰 JSON → 편집 가능한 네이티브 .pptx.

python-pptx 는 **export 경로 전용 선택적 의존성**이다(코어 render/import 는 stdlib 유지).
미설치 시 친절히 안내하고 종료한다.

좌표는 render.py 의 component 배치 로직(`_c_rect`·`_edge_pt`·`C_*` 상수)을 **그대로 재사용**해
HTML/PDF 와 동일한 위치로 도형을 찍는다(재구현 금지). px → EMU(×9525) 변환.

사용법:
    python3 scripts/pptx_export.py {view.json} [-o {out.pptx}]

지원: sequence · component · topology 3뷰 (view 필드로 디스패치, 미지정=sequence).
- component/topology: 노드 → 둥근 사각형 + 텍스트, 존 → 배경 사각형, 엣지 → 커넥터 + 라벨
- sequence: 액터 박스 + 라이프라인 + 액티베이션 바 + 메시지 커넥터(kind별 색) + note 박스
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

# sequence kind: req/self(accent) · res/relay(muted) — render.py LIGHT 테마 흰배경 솔리드 근사
SEQ_ARROW = {"req": (0x1F, 0x6F, 0xD0), "self": (0x1F, 0x6F, 0xD0),
             "res": (0x54, 0x66, 0x7E), "relay": (0x54, 0x66, 0x7E)}
SEQ_ACTOR_FILL = (0xEF, 0xF5, 0xFC)   # --zone-bg over white
SEQ_ACTOR_LINE = (0x1F, 0x6F, 0xD0)   # --accent
SEQ_ACT_FILL = (0xE4, 0xEE, 0xF9)     # --act-bg over white
SEQ_ACT_LINE = (0xB7, 0xD1, 0xF0)     # --act-bd over white
SEQ_NOTE_FILL = (0xFA, 0xF6, 0xEE)    # --note-bg over white
SEQ_NOTE_LINE = (0xE0, 0xC9, 0x98)    # --note-bd over white
SEQ_TEXT = (0x1B, 0x26, 0x35)         # --text
SEQ_MUTED = (0x54, 0x66, 0x7E)        # --muted
SEQ_WARN = (0x8A, 0x62, 0x10)         # --warn
SEQ_LIFELINE = (0x9C, 0xA3, 0xAF)     # 회색 점선


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


def export_sequence(data, out_path):
    """sequence 뷰 JSON → .pptx (시나리오 1개 = 슬라이드 1장).

    render.py 의 layout_sequence() 기하를 그대로 소비 — actor 박스·라이프라인·
    activation bar·message(kind별 색)·note 를 px→EMU(×9525)로 배치(재구현 금지).
    self·note 는 render 와 동일 좌표에 배치하되 self-loop 는 엘보 커넥터로 근사.
    """
    from pptx import Presentation
    from pptx.util import Emu, Pt
    from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.enum.dml import MSO_LINE_DASH_STYLE
    from pptx.dml.color import RGBColor
    from pptx.oxml.ns import qn

    R = _load_render()
    scenarios = data.get("scenarios") or []
    layouts = [R.layout_sequence(data, sc) for sc in scenarios]
    max_w = max((L["width"] for L in layouts), default=400)
    max_h = max((L["height"] for L in layouts), default=300)
    emu = lambda px: Emu(int(round(px * PX_TO_EMU)))
    BOX_W, BOX_H, ACT_W, ZONE_H = R.BOX_W, R.BOX_H, R.ACT_W, R.ZONE_H

    prs = Presentation()
    prs.slide_width = emu(max_w)
    prs.slide_height = emu(max_h)
    blank = prs.slide_layouts[6]

    def _labels(shapes, x, y, w, h, specs, align, anchor):
        """specs: [(text, size_pt, rgb, bold)] → 문단별 텍스트박스."""
        tb = shapes.add_textbox(emu(x), emu(y), emu(w), emu(h))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = anchor
        for i, (text, size, rgb, bold) in enumerate(specs):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            r = p.add_run()
            r.text = text
            r.font.size = Pt(size)
            r.font.color.rgb = RGBColor(*rgb)
            r.font.bold = bold

    def _arrow(conn, rgb):
        conn.line.color.rgb = RGBColor(*rgb)
        ln = conn.line._get_or_add_ln()
        ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle"}))

    for L in layouts:
        slide = prs.slides.add_slide(blank)
        shapes = slide.shapes
        zone_y, box_y, bottom = L["zone_y"], L["box_y"], L["bottom"]

        # 존 밴드(배경)
        for z in L["zones"]:
            zx1, zx2 = z["x1"], z["x2"]
            zb = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, emu(zx1), emu(zone_y),
                                  emu(zx2 - zx1), emu(ZONE_H))
            zb.fill.solid()
            zb.fill.fore_color.rgb = RGBColor(*SEQ_ACTOR_FILL)
            zb.line.color.rgb = RGBColor(*SEQ_ACTOR_LINE)
            zb.shadow.inherit = False
            tf = zb.text_frame
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf.text = z["name"]
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
            tf.paragraphs[0].runs[0].font.size = Pt(9)
            tf.paragraphs[0].runs[0].font.bold = True
            tf.paragraphs[0].runs[0].font.color.rgb = RGBColor(*SEQ_ACTOR_LINE)

        # 라이프라인(세로 점선)
        for a in L["actors"]:
            x = a["x"]
            ll = shapes.add_connector(MSO_CONNECTOR.STRAIGHT, emu(x), emu(box_y + BOX_H),
                                      emu(x), emu(bottom))
            ll.line.color.rgb = RGBColor(*SEQ_LIFELINE)
            ll.line.width = Pt(1)
            ll.line.dash_style = MSO_LINE_DASH_STYLE.DASH

        # 액티베이션 바
        for b in L["bars"]:
            ab = shapes.add_shape(MSO_SHAPE.RECTANGLE, emu(b["x"]), emu(b["y"]),
                                  emu(ACT_W), emu(b["h"]))
            ab.fill.solid()
            ab.fill.fore_color.rgb = RGBColor(*SEQ_ACT_FILL)
            ab.line.color.rgb = RGBColor(*SEQ_ACT_LINE)
            ab.shadow.inherit = False

        # 액터 박스(포트/라인 2단)
        for a in L["actors"]:
            x = a["x"]
            box = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, emu(x - BOX_W / 2), emu(box_y),
                                   emu(BOX_W), emu(BOX_H))
            box.fill.solid()
            box.fill.fore_color.rgb = RGBColor(*SEQ_ACTOR_FILL)
            box.line.color.rgb = RGBColor(*SEQ_ACTOR_LINE)
            box.shadow.inherit = False
            tf = box.text_frame
            tf.word_wrap = True
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf.text = a["name"]
            p0 = tf.paragraphs[0]
            p0.alignment = PP_ALIGN.CENTER
            p0.runs[0].font.size = Pt(11)
            p0.runs[0].font.bold = True
            p0.runs[0].font.color.rgb = RGBColor(*SEQ_ACTOR_LINE)
            if a["attrs"]:
                pp = tf.add_paragraph()
                pp.alignment = PP_ALIGN.CENTER
                r = pp.add_run()
                r.text = a["attrs"]
                r.font.size = Pt(8)
                r.font.color.rgb = RGBColor(*SEQ_MUTED)

        # 메시지 / 노트
        for st in L["steps"]:
            if st["type"] == "note":
                x1, x2, y, h, lines = st["x1"], st["x2"], st["y"], st["h"], st["lines"]
                nb = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, emu(x1), emu(y),
                                      emu(x2 - x1), emu(h))
                nb.fill.solid()
                nb.fill.fore_color.rgb = RGBColor(*SEQ_NOTE_FILL)
                nb.line.color.rgb = RGBColor(*SEQ_NOTE_LINE)
                nb.shadow.inherit = False
                if lines:
                    _labels(shapes, x1, y, x2 - x1, h,
                            [(ln, 9, SEQ_TEXT, False) for ln in lines],
                            PP_ALIGN.LEFT, MSO_ANCHOR.MIDDLE)
                continue

            kind, y, lines, mid = st["kind"], st["y"], st["lines"], st["mid"]
            rgb = SEQ_ARROW.get(kind, SEQ_ARROW["req"])
            bold = kind in ("req", "self")
            if st["self"]:
                sx = st["self_x"]
                conn = shapes.add_connector(MSO_CONNECTOR.ELBOW, emu(sx), emu(y - 14),
                                            emu(sx + 44), emu(y))
                _arrow(conn, rgb)
                lbl_x, lbl_align = sx + 52, PP_ALIGN.LEFT
            else:
                x1, x2 = st["x1"], st["x2"]
                conn = shapes.add_connector(MSO_CONNECTOR.STRAIGHT, emu(x1), emu(y),
                                            emu(x2), emu(y))
                _arrow(conn, rgb)
                lbl_x, lbl_align = mid - 70, PP_ALIGN.CENTER

            # 메시지 라벨(번호 인라인 포함) — 화살표 위
            if lines:
                lh = 15 * len(lines)
                _labels(shapes, lbl_x, y - 6 - lh, 140, lh + 4,
                        [(ln, 9, rgb, bold) for ln in lines],
                        lbl_align, MSO_ANCHOR.BOTTOM)
            # protocol / sub — 화살표 아래
            extra_specs = []
            for cls, val in st["extras"]:
                if cls == "proto":
                    extra_specs.append((f"( {val} )", 8, SEQ_MUTED, False))
                else:
                    extra_specs.append((val, 8, SEQ_WARN, False))
            if extra_specs:
                _labels(shapes, mid - 70, y + 2, 140, 15 * len(extra_specs) + 4,
                        extra_specs, PP_ALIGN.CENTER, MSO_ANCHOR.TOP)

    prs.save(str(out_path))
    return len(layouts)


def main():
    ap = argparse.ArgumentParser(description="flowcast 흐름도 → 편집가능 .pptx export (sequence·component·topology)")
    ap.add_argument("data", help="흐름도 뷰 JSON 경로 (view: sequence|component|topology)")
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
    dispatch = {"sequence": export_sequence, "component": export_component,
                "topology": export_topology}
    # sequence 는 view 미지정이 기본값 → render.py 와 동일하게 sequence 로 간주
    view = data.get("view", "sequence")
    if view not in dispatch:
        print(f"이 export 는 sequence·component·topology 뷰를 지원합니다 (view={view!r}).",
              file=sys.stderr)
        return 1

    out = Path(args.out) if args.out else path.with_suffix(".pptx")
    n = dispatch[view](data, out)
    print(f"pptx: {out} (슬라이드 {n})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
