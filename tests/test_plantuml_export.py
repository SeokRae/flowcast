"""flowcast scripts/plantuml_export.py — 흐름도 뷰 JSON → PlantUML(.puml) 텍스트 테스트.

stdlib-only(텍스트 출력) → python-pptx 같은 importorskip 가드 불필요.
검증 전략: 방출된 .puml 텍스트를 직접 파싱해 participant/rectangle/화살표/note/legend·
번호·라벨·포트 원문 보존·좌표 토큰 미누출을 확인 + CLI 검증 게이트/종료코드 확인.
"""

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import pytest

_spec = importlib.util.spec_from_file_location(
    "plantuml_export", Path(__file__).parent.parent / "scripts" / "plantuml_export.py")
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
export_sequence = _mod.export_sequence
export_topology = _mod.export_topology
export_component = _mod.export_component

ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "scripts" / "plantuml_export.py"
EX = ROOT / "examples"
SEQ = EX / "order-service-sequence.json"
TOPO = EX / "three-tier-topology.json"
COMP = EX / "microservice-component.json"


def _emit(export, src, tmp_path, **kw):
    data = json.loads(Path(src).read_text(encoding="utf-8"))
    out = tmp_path / "out.puml"
    n = export(data, out, **kw)
    return data, out.read_text(encoding="utf-8"), n


# ── 블록 수 = 시나리오 수 ──────────────────────────────────────
def test_block_count_matches_scenarios(tmp_path):
    for export, src in ((export_sequence, SEQ), (export_topology, TOPO), (export_component, COMP)):
        data, text, n = _emit(export, src, tmp_path)
        assert n == len(data["scenarios"])
        assert text.count("@startuml") == n == text.count("@enduml")


# ── SEQUENCE ──────────────────────────────────────────────────
def test_sequence_participants_in_actor_order(tmp_path):
    _, text, _ = _emit(export_sequence, SEQ, tmp_path)
    # actors 배열 순서(buyer→web→api→pay→bank)대로 participant 선언
    order = [text.index(f'as {aid}') for aid in ("buyer", "web", "api", "pay", "bank")]
    assert order == sorted(order)


def test_sequence_zone_box_and_arrows(tmp_path):
    _, text, _ = _emit(export_sequence, SEQ, tmp_path)
    assert 'box "Frontend"' in text and 'box "Backend"' in text and "end box" in text
    assert "buyer -> web : 1. 상품 주문" in text       # req → ->
    assert "bank --> pay : 5. 승인 응답" in text        # res → -->
    assert "web --> buyer : 8. 주문 완료" in text
    assert "( HTTPS )" in text                          # protocol


def test_sequence_no_coordinate_tokens(tmp_path):
    _, text, _ = _emit(export_sequence, SEQ, tmp_path)
    for tok in ("col=", "row=", '"x"', '"y"', "autonumber"):
        assert tok not in text


def test_sequence_kinds_note_self_relay(tmp_path):
    data = {
        "system": "T", "actors": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}],
        "scenarios": [{"title": "S", "steps": [
            {"from": "a", "to": "b", "label": "req", "kind": "req"},
            {"from": "b", "to": "a", "label": "res", "kind": "res"},
            {"from": "a", "to": "b", "label": "relay", "kind": "relay"},
            {"from": "a", "to": "a", "label": "self", "kind": "self"},
            {"from": "a", "to": "b", "label": "주의사항", "kind": "note"},
        ]}]}
    out = tmp_path / "k.puml"
    export_sequence(data, out)
    text = out.read_text(encoding="utf-8")
    assert "a ->> b : relay" in text          # relay
    assert "a -> a : self" in text            # self loop
    assert "note over a, b" in text and "주의사항" in text and "end note" in text


# ── TOPOLOGY ──────────────────────────────────────────────────
def test_topology_rectangles_zones_links_segments(tmp_path):
    _, text, _ = _emit(export_topology, TOPO, tmp_path)
    assert 'rectangle "Load Balancer" as lb <<gear>>' in text
    assert 'rectangle "Client" as client <<ext>>' in text
    assert 'package "App Tier" {' in text
    assert "client -- lb" in text                        # 정적 링크(순수 구성도 시나리오)
    assert "client --> lb : 1" in text                   # 번호 세그먼트 — 설명은 legend 로
    assert "col" not in text and "row" not in text        # 좌표 미누출


