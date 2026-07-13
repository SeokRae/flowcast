#!/usr/bin/env python3
"""flowcast PPT 입력 변환기 (B-in) — .pptx 슬라이드에서 도형·라벨·연결을 추출해 draft JSON으로.

.pptx 는 OOXML(zip + XML)이라 표준 라이브러리만으로 파싱한다(외부 의존성 없음).
산출물은 뷰 중립 **draft** — diagram-drawer 가 이를 받아 뷰(sequence/topology/component)를
판별하고 flowcast 표준 JSON으로 정제한다. 좌표는 슬라이드 크기 기준 auto-fit 스케일.

사용법:
    python3 scripts/pptx_import.py {deck.pptx} [-o {out.json}] [--canvas 1000] [--scale S]

draft 스키마:
    { source, slide_size:{cx,cy}, scale,
      slides:[ { index,
                 shapes:[{sid,text,x,y,w,h}],
                 connectors:[{from,to}],
                 connectors_loose:[{sid,x1,y1,x2,y2,st?,en?}] } ] }

- 좌표/크기 단위는 원본 EMU에 scale 을 곱한 값. scale 미지정 시 canvas/slide_cx 로 auto-fit.
- connectors 는 커넥터 도형(p:cxnSp)의 stCxn/endCxn glue(도형 id 참조)가 양쪽 다 있어
  시작/끝 연결 도형이 확인된 것. glue 가 없거나 한쪽뿐인 커넥터는 connectors_loose 로 낸다 —
  bbox+flipH/flipV 로 계산한 시작(x1,y1)→끝(x2,y2) 점과 부분 glue(st/en)를 담아,
  drawer 가 끝점-도형 근접 매칭으로 연결을 보완한다. 두 경우 모두 업무 방향은 화살촉·
  라벨(별도 텍스트박스 shape)·문맥으로 별도 판별한다.
- 그룹(p:grpSp) 내부 도형·커넥터는 그룹 자식 좌표계(chOff/chExt) 변환을 보정해
  슬라이드 절대 좌표로 낸다(중첩 그룹 포함).
"""

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

A = "http://schemas.openxmlformats.org/drawingml/2006/main"
P = "http://schemas.openxmlformats.org/presentationml/2006/main"

DEFAULT_CANVAS = 1000.0  # 슬라이드 폭을 몇 px 로 매핑할지 (auto-fit 기준)


def _slide_sort_key(name):
    m = re.search(r"slide(\d+)\.xml$", name)
    return int(m.group(1)) if m else 0


def _text_of(sp):
    """도형의 텍스트 — 문단(a:p)은 \\n, 런(a:r/a:t)은 이어붙임."""
    paras = []
    for p in sp.iter(f"{{{A}}}p"):
        runs = [t.text or "" for t in p.iter(f"{{{A}}}t")]
        paras.append("".join(runs))
    return "\n".join(x for x in paras).strip()


def _xfrm(el):
    """도형/커넥터 위치·크기·반전 (EMU) — (x, y, w, h, flipH, flipV). 없으면 None."""
    xf = el.find(f".//{{{A}}}xfrm")
    if xf is None:
        return None
    off = xf.find(f"{{{A}}}off")
    ext = xf.find(f"{{{A}}}ext")
    if off is None or ext is None:
        return None
    return (
        int(off.get("x", 0)), int(off.get("y", 0)),
        int(ext.get("cx", 0)), int(ext.get("cy", 0)),
        xf.get("flipH") == "1", xf.get("flipV") == "1",
    )


def _shape_id(el):
    cnv = el.find(f".//{{{P}}}cNvPr")
    return cnv.get("id") if cnv is not None else None


def _group_xfrm(grp):
    """그룹 좌표 변환 성분 (gx, gy, cx0, cy0, kx, ky) — 자식 좌표 → 부모 좌표.

    x' = gx + (x - cx0) * kx. chOff/chExt 가 없으면 자식 좌표 = 부모 좌표(항등)로 본다.
    """
    xf = grp.find(f"{{{P}}}grpSpPr/{{{A}}}xfrm")
    if xf is None:
        return None
    off = xf.find(f"{{{A}}}off")
    ext = xf.find(f"{{{A}}}ext")
    if off is None or ext is None:
        return None
    gx, gy = int(off.get("x", 0)), int(off.get("y", 0))
    gcx, gcy = int(ext.get("cx", 0)), int(ext.get("cy", 0))
    ch_off = xf.find(f"{{{A}}}chOff")
    ch_ext = xf.find(f"{{{A}}}chExt")
    cx0 = int(ch_off.get("x", 0)) if ch_off is not None else gx
    cy0 = int(ch_off.get("y", 0)) if ch_off is not None else gy
    ccx = int(ch_ext.get("cx", 0)) if ch_ext is not None else gcx
    ccy = int(ch_ext.get("cy", 0)) if ch_ext is not None else gcy
    kx = gcx / ccx if ccx else 1.0
    ky = gcy / ccy if ccy else 1.0
    return gx, gy, cx0, cy0, kx, ky


