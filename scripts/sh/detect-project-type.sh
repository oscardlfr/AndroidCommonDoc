#!/usr/bin/env bash
set -euo pipefail

# detect-project-type.sh — Classify a project root as node | gradle | hybrid | unknown.
#
# Reads file presence in the target directory to deterministically classify
# project type. Used by quality-gater (BL-W31.7-10) and any other agent that
# needs to gate verification steps on toolchain.
#
# Detection rules:
#   - settings.gradle.kts OR settings.gradle at ROOT -> Gradle present
#   - package.json at ROOT OR any depth-1 subdirectory -> Node present
#     (catches monorepos with package.json under mcp-server/, web/, etc.)
#   - Both -> hybrid
#   - Gradle only -> gradle
#   - Node only -> node
#   - Neither -> unknown
#
# Usage:
#   detect-project-type.sh                      # uses $PWD
#   detect-project-type.sh --root /path/to/proj # uses given path
#   detect-project-type.sh --help               # show this header
#
# Exit codes:
#   0 = always (callers decide what to do with "unknown")
#   2 = bad arguments / unreadable root
#
# Output: single line on stdout — one of: node, gradle, hybrid, unknown

ROOT="$PWD"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            grep -E "^# " "$0" | sed -e 's/^# //' -e 's/^#//' | head -30
            exit 0
            ;;
        --root)
            ROOT="$2"
            shift 2
            ;;
        --root=*)
            ROOT="${1#--root=}"
            shift
            ;;
        *)
            echo "Unknown option: $1" >&2
            exit 2
            ;;
    esac
done

if [[ ! -d "$ROOT" ]]; then
    echo "ERROR: root is not a directory: $ROOT" >&2
    exit 2
fi

# Resolve symlinks so callers can pass either a real path or a link.
ROOT="$(cd "$ROOT" 2>/dev/null && pwd -P)" || {
    echo "ERROR: cannot resolve root: $ROOT" >&2
    exit 2
}

HAS_GRADLE=0
HAS_NODE=0

if [[ -f "$ROOT/settings.gradle.kts" || -f "$ROOT/settings.gradle" ]]; then
    HAS_GRADLE=1
fi

if [[ -f "$ROOT/package.json" ]]; then
    HAS_NODE=1
else
    # Depth-1 search: catches monorepos with package.json under
    # mcp-server/, web/, packages/, etc. We do not recurse deeper to avoid
    # false positives from node_modules or build outputs.
    for sub in "$ROOT"/*/; do
        [[ -d "$sub" ]] || continue
        case "$sub" in
            */node_modules/|*/build/|*/.git/|*/dist/|*/out/|*/target/) continue ;;
        esac
        if [[ -f "$sub/package.json" ]]; then
            HAS_NODE=1
            break
        fi
    done
fi

if [[ $HAS_GRADLE -eq 1 && $HAS_NODE -eq 1 ]]; then
    echo "hybrid"
elif [[ $HAS_GRADLE -eq 1 ]]; then
    echo "gradle"
elif [[ $HAS_NODE -eq 1 ]]; then
    echo "node"
else
    echo "unknown"
fi
