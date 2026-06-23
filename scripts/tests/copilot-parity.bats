#!/usr/bin/env bats
# Tests for copilot-parity.sh and copilot-adapter.sh (copilot frontmatter support)

PARITY_SCRIPT="$BATS_TEST_DIRNAME/../sh/copilot-parity.sh"
ADAPTER_SCRIPT="$BATS_TEST_DIRNAME/../../adapters/copilot-adapter.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    mkdir -p "$WORK_DIR/skills"
    mkdir -p "$WORK_DIR/setup/copilot-templates"
}

teardown() {
    rm -rf "$WORK_DIR"
}

write_params_file() {
    echo '{"parameters":{}}' > "$WORK_DIR/skills/params.json"
}

# Helper: write a skill with copilot: true and scripted implementation
write_scripted_skill() {
    local name="$1"
    mkdir -p "$WORK_DIR/skills/$name"
    cat > "$WORK_DIR/skills/$name/SKILL.md" << 'HEREDOC'
---
name: SKILL_NAME
description: "Test skill SKILL_NAME"
copilot: true
---

## Usage

```
/SKILL_NAME
```

## Implementation

### macOS / Linux
```bash
echo "hello from SKILL_NAME"
```

### Windows (PowerShell)
```powershell
Write-Host "hello from SKILL_NAME"
```
HEREDOC
    sed -i "s/SKILL_NAME/$name/g" "$WORK_DIR/skills/$name/SKILL.md"
}

# Helper: write a skill with copilot: true and behavioral type
write_behavioral_skill() {
    local name="$1"
    mkdir -p "$WORK_DIR/skills/$name"
    cat > "$WORK_DIR/skills/$name/SKILL.md" << 'HEREDOC'
---
name: SKILL_NAME
description: "Test behavioral skill SKILL_NAME"
copilot: true
copilot-template-type: behavioral
---

## Steps

1. Do the first thing
2. Do the second thing
3. Report results
HEREDOC
    sed -i "s/SKILL_NAME/$name/g" "$WORK_DIR/skills/$name/SKILL.md"
}

# Helper: write a skill with copilot: false
write_excluded_skill() {
    local name="$1"
    mkdir -p "$WORK_DIR/skills/$name"
    cat > "$WORK_DIR/skills/$name/SKILL.md" << 'HEREDOC'
---
name: SKILL_NAME
description: "Test excluded skill SKILL_NAME"
copilot: false
---

# SKILL_NAME

Claude-only orchestration skill.
HEREDOC
    sed -i "s/SKILL_NAME/$name/g" "$WORK_DIR/skills/$name/SKILL.md"
}

# Helper: write a skill missing the copilot field
write_skill_no_copilot_field() {
    local name="$1"
    mkdir -p "$WORK_DIR/skills/$name"
    cat > "$WORK_DIR/skills/$name/SKILL.md" << 'HEREDOC'
---
name: SKILL_NAME
description: "Test skill without copilot field"
---

Some content.
HEREDOC
    sed -i "s/SKILL_NAME/$name/g" "$WORK_DIR/skills/$name/SKILL.md"
}

# Helper: write a scripted copilot template
write_scripted_template() {
    local name="$1"
    cat > "$WORK_DIR/setup/copilot-templates/$name.prompt.md" << 'HEREDOC'
<!-- GENERATED from skills/SKILL_NAME/SKILL.md -- DO NOT EDIT MANUALLY -->
---
mode: agent
description: "Test skill SKILL_NAME"
---

Test skill SKILL_NAME

## Implementation

### macOS / Linux
```bash
echo "hello"
```

### Windows (PowerShell)
```powershell
Write-Host "hello"
```
HEREDOC
    sed -i "s/SKILL_NAME/$name/g" "$WORK_DIR/setup/copilot-templates/$name.prompt.md"
}

# Helper: write a behavioral copilot template
write_behavioral_template() {
    local name="$1"
    cat > "$WORK_DIR/setup/copilot-templates/$name.prompt.md" << 'HEREDOC'
<!-- GENERATED from skills/SKILL_NAME/SKILL.md -- DO NOT EDIT MANUALLY -->
---
mode: agent
description: "Test behavioral skill SKILL_NAME"
---

Test behavioral skill SKILL_NAME

## Instructions

## Steps

1. Do the first thing
2. Do the second thing
HEREDOC
    sed -i "s/SKILL_NAME/$name/g" "$WORK_DIR/setup/copilot-templates/$name.prompt.md"
}

