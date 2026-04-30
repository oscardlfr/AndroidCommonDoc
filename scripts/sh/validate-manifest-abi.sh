#!/usr/bin/env bash
set -euo pipefail

# validate-manifest-abi.sh — Manifest ABI/API stability diff (BL-W31.7-11).
#
# Diffs `.claude/registry/agents.manifest.yaml` against a baseline (default
# git ref `develop`) and classifies each change as
# BREAKING | ADDITIVE | NEUTRAL. WARN-mode by default; `--strict` exits 1
# when BREAKING is present (Phase-4-ready, not yet wired as a gate).
#
# Thin bash wrapper around the canonical TypeScript implementation at
# `mcp-server/src/cli/validate-manifest-abi.ts`. The bash layer handles
# project discovery, build-on-demand, and audit log append; everything
# else lives in the TS lib so Vitest exercises the same codepath.
#
# Usage:
#   ./scripts/sh/validate-manifest-abi.sh [PROJECT_ROOT] [options]
#
# Options:
#   --baseline-ref <ref>     Git ref to compare against (default: develop)
#   --baseline-file <path>   YAML file path; overrides --baseline-ref
#   --format summary|json    Output format (default: summary)
#   --strict                 Exit 1 if BREAKING present (default WARN mode)
#   --include-neutral        Include NEUTRAL changes in output
#   --help, -h               Show this message
#
# Exit codes:
#   0 = no BREAKING (or WARN mode)
#   1 = BREAKING present AND --strict was passed
#   2 = error (missing build, bad arguments, baseline unreadable, etc.)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/audit-append.sh" 2>/dev/null || true

# --- Color helpers ---
if [[ -t 1 ]]; then
    RED='\033[31m'
    CYAN='\033[36m'
    RESET='\033[0m'
else
    RED='' CYAN='' RESET=''
fi

# --- Locate project root ---
detect_project_root() {
    local candidate="$1"
    if [[ -n "$candidate" && -d "$candidate" && -f "$candidate/mcp-server/package.json" ]]; then
        (cd "$candidate" && pwd)
        return 0
    fi
    local dir
    dir="$(cd "$SCRIPT_DIR/../.." && pwd)"
    while [[ "$dir" != "/" ]]; do
        if [[ -f "$dir/mcp-server/package.json" ]]; then
            echo "$dir"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    return 1
}

# --- Parse args ---
PROJECT_ROOT_ARG=""
PASSTHROUGH_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --help|-h)
            grep -E "^# " "$0" | sed -e 's/^# //' -e 's/^#//' | head -40
            exit 0
            ;;
        --project-root)
            PROJECT_ROOT_ARG="$2"
            shift 2
            ;;
        --project-root=*)
            PROJECT_ROOT_ARG="${1#--project-root=}"
            shift
            ;;
        --baseline-ref|--baseline-file|--format)
            PASSTHROUGH_ARGS+=("$1")
            if [[ -n "${2:-}" ]]; then
                PASSTHROUGH_ARGS+=("$2")
                shift
            fi
            shift
            ;;
        --baseline-ref=*|--baseline-file=*|--format=*|--strict|--include-neutral)
            PASSTHROUGH_ARGS+=("$1")
            shift
            ;;
        --*)
            PASSTHROUGH_ARGS+=("$1")
            shift
            ;;
        *)
            if [[ -z "$PROJECT_ROOT_ARG" ]]; then
                PROJECT_ROOT_ARG="$1"
            else
                PASSTHROUGH_ARGS+=("$1")
            fi
            shift
            ;;
    esac
done

PROJECT_ROOT="$(detect_project_root "$PROJECT_ROOT_ARG" || true)"
if [[ -z "$PROJECT_ROOT" ]]; then
    echo -e "${RED}ERROR${RESET} cannot locate project root (no mcp-server/package.json found)" >&2
    exit 2
fi

CLI_JS="$PROJECT_ROOT/mcp-server/build/cli/validate-manifest-abi.js"

# --- Build on demand ---
if [[ ! -f "$CLI_JS" ]]; then
    echo -e "${CYAN}info${RESET} build/cli/validate-manifest-abi.js missing — running 'npm run build' in mcp-server" >&2
    if ! (cd "$PROJECT_ROOT/mcp-server" && npm run build --silent >/dev/null 2>&1); then
        echo -e "${RED}ERROR${RESET} mcp-server build failed; run 'cd mcp-server && npm run build' to debug" >&2
        exit 2
    fi
fi

# --- Locate node ---
if ! command -v node >/dev/null 2>&1; then
    echo -e "${RED}ERROR${RESET} node not on PATH" >&2
    exit 2
fi

# --- Run validator ---
set +e
node "$CLI_JS" "$PROJECT_ROOT" "${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}"
EXIT_CODE=$?
set -e

# --- Audit log telemetry (best-effort) ---
case "$EXIT_CODE" in
    0) RESULT_STATUS="pass" ;;
    1) RESULT_STATUS="warn" ;;
    *) RESULT_STATUS="fail" ;;
esac

if type audit_append >/dev/null 2>&1; then
    audit_append "$PROJECT_ROOT" "validate-manifest-abi" "$RESULT_STATUS" \
        "\"exit_code\":$EXIT_CODE" 2>/dev/null || true
fi

exit "$EXIT_CODE"
