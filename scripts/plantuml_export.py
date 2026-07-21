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
    python3 scripts/plantuml_export.py {view.json} [-o {out.puml}] [--no-style] [--smetana]

지원: sequence · component · topology 3뷰 (view 필드로 디스패치, 미지정=sequence).
- sequence: participant(+box=zone) + 메시지 화살표(kind별) + note over
- topology: rectangle(+package=zone) + 정적 링크(--) + 번호 세그먼트(-->, 번호만) + legend 표
           (설명은 legend 로 — 한 pair 에 엣지가 몰리면 라벨이 겹쳐 뭉개진다)
- component: 시나리오-로컬 rectangle(+package=zone) + 방향 엣지(-->/<-->)
"""

import argparse
import importlib.util
import re
import sys
from pathlib import Path

# scripts/ 를 경로에 넣어 _cli 를 로드한다 — 테스트가 spec_from_file_location 으로
# 이 모듈을 로드할 때도 동작하도록 __file__ 기준으로 넣는다.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
from _cli import load_json  # noqa: E402


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
  BorderColor<<fw>> #8A6210
  BorderColor<<l4>> #1F6FD0
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


_ALIAS_RE = re.compile(r"[^0-9A-Za-z_]")


def _alias(node_id):
    """PlantUML 별칭 정규화 — 화살표 문법(`-->`)과 충돌하는 문자(하이픈·점·공백 등)를
    `_` 로 바꾸고, 빈 결과·숫자 시작을 PlantUML 이 받는 형태로 만든다.
    표시명(따옴표 문자열)은 건드리지 않고 별칭만 바꾼다."""
    base = _ALIAS_RE.sub("_", str(node_id))
    if not base:
        return "n"
    return "n_" + base if base[0].isdigit() else base


def _alias_map(ids):
    """블록(다이어그램) 단위 id → 별칭 표.

    정규화만 하면 서로 다른 id(`web-1`·`web.1`)가 같은 별칭으로 뭉개져 노드가 합쳐지고
    엣지가 자기 루프로 변질된다 — 그것도 exit 0 으로 조용히(#72). 충돌하면 `_2`/`_3` 을
    붙여 결정적으로 피하고 stderr 에 경고 한 줄을 남긴다. 정규화로 정상 출력이
    가능하므로 종료시키지 않는다(pptx export 와 대칭 유지).
    """
    taken, amap = {}, {}
    for nid in ids:
        key = str(nid)
        if key in amap:
            continue
        base = _alias(key)
        alias, k = base, 1
        while alias in taken:
            k += 1
            alias = f"{base}_{k}"
        if k > 1:
            print(f"warning: 별칭 충돌 — id {key!r} 이 {taken[base]!r} 과 같은 별칭 "
                  f"{base!r} 으로 정규화되어 {alias!r} 로 구분합니다.", file=sys.stderr)
        taken[alias] = key
        amap[key] = alias
    return amap


def _al(amap, node_id):
    """별칭 조회 — 선언되지 않은 id 참조(검증기가 먼저 걸러낸다)는 정규화로 폴백."""
    key = str(node_id)
    return amap.get(key) or _alias(key)


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
    amap = _alias_map(a["id"] for a in data.get("actors", []))
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
        out.append(f'{indent}participant "{_disp(a.get("name", a["id"]), _mk_port(a))}" as {_al(amap, a["id"])}')
    if box_open:
        out.append("end box")
    out.append("")
    for st in sc.get("steps", []):
        kind = st.get("kind")
        frm, to = st.get("from"), st.get("to")
        if kind == "note":
            targets = _al(amap, frm) if frm == to else f"{_al(amap, frm)}, {_al(amap, to)}"
            out.append(f"note over {targets}")
            n = st.get("n")
            body = (f"{n}. " if n is not None else "") + (st.get("label") or "")
            for ln in body.split("\n"):
                out.append(ln.rstrip())
            out.append("end note")
        else:
            op = _SEQ_OP.get(kind, "->")
            lbl = _arrow_label(st)
            out.append(f"{_al(amap, frm)} {op} {_al(amap, to)}" + (f" : {lbl}" if lbl else ""))
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
def _rect_decl(node, R, amap, indent=""):
    kind = node.get("kind")
    stereo = f" <<{kind}>>" if kind else ""
    # dual 노드는 IP range 를 2줄로 펼쳐 한 박스에 표기(v1 단순화)
    if node.get("dual"):
        l1, _ = R._split_dual_ip(node.get("name", node["id"]))
        disp = _disp(*l1)
    else:
        disp = _disp(node.get("name", node["id"]), _mk_port(node))
    return f'{indent}rectangle "{disp}" as {_al(amap, node["id"])}{stereo}'


def _nodes_with_zones(nodes, zones, R, amap, out):
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
            out.append(_rect_decl(n, R, amap, indent="  "))
        out.append("}")
    for n in loose:
        out.append(_rect_decl(n, R, amap))


def _cell(s):
    """legend 표 셀 — 구분자 `|` 이스케이프 + 개행을 `\\n` 토큰으로."""
    return str(s).replace("|", "&#124;").replace("\r", "").replace("\n", "\\n")


def _seg_desc_parts(sg, desc):
    """세그먼트의 설명 조각 — 화살표 라벨과 같은 구성(설명·protocol·meta·sub)."""
    parts = [desc]
    if sg.get("protocol"):
        parts.append(f"( {sg['protocol']} )")
    if sg.get("meta"):
        parts.append(f"( {sg['meta']} )")
    if sg.get("sub"):
        parts.append(sg["sub"])
    return [p for p in parts if p]


def _topo_legend(numbered, R):
    """번호 세그먼트 → `legend` 표 [# | 단계 | 설명]. render.py 의 배지+범례 패턴과 패리티.

    단계 열은 `_split_step_label` 이 실제로 단계를 뽑아낸 행이 하나라도 있을 때만 낸다.
    """
    rows = []
    for sg in numbered:
        step, desc = R._split_step_label(sg.get("label") or "")
        rows.append((sg.get("n"), step, _seg_desc_parts(sg, desc)))
    any_step = any(step for _, step, _ in rows)
    out = ["legend", "|= # " + ("|= 단계 " if any_step else "") + "|= 설명 |"]
    for n, step, parts in rows:
        cells = [str(n)] + ([_cell(step)] if any_step else []) + \
                ["\\n".join(_cell(p) for p in parts)]
        out.append("| " + " | ".join(cells) + " |")
    out.append("end legend")
    return out


def _seg_pair(sg):
    frm = sg.get("from")
    return frm, (frm if sg.get("self") else sg.get("to"))


def _topo_block(data, sc, R, style):
    out = _header(data.get("system", ""), sc.get("title", ""), data.get("source"), style)
    amap = _alias_map(n["id"] for n in data.get("nodes", []))
    _nodes_with_zones(data.get("nodes", []), data.get("zones", []), R, amap, out)
    out.append("")
    segments = sc.get("segments", [])
    # 세그먼트가 이미 잇는 pair 의 정적 링크는 생략 — PlantUML 에선 중복 엣지가 되어
    # 라벨을 같은 지점에 스택시킨다(#57). 순수 구성도(segments 없음)는 전부 그린다.
    seg_pairs = {frozenset(_seg_pair(sg)) for sg in segments}
    for lk in data.get("links", []):
        if frozenset((lk["from"], lk["to"])) not in seg_pairs:
            out.append(f'{_al(amap, lk["from"])} -- {_al(amap, lk["to"])}')
    # 번호가 있으면 엣지엔 번호만 두고 설명은 legend 로 뺀다 — 한 pair 에 엣지가 몰려도
    # 라벨이 겹쳐 뭉개지지 않는다(#57). 번호 없는 세그먼트는 참조할 키가 없어 라벨 유지.
    numbered = [sg for sg in segments if sg.get("n") is not None]
    if segments:
        out.append("")
        for sg in segments:
            frm, to = _seg_pair(sg)
            lbl = str(sg["n"]) if (numbered and sg.get("n") is not None) else _arrow_label(sg)
            out.append(f"{_al(amap, frm)} --> {_al(amap, to)}" + (f" : {lbl}" if lbl else ""))
    if numbered:
        out.append("")
        out.extend(_topo_legend(numbered, R))
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
    # component 는 노드가 시나리오 로컬이라 별칭 스코프도 시나리오 단위다.
    amap = _alias_map(n["id"] for n in sc.get("nodes", []))
    _nodes_with_zones(sc.get("nodes", []), sc.get("zones", []), R, amap, out)
    out.append("")
    for e in sc.get("edges", []):
        op = "<-->" if e.get("bidir") else "-->"
        lbl = _arrow_label(e)
        out.append(f'{_al(amap, e["from"])} {op} {_al(amap, e["to"])}' + (f" : {lbl}" if lbl else ""))
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
    data = load_json(path)
    view = data.get("view", "sequence")
    if view not in _DISPATCH:
        print(f"error: 이 export 는 sequence·component·topology 뷰를 지원합니다 (view={view!r}).",
              file=sys.stderr)
        return 1

    exporter, validator_name, is_rect = _DISPATCH[view]
    R = _load_render()
    errors, warnings = getattr(R, validator_name)(data)
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    if errors:
        for e in errors:
            print(f"error: {e}", file=sys.stderr)
        return 1

    out = Path(args.out) if args.out else path.with_suffix(".puml")
    kwargs = {"style": not args.no_style}
    if is_rect:
        kwargs["smetana"] = args.smetana
    elif args.smetana:
        print("warning: sequence 뷰는 레이아웃 pragma 를 쓰지 않아 --smetana 가 무시됩니다.",
              file=sys.stderr)
    n = exporter(data, out, **kwargs)
    print(f"puml: {out} (다이어그램 {n})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