# Helper: write an empty template (broken)
write_empty_template() {
    local name="$1"
    cat > "$WORK_DIR/setup/copilot-templates/$name.prompt.md" << 'HEREDOC'
<!-- GENERATED -->
---
mode: agent
description: "Empty skill"
---

Empty skill

## Implementation

### macOS / Linux
```bash

```

### Windows (PowerShell)
```powershell

```
HEREDOC
}

# ============================
# copilot-parity.sh tests
# ============================

@test "parity: PASS when all copilot:true skills have templates" {
    write_scripted_skill "test-skill"
    write_scripted_template "test-skill"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "RESULT: PASS"
    echo "$output" | grep -q '"status":"pass"'
}

@test "parity: PASS with behavioral template" {
    write_behavioral_skill "my-behavior"
    write_behavioral_template "my-behavior"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "RESULT: PASS"
}

@test "parity: PASS when copilot:false skill has no template" {
    write_excluded_skill "debug"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "RESULT: PASS"
}

@test "parity: FAIL with MISSING when copilot:true skill lacks template" {
    write_scripted_skill "missing-skill"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 1 ]
    echo "$output" | grep -q '\[MISSING\].*missing-skill'
    echo "$output" | grep -q '"missing":1'
}

@test "parity: FAIL with ORPHAN when template exists for copilot:false skill" {
    write_excluded_skill "old-skill"
    write_scripted_template "old-skill"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 1 ]
    echo "$output" | grep -q '\[ORPHAN\].*old-skill'
    echo "$output" | grep -q '"orphaned":1'
}

@test "parity: FAIL with ORPHAN when template has no matching skill" {
    write_scripted_template "ghost-skill"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 1 ]
    echo "$output" | grep -q '\[ORPHAN\].*ghost-skill'
}

@test "parity: FAIL with EMPTY for template with empty code blocks" {
    write_scripted_skill "empty-impl"
    write_empty_template "empty-impl"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 1 ]
    echo "$output" | grep -q '\[EMPTY\].*empty-impl'
    echo "$output" | grep -q '"empty":1'
}

@test "parity: FAIL with MISSING copilot field" {
    write_skill_no_copilot_field "no-field"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 1 ]
    echo "$output" | grep -q '\[MISSING\].*no-field.*copilot'
    echo "$output" | grep -q '"no_field":1'
}

@test "parity: counts multiple issue types correctly" {
    write_scripted_skill "has-template"
    write_scripted_template "has-template"
    write_scripted_skill "missing-one"
    write_excluded_skill "orphaned-one"
    write_scripted_template "orphaned-one"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 1 ]
    echo "$output" | grep -q '"missing":1'
    echo "$output" | grep -q '"orphaned":1'
}

@test "parity: --verbose shows OK entries" {
    write_scripted_skill "verbose-skill"
    write_scripted_template "verbose-skill"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR" --verbose
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '\[OK\].*verbose-skill.*template exists'
}

@test "parity: --help exits 0 with usage" {
    run bash "$PARITY_SCRIPT" --help
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "Usage:"
}

@test "parity: JSON summary on last line" {
    write_scripted_skill "json-test"
    write_scripted_template "json-test"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    last_line=$(echo "$output" | tail -1)
    echo "$last_line" | grep -q '"status":"pass"'
    echo "$last_line" | grep -q '"ok":'
    echo "$last_line" | grep -q '"missing":'
    echo "$last_line" | grep -q '"orphaned":'
    echo "$last_line" | grep -q '"empty":'
    echo "$last_line" | grep -q '"no_field":'
}

@test "parity: behavioral template with embedded Implementation section is not flagged empty" {
    write_behavioral_skill "has-impl-in-body"
    # Create a behavioral template that has ## Instructions AND ## Implementation (from body)
    cat > "$WORK_DIR/setup/copilot-templates/has-impl-in-body.prompt.md" << 'EOF'
<!-- GENERATED -->
---
mode: agent
description: "Behavioral with embedded impl"
---

Behavioral with embedded impl

## Instructions

## Steps

1. Do something

## Implementation

```bash
echo "this is inside instructions body"
```
EOF

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "RESULT: PASS"
}

@test "parity: mixed scenario with scripted, behavioral, and excluded skills" {
    write_scripted_skill "scripted-one"
    write_scripted_template "scripted-one"
    write_behavioral_skill "behavioral-one"
    write_behavioral_template "behavioral-one"
    write_excluded_skill "excluded-one"

    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q '"ok":2'
}

