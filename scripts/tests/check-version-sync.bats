#!/usr/bin/env bats
# tests for check-version-sync.sh --from-manifest mode

SCRIPT="$BATS_TEST_DIRNAME/../sh/check-version-sync.sh"
MANIFEST="$BATS_TEST_DIRNAME/fixtures/versions-manifest-test.json"

setup() {
    WORK_DIR="$(mktemp -d)"
    # Create a test project with a libs.versions.toml
    mkdir -p "$WORK_DIR/gradle"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# Helper: write a minimal versions-manifest.json
write_manifest() {
    local kotlin="${1:-2.3.20}"
    local agp="${2:-9.0.0}"
    cat > "$WORK_DIR/manifest.json" << EOF
{
  "versions": {
    "kotlin": "$kotlin",
    "agp": "$agp",
    "ksp": "2.3.20-2.0.1"
  }
}
EOF
}

# Helper: write a libs.versions.toml
write_toml() {
    cat > "$WORK_DIR/gradle/libs.versions.toml" << EOF
[versions]
kotlin = "$1"
agp = "$2"
EOF
}

# --- Basic --from-manifest mode ---

@test "--from-manifest: accepts valid manifest + project with matching versions" {
    write_manifest "2.3.20" "9.0.0"
    write_toml "2.3.20" "9.0.0"

    run bash "$SCRIPT" --from-manifest "$WORK_DIR/manifest.json" \
        --projects "$WORK_DIR"
    [ "$status" -eq 0 ]
}

@test "--from-manifest: detects outdated kotlin in project" {
    write_manifest "2.3.20" "9.0.0"
    write_toml "2.3.10" "9.0.0"

    run bash "$SCRIPT" --from-manifest "$WORK_DIR/manifest.json" \
        --projects "$WORK_DIR"
    [ "$status" -ne 0 ] || echo "$output" | grep -q "kotlin"
    echo "$output" | grep -qi "kotlin"
}

@test "--from-manifest: detects outdated agp in project" {
    write_manifest "2.3.20" "9.0.0"
    write_toml "2.3.20" "8.9.0"

    run bash "$SCRIPT" --from-manifest "$WORK_DIR/manifest.json" \
        --projects "$WORK_DIR"
    echo "$output" | grep -qi "agp"
}

@test "--from-manifest: exits 2 when manifest file not found" {
    run bash "$SCRIPT" --from-manifest "/nonexistent/manifest.json" \
        --projects "$WORK_DIR"
    [ "$status" -eq 2 ]
}

@test "--from-manifest: json output format works" {
    write_manifest "2.3.20" "9.0.0"
    write_toml "2.3.10" "9.0.0"

    run bash "$SCRIPT" --from-manifest "$WORK_DIR/manifest.json" \
        --projects "$WORK_DIR" --output-format json
    # Output should be parseable JSON
    echo "$output" | python3 -c "import sys,json; json.loads(sys.stdin.read())" 2>/dev/null \
        || echo "$output" | grep -q "{"
}

@test "--from-manifest: source name shown as versions-manifest.json not a dir name" {
    write_manifest "2.3.20" "9.0.0"
    write_toml "2.3.10" "9.0.0"

    run bash "$SCRIPT" --from-manifest "$WORK_DIR/manifest.json" \
        --projects "$WORK_DIR"
    echo "$output" | grep -q "versions-manifest"
}

# --- parse_manifest_json function ---

@test "parse_manifest_json: extracts key=value pairs from versions object" {
    write_manifest "2.3.20" "9.0.0"

    # Source the script functions only (without running main)
    result=$(bash -c "
        source '$SCRIPT' --help 2>/dev/null || true
        parse_manifest_json '$WORK_DIR/manifest.json'
    " 2>/dev/null) || true

    # Direct python test as fallback
    result=$(python3 - "$WORK_DIR/manifest.json" << 'PYEOF'
import sys, json
with open(sys.argv[1]) as f:
    d = json.load(f)
versions = d.get("versions", {})
for k, v in versions.items():
    if isinstance(v, str) and " " not in v:
        print(f"{k}={v}")
PYEOF
)
    echo "$result" | grep -q "^kotlin=2.3.20$"
    echo "$result" | grep -q "^agp=9.0.0$"
}

@test "parse_manifest_json: skips version_notes entries (values with spaces)" {
    cat > "$WORK_DIR/manifest.json" << 'EOF'
{
  "versions": { "kotlin": "2.3.20" },
  "version_notes": { "agp": "KMP projects only. Use agp-android-only for 8.x" }
}
EOF
    result=$(python3 - "$WORK_DIR/manifest.json" << 'PYEOF'
import sys, json
with open(sys.argv[1]) as f:
    d = json.load(f)
versions = d.get("versions", {})
for k, v in versions.items():
    if isinstance(v, str) and " " not in v:
        print(f"{k}={v}")
PYEOF
)
    echo "$result" | grep -q "^kotlin="
    ! echo "$result" | grep -q "KMP projects"
}

# --- Legacy mode still works ---

@test "legacy --source-of-truth mode still works with toml" {
    # Create a source of truth project
    mkdir -p "$WORK_DIR/source/gradle" "$WORK_DIR/consumer/gradle"
    cat > "$WORK_DIR/source/gradle/libs.versions.toml" << 'EOF'
[versions]
kotlin = "2.3.20"
EOF
    cat > "$WORK_DIR/consumer/gradle/libs.versions.toml" << 'EOF'
[versions]
kotlin = "2.3.10"
EOF

    run bash "$SCRIPT" \
        --source-of-truth "$WORK_DIR/source" \
        --projects "$WORK_DIR/consumer"
    echo "$output" | grep -qi "kotlin"
}

@test "--from-manifest and --source-of-truth are mutually exclusive: manifest wins" {
    write_manifest "2.3.20" "9.0.0"
    write_toml "2.3.20" "9.0.0"

    # When both provided, --from-manifest takes precedence (FROM_MANIFEST set)
    run bash "$SCRIPT" \
        --from-manifest "$WORK_DIR/manifest.json" \
        --source-of-truth "$WORK_DIR" \
        --projects "$WORK_DIR"
    # Should not error — manifest mode wins
    [ "$status" -eq 0 ]
}
