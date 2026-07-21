"""Plugin release metadata gate tests."""

import copy
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "scripts" / "validate_plugin_manifest.py"

_spec = importlib.util.spec_from_file_location("validate_plugin_manifest", SCRIPT)
_module = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_module)
SKILL_PATHS = (
    "./skills/flowcast",
    "./skills/sequence",
    "./skills/topology",
    "./skills/component",
)
AGENT_NAMES = ("diagram-router", "diagram-drawer")


def _plugin():
    return {
        "name": "flowcast",
        "description": "Diagram workflow plugin",
        "version": "1.2.3",
        "author": {"name": "SeokRae", "email": "owner@example.com"},
        "homepage": "https://example.com/flowcast",
        "repository": "https://example.com/flowcast.git",
        "license": "MIT",
        "keywords": ["flowcast", "diagram"],
        "skills": list(SKILL_PATHS),
    }


def _marketplace():
    return {
        "name": "flowcast",
        "owner": {"name": "SeokRae", "email": "owner@example.com"},
        "metadata": {"description": "Diagram workflow plugin", "version": "1.2.3"},
        "plugins": [
            {
                "name": "flowcast",
                "source": "./",
                "description": "Diagram workflow plugin",
                "version": "1.2.3",
                "author": {"name": "SeokRae", "email": "owner@example.com"},
                "keywords": ["flowcast", "diagram"],
            }
        ],
    }


def _write_repository(
    tmp_path,
    plugin=None,
    marketplace=None,
    missing_skill=None,
    agent_names=None,
    missing_agent=None,
):
    repository = tmp_path / "repository"
    metadata_directory = repository / ".claude-plugin"
    scripts_directory = repository / "scripts"
    metadata_directory.mkdir(parents=True)
    scripts_directory.mkdir()
    shutil.copyfile(SCRIPT, scripts_directory / SCRIPT.name)
    # 검증기는 형제 _cli.read_json 을 로드한다(#124) — 실배포처럼 scripts/ 에 나란히 둔다.
    shutil.copyfile(SCRIPT.parent / "_cli.py", scripts_directory / "_cli.py")

    plugin = _plugin() if plugin is None else plugin
    marketplace = _marketplace() if marketplace is None else marketplace
    (metadata_directory / "plugin.json").write_text(
        plugin if isinstance(plugin, str) else json.dumps(plugin),
        encoding="utf-8",
    )
    (metadata_directory / "marketplace.json").write_text(
        marketplace if isinstance(marketplace, str) else json.dumps(marketplace),
        encoding="utf-8",
    )

    for skill_path in SKILL_PATHS:
        if skill_path == missing_skill:
            continue
        skill_directory = repository / skill_path
        skill_directory.mkdir(parents=True)
        (skill_directory / "SKILL.md").write_text("# Skill\n", encoding="utf-8")

    # agent_names maps file stem -> frontmatter name (differ to force a mismatch).
    agents_directory = repository / "agents"
    agents_directory.mkdir()
    names = {stem: stem for stem in AGENT_NAMES}
    if agent_names is not None:
        names.update(agent_names)
    for stem, name in names.items():
        if stem == missing_agent:
            continue
        (agents_directory / (stem + ".md")).write_text(
            "---\nname: {}\ndescription: fixture\n---\n# agent\n".format(name),
            encoding="utf-8",
        )
    return repository


def _run_cli(repository):
    return subprocess.run(
        [sys.executable, str(repository / "scripts" / SCRIPT.name)],
        cwd=repository,
        capture_output=True,
        text=True,
        check=False,
    )


