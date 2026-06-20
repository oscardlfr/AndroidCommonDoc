#!/usr/bin/env bash
set -euo pipefail

# qg-doc-validators.sh — QG doc-coverage validator (wave qg-doc-coverage).
#
# Runs two subchecks and writes a combined JSON report under
# <project-root>/.androidcommondoc/doc-validator-report.json:
#
#   cross_refs      — replicates the CI doc-cross-refs job exactly:
#                     (a) resolve relative links in docs/agents/*.md
#                     (b) check required frontmatter in docs/*/*.md
#
#   doc_structure_vitest — runs the mcp-server vitest integration test
#                          tests/integration/doc-structure.test.ts; gracefully
#                          degrades (SKIP) when mcp-server is absent (L1/L2 use).
#
# Usage:
#   qg-doc-validators.sh [--project-root <path>] [--toolkit-root <path>]
#                        [--only cross-refs|structure|all]
#                        [--output-format json|human]
#
# Options:
#   --project-root    Root of the project to validate (default: $PWD)
#   --toolkit-root    Root of the L0 toolkit with mcp-server/ (default: ${ANDROID_COMMON_DOC:-$PWD})
#   --only            Which subcheck(s) to run: cross-refs | structure | all (default: all)
#   --output-format   Output format: json | human (default: human)
#   --help, -h        Show this help and exit 0
#
# Exit codes:
#   0 = all executed subchecks PASS (or SKIP)
#   1 = bad arguments / usage error
#   2 = one or more subchecks FAIL

usage() {
    cat <<'EOF'
Usage: qg-doc-validators.sh [OPTIONS]

Options:
  --project-root <path>      Project root to validate (default: $PWD)
  --toolkit-root <path>      L0 toolkit root with mcp-server/ (default: ${ANDROID_COMMON_DOC:-$PWD})
  --only cross-refs|structure|all  Subchecks to run (default: all)
  --output-format json|human       Output format (default: human)
  --help, -h                 Show this help

Exit codes:
  0  All executed subchecks PASS or SKIP
  1  Bad arguments
  2  One or more subchecks FAIL
EOF
    exit 0
}

# ── Arg parsing ───────────────────────────────────────────────────────────────

PROJECT_ROOT="${PWD}"
TOOLKIT_ROOT="${ANDROID_COMMON_DOC:-${PWD}}"
ONLY="all"
OUTPUT_FORMAT="human"

while [[ $# -gt 0 ]]; do
    case "$1" in
        --project-root)
            PROJECT_ROOT="$2"; shift 2 ;;
        --toolkit-root)
            TOOLKIT_ROOT="$2"; shift 2 ;;
        --only)
            ONLY="$2"; shift 2 ;;
        --output-format)
            OUTPUT_FORMAT="$2"; shift 2 ;;
        --help|-h)
            usage ;;
        *)
            echo "[qg-doc-validators] ERROR: unknown argument: $1" >&2
            echo "Run with --help for usage." >&2
            exit 1 ;;
    esac
done

# Validate --only value
case "$ONLY" in
    cross-refs|structure|all) ;;
    *)
        echo "[qg-doc-validators] ERROR: --only must be cross-refs, structure, or all" >&2
        exit 1 ;;
esac

# Validate --output-format value
case "$OUTPUT_FORMAT" in
    json|human) ;;
    *)
        echo "[qg-doc-validators] ERROR: --output-format must be json or human" >&2
        exit 1 ;;
esac

# ── Helpers ───────────────────────────────────────────────────────────────────

HEAD_SHA="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || echo "unknown")"
SELF="$(basename "$0")"

# Ensure report dir exists
REPORT_DIR="${PROJECT_ROOT}/.androidcommondoc"
mkdir -p "$REPORT_DIR"
REPORT_FILE="${REPORT_DIR}/doc-validator-report.json"

# ── Subcheck A: cross_refs ────────────────────────────────────────────────────
# Replicates the CI doc-cross-refs job verbatim (two run: blocks from
# .github/workflows/drift-audit.yml, relative to --project-root).

