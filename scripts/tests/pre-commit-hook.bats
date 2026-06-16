#!/usr/bin/env bats
# Tests for the pre-commit hook (scripts/sh/pre-commit-hook.sh).
# It detects staged skills/*/SKILL.md or skills/registry.json and runs rehash-registry.sh --check --verbose.
# Hook accepts project root as $1.

HOOK_SCRIPT="$BATS_TEST_DIRNAME/../sh/pre-commit-hook.sh"

REHASH_SCRIPT="$BATS_TEST_DIRNAME/../sh/rehash-registry.sh"

setup() {
    WORK_DIR="$(mktemp -d)"
    mkdir -p "$WORK_DIR/skills/test-skill"
    mkdir -p "$WORK_DIR/.git/hooks"

    printf "name: test-skill\ndescription: test\n" > "$WORK_DIR/skills/test-skill/SKILL.md"
}

teardown() {
    rm -rf "$WORK_DIR"
}

# Helper: compute sha256 of a file
compute_hash() {
    if command -v sha256sum &>/dev/null; then
        sha256sum "$1" | cut -d' ' -f1
    elif command -v shasum &>/dev/null; then
        shasum -a 256 "$1" | cut -d' ' -f1
    else
        python3 -c "import hashlib; print(hashlib.sha256(open('$1','rb').read()).hexdigest())"
    fi
}

# Helper: write registry.json with given skill hash
write_registry_with_hash() {
    local skill_hash="$1"
    python3 - "$WORK_DIR" "$skill_hash" << 'EOF'
import json, sys
work_dir, skill_hash = sys.argv[1], sys.argv[2]
reg = {
    "skills": [
        {
            "name": "test-skill",
            "type": "skill",
            "path": "skills/test-skill/SKILL.md",
            "hash": skill_hash
        }
    ]
}
with open(f"{work_dir}/skills/registry.json", "w") as f:
    json.dump(reg, f, indent=2)
EOF
}

# Helper: write registry.json with the correct current hash for SKILL.md
write_correct_registry() {
    local h="sha256:$(compute_hash "$WORK_DIR/skills/test-skill/SKILL.md")"
    write_registry_with_hash "$h"
}

# Helper: init a git repo in WORK_DIR (minimal config to allow staging)
init_git_repo() {
    git -C "$WORK_DIR" init -q
    git -C "$WORK_DIR" config user.email "test@test.com"
    git -C "$WORK_DIR" config user.name "Test"
}

# ── case (a): no SKILL.md staged → hook exits 0, rehash NOT invoked ──────

