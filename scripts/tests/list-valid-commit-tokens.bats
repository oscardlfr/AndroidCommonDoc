#!/usr/bin/env bats
# tests for list-valid-commit-tokens.sh

SCRIPT="$BATS_TEST_DIRNAME/../sh/list-valid-commit-tokens.sh"
PROJECT_ROOT="$BATS_TEST_DIRNAME/../.."

setup() {
    export KMP_TEST_RUNNER_BYPASS=1
    WORK_DIR="$(mktemp -d)"
    mkdir -p "$WORK_DIR/.github/workflows"
    cat > "$WORK_DIR/.github/workflows/reusable-commit-lint.yml" <<'EOF'
on:
  workflow_call:
    inputs:
      valid_types:
        description: "Comma-separated list of valid commit types"
        type: string
        default: "feat,fix,docs,style,refactor,perf,test,build,ci,chore,revert"
EOF
    cat > "$WORK_DIR/.commitlintrc.json" <<'EOF'
{
  "valid_scopes": ["core","data","ui","feature","ci","deps","release","docs","detekt","mcp","skills","scripts","agents","archive","di","guides","tests","tools"]
}
EOF
}

teardown() {
    rm -rf "$WORK_DIR"
}

# --- Human format ---

@test "--format human outputs 'Valid commit TYPES' header" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format human
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "Valid commit TYPES"
}

@test "--format human outputs 'Valid commit SCOPES' header" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format human
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "Valid commit SCOPES"
}

@test "--format human includes 'feat' and 'fix' in TYPES list" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format human
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "feat"
    echo "$output" | grep -q "fix"
}

@test "--format human includes 'core' and 'data' in SCOPES list" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format human
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "core"
    echo "$output" | grep -q "data"
}

@test "--format human includes explanatory NOTE about types vs scopes" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format human
    [ "$status" -eq 0 ]
    echo "$output" | grep -q "NOTE"
    echo "$output" | grep -q "TYPEs and SCOPEs are validated separately"
}

# --- JSON format ---

@test "--format json outputs valid JSON parseable by jq" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format json
    [ "$status" -eq 0 ]
    echo "$output" | jq empty
}

@test "--format json includes valid_types array with 'feat' element" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format json
    [ "$status" -eq 0 ]
    result=$(echo "$output" | jq -r '.valid_types[]' | grep -c "^feat$")
    [ "$result" -eq 1 ]
}

@test "--format json includes valid_scopes array with 'core' element" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format json
    [ "$status" -eq 0 ]
    result=$(echo "$output" | jq -r '.valid_scopes[]' | grep -c "^core$")
    [ "$result" -eq 1 ]
}

@test "--format json includes types_source and scopes_source fields" {
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format json
    [ "$status" -eq 0 ]
    echo "$output" | jq -e '.types_source' > /dev/null
    echo "$output" | jq -e '.scopes_source' > /dev/null
}

# --- Fail modes ---

@test "missing reusable-commit-lint.yml exits 1 with error" {
    rm "$WORK_DIR/.github/workflows/reusable-commit-lint.yml"
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format human
    [ "$status" -eq 1 ]
    echo "$output" | grep -qi "error"
}

@test "missing .commitlintrc.json exits 1 with error" {
    rm "$WORK_DIR/.commitlintrc.json"
    run bash "$SCRIPT" --project-root "$WORK_DIR" --format human
    [ "$status" -eq 1 ]
    echo "$output" | grep -qi "error"
}