def test_cli_accepts_repository_plugin_metadata():
    result = subprocess.run(
        [sys.executable, str(SCRIPT)],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    shipped = json.loads(
        (ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    # 버전을 하드코딩하면 릴리즈마다 이 테스트가 red 가 되어
    # "테스트를 고치는" 습관이 붙는다 — 매니페스트에서 읽어 비교한다.
    assert result.stdout == (
        f"plugin metadata valid: {shipped['name']} {shipped['version']}\n")
    assert result.stderr == ""


def test_cli_accepts_valid_current_structure(tmp_path):
    repository = _write_repository(tmp_path)

    result = _run_cli(repository)

    assert result.returncode == 0, result.stderr
    assert result.stdout == "plugin metadata valid: flowcast 1.2.3\n"
    assert result.stderr == ""


@pytest.mark.parametrize(
    ("manifest_name", "payload"),
    (("plugin.json", "{"), ("marketplace.json", "[")),
)
def test_cli_reports_invalid_json_without_a_traceback(
    tmp_path, manifest_name, payload
):
    keyword = "plugin" if manifest_name == "plugin.json" else "marketplace"
    repository = _write_repository(tmp_path, **{keyword: payload})

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "JSON 파싱 실패: {}".format(manifest_name) in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    ("manifest_name", "payload"),
    (
        ("plugin", "null"),
        ("plugin", "[]"),
        ("marketplace", "null"),
        ("marketplace", "[]"),
    ),
)
def test_cli_rejects_non_object_json_without_a_traceback(
    tmp_path, manifest_name, payload
):
    repository = _write_repository(tmp_path, **{manifest_name: payload})

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "{}: expected a JSON object".format(manifest_name) in result.stderr
    assert "Traceback" not in result.stderr


@pytest.mark.parametrize(
    ("manifest_name", "field"),
    (
        ("plugin", "description"),
        ("plugin", "author"),
        ("plugin", "homepage"),
        ("plugin", "repository"),
        ("plugin", "license"),
        ("plugin", "keywords"),
        ("plugin", "skills"),
        ("marketplace", "owner"),
        ("marketplace", "metadata"),
        ("marketplace", "plugins"),
    ),
)
def test_cli_rejects_missing_required_top_level_fields(
    tmp_path, manifest_name, field
):
    plugin = _plugin()
    marketplace = _marketplace()
    payload = plugin if manifest_name == "plugin" else marketplace
    del payload[field]
    repository = _write_repository(tmp_path, plugin, marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "{}.{}: required".format(manifest_name, field) in result.stderr


@pytest.mark.parametrize("field", ("id", "unexpected"))
def test_cli_rejects_unknown_marketplace_top_level_fields(tmp_path, field):
    marketplace = _marketplace()
    marketplace[field] = "unsupported"
    repository = _write_repository(tmp_path, marketplace=marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "marketplace: unsupported top-level field: {}".format(field) in result.stderr


@pytest.mark.parametrize("field", ("id", "unexpected"))
def test_cli_rejects_unknown_plugin_fields(tmp_path, field):
    plugin = _plugin()
    plugin[field] = "unsupported"
    repository = _write_repository(tmp_path, plugin=plugin)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "plugin: unsupported field: {}".format(field) in result.stderr


def test_cli_rejects_unknown_marketplace_plugin_entry_fields(tmp_path):
    marketplace = _marketplace()
    marketplace["plugins"][0]["typo"] = True
    repository = _write_repository(tmp_path, marketplace=marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "marketplace.plugins[0]: unsupported field: typo" in result.stderr


@pytest.mark.parametrize(
    ("location", "expected_path"),
    (
        ("plugin author", "plugin.author"),
        ("marketplace owner", "marketplace.owner"),
        ("marketplace metadata", "marketplace.metadata"),
        ("plugin entry author", "marketplace.plugins[0].author"),
    ),
)
def test_cli_rejects_unknown_nested_metadata_fields(
        tmp_path, location, expected_path):
    plugin = _plugin()
    marketplace = _marketplace()
    target = {
        "plugin author": plugin["author"],
        "marketplace owner": marketplace["owner"],
        "marketplace metadata": marketplace["metadata"],
        "plugin entry author": marketplace["plugins"][0]["author"],
    }[location]
    target["typo"] = True
    repository = _write_repository(tmp_path, plugin, marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "{}: unsupported field: typo".format(expected_path) in result.stderr


@pytest.mark.parametrize("name_location", ("marketplace", "plugin entry"))
def test_cli_rejects_plugin_name_mismatches(tmp_path, name_location):
    marketplace = _marketplace()
    if name_location == "marketplace":
        marketplace["name"] = "another-plugin"
    else:
        marketplace["plugins"][0]["name"] = "another-plugin"
    repository = _write_repository(tmp_path, marketplace=marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "plugin names must match" in result.stderr


@pytest.mark.parametrize("version_location", ("metadata", "plugin entry"))
def test_cli_rejects_plugin_version_mismatches(tmp_path, version_location):
    marketplace = _marketplace()
    if version_location == "metadata":
        marketplace["metadata"]["version"] = "1.2.4"
    else:
        marketplace["plugins"][0]["version"] = "1.2.4"
    repository = _write_repository(tmp_path, marketplace=marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "plugin versions must match" in result.stderr


@pytest.mark.parametrize(
    "version", ("1.2", "1.2.3-beta", "v1.2.3", "1.02.3", 123)
)
def test_cli_requires_numeric_semantic_versions(tmp_path, version):
    plugin = _plugin()
    marketplace = _marketplace()
    plugin["version"] = version
    marketplace["metadata"]["version"] = version
    marketplace["plugins"][0]["version"] = version
    repository = _write_repository(tmp_path, plugin, marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "version: expected numeric x.y.z" in result.stderr


def test_cli_requires_each_declared_skill_to_have_skill_markdown(tmp_path):
    missing_skill = "./skills/topology"
    repository = _write_repository(tmp_path, missing_skill=missing_skill)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "plugin.skills[2]: missing SKILL.md" in result.stderr


# ── agents/*.md 프론트매터 name 검증 (#97) ────────────────────
# skills/flowcast/SKILL.md 가 diagram-router/diagram-drawer 를 리터럴 dispatch 하는데
# 그 이름의 유일 출처인 agents/*.md 의 name 을 다른 게이트가 검사하지 않았다.

def test_cli_accepts_matching_agent_frontmatter(tmp_path):
    repository = _write_repository(tmp_path)

    result = _run_cli(repository)

    assert result.returncode == 0, result.stderr


def test_cli_rejects_agent_name_not_matching_stem(tmp_path):
    repository = _write_repository(
        tmp_path, agent_names={"diagram-router": "diagram-rooter"}
    )

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "agents/diagram-router.md" in result.stderr
    assert "does not match file stem" in result.stderr


def test_cli_rejects_missing_required_agent(tmp_path):
    repository = _write_repository(tmp_path, missing_agent="diagram-drawer")

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "required agent(s) missing or misnamed: ['diagram-drawer']" in result.stderr


@pytest.mark.parametrize(
    ("frontmatter", "expected"),
    (
        ("---\nname: diagram-router\n---\n", ("diagram-router", True)),
        ('---\nname: "diagram-router"\n---\n', ("diagram-router", True)),
        ("---\nname: 'diagram-router'\n---\n", ("diagram-router", True)),
        ("---\r\nname: diagram-router\r\n---\r\n", ("diagram-router", True)),
        ("no frontmatter here", (None, False)),
        ("---\ndescription: x\n---\n", (None, True)),
    ),
)
def test_frontmatter_name_tolerates_quotes_and_crlf(frontmatter, expected):
    # CRLF·따옴표는 유효 YAML — 언쿼팅/정규화 없이 비교하면 유효한 파일을 오거부한다.
    assert _module._frontmatter_name(frontmatter) == expected


@pytest.mark.parametrize(
    ("mutation", "expected"),
    (
        ("metadata description", "marketplace.metadata.description"),
        ("plugin source", "marketplace.plugins[0].source"),
        ("plugin author", "marketplace.plugins[0].author"),
        ("plugin keywords", "marketplace.plugins[0].keywords"),
    ),
)
def test_cli_rejects_incomplete_nested_marketplace_structure(
    tmp_path, mutation, expected
):
    marketplace = _marketplace()
    if mutation == "metadata description":
        del marketplace["metadata"]["description"]
    else:
        del marketplace["plugins"][0][mutation.removeprefix("plugin ")]
    repository = _write_repository(tmp_path, marketplace=marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "{}: required".format(expected) in result.stderr


# ── keywords 교차 검증 (#77) ──────────────────────────────────
# plugin.json 만 갱신되고 marketplace.json 이 남는 편측 갱신을 잡는다
# (#53 에서 실제로 발생 — plantuml 등 3개가 어긋난 채 CI 초록이었다).

def test_cli_rejects_marketplace_keyword_not_in_plugin(tmp_path):
    marketplace = _marketplace()
    marketplace["plugins"][0]["keywords"] = ["flowcast", "diagram", "ghost"]
    repository = _write_repository(tmp_path, marketplace=marketplace)

    result = _run_cli(repository)

    assert result.returncode == 1
    assert "must be a subset of plugin keywords" in result.stderr
    assert "ghost" in result.stderr


def test_cli_allows_marketplace_keywords_to_be_a_strict_subset(tmp_path):
    """노출용이라 일부만 싣는 건 허용 — 동등 검사가 아니다."""
    marketplace = _marketplace()
    marketplace["plugins"][0]["keywords"] = ["flowcast"]
    repository = _write_repository(tmp_path, marketplace=marketplace)

    result = _run_cli(repository)

    assert result.returncode == 0, result.stderr


def test_shipped_marketplace_keywords_are_subset_of_plugin():
    """실제 매니페스트 두 파일이 어긋나지 않는지 — #53 편측 갱신의 직접 회귀."""
    plugin = json.loads((ROOT / ".claude-plugin" / "plugin.json").read_text(encoding="utf-8"))
    marketplace = json.loads((ROOT / ".claude-plugin" / "marketplace.json").read_text(encoding="utf-8"))
    entry = marketplace["plugins"][0]["keywords"]
    assert set(entry) <= set(plugin["keywords"])
