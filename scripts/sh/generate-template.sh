#!/usr/bin/env bash
set -euo pipefail

# generate-template.sh — Agent template generator (Phase 3).
#
# Generates agent template `.md` files from
# `.claude/registry/agents.manifest.yaml`. Frontmatter is authored from
# manifest data; body is preserved verbatim. Mirrors at `.claude/agents/`
# stay byte-identical to source at `setup/agent-templates/`.
#
# Thin bash wrapper around the canonical TypeScript implementation at
# `mcp-server/src/cli/generate-template.ts`. The bash layer handles project
# discovery, build-on-demand, and audit log append; everything else lives in
# the TS lib so Vitest exercises the same codepath.
#
# Usage:
#   ./scripts/sh/generate-template.sh <agent-name> [PROJECT_ROOT] [options]
#   ./scripts/sh/generate-template.sh --all [PROJECT_ROOT] [options]
#
# Options:
#   --check                 Read-only; exit 1 if generated output != current file
#   --all                   Batch over every manifest entry
#   --update-manifest-hash  Compute SHA-256 + write to manifest in same pass
#   --format summary|json   Output format (default: summary)
#   --help, -h              Show this message
#
# Exit codes:
#   0 = success / no-op when target is aligned
#   1 = drift detected with --check (or any agent failed in --all)
#   2 = error (missing build, bad arguments, manifest unreadable, etc.)

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
SAW_AGENT_NAME=0
SAW_ALL=0
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
        --all)
            SAW_ALL=1
            PASSTHROUGH_ARGS+=("$1")
            shift
            ;;
        --check|--update-manifest-hash)
            PASSTHROUGH_ARGS+=("$1")
            shift
            ;;
        --format|--format=*)
            PASSTHROUGH_ARGS+=("$1")
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
            # First positional after --all is PROJECT_ROOT; otherwise first is
            # agent-name and second is PROJECT_ROOT.
            if [[ $SAW_ALL -eq 1 ]]; then
                if [[ -z "$PROJECT_ROOT_ARG" ]]; then
                    PROJECT_ROOT_ARG="$1"
                else
                    PASSTHROUGH_ARGS+=("$1")
                fi
            elif [[ $SAW_AGENT_NAME -eq 0 ]]; then
                PASSTHROUGH_ARGS+=("$1")
                SAW_AGENT_NAME=1
            elif [[ -z "$PROJECT_ROOT_ARG" ]]; then
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

CLI_JS="$PROJECT_ROOT/mcp-server/build/cli/generate-template.js"

# --- Build on demand ---
if [[ ! -f "$CLI_JS" ]]; then
    echo -e "${CYAN}info${RESET} build/cli/generate-template.js missing — running 'npm run build' in mcp-server" >&2
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

# --- Run generator ---
# Construct argv: TS CLI accepts `<agent-name> [PROJECT_ROOT]` OR `--all [PROJECT_ROOT]`.
# We append PROJECT_ROOT after passthrough args so the CLI's own positional
# parser picks it up correctly.
set +e
node "$CLI_JS" "${PASSTHROUGH_ARGS[@]+"${PASSTHROUGH_ARGS[@]}"}" "$PROJECT_ROOT"
EXIT_CODE=$?
set -e

# --- Audit log telemetry (best-effort) ---
case "$EXIT_CODE" in
    0) RESULT_STATUS="pass" ;;
    1) RESULT_STATUS="drift" ;;
    *) RESULT_STATUS="fail" ;;
esac

if type audit_append >/dev/null 2>&1; then
    audit_append "$PROJECT_ROOT" "generate-template" "$RESULT_STATUS" \
        "\"exit_code\":$EXIT_CODE" 2>/dev/null || true
fi

exit "$EXIT_CODE"
