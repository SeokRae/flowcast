#!/usr/bin/env python3
"""Validate a flowcast router manifest before drawer fan-out."""

import json
import os
import re
import sys


ALLOWED_VIEWS = frozenset(("sequence", "topology", "component"))
SAFE_KEBAB = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REQUIRED_UNIT_FIELDS = (
    "unit_id",
    "system",
    "source_ref",
    "name",
    "view",
    "title",
    "data",
    "ambiguous",
    "view_candidates",
    "notes",
    "pair_id",
    "segment_numbers",
)


def _is_non_empty_string(value):
    return isinstance(value, str) and bool(value.strip())


def _validate_string_list(value, path, errors):
    if not isinstance(value, list):
        errors.append("{}: expected a list of strings".format(path))
        return
    for index, item in enumerate(value):
        if not isinstance(item, str):
            errors.append("{}[{}]: expected a string".format(path, index))


def _validate_view_candidates(value, path, errors):
    if not isinstance(value, list):
        errors.append("{}: expected a list of {{view, reason}} objects".format(path))
        return
    for index, candidate in enumerate(value):
        candidate_path = "{}[{}]".format(path, index)
        if not isinstance(candidate, dict):
            errors.append("{}: expected an object with view and reason".format(candidate_path))
            continue
        candidate_view = candidate.get("view")
        if not isinstance(candidate_view, str) or candidate_view not in ALLOWED_VIEWS:
            errors.append(
                "{}.view: expected one of sequence, topology, component".format(
                    candidate_path
                )
            )
        if not _is_non_empty_string(candidate.get("reason")):
            errors.append("{}.reason: expected a non-empty string".format(candidate_path))


def _canonical_segment_number(value):
    if isinstance(value, int) and not isinstance(value, bool):
        return str(value)
    if isinstance(value, str):
        normalized = value.strip()
        return normalized or None
    return None


def _canonical_segment_numbers(values):
    if not isinstance(values, list):
        return None
    canonical = [_canonical_segment_number(value) for value in values]
    if any(value is None for value in canonical):
        return None
    return canonical


def _validate_segment_numbers(value, path, errors):
    if not isinstance(value, list):
        errors.append("{}: expected a list of unique integer/string scalars".format(path))
        return

    seen = set()
    for index, segment_number in enumerate(value):
        canonical = _canonical_segment_number(segment_number)
        if canonical is None:
            if isinstance(segment_number, str):
                errors.append(
                    "{}[{}]: expected a non-empty string after stripping whitespace".format(
                        path, index
                    )
                )
                continue
            errors.append(
                "{}[{}]: expected an integer or string scalar".format(path, index)
            )
            continue
        if canonical in seen:
            errors.append("{}: duplicate visible value {!r}".format(path, canonical))
        else:
            seen.add(canonical)


def _validate_data(value, path, errors):
    if isinstance(value, str):
        if not value.strip():
            errors.append("{}: expected non-empty data".format(path))
        return
    if isinstance(value, (list, dict)):
        if not value:
            errors.append("{}: expected non-empty data".format(path))
        return
    errors.append("{}: expected non-empty string, array, or object data".format(path))


def _candidate_reason_summary(candidates):
    if not isinstance(candidates, list):
        return "no candidate reasons provided"
    summaries = []
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        reason = candidate.get("reason")
        if not _is_non_empty_string(reason):
            continue
        view = candidate.get("view")
        if isinstance(view, str):
            summaries.append("{}: {}".format(view, reason.strip()))
        else:
            summaries.append(reason.strip())
    return "; ".join(summaries) or "no candidate reasons provided"


def _validate_unit(unit, index, errors):
    path = "manifest.units[{}]".format(index)
    if not isinstance(unit, dict):
        errors.append("{}: expected a JSON object".format(path))
        return False

    for field in REQUIRED_UNIT_FIELDS:
        if field not in unit:
            errors.append("{}.{}: required field is missing".format(path, field))

    for field in ("unit_id", "system", "source_ref", "title"):
        if field in unit and not _is_non_empty_string(unit[field]):
            errors.append("{}.{}: expected a non-empty string".format(path, field))

    if "name" in unit:
        name = unit["name"]
        if not isinstance(name, str) or SAFE_KEBAB.fullmatch(name) is None:
            errors.append("{}.name: expected a safe kebab-case name".format(path))

    if "view" in unit:
        view = unit["view"]
        if not isinstance(view, str) or view not in ALLOWED_VIEWS:
            errors.append(
                "{}.view: expected one of sequence, topology, component".format(path)
            )

    if "data" in unit:
        _validate_data(unit["data"], "{}.data".format(path), errors)

    if "view_candidates" in unit:
        _validate_view_candidates(
            unit["view_candidates"], "{}.view_candidates".format(path), errors
        )

    if "ambiguous" in unit:
        ambiguous = unit["ambiguous"]
        if not isinstance(ambiguous, bool):
            errors.append("{}.ambiguous: expected boolean false".format(path))
        elif ambiguous:
            reasons = _candidate_reason_summary(unit.get("view_candidates"))
            errors.append(
                "{}.ambiguous: must be false before preflight; candidates: {}".format(
                    path, reasons
                )
            )

    if "notes" in unit:
        _validate_string_list(unit["notes"], "{}.notes".format(path), errors)

    if "pair_id" in unit:
        pair_id = unit["pair_id"]
        if pair_id is not None and (
            not isinstance(pair_id, str) or SAFE_KEBAB.fullmatch(pair_id) is None
        ):
            errors.append("{}.pair_id: expected null or a safe kebab string".format(path))

    if "segment_numbers" in unit:
        _validate_segment_numbers(
            unit["segment_numbers"], "{}.segment_numbers".format(path), errors
        )
    return True


