#!/usr/bin/env python3
"""flowcast PPT 입력 변환기 (B-in) — .pptx 슬라이드에서 도형·라벨·연결을 추출해 draft JSON으로.

.pptx 는 OOXML(zip + XML)이라 표준 라이브러리만으로 파싱한다(외부 의존성 없음).
산출물은 뷰 중립 **draft** — diagram-drawer 가 이를 받아 뷰(sequence/topology/component)를
판별하고 flowcast 표준 JSON으로 정제한다. 좌표는 슬라이드 크기 기준 auto-fit 스케일.

사용법:
    python3 scripts/pptx_import.py {deck.pptx} [-o {out.json}] [--canvas 1000] [--scale S]

draft 스키마:
    { source, slide_size:{cx,cy}, scale,
      slides:[ { index, shapes:[{sid,text,x,y,w,h}], connectors:[{from,to}] } ] }

- 좌표/크기 단위는 원본 EMU에 scale 을 곱한 값. scale 미지정 시 canvas/slide_cx 로 auto-fit.
- connectors 는 커넥터 도형(p:cxnSp)의 stCxn/endCxn glue(도형 id 참조)에서만 확정한다
  (방향이 XML로 확증되는 경우). glue 없는 커넥터는 방향 불명이라 제외 — drawer 가 기하로 보완.
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


def _xfrm(sp):
    """도형 위치/크기 (EMU) — a:off/a:ext. 없으면 None."""
    off = sp.find(f".//{{{A}}}off")
    ext = sp.find(f".//{{{A}}}ext")
    if off is None or ext is None:
        return None
    return (
        int(off.get("x", 0)), int(off.get("y", 0)),
        int(ext.get("cx", 0)), int(ext.get("cy", 0)),
    )


def _shape_id(el):
    cnv = el.find(f".//{{{P}}}cNvPr")
    return cnv.get("id") if cnv is not None else None


def _parse_slide(xml_bytes, scale):
    root = ET.fromstring(xml_bytes)
    shapes, connectors = [], []

    for sp in root.iter(f"{{{P}}}sp"):
        box = _xfrm(sp)
        if box is None:
            continue
        x, y, w, h = box
        shapes.append({
            "sid": _shape_id(sp),
            "text": _text_of(sp),
            "x": round(x * scale, 1),
            "y": round(y * scale, 1),
            "w": round(w * scale, 1),
            "h": round(h * scale, 1),
        })

    # 커넥터: stCxn/endCxn glue 로 방향이 확증되는 것만
    for cxn in root.iter(f"{{{P}}}cxnSp"):
        st = cxn.find(f".//{{{A}}}stCxn")
        en = cxn.find(f".//{{{A}}}endCxn")
        if st is not None and en is not None:
            connectors.append({"from": st.get("id"), "to": en.get("id")})

    return shapes, connectors


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
            shapes, connectors = _parse_slide(zf.read(name), scale)
            slides.append({"index": i, "shapes": shapes, "connectors": connectors})

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
