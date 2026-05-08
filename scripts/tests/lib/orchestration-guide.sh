#!/usr/bin/env bash
# Reads orchestration guide hub + all tl-* sub-docs as one combined string.
# Usage: cat_orchestration_guide
cat_orchestration_guide() {
    local docs
    docs="$(git -C "${BATS_TEST_DIRNAME:-.}" rev-parse --show-toplevel 2>/dev/null)/docs/agents"
    if [ ! -d "$docs" ]; then
        docs="${BATS_TEST_DIRNAME:-$(dirname "${BASH_SOURCE[0]}")/..}/../../docs/agents"
    fi
    cat \
        "$docs/main-agent-orchestration-guide.md" \
        "$docs/tl-session-start.md" \
        "$docs/tl-agent-roster.md" \
        "$docs/tl-pm-absent-mode.md" \
        "$docs/tl-verification-done-criteria.md" \
        "$docs/tl-git-workflow.md" \
        "$docs/tl-skills-mcp-tools.md" \
        "$docs/tl-release-workflow.md" \
        "$docs/tl-ingestion-request-handler.md"
}