def _validate_unique_fields(units, errors):
    for field in ("unit_id", "name"):
        seen = {}
        for index, unit in enumerate(units):
            if not isinstance(unit, dict):
                continue
            value = unit.get(field)
            if not isinstance(value, str):
                continue
            if value in seen:
                errors.append(
                    "manifest.units[{}].{}: duplicate {} {!r}; first used at index {}".format(
                        index, field, field, value, seen[value]
                    )
                )
            else:
                seen[value] = index


def _validate_pairs(units, errors):
    pairs = {}
    for index, unit in enumerate(units):
        if not isinstance(unit, dict):
            continue
        pair_id = unit.get("pair_id")
        if (
            isinstance(pair_id, str)
            and SAFE_KEBAB.fullmatch(pair_id) is not None
        ):
            pairs.setdefault(pair_id, []).append((index, unit))

    for pair_id, members in pairs.items():
        views = [member.get("view") for _, member in members]
        if (
            len(members) != 2
            or views.count("sequence") != 1
            or views.count("topology") != 1
        ):
            errors.append(
                "pair_id {!r}: expected exactly one sequence and one topology unit".format(
                    pair_id
                )
            )

        segment_lists = [member.get("segment_numbers") for _, member in members]
        if not segment_lists or any(
            not isinstance(numbers, list) or not numbers
            for numbers in segment_lists
        ):
            errors.append(
                "pair_id {!r}: segment_numbers must be non-empty".format(pair_id)
            )
        else:
            canonical_lists = [
                _canonical_segment_numbers(numbers) for numbers in segment_lists
            ]
            if None not in canonical_lists and any(
                numbers != canonical_lists[0] for numbers in canonical_lists[1:]
            ):
                errors.append(
                    "pair_id {!r}: segment_numbers must be identical".format(pair_id)
                )


def validate_manifest(manifest):
    """Return manifest contract violations without raising for malformed input."""
    if not isinstance(manifest, dict):
        return ["manifest: expected a JSON object"]

    errors = []
    if manifest.get("schema_version") != "1.0":
        errors.append("manifest.schema_version: expected '1.0'")

    out_dir = manifest.get("out_dir")
    if (
        not isinstance(out_dir, str)
        or not out_dir.strip()
        or not os.path.isabs(out_dir)
    ):
        errors.append("manifest.out_dir: expected an absolute path")

    if "notes" in manifest:
        _validate_string_list(manifest["notes"], "manifest.notes", errors)

    units = manifest.get("units")
    if not isinstance(units, list) or not units:
        errors.append("manifest.units: expected a non-empty array")
        return errors

    for index, unit in enumerate(units):
        _validate_unit(unit, index, errors)
    _validate_unique_fields(units, errors)
    _validate_pairs(units, errors)
    return errors


def validate_manifest_file(path):
    """Load *path* and return all readable JSON and manifest validation errors."""
    try:
        with open(path, "r", encoding="utf-8") as stream:
            manifest = json.load(stream)
    except (OSError, TypeError, UnicodeError) as exc:
        return ["could not read manifest: {}".format(exc)]
    except json.JSONDecodeError as exc:
        return ["invalid JSON: {}".format(exc)]
    except ValueError as exc:
        return ["invalid JSON/numeric value: {}".format(exc)]
    return validate_manifest(manifest)


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    if len(arguments) != 1:
        print("usage: validate_manifest.py PATH", file=sys.stderr)
        return 1

    errors = validate_manifest_file(arguments[0])
    if errors:
        for error in errors:
            print("error: {}".format(error), file=sys.stderr)
        return 1

    print("Manifest valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
