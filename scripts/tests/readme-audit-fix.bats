#!/usr/bin/env bats
# Tests for readme-audit.sh --fix (FIX_MODE) golden-file behavior.
# Tests are RED until arch-platform implements the FIX_MODE branches.
# CLI flag confirmed: --fix (sets FIX_MODE=true, line 37 of readme-audit.sh)

SCRIPT="$BATS_TEST_DIRNAME/../sh/readme-audit.sh"

setup() {
    WORK_DIR="$(mktemp -d)"

    # Minimal AGENTS.md with stale skill count and no skill rows
    python3 -c "
import sys
work_dir = sys.argv[1]
content = '## Available Skills (5)\n| Name | Description |\n| --- | --- |\n'
open(work_dir + '/AGENTS.md', 'w').write(content)
" "$WORK_DIR"

    # Minimal README.md with stale MCP prose count
    python3 -c "
import sys
work_dir = sys.argv[1]
content = '# AndroidCommonDoc\n\nAn MCP server with 5 tools for KMP development.\n'
open(work_dir + '/README.md', 'w').write(content)
" "$WORK_DIR"

    # One real skill on disk
    mkdir -p "$WORK_DIR/skills/skill-bar"
    printf -- "---\nname: skill-bar\ndescription: Does bar\n---\n" > "$WORK_DIR/skills/skill-bar/SKILL.md"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# ── (a) --fix updates skill count header in AGENTS.md ────────────────────

@test "(a) fix: updates AGENTS.md Available Skills count from 5 to 1" {
    bash "$SCRIPT" --project-root "$WORK_DIR" --fix || true

    run python3 -c "
import sys
content = open(sys.argv[1] + '/AGENTS.md').read()
sys.exit(0 if 'Available Skills (1)' in content else 1)
" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── (b) --fix adds missing skill row to AGENTS.md ────────────────────────

@test "(b) fix: adds missing skill-bar row to AGENTS.md" {
    bash "$SCRIPT" --project-root "$WORK_DIR" --fix || true

    run python3 -c "
import sys
content = open(sys.argv[1] + '/AGENTS.md').read()
sys.exit(0 if 'skill-bar' in content else 1)
" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── (c) --fix removes phantom skill row from AGENTS.md ───────────────────

@test "(c) fix: removes phantom skill-phantom row from AGENTS.md" {
    # Add a phantom row (skill not on disk) — overwrite AGENTS.md
    python3 -c "
import sys
work_dir = sys.argv[1]
content = (
    '## Available Skills (5)\n'
    '| Name | Description |\n'
    '| --- | --- |\n'
    '| \`skill-phantom\` | Ghost skill |\n'
)
open(work_dir + '/AGENTS.md', 'w').write(content)
" "$WORK_DIR"

    bash "$SCRIPT" --project-root "$WORK_DIR" --fix || true

    run python3 -c "
import sys
content = open(sys.argv[1] + '/AGENTS.md').read()
sys.exit(1 if 'skill-phantom' in content else 0)
" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── (d) --fix updates prose MCP tool count in README.md ──────────────────

@test "(d) fix: updates README.md prose MCP count from 5 to 0" {
    # No mcp-server/src/tools dir in WORK_DIR fixture → actual count = 0
    bash "$SCRIPT" --project-root "$WORK_DIR" --fix || true

    run python3 -c "
import sys
content = open(sys.argv[1] + '/README.md').read()
sys.exit(0 if 'MCP server with 0 tools' in content else 1)
" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── (e) audit-only (no --fix) does NOT modify files ──────────────────────

@test "(e) audit-only mode does not modify README.md or AGENTS.md" {
    readme_before="$(python3 -c "import sys; print(open(sys.argv[1]+'/README.md').read(), end='')" "$WORK_DIR")"
    agents_before="$(python3 -c "import sys; print(open(sys.argv[1]+'/AGENTS.md').read(), end='')" "$WORK_DIR")"

    # Run without --fix; script may exit non-zero on findings — suppress that
    bash "$SCRIPT" --project-root "$WORK_DIR" || true

    readme_after="$(python3 -c "import sys; print(open(sys.argv[1]+'/README.md').read(), end='')" "$WORK_DIR")"
    agents_after="$(python3 -c "import sys; print(open(sys.argv[1]+'/AGENTS.md').read(), end='')" "$WORK_DIR")"

    [ "$readme_before" = "$readme_after" ]
    [ "$agents_before" = "$agents_after" ]
}