def test_topology_pure_diagram_scenario_has_no_numbered_arrows(tmp_path):
    _, text, _ = _emit(export_topology, TOPO, tmp_path)
    first_block = text.split("@enduml")[0]   # "인프라 구성도" (segments 없음)
    assert "-->" not in first_block and "client -- lb" in first_block
    assert "legend" not in first_block       # 번호 세그먼트가 없으면 범례도 없다


# ── topology 범례 (#57 — 다중 엣지 라벨 겹침 회피) ─────────────
def test_topology_segment_labels_move_to_legend(tmp_path):
    """엣지엔 번호만, 설명은 legend 표로 — 한 pair 에 엣지가 몰려도 라벨이 스택되지 않는다."""
    _, text, _ = _emit(export_topology, TOPO, tmp_path)
    flow = text.split("@enduml")[1]
    assert "client --> lb : 1" in flow
    assert "HTTPS 요청" not in flow.split("legend")[0]    # 화살표 라벨엔 설명 없음
    assert "| 1 | HTTPS 요청 |" in flow                   # 범례 행에 있음


def test_topology_legend_drops_step_column_when_no_step(tmp_path):
    """단계 열은 _split_step_label 이 실제로 뽑아낸 행이 있을 때만."""
    _, text, _ = _emit(export_topology, TOPO, tmp_path)
    assert "|= # |= 설명 |" in text and "단계" not in text


def test_topology_legend_keeps_step_column_and_meta(tmp_path):
    data = {"system": "T", "view": "topology",
            "nodes": [{"id": "a", "name": "A", "col": 0, "row": 0},
                      {"id": "b", "name": "B", "col": 1, "row": 0}],
            "scenarios": [{"title": "S", "segments": [
                {"n": 1, "from": "a", "to": "b", "label": "정산 — 수수료 차감", "meta": "D+3"}]}]}
    out = tmp_path / "s.puml"
    export_topology(data, out)
    text = out.read_text(encoding="utf-8")
    assert "|= # |= 단계 |= 설명 |" in text
    assert "| 1 | 정산 | 수수료 차감\\n( D+3 ) |" in text
    assert "a --> b : 1" in text


def test_topology_static_link_dropped_only_when_segment_covers_pair(tmp_path):
    """세그먼트가 잇는 pair 의 정적 링크만 생략 — 나머지는 남아 노드가 고아가 되지 않는다."""
    _, text, _ = _emit(export_topology, TOPO, tmp_path)
    flow = text.split("@enduml")[1]
    assert "client -- lb" not in flow      # 세그먼트 1 이 덮음
    assert "lb -- web2" in flow            # 덮는 세그먼트 없음 → 유지


def test_topology_unnumbered_segment_keeps_inline_label(tmp_path):
    """번호가 없으면 범례에서 참조할 키가 없어 라벨을 화살표에 남긴다."""
    data = {"system": "T", "view": "topology",
            "nodes": [{"id": "a", "name": "A", "col": 0, "row": 0},
                      {"id": "b", "name": "B", "col": 1, "row": 0}],
            "scenarios": [{"title": "S", "segments": [
                {"from": "a", "to": "b", "label": "무번호 흐름"}]}]}
    out = tmp_path / "u.puml"
    export_topology(data, out)
    text = out.read_text(encoding="utf-8")
    assert "a --> b : 무번호 흐름" in text and "legend" not in text


def test_topology_legend_escapes_pipe(tmp_path):
    data = {"system": "T", "view": "topology",
            "nodes": [{"id": "a", "name": "A", "col": 0, "row": 0},
                      {"id": "b", "name": "B", "col": 1, "row": 0}],
            "scenarios": [{"title": "S", "segments": [
                {"n": 1, "from": "a", "to": "b", "label": "a|b 분기"}]}]}
    out = tmp_path / "p.puml"
    export_topology(data, out)
    text = out.read_text(encoding="utf-8")
    assert "| 1 | a&#124;b 분기 |" in text   # 셀 구분자로 오인되지 않게 이스케이프


