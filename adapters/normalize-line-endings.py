#!/usr/bin/env python3
"""Normalize generated Markdown to repository-canonical LF bytes."""

from pathlib import Path
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: normalize-line-endings.py <generated-root>", file=sys.stderr)
        return 64

    root = Path(sys.argv[1])
    if not root.is_dir():
        print(f"Generated root is not a directory: {root}", file=sys.stderr)
        return 66

    normalized = 0
    for path in sorted(root.rglob("*.md")):
        data = path.read_bytes()
        canonical = data.replace(b"\r\n", b"\n")
        if canonical != data:
            path.write_bytes(canonical)
            normalized += 1

    print(f"Normalized generated Markdown line endings: {normalized} file(s).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