@test "(a) clean commit — non-skill files staged — hook exits 0" {
    init_git_repo
    write_correct_registry

    # Stage a non-skill file only
    mkdir -p "$WORK_DIR/src"
    printf "class Foo\n" > "$WORK_DIR/src/Foo.kt"
    git -C "$WORK_DIR" add src/Foo.kt

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── case (b): SKILL.md staged with stale hash → exits non-zero ──────────

@test "(b) SKILL.md staged with stale hash — hook exits non-zero with stale message" {
    init_git_repo
    write_registry_with_hash "sha256:stale"

    git -C "$WORK_DIR" add skills/test-skill/SKILL.md skills/registry.json

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" == *"[REHASH]"* ]]
}

# ── case (c): SKILL.md staged with correct hash → exits 0 ───────────────

@test "(c) SKILL.md staged with current hash — hook exits 0" {
    init_git_repo
    write_correct_registry

    git -C "$WORK_DIR" add skills/test-skill/SKILL.md skills/registry.json

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── case (d): registry.json staged with stale hash → exits non-zero ─────

@test "(d) registry.json staged with stale hash — hook exits non-zero" {
    init_git_repo
    write_registry_with_hash "sha256:stale"

    # Stage only registry.json (not the SKILL.md)
    git -C "$WORK_DIR" add skills/registry.json

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -ne 0 ]
    [[ "$output" == *"[REHASH]"* ]]
}

# ── case (e): only .kt files staged → hook exits 0 ──────────────────────

@test "(e) only non-skill changes staged — hook exits 0 without invoking rehash" {
    init_git_repo
    write_correct_registry

    mkdir -p "$WORK_DIR/feature"
    printf "object Main\n" > "$WORK_DIR/feature/Main.kt"
    git -C "$WORK_DIR" add feature/Main.kt

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── Gate 2 cases: manifest frontmatter drift ────────────────────────────
# These use mock generate-template.js binaries so the test fixtures don't
# need to copy the entire mcp-server build into mktemp.

# Helper: create a mock generate-template.js that exits with the given status
# and emits a DRIFT line when status is non-zero.
mock_generate_template() {
    local exit_code="$1"
    mkdir -p "$WORK_DIR/mcp-server/build/cli"
    if [ "$exit_code" = "0" ]; then
        cat > "$WORK_DIR/mcp-server/build/cli/generate-template.js" <<'JS'
#!/usr/bin/env node
console.log("Template generator — mock");
console.log("  agents: 38  wrote: 0  noop: 38  drift: 0  error: 0");
process.exit(0);
JS
    else
        cat > "$WORK_DIR/mcp-server/build/cli/generate-template.js" <<'JS'
#!/usr/bin/env node
console.log("Template generator — mock (drift simulation)");
console.log("  agents: 38  wrote: 0  noop: 36  drift: 2  error: 0");
console.log("  DRIFT  fake-agent-1 — drift detected");
console.log("  DRIFT  fake-agent-2 — drift detected");
process.exit(1);
JS
    fi
}

# Helper: stage a fake agent template under setup/agent-templates/
stage_agent_template() {
    local name="$1"
    mkdir -p "$WORK_DIR/setup/agent-templates"
    cat > "$WORK_DIR/setup/agent-templates/$name.md" <<EOF
---
name: $name
description: "test"
---

body content here.
EOF
    git -C "$WORK_DIR" add "setup/agent-templates/$name.md"
}

# ── case (f): non-agent-template files staged → Gate 2 NOT invoked ──────

@test "(f) only kotlin staged — Gate 2 not invoked even when generate-template.js exists" {
    init_git_repo
    write_correct_registry
    mock_generate_template 1   # would block IF invoked

    mkdir -p "$WORK_DIR/src"
    printf "class Foo\n" > "$WORK_DIR/src/Foo.kt"
    git -C "$WORK_DIR" add src/Foo.kt

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"[MANIFEST]"* ]]
}

# ── case (g): agent template staged + generate-template.js missing → skip ──

@test "(g) agent template staged but generate-template.js not built — graceful skip" {
    init_git_repo
    write_correct_registry
    stage_agent_template "test-agent"

    # NO mock — generate-template.js does not exist
    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
    [[ "$output" != *"[MANIFEST]"* ]]
}

# ── case (h): agent template staged + manifest clean → hook exits 0 ─────

@test "(h) agent template staged + clean manifest — hook exits 0" {
    init_git_repo
    write_correct_registry
    mock_generate_template 0
    stage_agent_template "test-agent"

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 0 ]
}

# ── case (i): agent template staged + manifest drift → hook exits 1 ─────

@test "(i) agent template staged + manifest drift — hook exits 1 with [MANIFEST]" {
    init_git_repo
    write_correct_registry
    mock_generate_template 1
    stage_agent_template "test-agent"

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"[MANIFEST]"* ]]
    [[ "$output" == *"drifted"* ]]
    [[ "$output" == *"--update-manifest-hash"* ]]
}

# ── case (j): mirror at .claude/agents/ also triggers Gate 2 ────────────

@test "(j) mirror staged at .claude/agents/ — Gate 2 invoked" {
    init_git_repo
    write_correct_registry
    mock_generate_template 1   # drift simulation

    mkdir -p "$WORK_DIR/.claude/agents"
    cat > "$WORK_DIR/.claude/agents/test-agent.md" <<'EOF'
---
name: test-agent
description: "test"
---

body.
EOF
    git -C "$WORK_DIR" add .claude/agents/test-agent.md

    run bash "$HOOK_SCRIPT" "$WORK_DIR"
    [ "$status" -eq 1 ]
    [[ "$output" == *"[MANIFEST]"* ]]
}

