#!/usr/bin/env python3
"""flowcast 시퀀스 뷰 렌더러 — IF 흐름도 JSON 데이터를 self-contained HTML(+PDF)로 변환.

사용법:
    python3 scripts/render.py {data.json} [-o {out.html}] [--pdf [{out.pdf}]]

데이터 스키마(JSON):
    system    : 시스템명 (필수)
    source    : 원본 출처 표기 (선택)
    zones[]   : { id, name } — 액터 그룹 밴드 (선택)
    actors[]  : { id, name, zone?, port?, line? } — 배열 순서 = 좌→우 레인 순서
    scenarios[]: { title, steps[] }
    steps[]   : { n?, from, to, label, kind, sub?, protocol? }
                kind: req(실선) | res(점선 응답) | relay(중계) | self(자기호출) | note(설명 박스)
                label 개행(\\n) = 다단 라벨. n 중복은 warning(원문 보존 허용).

    view      : "sequence"(기본) | "topology" | "component"
    [topology 전용] nodes[]: { id, name, zone?, col/row(그리드) 또는 x/y(절대), kind? }
                    kind: srv(기본) | ext(외부) | gear(네트워크 장비)
                    links[]: { from, to } — 번호·화살촉 없는 정적 배선(토폴로지 공통)
                    scenarios[].segments[]: { n?, from, to|self, label?, rail? } — 번호 구간 오버레이
                    segments 없는 시나리오 = 순수 인프라 구성도
    [component 전용] 노드/존/엣지를 시나리오별로 선언(각 다이어그램 독립)
                    scenarios[].nodes[]: { id, name, port?, zone?, col/row 또는 x/y, kind? }
                        kind: comp(기본, 내부 컴포넌트) | ext(외부 액터·시스템)
                    scenarios[].edges[]: { from, to, n?, label?, protocol?, bidir?, via?, lx?, ly?, lpos? }
                        bidir=양방향 화살촉, via=[x,y] 경유점, lx/ly=라벨 위치 오버라이드

표준 라이브러리만 사용. PDF 변환은 Chrome headless 필요.
"""
import argparse
import html
import json
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

KINDS = {"req", "res", "relay", "self", "note"}

# ── 레이아웃 상수 ──────────────────────────────────────────────
LANE_W = 170          # 레인 폭
ML = MR = 28          # 좌우 여백
BOX_W, BOX_H = 150, 52
ZONE_H, ZONE_GAP = 30, 8
ROW = 26              # 스텝 간 세로 간격
LBL_LH = 15           # 라벨 줄 높이
EXTRA_LH = 15         # sub/protocol 줄 높이
ACT_W = 12            # 액티베이션바 폭

# ── 토폴로지(구성도) 뷰 상수 ──────────────────────────────────
T_MARGIN = 26         # 캔버스 여백
T_CELL_W = 196        # 그리드 열 간격
T_CELL_H = 88         # 그리드 행 간격
T_BOX_W, T_BOX_H = 154, 50
T_ZONE_PAD = 14       # 존 박스 여백
T_ZONE_LBL = 18       # 존 라벨 높이
T_LEG_LH = 19         # 흐름 설명 줄 높이
T_LEG_WRAP = 46       # 흐름 설명 줄바꿈 문자 수

# ── 컴포넌트 뷰 상수 ──────────────────────────────────────────
C_MARGIN = 30
C_CELL_W = 214        # 그리드 열 간격
C_CELL_H = 120        # 그리드 행 간격
C_BOX_W, C_BOX_H = 152, 58
C_ZONE_PAD = 18
C_ZONE_LBL = 20
C_PAR_GAP = 16        # 평행 엣지 간 오프셋
C_LBL_LH = 14         # 엣지 라벨 줄 높이


def esc(s):
    return html.escape(str(s), quote=True)


# ── 검증 ──────────────────────────────────────────────────────
def validate(data):
    errors, warnings = [], []
    actors = data.get("actors") or []
    zones = {z["id"] for z in data.get("zones") or []}
    ids = [a.get("id") for a in actors]
    if not actors:
        errors.append("actors가 비어 있음")
    if len(ids) != len(set(ids)):
        errors.append(f"actor id 중복: {sorted({i for i in ids if ids.count(i) > 1})}")
    for a in actors:
        if not a.get("id") or not a.get("name"):
            errors.append(f"actor에 id/name 누락: {a}")
        if a.get("zone") and a["zone"] not in zones:
            errors.append(f"actor '{a.get('id')}'가 미정의 zone 참조: {a['zone']}")
    # zone 멤버 연속성 (밴드는 연속 레인만 지원)
    for z in data.get("zones") or []:
        idx = [i for i, a in enumerate(actors) if a.get("zone") == z["id"]]
        if not idx:
            warnings.append(f"zone '{z['id']}'에 소속 actor 없음")
        elif idx != list(range(idx[0], idx[-1] + 1)):
            errors.append(f"zone '{z['id']}' 소속 actor가 비연속 배치: index {idx}")
    if not data.get("scenarios"):
        errors.append("scenarios가 비어 있음")
    idset = set(ids)
    for si, sc in enumerate(data.get("scenarios") or []):
        if not sc.get("title"):
            errors.append(f"scenario[{si}]에 title 누락")
        seen_n = {}
        for ti, st in enumerate(sc.get("steps") or []):
            where = f"scenario[{si}].steps[{ti}]"
            kind = st.get("kind")
            if kind not in KINDS:
                errors.append(f"{where}: 잘못된 kind '{kind}' (허용: {sorted(KINDS)})")
            for key in ("from", "to"):
                if st.get(key) not in idset:
                    errors.append(f"{where}: 미정의 actor 참조 {key}='{st.get(key)}'")
            if kind == "note" and not st.get("label"):
                errors.append(f"{where}: note에 label 필수")
            n = st.get("n")
            if n is not None:
                if n in seen_n:
                    warnings.append(f"{where}: 스텝 번호 {n} 중복 (원문 보존으로 허용)")
                seen_n[n] = True
    return errors, warnings


def validate_topology(data):
    """구성도 뷰(view: topology) 검증 — 존·노드(그리드 좌표)·구간 오버레이."""
    errors, warnings = [], []
    nodes = data.get("nodes") or []
    zones = {z["id"] for z in data.get("zones") or []}
    ids = [n.get("id") for n in nodes]
    if not nodes:
        errors.append("nodes가 비어 있음")
    if len(ids) != len(set(ids)):
        errors.append(f"node id 중복: {sorted({i for i in ids if ids.count(i) > 1})}")
    for z in data.get("zones") or []:
        if not z.get("id") or not z.get("name"):
            errors.append(f"zone에 id/name 누락: {z}")
    for n in nodes:
        if not n.get("id") or not n.get("name"):
            errors.append(f"node에 id/name 누락: {n}")
        if n.get("zone") and n["zone"] not in zones:
            errors.append(f"node '{n.get('id')}'가 미정의 zone 참조: {n['zone']}")
        has_grid = n.get("col") is not None and n.get("row") is not None
        has_abs = n.get("x") is not None and n.get("y") is not None
        if not (has_grid or has_abs):
            errors.append(f"node '{n.get('id')}'에 위치 없음 (col/row 또는 x/y 필요)")
    idset = set(ids)
    for li, lk in enumerate(data.get("links") or []):
        for key in ("from", "to"):
            if lk.get(key) not in idset:
                errors.append(f"links[{li}]: 미정의 node 참조 {key}='{lk.get(key)}'")
    if not data.get("scenarios"):
        errors.append("scenarios가 비어 있음")
    for si, sc in enumerate(data.get("scenarios") or []):
        if not sc.get("title"):
            errors.append(f"scenario[{si}]에 title 누락")
        seen_n = {}
        for gi, sg in enumerate(sc.get("segments") or []):
            where = f"scenario[{si}].segments[{gi}]"
            if sg.get("from") not in idset:
                errors.append(f"{where}: 미정의 node 참조 from='{sg.get('from')}'")
            if not sg.get("self") and sg.get("to") not in idset:
                errors.append(f"{where}: 미정의 node 참조 to='{sg.get('to')}'")
            n = sg.get("n")
            if n is not None:
                if n in seen_n:
                    warnings.append(f"{where}: 구간 번호 {n} 중복 (원문 보존으로 허용)")
                seen_n[n] = True
    return errors, warnings


