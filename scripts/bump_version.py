#!/usr/bin/env python3
"""
Nexus Desk OS Semantic Version Helper
=================================
Reads and updates the canonical root VERSION file (`MAJOR.MINOR.PATCH`),
optionally rebuilding the frontend bundle to stamp the updated version.

Usage:
    python3 scripts/bump_version.py                # Print current version & build ID
    python3 scripts/bump_version.py --patch        # Bump PATCH (e.g. 2.0.0 -> 2.0.1)
    python3 scripts/bump_version.py --minor        # Bump MINOR (e.g. 2.0.0 -> 2.1.0)
    python3 scripts/bump_version.py --major        # Bump MAJOR (e.g. 2.0.0 -> 3.0.0)
    python3 scripts/bump_version.py --set 2.1.0    # Set explicit SemVer
    python3 scripts/bump_version.py --patch --build # Bump and rebuild frontend/dist/index.html
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT_DIR = Path(__file__).resolve().parent.parent
VERSION_FILE = ROOT_DIR / "VERSION"
BUILD_INFO_FILE = ROOT_DIR / "frontend" / ".build_version.json"
SEMVER_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)$")


def read_version() -> str:
    if not VERSION_FILE.exists():
        return "2.0.0"
    return VERSION_FILE.read_text(encoding="utf-8").strip()


def read_build_id() -> str:
    if not BUILD_INFO_FILE.exists():
        return "dev"
    try:
        data = json.loads(BUILD_INFO_FILE.read_text(encoding="utf-8"))
        return f"{data.get('date', 'unknown')}-{int(data.get('batch', 0)):02d}"
    except Exception:
        return "dev"


def main() -> int:
    parser = argparse.ArgumentParser(description="Nexus Desk OS Semantic Version Manager")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--major", action="store_true", help="Increment MAJOR version")
    group.add_argument("--minor", action="store_true", help="Increment MINOR version")
    group.add_argument("--patch", action="store_true", help="Increment PATCH version")
    group.add_argument("--set", metavar="X.Y.Z", help="Set explicit semantic version")
    parser.add_argument("--build", action="store_true", help="Rebuild frontend bundle after updating VERSION")
    args = parser.parse_args()

    current = read_version()
    m = SEMVER_RE.match(current)
    if not m:
        print(f"Error: VERSION file contains invalid SemVer: {current!r}", file=sys.stderr)
        return 1

    major, minor, patch = map(int, m.groups())
    if args.major:
        new_ver = f"{major + 1}.0.0"
    elif args.minor:
        new_ver = f"{major}.{minor + 1}.0"
    elif args.patch:
        new_ver = f"{major}.{minor}.{patch + 1}"
    elif args.set:
        if not SEMVER_RE.match(args.set.strip()):
            print(f"Error: Invalid SemVer '{args.set}'. Expected MAJOR.MINOR.PATCH.", file=sys.stderr)
            return 1
        new_ver = args.set.strip()
    else:
        print(f"Nexus Desk OS v{current} (Build {read_build_id()})")
        return 0

    VERSION_FILE.write_text(f"{new_ver}\n", encoding="utf-8")
    print(f"Updated VERSION: {current} -> {new_ver}")

    if args.build:
        res = subprocess.run([sys.executable, str(ROOT_DIR / "frontend" / "build.py")], cwd=ROOT_DIR)
        return res.returncode
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
