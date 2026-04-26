#!/usr/bin/env bash
set -euo pipefail

# validate-manifest.sh — Agents-manifest drift validator (Phase 2).
#
# Compares `.claude/registry/agents.manifest.yaml` against agent template
# frontmatter in `setup/agent-templates/` and the mirror copies in
# `.claude/agents/`. Surfaces drift as findings; exits 0 in WARN mode (the
# Phase 2 default), exits 1 in --strict mode if errors are present.
#
# Thin bash wrapper around the canonical TypeScript implementation at
# `mcp-server/src/cli/validate-manifest.ts`. The bash layer handles project
# discovery, build-on-demand, and audit log append; everything else lives in
# the TS lib so Vitest exercises the same codepath.
#
# Usage:
#   ./scripts/sh/validate-manifest.sh [PROJECT_ROOT] [options]
#
# Options:
#   --strict             Exit 1 if findings present (Phase 4 default)
#   --format summary|json   Output format (default: summary)
#   --help, -h           Show this message
#
# Exit codes:
#   0 = no findings, OR findings present in WARN mode (default)
#   1 = findings present AND --strict was passed
#   2 = error (missing build, bad arguments, manifest unreadable, etc.)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/audit-append.sh" 2>/dev/null || true

# --- Color helpers ---
if [[ -t 1 ]]; then
    RED='\033[31m'
    GREEN='\033[32m'
    YELLOW='\033[33m'
    CYAN='\033[36m'
    RESET='\033[0m'
else
    RED='' GREEN='' YELLOW='' CYAN='' RESET=''
fi

# --- Locate project root ---
# Default: walk up from script dir to find the toolkit root (contains
# `mcp-server/package.json`). Override via first positional arg.
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
            grep -E "^# " "$0" | sed -e 's/^# //' -e 's/^#//' | head -30
            exit 0
            ;;
        --strict|--format|--format=*)
            PASSTHROUGH_ARGS+=("$1")
            # --format takes a value when not in --format=value form
            if [[ "$1" == "--format" && -n "${2:-}" ]]; then
                PASSTHROUGH_ARGS+=("$2")
                shift
            fi
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

CLI_JS="$PROJECT_ROOT/mcp-server/build/cli/validate-manifest.js"

# --- Build on demand ---
if [[ ! -f "$CLI_JS" ]]; then
    echo -e "${CYAN}info${RESET} build/cli/validate-manifest.js missing — running 'npm run build' in mcp-server" >&2
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
    audit_append "$PROJECT_ROOT" "validate-manifest" "$RESULT_STATUS" \
        "\"exit_code\":$EXIT_CODE" 2>/dev/null || true
fi

exit "$EXIT_CODE"