def _walk(parent, tf, scale, shapes, connectors, loose):
    """spTree 를 순회하며 도형·커넥터 수집. tf=(ox,oy,sx,sy): X = ox + sx*x (그룹 변환 합성)."""
    ox, oy, sx, sy = tf
    for el in parent:
        tag = el.tag
        if tag == f"{{{P}}}sp":
            box = _xfrm(el)
            if box is None:
                continue
            x, y, w, h, _, _ = box
            shapes.append({
                "sid": _shape_id(el),
                "text": _text_of(el),
                "x": round((ox + sx * x) * scale, 1),
                "y": round((oy + sy * y) * scale, 1),
                "w": round(sx * w * scale, 1),
                "h": round(sy * h * scale, 1),
            })
        elif tag == f"{{{P}}}grpSp":
            g = _group_xfrm(el)
            if g is None:
                child_tf = tf
            else:
                gx, gy, cx0, cy0, kx, ky = g
                child_tf = (
                    ox + sx * (gx - kx * cx0), oy + sy * (gy - ky * cy0),
                    sx * kx, sy * ky,
                )
            _walk(el, child_tf, scale, shapes, connectors, loose)
        elif tag == f"{{{P}}}cxnSp":
            st = el.find(f".//{{{A}}}stCxn")
            en = el.find(f".//{{{A}}}endCxn")
            if st is not None and en is not None:
                # glue 양쪽 → 시작/끝 연결 도형 확인(업무 방향은 별도 판별)
                connectors.append({"from": st.get("id"), "to": en.get("id")})
                continue
            box = _xfrm(el)
            if box is None:
                continue
            # glue 미확증 → bbox+flip 으로 시작/끝점 계산 (drawer 가 근접 매칭으로 보완)
            x, y, w, h, fh, fv = box
            x1, x2 = (x + w, x) if fh else (x, x + w)
            y1, y2 = (y + h, y) if fv else (y, y + h)
            c = {
                "sid": _shape_id(el),
                "x1": round((ox + sx * x1) * scale, 1),
                "y1": round((oy + sy * y1) * scale, 1),
                "x2": round((ox + sx * x2) * scale, 1),
                "y2": round((oy + sy * y2) * scale, 1),
            }
            if st is not None:
                c["st"] = st.get("id")
            if en is not None:
                c["en"] = en.get("id")
            loose.append(c)


def _parse_slide(xml_bytes, scale):
    root = ET.fromstring(xml_bytes)
    tree = root.find(f"{{{P}}}cSld/{{{P}}}spTree")
    shapes, connectors, loose = [], [], []
    if tree is not None:
        _walk(tree, (0.0, 0.0, 1.0, 1.0), scale, shapes, connectors, loose)
    return shapes, connectors, loose


def _slide_size(zf):
    try:
        root = ET.fromstring(zf.read("ppt/presentation.xml"))
        sz = root.find(f"{{{P}}}sldSz")
        if sz is not None:
            return int(sz.get("cx")), int(sz.get("cy"))
    except KeyError:
        pass
    return None


def import_pptx(path, canvas=DEFAULT_CANVAS, scale=None):
    with zipfile.ZipFile(path) as zf:
        size = _slide_size(zf)
        if scale is None:
            scale = (canvas / size[0]) if size and size[0] else 1.0
        slide_files = sorted(
            (n for n in zf.namelist()
             if re.match(r"ppt/slides/slide\d+\.xml$", n)),
            key=_slide_sort_key,
        )
        slides = []
        for i, name in enumerate(slide_files, 1):
            shapes, connectors, loose = _parse_slide(zf.read(name), scale)
            slides.append({
                "index": i, "shapes": shapes,
                "connectors": connectors, "connectors_loose": loose,
            })

    return {
        "source": Path(path).name,
        "slide_size": {"cx": size[0], "cy": size[1]} if size else None,
        "scale": scale,
        "slides": slides,
    }


def main():
    ap = argparse.ArgumentParser(description="flowcast PPT 입력 변환기 (.pptx → draft JSON)")
    ap.add_argument("pptx", help=".pptx 파일 경로")
    ap.add_argument("-o", "--out", help="출력 JSON 경로 (기본: stdout)")
    ap.add_argument("--canvas", type=float, default=DEFAULT_CANVAS,
                    help=f"슬라이드 폭 매핑 px (auto-fit 기준, 기본 {int(DEFAULT_CANVAS)})")
    ap.add_argument("--scale", type=float, default=None,
                    help="EMU→px 스케일 직접 지정 (지정 시 --canvas 무시)")
    args = ap.parse_args()

    if not Path(args.pptx).exists():
        print(f"파일 없음: {args.pptx}", file=sys.stderr)
        return 1

    draft = import_pptx(args.pptx, canvas=args.canvas, scale=args.scale)
    text = json.dumps(draft, ensure_ascii=False, indent=2)
    if args.out:
        Path(args.out).write_text(text + "\n", encoding="utf-8")
        print(f"draft JSON: {args.out} (슬라이드 {len(draft['slides'])})")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
