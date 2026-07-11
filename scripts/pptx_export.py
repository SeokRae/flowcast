#!/usr/bin/env python3
"""flowcast PPT export (B-out) — 흐름도 뷰 JSON → 편집 가능한 네이티브 .pptx.

python-pptx 는 **export 경로 전용 선택적 의존성**이다(코어 render/import 는 stdlib 유지).
미설치 시 친절히 안내하고 종료한다.

좌표는 render.py 의 배치 로직(`_c_rect`·`_t_rect`·`_edge_pt`·`layout_sequence`)을 **그대로
재사용**해 HTML/PDF 와 동일한 상대 위치로 도형을 찍는다(재구현 금지). px → EMU(×9525) 변환.

슬라이드 캔버스(기본 `wide` = 1920×1080px, 16:9): 콘텐츠를 uniform scale 로 fit(업스케일
포함)하고 중앙 배치한다. 폰트도 같은 배율로 스케일(0.5pt 반올림, 최소 6pt).
`--slide-size auto` 는 기존 content-fit(콘텐츠 크기 = 슬라이드 크기) 동작.

사용법:
    python3 scripts/pptx_export.py {view.json} [-o {out.pptx}] [--slide-size wide|auto|{W}x{H}]

지원: sequence · component · topology 3뷰 (view 필드로 디스패치, 미지정=sequence).
- component: 노드 → 둥근 사각형 + 텍스트, 존 → 배경 사각형, 엣지 → 커넥터 + 라벨
- topology: 위와 동일 + 세그먼트 라벨은 번호 배지(원) + 하단 "흐름 설명" 범례 (render.py 패리티)
- sequence: 액터 박스 + 라이프라인 + 액티베이션 바 + 메시지 커넥터(kind별 색) + note 박스
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path

PX_TO_EMU = 9525   # 1px @96dpi
PAD_PX = 20        # auto(content-fit) 슬라이드 여백(px)
FIT_MARGIN = 60    # 고정 캔버스 fit 여백(px)
SLIDE_PRESETS = {"wide": (1920, 1080)}   # 캔버스 프리셋 (px) — 기본 wide
ACCENT = (0x1F, 0x6F, 0xD0)              # --accent (topology 번호 배지)

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


def _parse_slide_size(opt):
    """'wide'|'auto'|'{W}x{H}' → (W, H) px. auto 는 None(content-fit)."""
    if opt == "auto":
        return None
    if opt in SLIDE_PRESETS:
        return SLIDE_PRESETS[opt]
    try:
        w, h = str(opt).lower().split("x", 1)
        return int(w), int(h)
    except ValueError:
        raise SystemExit(f"--slide-size 형식 오류: {opt!r} (wide|auto|{{W}}x{{H}})")


def _fit(content_w, content_h, size):
    """콘텐츠(px)를 캔버스에 uniform scale 로 fit — (slide_w, slide_h, scale, dx, dy).

    dx/dy 는 콘텐츠-px 단위 중앙 배치 오프셋: 스케일된 emu 변환에서 (좌표 + dx) * scale.
    size=None(auto) 은 content-fit — scale 1, 여백 PAD_PX.
    """
    if size is None:
        return content_w + 2 * PAD_PX, content_h + 2 * PAD_PX, 1.0, PAD_PX, PAD_PX
    W, H = size
    s = min((W - 2 * FIT_MARGIN) / max(content_w, 1),
            (H - 2 * FIT_MARGIN) / max(content_h, 1))
    return W, H, s, (W / s - content_w) / 2, (H / s - content_h) / 2


def _fpt(base, s):
    """폰트 pt 를 배율 s 로 스케일 — 0.5pt 반올림, 최소 6pt."""
    return max(6.0, round(base * s * 2) / 2)


def _fill_lines(tf, name, s, size=10, sub_size=8,
                color=(0x1A, 0x20, 0x2C), sub_color=(0x4B, 0x55, 0x63), bold=True):
    """멀티라인 이름을 문단별로 채움 — 모든 문단에 명시적 스타일(첫 줄 base·bold, 이후 sub).

    `tf.text = "a\\nb"` 는 문단을 쪼개는데 기존 코드가 paragraphs[0]만 스타일링해
    둘째 줄부터 템플릿 기본값(18pt)으로 새던 버그의 공통 해소 지점.
    """
    from pptx.util import Pt
    from pptx.dml.color import RGBColor
    from pptx.enum.text import PP_ALIGN
    for i, ln in enumerate(str(name).split("\n")):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = ln
        first = i == 0
        r.font.size = Pt(_fpt(size if first else sub_size, s))
        r.font.bold = bold and first
        r.font.color.rgb = RGBColor(*(color if first else sub_color))


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


def export_component(data, out_path, slide_size="wide"):
    """component 뷰 JSON → .pptx (시나리오 1개 = 슬라이드 1장)."""
    from pptx import Presentation
    from pptx.util import Emu, Pt
    from pptx.enum.shapes import MSO_SHAPE, MSO_CONNECTOR
    from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    from pptx.dml.color import RGBColor
    from pptx.oxml.ns import qn

    R = _load_render()
    scenarios = data.get("scenarios") or []

    # 캔버스 = 시나리오 중 최대 bounding box 를 fit (좌표·크기는 스케일된 emu 로 변환)
    geoms = [_scene_geometry(R, sc) for sc in scenarios]
    max_w = max(((b[2] - b[0]) for _, _, b in geoms), default=400)
    max_h = max(((b[3] - b[1]) for _, _, b in geoms), default=300)
    SW, SH, s, dx, dy = _fit(max_w, max_h, _parse_slide_size(slide_size))
    emu = lambda px: Emu(int(round(px * s * PX_TO_EMU)))

    prs = Presentation()
    prs.slide_width = Emu(SW * PX_TO_EMU)
    prs.slide_height = Emu(SH * PX_TO_EMU)
    blank = prs.slide_layouts[6]

    def _arrow(connector, tail=True, head=False):
        ln = connector.line._get_or_add_ln()
        if head:
            ln.append(ln.makeelement(qn("a:headEnd"), {"type": "triangle"}))
        if tail:
            ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle"}))

    for scenario, (rects, zone_boxes, bbox) in zip(scenarios, geoms):
        minx, miny = bbox[0], bbox[1]
        ox, oy = -minx + dx, -miny + dy   # 원점 이동 + 중앙 배치
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
            tf.paragraphs[0].runs[0].font.size = Pt(_fpt(9, s))
            tf.paragraphs[0].runs[0].font.color.rgb = RGBColor(0x6B, 0x72, 0x80)
            tf.word_wrap = True
            zb.text_frame.vertical_anchor = MSO_ANCHOR.TOP

        # 엣지 커넥터 — 노드보다 먼저 (render.py z-순서 패리티: 노드가 선을 가림, #25)
        pending_labels = []
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

            parts = []
            if e.get("n") is not None:
                parts.append(f"({e['n']})")
            if e.get("label"):
                parts.append(e["label"])
            proto = f"( {e['protocol']} )" if e.get("protocol") else ""
            if parts or proto:
                mx = (e["lx"] if e.get("lx") is not None else (ax + bx) / 2)
                my = (e["ly"] if e.get("ly") is not None else (ay + by) / 2)
                pending_labels.append((mx, my, " ".join(parts), proto))

        # 노드 (커넥터 위)
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
            _fill_lines(tf, nd["name"], s, size=11)   # 밝은 fill 위 가독성
            if nd.get("port"):
                pp = tf.add_paragraph()
                pp.alignment = PP_ALIGN.CENTER
                r = pp.add_run()
                r.text = f"Port: {nd['port']}"
                r.font.size = Pt(_fpt(8, s))
                r.font.color.rgb = RGBColor(0x4B, 0x55, 0x63)

        # 엣지 라벨 (번호 인라인 + 프로토콜) — 최상위
        for mx, my, text, proto in pending_labels:
            tb = shapes.add_textbox(emu(mx + ox - 60), emu(my + oy - 12),
                                    emu(140), emu(30))
            tf = tb.text_frame
            tf.word_wrap = True
            tf.text = text
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
            tf.paragraphs[0].runs[0].font.size = Pt(_fpt(9, s))
            if proto:
                pp = tf.add_paragraph()
                pp.alignment = PP_ALIGN.CENTER
                r = pp.add_run()
                r.text = proto
                r.font.size = Pt(_fpt(8, s))

    prs.save(str(out_path))
    return len(scenarios)


def export_topology(data, out_path, slide_size="wide"):
    """topology 뷰 JSON → .pptx. nodes/links/zones 공유(모든 슬라이드) + 시나리오별 segments 오버레이.

    세그먼트 라벨은 render.py 패리티 — 엣지엔 원형 번호 배지만, 전문은 하단 "흐름 설명" 범례.
    """
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

    # 흐름 설명 범례(시나리오별) — render.py 와 동일한 줄바꿈, 최대 시나리오 기준 높이 선반영
    leg_x, leg_y = minx, maxy + 30
    legends, longest = [], 0
    for sc in scenarios:
        lines = []
        for sg in sc.get("segments") or []:
            if not sg.get("label"):
                continue
            prefix = f'{sg["n"]}. ' if sg.get("n") is not None else ""
            lines += R._wrap(prefix + sg["label"], R.T_LEG_WRAP)
        legends.append(lines)
        longest = max([longest] + [len(ln) for ln in lines])
    max_leg = max((len(ls) for ls in legends), default=0)
    if max_leg:
        maxy = leg_y + (max_leg + 1) * R.T_LEG_LH + 8   # 헤더 1줄 + 본문
        maxx = max(maxx, leg_x + longest * 7.2)

    SW, SH, s, dx, dy = _fit(maxx - minx, maxy - miny, _parse_slide_size(slide_size))
    ox, oy = -minx + dx, -miny + dy
    emu = lambda px: Emu(int(round(px * s * PX_TO_EMU)))
    prs = Presentation()
    prs.slide_width = Emu(SW * PX_TO_EMU)
    prs.slide_height = Emu(SH * PX_TO_EMU)
    blank = prs.slide_layouts[6]

    def _anchor(r1, r2):
        c1 = (r1[0] + r1[2] / 2, r1[1] + r1[3] / 2)
        c2 = (r2[0] + r2[2] / 2, r2[1] + r2[3] / 2)
        return R._edge_pt(r1, *c2), R._edge_pt(r2, *c1)

    def _badge(bx, by, n):
        """원형 번호 배지 (render.py r=11 패리티) — accent 채움 + 흰 숫자."""
        b = shapes.add_shape(MSO_SHAPE.OVAL, emu(bx + ox - 11), emu(by + oy - 11),
                             emu(22), emu(22))
        b.fill.solid()
        b.fill.fore_color.rgb = RGBColor(*ACCENT)
        b.line.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
        b.shadow.inherit = False
        tf = b.text_frame
        tf.word_wrap = False
        tf.vertical_anchor = MSO_ANCHOR.MIDDLE
        tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
        p = tf.paragraphs[0]
        p.alignment = PP_ALIGN.CENTER
        r = p.add_run()
        r.text = str(n)
        r.font.size = Pt(_fpt(8, s))
        r.font.bold = True
        r.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)

    for scenario, leg_lines in zip(scenarios, legends):
        segments = scenario.get("segments") or []
        slide = prs.slides.add_slide(blank)
        shapes = slide.shapes

        for z, zx1, zy1, zx2, zy2 in zone_boxes:
            zb = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, emu(zx1 + ox), emu(zy1 + oy),
                                  emu(zx2 - zx1), emu(zy2 - zy1))
            zb.fill.background()
            zb.line.color.rgb = RGBColor(0x9C, 0xA3, 0xAF)
            zb.shadow.inherit = False
            tf = zb.text_frame
            tf.text = z["name"]
            tf.vertical_anchor = MSO_ANCHOR.TOP
            p0 = tf.paragraphs[0]
            p0.alignment = PP_ALIGN.LEFT   # render.py 존 라벨 top-left 패리티
            p0.runs[0].font.size = Pt(_fpt(9, s))
            p0.runs[0].font.color.rgb = RGBColor(0x6B, 0x72, 0x80)

        # 정적 배선(links) — 화살촉 없는 회색선. 노드보다 먼저 (HTML z-순서 패리티, #25)
        for lk in links:
            r1, r2 = rects.get(lk.get("from")), rects.get(lk.get("to"))
            if not r1 or not r2:
                continue
            (ax, ay), (bx, by) = _anchor(r1, r2)
            ln = shapes.add_connector(MSO_CONNECTOR.STRAIGHT, emu(ax + ox), emu(ay + oy),
                                      emu(bx + ox), emu(by + oy))
            ln.line.color.rgb = RGBColor(0x94, 0xA3, 0xB8)

        # 구간 오버레이(segments) — 화살촉 커넥터. 배지는 노드 위에 spread 후 일괄 배치.
        badge_sgs = []
        for sg in segments:
            r1 = rects.get(sg.get("from"))
            if not r1:
                continue
            if sg.get("n") is not None:
                badge_sgs.append(sg)
            to = sg.get("to")
            if sg.get("self") or not to or to not in rects:
                continue   # self·대상없음 커넥터 라우팅은 범위 밖 (배지는 노드 위)
            r2 = rects[to]
            (ax, ay), (bx, by) = _anchor(r1, r2)
            conn = shapes.add_connector(MSO_CONNECTOR.STRAIGHT, emu(ax + ox), emu(ay + oy),
                                        emu(bx + ox), emu(by + oy))
            conn.line.color.rgb = RGBColor(0x33, 0x41, 0x55)
            ln = conn.line._get_or_add_ln()
            ln.append(ln.makeelement(qn("a:tailEnd"), {"type": "triangle"}))

        # 노드 — 커넥터 위 (관통 선을 가림)
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
            _fill_lines(tf, nd["name"], s, size=10)

        # 번호 배지 — render.py 공용 헬퍼(_t_badge_geom/_t_spread_badges)로 겹침 자동 회피
        spread = R._t_spread_badges([R._t_badge_geom(sg, rects) for sg in badge_sgs])
        for sg, (bx, by) in zip(badge_sgs, spread):
            _badge(bx, by, sg["n"])

        # 흐름 설명 범례 (render.py 패리티 — 다이어그램 하단)
        if leg_lines:
            tb = shapes.add_textbox(emu(leg_x + ox), emu(leg_y + oy - 14),
                                    emu(max(longest * 7.2, 200)),
                                    emu((len(leg_lines) + 1) * R.T_LEG_LH + 12))
            tf = tb.text_frame
            tf.word_wrap = True
            hp = tf.paragraphs[0]
            hr = hp.add_run()
            hr.text = "흐름 설명"
            hr.font.size = Pt(_fpt(9, s))
            hr.font.bold = True
            hr.font.color.rgb = RGBColor(0x54, 0x66, 0x7E)
            for ln_txt in leg_lines:
                p = tf.add_paragraph()
                r = p.add_run()
                r.text = ln_txt
                r.font.size = Pt(_fpt(9, s))
                r.font.color.rgb = RGBColor(0x1B, 0x26, 0x35)

    prs.save(str(out_path))
    return len(scenarios)


def export_sequence(data, out_path, slide_size="wide"):
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
    SW, SH, s, dx, dy = _fit(max_w, max_h, _parse_slide_size(slide_size))
    emu = lambda px: Emu(int(round(px * s * PX_TO_EMU)))   # 크기·길이
    X = lambda px: emu(px + dx)                            # 위치(x) — 중앙 배치 오프셋
    Y = lambda px: emu(px + dy)                            # 위치(y)
    BOX_W, BOX_H, ACT_W, ZONE_H = R.BOX_W, R.BOX_H, R.ACT_W, R.ZONE_H

    prs = Presentation()
    prs.slide_width = Emu(SW * PX_TO_EMU)
    prs.slide_height = Emu(SH * PX_TO_EMU)
    blank = prs.slide_layouts[6]

    def _labels(shapes, x, y, w, h, specs, align, anchor):
        """specs: [(text, size_pt, rgb, bold)] → 문단별 텍스트박스."""
        tb = shapes.add_textbox(X(x), Y(y), emu(w), emu(h))
        tf = tb.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = anchor
        for i, (text, size, rgb, bold) in enumerate(specs):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.alignment = align
            r = p.add_run()
            r.text = text
            r.font.size = Pt(_fpt(size, s))
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
            zb = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, X(zx1), Y(zone_y),
                                  emu(zx2 - zx1), emu(ZONE_H))
            zb.fill.solid()
            zb.fill.fore_color.rgb = RGBColor(*SEQ_ACTOR_FILL)
            zb.line.color.rgb = RGBColor(*SEQ_ACTOR_LINE)
            zb.shadow.inherit = False
            tf = zb.text_frame
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            tf.text = z["name"]
            tf.paragraphs[0].alignment = PP_ALIGN.CENTER
            tf.paragraphs[0].runs[0].font.size = Pt(_fpt(9, s))
            tf.paragraphs[0].runs[0].font.bold = True
            tf.paragraphs[0].runs[0].font.color.rgb = RGBColor(*SEQ_ACTOR_LINE)

        # 라이프라인(세로 점선)
        for a in L["actors"]:
            x = a["x"]
            ll = shapes.add_connector(MSO_CONNECTOR.STRAIGHT, X(x), Y(box_y + BOX_H),
                                      X(x), Y(bottom))
            ll.line.color.rgb = RGBColor(*SEQ_LIFELINE)
            ll.line.width = Pt(max(0.75, s))
            ll.line.dash_style = MSO_LINE_DASH_STYLE.DASH

        # 액티베이션 바
        for b in L["bars"]:
            ab = shapes.add_shape(MSO_SHAPE.RECTANGLE, X(b["x"]), Y(b["y"]),
                                  emu(ACT_W), emu(b["h"]))
            ab.fill.solid()
            ab.fill.fore_color.rgb = RGBColor(*SEQ_ACT_FILL)
            ab.line.color.rgb = RGBColor(*SEQ_ACT_LINE)
            ab.shadow.inherit = False

        # 액터 박스(포트/라인 2단)
        for a in L["actors"]:
            x = a["x"]
            box = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, X(x - BOX_W / 2), Y(box_y),
                                   emu(BOX_W), emu(BOX_H))
            box.fill.solid()
            box.fill.fore_color.rgb = RGBColor(*SEQ_ACTOR_FILL)
            box.line.color.rgb = RGBColor(*SEQ_ACTOR_LINE)
            box.shadow.inherit = False
            tf = box.text_frame
            tf.word_wrap = True
            tf.vertical_anchor = MSO_ANCHOR.MIDDLE
            _fill_lines(tf, a["name"], s, size=11, sub_size=8,
                        color=SEQ_ACTOR_LINE, sub_color=SEQ_MUTED)
            if a["attrs"]:
                pp = tf.add_paragraph()
                pp.alignment = PP_ALIGN.CENTER
                r = pp.add_run()
                r.text = a["attrs"]
                r.font.size = Pt(_fpt(8, s))
                r.font.color.rgb = RGBColor(*SEQ_MUTED)

        # 메시지 / 노트
        for st in L["steps"]:
            if st["type"] == "note":
                x1, x2, y, h, lines = st["x1"], st["x2"], st["y"], st["h"], st["lines"]
                nb = shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, X(x1), Y(y),
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
                conn = shapes.add_connector(MSO_CONNECTOR.ELBOW, X(sx), Y(y - 14),
                                            X(sx + 44), Y(y))
                _arrow(conn, rgb)
                lbl_x, lbl_align = sx + 52, PP_ALIGN.LEFT
            else:
                x1, x2 = st["x1"], st["x2"]
                conn = shapes.add_connector(MSO_CONNECTOR.STRAIGHT, X(x1), Y(y),
                                            X(x2), Y(y))
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
    ap.add_argument("--slide-size", default="wide",
                    help="슬라이드 캔버스: wide(1920x1080, 기본)|auto(content-fit)|{W}x{H} px")
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
    n = dispatch[view](data, out, slide_size=args.slide_size)
    print(f"pptx: {out} (슬라이드 {n})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
