#!/usr/bin/env bats
# Regression coverage for the full adapter pipeline and the Copilot agent
# adapter. Every mutating generation happens in an isolated fixture.

REPO_ROOT="$BATS_TEST_DIRNAME/../.."
PIPELINE="$REPO_ROOT/adapters/generate-all.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    FIXTURE_ROOT="$WORK_DIR/repo"
    FIXTURE_HOME="$WORK_DIR/home"
    mkdir -p "$FIXTURE_ROOT/setup/agent-templates" \
        "$FIXTURE_ROOT/setup/copilot-templates" \
        "$FIXTURE_ROOT/setup/copilot-agent-templates" \
        "$FIXTURE_ROOT/skills/demo" "$FIXTURE_ROOT/docs" "$FIXTURE_HOME"
    cp -R "$REPO_ROOT/adapters" "$FIXTURE_ROOT/adapters"

    printf '%s\n' '{"parameters":{}}' > "$FIXTURE_ROOT/skills/params.json"
    cat > "$FIXTURE_ROOT/skills/demo/SKILL.md" <<'EOF'
---
name: demo
description: "Portable demo skill"
copilot: true
copilot-template-type: behavioral
---

# Demo

Use the portable demo.
EOF
    cat > "$FIXTURE_ROOT/setup/agent-templates/demo-agent.md" <<'EOF'
---
name: demo-agent
description: "Portable agent description"
tools: Read, Grep, Bash
skills:
  - demo
---

You are the demo agent.
EOF
    cat > "$FIXTURE_ROOT/docs/pattern.md" <<'EOF'
---
title: "Fixture pattern"
scope: [testing]
sources: [fixture]
targets: [all]
---

# Fixture pattern

## Rule

- Keep generated fixtures deterministic.
EOF
    cat > "$FIXTURE_ROOT/CLAUDE.md" <<'EOF'
# Fixture

## Rules

- Preserve generated output parity.
EOF

    HOME="$FIXTURE_HOME" bash "$FIXTURE_ROOT/adapters/generate-all.sh" \
        > "$WORK_DIR/baseline-generation.log" 2>&1
}

teardown() {
    rm -rf -- "$WORK_DIR"
}

fixture_output_fingerprint() {
    find "$FIXTURE_ROOT/setup/copilot-templates" \
        "$FIXTURE_ROOT/setup/copilot-agent-templates" -type f -exec cksum {} \; | sort
}

@test "copilot agent adapter parses quoted frontmatter portably without corrupting YAML" {
    output_file="$FIXTURE_ROOT/setup/copilot-agent-templates/demo-agent.agent.md"
    [ -f "$output_file" ]
    grep -Fqx 'name: "demo-agent"' "$output_file"
    grep -Fqx 'description: "Portable agent description"' "$output_file"
    grep -Fqx 'tools: [read, search, run_terminal_command]' "$output_file"
    grep -Fqx -- '- **/demo**: Portable demo skill' "$output_file"
    ! grep -Fq 'name: " demo-agent"' "$output_file"
    ! grep -Fq 'description: " "' "$output_file"
}

@test "generate-all --check succeeds without mutating generated outputs" {
    before="$(fixture_output_fingerprint)"

    run env HOME="$FIXTURE_HOME" bash "$FIXTURE_ROOT/adapters/generate-all.sh" --check

    [ "$status" -eq 0 ]
    [[ "$output" == *"Adapter check passed"* ]]
    after="$(fixture_output_fingerprint)"
    [ "$after" = "$before" ]
}

@test "generate-all --check fails on generated drift and leaves the drift untouched" {
    drift_file="$FIXTURE_ROOT/setup/copilot-agent-templates/demo-agent.agent.md"
    printf '%s\n' '# local drift' >> "$drift_file"
    before="$(cksum "$drift_file")"

    run env HOME="$FIXTURE_HOME" bash "$FIXTURE_ROOT/adapters/generate-all.sh" --check

    [ "$status" -ne 0 ]
    [[ "$output" == *"Adapter drift detected"* ]]
    after="$(cksum "$drift_file")"
    [ "$after" = "$before" ]
    grep -Fqx '# local drift' "$drift_file"
}

@test "repository adapter outputs regenerate cleanly with one Copilot template per agent" {
    clean_home="$WORK_DIR/clean-home"
    mkdir -p "$clean_home"
    run env HOME="$clean_home" bash "$PIPELINE" --check

    [ "$status" -eq 0 ]
    source_count="$(find "$REPO_ROOT/setup/agent-templates" -type f -name '*.md' ! -name README.md | wc -l | tr -d ' ')"
    output_count="$(find "$REPO_ROOT/setup/copilot-agent-templates" -type f -name '*.agent.md' | wc -l | tr -d ' ')"
    [ "$source_count" -eq 39 ]
    [ "$output_count" -eq "$source_count" ]
}
