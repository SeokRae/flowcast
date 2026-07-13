"""Plugin release metadata gate tests."""

import copy
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).parent.parent
SCRIPT = ROOT / "scripts" / "validate_plugin_manifest.py"
SKILL_PATHS = (
    "./skills/flowcast",
    "./skills/sequence",
    "./skills/topology",
    "./skills/component",
)


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


def _write_repository(tmp_path, plugin=None, marketplace=None, missing_skill=None):
    repository = tmp_path / "repository"
    metadata_directory = repository / ".claude-plugin"
    scripts_directory = repository / "scripts"
    metadata_directory.mkdir(parents=True)
    scripts_directory.mkdir()
    shutil.copyfile(SCRIPT, scripts_directory / SCRIPT.name)

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
    assert result.stdout == "plugin metadata valid: flowcast 0.11.0\n"
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
    assert "{}: invalid JSON".format(manifest_name) in result.stderr
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