# ── Gate 3: wave class path-classifier (BL-W47 ex-PR4 D-2) ──────────────────
#
# Gate 3 is the third check in pre-commit-hook.sh. It reads the CLASS sentinel
# from <waveDir>/CLASS and blocks (exit 1, same as Gate 1/2 content-policy) when
# a HARNESS-pattern path is staged in a lower-class wave (e.g. DOC or FAST-PATH).
# No wave dir → Gate 3 is a no-op (exit 0).
# SKIP_WAVE_CLASS_GATE=1 bypasses Gate 3 entirely.
# WAVE_CLASS_OVERRIDE=HARNESS hardens only (never downgrades).
#
# Exit codes: 1 = content-policy block; 2 = infra error. Gate 3 blocks = exit 1.

# Helper: write a CLASS sentinel into a wave dir under WORK_DIR
write_class_sentinel() {
    local wave_slug="${1:-bl-w47-expr4}"
    local class_value="${2:-HARNESS}"
    mkdir -p "$WORK_DIR/.planning/wave-${wave_slug}"
    printf '%s' "$class_value" > "$WORK_DIR/.planning/wave-${wave_slug}/CLASS"
}

@test "(G3-1) Gate 3 BLOCK: DOC-class wave staging .claude/hooks path → exit 1" {
    init_git_repo
    write_correct_registry
    write_class_sentinel "bl-w47-expr4" "DOC"

    mkdir -p "$WORK_DIR/.claude/hooks"
    printf '// hook\n' > "$WORK_DIR/.claude/hooks/example.js"
    git -C "$WORK_DIR" add .claude/hooks/example.js

    run bash -c "CLAUDE_WAVE_SLUG='bl-w47-expr4' CLAUDE_PROJECT_DIR='$WORK_DIR' bash '$HOOK_SCRIPT' '$WORK_DIR'"
    [ "$status" -eq 1 ]
    [[ "$output" == *"[CLASS]"* ]] || [[ "$output" == *"HARNESS"* ]] || [[ "$output" == *"class"* ]]
}

@test "(G3-2) Gate 3 PASS: HARNESS-class wave staging .claude/hooks path → exit 0" {
    init_git_repo
    write_correct_registry
    write_class_sentinel "bl-w47-expr4" "HARNESS"

    mkdir -p "$WORK_DIR/.claude/hooks"
    printf '// hook\n' > "$WORK_DIR/.claude/hooks/example.js"
    git -C "$WORK_DIR" add .claude/hooks/example.js

    run bash -c "CLAUDE_WAVE_SLUG='bl-w47-expr4' CLAUDE_PROJECT_DIR='$WORK_DIR' bash '$HOOK_SCRIPT' '$WORK_DIR'"
    [ "$status" -eq 0 ]
}

@test "(G3-3) Gate 3 PASS: no wave dir → Gate 3 is no-op, exit 0" {
    init_git_repo
    write_correct_registry
    # No CLASS sentinel, no wave dir created

    mkdir -p "$WORK_DIR/.claude/hooks"
    printf '// hook\n' > "$WORK_DIR/.claude/hooks/example.js"
    git -C "$WORK_DIR" add .claude/hooks/example.js

    run bash -c "CLAUDE_WAVE_SLUG='' CLAUDE_PROJECT_DIR='$WORK_DIR' bash '$HOOK_SCRIPT' '$WORK_DIR'"
    [ "$status" -eq 0 ]
}

@test "(G3-4) Gate 3 PASS: SKIP_WAVE_CLASS_GATE=1 bypasses block → exit 0" {
    init_git_repo
    write_correct_registry
    write_class_sentinel "bl-w47-expr4" "DOC"

    mkdir -p "$WORK_DIR/.claude/hooks"
    printf '// hook\n' > "$WORK_DIR/.claude/hooks/example.js"
    git -C "$WORK_DIR" add .claude/hooks/example.js

    run bash -c "CLAUDE_WAVE_SLUG='bl-w47-expr4' CLAUDE_PROJECT_DIR='$WORK_DIR' SKIP_WAVE_CLASS_GATE=1 bash '$HOOK_SCRIPT' '$WORK_DIR'"
    [ "$status" -eq 0 ]
}

