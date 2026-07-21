#!/usr/bin/env python3
"""Validate Claude plugin metadata without third-party dependencies."""

import re
import sys
from pathlib import Path

# scripts/ 를 경로에 넣어 _cli 를 로드한다 — 직접 실행뿐 아니라 테스트가
# spec_from_file_location 으로 이 모듈을 로드할 때도 동작하도록 __file__ 기준으로 넣는다.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))
from _cli import read_json  # noqa: E402


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
METADATA_DIRECTORY = ".claude-plugin"
AGENTS_DIRECTORY = "agents"
# skills/flowcast/SKILL.md 가 이 이름들로 리터럴 dispatch 한다 — 유일 출처인
# agents/*.md 의 frontmatter name 이 파일명과 어긋나면 dispatch 가 조용히 깨진다.
REQUIRED_AGENT_NAMES = frozenset(("diagram-router", "diagram-drawer"))
PLUGIN_FILENAME = "plugin.json"
MARKETPLACE_FILENAME = "marketplace.json"
MARKETPLACE_FIELDS = frozenset(("name", "owner", "metadata", "plugins"))
PLUGIN_FIELDS = frozenset(
    (
        "name",
        "version",
        "description",
        "author",
        "homepage",
        "repository",
        "license",
        "keywords",
        "skills",
    )
)
MARKETPLACE_PLUGIN_FIELDS = frozenset(
    ("name", "source", "description", "version", "author", "keywords")
)
PLUGIN_AUTHOR_FIELDS = frozenset(("name", "email"))
MARKETPLACE_OWNER_FIELDS = frozenset(("name", "email"))
MARKETPLACE_METADATA_FIELDS = frozenset(("description", "version"))
LOAD_FAILED = object()
NUMERIC_SEMANTIC_VERSION = re.compile(
    r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$"
)
FRONTMATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)


def _load_json(path, label, errors):
    data, error = read_json(path, label=label)
    if error is not None:
        errors.append(error)
        return LOAD_FAILED
    return data


def _required_value(container, key, path, errors):
    if key not in container:
        errors.append("{}.{}: required".format(path, key))
        return None
    return container[key]


def _reject_unknown_fields(container, allowed_fields, path, errors):
    for field in sorted(set(container) - allowed_fields):
        errors.append("{}: unsupported field: {}".format(path, field))


def _required_string(container, key, path, errors):
    value = _required_value(container, key, path, errors)
    if value is None and key not in container:
        return None
    if not isinstance(value, str) or not value.strip():
        errors.append("{}.{}: expected a non-empty string".format(path, key))
        return None
    return value


def _required_object(container, key, path, errors):
    value = _required_value(container, key, path, errors)
    if value is None and key not in container:
        return None
    if not isinstance(value, dict):
        errors.append("{}.{}: expected a JSON object".format(path, key))
        return None
    return value


def _required_string_list(container, key, path, errors):
    value = _required_value(container, key, path, errors)
    field_path = "{}.{}".format(path, key)
    if value is None and key not in container:
        return None
    if not isinstance(value, list) or not value:
        errors.append("{}: expected a non-empty array".format(field_path))
        return None
    for index, item in enumerate(value):
        if not isinstance(item, str) or not item.strip():
            errors.append(
                "{}[{}]: expected a non-empty string".format(field_path, index)
            )
    return value


def _validate_person(person, path, errors, allowed_fields=PLUGIN_AUTHOR_FIELDS):
    if person is None:
        return
    _reject_unknown_fields(person, allowed_fields, path, errors)
    _required_string(person, "name", path, errors)
    _required_string(person, "email", path, errors)


def _validate_version(version, path, errors):
    if not isinstance(version, str) or not NUMERIC_SEMANTIC_VERSION.fullmatch(version):
        errors.append("{}: expected numeric x.y.z".format(path))


def _required_version(container, key, path, errors):
    version = _required_value(container, key, path, errors)
    if version is None and key not in container:
        return None
    _validate_version(version, "{}.{}".format(path, key), errors)
    return version


