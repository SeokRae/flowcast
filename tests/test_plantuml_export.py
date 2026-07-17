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
