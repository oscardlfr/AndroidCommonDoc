#!/usr/bin/env bats
# Regression tests for copilot-adapter.sh reference template_type branch.
# BL-Wave-B-adapter-bug: missing reference branch produced empty bash blocks.
#
# Strategy: run adapter on real repo (adapter hardcodes REPO_ROOT), check
# android-skills-consume.prompt.md which is the known reference-type skill.

ADAPTER_SCRIPT="$BATS_TEST_DIRNAME/../../adapters/copilot-adapter.sh"
REFERENCE_OUTPUT="$BATS_TEST_DIRNAME/../../setup/copilot-templates/android-skills-consume.prompt.md"

setup() {
    cd "$BATS_TEST_DIRNAME/../.."
    # Run adapter once; all tests in this file inspect the same output file
    bash "$ADAPTER_SCRIPT" > /dev/null 2>&1 || true
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
    # The bug: missing reference branch fell through to scripted, emitting ```bash\n\n```
    ! grep -A1 '```bash' "$REFERENCE_OUTPUT" | grep -q '^```$'
}

@test "adapter: reference template body is non-empty after header" {
    # Verify there is content after ## Reference (not just the header then EOF)
    awk '/^## Reference/{found=1; next} found && NF>0{print; exit}' "$REFERENCE_OUTPUT" | grep -q .
}

@test "adapter: reference output includes generated header comment" {
    grep -q "GENERATED from skills/android-skills-consume/SKILL.md" "$REFERENCE_OUTPUT"
}

@test "adapter: adapter summary reports reference count" {
    cd "$BATS_TEST_DIRNAME/../.."
    run bash "$ADAPTER_SCRIPT"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "reference"
}
