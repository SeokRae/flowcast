#!/usr/bin/env python3
"""flowcast PlantUML export (B-out) — 흐름도 뷰 JSON → PlantUML(.puml) 텍스트.

render.py 의 SVG/HTML 과 달리 PlantUML 은 텍스트 DSL 이므로 좌표를 쓰지 않는다.
render.py 의 배치 로직(layout_sequence·_c_rect·_t_rect 등)은 **재사용하지 않고**
(픽셀 좌표는 PlantUML 자체 레이아웃과 충돌), 검증기(validate·validate_topology·
validate_component)와 의미/텍스트 헬퍼(_split_dual_ip)만 render.py 에서 import 한다.
→ 순수 stdlib. python-pptx 같은 선택적 의존성 없음(의존성 격리 원칙 부합).

시나리오 1개 = `@startuml`…`@enduml` 블록 1개. 한 .puml 파일에 N개 블록을 이어붙인다.
좌표류(col/row/x/y/w/h/rail/via/lx/ly/lpos)는 전부 버린다. 분기·예외는 별개 시나리오
= 별개 블록(alt/opt 합성 안 함 — 스키마에 분기 블록이 없음).

사용법:
    python3 scripts/plantuml_export.py {view.json} [-o {out.puml}] [--no-style]

지원: sequence · component · topology 3뷰 (view 필드로 디스패치, 미지정=sequence).
- sequence: participant(+box=zone) + 메시지 화살표(kind별) + note over
- topology: rectangle(+package=zone) + 정적 링크(--) + 번호 세그먼트(-->) + legend
- component: 시나리오-로컬 rectangle(+package=zone) + 방향 엣지(-->/<-->)
"""

import argparse
import importlib.util
import json
import sys
from pathlib import Path