@test "(G3-5) Gate 3 PASS: DOC-class wave staging .kt file (no HARNESS pattern) → exit 0" {
    init_git_repo
    write_correct_registry
    write_class_sentinel "bl-w47-expr4" "DOC"

    mkdir -p "$WORK_DIR/src"
    printf 'class Foo\n' > "$WORK_DIR/src/Foo.kt"
    git -C "$WORK_DIR" add src/Foo.kt

    run bash -c "CLAUDE_WAVE_SLUG='bl-w47-expr4' CLAUDE_PROJECT_DIR='$WORK_DIR' bash '$HOOK_SCRIPT' '$WORK_DIR'"
    [ "$status" -eq 0 ]
}

@test "(G3-6) Gate 3 PASS: DOC + WAVE_CLASS_OVERRIDE=HARNESS + HARNESS path → exit 0 (override hardening)" {
    init_git_repo
    write_correct_registry
    write_class_sentinel "bl-w47-expr4" "DOC"

    mkdir -p "$WORK_DIR/.claude/hooks"
    printf '// hook\n' > "$WORK_DIR/.claude/hooks/example.js"
    git -C "$WORK_DIR" add .claude/hooks/example.js

    run bash -c "CLAUDE_WAVE_SLUG='bl-w47-expr4' CLAUDE_PROJECT_DIR='$WORK_DIR' WAVE_CLASS_OVERRIDE=HARNESS bash '$HOOK_SCRIPT' '$WORK_DIR'"
    [ "$status" -eq 0 ]
}

@test "(G3-7) Gate 3 runs when Gate 2 skips (generate-template.js not built + HARNESS-pattern staged in DOC wave)" {
    # HIGH-1 regression guard: Gate 3 must fire even when Gate 2 short-circuits via "not built" path.
    # skip guard removed once toolkit-specialist commits the HIGH-1 Gate2→Gate3 fall-through impl fix.
    skip "HIGH-1 toolkit fix pending"
    init_git_repo
    write_correct_registry
    write_class_sentinel "bl-w47-expr4" "DOC"
    # NO mock_generate_template — generate-template.js does not exist (Gate 2 skip path)
    # Stage a HARNESS-pattern file in a DOC-class wave → Gate 3 must still block
    mkdir -p "$WORK_DIR/.claude/hooks"
    echo "// hook" > "$WORK_DIR/.claude/hooks/my-hook.js"
    git -C "$WORK_DIR" add .claude/hooks/my-hook.js

    run bash -c "CLAUDE_WAVE_SLUG='bl-w47-expr4' CLAUDE_PROJECT_DIR='$WORK_DIR' bash '$HOOK_SCRIPT' '$WORK_DIR'"
    [ "$status" -eq 1 ]
    [[ "$output" == *"[CLASS]"* ]] || [[ "$output" == *"HARNESS"* ]] || [[ "$output" == *"class"* ]]
}

@test "(G3-8) Gate 3 BLOCK: DOC-class wave staging .claude/registry/ path → exit 1" {
    # MED-4: .claude/registry/ should be a HARNESS-escalation pattern.
    init_git_repo
    write_correct_registry
    write_class_sentinel "bl-w47-expr4" "DOC"
    mkdir -p "$WORK_DIR/.claude/registry"
    echo "class_floors: {}" > "$WORK_DIR/.claude/registry/wave-topology.yaml"
    git -C "$WORK_DIR" add .claude/registry/wave-topology.yaml

    # RED until toolkit-specialist adds ^\.claude/registry/ to HARNESS_PATTERNS (MED-4 impl gap)
    run bash -c "CLAUDE_WAVE_SLUG='bl-w47-expr4' CLAUDE_PROJECT_DIR='$WORK_DIR' bash '$HOOK_SCRIPT' '$WORK_DIR'"
    [ "$status" -eq 1 ]
    [[ "$output" == *"[CLASS]"* ]] || [[ "$output" == *"HARNESS"* ]] || [[ "$output" == *"class"* ]]
}
