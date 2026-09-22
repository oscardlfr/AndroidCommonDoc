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
  local proj="$TMPDIR/verdict-gi6-repo-$$"
  mkdir -p "$proj"
  git -C "$proj" init -q
  printf 'build/\n' > "$proj/.gitignore"
  local f="$proj/verdict-gi6.md"
  cat > "$f" << 'EOF'
## G. Dispatch

No template_version changes.

## H. Atomic commit files

build/something.txt

Pending amendments: 0

## I. Acceptance criteria
EOF
  run bash -c "cd '$proj' && bash '$SCRIPT' '$f'"
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

# ═════════════════════════════════════════════════════════════════════════════
# structured-verdict-evidence-contract (P3 consumer migration, arch-integration
# dispatch 2026-09-21T17:55:38Z): the script becomes dual-mode -- a .md path
# keeps today's exact byte-for-byte behavior (all 12 tests above, unchanged),
# and a .json path extracts rationale via verdict-evidence-contract-cli.cjs's
# read-field subcommand before running the SAME 6 checks against that
# extracted text. These assertions pin the CORRECT post-fix outcome (the same
# violation each .md-path sibling test above already proves).
#
# RED status differs per check (confirmed by arch-testing's retroactive
# verification, 2026-09-21 -- not all 6 discriminate the same way): the CURRENT
# (pre-dual-mode) script has no .json branch at all, so it scans the raw JSON
# bytes as if they were the whole markdown body. check_cross_file_pins (JSON-1),
# check_section_h_gitignored (JSON-3), check_new_doc_frontmatter (JSON-4), and
# check_cap_escalation (JSON-6) all key off $section_g/$section_h, which stay
# empty pre-fix (the G/H headers are buried inside one JSON-escaped "rationale"
# string value, never on their own line, so the ^#\{2,3\} G\./H\. anchors never
# match) -- these 4 genuinely flip from a wrong vacuous PASS pre-fix to a
# correct FAIL post-fix. check_commit_scope (JSON-2) and check_amendment_count
# (JSON-5) instead grep $content directly (never $section_g/$section_h), so
# they already correctly detect the same violation even pre-fix -- these 2
# don't discriminate old-vs-new behavior, they confirm the end-to-end .json
# pipeline (dual-mode extraction plus the check itself) produces the right
# exit code together, which is still real, non-vacuous coverage of the new
# .json path, just not a RED-before-fix proof specifically.
#
# Each case mints a genuine arch-testing-verdict-prep.json via the real
# write-verdict-request.sh + write-verdict.sh --decision approve flow (never
# hand-authored JSON), with the exact same violating G/H text as its .md-path
# sibling test piped in as the rationale -- CORE NON-VACUITY MANDATE: every
# head/plan_sha256/digest is real, computed at call time.

# _mint_json_prep_with_rationale <rationale-text> -> isolated git repo + real
# write-verdict-request.sh + write-verdict.sh --decision approve with
# <rationale-text> piped via stdin; prints "<proj-dir> <verdict-path>" (space
# separated). Mirrors JSON-PREP-1's own real-script-call pattern
# (scripts/tests/premature-execution-gate.bats ~line 1011). Callers must `cd`
# into <proj-dir> before invoking $SCRIPT against <verdict-path> -- the CLI's
# read-field subcommand (used by $SCRIPT's own .json branch) confines its read
# under process.cwd(), not under the verdict file's own directory, mirroring
# every other real-script invocation's own `cd "$proj" && ...` convention in
# this dispatch (e.g. write-verdict.sh's own confinement is relative to its
# resolved repo root the exact same way).
_mint_json_prep_with_rationale() {
  local rationale="$1"
  local proj="$TMPDIR/vpec-json-$$-${RANDOM}"
  mkdir -p "$proj"
  git -C "$proj" init -q
  git -C "$proj" -c user.email=test@example.com -c user.name=test commit -q --allow-empty -m init

  local slug="vpec-json-fixture"
  local wave_dir="$proj/.planning/wave-$slug"
  mkdir -p "$wave_dir"
  cat > "$wave_dir/PLAN.md" <<'PLANEOF'
### Wave Class

- **Class**: HARNESS

### Spawn Table

| Role | Count | Reason |
|---|---|---|
| arch-testing | 1 | fixture |
PLANEOF

  local wvr_script="$BATS_TEST_DIRNAME/../sh/write-verdict-request.sh"
  local wv_script="$BATS_TEST_DIRNAME/../sh/write-verdict.sh"
  local req_out req_path req_sha256
  req_out="$(cd "$proj" && CLAUDE_WAVE_SLUG="$slug" bash "$wvr_script" --role arch-testing --phase prep --slug "$slug")"
  req_path="$(printf '%s' "$req_out" | awk '{print $1}')"
  req_sha256="$(printf '%s' "$req_out" | awk '{print $2}')"

  bash -c "cd '$proj' && printf '%s' \"\$1\" | CLAUDE_WAVE_SLUG='$slug' bash '$wv_script' --role arch-testing --phase prep --slug '$slug' --request '$req_path' --request-sha256 '$req_sha256' --decision approve" _ "$rationale" >/dev/null 2>&1

  printf '%s %s' "$proj" "$wave_dir/arch-testing-verdict-prep.json"
}

