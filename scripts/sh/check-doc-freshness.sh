#!/usr/bin/env bash
set -euo pipefail

# Checks doc freshness by comparing version references against versions-manifest.json.
#
# Lightweight CI script that reads versions-manifest.json and scans all docs/*.md
# files for version references in Library Versions headers. Compares each found
# version against the manifest and reports stale references.
#
# This is the fast CI path -- the full doc-code-drift-detector agent performs
# comprehensive drift detection, but this script only checks version staleness.
#
# Usage:
#   ./check-doc-freshness.sh [--project-root DIR]
#
# Examples:
#   ./check-doc-freshness.sh
#   ./check-doc-freshness.sh --project-root /path/to/AndroidCommonDoc

# --- Argument parsing ---
PROJECT_ROOT=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"
            shift 2
            ;;
        -h|--help)
            echo "Usage: $0 [--project-root DIR]"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# --- Resolve project root ---
if [[ -z "$PROJECT_ROOT" ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
fi

MANIFEST_PATH="$PROJECT_ROOT/versions-manifest.json"
DOCS_DIR="$PROJECT_ROOT/docs"

if [[ ! -f "$MANIFEST_PATH" ]]; then
    echo "ERROR: versions-manifest.json not found at: $MANIFEST_PATH" >&2
    exit 2
fi

if [[ ! -d "$DOCS_DIR" ]]; then
    echo "ERROR: docs/ directory not found at: $DOCS_DIR" >&2
    exit 2
fi

# --- Perform freshness check using python3 (adapter pattern from Phase 1) ---
# Single python3 call handles JSON parsing, version extraction, wildcard comparison,
# and output formatting. Avoids fragile bash regex on complex version strings.
python3 - "$MANIFEST_PATH" "$DOCS_DIR" <<'PYEOF'
import json, sys, os, re, glob

manifest_path = sys.argv[1]
docs_dir = sys.argv[2]

# Load manifest
with open(manifest_path) as f:
    manifest = json.load(f)
versions = manifest["versions"]

# Library name mapping: doc text (lowercased) -> manifest key
LIB_MAP = {
    "kotlin": "kotlin",
    "agp": "agp",
    "compose multiplatform": "compose-multiplatform",
    "compose desktop": "compose-multiplatform",
    "compose": "compose-multiplatform",
    "koin": "koin",
    "kotlinx-coroutines": "kotlinx-coroutines",
    "kotlinx-coroutines-test": "kotlinx-coroutines",
    "kover": "kover",
    "mockk": "mockk",
    "compose gradle plugin": "compose-gradle-plugin",
    "kmp gradle plugin": "kotlin",
    "detekt": "detekt",
    "compose-rules": "compose-rules",
}

def map_lib_name(name):
    """Map a library name from doc text to a manifest key."""
    lower = name.strip().lower()
    return LIB_MAP.get(lower)

def versions_match(doc_ver, manifest_ver):
    """Compare versions with wildcard support."""
    if "x" in manifest_ver:
        m_parts = manifest_ver.split(".")
        d_parts = doc_ver.split(".")
        for i, mp in enumerate(m_parts):
            if mp == "x":
                return True
            if i >= len(d_parts):
                return False
            if mp != d_parts[i]:
                return False
        return True
    return doc_ver == manifest_ver

# Regex to extract library-version pairs from a version line
# Matches: "LibName version" where version is like 1.2.3, 1.7.x, 2.0.0-alpha.2
# Handles trailing annotations like "(Android)" by stopping at the version
PAIR_RE = re.compile(r"([A-Za-z][A-Za-z0-9 -]*?)\s+(\d+\.\d+(?:\.[A-Za-z0-9._-]+)?)")

print("Doc Freshness Check")
print()

stale_count = 0
ok_count = 0

doc_files = sorted(glob.glob(os.path.join(docs_dir, "*.md")))

for doc_path in doc_files:
    rel_path = "docs/" + os.path.basename(doc_path)
    doc_stale = []

    with open(doc_path, encoding="utf-8") as f:
        for line in f:
            # Match the Library Versions header line
            m = re.match(r'^>\s*\*\*Library Versions\*\*:?\s*(.+)$', line)
            if not m:
                continue

            version_text = m.group(1)
            # Split by comma
            pairs = version_text.split(",")

            for pair in pairs:
                pair = pair.strip()
                pm = PAIR_RE.match(pair)
                if not pm:
                    continue

                lib_name = pm.group(1).strip()
                doc_version = pm.group(2).strip()

                manifest_key = map_lib_name(lib_name)
                if manifest_key is None:
                    continue
                if manifest_key not in versions:
                    continue

                manifest_version = versions[manifest_key]
                if not versions_match(doc_version, manifest_version):
                    doc_stale.append(f"{lib_name}: found {doc_version}, expected {manifest_version}")

    if doc_stale:
        for issue in doc_stale:
            print(f"[STALE] {rel_path} -- {issue}")
            stale_count += 1
    else:
        print(f"[OK] {rel_path} -- all versions current")
        ok_count += 1

print()
if stale_count == 0:
    print("Result: PASS (0 stale)")
    sys.exit(0)
else:
    print(f"Result: FAIL ({stale_count} stale)")
    sys.exit(1)
PYEOF
