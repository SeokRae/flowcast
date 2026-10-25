#!/usr/bin/env python3
# count.py TRACE...: per-phase call counts from an ftrace function trace split by "phase NAME" markers.
# A row is: phase, who (main = the probe, which writes the markers; child = the forked writer), function<-caller, count.
# Fails if the ring buffer lost entries (entries-in-buffer != entries-written).
import re
import sys
from collections import Counter

LINE = re.compile(r"^\s*(?P<comm>.+?)-(?P<pid>\d+)\s+\[\d+\]\s+\S+\s+[\d.]+:\s+(?P<what>.*)$")
HEAD = re.compile(r"entries-in-buffer/entries-written:\s+(\d+)/(\d+)")


def count(path):
    phases, rows, main = [], {}, None
    phase = "start"
    for line in open(path, encoding="utf-8"):
        m = HEAD.search(line)
        if m and m.group(1) != m.group(2):
            sys.exit(f"{path}: lost entries {m.group(1)}/{m.group(2)}")
        if line.startswith("#"):
            continue
        m = LINE.match(line)
        if not m:
            continue
        what = m.group("what")
        if what.startswith("tracing_mark_write: phase "):
            phase = what.split("phase ", 1)[1].strip()
            main = main or m.group("pid")
            phases.append(phase)
            rows.setdefault(phase, Counter())
            continue
        who = "main" if m.group("pid") == main else "child"
        fn = what.replace(" ", "")
        rows.setdefault(phase, Counter())[(who, fn)] += 1
    return phases, rows


for path in sys.argv[1:]:
    phases, rows = count(path)
    print(f"# {path.rsplit('/', 1)[-1]}")
    for phase in phases:
        for (who, fn), n in sorted(rows[phase].items()):
            print(f"{phase:14} {who:5} {fn:44} {n}")
        if not rows[phase]:
            print(f"{phase:14} -     (none)                                       0")