# ── COMPONENT ─────────────────────────────────────────────────
def test_component_ports_edges_protocol(tmp_path):
    _, text, _ = _emit(export_component, COMP, tmp_path)
    assert r'rectangle "API Gateway\n:8080" as gw' in text   # 포트 \n 스택
    assert "gw --> order : 1. 주문 생성" in text
    assert "( http )" in text
    assert 'rectangle "Payment Gateway" as psp <<ext>>' in text


def test_component_bidir_edge(tmp_path):
    data = {"system": "C", "view": "component", "scenarios": [{"title": "S",
            "nodes": [{"id": "a", "name": "A", "col": 0, "row": 0},
                      {"id": "b", "name": "B", "col": 1, "row": 0}],
            "edges": [{"from": "a", "to": "b", "label": "sync", "bidir": True}]}]}
    out = tmp_path / "b.puml"
    export_component(data, out)
    assert "a <--> b : sync" in out.read_text(encoding="utf-8")


# ── 별칭 정규화 (하이픈 든 id 가 화살표 `a --> b` 파싱을 깨뜨리던 버그) ──
def test_topology_hyphenated_ids_sanitized(tmp_path):
    """`fw-edge` 같은 하이픈 든 id 는 PlantUML 화살표 문법을 깨뜨린다 —
    선언(`as`)·정적 링크·번호 세그먼트 모두 `_` 로 정규화해 매칭을 유지한다."""
    data = {"system": "T", "view": "topology",
            "nodes": [{"id": "fw-edge", "name": "Edge FW", "col": 0, "row": 0},
                      {"id": "lb-in", "name": "Ingress LB", "col": 1, "row": 0}],
            "links": [{"from": "fw-edge", "to": "lb-in"}],
            "scenarios": [
                {"title": "구성도"},
                {"title": "FLOW", "segments": [
                    {"n": 1, "from": "fw-edge", "to": "lb-in", "label": "통과"}]}]}
    out = tmp_path / "h.puml"
    export_topology(data, out)
    text = out.read_text(encoding="utf-8")
    assert 'as fw_edge' in text and 'as lb_in' in text     # 선언 정규화
    assert "fw_edge -- lb_in" in text                       # 정적 링크 정규화
    assert "fw_edge --> lb_in : 1" in text                  # 번호 세그먼트 참조 정규화
    assert "fw-edge" not in text and "lb-in" not in text    # 하이픈 별칭은 어디에도 없음


def test_topology_alias_collision_kept_distinct(tmp_path, capsys):
    """정규화 결과가 같아지는 id 들(`web-1`·`web.1`·`web 1`)이 한 별칭으로 뭉개지면
    노드가 합쳐지고 엣지가 자기 루프로 변질된다 — 그것도 exit 0 으로 조용히 (#72)."""
    data = {"system": "T", "view": "topology",
            "nodes": [{"id": "web-1", "name": "WEB", "col": 0, "row": 0},
                      {"id": "web.1", "name": "OTHER", "col": 1, "row": 0},
                      {"id": "web 1", "name": "THIRD", "col": 2, "row": 0}],
            "links": [{"from": "web-1", "to": "web.1"}],
            "scenarios": [{"title": "FLOW", "segments": [
                {"n": 1, "from": "web-1", "to": "web.1", "label": "a"},
                {"n": 2, "from": "web.1", "to": "web 1", "label": "b"}]}]}
    out = tmp_path / "c.puml"
    export_topology(data, out)
    text = out.read_text(encoding="utf-8")
    assert 'as web_1\n' in text and 'as web_1_2' in text and 'as web_1_3' in text
    assert "web_1 --> web_1_2 : 1" in text      # 자기 루프(web_1 --> web_1) 아님
    assert "web_1_2 --> web_1_3 : 2" in text
    assert "web_1 --> web_1 " not in text
    assert "경고: 별칭 충돌" in capsys.readouterr().err   # 조용히 넘어가지 않는다


def test_alias_collision_is_deterministic(tmp_path):
    """같은 입력이면 같은 별칭 — 재생성 diff 가 흔들리지 않아야 한다."""
    data = {"system": "T", "view": "topology",
            "nodes": [{"id": "a-1", "name": "A", "col": 0, "row": 0},
                      {"id": "a.1", "name": "B", "col": 1, "row": 0}],
            "scenarios": [{"title": "S", "segments": [
                {"n": 1, "from": "a-1", "to": "a.1", "label": "x"}]}]}
    first, second = tmp_path / "1.puml", tmp_path / "2.puml"
    export_topology(data, first)
    export_topology(data, second)
    assert first.read_text(encoding="utf-8") == second.read_text(encoding="utf-8")


