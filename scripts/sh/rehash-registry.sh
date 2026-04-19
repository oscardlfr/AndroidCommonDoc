#!/usr/bin/env bash
set -euo pipefail

# rehash-registry.sh — Recompute SHA-256 hashes in skills/registry.json
#
# Ensures every entry's hash matches the actual file on disk.
# Exits 0 if all hashes are current (no changes), 1 if any were updated.
#
# Usage:
#   rehash-registry.sh [--project-root DIR] [--check] [--verbose]
#
# Options:
#   --project-root DIR   Project root (default: ANDROID_COMMON_DOC or script parent)
#   --check              Check-only mode — report stale hashes but don't fix (exit 1 if stale)
#   --verbose            Show per-entry status

TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
CHECK_ONLY=false
VERBOSE=false

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            echo "Usage: $0 [--project-root DIR] [--check] [--verbose]"
            exit 0
            ;;
        --project-root)
            TOOLKIT_ROOT="$2"
            shift 2
            ;;
        --check)
            CHECK_ONLY=true
            shift
            ;;
        --verbose)
            VERBOSE=true
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

REGISTRY="$TOOLKIT_ROOT/skills/registry.json"

if [[ ! -f "$REGISTRY" ]]; then
    echo '{"error":"registry not found","path":"'"$REGISTRY"'"}' >&2
    exit 2
fi

# Use python for JSON manipulation + hashing (available on all CI runners)
python3 - "$REGISTRY" "$TOOLKIT_ROOT" "$CHECK_ONLY" "$VERBOSE" << 'PYEOF'
import json, hashlib, sys, os

registry_path = sys.argv[1]
root = sys.argv[2]
check_only = sys.argv[3].lower() == "true"
verbose = sys.argv[4].lower() == "true"

with open(registry_path, 'r', encoding='utf-8') as f:
    reg = json.load(f)

entries = reg.get('skills', reg.get('entries', []))

updated = 0
current = 0
missing = 0
stale_list = []

for entry in entries:
    path = entry.get('path', '')
    old_hash = entry.get('hash', '')
    if not path:
        continue

    full_path = os.path.join(root, path)
    try:
        with open(full_path, 'rb') as f:
            content = f.read()
        # Normalize CRLF → LF before hashing for cross-platform consistency
        # (Windows working copies may have CRLF, CI/Linux has LF)
        content = content.replace(b'\r\n', b'\n')
        actual = 'sha256:' + hashlib.sha256(content).hexdigest()
    except FileNotFoundError:
        missing += 1
        if verbose:
            print(f"  [MISSING] {path}", file=sys.stderr)
        continue

    if actual == old_hash:
        current += 1
        if verbose:
            print(f"  [OK]      {path}", file=sys.stderr)
    else:
        stale_list.append(path)
        if not check_only:
            entry['hash'] = actual
        updated += 1
        if verbose:
            print(f"  [REHASH]  {path}", file=sys.stderr)

if not check_only and updated > 0:
    if 'skills' in reg:
        reg['skills'] = entries
    else:
        reg['entries'] = entries
    with open(registry_path, 'w', encoding='utf-8') as f:
        json.dump(reg, f, indent=2, ensure_ascii=False)
        f.write('\n')

# JSON output to stdout
result = {
    "updated": updated,
    "current": current,
    "missing": missing,
    "total": len(entries),
    "check_only": check_only,
}
if stale_list and check_only:
    result["stale"] = stale_list

print(json.dumps(result))

if check_only and updated > 0:
    sys.exit(1)
PYEOF
