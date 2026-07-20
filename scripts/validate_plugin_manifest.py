#!/usr/bin/env python3
"""Validate Claude plugin metadata without third-party dependencies."""

import json
import re
import sys
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
METADATA_DIRECTORY = ".claude-plugin"
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


def _load_json(path, label, errors):
    try:
        with path.open(encoding="utf-8") as stream:
            return json.load(stream)
    except FileNotFoundError:
        errors.append("{}: file not found".format(label))
    except json.JSONDecodeError as exc:
        errors.append(
            "{}: invalid JSON at line {}, column {}".format(
                label, exc.lineno, exc.colno
            )
        )
    except (OSError, UnicodeError) as exc:
        errors.append("{}: could not read ({})".format(label, exc))
    return LOAD_FAILED


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