def validate_component(data):
    """컴포넌트 뷰(view: component) 검증 — 시나리오별 노드(포트)·존·방향 엣지."""
    errors, warnings = [], []
    if not data.get("scenarios"):
        errors.append("scenarios가 비어 있음")
    for si, sc in enumerate(data.get("scenarios") or []):
        if not sc.get("title"):
            errors.append(f"scenario[{si}]에 title 누락")
        nodes = sc.get("nodes") or []
        if not nodes:
            errors.append(f"scenario[{si}]에 nodes 없음")
        zones = {z["id"] for z in sc.get("zones") or []}
        ids = [n.get("id") for n in nodes]
        if len(ids) != len(set(ids)):
            errors.append(f"scenario[{si}] node id 중복: {sorted({i for i in ids if ids.count(i) > 1})}")
        for n in nodes:
            if not n.get("id") or not n.get("name"):
                errors.append(f"scenario[{si}] node에 id/name 누락: {n}")
            if n.get("zone") and n["zone"] not in zones:
                errors.append(f"scenario[{si}] node '{n.get('id')}'가 미정의 zone 참조: {n['zone']}")
            has_grid = n.get("col") is not None and n.get("row") is not None
            has_abs = n.get("x") is not None and n.get("y") is not None
            if not (has_grid or has_abs):
                errors.append(f"scenario[{si}] node '{n.get('id')}'에 위치 없음 (col/row 또는 x/y 필요)")
        idset = set(ids)
        seen_n = {}
        for ei, e in enumerate(sc.get("edges") or []):
            where = f"scenario[{si}].edges[{ei}]"
            for key in ("from", "to"):
                if e.get(key) not in idset:
                    errors.append(f"{where}: 미정의 node 참조 {key}='{e.get(key)}'")
            n = e.get("n")
            if n is not None:
                if n in seen_n:
                    warnings.append(f"{where}: 엣지 번호 {n} 중복 (원문 보존으로 허용)")
                seen_n[n] = True
    return errors, warnings


# ── 시퀀스 레이아웃 (단일 진실) ────────────────────────────────
def layout_sequence(data, scenario):
    """sequence 뷰 기하 계산. render_svg(SVG)·export_sequence(pptx)가 공유 — 재구현 금지.

    반환 dict:
      width, height, zone_y, box_y, bottom : 캔버스/기준 좌표
      actors : [{id, x, name, attrs}]        (x = 라이프라인 중심)
      zones  : [{name, x1, x2}]              (존 밴드; y=zone_y, h=ZONE_H)
      steps  : 순서 보존 레코드
        note : {type:"note", x1, x2, y, h, lines}
        msg  : {type:"msg", kind, self, y, x1, x2, self_x, mid, lines, extras:[(cls,val)]}
      bars   : [{x, y, h}]                    (액티베이션바; w=ACT_W)
    """
    actors = data["actors"]
    zones = data.get("zones") or []
    n_act = len(actors)
    width = ML + MR + LANE_W * n_act
    cx = {a["id"]: ML + LANE_W * i + LANE_W / 2 for i, a in enumerate(actors)}

    zone_y = 14
    box_y = zone_y + ZONE_H + ZONE_GAP if zones else 14
    y0 = box_y + BOX_H + 34

    steps, touched = [], {}

    def touch(aid, y):
        touched.setdefault(aid, []).append(y)

    cur = y0
    for st in scenario["steps"]:
        kind = st["kind"]
        label = st.get("label", "")
        lines = label.split("\n") if label else []
        if kind == "note":
            x1 = min(cx[st["from"]], cx[st["to"]]) - 70
            x2 = max(cx[st["from"]], cx[st["to"]]) + 70
            h = 18 * len(lines) + 16
            steps.append({"type": "note", "x1": x1, "x2": x2, "y": cur, "h": h, "lines": lines})
            cur += h + 18
            continue

        if lines and st.get("n") is not None:
            lines = [f"{st['n']}. {lines[0]}"] + lines[1:]
        lbl_h = LBL_LH * len(lines)
        y = cur + lbl_h + 6
        xa, xb = cx[st["from"]], cx[st["to"]]
        touch(st["from"], y)
        touch(st["to"], y)
        mid = (xa + xb) / 2

        rec = {"type": "msg", "kind": kind, "self": kind == "self", "y": y,
               "mid": mid, "lines": lines, "x1": None, "x2": None, "self_x": None, "extras": []}
        if kind == "self":
            rec["self_x"] = xa + ACT_W / 2
        else:
            off = ACT_W / 2 + 1
            rec["x1"], rec["x2"] = (xa + off, xb - off - 1) if xb > xa else (xa - off, xb + off + 1)
        for cls, val in (("proto", st.get("protocol")), ("sub", st.get("sub"))):
            if val:
                rec["extras"].append((cls, val))
        steps.append(rec)
        cur = y + EXTRA_LH * len(rec["extras"]) + ROW

    bottom = cur + 8
    height = bottom + 16

    zone_bands = []
    for z in zones:
        idx = [i for i, a in enumerate(actors) if a.get("zone") == z["id"]]
        if not idx:
            continue
        zx1 = ML + LANE_W * idx[0] + 8
        zx2 = ML + LANE_W * idx[-1] + LANE_W - 8
        zone_bands.append({"name": z["name"], "x1": zx1, "x2": zx2})

    actor_recs = [{"id": a["id"], "x": cx[a["id"]], "name": a["name"],
                   "attrs": " · ".join(str(a[k]) for k in ("port", "line") if a.get(k))}
                  for a in actors]
    bars = [{"x": cx[aid] - ACT_W / 2, "y": min(ys) - 10, "h": max(ys) - min(ys) + 20}
            for aid, ys in touched.items()]

    return {"width": width, "height": height, "zone_y": zone_y, "box_y": box_y,
            "bottom": bottom, "actors": actor_recs, "zones": zone_bands,
            "steps": steps, "bars": bars}


