#!/usr/bin/env bats
# Tests for sync-gsd-agents.sh and check-agent-parity.sh

SYNC_SCRIPT="$BATS_TEST_DIRNAME/../sh/sync-gsd-agents.sh"
CHECK_SCRIPT="$BATS_TEST_DIRNAME/../sh/check-agent-parity.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    # Fake project with .claude/agents/
    mkdir -p "$WORK_DIR/.claude/agents"
    # Fake GSD target (project-level)
    mkdir -p "$WORK_DIR/.gsd/agents"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# Helper: write a minimal .claude agent
write_claude_agent() {
    local name="$1"
    local model="${2:-sonnet}"
    local tools="${3:-Read, Grep, Glob}"
    cat > "$WORK_DIR/.claude/agents/${name}.md" << EOF
---
name: ${name}
description: Test agent ${name}
tools: ${tools}
model: ${model}
memory: project
---

You are ${name}. Do the thing.

## Checks

### 1. First Check
- Check something
- Verify something

## Output

Report results.
EOF
}

# ========================
# sync-gsd-agents.sh tests
# ========================

@test "sync: generates GSD agent from .claude agent" {
    write_claude_agent "test-agent"

    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"new":1'
    [ -f "$WORK_DIR/.gsd/agents/test-agent.md" ]
}

@test "sync: preserves name and description in frontmatter" {
    write_claude_agent "my-auditor"

    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    grep -q "^name: my-auditor" "$WORK_DIR/.gsd/agents/my-auditor.md"
    grep -q "^description: Test agent my-auditor" "$WORK_DIR/.gsd/agents/my-auditor.md"
}

@test "sync: drops model and memory fields" {
    write_claude_agent "drop-fields" "opus"

    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    ! grep -q "^model:" "$WORK_DIR/.gsd/agents/drop-fields.md"
    ! grep -q "^memory:" "$WORK_DIR/.gsd/agents/drop-fields.md"
}

@test "sync: maps Grep and Glob to bash in tools" {
    write_claude_agent "tool-mapper" "sonnet" "Read, Grep, Glob, Bash"

    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    tools_line=$(grep "^tools:" "$WORK_DIR/.gsd/agents/tool-mapper.md")
    echo "$tools_line" | grep -q "bash"
    echo "$tools_line" | grep -q "read"
    ! echo "$tools_line" | grep -qi "grep"
    ! echo "$tools_line" | grep -qi "glob"
}

@test "sync: preserves body content verbatim" {
    write_claude_agent "body-check"

    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    grep -q "You are body-check. Do the thing." "$WORK_DIR/.gsd/agents/body-check.md"
    grep -q "### 1. First Check" "$WORK_DIR/.gsd/agents/body-check.md"
}

@test "sync: handles multiple agents" {
    write_claude_agent "agent-one"
    write_claude_agent "agent-two"
    write_claude_agent "agent-three"

    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"generated":3'
    echo "$output" | grep -q '"new":3'
    [ -f "$WORK_DIR/.gsd/agents/agent-one.md" ]
    [ -f "$WORK_DIR/.gsd/agents/agent-two.md" ]
    [ -f "$WORK_DIR/.gsd/agents/agent-three.md" ]
}

@test "sync: idempotent -- second run shows unchanged" {
    write_claude_agent "idem-agent"

    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project
    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"unchanged":1'
    echo "$output" | grep -q '"new":0'
}

@test "sync: detects updated source" {
    write_claude_agent "update-me"
    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    # Modify source
    echo "## New section added" >> "$WORK_DIR/.claude/agents/update-me.md"

    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"updated":1'
}

@test "sync: --dry-run does not create files" {
    write_claude_agent "dry-agent"

    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project --dry-run
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"new":1'
    [ ! -f "$WORK_DIR/.gsd/agents/dry-agent.md" ]
}

@test "sync: --verbose shows per-agent status on stderr" {
    write_claude_agent "verbose-agent"

    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project --verbose
    echo "$output" | grep -q "verbose-agent"
}

@test "sync: exits 1 when no .claude/agents/ directory" {
    rm -rf "$WORK_DIR/.claude/agents"

    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 1 ]
}

