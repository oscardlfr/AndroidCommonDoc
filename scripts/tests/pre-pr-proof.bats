#!/usr/bin/env bats
#
# Tests for skills/pre-pr/SKILL.md + setup/copilot-templates/pre-pr.prompt.md.
# Asserts that the Option-A messaging (PASS ≠ push-auth; route to /quality-gate)
# is present and that no push-proof minting action leaked into either file.
#
# These are read-only content assertions. /pre-pr is a behavioral skill — do NOT
# attempt to execute it here.
#
# 18 assertions: A1·A1b·A2·A2b·A3·A4·A5(×4)·A6(×2)·A6b(×2)·A7·A7b·A8·A8b
#
# Invocation: bats scripts/tests/pre-pr-proof.bats  (from repo root)

export KMP_TEST_RUNNER_BYPASS=1
REPO_ROOT="$BATS_TEST_DIRNAME/../.."
SKILL="$REPO_ROOT/skills/pre-pr/SKILL.md"
TEMPLATE="$REPO_ROOT/setup/copilot-templates/pre-pr.prompt.md"

# ── A1 — "run  /quality-gate" present in SKILL (two spaces) ──────────────────

@test "A1  SKILL: contains 'run  /quality-gate' (two spaces)" {
  grep -q "run  /quality-gate" "$SKILL"
}

# ── A1b — same phrase present in TEMPLATE ────────────────────────────────────

@test "A1b TEMPLATE: contains 'run  /quality-gate' (two spaces)" {
  grep -q "run  /quality-gate" "$TEMPLATE"
}

# ── A2 — "NOT push authorization" present in SKILL ───────────────────────────

@test "A2  SKILL: contains 'NOT push authorization'" {
  grep -q "NOT push authorization" "$SKILL"
}

# ── A2b — same phrase present in TEMPLATE ────────────────────────────────────

@test "A2b TEMPLATE: contains 'NOT push authorization'" {
  grep -q "NOT push authorization" "$TEMPLATE"
}

# ── A3 — "--supersede" flag reference present in SKILL ───────────────────────

@test "A3  SKILL: contains '--supersede'" {
  grep -q -- "--supersede" "$SKILL"
}

# ── A4 — heredoc receipt line preserved in SKILL ─────────────────────────────

@test "A4  SKILL: contains 'cat > \"\$STAMP_PATH\" <<EOF' (receipt heredoc)" {
  grep -qF 'cat > "$STAMP_PATH" <<EOF' "$SKILL"
}

# ── A5 — four JSON keys present in SKILL receipt block ───────────────────────

@test "A5a SKILL: contains '\"verdict\"' (JSON receipt key)" {
  grep -q '"verdict"' "$SKILL"
}

@test "A5b SKILL: contains '\"timestamp\"' (JSON receipt key)" {
  grep -q '"timestamp"' "$SKILL"
}

@test "A5c SKILL: contains '\"head\"' (JSON receipt key)" {
  grep -q '"head"' "$SKILL"
}

@test "A5d SKILL: contains '\"branch\"' (JSON receipt key)" {
  grep -q '"branch"' "$SKILL"
}

# ── A6 — no push-proof MINTING action in SKILL ───────────────────────────────
# The prose may legitimately NAME push-proof.json/run-qg for routing purposes;
# we only block imperative minting actions (bash invocation or redirect write).

@test "A6a SKILL: does NOT contain 'bash emit-push-proof' (no minting action)" {
  ! grep -qE 'bash[[:space:]]+(scripts/sh/)?emit-push-proof' "$SKILL"
}

@test "A6b SKILL: does NOT contain '> push-proof.json' redirect (no minting action)" {
  ! grep -qE '(>|>>)[[:space:]]*[^[:space:]]*push-proof\.json' "$SKILL"
}

# ── A6b (template) — same two negative checks on TEMPLATE ────────────────────

@test "A6b-1 TEMPLATE: does NOT contain 'bash emit-push-proof' (no minting action)" {
  ! grep -qE 'bash[[:space:]]+(scripts/sh/)?emit-push-proof' "$TEMPLATE"
}

@test "A6b-2 TEMPLATE: does NOT contain '> push-proof.json' redirect (no minting action)" {
  ! grep -qE '(>|>>)[[:space:]]*[^[:space:]]*push-proof\.json' "$TEMPLATE"
}

# ── A7 — "content-check receipt" label present in SKILL ──────────────────────

@test "A7  SKILL: contains 'content-check receipt'" {
  grep -q "content-check receipt" "$SKILL"
}

# ── A7b — same label present in TEMPLATE ─────────────────────────────────────

@test "A7b TEMPLATE: contains 'content-check receipt'" {
  grep -q "content-check receipt" "$TEMPLATE"
}

# ── A8 — Gap-1 precision clause in SKILL ─────────────────────────────────────

@test "A8  SKILL: contains 'one of two prerequisites'" {
  grep -q "one of two prerequisites" "$SKILL"
}

# ── A8b — same clause present in TEMPLATE ────────────────────────────────────

@test "A8b TEMPLATE: contains 'one of two prerequisites'" {
  grep -q "one of two prerequisites" "$TEMPLATE"
}