@test "JSON-1: cross_file_pins -- template_version bump but manifest yaml missing in H, via genuine JSON PREP rationale, exits 1" {
  local rationale
  rationale="$(cat <<'RATEOF'
## G. Dispatch

- template_version: "1.0.0" -> "2.0.0"

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md

Pending amendments: 0

pre_edit_lines: 380
post_edit_estimate: 380

## I. Acceptance criteria
RATEOF
)"
  local proj verdict
  read -r proj verdict <<< "$(_mint_json_prep_with_rationale "$rationale")"
  run bash -c "cd '$proj' && bash '$SCRIPT' '$verdict'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"agents.manifest.yaml"* ]]
}

@test "JSON-2: commit_scope -- feat(setup) is not in whitelist, via genuine JSON PREP rationale, exits 1" {
  local rationale
  rationale="$(cat <<'RATEOF'
## G. Dispatch

Commit subject: feat(setup): add new template files (BL-W42 PR2)

## H. Atomic commit files

scripts/sh/verdict-pre-execute-check.sh

Pending amendments: 0

## I. Acceptance criteria
RATEOF
)"
  local proj verdict
  read -r proj verdict <<< "$(_mint_json_prep_with_rationale "$rationale")"
  # check_commit_scope reads .github/workflows/l0-ci.yml's valid_scopes relative to
  # CWD -- the scratch $proj repo has no such file (unlike the real project repo the
  # .md-path sibling test above implicitly relies on via unshifted CWD), so this
  # test supplies its own minimal one: "agents" whitelisted, "setup" deliberately not.
  mkdir -p "$proj/.github/workflows"
  printf '      valid_scopes: "agents,tests,core"\n' > "$proj/.github/workflows/l0-ci.yml"
  run bash -c "cd '$proj' && bash '$SCRIPT' '$verdict'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"setup"* ]]
}

@test "JSON-3: section_h_gitignored -- build/something.txt is gitignored, via genuine JSON PREP rationale, exits 1" {
  local rationale
  rationale="$(cat <<'RATEOF'
## G. Dispatch

No template_version changes.

## H. Atomic commit files

build/something.txt

Pending amendments: 0

## I. Acceptance criteria
RATEOF
)"
  local proj verdict
  read -r proj verdict <<< "$(_mint_json_prep_with_rationale "$rationale")"
  # check_section_h_gitignored shells out to `git check-ignore` against CWD's own
  # .gitignore -- the scratch $proj repo starts with none (unlike the real project
  # repo the .md-path sibling test above implicitly relies on, which ignores
  # build/ at its own .gitignore line 7), so this test supplies its own rule.
  printf 'build/\n' > "$proj/.gitignore"
  run bash -c "cd '$proj' && bash '$SCRIPT' '$verdict'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"gitignored"* ]]
}

@test "JSON-4: new_doc_frontmatter -- docs path missing targets field, via genuine JSON PREP rationale, exits 1" {
  local rationale
  rationale="$(cat <<'RATEOF'
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
RATEOF
)"
  local proj verdict
  read -r proj verdict <<< "$(_mint_json_prep_with_rationale "$rationale")"
  run bash -c "cd '$proj' && bash '$SCRIPT' '$verdict'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"targets:"* ]]
}

@test "JSON-5: amendment_count -- no Pending amendments line, via genuine JSON PREP rationale, exits 1" {
  local rationale
  rationale="$(cat <<'RATEOF'
## G. Dispatch

No template_version changes.

## H. Atomic commit files

scripts/sh/some-script.sh

## I. Acceptance criteria
RATEOF
)"
  local proj verdict
  read -r proj verdict <<< "$(_mint_json_prep_with_rationale "$rationale")"
  run bash -c "cd '$proj' && bash '$SCRIPT' '$verdict'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"Pending amendments"* ]]
}

@test "JSON-6: cap_escalation -- post_edit_estimate 395 without requires_extraction, via genuine JSON PREP rationale, exits 1" {
  local rationale
  rationale="$(cat <<'RATEOF'
## G. Dispatch

No template_version changes.

Pending amendments: 0

## H. Atomic commit files

setup/agent-templates/arch-platform.md
.claude/agents/arch-platform.md

pre_edit_lines: 425
post_edit_estimate: 395

## I. Acceptance criteria
RATEOF
)"
  local proj verdict
  read -r proj verdict <<< "$(_mint_json_prep_with_rationale "$rationale")"
  run bash -c "cd '$proj' && bash '$SCRIPT' '$verdict'"
  [ "$status" -eq 1 ]
  [[ "$output" == *"requires_extraction"* ]]
}