@test "sync: skips agents without name in frontmatter" {
    cat > "$WORK_DIR/.claude/agents/no-name.md" << 'EOF'
---
description: Agent without name
tools: Read
---

Body content.
EOF

    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"generated":0'
}

@test "sync: output is valid JSON" {
    write_claude_agent "json-check"

    run bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "import sys,json; json.loads(sys.stdin.read())"
}

@test "sync: maps Agent tool to subagent" {
    write_claude_agent "delegator" "sonnet" "Read, Grep, Agent, Bash"

    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    tools_line=$(grep "^tools:" "$WORK_DIR/.gsd/agents/delegator.md")
    # Should contain "subagent", not bare "agent" as a separate entry
    echo "$tools_line" | grep -q "subagent"
    # The word "agent" should only appear inside "subagent"
    cleaned=$(echo "$tools_line" | sed 's/subagent//g')
    ! echo "$cleaned" | grep -qi "agent"
}

@test "sync: maps Write and Edit tools" {
    write_claude_agent "writer" "sonnet" "Read, Write, Edit"

    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    tools_line=$(grep "^tools:" "$WORK_DIR/.gsd/agents/writer.md")
    echo "$tools_line" | grep -q "read"
    echo "$tools_line" | grep -q "edit"
    echo "$tools_line" | grep -q "write"
}

# ============================
# check-agent-parity.sh tests
# ============================

@test "parity: PASS when all agents match" {
    write_claude_agent "matched-agent"
    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "PASS"
    echo "$output" | grep -q "\[OK\].*matched-agent"
}

@test "parity: FAIL with MISSING when GSD agent absent" {
    write_claude_agent "missing-agent"

    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 1 ]
    echo "$output" | grep -q "FAIL"
    echo "$output" | grep -q "\[MISSING\].*missing-agent"
}

@test "parity: FAIL with STALE when GSD body differs" {
    write_claude_agent "stale-agent"
    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    echo "# tampered content" >> "$WORK_DIR/.gsd/agents/stale-agent.md"

    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 1 ]
    echo "$output" | grep -q "\[STALE\].*stale-agent"
}

@test "parity: reports correct counts in JSON" {
    write_claude_agent "ok-agent"
    write_claude_agent "missing-one"
    write_claude_agent "stale-one"

    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    rm "$WORK_DIR/.gsd/agents/missing-one.md"
    echo "# tamper" >> "$WORK_DIR/.gsd/agents/stale-one.md"

    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 1 ]
    echo "$output" | grep -q '"ok":1'
    echo "$output" | grep -q '"missing":1'
    echo "$output" | grep -q '"stale":1'
}

@test "parity: --fix runs sync and creates missing agents" {
    write_claude_agent "fix-me"

    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project --fix
    echo "$output" | grep -q "\[MISSING\].*fix-me"
    echo "$output" | grep -q "Auto-fixing"

    [ -f "$WORK_DIR/.gsd/agents/fix-me.md" ]
}

@test "parity: multiple agents all OK" {
    write_claude_agent "alpha"
    write_claude_agent "beta"
    write_claude_agent "gamma"
    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"ok":3'
}

@test "parity: handles empty .claude/agents/ gracefully" {
    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "PASS"
}

@test "parity: JSON output is parseable" {
    write_claude_agent "json-parity"
    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project
    last_line=$(echo "$output" | tail -1)
    echo "$last_line" | python3 -c "import sys,json; json.loads(sys.stdin.read())"
}

@test "parity: mixed OK + MISSING + STALE in one run" {
    write_claude_agent "agent-ok"
    write_claude_agent "agent-missing"
    write_claude_agent "agent-stale"
    bash "$SYNC_SCRIPT" --project-root "$WORK_DIR" --target project

    rm "$WORK_DIR/.gsd/agents/agent-missing.md"
    echo "# drift" >> "$WORK_DIR/.gsd/agents/agent-stale.md"

    run bash "$CHECK_SCRIPT" --project-root "$WORK_DIR" --target project
    [ "$status" -eq 1 ]
    echo "$output" | grep -q "\[OK\].*agent-ok"
    echo "$output" | grep -q "\[MISSING\].*agent-missing"
    echo "$output" | grep -q "\[STALE\].*agent-stale"
}
