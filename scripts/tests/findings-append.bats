#!/usr/bin/env bats
# =============================================================================
# Tests for scripts/sh/lib/findings-append.sh
#
# Validates:
# - Creates findings log dir and file on first call
# - Appends valid JSON lines with required fields
# - Bulk append reads from stdin
# - Handles missing git gracefully
# =============================================================================

LIB="$BATS_TEST_DIRNAME/../sh/lib/findings-append.sh"

setup() {
    source "$LIB"
    WORK_DIR=$(mktemp -d)
    LOG_FILE="$WORK_DIR/.androidcommondoc/findings-log.jsonl"
    # Init a fake git repo
    git -C "$WORK_DIR" init -q 2>/dev/null || true
    git -C "$WORK_DIR" config user.email "test@test.com" 2>/dev/null || true
    git -C "$WORK_DIR" config user.name "Test" 2>/dev/null || true
    touch "$WORK_DIR/README.md"
    git -C "$WORK_DIR" add . 2>/dev/null || true
    git -C "$WORK_DIR" commit -q -m "init" 2>/dev/null || true
}

teardown() {
    rm -rf "$WORK_DIR"
}

SAMPLE_FINDING='{"severity":"HIGH","category":"code-quality","check":"test-check","title":"Test finding","file":"src/Test.kt","line":42}'

@test "findings_append: creates .androidcommondoc dir if missing" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    [ -d "$WORK_DIR/.androidcommondoc" ]
}

@test "findings_append: creates findings-log.jsonl file" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    [ -f "$LOG_FILE" ]
}

@test "findings_append: line is valid JSON" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    LOG_FILE="$LOG_FILE" python3 -c "import json,os; json.loads(open(os.environ['LOG_FILE']).readline())"
}

@test "findings_append: JSON contains required field ts" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    LOG_FILE="$LOG_FILE" python3 -c "
import json, os
line = json.loads(open(os.environ['LOG_FILE']).readline())
assert 'ts' in line, 'missing ts'
assert line['ts'] != '', 'empty ts'
"
}

@test "findings_append: JSON contains run_id" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    LOG_FILE="$LOG_FILE" python3 -c "
import json, os
line = json.loads(open(os.environ['LOG_FILE']).readline())
assert line['run_id'] == 'run-001'
"
}

@test "findings_append: JSON contains finding object" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    LOG_FILE="$LOG_FILE" python3 -c "
import json, os
line = json.loads(open(os.environ['LOG_FILE']).readline())
assert 'finding' in line
assert line['finding']['severity'] == 'HIGH'
assert line['finding']['check'] == 'test-check'
assert line['finding']['line'] == 42
"
}

@test "findings_append: includes commit and branch from git" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    LOG_FILE="$LOG_FILE" python3 -c "
import json, os
line = json.loads(open(os.environ['LOG_FILE']).readline())
assert 'commit' in line
assert 'branch' in line
"
}

@test "findings_append: multiple calls append, not overwrite" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    findings_append "$WORK_DIR" "run-002" "$SAMPLE_FINDING"
    count=$(wc -l < "$LOG_FILE")
    [ "$count" -eq 2 ]
}

@test "findings_append: each line in multi-append is valid JSON" {
    findings_append "$WORK_DIR" "run-001" "$SAMPLE_FINDING"
    findings_append "$WORK_DIR" "run-002" "$SAMPLE_FINDING"
    while IFS= read -r line; do
        echo "$line" | python3 -c "import json,sys; json.loads(sys.stdin.read())"
    done < "$LOG_FILE"
}

@test "findings_append: does not crash when project has no git repo" {
    NO_GIT=$(mktemp -d)
    findings_append "$NO_GIT" "run-001" "$SAMPLE_FINDING"
    [ -f "$NO_GIT/.androidcommondoc/findings-log.jsonl" ]
    rm -rf "$NO_GIT"
}

@test "findings_append_bulk: appends multiple findings from stdin" {
    echo "$SAMPLE_FINDING" | findings_append_bulk "$WORK_DIR" "bulk-001"
    [ -f "$LOG_FILE" ]
    count=$(wc -l < "$LOG_FILE")
    [ "$count" -eq 1 ]
}

@test "findings_append_bulk: handles multiple lines" {
    printf '%s\n%s\n' "$SAMPLE_FINDING" "$SAMPLE_FINDING" | findings_append_bulk "$WORK_DIR" "bulk-002"
    count=$(wc -l < "$LOG_FILE")
    [ "$count" -eq 2 ]
}

@test "findings_append_bulk: skips empty lines" {
    printf '%s\n\n%s\n' "$SAMPLE_FINDING" "$SAMPLE_FINDING" | findings_append_bulk "$WORK_DIR" "bulk-003"
    count=$(wc -l < "$LOG_FILE")
    [ "$count" -eq 2 ]
}

@test "findings_append_bulk: each line is valid JSON" {
    printf '%s\n%s\n' "$SAMPLE_FINDING" "$SAMPLE_FINDING" | findings_append_bulk "$WORK_DIR" "bulk-004"
    while IFS= read -r line; do
        echo "$line" | python3 -c "import json,sys; json.loads(sys.stdin.read())"
    done < "$LOG_FILE"
}
