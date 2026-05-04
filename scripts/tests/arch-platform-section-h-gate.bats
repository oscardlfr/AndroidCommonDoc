#!/usr/bin/env bats

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/sh/lint-verdict-section-h.sh"
TMPDIR="${BATS_TEST_TMPDIR:-/tmp}"

make_verdict() {
  local file="$TMPDIR/verdict-$$.md"
  cat > "$file" <<'VERDICT'
VERDICT
  echo "$file"
}

# --------------------------------------------------------------------------
# TEST 1 -- Missing manifest yaml when template_version bumped (must fail)
# --------------------------------------------------------------------------
@test "TEST 1: missing agents.manifest.yaml when section G bumps template_version exits non-zero" {
  local f="$TMPDIR/verdict-test1-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

- template_version: "1.25.0" -> "1.26.0"

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md
skills/registry.json

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -ne 0 ]
  [[ "$output" == *"agents.manifest.yaml"* ]]
}

# --------------------------------------------------------------------------
# TEST 2 -- Placeholder string in section H (must fail)
# --------------------------------------------------------------------------
@test "TEST 2: angle-bracket placeholder in section H exits non-zero" {
  local f="$TMPDIR/verdict-test2-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes in this wave.

## H. Atomic commit files

setup/agent-templates/arch-platform.md
<registry manifest -- path from rehash-registry.sh>

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -ne 0 ]
  [[ "$output" == *"placeholder"* ]]
}

# --------------------------------------------------------------------------
# TEST 3 -- Valid verdict with version bump and both registry files (must pass)
# --------------------------------------------------------------------------
@test "TEST 3: valid verdict with template_version bump and both registry paths exits 0" {
  local f="$TMPDIR/verdict-test3-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

- template_version: "1.25.0" -> "1.26.0"

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md
.claude/registry/agents.manifest.yaml
skills/registry.json

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}

# --------------------------------------------------------------------------
# TEST 4 -- No version bump, no registry files in H (must pass)
# --------------------------------------------------------------------------
@test "TEST 4: no template_version bump in section G, no registry files in H exits 0" {
  local f="$TMPDIR/verdict-test4-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

Add Section H Authoring Rule block to arch-platform template.

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}

# --------------------------------------------------------------------------
# TEST 5 -- Two template_version bumps, both registry files in H (must pass)
# --------------------------------------------------------------------------
@test "TEST 5: two template_version bumps with both registry files in H exits 0" {
  local f="$TMPDIR/verdict-test5-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

- arch-platform template_version: "1.25.0" -> "1.26.0"
- arch-testing template_version: "1.27.0" -> "1.28.0"

## H. Atomic commit files

setup/agent-templates/arch-platform.md
setup/agent-templates/arch-testing.md
.claude/agents/arch-platform.md
.claude/agents/arch-testing.md
.claude/registry/agents.manifest.yaml
skills/registry.json

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}
