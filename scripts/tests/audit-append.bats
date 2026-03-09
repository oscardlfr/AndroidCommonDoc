#!/usr/bin/env bats
# =============================================================================
# Tests for scripts/sh/lib/audit-append.sh
#
# Validates:
#   - Creates audit log dir and file on first call
#   - Appends valid JSON lines
#   - Each line is parseable JSON with required fields
#   - Multiple appends don't overwrite (true append)
#   - Handles missing git gracefully (no crash)
#   - Extra fields are included in output
# =============================================================================

LIB="$BATS_TEST_DIRNAME/../sh/lib/audit-append.sh"

setup() {
    # shellcheck disable=SC1090
    source "$LIB"
    WORK_DIR=$(mktemp -d)
    AUDIT_LOG="$WORK_DIR/.androidcommondoc/audit-log.jsonl"
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

# Helper: read the audit log as Windows path for Python3
_audit_log_win() {
    cygpath -w "$AUDIT_LOG" 2>/dev/null || echo "$AUDIT_LOG"
}

# Helper: validate JSON using python3 with proper path handling
_validate_json_line() {
    local log_path
    log_path=$(_audit_log_win)
    python3 - "$log_path" <<'EOF'
import sys, json
path = sys.argv[1].replace("\\\\", "\\")
with open(path, 'r') as f:
    for line in f:
        line = line.strip()
        if line:
            json.loads(line)
print("ok")
EOF
}

# Helper: get JSON field from first line
_get_json_field() {
    local field="$1"
    local log_path
    log_path=$(_audit_log_win)
    python3 - "$log_path" "$field" <<'EOF'
import sys, json
path = sys.argv[1]
field = sys.argv[2]
with open(path, 'r') as f:
    d = json.loads(f.readline())
print(d.get(field, ''))
EOF
}

# Helper: get JSON field from all lines as JSON array
_get_all_events() {
    local log_path
    log_path=$(_audit_log_win)
    python3 - "$log_path" <<'EOF'
import sys, json
path = sys.argv[1]
events = []
with open(path, 'r') as f:
    for line in f:
        line = line.strip()
        if line:
            events.append(json.loads(line)['event'])
print(','.join(events))
EOF
}

# ---------------------------------------------------------------------------
# File creation
# ---------------------------------------------------------------------------

@test "audit_append: creates .androidcommondoc dir if missing" {
    audit_append "$WORK_DIR" "coverage" "pass" '"coverage_pct":84.2'
    [ -d "$WORK_DIR/.androidcommondoc" ]
}

@test "audit_append: creates audit-log.jsonl file" {
    audit_append "$WORK_DIR" "coverage" "pass" '"coverage_pct":84.2'
    [ -f "$AUDIT_LOG" ]
}

# ---------------------------------------------------------------------------
# JSON validity
# ---------------------------------------------------------------------------

@test "audit_append: line is valid JSON" {
    audit_append "$WORK_DIR" "coverage" "pass" '"coverage_pct":84.2'
    result=$(_validate_json_line)
    [ "$result" = "ok" ]
}

@test "audit_append: JSON contains required field ts" {
    audit_append "$WORK_DIR" "coverage" "pass" '"coverage_pct":84.2'
    ts=$(_get_json_field "ts")
    [ -n "$ts" ]
}

@test "audit_append: JSON event field has correct value" {
    audit_append "$WORK_DIR" "kmp_verify" "pass" '"errors":0'
    event=$(_get_json_field "event")
    [ "$event" = "kmp_verify" ]
}

@test "audit_append: JSON result field has correct value" {
    audit_append "$WORK_DIR" "coverage" "warn" '"coverage_pct":42.0'
    result=$(_get_json_field "result")
    [ "$result" = "warn" ]
}

@test "audit_append: JSON project field is basename of root" {
    audit_append "$WORK_DIR" "coverage" "pass" '"coverage_pct":100.0'
    proj=$(_get_json_field "project")
    expected=$(basename "$WORK_DIR")
    [ "$proj" = "$expected" ]
}

@test "audit_append: extra fields are included in output" {
    audit_append "$WORK_DIR" "coverage" "pass" '"coverage_pct":77.1,"modules_total":5'
    log_path=$(_audit_log_win)
    python3 - "$log_path" <<'EOF'
import sys, json
path = sys.argv[1]
d = json.loads(open(path).readline())
assert d['coverage_pct'] == 77.1, f"coverage_pct={d.get('coverage_pct')}"
assert d['modules_total'] == 5, f"modules_total={d.get('modules_total')}"
print("ok")
EOF
}

# ---------------------------------------------------------------------------
# Append semantics
# ---------------------------------------------------------------------------

@test "audit_append: multiple calls append, not overwrite" {
    audit_append "$WORK_DIR" "coverage" "pass" '"coverage_pct":80.0'
    audit_append "$WORK_DIR" "sbom_scan" "pass" '"cve_critical":0'
    audit_append "$WORK_DIR" "kmp_verify" "fail" '"errors":3'
    line_count=$(wc -l < "$AUDIT_LOG")
    [ "$line_count" -eq 3 ]
}

@test "audit_append: each line in multi-append is valid JSON" {
    audit_append "$WORK_DIR" "coverage" "pass" '"coverage_pct":80.0'
    audit_append "$WORK_DIR" "sbom_scan" "warn" '"cve_high":2'
    result=$(_validate_json_line)
    [ "$result" = "ok" ]
}

@test "audit_append: events are in append order" {
    audit_append "$WORK_DIR" "coverage" "pass" '"n":1'
    audit_append "$WORK_DIR" "sbom_scan" "pass" '"n":2'
    audit_append "$WORK_DIR" "kmp_verify" "pass" '"n":3'
    events=$(_get_all_events)
    [ "$events" = "coverage,sbom_scan,kmp_verify" ]
}

# ---------------------------------------------------------------------------
# Robustness
# ---------------------------------------------------------------------------

@test "audit_append: does not crash when project has no git repo" {
    NO_GIT_DIR=$(mktemp -d)
    audit_append "$NO_GIT_DIR" "coverage" "pass" '"coverage_pct":50.0'
    rm -rf "$NO_GIT_DIR"
}

@test "audit_append: works when extra_fields is empty string" {
    audit_append "$WORK_DIR" "android_test" "pass" ''
    [ -f "$AUDIT_LOG" ]
    result=$(_validate_json_line)
    [ "$result" = "ok" ]
}