def _validate_plugin(plugin, repository_root, errors):
    if not isinstance(plugin, dict):
        errors.append("plugin: expected a JSON object")
        return {}

    _reject_unknown_fields(plugin, PLUGIN_FIELDS, "plugin", errors)
    name = _required_string(plugin, "name", "plugin", errors)
    _required_string(plugin, "description", "plugin", errors)
    version = _required_version(plugin, "version", "plugin", errors)
    author = _required_object(plugin, "author", "plugin", errors)
    _validate_person(author, "plugin.author", errors)
    _required_string(plugin, "homepage", "plugin", errors)
    _required_string(plugin, "repository", "plugin", errors)
    _required_string(plugin, "license", "plugin", errors)
    keywords = _required_string_list(plugin, "keywords", "plugin", errors)
    skills = _required_string_list(plugin, "skills", "plugin", errors)

    if skills is not None:
        _validate_skill_paths(skills, repository_root, errors)
    return {"name": name, "version": version, "keywords": keywords}


def _validate_skill_paths(skills, repository_root, errors):
    repository_root = repository_root.resolve()
    for index, skill_path in enumerate(skills):
        if not isinstance(skill_path, str) or not skill_path.strip():
            continue
        path = Path(skill_path)
        field_path = "plugin.skills[{}]".format(index)
        if path.is_absolute():
            errors.append("{}: expected a repository-relative path".format(field_path))
            continue
        skill_file = (repository_root / path / "SKILL.md").resolve()
        try:
            skill_file.relative_to(repository_root)
        except ValueError:
            errors.append("{}: path leaves the repository".format(field_path))
            continue
        if not skill_file.is_file():
            errors.append(
                "{}: missing SKILL.md at {}".format(field_path, skill_path)
            )


def _validate_marketplace(marketplace, errors):
    if not isinstance(marketplace, dict):
        errors.append("marketplace: expected a JSON object")
        return {}

    for field in sorted(set(marketplace) - MARKETPLACE_FIELDS):
        errors.append("marketplace: unsupported top-level field: {}".format(field))

    name = _required_string(marketplace, "name", "marketplace", errors)
    owner = _required_object(marketplace, "owner", "marketplace", errors)
    _validate_person(
        owner, "marketplace.owner", errors, MARKETPLACE_OWNER_FIELDS
    )

    metadata = _required_object(marketplace, "metadata", "marketplace", errors)
    metadata_version = None
    if metadata is not None:
        _reject_unknown_fields(
            metadata,
            MARKETPLACE_METADATA_FIELDS,
            "marketplace.metadata",
            errors,
        )
        _required_string(metadata, "description", "marketplace.metadata", errors)
        metadata_version = _required_version(
            metadata, "version", "marketplace.metadata", errors
        )

    plugins = _required_value(marketplace, "plugins", "marketplace", errors)
    plugin_entry = None
    if "plugins" in marketplace:
        if not isinstance(plugins, list) or len(plugins) != 1:
            errors.append("marketplace.plugins: expected exactly one plugin")
        elif not isinstance(plugins[0], dict):
            errors.append("marketplace.plugins[0]: expected a JSON object")
        else:
            plugin_entry = plugins[0]

    entry_name = None
    entry_version = None
    entry_keywords = None
    if plugin_entry is not None:
        _reject_unknown_fields(
            plugin_entry,
            MARKETPLACE_PLUGIN_FIELDS,
            "marketplace.plugins[0]",
            errors,
        )
        entry_name = _required_string(
            plugin_entry, "name", "marketplace.plugins[0]", errors
        )
        source = _required_string(
            plugin_entry, "source", "marketplace.plugins[0]", errors
        )
        if source is not None and source != "./":
            errors.append("marketplace.plugins[0].source: expected './'")
        _required_string(
            plugin_entry, "description", "marketplace.plugins[0]", errors
        )
        entry_version = _required_version(
            plugin_entry, "version", "marketplace.plugins[0]", errors
        )
        author = _required_object(
            plugin_entry, "author", "marketplace.plugins[0]", errors
        )
        _validate_person(author, "marketplace.plugins[0].author", errors)
        entry_keywords = _required_string_list(
            plugin_entry, "keywords", "marketplace.plugins[0]", errors
        )

    return {
        "name": name,
        "metadata_version": metadata_version,
        "entry_name": entry_name,
        "entry_version": entry_version,
        "entry_keywords": entry_keywords,
    }


def _all_present_and_equal(values):
    return all(value is not None for value in values) and all(
        value == values[0] for value in values[1:]
    )