# ── SVG 생성 ──────────────────────────────────────────────────
def render_svg(data, scenario):
    L = layout_sequence(data, scenario)
    width, height, box_y, bottom = L["width"], L["height"], L["box_y"], L["bottom"]

    body = []
    for st in L["steps"]:
        if st["type"] == "note":
            x1, x2, y, h, lines = st["x1"], st["x2"], st["y"], st["h"], st["lines"]
            body.append(f'<rect class="note" x="{x1}" y="{y}" width="{x2 - x1}" height="{h}" rx="8"/>')
            for i, ln in enumerate(lines):
                body.append(f'<text class="note-tx" x="{x1 + 14}" y="{y + 22 + i * 18}">{esc(ln)}</text>')
            continue

        kind, y, lines, mid = st["kind"], st["y"], st["lines"], st["mid"]
        if st["self"]:
            x = st["self_x"]
            body.append(f'<path class="ar-{kind} ar" d="M{x},{y - 14} C{x + 44},{y - 14} {x + 44},{y} {x},{y}" marker-end="url(#mk-{kind})"/>')
            for i, ln in enumerate(lines):
                body.append(f'<text class="lb-{kind}" x="{x + 52}" y="{y - 14 - 4 - LBL_LH * (len(lines) - 1 - i)}">{esc(ln)}</text>')
        else:
            x1, x2 = st["x1"], st["x2"]
            body.append(f'<line class="ar-{kind} ar" x1="{x1}" y1="{y}" x2="{x2}" y2="{y}" marker-end="url(#mk-{kind})"/>')
            for i, ln in enumerate(lines):
                body.append(f'<text class="lb-{kind}" x="{mid}" y="{y - 6 - LBL_LH * (len(lines) - 1 - i)}" text-anchor="middle">{esc(ln)}</text>')

        extra_y = y + EXTRA_LH
        for cls, val in st["extras"]:
            body.append(f'<text class="lb-{cls}" x="{mid}" y="{extra_y}" text-anchor="middle">( {esc(val)} )</text>' if cls == "proto"
                        else f'<text class="lb-{cls}" x="{mid}" y="{extra_y}" text-anchor="middle">{esc(val)}</text>')
            extra_y += EXTRA_LH

    head = []
    # 존 밴드
    for z in L["zones"]:
        zx1, zx2 = z["x1"], z["x2"]
        head.append(f'<rect class="zone" x="{zx1}" y="{L["zone_y"]}" width="{zx2 - zx1}" height="{ZONE_H}" rx="8"/>')
        head.append(f'<text class="zone-tx" x="{(zx1 + zx2) / 2}" y="{L["zone_y"] + ZONE_H / 2 + 4}" text-anchor="middle">{esc(z["name"])}</text>')
    # 라이프라인 → 액터 박스 → 액티베이션바 순서로 겹침 처리
    for a in L["actors"]:
        x = a["x"]
        head.append(f'<line class="lifeline" x1="{x}" y1="{box_y + BOX_H}" x2="{x}" y2="{bottom}"/>')
    for a in L["actors"]:
        x, attrs = a["x"], a["attrs"]
        head.append(f'<rect class="actor" x="{x - BOX_W / 2}" y="{box_y}" width="{BOX_W}" height="{BOX_H}" rx="9"/>')
        ny = box_y + (BOX_H / 2 + 4 if not attrs else BOX_H / 2 - 3)
        head.append(f'<text class="actor-tx" x="{x}" y="{ny}" text-anchor="middle">{esc(a["name"])}</text>')
        if attrs:
            head.append(f'<text class="actor-sub" x="{x}" y="{box_y + BOX_H / 2 + 15}" text-anchor="middle">{esc(attrs)}</text>')
    for b in L["bars"]:
        head.append(f'<rect class="act-bar" x="{b["x"]}" y="{b["y"]}" width="{ACT_W}" height="{b["h"]}" rx="2"/>')

    markers = "".join(
        f'<marker id="mk-{k}" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">'
        f'<path class="mk mk-{k}" d="M0,0 L0,8 L8,4z"/></marker>'
        for k in ("req", "res", "relay", "self"))
    svg = (f'<svg viewBox="0 0 {width} {height}" style="width:100%;display:block;" '
           f'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{esc(scenario["title"])}">'
           f'<defs>{markers}</defs>{"".join(head)}{"".join(body)}</svg>')
    return svg, width, height


# ── 토폴로지 SVG 생성 ─────────────────────────────────────────
def _t_rect(nd):
    """노드 사각형 (x, y, w, h). col/row 그리드 기준, x/y 있으면 오버라이드."""
    w, h = nd.get("w", T_BOX_W), nd.get("h", T_BOX_H)
    if nd.get("col") is not None and nd.get("row") is not None:
        x = T_MARGIN + nd["col"] * T_CELL_W
        y = T_MARGIN + nd["row"] * T_CELL_H
    else:
        x = y = T_MARGIN
    if nd.get("x") is not None:
        x = float(nd["x"])
    if nd.get("y") is not None:
        y = float(nd["y"])
    return x, y, w, h


def _edge_pt(rect, tx, ty):
    """rect 중심에서 (tx,ty) 방향으로 rect 경계와 만나는 점."""
    x, y, w, h = rect
    cx, cy = x + w / 2, y + h / 2
    dx, dy = tx - cx, ty - cy
    if dx == 0 and dy == 0:
        return cx, cy
    sx = (w / 2) / abs(dx) if dx else float("inf")
    sy = (h / 2) / abs(dy) if dy else float("inf")
    s = min(sx, sy)
    return cx + dx * s, cy + dy * s


def _wrap(text, width):
    """긴 흐름 설명을 문자 수 기준 하드 줄바꿈 (한글은 공백이 적어 char 기준)."""
    return [text[i:i + width] for i in range(0, len(text), width)] or [""]


def _t_badge_geom(sg, rects):
    """세그먼트 1개의 배지 위치 + 엣지 단위방향 (bx, by, ux, uy) — render·pptx 공용.

    normal은 앵커의 0.45/0.55 보간, rail은 rail 중점, self·대상없음은 노드 위(-34).
    ux,uy 는 충돌 spread 때 배지를 밀어낼 방향(자기 엣지 방향, self는 수평).
    """
    a = rects[sg["from"]]
    to = sg.get("to")
    if sg.get("self") or not to or to not in rects:
        return a[0] + a[2] / 2, a[1] - 34, 1.0, 0.0
    b = rects[to]
    ac = (a[0] + a[2] / 2, a[1] + a[3] / 2)
    bc = (b[0] + b[2] / 2, b[1] + b[3] / 2)
    if sg.get("rail") is not None:
        rail = float(sg["rail"])
        p1 = _edge_pt(a, ac[0], rail)
        p2 = _edge_pt(b, bc[0], rail)
        bx, by = (p1[0] + p2[0]) / 2, rail
        dx, dy = p2[0] - p1[0], 0.0
    else:
        p1 = _edge_pt(a, bc[0], bc[1])
        p2 = _edge_pt(b, ac[0], ac[1])
        bx, by = p1[0] * 0.45 + p2[0] * 0.55, p1[1] * 0.45 + p2[1] * 0.55
        dx, dy = p2[0] - p1[0], p2[1] - p1[1]
    n = (dx * dx + dy * dy) ** 0.5 or 1.0
    return bx, by, dx / n, dy / n