# ============================
# copilot-adapter.sh tests
# ============================

@test "adapter: generates scripted template for copilot:true skill with Implementation" {
    write_params_file
    write_scripted_skill "adapter-scripted"

    run bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    [ -f "$WORK_DIR/setup/copilot-templates/adapter-scripted.prompt.md" ]
    grep -q "^## Implementation" "$WORK_DIR/setup/copilot-templates/adapter-scripted.prompt.md"
    echo "$output" | grep -q "Generated (scripted)"
}

@test "adapter: skips copilot:false skills" {
    write_params_file
    write_excluded_skill "debug"

    run bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "Skipped (copilot: false)"
    echo "$output" | grep -q "skipped"
    [ ! -f "$WORK_DIR/setup/copilot-templates/debug.prompt.md" ]
}

@test "adapter: generates behavioral template for copilot-template-type: behavioral" {
    write_params_file
    write_behavioral_skill "accessibility"

    run bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "Generated (behavioral)"
    grep -q "^## Instructions" "$WORK_DIR/setup/copilot-templates/accessibility.prompt.md"
}

@test "adapter: reports correct counts" {
    write_params_file
    write_scripted_skill "scripted-one"
    write_behavioral_skill "behavioral-one"
    write_excluded_skill "excluded-one"

    run bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "prompts generated"
    echo "$output" | grep -q "scripted"
    echo "$output" | grep -q "behavioral"
    echo "$output" | grep -q "skipped"
    echo "$output" | grep -q "2 prompts generated"
}

@test "adapter: --clean removes orphaned templates" {
    write_params_file
    write_scripted_skill "adapter-scripted"
    echo "orphan" > "$WORK_DIR/setup/copilot-templates/BATS-TEST-ORPHAN.prompt.md"

    run bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR" --clean
    [ "$status" -eq 0 ]
    [ ! -f "$WORK_DIR/setup/copilot-templates/BATS-TEST-ORPHAN.prompt.md" ]
    echo "$output" | grep -q "Cleaned orphan: BATS-TEST-ORPHAN"
}

@test "parity: --fix respects --project-root from real repo and leaves live templates unchanged" {
    write_params_file
    write_excluded_skill "orphan-owner"
    echo "orphan" > "$WORK_DIR/setup/copilot-templates/orphan-owner.prompt.md"

    local repo_root live_before live_after
    repo_root="$BATS_TEST_DIRNAME/../.."
    live_before="$(git -C "$repo_root" status --porcelain -- setup/copilot-templates)"

    cd "$repo_root"
    run bash "$PARITY_SCRIPT" --project-root "$WORK_DIR" --fix
    [ "$status" -eq 1 ]
    [ ! -f "$WORK_DIR/setup/copilot-templates/orphan-owner.prompt.md" ]
    echo "$output" | grep -q "Templates: $WORK_DIR/setup/copilot-templates"
    echo "$output" | grep -q "Cleaned orphan: orphan-owner.prompt.md"

    live_after="$(git -C "$repo_root" status --porcelain -- setup/copilot-templates)"
    [ "$live_before" = "$live_after" ]
}

@test "adapter: behavioral templates have ## Instructions section" {
    write_params_file
    write_behavioral_skill "accessibility"

    bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR" > /dev/null 2>&1

    grep -q "^## Instructions" "$WORK_DIR/setup/copilot-templates/accessibility.prompt.md"
}

@test "adapter: scripted templates have ## Implementation section" {
    write_params_file
    write_scripted_skill "test"

    bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR" > /dev/null 2>&1

    grep -q "^## Implementation" "$WORK_DIR/setup/copilot-templates/test.prompt.md"
}

@test "adapter: no template generated for copilot:false skills" {
    write_params_file
    write_excluded_skill "debug"
    write_excluded_skill "decide"
    write_excluded_skill "work"

    bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR" > /dev/null 2>&1

    [ ! -f "$WORK_DIR/setup/copilot-templates/debug.prompt.md" ]
    [ ! -f "$WORK_DIR/setup/copilot-templates/decide.prompt.md" ]
    [ ! -f "$WORK_DIR/setup/copilot-templates/work.prompt.md" ]
}

@test "adapter: generated templates have GENERATED header" {
    write_params_file
    write_scripted_skill "test"

    bash "$ADAPTER_SCRIPT" --project-root "$WORK_DIR" > /dev/null 2>&1

    head -1 "$WORK_DIR/setup/copilot-templates/test.prompt.md" | grep -q "GENERATED from"
}
