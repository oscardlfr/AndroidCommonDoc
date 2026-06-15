#!/usr/bin/env bats
#
# Tests for skills/pre-pr/SKILL.md + setup/copilot-templates/pre-pr.prompt.md.
# Asserts that the QG-phase routing + P2-honesty messaging is present and that
# no push-proof minting action appears inside an executable ```bash fence.
#
# These are read-only content assertions. /pre-pr is a behavioral skill — do NOT
# attempt to execute it here.
#
# 20 assertions: A1·A1b·A2·A2b·A3·A4·A5(×4)·A6(×2)·A6b(×2)·A7·A7b·A8·A8b·A9·A9b
#
# Invocation: bats scripts/tests/pre-pr-proof.bats  (from repo root)

export KMP_TEST_RUNNER_BYPASS=1
REPO_ROOT="$BATS_TEST_DIRNAME/../.."
SKILL="$REPO_ROOT/skills/pre-pr/SKILL.md"
TEMPLATE="$REPO_ROOT/setup/copilot-templates/pre-pr.prompt.md"

# ── A1 — "Quality Gate phase" routing anchor present in SKILL ────────────────

@test "A1  SKILL: contains 'Quality Gate phase'" {
  grep -q "Quality Gate phase" "$SKILL"
}

# ── A1b — same phrase present in TEMPLATE ────────────────────────────────────

@test "A1b TEMPLATE: contains 'Quality Gate phase'" {
  grep -q "Quality Gate phase" "$TEMPLATE"
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

# ── A6 — no push-proof MINTING action inside ```bash fences in SKILL ─────────
# Routing prose legitimately names emit-push-proof.sh in untagged ``` fences.
# Only ```bash (tagged) fences contain executable steps — check those only.

@test "A6a SKILL: does NOT invoke emit-push-proof inside a bash fenced block" {
  result=$(awk '
    /^```bash/ { in_fence=1; next }
    /^```/     { in_fence=0; next }
    in_fence && /emit-push-proof/ { found=1 }
    END { exit found }
  ' "$SKILL"; echo $?)
  [ "$result" -eq 0 ]
}

@test "A6b SKILL: does NOT contain '> push-proof.json' redirect (no minting action)" {
  ! grep -qE '(>|>>)[[:space:]]*[^[:space:]]*push-proof\.json' "$SKILL"
}

# ── A6b (template) — same two checks on TEMPLATE ─────────────────────────────

@test "A6b-1 TEMPLATE: does NOT invoke emit-push-proof inside a bash fenced block" {
  result=$(awk '
    /^```bash/ { in_fence=1; next }
    /^```/     { in_fence=0; next }
    in_fence && /emit-push-proof/ { found=1 }
    END { exit found }
  ' "$TEMPLATE"; echo $?)
  [ "$result" -eq 0 ]
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

# ── A9 — P2-honesty "does NOT assert" banner present in SKILL ────────────────

@test "A9  SKILL: contains 'does NOT assert'" {
  grep -q "does NOT assert" "$SKILL"
}

# ── A9b — same phrase present in TEMPLATE ────────────────────────────────────

@test "A9b TEMPLATE: contains 'does NOT assert'" {
  grep -q "does NOT assert" "$TEMPLATE"
}
