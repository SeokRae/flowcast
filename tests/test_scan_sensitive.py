"""flowcast scripts/scan-sensitive.sh — 실 데이터 차단 게이트의 회귀 테스트.

이 게이트는 push 를 막을 권한을 가진 유일한 장치인데 그동안 테스트가 없었다(#75).
패턴을 잘못 손봐 실 토큰이 통과하게 돼도, 리포에 그 토큰이 없으므로 CI 는 계속
초록이다 — 무력화된 사실을 알 방법이 없다.

**픽스처 토큰은 반드시 런타임 문자열 조합으로 만든다.** 리터럴로 적으면 이 파일
자체가 리포 전체 스캔에 걸려 push 가 영구 차단된다.

parametrize 의 id 도 조립 토큰이 되면 안 된다 — pytest 가 `.pytest_cache/v/cache/nodeids`
에 테스트 id 를 그대로 적어 그 파일이 게이트에 걸린다(실제로 걸렸다).

검증 전략: tmp_path 에 최소 트리(scripts/ + 대상 파일)를 만들고 스크립트를 복사해
실행한다. 스크립트가 ROOT 를 `dirname $0/..` 로 잡으므로 프로덕션 코드에 주입 훅이
필요 없다.
"""

import shutil
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).parent.parent / "scripts" / "scan-sensitive.sh"

# 블록리스트 계열별 대표 토큰 — 전부 런타임 조합 (위 docstring 참조)
LATIN = [
    "nas" + "tec",
    "v" + "pg",
    "lot" + "te",
    "nice" + "pay",
    "k" + "7",                      # 독립 토큰은 탐지돼야 한다
    "acct" + "_1AbC",
    "settreport" + "_9",
    "payauthz" + "_9",
    "refauthz" + "_9",
    "pay" + "only",
    "bid" + "_1",
    "client" + "Id",
    "partner" + "TransactionId",
]
KOREAN = ["나스" + "텍", "롯" + "데", "입금" + "정산"]


def _run(tmp_path, files):
    """tmp_path 에 트리를 만들고 게이트를 실행해 CompletedProcess 반환."""
    (tmp_path / "scripts").mkdir(parents=True, exist_ok=True)
    shutil.copy(SCRIPT, tmp_path / "scripts" / "scan-sensitive.sh")
    for rel, text in files.items():
        p = tmp_path / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(text, encoding="utf-8")
    return subprocess.run(["bash", str(tmp_path / "scripts" / "scan-sensitive.sh")],
                          capture_output=True, text=True)


# ── 양성: 각 계열이 실제로 탐지되는가 ──────────────────────────

@pytest.mark.parametrize("token", LATIN, ids=[f"latin{i}" for i in range(len(LATIN))])
def test_latin_tokens_are_blocked(tmp_path, token):
    r = _run(tmp_path, {"examples/x.json": '{"label": "%s"}' % token})
    assert r.returncode == 1, f"{token!r} 가 통과했다 — 게이트 무력화"
    assert "차단" in r.stdout


@pytest.mark.parametrize("token", KOREAN, ids=[f"ko{i}" for i in range(len(KOREAN))])
def test_korean_tokens_are_blocked(tmp_path, token):
    r = _run(tmp_path, {"docs/note.md": f"파트너: {token}"})
    assert r.returncode == 1, f"{token!r} 가 통과했다 — 게이트 무력화"


def test_uppercase_company_name_is_blocked(tmp_path):
    r = _run(tmp_path, {"a.md": "결제사 " + "NI" + "CE" + " 연동"})
    assert r.returncode == 1


def test_case_insensitive_for_latin(tmp_path):
    """라틴 계열은 -i 라 대소문자를 가리지 않는다."""
    r = _run(tmp_path, {"a.md": ("nas" + "tec").upper()})
    assert r.returncode == 1


# ── 음성: 오탐하지 않는가 ─────────────────────────────────────

