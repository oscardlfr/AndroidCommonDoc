#!/usr/bin/env bash
# Disk-derived count helpers for README validation tests.
# Source this file in bats test files to avoid hardcoded count literals.
#
# Usage in bats:
#   source "$BATS_TEST_DIRNAME/lib/readme-counts.sh"
#   skill_count=$(count_skills "$L0_ROOT")

# Count *.md files in a directory, excluding README.md.
# Usage: count_md_excluding_readme <dir>
count_md_excluding_readme() {
    local dir="$1"
    ls "$dir"/*.md 2>/dev/null | grep -v 'README\.md' | wc -l | tr -d ' \r'
}

# Count agent template *.md files in setup/agent-templates/, excluding README.
# Usage: count_agent_templates <l0_root>
count_agent_templates() {
    local root="$1"
    count_md_excluding_readme "$root/setup/agent-templates"
}

# Count skill subdirectories in skills/.
# Usage: count_skills <l0_root>
count_skills() {
    local root="$1"
    find "$root/skills/" -maxdepth 1 -mindepth 1 -type d | wc -l | tr -d ' \r'
}

# Count command *.md files in .claude/commands/.
# Usage: count_commands <l0_root>
count_commands() {
    local root="$1"
    find "$root/.claude/commands/" -name '*.md' | wc -l | tr -d ' \r'
}
