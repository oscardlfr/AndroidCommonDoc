#!/usr/bin/env bats
# Tests for rehash-registry.sh

SCRIPT="$BATS_TEST_DIRNAME/../sh/rehash-registry.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    mkdir -p "$WORK_DIR/skills/test-skill"
    mkdir -p "$WORK_DIR/.claude/agents"
    mkdir -p "$WORK_DIR/.claude/commands"

    # Create test files
    printf "name: test-skill\n" > "$WORK_DIR/skills/test-skill/SKILL.md"
    printf "name: test-agent\n" > "$WORK_DIR/.claude/agents/test-agent.md"
    printf "# Command\n" > "$WORK_DIR/.claude/commands/test-cmd.md"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# Helper: compute expected hash
compute_hash() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        python3 -c "import hashlib; print(hashlib.sha256(open('$1','rb').read()).hexdigest())"
    fi
}

# Helper: write a registry with given hashes
write_registry() {
    local skill_hash="${1:-sha256:stale}"
    local agent_hash="${2:-sha256:stale}"
    local cmd_hash="${3:-sha256:stale}"
    cat > "$WORK_DIR/skills/registry.json" << EOF
{
  "skills": [
    {"name": "test-skill", "type": "skill", "path": "skills/test-skill/SKILL.md", "hash": "$skill_hash"},
    {"name": "test-agent", "type": "agent", "path": ".claude/agents/test-agent.md", "hash": "$agent_hash"},
    {"name": "test-cmd", "type": "command", "path": ".claude/commands/test-cmd.md", "hash": "$cmd_hash"}
  ]
}
EOF
}

# Helper: write a registry with correct hashes
write_correct_registry() {
    local h1="sha256:$(compute_hash "$WORK_DIR/skills/test-skill/SKILL.md")"
    local h2="sha256:$(compute_hash "$WORK_DIR/.claude/agents/test-agent.md")"
    local h3="sha256:$(compute_hash "$WORK_DIR/.claude/commands/test-cmd.md")"
    write_registry "$h1" "$h2" "$h3"
}

# ── rehash mode (default) ───────────────────────────────────────────────

@test "rehash: updates stale hashes and exits 0" {
    write_registry "sha256:stale1" "sha256:stale2" "sha256:stale3"

    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['updated']==3"
}

@test "rehash: exits 0 when all hashes are current" {
    write_correct_registry

    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['updated']==0; assert d['current']==3"
}

@test "rehash: actually writes correct hashes to registry" {
    write_registry "sha256:wrong" "sha256:wrong" "sha256:wrong"
    bash "$SCRIPT" --project-root "$WORK_DIR"

    # Read back and verify hash was updated (not "sha256:wrong" anymore)
    local actual
    actual=$(WORK_DIR="$WORK_DIR" python3 -c "
import json, os
reg_path = os.path.join(os.environ['WORK_DIR'], 'skills', 'registry.json')
with open(reg_path) as f:
    d = json.load(f)
for e in d['skills']:
    if e['name'] == 'test-skill':
        print(e['hash'])
")
    [[ "$actual" == sha256:* ]]
    [ "$actual" != "sha256:wrong" ]
}

@test "rehash: idempotent — second run changes nothing" {
    write_registry "sha256:stale" "sha256:stale" "sha256:stale"
    bash "$SCRIPT" --project-root "$WORK_DIR"

    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['updated']==0"
}

@test "rehash: handles missing files gracefully" {
    write_registry
    rm "$WORK_DIR/.claude/commands/test-cmd.md"

    run bash "$SCRIPT" --project-root "$WORK_DIR"
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['missing']==1"
}

@test "rehash: output is valid JSON" {
    write_registry
    run bash "$SCRIPT" --project-root "$WORK_DIR"
    echo "$output" | python3 -c "import json,sys; json.load(sys.stdin)"
}

@test "rehash: --verbose shows per-entry status" {
    write_registry "sha256:stale" "sha256:stale" "sha256:stale"
    # --verbose writes to stderr; capture both streams
    local combined
    combined=$(bash "$SCRIPT" --project-root "$WORK_DIR" --verbose 2>&1)
    echo "$combined" | grep -q "REHASH"
}

# ── check mode ───────────────────────────────────────────────────────────

@test "check: exits 0 when all hashes current" {
    write_correct_registry

    run bash "$SCRIPT" --project-root "$WORK_DIR" --check
    [ "$status" -eq 0 ]
    echo "$output" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['updated']==0"
}

@test "check: exits 1 when stale hashes found" {
    write_registry "sha256:stale" "sha256:stale" "sha256:stale"

    run bash "$SCRIPT" --project-root "$WORK_DIR" --check
    [ "$status" -eq 1 ]
    echo "$output" | python3 -c "import json,sys; d=json.load(sys.stdin); assert d['updated']==3"
}

@test "check: does NOT modify registry on disk" {
    write_registry "sha256:stale" "sha256:stale" "sha256:stale"
    local before
    before=$(cat "$WORK_DIR/skills/registry.json")

    bash "$SCRIPT" --project-root "$WORK_DIR" --check || true

    local after
    after=$(cat "$WORK_DIR/skills/registry.json")
    [ "$before" = "$after" ]
}

@test "check: lists stale paths in output" {
    write_registry "sha256:stale" "sha256:stale" "sha256:stale"

    run bash "$SCRIPT" --project-root "$WORK_DIR" --check
    echo "$output" | python3 -c "
import json,sys
d = json.load(sys.stdin)
assert 'stale' in d
assert len(d['stale']) == 3
"
}

# ── error handling ───────────────────────────────────────────────────────

@test "exits 2 when registry not found" {
    run bash "$SCRIPT" --project-root "/nonexistent/path"
    [ "$status" -eq 2 ]
}

@test "exits 2 on unknown option" {
    run bash "$SCRIPT" --bad-flag
    [ "$status" -eq 2 ]
}