def test_alias_numeric_and_empty_ids_are_valid(tmp_path):
    """숫자로 시작하거나 기호뿐인 id 도 PlantUML 이 받는 별칭이 돼야 한다."""
    data = {"system": "T", "view": "topology",
            "nodes": [{"id": "7edge", "name": "NUM", "col": 0, "row": 0},
                      {"id": "--", "name": "SYM", "col": 1, "row": 0}],
            "scenarios": [{"title": "S", "segments": [
                {"n": 1, "from": "7edge", "to": "--", "label": "x"}]}]}
    out = tmp_path / "n.puml"
    export_topology(data, out)
    text = out.read_text(encoding="utf-8")
    assert "as n_7edge" in text                 # 숫자 시작 → n_ prefix
    assert "n_7edge --> " in text
    assert " as 7edge" not in text


def test_component_alias_scope_is_per_scenario(tmp_path):
    """component 노드는 시나리오 로컬 — 시나리오마다 별칭을 새로 매긴다."""
    data = {"system": "T", "view": "component", "scenarios": [
        {"title": "S1", "nodes": [{"id": "a-1", "name": "A", "col": 0, "row": 0}],
         "edges": []},
        {"title": "S2", "nodes": [{"id": "a.1", "name": "B", "col": 0, "row": 0}],
         "edges": []}]}
    out = tmp_path / "cs.puml"
    export_component(data, out)
    blocks = out.read_text(encoding="utf-8").split("@enduml")
    # 서로 다른 시나리오이므로 각자 충돌 없이 base 별칭을 쓴다
    assert "as a_1" in blocks[0] and "as a_1" in blocks[1]


def test_sequence_and_component_hyphenated_ids_sanitized(tmp_path):
    """sequence participant/화살표·component 엣지도 동일하게 정규화(표시명은 원문 보존)."""
    seq = {"system": "T",
           "actors": [{"id": "web-api", "name": "Web"}, {"id": "pay-gw", "name": "Pay"}],
           "scenarios": [{"title": "S", "steps": [
               {"from": "web-api", "to": "pay-gw", "label": "요청", "kind": "req"}]}]}
    out = tmp_path / "s.puml"
    export_sequence(seq, out)
    st = out.read_text(encoding="utf-8")
    assert "as web_api" in st and "web_api -> pay_gw : 요청" in st and "web-api" not in st

    comp = {"system": "T", "view": "component", "scenarios": [{"title": "S",
            "nodes": [{"id": "svc-a", "name": "A", "col": 0, "row": 0},
                      {"id": "svc-b", "name": "B", "col": 1, "row": 0}],
            "edges": [{"from": "svc-a", "to": "svc-b", "label": "call"}]}]}
    out = tmp_path / "c.puml"
    export_component(comp, out)
    ct = out.read_text(encoding="utf-8")
    assert "as svc_a" in ct and "svc_a --> svc_b : call" in ct and "svc-a" not in ct


# ── 스타일 토글 ───────────────────────────────────────────────
def test_no_style_omits_skinparam(tmp_path):
    _, styled, _ = _emit(export_sequence, SEQ, tmp_path)
    assert "skinparam" in styled
    data = json.loads(SEQ.read_text(encoding="utf-8"))
    out = tmp_path / "plain.puml"
    export_sequence(data, out, style=False)
    assert "skinparam" not in out.read_text(encoding="utf-8")


# ── 레이아웃 pragma 토글 (dot 기본 ↔ smetana opt-in) ──────────
_PRAGMA = "!pragma layout smetana"


def test_rect_views_use_dot_by_default(tmp_path):
    """기본은 dot — smetana 는 캔버스를 클리핑하므로 강제하지 않는다(v0.13 에서 뒤집음)."""
    for export, src in ((export_topology, TOPO), (export_component, COMP)):
        _, text, _ = _emit(export, src, tmp_path)
        assert _PRAGMA not in text
        assert "skinparam" in text             # 팔레트는 직교 — 같이 빠지지 않는다