def _load_render():
    spec = importlib.util.spec_from_file_location(
        "flowcast_render", Path(__file__).parent / "render.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


# ── PlantUML 스타일 (flowcast 팔레트 근사 — vault 기존 다이어그램 <style> 톤과 일치) ──
SEQ_STYLE = """skinparam backgroundColor #FFFFFF
skinparam sequenceMessageAlign center
skinparam sequence {
  ArrowColor #334155
  LifeLineBorderColor #94A3B8
  LifeLineBackgroundColor #FFFFFF
  ParticipantBackgroundColor #F1F5F9
  ParticipantBorderColor #475569
  ParticipantFontColor #1B2635
  ActorBackgroundColor #F1F5F9
  ActorBorderColor #475569
  BoxBackgroundColor #E8F1FF
  BoxBorderColor #94A3B8
}
skinparam noteBackgroundColor #FAF6EE
skinparam noteBorderColor #E0C998"""

# rectangle 뷰(topology/component)는 dot(graphviz) 레이아웃을 탄다 — 기본값이 dot.
#
# `!pragma layout smetana`(PlantUML 내장 엔진)는 graphviz 가 없는 환경용 **opt-in**(`--smetana`).
# v0.12 까지는 이게 강제였으나 v0.13 에서 뒤집었다 — smetana 가 캔버스를 클리핑하기 때문:
#   · examples/three-tier-topology  : smetana 243x541 ("5. 캐시 갱신"→"5. 캐시" 절단) / dot 271x664 정상
#   · 6노드·11엣지·package 1 (실사용): smetana 407x442 잘림                        / dot 984x523 정상
# 강제의 근거였던 "Obsidian 은 graphviz-free" 전제도 틀렸다 — Obsidian PlantUML 플러그인은 dot 을 쓴다.
# (렌더 실패의 진짜 원인은 GUI 앱이라 셸 PATH 를 상속받지 않는 것 → dotPath 를 '절대경로'로 주면 된다.)
RECT_PRAGMA = "!pragma layout smetana"

RECT_STYLE = """skinparam backgroundColor #FFFFFF
skinparam rectangle {
  BackgroundColor #F1F5F9
  BackgroundColor<<ext>> #FDF3E7
  BackgroundColor<<gear>> #F8FAFC
  BackgroundColor<<fw>> #F8FAFC
  BackgroundColor<<l4>> #F8FAFC
  BorderColor #475569
  BorderColor<<ext>> #B7791F
  BorderColor<<gear>> #94A3B8
  FontColor #1B2635
}
skinparam package {
  BorderColor #94A3B8
  BackgroundColor transparent
  FontColor #475569
}"""


def _rect_head(style, smetana):
    """rectangle 뷰(topology/component) 의 @startuml 직후 블록.

    레이아웃 엔진(pragma)과 팔레트(skinparam)는 **직교**한다 —
    `--smetana` 는 pragma 만 켜고, `--no-style` 은 skinparam 만 뺀다.
    """
    return "\n".join(p for p in (RECT_PRAGMA if smetana else "", RECT_STYLE if style else "") if p)


def _disp(*parts):
    """참조명(따옴표 내부) — 실제 개행/포트/라인을 `\\n` 토큰으로 스택, 따옴표 회피."""
    lines = []
    for p in parts:
        if p is None or p == "":
            continue
        lines.extend(str(p).split("\n"))
    return "\\n".join(s.replace('"', "'") for s in lines)


def _label(*parts):
    """화살표/세그먼트 라벨 — 여러 조각을 개행으로 잇고 `\\n` 토큰으로 변환."""
    joined = "\n".join(str(p) for p in parts if p is not None and p != "")
    return joined.replace("\r", "").replace("\n", "\\n")


def _line(s):
    """단일 라인 컨텍스트(title/comment) — 개행을 공백으로."""
    return str(s).replace("\r", " ").replace("\n", " ").strip()


def _header(system, title, source, style):
    out = ["@startuml"]
    if style:
        out.append(style)
    out.append(f"title {_line(system)} — {_line(title)}" if title else f"title {_line(system)}")
    if source:
        out.append(f"' flowcast source: {_line(source)}")
    return out


def _arrow_label(rec, n_key="n"):
    n = rec.get(n_key)
    base = rec.get("label") or ""
    head = f"{n}. {base}" if n is not None and base else (str(n) + "." if n is not None else base)
    parts = [head]
    if rec.get("protocol"):
        parts.append(f"( {rec['protocol']} )")
    if rec.get("meta"):
        parts.append(f"( {rec['meta']} )")
    if rec.get("sub"):
        parts.append(rec["sub"])
    return _label(*parts)


# ── SEQUENCE ──────────────────────────────────────────────────
_SEQ_OP = {"req": "->", "res": "-->", "relay": "->>", "self": "->"}


def _seq_block(data, sc, style):
    out = _header(data.get("system", ""), sc.get("title", ""), data.get("source"), style)
    zone_name = {z["id"]: z.get("name", z["id"]) for z in data.get("zones", []) if isinstance(z, dict)}
    # participant 선언 — actors 배열 순서 = 좌→우, zone 은 연속(검증기 보장)이므로 box 로 감쌈
    cur, box_open = object(), False
    for a in data.get("actors", []):
        az = a.get("zone")
        if az != cur:
            if box_open:
                out.append("end box")
                box_open = False
            if az is not None and az in zone_name:
                out.append(f'box "{_disp(zone_name[az])}"')
                box_open = True
            cur = az
        indent = "  " if box_open else ""
        out.append(f'{indent}participant "{_disp(a.get("name", a["id"]), _mk_port(a))}" as {a["id"]}')
    if box_open:
        out.append("end box")
    out.append("")
    for st in sc.get("steps", []):
        kind = st.get("kind")
        frm, to = st.get("from"), st.get("to")
        if kind == "note":
            targets = frm if frm == to else f"{frm}, {to}"
            out.append(f"note over {targets}")
            n = st.get("n")
            body = (f"{n}. " if n is not None else "") + (st.get("label") or "")
            for ln in body.split("\n"):
                out.append(ln.rstrip())
            out.append("end note")
        else:
            op = _SEQ_OP.get(kind, "->")
            lbl = _arrow_label(st)
            out.append(f"{frm} {op} {to}" + (f" : {lbl}" if lbl else ""))
    out.append("@enduml")
    return "\n".join(out)


def _mk_port(a):
    extra = []
    if a.get("port"):
        extra.append(f":{a['port']}")
    if a.get("line"):
        extra.append(str(a["line"]))
    return "\n".join(extra) if extra else None


def export_sequence(data, out_path, style=True):
    blocks = [_seq_block(data, sc, SEQ_STYLE if style else "") for sc in data.get("scenarios", [])]
    out_path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    return len(blocks)


# ── TOPOLOGY ──────────────────────────────────────────────────
def _rect_decl(node, R, indent=""):
    kind = node.get("kind")
    stereo = f" <<{kind}>>" if kind else ""
    # dual 노드는 IP range 를 2줄로 펼쳐 한 박스에 표기(v1 단순화)
    if node.get("dual"):
        l1, _ = R._split_dual_ip(node.get("name", node["id"]))
        disp = _disp(*l1)
    else:
        disp = _disp(node.get("name", node["id"]), _mk_port(node))
    return f'{indent}rectangle "{disp}" as {node["id"]}{stereo}'


def _nodes_with_zones(nodes, zones, R, out):
    """존별 package 로 묶어 rectangle 선언 (zoneless 는 최상위)."""
    zone_name = {z["id"]: z.get("name", z["id"]) for z in zones if isinstance(z, dict)}
    by_zone, loose = {}, []
    for n in nodes:
        z = n.get("zone")
        if z in zone_name:
            by_zone.setdefault(z, []).append(n)
        else:
            loose.append(n)
    for zid, members in by_zone.items():
        out.append(f'package "{_disp(zone_name[zid])}" {{')
        for n in members:
            out.append(_rect_decl(n, R, indent="  "))
        out.append("}")
    for n in loose:
        out.append(_rect_decl(n, R))


def _topo_block(data, sc, R, style):
    out = _header(data.get("system", ""), sc.get("title", ""), data.get("source"), style)
    _nodes_with_zones(data.get("nodes", []), data.get("zones", []), R, out)
    out.append("")
    for lk in data.get("links", []):
        out.append(f'{lk["from"]} -- {lk["to"]}')
    segments = sc.get("segments", [])
    if segments:
        out.append("")
        for sg in segments:
            frm = sg.get("from")
            to = frm if sg.get("self") else sg.get("to")
            lbl = _arrow_label(sg)
            out.append(f"{frm} --> {to}" + (f" : {lbl}" if lbl else ""))
    out.append("@enduml")
    return "\n".join(out)


def export_topology(data, out_path, style=True, smetana=False):
    R = _load_render()
    head = _rect_head(style, smetana)
    blocks = [_topo_block(data, sc, R, head) for sc in data.get("scenarios", [])]
    out_path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    return len(blocks)


# ── COMPONENT ─────────────────────────────────────────────────
def _comp_block(data, sc, R, style):
    out = _header(data.get("system", ""), sc.get("title", ""), data.get("source"), style)
    _nodes_with_zones(sc.get("nodes", []), sc.get("zones", []), R, out)
    out.append("")
    for e in sc.get("edges", []):
        op = "<-->" if e.get("bidir") else "-->"
        lbl = _arrow_label(e)
        out.append(f'{e["from"]} {op} {e["to"]}' + (f" : {lbl}" if lbl else ""))
    out.append("@enduml")
    return "\n".join(out)


def export_component(data, out_path, style=True, smetana=False):
    R = _load_render()
    head = _rect_head(style, smetana)
    blocks = [_comp_block(data, sc, R, head) for sc in data.get("scenarios", [])]
    out_path.write_text("\n\n".join(blocks) + "\n", encoding="utf-8")
    return len(blocks)


# ── main ──────────────────────────────────────────────────────
# (exporter, 검증기명, rectangle 뷰인가) — rectangle 뷰만 레이아웃 pragma 를 탄다(sequence 는 네이티브).
_DISPATCH = {
    "sequence": (export_sequence, "validate", False),
    "topology": (export_topology, "validate_topology", True),
    "component": (export_component, "validate_component", True),
}


def main():
    ap = argparse.ArgumentParser(
        description="flowcast 흐름도 → PlantUML(.puml) export (sequence·component·topology)")
    ap.add_argument("data", help="흐름도 뷰 JSON 경로 (view: sequence|component|topology)")
    ap.add_argument("-o", "--out", help="출력 .puml (기본: 입력과 같은 위치 .puml)")
    ap.add_argument("--no-style", action="store_true",
                    help="flowcast 팔레트 skinparam 생략(vanilla PlantUML)")
    ap.add_argument("--smetana", action="store_true",
                    help="topology·component 에 '!pragma layout smetana' 추가 — graphviz(dot) 가 없는 "
                         "환경용 opt-in. smetana 는 캔버스를 클리핑할 수 있어 기본은 dot 이다. "
                         "sequence 는 네이티브 렌더라 무관")
    args = ap.parse_args()

    path = Path(args.data)
    if not path.exists():
        print(f"파일 없음: {path}", file=sys.stderr)
        return 1
    data = json.loads(path.read_text(encoding="utf-8"))
    view = data.get("view", "sequence")
    if view not in _DISPATCH:
        print(f"이 export 는 sequence·component·topology 뷰를 지원합니다 (view={view!r}).",
              file=sys.stderr)
        return 1

    exporter, validator_name, is_rect = _DISPATCH[view]
    R = _load_render()
    errors, warnings = getattr(R, validator_name)(data)
    for w in warnings:
        print(f"경고: {w}", file=sys.stderr)
    if errors:
        for e in errors:
            print(f"검증 오류: {e}", file=sys.stderr)
        return 1

    out = Path(args.out) if args.out else path.with_suffix(".puml")
    kwargs = {"style": not args.no_style}
    if is_rect:
        kwargs["smetana"] = args.smetana
    elif args.smetana:
        print("경고: sequence 뷰는 레이아웃 pragma 를 쓰지 않아 --smetana 가 무시됩니다.",
              file=sys.stderr)
    n = exporter(data, out, **kwargs)
    print(f"puml: {out} (다이어그램 {n})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