def _t_spread_badges(geoms, r=11, gap=2, iters=8):
    """배지 겹침 자동 회피 — 겹친 쌍을 각자 자기 엣지 방향으로, 서로 멀어지는 부호로 밀어냄.

    geoms: [(bx, by, ux, uy)] → [(bx, by)]. 결정적(입력 순서 고정·반복 상한 iters).
    부호는 분리 벡터와의 내적으로 정한다 — 역평행 엣지(왕복 구간 A→B/B→A)에서
    둘이 같은 방향으로 밀려 겹침이 유지되는 퇴행을 막고, 그래도 개선이 없으면
    (완전 평행·동일점) j 쪽 부호를 반전한다.
    """
    min_d = 2 * r + gap
    pts = [list(g) for g in geoms]
    for _ in range(iters):
        moved = False
        for i in range(len(pts)):
            for j in range(i + 1, len(pts)):
                dx = pts[j][0] - pts[i][0]
                dy = pts[j][1] - pts[i][1]
                d = (dx * dx + dy * dy) ** 0.5
                if d >= min_d:
                    continue
                push = (min_d - d) / 2 + 0.5
                si = -1.0 if dx * pts[i][2] + dy * pts[i][3] > 0 else 1.0
                sj = 1.0 if dx * pts[j][2] + dy * pts[j][3] >= 0 else -1.0
                nix = pts[i][0] + pts[i][2] * si * push
                niy = pts[i][1] + pts[i][3] * si * push
                njx = pts[j][0] + pts[j][2] * sj * push
                njy = pts[j][1] + pts[j][3] * sj * push
                if ((njx - nix) ** 2 + (njy - niy) ** 2) ** 0.5 <= d:
                    sj = -sj
                    njx = pts[j][0] + pts[j][2] * sj * push
                    njy = pts[j][1] + pts[j][3] * sj * push
                pts[i][0], pts[i][1] = nix, niy
                pts[j][0], pts[j][1] = njx, njy
                moved = True
        if not moved:
            break
    return [(p[0], p[1]) for p in pts]