run_cross_refs() {
    local status="PASS"
    local summary=""
    local cross_fail=0
    local fm_fail=0

    # --- Block 1: relative links in docs/agents/*.md ---
    local link_fail=0
    for doc in "${PROJECT_ROOT}"/docs/agents/*.md; do
        [ -f "$doc" ] || continue
        dir=$(dirname "$doc")
        LINKS=$(grep -oE '\[[^]]+\]\(([^)]+\.md[^)]*)\)' "$doc" \
            | grep -oE '\([^)]+\)' | tr -d '()\r' || true)
        for link in $LINKS; do
            path="${link%%#*}"
            [ -z "$path" ] && continue
            echo "$path" | grep -qE '^https?://' && continue
            target="$dir/$path"
            if [ ! -f "$target" ] && [ ! -f "$path" ]; then
                echo "❌ $doc references missing file: $link" >&2
                link_fail=1
            fi
        done
    done

    if [ "$link_fail" -eq 0 ]; then
        echo "✅ All docs/agents/ cross-references resolve" >&2
    else
        cross_fail=1
    fi

    # --- Block 2: frontmatter completeness in docs/*/*.md ---
    local fm_fail=0
    for f in "${PROJECT_ROOT}"/docs/*/*.md; do
        [ -f "$f" ] || continue
        case "$f" in
            *hub.md) continue ;;
            "${PROJECT_ROOT}"/docs/archive/*) continue ;;
        esac
        fm=$(awk '/^---$/{c++; next} c==1' "$f" 2>/dev/null)
        for k in scope sources targets slug; do
            if ! echo "$fm" | grep -qE "^$k:"; then
                echo "❌ $f: missing frontmatter field '$k'" >&2
                fm_fail=1
            fi
        done
    done

    if [ "$fm_fail" -eq 0 ]; then
        echo "✅ All active docs have required frontmatter" >&2
    fi

    if [ "$cross_fail" -ne 0 ] || [ "$fm_fail" -ne 0 ]; then
        status="FAIL"
        summary="cross-refs or frontmatter check failed — see stderr for details"
    else
        summary="all docs/agents/ cross-references resolve; all active docs have required frontmatter"
    fi

    echo "${status}|${summary}"
}

# ── Subcheck B: doc_structure_vitest ─────────────────────────────────────────

run_doc_structure_vitest() {
    local mcp_dir="${TOOLKIT_ROOT}/mcp-server"

    # Graceful degrade: if mcp-server is absent or has no package.json, SKIP
    if [ ! -d "$mcp_dir" ] || [ ! -f "$mcp_dir/package.json" ]; then
        echo "SKIP|mcp-server not found at ${mcp_dir} — skipping doc-structure vitest (L1/L2 consumer)"
        return 0
    fi

    local vitest_out
    vitest_out=$(cd "$mcp_dir" && npx vitest run tests/integration/doc-structure.test.ts 2>&1) || {
        echo "FAIL|doc-structure vitest exited non-zero: $(echo "$vitest_out" | tail -5 | tr '\n' ' ')"
        return 0
    }
    echo "PASS|doc-structure vitest passed"
}

# ── Run subchecks ─────────────────────────────────────────────────────────────

CROSS_STATUS="SKIP"
CROSS_SUMMARY="not-run"
STRUCT_STATUS="SKIP"
STRUCT_SUMMARY="not-run"

if [[ "$ONLY" == "cross-refs" || "$ONLY" == "all" ]]; then
    result="$(run_cross_refs)"
    CROSS_STATUS="${result%%|*}"
    CROSS_SUMMARY="${result#*|}"
fi

if [[ "$ONLY" == "structure" || "$ONLY" == "all" ]]; then
    result="$(run_doc_structure_vitest)"
    STRUCT_STATUS="${result%%|*}"
    STRUCT_SUMMARY="${result#*|}"
fi

# Top-level result: FAIL if either subcheck FAILs (SKIP is not FAIL)
TOP_RESULT="PASS"
if [[ "$CROSS_STATUS" == "FAIL" || "$STRUCT_STATUS" == "FAIL" ]]; then
    TOP_RESULT="FAIL"
fi

TOP_SUMMARY="cross_refs=${CROSS_STATUS} doc_structure_vitest=${STRUCT_STATUS}"

# ── Write combined JSON report ────────────────────────────────────────────────

cat > "$REPORT_FILE" <<EOF
{
  "step": "doc-validator-parity",
  "ran": true,
  "result": "${TOP_RESULT}",
  "head": "${HEAD_SHA}",
  "command": "${SELF}",
  "summary": "${TOP_SUMMARY}",
  "subchecks": {
    "cross_refs": {
      "status": "${CROSS_STATUS}",
      "head": "${HEAD_SHA}",
      "command": "${SELF} --only cross-refs",
      "summary": "${CROSS_SUMMARY}"
    },
    "doc_structure_vitest": {
      "status": "${STRUCT_STATUS}",
      "head": "${HEAD_SHA}",
      "command": "${SELF} --only structure",
      "summary": "${STRUCT_SUMMARY}"
    }
  }
}
EOF

# ── Human-readable summary ────────────────────────────────────────────────────

if [[ "$OUTPUT_FORMAT" == "human" ]]; then
    echo ""
    echo "doc-validator-parity result: ${TOP_RESULT}"
    echo "  cross_refs:            ${CROSS_STATUS} — ${CROSS_SUMMARY}"
    echo "  doc_structure_vitest:  ${STRUCT_STATUS} — ${STRUCT_SUMMARY}"
    echo "Report written: ${REPORT_FILE}"
fi

# ── Exit code ─────────────────────────────────────────────────────────────────

if [[ "$TOP_RESULT" == "FAIL" ]]; then
    exit 2
fi
exit 0