def test_clean_tree_passes(tmp_path):
    r = _run(tmp_path, {"examples/ok.json": '{"label": "결제 요청"}'})
    assert r.returncode == 0
    assert "CLEAN" in r.stdout


@pytest.mark.parametrize("word", ["lnk" + "7", "link" + "7", "lnk" + "7" + "0"],
                         ids=["lnk", "link", "lnk0"])
def test_plantuml_link_ids_are_not_false_positives(tmp_path, word):
    """#64 회귀 — PlantUML 자동 링크 id 의 부분문자열에 오탐하면 링크 7개 이상
    SVG 가 push 를 막는다. 단어경계(\\b) 고정이 풀리면 이 테스트가 red 가 된다."""
    r = _run(tmp_path, {"docs/x.svg": f'<g id="{word}"><path d="M0,0"/></g>'})
    assert r.returncode == 0, f"{word!r} 를 오탐했다 (#64 재발)"


def test_lowercase_generic_word_is_not_blocked(tmp_path):
    """회사명은 대문자 단어경계로만 잡는다 — 영어 일반어까지 막으면 안 된다."""
    r = _run(tmp_path, {"a.md": "That looks " + "ni" + "ce" + " to me."})
    assert r.returncode == 0


# ── 제외 경로(EXCL) 가 유지되는가 ─────────────────────────────

def test_planning_doc_is_no_longer_excluded(tmp_path):
    """PLAN.md 는 더 이상 제외 대상이 아니다 (#98).

    초기 구축용 planning 문서를 지우면서 `.gitignore` 와 EXCL 양쪽에서 함께 뺐다.
    같은 이름의 파일이 다시 생기면 커밋은 가능하되 스캔 대상이므로, 실 데이터가
    들어가면 게이트가 push 를 막는다 — public repo 에선 '무시'보다 '스캔'이 더
    강한 보장이다.
    """
    r = _run(tmp_path, {"PLAN.md": "제약: " + "나스" + "텍" + " 데이터 금지"})
    assert r.returncode == 1


def test_scan_script_itself_is_excluded(tmp_path):
    """스크립트는 패턴을 담고 있으니 자기 자신을 스캔하면 항상 red 가 된다."""
    r = _run(tmp_path, {})          # 스크립트만 있는 트리
    assert r.returncode == 0


@pytest.mark.parametrize("d", ["__pycache__", ".pytest_cache", ".venv"])
def test_tooling_caches_are_excluded(tmp_path, d):
    """gitignore 된 도구 캐시·의존성 트리는 스캔 대상이 아니다.

    특히 `.pytest_cache/v/cache/nodeids` 는 pytest 가 테스트 id 를 그대로 적어 두는
    파일이라, 이 파일의 회귀 테스트가 바로 그 자리를 채운다(제외 전 실제로 걸렸다).
    `.venv` 는 서드파티 패키지 소스·바이너리가 토큰 유사 문자열로 오탐한다(#122).
    """
    r = _run(tmp_path, {f"{d}/v/cache/nodeids": '["%s"]' % ("nas" + "tec")})
    assert r.returncode == 0


@pytest.mark.parametrize("d", ["flowcast-out", "_workspace", "_workspace_prev"])
def test_run_artifacts_are_excluded(tmp_path, d):
    """실행 산출물에는 실 데이터가 정상적으로 들어간다 — .gitignore 로 커밋되지
    않으므로 게이트 대상이 아니다(#70). 제외가 풀리면 1회 실행으로 게이트가 죽는다."""
    r = _run(tmp_path, {f"{d}/diagram.json": '{"label": "%s"}' % ("nas" + "tec")})
    assert r.returncode == 0


def test_artifact_exclusion_does_not_leak_to_similar_names(tmp_path):
    """제외는 정확한 디렉토리명에만 걸린다 — 비슷한 이름까지 새면 구멍이 된다."""
    r = _run(tmp_path, {"flowcast-output/x.json": '{"label": "%s"}' % ("nas" + "tec")})
    assert r.returncode == 1