def render_svg_topology(data, scenario):
    nodes = data["nodes"]
    zones = data.get("zones") or []
    segments = scenario.get("segments") or []
    rects = {n["id"]: _t_rect(n) for n in nodes}

    # 이번 시나리오 경로에 포함된 노드 = 강조, 나머지 = 문맥(흐림)
    on = set()
    for sg in segments:
        on.add(sg.get("from"))
        if sg.get("to"):
            on.add(sg.get("to"))

    xs, ys = [], []
    for x, y, w, h in rects.values():
        xs += [x, x + w]
        ys += [y, y + h]

    # 존 = 소속 노드 bounding box (자동 크기)
    zone_body = []
    for z in zones:
        members = [n["id"] for n in nodes if n.get("zone") == z["id"]]
        mr = [rects[mid] for mid in members]
        if not mr:
            continue
        zx1 = min(x for x, y, w, h in mr) - T_ZONE_PAD
        zy1 = min(y for x, y, w, h in mr) - T_ZONE_PAD - T_ZONE_LBL
        zx2 = max(x + w for x, y, w, h in mr) + T_ZONE_PAD
        zy2 = max(y + h for x, y, w, h in mr) + T_ZONE_PAD
        xs += [zx1, zx2]
        ys += [zy1, zy2]
        zone_body.append(f'<g class="iff-zone" data-zone="{esc(z["id"])}" data-members="{esc(",".join(members))}" data-pad="{T_ZONE_PAD}" data-lbl="{T_ZONE_LBL}" data-lblpos="tl">')
        zone_body.append(f'<rect class="topo-zone" x="{zx1}" y="{zy1}" width="{zx2 - zx1}" height="{zy2 - zy1}" rx="10"/>')
        zone_body.append(f'<text class="topo-zone-tx" x="{zx1 + 10}" y="{zy1 + 13}">{esc(z["name"])}</text>')
        zone_body.append('</g>')

    # 노드
    node_body = []
    for nd in nodes:
        x, y, w, h = rects[nd["id"]]
        kind = nd.get("kind", "srv")
        # 순수 구성도(segments 없음) = 중립. 오버레이 = 경로 노드 강조 / 나머지 흐림.
        state = "" if not segments else (" on" if nd["id"] in on else " dim")
        cls = "topo-node"
        if kind == "ext":
            cls += " topo-ext"
        elif kind == "gear":
            cls += " topo-gear"
        cls += state
        node_body.append(f'<g class="iff-node" data-id="{esc(nd["id"])}" data-cx="{x + w / 2}" data-cy="{y + h / 2}" data-w="{w}" data-h="{h}">')
        node_body.append(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="9"/>')
        lines = str(nd["name"]).split("\n")
        txcls = "topo-tx on" if state == " on" else "topo-tx"
        for i, ln in enumerate(lines):
            ty = y + h / 2 + 4 - (len(lines) - 1) * 6 + i * 12
            node_body.append(f'<text class="{txcls}" x="{x + w / 2}" y="{ty}" text-anchor="middle">{esc(ln)}</text>')
        node_body.append('</g>')

    # 정적 배선 (links, 번호·화살촉 없음) — 토폴로지 공통 배경
    link_body = []
    for lk in data.get("links") or []:
        a = rects.get(lk.get("from"))
        b = rects.get(lk.get("to"))
        if not a or not b:
            continue
        ac = (a[0] + a[2] / 2, a[1] + a[3] / 2)
        bc = (b[0] + b[2] / 2, b[1] + b[3] / 2)
        p1 = _edge_pt(a, bc[0], bc[1])
        p2 = _edge_pt(b, ac[0], ac[1])
        link_body.append(f'<line class="topo-link" data-from="{esc(lk["from"])}" data-to="{esc(lk["to"])}" x1="{p1[0]}" y1="{p1[1]}" x2="{p2[0]}" y2="{p2[1]}"/>')

    # 구간 오버레이 (화살표 + 번호 배지 — 배지는 _t_badge_geom/_t_spread_badges 로 겹침 회피)
    seg_paths, badges, badge_sgs = [], [], []
    for sg in segments:
        a = rects[sg["from"]]
        if sg.get("self"):
            sx, sy = a[0] + a[2] / 2, a[1]
            seg_paths.append(f'<path class="topo-seg" data-self="{esc(sg["from"])}" d="M{sx - 16},{sy} C{sx - 16},{sy - 30} {sx + 16},{sy - 30} {sx + 16},{sy}" marker-end="url(#mk-topo)"/>')
        else:
            b = rects[sg["to"]]
            ac = (a[0] + a[2] / 2, a[1] + a[3] / 2)
            bc = (b[0] + b[2] / 2, b[1] + b[3] / 2)
            if sg.get("rail") is not None:
                rail = float(sg["rail"])
                p1 = _edge_pt(a, ac[0], rail)
                p2 = _edge_pt(b, bc[0], rail)
                d = f'M{p1[0]},{p1[1]} L{p1[0]},{rail} L{p2[0]},{rail} L{p2[0]},{p2[1]}'
            else:
                p1 = _edge_pt(a, bc[0], bc[1])
                p2 = _edge_pt(b, ac[0], ac[1])
                d = f'M{p1[0]},{p1[1]} L{p2[0]},{p2[1]}'
            seg_paths.append(f'<path class="topo-seg" data-from="{esc(sg["from"])}" data-to="{esc(sg["to"])}" d="{d}" marker-end="url(#mk-topo)"/>')
        if sg.get("n") is not None:
            badge_sgs.append(sg)
    spread = _t_spread_badges([_t_badge_geom(sg, rects) for sg in badge_sgs])
    for sg, (bx, by) in zip(badge_sgs, spread):
        dattr = f'data-self="{esc(sg["from"])}"' if sg.get("self") else f'data-from="{esc(sg["from"])}" data-to="{esc(sg["to"])}"'
        badges.append(f'<g class="iff-badge" {dattr}>')
        badges.append(f'<circle class="topo-badge" cx="{bx}" cy="{by}" r="11"/>')
        badges.append(f'<text class="topo-badge-tx" x="{bx}" y="{by + 4}" text-anchor="middle">{esc(sg["n"])}</text>')
        badges.append('</g>')

    # 흐름 설명 legend (토폴로지 하단)
    leg_x = min(xs) if xs else T_MARGIN
    leg_lines, longest = [], 0
    labelled = [sg for sg in segments if sg.get("label")]
    if labelled:
        leg_y = max(ys) + 30
        leg_lines.append(f'<text class="topo-legend-h" x="{leg_x}" y="{leg_y}">흐름 설명</text>')
        ly = leg_y + T_LEG_LH + 4
        for sg in labelled:
            prefix = f'{sg["n"]}. ' if sg.get("n") is not None else ""
            for ln in _wrap(prefix + sg["label"], T_LEG_WRAP):
                longest = max(longest, len(ln))
                leg_lines.append(f'<text class="topo-legend-tx" x="{leg_x}" y="{ly}">{esc(ln)}</text>')
                ly += T_LEG_LH
            ly += 2
        maxy = ly
    else:
        maxy = max(ys) if ys else T_MARGIN

    minx, miny = min(xs), min(ys)
    maxx = max(max(xs), leg_x + longest * 7.2)
    pad = 14
    vb_x, vb_y = minx - pad, miny - pad
    vb_w = (maxx - minx) + 2 * pad
    vb_h = (maxy - miny) + 2 * pad

    marker = ('<marker id="mk-topo" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto">'
              '<path class="mk-topo" d="M0,0 L8,3 L0,6z"/></marker>')
    svg = (f'<svg viewBox="{vb_x} {vb_y} {vb_w} {vb_h}" style="width:100%;display:block;" '
           f'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{esc(scenario["title"])}">'
           f'<defs>{marker}</defs>'
           f'{"".join(zone_body)}{"".join(link_body)}{"".join(seg_paths)}{"".join(node_body)}{"".join(badges)}{"".join(leg_lines)}</svg>')
    return svg, vb_w, vb_h


# ── 컴포넌트 SVG 생성 ─────────────────────────────────────────
def _c_rect(nd):
    """컴포넌트 노드 사각형. col/row 그리드 기준, x/y 있으면 오버라이드."""
    w, h = nd.get("w", C_BOX_W), nd.get("h", C_BOX_H)
    if nd.get("col") is not None and nd.get("row") is not None:
        x = C_MARGIN + nd["col"] * C_CELL_W
        y = C_MARGIN + nd["row"] * C_CELL_H
    else:
        x = y = C_MARGIN
    if nd.get("x") is not None:
        x = float(nd["x"])
    if nd.get("y") is not None:
        y = float(nd["y"])
    return x, y, w, h


def render_svg_component(data, scenario):
    """컴포넌트 뷰 — 포트 달린 컴포넌트 박스 + 라벨·프로토콜을 나르는 방향 엣지.
    노드/존/엣지는 시나리오별로 선언(각 다이어그램 독립)."""
    nodes = scenario.get("nodes") or []
    zones = scenario.get("zones") or []
    edges = scenario.get("edges") or []
    rects = {n["id"]: _c_rect(n) for n in nodes}

    xs, ys = [], []
    for x, y, w, h in rects.values():
        xs += [x, x + w]
        ys += [y, y + h]

    # 존 = 소속 노드 bounding box (자동 크기)
    zone_body = []
    for z in zones:
        members = [n["id"] for n in nodes if n.get("zone") == z["id"]]
        mr = [rects[mid] for mid in members]
        if not mr:
            continue
        zx1 = min(x for x, y, w, h in mr) - C_ZONE_PAD
        zy1 = min(y for x, y, w, h in mr) - C_ZONE_PAD - C_ZONE_LBL
        zx2 = max(x + w for x, y, w, h in mr) + C_ZONE_PAD
        zy2 = max(y + h for x, y, w, h in mr) + C_ZONE_PAD
        xs += [zx1, zx2]
        ys += [zy1, zy2]
        zone_body.append(f'<g class="iff-zone" data-zone="{esc(z["id"])}" data-members="{esc(",".join(members))}" data-pad="{C_ZONE_PAD}" data-lbl="{C_ZONE_LBL}" data-lblpos="tr">')
        zone_body.append(f'<rect class="comp-zone" x="{zx1}" y="{zy1}" width="{zx2 - zx1}" height="{zy2 - zy1}" rx="12"/>')
        zone_body.append(f'<text class="comp-zone-tx" x="{zx2 - 12}" y="{zy1 + 15}" text-anchor="end">{esc(z["name"])}</text>')
        zone_body.append('</g>')

    # 평행 엣지(같은 노드쌍 다중 연결) 그룹핑 → 오프셋 인덱스
    groups = defaultdict(list)
    for i, e in enumerate(edges):
        groups[frozenset((e["from"], e["to"]))].append(i)
    order = {}
    for idxs in groups.values():
        for k, i in enumerate(idxs):
            order[i] = (k, len(idxs))

    edge_body, label_body = [], []
    for i, e in enumerate(edges):
        a, b = rects[e["from"]], rects[e["to"]]
        ac = (a[0] + a[2] / 2, a[1] + a[3] / 2)
        bc = (b[0] + b[2] / 2, b[1] + b[3] / 2)
        p1 = _edge_pt(a, bc[0], bc[1])
        p2 = _edge_pt(b, ac[0], ac[1])
        # 평행 오프셋 (선을 연결선에 수직으로 밀어 겹침 방지)
        k, cnt = order[i]
        dx, dy = p2[0] - p1[0], p2[1] - p1[1]
        L = (dx * dx + dy * dy) ** 0.5 or 1
        px, py = -dy / L, dx / L
        off = (k - (cnt - 1) / 2) * C_PAR_GAP if cnt > 1 else 0
        p1 = (p1[0] + px * off, p1[1] + py * off)
        p2 = (p2[0] + px * off, p2[1] + py * off)

        via = e.get("via")
        if via:
            d = f'M{p1[0]},{p1[1]} L{via[0]},{via[1]} L{p2[0]},{p2[1]}'
            mx, my = via[0], via[1]
        else:
            d = f'M{p1[0]},{p1[1]} L{p2[0]},{p2[1]}'
            t = e.get("lpos", 0.5)
            mx = p1[0] + (p2[0] - p1[0]) * t
            my = p1[1] + (p2[1] - p1[1]) * t
        start = ' marker-start="url(#mk-comp-s)"' if e.get("bidir") else ''
        edge_body.append(f'<path class="comp-edge" data-from="{esc(e["from"])}" data-to="{esc(e["to"])}" d="{d}" marker-end="url(#mk-comp)"{start}/>')

        # 라벨: (n) 설명 + ( protocol ). lx/ly로 위치 오버라이드 가능.
        lines = []
        if e.get("label"):
            first = f'({e["n"]}) {e["label"]}' if e.get("n") is not None else e["label"]
            lines.append(("lb", first))
        elif e.get("n") is not None:
            lines.append(("lb", f'({e["n"]})'))
        if e.get("protocol"):
            lines.append(("proto", f'( {e["protocol"]} )'))
        if lines:
            has_pos = e.get("lx") is not None
            lx = e.get("lx", mx)
            ly = e.get("ly", my - 6 - (len(lines) - 1) * C_LBL_LH)
            anc = "start" if has_pos else "middle"
            for j, (cls, tx) in enumerate(lines):
                yy = ly + j * C_LBL_LH
                label_body.append(f'<text class="comp-{cls}" data-from="{esc(e["from"])}" data-to="{esc(e["to"])}" x="{lx}" y="{yy}" text-anchor="{anc}">{esc(tx)}</text>')
                if anc == "start":
                    xs += [lx, lx + len(tx) * 6.6]
                else:
                    xs += [lx - len(tx) * 3.4, lx + len(tx) * 3.4]
                ys.append(yy)

    # 노드 (이름 + 포트 2단)
    node_body = []
    for nd in nodes:
        x, y, w, h = rects[nd["id"]]
        kind = nd.get("kind", "comp")
        cls = "comp-node" + ("" if kind == "comp" else f" comp-{kind}")
        node_body.append(f'<g class="iff-node" data-id="{esc(nd["id"])}" data-cx="{x + w / 2}" data-cy="{y + h / 2}" data-w="{w}" data-h="{h}">')
        node_body.append(f'<rect class="{cls}" x="{x}" y="{y}" width="{w}" height="{h}" rx="9"/>')
        name_lines = str(nd["name"]).split("\n")
        port = nd.get("port")
        total = len(name_lines) + (1 if port else 0)
        cy0 = y + h / 2 - (total - 1) * 7 + 4
        for j, ln in enumerate(name_lines):
            node_body.append(f'<text class="comp-name" x="{x + w / 2}" y="{cy0 + j * 14}" text-anchor="middle">{esc(ln)}</text>')
        if port:
            node_body.append(f'<text class="comp-port" x="{x + w / 2}" y="{cy0 + len(name_lines) * 14 + 2}" text-anchor="middle">Port: {esc(port)}</text>')
        node_body.append('</g>')

    pad = 16
    minx, miny, maxx, maxy = min(xs), min(ys), max(xs), max(ys)
    vb_x, vb_y = minx - pad, miny - pad
    vb_w, vb_h = (maxx - minx) + 2 * pad, (maxy - miny) + 2 * pad

    marker = ('<marker id="mk-comp" markerWidth="9" markerHeight="9" refX="7.5" refY="3" orient="auto">'
              '<path class="mk-comp" d="M0,0 L8,3 L0,6z"/></marker>'
              '<marker id="mk-comp-s" markerWidth="9" markerHeight="9" refX="0.5" refY="3" orient="auto">'
              '<path class="mk-comp" d="M8,0 L0,3 L8,6z"/></marker>')
    svg = (f'<svg viewBox="{vb_x} {vb_y} {vb_w} {vb_h}" '
           f'style="width:100%;max-width:{vb_w:.0f}px;display:block;margin:0 auto;" '
           f'xmlns="http://www.w3.org/2000/svg" role="img" aria-label="{esc(scenario["title"])}">'
           f'<defs>{marker}</defs>'
           f'{"".join(zone_body)}{"".join(edge_body)}{"".join(node_body)}{"".join(label_body)}</svg>')
    return svg, vb_w, vb_h


# ── HTML 생성 ─────────────────────────────────────────────────
LIGHT_VARS = """
      --bg:#f4f7fc; --surface:#ffffff; --border:rgba(28,60,110,0.16);
      --text:#1b2635; --muted:#54667e; --accent:#1f6fd0; --warn:#8a6210;
      --line:rgba(31,111,208,0.42); --line-soft:rgba(31,111,208,0.30);
      --note-bg:rgba(181,126,10,0.07); --note-bd:rgba(181,126,10,0.42);
      --act-bg:rgba(31,111,208,0.12); --act-bd:rgba(31,111,208,0.32);
      --zone-bg:rgba(31,111,208,0.07); --zone-bd:rgba(31,111,208,0.30);
      --comp-bg:rgba(35,170,155,0.13); --comp-bd:rgba(20,130,120,0.55);
      --shadow:0 10px 32px rgba(23,48,88,0.10);
"""

CSS = """
    :root {
      --bg:#07101b; --surface:rgba(12,21,36,0.92); --border:rgba(153,186,255,0.14);
      --text:#edf3ff; --muted:#98abc9; --accent:#68b6ff; --warn:#ffd072;
      --line:rgba(104,182,255,0.75); --line-soft:rgba(140,166,205,0.55);
      --note-bg:rgba(255,208,114,0.06); --note-bd:rgba(255,208,114,0.38);
      --act-bg:rgba(104,182,255,0.15); --act-bd:rgba(104,182,255,0.32);
      --zone-bg:rgba(104,182,255,0.08); --zone-bd:rgba(104,182,255,0.32);
      --comp-bg:rgba(78,205,190,0.14); --comp-bd:rgba(78,205,190,0.44);
      --shadow:0 24px 72px rgba(0,0,0,0.34);
      --font:-apple-system,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif;
      --mono:ui-monospace,"JetBrains Mono",Menlo,monospace;
    }
    :root[data-theme="light"] { LIGHT_VARS }
    *{box-sizing:border-box;}
    html,body{margin:0;min-height:100%;}
    body{font-family:var(--font);color:var(--text);background:var(--bg);-webkit-font-smoothing:antialiased;}
    .page{width:min(SVGWPXpx + 48px,calc(100% - 32px));margin:0 auto;padding:24px 0 48px;display:grid;gap:18px;}
    .sheet{border:1px solid var(--border);background:var(--surface);box-shadow:var(--shadow);border-radius:20px;padding:20px 24px;}
    .hero{margin-bottom:14px;}
    .eyebrow{display:inline-flex;padding:6px 12px;border-radius:999px;border:1px solid var(--zone-bd);background:var(--zone-bg);color:var(--accent);font-size:12px;font-weight:700;letter-spacing:0.07em;}
    h1{margin:10px 0 4px;font-size:clamp(1.3rem,2.2vw,1.7rem);letter-spacing:-0.02em;}
    p.sub{margin:0;color:var(--muted);font-size:12.5px;}
    .diagram-wrap{overflow-x:auto;border-radius:12px;border:1px solid var(--border);}
    .theme-toggle{position:fixed;top:14px;right:14px;z-index:10;padding:8px 14px;border-radius:999px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;cursor:pointer;box-shadow:var(--shadow);}
    /* ── SVG ── */
    .zone{fill:var(--zone-bg);stroke:var(--zone-bd);stroke-width:1.5;}
    .zone-tx{fill:var(--accent);font-family:var(--font);font-size:12px;font-weight:700;}
    .actor{fill:var(--zone-bg);stroke:var(--zone-bd);stroke-width:1.5;}
    .actor-tx{fill:var(--accent);font-family:var(--font);font-size:12.5px;font-weight:700;}
    .actor-sub{fill:var(--muted);font-family:var(--mono);font-size:10px;}
    .lifeline{stroke:var(--line-soft);stroke-opacity:0.4;stroke-width:1;stroke-dasharray:5,5;}
    .act-bar{fill:var(--act-bg);stroke:var(--act-bd);stroke-width:1;}
    .ar{fill:none;}
    .ar-req{stroke:var(--line);stroke-width:1.8;}
    .ar-res{stroke:var(--line-soft);stroke-width:1.5;stroke-dasharray:6,4;}
    .ar-relay{stroke:var(--line-soft);stroke-width:1.4;}
    .ar-self{stroke:var(--line);stroke-width:1.6;}
    .mk-req,.mk-self{fill:var(--line);}
    .mk-res,.mk-relay{fill:var(--line-soft);}
    text{font-family:var(--font);}
    .lb-req,.lb-self{fill:var(--accent);font-size:12px;font-weight:600;}
    .lb-res{fill:var(--muted);font-size:12px;}
    .lb-relay{fill:var(--muted);font-size:11.5px;font-style:italic;}
    .lb-sub{fill:var(--warn);font-size:11px;font-weight:600;}
    .lb-proto{fill:var(--muted);font-size:10.5px;font-family:var(--mono);}
    .note{fill:var(--note-bg);stroke:var(--note-bd);stroke-width:1.3;}
    .note-tx{fill:var(--text);font-size:11.5px;}
    /* ── 토폴로지(구성도) 뷰 ── */
    .topo-zone{fill:var(--zone-bg);stroke:var(--zone-bd);stroke-width:1.4;stroke-dasharray:5,4;}
    .topo-zone-tx{fill:var(--accent);font-size:11.5px;font-weight:700;}
    .topo-node{fill:var(--surface);stroke:var(--border);stroke-width:1.4;}
    .topo-node.dim{opacity:0.5;}
    .topo-node.on{fill:var(--zone-bg);stroke:var(--accent);stroke-width:1.9;}
    .topo-ext{fill:var(--note-bg);stroke:var(--note-bd);}
    .topo-gear{fill:var(--surface);stroke:var(--line-soft);stroke-dasharray:4,3;}
    .topo-tx{fill:var(--muted);font-size:11px;font-weight:600;}
    .topo-tx.on{fill:var(--accent);}
    .topo-link{stroke:var(--line-soft);stroke-width:1.3;fill:none;opacity:0.55;}
    .topo-seg{fill:none;stroke:var(--line);stroke-width:2;}
    .mk-topo{fill:var(--line);}
    .topo-badge{fill:var(--accent);stroke:var(--surface);stroke-width:1.6;}
    .topo-badge-tx{fill:#fff;font-size:11px;font-weight:700;}
    .topo-legend-h{fill:var(--muted);font-size:11px;font-weight:700;}
    .topo-legend-tx{fill:var(--text);font-size:11.5px;}
    /* ── 컴포넌트 뷰 ── */
    .comp-zone{fill:var(--zone-bg);stroke:var(--zone-bd);stroke-width:1.4;stroke-dasharray:6,4;}
    .comp-zone-tx{fill:var(--accent);font-size:12px;font-weight:700;}
    .comp-node{fill:var(--comp-bg);stroke:var(--comp-bd);stroke-width:1.6;}
    .comp-ext{fill:var(--note-bg);stroke:var(--note-bd);}
    .comp-name{fill:var(--text);font-size:12px;font-weight:700;}
    .comp-port{fill:var(--muted);font-size:10px;font-family:var(--mono);font-weight:700;}
    .comp-edge{fill:none;stroke:var(--line);stroke-width:1.7;}
    .comp-lb{fill:var(--text);font-size:11px;font-weight:600;}
    .comp-proto{fill:var(--muted);font-size:10px;font-family:var(--mono);}
    .mk-comp{fill:var(--line);}
    @media print {
      :root, :root[data-theme="dark"] { LIGHT_VARS }
      .theme-toggle{display:none;}
      body{background:#fff;}
      .page{width:SVGWPXpx + 48px;padding:0;gap:0;}
      .sheet{border:none;box-shadow:none;border-radius:0;page-break-after:always;page-break-inside:avoid;}
      .diagram-wrap{overflow:visible;border:none;}
      .hero{height:96px;overflow:hidden;}
    }
"""


# 드래그 뷰(topology·component) — 노드 드래그 + 엣지 추종 + 좌표 export.
# 드래그는 배치 스크래치패드: 엣지는 직선 추종, 최종 faithful 렌더는 export 좌표로 Python 재렌더.
DRAG_CSS = """
    .iff-node{cursor:grab;}
    .iff-node:active{cursor:grabbing;}
    .iff-zone{cursor:grab;}
    .iff-zone:active{cursor:grabbing;}
    .iff-export{margin:0 0 10px;padding:6px 12px;border-radius:8px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:12px;font-weight:600;cursor:pointer;}
    @media print{ .iff-export{display:none;} }
"""

DRAG_JS = """
(function () {
  function edgePt(n, tx, ty) {
    var cx = n.cx + n.tx, cy = n.cy + n.ty, dx = tx - cx, dy = ty - cy;
    if (!dx && !dy) return [cx, cy];
    var sx = dx ? (n.w / 2) / Math.abs(dx) : 1e9, sy = dy ? (n.h / 2) / Math.abs(dy) : 1e9;
    var s = Math.min(sx, sy);
    return [cx + dx * s, cy + dy * s];
  }
  function initSvg(svg) {
    var nodes = {};
    svg.querySelectorAll('.iff-node').forEach(function (g) {
      nodes[g.getAttribute('data-id')] = {
        g: g, cx: +g.getAttribute('data-cx'), cy: +g.getAttribute('data-cy'),
        w: +g.getAttribute('data-w'), h: +g.getAttribute('data-h'), tx: 0, ty: 0
      };
    });
    function refresh(id) {
      svg.querySelectorAll('[data-self="' + id + '"]').forEach(function (el) {
        var n = nodes[id]; el.setAttribute('transform', 'translate(' + n.tx + ',' + n.ty + ')');
      });
      svg.querySelectorAll('[data-from],[data-to]').forEach(function (el) {
        if (el.getAttribute('data-self')) return;
        var f = el.getAttribute('data-from'), t = el.getAttribute('data-to');
        if (f !== id && t !== id) return;
        var a = nodes[f], b = nodes[t]; if (!a || !b) return;
        var ca = [a.cx + a.tx, a.cy + a.ty], cb = [b.cx + b.tx, b.cy + b.ty];
        if (el.tagName === 'path') {
          var p1 = edgePt(a, cb[0], cb[1]), p2 = edgePt(b, ca[0], ca[1]);
          el.setAttribute('d', 'M' + p1[0] + ',' + p1[1] + ' L' + p2[0] + ',' + p2[1]);
        } else if (el.tagName === 'line') {
          var q1 = edgePt(a, cb[0], cb[1]), q2 = edgePt(b, ca[0], ca[1]);
          el.setAttribute('x1', q1[0]); el.setAttribute('y1', q1[1]);
          el.setAttribute('x2', q2[0]); el.setAttribute('y2', q2[1]);
        } else {
          el.setAttribute('transform', 'translate(' + ((a.tx + b.tx) / 2) + ',' + ((a.ty + b.ty) / 2) + ')');
        }
      });
    }
    function nodeRect(id) { var n = nodes[id]; return { x: n.cx + n.tx - n.w / 2, y: n.cy + n.ty - n.h / 2, w: n.w, h: n.h }; }
    function zoneRecompute(zg) {
      var mem = (zg.getAttribute('data-members') || '').split(',').filter(Boolean);
      if (!mem.length) return;
      var pad = +zg.getAttribute('data-pad'), lbl = +zg.getAttribute('data-lbl'), lp = zg.getAttribute('data-lblpos');
      var rs = mem.map(nodeRect);
      var zx1 = Math.min.apply(null, rs.map(function (r) { return r.x; })) - pad;
      var zy1 = Math.min.apply(null, rs.map(function (r) { return r.y; })) - pad - lbl;
      var zx2 = Math.max.apply(null, rs.map(function (r) { return r.x + r.w; })) + pad;
      var zy2 = Math.max.apply(null, rs.map(function (r) { return r.y + r.h; })) + pad;
      var rect = zg.querySelector('rect'), txt = zg.querySelector('text');
      rect.setAttribute('x', zx1); rect.setAttribute('y', zy1);
      rect.setAttribute('width', zx2 - zx1); rect.setAttribute('height', zy2 - zy1);
      if (lp === 'tr') { txt.setAttribute('x', zx2 - 12); txt.setAttribute('y', zy1 + 15); }
      else { txt.setAttribute('x', zx1 + 10); txt.setAttribute('y', zy1 + 13); }
    }
    function recomputeZones() { svg.querySelectorAll('.iff-zone').forEach(zoneRecompute); }
    var active = null, start = null;
    function toSvg(evt) {
      var pt = svg.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
      return pt.matrixTransform(svg.getScreenCTM().inverse());
    }
    svg.querySelectorAll('.iff-node').forEach(function (g) {
      g.addEventListener('pointerdown', function (evt) {
        evt.preventDefault();
        active = nodes[g.getAttribute('data-id')];
        var p = toSvg(evt); start = { x: p.x, y: p.y, tx: active.tx, ty: active.ty };
        g.setPointerCapture(evt.pointerId);
      });
      g.addEventListener('pointermove', function (evt) {
        if (!active) return;
        var p = toSvg(evt);
        active.tx = start.tx + (p.x - start.x); active.ty = start.ty + (p.y - start.y);
        active.g.setAttribute('transform', 'translate(' + active.tx + ',' + active.ty + ')');
        refresh(active.g.getAttribute('data-id'));
        recomputeZones();
      });
      g.addEventListener('pointerup', function () { active = null; });
      g.addEventListener('pointercancel', function () { active = null; });
    });
    var zdrag = null;
    svg.querySelectorAll('.iff-zone').forEach(function (zg) {
      zg.addEventListener('pointerdown', function (evt) {
        evt.preventDefault();
        var mem = (zg.getAttribute('data-members') || '').split(',').filter(Boolean);
        var p = toSvg(evt);
        zdrag = { x: p.x, y: p.y, base: mem.map(function (id) { return { id: id, tx: nodes[id].tx, ty: nodes[id].ty }; }) };
        zg.setPointerCapture(evt.pointerId);
      });
      zg.addEventListener('pointermove', function (evt) {
        if (!zdrag) return;
        var p = toSvg(evt), ddx = p.x - zdrag.x, ddy = p.y - zdrag.y;
        zdrag.base.forEach(function (b) {
          var n = nodes[b.id]; n.tx = b.tx + ddx; n.ty = b.ty + ddy;
          n.g.setAttribute('transform', 'translate(' + n.tx + ',' + n.ty + ')');
          refresh(b.id);
        });
        recomputeZones();
      });
      zg.addEventListener('pointerup', function () { zdrag = null; });
      zg.addEventListener('pointercancel', function () { zdrag = null; });
    });
    return function () {
      var out = {};
      Object.keys(nodes).forEach(function (id) {
        var n = nodes[id];
        out[id] = { x: Math.round(n.cx + n.tx - n.w / 2), y: Math.round(n.cy + n.ty - n.h / 2) };
      });
      return out;
    };
  }
  document.querySelectorAll('.sheet').forEach(function (sheet) {
    var svg = sheet.querySelector('svg'); if (!svg) return;
    var exporter = initSvg(svg);
    var btn = sheet.querySelector('.iff-export');
    if (btn) btn.addEventListener('click', function () {
      var json = JSON.stringify(exporter(), null, 2);
      window.__iffExport = json;
      if (navigator.clipboard) navigator.clipboard.writeText(json);
      btn.textContent = '✅ 좌표 복사됨 (JSON nodes의 x/y에 반영)';
      setTimeout(function () { btn.textContent = '📋 좌표 복사'; }, 1800);
    });
  });
})();
"""


def build_html(data, rendered):
    view = data.get("view", "sequence")
    draggable = view in ("topology", "component")
    max_w = max(w for _, w, _ in rendered)
    max_h = max(h for _, _, h in rendered)
    page_w = max_w + 48
    page_h = 20 + 96 + 14 + max_h + 20 + 24  # sheet pad + hero + gap + svg + pad + 여유
    css = (CSS.replace("LIGHT_VARS", LIGHT_VARS)
              .replace("SVGWPXpx + 48px", f"{page_w}px"))
    css += f"\n    @page {{ size: {page_w}px {page_h}px; margin: 0; }}\n"
    if draggable:
        css += DRAG_CSS

    tools = '<button class="iff-export" type="button">📋 좌표 복사</button>' if draggable else ""
    sheets = []
    for (svg, _, _), sc in zip(rendered, data["scenarios"]):
        src = f'<p class="sub">{esc(data["source"])}</p>' if data.get("source") else ""
        sheets.append(f"""  <section class="sheet">
    <header class="hero">
      <span class="eyebrow">{esc(data["system"])} · IF 흐름도</span>
      <h1>{esc(sc["title"])}</h1>
      {src}
    </header>
    {tools}
    <div class="diagram-wrap">{svg}</div>
  </section>""")

    title = esc(f'{data["system"]} IF 흐름도')
    return f"""<!DOCTYPE html>
<html lang="ko" data-theme="dark">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>{title}</title>
<style>{css}</style>
</head>
<body>
<button id="themeToggle" class="theme-toggle" type="button">🌓 테마</button>
<main class="page">
{chr(10).join(sheets)}
</main>
<script>
(function () {{
  var KEY = 'flowcast-theme';
  var root = document.documentElement;
  var saved = localStorage.getItem(KEY);
  if (saved) root.setAttribute('data-theme', saved);
  document.getElementById('themeToggle').addEventListener('click', function () {{
    var next = root.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    root.setAttribute('data-theme', next);
    localStorage.setItem(KEY, next);
  }});
}})();
</script>
<script>{DRAG_JS if draggable else ""}</script>
</body>
</html>
"""


# ── PDF 변환 (Chrome headless) ────────────────────────────────
CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome", "chromium",
]