def _frontmatter_name(text):
    """Return ``(name, has_frontmatter)`` from a Markdown frontmatter block.

    Stdlib line scan — no PyYAML (dependency isolation). Only the ``name`` field
    is contract-bearing here; full frontmatter YAML validity is a separate gate.
    ``name`` is ``None`` when the frontmatter has no ``name:`` line. Tolerates CRLF
    line endings and a single wrapping quote pair around the value (both valid YAML).
    """
    match = FRONTMATTER.match(text)
    if match is None:
        return None, False
    for line in match.group(1).splitlines():
        key, separator, value = line.partition(":")
        if separator and key.strip() == "name":
            value = value.strip()
            if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                value = value[1:-1]
            return value, True
    return None, True


def _validate_agent_files(repository_root, errors):
    """Every agents/*.md frontmatter ``name`` must equal its file stem, and the
    names skills dispatch by must all be present."""
    agents_directory = repository_root / AGENTS_DIRECTORY
    found = set()
    for path in sorted(agents_directory.glob("*.md")):
        field = "{}/{}".format(AGENTS_DIRECTORY, path.name)
        try:
            text = path.read_text(encoding="utf-8")
        except OSError:
            errors.append("{}: cannot read".format(field))
            continue
        name, has_frontmatter = _frontmatter_name(text)
        if not has_frontmatter:
            errors.append("{}: missing frontmatter block".format(field))
            continue
        if name is None or not name:
            errors.append("{}: missing frontmatter name".format(field))
            continue
        if name != path.stem:
            errors.append(
                "{}: frontmatter name {!r} does not match file stem {!r}".format(
                    field, name, path.stem
                )
            )
            continue
        found.add(name)
    missing = REQUIRED_AGENT_NAMES - found
    if missing:
        errors.append(
            "required agent(s) missing or misnamed: {}".format(sorted(missing))
        )


def _load_and_validate(repository_root):
    repository_root = Path(repository_root)
    errors = []
    metadata_directory = repository_root / METADATA_DIRECTORY
    plugin = _load_json(
        metadata_directory / PLUGIN_FILENAME, PLUGIN_FILENAME, errors
    )
    marketplace = _load_json(
        metadata_directory / MARKETPLACE_FILENAME, MARKETPLACE_FILENAME, errors
    )

    plugin_details = (
        _validate_plugin(plugin, repository_root, errors)
        if plugin is not LOAD_FAILED
        else {}
    )
    marketplace_details = (
        _validate_marketplace(marketplace, errors)
        if marketplace is not LOAD_FAILED
        else {}
    )

    _validate_agent_files(repository_root, errors)

    names = (
        plugin_details.get("name"),
        marketplace_details.get("name"),
        marketplace_details.get("entry_name"),
    )
    if all(name is not None for name in names) and not _all_present_and_equal(names):
        errors.append("plugin names must match across plugin and marketplace metadata")

    versions = (
        plugin_details.get("version"),
        marketplace_details.get("metadata_version"),
        marketplace_details.get("entry_version"),
    )
    versions_are_present = all(version is not None for version in versions)
    if versions_are_present and not _all_present_and_equal(versions):
        errors.append("plugin versions must match across all three metadata fields")

    # marketplace keywords ⊆ plugin keywords.
    # 동등이 아니라 부분집합인 이유: marketplace 는 노출용이라 일부만 실을 수 있지만,
    # plugin.json 에 없는 키워드로 검색되면 잘못된 기대를 준다. description 처럼
    # 의도적으로 다른 필드까지 묶지 않도록 동등 검사는 쓰지 않는다.
    plugin_keywords = plugin_details.get("keywords")
    entry_keywords = marketplace_details.get("entry_keywords")
    if plugin_keywords is not None and entry_keywords is not None:
        extra = [k for k in entry_keywords if k not in set(plugin_keywords)]
        if extra:
            errors.append(
                "marketplace.plugins[0].keywords must be a subset of plugin keywords; "
                f"unknown: {sorted(extra)}"
            )

    return errors, plugin_details


def validate_plugin_manifest(repository_root=REPOSITORY_ROOT):
    """Return all plugin metadata contract violations for *repository_root*."""
    errors, _ = _load_and_validate(repository_root)
    return errors


def main():
    errors, plugin = _load_and_validate(REPOSITORY_ROOT)
    if errors:
        for error in errors:
            print("error: {}".format(error), file=sys.stderr)
        return 1
    print("plugin metadata valid: {} {}".format(plugin["name"], plugin["version"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
