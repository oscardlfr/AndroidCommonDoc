#!/usr/bin/env bash
# findings-append.sh — Append structured findings to findings-log.jsonl
#
# Usage:
#   source "$SCRIPT_DIR/lib/findings-append.sh"
#   findings_append "$PROJECT_ROOT" "$RUN_ID" '{"severity":"HIGH","category":"code-quality","check":"cancellation-exception-swallowed","title":"CancellationException swallowed","file":"core/data/src/commonMain/kotlin/SomeRepo.kt","line":42}'
#
# The findings log lives at: <project>/.androidcommondoc/findings-log.jsonl
# Recommended .gitattributes: .androidcommondoc/findings-log.jsonl merge=union
#
# This function is intentionally minimal — one echo, no subshells beyond git/date.
# The agent NEVER reads this file; only the MCP findings-report tool aggregates it.

findings_append() {
    local project_root="$1"
    local run_id="$2"
    local finding_json="$3"  # Pre-formatted AuditFinding JSON object

    local audit_dir="$project_root/.androidcommondoc"
    local log_file="$audit_dir/findings-log.jsonl"

    mkdir -p "$audit_dir" 2>/dev/null || return 0

    local ts
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "unknown")"

    local branch=""
    branch="$(git -C "$project_root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"

    local commit=""
    commit="$(git -C "$project_root" rev-parse --short HEAD 2>/dev/null || echo "")"

    local line='{"ts":"'"$ts"'","run_id":"'"$run_id"'","commit":"'"$commit"'","branch":"'"$branch"'","finding":'"$finding_json"'}'
    echo "$line" >> "$log_file"
}

# Bulk append: reads findings from stdin (one JSON per line)
findings_append_bulk() {
    local project_root="$1"
    local run_id="$2"

    local audit_dir="$project_root/.androidcommondoc"
    local log_file="$audit_dir/findings-log.jsonl"

    mkdir -p "$audit_dir" 2>/dev/null || return 0

    local ts branch commit
    ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo "unknown")"
    branch="$(git -C "$project_root" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
    commit="$(git -C "$project_root" rev-parse --short HEAD 2>/dev/null || echo "")"

    while IFS= read -r finding_json; do
        [[ -z "$finding_json" ]] && continue
        echo '{"ts":"'"$ts"'","run_id":"'"$run_id"'","commit":"'"$commit"'","branch":"'"$branch"'","finding":'"$finding_json"'}' >> "$log_file"
    done
}