def to_pdf(html_path, pdf_path):
    import shutil
    chrome = next((c for c in CHROME_CANDIDATES
                   if Path(c).exists() or shutil.which(c)), None)
    if not chrome:
        sys.exit("ERROR: Chrome을 찾을 수 없어 PDF 변환 불가 — HTML은 생성됨")
    for headless in ("--headless=new", "--headless"):
        r = subprocess.run(
            [chrome, headless, "--disable-gpu", "--no-pdf-header-footer",
             f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri()],
            capture_output=True, text=True)
        if r.returncode == 0 and Path(pdf_path).exists():
            return
    sys.exit(f"ERROR: Chrome PDF 변환 실패\n{r.stderr[-500:]}")


# ── main ──────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description="flowcast 시퀀스 뷰 렌더러 (JSON → HTML/PDF)")
    ap.add_argument("data", help="IF 흐름도 데이터 JSON 경로")
    ap.add_argument("-o", "--out", help="출력 HTML 경로 (기본: 데이터와 같은 위치 .html)")
    ap.add_argument("--pdf", nargs="?", const="", metavar="PDF",
                    help="Chrome headless로 PDF도 생성 (기본: HTML과 같은 위치 .pdf)")
    args = ap.parse_args()

    data_path = Path(args.data)
    data = json.loads(data_path.read_text(encoding="utf-8"))

    view = data.get("view", "sequence")
    validator = {"topology": validate_topology, "component": validate_component}.get(view, validate)
    errors, warnings = validator(data)
    for w in warnings:
        print(f"WARNING: {w}", file=sys.stderr)
    if errors:
        for e in errors:
            print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    render = {"topology": render_svg_topology, "component": render_svg_component}.get(view, render_svg)
    rendered = [render(data, sc) for sc in data["scenarios"]]
    out = Path(args.out) if args.out else data_path.with_suffix(".html")
    out.write_text(build_html(data, rendered), encoding="utf-8")
    print(f"HTML: {out}")

    if args.pdf is not None:
        pdf = Path(args.pdf) if args.pdf else out.with_suffix(".pdf")
        to_pdf(out, pdf)
        print(f"PDF : {pdf}")


if __name__ == "__main__":
    main()
