#!/usr/bin/env bats
# Regression tests for copilot-adapter.sh reference template_type branch.
# BL-Wave-B-adapter-bug: missing reference branch produced empty bash blocks.
#
# Strategy: run adapter against a temp fixture repo and inspect the generated
# reference template there. These tests must never write setup/copilot-templates/
# in the live checkout.

ADAPTER_SCRIPT="$BATS_TEST_DIRNAME/../../adapters/copilot-adapter.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    mkdir -p "$WORK_DIR/skills/android-skills-consume"
    mkdir -p "$WORK_DIR/setup/copilot-templates"
    echo '{"parameters":{}}' > "$WORK_DIR/skills/params.json"
    cat > "$WORK_DIR/skills/android-skills-consume/SKILL.md" << 'EOF'
---
name: android-skills-consume
description: "Consume Android CLI skills"
copilot: true
copilot-template-type: reference
---

Use the Android CLI skills catalog.

## Details

Reference body content for Android skill installation.
EOF
    bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR" > "$WORK_DIR/adapter-output.txt"
    REFERENCE_OUTPUT="$WORK_DIR/setup/copilot-templates/android-skills-consume.prompt.md"
}

teardown() {
    rm -rf "$WORK_DIR"
}

@test "adapter: generates reference template for copilot-template-type: reference" {
    [ -f "$REFERENCE_OUTPUT" ]
}

@test "adapter: reference templates have ## Reference section" {
    grep -q "^## Reference" "$REFERENCE_OUTPUT"
}

@test "adapter: reference templates do not have ## Instructions section" {
    ! grep -q "^## Instructions" "$REFERENCE_OUTPUT"
}

@test "adapter: reference templates do not have ## Implementation section" {
    ! grep -q "^## Implementation" "$REFERENCE_OUTPUT"
}

@test "adapter: reference templates do not have empty bash blocks" {
    ! grep -A1 '```bash' "$REFERENCE_OUTPUT" | grep -q '^```$'
}

@test "adapter: reference template body is non-empty after header" {
    awk '/^## Reference/{found=1; next} found && NF>0{print; exit}' "$REFERENCE_OUTPUT" | grep -q .
}

@test "adapter: reference output includes generated header comment" {
    grep -q "GENERATED from skills/android-skills-consume/SKILL.md" "$REFERENCE_OUTPUT"
}

@test "adapter: adapter summary reports reference generation" {
    grep -q "Generated (reference)" "$WORK_DIR/adapter-output.txt"
}
