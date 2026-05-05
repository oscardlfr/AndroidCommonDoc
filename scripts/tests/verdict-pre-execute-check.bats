#!/usr/bin/env bats

# Test 6 uses `build/` path which is gitignored per .gitignore line 7. No temp .gitignore needed.

SCRIPT="$BATS_TEST_DIRNAME/../../scripts/sh/verdict-pre-execute-check.sh"
TMPDIR="${BATS_TEST_TMPDIR:-/tmp}"

# ---------------------------------------------------------------------------
# TEST 1 -- check_cross_file_pins: G bumps template_version, H has manifest yaml (PASS)
# ---------------------------------------------------------------------------
@test "TEST 1: cross_file_pins -- template_version bump with manifest yaml in H exits 0" {
  local f="$TMPDIR/verdict-cp1-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

- template_version: "1.0.0" -> "2.0.0"

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md
.claude/registry/agents.manifest.yaml
skills/registry.json

Pending amendments: 0

pre_edit_lines: 380
post_edit_estimate: 380

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# TEST 2 -- check_cross_file_pins: G bumps template_version, H missing manifest yaml (FAIL)
# ---------------------------------------------------------------------------
@test "TEST 2: cross_file_pins -- template_version bump but manifest yaml missing in H exits 1" {
  local f="$TMPDIR/verdict-cp2-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

- template_version: "1.0.0" -> "2.0.0"

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md

Pending amendments: 0

pre_edit_lines: 380
post_edit_estimate: 380

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"agents.manifest.yaml"* ]]
}

# ---------------------------------------------------------------------------
# TEST 3 -- check_commit_scope: feat(agents) is in whitelist (PASS)
# ---------------------------------------------------------------------------
@test "TEST 3: commit_scope -- feat(agents) is in whitelist exits 0" {
  local f="$TMPDIR/verdict-cs3-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

Commit subject: feat(agents): verdict pre-execute checklist (BL-W42 PR2)

## H. Atomic commit files

scripts/sh/verdict-pre-execute-check.sh

Pending amendments: 0

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# TEST 4 -- check_commit_scope: feat(setup) is NOT in whitelist (FAIL)
# ---------------------------------------------------------------------------
@test "TEST 4: commit_scope -- feat(setup) is not in whitelist exits 1" {
  local f="$TMPDIR/verdict-cs4-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

Commit subject: feat(setup): add new template files (BL-W42 PR2)

## H. Atomic commit files

scripts/sh/verdict-pre-execute-check.sh

Pending amendments: 0

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"setup"* ]]
}

# ---------------------------------------------------------------------------
# TEST 5 -- check_section_h_gitignored: all tracked paths (PASS)
# ---------------------------------------------------------------------------
@test "TEST 5: section_h_gitignored -- only tracked paths in H exits 0" {
  local f="$TMPDIR/verdict-gi5-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

## H. Atomic commit files

scripts/sh/verdict-pre-execute-check.sh
scripts/tests/verdict-pre-execute-check.bats

Pending amendments: 0

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# TEST 6 -- check_section_h_gitignored: build/ is gitignored (FAIL)
# ---------------------------------------------------------------------------
@test "TEST 6: section_h_gitignored -- build/something.txt is gitignored exits 1" {
  local f="$TMPDIR/verdict-gi6-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

## H. Atomic commit files

build/something.txt

Pending amendments: 0

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"gitignored"* ]]
}

# ---------------------------------------------------------------------------
# TEST 7 -- check_new_doc_frontmatter: docs/agents/foo.md with all 5 fields (PASS)
# ---------------------------------------------------------------------------
@test "TEST 7: new_doc_frontmatter -- docs path with all 5 frontmatter fields exits 0" {
  local f="$TMPDIR/verdict-df7-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

New doc spec:
```yaml
---
scope: [workflow, ai-agents]
sources: [androidcommondoc]
targets: [all]
slug: foo
category: agents
---
```

## H. Atomic commit files

docs/agents/foo.md

Pending amendments: 0

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# TEST 8 -- check_new_doc_frontmatter: docs/agents/foo.md missing targets: field (FAIL)
# ---------------------------------------------------------------------------
@test "TEST 8: new_doc_frontmatter -- docs path missing targets field exits 1" {
  local f="$TMPDIR/verdict-df8-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

New doc spec:
```yaml
---
scope: [workflow, ai-agents]
sources: [androidcommondoc]
slug: foo
category: agents
---
```

## H. Atomic commit files

docs/agents/foo.md

Pending amendments: 0

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"targets:"* ]]
}

# ---------------------------------------------------------------------------
# TEST 9 -- check_amendment_count: body has "Pending amendments: 0" (PASS)
# ---------------------------------------------------------------------------
@test "TEST 9: amendment_count -- Pending amendments line present exits 0" {
  local f="$TMPDIR/verdict-ac9-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

Pending amendments: 0

## H. Atomic commit files

scripts/sh/some-script.sh

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# TEST 10 -- check_amendment_count: no amendment line at all (FAIL)
# ---------------------------------------------------------------------------
@test "TEST 10: amendment_count -- no Pending amendments line exits 1" {
  local f="$TMPDIR/verdict-ac10-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

## H. Atomic commit files

scripts/sh/some-script.sh

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Pending amendments"* ]]
}

# ---------------------------------------------------------------------------
# TEST 11 -- check_cap_escalation: agent template, post_edit_estimate 380 (no escalation needed, PASS)
# ---------------------------------------------------------------------------
@test "TEST 11: cap_escalation -- post_edit_estimate 380 (below threshold) exits 0" {
  local f="$TMPDIR/verdict-ce11-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

Pending amendments: 0

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md

pre_edit_lines: 425
post_edit_estimate: 380

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 0 ]
}

# ---------------------------------------------------------------------------
# TEST 12 -- check_cap_escalation: post_edit_estimate 395 (>=391) but requires_extraction absent (FAIL)
# ---------------------------------------------------------------------------
@test "TEST 12: cap_escalation -- post_edit_estimate 395 without requires_extraction exits 1" {
  local f="$TMPDIR/verdict-ce12-$$.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

Pending amendments: 0

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md

pre_edit_lines: 425
post_edit_estimate: 395

## I. Acceptance criteria
EOF
  run bash "$SCRIPT" "$f"
  [ "$status" -eq 1 ]
  [[ "$output" == *"requires_extraction"* ]]
}