def test_smetana_opt_in_emits_pragma_per_block(tmp_path):
    for export, src in ((export_topology, TOPO), (export_component, COMP)):
        _, text, n = _emit(export, src, tmp_path, smetana=True)
        assert text.count(_PRAGMA) == n        # 블록마다 하나씩


def test_pragma_and_style_are_orthogonal(tmp_path):
    """--no-style 은 pragma 를, --smetana 는 skinparam 을 건드리지 않는다."""
    _, no_style, _ = _emit(export_topology, TOPO, tmp_path, style=False, smetana=True)
    assert _PRAGMA in no_style and "skinparam" not in no_style
    _, neither, _ = _emit(export_topology, TOPO, tmp_path, style=False)
    assert _PRAGMA not in neither and "skinparam" not in neither
    assert neither.startswith("@startuml\ntitle ")   # @startuml 직후 바로 title


def test_sequence_never_emits_layout_pragma(tmp_path):
    for kw in ({}, {"style": False}):
        _, text, _ = _emit(export_sequence, SEQ, tmp_path, **kw)
        assert "!pragma" not in text


def test_cli_smetana_flag(tmp_path):
    dst = tmp_path / "t.json"
    dst.write_text(TOPO.read_text(encoding="utf-8"), encoding="utf-8")
    assert _run([str(dst)]).returncode == 0
    assert _PRAGMA not in (tmp_path / "t.puml").read_text(encoding="utf-8")
    r = _run([str(dst), "--smetana"])
    assert r.returncode == 0
    assert _PRAGMA in (tmp_path / "t.puml").read_text(encoding="utf-8")


def test_cli_smetana_on_sequence_warns_and_succeeds(tmp_path):
    dst = tmp_path / "s.json"
    dst.write_text(SEQ.read_text(encoding="utf-8"), encoding="utf-8")
    r = _run([str(dst), "--smetana"])
    assert r.returncode == 0 and "무시" in r.stderr


# ── CLI 검증 게이트 · 종료코드 ─────────────────────────────────
def _run(args):
    return subprocess.run([sys.executable, str(SCRIPT), *args],
                          capture_output=True, text=True)


def test_cli_success_default_out(tmp_path):
    dst = tmp_path / "s.json"
    dst.write_text(SEQ.read_text(encoding="utf-8"), encoding="utf-8")
    r = _run([str(dst)])
    assert r.returncode == 0 and "puml:" in r.stdout
    assert (tmp_path / "s.puml").exists()


def test_cli_dangling_actor_ref_rejected(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"system": "T", "actors": [{"id": "a", "name": "A"}],
        "scenarios": [{"title": "S", "steps": [
            {"from": "a", "to": "ghost", "label": "x", "kind": "req"}]}]}), encoding="utf-8")
    r = _run([str(bad)])
    assert r.returncode == 1 and "검증 오류" in r.stderr
    assert not (tmp_path / "bad.puml").exists()


def test_cli_unsupported_view(tmp_path):
    bad = tmp_path / "v.json"
    bad.write_text(json.dumps({"system": "T", "view": "gantt", "scenarios": []}), encoding="utf-8")
    r = _run([str(bad)])
    assert r.returncode == 1 and "지원" in r.stderr


def test_cli_missing_file():
    r = _run(["/nonexistent/x.json"])
    assert r.returncode == 1 and "파일 없음" in r.stderr


# ── 게시본 .puml 골든 회귀 (#69) ───────────────────────────────
# docs/examples/puml/*.puml 는 Pages showcase 가 그대로 보여주는 B-out 산출물이다.
# exporter 를 고치면 `bash scripts/regen-examples.sh` 로 함께 갱신한다.

DOCS_PUML = ROOT / "docs" / "examples" / "puml"


@pytest.mark.parametrize("name", sorted(p.stem for p in EX.glob("*.json")))
def test_published_puml_matches_current_export(name, tmp_path):
    out = tmp_path / f"{name}.puml"
    r = _run([str(EX / f"{name}.json"), "-o", str(out)])
    assert r.returncode == 0, r.stderr
    assert out.read_text(encoding="utf-8") == (
        DOCS_PUML / f"{name}.puml"
    ).read_text(encoding="utf-8"), (
        f"docs/examples/puml/{name}.puml 이 현재 plantuml_export.py 출력과 다르다 "
        f"— bash scripts/regen-examples.sh 후 재생성분을 함께 커밋"
    )
